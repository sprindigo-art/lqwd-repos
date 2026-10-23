---
name: gateway-contract-validator
description: Test gateway endpoints with payloads and validate response shapes match skill expectations
---

# Gateway Contract Validator

Call all Go gateway endpoints with test payloads and verify response shapes are correct.

## Purpose

Detect contract mismatches between what skills expect and what the gateway actually returns. Run this after gateway updates or skill changes.

## Gateway health preamble (SKL-03 / SKL-04)

Run this block ONCE at the start of any session that will call the gateway. It
is advisory — it logs + posts an operator alert on drift, but does NOT abort
execution (per 22-CONTEXT.md D-15). Token files are the same group-readable
`0640 root:openclaw` files the other admin-authed skills use.

```bash
ADMIN_TOKEN=$(cat /etc/lnd-gateway/admin-token 2>/dev/null)
INTERNAL_AUTH=$(cat /etc/lnd-gateway/internal-auth 2>/dev/null)

# SKL-03: Gateway version drift check
EXPECTED_GATEWAY_VERSION="v3.0.0"  # bump per release; matches ldflags -X main.Version
_actual_version=$(curl -sI http://127.0.0.1:7778/v1/health 2>/dev/null | grep -i '^x-gateway-version:' | awk '{print $2}' | tr -d '\r\n')
if [ -n "$_actual_version" ] && [ "$_actual_version" != "$EXPECTED_GATEWAY_VERSION" ] && [ -z "$_SKL03_ALERTED" ]; then
  echo "WARN: Gateway version drift: expected $EXPECTED_GATEWAY_VERSION, got $_actual_version" >&2
  # Post operator-visible alert (faucet-monitor tails gateway logs for source=skill:* and forwards to Telegram)
  curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Internal-Auth: $INTERNAL_AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"level\":\"warn\",\"source\":\"skill:gateway-contract-validator\",\"message\":\"gateway version drift: expected $EXPECTED_GATEWAY_VERSION got $_actual_version\"}" \
    http://127.0.0.1:7778/v1/internal/admin/alert >/dev/null || true
  _SKL03_ALERTED=1  # per-session dedupe (D-14)
fi

# SKL-04: Skills symlink self-check
EXPECTED_SKILLS_TARGET="/opt/lqwdclawnode/lqwdclaw-nodeops/skills"
_actual_target=$(readlink -f /home/openclaw/nodeops/skills 2>/dev/null)
if [ -n "$_actual_target" ] && [ "$_actual_target" != "$EXPECTED_SKILLS_TARGET" ] && [ -z "$_SKL04_ALERTED" ]; then
  echo "ERROR: Skills symlink drift: expected $EXPECTED_SKILLS_TARGET, got $_actual_target" >&2
  curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Internal-Auth: $INTERNAL_AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"level\":\"error\",\"source\":\"skill:gateway-contract-validator\",\"message\":\"skills symlink drift: expected $EXPECTED_SKILLS_TARGET got $_actual_target\"}" \
    http://127.0.0.1:7778/v1/internal/admin/alert >/dev/null || true
  _SKL04_ALERTED=1
fi
```

Both checks continue execution on failure — they are advisory alerts, not
fatal guards (D-15). Per-session dedupe flags (`_SKL03_ALERTED`,
`_SKL04_ALERTED`) keep the operator seeing ONE alert per drift per session,
not one per gateway call (D-14).

## Test Procedure

### 1. Health Check
```bash
curl -s http://127.0.0.1:7778/v1/health | jq .
```
Expected: `{"ok": true, "data": {"status": "...", "mock_mode": ..., "uptime_seconds": ..., "kill_switch": ...}}`

### 2. Read Endpoints (require auth)
Test each read endpoint returns `{"ok": true, "data": {...}}`:

```bash
TOKEN=$(cat /etc/lnd-gateway/agent-token)

# Info
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/info -d '{}' | jq '{ok, has_data: (.data != null)}'

# Wallet balance
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/wallet/balance -d '{}' | jq '{ok, has_data: (.data != null)}'

# Channel balance
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/wallet/channel-balance -d '{}' | jq '{ok, has_data: (.data != null)}'

# Channels
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/channels -d '{}' | jq '{ok, has_data: (.data != null)}'

# Peers
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/peers -d '{}' | jq '{ok, has_data: (.data != null)}'

# Fee estimate
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/fees/estimate -d '{}' | jq '{ok, has_data: (.data != null)}'

# Fee report
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/routing/fee-report -d '{}' | jq '{ok, has_data: (.data != null)}'

# Channel scores
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/analytics/channel-scores -d '{}' | jq '{ok, has_data: (.data != null)}'

# Audit recent
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/audit/recent -d '{}' | jq '{ok, has_data: (.data != null)}'

# Audit summary
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/audit/summary -d '{}' | jq '{ok, has_data: (.data != null)}'
```

### 3. Write Endpoint Validation
Test that write endpoints enforce required fields:

```bash
# Missing fields should return 400
curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/graph/node -d '{}' | jq .
# Expected: {"ok": false, "error": "pub_key is required"}

curl -s -H "Authorization: Bearer $TOKEN" -X POST http://127.0.0.1:7778/v1/graph/channel -d '{}' | jq .
# Expected: {"ok": false, "error": "chan_id is required"}
```

### 4. Auth Enforcement
Test that unauthenticated requests are rejected:

```bash
curl -s -X POST http://127.0.0.1:7778/v1/info -d '{}' | jq .
# Expected: 401 response
```

### 5. Response Envelope Consistency
Every successful response must have `"ok": true` and a `"data"` field.
Every error response must have `"ok": false` and an `"error"` field.

## Report Format

### Endpoints Tested: X

| Endpoint | Status | Response Shape | Issues |
|----------|--------|---------------|--------|
| /v1/health | PASS | OK | None |
| /v1/info | PASS | OK | None |
| ... | ... | ... | ... |

### Contract Mismatches Found: X
For each mismatch:
- Endpoint
- Expected response shape
- Actual response shape
- Impact on skills

## Important Rules

- Run this in mock mode — it tests response shapes, not LND connectivity
- Do not send real payments or open real channels during testing
- Compare results against TOOLS.md documentation
- Report all mismatches to the operator
