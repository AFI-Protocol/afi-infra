#!/usr/bin/env bash
# AFI Signal Runtime — staging round-trip: build + deploy orchestrator.
#
# Deploys into the owner-confirmed AFI GCP project (NEVER a Clarity project):
#   1. afi-tiny-brains -> Cloud Run, ingress=internal + allow-unauthenticated
#      (the reactor's aiMl client sends NO identity token, so IAM is NOT used;
#       the internal-ingress network boundary is the control — never public)
#   2. afi-reactor     -> Cloud Run, IAM-only, NODE_ENV=production (5 real lanes),
#      egressing all traffic through a stable static IP (VPC connector + Cloud NAT)
#      so Atlas allowlists ONE IP, never 0.0.0.0/0.
#
# SECRETS NEVER TOUCH DISK: the Atlas URI is read from the environment (or a
# hidden prompt) and piped straight into Secret Manager; the webhook secret is
# generated once and stored only in Secret Manager. roundtrip.env holds no secrets.
#
# Idempotent; safe to re-run. Provisions the MongoDB Atlas cluster? NO — the owner
# creates that manually and supplies its SRV URI (see the questions/README).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Locate the AFI-Protocol workspace root (dir containing the sibling repos) by
# walking up — works whether this lives in scripts/deploy/ or afi-infra/deploy/signal-runtime/.
WORKSPACE=""; d="$HERE"
for _ in 1 2 3 4 5 6; do
  d="$(cd "$d/.." && pwd)"
  if [ -d "$d/afi-reactor" ] && [ -d "$d/afi-tiny-brains" ] && [ -d "$d/afi-config" ]; then WORKSPACE="$d"; break; fi
done
[ -n "$WORKSPACE" ] || { echo "FATAL: could not locate AFI-Protocol workspace root above $HERE"; exit 1; }
ENV_FILE="$HERE/roundtrip.env"

[ -f "$ENV_FILE" ] || { echo "FATAL: $ENV_FILE not found. Copy roundtrip.env.template and fill it."; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

# --- guardrails ---------------------------------------------------------------
grep -q '<[A-Z_]' "$ENV_FILE" && { echo "FATAL: roundtrip.env still has <...> placeholders."; exit 1; }
for v in AFI_GCP_PROJECT AFI_GCP_REGION AFI_AR_REPO AFI_REACTOR_SA_NAME AFI_PRICE_FEED_SOURCE \
         AFI_VPC_NETWORK AFI_VPC_CONNECTOR AFI_VPC_CONNECTOR_RANGE AFI_EGRESS_IP_NAME \
         AFI_EGRESS_ROUTER AFI_EGRESS_NAT; do
  [ -n "${!v:-}" ] || { echo "FATAL: $v is empty in roundtrip.env"; exit 1; }
done
case "$AFI_GCP_PROJECT" in
  *clarity*) echo "FATAL: refusing to deploy AFI infra into a Clarity project ('$AFI_GCP_PROJECT')."; exit 1;;
esac

PROJECT="$AFI_GCP_PROJECT"; REGION="$AFI_GCP_REGION"; REPO="$AFI_AR_REPO"
REG_HOST="${REGION}-docker.pkg.dev"
TB_IMG="${REG_HOST}/${PROJECT}/${REPO}/afi-tiny-brains:latest"
RX_IMG="${REG_HOST}/${PROJECT}/${REPO}/afi-reactor:latest"
SA_EMAIL="${AFI_REACTOR_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

echo "==> Target project: $PROJECT (region $REGION)"
ACTIVE_ACCT="$(gcloud config get-value account 2>/dev/null || true)"
echo "==> Active gcloud account: $ACTIVE_ACCT"
gcloud config set project "$PROJECT" >/dev/null
gcloud projects describe "$PROJECT" >/dev/null 2>&1 || { echo "FATAL: project '$PROJECT' not accessible by $ACTIVE_ACCT. Re-auth as the AFI owner and confirm billing."; exit 1; }

echo "==> [1/10] Enable APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com \
  compute.googleapis.com vpcaccess.googleapis.com --project "$PROJECT"

