# AFI Hosted Round-Trip v1.0 — Acceptance Report (REDACTED)

**Status: PASSING** · Date: 2026-07-24 · Environment: staging (AFI Signal Runtime = hosted Machine)

_Redacted: no secrets, no full MongoDB URI, no webhook secret, no identity tokens. Hashes shown as prefixes._

## Project
- **GCP project ID:** `afi-signal-runtime-staging` (project number `724298384563`)
- Region: `us-central1` · Payer/billing: Clarity billing account (kept separate from Clarity *projects*; `clarity-staging-488201` untouched)

## Services deployed (Cloud Run)
- **afi-reactor** — scoring pipeline server. Ingress: all; **IAM-only** (`--no-allow-unauthenticated`); `NODE_ENV=production`. Stable egress via Serverless VPC connector → Cloud NAT → one reserved static IP. URL: `https://afi-reactor-bmtbwud2xa-uc.a.run.app`
- **afi-tiny-brains** — aiMl service (chronos-bolt-small + OLS trend). **Ingress: internal**, **IAM-protected**; reactor authenticates with a Cloud Run ID token (audience = TB URL). Not publicly reachable.
- Both currently at **`min-instances=0`** (scale-to-zero; first request incurs a cold start).

## Acceptance run (fresh, real signal — not the committed fixture)
- **Primary signalId:** `cpj-telegram-oracle-telegram-channel-1-roundtrip-1784864852812-16297`
- **HTTP response:** `200 OK`, `persistence.outcome = inserted`
- **UWR score (in the HTTP response):** `0.425`
- **Evidence V3 record (read back from Atlas):** `lifecycleState = SCORED`, `recordVersion = 1`
  - `recordHash` prefix: `82b4e1f4add5…`
  - `replayHash` prefix: `22fe5df044c7…`
- A second real SCORED record also persisted (earlier successful POST):
  - signalId `…roundtrip-1784864786537-713860` — `recordHash 6a6ae1d5f881…`, `replayHash 2057dcda1671…`

## Atlas persistence
- **Database:** `afi_scored_signal_evidence`
- **Collections:** `scored_signal_evidence` (current, unique index `signalId_unique` on `{signalId:1}`) + `scored_signal_evidence_history` (auto-created on first supersede)
- Cluster: MongoDB Atlas replica set. Access: least-privilege `readWrite` user scoped to `afi_scored_signal_evidence`; network allowlist = the reactor's static egress IP + operator IP (no `0.0.0.0/0`). URI held only in GCP Secret Manager.

## What was real (no stubs, no synthetic data)
All 5 scoring lanes ran against live/real inputs:
1. **technical** — live BloFin OHLCV (ccxt, keyless)
2. **pattern** — real in-reactor deterministic kernel (STUMPY/ruptures/scipy)
3. **sentiment** — live CFTC COT (Socrata, keyless; BTC mapped)
4. **news** — live SEC EDGAR (fail-soft)
5. **aiMl** — hosted Tiny Brains: chronos-bolt-small (183MB, sha-verified) + OLS, deterministic
- Real afi-core UWR computation; real MongoDB Atlas insert + read-back; Evidence V3 recordHash/replayHash verified from the persisted record.

## What was deferred
- **Participant Gateway** (multi-tenant auth / API-key metering / rate-limit) — not deployed.
- **Signal query/read API** — none (read-back done via direct store query).
- Second Tiny Brains endpoint `/analyze/pattern` (the active pipeline runs pattern locally).
- BUY SELL TERMINAL, Factory runtime wiring, rewards/mint/token — untouched.

## No-go claims (what this is NOT)
- Not GA / not a product launch — **staging** only.
- Not highly available — **single-region, scale-to-zero, single strategy** (`froggy/trend_pullback_v1`).
- Not a public endpoint — reactor is **IAM-gated**; Tiny Brains is **internal + IAM**.
- No trade execution, no custody, no monetary settlement.
- No scoring/contract/governance changes were made (the only reactor code change is env-gated transport-layer ID-token auth).

## How to re-run acceptance
From `afi-infra/deploy/signal-runtime/` (runbook committed on branch `ops/signal-runtime-deploy-runbook`):
1. Ensure `roundtrip.env` exists locally (non-secret config; gitignored) and the Atlas URI + webhook secret are in Secret Manager.
2. Ensure Atlas Network Access allowlists the reactor's static egress IP, and (for local read-back) the operator's current IP.
3. Run:
   ```
   AFI_REACTOR_URL=https://afi-reactor-bmtbwud2xa-uc.a.run.app ./verify-roundtrip.sh
   ```
   Expected: `ACCEPTANCE PASS` — HTTP 200 with a `uwrScore`, and a persisted Atlas record with `lifecycleState: SCORED` + non-empty `recordHash`/`replayHash`.
   (Services scale from zero, so allow a few seconds of cold start on the first call.)

## Git state (preserved, not pushed)
- `afi-reactor` — branch `ops/hosted-roundtrip-v1` (`Dockerfile.reactor`, `aimlServiceClient.ts`)
- `afi-tiny-brains` — branch `ops/hosted-roundtrip-v1` (`Dockerfile`)
- `afi-infra` — branch `ops/signal-runtime-deploy-runbook` (`deploy/signal-runtime/` runbook; no secrets, no `roundtrip.env`)
