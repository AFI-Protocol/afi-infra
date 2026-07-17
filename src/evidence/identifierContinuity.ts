// Identifier-continuity + finality checks the store enforces at the mutation
// boundary. JSON Schema draft-07 cannot express cross-object equality, so these
// realize the governed x-afiConstraints.identifierContinuity clause of
// `afi.scored-signal-evidence.v2` (OBJ-GOV D-OBJ-1/D-OBJ-3/D-OBJ-6, LIFE-GOV
// D-LIFE-5) — the same constraint the afi-config drift-guard tests assert.

import {
  FINALIZED_STATES,
  type AnyScoredSignalEvidenceRecord,
} from "./types.js";

/** Returns the list of identifier-continuity violations (empty === continuous).
 *  Operates structurally so it is safe to run before/independently of schema
 *  validation. The `composition` property carries no continuity-bound
 *  identifiers. */
export function checkIdentifierContinuity(
  record: AnyScoredSignalEvidenceRecord
): string[] {
  const v: string[] = [];
  const ss = record.scoredSignal;
  const pr = record.provenanceRecord;

  if (ss?.signalId !== record.signalId) {
    v.push("signalId != scoredSignal.signalId");
  }
  if (pr?.signalId !== record.signalId) {
    v.push("signalId != provenanceRecord.signalId");
  }
  if (ss?.analystId !== record.analystId) {
    v.push("analystId != scoredSignal.analystId");
  }
  if (ss?.strategyId !== record.strategyId) {
    v.push("strategyId != scoredSignal.strategyId");
  }
  // strategyVersion is REQUIRED on the evidence record (complete OBJ-GOV triple)
  // and MUST equal the projection's.
  if (ss?.strategyVersion !== record.strategyVersion) {
    v.push("strategyVersion != scoredSignal.strategyVersion");
  }
  if (pr?.canonicalizationVersion !== record.canonicalizationVersion) {
    v.push("canonicalizationVersion != provenanceRecord.canonicalizationVersion");
  }
  return v;
}

/** Whether the record's lifecycleState carries the immutable-after-FINALIZED
 *  marker (MONGO-GOV D-MONGO-5 / LIFE-GOV D-LIFE-4). */
export function isFinalized(record: AnyScoredSignalEvidenceRecord): boolean {
  return FINALIZED_STATES.includes(record.lifecycleState);
}
