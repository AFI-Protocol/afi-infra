import { describe, it, expect } from "vitest";
import { InMemoryTSSDVaultClient } from "../TSSDVaultClient";
import { TenantScopedTSSDVaultClient } from "../TenantScopedTSSDVaultClient";
import type { VaultedSignalRecord } from "../types";

const baseRecord = (signalId: string, analystId: string): VaultedSignalRecord => ({
  identity: {
    signalId,
    analystId,
    epochId: "epoch-1",
    market: "BTC-PERP",
    timeframe: "1h",
    strategyId: "strat",
  },
  stages: {},
  publicSurface: {
    keyDrivers: [],
    summaryInsight: "",
    tags: [],
  },
  training: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("TenantScopedTSSDVaultClient", () => {
  it("overrides analystId on upsert", async () => {
    const inner = new InMemoryTSSDVaultClient();
    const client = new TenantScopedTSSDVaultClient({ tenantId: "tenant-a", innerClient: inner });

    await client.upsert(baseRecord("sig-1", "someone-else"));

    const result = await client.getBySignalId("sig-1");
    expect(result?.identity.analystId).toBe("tenant-a");
  });

  it("isolates records between tenants", async () => {
    const inner = new InMemoryTSSDVaultClient();
    const clientA = new TenantScopedTSSDVaultClient({ tenantId: "tenant-a", innerClient: inner });
    const clientB = new TenantScopedTSSDVaultClient({ tenantId: "tenant-b", innerClient: inner });

    await clientA.upsert(baseRecord("sig-2", "wrong"));

    expect(await clientA.getBySignalId("sig-2")).not.toBeNull();
    expect(await clientB.getBySignalId("sig-2")).toBeNull();

    const resultsForB = await clientB.query({});
    expect(resultsForB.length).toBe(0);
  });

  it("scopes query even when caller passes different analystId", async () => {
    const inner = new InMemoryTSSDVaultClient();
    const client = new TenantScopedTSSDVaultClient({ tenantId: "tenant-a", innerClient: inner });

    await client.upsert(baseRecord("sig-3", "tenant-a"));

    const results = await client.query({ analystId: "tenant-b" });
    expect(results).toHaveLength(1);
    expect(results[0].identity.analystId).toBe("tenant-a");
  });
});
