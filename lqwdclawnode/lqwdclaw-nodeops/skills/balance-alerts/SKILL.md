---
name: balance-alerts
description: Threshold warnings when on-chain or channel balances cross configurable limits
---

# Balance Alerts

Monitor balances and alert when they cross warning thresholds.

## Check All Balances

### On-Chain Balance
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/wallet/balance \
  -d '{}' | jq .
```

### Channel Balance
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/wallet/channel-balance \
  -d '{}' | jq .
```

### Daily Spend (from audit)
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/audit/recent \
  -d '{}' | jq .
```

## Alert Thresholds

### On-Chain Balance
| Level | Condition | Action |
|-------|-----------|--------|
| INFO | Confirmed balance < 1,000,000 sats | Note — limited funds for channel opens |
| WARNING | Confirmed balance < 500,000 sats | Alert — may not cover emergency channel close fees |
| CRITICAL | Confirmed balance < 100,000 sats | Alert immediately — on-chain operations impossible |

### Channel Balance (aggregate)
| Level | Condition | Action |
|-------|-----------|--------|
| INFO | Total local < 20% of total capacity | Note — outbound liquidity running low |
| WARNING | Total local < 10% of total capacity | Alert — cannot route outbound |
| INFO | Total remote < 20% of total capacity | Note — inbound liquidity running low |
| WARNING | Total remote < 10% of total capacity | Alert — cannot receive payments |

### Daily Spend
| Level | Condition | Action |
|-------|-----------|--------|
| INFO | Daily spend > 50% of ceiling | Note — over half of daily budget used |
| WARNING | Daily spend > 80% of ceiling | Alert — approaching daily limit |
| CRITICAL | Daily spend > 95% of ceiling | Alert — operations will be blocked soon |

### Pending Balance
| Level | Condition | Action |
|-------|-----------|--------|
| INFO | Unconfirmed on-chain balance > 0 | Note — incoming transaction pending |
| WARNING | Pending open channel balance > 0 | Note — channel open in progress |

## How to Present

### Normal state
```
Balance Report — All Clear

On-Chain: 4,500,000 sats (0.045 BTC) confirmed
Lightning: 15,000,000 sats local / 10,000,000 sats remote
Daily spend: 1,200,000 / 10,000,000 sats (12%)
Total node value: ~29,500,000 sats (0.295 BTC)
```

### Warning state
```
Balance Alert — WARNING

On-Chain: 400,000 sats — LOW (< 500,000 sats threshold)
  Risk: May not cover emergency force-close on-chain fees.
  Action: Consider depositing funds or closing unproductive channels.

Lightning: 1,500,000 sats local / 23,500,000 sats remote
  Outbound ratio: 6% — LOW (< 10% threshold)
  Action: Consider rebalancing channels.

Daily spend: 8,500,000 / 10,000,000 sats (85%) — APPROACHING LIMIT
  Action: Non-urgent operations should wait until tomorrow.
```

### Critical state
```
CRITICAL BALANCE ALERT

On-Chain: 50,000 sats — CRITICALLY LOW
  On-chain operations are effectively impossible.
  Emergency force-closes will fail without more funds.
  IMMEDIATE ACTION: Deposit Bitcoin to the node's on-chain wallet.
```

## When to Run
- Every 30 minutes (automated)
- After any payment or on-chain send
- After channel opens/closes
- When the operator asks about balance status
- At the start of each day (daily summary)
