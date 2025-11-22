# AGENTS.md — AFI Infra Droid Instructions (v1)

This file is the canonical instruction set for Factory.ai droids and other agents working in this repository.
If AGENTS.md conflicts with README or docs, **AGENTS.md wins.**

---

## 0. Repo Purpose

**What this repo is for:**  
Infrastructure services, agent templates, signal templates, and schema scaffolding for AFI Protocol. Provides reusable infra patterns, agent role definitions, and CLI templates.

**What this repo is NOT for:**  
- Core runtime logic (use afi-core)
- DAG orchestration (use afi-reactor)
- Production deployment (use afi-ops)
- Deep business logic implementation

---

## 1. Prime Directives (Global AFI Rules)

- **Scaffold, wire, and align context only.** Do not expand full feature logic unless explicitly instructed.
- **Keep changes minimal and deterministic.**
- **Preserve modular boundaries.** No cross-repo code moves unless asked.
- **Codex + AOS are truth sources.** Whitepaper is narrative, not canonical.
- **Never delete or overwrite without a replacement plan.**
- **Prefer small patches over large refactors.**

---

## 2. Allowed Tasks

Droids MAY:
- Add infrastructure stubs in `infra/`
- Add agent role definitions in `agent-roles/`
- Add agent prompts in `agent-prompts/`
- Add signal templates in `signal_templates/`
- Add schemas in `schemas/`
- Add CLI templates in `cli_templates/`
- Improve documentation in `docs/`
- Add agent stubs in `agent-stubs/`

---

## 3. Forbidden Tasks

Droids MUST NOT:
- Implement deep business logic beyond scaffolding
- Add production infrastructure without approval
- Modify core agent semantics without understanding downstream impact
- Add dependencies that aren't standard in AFI
- Change schema contracts without coordinating with consumers

---

## 4. Key Invariants

These must remain true after changes:
- Templates remain minimal and reusable
- Schemas are valid and type-safe
- Agent roles are well-documented
- No production secrets or credentials in templates
- All stubs include clear TODO comments for next steps

---

## 5. Repo Layout Map

- `infra/` — Infrastructure service stubs
- `agent-roles/` — Agent role definitions and personas
- `agent-prompts/` — Reusable agent prompt templates
- `agent-stubs/` — Agent implementation stubs
- `signal_templates/` — Signal format templates
- `schemas/` — Schema definitions
- `cli_templates/` — CLI command templates
- `docs/` — Documentation and guides
- `src/` — Source code (if any)
- `.afi-codex.json` — Repo metadata

---

## 6. Codex / AOS Touchpoints

- `.afi-codex.json` location: Root of repo (if exists)
- AOS streams / registries referenced:
  - Infrastructure service registry
  - Agent role registry
  - Signal template registry
- Schema contracts this repo provides:
  - Agent role schemas
  - Infrastructure service schemas
  - Signal template schemas

---

## 7. Safe Patch Patterns

When editing, prefer:
- Small diffs, one intent per commit/patch
- Additive changes over rewrites
- Clear comments stating purpose and next steps
- Template additions follow existing patterns
- Stubs include usage examples

Example safe patch:
```typescript
// TODO(droid): Add agent role for market sentiment analyzer
// Expected behavior: Analyzes market sentiment from news sources
// Usage: Import in afi-core for runtime instantiation
export const MarketSentimentAnalyzerRole = {
  name: "market-sentiment-analyzer",
  description: "Analyzes market sentiment from news sources",
  capabilities: ["sentiment-analysis", "news-parsing"],
  // Stub: Add full role definition
};
```

---

## 8. How to Validate Locally

**Automated test suite available.** Run these before finalizing:

```bash
# Install dependencies
npm install

# Run all tests (smoke + DAG deterministic)
npm test

# Run only smoke tests (CLI/entrypoint checks)
npm run test:smoke

# Run only DAG deterministic tests
npm run test:dag

# TypeScript type check
npm run build

# Watch mode for development
npm run test:watch
```

**Expected outcomes:**
- ✅ All tests pass (<10s locally)
- ✅ TypeScript compiles without errors
- ✅ No secrets or credentials in code
- ✅ Schemas are valid
- ✅ CLI entrypoints execute without throwing

**Test coverage:**
- Smoke tests: All CLI templates, agent stubs, infra services, TSSD client, schemas
- DAG tests: Deterministic 3-node pipeline (ingest → enrich → score) with TSSD integration

---

## 9. CI / PR Expectations

**Automated CI runs on all PRs** via `.github/workflows/validate-infra.yml`:

**Test Job:**
- ✅ TypeScript type check (`npm run build`)
- ✅ All tests (`npm test`)
- ✅ Smoke tests (`npm run test:smoke`)
- ✅ DAG deterministic tests (`npm run test:dag`)

**Validate Job:**
- ✅ JSON syntax validation
- ✅ Secret detection (blocks merge if secrets found)

**PR Requirements:**
- All tests must pass
- No TypeScript errors
- No secrets in code
- Any new schema must include validation test
- Any new template must include usage example
- Documentation updates should reduce ambiguity
- PR description must explain what was added and why

---

## 10. Current Priorities

1. Organize agent-roles/ for clarity
2. Add comprehensive signal templates
3. Document schema contracts
4. Clean up agent-stubs/ with clear TODOs

---

## 11. If You're Unsure

Default to:
1. Do nothing risky
2. Add a stub + TODO comment
3. Document the uncertainty
4. Ask a human maintainer (tag @afi-infra-team in PR)

---

**Last Updated**: 2025-11-22  
**Maintainers**: AFI Infra Team  
**Version**: 1.0.0

