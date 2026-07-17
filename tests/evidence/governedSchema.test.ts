import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  validateEvidenceSchema,
  validateEvidenceSchemaV2,
  GOVERNED_EVIDENCE_SCHEMA_ID,
  GOVERNED_EVIDENCE_SCHEMA_ID_V2,
  GOVERNED_COMPOSITION_REF_SCHEMA_ID,
  GOVERNED_SCHEMA_DIR,
  GOVERNED_SCHEMA_FILES,
} from "../../src/evidence/governedSchema.js";
import { checkIdentifierContinuity } from "../../src/evidence/identifierContinuity.js";
import { FINALIZED_STATES } from "../../src/evidence/types.js";
import {
  validBase,
  finalizedBase,
  validBaseV2,
  finalizedBaseV2,
  afiConfigAvailable,
  afiConfigRoot,
} from "./fixtures.js";
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

// The RC-6 source discriminators the local UwrProfileStampSource union encodes —
// the ONLY fixed vocabulary on the (otherwise analyst-neutral) profile stamp.
const LOCAL_STAMP_SOURCES = ["builtin-value-identity", "registry-consumed"];

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

const vendoredEvidenceSchemaV2 = JSON.parse(
  readFileSync(join(GOVERNED_SCHEMA_DIR, "scored-signal-evidence.v2.schema.json"), "utf-8")
);
const vendoredCompositionRefSchema = JSON.parse(
  readFileSync(join(GOVERNED_SCHEMA_DIR, "composition-ref.schema.json"), "utf-8")
);

describe("governed-schema validation v2 (vendored FACTORY-CONTRACT)", () => {
  it("validates against the governed v2 + composition-ref schema $ids", () => {
    expect(vendoredEvidenceSchemaV2.$id).toBe(GOVERNED_EVIDENCE_SCHEMA_ID_V2);
    expect(vendoredCompositionRefSchema.$id).toBe(GOVERNED_COMPOSITION_REF_SCHEMA_ID);
  });

  it("v2 = v1 + REQUIRED composition ($ref afi.composition-ref.v1)", () => {
    expect(vendoredEvidenceSchemaV2.required).toContain("composition");
    expect(vendoredEvidenceSchemaV2.properties.composition.$ref).toBe(
      GOVERNED_COMPOSITION_REF_SCHEMA_ID
    );
    // the thirteen v1 properties are all still present
    Object.keys(vendoredEvidenceSchema.properties).forEach((p) =>
      expect(Object.keys(vendoredEvidenceSchemaV2.properties)).toContain(p)
    );
    expect(vendoredEvidenceSchemaV2.properties.lifecycleState.enum).toEqual(LOCAL_STATES);
  });

  it("accepts the vendored v2 base and a derived FINALIZED v2 record", () => {
    for (const rec of [validBaseV2(), finalizedBaseV2()]) {
      const { valid, errors } = validateEvidenceSchemaV2(rec);
      if (!valid) console.error(errors);
      expect(valid).toBe(true);
      expect(checkIdentifierContinuity(rec)).toEqual([]);
    }
  });

  it("REJECTS a v2 record without composition (fail closed, all-or-nothing)", () => {
    const { composition: _omitted, ...noComposition } = validBaseV2() as any;
    const { valid, errors } = validateEvidenceSchemaV2(noComposition);
    expect(valid).toBe(false);
    expect(errors?.some((e: any) => e.params?.missingProperty === "composition")).toBe(true);
  });

  it("REJECTS partial composition provenance (missing hash pin)", () => {
    const rec: any = validBaseV2();
    delete rec.composition.executionSummaryHash;
    expect(validateEvidenceSchemaV2(rec).valid).toBe(false);
  });

  it("REJECTS malformed canonical-hash sub-shapes inside composition", () => {
    const cases: Array<[string, (r: any) => void]> = [
      ["non-hex hash value", (r) => { r.composition.manifestHash.value = "not-a-hash"; }],
      ["truncated hash value", (r) => { r.composition.pluginSetHash.value = "abc123"; }],
      ["bad domainTag pattern", (r) => { r.composition.enrichmentHash.domainTag = "Enrichment Bundle!"; }],
      ["missing algorithm", (r) => { delete r.composition.analystConfigHash.algorithm; }],
      ["bad canonicalizationVersion", (r) => { r.composition.executionSummaryHash.canonicalizationVersion = "v1"; }],
    ];
    for (const [label, mutate] of cases) {
      const rec: any = validBaseV2();
      mutate(rec);
      expect(validateEvidenceSchemaV2(rec).valid, label).toBe(false);
    }
  });

  it("REJECTS a v1 schema const under the v2 validator and vice versa", () => {
    const v1AsV2: any = validBase();
    expect(validateEvidenceSchemaV2(v1AsV2).valid).toBe(false);
    const v2AsV1: any = validBaseV2();
    expect(validateEvidenceSchema(v2AsV1).valid).toBe(false);
  });
});

