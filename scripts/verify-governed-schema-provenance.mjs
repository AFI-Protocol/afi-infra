#!/usr/bin/env node
// CI provenance/drift proof for the vendored governed schema closure.
//
// Proves that every vendored file is BYTE-IDENTICAL to the pinned afi-config
// source commit recorded in src/evidence/governed-schema/MANIFEST.json. Intended
// to run in CI against a checkout of afi-config at MANIFEST.afiConfigCommit. It
// HARD-FAILS (exit 1) if the afi-config source is unavailable or any file
// drifts — so the byte-equality proof can never be silently skipped in CI.
//
// Runtime deployment never needs this: the store loads the vendored copy.
//
// Usage:
//   node scripts/verify-governed-schema-provenance.mjs <afi-config-dir>
//   AFI_CONFIG_REPO_DIR=<dir> node scripts/verify-governed-schema-provenance.mjs

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "src/evidence/governed-schema/MANIFEST.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

const afiConfigDir = process.argv[2] || process.env.AFI_CONFIG_REPO_DIR;
if (!afiConfigDir || !existsSync(join(afiConfigDir, "package.json"))) {
  console.error(
    `[provenance] FAIL: afi-config source not found. Pass <afi-config-dir> or set AFI_CONFIG_REPO_DIR ` +
      `to a checkout of afi-config@${manifest.afiConfigCommit}.`
  );
  process.exit(1);
}

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

let failures = 0;
console.log(`[provenance] afi-config pin: ${manifest.afiConfigCommit}`);
console.log(`[provenance] afi-config dir: ${afiConfigDir}`);

for (const [vendored, entry] of Object.entries(manifest.sources)) {
  const vendoredPath = join(repoRoot, vendored);
  const sourcePath = join(afiConfigDir, entry.afiConfigPath);
  const problems = [];

  if (!existsSync(vendoredPath)) problems.push("vendored file missing");
  if (!existsSync(sourcePath)) problems.push(`afi-config source missing (${entry.afiConfigPath})`);

  if (problems.length === 0) {
    const vh = sha256(vendoredPath);
    const sh = sha256(sourcePath);
    if (vh !== entry.sha256) problems.push(`vendored sha256 ${vh} != manifest ${entry.sha256}`);
    if (sh !== entry.sha256) problems.push(`afi-config source sha256 ${sh} != manifest ${entry.sha256}`);
  }

  if (problems.length > 0) {
    failures += 1;
    console.error(`[provenance] FAIL ${vendored}: ${problems.join("; ")}`);
  } else {
    console.log(`[provenance] ok   ${vendored}  (${entry.sha256.slice(0, 12)}…)`);
  }
}

if (failures > 0) {
  console.error(`[provenance] FAIL: ${failures} file(s) drifted from afi-config@${manifest.afiConfigCommit}.`);
  process.exit(1);
}
console.log(
  `[provenance] OK: all ${Object.keys(manifest.sources).length} vendored files are byte-identical to afi-config@${manifest.afiConfigCommit}.`
);
