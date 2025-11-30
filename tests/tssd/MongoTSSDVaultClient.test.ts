import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoTSSDVaultClient } from "../../src/tssd/MongoTSSDVaultClient.js";
import type { VaultedSignalRecord } from "../../src/tssd/types.js";

const mongoUri = process.env.AFI_TSSD_MONGODB_URI;
const hasMongo = Boolean(mongoUri);

(hasMongo ? describe : describe.skip)(
  "[mongo] MongoTSSDVaultClient smoke",
  () => {
    const collectionName = `tssd_signals_test_${Date.now()}`;
    const dbName = process.env.AFI_TSSD_DB_NAME || "afi_tssd_test";
    let client: MongoTSSDVaultClient;

    beforeAll(async () => {
      client = new MongoTSSDVaultClient({
        mongoUri: mongoUri as string,
        dbName,
        collectionName,
      });
    });

    afterAll(async () => {
      await client?.close();
    });

    it("upserts and retrieves a vaulted signal", async () => {
      const now = new Date().toISOString();
      const record: VaultedSignalRecord = {
        identity: {
          signalId: `vault-smoke-${Date.now()}`,
          analystId: "analyst-test",
          strategyId: "strategy-test",
          epochId: "epoch-test",
          market: "BTCUSDT",
          timeframe: "1h",
        },
        stages: {
          raw: {
            receivedAt: now,
            source: "test-suite",
            triggerSummary: "smoke test insert",
          },
        },
        publicSurface: {
          keyDrivers: ["test"],
          summaryInsight: "Mongo vault smoke",
          tags: ["smoke"],
        },
        training: {},
        createdAt: now,
        updatedAt: now,
      };

      await client.upsert(record);

      const fetched = await client.getBySignalId(record.identity.signalId);
      expect(fetched).toBeTruthy();
      expect(fetched?.identity.signalId).toBe(record.identity.signalId);
      expect(fetched?.identity.market).toBe(record.identity.market);
      expect(fetched?.stages.raw?.source).toBe("test-suite");
      expect(fetched?.publicSurface.tags).toContain("smoke");
      expect(fetched?.createdAt).toBeDefined();
      expect(fetched?.updatedAt).toBeDefined();
    });
  }
);
