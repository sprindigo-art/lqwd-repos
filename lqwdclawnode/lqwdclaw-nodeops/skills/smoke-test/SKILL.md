---
name: smoke-test
description: End-to-end production smoke test validating all gateway endpoints and subsystems
---

# Production Smoke Test

Run a comprehensive end-to-end test of all gateway endpoints to verify the system is functioning correctly after deployment, upgrade, or recovery.

## When to Use

- After deploying a new gateway binary
- After LND upgrade
- After VM restart or recovery
- Weekly scheduled verification
- Before opening new channels or large operations

## Smoke Test Procedure

Run each step sequentially. Stop on first failure.

### Step 1: Gateway Health

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/health -d '{}' | jq .
```

Expected: `{"ok": true, ...}` with `gateway_up: true`, `lnd_reachable: true`

### Step 2: Node Info

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/info -d '{}' | jq .
```

Expected: `ok: true`, `synced_to_chain: true`, valid `block_height`

### Step 3: Wallet Balances

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/balance/wallet -d '{}' | jq .
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/balance/channels -d '{}' | jq .
```

Expected: Both return `ok: true` with numeric balances

### Step 4: Channels and Peers

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels -d '{}' | jq '.data.channels | length'
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/peers -d '{}' | jq '.data.peers | length'
```

Expected: Channel count matches expected, peer count >= channel count

### Step 5: Analytics Endpoints

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/routing/fee-report -d '{}' | jq .ok
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/analytics/channel-scores -d '{}' | jq .ok
```

Expected: Both return `true`

### Step 6: Node Summary (Sub-Agent Endpoint)

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/node/summary -d '{}' | jq .
```

Expected: `ok: true` with all sections (node, balances, channels, peers, routing, health)

### Step 7: Audit System

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/summary -d '{}' | jq .ok
```

Expected: `true` (audit DB accessible and returning data)

### Step 8: Kill Switch Verification

```bash
# Verify kill switch is NOT engaged
ls -la /var/lib/lnd-gateway/kill-switch 2>&1
```

Expected: "No such file or directory" (kill switch disengaged)

### Step 9: SCB Backup Service

```bash
systemctl is-active scb-backup
ls -lt /var/lib/lnd-gateway/scb-backups/ | head -3
```

Expected: `active`, recent backups present

### Step 10: L402 Server (if L402_ENABLED=true)

```bash
# Should return 402 with WWW-Authenticate header
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  http://127.0.0.1:7778/v1/l402/node-stats)
echo "L402 node-stats (no auth): HTTP $HTTP_CODE"

# Verify all 3 L402 endpoints respond with 402
for ep in node-stats network-analytics promo; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/v1/l402/$ep)
  echo "L402 $ep: HTTP $CODE"
done
```

Expected: All return HTTP 402 with `WWW-Authenticate: L402 ...` header

### Step 11: Write Endpoint Auth (Negative Test)

```bash
# Verify agent token cannot access admin endpoints
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/confirm/list -d '{}')
echo "Admin endpoint with agent token: HTTP $HTTP_CODE"
```

Expected: HTTP 403 (agent token correctly rejected from admin endpoint)

## Result Summary

After all steps, report:

```
SMOKE TEST RESULTS — {timestamp}
================================
Step 1 (Health):        PASS/FAIL
Step 2 (Node Info):     PASS/FAIL
Step 3 (Balances):      PASS/FAIL
Step 4 (Channels):      PASS/FAIL
Step 5 (Analytics):     PASS/FAIL
Step 6 (Node Summary):  PASS/FAIL
Step 7 (Audit):         PASS/FAIL
Step 8 (Kill Switch):   PASS/FAIL
Step 9 (SCB Backup):    PASS/FAIL
Step 10 (L402):         PASS/FAIL/SKIP
Step 11 (Auth):         PASS/FAIL
================================
Overall: PASS/FAIL ({passed}/11 passed)
```

## Important Rules

- Smoke tests are READ-ONLY. Never create invoices, send payments, or modify state during a smoke test.
- If any step fails, stop the test and investigate before proceeding.
- Run the full smoke test before declaring any deployment or upgrade complete.
- Log smoke test results to the audit trail.
