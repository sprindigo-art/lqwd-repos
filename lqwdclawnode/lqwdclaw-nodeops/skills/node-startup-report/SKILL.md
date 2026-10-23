---
name: node-startup-report
description: Post-restart status check — reports node health, pending operations, and recent audit entries
---

# Node Startup Report

Run this skill after OpenClaw restarts to give the operator a complete picture of what happened while the agent was offline.

## Steps

### 1. Check Gateway Health
```bash
curl -s http://127.0.0.1:7778/v1/health | jq .
```
Report: gateway status, mock mode, kill switch status, pending confirmations.

### 2. Check Node Info
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/info \
  -d '{}' | jq .
```
Report: sync status, block height, active/inactive channels.
**If wallet is locked, alert immediately.**

### 3. Check Balances
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

### 4. Check Recent Audit Entries
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/recent \
  -d '{}' | jq .
```
Report any operations that occurred while the agent was offline. Flag errors or unusual patterns.

### 5. Check Channels for Issues
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels \
  -d '{}' | jq .
```
Flag: inactive channels, channels with pending HTLCs, severely imbalanced channels.

## How to Present
Compile all findings into a single startup report:

```
## Node Startup Report

**Gateway**: healthy, kill switch: off
**Node**: synced, block 880000, LND v0.20.1
**Channels**: 5 active, 1 inactive (03peer3... — offline since restart)
**Balance**: 4,500,000 sats on-chain, 15,000,000 sats in channels
**Audit**: 3 operations while offline (2 payments, 1 channel update)
**Alerts**: None / [list any issues found]
```
