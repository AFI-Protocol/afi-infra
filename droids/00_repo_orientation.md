# AFI Infra - Droid Repo Orientation

**Quick Start**: You're in `afi-infra`, the infrastructure services repo for AFI Protocol.

---

## What This Repo Does

Infrastructure scaffolding, shared schemas, and T.S.S.D. Vault services/tests. Current center of gravity: TSSD (clients, types, deterministic tests) plus infra-level schemas and codex specs.

**Key Capabilities**:
- Infrastructure scaffolding and shared schemas
- TSSD vault services (clients, types, helpers) and tests
- Infra-level codex specs and docs
- Basic CLI helpers for infra/TSSD smoke (e.g., signal_simulator)

---

## Repo Boundaries

**This repo handles**:
- ✅ Infrastructure scaffolding and shared schemas
- ✅ TSSD vault clients/types and deterministic tests
- ✅ Infra-level codex specs and docs
- ✅ CLI helpers used for infra/TSSD smoke testing

**This repo does NOT handle**:
- ❌ Deployment scripts (that's afi-ops)
- ❌ Application code (that's afi-core, afi-reactor)
- ❌ Smart contracts (that's afi-token)

---

## Key Files to Know

```
afi-codex/      Codex JSON specs
schemas/        Zod schemas (enrichment, analysis, feedback, finalization, scoring, enrichment_common)
src/tssd/       TSSD vault clients, types, helpers
cli_templates/  Small CLI helpers (e.g., signal_simulator)
tests/          Vitest suites (including tests/tssd/)
droids/         Repo-scoped droid instructions
docs/           Infra and TSSD docs (TSSD_VAULT_SPEC, TSSD_VAULT_CONSOLIDATION_PLAN.v0.1.md)
```

---

## Quick Commands

```bash
# Install dependencies
npm install

# Validate configs
npm run validate  # if available

# Run tests
npm test  # if available
```

---

## Common Droid Tasks

See `10_common_tasks.md` for detailed workflows.

**Most frequent**:
1. Add infrastructure definition
2. Add service configuration
3. Add database schema
4. Add monitoring config

---

## Safety Notes

**Before making changes**:
1. Read `AGENTS.md` for constraints
2. Check `.afi-codex.json` for dependencies
3. Validate configs locally
4. Ensure no production secrets

**Red flags** (ask a human):
- Modifying production configs
- Adding credentials or secrets
- Breaking service dependencies

---

## Getting Help

- **AGENTS.md**: Canonical constraints
- **README.md**: High-level overview
- **Human maintainers**: Tag @afi-infra-team in PR

---

**Last Updated**: 2025-11-22
