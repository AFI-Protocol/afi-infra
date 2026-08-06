# Atlas read-only custody runbook — CFG-GOV D-CFG-2(3)

**Owner-only work.** This document prepares — and does not perform — the MongoDB
Atlas role separation that D-CFG-2(3) requires: *"Write access to the canonical
evidence store is restricted to the sole canonical writer (MONGO-GOV D-MONGO-3,
unchanged). Read-only credentials are used for every non-writer consumer,
including analytics and readout tooling."* Nothing in these repos can enforce
Atlas user grants; this is infrastructure configuration in the Atlas console.

## The data topology (from code, verified 2026-08-06)

| Database | Collections | Written by |
|---|---|---|
| `afi_scored_signal_evidence` (env `AFI_EVIDENCE_DB_NAME`) | `scored_signal_evidence`, `scored_signal_evidence_history` | ONLY the reactor's evidence submit path via `afi-infra` `MongoScoredSignalEvidenceStore` (the sole canonical writer, D-MONGO-3) |
| `afi_signal_analytics` (env `AFI_ANALYTICS_DB_NAME`) | `scoring_context`, `signal_outcomes` | reactor analytics capture (`scoringContextStore.ts`); `scripts/capture-outcomes.mjs` (outcome cron) |

**Custody defect to close:** today every consumer reads the single
`AFI_EVIDENCE_MONGODB_URI` credential — the analytics plane and any readout
tooling currently hold canonical WRITE capability they must not have.

## Exact users and grants to create (Atlas → Database Access → Add New Database User)

1. **`afi-evidence-writer`** — the sole canonical writer.
   - Grant: built-in role `readWrite` scoped to database `afi_scored_signal_evidence` only.
   - Additional grant: `readWrite` scoped to `afi_signal_analytics` (the reactor process also writes the analytics capture; if you later split analytics into its own service, give that service its own user and drop this grant).
   - Consumer: ONLY the deployed afi-reactor service (`AFI_EVIDENCE_MONGODB_URI` in its environment).
2. **`afi-evidence-reader`** — every non-writer consumer of the canonical store.
   - Grant: built-in role `read` scoped to database `afi_scored_signal_evidence` only.
   - Consumers: the periodic re-verification cron (`npm run verify:evidence` in afi-infra — the script itself documents it must run under a read-only user), any readout/BI/report tooling, any human shell.
3. **`afi-analytics-writer`** — the outcome-capture cron.
   - Grant: `readWrite` scoped to `afi_signal_analytics` only (it reads `scoring_context`, appends `signal_outcomes`).
   - Explicitly NO grant on `afi_scored_signal_evidence` — if the cron ever needs canonical reads, use `afi-evidence-reader` alongside.

Rotate the current shared credential after cutover so no legacy copy of the
old all-access URI retains canonical write capability.

## Verification (after creating the users)

1. Connect with `afi-evidence-reader` and attempt a write —
   `mongosh "<reader URI>" --eval 'db.getSiblingDB("afi_scored_signal_evidence").scored_signal_evidence.insertOne({probe:1})'`
   must fail with an authorization error (`not authorized on afi_scored_signal_evidence`).
2. Run the re-verification under the reader —
   `AFI_EVIDENCE_MONGODB_URI="<reader URI>" npm run verify:evidence`
   must complete (exit 0 on an intact store; exit 2 reports integrity faults; it never needs write).
3. Connect with `afi-analytics-writer` and attempt a canonical read —
   must fail; the analytics plane never sees canonical bytes except through governed read tooling.
4. Confirm the deployed reactor still admits records (its writer grant is intact).
