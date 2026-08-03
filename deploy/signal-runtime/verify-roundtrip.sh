#!/usr/bin/env bash
# AFI Signal Runtime — staging round-trip: ACCEPTANCE harness.
#
# Mints a FRESH BTC/USDT.P CPJ signal payload (new signalId + current timestamp,
# NOT the committed fixture), POSTs it to the live hosted Reactor over Cloud Run
# IAM auth, asserts HTTP 200 with a UWR score in the response, reads the
# persisted Evidence V3 record back from MongoDB Atlas and verifies its
# lifecycleState / recordHash / replayHash — then SELF-CLEANS: the probe's
# rows are deleted from every store and zero residue is asserted (owner
# ruling 2026-08-02: no test signals present anywhere; DH-GOV D-DH-4(1)).
# Failure to clean is a script failure.
#
# Secrets are pulled from Secret Manager at runtime — never from a file.
# roundtrip.env supplies only non-secret config (project/region).
#
#   [AFI_REACTOR_URL=https://afi-reactor-xxx.run.app] ./verify-roundtrip.sh
# Optional signal-claim overrides: ENTRY, STOP_LOSS, TAKE_PROFIT.
#
# NOTE: this reads Atlas directly for the persisted-record check, so this
# machine's current IP must be temporarily allowlisted in Atlas Network Access.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Locate the AFI-Protocol workspace root by walking up — works from scripts/deploy/
# or afi-infra/deploy/signal-runtime/.
WORKSPACE=""; d="$HERE"
for _ in 1 2 3 4 5 6; do
  d="$(cd "$d/.." && pwd)"
  if [ -d "$d/afi-reactor" ] && [ -d "$d/afi-tiny-brains" ] && [ -d "$d/afi-config" ]; then WORKSPACE="$d"; break; fi
done
[ -n "$WORKSPACE" ] || { echo "FATAL: could not locate AFI-Protocol workspace root above $HERE"; exit 1; }
ENV_FILE="$HERE/roundtrip.env"
REACTOR_NM="$WORKSPACE/afi-reactor/node_modules"

[ -f "$ENV_FILE" ] || { echo "FATAL: $ENV_FILE not found."; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"
PROJECT="$AFI_GCP_PROJECT"; REGION="$AFI_GCP_REGION"

# Auto-discover the reactor URL if not provided.
if [ -z "${AFI_REACTOR_URL:-}" ]; then
  AFI_REACTOR_URL="$(gcloud run services describe afi-reactor --region "$REGION" --project "$PROJECT" --format='value(status.url)')"
fi
[ -n "$AFI_REACTOR_URL" ] || { echo "FATAL: could not resolve AFI_REACTOR_URL"; exit 1; }

# Secrets from Secret Manager (into shell vars, never a file).
SECRET="$(gcloud secrets versions access latest --secret=afi-webhook-secret --project "$PROJECT")"
MONGO_URI="$(gcloud secrets versions access latest --secret=afi-evidence-mongodb-uri --project "$PROJECT")"

ENTRY="${ENTRY:-63000}"; STOP_LOSS="${STOP_LOSS:-61500}"; TAKE_PROFIT="${TAKE_PROFIT:-66000}"
PAYLOAD_FILE="$(mktemp)"; RESP_FILE="$(mktemp)"

# Best-effort probe cleanup on ANY exit once the probe exists (D-DH-4(1)):
# SIGNAL_ID is set after step [3/6]; until then this trap only removes tmp
# files. A failure between ingest and the trap installation can still orphan
# the probe — the next run's residue warning surfaces it.
SIGNAL_ID=""
cleanup() {
  rm -f "$PAYLOAD_FILE" "$RESP_FILE"
  if [ -n "$SIGNAL_ID" ]; then
    NODE_PATH="$REACTOR_NM" MONGO_URI="$MONGO_URI" SIGNAL_ID="$SIGNAL_ID" node -e '
      const { MongoClient } = require("mongodb");
      (async () => {
        const sid = process.env.SIGNAL_ID;
        if (!sid || !sid.startsWith("cpj-")) return;
        const c = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 }); await c.connect();
        for (const [d, col] of [["afi_scored_signal_evidence","scored_signal_evidence"],["afi_scored_signal_evidence","scored_signal_evidence_history"],["afi_signal_analytics","scoring_context"],["afi_signal_analytics","signal_outcomes"]]) {
          await c.db(d).collection(col).deleteMany({ signalId: sid }).catch(() => {});
        }
        await c.close();
      })().catch(() => {});
    ' 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "==> [0/6] Atlas preflight (never mint a probe the clean cannot reach)"
