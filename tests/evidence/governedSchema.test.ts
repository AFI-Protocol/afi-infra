import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  validateEvidenceSchemaV3,
  GOVERNED_EVIDENCE_SCHEMA_ID_V3,
  GOVERNED_COMPOSITION_REF_SCHEMA_ID,
  GOVERNED_PROVIDER_INVOCATION_PROOF_SCHEMA_ID,
  GOVERNED_AIML_INVOCATION_PROOF_SCHEMA_ID,
  GOVERNED_SCHEMA_DIR,
  GOVERNED_SCHEMA_FILES,
} from "../../src/evidence/governedSchema.js";
import { checkIdentifierContinuity } from "../../src/evidence/identifierContinuity.js";
import {
  computeRecordHashValue,
  computeReplayHashValue,
} from "../../src/evidence/canonicalJsonHashing.js";
import { FINALIZED_STATES, PROVIDER_INVOCATION_CATEGORIES } from "../../src/evidence/types.js";
import {
  validBaseV3,
  finalizedBaseV3,
  afiConfigAvailable,
  afiConfigRoot,
} from "./fixtures.js";

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

const vendoredEvidenceSchemaV3 = JSON.parse(
  readFileSync(join(GOVERNED_SCHEMA_DIR, "scored-signal-evidence.v3.schema.json"), "utf-8")
);
const vendoredCompositionRefSchema = JSON.parse(
  readFileSync(join(GOVERNED_SCHEMA_DIR, "composition-ref.schema.json"), "utf-8")
);
const vendoredProofSchema = JSON.parse(
  readFileSync(join(GOVERNED_SCHEMA_DIR, "provider-invocation-proof.schema.json"), "utf-8")
);
const vendoredAimlProofSchema = JSON.parse(
  readFileSync(join(GOVERNED_SCHEMA_DIR, "aiml-invocation-proof.schema.json"), "utf-8")
);

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("governed-schema validation v3 (vendored EV3-CONTRACT)", () => {
  it("validates against the governed v3 + closure schema $ids", () => {
    expect(vendoredEvidenceSchemaV3.$id).toBe(GOVERNED_EVIDENCE_SCHEMA_ID_V3);
    expect(vendoredCompositionRefSchema.$id).toBe(GOVERNED_COMPOSITION_REF_SCHEMA_ID);
    expect(vendoredProofSchema.$id).toBe(GOVERNED_PROVIDER_INVOCATION_PROOF_SCHEMA_ID);
    expect(vendoredAimlProofSchema.$id).toBe(GOVERNED_AIML_INVOCATION_PROOF_SCHEMA_ID);
  });

  it("carries the v2 core forward PLUS exactly the three D-EV3-1 additions, all REQUIRED", () => {
    // The carried-forward v2 base + the three v3 additions are all present…
    [
      "schema",
      "signalId",
      "analystId",
      "strategyId",
      "strategyVersion",
      "canonicalizationVersion",
      "lifecycleState",
      "finalized",
      "scoredSignal",
      "provenanceRecord",
      "uwrProfile",
      "composition",
      "providerInvocations",
      "recordHash",
      "replayHash",
      "recordVersion",
      "supersedesRecordHash",
    ].forEach((p) =>
      expect(Object.keys(vendoredEvidenceSchemaV3.properties)).toContain(p)
    );
    // …and the three additions are REQUIRED (15 required = 12 v2 + 3).
    ["composition", "providerInvocations", "recordHash", "replayHash"].forEach((p) =>
      expect(vendoredEvidenceSchemaV3.required).toContain(p)
    );
    expect(vendoredEvidenceSchemaV3.required).toHaveLength(15);
    expect(vendoredEvidenceSchemaV3.properties.schema.const).toBe(
      "afi.scored-signal-evidence.v3"
    );
    expect(vendoredEvidenceSchemaV3.properties.composition.$ref).toBe(
      GOVERNED_COMPOSITION_REF_SCHEMA_ID
    );
  });

  it("binds the five-proof tuple positionally in the governed order (aiMl, news, pattern, sentiment, technical)", () => {
    const pi = vendoredEvidenceSchemaV3.properties.providerInvocations;
    expect(pi.minItems).toBe(5);
    expect(pi.maxItems).toBe(5);
    expect(pi.additionalItems).toBe(false);
    const positions = pi.items.map(
      (item: any) => item.allOf[1].properties.category.const
    );
    expect(positions).toEqual([...PROVIDER_INVOCATION_CATEGORIES]);
    expect(positions).toEqual(["aiMl", "news", "pattern", "sentiment", "technical"]);
  });

  it("local lifecycleState set matches the governed enum", () => {
    expect(vendoredEvidenceSchemaV3.properties.lifecycleState.enum).toEqual(LOCAL_STATES);
    FINALIZED_STATES.forEach((s) => expect(LOCAL_STATES).toContain(s));
  });

  it("accepts the vendored v3 base and a derived FINALIZED v3 record", () => {
    for (const rec of [validBaseV3(), finalizedBaseV3()]) {
      const { valid, errors } = validateEvidenceSchemaV3(rec);
      if (!valid) console.error(errors);
      expect(valid).toBe(true);
      expect(checkIdentifierContinuity(rec)).toEqual([]);
    }
  });

  it("REJECTS a v3 record without composition (fail closed, all-or-nothing)", () => {
    const { composition: _omitted, ...noComposition } = validBaseV3() as any;
    const { valid, errors } = validateEvidenceSchemaV3(noComposition);
    expect(valid).toBe(false);
    expect(errors?.some((e: any) => e.params?.missingProperty === "composition")).toBe(true);
  });

  it("REJECTS a v3 record missing any of the three D-EV3-1 additions", () => {
    for (const field of ["providerInvocations", "recordHash", "replayHash"]) {
      const rec: any = validBaseV3();
      delete rec[field];
      const { valid, errors } = validateEvidenceSchemaV3(rec);
      expect(valid, `missing ${field}`).toBe(false);
      expect(errors?.some((e: any) => e.params?.missingProperty === field)).toBe(true);
    }
  });

  it("REJECTS proof-tuple violations (count / order / duplicate / unknown category)", () => {
    const four: any = validBaseV3();
    four.providerInvocations = four.providerInvocations.slice(0, 4);
    expect(validateEvidenceSchemaV3(four).valid, "four proofs").toBe(false);

    const six: any = validBaseV3();
    six.providerInvocations = [
      ...six.providerInvocations,
      JSON.parse(JSON.stringify(six.providerInvocations[4])),
    ];
    expect(validateEvidenceSchemaV3(six).valid, "six proofs").toBe(false);

    const misOrdered: any = validBaseV3();
    misOrdered.providerInvocations = [...misOrdered.providerInvocations].reverse();
    expect(validateEvidenceSchemaV3(misOrdered).valid, "mis-ordered proofs").toBe(false);

    const duplicate: any = validBaseV3();
    duplicate.providerInvocations[1] = JSON.parse(
      JSON.stringify(duplicate.providerInvocations[2])
    );
    expect(validateEvidenceSchemaV3(duplicate).valid, "duplicate category").toBe(false);

    const unknown: any = validBaseV3();
    unknown.providerInvocations[1].category = "macro";
    expect(validateEvidenceSchemaV3(unknown).valid, "unknown category").toBe(false);
  });

  it("REJECTS aiMl-nesting violations (missing on aiMl; present elsewhere)", () => {
    const missing: any = validBaseV3();
    delete missing.providerInvocations[0].aimlInvocation;
    expect(validateEvidenceSchemaV3(missing).valid, "aiMl proof without nested proof").toBe(false);

    const misplaced: any = validBaseV3();
    misplaced.providerInvocations[4].aimlInvocation = JSON.parse(
      JSON.stringify(validBaseV3().providerInvocations[0].aimlInvocation)
    );
    expect(validateEvidenceSchemaV3(misplaced).valid, "nested proof on technical").toBe(false);
  });

  it("REJECTS priceSource on any non-technical lane (the only per-lane source field)", () => {
    // The vendored base carries it on technical (position 4) — valid.
    expect(validBaseV3().providerInvocations[4].priceSource).toBe("blofin");
    for (const pos of [0, 1, 2, 3]) {
      const rec: any = validBaseV3();
      rec.providerInvocations[pos].priceSource = "blofin";
      expect(validateEvidenceSchemaV3(rec).valid, `priceSource at position ${pos}`).toBe(false);
    }
  });

  it("REJECTS credential-binding violations (mode mix, secret-shaped extras)", () => {
    const mixed: any = validBaseV3();
    mixed.providerInvocations[1].credential = {
      mode: "keyless",
      credentialRef: "cred-news-1",
    };
    expect(validateEvidenceSchemaV3(mixed).valid, "keyless with credentialRef").toBe(false);

    const secretish: any = validBaseV3();
    secretish.providerInvocations[1].credential = {
      mode: "credentialRef",
      credentialKind: "apiKeyHeader",
      credentialRef: "cred-news-1",
      recordVersion: "1.0.0",
      status: "active",
      apiKey: "SYNTHETIC-NOT-A-REAL-KEY",
    };
    expect(validateEvidenceSchemaV3(secretish).valid, "secret-bearing credential").toBe(false);
  });

  it("REJECTS malformed record-level hash sub-shapes (domain tags + hex law)", () => {
    const cases: Array<[string, (r: any) => void]> = [
      ["non-hex recordHash value", (r) => { r.recordHash.value = "not-a-hash"; }],
      ["truncated replayHash value", (r) => { r.replayHash.value = "abc123"; }],
      ["wrong recordHash domainTag", (r) => { r.recordHash.domainTag = "afi.d2.evidence-replay"; }],
      ["wrong replayHash domainTag", (r) => { r.replayHash.domainTag = "afi.d2.evidence-record"; }],
      ["missing recordHash algorithm", (r) => { delete r.recordHash.algorithm; }],
      ["bad canonicalizationVersion", (r) => { r.replayHash.canonicalizationVersion = "v1"; }],
    ];
    for (const [label, mutate] of cases) {
      const rec: any = validBaseV3();
      mutate(rec);
      expect(validateEvidenceSchemaV3(rec).valid, label).toBe(false);
    }
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
      const rec: any = validBaseV3();
      mutate(rec);
      expect(validateEvidenceSchemaV3(rec).valid, label).toBe(false);
    }
  });

  it("REJECTS records carrying a prior schema const (v3 is the ONLY contract — no dual mode)", () => {
    // A v2-shaped record: the v3 base minus the three additions, carrying the v2 const.
    const v2Shaped: any = validBaseV3();
    v2Shaped.schema = "afi.scored-signal-evidence.v2";
    delete v2Shaped.providerInvocations;
    delete v2Shaped.recordHash;
    delete v2Shaped.replayHash;
    expect(validateEvidenceSchemaV3(v2Shaped).valid).toBe(false);
    // Even WITH the v3 additions, a prior const alone is inadmissible.
    for (const bogus of ["afi.scored-signal-evidence.v2", "afi.scored-signal-evidence.v1"]) {
      const rec: any = validBaseV3();
      rec.schema = bogus;
      expect(validateEvidenceSchemaV3(rec).valid, bogus).toBe(false);
    }
  });

  it("returns BOUNDED error facts only — never the candidate record contents", () => {
    const marker = "AFI-SYNTHETIC-SECRET-MARKER-9c4e";
    const rec: any = validBaseV3();
    rec.uwrProfile.status = marker; // valid-typed field carrying the marker
    rec.extraneousTopLevel = true; // root-level additionalProperties violation
    const { valid, errors } = validateEvidenceSchemaV3(rec);
    expect(valid).toBe(false);
    expect(JSON.stringify(errors)).not.toContain(marker);
  });
});

