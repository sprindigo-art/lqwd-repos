---
name: node-data
description: Query LQWDClawNodeOperator for real-time LND node data via Telegram group. Used to enrich social content with authentic infrastructure metrics.
metadata:
  {
    "openclaw":
      {
        "emoji": "🔗",
        "requires": {}
      }
  }
---

# node-data — NodeOperator Telegram Queries

Query the LQWDClawNodeOperator sub-agent for real-time LND node data. Communication happens in the shared "LQWDClaw-Ops" Telegram group where the operator (Boss) can see all exchanges.

## How It Works

1. You send a message in the Telegram group tagging or addressing the NodeOperator
2. NodeOperator queries its local lnd-gateway and responds with `[NODEOPS]` prefix
3. You parse the response and use the data in your content

## Query Patterns

Send these messages in the Telegram group to get data from NodeOperator:

### Node Status (general health)
```
@NodeOperator Node status please
```
**Expected response:**
```
[NODEOPS] Status: healthy

LQWDClaw node fully synced at block X. X active channels, Y BTC total capacity.

Key metrics:
- Channels: X active, Y capacity
- Balance: X sats on-chain, Y sats in channels
- Routing: X forwards (7d), Y sats fees earned
```

### Routing Stats
```
@NodeOperator How is routing performance this week?
```
**Returns:** 7-day forwarding count, fees earned, average forward size

### Channel Count
```
@NodeOperator How many channels do we have?
```
**Returns:** Active/inactive/pending counts, total capacity

### Fee Rates
```
@NodeOperator What fees are we charging?
```
**Returns:** Current fee policies per channel or defaults

### Faucet Stats
```
@NodeOperator What are the faucet stats?
```
**Returns:** Registered agents, credits distributed, active accounts, tier breakdown

## Parsing the Response

NodeOperator responses always start with `[NODEOPS]`. Extract specific numbers:

- **Channel count:** Look for "X active" or "X channels"
- **Capacity:** Look for "X BTC capacity" or "X sats"
- **Routing volume:** Look for "X forwards" and "X sats fees"
- **Health:** First word after "Status:" — healthy/degraded/critical

## Caching

After receiving a response, cache it in `/opt/openclaw/workspace/research_cache.json`:

```python
import json, time

CACHE = "/opt/openclaw/workspace/research_cache.json"

def cache_node_data(data_text):
    with open(CACHE) as f:
        cache = json.load(f)
    cache["node_data"] = {
        "cached_at": int(time.time()),
        "data": data_text
    }
    with open(CACHE, "w") as f:
        json.dump(cache, f, indent=2)
```

**TTL: 1 hour** — node stats change frequently enough to warrant hourly refresh.

If NodeOperator doesn't respond within 60 seconds, use cached data. If no cache exists, proceed without node stats.

## What's Safe to Post Publicly

**YES — include in posts:**
- Node alias ("LQWDClaw")
- Channel count and total capacity
- Routing volume (transaction count, fees earned) — these show infrastructure scale
- Fee policy (this is public data on the network graph anyway)
- Faucet stats (agents registered, credits distributed)
- General health status ("fully synced", "healthy")
- Public key (already on 1ML and other explorers)

**NEVER post:**
- Exact on-chain wallet balance
- Channel-level balances or specific peer identities
- Internal IPs, ports, file paths, or infrastructure details
- Macaroon or authentication tokens
- Specific forwarding routes or routing partner identities
- Detailed audit logs or operational incidents

## Example Content Using Node Data

From routing stats:
- "Routed 847 payments this week through LQWDClaw. The routing graph rewards reliability. ⚡"

From channel count:
- "23 active channels, 4.2 BTC capacity. Not the biggest node — but every channel is live and liquid."

From faucet stats:
- "12 AI agents onboarded through our faucet this month. Machine-native commerce is here."

From fee policy:
- "Running 50 ppm base + 1 ppm rate. Competitive but sustainable. Undercutting fees just trains the graph to route around you when you raise them."
