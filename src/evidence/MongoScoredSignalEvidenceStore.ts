// MongoDB implementation of the canonical scored-signal evidence store
// (MONGO-STORE / Slot 2 of AFI-GOV-PERSISTENCE-IMPL-v0.1).
//
// Realizes MONGO-GOV: one FRESH canonical store (D-MONGO-1, Option A) for the
// governed evidence contract — `afi.scored-signal-evidence.v2` (the active
// write contract, FACTORY-CONTRACT), the ONLY admissible `schema` const; any
// other value is rejected as SCHEMA_VALIDATION. ALL other store law (unique
// signalId, append-once, idempotency, supersession, continuity, recordVersion)
// is contract-independent. The sole afi-infra storage mutation path
// (D-MONGO-3); a STANDARD collection with a UNIQUE `signalId` index (D-MONGO-6 —
// NOT time-series, no non-unique fallback); append-once + immutable-after-
// FINALIZED via versioning-by-supersession (D-MONGO-5); read-by-signalId +
// minimum replay retrieval (D-MONGO-9). No HTTP/API surface (ATLAS-GOV). It does
// not touch, migrate, or read the legacy reactor/tssd stores.
//
// Supersession is ATOMIC: the two-collection archive+install runs inside a
// MongoDB multi-document transaction, so a crash or error can never leave the
// current/history collections partially updated. (Transactions require a replica
// set — the standard production topology.)
//
// Scope note (LIFE-GOV): this store persists a governed record and models
// governed CORRECTIONS via `supersede` (D-MONGO-5). It does not own or decide
// how LIFE-GOV lifecycle *transitions* (who advances SCORED→CERTIFIED→…) are
// applied — that is transition-ownership (LIFE-GOV D-LIFE-3) and the submitter
// slots (reactor/gateway), out of Slot 2's scope.

import type { IScoredSignalEvidenceStore } from "./IScoredSignalEvidenceStore.js";
import {
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidencePersistenceError,
  EvidenceStoreError,
  EvidenceSupersedeError,
  EvidenceValidationError,
  EvidenceContinuityError,
  type AnyScoredSignalEvidenceRecord,
  type EvidenceReplayBundle,
  type SubmitResult,
  type SupersedeResult,
} from "./types.js";
import { validateEvidenceSchemaV2 } from "./governedSchema.js";
import { checkIdentifierContinuity, isFinalized } from "./identifierContinuity.js";

// --- Minimal structural MongoDB surface (injectable for testing) ------------

type WriteOptions = { session?: unknown };
type ReplaceResult = { matchedCount?: number; modifiedCount?: number };

type CollectionLike<T> = {
  findOne(filter: Record<string, unknown>, options?: WriteOptions): Promise<T | null>;
  insertOne(doc: T, options?: WriteOptions): Promise<unknown>;
  replaceOne(
    filter: Record<string, unknown>,
    doc: T,
    options?: WriteOptions
  ): Promise<ReplaceResult>;
  createIndex(
    index: Record<string, number>,
    options?: Record<string, unknown>
  ): Promise<string>;
};

type DbLike = {
  collection<T>(name: string): CollectionLike<T>;
  createCollection(name: string, options?: Record<string, unknown>): Promise<unknown>;
  listCollections(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>
  ): { toArray(): Promise<Array<Record<string, unknown>>> };
};

type ClientSessionLike = {
  withTransaction<T>(fn: () => Promise<T>): Promise<T>;
  endSession(): Promise<void>;
};

type MongoClientLike = {
  connect(): Promise<void>;
  close(): Promise<void>;
  db(name: string): DbLike;
  startSession(): ClientSessionLike;
};

type Logger = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

/** Stored document = the canonical record verbatim (byte-faithful for replay)
 *  plus Mongo's own `_id`. No volatile storage timestamps are added — the
 *  canonical record structurally excludes them (MONGO-GOV D-MONGO-1). */
type EvidenceDocument = AnyScoredSignalEvidenceRecord & { _id?: unknown };

export interface MongoScoredSignalEvidenceStoreConfig {
  mongoUri?: string;
  dbName?: string;
  /** Current-record collection (unique `signalId`). */
  collectionName?: string;
  /** Superseded-version history collection (append-only). */
  historyCollectionName?: string;
  logger?: Logger;
  /** Inject a client to bypass the real driver (tests). Must be session-capable. */
  client?: MongoClientLike;
}

const DEFAULT_DB_NAME = "afi_scored_signal_evidence";
const DEFAULT_COLLECTION = "scored_signal_evidence";
const DEFAULT_HISTORY_COLLECTION = "scored_signal_evidence_history";