describe("scoring-profile stamp (PR-UWR-STAMP / RC-6)", () => {
  it("local UwrProfileStampSource union matches the governed source enum", () => {
    // Drift guard: the schema is authoritative for the ONLY fixed vocabulary.
    expect(vendoredEvidenceSchemaV3.properties.uwrProfile.properties.source.enum).toEqual(
      LOCAL_STAMP_SOURCES
    );
  });

  it("REQUIRES the stamp on every canonical evidence record", () => {
    expect(vendoredEvidenceSchemaV3.required).toContain("uwrProfile");
    const { uwrProfile: _omitted, ...unstamped } = validBaseV3() as any;
    const { valid, errors } = validateEvidenceSchemaV3(unstamped);
    expect(valid).toBe(false);
    expect(errors?.some((e: any) => e.params?.missingProperty === "uwrProfile")).toBe(true);
  });

  it("accepts BOTH governed sources and rejects an ungoverned one", () => {
    for (const source of LOCAL_STAMP_SOURCES) {
      const rec: any = validBaseV3();
      rec.uwrProfile.source = source;
      expect(validateEvidenceSchemaV3(rec).valid, source).toBe(true);
    }
    for (const bad of ["registry", "builtin", "unknown", ""]) {
      const rec: any = validBaseV3();
      rec.uwrProfile.source = bad;
      expect(validateEvidenceSchemaV3(rec).valid, `source '${bad}'`).toBe(false);
    }
  });

  it("rejects a stamp with missing source or malformed profile metadata", () => {
    const noSource: any = validBaseV3();
    delete noSource.uwrProfile.source;
    expect(validateEvidenceSchemaV3(noSource).valid).toBe(false);
    for (const field of ["profileId", "status", "decisionRef"]) {
      const rec: any = validBaseV3();
      rec.uwrProfile[field] = "";
      expect(validateEvidenceSchemaV3(rec).valid, `empty ${field}`).toBe(false);
    }
  });

  it("is analyst-/strategy-/profile-NEUTRAL: admits another analyst's conforming profile", () => {
    const rec: any = validBaseV3();
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
    const { valid, errors } = validateEvidenceSchemaV3(rec);
    if (!valid) console.error(errors);
    expect(valid).toBe(true);
    expect(checkIdentifierContinuity(rec)).toEqual([]);
  });
});

