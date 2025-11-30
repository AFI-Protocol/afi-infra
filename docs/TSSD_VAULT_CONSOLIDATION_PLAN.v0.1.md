# TSSD Vault Consolidation Plan v0.1

**Date:** 2025-11-29  
**Status:** Planning Document (Non-Implementation)  
**Related:** [TSSD_VAULT_SPEC.md](./TSSD_VAULT_SPEC.md), [TSSD_VAULT_READINESS_REPORT.md](../../afi-eliza-gateway/TSSD_VAULT_READINESS_REPORT.md)

---

## 1. Purpose

The AFI Protocol codebase currently contains multiple TSSD/Vault-related type definitions and implementations across repos, created during parallel development. This has resulted in schema drift, naming collisions, and fragmented storage logic.

This consolidation plan declares a **single canonical path forward** for TSSD Vault implementation. It identifies which types, files, and patterns are authoritative, which are deprecated stubs, and how future implementation work should proceed safely without breaking existing code.

This is a **planning document**, not an implementation spec. It provides the agreed direction so future tasks can execute cleanly and non-destructively.

---

## 2. Canonical TSSD Vault Types

**Authoritative Source:** `afi-infra/src/tssd/types.ts`

This file is the **single source of truth** for all TSSD Vault types. It defines:

- `VaultedSignalRecord` - Complete lifecycle record structure
- `SignalIdentity` - Global identification (signalId, epochId, market, timeframe, analystId, strategyId, etc.)
- `SignalLifecycleStage` - Enum for RAW | ENRICHED | ANALYZED | SCORED | MINTED | REPLAYED
- Lifecycle snapshots:
  - `RawSignalSnapshot`
  - `EnrichmentSnapshot`
  - `AnalysisSnapshot`
  - `ScoreSnapshot`
  - `MintSnapshot`
  - `OutcomeSnapshot`
- `PublicSurfaceView` - Safe for receipts/explorers
- `ProprietaryDetailView` - Analyst's private edge
- `TrainingFlags` - Model training controls

**Deprecated Stubs (Do Not Delete Yet):**

The following files contain competing or incomplete vault type definitions and are considered **deprecated**:

- `afi-reactor/types/VaultedSignal.ts` (10 lines) - Minimal stub with signalId, score, timestamp, meta
- `afi-reactor/src/core/VaultService.ts` (43 lines) - Stub class with "not implemented" errors, defines its own `VaultedSignal` interface
- `afi-reactor/agents/persistence/VaultedSignalStore.ts` (58 lines) - MongoDB time-series implementation using incompatible `VaultedSignal` type

**Migration Note:**

Future work will update afi-reactor to import and depend directly on `afi-infra/src/tssd/types.ts`. The deprecated stubs will be redirected to use canonical types or removed once the new implementation is stable. **Do not delete these files yet** — they may be referenced by existing code.

---

## 3. Canonical Storage Engine and Layout (Stage 1)

**Stage 1 Decision: MongoDB with Time-Series Collections**

Based on the readiness analysis, Stage 1 implementation will use **MongoDB** as the default storage engine:

- MongoDB 5.0+ native time-series collections are already in use in afi-reactor
- Existing environment variables and stubs assume MongoDB
- `afi-config/schemas/vault.schema.json` supports multiple engines, but MongoDB is the most mature path forward

**Proposed Stage 1 Configuration:**

- **Database name:** `afi_tssd`
- **Primary collection name:** `tssd_signals`
- **Time-series configuration:**
  - `timeField`: `createdAt` (from VaultedSignalRecord)
  - `metaField`: `identity` (SignalIdentity metadata)
  - `granularity`: `minutes`

**Multi-Engine Support:**

This decision does **not** preclude PostgreSQL/TimescaleDB/InfluxDB support in the future. The `vault.schema.json` multi-engine design remains valid. Stage 1 focuses on MongoDB only to avoid over-engineering before production validation.

---

## 4. Canonical Environment Variables

**Proposed Canonical Names:**

To eliminate inconsistency across repos, the following environment variables are declared canonical for TSSD Vault:

- `AFI_TSSD_MONGODB_URI` - MongoDB connection string (e.g., `mongodb://localhost:27017`)
- `AFI_TSSD_DB_NAME` - Database name (default: `afi_tssd`)
- `AFI_TSSD_COLLECTION` - Primary collection name (default: `tssd_signals`)

**Legacy Names (Phase Out):**

The following environment variable names are considered **legacy** and should be gradually phased out:

- `MONGODB_URI` (too generic, conflicts with other MongoDB uses)
- `MONGO_URI` (inconsistent naming)
- `DB_URI` (too generic)

**Migration Strategy:**

Future implementation will:
1. Read from canonical names first (`AFI_TSSD_*`)
2. Fall back to legacy names with deprecation warnings
3. Update documentation and `.env.example` files to use canonical names
4. Eventually remove legacy fallback support in a future major version

---

## 5. Responsibilities by Repo

### afi-infra

**Owns:**
- Canonical TSSD Vault types (`src/tssd/types.ts`)
- `ITSSDVaultClient` interface (`src/tssd/TSSDVaultClient.ts`)
- Concrete database client implementations (e.g., `MongoTSSDVaultClient`, future `PostgresTSSDVaultClient`)
- TSSD Vault specification and documentation (`docs/TSSD_VAULT_SPEC.md`)

**Responsibilities:**
- Maintain type definitions for `VaultedSignalRecord` and all lifecycle snapshots
- Provide storage-agnostic interface (`ITSSDVaultClient`) for vault operations
- Implement production-ready database clients (currently: `InMemoryTSSDVaultClient` for dev/test)
- Ensure backward compatibility when evolving vault schema

