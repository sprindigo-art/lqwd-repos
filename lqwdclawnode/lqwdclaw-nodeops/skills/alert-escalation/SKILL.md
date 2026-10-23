---
name: alert-escalation
description: Escalate critical node events via Telegram with severity-based routing
---

# Alert Escalation

Route alerts to the operator via Telegram based on severity. Critical events get immediate attention; warnings accumulate into periodic digests.

## When to Use

- When any monitoring skill detects an anomaly
- When gateway health check fails
- When kill switch is engaged/disengaged
- When budget thresholds are approached
- When channel force-closes are detected

## Severity Levels

| Severity | Response Time | Action |
|----------|---------------|--------|
| CRITICAL | Immediate | Send Telegram alert NOW |
| WARNING | Within 1 hour | Include in next digest |
| INFO | Next daily report | Log only, include in daily summary |

## Critical Events (Immediate Alert)

These events MUST trigger an immediate Telegram message:

1. **Kill switch engaged** — all writes blocked
2. **Channel force-close detected** — funds at risk of timelock
3. **Node out of sync** — `synced_to_chain: false` for >10 minutes
4. **LND unreachable** — gateway cannot connect to LND gRPC
5. **Daily spend >80%** — approaching daily budget ceiling
6. **SCB backup failure** — backup service stopped or failed
7. **Peer cascade** — 3+ peers disconnected within 5 minutes
8. **Wallet locked** — LND wallet requires manual unlock

### Alert Format

```
[CRITICAL] LQWDClaw-NodeOps

Event: {event description}
Time: {UTC timestamp}
Details: {1-2 lines of context}

Action required: {what the operator should do}
```

## Warning Events (Digest)

Accumulate and report in hourly or triggered digests:

1. Channel balance ratio <20% or >80% (imbalanced)
2. Single peer disconnected
3. HTLC pending >50% of timeout
4. Fee revenue below 7-day average
5. On-chain balance below threshold
6. Gateway restart detected

### Digest Format

```
[DIGEST] LQWDClaw-NodeOps — {count} warnings

1. {warning description}
2. {warning description}
...

Node status: {healthy/degraded}
```

## How to Send Alerts

Use OpenClaw's Telegram integration to send messages to the operator:

```
Send the operator a message:
[CRITICAL] LQWDClaw-NodeOps
Event: Force-close detected on channel {chan_id}
Time: 2026-03-20T14:30:00Z
Details: Channel with peer {alias} entered force-close state
Action required: Monitor timelock expiry, verify SCB backup is current
```

## Escalation Chain

1. **First**: Telegram message to operator
2. **If unacknowledged after 30 min (CRITICAL only)**: Repeat Telegram with "[REMINDER]" prefix
3. **If unacknowledged after 2 hours**: Log to audit trail as unacknowledged critical event

## Important Rules

- Never suppress or delay CRITICAL alerts
- Never send more than 1 reminder per event per hour
- Always include actionable next steps in alerts
- Do not include sensitive data (tokens, macaroon paths) in Telegram messages
- Keep alert messages under 500 characters for mobile readability
- Always verify the condition is real before alerting (query gateway, don't rely on cached state)
