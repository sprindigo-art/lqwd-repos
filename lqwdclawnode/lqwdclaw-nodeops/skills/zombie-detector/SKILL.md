---
name: zombie-detector
description: Identify dead or dying channels — no forwards, offline peers, stale graph updates
---

# Zombie Detector

Scan channels for signs of death or decay that waste locked capital.

## Zombie Indicators

A channel is a zombie candidate if ANY of these are true:
- **No forwards in 30 days** — channel is not routing traffic
- **Peer offline for 7+ consecutive days** — peer node is likely abandoned
- **No graph updates in 14 days** — peer is not maintaining their channels
- **Channel health score below 25%** — multiple negative signals combined

## Data Collection

### 1. Channel List (with peer online status)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels \
  -d '{}' | jq .
```

### 2. Channel Health Scores
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/analytics/channel-scores \
  -d '{}' | jq .
```

### 3. Forwarding History
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/routing/forwarding \
  -d '{}' | jq .
```

### 4. Peer Graph Info (for last_update timestamp)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/graph/node \
  -d '{"pub_key": "<peer_pubkey>"}' | jq .
```

## Scan Process

1. Fetch all channels and their health scores
2. For each channel with score < 50%:
   a. Check forwarding history — any forwards in the last 30 days?
   b. Check peer online status — is the peer currently connected?
   c. Check graph node info — when was the peer's last graph update?
3. Classify channels:
   - **Zombie**: No forwards 30d + peer offline 7d+ (recommend close)
   - **Dying**: No forwards 30d but peer still online (recommend fee adjustment first)
   - **Dormant**: Low activity but peer active with recent updates (monitor)

## Report Format

### Zombie Channels (recommend close)
| Channel | Peer | Capacity | Last Forward | Peer Offline | Action |
|---------|------|----------|-------------|-------------|--------|

### Dying Channels (recommend intervention)
| Channel | Peer | Capacity | Last Forward | Issue | Suggestion |

### Dormant Channels (monitor)
| Channel | Peer | Capacity | Last Forward | Notes |

### Summary
- Total channels scanned
- Zombies found / capital locked in zombies
- Dying channels / capital at risk
- Estimated on-chain cost to close all zombies at current fee rates

## Important Rules

- Always check mempool fees before recommending closes
- Present findings to operator — never auto-close channels
- Consider that a newly opened channel (<14 days) with no forwards is normal, not a zombie
- A channel to a well-known routing node (exchange, LSP) may have periods of low activity — check peer reputation before flagging
- Include the cost of closing in the recommendation (on-chain fee at current rates)
- Fetch fresh data for every scan — channel state changes rapidly