NODE_PATH="$REACTOR_NM" MONGO_URI="$MONGO_URI" node -e '
  const { MongoClient } = require("mongodb");
  (async () => {
    const c = new MongoClient(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 }); await c.connect();
    await c.db("admin").command({ ping: 1 }); await c.close();
    console.log("    Atlas reachable — self-clean is possible; proceeding.");
  })().catch(e => { console.error("FATAL: Atlas unreachable (" + e.message + ") — refusing to ingest a probe that could not be cleaned."); process.exit(1); });
'

echo "==> [1/6] Mint fresh BTC/USDT.P CPJ payload"
SECRET="$SECRET" ENTRY="$ENTRY" SL="$STOP_LOSS" TP="$TAKE_PROFIT" PAYLOAD_FILE="$PAYLOAD_FILE" node -e '
  const now = new Date().toISOString();
  const uniq = `${Date.now()}-${Math.floor(Math.random()*1e6)}`;
  const payload = {
    schema: "afi.cpj.v0.1",
    secret: process.env.SECRET,
    provenance: {
      providerType: "telegram", providerId: "oracle-telegram-channel-1",
      messageId: `roundtrip-${uniq}`, postedAt: now,
      rawText: `BTC LONG entry ${process.env.ENTRY} SL ${process.env.SL} TP ${process.env.TP} (fresh round-trip ${uniq})`,
      channelName: "Round-Trip Acceptance"
    },
    extracted: {
      symbolRaw: "BTCUSDT", side: "long",
      entry: Number(process.env.ENTRY), stopLoss: Number(process.env.SL),
      takeProfits: [{ price: Number(process.env.TP) }],
      timeframeHint: "4h", venueHint: "blofin", marketTypeHint: "perp"
    },
    parse: { parserId: "roundtrip-acceptance", parserVersion: "1.0.0", confidence: 0.9 }
  };
  require("fs").writeFileSync(process.env.PAYLOAD_FILE, JSON.stringify(payload));
  console.error("    messageId:", payload.provenance.messageId, "postedAt:", now);
'

echo "==> [2/6] POST to hosted Reactor (Cloud Run IAM)"
TOKEN="$(gcloud auth print-identity-token)"
HTTP_CODE="$(curl -sS -o "$RESP_FILE" -w '%{http_code}' -X POST "$AFI_REACTOR_URL/api/ingest/cpj" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @"$PAYLOAD_FILE")"
echo "    HTTP $HTTP_CODE"
[ "$HTTP_CODE" = "200" ] || { echo "FATAL: expected 200"; cat "$RESP_FILE"; exit 1; }

