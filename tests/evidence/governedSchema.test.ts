import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  validateEvidenceSchema,
  GOVERNED_EVIDENCE_SCHEMA_ID,
  GOVERNED_SCHEMA_DIR,
  GOVERNED_SCHEMA_FILES,
} from "../../src/evidence/governedSchema.js";
import { checkIdentifierContinuity } from "../../src/evidence/identifierContinuity.js";
import { FINALIZED_STATES } from "../../src/evidence/types.js";
import { validBase, finalizedBase, afiConfigAvailable, afiConfigRoot } from "./fixtures.js";
import type { ScoredSignalEvidenceRecord } from "../../src/evidence/types.js";

// The 10 persistable canonical LIFE-GOV states the local type union encodes.
const LOCAL_STATES = [
  "SCORED",
  "CERTIFIED",
  "DECERTIFIED",
  "QUALIFIED",
  "UNQUALIFIED",
  "CHALLENGE_OPEN",
  "CONTESTED",
  "FINALIZED",
  "FINAL_REJECTED",
  "EPOCH_ELIGIBLE",
];

const vendoredEvidenceSchema = JSON.parse(
  readFileSync(join(GOVERNED_SCHEMA_DIR, "scored-signal-evidence.schema.json"), "utf-8")
);

describe("governed-schema validation (vendored contract)", () => {
  it("validates against the governed schema $id", () => {
    expect(vendoredEvidenceSchema.$id).toBe(GOVERNED_EVIDENCE_SCHEMA_ID);
  });

  it("local lifecycleState set matches the governed enum", () => {
    expect(vendoredEvidenceSchema.properties.lifecycleState.enum).toEqual(LOCAL_STATES);
    FINALIZED_STATES.forEach((s) => expect(LOCAL_STATES).toContain(s));
  });

  it("accepts the vendored valid base and a derived FINALIZED record", () => {
    for (const rec of [validBase(), finalizedBase()]) {
      const { valid, errors } = validateEvidenceSchema(rec);
      if (!valid) console.error(errors);
      expect(valid).toBe(true);
      expect(checkIdentifierContinuity(rec)).toEqual([]);
    }
  });
});

// afi-config source paths for each vendored schema file.
function afiConfigSourceFor(file: string): string {
  const sub = file === "scored-signal-evidence.schema.json"
    ? "scored-signal-evidence/v1"
    : "provenance/v1";
  return join(afiConfigRoot as string, "schemas", sub, file);
}

// Enforced whenever the afi-config repo is present (local / monorepo CI). Skips
// in a standalone (single-repo) checkout where the sibling is unavailable.
describe.skipIf(!afiConfigAvailable)("drift guard vs the afi-config source", () => {
  it("every vendored governed schema file is byte-identical to afi-config", () => {
    for (const file of GOVERNED_SCHEMA_FILES) {
      const vendored = readFileSync(join(GOVERNED_SCHEMA_DIR, file), "utf-8");
      const source = readFileSync(afiConfigSourceFor(file), "utf-8");
      expect(vendored, `${file} drifted from afi-config`).toBe(source);
    }
  });

  it("the vendored minimal-scored fixture is byte-identical to afi-config", () => {
    const vendored = readFileSync(
      new URL("./vendored/minimal-scored.json", import.meta.url),
      "utf-8"
    );
    const source = readFileSync(
      join(afiConfigRoot as string, "examples/scored-signal-evidence/v1/vectors/valid/minimal-scored.json"),
      "utf-8"
    );
    expect(vendored).toBe(source);
  });

  it("classifies every governed valid vector as admissible", () => {
    const exDir = join(afiConfigRoot as string, "examples/scored-signal-evidence/v1");
    const validFiles = [
      "scored-signal-evidence.example.json",
      ...readdirSync(join(exDir, "vectors/valid")).map((f) => `vectors/valid/${f}`),
    ];
    for (const rel of validFiles) {
      const rec = JSON.parse(readFileSync(join(exDir, rel), "utf-8")) as ScoredSignalEvidenceRecord;
      expect(validateEvidenceSchema(rec).valid, rel).toBe(true);
      expect(checkIdentifierContinuity(rec), rel).toEqual([]);
    }
  });

  it("rejects every governed invalid vector (schema OR continuity)", () => {
    const invDir = join(afiConfigRoot as string, "examples/scored-signal-evidence/v1/vectors/invalid");
    for (const f of readdirSync(invDir)) {
      const rec = JSON.parse(readFileSync(join(invDir, f), "utf-8")) as ScoredSignalEvidenceRecord;
      const schemaValid = validateEvidenceSchema(rec).valid;
      const continuous = schemaValid && checkIdentifierContinuity(rec).length === 0;
      expect(schemaValid && continuous, `${f} should be inadmissible`).toBe(false);
    }
  });
});
