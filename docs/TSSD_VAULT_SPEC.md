# T.S.S.D. Vault Specification

> **AFI Settlement v1 note:** Parts of this document reference the **v0** per-signal mint / ERC-1155 receipt / direct-beneficiary path, which is **superseded as mainnet architecture** by AFI Settlement v1 — rewards settle **by epoch** through a RewardsVault / Merkle-claim layer funded from an EpochSettlementManifest, strategy/epoch receipts use **ERC-6909** (not ERC-1155), provenance is separated from payout, and ENS names are aliases (concrete addresses + chainId are the source of truth). See `afi-docs/specs/AFI_SETTLEMENT_V1_DOCTRINE.md` for the canonical architecture.

## Purpose

The **T.S.S.D. Vault** (Time-Series Signal Data Vault) is the canonical, auditable record of each signal's end-to-end lifecycle within the AFI Protocol. It serves as:

- **The single source of truth** for signal progression through the full pipeline: RAW → ENRICHED → ANALYZED → SCORED → MINTED → REPLAYED
- **The bridge** between AFI's off-chain intelligence and on-chain receipts
- **The primary training corpus** for analysts, validators, and their models over time
- **The audit trail** for performance evaluation, regression testing, and continuous improvement

### Why Store Structured Snapshots at Each Stage?

Each lifecycle stage captures a distinct transformation of the signal:

- **RAW**: Initial ingestion from external sources (webhooks, feeds, internal models)
- **ENRICHED**: Augmented with technical indicators, patterns, sentiment, and contextual data
- **ANALYZED**: High-level narrative, regime classification, and risk assessment
- **SCORED**: Quantitative assessment with analyst score template (UWR axes, conviction, market context)
- **MINTED**: On-chain receipt with transaction hash, token address, and chain ID
- **REPLAYED**: Post-signal outcome evaluation for performance tracking and validator consensus

By preserving snapshots at each stage, the Vault enables:

- **Auditability**: Full transparency into how a signal evolved from raw data to on-chain mint
- **Regression Testing**: Ability to replay historical signals through updated models
- **Model Training**: Rich, structured data for supervised and reinforcement learning
- **Performance Analysis**: Comparison of predicted vs. realized outcomes

---

## Public vs Proprietary

The TSSD Vault explicitly separates **public surface data** from **proprietary detail**, respecting analyst edge while enabling meaningful statistics and training.

### Public Surface (`publicSurface`)

Designed to be safely exposed via:

- **On-chain receipts** (ERC-1155 tokens in afi-token repo)
- **Explorers and dashboards** (public-facing UIs)
- **Research portals** (for validators and researchers)

Contains:

- `keyDrivers`: High-level factors (e.g. "momentum breakout", "volume spike") without revealing proprietary logic
- `summaryInsight`: Concise, human-readable explanation
- `riskLabel`: Risk classification (e.g. "conservative", "balanced", "aggressive")
- `tags`: Arbitrary labels for clustering, search, and categorization

### Proprietary Detail (`proprietaryDetail`)

Reserved for the analyst's own edge. **AFI does NOT require full strategy disclosure.**

This area can contain:

- `internalNotes`: Free-form notes for the analyst's internal use
- `featureNotes`: Description of internal features/inputs (optional)
- `externalRefs`: Links to encrypted blobs, IPFS, S3, or private documentation
- `opaqueBlobRef`: Pointer to encrypted or off-vault data

**Key Principle**: Analysts can keep their secret sauce private while still contributing useful metadata for AFI.

This separation enables:

- **Meaningful statistics**: Aggregate performance by market, regime, risk band, etc.
- **Training data**: Public surface provides labels and context for model training
- **Performance tracking**: Realized outcomes can be compared to public predictions
- **Analyst privacy**: Proprietary methods remain confidential

---

## Training and Model Use

The Vault includes `training` flags to guide whether and how records are used for model training:

- `includeForModel`: Whether to include this signal for training (default: true if omitted)
- `anonymizeRequired`: If true, must anonymize before training (e.g. strip analystId, strategyId)
- `holdoutSet`: If true, reserved for evaluation/backtest holdout set (not used in training)

