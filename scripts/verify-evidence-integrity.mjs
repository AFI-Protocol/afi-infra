#!/usr/bin/env node
// Periodic re-verification of the canonical scored-signal evidence store
// (CFG-GOV D-CFG-2(2)): recomputes recordHash and replayHash for EVERY
// persisted record version (current + history collections) under
// canonical-json-hashing.v1 and reports every mismatch as an integrity fault.
//
// READ-ONLY by construction: this job only ever calls verifyIntegrity(), which
// performs no writes; faults are reported, never repaired in place —
// remediation is a governed act. Run it under READ-ONLY credentials
// (D-CFG-2(3) custody): a URI whose database user has the `read` role on the
// evidence database is sufficient and is the intended deployment.
//
// Scheduling (the "periodic" in the duty) is deployment configuration outside
// this repo (Cloud Scheduler / cron), exactly like the outcomes capture job.
//
// Exit codes: 0 = every record verified; 2 = integrity fault(s) found;
// 1 = the verification pass itself could not run.
//
// Environment: AFI_EVIDENCE_MONGODB_URI (required; use a read-only user),
// plus the store's usual AFI_EVIDENCE_DB_NAME / AFI_EVIDENCE_COLLECTION /
// AFI_EVIDENCE_HISTORY_COLLECTION overrides.

import { MongoScoredSignalEvidenceStore } from "../dist/evidence/MongoScoredSignalEvidenceStore.js";

const store = new MongoScoredSignalEvidenceStore();
let exitCode = 0;
try {
  const startedAt = new Date().toISOString();
  const report = await store.verifyIntegrity();
  if (report.faults.length === 0) {
    console.log(
      `[verify-evidence-integrity] OK: ${report.checked} persisted record version(s) verified, 0 faults (started ${startedAt}).`
    );
  } else {
    exitCode = 2;
    console.error(
      `[verify-evidence-integrity] INTEGRITY FAULT: ${report.faults.length} mismatch(es) across ${report.checked} persisted record version(s) (started ${startedAt}).`
    );
    for (const f of report.faults) {
      console.error(
        `  - signalId=${f.signalId} v${f.recordVersion} [${f.collection}] ${f.hashKind}: declared ${f.declared} != recomputed ${f.recomputed}`
      );
    }
  }
} catch (err) {
  exitCode = 1;
  console.error(
    `[verify-evidence-integrity] verification pass failed to run: ${err instanceof Error ? err.message : String(err)}`
  );
} finally {
  await store.close().catch(() => {});
}
process.exit(exitCode);
