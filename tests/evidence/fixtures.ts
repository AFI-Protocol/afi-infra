// Test fixtures. The store-behaviour tests use a VENDORED governed record
// (byte-identical to afi-config, drift-guarded) so they run standalone in CI.
// The conformance + drift tests reach into the afi-config sibling repo ONLY
// when it is present (local / monorepo CI); they skip otherwise.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ScoredSignalEvidenceRecordV3 } from "../../src/evidence/types.js";
import {
  computeRecordHashValue,
  computeReplayHashValue,
} from "../../src/evidence/canonicalJsonHashing.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A valid non-finalized governed v3 record (vendored copy of afi-config's v3
 *  minimal-scored vector — carries the REQUIRED composition ref, the five-lane
 *  provider invocation proof tuple, and self-consistent recordHash/replayHash).
 *  SCORED, finalized:false, recordVersion absent. */
export function validBaseV3(): ScoredSignalEvidenceRecordV3 {
  return JSON.parse(readFileSync(join(HERE, "vendored/minimal-scored.v3.json"), "utf-8"));
}

/** Recompute the record's recordHash/replayHash values under the governed
 *  composition law (KAT-proven implementation) after a test mutation, so a
 *  content-mutated fixture remains hash-admissible (EV3-GOV D-EV3-7). Mutates
 *  and returns the same record. */
export function withRecomputedHashes(
  r: ScoredSignalEvidenceRecordV3
): ScoredSignalEvidenceRecordV3 {
  r.replayHash = { ...r.replayHash, value: computeReplayHashValue(r) };
  r.recordHash = { ...r.recordHash, value: computeRecordHashValue(r) };
  return r;
}

/** The v3 base advanced to a FINALIZED state (finalized:true) — schema-valid
 *  by the contract's if/then finalized binding. recordHash is recomputed
 *  (lifecycle fields enter the record preimage); replayHash is UNCHANGED by
 *  law (lifecycle progression never moves the replay commitment) — asserted
 *  by the hashing tests. Used for immutability tests. */
export function finalizedBaseV3(): ScoredSignalEvidenceRecordV3 {
  const r = validBaseV3();
  r.lifecycleState = "FINALIZED";
  r.finalized = true;
  return withRecomputedHashes(r);
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
