# AFI Signal Runtime — staging hosted round-trip

Deploys the hosted **Machine** (AFI Signal Runtime) as a staging round-trip:

```
fresh BTC/USDT.P CPJ  ──POST(IAM)──►  afi-reactor (Cloud Run, 5 real lanes)
     │                                     │  aiMl lane ──► afi-tiny-brains (Cloud Run, internal)
     │                                     ▼
     │                          afi-core UWR score ──► Evidence V3
     ▼                                     ▼
  200 + uwrScore  ◄───────────  persisted in MongoDB Atlas (read back + hashes verified)
```

Kept entirely separate from Clarity infrastructure. Its own GCP project, Artifact
Registry, Secret Manager, IAM, logs, and MongoDB Atlas.

## Files
- `../../../afi-tiny-brains/Dockerfile` — Tiny Brains image (bakes chronos-bolt-small).
- `../../../afi-reactor/Dockerfile.reactor` — Reactor image (**build context = workspace root**).
- `roundtrip.env.template` — non-secret config; copy to `roundtrip.env` and fill.
- `deploy-roundtrip.sh` — idempotent build + deploy (refuses placeholders / any `clarity*` project).
- `verify-roundtrip.sh` — acceptance: fresh payload → 200+UWR → Atlas read-back of hashes.

Secrets (Atlas URI, webhook secret) live **only** in Secret Manager — never in these files.

## Owner steps (manual, done once) — BLOCKS deployment until complete

1. **GCP project** — re-auth as the AFI owner and create the project:
   ```
   gcloud auth login                 # AFI owner identity (not the Clarity account)
   gcloud projects create afi-signal-runtime-staging   # or afi-signal-runtime-stg / -001
   gcloud billing projects link afi-signal-runtime-staging --billing-account=<BILLING_ID>
   ```
   Then confirm the final project id back to the agent.

2. **MongoDB Atlas** (you create it; agent never provisions Atlas):
   - A **replica-set** cluster (any Atlas tier — M0 free qualifies; supersede() uses txns).
   - DB `afi_scored_signal_evidence`. **Do not** pre-create collections/indexes — the app
     auto-creates `scored_signal_evidence`, `scored_signal_evidence_history`, and the
     unique `signalId_unique` index on first write.
   - A **least-priv** DB user: built-in `readWrite` scoped to `afi_scored_signal_evidence`
     only (that role already grants createCollection/createIndex/listCollections — enough).
     **No admin/root user.**
   - Network Access: **no `0.0.0.0/0`.** After step 3's deploy prints the egress IP,
     allowlist that single IP. For local read-back verification, temporarily allowlist
     your current machine IP.
   - Hand the agent the full `mongodb+srv://…/afi_scored_signal_evidence?...` URI (it goes
     straight into Secret Manager, never to disk).

3. **Fill config + deploy** (agent runs this once you confirm 1 & 2):
   ```
   cp roundtrip.env.template roundtrip.env      # set AFI_GCP_PROJECT = confirmed id
   AFI_EVIDENCE_MONGODB_URI='mongodb+srv://…' ./deploy-roundtrip.sh
   # → prints the Atlas allowlist IP and the reactor URL
   ```
   Allowlist the printed egress IP in Atlas.

4. **Acceptance:**
   ```
   ./verify-roundtrip.sh        # auto-discovers reactor URL + secrets
   ```
   PASS = HTTP 200 with `pipelineResult.analystScore.uwrScore`, and a persisted Atlas
   record with `lifecycleState: SCORED` + non-empty `recordHash`/`replayHash`.

## Notes
- All 5 lanes are real (blofin OHLCV / local pattern / CFTC COT / SEC EDGAR / Tiny Brains aiMl).
  Demo symbol must be BTC or ETH (only these are sentiment-mapped).
- Reactor egresses all traffic through a VPC connector → Cloud NAT → one reserved static IP.
- Reactor ingest is IAM-only (Cloud Run) plus a shared-secret body field; Tiny Brains is
  internal-ingress with no public exposure.
