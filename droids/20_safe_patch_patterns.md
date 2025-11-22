# AFI Infra - Safe Patch Patterns

How to make safe, reviewable infrastructure changes.

---

## Pattern 1: Additive Infrastructure Changes

**Good** ✅:
```hcl
# Add new resource without modifying existing
resource "aws_service" "new_service" {
  name = "new-service"
}
```

**Bad** ❌:
```hcl
# Modifying existing resource (risky)
resource "aws_service" "existing_service" {
  name = "existing-service"
  instance_type = "t3.large"  # Changed from t3.medium - RISKY!
}
```

**Why**: Additive changes are safer and easier to rollback.

---

## Pattern 2: No Secrets in Code

**Good** ✅:
```hcl
# Use environment variables or secret manager
resource "aws_service" "my_service" {
  api_key = var.api_key  # From environment
}
```

**Bad** ❌:
```hcl
# Hardcoded secret - FORBIDDEN!
resource "aws_service" "my_service" {
  api_key = "sk-1234567890abcdef"  # NEVER DO THIS
}
```

**Why**: Secrets in code are security vulnerabilities.

---

## Pattern 3: Validate Before Commit

**Good** ✅:
```bash
# Validate all configs before committing
terraform validate
yamllint **/*.yml
npm run validate
```

**Why**: Validation catches errors early.

---

## Pattern 4: Document Infrastructure Changes

**Good** ✅:
```markdown
## Infrastructure Change: Added Redis Cache

### Purpose
Improve API response times by caching frequent queries

### Resources Added
- AWS ElastiCache Redis cluster
- Security group for Redis access
- CloudWatch alarms for monitoring

### Impact
- Estimated cost: $50/month
- No breaking changes
```

**Why**: Infrastructure changes affect entire system.

---

## Checklist Before Submitting

- [ ] Changes are additive (no deletions unless necessary)
- [ ] No secrets or credentials in code
- [ ] Configs validated locally
- [ ] Documentation updated
- [ ] No production config changes without approval

---

**Last Updated**: 2025-11-22

