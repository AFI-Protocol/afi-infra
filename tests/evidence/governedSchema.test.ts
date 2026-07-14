import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import {
  validateEvidenceSchema,
  GOVERNED_EVIDENCE_SCHEMA_ID,
} from "../../src/evidence/governedSchema.js";
import { checkIdentifierContinuity } from "../../src/evidence/identifierContinuity.js";
import { FINALIZED_STATES } from "../../src/evidence/types.js";
import {
  canonicalExample,
  validMinimalScored,
  validQualified,
  validEpochEligible,
  invalidVector,
} from "./fixtures.js";
import type { ScoredSignalEvidenceRecord } from "../../src/evidence/types.js";

const require = createRequire(import.meta.url);
const afiConfigRoot = dirname(require.resolve("afi-config/package.json"));
const governedSchema = JSON.parse(
  readFileSync(
    join(afiConfigRoot, "schemas/scored-signal-evidence/v1/scored-signal-evidence.schema.json"),
    "utf-8"
  )
);

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

describe("governed-schema validation is bound to the afi-config contract", () => {
  it("validates against the governed schema $id (no vendored copy)", () => {
    expect(governedSchema.$id).toBe(GOVERNED_EVIDENCE_SCHEMA_ID);
  });

  it("local lifecycleState set matches the governed enum (drift guard)", () => {
    expect(governedSchema.properties.lifecycleState.enum).toEqual(LOCAL_STATES);
    // FINALIZED_STATES must be a subset of the governed enum.
    FINALIZED_STATES.forEach((s) => expect(LOCAL_STATES).toContain(s));
  });

  it("accepts the canonical example and all valid vectors", () => {
    [canonicalExample(), validMinimalScored(), validQualified(), validEpochEligible()].forEach(
      (rec) => {
        const { valid, errors } = validateEvidenceSchema(rec);
        if (!valid) console.error(errors);
        expect(valid).toBe(true);
        expect(checkIdentifierContinuity(rec as ScoredSignalEvidenceRecord)).toEqual([]);
      }
    );
  });

  it("rejects schema-invalid governed vectors at the schema layer", () => {
    [
      "missing-strategy-version.json",
      "missing-provenance-record.json",
      "pre-scoring-lifecycle-state.json",
      "legacy-vocabulary-state.json",
      "finality-marker-mismatch.json",
      "heavy-carrier-substitution.json",
      "vaulted-lifecycle-brain.json",
      "volatile-timestamp.json",
    ].forEach((name) => {
      expect(validateEvidenceSchema(invalidVector(name)).valid, name).toBe(false);
    });
  });

  it("continuity-only vectors pass the schema but fail identifier continuity", () => {
    [
      "signalid-discontinuity.json",
      "provenance-signalid-discontinuity.json",
      "strategy-triple-mismatch.json",
      "canonicalization-version-mismatch.json",
    ].forEach((name) => {
      const rec = invalidVector(name) as ScoredSignalEvidenceRecord;
      expect(validateEvidenceSchema(rec).valid, `${name} schema`).toBe(true);
      expect(checkIdentifierContinuity(rec).length, `${name} continuity`).toBeGreaterThan(0);
    });
  });
});
