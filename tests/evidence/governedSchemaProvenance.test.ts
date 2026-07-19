import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// ALWAYS-ON provenance/integrity guard (no afi-config checkout required). Proves
// the vendored governed schema closure has not been tampered with since it was
// vendored from the pinned afi-config commit. The complementary byte-equality-
// against-the-pinned-source proof runs in CI via
// scripts/verify-governed-schema-provenance.mjs.

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(repoRoot, "src/evidence/governed-schema/MANIFEST.json"), "utf-8")
) as {
  afiConfigCommit: string;
  governedSchemaIdV3: string;
  sources: Record<string, { afiConfigPath: string; sha256: string }>;
};

function sha256(relPath: string): string {
  return createHash("sha256").update(readFileSync(join(repoRoot, relPath))).digest("hex");
}

describe("vendored governed schema provenance (MANIFEST integrity)", () => {
  it("pins a concrete afi-config commit", () => {
    expect(manifest.afiConfigCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("every vendored file matches its recorded sha256", () => {
    for (const [vendored, entry] of Object.entries(manifest.sources)) {
      expect(sha256(vendored), `${vendored} drifted from its recorded hash`).toBe(entry.sha256);
    }
  });

  it("covers the full runtime schema closure the store loads", () => {
    const covered = Object.keys(manifest.sources);
    [
      "scored-signal-evidence.v3.schema.json",
      "provider-invocation-proof.schema.json",
      "aiml-invocation-proof.schema.json",
      "composition-ref.schema.json",
      "canonical-hash.schema.json",
      "evidence-ref.schema.json",
      "source-disclosure-profile.schema.json",
      "scored-signal.schema.json",
      "provenance-record.schema.json",
    ].forEach((f) =>
      expect(covered).toContain(`src/evidence/governed-schema/${f}`)
    );
  });

  it("covers the governed KAT vectors + valid vector the test suite executes", () => {
    const covered = Object.keys(manifest.sources);
    [
      "tests/evidence/vendored/minimal-scored.v3.json",
      "tests/evidence/vendored/canonical-json-hashing.kat.json",
      "tests/evidence/vendored/evidence-v3-hashes.kat.json",
    ].forEach((f) => expect(covered).toContain(f));
  });

  it("carries NO V2 evidence surface (EV3-GOV D-EV3-8 forward-only deletion)", () => {
    const covered = Object.keys(manifest.sources).join("\n");
    expect(covered).not.toMatch(/scored-signal-evidence\.v2/);
    expect(covered).not.toMatch(/enrichment-provenance/);
    expect(manifest).not.toHaveProperty("governedSchemaIdV2");
  });

  it("pins the EV3-CONTRACT closure at the authorizing afi-config commit", () => {
    expect(manifest.afiConfigCommit).toBe("d6f2504805059ffa09d8c1bfcecb67cd47abcea2");
    expect(manifest.governedSchemaIdV3).toBe(
      "https://afi-protocol.org/schemas/scored-signal-evidence/v3/scored-signal-evidence.schema.json"
    );
  });
});
