#!/usr/bin/env node
/**
 * OWNER-ONLY corpus purge — clear the pre-CFG-GOV scored corpus, KEEP observations.
 *
 * WHY: the existing scored records were produced by a pipeline with fabricated
 * inputs; they are opinions, not observations, and the owner intends to clear
 * them BEFORE deploying the CFG-GOV sealed-at-admission runtime so the store
 * is uniformly sealed from the first record forward.
 *
 * WHAT IT PURGES (and nothing else):
 *   - afi_scored_signal_evidence.scored_signal_evidence          (canonical current)
 *   - afi_scored_signal_evidence.scored_signal_evidence_history  (canonical history)
 *
 * WHAT IT KEEPS — the keep-list, hard-refused even if asked:
 *   - afi_signal_analytics.signal_outcomes  (observations: what the market did)
 *   - afi_signal_analytics.scoring_context  (carries the RAW INGEST PAYLOAD,
 *     `rawUss`, per signal — observations that enable offline re-scoring later)
 *   Everything not named above (tssd_signals, any other db/collection) is
 *   out of scope and never touched.
 *
 * SAFETY MODEL:
 *   - DRY-RUN BY DEFAULT: prints exact per-collection counts and exits.
 *   - Acting requires the explicit flag --confirm-purge-scored-corpus.
 *   - Refuses any attempt to name a keep-list or unknown collection.
 *   - deleteMany({}) (never drop): collections, indexes, and the unique
 *     signalId constraint survive; only documents are removed.
 *   - Prints per-collection counts BEFORE and AFTER, and verifies the
 *     keep-list counts are byte-identical before/after.
 *
 * USAGE:
 *   AFI_EVIDENCE_MONGODB_URI='mongodb+srv://…' node scripts/purge-scored-corpus.mjs
 *   AFI_EVIDENCE_MONGODB_URI='mongodb+srv://…' node scripts/purge-scored-corpus.mjs --confirm-purge-scored-corpus
 */
import { MongoClient } from "mongodb";
import process from "node:process";

const EVIDENCE_DB = process.env.AFI_EVIDENCE_DB_NAME ?? "afi_scored_signal_evidence";
const ANALYTICS_DB = process.env.AFI_ANALYTICS_DB_NAME ?? "afi_signal_analytics";

const PURGE_LIST = [
  { db: EVIDENCE_DB, collection: process.env.AFI_EVIDENCE_COLLECTION ?? "scored_signal_evidence" },
  { db: EVIDENCE_DB, collection: process.env.AFI_EVIDENCE_HISTORY_COLLECTION ?? "scored_signal_evidence_history" },
];

const KEEP_LIST = [
  { db: ANALYTICS_DB, collection: "signal_outcomes" },
  { db: ANALYTICS_DB, collection: "scoring_context" },
];

const CONFIRM_FLAG = "--confirm-purge-scored-corpus";

function fail(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
for (const arg of args) {
  if (arg !== CONFIRM_FLAG) {
    fail(
      `unknown argument '${arg}'. This script takes exactly one optional flag, ${CONFIRM_FLAG}. ` +
        `It will never accept a collection name — the purge set is fixed in source and the ` +
        `keep-list (${KEEP_LIST.map((k) => `${k.db}.${k.collection}`).join(", ")}) is untouchable.`
    );
  }
}
const act = args.includes(CONFIRM_FLAG);

// Defense in depth: if editing ever put a keep-list name into the purge set,
// refuse to start.
for (const p of PURGE_LIST) {
  if (KEEP_LIST.some((k) => k.db === p.db && k.collection === p.collection)) {
    fail(`purge list names keep-list collection ${p.db}.${p.collection}`);
  }
}

const uri = process.env.AFI_EVIDENCE_MONGODB_URI;
if (!uri) fail("AFI_EVIDENCE_MONGODB_URI is not set");

const client = new MongoClient(uri);

async function counts(list) {
  const out = [];
  for (const { db, collection } of list) {
    out.push({ db, collection, count: await client.db(db).collection(collection).countDocuments() });
  }
  return out;
}

function printCounts(label, rows) {
  console.log(`\n${label}`);
  for (const r of rows) {
    console.log(`  ${r.db}.${r.collection}: ${r.count}`);
  }
}

try {
  await client.connect();

  const purgeBefore = await counts(PURGE_LIST);
  const keepBefore = await counts(KEEP_LIST);
  printCounts("PURGE TARGETS (before):", purgeBefore);
  printCounts("KEEP-LIST (never touched):", keepBefore);

  if (!act) {
    console.log(
      `\nDRY-RUN — no documents were removed. To purge the ${purgeBefore.reduce((n, r) => n + r.count, 0)} ` +
        `scored documents above, re-run with ${CONFIRM_FLAG}.`
    );
    process.exit(0);
  }

  console.log("\nCONFIRMED — purging scored corpus (deleteMany, collections and indexes preserved)…");
  for (const { db, collection } of PURGE_LIST) {
    const res = await client.db(db).collection(collection).deleteMany({});
    console.log(`  deleted ${res.deletedCount} from ${db}.${collection}`);
  }

  const purgeAfter = await counts(PURGE_LIST);
  const keepAfter = await counts(KEEP_LIST);
  printCounts("PURGE TARGETS (after):", purgeAfter);
  printCounts("KEEP-LIST (after — must equal before):", keepAfter);

  const keepMoved = keepAfter.some(
    (r, i) => r.count !== keepBefore[i].count
  );
  if (keepMoved) {
    console.error("\nINTEGRITY ALARM: a keep-list count changed. This script issued no write to those collections — investigate concurrent writers before proceeding.");
    process.exit(2);
  }
  const residue = purgeAfter.reduce((n, r) => n + r.count, 0);
  if (residue !== 0) {
    console.error(`\nINCOMPLETE: ${residue} document(s) remain in the purge targets.`);
    process.exit(2);
  }
  console.log("\nDONE — scored corpus cleared; observations kept.");
} finally {
  await client.close();
}
