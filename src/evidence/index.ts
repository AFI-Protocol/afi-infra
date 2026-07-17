// Canonical scored-signal evidence store (MONGO-STORE / Slot 2).
// The single internal persistence surface for the governed evidence contract:
// `afi.scored-signal-evidence.v2` (active write contract, FACTORY-CONTRACT)
// plus `afi.scored-signal-evidence.v1` (TEMPORARY dual-accept; removed by
// SLOT-FCP-CLEANUP). No HTTP/API surface is exported (ATLAS-GOV, out of scope).

export type { IScoredSignalEvidenceStore } from "./IScoredSignalEvidenceStore.js";
export {
  MongoScoredSignalEvidenceStore,
  type MongoScoredSignalEvidenceStoreConfig,
} from "./MongoScoredSignalEvidenceStore.js";
export {
  validateEvidenceSchema,
  validateEvidenceSchemaV2,
  getEvidenceValidator,
  getEvidenceValidatorV2,
  GOVERNED_EVIDENCE_SCHEMA_ID,
  GOVERNED_EVIDENCE_SCHEMA_ID_V2,
  GOVERNED_COMPOSITION_REF_SCHEMA_ID,
  type SchemaValidationResult,
} from "./governedSchema.js";
export {
  checkIdentifierContinuity,
  isFinalized,
} from "./identifierContinuity.js";
export * from "./types.js";
