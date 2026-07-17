// Canonical Scored-Signal Evidence — types & typed error taxonomy (MONGO-STORE / Slot 2)
//
// Consumes the governed afi-config contract `afi.scored-signal-evidence.v2`
// (afi-config/schemas/scored-signal-evidence/v2/) — the single canonical
// scored-signal evidence record designated by MONGO-GOV D-MONGO-1 and made the
// active write contract by FACTORY-CONTRACT (decision
// factory-configurable-pipelines-v1). These TS
// types are ergonomic mirrors; the AUTHORITATIVE structural check is validation
// against the governed JSON Schema (see governedSchema.ts). This module decides
// NO object-identity/lifecycle semantics — it consumes OBJ-GOV/LIFE-GOV/
// MONGO-GOV as merged.

/** The canonical LIFE-GOV D-LIFE-1 states persistable into the evidence store
 *  (post-scoring; pre-scoring INGESTED/VALIDATED/SCHEMA_REJECTED are not
 *  admissible per LIFE-GOV D-LIFE-6). Kept in sync with the governed schema
 *  enum by the drift-guard test; the schema is authoritative. */
export type EvidenceLifecycleState =
  | "SCORED"
  | "CERTIFIED"
  | "DECERTIFIED"
  | "QUALIFIED"
  | "UNQUALIFIED"
  | "CHALLENGE_OPEN"
  | "CONTESTED"
  | "FINALIZED"
  | "FINAL_REJECTED"
  | "EPOCH_ELIGIBLE";

/** lifecycleState values that carry the immutable-after-FINALIZED marker
 *  (finalized === true), per MONGO-GOV D-MONGO-5 / LIFE-GOV D-LIFE-4. */
export const FINALIZED_STATES: ReadonlyArray<EvidenceLifecycleState> = [
  "FINALIZED",
  "FINAL_REJECTED",
  "EPOCH_ELIGIBLE",
];

/** Off-chain CanonicalHash reference (afi.hash.vN); structural mirror only. */
export interface CanonicalHashRef {
  algorithm: "sha256";
  canonicalizationVersion: string;
  domainTag: string;
  value: string;
  [k: string]: unknown;
}

/** The thin afi.scored-signal.v1 projection (OBJ-GOV D-OBJ-5), carried by the
 *  evidence record. Only the fields the store reads are typed; the rest is
 *  validated by the governed schema. */
export interface ScoredSignalProjection {
  schema: "afi.scored-signal.v1";
  signalId: string;
  analystId: string;
  strategyId: string;
  strategyVersion?: string;
  [k: string]: unknown;
}

/** The afi.provenance-record.v1 required present per LIFE-GOV D-LIFE-6, carrying
 *  the replay/verify digests (MONGO-GOV D-MONGO-9). */
export interface ProvenanceRecord {
  schema: "afi.provenance-record.v1";
  signalId: string;
  canonicalizationVersion: string;
  inputHash: CanonicalHashRef;
  outputHash: CanonicalHashRef;
  [k: string]: unknown;
}

/**
 * RC-6 source discriminator (PR-UWR-STAMP-SEMANTICS) — the ONLY fixed vocabulary
 * on the stamp. Kept in sync with the governed schema enum by the drift-guard
 * test; the schema is authoritative.
 *
 * - "builtin-value-identity": scoring ran the builtin config, value-identical to
 *   the registered profile by construction; the registry was NOT read.
 * - "registry-consumed": scoring ran the profile actually READ from the registry
 *   and validated at runtime. Resolution is fail-closed, so a failed read refuses
 *   to score — no record (and no stamp) can exist for a failed resolution.
 */
export type UwrProfileStampSource = "builtin-value-identity" | "registry-consumed";

/**
 * The scoring-profile stamp (PR-UWR-STAMP shape) carried by every canonical
 * evidence record: identifies the UWR/scoring profile that ACTUALLY produced the
 * score, plus its exact source/provenance.
 *
 * ANALYST-NEUTRAL: the governed contract fixes no analyst, strategy, or profile
 * value — `profileId`/`status`/`decisionRef` are free-form non-empty strings and
 * only `source` has a governed vocabulary. Traceability metadata only: it confers
 * no qualification, reward eligibility, or mint wiring.
 */
export interface UwrProfileStamp {
  /** Identifies the profile that produced the score (any conforming profile id). */
  profileId: string;
  /** The profile's declared governance/lifecycle status (no fixed vocabulary). */
  status: string;
  /** The reference that defines/pins that profile. */
  decisionRef: string;
  /** RC-6 provenance discriminator (the only governed vocabulary). */
  source: UwrProfileStampSource;
}

/**
 * The canonical composition provenance stamp (`afi.composition-ref.v1`,
 * FACTORY-CONTRACT): the COMPLETE, hash-pinned identity of the composition that
 * produced one scored signal. Every field is REQUIRED (all-or-nothing — partial
 * composition provenance is inadmissible; the governed schema is
 * additionalProperties:false). Structural mirror only; the AUTHORITATIVE check
 * is validation against the vendored governed schema.
 */
export interface CompositionRefV1 {
  schema: "afi.composition-ref.v1";
  /** pipelineId of the afi.pipeline.v1 manifest that composed this score. */
  pipelineId: string;
  /** pipelineVersion of that manifest (WITH v prefix, e.g. "v1.0.0"). */
  pipelineVersion: string;
  /** CanonicalHash of the executed pipeline manifest. */
  manifestHash: CanonicalHashRef;
  /** CanonicalHash of the resolved afi.analyst-strategy-config.v1. */
  analystConfigHash: CanonicalHashRef;
  /** pluginId of the scorer plugin that produced the score. */
  scorerPluginId: string;
  /** pluginVersion of that scorer plugin (semver, no v prefix). */
  scorerPluginVersion: string;
  /** CanonicalHash over the canonically ordered set of ALL bound plugin manifests. */
  pluginSetHash: CanonicalHashRef;
  /** CanonicalHash of the deterministic, timestamp-free execution summary. */
  executionSummaryHash: CanonicalHashRef;
  /** CanonicalHash of the enrichment bundle this run produced. */
  enrichmentHash: CanonicalHashRef;
}

