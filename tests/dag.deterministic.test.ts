/**
 * 🧪 Deterministic DAG Mock Test
 * 
 * Verifies a stable, repeatable flow end-to-end at the infra boundary.
 * 
 * This test simulates a minimal 3-node DAG:
 * 1. Ingest → 2. Enrich → 3. Score
 * 
 * MUST prove:
 * - Identical input → identical output across runs
 * - No nondeterminism from timestamps or ordering
 * - Pure functions only, no network/DB calls
 * 
 * NOTE: This is a LOCAL mock. Does NOT import from afi-core or afi-reactor.
 * Real DAG orchestration lives in afi-reactor (see AFI_ORCHESTRATOR_DOCTRINE.md).
 */

import { describe, it, expect } from 'vitest';
import { InMemoryTSSDVaultClient } from '../src/tssd/TSSDVaultClient.js';
import type { VaultedSignalRecord } from '../src/tssd/types.js';

/**
 * Mock DAG Node: Pure function that transforms a signal record.
 */
type DAGNode = (record: VaultedSignalRecord) => VaultedSignalRecord;

/**
 * Mock DAG Pipeline: Chains nodes in sequence.
 */
class MockDAGPipeline {
  private nodes: DAGNode[] = [];

  addNode(node: DAGNode): this {
    this.nodes.push(node);
    return this;
  }

  async execute(input: VaultedSignalRecord): Promise<VaultedSignalRecord> {
    let current = input;
    for (const node of this.nodes) {
      current = node(current);
    }
    return current;
  }
}

/**
 * Node 1: Ingest (RAW stage)
 * Adds raw signal snapshot (deterministic for testing).
 */
const ingestNode: DAGNode = (record) => ({
  ...record,
  stages: {
    ...record.stages,
    raw: {
      receivedAt: '2025-01-01T00:00:00.000Z', // Fixed timestamp for determinism
      source: 'test-source',
      triggerSummary: 'Test signal ingestion',
    },
  },
});

/**
 * Node 2: Enrich (ENRICHED stage)
 * Adds enrichment data based on signal content.
 */
const enrichNode: DAGNode = (record) => {
  const content = record.publicSurface.summaryInsight || '';
  const tags = content.toLowerCase().includes('btc') ? ['crypto', 'bitcoin'] : ['general'];

  return {
    ...record,
    stages: {
      ...record.stages,
      enriched: {
        enrichedAt: '2025-01-01T00:00:01.000Z', // Fixed timestamp
        sentimentTags: tags,
      },
    },
    publicSurface: {
      ...record.publicSurface,
      tags,
    },
  };
};

/**
 * Node 3: Score (SCORED stage)
 * Assigns a deterministic score based on tags.
 */
const scoreNode: DAGNode = (record) => {
  const tags = record.publicSurface.tags || [];
  const baseScore = tags.includes('crypto') ? 85 : 50;

  return {
    ...record,
    stages: {
      ...record.stages,
      scored: {
        scoredAt: '2025-01-01T00:00:02.000Z', // Fixed timestamp
        baseScore,
        confidence: 0.8,
      },
    },
  };
};

describe('[DAG] Deterministic Pipeline', () => {
  it('produces identical output for identical input across multiple runs', async () => {
    const pipeline = new MockDAGPipeline()
      .addNode(ingestNode)
      .addNode(enrichNode)
      .addNode(scoreNode);

    const input: VaultedSignalRecord = {
      identity: {
        signalId: 'test-signal-001',
        analystId: 'analyst-123',
        strategyId: 'strategy-456',
        epochId: 'epoch-789',
        market: 'BTCUSDT',
        timeframe: '1h',
      },
      publicSurface: {
        summaryInsight: 'BTC showing strong momentum',
        keyDrivers: ['momentum', 'volume'],
      },
      stages: {},
      training: {},
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    // Run pipeline 3 times
    const run1 = await pipeline.execute(input);
    const run2 = await pipeline.execute(input);
    const run3 = await pipeline.execute(input);

    // All runs must produce identical output
    expect(run1).toEqual(run2);
    expect(run2).toEqual(run3);

    // Verify expected transformations
    expect(run1.stages.raw).toBeDefined();
    expect(run1.stages.enriched).toBeDefined();
    expect(run1.stages.scored).toBeDefined();
    expect(run1.stages.scored?.baseScore).toBe(85); // crypto tag → score 85
    expect(run1.publicSurface.tags).toEqual(['crypto', 'bitcoin']);
  });

  it('integrates with TSSD Vault for end-to-end flow', async () => {
    const vault = new InMemoryTSSDVaultClient();
    const pipeline = new MockDAGPipeline()
      .addNode(ingestNode)
      .addNode(enrichNode)
      .addNode(scoreNode);

    const input: VaultedSignalRecord = {
      identity: {
        signalId: 'test-signal-002',
        analystId: 'analyst-456',
        strategyId: 'strategy-789',
        epochId: 'epoch-101',
        market: 'ETHUSDT',
        timeframe: '4h',
      },
      publicSurface: {
        summaryInsight: 'ETH consolidating',
        keyDrivers: ['consolidation'],
      },
      stages: {},
      training: {},
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    // Execute pipeline
    const processed = await pipeline.execute(input);

    // Store in vault
    await vault.upsert(processed);

    // Retrieve and verify core fields (vault adds timestamps/metadata)
    const retrieved = await vault.getBySignalId('test-signal-002');
    expect(retrieved).toBeDefined();
    expect(retrieved?.identity).toEqual(input.identity);
    expect(retrieved?.stages.raw).toBeDefined();
    expect(retrieved?.stages.enriched).toBeDefined();
    expect(retrieved?.stages.scored).toBeDefined();
    expect(retrieved?.stages.scored?.baseScore).toBe(50); // no crypto tag → score 50
    expect(retrieved?.publicSurface.tags).toEqual(['general']);
  });
});

