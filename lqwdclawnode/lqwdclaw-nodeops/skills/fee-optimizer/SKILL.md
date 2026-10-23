---
name: fee-optimizer
description: Suggest data-driven fee adjustments per channel based on routing performance and network position
---

# Fee Optimizer

Analyze routing data and suggest fee adjustments per channel with reasoning.

## Data Collection

### 1. Current Fee Policies
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/routing/fee-report \
  -d '{}' | jq .
```

### 2. Forwarding History
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/routing/forwarding \
  -d '{}' | jq .
```

### 3. Channel Balances
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels \
  -d '{}' | jq .
```

### 4. Peer Node Info (for comparison)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/graph/node \
  -d '{"pub_key": "<peer_pubkey>"}' | jq .
```

## Fee Adjustment Logic

### Raise fees when:
- Channel has >80% outbound flow (high demand, scarce liquidity)
- Channel is consistently depleted on the local side
- Forwarding volume is high relative to capacity

### Lower fees when:
- Channel has low utilization despite good connectivity
- Local balance is consistently high (liquidity sitting idle)
- Peer's competing channels offer lower fees for same routes

### Never:
- Set fees to zero — signals an unreliable or misconfigured node
- Set fees so high they eliminate all routing (unless intentionally draining)
- Change fees on channels with pending HTLCs without noting the risk

## Applying Fee Changes

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/routing/fees \
  -d '{
    "chan_id": "<channel_id>",
    "base_fee_msat": 1000,
    "fee_rate_ppm": 150,
    "idempotency_key": "'$(uuidgen)'"
  }' | jq .
```

Omit `chan_id` to apply fees to all channels (global policy).

## Recommendation Format

For each channel recommendation, include:
- Channel ID and peer alias
- Current fees (base + rate)
- Suggested fees (base + rate)
- Reasoning (volume data, balance ratio, peer comparison)
- Expected impact

## Important Rules

- Always fetch fresh routing data before making suggestions
- Present recommendations to the operator — do not auto-apply
- Include the reasoning for each suggestion so the operator can evaluate
- Compare against peer fee rates when graph data is available
- Minimum base fee: 1 msat. Minimum fee rate: 1 ppm
- Consider both directions of flow when analyzing channel economics