const SIGNAL_ID_UNIQUE_INDEX = "signalId_unique";
const NAMESPACE_EXISTS = 48; // MongoDB "collection already exists"

/** Recursively key-sorted JSON — order-insensitive structural comparison for
 *  distinguishing an idempotent re-submission from conflicting content. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function errorCode(err: unknown): unknown {
  return (err as { code?: unknown } | null)?.code;
}
function isDuplicateKeyError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e) return false;
  return e.code === 11000 || e.code === "11000" || /E11000/.test(String(e.message ?? ""));
}

export class MongoScoredSignalEvidenceStore implements IScoredSignalEvidenceStore {
  private readonly logger: Logger;
  private readonly providedClient?: MongoClientLike;
  private readonly mongoUri?: string;
  private readonly dbName: string;
  private readonly collectionName: string;
  private readonly historyCollectionName: string;

  private client?: MongoClientLike;
  private db?: DbLike;
  private current?: CollectionLike<EvidenceDocument>;
  private history?: CollectionLike<EvidenceDocument>;
  private initPromise?: Promise<void>;

  constructor(config: MongoScoredSignalEvidenceStoreConfig = {}) {
    this.providedClient = config.client;
    this.mongoUri =
      config.mongoUri ??
      process.env.AFI_EVIDENCE_MONGODB_URI ??
      process.env.AFI_SCORED_SIGNAL_EVIDENCE_URI;
    this.dbName = config.dbName ?? process.env.AFI_EVIDENCE_DB_NAME ?? DEFAULT_DB_NAME;
    this.collectionName =
      config.collectionName ?? process.env.AFI_EVIDENCE_COLLECTION ?? DEFAULT_COLLECTION;
    this.historyCollectionName =
      config.historyCollectionName ??
      process.env.AFI_EVIDENCE_HISTORY_COLLECTION ??
      DEFAULT_HISTORY_COLLECTION;
    this.logger = config.logger ?? console;
  }

  async submit(record: AnyScoredSignalEvidenceRecord): Promise<SubmitResult> {
    this.assertGovernedRecord(record);
    // First-write invariant: the first canonical record for a signalId is
    // version 1 (MONGO-GOV D-MONGO-5). Higher versions arrive only via
    // supersede(), so the supersession chain is never bypassed.
    if ((record.recordVersion ?? 1) > 1) {
      throw new EvidenceSupersedeError(
        `submit() is the first-write path; recordVersion ${record.recordVersion} > 1 for signalId '${record.signalId}' must arrive via supersede() (versioning-by-supersession, MONGO-GOV D-MONGO-5).`,
        record.signalId
      );
    }
    const canonical = this.normalize(record);
    await this.ensureInitialized();
    const collection = this.current!;

    try {
      await collection.insertOne(this.toDoc(canonical));
      return {
        outcome: "inserted",
        signalId: canonical.signalId,
        recordVersion: canonical.recordVersion!,
        record: canonical,
      };
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // A record already exists for this signalId — distinguish an idempotent
        // re-submission (identical content) from a conflicting duplicate.
        const existing = await this.getBySignalId(canonical.signalId);
        if (existing && stableStringify(existing) === stableStringify(canonical)) {
          return {
            outcome: "idempotent-duplicate",
            signalId: canonical.signalId,
            recordVersion: existing.recordVersion ?? 1,
            record: existing,
          };
        }
        throw new EvidenceIdempotencyConflictError(
          `A different canonical record already exists for signalId '${canonical.signalId}' (append-once; use supersede for a governed correction).`,
          canonical.signalId
        );
      }
      throw new EvidencePersistenceError(
        `Canonical evidence insert failed for signalId '${canonical.signalId}'.`,
        err,
        canonical.signalId
      );
    }
  }

  async supersede(record: AnyScoredSignalEvidenceRecord): Promise<SupersedeResult> {
    this.assertGovernedRecord(record);
    await this.ensureInitialized();

    const signalId = record.signalId;
    const currentRecord = await this.getBySignalId(signalId);
    if (!currentRecord) {
      throw new EvidenceSupersedeError(
        `No current canonical record to supersede for signalId '${signalId}'.`,
        signalId
      );
    }
    if (isFinalized(currentRecord)) {
      throw new EvidenceImmutableError(
        `Canonical record for signalId '${signalId}' is finalized (${currentRecord.lifecycleState}); it is immutable and cannot be superseded.`,
        signalId
      );
    }
    // The supersession chain must be explicit (MONGO-GOV D-MONGO-5). The store
    // does not compute canonical hashes (District-2 hash doctrine), but it
    // requires the caller-provided link to the superseded record.
    if (!record.supersedesRecordHash) {
      throw new EvidenceSupersedeError(
        `supersede() requires supersedesRecordHash linking the superseded record for signalId '${signalId}' (MONGO-GOV D-MONGO-5 supersession chain).`,
        signalId
      );
    }

    const fromVersion = currentRecord.recordVersion ?? 1;
    const toVersion = record.recordVersion ?? fromVersion + 1;
    if (toVersion <= fromVersion) {
      throw new EvidenceSupersedeError(
        `Superseding recordVersion must strictly increase (${fromVersion} -> ${toVersion}) for signalId '${signalId}'.`,
        signalId
      );
    }
    const canonical = this.normalize({ ...record, recordVersion: toVersion });

    // ATOMIC supersession: archive the current version to history AND install
    // the new version in a single multi-document transaction. Either both
    // commit or neither — a crash/error can never leave a partial state. The
    // replaceOne filter pins fromVersion (optimistic concurrency): a concurrent
    // supersede either loses the archive dup-key race or the version match, and
    // is surfaced as a typed error — never a silent lost update.
    const session = this.client!.startSession();
    try {
      await session.withTransaction(async () => {
        try {
          await this.history!.insertOne(this.toDoc(currentRecord), { session });
        } catch (err) {
          if (isDuplicateKeyError(err)) {
            throw new EvidenceSupersedeError(
              `Concurrent supersede detected for signalId '${signalId}': version ${fromVersion} was already archived.`,
              signalId
            );
          }
          throw err;
        }
        const res = await this.current!.replaceOne(
          { signalId, recordVersion: fromVersion },
          this.toDoc(canonical),
          { session }
        );
        if ((res?.matchedCount ?? 0) === 0) {
          throw new EvidenceSupersedeError(
            `Concurrent modification: current record for signalId '${signalId}' was no longer at version ${fromVersion} when installing the superseding version.`,
            signalId
          );
        }
      });
    } catch (err) {
      if (err instanceof EvidenceStoreError) throw err;
      throw new EvidencePersistenceError(
        `Atomic supersede failed for signalId '${signalId}'.`,
        err,
        signalId
      );
    } finally {
      await session.endSession();
    }

    return { outcome: "superseded", signalId, fromVersion, toVersion, record: canonical };
  }

  async getBySignalId(signalId: string): Promise<AnyScoredSignalEvidenceRecord | null> {
    await this.ensureInitialized();
    let doc: EvidenceDocument | null;
    try {
      doc = await this.current!.findOne({ signalId });
    } catch (err) {
      throw new EvidencePersistenceError(
        `Read failed for signalId '${signalId}'.`,
        err,
        signalId
      );
    }
    return doc ? this.fromDoc(doc) : null;
  }

  async getReplayBundle(signalId: string): Promise<EvidenceReplayBundle | null> {
    const record = await this.getBySignalId(signalId);
    if (!record) return null;
    return {
      signalId: record.signalId,
      canonicalizationVersion: record.canonicalizationVersion,
      scoredSignal: record.scoredSignal,
      provenanceRecord: record.provenanceRecord,
      // Replay/verify sufficiency (MONGO-GOV D-MONGO-9) includes the
      // hash-pinned composition ref — WHAT composed the score.
      composition: record.composition,
    };
  }

  async close(): Promise<void> {
    if (!this.providedClient && this.client) {
      await this.client.close();
      this.client = undefined;
    }
    this.db = undefined;
    this.current = undefined;
    this.history = undefined;
    this.initPromise = undefined;
  }

  // --- internals ------------------------------------------------------------

  /** Validate against the governed v2 evidence schema AND identifier
   *  continuity. Both are admission preconditions (MONGO-GOV D-MONGO-3).
   *  'afi.scored-signal-evidence.v2' is the ONLY admissible `schema` const
   *  (composition REQUIRED, validated against afi.composition-ref.v1 including
   *  its CanonicalHash sub-shapes); any other value is rejected as
   *  SCHEMA_VALIDATION. */
  private assertGovernedRecord(record: AnyScoredSignalEvidenceRecord): void {
    const schemaConst = (record as { schema?: unknown } | null)?.schema;
    if (schemaConst !== "afi.scored-signal-evidence.v2") {
      throw new EvidenceValidationError(
        `Record carries an inadmissible evidence schema const '${String(
          schemaConst
        )}' — the only admissible value is 'afi.scored-signal-evidence.v2'.`,
        [],
        (record as { signalId?: string } | null)?.signalId
      );
    }
    const { valid, errors } = validateEvidenceSchemaV2(record);
    if (!valid) {
      throw new EvidenceValidationError(
        `Record failed governed ${String(schemaConst)} schema validation.`,
        errors,
        record?.signalId
      );
    }
    const violations = checkIdentifierContinuity(record);
    if (violations.length > 0) {
      throw new EvidenceContinuityError(
        `Identifier continuity violated for signalId '${record.signalId}': ${violations.join("; ")}.`,
        violations,
        record.signalId
      );
    }
  }

  /** Pin recordVersion (first canonical record is version 1) for a stable,
   *  order-insensitive idempotency comparison and history versioning. */
  private normalize(record: AnyScoredSignalEvidenceRecord): AnyScoredSignalEvidenceRecord {
    return { ...record, recordVersion: record.recordVersion ?? 1 };
  }

  private toDoc(record: AnyScoredSignalEvidenceRecord): EvidenceDocument {
    return { ...record };
  }

  private fromDoc(doc: EvidenceDocument): AnyScoredSignalEvidenceRecord {
    const { _id, ...record } = doc;
    void _id;
    return record as AnyScoredSignalEvidenceRecord;
  }

  /** Concurrency-safe, once-only initialization (memoized promise; cleared on
   *  failure so a transient error can be retried). */
  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit().catch((err) => {
        this.initPromise = undefined;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (this.providedClient) {
      this.client = this.providedClient;
    } else {
      if (!this.mongoUri) {
        throw new EvidencePersistenceError(
          "MongoScoredSignalEvidenceStore requires a MongoDB URI (AFI_EVIDENCE_MONGODB_URI) or an injected client."
        );
      }
      // @ts-ignore MongoDB driver resolved from the runtime environment.
      const { MongoClient } = await import("mongodb");
      this.client = new MongoClient(this.mongoUri) as unknown as MongoClientLike;
      try {
        await this.client.connect();
      } catch (err) {
        throw new EvidencePersistenceError("Failed to connect to MongoDB.", err);
      }
    }
    this.db = this.client.db(this.dbName);

    await this.ensureStandardCollection(this.collectionName);
    await this.ensureStandardCollection(this.historyCollectionName);

    this.current = this.db.collection<EvidenceDocument>(this.collectionName);
    this.history = this.db.collection<EvidenceDocument>(this.historyCollectionName);

    // D-MONGO-6: a UNIQUE signalId constraint at the store layer. A time-series
    // collection cannot enforce this — so this is a STANDARD collection and the
    // unique index is REQUIRED (no non-unique fallback; failure is surfaced).
    try {
      await this.current.createIndex(
        { signalId: 1 },
        { unique: true, name: SIGNAL_ID_UNIQUE_INDEX }
      );
    } catch (err) {
      throw new EvidencePersistenceError(
        "Failed to create the required UNIQUE signalId index on the canonical evidence collection. " +
          "The canonical store MUST enforce signalId uniqueness (MONGO-GOV D-MONGO-6); a store type that " +
          "cannot (e.g. time-series) is not admissible.",
        err
      );
    }
    // History retains one immutable entry per (signalId, recordVersion).
    try {
      await this.history.createIndex(
        { signalId: 1, recordVersion: 1 },
        { unique: true, name: "signalId_recordVersion_unique" }
      );
    } catch (err) {
      throw new EvidencePersistenceError(
        "Failed to create the history (signalId, recordVersion) index.",
        err
      );
    }
  }

  private async ensureStandardCollection(name: string): Promise<void> {
    let existing: Array<Record<string, unknown>>;
    try {
      existing = await this.db!.listCollections({ name }, { nameOnly: true }).toArray();
    } catch (err) {
      throw new EvidencePersistenceError(`Failed to list collections for '${name}'.`, err);
    }
    if (existing.length > 0) return;
    try {
      // Explicitly a STANDARD collection — NOT time-series (MONGO-GOV D-MONGO-6).
      await this.db!.createCollection(name);
      this.logger.info?.(
        `[evidence] Created standard collection '${name}' (unique-signalId capable; not time-series).`
      );
    } catch (err) {
      // A concurrent initializer may have created it first — tolerate.
      if (errorCode(err) === NAMESPACE_EXISTS) return;
      throw new EvidencePersistenceError(`Failed to create collection '${name}'.`, err);
    }
  }
}
