# afi-infra

**Infrastructure services for AFI Protocol**

## 🤖 Droid Instructions

**For AI agents and automated contributors**: See [AGENTS.md](./AGENTS.md) for canonical repo constraints, allowed tasks, and safe patch patterns.

> **Note**: If AGENTS.md conflicts with this README, AGENTS.md wins.

## Purpose

`afi-infra` provides infrastructure-as-code and service definitions for AFI Protocol's core infrastructure components, including:

- **T.S.S.D. Vault** - Time-Series Signal Database for storing and querying signal history
- **Service configurations** - Docker, Kubernetes, and cloud service definitions
- **Infrastructure utilities** - Deployment helpers, health checks, monitoring

## What Belongs Here

✅ Infrastructure-as-Code (Terraform, CloudFormation, etc.)
✅ Service definitions (Docker Compose, K8s manifests)
✅ Database schemas and migrations
✅ Monitoring and observability configs
✅ Infrastructure utilities and helpers
✅ Core infra-level schemas and TSSD-facing types used by AFI services (e.g., signal enrichment, analysis, scoring, and vault records).

## What Does NOT Belong Here

❌ Deployment scripts (→ `afi-ops`)
❌ Application code (→ `afi-core`, `afi-reactor`)
❌ Smart contracts (→ `afi-token`)
❌ Documentation (→ `afi-docs`)

## Current Stage

**Phase 1.5 – infra scaffolding + TSSD v0:** core infra definitions, shared schemas, and TSSD vault services are being established.

## Structure

```
afi-infra/
├── afi-codex/          # Codex JSON specs for schemas
├── schemas/            # Zod schemas (signal enrichment, analysis, scoring, etc.)
├── src/
│   └── tssd/           # TSSD vault clients and types (canonical)
├── agent-roles/        # Agent role definitions
├── docs/               # TSSD specs and documentation
├── droids/             # Droid configuration files
├── tests/              # Vitest suites, including TSSD and DAG deterministic tests
└── README.md
```

## Intended Droid Work

Factory.ai droids can contribute:

- Infrastructure service definitions
- Database schema designs
- Monitoring and alerting configurations
- Cloud resource templates
- Health check implementations

## Related Repositories

- **afi-ops** - Deployment and operations toolkit
- **afi-reactor** - DAG orchestrator (infrastructure consumer)
- **afi-core** - Core runtime (infrastructure consumer)

## License

MIT
