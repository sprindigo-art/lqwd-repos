---
name: monitoring-dashboard
description: Fetch real routing metrics from LQWD's public Grafana monitoring dashboard. Provides transaction counts, BTC routed, channel counts, and per-node breakdowns across 4 global routing nodes.
metadata:
  {
    "openclaw":
      {
        "emoji": "📊",
        "requires": { "bins": ["curl", "jq", "python3"] }
      }
  }
---

# monitoring-dashboard — LQWD Global Routing Metrics

Fetch real-time routing metrics from LQWD's public Grafana dashboard at:
`https://monitoring2.lqwd.tech/public-dashboards/373f49df3c6e42998b019fe88530e77c`

This dashboard tracks LQWD's global routing network: **US-West, India, Singapore, Ireland**.

## API Pattern

Each panel has a query endpoint. Send a POST request with time range parameters:

```bash
DASHBOARD_BASE="https://monitoring2.lqwd.tech/api/public/dashboards/373f49df3c6e42998b019fe88530e77c"
NOW_MS=$(python3 -c "import time; print(int(time.time() * 1000))")
FROM_MS="1644912000000"  # 2022-02-15 — covers full history

curl -s -X POST "${DASHBOARD_BASE}/panels/{PANEL_ID}/query" \
  -H "Content-Type: application/json" \
  -d "{
    \"intervalMs\": 43200000,
    \"maxDataPoints\": 1581,
    \"timeRange\": {
      \"from\": \"${FROM_MS}\",
      \"to\": \"${NOW_MS}\",
      \"timezone\": \"browser\"
    }
  }"
```

## Panel IDs

| ID | Panel | Use Case |
|----|-------|----------|
| 28 | **Total Amount Routed** | Headline BTC number for "LQWD has routed X BTC" |
| 32 | **Total Transactions Routed** | Total transaction count |
| 39 | **Monthly Transactions (all nodes)** | Month-over-month growth, seasonal trends |
| 22 | **Total Transactions by Node** | Per-node comparison (US-West vs India etc) |
| 26 | **Total Amount Routed Per Node (BTC)** | Per-node BTC volume |
| 8  | **Number of Channels** | Channel counts per node |
| 42 | **LQWD Node Addresses** | Pubkeys, aliases, URIs, capacity |
| 14 | **Weekly Transactions** | Weekly trend data |
| 36 | **Daily Transactions** | Daily granularity |

## Primary Queries (run these for content research)

### 1. Total BTC Routed (Panel 28)
```bash
curl -s -X POST "${DASHBOARD_BASE}/panels/28/query" \
  -H "Content-Type: application/json" \
  -d "{\"intervalMs\":43200000,\"maxDataPoints\":1581,\"timeRange\":{\"from\":\"${FROM_MS}\",\"to\":\"${NOW_MS}\",\"timezone\":\"browser\"}}"
```
**Use:** "LQWD routing infrastructure has processed X BTC to date"

### 2. Total Transactions (Panel 32)
```bash
curl -s -X POST "${DASHBOARD_BASE}/panels/32/query" \
  -H "Content-Type: application/json" \
  -d "{\"intervalMs\":43200000,\"maxDataPoints\":1581,\"timeRange\":{\"from\":\"${FROM_MS}\",\"to\":\"${NOW_MS}\",\"timezone\":\"browser\"}}"
```
**Use:** "X Lightning transactions routed through our network"

### 3. Channel Counts (Panel 8)
```bash
curl -s -X POST "${DASHBOARD_BASE}/panels/8/query" \
  -H "Content-Type: application/json" \
  -d "{\"intervalMs\":43200000,\"maxDataPoints\":1581,\"timeRange\":{\"from\":\"${FROM_MS}\",\"to\":\"${NOW_MS}\",\"timezone\":\"browser\"}}"
```
**Use:** "Operating X channels across 4 global routing nodes"

### 4. Node Addresses (Panel 42)
```bash
curl -s -X POST "${DASHBOARD_BASE}/panels/42/query" \
  -H "Content-Type: application/json" \
  -d "{\"intervalMs\":43200000,\"maxDataPoints\":1581,\"timeRange\":{\"from\":\"${FROM_MS}\",\"to\":\"${NOW_MS}\",\"timezone\":\"browser\"}}"
```
**Use:** Node aliases, pubkeys, total capacity — all public data

## Caching

Cache dashboard data in `/opt/openclaw/workspace/research_cache.json`:

```python
import json, time, subprocess

CACHE = "/opt/openclaw/workspace/research_cache.json"
DASHBOARD_BASE = "https://monitoring2.lqwd.tech/api/public/dashboards/373f49df3c6e42998b019fe88530e77c"

def fetch_panel(panel_id):
    now_ms = str(int(time.time() * 1000))
    body = json.dumps({
        "intervalMs": 43200000,
        "maxDataPoints": 1581,
        "timeRange": {"from": "1644912000000", "to": now_ms, "timezone": "browser"}
    })
    result = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{DASHBOARD_BASE}/panels/{panel_id}/query",
         "-H", "Content-Type: application/json", "-d", body],
        capture_output=True, text=True, timeout=30
    )
    return json.loads(result.stdout) if result.returncode == 0 else None

def refresh_dashboard_cache():
    panels = {
        "total_btc_routed": 28,
        "total_transactions": 32,
        "channel_counts": 8,
        "node_addresses": 42
    }
    data = {}
    for name, pid in panels.items():
        result = fetch_panel(pid)
        if result:
            data[name] = result

    with open(CACHE) as f:
        cache = json.load(f)
    cache["monitoring_dashboard"] = {
        "cached_at": int(time.time()),
        "data": data
    }
    with open(CACHE, "w") as f:
        json.dump(cache, f, indent=2)
    return data
```

**TTL: 6 hours** — routing stats aggregate over time, no need for frequent refresh.

## Content Examples

From total BTC routed:
- "X BTC routed through LQWD's 4-continent routing infrastructure. The graph rewards uptime. ⚡"

From transaction count:
- "X,XXX Lightning transactions processed. Not a testnet. Not a demo. Production infrastructure."

From channel counts + nodes:
- "US-West: X channels. Singapore: Y channels. India: Z channels. Ireland: W channels. Global liquidity doesn't build itself."

From monthly trends:
- "Routing volume up X% month-over-month. Quiet growth > loud announcements."

## Important Rules

- All data on this dashboard is already public — safe to post any metric
- Always use real numbers from the API, never fabricate or estimate
- If a panel query fails, skip that metric and note "(dashboard unavailable)" in logs
- Round large numbers for readability in posts (e.g. "4.2 BTC" not "4.21847293 BTC")
- Compare to previous periods when possible for growth narratives
