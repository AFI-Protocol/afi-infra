#!/usr/bin/env node
// Packaging: copy the runtime governed-schema JSON assets into the emitted
// package. The evidence store loads its vendored governed schema closure from
// ./governed-schema/*.json relative to the module (governedSchema.ts, unchanged),
// so those JSON files MUST sit next to the compiled governedSchema.js in dist.
// tsc does not emit .json, hence this copy step. No logic/schema change.

import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src/evidence/governed-schema");
const destDir = join(root, "dist/evidence/governed-schema");

if (!existsSync(srcDir)) {
  console.error(`[assets] source not found: ${srcDir}`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
cpSync(srcDir, destDir, { recursive: true });

const copied = readdirSync(destDir).filter((f) => f.endsWith(".json"));
console.log(`[assets] copied ${copied.length} governed-schema files to dist/evidence/governed-schema:`);
for (const f of copied.sort()) console.log(`  - ${f}`);
