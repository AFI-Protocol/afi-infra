/**
 * 🧪 Smoke Tests for CLI/Entrypoints
 * 
 * Quick "does it run" checks for all primary CLI/entrypoints in afi-infra.
 * These tests verify that entrypoints can be imported and executed without throwing.
 * 
 * NO network calls, NO real DB access, NO heavy business logic.
 */

import { describe, it, expect } from 'vitest';

// NOTE: CLI Templates and Infrastructure Services tests removed after archival.
// Original files moved to _archived/ as they were unused stubs.
// - cli_templates/signal_simulator.ts → _archived/cli_templates/
// - infra/{eventsBus,infra.config,observerDaemon}.ts → _archived/infra/

describe('[smoke] TSSD Vault Client', () => {
  it('TSSDVaultClient imports and instantiates', async () => {
    const { InMemoryTSSDVaultClient } = await import('../src/tssd/TSSDVaultClient.js');
    
    expect(InMemoryTSSDVaultClient).toBeDefined();
    
    const client = new InMemoryTSSDVaultClient();
    expect(client).toBeDefined();
    expect(client.upsert).toBeDefined();
    expect(client.getBySignalId).toBeDefined();
    expect(client.query).toBeDefined();
    expect(client.listForTraining).toBeDefined();
  });

  it('TSSD types import without error', async () => {
    const module = await import('../src/tssd/types.js');
    
    expect(module).toBeDefined();
  });
});

describe('[smoke] Schemas', () => {
  it('all schema modules import without error', async () => {
    const schemaModules = [
      "../schemas/signal_enrichment_schema.ts",
      "../schemas/signal_analysis_schema.ts",
      "../schemas/signal_feedback_schema.ts",
      "../schemas/signal_finalization_schema.ts",
      "../schemas/signal_scoring_schema.ts",
      "../schemas/enrichment_common.ts",
    ];

    for (const mod of schemaModules) {
      const module = await import(mod);
      expect(module).toBeDefined();
    }
  });
});
