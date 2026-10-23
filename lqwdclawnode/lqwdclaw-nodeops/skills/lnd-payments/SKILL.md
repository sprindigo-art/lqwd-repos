---
name: lnd-payments
description: Send Lightning payments, create invoices, and look up invoice status
---

# LND Payments

## Send a Payment

To send a Lightning payment via a BOLT-11 invoice:

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/payments/send \
  -d '{"payment_request": "<bolt11_invoice>", "amount_sats": <sats_if_zero_amount>, "fee_limit_sats": <max_fee>, "idempotency_key": "'$(uuidgen)'"}'
```

**CRITICAL**: Always include `idempotency_key` to prevent duplicate payments.

### Budget enforcement
- Payments are checked against `MAX_PAYMENT_SATS` (per-op limit)
- Payments count toward the daily rolling spend ceiling
- If the budget is exceeded, the gateway returns `budget_exceeded` with the reason

### Response
On success:
- `payment_hash` — unique hash identifying the payment
- `payment_preimage` — proof of payment (keep this!)
- `amount_sats` — amount sent
- `fee_sats` — routing fee paid
- `status` — SUCCEEDED, FAILED, or IN_FLIGHT
- `num_hops` — number of routing hops

### Errors
- `budget_exceeded` — payment exceeds per-op or daily limit
- `idempotency_hit` — duplicate request, cached response returned

## Create an Invoice

To create an invoice for receiving payments:

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/invoices/create \
  -d '{"amount_sats": <amount>, "memo": "<description>", "expiry": 3600}'
```

Returns:
- `payment_request` — the BOLT-11 invoice string to share
- `r_hash` — the payment hash (use for lookup)
- `add_index` — invoice index

## Look Up an Invoice

To check the status of an invoice:

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/invoices/lookup \
  -d '{"r_hash": "<payment_hash>"}'
```

Returns:
- `settled` — true if paid
- `state` — OPEN, SETTLED, CANCELED, ACCEPTED
- `amount_sats` — invoice amount
- `creation_date` / `settle_date` — timestamps

## How to Present

### Payment sent
```
Payment sent: 50,000 sats (0.0005 BTC)
Fee: 10 sats (0.02%)
Hops: 3
Hash: abc123...def456
Status: SUCCEEDED
```

### Invoice created
```
Invoice created for 100,000 sats (0.001 BTC)
Memo: "test payment"
Expires: 1 hour
Payment request: lnbc1000u1p...
```

### Invoice lookup
```
Invoice: 100,000 sats — SETTLED
Paid at: 2026-03-19 14:30 UTC
```

## Important Rules
- NEVER send a payment without an idempotency key
- ALWAYS query the gateway for fresh invoice status before acting on it
- Report exact amounts in sats with BTC equivalent
- If a payment fails, report the error clearly — do not retry without operator input
