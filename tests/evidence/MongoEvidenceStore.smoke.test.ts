import { describe, it, expect, afterAll } from "vitest";
import { MongoScoredSignalEvidenceStore } from "../../src/evidence/MongoScoredSignalEvidenceStore.js";
import { EvidenceIdempotencyConflictError } from "../../src/evidence/types.js";
import { validBase, deepClone } from "./fixtures.js";

// Opt-in real-MongoDB smoke (mirrors tests/tssd convention): runs ONLY when a
// live URI is provided. Proves the real unique `signalId` index enforces
// idempotency/append-once end-to-end against a standard collection.
const mongoUri = process.env.AFI_EVIDENCE_MONGODB_URI;
const hasMongo = Boolean(mongoUri);

(hasMongo ? describe : describe.skip)(
  "[mongo] MongoScoredSignalEvidenceStore smoke",
  () => {
    const suffix = process.env.AFI_EVIDENCE_TEST_SUFFIX ?? "smoke";
    const store = new MongoScoredSignalEvidenceStore({
      mongoUri: mongoUri as string,
      dbName: process.env.AFI_EVIDENCE_DB_NAME ?? "afi_scored_signal_evidence_test",
      collectionName: `scored_signal_evidence_${suffix}`,
      historyCollectionName: `scored_signal_evidence_history_${suffix}`,
      logger: {},
    });

    afterAll(async () => {
      await store.close();
    });

    it("insert → read → idempotent re-submit → conflicting submit rejected", async () => {
      const rec = validBase();
      rec.signalId = `evi-smoke-${Date.now()}`;
      rec.scoredSignal.signalId = rec.signalId;
      rec.provenanceRecord.signalId = rec.signalId;

      const inserted = await store.submit(rec);
      expect(inserted.outcome).toBe("inserted");

      const fetched = await store.getBySignalId(rec.signalId);
      expect(fetched?.signalId).toBe(rec.signalId);

      const again = await store.submit(deepClone(rec));
      expect(again.outcome).toBe("idempotent-duplicate");

      const conflicting = deepClone(rec);
      conflicting.scoredSignal.uwrScore = 0.123456;
      await expect(store.submit(conflicting)).rejects.toBeInstanceOf(
        EvidenceIdempotencyConflictError
      );
    });
  }
);
