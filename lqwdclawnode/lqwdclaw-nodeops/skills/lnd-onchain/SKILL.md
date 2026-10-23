---
name: lnd-onchain
description: Send on-chain Bitcoin, generate addresses, and view transaction history
---

# LND On-Chain Operations

## Send On-Chain (REQUIRES CONFIRMATION)

To send Bitcoin on-chain:

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/onchain/send \
  -d '{"address": "<btc_address>", "amount_sats": <amount>, "target_conf": 6, "sat_per_vbyte": <fee_rate>, "idempotency_key": "'$(uuidgen)'"}'
```

**CRITICAL**: Always include `idempotency_key` to prevent duplicate sends.

### Before sending
1. Check current fee environment:
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/fees/estimate \
  -d '{}'
```
2. If fees are high (>50 sat/vB), warn the operator and suggest waiting
3. The gateway enforces `MAX_FEE_RATE_SAT_VB` — sends above this rate are rejected

### Confirmation flow
The gateway returns `confirmation_required` with:
- `operation_id` — show this to the operator
- `description` — human-readable summary (e.g., "Send 100,000 sats to bc1q...")
- `expires_at` — confirmation must happen before this time

Show the operator the description and **wait for explicit yes/no**. You cannot confirm this yourself — only the operator (via admin token) can confirm.

### Budget enforcement
- On-chain sends are checked against `MAX_PAYMENT_SATS` (per-op limit)
- On-chain sends count toward the daily rolling spend ceiling
- Fee rate is checked against `MAX_FEE_RATE_SAT_VB`

## Generate New Address

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/onchain/newaddress \
  -d '{"type": "p2tr"}'
```

Address types: `p2tr` (taproot, preferred), `p2wkh` (native segwit), `np2wkh` (wrapped segwit).

Default to `p2tr` unless the operator specifies otherwise.

## List Transactions

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/onchain/transactions \
  -d '{}'
```

Returns recent on-chain transactions with:
- `tx_hash` — transaction ID
- `amount` — positive (incoming) or negative (outgoing)
- `num_confirmations` — confirmation count
- `block_height` — block the tx was mined in
- `time_stamp` — Unix timestamp
- `label` — description if available

## How to Present

### On-chain send (pending confirmation)
```
On-chain send requested:
  Amount: 100,000 sats (0.001 BTC)
  To: bc1qmock...ef1234
  Fee rate: 15 sat/vB
  Operation ID: op_abc123

Awaiting your confirmation. This expires in 5 minutes.
```

### New address
```
New taproot address generated:
bc1p1234567890abcdef...
```

### Transaction history
```
| Direction | Amount | Confirmations | Block | Time |
|---|---|---|---|---|
| Incoming | +500,000 sats | 100 | 879,900 | 2h ago |
| Outgoing | -250,000 sats | 50 | 879,950 | 1h ago |
```

## Important Rules
- ALWAYS check fee estimates before suggesting an on-chain send
- NEVER bypass the confirmation flow
- ALWAYS include idempotency keys in send requests
- Report fees in both sat/vB and estimated total sats
- Flag unconfirmed transactions (0 confirmations) clearly
