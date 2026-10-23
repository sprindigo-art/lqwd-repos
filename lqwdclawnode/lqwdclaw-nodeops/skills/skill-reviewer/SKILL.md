---
name: skill-reviewer
description: Lint own SKILL.md files for outdated endpoints, missing error handling, and unclear instructions
---

# Skill Reviewer

Read and review all SKILL.md files for correctness, completeness, and consistency.

## Review Checklist

For each SKILL.md file, verify:

### 1. Endpoint Accuracy
- Every `curl` command references a valid gateway endpoint
- HTTP method matches (all should be POST except health which is GET)
- Request body fields match what the gateway expects
- The gateway base URL is `http://127.0.0.1:7778`

### 2. Authentication
- All curl commands use `$(cat /etc/lnd-gateway/agent-token)` for auth
- No hardcoded tokens
- No references to admin token (agent skills should never use admin token)

### 3. Error Handling
- Skill mentions what to do if the gateway returns an error
- Skill mentions what to do if the gateway returns 429 (rate limited)
- Skill mentions what to do if the gateway returns 503 (kill switch active)
- Write skills mention budget exceeded (403) handling

### 4. Idempotency
- All write operation curl commands include `"idempotency_key": "'$(uuidgen)'"`
- Skill explains why idempotency keys are important

### 5. Confirmation Flow
- Destructive operation skills (channel open/close, on-chain send) document the confirmation flow
- Skills clearly state the agent cannot confirm operations
- Skills mention confirmation expiry

### 6. Data Freshness
- Skills instruct to fetch fresh data before acting
- No instructions to cache or reuse old data

### 7. Safety Rules
- Skills follow AGENTS.md guardrails
- No instructions that could bypass budget, confirmation, or kill switch

## How to Review

Read each skill file in the workspace:
```bash
cat ~/lqwdclaw-nodeops/skills/*/SKILL.md
```

Compare each endpoint reference against the gateway's actual endpoints listed in TOOLS.md:
```bash
cat ~/lqwdclaw-nodeops/workspace/TOOLS.md
```

## Report Format

### Skills Reviewed: X

For each skill with issues:
- **Skill**: [name]
- **Issues found**:
  - [Issue 1 with specific location and suggestion]
  - [Issue 2 ...]
- **Severity**: Low / Medium / High

### Summary
- Skills passing all checks: X
- Skills with issues: Y
- Critical issues (High severity): Z

## Important Rules

- This is a read-only review — suggest changes, do not make them
- Compare against TOOLS.md as the source of truth for endpoints
- Flag any skill that references endpoints not in TOOLS.md
- Flag any skill that uses `lncli` or direct gRPC calls
- Report findings to the operator
