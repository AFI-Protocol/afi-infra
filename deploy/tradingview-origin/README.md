# AFI TradingView Low-Latency Origin — Prep v0.1

Prepares AFI to receive a **real TradingView alert** from the **MarkitTick
Adaptive RSI Supertrend** indicator and score it synchronously, with full latency
instrumentation. Built and verified now with **captured MarkitTick payloads**;
real TradingView-origin acceptance is **BLOCKED** until the TradingView account
plan upgrade enables webhook URLs (planned next week).

> The MarkitTick indicator is a third-party Pine **indicator** (not a strategy).
> Its Pine source is **not** committed or redistributed here — it is treated as
> an external TradingView signal source.

## Pipeline

```
MarkitTick alert (or captured equivalent for preflight)
  → POST /api/webhooks/tradingview/markittick   (afi-reactor)
  → MarkitTick adapter  (ticker→symbol, tf→timeframe, event→direction)
  → canonical USS v1.1  (+ source metadata on provenance)
  → provider-binding resolution → registered composition
  → enrichment lanes run in parallel dependency waves
  → froggy scorer → UWR score
  → Evidence V3 persistence (measured; excludable by config)
  → scored HTTP response + latency block
```

### v0.1 event scope
| MarkitTick event | v0.1 |
|---|---|
| `bull_cross` | **BUY / LONG** |
| `bear_cross` | **SELL / SHORT** |
| `squeeze_breakout`, `st_flip_bull`, `st_flip_bear`, `ob_entry`, `os_entry` | **deferred** (typed `422 deferred_event`) |

### Request / response
Request (raw MarkitTick alert):
```json
{ "ticker": "BINANCE:BTCUSDT", "tf": "5", "event": "bull_cross", "arsi": "61.25", "merged": "58.90" }
```
Response (200): the scored `ReactorScoredSignalV1` (`signalId`, `analystScore.uwrScore`,
`rawUss`, …) plus:
- `persistence` — Evidence V3 outcome (`inserted` / `idempotent-duplicate` / `skipped-by-config`)
- `origin` — `{ source:"tradingview", indicatorId, event, direction, symbol, timeframe, arsi, merged, providerId, originMode }`
  (named `origin`, not `source`: the scored signal already reserves a top-level `source`)
- `latency` — `{ selectedProfileId, totalLatencyMs, ingestLatencyMs, mapperLatencyMs, scorerLatencyMs, persistenceLatencyMs, persistence, lanes:[{lane,nodeId,wave,latencyMs,status}] }`

`origin.originMode` is `captured-preflight` until a real TradingView webhook
fires (set `AFI_MARKITTICK_ORIGIN_MODE=tradingview-webhook` post plan upgrade).

## Provider identity & auth
- MarkitTick alerts carry no provider identity. The route injects
  `providerId = payload.providerId || AFI_MARKITTICK_PROVIDER_ID || "giovanni_tradingview_staging"`.
- The **`giovanni-tradingview-staging`** provider binding (afi-config,
  `providerType: webhook`) routes the registered `froggy/trend_pullback_v1/1.0.0`
  strategy. An unknown/inactive provider is an honest `403`.
- Optional shared secret: `WEBHOOK_SHARED_SECRET` on the reactor; supply it as
  `body.secret` (weak — stack Cloud Run IAM on top for the hosted deploy).

## Latency doctrine (reported, never promised)
```
total ≈ ingest + max(required enrichment lane) + scorer + persistence/emit
```
- **Warm low-latency profile** (local/cached/fast providers): target **<150–200ms**.
- **Slower provider selections** (live CFTC COT / SEC EDGAR / hosted Tiny Brains):
  **1–3s+**, bounded by the **slowest REQUIRED lane**.
- Per-lane latency + status are always reported. There is no universal <150ms claim.
- Lane status vocabulary: `resolved` (executed), `degraded` (fail-open), `skipped`,
  `failed_optional`. A **required** (critical) lane that times out/fails aborts the
  whole synchronous run (request-level failure), never a partial score.

Latency is emitted on the HTTP response **only** — never in the canonical
Evidence V3 record (governance bans wall-clock timing from the hashed evidence).

## The low-latency enrichment profile (Munni / Buy Sell Terminal v1)

Target profile (define/document):

| Lane | v0.1 low-latency profile |
|---|---|
| technical | local/cached/fast only (demo/cached OHLCV) |
| pattern | local/cached/fast only (in-process kernel) |
| sentiment | disabled or **cached** only |
| news | **disabled** |
| aiMl | local/cached only, or disabled if remote Tiny Brains can't meet the budget |
| execution | all selected required lanes run in **parallel**; response is **synchronous** |

