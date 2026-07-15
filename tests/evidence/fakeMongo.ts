// In-memory MongoDB test double for the evidence store. Emulates the small
// surface the store depends on, INCLUDING:
//   - unique-index enforcement (duplicate key → E11000), so idempotency /
//     append-once behave as a real unique `signalId` index would;
//   - multi-document transactions with ATOMIC rollback-on-error and SERIALIZED
//     isolation, so supersession atomicity + concurrency can be tested without a
//     real replica set.
// A failure-injection hook lets tests force a mid-transaction error.

type Doc = Record<string, unknown> & { _id?: unknown };

interface IndexDef {
  keys: string[];
  unique: boolean;
  name: string;
}

function duplicateKeyError(name: string, keys: string[]): Error {
  const err = new Error(
    `E11000 duplicate key error collection index: ${name} dup key: { ${keys.join(", ")} }`
  ) as Error & { code: number };
  err.code = 11000;
  return err;
}

function matchesFilter(doc: Doc, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, val]) => doc[k] === val);
}

let idSeq = 0;

export class FakeCollection {
  private docs: Doc[] = [];
  private indexes: IndexDef[] = [];
  /** When >0, the next N replaceOne calls throw (mid-transaction failure test). */
  failReplaceOnce = 0;
  constructor(readonly name: string) {}

  private clone(doc: Doc): Doc {
    return JSON.parse(JSON.stringify(doc));
  }

  private violatesUnique(candidate: Doc, ignore?: Doc): void {
    for (const idx of this.indexes) {
      if (!idx.unique) continue;
      const conflict = this.docs.find(
        (d) => d !== ignore && idx.keys.every((k) => d[k] === candidate[k])
      );
      if (conflict) throw duplicateKeyError(idx.name, idx.keys);
    }
  }

  async insertOne(doc: Doc): Promise<{ insertedId: unknown }> {
    const stored = this.clone(doc);
    if (stored._id === undefined) stored._id = `oid-${++idSeq}`;
    this.violatesUnique(stored);
    this.docs.push(stored);
    return { insertedId: stored._id };
  }

  async findOne(filter: Record<string, unknown>): Promise<Doc | null> {
    const found = this.docs.find((d) => matchesFilter(d, filter));
    return found ? this.clone(found) : null;
  }

  async replaceOne(
    filter: Record<string, unknown>,
    doc: Doc
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    if (this.failReplaceOnce > 0) {
      this.failReplaceOnce -= 1;
      throw new Error("injected replaceOne failure");
    }
    const idx = this.docs.findIndex((d) => matchesFilter(d, filter));
    if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
    const target = this.docs[idx];
    const replacement = this.clone(doc);
    replacement._id = target._id;
    this.violatesUnique(replacement, target);
    this.docs[idx] = replacement;
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async createIndex(
    index: Record<string, number>,
    options?: Record<string, unknown>
  ): Promise<string> {
    const keys = Object.keys(index);
    const name = (options?.name as string) ?? keys.join("_");
    const unique = Boolean(options?.unique);
    if (!this.indexes.some((i) => i.name === name)) {
      this.indexes.push({ keys, unique, name });
    }
    return name;
  }

  // --- transaction snapshot/restore + introspection ---
  _snapshotDocs(): Doc[] {
    return this.docs.map((d) => this.clone(d));
  }
  _restoreDocs(docs: Doc[]): void {
    this.docs = docs;
  }
  _allDocs(): Doc[] {
    return this.docs.map((d) => this.clone(d));
  }
  _indexes(): IndexDef[] {
    return [...this.indexes];
  }
}

export class FakeDb {
  private collections = new Map<string, FakeCollection>();
  readonly createdCollections: string[] = [];
  readonly createCollectionOptions = new Map<string, Record<string, unknown> | undefined>();

  collection(name: string): FakeCollection {
    let c = this.collections.get(name);
    if (!c) {
      c = new FakeCollection(name);
      this.collections.set(name, c);
    }
    return c;
  }

  async createCollection(name: string, options?: Record<string, unknown>): Promise<unknown> {
    this.collection(name);
    this.createdCollections.push(name);
    this.createCollectionOptions.set(name, options);
    return {};
  }

  listCollections(
    filter: Record<string, unknown>
  ): { toArray(): Promise<Array<Record<string, unknown>>> } {
    const name = filter.name as string | undefined;
    const exists = name ? this.collections.has(name) : this.collections.size > 0;
    return { toArray: async () => (exists && name ? [{ name }] : []) };
  }

  _collection(name: string): FakeCollection {
    return this.collection(name);
  }
  _snapshot(): Map<string, Doc[]> {
    const snap = new Map<string, Doc[]>();
    for (const [name, col] of this.collections) snap.set(name, col._snapshotDocs());
    return snap;
  }
  _restore(snap: Map<string, Doc[]>): void {
    for (const [name, docs] of snap) this.collection(name)._restoreDocs(docs);
  }
}

class FakeSession {
  constructor(private readonly client: FakeMongoClient) {}
  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.client._runTransaction(fn);
  }
  async endSession(): Promise<void> {}
}

export class FakeMongoClient {
  private readonly _db: FakeDb;
  private txnLock: Promise<void> = Promise.resolve();
  constructor(db?: FakeDb) {
    this._db = db ?? new FakeDb();
  }
  db(_name?: string): FakeDb {
    return this._db;
  }
  startSession(): FakeSession {
    return new FakeSession(this);
  }
  async connect(): Promise<void> {}
  async close(): Promise<void> {}

  /** Serialized (isolation) + snapshot/rollback (atomicity) transaction model. */
  async _runTransaction<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const prev = this.txnLock;
    this.txnLock = new Promise<void>((r) => (release = r));
    await prev; // serialize: no two transactions run concurrently
    const snapshot = this._db._snapshot();
    try {
      return await fn();
    } catch (err) {
      this._db._restore(snapshot); // abort: roll back ALL writes made in the txn
      throw err;
    } finally {
      release();
    }
  }
}
