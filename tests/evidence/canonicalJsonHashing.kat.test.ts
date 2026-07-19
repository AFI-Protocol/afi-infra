import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CANONICALIZATION_VERSION,
  RECORD_HASH_DOMAIN_TAG,
  REPLAY_HASH_DOMAIN_TAG,
  RECORD_HASH_EXCLUDED_FIELDS,
  REPLAY_HASH_EXCLUDED_FIELDS,
  canonicalize,
  canonicalSha256,
  computeRecordHashValue,
  computeReplayHashValue,
  sha256Hex,
  stripExcluded,
} from "../../src/evidence/canonicalJsonHashing.js";
import { validBaseV3, finalizedBaseV3, deepClone } from "./fixtures.js";

// Known-answer proof of the self-contained canonical-json-hashing.v1
// implementation against BOTH governed afi-config KAT suites (EV3-GOV
// D-EV3-4(8)): the composition-law serialization vectors (kats/hashing/v1)
// AND the Evidence-V3 projection vectors (kats/evidence/v3). The KAT files
// are vendored byte-identically (MANIFEST-pinned, provenance-guarded).

type HashingVector = {
  name: string;
  input: unknown;
  excludedFields?: string[];
  expectedCanonicalForm: string;
  expectedSha256: string;
};

type EvidenceVector = {
  name: string;
  domainTag?: string;
  excludedFields?: string[];
  input: Record<string, unknown>;
  expectedSha256?: string;
  category?: string;
  categoryResultDomainTag?: string;
  expectedCategoryResultSha256?: string;
  providerResultDomainTag?: string;
  providerResultExcludedFields?: string[];
  expectedProviderResultSha256?: string;
};

const hashingKat = JSON.parse(
  readFileSync(new URL("./vendored/canonical-json-hashing.kat.json", import.meta.url), "utf-8")
) as { schema: string; canonicalizationVersion: string; vectors: HashingVector[] };

const evidenceKat = JSON.parse(
  readFileSync(new URL("./vendored/evidence-v3-hashes.kat.json", import.meta.url), "utf-8")
) as { schema: string; canonicalizationVersion: string; vectors: EvidenceVector[] };