// afi-config source paths for each vendored schema file (the v3 evidence
// contract, the two invocation-proof contracts, composition-ref, and the
// shared provenance deps).
const AFI_CONFIG_SOURCE_REL: Record<string, string> = {
  "scored-signal-evidence.v3.schema.json":
    "scored-signal-evidence/v3/scored-signal-evidence.schema.json",
  "provider-invocation-proof.schema.json":
    "provider-invocation-proof/v1/provider-invocation-proof.schema.json",
  "aiml-invocation-proof.schema.json":
    "aiml-invocation-proof/v1/aiml-invocation-proof.schema.json",
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

  it("the vendored v3 fixtures (vector + KAT suites) are byte-identical to afi-config", () => {
    const pairs: Array<[string, string]> = [
      ["./vendored/minimal-scored.v3.json", "examples/scored-signal-evidence/v3/vectors/valid/minimal-scored.json"],
      ["./vendored/canonical-json-hashing.kat.json", "kats/hashing/v1/canonical-json-hashing.kat.json"],
      ["./vendored/evidence-v3-hashes.kat.json", "kats/evidence/v3/evidence-v3-hashes.kat.json"],
    ];
    for (const [vendoredRel, sourceRel] of pairs) {
      const vendored = readFileSync(new URL(vendoredRel, import.meta.url), "utf-8");
      const source = readFileSync(join(afiConfigRoot as string, sourceRel), "utf-8");
      expect(vendored, `${vendoredRel} drifted from afi-config`).toBe(source);
    }
  });

  it("the afi-config source carries NO scored-signal-evidence v1/v2 directory (D-EV3-8)", () => {
    const versions = readdirSync(join(afiConfigRoot as string, "schemas/scored-signal-evidence"));
    expect(versions).toEqual(["v3"]);
  });

  it("classifies every governed v3 valid vector as admissible (schema + continuity + hash recomputation)", () => {
    const exDir = join(afiConfigRoot as string, "examples/scored-signal-evidence/v3");
    const validFiles = [
      "scored-signal-evidence.example.json",
      ...readdirSync(join(exDir, "vectors/valid")).map((f) => `vectors/valid/${f}`),
    ];
    for (const rel of validFiles) {
      const rec = JSON.parse(readFileSync(join(exDir, rel), "utf-8"));
      expect(validateEvidenceSchemaV3(rec).valid, rel).toBe(true);
      expect(checkIdentifierContinuity(rec), rel).toEqual([]);
      expect(computeRecordHashValue(rec), `${rel} recordHash`).toBe(rec.recordHash.value);
      expect(computeReplayHashValue(rec), `${rel} replayHash`).toBe(rec.replayHash.value);
    }
  });

  it("rejects every governed v3 invalid vector (schema OR continuity OR hash mismatch)", () => {
    const invDir = join(afiConfigRoot as string, "examples/scored-signal-evidence/v3/vectors/invalid");
    const files = readdirSync(invDir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(invDir, f), "utf-8"));
      const schemaValid = validateEvidenceSchemaV3(rec).valid;
      const continuous = schemaValid && checkIdentifierContinuity(rec).length === 0;
      const hashesVerify =
        continuous &&
        computeRecordHashValue(rec) === rec.recordHash?.value &&
        computeReplayHashValue(rec) === rec.replayHash?.value;
      expect(schemaValid && continuous && hashesVerify, `${f} should be inadmissible`).toBe(false);
    }
  });
});
