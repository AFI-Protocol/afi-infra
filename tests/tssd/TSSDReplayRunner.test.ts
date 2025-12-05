import { describe, it, expect } from "vitest";
import { replaySignalsFromTssd } from "../../src/tssd/TSSDReplayRunner.js";
import { InMemoryTSSDVaultClient } from "../../src/tssd/TSSDVaultClient.js";
import type { VaultedSignalRecord } from "../../src/tssd/types.js";

describe("TSSDReplayRunner", () => {
  it("replays a single signal with an existing score", async () => {
    const vault = new InMemoryTSSDVaultClient();
    const now = "2025-11-22T00:00:00.000Z";

    const record: VaultedSignalRecord = {
      identity: {
        signalId: "replay-test-1",
        epochId: "epoch-1",
        market: "BTCUSDT",
        timeframe: "1h",
      },
      stages: {
        scored: {
          scoredAt: now,
          baseScore: 0.8,
          confidence: 0.9,
        },
      },
      publicSurface: {
        keyDrivers: ["test"],
        summaryInsight: "Replay test",
      },
      training: {},
      createdAt: now,
      updatedAt: now,
    };

    await vault.upsert(record);

    const result = await replaySignalsFromTssd(vault, {
      signalId: "replay-test-1",
      dryRun: true,
    });

    expect(result.totalRequested).toBe(1);
    expect(result.totalReplayed).toBe(1);
    expect(result.totalWithOriginalScore).toBe(1);
    expect(result.totalWithoutOriginalScore).toBe(0);
    expect(result.notes?.some((n) => n.includes("replay-test-1"))).toBe(true);
  });

  it("returns not-found summary when signal is missing", async () => {
    const vault = new InMemoryTSSDVaultClient();

    const result = await replaySignalsFromTssd(vault, {
      signalId: "does-not-exist",
      dryRun: true,
    });

    expect(result.totalRequested).toBe(1);
    expect(result.totalReplayed).toBe(0);
    expect(result.totalWithOriginalScore).toBe(0);
    expect(result.totalWithoutOriginalScore).toBe(0);
    expect(result.notes?.some((n) => n.includes("not found"))).toBe(true);
  });
});
