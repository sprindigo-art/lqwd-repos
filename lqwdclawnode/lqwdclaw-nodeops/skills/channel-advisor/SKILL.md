---
name: channel-advisor
description: Recommend channels to open or close based on routing performance, network graph analysis, and liquidity needs
---

# Channel Advisor

Provide data-driven recommendations for opening new channels and closing underperforming ones.

## Data Collection

### 1. Current Channels
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

### 4. Fee Environment
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/fees/estimate \
  -d '{}' | jq .
```

### 5. Network Graph (for candidate evaluation)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/graph/node \
  -d '{"pub_key": "<candidate_pubkey>", "include_channels": true}' | jq .
```

## Close Recommendations

Close a channel if ALL of these are true:
- Earned less in fees than open+close on-chain cost over 90 days
- Channel health score is below 40%
- Peer has been offline for 7+ days OR zero forwards in 30 days

### Cost Analysis
Before recommending close:
1. Estimate close transaction fee at current mempool rates
2. Compare total lifetime fee revenue vs total cost (open fee + close fee)
3. If the channel is net negative over 90 days with no trend improvement, recommend close

### Never auto-close:
- Channels with pending HTLCs
- Channels opened in the last 14 days (insufficient data)
- Channels to known high-value routing nodes (may improve with fee tuning)

## Open Recommendations

When recommending new channels:
1. Identify routing gaps (destinations frequently attempted but failed)
2. Look for well-connected nodes that complement existing connectivity
3. Prefer nodes with high uptime, recent graph updates, and active channels
4. Check candidate's channel count and total capacity

### Candidate Validation
For each candidate, verify:
- `last_update` timestamp is within 14 days (node is actively maintaining channels)
- Node has at least 10 active channels (established routing node)
- Node is not already a direct peer

### Fee Environment Check
Always check mempool fees before recommending a channel open:
- If fees are above 50 sat/vB, recommend waiting unless urgent
- If fees are above 100 sat/vB, strongly recommend waiting
- Include the estimated on-chain cost in the recommendation

## Recommendation Format

### Close recommendation:
- Channel ID and peer alias
- Lifetime fee revenue
- Estimated close cost at current fees
- Health score and reason for recommendation
- Risk assessment

### Open recommendation:
- Candidate pubkey and alias
- Suggested channel size (sats)
- Estimated open cost at current fees
- Connectivity benefit (fills routing gap to X)
- Expected break-even timeline

## Important Rules

- Always check mempool fees before any on-chain recommendation
- Present recommendations — never auto-execute opens or closes
- Include cost/benefit analysis with every recommendation
- Fetch fresh data before analyzing — never rely on stale state
- For the LQWD PR node, prefer channels to high-volume routing nodes (exchanges, LSPs, payment processors)
