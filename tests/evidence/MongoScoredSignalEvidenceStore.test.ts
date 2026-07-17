import { describe, it, expect } from "vitest";
import { FakeMongoClient } from "./fakeMongo.js";
import { validBase, finalizedBase, validBaseV2, finalizedBaseV2, deepClone } from "./fixtures.js";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import {
  EvidenceValidationError,
  EvidenceContinuityError,
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidencePersistenceError,
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
      const rec = validBase();

      const res = await store.submit(rec);
      expect(res.outcome).toBe("inserted");
      expect(res.signalId).toBe(rec.signalId);
      expect(res.recordVersion).toBe(1);

      const fetched = await store.getBySignalId(rec.signalId);
      expect(fetched?.signalId).toBe(rec.signalId);
      expect(fetched?.lifecycleState).toBe("SCORED");
      expect("_id" in (fetched as object)).toBe(false); // storage _id not leaked
    });

    it("returns a minimum replay bundle (projection + provenance digests)", async () => {
      const { store } = makeStore();
      const rec = validBase();
      await store.submit(rec);

      const bundle = await store.getReplayBundle(rec.signalId);
      expect(bundle?.signalId).toBe(rec.signalId);
      expect(bundle?.canonicalizationVersion).toBe(rec.canonicalizationVersion);
      expect(bundle?.scoredSignal.schema).toBe("afi.scored-signal.v1");
      expect(bundle?.provenanceRecord.schema).toBe("afi.provenance-record.v1");
      expect(bundle?.provenanceRecord.inputHash).toBeTruthy();
      expect(bundle?.provenanceRecord.outputHash).toBeTruthy();
    });

    it("rejects schema-invalid records with a typed EvidenceValidationError", async () => {
      const { store } = makeStore();
      for (const [label, mutate] of SCHEMA_INVALID) {
        const bad = validBase();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), label).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("rejects identifier-continuity violations with a typed EvidenceContinuityError", async () => {
      const { store } = makeStore();
      for (const [label, mutate] of CONTINUITY_INVALID) {
        const bad = validBase();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceContinuityError);
        await expect(store.submit(bad), label).rejects.toMatchObject({ code: "IDENTIFIER_CONTINUITY" });
      }
    });
  });

  describe("idempotency & append-once (D-MONGO-5/6)", () => {
    it("treats a byte-identical re-submission as idempotent (no duplicate record)", async () => {
      const { db, store } = makeStore();
      const rec = validBase();

      const first = await store.submit(rec);
      const second = await store.submit(deepClone(rec));

      expect(first.outcome).toBe("inserted");
      expect(second.outcome).toBe("idempotent-duplicate");
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });

    it("distinguishes a CONFLICTING duplicate (same signalId, different content)", async () => {
      const { db, store } = makeStore();
      const rec = validBase();
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
      const v1 = validBase(); // SCORED, finalized:false, v1
      const baseScore = v1.scoredSignal.uwrScore;
      await store.submit(v1);

      const v2 = deepClone(v1);
      v2.recordVersion = 2;
      v2.supersedesRecordHash = PRED_HASH;
      v2.scoredSignal.uwrScore = 0.6; // a governed content correction

      const res = await store.supersede(v2);
      expect(res.outcome).toBe("superseded");
      expect(res.fromVersion).toBe(1);
      expect(res.toVersion).toBe(2);

      const current = await store.getBySignalId(v1.signalId);
      expect(current?.recordVersion).toBe(2);
      expect(current?.scoredSignal.uwrScore).toBe(0.6);

      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
      const hist = db._collection(HISTORY)._allDocs();
      expect(hist).toHaveLength(1);
      const archived = hist[0] as unknown as ScoredSignalEvidenceRecord;
      expect(archived.recordVersion).toBe(1);
      expect(archived.scoredSignal.uwrScore).toBe(baseScore);
    });

    it("requires supersedesRecordHash (explicit supersession chain)", async () => {
      const { store } = makeStore();
      await store.submit(validBase());

      const v2 = deepClone(validBase());
      v2.recordVersion = 2;
      v2.scoredSignal.uwrScore = 0.6; // no supersedesRecordHash
      await expect(store.supersede(v2)).rejects.toBeInstanceOf(EvidenceSupersedeError);
      await expect(store.supersede(v2)).rejects.toMatchObject({ code: "SUPERSEDE_INVALID" });
    });

    it("refuses to supersede a FINALIZED record (immutable-after-FINALIZED)", async () => {
      const { store } = makeStore();
      await store.submit(finalizedBase());

      const attempt = deepClone(finalizedBase());
      attempt.recordVersion = 2;
      attempt.supersedesRecordHash = PRED_HASH;

      await expect(store.supersede(attempt)).rejects.toBeInstanceOf(EvidenceImmutableError);
      await expect(store.supersede(attempt)).rejects.toMatchObject({ code: "IMMUTABLE_AFTER_FINALIZED" });
    });

    it("refuses to supersede when no current record exists", async () => {
      const { store } = makeStore();
      const v2 = deepClone(validBase());
      v2.recordVersion = 2;
      v2.supersedesRecordHash = PRED_HASH;
      await expect(store.supersede(v2)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("refuses a non-monotonic recordVersion", async () => {
      const { store } = makeStore();
      await store.submit(validBase());

      const notNewer = deepClone(validBase());
      notNewer.recordVersion = 1; // not greater than current v1
      notNewer.supersedesRecordHash = PRED_HASH;
      notNewer.scoredSignal.uwrScore = 0.6;
      await expect(store.supersede(notNewer)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("is ATOMIC: a failure between history archival and current install rolls back", async () => {
      const { db, store } = makeStore();
      const v1 = validBase();
      await store.submit(v1);

      // Force the current-collection replaceOne to throw mid-transaction, AFTER
      // the history archive has been written inside the same transaction.
      db._collection(COLLECTION).failReplaceOnce = 1;

      const v2 = deepClone(v1);
      v2.recordVersion = 2;
      v2.supersedesRecordHash = PRED_HASH;
      v2.scoredSignal.uwrScore = 0.6;

      await expect(store.supersede(v2)).rejects.toBeInstanceOf(EvidencePersistenceError);

      // No partial state: the transaction rolled back — history is empty and the
      // current record is untouched at v1.
      expect(db._collection(HISTORY)._allDocs()).toHaveLength(0);
      const current = await store.getBySignalId(v1.signalId);
      expect(current?.recordVersion).toBe(1);
      expect(current?.scoredSignal.uwrScore).toBe(v1.scoredSignal.uwrScore);
    });

    it("serializes concurrent supersedes: one wins, the other is a typed conflict", async () => {
      const { db, store } = makeStore();
      const v1 = validBase();
      await store.submit(v1);

      const attempt = (score: number) => {
        const r = deepClone(v1);
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

      // consistent final state: current advanced to v2 exactly once; one v1 archived.
      const current = await store.getBySignalId(v1.signalId);
      expect(current?.recordVersion).toBe(2);
      expect(db._collection(HISTORY)._allDocs()).toHaveLength(1);
    });
  });

  describe("first-write invariant & concurrency-safe init", () => {
    it("rejects a first-write submit with recordVersion > 1 (use supersede)", async () => {
      const { store } = makeStore();
      const bad = deepClone(validBase());
      bad.recordVersion = 2;
      bad.supersedesRecordHash = PRED_HASH;
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("initializes the store exactly once under concurrent submits", async () => {
      const { db, store } = makeStore();
      const a = validBase();
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
      await store.submit(validBase());

      expect(db.createdCollections).toContain(COLLECTION);
      expect(db.createCollectionOptions.get(COLLECTION)).toBeUndefined(); // no timeseries options

      const indexes = db._collection(COLLECTION)._indexes();
      const sig = indexes.find((i) => i.keys.length === 1 && i.keys[0] === "signalId");
      expect(sig?.unique).toBe(true);
    });

    it("enforces uniqueness at the store layer (different content, same signalId cannot both persist)", async () => {
      const { db, store } = makeStore();
      const a = validBase();
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

  describe("v2 records (afi.scored-signal-evidence.v2 — FACTORY-CONTRACT)", () => {
    it("submits a valid v2 record (schema-const dispatch) and reads it back", async () => {
      const { store } = makeStore();
      const rec = validBaseV2();

      const res = await store.submit(rec);
      expect(res.outcome).toBe("inserted");
      expect(res.recordVersion).toBe(1);

      const fetched = await store.getBySignalId(rec.signalId);
      expect(fetched?.schema).toBe("afi.scored-signal-evidence.v2");
      expect(
        fetched && "composition" in fetched ? fetched.composition.schema : undefined
      ).toBe("afi.composition-ref.v1");
    });

    it("rejects a v2 record WITHOUT composition (SCHEMA_VALIDATION, fail closed)", async () => {
      const { store } = makeStore();
      const { composition: _omitted, ...noComposition } = validBaseV2() as any;
      await expect(store.submit(noComposition)).rejects.toBeInstanceOf(EvidenceValidationError);
      await expect(store.submit(noComposition)).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
    });

    it("rejects a v2 record with malformed composition hashes (SCHEMA_VALIDATION)", async () => {
      const { store } = makeStore();
      const malformed: Array<[string, (r: any) => void]> = [
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

    it("rejects any UNKNOWN evidence schema const (SCHEMA_VALIDATION)", async () => {
      const { store } = makeStore();
      for (const bogus of ["afi.scored-signal-evidence.v3", "afi.scored-signal.v1", "", undefined]) {
        const bad: any = validBaseV2();
        bad.schema = bogus;
        if (bogus === undefined) delete bad.schema;
        await expect(store.submit(bad), String(bogus)).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), String(bogus)).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("enforces identifier continuity IDENTICALLY on v2 records", async () => {
      const { store } = makeStore();
      const continuityBreaks: Array<[string, (r: any) => void]> = [
        ["signalId != scoredSignal.signalId", (r) => { r.scoredSignal.signalId = `${r.signalId}-x`; }],
        ["signalId != provenanceRecord.signalId", (r) => { r.provenanceRecord.signalId = `${r.signalId}-x`; }],
        ["strategyId != scoredSignal.strategyId", (r) => { r.scoredSignal.strategyId = "other_strategy_v1"; }],
        ["canonicalizationVersion != provenanceRecord's", (r) => { r.canonicalizationVersion = "afi.hash.v2"; }],
      ];
      for (const [label, mutate] of continuityBreaks) {
        const bad: any = validBaseV2();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceContinuityError);
      }
    });

    it("treats a byte-identical v2 re-submission as idempotent; different content conflicts", async () => {
      const { db, store } = makeStore();
      const rec = validBaseV2();

      const first = await store.submit(rec);
      const second = await store.submit(deepClone(rec));
      expect(first.outcome).toBe("inserted");
      expect(second.outcome).toBe("idempotent-duplicate");
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);

      const conflicting = deepClone(rec);
      conflicting.scoredSignal.uwrScore = 0.99;
      await expect(store.submit(conflicting)).rejects.toBeInstanceOf(EvidenceIdempotencyConflictError);
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });

    it("supersedes a v2 record transactionally, archiving v1-of-the-chain to history", async () => {
      const { db, store } = makeStore();
      const first = validBaseV2();
      await store.submit(first);

      const next = deepClone(first);
      next.recordVersion = 2;
      next.supersedesRecordHash = PRED_HASH;
      next.scoredSignal.uwrScore = 0.61;

      const res = await store.supersede(next);
      expect(res.outcome).toBe("superseded");
      expect(res.fromVersion).toBe(1);
      expect(res.toVersion).toBe(2);

      const current = await store.getBySignalId(first.signalId);
      expect(current?.recordVersion).toBe(2);
      expect(current?.schema).toBe("afi.scored-signal-evidence.v2");
      expect(db._collection(HISTORY)._allDocs()).toHaveLength(1);
    });

    it("refuses to supersede a FINALIZED v2 record (immutable-after-FINALIZED)", async () => {
      const { store } = makeStore();
      await store.submit(finalizedBaseV2());
      const attempt = deepClone(finalizedBaseV2());
      attempt.recordVersion = 2;
      attempt.supersedesRecordHash = PRED_HASH;
      await expect(store.supersede(attempt)).rejects.toBeInstanceOf(EvidenceImmutableError);
    });

    it("rejects a v2 first-write with recordVersion > 1 (recordVersion enforcement)", async () => {
      const { store } = makeStore();
      const bad = deepClone(validBaseV2());
      bad.recordVersion = 2;
      bad.supersedesRecordHash = PRED_HASH;
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("replay bundle CARRIES composition for v2 records and OMITS it for v1", async () => {
      const { store } = makeStore();
      const v2rec = validBaseV2();
      await store.submit(v2rec);

      const v2bundle = await store.getReplayBundle(v2rec.signalId);
      expect(v2bundle?.composition).toEqual(v2rec.composition);
      expect(v2bundle?.scoredSignal.schema).toBe("afi.scored-signal.v1");
      expect(v2bundle?.provenanceRecord.inputHash).toBeTruthy();

      const v1rec = validBase();
      v1rec.signalId = `${v1rec.signalId}-v1side`;
      v1rec.scoredSignal.signalId = v1rec.signalId;
      v1rec.provenanceRecord.signalId = v1rec.signalId;
      await store.submit(v1rec);

      const v1bundle = await store.getReplayBundle(v1rec.signalId);
      expect(v1bundle).not.toBeNull();
      expect(v1bundle && "composition" in v1bundle && v1bundle.composition !== undefined).toBe(false);
    });
  });

  // Tagged for SLOT-FCP-CLEANUP: this block (and the store's v1 validation
  // branch) is removed once afi-reactor emits v2 only.
  describe("TEMPORARY-DUAL-ACCEPT (v1 records still admissible during cross-repo sequencing)", () => {
    it("still accepts a valid v1 record byte-for-byte (existing behavior unchanged)", async () => {
      const { store } = makeStore();
      const rec = validBase();
      const res = await store.submit(rec);
      expect(res.outcome).toBe("inserted");
      const fetched = await store.getBySignalId(rec.signalId);
      expect(fetched?.schema).toBe("afi.scored-signal-evidence.v1");
      expect(fetched && "composition" in fetched).toBe(false);
    });

    it("still rejects a v1 record carrying composition (v1 shape is frozen)", async () => {
      const { store } = makeStore();
      const bad: any = validBase();
      bad.composition = validBaseV2().composition;
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceValidationError);
    });
  });
});
