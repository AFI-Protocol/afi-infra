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
The hosted reactor is Cloud Run **IAM-protected**, but **TradingView cannot send
a Google identity token** — its webhook is an unauthenticated HTTP POST from
TradingView's servers. So for real TradingView origin, the MarkitTick endpoint
must be reachable by TradingView. Choose ONE (owner decision, security-reviewed):
1. A dedicated **public ingress** for `/api/webhooks/tradingview/markittick`
   secured by the **`WEBHOOK_SHARED_SECRET`** (`body.secret`) **plus** an allowlist
   of TradingView's published webhook source IPs (at the load balancer / WAF).
2. A thin **authenticating relay** (public, secret-checked) that forwards to the
   IAM-protected reactor with a minted identity token.

Do not simply make the whole reactor `allow-unauthenticated`. Keep the CPJ and
legacy routes IAM-only.

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
Keep `AFI_MARKITTICK_PROVIDER_ID=giovanni_tradingview_staging` (its binding must be
deployed — afi-config change published + reactor image rebuilt).

## Confirm real acceptance
- Trigger the alert (or wait for a real cross). Confirm the reactor returns 200
  with `origin.originMode = "tradingview-webhook"`, a real `analystScore.uwrScore`,
  and `persistence.outcome = "inserted"`.
- Read the persisted Evidence V3 record back and confirm `lifecycleState: SCORED`
  with `recordHash`/`replayHash`, `provenance.source = "tradingview"`, and
  `provenance.indicatorId = "markittick_adaptive_rsi_supertrend_v1"`.
- Only then is this **real TradingView-origin acceptance** — record it in the
  acceptance report (not the preflight one).
