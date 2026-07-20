import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import {
  EvidenceHashMismatchError,
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidenceStoreError,
  EvidenceValidationError,
  type ScoredSignalEvidenceRecordV3,
} from "../../src/evidence/types.js";
import { validBaseV3, withRecomputedHashes, deepClone } from "./fixtures.js";

// Real-MongoDB integration. Requires a replica set (supersession uses a
// multi-document transaction). Env-gated so local runs without Mongo skip — but
// in CI, AFI_REQUIRE_MONGO=1 turns a missing DB into a HARD FAILURE (never a
// silent skip), so these behaviours are mandatory in PR validation.
const mongoUri = process.env.AFI_EVIDENCE_MONGODB_URI;
const hasMongo = Boolean(mongoUri);
const required = process.env.AFI_REQUIRE_MONGO === "1";

/** Build a valid governed v3 record (five-proof tuple + verified record
 *  hashes) with `signalId` threaded through every leg and the record-level
 *  commitments recomputed under the KAT-proven composition law. */
function record(signalId: string, uwrScore = 0.55): ScoredSignalEvidenceRecordV3 {
  const r = validBaseV3();
  r.signalId = signalId;
  r.scoredSignal.signalId = signalId;
  r.scoredSignal.uwrScore = uwrScore;
  r.scoredSignal.provenanceRecordRef = `provenance-record:${signalId}`;
  r.provenanceRecord.signalId = signalId;
  return withRecomputedHashes(r);
}

/** A hash-admissible superseding record with the DEFINED chain link
 *  (supersedesRecordHash = the predecessor's recordHash, EV3-GOV D-EV3-4(6)). */
function superseding(base: ScoredSignalEvidenceRecordV3, uwrScore: number): ScoredSignalEvidenceRecordV3 {
  const r = deepClone(base);
  r.recordVersion = 2;
  r.supersedesRecordHash = deepClone(base.recordHash);
  r.scoredSignal.uwrScore = uwrScore;
  return withRecomputedHashes(r);
}

if (required && !hasMongo) {
  describe("real-Mongo integration (REQUIRED by CI)", () => {
    it("must have AFI_EVIDENCE_MONGODB_URI provisioned", () => {
      throw new Error(
        "AFI_REQUIRE_MONGO=1 but AFI_EVIDENCE_MONGODB_URI is unset — CI must provision MongoDB (replica set)."
      );
    });
  });
}

