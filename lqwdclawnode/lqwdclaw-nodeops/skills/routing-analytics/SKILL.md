---
name: routing-analytics
description: Analyze forwarding history, fee revenue by channel, and routing success rates
---

# Routing Analytics

Analyze Lightning Network routing performance using forwarding history and fee data.

## Data Sources

### Forwarding History
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/routing/forwarding \
  -d '{}' | jq .
```

Returns forwarding events with: timestamp, incoming/outgoing channel, amount, fee earned.

### Fee Report
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/routing/fee-report \
  -d '{}' | jq .
```

Returns per-channel fee policies (base_fee, fee_rate) and aggregate revenue stats.

### Channel List (for context)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels \
  -d '{}' | jq .
```

## Analysis Steps

1. **Fetch forwarding history** — get recent forwarding events
2. **Fetch fee report** — get current fee policies and revenue
3. **Fetch channel list** — get channel capacities and balances for context
4. **Compute per-channel metrics:**
   - Total forwarded volume (sats)
   - Total fees earned (sats)
   - Number of forwards
   - Average forward size
   - Fee yield (fees / capacity / day)
5. **Identify patterns:**
   - Which channels route the most volume?
   - Which channels earn the most fees?
   - Are any high-capacity channels underperforming?
   - What is the inbound vs outbound flow ratio per channel?

## Reporting Format

Present results as a structured summary:
- Top 5 channels by routing volume
- Top 5 channels by fee revenue
- Channels with zero forwards (potential zombies)
- Overall routing success rate if available
- Total fee revenue for the period

## Important Rules

- Always fetch fresh data before analyzing — never use data from earlier in the conversation
- Report exact satoshi amounts alongside BTC equivalents
- If forwarding history is empty, the node may be new or poorly connected — say so
- Do not make predictions about future routing revenue
