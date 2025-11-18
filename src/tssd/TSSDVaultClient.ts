// 🧩 T.S.S.D. Vault Client Interface + In-Memory Implementation

import { VaultedSignalRecord } from "./types";

/**
 * Query parameters for searching the TSSD Vault.
 * Supports filtering by analyst, strategy, epoch, market, and tags.
 */
export interface TSSDVaultQuery {
  /** Filter by analyst ID */
  analystId?: string;
  /** Filter by strategy ID */
  strategyId?: string;
  /** Filter by epoch ID */
  epochId?: string;
  /** Filter by market */
  market?: string;
  /** Match signals with any of these tags in publicSurface.tags */
  tagIncludesAny?: string[];
  /** Maximum number of results to return (default: 100) */
  limit?: number;
}

/**
 * ITSSDVaultClient: Generic interface for TSSD Vault operations.
 * 
 * This interface defines the contract for interacting with the TSSD Vault,
 * which stores the canonical, auditable record of each signal's lifecycle.
 * 
 * Implementations may use:
 * - In-memory storage (for dev/test)
 * - MongoDB time-series collections (for production)
 * - Other persistent storage backends
 */
export interface ITSSDVaultClient {
  /**
   * Upsert a signal record into the vault.
   * If the signal already exists (by signalId), merge the new data with existing.
   * 
   * @param record - The VaultedSignalRecord to store
   */
  upsert(record: VaultedSignalRecord): Promise<void>;

  /**
   * Retrieve a signal record by its unique signalId.
   * 
   * @param signalId - The unique signal identifier
   * @returns The VaultedSignalRecord if found, null otherwise
   */
  getBySignalId(signalId: string): Promise<VaultedSignalRecord | null>;

  /**
   * Query the vault for signals matching the given criteria.
   * 
   * @param query - Query parameters for filtering
   * @returns Array of matching VaultedSignalRecords
   */
  query(query: TSSDVaultQuery): Promise<VaultedSignalRecord[]>;

  /**
   * List signals suitable for training (respects training flags).
   * Filters out signals where training.includeForModel is explicitly false.
   * 
   * @param query - Query parameters for filtering
   * @returns Array of training-eligible VaultedSignalRecords
   */
  listForTraining(query: TSSDVaultQuery): Promise<VaultedSignalRecord[]>;
}

/**
 * InMemoryTSSDVaultClient: Simple in-memory implementation of ITSSDVaultClient.
 * 
 * This is a local, non-persistent implementation meant for:
 * - Development and testing
 * - Prototyping and demos
 * - Unit tests
 * 
 * For production use, implement ITSSDVaultClient with a persistent backend
 * such as MongoDB time-series collections with proper indexing on:
 * - signalId (unique)
 * - epochId
 * - analystId
 * - strategyId
 * - market
 * - publicSurface.tags
 * 
 * No persistence, encryption, or access control is handled by this class.
 */
export class InMemoryTSSDVaultClient implements ITSSDVaultClient {
  private records = new Map<string, VaultedSignalRecord>();

  /**
   * Upsert a signal record.
   * Merges stages and other fields intelligently with existing records.
   */
  async upsert(record: VaultedSignalRecord): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.records.get(record.identity.signalId);

    const merged: VaultedSignalRecord = {
      ...existing,
      ...record,
      identity: record.identity,
      stages: {
        ...(existing?.stages ?? {}),
        ...(record.stages ?? {}),
      },
      publicSurface: record.publicSurface ?? existing?.publicSurface ?? {
        keyDrivers: [],
        summaryInsight: "",
      },
      proprietaryDetail: record.proprietaryDetail ?? existing?.proprietaryDetail,
      training: {
        ...(existing?.training ?? {}),
        ...(record.training ?? {}),
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.records.set(merged.identity.signalId, merged);
  }

  /**
   * Retrieve a signal by signalId.
   */
  async getBySignalId(signalId: string): Promise<VaultedSignalRecord | null> {
    return this.records.get(signalId) ?? null;
  }

  /**
   * Query signals with filtering.
   */
  async query(query: TSSDVaultQuery): Promise<VaultedSignalRecord[]> {
    const all = Array.from(this.records.values());
    const filtered = all.filter((r) => {
      if (query.analystId && r.identity.analystId !== query.analystId) return false;
      if (query.strategyId && r.identity.strategyId !== query.strategyId) return false;
      if (query.epochId && r.identity.epochId !== query.epochId) return false;
      if (query.market && r.identity.market !== query.market) return false;
      if (query.tagIncludesAny && query.tagIncludesAny.length > 0) {
        const tags = r.publicSurface.tags ?? [];
        const hasMatch = query.tagIncludesAny.some((t) => tags.includes(t));
        if (!hasMatch) return false;
      }
      return true;
    });

    const limit = query.limit ?? 100;
    return filtered.slice(0, limit);
  }

  /**
   * List signals eligible for training.
   * Filters out signals where training.includeForModel is explicitly false.
   */
  async listForTraining(query: TSSDVaultQuery): Promise<VaultedSignalRecord[]> {
    const base = await this.query(query);
    return base.filter((r) => r.training?.includeForModel !== false);
  }
}

