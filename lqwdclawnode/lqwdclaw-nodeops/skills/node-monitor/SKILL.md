---
name: node-monitor
description: Periodic health checks — LND sync status, channel count, peer count, pending HTLCs
---

# Node Monitor

Run periodic health checks to detect issues before they become critical.

## Full Health Check

Run all checks in sequence:

### 1. Gateway Health
```bash
curl -s http://127.0.0.1:7778/v1/health | jq .
```
Check: gateway status, mock mode, kill switch, pending confirmations.

### 2. Node Sync Status
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/info \
  -d '{}' | jq .
```
Check:
- `synced_to_chain` — **CRITICAL if false**: node is behind the blockchain
- `synced_to_graph` — warning if false: routing may be unreliable
- `block_height` — compare to expected (should be near current block)
- `num_active_channels` vs `num_inactive_channels`

### 3. Channel Status
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels \
  -d '{}' | jq .
```
Check each channel for:
- **Inactive channels** (`active: false`) — peer may be offline
- **Pending HTLCs** — any non-empty `pending_htlcs` arrays
- **Severely imbalanced** — local or remote balance < 10% of capacity
- **Zero updates** — channel may be unused/dead

### 4. Balance Check
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/wallet/balance \
  -d '{}' | jq .
```
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/wallet/channel-balance \
  -d '{}' | jq .
```
Check:
- On-chain balance trend (compare to last check if available)
- Channel balance distribution (local vs remote)

### 5. Fee Environment
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/fees/estimate \
  -d '{}' | jq .
```
Note current fee environment — relevant for any pending on-chain operations.

## Severity Levels

| Level | Condition | Action |
|-------|-----------|--------|
| CRITICAL | `synced_to_chain: false` | Alert immediately — node cannot operate |
| CRITICAL | Wallet locked | Alert immediately — all operations blocked |
| WARNING | `synced_to_graph: false` | Alert — routing unreliable |
| WARNING | Inactive channel (>1 hour) | Note in report |
| WARNING | Pending HTLCs near expiry | Alert — force-close risk |
| INFO | Imbalanced channels | Note for rebalancing |
| INFO | Fee environment change | Note for operations planning |

## How to Present

```
## Node Health Report

**Status**: Healthy / Degraded / Critical
**Time**: 2026-03-19 14:00 UTC

**Sync**: Chain synced (block 880,000), graph synced
**Channels**: 5 active, 1 inactive
**Peers**: 8 connected
**Balance**: 4,500,000 sats on-chain, 15,000,000 sats local / 10,000,000 sats remote
**Fees**: 15 sat/vB (half-hour), moderate

**Issues**:
- WARNING: Channel 03peer3...3366 inactive since 2h ago
- INFO: Channel 03peer1...3344 imbalanced (60/40)

**No critical issues.**
```

## When to Run
- After every restart (see node-startup-report skill)
- Periodically (every 30 minutes if configured)
- When the operator asks for a health check
- Before any significant operation (channel open, large payment)
