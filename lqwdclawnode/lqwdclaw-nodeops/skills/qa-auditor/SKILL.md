---
name: qa-auditor
description: Validate that destructive operations had proper confirmation, budget checks passed, and outcomes matched expectations
---

# QA Auditor

Audit the integrity of safety mechanisms by verifying that confirmations, budget checks, and outcomes are consistent.

## Audit Checks

### 1. Confirmation Integrity
Verify that all destructive operations (channel open, channel close, on-chain send) went through the confirmation flow:

```bash
# Get all confirmed operations
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/query \
  -d '{"op_type": "confirmed_/v1/channels/open", "limit": 100}' | jq .
```

Check for:
- Every channel open/close/on-chain send has a corresponding `confirmed_*` audit entry
- No destructive operations were executed without confirmation
- Confirmation timestamps are after the initial request timestamps

### 2. Budget Compliance
Verify that budget limits were respected:

```bash
# Get budget rejections
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/query \
  -d '{"min_status": 403, "max_status": 403, "limit": 100}' | jq .
```

```bash
# Get summary with spend totals
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/summary \
  -d '{}' | jq .
```

Check for:
- Daily spend never exceeded `MAX_DAILY_SPEND_SATS`
- No single payment exceeded `MAX_PAYMENT_SATS`
- No channel open exceeded `MAX_CHANNEL_SIZE_SATS`
- Budget rejections were handled correctly (agent did not retry with modified amounts to bypass)

### 3. Idempotency Verification
Check that write operations used idempotency keys:

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/query \
  -d '{"op_type": "payment", "limit": 100}' | jq '.data[] | {endpoint, idempotency_key, amount_sats}'
```

Flag any write operations missing idempotency keys.

### 4. Outcome Validation
For completed operations, verify outcomes make sense:
- Channel opens: did the channel actually appear in channel list?
- Payments: was the amount reasonable for the context?
- Rebalances: was the fee paid less than the expected revenue benefit?

## Report Format

### Confirmation Audit
- Total destructive operations: X
- Properly confirmed: Y
- Anomalies found: Z (list each)

### Budget Audit
- Budget rejections: X
- Max daily spend observed: Y sats (limit: Z sats)
- Over-limit attempts: list any

### Idempotency Audit
- Write operations with keys: X
- Write operations without keys: Y (list each — this is a bug)

### Anomalies
List any suspicious patterns:
- Operations executed without proper flow
- Unusual timing or amounts
- Repeated failures suggesting misconfiguration

## Important Rules

- This is a read-only audit — do not modify anything
- Report findings to the operator with severity levels
- If any confirmation bypass is detected, flag as CRITICAL
- Run this audit periodically (weekly recommended)
