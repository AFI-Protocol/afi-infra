# AFI Infra - Common Droid Tasks

Frequent tasks with step-by-step instructions.

---

## Task 1: Add Infrastructure Definition

**When**: You need to define new infrastructure component.

**Steps**:

1. **Create definition file**:
   ```bash
   touch infra/my-service.tf  # or .yml, .json
   ```

2. **Add definition**:
   ```hcl
   # infra/my-service.tf
   resource "aws_service" "my_service" {
     # TODO: Add resource definition
   }
   ```

3. **Validate**:
   ```bash
   terraform validate  # or equivalent
   ```

**Expected time**: 30-60 minutes

---

## Task 2: Add Service Configuration

**When**: You need to configure a service.

**Steps**:

1. **Create config file**:
   ```bash
   touch services/my-service.yml
   ```

2. **Add configuration**:
   ```yaml
   # services/my-service.yml
   service:
     name: my-service
     # TODO: Add configuration
   ```

3. **Validate**:
   ```bash
   yamllint services/my-service.yml
   ```

**Expected time**: 15-30 minutes

---

## Task 3: Add Database Schema

**When**: You need to define database structure.

**Steps**:

1. **Create schema file**:
   ```bash
   touch schemas/my-table.sql
   ```

2. **Define schema**:
   ```sql
   -- schemas/my-table.sql
   CREATE TABLE my_table (
     id SERIAL PRIMARY KEY,
     -- TODO: Add columns
   );
   ```

3. **Validate**:
   ```bash
   psql -f schemas/my-table.sql --dry-run
   ```

**Expected time**: 30-60 minutes

---

## Task 4: Add Monitoring Config

**When**: You need to add monitoring for a service.

**Steps**:

1. **Create monitoring config**:
   ```bash
   touch monitoring/my-service.yml
   ```

2. **Define metrics**:
   ```yaml
   # monitoring/my-service.yml
   metrics:
     - name: request_count
       # TODO: Add metric definition
   ```

**Expected time**: 30-60 minutes

---

## Getting Help

If stuck on any task:
1. Check `AGENTS.md` for constraints
2. Look at existing configs for patterns
3. Validate configs locally
4. Ask human maintainer if unsure

---

**Last Updated**: 2025-11-22

