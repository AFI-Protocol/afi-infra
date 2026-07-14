// Test fixtures. The store-behaviour tests use a VENDORED governed record
// (byte-identical to afi-config, drift-guarded) so they run standalone in CI.
// The conformance + drift tests reach into the afi-config sibling repo ONLY
// when it is present (local / monorepo CI); they skip otherwise.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ScoredSignalEvidenceRecord } from "../../src/evidence/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A valid non-finalized governed record (vendored copy of afi-config's
 *  minimal-scored vector). SCORED, finalized:false, recordVersion absent. */
export function validBase(): ScoredSignalEvidenceRecord {
  return JSON.parse(readFileSync(join(HERE, "vendored/minimal-scored.json"), "utf-8"));
}

/** Same record advanced to a FINALIZED state (finalized:true) — schema-valid
 *  by the contract's if/then finalized binding. Used for immutability tests. */
export function finalizedBase(): ScoredSignalEvidenceRecord {
  const r = validBase();
  r.lifecycleState = "FINALIZED";
  r.finalized = true;
  return r;
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// --- afi-config sibling access (gated) --------------------------------------

/** afi-config repo root if present as a sibling checkout, else null. */
export const afiConfigRoot: string | null = (() => {
  const candidate = join(HERE, "../../../afi-config");
  return existsSync(join(candidate, "package.json")) ? candidate : null;
})();

export const afiConfigAvailable = afiConfigRoot !== null;

const EX_DIR = afiConfigRoot
  ? join(afiConfigRoot, "examples/scored-signal-evidence/v1")
  : null;

/** Load a governed example/vector from the afi-config sibling repo. */
export function loadAfiConfigExample<T = unknown>(rel: string): T {
  if (!EX_DIR) throw new Error("afi-config sibling repo not available");
  return JSON.parse(readFileSync(join(EX_DIR, rel), "utf-8")) as T;
}