echo "==> [3/6] Assert UWR score + capture signalId from the HTTP response"
# console.log emits a trailing newline so `read` returns 0 under `set -e`.
read -r SIGNAL_ID UWR OUTCOME < <(RESP_FILE="$RESP_FILE" node -e '
  const r = JSON.parse(require("fs").readFileSync(process.env.RESP_FILE,"utf8"));
  const uwr = r?.pipelineResult?.analystScore?.uwrScore;
  const sid = r?.signalId || r?.pipelineResult?.signalId;
  if (typeof uwr !== "number") { console.error("no uwrScore:", JSON.stringify(r).slice(0,600)); process.exit(1); }
  console.log(`${sid} ${uwr} ${r?.persistence?.outcome ?? "unknown"}`);
') || true
[ -n "$UWR" ] || { echo "FATAL: could not extract uwrScore"; exit 1; }
echo "    signalId=$SIGNAL_ID  uwrScore=$UWR  persistence.outcome=$OUTCOME"

echo "==> [4/6] Read Evidence V3 record back from MongoDB Atlas"
NODE_PATH="$REACTOR_NM" MONGO_URI="$MONGO_URI" SIGNAL_ID="$SIGNAL_ID" node -e '
  const { MongoClient } = require("mongodb");
  (async () => {
    const c = new MongoClient(process.env.MONGO_URI); await c.connect();
    const rec = await c.db("afi_scored_signal_evidence").collection("scored_signal_evidence").findOne({ signalId: process.env.SIGNAL_ID });
    await c.close();
    if (!rec) { console.error("FATAL: no persisted record for", process.env.SIGNAL_ID); process.exit(1); }
    console.log("    lifecycleState:", rec.lifecycleState);
    console.log("    recordHash:    ", rec.recordHash && rec.recordHash.value);
    console.log("    replayHash:    ", rec.replayHash && rec.replayHash.value);
    console.log("    finalized:", rec.finalized, " recordVersion:", rec.recordVersion);
    const ok = rec.lifecycleState === "SCORED" && rec.recordHash && rec.recordHash.value && rec.replayHash && rec.replayHash.value;
    if (!ok) { console.error("FATAL: missing SCORED state or hashes"); process.exit(1); }
    console.log("    persisted-record verification: PASS");
  })().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
'

echo "==> [5/6] Self-clean: delete the probe's rows everywhere, assert zero residue"
NODE_PATH="$REACTOR_NM" MONGO_URI="$MONGO_URI" SIGNAL_ID="$SIGNAL_ID" node -e '
  const { MongoClient } = require("mongodb");
  (async () => {
    const c = new MongoClient(process.env.MONGO_URI); await c.connect();
    const sid = process.env.SIGNAL_ID;
    if (!sid || !sid.startsWith("cpj-")) {
      console.error("FATAL: refusing to clean — probe signalId missing or not cpj-prefixed:", sid);
      process.exit(1);
    }
    const targets = [
      ["afi_scored_signal_evidence", "scored_signal_evidence"],
      ["afi_scored_signal_evidence", "scored_signal_evidence_history"],
      ["afi_signal_analytics", "scoring_context"],
      ["afi_signal_analytics", "signal_outcomes"],
    ];
    let residue = 0, priorRuns = 0;
    for (const [dbName, colName] of targets) {
      const col = c.db(dbName).collection(colName);
      const r = await col.deleteMany({ signalId: sid });
      const left = await col.countDocuments({ signalId: sid });
      const others = await col.countDocuments({ signalId: { $regex: "^cpj-", $ne: sid } });
      residue += left; priorRuns += others;
      console.log(`    ${dbName}.${colName}: deleted ${r.deletedCount}, residue ${left}${others ? `, PRIOR-RUN cpj residue ${others}` : ""}`);
    }
    await c.close();
    if (residue > 0) { console.error("FATAL: probe residue remains after clean"); process.exit(1); }
    if (priorRuns > 0) console.warn(`    WARNING: ${priorRuns} cpj- row(s) from EARLIER runs remain — clean them (owner ruling: no test signals anywhere).`);
    console.log("    self-clean: PASS (zero residue for the current probe)");
  })().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
'

echo "==> [6/6] ACCEPTANCE PASS"
echo "    Fresh BTC/USDT.P signal -> hosted Reactor (5 real lanes) -> hosted Tiny Brains"
echo "    -> afi-core UWR=$UWR -> Evidence V3 persisted in Atlas -> hashes verified from the record"
echo "    -> probe rows self-cleaned from every store (no test signals persist)."
