import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import {
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidenceStoreError,
  EvidenceValidationError,
  type ScoredSignalEvidenceRecordV2,
} from "../../src/evidence/types.js";
import { validBaseV2, deepClone } from "./fixtures.js";

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

/** Build a valid governed v2 record (REQUIRED composition) with `signalId`
 *  threaded through every leg. */
function record(signalId: string, uwrScore = 0.55): ScoredSignalEvidenceRecordV2 {
  const r = validBaseV2();
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
      expect(stored?.schema).toBe("afi.scored-signal-evidence.v2");
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

    it("supersedes successfully and the replay bundle carries composition", async () => {
      const id = sid("supersede");
      const base = record(id, 0.55);
      await store.submit(base);

      const next = deepClone(record(id, 0.6));
      next.recordVersion = 2;
      next.supersedesRecordHash = PRED_HASH;

      const res = await store.supersede(next);
      expect(res.outcome).toBe("superseded");
      expect(res.toVersion).toBe(2);

      const current = await store.getBySignalId(id);
      expect(current?.recordVersion).toBe(2);
      expect(current?.scoredSignal.uwrScore).toBe(0.6);

      const bundle = await store.getReplayBundle(id);
      expect(bundle?.signalId).toBe(id);
      expect(bundle?.scoredSignal.schema).toBe("afi.scored-signal.v1");
      expect(bundle?.provenanceRecord.inputHash).toBeTruthy();
      expect(bundle?.composition).toEqual(base.composition);
      expect(bundle?.composition?.schema).toBe("afi.composition-ref.v1");
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

    it("rejects a record without composition (SCHEMA_VALIDATION, fail closed)", async () => {
      const { composition: _omitted, ...noComposition } = record(sid("nocomp")) as any;
      await expect(store.submit(noComposition)).rejects.toBeInstanceOf(EvidenceValidationError);
    });

    it("rejects an unknown evidence schema const (SCHEMA_VALIDATION)", async () => {
      const bad: any = record(sid("unknown-const"));
      bad.schema = "afi.scored-signal-evidence.v3";
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceValidationError);
    });

    it("rejects a v1-const record (v2 is the ONLY accepted write contract)", async () => {
      const id = sid("v1-const");
      // A v1-shaped record: the v2 base minus composition, carrying the v1 const.
      const v1Shaped: any = record(id);
      v1Shaped.schema = "afi.scored-signal-evidence.v1";
      delete v1Shaped.composition;

      await expect(store.submit(v1Shaped)).rejects.toBeInstanceOf(EvidenceValidationError);
      expect(await store.getBySignalId(id)).toBeNull(); // nothing persisted
    });
  }
);
