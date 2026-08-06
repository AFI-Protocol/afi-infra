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
 * WHAT IT SCRUBS — field-level, documents preserved (owner ruling 2026-08-06):
 *   - afi_signal_analytics.scoring_context — `analystScore` is set to null and a
 *     self-describing `scorePurge` marker is written. The score was the worthless
 *     part; everything that makes the row an OBSERVATION is kept:
 *       `lenses`      the persisted enriched view — enables offline re-scoring
 *       `rawUss`      the raw ingest payload as submitted
 *       `meta`        instrument + declared direction (the hourly outcomes cron
 *                     reads `meta.direction` / `meta.symbol`; it never reads
 *                     `analystScore`, so this scrub cannot break it)
 *       `decayParams`, `compositionRef`, `uwrResolvedSource`  provenance
 *     Nulling rather than unsetting is deliberate: a reader can distinguish
 *     "score deliberately removed" from "row never carried one".
 *
 * WHAT IT KEEPS UNTOUCHED — hard-refused even if asked:
 *   - afi_signal_analytics.signal_outcomes  (observations: what the market did)
 *   Everything not named above (tssd_signals, any other db/collection) is
 *   out of scope and never touched.
 *
 * SAFETY MODEL:
 *   - DRY-RUN BY DEFAULT: prints exact per-collection counts and exits.
 *   - Acting requires the explicit flag --confirm-purge-scored-corpus.
 *   - Refuses any attempt to name a keep-list or unknown collection.
 *   - deleteMany({}) (never drop): collections, indexes, and the unique
 *     signalId constraint survive; only documents are removed.
 *   - The scrub issues $set only — NEVER a delete. Its document count must be
 *     byte-identical before/after, and that is asserted.
 *   - Prints per-collection counts BEFORE and AFTER, and verifies the
 *     keep-list and scrub-list document counts are byte-identical before/after.
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
];

// Field-level scrub: documents survive, only the named score fields are nulled.
// `filter` also defines what the dry-run counts as still-scored.
const SCRUB_LIST = [
  {
    db: ANALYTICS_DB,
    collection: "scoring_context",
    filter: { analystScore: { $ne: null } },
    set: { analystScore: null },
    label: "analystScore",
  },
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

// Defense in depth: if editing ever put a keep-list or scrub-list name into the
// purge (deleteMany) set, refuse to start. A scrubbed collection must never be
// deleted from, and a keep-list collection must never be written at all.
for (const p of PURGE_LIST) {
  if (KEEP_LIST.some((k) => k.db === p.db && k.collection === p.collection)) {
    fail(`purge list names keep-list collection ${p.db}.${p.collection}`);
  }
  if (SCRUB_LIST.some((s) => s.db === p.db && s.collection === p.collection)) {
    fail(`purge list names scrub-list collection ${p.db}.${p.collection} — scrub is $set, never delete`);
  }
}
for (const s of SCRUB_LIST) {
  if (KEEP_LIST.some((k) => k.db === s.db && k.collection === s.collection)) {
    fail(`scrub list names keep-list collection ${s.db}.${s.collection}`);
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

async function scrubCounts() {
  const out = [];
  for (const { db, collection, filter, label } of SCRUB_LIST) {
    const col = client.db(db).collection(collection);
    out.push({
      db,
      collection,
      label,
      documents: await col.countDocuments(),
      stillScored: await col.countDocuments(filter),
    });
  }
  return out;
}

function printScrub(label, rows) {
  console.log(`\n${label}`);
  for (const r of rows) {
    console.log(
      `  ${r.db}.${r.collection}: ${r.documents} document(s), ${r.stillScored} still carrying '${r.label}'`
    );
  }
}

try {
  await client.connect();

  const purgeBefore = await counts(PURGE_LIST);
  const keepBefore = await counts(KEEP_LIST);
  const scrubBefore = await scrubCounts();
  printCounts("PURGE TARGETS — documents deleted (before):", purgeBefore);
  printCounts("KEEP-LIST — never written (before):", keepBefore);
  printScrub("SCRUB TARGETS — documents PRESERVED, score field nulled (before):", scrubBefore);

  if (!act) {
    console.log(
      `\nDRY-RUN — nothing was removed or modified.` +
        `\n  would DELETE  ${purgeBefore.reduce((n, r) => n + r.count, 0)} scored evidence document(s)` +
        `\n  would NULL    ${scrubBefore.reduce((n, r) => n + r.stillScored, 0)} '${SCRUB_LIST.map((s) => s.label).join("/")}' field(s), keeping every document` +
        `\nTo act, re-run with ${CONFIRM_FLAG}.`
    );
    process.exit(0);
  }

  console.log("\nCONFIRMED — purging scored corpus (deleteMany, collections and indexes preserved)…");
  for (const { db, collection } of PURGE_LIST) {
    const res = await client.db(db).collection(collection).deleteMany({});
    console.log(`  deleted ${res.deletedCount} from ${db}.${collection}`);
  }

  console.log("\nCONFIRMED — scrubbing score fields ($set only, never delete)…");
  const purgedAt = new Date().toISOString();
  for (const { db, collection, filter, set, label } of SCRUB_LIST) {
    const res = await client
      .db(db)
      .collection(collection)
      .updateMany(filter, {
        $set: {
          ...set,
          scorePurge: {
            purgedAt,
            field: label,
            reason:
              "pre-CFG-GOV score produced by a pipeline with fabricated inputs; " +
              "observations (lenses, rawUss, meta) deliberately retained for offline re-scoring",
          },
        },
      });
    console.log(`  nulled ${label} on ${res.modifiedCount} document(s) in ${db}.${collection}`);
  }

  const purgeAfter = await counts(PURGE_LIST);
  const keepAfter = await counts(KEEP_LIST);
  const scrubAfter = await scrubCounts();
  printCounts("PURGE TARGETS (after):", purgeAfter);
  printCounts("KEEP-LIST (after — must equal before):", keepAfter);
  printScrub("SCRUB TARGETS (after — documents must equal before, stillScored must be 0):", scrubAfter);

  const keepMoved = keepAfter.some(
    (r, i) => r.count !== keepBefore[i].count
  );
  if (keepMoved) {
    console.error("\nINTEGRITY ALARM: a keep-list count changed. This script issued no write to those collections — investigate concurrent writers before proceeding.");
    process.exit(2);
  }
  const scrubLostDocs = scrubAfter.some((r, i) => r.documents !== scrubBefore[i].documents);
  if (scrubLostDocs) {
    console.error("\nINTEGRITY ALARM: a scrub-target document count changed. The scrub issues $set only and must never delete — investigate before proceeding.");
    process.exit(2);
  }
  const scrubResidue = scrubAfter.reduce((n, r) => n + r.stillScored, 0);
  if (scrubResidue !== 0) {
    console.error(`\nINCOMPLETE: ${scrubResidue} document(s) still carry a score field.`);
    process.exit(2);
  }
  const residue = purgeAfter.reduce((n, r) => n + r.count, 0);
  if (residue !== 0) {
    console.error(`\nINCOMPLETE: ${residue} document(s) remain in the purge targets.`);
    process.exit(2);
  }
  console.log("\nDONE — scored corpus cleared, score fields nulled; observations kept.");
} finally {
  await client.close();
}
