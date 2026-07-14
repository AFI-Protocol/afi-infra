// Governed-schema validation for the canonical scored-signal evidence record.
//
// Validates the COMPLETE evidence record against the governed afi-config JSON
// Schema `afi.scored-signal-evidence.v1` (MONGO-GOV D-MONGO-1/D-MONGO-2). The
// schema is loaded from the afi-config package itself (not a vendored copy), so
// the store validates against THE governed contract with no drift surface. The
// AJV configuration mirrors afi-config's own test harness exactly.

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

/** Resolve the afi-config `schemas/` directory (file: dependency symlink). */
function resolveAfiConfigSchemaDir(): string {
  const root = dirname(require.resolve("afi-config/package.json"));
  return join(root, "schemas");
}

function loadSchemaJson(schemaDir: string, relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(schemaDir, relPath), "utf-8"));
}

/** The evidence contract and the governed District-2 shapes it $refs (closure). */
const EVIDENCE_SCHEMA_REL =
  "scored-signal-evidence/v1/scored-signal-evidence.schema.json";
const DEP_SCHEMA_RELS = [
  "provenance/v1/canonical-hash.schema.json",
  "provenance/v1/evidence-ref.schema.json",
  "provenance/v1/source-disclosure-profile.schema.json",
  "provenance/v1/enrichment-provenance.schema.json",
  "provenance/v1/scored-signal.schema.json",
  "provenance/v1/provenance-record.schema.json",
];

let compiled: ValidateFunction | undefined;

/** Compile (once) the governed evidence validator, preloading the reused
 *  District-2 shapes so cross-file $refs resolve by $id. */
export function getEvidenceValidator(): ValidateFunction {
  if (compiled) return compiled;

  const schemaDir = resolveAfiConfigSchemaDir();
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

  for (const rel of DEP_SCHEMA_RELS) {
    ajv.addSchema(loadSchemaJson(schemaDir, rel));
  }
  compiled = ajv.compile(loadSchemaJson(schemaDir, EVIDENCE_SCHEMA_REL));
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

/** The governed schema's `$id`, for provenance/audit surfaces. */
export const GOVERNED_EVIDENCE_SCHEMA_ID =
  "https://afi-protocol.org/schemas/scored-signal-evidence/v1/scored-signal-evidence.schema.json";
