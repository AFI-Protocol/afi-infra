// 🧩 T.S.S.D. Vault - MongoDB Implementation (Time-Series)
// Minimal v0 client using MongoDB native time-series collections.

import type { ITSSDVaultClient, TSSDVaultQuery } from "./TSSDVaultClient.js";
import type { VaultedSignalRecord } from "./types.js";

type MongoClientLike = {
  connect(): Promise<void>;
  close(): Promise<void>;
  db(name: string): DbLike;
};

type DbLike = {
  collection<T>(name: string): CollectionLike<T>;
  createCollection(
    name: string,
    options?: Record<string, unknown>
  ): Promise<unknown>;
  listCollections(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>
  ): { toArray(): Promise<Array<Record<string, unknown>>> };
};

type CursorLike<T> = {
  sort(sort: Record<string, number>): CursorLike<T>;
  limit(n: number): CursorLike<T>;
  toArray(): Promise<T[]>;
};

type CollectionLike<T> = {
  findOne(filter: Record<string, unknown>): Promise<T | null>;
  insertOne(doc: T): Promise<unknown>;
  deleteOne(filter: Record<string, unknown>): Promise<unknown>;
  find(filter: Record<string, unknown>): CursorLike<T>;
  createIndex(index: Record<string, unknown>, options?: Record<string, unknown>): Promise<string>;
};

type Logger = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

export interface MongoTSSDVaultClientConfig {
  mongoUri?: string;
  dbName?: string;
  collectionName?: string;
  retentionDays?: number;
  logger?: Logger;
  client?: MongoClientLike;
  db?: DbLike;
}

type VaultedSignalRecordDocument = Omit<
  VaultedSignalRecord,
  "createdAt" | "updatedAt"
> & {
  createdAt: Date;
  updatedAt: Date;
};

const DEFAULT_DB_NAME = "afi_tssd";
const DEFAULT_COLLECTION_NAME = "tssd_signals";

const timeSeriesOptions = {
  timeField: "createdAt",
  metaField: "identity",
  granularity: "minutes" as const,
};

export class MongoTSSDVaultClient implements ITSSDVaultClient {
  private readonly logger: Logger;
  private readonly retentionDays?: number;
  private readonly providedClient?: MongoClientLike;
  private readonly providedDb?: DbLike;
  private client?: MongoClientLike;
  private db?: DbLike;
  private collection?: CollectionLike<VaultedSignalRecordDocument>;
  private initialized = false;
  private readonly mongoUri: string;
  private readonly dbName: string;
  private readonly collectionName: string;

  constructor(config: MongoTSSDVaultClientConfig = {}) {
    const envUri =
      process.env.AFI_TSSD_MONGODB_URI ||
      process.env.MONGODB_URI ||
      process.env.MONGO_URI;

    const usedLegacyUri =
      !process.env.AFI_TSSD_MONGODB_URI &&
      (Boolean(process.env.MONGODB_URI) || Boolean(process.env.MONGO_URI));

    if (usedLegacyUri) {
      (config.logger ?? console).warn?.(
        "[TSSD] Using legacy Mongo URI env (MONGODB_URI/MONGO_URI). Prefer AFI_TSSD_MONGODB_URI."
      );
    }

    const mongoUri = config.mongoUri ?? envUri;
    if (!mongoUri) {
      throw new Error(
        "[TSSD] MongoTSSDVaultClient requires a MongoDB URI (AFI_TSSD_MONGODB_URI)."
      );
    }

    this.mongoUri = mongoUri;
    this.dbName = config.dbName ?? process.env.AFI_TSSD_DB_NAME ?? DEFAULT_DB_NAME;
    this.collectionName =
      config.collectionName ??
      process.env.AFI_TSSD_COLLECTION ??
      DEFAULT_COLLECTION_NAME;
    this.retentionDays = config.retentionDays;
    this.logger = config.logger ?? console;
    this.providedClient = config.client;
    this.providedDb = config.db;
  }