describe("scoring-profile stamp (PR-UWR-STAMP / RC-6)", () => {
  it("local UwrProfileStampSource union matches the governed source enum", () => {
    // Drift guard: the schema is authoritative for the ONLY fixed vocabulary.
    expect(vendoredEvidenceSchema.properties.uwrProfile.properties.source.enum).toEqual(
      LOCAL_STAMP_SOURCES
    );
  });

  it("REQUIRES the stamp on every canonical evidence record", () => {
    expect(vendoredEvidenceSchema.required).toContain("uwrProfile");
    const { uwrProfile: _omitted, ...unstamped } = validBase() as any;
    const { valid, errors } = validateEvidenceSchema(unstamped);
    expect(valid).toBe(false);
    expect(errors?.some((e: any) => e.params?.missingProperty === "uwrProfile")).toBe(true);
  });

  it("accepts BOTH governed sources and rejects an ungoverned one", () => {
    for (const source of LOCAL_STAMP_SOURCES) {
      const rec: any = validBase();
      rec.uwrProfile.source = source;
      expect(validateEvidenceSchema(rec).valid, source).toBe(true);
    }
    for (const bad of ["registry", "builtin", "unknown", ""]) {
      const rec: any = validBase();
      rec.uwrProfile.source = bad;
      expect(validateEvidenceSchema(rec).valid, `source '${bad}'`).toBe(false);
    }
  });

  it("rejects a stamp with missing source or malformed profile metadata", () => {
    const noSource: any = validBase();
    delete noSource.uwrProfile.source;
    expect(validateEvidenceSchema(noSource).valid).toBe(false);
    for (const field of ["profileId", "status", "decisionRef"]) {
      const rec: any = validBase();
      rec.uwrProfile[field] = "";
      expect(validateEvidenceSchema(rec).valid, `empty ${field}`).toBe(false);
    }
  });

  it("is analyst-/strategy-/profile-NEUTRAL: admits another analyst's conforming profile", () => {
    const rec: any = validBase();
    rec.analystId = "kestrel";
    rec.strategyId = "mean_reversion_v2";
    rec.scoredSignal.analystId = "kestrel";
    rec.scoredSignal.strategyId = "mean_reversion_v2";
    rec.uwrProfile = {
      profileId: "kestrel-adaptive-lifts-v2.0",
      status: "analyst-declared",
      decisionRef: "analysts/kestrel/profiles/adaptive-lifts-v2.0.md",
      source: "registry-consumed",
    };
    const { valid, errors } = validateEvidenceSchema(rec);
    if (!valid) console.error(errors);
    expect(valid).toBe(true);
    expect(checkIdentifierContinuity(rec)).toEqual([]);
  });
});

// afi-config source paths for each vendored schema file (the ENLARGED closure:
// v1 + v2 evidence contracts, composition-ref, and the shared provenance deps).
const AFI_CONFIG_SOURCE_REL: Record<string, string> = {
  "scored-signal-evidence.schema.json":
    "scored-signal-evidence/v1/scored-signal-evidence.schema.json",
  "scored-signal-evidence.v2.schema.json":
    "scored-signal-evidence/v2/scored-signal-evidence.schema.json",
  "composition-ref.schema.json": "composition-ref/v1/composition-ref.schema.json",
};
function afiConfigSourceFor(file: string): string {
  const rel = AFI_CONFIG_SOURCE_REL[file] ?? `provenance/v1/${file}`;
  return join(afiConfigRoot as string, "schemas", rel);
}

// In CI, AFI_REQUIRE_AFI_CONFIG=1 turns a missing afi-config source into a HARD
// FAILURE, so the drift/conformance checks can never be silently skipped there.
if (process.env.AFI_REQUIRE_AFI_CONFIG === "1" && !afiConfigAvailable) {
  describe("governed-schema drift (REQUIRED by CI)", () => {
    it("must have the afi-config source available (AFI_CONFIG_REPO_DIR)", () => {
      throw new Error(
        "AFI_REQUIRE_AFI_CONFIG=1 but the afi-config source is unavailable — CI must check out afi-config at the pinned commit."
      );
    });
  });
}

// Enforced whenever the afi-config repo is present (local / monorepo / CI with a
// pinned checkout). Skips only in a standalone checkout without the source.
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

  it("the vendored v2 minimal-scored fixture is byte-identical to afi-config", () => {
    const vendored = readFileSync(
      new URL("./vendored/minimal-scored.v2.json", import.meta.url),
      "utf-8"
    );
    const source = readFileSync(
      join(afiConfigRoot as string, "examples/scored-signal-evidence/v2/vectors/valid/minimal-scored.json"),
      "utf-8"
    );
    expect(vendored).toBe(source);
  });

  it("classifies every governed v2 valid vector as admissible (v2 validator)", () => {
    const exDir = join(afiConfigRoot as string, "examples/scored-signal-evidence/v2");
    const validFiles = [
      "scored-signal-evidence.example.json",
      ...readdirSync(join(exDir, "vectors/valid")).map((f) => `vectors/valid/${f}`),
    ];
    for (const rel of validFiles) {
      const rec = JSON.parse(readFileSync(join(exDir, rel), "utf-8"));
      expect(validateEvidenceSchemaV2(rec).valid, rel).toBe(true);
      expect(checkIdentifierContinuity(rec), rel).toEqual([]);
    }
  });

  it("rejects every governed v2 invalid vector (schema OR continuity, v2 validator)", () => {
    const invDir = join(afiConfigRoot as string, "examples/scored-signal-evidence/v2/vectors/invalid");
    for (const f of readdirSync(invDir)) {
      const rec = JSON.parse(readFileSync(join(invDir, f), "utf-8"));
      const schemaValid = validateEvidenceSchemaV2(rec).valid;
      const continuous = schemaValid && checkIdentifierContinuity(rec).length === 0;
      expect(schemaValid && continuous, `${f} should be inadmissible`).toBe(false);
    }
  });
});
