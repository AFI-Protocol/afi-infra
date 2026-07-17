import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import {
  EvidenceIdempotencyConflictError,
  EvidenceImmutableError,
  EvidenceStoreError,
  EvidenceValidationError,
  type ScoredSignalEvidenceRecord,
  type ScoredSignalEvidenceRecordV2,
} from "../../src/evidence/types.js";
import { validBase, validBaseV2, deepClone } from "./fixtures.js";

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

/** Build a valid governed v1 record with `signalId` threaded through every leg. */
function record(signalId: string, uwrScore = 0.55): ScoredSignalEvidenceRecord {
  const r = validBase();
  r.signalId = signalId;
  r.scoredSignal.signalId = signalId;
  r.scoredSignal.uwrScore = uwrScore;
  r.scoredSignal.provenanceRecordRef = `provenance-record:${signalId}`;
  r.provenanceRecord.signalId = signalId;
  return r;
}

/** Build a valid governed v2 record (REQUIRED composition) the same way. */
function recordV2(signalId: string, uwrScore = 0.55): ScoredSignalEvidenceRecordV2 {
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

    // --- afi.scored-signal-evidence.v2 (FACTORY-CONTRACT) --------------------

    it("v2: submits, enforces idempotency, and rejects a conflicting duplicate", async () => {
      const id = sid("v2-uniq");
      const first = await store.submit(recordV2(id));
      expect(first.outcome).toBe("inserted");

      const again = await store.submit(recordV2(id)); // byte-identical
      expect(again.outcome).toBe("idempotent-duplicate");

      await expect(store.submit(recordV2(id, 0.99))).rejects.toBeInstanceOf(
        EvidenceIdempotencyConflictError
      );
      const stored = await store.getBySignalId(id);
      expect(stored?.schema).toBe("afi.scored-signal-evidence.v2");
    });

    it("v2: rejects a record without composition (SCHEMA_VALIDATION, fail closed)", async () => {
      const { composition: _omitted, ...noComposition } = recordV2(sid("v2-nocomp")) as any;
      await expect(store.submit(noComposition)).rejects.toBeInstanceOf(EvidenceValidationError);
    });

    it("v2: rejects an unknown evidence schema const (SCHEMA_VALIDATION)", async () => {
      const bad: any = recordV2(sid("v2-unknown"));
      bad.schema = "afi.scored-signal-evidence.v3";
      await expect(store.submit(bad)).rejects.toBeInstanceOf(EvidenceValidationError);
    });

    it("v2: supersedes transactionally and the replay bundle carries composition", async () => {
      const id = sid("v2-supersede");
      const base = recordV2(id, 0.55);
      await store.submit(base);

      const next = deepClone(recordV2(id, 0.6));
      next.recordVersion = 2;
      next.supersedesRecordHash = PRED_HASH;

      const res = await store.supersede(next);
      expect(res.outcome).toBe("superseded");
      expect(res.toVersion).toBe(2);

      const bundle = await store.getReplayBundle(id);
      expect(bundle?.signalId).toBe(id);
      expect(bundle?.composition).toEqual(base.composition);
      expect(bundle?.composition?.schema).toBe("afi.composition-ref.v1");
      expect(bundle?.provenanceRecord.inputHash).toBeTruthy();
    });

    it("v2: replay bundle OMITS composition for a v1 record", async () => {
      const id = sid("v1-nocomp-bundle");
      await store.submit(record(id));
      const bundle = await store.getReplayBundle(id);
      expect(bundle).not.toBeNull();
      expect(bundle?.composition).toBeUndefined();
    });

    // Tagged for SLOT-FCP-CLEANUP: removed once afi-reactor emits v2 only.
    describe("TEMPORARY-DUAL-ACCEPT (real Mongo)", () => {
      it("still accepts a v1 record while the dual period lasts", async () => {
        const id = sid("v1-dual");
        const res = await store.submit(record(id));
        expect(res.outcome).toBe("inserted");
        const stored = await store.getBySignalId(id);
        expect(stored?.schema).toBe("afi.scored-signal-evidence.v1");
      });
    });
  }
);