### Use Cases for Training

Validators and researchers can use `VaultedSignalRecord` for:

- **Supervised Learning**: Train models to predict `uwrScore`, `conviction`, or `realizedPnlPct` from enriched features
- **Reinforcement Learning**: Train agent policies based on signal outcomes and reward functions
- **Meta-Analysis**: Study which strategies, regimes, or markets perform best over time
- **Ensemble Methods**: Combine signals from multiple analysts with different scoring approaches

**Note**: PoI (Proof of Intelligence) and PoInsight (Proof of Insight) are validator/agent-level traits tracked in benchkit and validator registries, NOT per-signal fields in TSSD records. The analyst score template captures per-signal scoring data (UWR axes, conviction, market context).

The `listForTraining()` method in `ITSSDVaultClient` automatically filters out signals where `includeForModel` is false, respecting analyst preferences.

---

## Relation to On-Chain Receipts

The TSSD Vault lives **off-chain** (e.g. in MongoDB time-series collections), while on-chain receipts (ERC-1155 tokens in the afi-token repo) provide a lightweight, immutable breadcrumb.

### Division of Responsibility

- **Vault (off-chain)**: Dense, structured data with full lifecycle snapshots, proprietary detail, and training flags
- **Receipt (on-chain)**: Minimal public fields (signalId, epochId, baseScore, confidence, txHash) for provenance and emissions

### Workflow

1. Signal progresses through RAW → ENRICHED → ANALYZED → SCORED stages (all off-chain, stored in Vault)
2. When ready to mint, the Vault record's `publicSurface` is used to generate on-chain receipt metadata
3. Mint transaction is executed (afi-token repo), and `stages.minted` is updated in the Vault with txHash, tokenAddress, etc.
4. On-chain receipt references `signalId` and `epochId`, allowing explorers to link back to Vault for full details (if analyst chooses to expose)

**Key Principle**: The Vault is the dense "brain"; the token/receipt is the surface breadcrumb.

---

## Implementation Notes

### Current Infrastructure

The current implementation uses `InMemoryTSSDVaultClient` as a dev/test adapter:

- **No persistence**: Data is lost when process exits
- **No encryption**: All data is in-memory plaintext
- **No access control**: No authentication or authorization
- **No indexing**: Linear scan for queries

This is suitable for:

- Unit tests
- Local development
- Prototyping and demos

### Future: Mongo-Backed Implementation

A production-ready `MongoTSSDVaultClient` will:

- **Leverage MongoDB time-series collections** for efficient storage and querying of signal lifecycle data
- **Index by key fields**: signalId (unique), epochId, analystId, strategyId, market, publicSurface.tags
- **Respect training flags**: Implement `listForTraining()` with proper filtering
- **Support privacy constraints**: Optionally encrypt `proprietaryDetail` at rest
- **Provide audit logs**: Track who accessed which signals and when
- **Enable time-based queries**: Retrieve signals by createdAt, updatedAt, or stage timestamps

### Schema Evolution

As the AFI Protocol evolves, the Vault schema may need to accommodate:

- New lifecycle stages (e.g. "VALIDATED", "CHALLENGED")
- Additional metadata fields (e.g. "gasUsed", "slippage")
- New training flags (e.g. "syntheticData", "adversarialExample")

The `VaultedSignalRecord` interface is designed to be extensible via optional fields and `extra` objects in snapshots.

---

## Summary

The T.S.S.D. Vault is the **canonical memory** of AFI Protocol, enabling:

- **Auditability**: Full transparency into signal lifecycle
- **Training**: Rich corpus for model development
- **Privacy**: Separation of public surface and proprietary detail
- **Performance Tracking**: Realized outcomes vs. predictions
- **On-Chain Integration**: Lightweight receipts reference dense off-chain records

By treating the Vault as the single source of truth, AFI ensures that every signal—from raw ingestion to on-chain mint to post-signal replay—is captured, auditable, and ready for continuous learning.

