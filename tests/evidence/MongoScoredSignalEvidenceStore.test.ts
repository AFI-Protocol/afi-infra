import { describe, it, expect } from "vitest";
import { FakeDb } from "./fakeMongo.js";
import {
  canonicalExample,
  validMinimalScored,
  invalidVector,
  deepClone,
} from "./fixtures.js";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import {
  EvidenceValidationError,
  EvidenceContinuityError,
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidenceSupersedeError,
  type ScoredSignalEvidenceRecord,
} from "../../src/evidence/types.js";

const COLLECTION = "scored_signal_evidence";
const HISTORY = "scored_signal_evidence_history";

/** A valid CanonicalHash link to a predecessor evidence record (supersedes). */
const PRED_HASH = {
  algorithm: "sha256" as const,
  canonicalizationVersion: "afi.hash.v1",
  domainTag: "afi.d2.scored-signal-evidence",
  value: "1b16b1df538ba12dc3f97edbb85caa7050d46c148134290feba80f8236c83db9",
};

function makeStore() {
  const db = new FakeDb();
  const store = new MongoScoredSignalEvidenceStore({
    db: db as never,
    collectionName: COLLECTION,
    historyCollectionName: HISTORY,
    logger: {},
  });
  return { db, store };
}

describe("MongoScoredSignalEvidenceStore (MONGO-STORE / Slot 2)", () => {
  describe("submit — first write, validation, continuity", () => {
    it("inserts a valid record and reads it back by signalId", async () => {
      const { store } = makeStore();
      const rec = validMinimalScored();

      const res = await store.submit(rec);
      expect(res.outcome).toBe("inserted");
      expect(res.signalId).toBe(rec.signalId);
      expect(res.recordVersion).toBe(1);

      const fetched = await store.getBySignalId(rec.signalId);
      expect(fetched).toBeTruthy();
      expect(fetched?.signalId).toBe(rec.signalId);
      expect((fetched as ScoredSignalEvidenceRecord).lifecycleState).toBe("SCORED");
      // Storage `_id` is not leaked back into the canonical record.
      expect("_id" in (fetched as object)).toBe(false);
    });

    it("returns a minimum replay bundle (projection + provenance digests)", async () => {
      const { store } = makeStore();
      const rec = validMinimalScored();
      await store.submit(rec);

      const bundle = await store.getReplayBundle(rec.signalId);
      expect(bundle).toBeTruthy();
      expect(bundle?.signalId).toBe(rec.signalId);
      expect(bundle?.canonicalizationVersion).toBe(rec.canonicalizationVersion);
      expect(bundle?.scoredSignal.schema).toBe("afi.scored-signal.v1");
      expect(bundle?.provenanceRecord.schema).toBe("afi.provenance-record.v1");
      expect(bundle?.provenanceRecord.inputHash).toBeTruthy();
      expect(bundle?.provenanceRecord.outputHash).toBeTruthy();
    });

    it("rejects a schema-invalid record with a typed EvidenceValidationError", async () => {
      const { store } = makeStore();
      for (const name of [
        "missing-strategy-version.json",
        "heavy-carrier-substitution.json",
        "pre-scoring-lifecycle-state.json",
        "legacy-vocabulary-state.json",
        "finality-marker-mismatch.json",
        "volatile-timestamp.json",
        "vaulted-lifecycle-brain.json",
      ]) {
        const bad = invalidVector(name) as ScoredSignalEvidenceRecord;
        await expect(store.submit(bad), name).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), name).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("rejects an identifier-continuity violation with a typed EvidenceContinuityError", async () => {
      const { store } = makeStore();
      for (const name of [
        "signalid-discontinuity.json",
        "provenance-signalid-discontinuity.json",
        "strategy-triple-mismatch.json",
        "canonicalization-version-mismatch.json",
      ]) {
        const bad = invalidVector(name) as ScoredSignalEvidenceRecord;
        await expect(store.submit(bad), name).rejects.toBeInstanceOf(EvidenceContinuityError);
        await expect(store.submit(bad), name).rejects.toMatchObject({
          code: "IDENTIFIER_CONTINUITY",
        });
      }
    });
  });

  describe("idempotency & append-once (D-MONGO-5/6)", () => {
    it("treats a byte-identical re-submission as idempotent (no duplicate record)", async () => {
      const { db, store } = makeStore();
      const rec = validMinimalScored();

      const first = await store.submit(rec);
      const second = await store.submit(deepClone(rec));

      expect(first.outcome).toBe("inserted");
      expect(second.outcome).toBe("idempotent-duplicate");
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });

    it("distinguishes a CONFLICTING duplicate (same signalId, different content)", async () => {
      const { db, store } = makeStore();
      const rec = validMinimalScored();
      await store.submit(rec);

      const conflicting = deepClone(rec);
      conflicting.scoredSignal.uwrScore = 0.99; // schema- & continuity-valid, different content

      await expect(store.submit(conflicting)).rejects.toBeInstanceOf(
        EvidenceIdempotencyConflictError
      );
      await expect(store.submit(conflicting)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

      // append-once: the stored record was NOT overwritten by the conflicting submit.
      const stored = await store.getBySignalId(rec.signalId);
      expect(stored?.scoredSignal.uwrScore).toBe(rec.scoredSignal.uwrScore);
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });
  });

  describe("supersession & immutable-after-FINALIZED (D-MONGO-5)", () => {
    it("supersedes with a governed correction, archiving the prior version to history", async () => {
      const { db, store } = makeStore();
      const v1 = validMinimalScored(); // SCORED, finalized:false, v1, uwrScore 0.55
      await store.submit(v1);

      // A governed CORRECTION: new schema-versioned record with the predecessor
      // link; content corrected (uwrScore), lifecycleState unchanged.
      const v2 = deepClone(v1);
      v2.recordVersion = 2;
      v2.supersedesRecordHash = PRED_HASH;
      v2.scoredSignal.uwrScore = 0.6;

      const res = await store.supersede(v2);
      expect(res.outcome).toBe("superseded");
      expect(res.fromVersion).toBe(1);
      expect(res.toVersion).toBe(2);

      const current = await store.getBySignalId(v1.signalId);
      expect(current?.recordVersion).toBe(2);
      expect(current?.scoredSignal.uwrScore).toBe(0.6);

      // exactly one current doc; the superseded v1 is retained immutably in history.
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
      const hist = db._collection(HISTORY)._allDocs();
      expect(hist).toHaveLength(1);
      const archived = hist[0] as unknown as ScoredSignalEvidenceRecord;
      expect(archived.recordVersion).toBe(1);
      expect(archived.scoredSignal.uwrScore).toBe(0.55);
    });

    it("requires supersedesRecordHash (explicit supersession chain)", async () => {
      const { store } = makeStore();
      const v1 = validMinimalScored();
      await store.submit(v1);

      const v2 = deepClone(v1);
      v2.recordVersion = 2;
      v2.scoredSignal.uwrScore = 0.6; // no supersedesRecordHash
      await expect(store.supersede(v2)).rejects.toBeInstanceOf(EvidenceSupersedeError);
      await expect(store.supersede(v2)).rejects.toMatchObject({ code: "SUPERSEDE_INVALID" });
    });

    it("refuses to supersede a FINALIZED record (immutable-after-FINALIZED)", async () => {
      const { store } = makeStore();
      const finalizedRec = canonicalExample(); // FINALIZED, finalized:true
      await store.submit(finalizedRec);

      const attempt = deepClone(finalizedRec);
      attempt.recordVersion = 2;
      attempt.supersedesRecordHash = PRED_HASH;

      await expect(store.supersede(attempt)).rejects.toBeInstanceOf(EvidenceImmutableError);
      await expect(store.supersede(attempt)).rejects.toMatchObject({
        code: "IMMUTABLE_AFTER_FINALIZED",
      });
    });

    it("refuses to supersede when no current record exists", async () => {
      const { store } = makeStore();
      const v2 = deepClone(validMinimalScored());
      v2.recordVersion = 2;
      v2.supersedesRecordHash = PRED_HASH;
      await expect(store.supersede(v2)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("refuses a non-monotonic recordVersion", async () => {
      const { store } = makeStore();
      const v1 = validMinimalScored();
      await store.submit(v1);

      const notNewer = deepClone(v1);
      notNewer.recordVersion = 1; // not greater than current v1
      notNewer.supersedesRecordHash = PRED_HASH;
      notNewer.scoredSignal.uwrScore = 0.6;
      await expect(store.supersede(notNewer)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });
  });

  describe("first-write invariant & concurrency-safe init", () => {
    it("rejects a first-write submit with recordVersion > 1 (use supersede)", async () => {
      const { store } = makeStore();
      const bad = deepClone(validMinimalScored());
      bad.recordVersion = 2;
      bad.supersedesRecordHash = PRED_HASH;
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("initializes the store exactly once under concurrent submits", async () => {
      const { db, store } = makeStore();
      const a = validMinimalScored();
      const b = deepClone(a);
      b.signalId = "sig-min-0002";
      b.scoredSignal.signalId = "sig-min-0002";
      b.provenanceRecord.signalId = "sig-min-0002";
      b.scoredSignal.provenanceRecordRef = "provenance-record:sig-min-0002";

      await Promise.all([store.submit(a), store.submit(b)]);

      // memoized init: the collection is created once, not once-per-submit.
      const created = db.createdCollections.filter((n) => n === COLLECTION);
      expect(created).toHaveLength(1);
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(2);
    });
  });

  describe("store shape — unique signalId index, standard (not time-series)", () => {
    it("creates a STANDARD collection with a UNIQUE signalId index", async () => {
      const { db, store } = makeStore();
      await store.submit(validMinimalScored());

      // createCollection was called WITHOUT time-series options.
      expect(db.createdCollections).toContain(COLLECTION);
      expect(db.createCollectionOptions.get(COLLECTION)).toBeUndefined();

      const indexes = db._collection(COLLECTION)._indexes();
      const sig = indexes.find((i) => i.keys.length === 1 && i.keys[0] === "signalId");
      expect(sig, "signalId index must exist").toBeTruthy();
      expect(sig?.unique, "signalId index must be UNIQUE").toBe(true);
    });

    it("enforces uniqueness at the store layer (duplicate insert is a store-level dup key)", async () => {
      // Two DIFFERENT records with the same signalId cannot both persist.
      const { db, store } = makeStore();
      const a = validMinimalScored();
      const b = deepClone(a);
      b.scoredSignal.uwrScore = 0.42;

      await store.submit(a);
      await expect(store.submit(b)).rejects.toBeInstanceOf(EvidenceIdempotencyConflictError);
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });
  });

  describe("reads", () => {
    it("returns null for unknown signalId (get + replay)", async () => {
      const { store } = makeStore();
      expect(await store.getBySignalId("nope")).toBeNull();
      expect(await store.getReplayBundle("nope")).toBeNull();
    });
  });
});
