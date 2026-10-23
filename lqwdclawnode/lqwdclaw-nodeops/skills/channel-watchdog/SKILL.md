---
name: channel-watchdog
description: Detect force-close events, inactive channels, capacity imbalances, and stuck HTLCs
---

# Channel Watchdog

Monitor channels for dangerous conditions that require immediate attention.

## Check Channels

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels \
  -d '{}' | jq .
```

## What to Watch For

### 1. Inactive Channels
Channels where `active: false`. This means the peer is offline or unreachable.

- **1 hour offline**: INFO — note it, peer may be restarting
- **6 hours offline**: WARNING — alert operator
- **24+ hours offline**: CRITICAL — channel may need closing, funds are locked

### 2. Pending HTLCs
Any channel with non-empty `pending_htlcs` needs attention.

For each pending HTLC, check:
- **Expiry block height** vs current block height
- **50+ blocks to expiry**: INFO — monitor
- **20 blocks to expiry**: WARNING — alert operator
- **10 blocks to expiry**: CRITICAL — force-close risk imminent

HTLCs stuck near expiry can trigger a cascade of force-closes upstream. This is the most dangerous condition.

### 3. Severely Imbalanced Channels
- **Local balance < 10% capacity**: LOW OUTBOUND — cannot send through this channel
- **Remote balance < 10% capacity**: LOW INBOUND — cannot receive through this channel
- Both conditions reduce routing capability

### 4. Zero-Activity Channels
Channels with very low `num_updates` or no forwarding volume may be:
- Connected to offline/unreliable peers
- Connected to poorly connected nodes
- Candidates for closing (capital locked with no routing value)

### 5. Force-Close Detection
Check audit log for recent force-close events:
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/recent \
  -d '{}' | jq '.data[] | select(.op_type == "channel_close")'
```

Also check for pending channels that indicate a close in progress.

## Alert Format

### CRITICAL Alert
```
CRITICAL: Stuck HTLC approaching expiry!

Channel: 03peer1...3344
HTLC amount: 100,000 sats
Blocks to expiry: 12
Current block: 879,988
Expiry block: 880,000

This HTLC will force-close the channel if not resolved.
Action required: Monitor closely. Force-close may be necessary.
```

### WARNING Alert
```
WARNING: Channel inactive for 8 hours

Peer: 03peer3...3366
Channel capacity: 2,000,000 sats
Local balance: 500,000 sats (locked)
Last active: 2026-03-19 06:00 UTC

Consider: wait for peer to come back online, or close channel to recover funds.
```

### Imbalance Report
```
Channel Imbalance Report:

| Peer | Capacity | Local | Remote | Issue |
|---|---|---|---|---|
| 03peer1...3344 | 5,000,000 | 4,800,000 | 200,000 | Low inbound (4%) |
| 03peer3...3366 | 2,000,000 | 100,000 | 1,900,000 | Low outbound (5%) |

Suggestion: Consider rebalancing to restore routing capacity.
```

## When to Run
- Every 15-30 minutes (automated monitoring)
- Whenever an HTLC-related event is detected
- When the operator asks about channel health
- Before and after channel operations (open/close)
