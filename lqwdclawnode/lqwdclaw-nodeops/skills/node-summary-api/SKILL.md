---
name: node-summary-api
description: Provide a high-level node status summary for the LQWDClaw orchestrator or external queries
---

# Node Summary API

Produce a comprehensive node status summary when asked "How is the node?" or similar queries from the LQWDClaw orchestrator or operator.

## When to Use

Use this skill when:
- The LQWDClaw orchestrator asks for node status
- The operator asks for a general overview
- Any external system queries node health
- Generating periodic status reports

## Data Source

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/node/summary \
  -d '{}' | jq .
```

This single endpoint aggregates:
- Node identity (alias, pubkey, version, sync status)
- Balances (on-chain, channel local/remote, total)
- Channel stats (active/inactive/pending, capacity, balance ratio)
- Peer count
- Routing performance (7-day forwards, fees earned, avg forward size)
- Health status (kill switch, avg channel score, uptime)

## Response Format for Orchestrator

When responding to the LQWDClaw orchestrator, format the response as a structured summary:

### Status: [Healthy / Degraded / Critical]

**Node**: [alias] ([version]) — [synced/not synced] at block [height]

**Balances**:
- On-chain: [X] sats ([X] BTC)
- Channels: [X] local / [X] remote sats
- Total: [X] sats ([X] BTC)

**Channels**: [X] active / [X] inactive / [X] pending
- Total capacity: [X] sats
- Average local balance ratio: [X]%

**Routing (7d)**: [X] forwards, [X] sats earned in fees

**Health**: [status], avg channel score [X]%

## Supplementary Data

If the orchestrator asks for more detail, use additional endpoints:

```bash
# Channel-level detail
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/analytics/channel-scores \
  -d '{}' | jq .

# Recent audit activity
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/summary \
  -d '{}' | jq .
```

## Important Rules

- Always fetch fresh data — never report from memory
- Report exact satoshi amounts alongside BTC equivalents
- If the node is not synced, flag this prominently
- If the kill switch is active, report this as the first item
- Keep the summary concise — the orchestrator may be forwarding it to social media or reports
- Do not include sensitive data (pubkeys can be shared, but not tokens or internal IPs)
