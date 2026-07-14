// Loads the GOVERNED test vectors straight from the afi-config package, so the
// store tests are tied to the same fixtures the contract's own drift guards
// use. Nothing here is hand-authored — the canonical shape lives in afi-config.

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import type { ScoredSignalEvidenceRecord } from "../../src/evidence/types.js";

const require = createRequire(import.meta.url);
const afiConfigRoot = dirname(require.resolve("afi-config/package.json"));
const EX_DIR = join(afiConfigRoot, "examples/scored-signal-evidence/v1");

function load<T = ScoredSignalEvidenceRecord>(rel: string): T {
  return JSON.parse(readFileSync(join(EX_DIR, rel), "utf-8")) as T;
}

/** Canonical example — FINALIZED (finalized: true). */
export const canonicalExample = (): ScoredSignalEvidenceRecord =>
  load("scored-signal-evidence.example.json");

/** Valid vectors. */
export const validMinimalScored = (): ScoredSignalEvidenceRecord =>
  load("vectors/valid/minimal-scored.json"); // SCORED, finalized:false
export const validQualified = (): ScoredSignalEvidenceRecord =>
  load("vectors/valid/qualified-mid-lifecycle.json"); // QUALIFIED, finalized:false
export const validEpochEligible = (): ScoredSignalEvidenceRecord =>
  load("vectors/valid/epoch-eligible-superseded.json"); // EPOCH_ELIGIBLE, finalized:true

/** Invalid vectors (loaded as unknown — they intentionally violate the contract). */
export const invalidVector = (name: string): unknown => load<unknown>(`vectors/invalid/${name}`);

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
