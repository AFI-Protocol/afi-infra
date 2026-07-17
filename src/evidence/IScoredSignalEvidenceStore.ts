// The single internal persistence interface for the canonical scored-signal
// evidence store (MONGO-GOV D-MONGO-3: afi-infra owns the sole storage mutation
// path; Reactor and Gateway are submitters, never writers). This interface IS
// the mutation boundary — there is no other write surface, and it is NOT an
// external HTTP/API surface (that is ATLAS-GOV, out of scope).

import type {
  AnyScoredSignalEvidenceRecord,
  SubmitResult,
  SupersedeResult,
  EvidenceReplayBundle,
} from "./types.js";

export interface IScoredSignalEvidenceStore {
  /**
   * The sole first-write mutation. Validates the complete record against the
   * governed afi-config schema SELECTED BY ITS `schema` const (v1 or v2 —
   * v1 acceptance is temporary dual-accept; any other value is rejected as
   * SCHEMA_VALIDATION) and identifier continuity, then performs an
   * insert-if-absent keyed by the unique `signalId` (MONGO-GOV D-MONGO-6).
   *
   * - New `signalId` → `{ outcome: "inserted" }`.
   * - Same `signalId`, byte-identical content → `{ outcome: "idempotent-duplicate" }`
   *   (idempotent re-submission; no second record is created).
   * - Same `signalId`, DIFFERENT content → throws `EvidenceIdempotencyConflictError`.
   *
   * Never overwrites an existing record (append-once, MONGO-GOV D-MONGO-5).
   * @throws EvidenceValidationError | EvidenceContinuityError |
   *         EvidenceIdempotencyConflictError | EvidencePersistenceError
   */
  submit(record: AnyScoredSignalEvidenceRecord): Promise<SubmitResult>;

  /**
   * A governed correction (MONGO-GOV D-MONGO-5 versioning-by-supersession):
   * archives the current record immutably as history and installs a new,
   * higher-`recordVersion` current record. Refused when the current record's
   * signal has reached a FINALIZED state (immutable-after-FINALIZED).
   * @throws EvidenceValidationError | EvidenceContinuityError |
   *         EvidenceImmutableError | EvidenceSupersedeError | EvidencePersistenceError
   */
  supersede(record: AnyScoredSignalEvidenceRecord): Promise<SupersedeResult>;

  /** Read-by-signalId (MONGO-GOV D-MONGO-9a): the current canonical record. */
  getBySignalId(signalId: string): Promise<AnyScoredSignalEvidenceRecord | null>;

  /**
   * Minimum replay-data retrieval (MONGO-GOV D-MONGO-9b): the projection +
   * provenance record (input/enrichment/output digests + pins) sufficient to
   * deterministically replay/verify off-line. A data guarantee, NOT an endpoint.
   */
  getReplayBundle(signalId: string): Promise<EvidenceReplayBundle | null>;

  /** Release any owned driver connection. */
  close(): Promise<void>;
}
