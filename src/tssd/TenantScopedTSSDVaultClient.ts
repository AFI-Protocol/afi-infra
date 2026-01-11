import type { ITSSDVaultClient, TSSDVaultQuery } from "./TSSDVaultClient";
import type { VaultedSignalRecord } from "./types";
import { MongoTSSDVaultClient, type MongoTSSDVaultClientConfig } from "./MongoTSSDVaultClient";

export interface TenantScopedVaultOptions extends MongoTSSDVaultClientConfig {
  /** Tenant/analyst identifier used to scope all operations */
  tenantId: string;
  /** Optional injected client (useful for testing) */
  innerClient?: ITSSDVaultClient;
}

/**
 * TenantScopedTSSDVaultClient
 *
 * Enforces tenant (analyst) isolation by automatically scoping all reads/writes
 * to the provided tenantId. When no innerClient is supplied, it creates a
 * MongoTSSDVaultClient using the provided config.
 */
export class TenantScopedTSSDVaultClient implements ITSSDVaultClient {
  private readonly tenantId: string;
  private readonly inner: ITSSDVaultClient;

  constructor(options: TenantScopedVaultOptions) {
    this.tenantId = options.tenantId;
    this.inner = options.innerClient ?? new MongoTSSDVaultClient(options);
  }

  /** Upsert with enforced tenant scope */
  async upsert(record: VaultedSignalRecord): Promise<void> {
    const scoped: VaultedSignalRecord = {
      ...record,
      identity: {
        ...record.identity,
        analystId: this.tenantId,
      },
    };
    return this.inner.upsert(scoped);
  }

  /** getBySignalId returns a record only if it belongs to the tenant */
  async getBySignalId(signalId: string): Promise<VaultedSignalRecord | null> {
    const rec = await this.inner.getBySignalId(signalId);
    if (!rec) return null;
    return rec.identity.analystId === this.tenantId ? rec : null;
  }

  /** Queries are automatically scoped to tenantId regardless of caller input */
  async query(query: TSSDVaultQuery): Promise<VaultedSignalRecord[]> {
    const scopedQuery: TSSDVaultQuery = {
      ...query,
      analystId: this.tenantId,
    };
    return this.inner.query(scopedQuery);
  }

  /** listForTraining scoped to tenant */
  async listForTraining(query: TSSDVaultQuery): Promise<VaultedSignalRecord[]> {
    const scopedQuery: TSSDVaultQuery = {
      ...query,
      analystId: this.tenantId,
    };
    return this.inner.listForTraining(scopedQuery);
  }
}
