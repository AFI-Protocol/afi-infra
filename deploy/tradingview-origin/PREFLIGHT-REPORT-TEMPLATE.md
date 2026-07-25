# AFI TradingView Low-Latency Origin — Preflight Report (REDACTED TEMPLATE)

> Redacted: no secrets, no Mongo URI, no webhook secret, no identity tokens, no
> full connection strings. Fill `<...>` and the metric tables from a real run.

**Status:** PREFLIGHT PASSING · **Real TradingView-origin acceptance: BLOCKED**
until the TradingView account plan upgrade enables webhook URLs.
**Date:** `<YYYY-MM-DD>` · **Origin mode:** `captured-preflight`

## Scope
- Indicator source: **MarkitTick Adaptive RSI Supertrend** (external TradingView
  Pine indicator — source not committed/redistributed).
- Events scored (v0.1): `bull_cross → LONG`, `bear_cross → SHORT`. Others deferred.
- Signal path: `MarkitTick alert → /api/webhooks/tradingview/markittick → USS v1.1
  → froggy composition (parallel lanes) → UWR score → Evidence V3 → scored response`.

## Environment
- Reactor: `<local in-process harness | hosted reactor url>`
- Provider binding: `giovanni-tradingview-staging` (providerType `webhook`) →
  `froggy/trend_pullback_v1/1.0.0`.
- Enrichment configuration under test: `<recorded/cached remote lanes + demo feed |
  live blofin + live/hosted lanes>`.
- Persistence: `<measured (store=...) | excluded-by-config>`.

## Captured-payload scoring (real synchronous score)
| Case | HTTP | uwrScore | direction | persistence | recordHash (prefix) | replayHash (prefix) |
|---|---|---|---|---|---|---|
| `bull_cross` | `<200>` | `<0.xx>` | long | `<inserted>` | `<abcd1234…>` | `<abcd1234…>` |
| `bear_cross` | `<200>` | `<0.xx>` | short | `<inserted>` | `<abcd1234…>` | `<abcd1234…>` |

- `origin.source = tradingview`, `origin.indicatorId = markittick_adaptive_rsi_supertrend_v1`,
  `origin.originMode = captured-preflight`.
- Evidence V3 provenance carries the source metadata (strings only); the raw
  `arsi`/`merged` readings are committed via the ingestHash and echoed on the
  response (never as raw floats in the hashed evidence).

## Warm-service latency (p50 / p95 / max, ms)
Configuration: `<demo feed + recorded/cached remote lanes>` · iterations `<N>`.

| Stage | p50 | p95 | max |
|---|---|---|---|
| total (server) | `<19>` | `<29>` | `<29>` |
| ingest | `<1>` | `<1>` | `<1>` |
| mapper | `<0>` | `<1>` | `<1>` |
| scorer | `<15>` | `<23>` | `<25>` |
| persistence | `<3>` | `<5>` | `<6>` |
| lane:technical | | | |
| lane:pattern | | | |
| lane:sentiment | | | |
| lane:news | | | |
| lane:aiMl | | | |

**Latency doctrine:** `total ≈ ingest + max(required lane) + scorer + persistence`.
Warm low-latency (local/cached/fast) target **<150–200ms** — met above. Slower
provider selections (live CFTC/EDGAR/Tiny Brains) run **1–3s+**, bounded by the
slowest REQUIRED lane. No universal <150ms claim.

## What is real
- Real synchronous UWR scoring through the governed froggy composition (scorer,
  decay, UWR profile) with real Evidence V3 construction + validation + persistence.
- technical (`<demo|blofin>`) + pattern (local kernel) run their real kernels.
- Remote lanes: `<recorded/cached (preflight) | live>`.

## What is deferred / not claimed
- Real TradingView-origin acceptance (needs the plan upgrade + a real webhook).
- Registered fast-lane composition (a governed afi-config change — see README
  "staged next step"); v0.1 uses the cached-lane realization of the profile.
- Events other than bull_cross/bear_cross.
- Participant Gateway (out of scope).

## Reproduce
- In-repo (preflight): `cd afi-reactor && npx jest test/oracle/markitTick*`
- Standalone (hosted): `AFI_REACTOR_URL=<url> node verify-markittick.mjs` and
  `... node bench-markittick.mjs`.