### afi-reactor

**Owns:**
- DAG pipeline orchestration (`codex/dag.codex.json`)
- Signal lifecycle progression (RAW → ENRICHED → ANALYZED → SCORED)
- Vault integration points within the pipeline

**Responsibilities:**
- Call into vault via `ITSSDVaultClient` interface (imported from afi-infra)
- Populate `VaultedSignalRecord` at appropriate pipeline stages
- Trigger vault upserts after SCORED stage (and optionally after ENRICHED/ANALYZED)
- **Does not define its own vault types long-term** — imports from afi-infra

**Current State:**
- afi-reactor currently has its own `VaultedSignal` types and stubs
- These will be **redirected** to afi-infra's canonical types in Phase 1 implementation

### afi-core

**Owns:**
- Universal signal schemas for validation (`schemas/universal_signal_schema.ts`)
- Zod-based schemas for RAW/ENRICHED/ANALYZED/SCORED signals
- Signal validation and scoring logic

**Responsibilities:**
- Define the **shape** of signals at each pipeline stage (for validation purposes)
- These schemas **feed into** TSSD Vault records but do **not define storage layout**
- Validation schemas may be simpler than vault schemas (vault adds metadata, timestamps, identity)

**Relationship to TSSD Vault:**
- afi-core schemas validate signals **before** they are vaulted
- afi-infra's `VaultedSignalRecord` wraps validated signals with additional metadata
- No direct dependency: afi-core does not import from afi-infra

### afi-config

**Owns:**
- Vault configuration schema (`schemas/vault.schema.json`)
- Multi-engine configuration governance (MongoDB, PostgreSQL, TimescaleDB, InfluxDB)
- Retention policy, indexing, and replication configuration

**Responsibilities:**
- Define **how** vault is configured (engine selection, connection strings, collection names)
- Provide JSON Schema validation for vault configuration files
- Control environment variable wiring and deployment-time configuration

**Relationship to TSSD Vault:**
- afi-config governs **configuration**, not **implementation**
- afi-infra implements vault clients that **consume** afi-config schemas

---

## 6. Deprecation Notes (Non-Destructive)

The following files are considered **deprecated stubs** but **must not be deleted yet**:

### afi-reactor/types/VaultedSignal.ts

**Status:** Deprecated stub (10 lines)
**Reason:** Minimal interface that conflicts with afi-infra's `VaultedSignalRecord`
**Action:** Do not delete yet. Will be redirected to import from afi-infra in Phase 1.

### afi-reactor/src/core/VaultService.ts

**Status:** Deprecated stub (43 lines)
**Reason:** All methods throw "not implemented" errors. Defines its own `VaultedSignal` interface.
**Action:** Do not delete yet. Will be refactored to use `ITSSDVaultClient` from afi-infra in Phase 1.

### afi-reactor/agents/persistence/VaultedSignalStore.ts

**Status:** Functional but incompatible (58 lines)
**Reason:** MongoDB time-series implementation using incompatible `VaultedSignal` type (not `VaultedSignalRecord`)
**Action:** Do not delete yet. Will be refactored to use afi-infra's `MongoTSSDVaultClient` in Phase 1.

### afi-reactor/plugins/tssd-vault-service.ts

**Status:** Functional but minimal (32 lines)
**Reason:** Simple MongoDB insert plugin, does not use canonical types
**Action:** Do not delete yet. May be deprecated in favor of afi-infra's vault client.

**General Principle:**

These files represent **parallel development** that occurred before consolidation. They will be **redirected** to use canonical types in a migration-safe manner. Deleting them prematurely could break existing code or scripts.

---

## 7. Phase 1 Implementation Scope (Preview Only)

Phase 1 implementation will focus on **consolidation and MongoDB production readiness**. The following tasks are anticipated:

1. **Implement `MongoTSSDVaultClient` in afi-infra**
   - Location: `afi-infra/src/tssd/MongoTSSDVaultClient.ts`
   - Implements `ITSSDVaultClient` interface
   - Uses `VaultedSignalRecord` type
   - Supports MongoDB time-series collections with proper indexing

2. **Add migration-safe wiring in afi-reactor**
   - Update `VaultService` to delegate to `ITSSDVaultClient` from afi-infra
   - Add adapter layer if needed to bridge existing code
   - Ensure existing scripts (e.g., `replay-vault-signals.ts`) continue to work

3. **Add offline smoke tests**
   - Similar to `afi-eliza-gateway/scripts/offline-telemetry-smoke.ts`
   - Test vault upsert, query, and replay operations without network dependencies
   - Validate schema compliance

4. **Add minimal integration test**
   - Write a few `VaultedSignalRecord` instances to MongoDB
   - Read them back and verify lifecycle stage progression
   - Test query filters (by epochId, analystId, market, tags)

5. **Keep all existing stubs in place**
   - Do not delete deprecated files until new client is stable
   - Add deprecation warnings in code comments
   - Update documentation to point to canonical types

**Explicit Non-Goal for Phase 1:**

This document **does not perform these changes**. It describes the agreed direction so future implementation tasks can execute safely and non-destructively.

---

## 8. Success Criteria

This consolidation plan is successful when:

1. **Single source of truth established**: All future vault work references `afi-infra/src/tssd/types.ts`
2. **No schema drift**: New code does not introduce competing vault type definitions
3. **Migration path clear**: Deprecated stubs have documented replacement paths
4. **Environment variables standardized**: Canonical names (`AFI_TSSD_*`) are adopted
5. **MongoDB implementation ready**: `MongoTSSDVaultClient` is production-ready and tested

---

**End of Consolidation Plan v0.1**

