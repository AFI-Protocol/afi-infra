// Canonical JSON Hashing v1 — the COMPOSITION canonicalization law
// (`canonical-json-hashing.v1`, afi-config/schemas/hashing/canonical-json-hashing.v1.md;
// FCP-GOV FACTORY-CONTRACT), self-contained for the store's D-EV3-7
// recomputation-verified admission.
//
// EV3-GOV D-EV3-4(2)/(6): every Evidence-V3 record-level hash (recordHash,
// replayHash) is computed under THIS law — sha256 over the UTF-8 bytes of the
// canonically serialized JSON value after removing the projection's excluded
// TOP-LEVEL fields. The domain tag is CARRIED in the CanonicalHash object and
// is NEVER part of the hash material (unlike the evidence-layer law
// `canonicalHashV1`, which prefixes its preimage with the tag — both laws stamp
// `canonicalizationVersion: "afi.hash.v1"`; the stamp alone does NOT
// disambiguate them).
//
// Serialization (spec §2, RFC 8785(JCS)-aligned for the JSON subset used):
//   - objects: keys recursively sorted lexicographically by UTF-16 code units
//     (the JavaScript default string sort);
//   - arrays: authored order preserved;
//   - no insignificant whitespace;
//   - numbers: shortest ECMAScript round-trip form (floats ADMISSIBLE:
//     1.0 -> 1, 1e21 -> 1e+21, 0.0000001 -> 1e-7, -0 -> 0);
//   - strings: as JSON.stringify emits (non-ASCII literal);
//   - literals verbatim.
//
// This implementation mirrors the governed spec's reference implementation
// verbatim and is proven byte-exact against BOTH governed KAT suites
// (afi-config kats/hashing/v1 AND kats/evidence/v3) by
// tests/evidence/canonicalJsonHashing.kat.test.ts. Any change to these rules
// requires a new governance decision + canonical-json-hashing.v2 (spec §5) —
// never a silent mutation here.

import { createHash } from "node:crypto";
import type { AnyScoredSignalEvidenceRecord } from "./types.js";

/** The canonicalization-law version stamp both AFI hashing laws carry. */
export const CANONICALIZATION_VERSION = "afi.hash.v1";

/** Registered D-EV3-4(1) domain tag of the full-record integrity commitment. */
export const RECORD_HASH_DOMAIN_TAG = "afi.d2.evidence-record";
/** Registered D-EV3-4(1) domain tag of the deterministic replay commitment. */
export const REPLAY_HASH_DOMAIN_TAG = "afi.d2.evidence-replay";

/** recordHash preimage exclusions (D-EV3-4(6)): the full v3 record MINUS the
 *  two record-level hash fields themselves. TOP-LEVEL only. */
export const RECORD_HASH_EXCLUDED_FIELDS = ["recordHash", "replayHash"] as const;

/** replayHash preimage exclusions (D-EV3-4(6)): the replay projection — the
 *  record MINUS the record-level hashes AND the lifecycle/supersession custody
 *  fields. Lifecycle progression and supersession custody never move the
 *  replay commitment. TOP-LEVEL only. */
export const REPLAY_HASH_EXCLUDED_FIELDS = [
  "recordHash",
  "replayHash",
  "lifecycleState",
  "finalized",
  "recordVersion",
  "supersedesRecordHash",
] as const;

/**
 * Canonical serialization — the governed reference implementation, verbatim
 * semantics (canonical-json-hashing.v1 §2).
 */
export function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v)!;
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonicalize((v as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

/** sha256 over UTF-8 bytes, rendered as 64 lowercase hex characters. */
export function sha256Hex(utf8: string): string {
  return createHash("sha256").update(utf8, "utf-8").digest("hex");
}

/**
 * Removes the named TOP-LEVEL fields only (a nested key with the same name is
 * semantic data and survives — canonical-json-hashing.v1 §3).
 */
export function stripExcluded<T extends object>(
  artifact: T,
  excludedFields: readonly string[]
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(artifact)) {
    if (!excludedFields.includes(k)) out[k] = val;
  }
  return out as Partial<T>;
}

/** The composition-law digest of a JSON value after top-level exclusions.
 *  The domain tag is carried by the caller's CanonicalHash object — it is
 *  NEVER part of this hash material. */
export function canonicalSha256(value: unknown, excludedFields: readonly string[] = []): string {
  const material =
    excludedFields.length > 0 && value !== null && typeof value === "object" && !Array.isArray(value)
      ? stripExcluded(value as object, excludedFields)
      : value;
  return sha256Hex(canonicalize(material));
}

/**
 * The recomputed recordHash digest of a v3 evidence record AS SUBMITTED
 * (D-EV3-4(6)): the record minus {recordHash, replayHash}. When the submitter
 * omits the optional recordVersion (omission means 1 per the governed
 * contract), the field is absent from the preimage — the store's
 * recordVersion pinning is storage custody and happens AFTER verification.
 */
export function computeRecordHashValue(record: AnyScoredSignalEvidenceRecord): string {
  return canonicalSha256(record, RECORD_HASH_EXCLUDED_FIELDS);
}

/** The recomputed replayHash digest of a v3 evidence record (D-EV3-4(6)/(7)):
 *  the deterministic semantic/replay projection. */
export function computeReplayHashValue(record: AnyScoredSignalEvidenceRecord): string {
  return canonicalSha256(record, REPLAY_HASH_EXCLUDED_FIELDS);
}
