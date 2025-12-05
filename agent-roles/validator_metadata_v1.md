Validator Metadata v1 (AFI Spec)

1. What is Validator Metadata?
Validator metadata is the compact profile for a validator agent in AFI. It captures who the validator is, what versions and domains they cover, and a few lightweight performance and reputation signals. It is not a per-signal record; it describes the validator as a long-running participant. The intent is to keep a consistent, human-readable snapshot that governance, droids, and tools can trust without digging into code or vault records.

Validator metadata is intentionally small and declarative. It is meant to be stable enough for registry views, dashboards, and selection logic while leaving heavy-duty performance analysis to the vault and replay systems. It should make it obvious which validators are active, what they focus on, and which scores (e.g., PoI) describe their capability—not alter how signals are scored.

2. How it’s used in the protocol
Validator metadata informs eligibility, selection, and monitoring. Registries and coordination layers read it to decide which validators are available for certain markets or strategies. Reputation-aware flows can reference these fields to weight or filter validators, but reputation and PoI/PoInsight never override UWR or vault finality. PoI (Proof-of-Intelligence) and PoInsight (Proof-of-Insight) live at the validator level; they describe capability and historical insight quality, not individual signal scores. Metadata keeps a high-level view of validator competence and activity so selectors and dashboards can reason about the validator set without touching per-signal data.

3. Field-by-field overview
Canonical v1 fields (match the TypeScript schema):
- agentId: UUID for the validator agent. This is the stable identity key used in the v1 schema and should be used for joins and registry lookups.
- displayName: Optional human-friendly label. “Name” in UIs can map here, but the schema field is displayName.
- description: Optional short summary of the validator’s focus or approach.
- domainsCovered: String array of domains the validator can handle (e.g., futures, macro, onchain). Drives eligibility and routing.
- supportedStrategies: String array of strategy families the validator supports. Helps task/strategy matching.
- supportedMarkets: String array of markets/instruments the validator covers. Prevents misrouting to irrelevant venues.
- po_i_score: Proof-of-Intelligence (PoI) score (0–1). Describes validator capability/domain fluency. Validator-level only; does not touch UWR or per-signal scoring.
- poiScore: Proof-of-Insight (PoInsight) score (0–1). Describes long-run insight/alpha quality. Validator-level only; does not touch UWR or per-signal scoring.
- epochsActive: Number of epochs in which this validator has participated. Indicates tenure/availability.
- mintedAFI: Aggregate AFI minted while this validator participated. Informational, not a control surface.
- isActive: Boolean flag indicating whether the validator is currently active/eligible in rotations.
- lastUpdated: ISO datetime string when this metadata profile was last refreshed.

Future / optional extensions (not in the current v1 schema; keep clearly non-canonical until added):
- agentVersion, contact, reputationScore, stakeWeight, lastEpochActivity, verified, notes, and any other operational fields should be treated as future extensions if needed. If introduced later, add them as optional fields to preserve backward compatibility.

4. Versioning and future changes
This is Validator Metadata v1. The canonical TypeScript/Zod schema lives in afi-core and the Codex entry lives in afi-infra. Future versions may extend fields (e.g., add operational or governance fields) but should remain backward-compatible where possible: prefer adding optional fields rather than renaming required ones. Any evolution must preserve the invariants from REGISTRIES_AND_REPUTATION: PoI/PoInsight are validator-level traits, reputation cannot alter UWR or vault finality, and metadata describes validators—not individual signals.

Sources aligned: afi-core/schemas/validator_metadata_schema.ts, afi-infra/afi-codex/validator_metadata_schema.afi-codex.json, afi-config/docs/REGISTRIES_AND_REPUTATION.v0.1.md.
