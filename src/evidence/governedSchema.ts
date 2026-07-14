// Governed-schema validation for the canonical scored-signal evidence record.
//
// Validates the COMPLETE evidence record against the governed JSON Schema
// `afi.scored-signal-evidence.v1` (MONGO-GOV D-MONGO-1/D-MONGO-2). afi-infra is
// a deployable service that (like CI) does not have the afi-config repo on its
// path, so the governed schema + its District-2 $ref closure are VENDORED here
// under ./governed-schema/. Those files are byte-identical copies of the
// afi-config source: `tests/evidence/governedSchemaDrift.test.ts` enforces
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

const EVIDENCE_SCHEMA_FILE = "scored-signal-evidence.schema.json";
/** The reused District-2 shapes the evidence schema $refs (closure), preloaded
 *  so cross-file $refs resolve by $id. */
const DEP_SCHEMA_FILES = [
  "canonical-hash.schema.json",
  "evidence-ref.schema.json",
  "source-disclosure-profile.schema.json",
  "enrichment-provenance.schema.json",
  "scored-signal.schema.json",
  "provenance-record.schema.json",
];

let compiled: ValidateFunction | undefined;

/** Compile (once) the governed evidence validator. */
export function getEvidenceValidator(): ValidateFunction {
  if (compiled) return compiled;

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
  compiled = ajv.compile(loadSchemaJson(EVIDENCE_SCHEMA_FILE));
  return compiled;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: unknown[];
}

/** Validate a candidate object against the governed evidence schema. */
export function validateEvidenceSchema(candidate: unknown): SchemaValidationResult {
  const validate = getEvidenceValidator();
  const valid = validate(candidate) as boolean;
  return { valid, errors: valid ? [] : [...(validate.errors ?? [])] };
}

/** Directory holding the vendored governed schema files (for the drift guard). */
export const GOVERNED_SCHEMA_DIR = SCHEMA_DIR;
/** Vendored governed schema file names (evidence contract + $ref closure). */
export const GOVERNED_SCHEMA_FILES = [EVIDENCE_SCHEMA_FILE, ...DEP_SCHEMA_FILES];

/** The governed schema's `$id`, for provenance/audit surfaces. */
export const GOVERNED_EVIDENCE_SCHEMA_ID =
  "https://afi-protocol.org/schemas/scored-signal-evidence/v1/scored-signal-evidence.schema.json";