(hasMongo ? describe : describe.skip)(
  "[mongo] MongoScoredSignalEvidenceStore integration (real replica set)",
  () => {
    const suffix = process.env.GITHUB_RUN_ID ?? String(Math.floor(Math.random() * 1e9));
    const store = new MongoScoredSignalEvidenceStore({
      mongoUri: mongoUri as string,
      dbName: process.env.AFI_EVIDENCE_DB_NAME ?? "afi_scored_signal_evidence_it",
      collectionName: `scored_signal_evidence_${suffix}`,
      historyCollectionName: `scored_signal_evidence_history_${suffix}`,
      logger: {},
    });
    const sid = (name: string) => `evi-it-${suffix}-${name}`;

    beforeAll(async () => {
      // Force initialization (index creation) up front.
      await store.getBySignalId(sid("warmup"));
    });
    afterAll(async () => {
      await store.close();
    });

    it("enforces the unique signalId index + idempotent resubmission", async () => {
      const id = sid("uniq");
      const first = await store.submit(record(id));
      expect(first.outcome).toBe("inserted");

      const again = await store.submit(record(id)); // byte-identical
      expect(again.outcome).toBe("idempotent-duplicate");

      const stored = await store.getBySignalId(id);
      expect(stored?.signalId).toBe(id);
      expect(stored?.schema).toBe("afi.scored-signal-evidence.v3");
    });

    it("rejects a conflicting duplicate (same signalId, different content)", async () => {
      const id = sid("conflict");
      await store.submit(record(id, 0.55));
      await expect(store.submit(record(id, 0.99))).rejects.toBeInstanceOf(
        EvidenceIdempotencyConflictError
      );
      const stored = await store.getBySignalId(id);
      expect(stored?.scoredSignal.uwrScore).toBe(0.55); // append-once: not overwritten
    });

    it("rejects a mis-hashed record before insert (HASH_VERIFICATION; nothing persisted)", async () => {
      const id = sid("mis-hashed");
      const bad = record(id);
      bad.recordHash = { ...bad.recordHash, value: "0".repeat(64) };
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceHashMismatchError);
      const badReplay = record(id);
      badReplay.replayHash = { ...badReplay.replayHash, value: "f".repeat(64) };
      await expect(store.submit(badReplay)).rejects.toBeInstanceOf(EvidenceHashMismatchError);
      expect(await store.getBySignalId(id)).toBeNull(); // never persisted
    });

    it("supersedes via the DEFINED chain link and the replay bundle carries the v3 surfaces", async () => {
      const id = sid("supersede");
      const base = record(id, 0.55);
      await store.submit(base);

      const next = superseding(base, 0.6);
      const res = await store.supersede(next);
      expect(res.outcome).toBe("superseded");
      expect(res.toVersion).toBe(2);

      const current = await store.getBySignalId(id);
      expect(current?.recordVersion).toBe(2);
      expect(current?.scoredSignal.uwrScore).toBe(0.6);
      expect(current?.supersedesRecordHash?.value).toBe(base.recordHash.value);

      const bundle = await store.getReplayBundle(id);
      expect(bundle?.signalId).toBe(id);
      expect(bundle?.scoredSignal.schema).toBe("afi.scored-signal.v1");
      expect(bundle?.provenanceRecord.inputHash).toBeTruthy();
      expect(bundle?.composition).toEqual(base.composition);
      expect(bundle?.composition?.schema).toBe("afi.composition-ref.v1");
      expect(bundle?.providerInvocations.map((p) => p.category)).toEqual([
        "aiMl",
        "news",
        "pattern",
        "sentiment",
        "technical",
      ]);
      expect(bundle?.recordHash.value).toBe(next.recordHash.value);
      expect(bundle?.replayHash.value).toBe(next.replayHash.value);
    });

    it("rejects a broken supersession chain link (supersedesRecordHash != predecessor recordHash)", async () => {
      const id = sid("chain-broken");
      const base = record(id, 0.55);
      await store.submit(base);

      const next = deepClone(base);
      next.recordVersion = 2;
      next.supersedesRecordHash = { ...deepClone(base.recordHash), value: "a".repeat(64) };
      next.scoredSignal.uwrScore = 0.6;
      withRecomputedHashes(next); // self-hash-valid, chain link wrong

      await expect(store.supersede(next)).rejects.toBeInstanceOf(EvidenceStoreError);
      expect((await store.getBySignalId(id))?.recordVersion ?? 1).toBe(1);
    });

    it("resolves concurrent supersedes to exactly one winner (typed conflict for the loser)", async () => {
      const id = sid("concurrent");
      const base = record(id, 0.55);
      await store.submit(base);

      const results = await Promise.allSettled([
        store.supersede(superseding(base, 0.6)),
        store.supersede(superseding(base, 0.7)),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1); // exactly one wins
      results
        .filter((r) => r.status === "rejected")
        .forEach((r) =>
          expect((r as PromiseRejectedResult).reason).toBeInstanceOf(EvidenceStoreError)
        );

      const current = await store.getBySignalId(id);
      expect(current?.recordVersion).toBe(2); // consistent: advanced exactly once
    });

    it("refuses to supersede a FINALIZED record (immutable-after-FINALIZED)", async () => {
      const id = sid("finalized");
      const fin = record(id);
      fin.lifecycleState = "FINALIZED";
      fin.finalized = true;
      withRecomputedHashes(fin);
      await store.submit(fin);

      const attempt = superseding(fin, 0.6);
      await expect(store.supersede(attempt)).rejects.toBeInstanceOf(EvidenceImmutableError);
    });

    it("returns null for an unknown signalId (read + replay)", async () => {
      expect(await store.getBySignalId(sid("missing"))).toBeNull();
      expect(await store.getReplayBundle(sid("missing"))).toBeNull();
    });

    it("rejects a record without the five-proof tuple (SCHEMA_VALIDATION, fail closed)", async () => {
      const { providerInvocations: _omitted, ...noProofs } = record(sid("noproofs")) as never as Record<string, unknown>;
      await expect(
        store.submit(noProofs as never)
      ).rejects.toBeInstanceOf(EvidenceValidationError);
    });

    it("rejects prior-version schema consts (v3 is the ONLY accepted write contract)", async () => {
      const id = sid("v2-const");
      // A prior-major-shaped record: the v3 base minus the three additions, carrying a superseded major const.
      const v2Shaped: Record<string, unknown> = { ...record(id) };
      v2Shaped.schema = ["afi.scored-signal-evidence", ".v", "2"].join("");
      delete v2Shaped.providerInvocations;
      delete v2Shaped.recordHash;
      delete v2Shaped.replayHash;
      await expect(store.submit(v2Shaped as never)).rejects.toBeInstanceOf(EvidenceValidationError);

      const v1Const: Record<string, unknown> = { ...record(id) };
      v1Const.schema = ["afi.scored-signal-evidence", ".v", "1"].join("");
      await expect(store.submit(v1Const as never)).rejects.toBeInstanceOf(EvidenceValidationError);
      expect(await store.getBySignalId(id)).toBeNull(); // nothing persisted
    });
  }
);
