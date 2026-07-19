// Canonical scored-signal evidence store (MONGO-STORE / Slot 2).
// The single internal persistence surface for the governed evidence contract:
// `afi.scored-signal-evidence.v3` (the SOLE current canonical evidence
// contract, EV3-GOV D-EV3-1/D-EV3-7 — V3-only admission with
// recomputation-verified recordHash/replayHash).
// No HTTP/API surface is exported (ATLAS-GOV, out of scope).

export type { IScoredSignalEvidenceStore } from "./IScoredSignalEvidenceStore.js";
export {
  MongoScoredSignalEvidenceStore,
  type MongoScoredSignalEvidenceStoreConfig,
} from "./MongoScoredSignalEvidenceStore.js";
export {
  validateEvidenceSchemaV3,
  getEvidenceValidatorV3,
  GOVERNED_EVIDENCE_SCHEMA_ID_V3,
  GOVERNED_COMPOSITION_REF_SCHEMA_ID,
  GOVERNED_PROVIDER_INVOCATION_PROOF_SCHEMA_ID,
  GOVERNED_AIML_INVOCATION_PROOF_SCHEMA_ID,
  type SchemaValidationResult,
} from "./governedSchema.js";
export {
  CANONICALIZATION_VERSION,
  RECORD_HASH_DOMAIN_TAG,
  REPLAY_HASH_DOMAIN_TAG,
  RECORD_HASH_EXCLUDED_FIELDS,
  REPLAY_HASH_EXCLUDED_FIELDS,
  canonicalize,
  canonicalSha256,
  computeRecordHashValue,
  computeReplayHashValue,
  sha256Hex,
  stripExcluded,
} from "./canonicalJsonHashing.js";
export {
  checkIdentifierContinuity,
  isFinalized,
} from "./identifierContinuity.js";
export * from "./types.js";
