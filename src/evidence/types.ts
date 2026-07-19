// Canonical Scored-Signal Evidence — types & typed error taxonomy (MONGO-STORE / Slot 2)
//
// Consumes the governed afi-config contract `afi.scored-signal-evidence.v3`
// (afi-config/schemas/scored-signal-evidence/v3/) — the SOLE current canonical
// scored-signal evidence contract (EV3-GOV D-EV3-1): the v2 record shape
// carried forward unchanged plus exactly three required additions —
// providerInvocations (the five-lane provider invocation proof collection,
// D-EV3-2), recordHash and replayHash (the record-level commitments,
// D-EV3-4(6)). These TS types are ergonomic mirrors; the AUTHORITATIVE
// structural check is validation against the governed JSON Schema (see
// governedSchema.ts). This module decides NO object-identity/lifecycle
// semantics — it consumes OBJ-GOV/LIFE-GOV/MONGO-GOV/EV3-GOV as merged.

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

/** The governed category lanes (D-FCP-1 namespace, casing exact — only the
 *  runtime category marker is camelCase aiMl), in the deterministic proof
 *  order EV3-GOV D-EV3-2 fixes: ascending case-sensitive lexicographic. */
export const PROVIDER_INVOCATION_CATEGORIES = [
  "aiMl",
  "news",
  "pattern",
  "sentiment",
  "technical",
] as const;
export type ProviderInvocationCategory = (typeof PROVIDER_INVOCATION_CATEGORIES)[number];

/** The nested afi.aiml-invocation-proof.v1 (EV3-GOV D-EV3-3): the deterministic,
 *  non-secret projection of one successful tiny-brains.aiml-invocation.v1
 *  record. Its hex digests are OPAQUE service-law commitments pinned to
 *  hashLaw (tiny-brains.hash.v1) — NOT CanonicalHash objects, and never
 *  recomputed under either afi.hash.v1 law. Structural mirror only. */
export interface AimlInvocationProof {
  schema: "afi.aiml-invocation-proof.v1";
  profileId: string;
  profileVersion: string;
  resolverId: string;
  resolverVersion: string;
  codeConfigFingerprint: string;
  hashLaw: string;
  inputHash: string;
  outputHash: string;
  status: "succeeded";
  experts: Array<{
    expertId: string;
    expertVersion: string;
    posture: "deterministic" | "probabilistic";
    status: "succeeded";
    outputHash: string;
    artifactFingerprints?: Record<string, string>;
    [k: string]: unknown;
  }>;
  [k: string]: unknown;
}

/**
 * One per-lane provider invocation proof (`afi.provider-invocation-proof.v1`,
 * EV3-GOV D-EV3-2): the closed, credential-safe record of one SUCCESSFUL
 * provider invocation for one governed category lane. Carried, never consumed.
 * Structural mirror only; the governed schema (positional five-tuple on the v3
 * record) is authoritative for count, order, uniqueness, the per-category
 * resultSchema binders, the credential oneOf, and the aiMl nesting law.
 */
export interface ProviderInvocationProof {
  schema: "afi.provider-invocation-proof.v1";
  category: ProviderInvocationCategory;
  resultSchema: string;
  provider: {
    providerId: string;
    recordVersion: string;
    recordFingerprint: CanonicalHashRef;
    executionClass: "local" | "remote";
    deterministic: boolean;
    [k: string]: unknown;
  };
  providerInstance: {
    providerInstanceId: string;
    recordVersion: string;
    recordFingerprint: CanonicalHashRef;
    model?: string;
    [k: string]: unknown;
  };
  adapter: {
    adapterId: string;
    adapterVersion: string;
    transportKind: "in-process" | "http";
    [k: string]: unknown;
  };
  /** Explicit keyless posture XOR an opaque CredentialRef binding — never a
   *  secret value, header, token, or credentialed URL (D-EV3-6). */
  credential:
    | { mode: "keyless"; [k: string]: unknown }
    | {
        mode: "credentialRef";
        credentialKind: string;
        credentialRef: string;
        recordVersion: string;
        status: "active" | "disabled";
        [k: string]: unknown;
      };
  invocationInputHash: CanonicalHashRef;
  providerResultHash: CanonicalHashRef;
  categoryResultHash: CanonicalHashRef;
  /** Technical lane ONLY (structurally forbidden elsewhere): the non-secret
   *  price-source identifier — the only per-lane source-reference field. */
  priceSource?: string;
  status: "succeeded";
  /** REQUIRED exactly when category is aiMl, structurally forbidden otherwise. */
  aimlInvocation?: AimlInvocationProof;
}

/** The five-lane proof collection: exactly five, unique by category, ordered
 *  ascending case-sensitive (aiMl, news, pattern, sentiment, technical) —
 *  bound positionally by the governed schema. */
