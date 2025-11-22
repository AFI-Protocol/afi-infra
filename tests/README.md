# AFI Infra Tests

Minimal, droid-friendly test layer for afi-infra.

## Test Coverage

### Smoke Tests (`smoke.cli.test.ts`)

Quick "does it run" checks for all primary CLI/entrypoints:

- **CLI Templates**: `signal_simulator`
- **Agent Stubs**: `mentor_feedback_simulator`, `variant_agent_stub`
- **Infrastructure Services**: `eventsBus`, `infra.config`, `observerDaemon`
- **TSSD Vault Client**: `InMemoryTSSDVaultClient`, types
- **Schemas**: All 11 schema modules

**Purpose**: Verify entrypoints can be imported and executed without throwing.  
**Constraints**: NO network calls, NO real DB access, NO heavy business logic.

### DAG Deterministic Tests (`dag.deterministic.test.ts`)

Verifies a stable, repeatable flow end-to-end at the infra boundary.

**Test Pipeline**: 3-node DAG (Ingest → Enrich → Score)

- **Node 1 (RAW)**: Adds raw signal snapshot with fixed timestamp
- **Node 2 (ENRICHED)**: Adds enrichment data based on content
- **Node 3 (SCORED)**: Assigns deterministic score based on tags

**Guarantees**:
- ✅ Identical input → identical output across runs
- ✅ No nondeterminism from timestamps or ordering
- ✅ Pure functions only, no network/DB calls

**Integration**: Tests TSSD Vault upsert/query operations

## Running Tests

```bash
# Run all tests
npm test

# Run only smoke tests
npm run test:smoke

# Run only DAG deterministic tests
npm run test:dag

# Watch mode for development
npm run test:watch

# TypeScript type check
npm run build
```

## Expected Performance

All tests should complete in **<10 seconds** locally.

## CI Integration

Tests run automatically on all PRs via `.github/workflows/validate-infra.yml`:

- ✅ TypeScript type check
- ✅ All tests (smoke + DAG)
- ✅ JSON validation
- ✅ Secret detection

**Merge is blocked if any test fails.**

## Adding New Tests

### For New CLI/Entrypoints

Add to `smoke.cli.test.ts`:

```typescript
it('my_new_cli imports and executes without error', async () => {
  const { myFunction } = await import('../cli_templates/my_new_cli.js');
  
  expect(myFunction).toBeDefined();
  expect(() => myFunction()).not.toThrow();
});
```

### For New Infrastructure Services

Add to `smoke.cli.test.ts` under "Infrastructure Services":

```typescript
it('myService imports without error', async () => {
  const module = await import('../infra/myService.js');
  
  expect(module).toBeDefined();
});
```

### For DAG/Pipeline Logic

Extend `dag.deterministic.test.ts` with new nodes or pipelines.

**IMPORTANT**: Keep tests deterministic (fixed timestamps, no randomness).

## Notes

- Tests use **Vitest** (ESM-first, fast)
- All imports use `.js` extension (ESM requirement)
- Existing schema test files (`schemas/*.test.ts`) are excluded from TypeScript compilation (legacy format)
- NO business logic added or altered by this test layer

---

**Last Updated**: 2025-11-22  
**Maintainers**: AFI Infra Team

