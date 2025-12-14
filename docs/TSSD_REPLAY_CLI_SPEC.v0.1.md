# TSSD Replay CLI – v0.1 Spec

Status: draft spec for v0.1 (implementation lives in a future PR).

## 1. Purpose & Scope

The TSSD Replay CLI replays stored `VaultedSignalRecord` documents from the T.S.S.D. Vault through AFI’s scoring/evaluation pipeline. It is for audits, regression analysis, and validator behavior investigation—never for live trading. Replays operate over existing TSSD data; they do not regenerate history or mutate canonical records.

## 2. Key Invariants

- Determinism  
  Given the same `VaultedSignalRecord` plus the same pinned code/config, a replay run must produce identical outputs across runs. No use of `Date.now()`, random numbers, or network data inside replayed scoring logic unless already baked into the original record.

- Read-only over canonical history  
  The CLI must not overwrite or mutate documents in the main `tssd_signals` collection. If replay results are stored, they must go to a separate audit/replay collection (e.g., `tssd_replay_audit`) or local output only.

- Version awareness  
  Replay commands must record the code version (git SHA or package version), the scoring/DAG version used for replay, the time, and the operator (if available). Replays must never be confused with the original epoch’s scoring.

- Traceability  
  Every replay run should be traceable: capture input filters, counts of signals replayed, and a summary of mismatches vs original scores where applicable.

- Isolation / safety  
  Replay should not call external APIs or live data sources. It should only talk to TSSD (Mongo) for reads, local scoring/analysis code, and optionally dedicated replay/audit collections.

## 3. Terminology

- TSSD / `VaultedSignalRecord`: Canonical per-signal lifecycle document as defined in `docs/TSSD_VAULT_SPEC.md` and `src/tssd/types.ts`.
- Replay run: One execution of the CLI with a specific filter set and versioned scoring config.
- Audit record: Optional replay output (diffs/mismatches) written to a dedicated replay/audit collection, never to `tssd_signals`.
- Scoring pipeline: The replay-time scoring/analysis invocation (stub initially; future alignment with EnrichedSignalCore and analyst modules).

## 4. CLI UX (v0.1)

Command name is TBD; examples assume a local runner:

- `npx afi-tssd-replay ...`  
- `node ./bin/tssd-replay.mjs ...`

Core flags:
- Target selection: `--signal-id <id>`, `--epoch-id <epoch>`, `--analyst-id <id>`, `--strategy-id <id>`, `--from <ISO>`, `--to <ISO>`, `--limit <n>`
- TSSD connection: `--mongo-uri`, `--db-name`, `--collection` (default from env used by `MongoTSSDVaultClient`)
- Replay behavior: `--dry-run`, `--output=json|ndjson|table`, `--scorer-version <tag-or-sha>` or `--dag-version <id>`
- Audit/diff (design only): `--write-audit` writes to a dedicated replay/audit collection (distinct from `tssd_signals`)

Examples:
```
# Replay one signal by ID
npx afi-tssd-replay --signal-id signal_123 --dry-run --output=table

# Replay all BTCUSDT 1h signals for an epoch and output NDJSON
npx afi-tssd-replay --epoch-id epoch_2025_11 --strategy-id trend_pullback_v1 --output=ndjson --limit 500

# Replay a time range with dry-run table output
node ./bin/tssd-replay.mjs --from 2025-11-01T00:00:00Z --to 2025-11-02T00:00:00Z --dry-run --output=table
```

## 5. Execution Model (v0.1)

1. Parse CLI args and resolve env/config for Mongo and scoring.
2. Query TSSD (via `MongoTSSDVaultClient`) for matching `VaultedSignalRecord` documents.
3. For each record:
   - Derive the scoring/enrichment input (stub in v0.1; future alignment with EnrichedSignalCore and analyst modules like Froggy).
   - Call the scoring/analysis pipeline (spec only; no wiring here).
   - Compare replayed results with `stages.scored` where present.
4. Aggregate totals: records replayed, matches vs mismatches, optional score delta distribution.
5. Emit results via the chosen output mode and, if `--write-audit` is enabled, persist to a dedicated replay/audit collection (never to `tssd_signals`).

## 6. Non-goals for v0.1

- No live trade execution.
- No mutation of original TSSD records.
- No fancy UI.
- No cross-repo orchestration with `afi-reactor` yet; this runs as a local infra tool against TSSD and local scoring code.

## 7. Future Extensions

- Integrate with `afi-reactor` DAG definitions.
- Support multiple analyst profiles and full UWR-based scoring.
- Stream results to AFI dashboards or external monitoring/alerting systems.
