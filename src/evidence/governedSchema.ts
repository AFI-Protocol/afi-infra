// Governed-schema validation for the canonical scored-signal evidence record.
//
// Validates the COMPLETE evidence record against the governed JSON Schema —
// `afi.scored-signal-evidence.v2` (MONGO-GOV D-MONGO-1/D-MONGO-2 as amended by
// FACTORY-CONTRACT, decision factory-configurable-pipelines-v1: the base
// evidence contract + REQUIRED composition provenance,
// afi.composition-ref.v1). afi-infra is
// a deployable service that (like CI) does not have the afi-config repo on its
// path, so the governed schemas + their District-2 $ref closure are VENDORED
// here under ./governed-schema/. Those files are byte-identical copies of the
// afi-config source: the drift tests in tests/evidence/ enforce
// byte-equality against the afi-config repo whenever it is available (local /
// monorepo CI), so the vendored copy cannot silently drift from the contract.
// The AJV configuration mirrors afi-config's own harness exactly.

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "governed-schema");

function loadSchemaJson(fileName: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, fileName), "utf-8"));
}

const EVIDENCE_SCHEMA_FILE_V2 = "scored-signal-evidence.v2.schema.json";
const COMPOSITION_REF_SCHEMA_FILE = "composition-ref.schema.json";
/** The reused District-2 shapes the evidence schemas $ref (closure), preloaded
 *  so cross-file $refs resolve by $id. */
const DEP_SCHEMA_FILES = [
  "canonical-hash.schema.json",
  "evidence-ref.schema.json",
  "source-disclosure-profile.schema.json",
  "enrichment-provenance.schema.json",
  "scored-signal.schema.json",
  "provenance-record.schema.json",
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

let compiledV2: ValidateFunction | undefined;

/** Compile (once) the governed v2 evidence validator (REQUIRED composition,
 *  validated against afi.composition-ref.v1 including its CanonicalHash
 *  sub-shapes). */
export function getEvidenceValidatorV2(): ValidateFunction {
  if (compiledV2) return compiledV2;
  const ajv = newGovernedAjv();
  ajv.addSchema(loadSchemaJson(COMPOSITION_REF_SCHEMA_FILE));
  compiledV2 = ajv.compile(loadSchemaJson(EVIDENCE_SCHEMA_FILE_V2));
  return compiledV2;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: unknown[];
}

/** Validate a candidate object against the governed v2 evidence schema
 *  (composition REQUIRED; afi.composition-ref.v1 all-or-nothing). */
export function validateEvidenceSchemaV2(candidate: unknown): SchemaValidationResult {
  const validate = getEvidenceValidatorV2();
  const valid = validate(candidate) as boolean;
  return { valid, errors: valid ? [] : [...(validate.errors ?? [])] };
}

/** Directory holding the vendored governed schema files (for the drift guard). */
export const GOVERNED_SCHEMA_DIR = SCHEMA_DIR;
/** Vendored governed schema file names (evidence contract + $ref closure). */
export const GOVERNED_SCHEMA_FILES = [
  EVIDENCE_SCHEMA_FILE_V2,
  COMPOSITION_REF_SCHEMA_FILE,
  ...DEP_SCHEMA_FILES,
];

/** The governed v2 schema's `$id`, for provenance/audit surfaces. */
export const GOVERNED_EVIDENCE_SCHEMA_ID_V2 =
  "https://afi-protocol.org/schemas/scored-signal-evidence/v2/scored-signal-evidence.schema.json";
/** The governed composition-ref schema's `$id` (the evidence contract's
 *  composition $ref). */
export const GOVERNED_COMPOSITION_REF_SCHEMA_ID =
  "https://afi-protocol.org/schemas/composition-ref/v1/composition-ref.schema.json";
