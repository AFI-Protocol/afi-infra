# AFI Infra - Droid Repo Orientation

**Quick Start**: You're in `afi-infra`, the infrastructure services repo for AFI Protocol.

---

## What This Repo Does

Infrastructure-as-code and service definitions for AFI Protocol's core infrastructure components, including T.S.S.D. Vault (Time-Series Signal Database), service configurations, and infrastructure utilities.

**Key Capabilities**:
- Infrastructure-as-Code (Terraform, CloudFormation)
- Service definitions (Docker, K8s)
- Database schemas and migrations
- Monitoring and observability configs

---

## Repo Boundaries

**This repo handles**:
- ✅ Infrastructure definitions
- ✅ Service configurations
- ✅ Database schemas
- ✅ Monitoring configs

**This repo does NOT handle**:
- ❌ Deployment scripts (that's afi-ops)
- ❌ Application code (that's afi-core, afi-reactor)
- ❌ Smart contracts (that's afi-token)

---

## Key Files to Know

```
infra/
  [Infrastructure definitions]
  
schemas/
  [Database schemas]
  
agent-prompts/
  [Agent prompt templates]
  
agent-roles/
  [Agent role definitions]
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

