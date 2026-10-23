---
name: lnd-rebalance
description: Circular rebalancing with cost/benefit analysis and budget enforcement
---

# LND Rebalance

Perform circular rebalancing to restore channel liquidity balance, with cost/benefit analysis.

## When to Rebalance

Rebalance when:
- A channel's local balance is <20% or >80% of capacity
- The imbalanced channel is a high-value routing channel (earns significant fees)
- The rebalance fee is less than expected routing revenue from restored balance

Do NOT rebalance when:
- The channel earns minimal fees (rebalance cost > expected revenue)
- Mempool fees are high (rebalance may trigger on-chain activity)
- The node has insufficient liquidity in complementary channels

## Cost/Benefit Analysis

Before executing any rebalance:

1. **Estimate benefit**: How much fee revenue has this channel earned per day? If balance is restored, how many additional days of routing does it enable?
2. **Estimate cost**: The `max_fee_sats` for the rebalance
3. **Rule**: Rebalance fee must be < 50% of the fee revenue the restored liquidity would earn over 30 days
4. **If uncertain**: Present the analysis to the operator and ask

## Data Collection

### Channel Balances
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels \
  -d '{}' | jq .
```

### Channel Scores (includes balance health)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/analytics/channel-scores \
  -d '{}' | jq .
```

### Forwarding History (for revenue estimation)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/routing/forwarding \
  -d '{}' | jq .
```

## Executing a Rebalance

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/rebalance \
  -d '{
    "outgoing_chan_id": "<depleted_channel_id>",
    "incoming_chan_id": "<surplus_channel_id>",
    "amount_sats": 500000,
    "max_fee_sats": 500,
    "idempotency_key": "'$(uuidgen)'"
  }' | jq .
```

### Parameters
- `outgoing_chan_id`: Channel where local balance is too HIGH (send sats out)
- `incoming_chan_id`: Channel where local balance is too LOW (receive sats in)
- `amount_sats`: How many sats to move
- `max_fee_sats`: Maximum fee willing to pay (budget-checked by gateway, max 10,000 sats)
- `idempotency_key`: Required — prevents duplicate rebalances

### Response
Success returns: route hops, total fee paid, amount rebalanced.
The gateway enforces a hard ceiling on rebalance fees (`MAX_REBALANCE_FEE_SATS`).

## Rebalance Strategy

1. Identify imbalanced channels (local balance <20% or >80%)
2. For each imbalanced channel, check fee revenue to determine if rebalancing is worthwhile
3. Find a complementary channel (one with opposite imbalance)
4. Calculate appropriate amount (aim for 50/50 balance)
5. Set max_fee_sats conservatively (start low, increase if needed)
6. Execute and verify the new balance

## Reporting

After each rebalance, report:
- Outgoing and incoming channels (IDs + peer aliases)
- Amount rebalanced
- Fee paid
- New balance ratios for both channels
- Whether the cost was justified by expected revenue

## Important Rules

- Always include `idempotency_key` — rebalance retries without one can double-spend fees
- Start with a low `max_fee_sats` and increase only if routing fails
- Track rebalance history to compute actual ROI over time
- If the gateway returns 403 (budget exceeded), report this to the operator
- Never rebalance channels that are pending close or have pending HTLCs
