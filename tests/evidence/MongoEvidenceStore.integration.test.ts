import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import {
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidenceStoreError,
  type ScoredSignalEvidenceRecord,
} from "../../src/evidence/types.js";
import { validBase, deepClone } from "./fixtures.js";

// Real-MongoDB integration. Requires a replica set (supersession uses a
// multi-document transaction). Env-gated so local runs without Mongo skip — but
// in CI, AFI_REQUIRE_MONGO=1 turns a missing DB into a HARD FAILURE (never a
// silent skip), so these behaviours are mandatory in PR validation.
const mongoUri = process.env.AFI_EVIDENCE_MONGODB_URI;
const hasMongo = Boolean(mongoUri);
const required = process.env.AFI_REQUIRE_MONGO === "1";

const PRED_HASH = {
  algorithm: "sha256" as const,
  canonicalizationVersion: "afi.hash.v1",
  domainTag: "afi.d2.scored-signal-evidence",
  value: "1b16b1df538ba12dc3f97edbb85caa7050d46c148134290feba80f8236c83db9",
};

/** Build a valid governed record with `signalId` threaded through every leg. */
function record(signalId: string, uwrScore = 0.55): ScoredSignalEvidenceRecord {
  const r = validBase();
  r.signalId = signalId;
  r.scoredSignal.signalId = signalId;
  r.scoredSignal.uwrScore = uwrScore;
  r.scoredSignal.provenanceRecordRef = `provenance-record:${signalId}`;
  r.provenanceRecord.signalId = signalId;
  return r;
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

    it("supersedes successfully and returns read + replay bundle", async () => {
      const id = sid("supersede");
      await store.submit(record(id, 0.55));

      const v2 = deepClone(record(id, 0.6));
      v2.recordVersion = 2;
      v2.supersedesRecordHash = PRED_HASH;

      const res = await store.supersede(v2);
      expect(res.outcome).toBe("superseded");
      expect(res.toVersion).toBe(2);

      const current = await store.getBySignalId(id);
      expect(current?.recordVersion).toBe(2);
      expect(current?.scoredSignal.uwrScore).toBe(0.6);

      const bundle = await store.getReplayBundle(id);
      expect(bundle?.signalId).toBe(id);
      expect(bundle?.scoredSignal.schema).toBe("afi.scored-signal.v1");
      expect(bundle?.provenanceRecord.inputHash).toBeTruthy();
    });

    it("resolves concurrent supersedes to exactly one winner (typed conflict for the loser)", async () => {
      const id = sid("concurrent");
      await store.submit(record(id, 0.55));

      const mk = (score: number) => {
        const r = deepClone(record(id, score));
        r.recordVersion = 2;
        r.supersedesRecordHash = PRED_HASH;
        return r;
      };

      const results = await Promise.allSettled([store.supersede(mk(0.6)), store.supersede(mk(0.7))]);
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
      await store.submit(fin);

      const attempt = deepClone(fin);
      attempt.recordVersion = 2;
      attempt.supersedesRecordHash = PRED_HASH;
      await expect(store.supersede(attempt)).rejects.toBeInstanceOf(EvidenceImmutableError);
    });

    it("returns null for an unknown signalId (read + replay)", async () => {
      expect(await store.getBySignalId(sid("missing"))).toBeNull();
      expect(await store.getReplayBundle(sid("missing"))).toBeNull();
    });
  }
);