  async upsert(record: VaultedSignalRecord): Promise<void> {
    await this.ensureInitialized();
    if (!this.collection) return;

    const nowIso = new Date().toISOString();
    const existingDoc = await this.collection.findOne({
      "identity.signalId": record.identity.signalId,
    });
    const existing = existingDoc ? this.fromDb(existingDoc) : null;

    const merged: VaultedSignalRecord = {
      ...existing,
      ...record,
      identity: record.identity,
      stages: {
        ...(existing?.stages ?? {}),
        ...(record.stages ?? {}),
      },
      publicSurface:
        record.publicSurface ??
        existing?.publicSurface ?? {
          keyDrivers: [],
          summaryInsight: "",
        },
      proprietaryDetail: record.proprietaryDetail ?? existing?.proprietaryDetail,
      training: {
        ...(existing?.training ?? {}),
        ...(record.training ?? {}),
      },
      createdAt: existing?.createdAt ?? record.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    const doc = this.toDb(merged);
    const filter = { "identity.signalId": merged.identity.signalId };

    if (existingDoc) {
      await this.collection.deleteOne(filter);
    }

    await this.collection.insertOne(doc);
  }

  async getBySignalId(signalId: string): Promise<VaultedSignalRecord | null> {
    await this.ensureInitialized();
    if (!this.collection) return null;

    const doc = await this.collection.findOne({ "identity.signalId": signalId });
    return doc ? this.fromDb(doc) : null;
  }

  async query(query: TSSDVaultQuery): Promise<VaultedSignalRecord[]> {
    await this.ensureInitialized();
    if (!this.collection) return [];

    const filter: Record<string, unknown> = {};
    if (query.analystId) filter["identity.analystId"] = query.analystId;
    if (query.strategyId) filter["identity.strategyId"] = query.strategyId;
    if (query.epochId) filter["identity.epochId"] = query.epochId;
    if (query.market) filter["identity.market"] = query.market;
    if (query.tagIncludesAny && query.tagIncludesAny.length > 0) {
      filter["publicSurface.tags"] = { $in: query.tagIncludesAny };
    }

    const limit = query.limit ?? 100;
    const docs = await this.collection
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((d) => this.fromDb(d));
  }

  async listForTraining(query: TSSDVaultQuery): Promise<VaultedSignalRecord[]> {
    const base = await this.query(query);
    return base.filter((r) => r.training?.includeForModel !== false);
  }

  async close(): Promise<void> {
    if (this.providedClient) return;
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
    this.db = undefined;
    this.collection = undefined;
    this.initialized = false;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (this.providedDb) {
      this.db = this.providedDb;
    } else {
      if (this.providedClient) {
        this.client = this.providedClient;
      } else {
        // @ts-ignore MongoDB driver is expected to be installed at runtime by the consumer environment
        const { MongoClient } = await import("mongodb");
        this.client = new MongoClient(this.mongoUri) as unknown as MongoClientLike;
        await this.client.connect();
      }
      this.db = this.client.db(this.dbName);
    }

    const existing = await this.db
      .listCollections({ name: this.collectionName }, { nameOnly: true })
      .toArray();

    if (existing.length === 0) {
      await this.db.createCollection(this.collectionName, { timeseries: timeSeriesOptions });
      this.logger.info?.(
        `[TSSD] Created time-series collection ${this.collectionName} (timeField=createdAt, metaField=identity, granularity=minutes)`
      );
    }

    this.collection = this.db.collection<VaultedSignalRecordDocument>(this.collectionName);

    try {
      await this.collection.createIndex(
        { "identity.signalId": 1 },
        { unique: true, name: "identity_signalId_unique" }
      );
    } catch (err: unknown) {
      // MongoDB time-series collections do not allow unique indexes; fall back to non-unique.
      this.logger.warn?.(
        "[TSSD] Unique index on identity.signalId not supported on time-series collection; creating non-unique index instead."
      );
      await this.collection.createIndex(
        { "identity.signalId": 1 },
        { name: "identity_signalId" }
      );
    }

    await this.collection.createIndex({ createdAt: -1 }, { name: "createdAt_idx" });

    // Tenant-scoped time-series access pattern: analystId + recency
    await this.collection.createIndex(
      { "identity.analystId": 1, createdAt: -1 },
      { name: "identity_analystId_createdAt_idx" }
    );

    if (this.retentionDays && Number.isFinite(this.retentionDays) && this.retentionDays > 0) {
      const seconds = this.retentionDays * 24 * 60 * 60;
      await this.collection.createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: seconds, name: "createdAt_ttl" }
      );
      this.logger.info?.(
        `[TSSD] TTL index created on createdAt with retentionDays=${this.retentionDays}`
      );
    }

    this.initialized = true;
  }

  private toDb(record: VaultedSignalRecord): VaultedSignalRecordDocument {
    return {
      ...record,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
    };
  }

  private fromDb(doc: VaultedSignalRecordDocument): VaultedSignalRecord {
    return {
      ...doc,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