**How it is realized in v0.1 (honestly):** the reactor's registered composition
is the single governed `froggy/trend_pullback_v1` five-lane pipeline. The
scorer only reads technical (+ pattern); sentiment/news/aiMl are inert at the
scorer. For preflight, the sanctioned real-scoring harness runs technical (demo
feed) + pattern (local kernel) REAL and serves the three remote reference lanes
from **recorded/cached** transports — i.e. the "sentiment cached / aiMl cached"
selection above. This produces a **real** synchronous scored signal at warm
low-latency (see the preflight report), not a fake fast score.

**Staged (owner-authorized) next step — a registered fast composition.** A
first-class fast profile that *drops* sentiment/news/aiMl as required lanes needs
a NEW registered composition in afi-config (a `froggy-trend-pullback-fast`
pipeline manifest + analyst-strategy registration + repointed binding
`defaultStrategy`). That was **not** done in v0.1 because it changes a governed
invariant: `afi-config/tests/registries-seeding-validation.test.ts` pins a single
registered strategy and asserts every binding routes only the froggy triple.
Registering a second strategy + relaxing those drift pins is a governance change
that needs owner authorization. Steps, when authorized:
1. Author `registries/pipelines/froggy-trend-pullback-fast--v1.0.0.json` = nodes
   `{technical(entry), pattern, merge, scorer}` + edges
   `technical→pattern(candles)`, `technical→merge(optional)`,
   `pattern→merge(optional)`, `merge→scorer` (drop sentiment/news/aiMl).
2. Author `analyst-strategies/froggy--trend_pullback_fast_v1--1.0.0.json` +
   `.config.json` (pipelineRef.manifestHash = `computeManifestHash(fast)`,
   analystConfigHash = `computeAnalystConfigHash(config)`; both recomputed +
   verified at reactor boot).
3. Repoint `giovanni-tradingview-staging.defaultStrategy` to the fast triple (and
   add it to `allowedStrategies`).
4. Relax the single-strategy drift pins in `registries-seeding-validation.test.ts`
   (allow bindings to route the fast triple) + add the new pipeline/strategy to
   the pinned file lists.

## Running the scripts
```bash
# verification (captured bull_cross + bear_cross → real scored 200 + latency)
AFI_REACTOR_URL=<reactor-url> node verify-markittick.mjs
# hosted (IAM): AFI_IDENTITY_TOKEN=$(gcloud auth print-identity-token) AFI_REACTOR_URL=<url> node verify-markittick.mjs

# warm-service latency benchmark (p50/p95/max total + per-stage + per-lane)
AFI_REACTOR_URL=<reactor-url> MARKITTICK_BENCH_ITERS=30 node bench-markittick.mjs
```
For a pure enrich+score latency number (no persistence), deploy the reactor with
`AFI_MARKITTICK_PERSIST=false`. Captured payloads live in `captured-payloads/`.

In-repo preflight equivalents (in-process, recorded lanes) — the source of the
v0.1 warm numbers — live in afi-reactor:
`test/oracle/markitTickCapturedPreflight.test.ts` (scoring) and
`test/oracle/markitTickLatencyBench.test.ts` (p50/p95). Run with
`npx jest test/oracle/markitTick*`.

## Environment (reactor)
| var | purpose |
|---|---|
| `AFI_MARKITTICK_PROVIDER_ID` | provider identity injected for MarkitTick alerts (default `giovanni_tradingview_staging`) |
| `AFI_MARKITTICK_ORIGIN_MODE` | `captured-preflight` (default) → `tradingview-webhook` once real alerts fire |
| `AFI_MARKITTICK_PERSIST` | `true` (default) measures Evidence V3 persistence; `false` excludes it by config |
| `WEBHOOK_SHARED_SECRET` | optional `body.secret` check |
| `AFI_PRICE_FEED_SOURCE` | technical lane feed. `blofin`/`coinbase` = live (required for a live hosted reactor — **production refuses `demo`**, fail-closed on synthetic feeds). `demo` = deterministic/local, available only to the in-process test harness (`NODE_ENV=test`); the demo-feed warm numbers come from there. A live warm benchmark uses `blofin` (real, keyless) for technical. |

## Real TradingView-origin acceptance (post plan upgrade)
See `HUMAN-TRADINGVIEW-SETUP.md`. Real acceptance requires a real MarkitTick
alert (webhook) to hit the hosted reactor, score, and persist/record as
**tradingview-webhook** origin (not captured-preflight). Until then, do NOT claim
real TradingView-origin acceptance.
