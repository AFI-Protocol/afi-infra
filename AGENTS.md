# afi-infra — Agent Instructions

**afi-infra** provides infrastructure templates, agent role definitions, signal templates, and schema scaffolding for AFI Protocol. This repo is **template/stub oriented**, not production runtime.

**Global Authority**: All agents operating in AFI Protocol repos must follow `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md`. If this AGENTS.md conflicts with the Charter, **the Charter wins**.

---

## Build & Test

```bash
# Install dependencies
npm install

# Build (type check only, no compilation)
npm run build

# Run all tests (Vitest)
npm test

# Run tests in watch mode
npm run test:watch

# Run smoke tests
npm run test:smoke

# Run DAG deterministic tests
npm run test:dag
```

**Expected outcomes**: All tests pass (smoke + DAG deterministic), no TypeScript errors.

---

## Run Locally / Dev Workflow

This repo has no dev server. Typical workflow:

1. Edit templates in `templates/` or `stubs/`
2. Update agent role definitions
3. Run `npm run test:smoke` to verify templates are valid
4. Run `npm run test:dag` to ensure DAG determinism
5. Test templates by using them in target repos (afi-reactor, afi-core)

---

## Architecture Overview

**Purpose**: Provide reusable infrastructure patterns, agent stubs, and config scaffolding. **Not** for production runtime.

**Key directories**:
- `afi-codex/` – Codex JSON specs for infra-facing schemas and contracts
- `schemas/` – Zod schemas for signal enrichment/analysis/feedback/finalization/scoring and enrichment_common
- `src/tssd/` – TSSD vault clients, types, and helpers
- `cli_templates/` – Small CLI-oriented helpers (e.g. signal_simulator)
- `tests/` – Vitest suites for infra and TSSD (including tests/tssd/)
- `droids/` – Repo-scoped droid instructions and safety rails
- `docs/` – Infra and TSSD docs (e.g., TSSD_VAULT_SPEC, TSSD_VAULT_CONSOLIDATION_PLAN.v0.1.md)

**Consumed by**: afi-reactor, afi-core, afi-ops, afi-factory  
**Depends on**: afi-config (schemas)

---

## Security

- **Templates are executed by agents**: Ensure no hardcoded secrets or unsafe defaults.
- **No production URLs**: Use placeholder URLs in templates.
- **Stub validation**: Agent stubs must follow interface contracts from afi-core.

---

## Git Workflows

- **Base branch**: `main`
- **Branch naming**: `feat/`, `fix/`, `docs/`
- **Commit messages**: Conventional commits (e.g., `feat(templates): add mentor agent stub`)
- **Before committing**: Run `npm test` (smoke + DAG tests)

---

## Conventions & Patterns

- **Language**: TypeScript (ESM), YAML/JSON for templates
- **Template naming**: kebab-case (e.g., `validator-agent-template.yaml`)
- **Stubs**: Follow existing patterns, prefer extending over inventing
- **Tests**: Vitest, smoke tests for templates, DAG tests for determinism

---

## Scope & Boundaries for Agents

**Allowed**:
- Improve templates and add new examples
- Refine config scaffolding
- Add new agent role stubs (validator, scorer, mentor, etc.)
- Update tests for template validation

**Forbidden**:
- Treating this as canonical runtime infra (production infra lives in afi-ops)
- Hardcoding secrets or real URLs in templates
- Adding runtime logic that belongs in afi-core or afi-reactor
- Breaking template contracts that other repos depend on

**When unsure**: Keep templates simple and well-documented. Prefer extending existing patterns over creating new ones.

---

**Last Updated**: 2025-11-26  
**Maintainers**: AFI Infra Team  
**Charter**: `afi-config/codex/governance/droids/AFI_DROID_CHARTER.v0.1.md`

### tssd_caretaker_droid (afi-infra)

**Role:** Repo-scoped maintenance droid for the T.S.S.D. Vault in afi-infra.

**Scope:**
- Maintain TSSD-related code, tests, and docs in this repo.
- Files under:
  - `src/tssd/`
  - `tests/tssd/`
  - `docs/TSSD_*.md`
- May update types, clients, tests, and design docs related to the TSSD Vault.

**Hard limits (MUST NOT):**
- No direct writes to production MongoDB instances.
- No schema or retention changes applied to live databases without explicit human approval.
- May propose migration or schema-change scripts in code/docs, but must never apply them to live databases autonomously; any production migration requires an explicit human-approved runbook and sign-off.
- No modifications to token, emissions, validator, or governance logic.
- No changes outside afi-infra.

**Examples of allowed work:**
- Refactor MongoTSSDVaultClient for clarity or performance.
- Add or improve tests for TSSD vault behavior.
- Update TSSD_VAULT_CONSOLIDATION_PLAN.v0.1.md to match the implementation.
- Add non-destructive diagnostics and logging hooks.
