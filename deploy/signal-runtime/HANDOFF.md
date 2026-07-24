# AFI Signal Runtime — staging round-trip: HANDOFF / CHECKPOINT

_Checkpoint taken mid-mission. No cloud resources exist yet. Nothing committed, nothing pushed._

## Identifiers
- **GCP project ID:** `afi-signal-runtime-staging`
- **GCP project number:** `724298384563`
- **Billing account ID (Clarity's, payer=clarity):** `01F698-4D3C10-D9E18B`
- **Active account:** `giovanni@creativesolutionspartners.com`
- **DO NOT USE:** `clarity-staging-488201` (Clarity project — off-limits for AFI work)

## Current blocker
`giovanni@creativesolutionspartners.com` lacks **`billing.resourceAssociations.create`** on billing
account `01F698-4D3C10-D9E18B`. The billing-link attempt failed with `IAM_PERMISSION_DENIED`.
Fix (a **Billing Account Administrator** must grant it — giovanni@ cannot grant it to itself):

```
gcloud billing accounts add-iam-policy-binding 01F698-4D3C10-D9E18B \
  --member="user:giovanni@creativesolutionspartners.com" \
  --role="roles/billing.user"
```
(or Cloud Billing console → account `01F698-4D3C10-D9E18B` → Account management → Add principal
→ giovanni@ → role **Billing Account User**.)

## EXACT next command once billing permission is granted
```
gcloud billing projects link afi-signal-runtime-staging --billing-account=01F698-4D3C10-D9E18B
```
Verify with: `gcloud billing projects describe afi-signal-runtime-staging --format=json`
(expect `"billingEnabled": true`).

## Then (each still owner-gated; no billable action without go-ahead)
1. Enable APIs: `run artifactregistry secretmanager cloudbuild compute vpcaccess`.googleapis.com
2. Owner creates MongoDB **Atlas** replica set (db `afi_scored_signal_evidence`, least-priv
   `readWrite` user, NO 0.0.0.0/0) and provides the `mongodb+srv://` URI.
3. `cp roundtrip.env.template roundtrip.env` and set `AFI_GCP_PROJECT=afi-signal-runtime-staging`.
4. `AFI_EVIDENCE_MONGODB_URI='mongodb+srv://…' ./deploy-roundtrip.sh` (prints the Atlas egress IP).
5. Allowlist that egress IP in Atlas (+ your machine IP temporarily for read-back).
6. `./verify-roundtrip.sh` → PASS = HTTP 200 + `uwrScore` + Atlas record `SCORED` with
   `recordHash`/`replayHash`.

## Artifacts on disk (all PRESENT; secrets never written to disk)
| Path | Size | Git state |
|---|---|---|
| `afi-tiny-brains/Dockerfile` | 1492 B | untracked (`?? Dockerfile`) on `afi-tiny-brains` main |
| `afi-reactor/Dockerfile.reactor` | 1617 B | untracked (`?? Dockerfile.reactor`) on `afi-reactor` main |
| `scripts/deploy/deploy-roundtrip.sh` | 8549 B | not under git (workspace root is not a repo) |
| `scripts/deploy/verify-roundtrip.sh` | 5691 B | not under git |
| `scripts/deploy/roundtrip.env.template` | 1492 B | not under git |
| `scripts/deploy/README.md` | 3782 B | not under git |

`scripts/deploy/roundtrip.env` (the filled, project-specific copy) does **not** exist yet — correct.
No secrets are stored on disk anywhere.

## What has been done to the cloud so far
- Created project `afi-signal-runtime-staging` (+ labels product/environment/component/payer).
- Set it as the active gcloud project.
- GCP auto-enabled only `cloudapis.googleapis.com` (unavoidable, non-billable).
- **Nothing else:** no billing linked, no APIs enabled by us, no Artifact Registry / Cloud Run /
  VPC / NAT / secrets / service accounts, nothing deployed. `clarity-staging-488201` untouched.
