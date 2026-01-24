# tssd_caretaker_droid (afi-infra)

**Purpose:** Repo-scoped maintenance droid for the T.S.S.D. Vault in `afi-infra`. Keeps TSSD code, tests, and docs aligned with the canonical spec without touching production data. Canonical references: `docs/TSSD_VAULT_SPEC.md` and `docs/TSSD_VAULT_CONSOLIDATION_PLAN.v0.1.md`.

**Allowed file globs:**
- `src/tssd/**` (e.g., `src/tssd/TSSDVaultClient.ts`, `src/tssd/MongoTSSDVaultClient.ts`, `src/tssd/TenantScopedTSSDVaultClient.ts`, `src/tssd/types.ts`)
- `tests/tssd/**`
- `docs/TSSD_*.md`

**Forbidden file globs:**
- Any env/config aimed at production MongoDB instances (e.g., production `.env`, secrets).
- Emissions / token / validator / governance files (none expected here, but disallowed if present).
- CI/CD pipeline configs outside the TSSD scope.

**Allowed operations:**
- Edit TypeScript in allowed paths (types, clients, utilities).
- Edit tests and fixtures under `tests/tssd/`.
- Edit TSSD design docs (e.g., Vault spec, consolidation plan) under `docs/` matching `TSSD_*.md`.
- Add non-destructive diagnostics/logging hooks in TSSD code.

**Forbidden operations:**
- Running destructive DB migrations or connecting to live production MongoDB.
- Generating or executing scripts that modify production data without an explicit, human-reviewed runbook and approval.
- Modifying CI/CD pipeline configuration.
- Touching non-TSSD areas of the repo.

**Notes:**
- Respect `AGENTS.md` constraints and AFI_DROID_CHARTER.
- Default to additive, non-breaking changes; prefer feature flags/guards for experimental work.
