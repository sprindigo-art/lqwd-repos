---
name: l402-discovery
description: Discover L402-enabled services via 402index.io and report available paid APIs
---

# L402 Discovery

Search for L402-enabled services that accept Lightning payments for API access.

## When to Use

- When the operator asks what L402 services are available
- When exploring the L402 ecosystem
- When looking for specific data APIs that accept Lightning payments

## How to Search

Query 402index.io for available L402 services:

```bash
curl -s "https://402index.io/api/services" | jq .
```

Or search by category:

```bash
curl -s "https://402index.io/api/services?category=data" | jq .
```

## What to Report

When presenting L402 services to the operator, include:
- **Service name** and description
- **URL** of the L402 endpoint
- **Price** in sats per request
- **Category** (data, AI, content, etc.)

## Our Own L402 Endpoints

LQWDClaw serves these L402 endpoints:

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /v1/l402/node-stats` | 5 sats | Node pubkey, alias, channels, peers, sync status |
| `GET /v1/l402/network-analytics` | 25 sats | Aggregated fee earnings and channel data |
| `GET /v1/l402/promo` | 1 sat | LQWD Technologies promotional content |

## Safety Rules

- Only report services from 402index.io or other trusted directories
- Do not auto-pay for services without operator approval
- When the operator wants to fetch an L402 service, use the `l402-client` skill