describe("canonical-json-hashing.v1 — governed hashing KATs (kats/hashing/v1)", () => {
  it("carries the full governed suite (6 vectors, afi.hash.v1)", () => {
    expect(hashingKat.schema).toBe("afi.canonical-json-hashing-kat.v1");
    expect(hashingKat.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    expect(hashingKat.vectors).toHaveLength(6);
  });

  for (const vector of hashingKat.vectors) {
    it(`reproduces '${vector.name}' byte-exactly (canonical form + digest)`, () => {
      const material = vector.excludedFields
        ? stripExcluded(vector.input as object, vector.excludedFields)
        : vector.input;
      const canonical = canonicalize(material);
      expect(canonical).toBe(vector.expectedCanonicalForm);
      expect(sha256Hex(canonical)).toBe(vector.expectedSha256);
      expect(canonicalSha256(vector.input, vector.excludedFields ?? [])).toBe(
        vector.expectedSha256
      );
    });
  }
});

describe("Evidence V3 hash projections — governed KATs (kats/evidence/v3)", () => {
  it("carries the full governed suite (7 vectors, afi.hash.v1)", () => {
    expect(evidenceKat.schema).toBe("afi.evidence-v3-hash-kat.v1");
    expect(evidenceKat.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    expect(evidenceKat.vectors).toHaveLength(7);
    expect(evidenceKat.vectors.map((v) => v.name)).toEqual([
      "record-hash-full-record",
      "replay-hash-projection",
      "category-result-aiMl",
      "category-result-news",
      "category-result-pattern",
      "category-result-sentiment",
      "category-result-technical",
    ]);
  });

  it("reproduces the recordHash vector (afi.d2.evidence-record, top-level exclusions)", () => {
    const v = evidenceKat.vectors.find((x) => x.name === "record-hash-full-record")!;
    expect(v.domainTag).toBe(RECORD_HASH_DOMAIN_TAG);
    expect(v.excludedFields).toEqual([...RECORD_HASH_EXCLUDED_FIELDS]);
    expect(canonicalSha256(v.input, v.excludedFields!)).toBe(v.expectedSha256);
    // The exact function the store's admission uses:
    expect(computeRecordHashValue(v.input as never)).toBe(v.expectedSha256);
  });

  it("reproduces the replayHash vector (afi.d2.evidence-replay, replay projection)", () => {
    const v = evidenceKat.vectors.find((x) => x.name === "replay-hash-projection")!;
    expect(v.domainTag).toBe(REPLAY_HASH_DOMAIN_TAG);
    expect(v.excludedFields).toEqual([...REPLAY_HASH_EXCLUDED_FIELDS]);
    expect(canonicalSha256(v.input, v.excludedFields!)).toBe(v.expectedSha256);
    expect(computeReplayHashValue(v.input as never)).toBe(v.expectedSha256);
  });

  for (const lane of ["aiMl", "news", "pattern", "sentiment", "technical"]) {
    it(`reproduces the ${lane} lane vectors (categoryResultHash + providerResultHash)`, () => {
      const v = evidenceKat.vectors.find((x) => x.name === `category-result-${lane}`)!;
      expect(v.categoryResultDomainTag).toBe("afi.d2.lane-output");
      expect(v.providerResultDomainTag).toBe("afi.d2.provider-result");
      // categoryResultHash: the FULL category result consumed by the join.
      expect(canonicalSha256(v.input)).toBe(v.expectedCategoryResultSha256);
      // providerResultHash: the category result MINUS its category property.
      expect(v.providerResultExcludedFields).toEqual(["category"]);
      expect(canonicalSha256(v.input, v.providerResultExcludedFields!)).toBe(
        v.expectedProviderResultSha256
      );
    });
  }
});

describe("vendored v3 valid vector — record-hash chain anchor", () => {
  it("the vendored minimal-scored.v3 recordHash/replayHash recompute byte-exactly", () => {
    const rec = validBaseV3();
    expect(rec.recordHash.domainTag).toBe(RECORD_HASH_DOMAIN_TAG);
    expect(rec.replayHash.domainTag).toBe(REPLAY_HASH_DOMAIN_TAG);
    expect(computeRecordHashValue(rec)).toBe(rec.recordHash.value);
    expect(computeReplayHashValue(rec)).toBe(rec.replayHash.value);
  });

  it("lifecycle progression moves recordHash but NEVER replayHash (D-EV3-4(7))", () => {
    const base = validBaseV3();
    const finalized = finalizedBaseV3();
    expect(finalized.recordHash.value).not.toBe(base.recordHash.value);
    expect(finalized.replayHash.value).toBe(base.replayHash.value);
    // And the finalized variant still self-verifies.
    expect(computeRecordHashValue(finalized)).toBe(finalized.recordHash.value);
    expect(computeReplayHashValue(finalized)).toBe(finalized.replayHash.value);
  });

  it("recordVersion/supersedesRecordHash custody moves recordHash but NEVER replayHash", () => {
    const base = validBaseV3();
    const v2 = deepClone(base);
    v2.recordVersion = 2;
    v2.supersedesRecordHash = deepClone(base.recordHash);
    expect(computeReplayHashValue(v2)).toBe(base.replayHash.value);
    expect(computeRecordHashValue(v2)).not.toBe(base.recordHash.value);
  });

  it("every load-bearing content field moves BOTH hashes (mutation sensitivity)", () => {
    const base = validBaseV3();
    const mutations: Array<[string, (r: ReturnType<typeof validBaseV3>) => void]> = [
      ["scoredSignal.uwrScore", (r) => { r.scoredSignal.uwrScore = 0.99; }],
      ["composition.enrichmentHash.value", (r) => { r.composition.enrichmentHash.value = r.composition.enrichmentHash.value.replace(/^./, r.composition.enrichmentHash.value.startsWith("0") ? "1" : "0"); }],
      ["providerInvocations[0].categoryResultHash.value", (r) => { r.providerInvocations[0].categoryResultHash.value = r.providerInvocations[0].categoryResultHash.value.replace(/^./, r.providerInvocations[0].categoryResultHash.value.startsWith("0") ? "1" : "0"); }],
      ["providerInvocations[0].aimlInvocation.outputHash", (r) => { r.providerInvocations[0].aimlInvocation!.outputHash = "0".repeat(64); }],
      ["provenanceRecord.inputHash.value", (r) => { r.provenanceRecord.inputHash.value = "f".repeat(64); }],
    ];
    for (const [label, mutate] of mutations) {
      const m = deepClone(base);
      mutate(m);
      expect(computeRecordHashValue(m), `${label} must move recordHash`).not.toBe(
        base.recordHash.value
      );
      expect(computeReplayHashValue(m), `${label} must move replayHash`).not.toBe(
        base.replayHash.value
      );
    }
  });

  it("is deterministic and key-order-insensitive over the record", () => {
    const rec = validBaseV3();
    const reordered = Object.fromEntries(Object.entries(rec).reverse()) as never;
    expect(computeRecordHashValue(reordered)).toBe(rec.recordHash.value);
    expect(computeReplayHashValue(reordered)).toBe(rec.replayHash.value);
  });
});
