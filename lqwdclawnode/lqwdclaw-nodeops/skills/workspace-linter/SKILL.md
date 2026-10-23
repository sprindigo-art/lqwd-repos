---
name: workspace-linter
description: Audit AGENTS.md, SOUL.md, TOOLS.md for contradictions, missing guardrails, and outdated info
---

# Workspace Linter

Review workspace configuration files for correctness, consistency, and completeness.

## Files to Review

### AGENTS.md
```bash
cat ~/lqwdclaw-nodeops/workspace/AGENTS.md
```

Check for:
- All critical rules are present (never bypass gateway, never cache state, never auto-confirm)
- Rules are not contradictory
- Gateway URL is correct (`http://127.0.0.1:7778`)
- Token file path is correct (`/etc/lnd-gateway/agent-token`)
- No instructions that could lead to unsafe behavior

### SOUL.md
```bash
cat ~/lqwdclaw-nodeops/workspace/SOUL.md
```

Check for:
- Identity is consistent with LQWD Technologies Corp. branding
- No forward-looking statements or financial advice promises
- Persona is professional and safety-conscious
- No contradictions with AGENTS.md rules

### TOOLS.md
```bash
cat ~/lqwdclaw-nodeops/workspace/TOOLS.md
```

Check for:
- All gateway endpoints are listed (compare against actual routes in main.go)
- Endpoint descriptions are accurate
- Request/response patterns are correct
- Error codes are documented
- "Tools NOT to use" section is present and complete

### IDENTITY.md
```bash
cat ~/lqwdclaw-nodeops/workspace/IDENTITY.md
```

Check for:
- Name, role, and organization are correct
- Consistent with SOUL.md

### USER.md
```bash
cat ~/lqwdclaw-nodeops/workspace/USER.md
```

Check for:
- Operator profile is accurate
- No sensitive information (passwords, tokens, private keys)

## Cross-File Consistency

Verify across all files:
- Gateway URL is the same everywhere
- Token handling instructions are consistent
- Safety rules in AGENTS.md are not contradicted by other files
- Endpoint references in skills match TOOLS.md

## Report Format

### Files Reviewed: X

For each file with issues:
- **File**: [name]
- **Issues**:
  - [Issue with specific line/section reference]
- **Severity**: Low / Medium / High

### Cross-File Issues
- [Any contradictions or inconsistencies between files]

### Missing Content
- [Any guardrails, endpoints, or documentation that should exist but doesn't]

### Summary
- Files passing all checks: X / Y
- Issues found: Z (Critical: A, Medium: B, Low: C)

## Important Rules

- This is a read-only audit — suggest changes, do not make them
- Pay special attention to safety-related content
- Flag any instruction that could lead to bypassing the gateway
- Flag any reference to lncli, direct gRPC, or macaroon files
- Report findings to the operator
