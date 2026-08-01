# Human TradingView setup — MarkitTick → AFI (post plan upgrade)

Do these steps **after** the TradingView account plan upgrade enables webhook
alerts. Until then this is blocked and AFI runs on captured payloads only.

## Prerequisites
- TradingView plan that supports **webhook URL** alerts (Essential/Plus/Premium —
  webhooks are not on the free plan).
- The **MarkitTick Adaptive RSI Supertrend** indicator added to a chart on the
  symbol/timeframe you want (e.g. `BINANCE:BTCUSDT`, 5m).
- The hosted reactor URL and the webhook shared secret (from Secret Manager —
  never paste the secret into a doc or commit it).

## Ingress reality (important)
**TradingView cannot send a Google identity token** — its webhook is an
unauthenticated HTTP POST from TradingView's servers. So the MarkitTick endpoint
has to be reachable without Cloud Run IAM.

### ⚠️ Terminology correction (2026-07-31)
An earlier revision of this file told you to "keep the CPJ and **legacy** routes
IAM-only". **There are no legacy routes.** All three ingress paths are current:

| route | what it is |
|---|---|
| `POST /api/webhooks/tradingview` | The **canonical** signal-submission surface (`symbol`/`timeframe`/`strategy`/`direction`/`enrichmentProfile`). Registered in `afi-docs/atlas/afi-protocol-atlas.v1.json` as an `addressOrOperation`, referenced by four accepted governance decisions, and **the endpoint `afi-gateway` submits to** (`afiClient.ts`, `afiCli.ts`). |
| `POST /api/webhooks/tradingview/markittick` | A **thin adapter** that normalizes MarkitTick's indicator shape into the same USS v1.1 canonical form. Additive: no canonical-mapper or schema change. |
| `POST /api/ingest/cpj` | CPJ ingest — the oracle/Telegram collector path, exercised by `verify-roundtrip.sh`. |

The canonical route's last substantive commit is old (`e80ed89`, 2025-12-06)
because it is **stable**, not abandoned. Do not delete or deprecate it — doing so
breaks the Gateway and contradicts the Atlas. The repo's actual legacy guard,
`afi-reactor/test/guardrails/no-legacy-ingest.test.ts`, is about **deleted files**
(retired demo-pipeline / codex ingest paths staying deleted) and says nothing
about these routes.

### What was actually done, and why
This file previously proposed two options and warned against making the whole
reactor `allow-unauthenticated`. **Option 1 as written is not achievable on Cloud
Run**: a serverless NEG behind an HTTPS load balancer forwards requests *without*
authenticating, so the service still requires an `allUsers` → `roles/run.invoker`
binding. A load balancer buys path-scoping and Cloud Armor; it does **not** avoid
public ingress. Only an **authenticating relay** or **API Gateway** (which invokes
Cloud Run with a service account) genuinely avoids it.

Shipped instead — route-level protection **in the application** rather than at a
WAF:
- `allUsers` → `roles/run.invoker` on `afi-reactor` (needs a project-level override
  of `constraints/iam.allowedPolicyMemberDomains`; the org policy blocks it by
  default and only an Organization Policy Administrator can grant the exception).
- `WEBHOOK_SHARED_SECRET` (`body.secret`) enforced on **all three** POST routes.
- A **source-IP allowlist** on the MarkitTick route only
  (`AFI_MARKITTICK_ALLOWED_IPS=tradingview`, `src/utils/sourceIpAllowlist.ts`).
  It reads the **rightmost** `X-Forwarded-For` entry because Cloud Run *appends*
  the observed peer to any client-supplied header — reading the leftmost entry
  (Express `trust proxy: true`) is trivially spoofable and worse than no filter.
  Verified live: a request spoofing an allowlisted address is still rejected.

### Residual gap (open)
`POST /api/webhooks/tradingview` and `POST /api/ingest/cpj` are now publicly
reachable with **only the shared secret** in front of them — no IP allowlist. The
canonical route is the one Gateway v0.1 will depend on, so it is the most valuable
surface with the weakest guard. Acceptable for staging; **close it before
production** with API Gateway or an authenticating relay, or extend the source-IP
allowlist to the canonical route if its callers have stable egress addresses.

Also note the secret check is **fail-open** (`if (expectedSecret && ...)`): if
`WEBHOOK_SHARED_SECRET` were ever unset or lost its binding, all three POST routes
would accept anything. On a publicly reachable service that should fail closed.

## Create the alert
1. Open the chart with the MarkitTick indicator. **Create Alert** → Condition =
   the MarkitTick indicator (its alert conditions), **Once Per Bar Close**.
2. **Notifications → Webhook URL**:
   ```
   https://<hosted-reactor-or-relay>/api/webhooks/tradingview/markittick
   ```
3. **Message** = the MarkitTick alert JSON. v0.1 accepts:
   ```json
   {"ticker":"{{ticker}}","tf":"{{interval}}","event":"bull_cross","arsi":"{{plot_0}}","merged":"{{plot_1}}","secret":"<WEBHOOK_SHARED_SECRET>"}
   ```
   - Use the indicator's own `alert()` payload if it already emits this shape; add
     `"secret"` if a shared secret is configured.
   - v0.1 scores only `bull_cross` and `bear_cross`. Create one alert per event
     (or let the indicator emit `event` accordingly). Other events return a typed
     `422 deferred_event` — harmless, just not scored yet.
   - `arsi`/`merged` are the indicator readings; map them to the right `{{plot_n}}`
     placeholders for your MarkitTick version (they are echoed for audit, not
     required to score).

## Flip origin mode to live
On the hosted reactor, set `AFI_MARKITTICK_ORIGIN_MODE=tradingview-webhook` so
persisted records are stamped as real TradingView origin (not captured-preflight).
`AFI_MARKITTICK_PROVIDER_ID` defaults to `giovanni_tradingview_staging` in code
(`markitTickMapper.ts`), so it only needs setting to override — its binding is
published in afi-config and confirmed resolving (`froggy/trend_pullback_v1@1.0.0`).

⚠️ **Timing.** Flip it only when the *next* MarkitTick request will be a genuine
TradingView alert. Flipping early stamps synthetic/replayed payloads as real
TradingView origin, which is provenance contamination, not a labelling nit. Once
`AFI_MARKITTICK_ALLOWED_IPS=tradingview` is enforced, non-TradingView callers get a
403 and can no longer contaminate the corpus — which makes an early flip safe, but
only because of the filter.

⚠️ **Persistence.** `AFI_MARKITTICK_ORIGIN_MODE` and `AFI_MARKITTICK_ALLOWED_IPS`
are read by `deploy-roundtrip.sh` from `roundtrip.env`, which is **gitignored**. A
deploy from a fresh clone omits both and **silently disables the source-IP filter**
(the allowlist defaults to empty = off). Set them in `roundtrip.env` on any machine
that deploys, or the filter is one redeploy away from being gone.

## Confirm real acceptance
- Trigger the alert (or wait for a real cross). Confirm the reactor returns 200
  with `origin.originMode = "tradingview-webhook"`, a real `analystScore.uwrScore`,
  and `persistence.outcome = "inserted"`.
- Read the persisted Evidence V3 record back and confirm `lifecycleState: SCORED`
  with `recordHash`/`replayHash`, `provenance.source = "tradingview"`, and
  `provenance.indicatorId = "markittick_adaptive_rsi_supertrend_v1"`.
- Only then is this **real TradingView-origin acceptance** — record it in the
  acceptance report (not the preflight one).
