# AFI TradingView Low-Latency Origin — Preflight Report v0.1 (REDACTED)

> Redacted: no secrets, no Mongo URI, no webhook secret, no identity tokens.

**Status:** PREFLIGHT PASSING · **Real TradingView-origin acceptance: BLOCKED**
until the TradingView account plan upgrade enables webhook URLs.
**Date:** 2026-07-25 · **Origin mode:** `captured-preflight`

## Scope
- Indicator source: **MarkitTick Adaptive RSI Supertrend** (external TradingView
  Pine indicator — source not committed/redistributed; treated as an external
  signal source).
- Events scored (v0.1): `bull_cross → LONG`, `bear_cross → SHORT`. The other
  emitted events (`squeeze_breakout`, `st_flip_bull/bear`, `ob_entry`, `os_entry`)
  are deferred (`422 deferred_event`).
- Path: `MarkitTick alert → POST /api/webhooks/tradingview/markittick → USS v1.1
  → froggy/trend_pullback_v1 composition (parallel lanes) → UWR score → Evidence
  V3 → scored response + latency block`.

## Environment
- Reactor: in-process oracle harness (afi-reactor), the sanctioned real-scoring
  path (`test/oracle/markitTickCapturedPreflight.test.ts` + `...LatencyBench.test.ts`).
- Provider binding: `giovanni-tradingview-staging` (providerType `webhook`) →
  `froggy/trend_pullback_v1/1.0.0` (resolved via the binding's defaultStrategy;
  the raw MarkitTick alert carries no providerId — the route injects it).
- Enrichment configuration: technical = **demo feed** (local/fast), pattern =
  **local kernel** (real); sentiment/news/aiMl = **recorded/cached** transports —
  i.e. the low-latency profile's "sentiment cached / aiMl cached" selection.
- Persistence: **measured** (in-memory OracleEvidenceStore, afi-infra submit
  semantics).

## Captured-payload scoring — real synchronous score
| Case | HTTP | uwrScore | direction | persistence | recordHash (prefix) | replayHash (prefix) | lifecycle |
|---|---|---|---|---|---|---|---|
| `bull_cross` | 200 | 0.591666… | long | inserted | `b3b7ee25de6d…` | `be96612cb9ad…` | SCORED |
| `bear_cross` | 200 | 0.591666… | short | inserted | `5cd699def2ca…` | `401b4aadf114…` | SCORED |

- `origin = { source:"tradingview", indicatorId:"markittick_adaptive_rsi_supertrend_v1",
  event, direction, symbol:"BTCUSDT", timeframe:"5m", arsi, merged,
  providerId, originMode:"captured-preflight" }` (named `origin`, not `source`).
- Evidence V3 `provenance` carries the source metadata as strings
  (`source`, `providerType:"tradingview"`, `indicatorId`, `indicatorEvent`,
  `originMode`, `providerRef`, `sourceExchange`). Raw `arsi`/`merged` readings ride
  as top-level payload fields into the `ingestHash` (a hex string in the afi.hash.v1
  inputHash preimage — verified: differing readings ⇒ differing ingestHash) and are
  echoed on the HTTP response — NOT placed as raw floats in the hashed evidence.
- Both cases score the same UWR (the froggy scorer reads the technical setup, not
  the alert direction) — expected and correct.

## Warm-service latency (p50 / p95 / max, ms) — 40 warm iterations, persistence measured
| Stage | p50 | p95 | max |
|---|---|---|---|
| **total (server)** | **19** | **29** | **29** |
| ingest | 1 | 1 | 1 |
| mapper | 0 | 1 | 1 |
| scorer | 15 | 23 | 25 |
| persistence | 3 | 5 | 6 |
| lane:technical | 3 | 3 | 4 |
| lane:pattern | 3 | 3 | 6 |
| lane:sentiment | 4 | 6 | 7 |
| lane:news | 4 | 5 | 7 |
| lane:aiMl | 2 | 4 | 8 |
| lane:merge | 1 | 1 | 1 |
| lane:scorer | 1 | 1 | 1 |

- **Warm low-latency target <150–200ms: MET** (total p95 = 29ms) with local/cached/
  fast providers. Clock: `Date.now-ms`.
- **Doctrine:** `total ≈ ingest + max(required lane) + scorer + persistence`. With
  **live** remote lanes (CFTC COT / SEC EDGAR / hosted Tiny Brains) the total is
  bounded by the slowest REQUIRED lane and runs **1–3s+** — reported, not hidden.
- Lane status vocabulary present per lane (`resolved`/`degraded`/`skipped`/
  `failed_optional`); a required-lane timeout/failure aborts the whole run.

## What is real
- Real synchronous UWR scoring through the governed froggy composition (scorer +
  decay + UWR profile); real Evidence V3 construction + validation + persistence
  (`lifecycleState: SCORED`, recordHash/replayHash verified from the persisted
  record). Not a fake fast score.
- technical (demo feed) + pattern (local kernel) run their real kernels; the three
  remote lanes run their real derivation math over recorded/cached transports.

## Deferred / not claimed
- **Real TradingView-origin acceptance** — blocked until the plan upgrade + a real
  MarkitTick webhook (`HUMAN-TRADINGVIEW-SETUP.md`).
- **Registered fast-lane composition** (drops sentiment/news/aiMl as required
  lanes) — a governed afi-config change (README "staged next step"); v0.1 realizes
  the profile via the cached-lane selection instead.
- Events beyond bull_cross/bear_cross; Participant Gateway.

## Reproduce
```
cd afi-reactor
npx jest test/oracle/markitTickCapturedPreflight.test.ts   # scoring + persistence
npx jest test/oracle/markitTickLatencyBench.test.ts        # p50/p95 latency
npx jest test/pipeline/markitTickMapper.test.ts            # mapper units
```
Hosted (after deploy): `AFI_REACTOR_URL=<url> node deploy/tradingview-origin/verify-markittick.mjs`.
