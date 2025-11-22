/**
 * 🧪 Smoke Tests for CLI/Entrypoints
 * 
 * Quick "does it run" checks for all primary CLI/entrypoints in afi-infra.
 * These tests verify that entrypoints can be imported and executed without throwing.
 * 
 * NO network calls, NO real DB access, NO heavy business logic.
 */

import { describe, it, expect } from 'vitest';

describe('[smoke] CLI Templates', () => {
  it('signal_simulator imports and executes without error', async () => {
    const { simulateSignal } = await import('../cli_templates/signal_simulator.js');
    
    expect(simulateSignal).toBeDefined();
    expect(typeof simulateSignal).toBe('function');
    
    // Execute and verify it doesn't throw
    expect(() => simulateSignal()).not.toThrow();
  });
});

describe('[smoke] Agent Stubs', () => {
  it('mentor_feedback_simulator imports without error', async () => {
    // This stub has side effects (console.log), so we just verify import works
    const module = await import('../agent-stubs/mentor_feedback_simulator.js');
    
    expect(module).toBeDefined();
  });

  it('variant_agent_stub imports without error', async () => {
    const module = await import('../agent-stubs/variant_agent_stub.js');
    
    expect(module).toBeDefined();
  });
});

describe('[smoke] Infrastructure Services', () => {
  it('eventsBus imports and is an EventEmitter', async () => {
    const { eventsBus } = await import('../infra/eventsBus.js');
    
    expect(eventsBus).toBeDefined();
    expect(eventsBus.on).toBeDefined();
    expect(eventsBus.emit).toBeDefined();
    
    // Verify basic pub-sub works
    let received = false;
    eventsBus.once('test-event', () => { received = true; });
    eventsBus.emit('test-event');
    
    expect(received).toBe(true);
  });

  it('infra.config imports without error', async () => {
    const module = await import('../infra/infra.config.js');
    
    expect(module).toBeDefined();
  });

  it('observerDaemon imports without error', async () => {
    const module = await import('../infra/observerDaemon.js');
    
    expect(module).toBeDefined();
  });
});

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
    const schemas = [
      '../schemas/aos_sync_loop_schema.js',
      '../schemas/dag_pipeline_config_schema.js',
      '../schemas/mentor_judgment_schema.js',
      '../schemas/signal_analysis_schema.js',
      '../schemas/signal_enrichment_schema.js',
      '../schemas/signal_feedback_schema.js',
      '../schemas/signal_finalization_schema.js',
      '../schemas/signal_scoring_schema.js',
      '../schemas/signal_transmission_schema.js',
      '../schemas/signal_variant_schema.js',
      '../schemas/validator_metadata_schema.js',
    ];

    for (const schemaPath of schemas) {
      const module = await import(schemaPath);
      expect(module).toBeDefined();
    }
  });
});

