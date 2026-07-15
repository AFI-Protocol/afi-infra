// Canonical scored-signal evidence store (MONGO-STORE / Slot 2).
// The single internal persistence surface for `afi.scored-signal-evidence.v1`.
// No HTTP/API surface is exported (ATLAS-GOV, out of scope).

export type { IScoredSignalEvidenceStore } from "./IScoredSignalEvidenceStore.js";
export {
  MongoScoredSignalEvidenceStore,
  type MongoScoredSignalEvidenceStoreConfig,
} from "./MongoScoredSignalEvidenceStore.js";
export {
  validateEvidenceSchema,
  getEvidenceValidator,
  GOVERNED_EVIDENCE_SCHEMA_ID,
  type SchemaValidationResult,
} from "./governedSchema.js";
export {
  checkIdentifierContinuity,
  isFinalized,
} from "./identifierContinuity.js";
export * from "./types.js";