/** The canonical scored-signal evidence record
 *  (`afi.scored-signal-evidence.v2`, FACTORY-CONTRACT): the governed base
 *  evidence properties plus the REQUIRED `composition` provenance stamp. */
export interface ScoredSignalEvidenceRecordV2 {
  schema: "afi.scored-signal-evidence.v2";
  signalId: string;
  analystId: string;
  strategyId: string;
  strategyVersion: string;
  canonicalizationVersion: string;
  lifecycleState: EvidenceLifecycleState;
  finalized: boolean;
  scoredSignal: ScoredSignalProjection;
  provenanceRecord: ProvenanceRecord;
  /** REQUIRED scoring-profile stamp (see UwrProfileStamp). */
  uwrProfile: UwrProfileStamp;
  /** REQUIRED composition provenance (afi.composition-ref.v1). */
  composition: CompositionRefV1;
  recordVersion?: number;
  supersedesRecordHash?: CanonicalHashRef;
}

/** Any admissible canonical evidence record — `afi.scored-signal-evidence.v2`
 *  is the ONLY accepted write contract. */
export type AnyScoredSignalEvidenceRecord = ScoredSignalEvidenceRecordV2;

/** Minimum replay-data bundle (MONGO-GOV D-MONGO-9): read-by-signalId returns
 *  the projection + provenance record (input/enrichment/output digests + pins)
 *  PLUS the hash-pinned composition ref (WHAT composed the score), sufficient
 *  to deterministically replay/verify off-line. NOT an endpoint. */
export interface EvidenceReplayBundle {
  signalId: string;
  canonicalizationVersion: string;
  scoredSignal: ScoredSignalProjection;
  provenanceRecord: ProvenanceRecord;
  /** The composition ref of the current canonical record. */
  composition: CompositionRefV1;
}

export type SubmitOutcome = "inserted" | "idempotent-duplicate";

/** Result of a first-write submit. Idempotent re-submission of byte-identical
 *  content returns `idempotent-duplicate` (no new record); conflicting content
 *  for the same signalId throws EvidenceIdempotencyConflictError. */
export interface SubmitResult {
  outcome: SubmitOutcome;
  signalId: string;
  recordVersion: number;
  record: AnyScoredSignalEvidenceRecord;
}

/** Result of a governed supersession (MONGO-GOV D-MONGO-5). */
export interface SupersedeResult {
  outcome: "superseded";
  signalId: string;
  fromVersion: number;
  toVersion: number;
  record: AnyScoredSignalEvidenceRecord;
}

// ---------------------------------------------------------------------------
// Typed error taxonomy — every store failure is explicit and typed
// (MONGO-GOV D-MONGO-8 spirit: failures are first-class, never masked).
// ---------------------------------------------------------------------------

export type EvidenceErrorCode =
  | "SCHEMA_VALIDATION"
  | "IDENTIFIER_CONTINUITY"
  | "IDEMPOTENCY_CONFLICT"
  | "IMMUTABLE_AFTER_FINALIZED"
  | "SUPERSEDE_INVALID"
  | "PERSISTENCE_FAILURE";

export abstract class EvidenceStoreError extends Error {
  abstract readonly code: EvidenceErrorCode;
  readonly signalId?: string;
  constructor(message: string, signalId?: string) {
    super(message);
    this.name = new.target.name;
    this.signalId = signalId;
  }
}

/** The submitted record failed governed-schema validation. */
export class EvidenceValidationError extends EvidenceStoreError {
  readonly code = "SCHEMA_VALIDATION" as const;
  readonly errors: unknown[];
  constructor(message: string, errors: unknown[], signalId?: string) {
    super(message, signalId);
    this.errors = errors;
  }
}

/** Identifier continuity violated across evidence record / projection /
 *  provenance (OBJ-GOV D-OBJ-1/D-OBJ-3/D-OBJ-6, LIFE-GOV D-LIFE-5). */
export class EvidenceContinuityError extends EvidenceStoreError {
  readonly code = "IDENTIFIER_CONTINUITY" as const;
  readonly violations: string[];
  constructor(message: string, violations: string[], signalId?: string) {
    super(message, signalId);
    this.violations = violations;
  }
}

/** A record with the same signalId already exists with DIFFERENT content —
 *  a conflicting duplicate (distinct from an idempotent re-submission). */
export class EvidenceIdempotencyConflictError extends EvidenceStoreError {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
}

/** Attempt to supersede a record whose signal has reached a FINALIZED state —
 *  the canonical evidence record is immutable (MONGO-GOV D-MONGO-5). */
export class EvidenceImmutableError extends EvidenceStoreError {
  readonly code = "IMMUTABLE_AFTER_FINALIZED" as const;
}

/** Supersession preconditions unmet (no current record, or non-monotonic
 *  recordVersion) — MONGO-GOV D-MONGO-5 versioning-by-supersession. */
export class EvidenceSupersedeError extends EvidenceStoreError {
  readonly code = "SUPERSEDE_INVALID" as const;
}

/** An underlying storage/driver failure — surfaced, never swallowed. */
export class EvidencePersistenceError extends EvidenceStoreError {
  readonly code = "PERSISTENCE_FAILURE" as const;
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown, signalId?: string) {
    super(message, signalId);
    this.cause = cause;
  }
}
