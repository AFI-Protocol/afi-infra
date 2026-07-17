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
      "scored-signal-evidence.v2.schema.json",
      "composition-ref.schema.json",
      "canonical-hash.schema.json",
      "evidence-ref.schema.json",
      "source-disclosure-profile.schema.json",
      "enrichment-provenance.schema.json",
      "scored-signal.schema.json",
      "provenance-record.schema.json",
    ].forEach((f) =>
      expect(covered).toContain(`src/evidence/governed-schema/${f}`)
    );
  });

  it("pins the FACTORY-CONTRACT closure at the authorizing afi-config commit", () => {
    expect(manifest.afiConfigCommit).toBe("e462c4e8bef5fda946ca19a826f5c53c6d202151");
  });
});