echo "==> [2/10] Artifact Registry repo (idempotent)"
gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" --repository-format=docker --location "$REGION" --project "$PROJECT"

echo "==> [3/10] Stable egress: reserved static IP + VPC connector + Cloud NAT"
gcloud compute addresses describe "$AFI_EGRESS_IP_NAME" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud compute addresses create "$AFI_EGRESS_IP_NAME" --region "$REGION" --project "$PROJECT"
EGRESS_IP="$(gcloud compute addresses describe "$AFI_EGRESS_IP_NAME" --region "$REGION" --project "$PROJECT" --format='value(address)')"
gcloud compute networks vpc-access connectors describe "$AFI_VPC_CONNECTOR" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud compute networks vpc-access connectors create "$AFI_VPC_CONNECTOR" \
       --region "$REGION" --network "$AFI_VPC_NETWORK" --range "$AFI_VPC_CONNECTOR_RANGE" --project "$PROJECT"
gcloud compute routers describe "$AFI_EGRESS_ROUTER" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud compute routers create "$AFI_EGRESS_ROUTER" --network "$AFI_VPC_NETWORK" --region "$REGION" --project "$PROJECT"
gcloud compute routers nats describe "$AFI_EGRESS_NAT" --router "$AFI_EGRESS_ROUTER" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud compute routers nats create "$AFI_EGRESS_NAT" --router "$AFI_EGRESS_ROUTER" --region "$REGION" \
       --nat-all-subnet-ip-ranges --nat-external-ip-pool="$AFI_EGRESS_IP_NAME" --project "$PROJECT"
echo "    >>> Atlas allowlist IP (add this in Atlas Network Access, NOT 0.0.0.0/0): $EGRESS_IP"

echo "==> [4/10] Atlas URI secret in Secret Manager (never written to disk / chat)"
# Prefer an owner-precreated secret (URI never enters this script's argv/env).
# Fallback: create it from AFI_EVIDENCE_MONGODB_URI if the caller exported it.
if gcloud secrets describe afi-evidence-mongodb-uri --project "$PROJECT" >/dev/null 2>&1; then
  echo "    using existing secret afi-evidence-mongodb-uri (value not read here)"
elif [ -n "${AFI_EVIDENCE_MONGODB_URI:-}" ]; then
  case "$AFI_EVIDENCE_MONGODB_URI" in mongodb+srv://*|mongodb://*) :;; *) echo "FATAL: AFI_EVIDENCE_MONGODB_URI is not a mongodb URI."; exit 1;; esac
  printf '%s' "$AFI_EVIDENCE_MONGODB_URI" | gcloud secrets create afi-evidence-mongodb-uri --data-file=- --replication-policy=automatic --project "$PROJECT" >/dev/null
  unset AFI_EVIDENCE_MONGODB_URI
  echo "    created secret afi-evidence-mongodb-uri from env"
else
  echo "FATAL: secret afi-evidence-mongodb-uri absent and no AFI_EVIDENCE_MONGODB_URI set."
  echo "Create it first with hidden input (stays out of chat + shell history):"
  echo "  read -rs U && printf '%s' \"\$U\" | gcloud secrets create afi-evidence-mongodb-uri --data-file=- --replication-policy=automatic --project=$PROJECT && unset U"
  exit 1
fi
# Webhook secret: generate ONCE, keep stable so verify can reuse it.
if ! gcloud secrets describe afi-webhook-secret --project "$PROJECT" >/dev/null 2>&1; then
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create afi-webhook-secret --data-file=- --replication-policy=automatic --project "$PROJECT" >/dev/null
  echo "    generated afi-webhook-secret"
fi

echo "==> [5/10] Reactor runtime SA + secret access (idempotent)"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$AFI_REACTOR_SA_NAME" --display-name "AFI Reactor runtime" --project "$PROJECT"
for s in afi-evidence-mongodb-uri afi-webhook-secret; do
  gcloud secrets add-iam-policy-binding "$s" --project "$PROJECT" \
    --member "serviceAccount:${SA_EMAIL}" --role roles/secretmanager.secretAccessor >/dev/null
done

