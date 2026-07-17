import { describe, it, expect } from "vitest";
import { FakeMongoClient } from "./fakeMongo.js";
import { validBaseV2, finalizedBaseV2, deepClone } from "./fixtures.js";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import {
  EvidenceValidationError,
  EvidenceContinuityError,
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidencePersistenceError,
  EvidenceSupersedeError,
  type ScoredSignalEvidenceRecordV2,
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
  const client = new FakeMongoClient();
  const db = client.db();
  const store = new MongoScoredSignalEvidenceStore({
    client: client as never,
    collectionName: COLLECTION,
    historyCollectionName: HISTORY,
    logger: {},
  });
  return { client, db, store };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mutate = (r: any) => void;

// Mutations of the vendored governed base record that make it SCHEMA-invalid.
const SCHEMA_INVALID: Array<[string, Mutate]> = [
  ["missing strategyVersion", (r) => { delete r.strategyVersion; }],
  ["heavy ReactorScoredSignalDocument carrier", (r) => { r.scoredSignal.rawUss = { schema: "afi.usignal.v1.1" }; }],
  ["pre-scoring lifecycleState", (r) => { r.lifecycleState = "INGESTED"; r.finalized = false; }],
  ["legacy vocabulary state", (r) => { r.lifecycleState = "minted"; }],
  ["finality marker mismatch", (r) => { r.lifecycleState = "FINALIZED"; r.finalized = false; }],
  ["volatile storage timestamp", (r) => { r.storedAt = "2026-01-15T12:00:07Z"; }],
  ["VaultedSignalRecord brain field", (r) => { r.validator = { verdict: "approve" }; }],
];

// Mutations that keep the record SCHEMA-valid but break identifier continuity.
const CONTINUITY_INVALID: Array<[string, Mutate]> = [
  ["signalId != scoredSignal.signalId", (r) => { r.scoredSignal.signalId = `${r.signalId}-x`; }],
  ["signalId != provenanceRecord.signalId", (r) => { r.provenanceRecord.signalId = `${r.signalId}-x`; }],
  ["strategyId != scoredSignal.strategyId", (r) => { r.scoredSignal.strategyId = "other_strategy_v1"; }],
  ["canonicalizationVersion != provenanceRecord's", (r) => { r.canonicalizationVersion = "afi.hash.v2"; }],
];

describe("MongoScoredSignalEvidenceStore (MONGO-STORE / Slot 2)", () => {
  describe("submit — first write, validation, continuity", () => {
    it("inserts a valid record and reads it back by signalId", async () => {
      const { store } = makeStore();
      const rec = validBaseV2();

      const res = await store.submit(rec);
      expect(res.outcome).toBe("inserted");
      expect(res.signalId).toBe(rec.signalId);
      expect(res.recordVersion).toBe(1);

      const fetched = await store.getBySignalId(rec.signalId);
      expect(fetched?.signalId).toBe(rec.signalId);
      expect(fetched?.schema).toBe("afi.scored-signal-evidence.v2");
      expect(fetched?.lifecycleState).toBe("SCORED");
      expect(fetched?.composition.schema).toBe("afi.composition-ref.v1");
      expect("_id" in (fetched as object)).toBe(false); // storage _id not leaked
    });

    it("returns a minimum replay bundle (projection + provenance digests + composition)", async () => {
      const { store } = makeStore();
      const rec = validBaseV2();
      await store.submit(rec);

      const bundle = await store.getReplayBundle(rec.signalId);
      expect(bundle?.signalId).toBe(rec.signalId);
      expect(bundle?.canonicalizationVersion).toBe(rec.canonicalizationVersion);
      expect(bundle?.scoredSignal.schema).toBe("afi.scored-signal.v1");
      expect(bundle?.provenanceRecord.schema).toBe("afi.provenance-record.v1");
      expect(bundle?.provenanceRecord.inputHash).toBeTruthy();
      expect(bundle?.provenanceRecord.outputHash).toBeTruthy();
      expect(bundle?.composition).toEqual(rec.composition);
    });

    it("rejects schema-invalid records with a typed EvidenceValidationError", async () => {
      const { store } = makeStore();
      for (const [label, mutate] of SCHEMA_INVALID) {
        const bad = validBaseV2();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), label).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("rejects a record WITHOUT composition (SCHEMA_VALIDATION, fail closed)", async () => {
      const { store } = makeStore();
      const { composition: _omitted, ...noComposition } = validBaseV2() as any;
      await expect(store.submit(noComposition)).rejects.toBeInstanceOf(EvidenceValidationError);
      await expect(store.submit(noComposition)).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
    });

    it("rejects a record with malformed composition hashes (SCHEMA_VALIDATION)", async () => {
      const { store } = makeStore();
      const malformed: Array<[string, Mutate]> = [
        ["non-hex manifestHash value", (r) => { r.composition.manifestHash.value = "zz-not-hex"; }],
        ["truncated pluginSetHash value", (r) => { r.composition.pluginSetHash.value = "abc123"; }],
        ["missing executionSummaryHash", (r) => { delete r.composition.executionSummaryHash; }],
        ["bad enrichmentHash domainTag", (r) => { r.composition.enrichmentHash.domainTag = "NOT A TAG"; }],
      ];
      for (const [label, mutate] of malformed) {
        const bad: any = validBaseV2();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), label).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("rejects any schema const other than v2 (SCHEMA_VALIDATION)", async () => {
      const { store } = makeStore();
      for (const bogus of ["afi.scored-signal-evidence.v3", "afi.scored-signal.v1", "", undefined]) {
        const bad: any = validBaseV2();
        bad.schema = bogus;
        if (bogus === undefined) delete bad.schema;
        await expect(store.submit(bad), String(bogus)).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), String(bogus)).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("rejects a v1-const record (v2 is the ONLY accepted write contract)", async () => {
      const { db, store } = makeStore();
      // A v1-shaped record: the v2 base minus composition, carrying the v1 const.
      const v1Shaped: any = validBaseV2();
      v1Shaped.schema = "afi.scored-signal-evidence.v1";
      delete v1Shaped.composition;

      await expect(store.submit(v1Shaped)).rejects.toBeInstanceOf(EvidenceValidationError);
      await expect(store.submit(v1Shaped)).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(0); // nothing persisted
    });

    it("rejects identifier-continuity violations with a typed EvidenceContinuityError", async () => {
      const { store } = makeStore();
      for (const [label, mutate] of CONTINUITY_INVALID) {
        const bad = validBaseV2();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceContinuityError);
        await expect(store.submit(bad), label).rejects.toMatchObject({ code: "IDENTIFIER_CONTINUITY" });
      }
    });
  });

  describe("idempotency & append-once (D-MONGO-5/6)", () => {
    it("treats a byte-identical re-submission as idempotent (no duplicate record)", async () => {
      const { db, store } = makeStore();
      const rec = validBaseV2();

      const first = await store.submit(rec);
      const second = await store.submit(deepClone(rec));

      expect(first.outcome).toBe("inserted");
      expect(second.outcome).toBe("idempotent-duplicate");
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });

    it("distinguishes a CONFLICTING duplicate (same signalId, different content)", async () => {
      const { db, store } = makeStore();
      const rec = validBaseV2();
      await store.submit(rec);

      const conflicting = deepClone(rec);
      conflicting.scoredSignal.uwrScore = 0.99; // schema- & continuity-valid, different content

      await expect(store.submit(conflicting)).rejects.toBeInstanceOf(EvidenceIdempotencyConflictError);
      await expect(store.submit(conflicting)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

      // append-once: the stored record was NOT overwritten.
      const stored = await store.getBySignalId(rec.signalId);
      expect(stored?.scoredSignal.uwrScore).toBe(rec.scoredSignal.uwrScore);
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });
  });

  describe("supersession & immutable-after-FINALIZED (D-MONGO-5)", () => {
    it("supersedes with a governed correction, archiving the prior version to history", async () => {
      const { db, store } = makeStore();
      const first = validBaseV2(); // SCORED, finalized:false, recordVersion 1
      const baseScore = first.scoredSignal.uwrScore;
      await store.submit(first);

      const next = deepClone(first);
      next.recordVersion = 2;
      next.supersedesRecordHash = PRED_HASH;
      next.scoredSignal.uwrScore = 0.6; // a governed content correction

      const res = await store.supersede(next);
      expect(res.outcome).toBe("superseded");
      expect(res.fromVersion).toBe(1);
      expect(res.toVersion).toBe(2);

      const current = await store.getBySignalId(first.signalId);
      expect(current?.recordVersion).toBe(2);
      expect(current?.schema).toBe("afi.scored-signal-evidence.v2");
      expect(current?.scoredSignal.uwrScore).toBe(0.6);

      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
      const hist = db._collection(HISTORY)._allDocs();
      expect(hist).toHaveLength(1);
      const archived = hist[0] as unknown as ScoredSignalEvidenceRecordV2;
      expect(archived.recordVersion).toBe(1);
      expect(archived.scoredSignal.uwrScore).toBe(baseScore);
    });

    it("requires supersedesRecordHash (explicit supersession chain)", async () => {
      const { store } = makeStore();
      await store.submit(validBaseV2());

      const next = deepClone(validBaseV2());
      next.recordVersion = 2;
      next.scoredSignal.uwrScore = 0.6; // no supersedesRecordHash
      await expect(store.supersede(next)).rejects.toBeInstanceOf(EvidenceSupersedeError);
      await expect(store.supersede(next)).rejects.toMatchObject({ code: "SUPERSEDE_INVALID" });
    });

    it("refuses to supersede a FINALIZED record (immutable-after-FINALIZED)", async () => {
      const { store } = makeStore();
      await store.submit(finalizedBaseV2());

      const attempt = deepClone(finalizedBaseV2());
      attempt.recordVersion = 2;
      attempt.supersedesRecordHash = PRED_HASH;

      await expect(store.supersede(attempt)).rejects.toBeInstanceOf(EvidenceImmutableError);
      await expect(store.supersede(attempt)).rejects.toMatchObject({ code: "IMMUTABLE_AFTER_FINALIZED" });
    });

    it("refuses to supersede when no current record exists", async () => {
      const { store } = makeStore();
      const next = deepClone(validBaseV2());
      next.recordVersion = 2;
      next.supersedesRecordHash = PRED_HASH;
      await expect(store.supersede(next)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("refuses a non-monotonic recordVersion", async () => {
      const { store } = makeStore();
      await store.submit(validBaseV2());

      const notNewer = deepClone(validBaseV2());
      notNewer.recordVersion = 1; // not greater than current version 1
      notNewer.supersedesRecordHash = PRED_HASH;
      notNewer.scoredSignal.uwrScore = 0.6;
      await expect(store.supersede(notNewer)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("is ATOMIC: a failure between history archival and current install rolls back", async () => {
      const { db, store } = makeStore();
      const first = validBaseV2();
      await store.submit(first);

      // Force the current-collection replaceOne to throw mid-transaction, AFTER
      // the history archive has been written inside the same transaction.
      db._collection(COLLECTION).failReplaceOnce = 1;

      const next = deepClone(first);
      next.recordVersion = 2;
      next.supersedesRecordHash = PRED_HASH;
      next.scoredSignal.uwrScore = 0.6;

      await expect(store.supersede(next)).rejects.toBeInstanceOf(EvidencePersistenceError);

      // No partial state: the transaction rolled back — history is empty and the
      // current record is untouched at version 1.
      expect(db._collection(HISTORY)._allDocs()).toHaveLength(0);
      const current = await store.getBySignalId(first.signalId);
      expect(current?.recordVersion).toBe(1);
      expect(current?.scoredSignal.uwrScore).toBe(first.scoredSignal.uwrScore);
    });

    it("serializes concurrent supersedes: one wins, the other is a typed conflict", async () => {
      const { db, store } = makeStore();
      const first = validBaseV2();
      await store.submit(first);

      const attempt = (score: number) => {
        const r = deepClone(first);
        r.recordVersion = 2;
        r.supersedesRecordHash = PRED_HASH;
        r.scoredSignal.uwrScore = score;
        return r;
      };

      const results = await Promise.allSettled([
        store.supersede(attempt(0.6)),
        store.supersede(attempt(0.7)),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(EvidenceSupersedeError);

      // consistent final state: current advanced to version 2 exactly once; one archived.
      const current = await store.getBySignalId(first.signalId);
      expect(current?.recordVersion).toBe(2);
      expect(db._collection(HISTORY)._allDocs()).toHaveLength(1);
    });
  });

  describe("first-write invariant & concurrency-safe init", () => {
    it("rejects a first-write submit with recordVersion > 1 (use supersede)", async () => {
      const { store } = makeStore();
      const bad = deepClone(validBaseV2());
      bad.recordVersion = 2;
      bad.supersedesRecordHash = PRED_HASH;
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("initializes the store exactly once under concurrent submits", async () => {
      const { db, store } = makeStore();
      const a = validBaseV2();
      const b = deepClone(a);
      b.signalId = `${a.signalId}-2`;
      b.scoredSignal.signalId = b.signalId;
      b.provenanceRecord.signalId = b.signalId;

      await Promise.all([store.submit(a), store.submit(b)]);

      const created = db.createdCollections.filter((n) => n === COLLECTION);
      expect(created).toHaveLength(1); // memoized init, not once-per-submit
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(2);
    });
  });

  describe("store shape — unique signalId index, standard (not time-series)", () => {
    it("creates a STANDARD collection with a UNIQUE signalId index", async () => {
      const { db, store } = makeStore();
      await store.submit(validBaseV2());

      expect(db.createdCollections).toContain(COLLECTION);
      expect(db.createCollectionOptions.get(COLLECTION)).toBeUndefined(); // no timeseries options

      const indexes = db._collection(COLLECTION)._indexes();
      const sig = indexes.find((i) => i.keys.length === 1 && i.keys[0] === "signalId");
      expect(sig?.unique).toBe(true);
    });

    it("enforces uniqueness at the store layer (different content, same signalId cannot both persist)", async () => {
      const { db, store } = makeStore();
      const a = validBaseV2();
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
