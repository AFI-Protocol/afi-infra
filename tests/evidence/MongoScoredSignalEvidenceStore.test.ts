import { describe, it, expect } from "vitest";
import { FakeMongoClient } from "./fakeMongo.js";
import { validBaseV3, finalizedBaseV3, withRecomputedHashes, deepClone } from "./fixtures.js";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import {
  EvidenceValidationError,
  EvidenceContinuityError,
  EvidenceHashMismatchError,
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidencePersistenceError,
  EvidenceSupersedeError,
  type EvidenceStoreError,
  type ScoredSignalEvidenceRecordV3,
} from "../../src/evidence/types.js";

const COLLECTION = "scored_signal_evidence";
const HISTORY = "scored_signal_evidence_history";

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

/** A hash-admissible superseding record: recordVersion 2, supersedesRecordHash
 *  = the predecessor's recordHash (the EV3-GOV D-EV3-4(6) DEFINED computation),
 *  content correction applied, own recordHash/replayHash recomputed LAST (the
 *  custody fields are part of the recordHash preimage). */
function supersedingRecord(
  base: ScoredSignalEvidenceRecordV3,
  uwrScore: number
): ScoredSignalEvidenceRecordV3 {
  const r = deepClone(base);
  r.recordVersion = 2;
  r.supersedesRecordHash = deepClone(base.recordHash);
  r.scoredSignal.uwrScore = uwrScore;
  return withRecomputedHashes(r);
}

/** Serialize the FULL enumerable error surface (message + own fields) for the
 *  bounded-rejection (redaction) assertions. */
