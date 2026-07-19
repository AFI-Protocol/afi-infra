// Governed-schema validation for the canonical scored-signal evidence record.
//
// Validates the COMPLETE evidence record against the governed JSON Schema —
// `afi.scored-signal-evidence.v3` (EV3-GOV D-EV3-1: the SOLE current canonical
// evidence contract — the v2 shape carried forward unchanged plus the required
// providerInvocations five-tuple, recordHash, and replayHash). afi-infra is
// a deployable service that (like CI) does not have the afi-config repo on its
// path, so the governed schemas + their District-2 $ref closure are VENDORED
// here under ./governed-schema/. Those files are byte-identical copies of the
// afi-config source: the drift tests in tests/evidence/ enforce
// byte-equality against the afi-config repo whenever it is available (local /
// monorepo CI), so the vendored copy cannot silently drift from the contract.
// The AJV configuration mirrors afi-config's own harness exactly.

import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "governed-schema");

function loadSchemaJson(fileName: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, fileName), "utf-8"));
}

const EVIDENCE_SCHEMA_FILE_V3 = "scored-signal-evidence.v3.schema.json";
const COMPOSITION_REF_SCHEMA_FILE = "composition-ref.schema.json";
/** The reused District-2 + EV3 proof shapes the evidence schema $refs
 *  (closure), preloaded so cross-file $refs resolve by $id. */
const DEP_SCHEMA_FILES = [
  "canonical-hash.schema.json",
  "evidence-ref.schema.json",
  "source-disclosure-profile.schema.json",
  "scored-signal.schema.json",
  "provenance-record.schema.json",
  "aiml-invocation-proof.schema.json",
  "provider-invocation-proof.schema.json",
];

function newGovernedAjv(): Ajv {
  const ajv = new Ajv({
    strict: true,
    allowUnionTypes: true,
    strictRequired: false,
    allErrors: true,
    verbose: true,
  });
  addFormats(ajv);
  ajv.addVocabulary([
    "x-afiStatus",
    "x-afiPartOf",
    "x-afiDoctrineRefs",
    "x-afiOpenItems",
    "x-afiProposedNotAccepted",
    "x-afiConstraints",
  ]);
  for (const file of DEP_SCHEMA_FILES) ajv.addSchema(loadSchemaJson(file));
  return ajv;
}

let compiledV3: ValidateFunction | undefined;

/** Compile (once) the governed v3 evidence validator (REQUIRED composition +
 *  the positional five-tuple of provider invocation proofs + the record-level
 *  CanonicalHash commitments, validated against the full vendored closure). */
export function getEvidenceValidatorV3(): ValidateFunction {
  if (compiledV3) return compiledV3;
  const ajv = newGovernedAjv();
  ajv.addSchema(loadSchemaJson(COMPOSITION_REF_SCHEMA_FILE));
  compiledV3 = ajv.compile(loadSchemaJson(EVIDENCE_SCHEMA_FILE_V3));
  return compiledV3;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: unknown[];
}

/** BOUNDED projection of one AJV error: locator/keyword facts only — the
 *  verbose-mode `data`/`schema`/`parentSchema` members (which can echo the
 *  candidate record wholesale) are structurally dropped (EV3-GOV D-EV3-6:
 *  no rejection surface may echo full record contents). */
function boundedError(e: ErrorObject): Record<string, unknown> {
  return {
    instancePath: e.instancePath,
    schemaPath: e.schemaPath,
    keyword: e.keyword,
    message: e.message,
    params: e.params,
  };
}

/** Validate a candidate object against the governed v3 evidence schema
 *  (composition + five-proof tuple + record hashes REQUIRED; all-or-nothing).
 *  Returned errors are BOUNDED validation facts, never record contents. */
export function validateEvidenceSchemaV3(candidate: unknown): SchemaValidationResult {
  const validate = getEvidenceValidatorV3();
  const valid = validate(candidate) as boolean;
  return { valid, errors: valid ? [] : (validate.errors ?? []).map(boundedError) };
}

/** Directory holding the vendored governed schema files (for the drift guard). */
export const GOVERNED_SCHEMA_DIR = SCHEMA_DIR;
/** Vendored governed schema file names (evidence contract + $ref closure). */
export const GOVERNED_SCHEMA_FILES = [
  EVIDENCE_SCHEMA_FILE_V3,
  COMPOSITION_REF_SCHEMA_FILE,
  ...DEP_SCHEMA_FILES,
];

/** The governed v3 schema's `$id`, for provenance/audit surfaces. */
export const GOVERNED_EVIDENCE_SCHEMA_ID_V3 =
  "https://afi-protocol.org/schemas/scored-signal-evidence/v3/scored-signal-evidence.schema.json";
/** The governed composition-ref schema's `$id` (the evidence contract's
 *  composition $ref). */
export const GOVERNED_COMPOSITION_REF_SCHEMA_ID =
  "https://afi-protocol.org/schemas/composition-ref/v1/composition-ref.schema.json";
/** The governed provider-invocation-proof schema's `$id` (the five-tuple's
 *  per-position $ref). */
export const GOVERNED_PROVIDER_INVOCATION_PROOF_SCHEMA_ID =
  "https://afi-protocol.org/schemas/provider-invocation-proof/v1/provider-invocation-proof.schema.json";
/** The governed aiml-invocation-proof schema's `$id` (nested inside the aiMl
 *  proof at position 0). */
export const GOVERNED_AIML_INVOCATION_PROOF_SCHEMA_ID =
  "https://afi-protocol.org/schemas/aiml-invocation-proof/v1/aiml-invocation-proof.schema.json";
