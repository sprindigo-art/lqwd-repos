---
name: l402-client
description: Pay for and consume L402-protected API endpoints via the gateway's /v1/l402/pay endpoint
---

# L402 Client

Fetch data from L402-protected endpoints by paying Lightning invoices through the gateway.

## When to Use

- When the operator asks you to fetch data from an L402-protected URL
- When another skill needs data from a paid API endpoint
- When testing L402 connectivity

## How It Works

The gateway handles the full L402 flow:
1. You send the target URL and a max payment amount
2. Gateway fetches the URL, detects 402, extracts the invoice
3. Gateway pays the invoice via LND (budget-checked)
4. Gateway retries with the L402 token and returns the result

You do NOT need to parse macaroons or pay invoices yourself.

## Usage

```bash
curl -s -X POST http://127.0.0.1:7778/v1/l402/pay \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/api/data",
    "max_sats": 50,
    "idempotency_key": "l402-fetch-example-001"
  }' | jq .
```

## Parameters

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | The L402-protected URL to fetch |
| `max_sats` | Yes | Maximum sats willing to pay (budget guard) |
| `idempotency_key` | No | Prevents duplicate payments on retry |

## Response

```json
{
  "ok": true,
  "data": {
    "url": "https://example.com/api/data",
    "paid_sats": 5,
    "payment_hash": "abc123...",
    "response": { "...": "the data from the L402 endpoint" }
  }
}
```

## Budget Enforcement

- Per-payment limit: `MAX_L402_PAYMENT_SATS` (default 1000 sats)
- Counts against the daily spend ceiling
- If budget exceeded, returns error with reason

## Safety Rules

- Always set `max_sats` to the minimum you expect the endpoint to cost
- Use idempotency keys to prevent double-paying on retries
- Only fetch URLs the operator has approved or that come from trusted sources (402index.io)
- Report the amount paid and payment hash to the operator