export type ProviderInvocationProofs = [
  ProviderInvocationProof,
  ProviderInvocationProof,
  ProviderInvocationProof,
  ProviderInvocationProof,
  ProviderInvocationProof,
];

/** The canonical scored-signal evidence record
 *  (`afi.scored-signal-evidence.v3`, EV3-CONTRACT): the v2 record shape
 *  carried forward unchanged plus the REQUIRED providerInvocations,
 *  recordHash, and replayHash additions (EV3-GOV D-EV3-1). */
export interface ScoredSignalEvidenceRecordV3 {
  schema: "afi.scored-signal-evidence.v3";
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
  /** REQUIRED five-lane provider invocation proof collection (D-EV3-2). */
  providerInvocations: ProviderInvocationProofs;
  /** REQUIRED full-record integrity commitment: CanonicalHash v1, domain
   *  afi.d2.evidence-record, over the record minus {recordHash, replayHash}
   *  under canonical-json-hashing.v1 — verified by recomputation before
   *  insert (D-EV3-7). */
  recordHash: CanonicalHashRef;
  /** REQUIRED deterministic semantic/replay commitment: CanonicalHash v1,
   *  domain afi.d2.evidence-replay, over the replay projection (the record
   *  minus {recordHash, replayHash, lifecycleState, finalized, recordVersion,
   *  supersedesRecordHash}) — verified by recomputation before insert. */
  replayHash: CanonicalHashRef;
  recordVersion?: number;
  /** For v3 records its computation is DEFINED (D-EV3-4(6)): the superseded
   *  record's recordHash. */
  supersedesRecordHash?: CanonicalHashRef;
}

/** Any admissible canonical evidence record — `afi.scored-signal-evidence.v3`
 *  is the ONLY accepted write contract (EV3-GOV D-EV3-7: no dual write, no
 *  fallback, no alias). */
export type AnyScoredSignalEvidenceRecord = ScoredSignalEvidenceRecordV3;

/** Minimum replay-data bundle (MONGO-GOV D-MONGO-9): read-by-signalId returns
 *  the projection + provenance record (input/enrichment/output digests + pins)
 *  PLUS the hash-pinned composition ref (WHAT composed the score), and — v3 —
 *  the five invocation proofs (WHO/WHAT was invoked per lane) with the
 *  record-level commitments, sufficient to deterministically replay/verify
 *  off-line. NOT an endpoint. */
export interface EvidenceReplayBundle {
  signalId: string;
  canonicalizationVersion: string;
  scoredSignal: ScoredSignalProjection;
  provenanceRecord: ProvenanceRecord;
  /** The composition ref of the current canonical record. */
  composition: CompositionRefV1;
  /** The five-lane provider invocation proofs of the current record (D-EV3-2). */
  providerInvocations: ProviderInvocationProofs;
  /** The full-record integrity commitment of the current record. */
  recordHash: CanonicalHashRef;
  /** The deterministic semantic/replay commitment of the current record. */
  replayHash: CanonicalHashRef;
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
  | "HASH_VERIFICATION"
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

/** The submitted record failed governed-schema validation. `errors` carries
 *  BOUNDED validation facts only (instancePath/schemaPath/keyword/message/
 *  params) — never the record contents (EV3-GOV D-EV3-6 credential-safety:
 *  no rejection surface may echo the full candidate record). */
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

/** A record-level hash commitment failed recomputation-verified admission
 *  (EV3-GOV D-EV3-7 / D-EV3-4(6)): the declared recordHash or replayHash does
 *  not equal the digest recomputed under canonical-json-hashing.v1. The record
 *  is rejected, never persisted. Carries BOUNDED facts only: the hash kind and
 *  the two non-secret digests — never the record contents. */
export class EvidenceHashMismatchError extends EvidenceStoreError {
  readonly code = "HASH_VERIFICATION" as const;
  readonly hashKind: "recordHash" | "replayHash";
  readonly declared: string;
  readonly recomputed: string;
  constructor(
    hashKind: "recordHash" | "replayHash",
    declared: string,
    recomputed: string,
    signalId?: string
  ) {
    super(
      `${hashKind} verification failed for signalId '${signalId}': declared ${declared} != recomputed ${recomputed} under canonical-json-hashing.v1 (EV3-GOV D-EV3-7 recomputation-verified admission; the record is rejected, never persisted).`,
      signalId
    );
    this.hashKind = hashKind;
    this.declared = declared;
    this.recomputed = recomputed;
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

/** Supersession preconditions unmet (no current record, non-monotonic
 *  recordVersion, or a supersedesRecordHash that does not equal the superseded
 *  record's recordHash — the D-EV3-4(6) defined computation) — MONGO-GOV
 *  D-MONGO-5 versioning-by-supersession. */
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