function errorSurface(err: unknown): string {
  const e = err as Error;
  return JSON.stringify({ ...(e as unknown as Record<string, unknown>), message: e.message, name: e.name });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mutate = (r: any) => void;

// Mutations of the vendored governed base record that make it SCHEMA-invalid
// (rejected at the AJV stage — BEFORE continuity and hash verification).
const SCHEMA_INVALID: Array<[string, Mutate]> = [
  ["missing strategyVersion", (r) => { delete r.strategyVersion; }],
  ["heavy ReactorScoredSignalDocument carrier", (r) => { r.scoredSignal.rawUss = { schema: "afi.usignal.v1.1" }; }],
  ["pre-scoring lifecycleState", (r) => { r.lifecycleState = "INGESTED"; r.finalized = false; }],
  ["legacy vocabulary state", (r) => { r.lifecycleState = "minted"; }],
  ["finality marker mismatch", (r) => { r.lifecycleState = "FINALIZED"; r.finalized = false; }],
  ["volatile storage timestamp", (r) => { r.storedAt = "2026-01-15T12:00:07Z"; }],
  ["VaultedSignalRecord brain field", (r) => { r.validator = { verdict: "approve" }; }],
  ["missing providerInvocations", (r) => { delete r.providerInvocations; }],
  ["four-proof collection", (r) => { r.providerInvocations = r.providerInvocations.slice(0, 4); }],
  ["mis-ordered proof tuple", (r) => { r.providerInvocations = [...r.providerInvocations].reverse(); }],
  ["missing recordHash", (r) => { delete r.recordHash; }],
  ["missing replayHash", (r) => { delete r.replayHash; }],
  ["missing nested aiMl invocation proof", (r) => { delete r.providerInvocations[0].aimlInvocation; }],
];

// Mutations that keep the record SCHEMA-valid but break identifier continuity
// (rejected at the continuity stage — BEFORE hash verification, so no hash
// recomputation is needed for the fixture).
const CONTINUITY_INVALID: Array<[string, Mutate]> = [
  ["signalId != scoredSignal.signalId", (r) => { r.scoredSignal.signalId = `${r.signalId}-x`; }],
  ["signalId != provenanceRecord.signalId", (r) => { r.provenanceRecord.signalId = `${r.signalId}-x`; }],
  ["strategyId != scoredSignal.strategyId", (r) => { r.scoredSignal.strategyId = "other_strategy_v1"; }],
  ["canonicalizationVersion != provenanceRecord's", (r) => { r.canonicalizationVersion = "afi.hash.v2"; }],
];

describe("MongoScoredSignalEvidenceStore (MONGO-STORE / Slot 2, V3-only admission)", () => {
  describe("submit — first write, validation, continuity, hash-verified admission", () => {
    it("inserts a valid record and reads it back by signalId", async () => {
      const { store } = makeStore();
      const rec = validBaseV3();

      const res = await store.submit(rec);
      expect(res.outcome).toBe("inserted");
      expect(res.signalId).toBe(rec.signalId);
      expect(res.recordVersion).toBe(1);

      const fetched = await store.getBySignalId(rec.signalId);
      expect(fetched?.signalId).toBe(rec.signalId);
      expect(fetched?.schema).toBe("afi.scored-signal-evidence.v3");
      expect(fetched?.lifecycleState).toBe("SCORED");
      expect(fetched?.composition.schema).toBe("afi.composition-ref.v1");
      expect(fetched?.providerInvocations.map((p) => p.category)).toEqual([
        "aiMl",
        "news",
        "pattern",
        "sentiment",
        "technical",
      ]);
      expect(fetched?.recordHash.value).toBe(rec.recordHash.value);
      expect("_id" in (fetched as object)).toBe(false); // storage _id not leaked
    });

    it("returns a minimum replay bundle (projection + digests + composition + proofs + record hashes)", async () => {
      const { store } = makeStore();
      const rec = validBaseV3();
      await store.submit(rec);

      const bundle = await store.getReplayBundle(rec.signalId);
      expect(bundle?.signalId).toBe(rec.signalId);
      expect(bundle?.canonicalizationVersion).toBe(rec.canonicalizationVersion);
      expect(bundle?.scoredSignal.schema).toBe("afi.scored-signal.v1");
      expect(bundle?.provenanceRecord.schema).toBe("afi.provenance-record.v1");
      expect(bundle?.provenanceRecord.inputHash).toBeTruthy();
      expect(bundle?.provenanceRecord.outputHash).toBeTruthy();
      expect(bundle?.composition).toEqual(rec.composition);
      expect(bundle?.providerInvocations).toEqual(rec.providerInvocations);
      expect(bundle?.recordHash).toEqual(rec.recordHash);
      expect(bundle?.replayHash).toEqual(rec.replayHash);
    });

    it("rejects schema-invalid records with a typed EvidenceValidationError", async () => {
      const { store } = makeStore();
      for (const [label, mutate] of SCHEMA_INVALID) {
        const bad = validBaseV3();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), label).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("rejects a record WITHOUT composition (SCHEMA_VALIDATION, fail closed)", async () => {
      const { store } = makeStore();
      const { composition: _omitted, ...noComposition } = validBaseV3() as any;
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
        const bad: any = validBaseV3();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), label).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("rejects any schema const other than v3 (SCHEMA_VALIDATION)", async () => {
      const { store } = makeStore();
      for (const bogus of [
        ["afi.scored-signal-evidence", ".v", "2"].join(""),
        ["afi.scored-signal-evidence", ".v", "1"].join(""),
        "afi.scored-signal-evidence.v4",
        "afi.scored-signal.v1",
        "",
        undefined,
      ]) {
        const bad: any = validBaseV3();
        bad.schema = bogus;
        if (bogus === undefined) delete bad.schema;
        await expect(store.submit(bad), String(bogus)).rejects.toBeInstanceOf(EvidenceValidationError);
        await expect(store.submit(bad), String(bogus)).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      }
    });

    it("rejects a superseded-major-const record even in that shape (v3 is the ONLY accepted write contract)", async () => {
      const { db, store } = makeStore();
      // A prior-major-shaped record: the v3 base minus the three additions, carrying a superseded major const.
      const v2Shaped: any = validBaseV3();
      v2Shaped.schema = ["afi.scored-signal-evidence", ".v", "2"].join("");
      delete v2Shaped.providerInvocations;
      delete v2Shaped.recordHash;
      delete v2Shaped.replayHash;

      await expect(store.submit(v2Shaped)).rejects.toBeInstanceOf(EvidenceValidationError);
      await expect(store.submit(v2Shaped)).rejects.toMatchObject({ code: "SCHEMA_VALIDATION" });
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(0); // nothing persisted
    });

    it("rejects identifier-continuity violations with a typed EvidenceContinuityError", async () => {
      const { store } = makeStore();
      for (const [label, mutate] of CONTINUITY_INVALID) {
        const bad = validBaseV3();
        mutate(bad);
        await expect(store.submit(bad), label).rejects.toBeInstanceOf(EvidenceContinuityError);
        await expect(store.submit(bad), label).rejects.toMatchObject({ code: "IDENTIFIER_CONTINUITY" });
      }
    });
  });

  describe("recomputation-verified admission (EV3-GOV D-EV3-7)", () => {
    it("rejects a recordHash mismatch (HASH_VERIFICATION) and persists nothing", async () => {
      const { db, store } = makeStore();
      const bad = validBaseV3();
      // Schema-valid 64-hex digest that is NOT the recomputed value.
      bad.recordHash = { ...bad.recordHash, value: "0".repeat(64) };
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceHashMismatchError);
      await expect(store.submit(bad)).rejects.toMatchObject({
        code: "HASH_VERIFICATION",
        hashKind: "recordHash",
        declared: "0".repeat(64),
      });
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(0);
    });

    it("rejects a replayHash mismatch (HASH_VERIFICATION) and persists nothing", async () => {
      const { db, store } = makeStore();
      const bad = validBaseV3();
      bad.replayHash = { ...bad.replayHash, value: "f".repeat(64) };
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceHashMismatchError);
      await expect(store.submit(bad)).rejects.toMatchObject({
        code: "HASH_VERIFICATION",
        hashKind: "replayHash",
        declared: "f".repeat(64),
      });
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(0);
    });

    it("rejects a content mutation whose hashes were NOT recomputed (stale commitments)", async () => {
      const { db, store } = makeStore();
      const bad = validBaseV3();
      bad.scoredSignal.uwrScore = 0.99; // schema- & continuity-valid, stale hashes
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceHashMismatchError);
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(0);
    });

    it("admits the same content mutation once its hashes ARE recomputed", async () => {
      const { store } = makeStore();
      const rec = validBaseV3();
      rec.scoredSignal.uwrScore = 0.99;
      withRecomputedHashes(rec);
      const res = await store.submit(rec);
      expect(res.outcome).toBe("inserted");
    });

    it("verifies BEFORE the store's recordVersion pinning (omitted recordVersion admissible)", async () => {
      const { store } = makeStore();
      const rec = validBaseV3(); // the governed vector: recordVersion ABSENT
      expect(rec.recordVersion).toBeUndefined();
      const res = await store.submit(rec);
      expect(res.outcome).toBe("inserted");
      expect(res.recordVersion).toBe(1); // custody pinning happens after
    });
  });

  describe("bounded rejection surfaces (EV3-GOV D-EV3-6 synthetic-marker proof)", () => {
    const MARKER = "AFI-SYNTHETIC-SECRET-MARKER-b6f2";

    it("hash-mismatch rejection echoes bounded facts only — never record contents", async () => {
      const { store } = makeStore();
      const bad = validBaseV3();
      bad.uwrProfile.status = MARKER; // marker riding in a free-form field
      bad.recordHash = { ...bad.recordHash, value: "0".repeat(64) };
      let caught: unknown;
      try {
        await store.submit(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EvidenceHashMismatchError);
      expect(errorSurface(caught)).not.toContain(MARKER);
      expect((caught as EvidenceStoreError).signalId).toBe(bad.signalId);
    });

    it("schema-validation rejection echoes bounded facts only — never record contents", async () => {
      const { store } = makeStore();
      const bad: any = validBaseV3();
      bad.uwrProfile.status = MARKER; // valid-typed field carrying the marker
      bad.extraneousTopLevel = true; // root-level additionalProperties violation
      let caught: unknown;
      try {
        await store.submit(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(EvidenceValidationError);
      expect(errorSurface(caught)).not.toContain(MARKER);
    });
  });

  describe("idempotency & append-once (D-MONGO-5/6)", () => {
    it("treats a byte-identical re-submission as idempotent (no duplicate record)", async () => {
      const { db, store } = makeStore();
      const rec = validBaseV3();

      const first = await store.submit(rec);
      const second = await store.submit(deepClone(rec));

      expect(first.outcome).toBe("inserted");
      expect(second.outcome).toBe("idempotent-duplicate");
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });

    it("distinguishes a CONFLICTING duplicate (same signalId, different content)", async () => {
      const { db, store } = makeStore();
      const rec = validBaseV3();
      await store.submit(rec);

      const conflicting = deepClone(rec);
      conflicting.scoredSignal.uwrScore = 0.99;
      withRecomputedHashes(conflicting); // hash-admissible, different content

      await expect(store.submit(conflicting)).rejects.toBeInstanceOf(EvidenceIdempotencyConflictError);
      await expect(store.submit(conflicting)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

      // append-once: the stored record was NOT overwritten.
      const stored = await store.getBySignalId(rec.signalId);
      expect(stored?.scoredSignal.uwrScore).toBe(rec.scoredSignal.uwrScore);
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
    });
  });

  describe("supersession & immutable-after-FINALIZED (D-MONGO-5, D-EV3-4(6) chain law)", () => {
    it("supersedes with a governed correction, archiving the prior version to history", async () => {
      const { db, store } = makeStore();
      const first = validBaseV3(); // SCORED, finalized:false, recordVersion 1
      const baseScore = first.scoredSignal.uwrScore;
      await store.submit(first);

      const next = supersedingRecord(first, 0.6);
      const res = await store.supersede(next);
      expect(res.outcome).toBe("superseded");
      expect(res.fromVersion).toBe(1);
      expect(res.toVersion).toBe(2);

      const current = await store.getBySignalId(first.signalId);
      expect(current?.recordVersion).toBe(2);
      expect(current?.schema).toBe("afi.scored-signal-evidence.v3");
      expect(current?.scoredSignal.uwrScore).toBe(0.6);
      // The DEFINED chain computation: the installed record's supersedesRecordHash
      // IS the predecessor's recordHash.
      expect(current?.supersedesRecordHash?.value).toBe(first.recordHash.value);
      // Lifecycle/custody never moves the replay commitment.
      expect(current?.replayHash.value).not.toBe(first.replayHash.value); // content changed here
      expect(current?.recordHash.value).toBe(next.recordHash.value);

      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(1);
      const hist = db._collection(HISTORY)._allDocs();
      expect(hist).toHaveLength(1);
      const archived = hist[0] as unknown as ScoredSignalEvidenceRecordV3;
      expect(archived.recordVersion).toBe(1);
      expect(archived.scoredSignal.uwrScore).toBe(baseScore);
    });

    it("a custody-only supersession (no content change) keeps replayHash byte-identical", async () => {
      const { store } = makeStore();
      const first = validBaseV3();
      await store.submit(first);

      const next = deepClone(first);
      next.recordVersion = 2;
      next.supersedesRecordHash = deepClone(first.recordHash);
      withRecomputedHashes(next); // custody fields move recordHash only

      const res = await store.supersede(next);
      expect(res.outcome).toBe("superseded");
      const current = await store.getBySignalId(first.signalId);
      expect(current?.replayHash.value).toBe(first.replayHash.value);
      expect(current?.recordHash.value).not.toBe(first.recordHash.value);
    });

    it("requires supersedesRecordHash (explicit supersession chain)", async () => {
      const { store } = makeStore();
      await store.submit(validBaseV3());

      const next = deepClone(validBaseV3());
      next.recordVersion = 2;
      next.scoredSignal.uwrScore = 0.6; // no supersedesRecordHash
      withRecomputedHashes(next);
      await expect(store.supersede(next)).rejects.toBeInstanceOf(EvidenceSupersedeError);
      await expect(store.supersede(next)).rejects.toMatchObject({ code: "SUPERSEDE_INVALID" });
    });

    it("rejects a supersedesRecordHash that is not the predecessor's recordHash (broken chain link)", async () => {
      const { db, store } = makeStore();
      const first = validBaseV3();
      await store.submit(first);

      const next = deepClone(first);
      next.recordVersion = 2;
      next.supersedesRecordHash = { ...deepClone(first.recordHash), value: "a".repeat(64) };
      next.scoredSignal.uwrScore = 0.6;
      withRecomputedHashes(next); // self-hash-valid, but the chain link is wrong

      await expect(store.supersede(next)).rejects.toBeInstanceOf(EvidenceSupersedeError);
      await expect(store.supersede(next)).rejects.toMatchObject({ code: "SUPERSEDE_INVALID" });
      // Nothing moved: still at version 1, no history entry.
      expect((await store.getBySignalId(first.signalId))?.recordVersion).toBe(1);
      expect(db._collection(HISTORY)._allDocs()).toHaveLength(0);
    });

    it("rejects a superseding record whose own hashes were not recomputed (HASH_VERIFICATION)", async () => {
      const { store } = makeStore();
      const first = validBaseV3();
      await store.submit(first);

      const next = deepClone(first);
      next.recordVersion = 2;
      next.supersedesRecordHash = deepClone(first.recordHash);
      next.scoredSignal.uwrScore = 0.6; // stale recordHash/replayHash
      await expect(store.supersede(next)).rejects.toBeInstanceOf(EvidenceHashMismatchError);
    });

    it("refuses to supersede a FINALIZED record (immutable-after-FINALIZED)", async () => {
      const { store } = makeStore();
      const fin = finalizedBaseV3();
      await store.submit(fin);

      const attempt = supersedingRecord(fin, 0.6);
      await expect(store.supersede(attempt)).rejects.toBeInstanceOf(EvidenceImmutableError);
      await expect(store.supersede(attempt)).rejects.toMatchObject({ code: "IMMUTABLE_AFTER_FINALIZED" });
    });

    it("refuses to supersede when no current record exists", async () => {
      const { store } = makeStore();
      const next = supersedingRecord(validBaseV3(), 0.6);
      await expect(store.supersede(next)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("refuses a non-monotonic recordVersion", async () => {
      const { store } = makeStore();
      const first = validBaseV3();
      await store.submit(first);

      const notNewer = deepClone(first);
      notNewer.recordVersion = 1; // not greater than current version 1
      notNewer.supersedesRecordHash = deepClone(first.recordHash);
      notNewer.scoredSignal.uwrScore = 0.6;
      withRecomputedHashes(notNewer);
      await expect(store.supersede(notNewer)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("is ATOMIC: a failure between history archival and current install rolls back", async () => {
      const { db, store } = makeStore();
      const first = validBaseV3();
      await store.submit(first);

      // Force the current-collection replaceOne to throw mid-transaction, AFTER
      // the history archive has been written inside the same transaction.
      db._collection(COLLECTION).failReplaceOnce = 1;

      const next = supersedingRecord(first, 0.6);
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
      const first = validBaseV3();
      await store.submit(first);

      const results = await Promise.allSettled([
        store.supersede(supersedingRecord(first, 0.6)),
        store.supersede(supersedingRecord(first, 0.7)),
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
      const bad = supersedingRecord(validBaseV3(), 0.6); // hash-admissible, version 2
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceSupersedeError);
    });

    it("initializes the store exactly once under concurrent submits", async () => {
      const { db, store } = makeStore();
      const a = validBaseV3();
      const b = deepClone(a);
      b.signalId = `${a.signalId}-2`;
      b.scoredSignal.signalId = b.signalId;
      b.scoredSignal.provenanceRecordRef = `provenance-record:${b.signalId}`;
      b.provenanceRecord.signalId = b.signalId;
      withRecomputedHashes(b);

      await Promise.all([store.submit(a), store.submit(b)]);

      const created = db.createdCollections.filter((n) => n === COLLECTION);
      expect(created).toHaveLength(1); // memoized init, not once-per-submit
      expect(db._collection(COLLECTION)._allDocs()).toHaveLength(2);
    });
  });

  describe("store shape — unique signalId index, standard (not time-series)", () => {
    it("creates a STANDARD collection with a UNIQUE signalId index", async () => {
      const { db, store } = makeStore();
      await store.submit(validBaseV3());

      expect(db.createdCollections).toContain(COLLECTION);
      expect(db.createCollectionOptions.get(COLLECTION)).toBeUndefined(); // no timeseries options

      const indexes = db._collection(COLLECTION)._indexes();
      const sig = indexes.find((i) => i.keys.length === 1 && i.keys[0] === "signalId");
      expect(sig?.unique).toBe(true);
    });

    it("enforces uniqueness at the store layer (different content, same signalId cannot both persist)", async () => {
      const { db, store } = makeStore();
      const a = validBaseV3();
      const b = deepClone(a);
      b.scoredSignal.uwrScore = 0.42;
      withRecomputedHashes(b);

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
