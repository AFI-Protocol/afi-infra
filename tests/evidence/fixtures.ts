// Test fixtures. The store-behaviour tests use a VENDORED governed record
// (byte-identical to afi-config, drift-guarded) so they run standalone in CI.
// The conformance + drift tests reach into the afi-config sibling repo ONLY
// when it is present (local / monorepo CI); they skip otherwise.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ScoredSignalEvidenceRecordV2 } from "../../src/evidence/types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A valid non-finalized governed v2 record (vendored copy of afi-config's v2
 *  minimal-scored vector — carries the REQUIRED composition ref). SCORED,
 *  finalized:false, recordVersion absent. */
export function validBaseV2(): ScoredSignalEvidenceRecordV2 {
  return JSON.parse(readFileSync(join(HERE, "vendored/minimal-scored.v2.json"), "utf-8"));
}

/** The v2 base advanced to a FINALIZED state (finalized:true) — schema-valid
 *  by the contract's if/then finalized binding. Used for immutability tests. */
export function finalizedBaseV2(): ScoredSignalEvidenceRecordV2 {
  const r = validBaseV2();
  r.lifecycleState = "FINALIZED";
  r.finalized = true;
  return r;
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// --- afi-config sibling access (gated) --------------------------------------

/** afi-config repo root if available (explicit AFI_CONFIG_REPO_DIR — used by CI
 *  to point at a pinned checkout — or a sibling checkout), else null. */
export const afiConfigRoot: string | null = (() => {
  const env = process.env.AFI_CONFIG_REPO_DIR;
  if (env && existsSync(join(env, "package.json"))) return env;
  const sibling = join(HERE, "../../../afi-config");
  return existsSync(join(sibling, "package.json")) ? sibling : null;
})();

export const afiConfigAvailable = afiConfigRoot !== null;