echo "==> [6/10] Build + deploy Tiny Brains (internal ingress, no IAM — reactor sends no token)"
if gcloud artifacts docker images describe "$TB_IMG" --project "$PROJECT" >/dev/null 2>&1; then
  echo "    Tiny Brains image already present — skipping build (delete the tag to force rebuild)"
else
  gcloud builds submit "$WORKSPACE/afi-tiny-brains" --tag "$TB_IMG" --project "$PROJECT"
fi
gcloud run deploy afi-tiny-brains --image "$TB_IMG" --region "$REGION" --project "$PROJECT" \
  --no-allow-unauthenticated --ingress=internal \
  --memory=2Gi --cpu=1 --cpu-boost --min-instances=1 --timeout=120
TB_URL="$(gcloud run services describe afi-tiny-brains --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo "    Tiny Brains internal URL: $TB_URL"

echo "==> [7/10] Build Reactor image (minimal staged context: config+core+reactor source only)"
if gcloud artifacts docker images describe "$RX_IMG" --project "$PROJECT" >/dev/null 2>&1; then
  echo "    Reactor image already present — skipping build (delete the tag to force rebuild)"
else
  # gcloud builds submit --tag has no -f; build from a staged context whose root
  # Dockerfile is the reactor one, containing only the 3 repos' SOURCE (no
  # node_modules/dist/.git) so the upload is small and clean.
  STAGE="$(mktemp -d)"
  for r in afi-config afi-core afi-reactor; do
    mkdir -p "$STAGE/$r"
    rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .logs "$WORKSPACE/$r/" "$STAGE/$r/"
  done
  cp "$WORKSPACE/afi-reactor/Dockerfile.reactor" "$STAGE/Dockerfile"
  gcloud builds submit "$STAGE" --tag "$RX_IMG" --project "$PROJECT"
  rm -rf "$STAGE"
fi

echo "==> [8/10] Deploy Reactor (IAM-only, stable egress, wired to Tiny Brains + secrets)"
# TINY_BRAINS_ID_TOKEN_AUDIENCE enables the reactor's Cloud Run service-to-service
# auth to the IAM-protected Tiny Brains (audience = its service URL).
gcloud run deploy afi-reactor --image "$RX_IMG" --region "$REGION" --project "$PROJECT" \
  --no-allow-unauthenticated --service-account "$SA_EMAIL" \
  --vpc-connector "$AFI_VPC_CONNECTOR" --vpc-egress=all-traffic \
  --memory=1Gi --cpu=1 --timeout=120 --min-instances=1 \
  --set-env-vars "AFI_PRICE_FEED_SOURCE=${AFI_PRICE_FEED_SOURCE},TINY_BRAINS_URL=${TB_URL},TINY_BRAINS_ID_TOKEN_AUDIENCE=${TB_URL},NODE_ENV=production" \
  --set-secrets "AFI_EVIDENCE_MONGODB_URI=afi-evidence-mongodb-uri:latest,WEBHOOK_SHARED_SECRET=afi-webhook-secret:latest"

echo "==> [9/10] Grant invokers: reactor SA -> Tiny Brains, deploying account -> reactor"
# Reactor's runtime SA must be able to invoke the IAM-protected Tiny Brains.
gcloud run services add-iam-policy-binding afi-tiny-brains --region "$REGION" --project "$PROJECT" \
  --member "serviceAccount:${SA_EMAIL}" --role roles/run.invoker >/dev/null
# Deploying account must be able to invoke the IAM-protected reactor (acceptance).
gcloud run services add-iam-policy-binding afi-reactor --region "$REGION" --project "$PROJECT" \
  --member "user:${ACTIVE_ACCT}" --role roles/run.invoker >/dev/null

RX_URL="$(gcloud run services describe afi-reactor --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
echo "==> [10/10] Deployed."
echo "    Reactor URL:     $RX_URL"
echo "    Tiny Brains URL: $TB_URL (internal)"
echo "    Atlas egress IP: $EGRESS_IP  (must be allowlisted in Atlas Network Access)"
echo
echo "Before acceptance: ensure $EGRESS_IP is allowlisted in Atlas, then run:"
echo "    AFI_REACTOR_URL=$RX_URL $HERE/verify-roundtrip.sh"
