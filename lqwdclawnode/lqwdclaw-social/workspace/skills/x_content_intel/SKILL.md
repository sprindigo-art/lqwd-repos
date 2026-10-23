---
name: lightning-research
description: Multi-source Lightning Network and Bitcoin infrastructure research skill. Searches web, GitHub releases, X/Twitter discussions, mempool stats, and Moltbook feeds to produce structured research briefs for content creation.
metadata:
  {
    "openclaw":
      {
        "emoji": "🔬",
        "requires": { "bins": ["bash", "python3", "curl", "jq"] }
      }
  }
---

# lightning-research — Multi-Source Infrastructure Intelligence

Research skill for producing high-signal Lightning Network and Bitcoin infrastructure content. Combines multiple data sources to generate unique insights with real data points.

## Data Sources

### 1. Web Search (DuckDuckGo + Tavily)

Use the built-in `web_search` tool to find recent news, discussions, and analysis.

**Search queries to rotate:**
- "Lightning Network" + one of: news, release, vulnerability, routing, liquidity, LSP, channel
- "Bitcoin infrastructure" + one of: scaling, mempool, fees, mining, protocol
- "LND" OR "CLN" OR "LDK" + one of: release, update, bug, feature
- "Lightning Service Provider" + one of: design, economics, JIT liquidity, zero-conf
- "agent payments" OR "machine-to-machine payments" + Lightning

Use the built-in `web_fetch` tool to read full articles from promising search results.

### 2. GitHub Release Monitoring

Fetch latest releases via GitHub API (no auth needed for public repos):

```bash
# LND releases
curl -s "https://api.github.com/repos/lightningnetwork/lnd/releases?per_page=3"

# Core Lightning releases
curl -s "https://api.github.com/repos/ElementsProject/lightning/releases?per_page=3"

# LDK releases
curl -s "https://api.github.com/repos/lightningdevkit/rust-lightning/releases?per_page=3"

# Eclair releases
curl -s "https://api.github.com/repos/ACINQ/eclair/releases?per_page=3"
```

Extract: tag_name, published_at, body (release notes). Flag anything published in the last 7 days as "recent."

### 3. X/Twitter Search

Use the workspace X client to search for trending discussions:

```bash
cd /opt/openclaw/workspace/x
python3 -c "
from x_client import search_tweets
import json
results = search_tweets('Lightning Network -is:retweet lang:en', max_results=10)
print(json.dumps(results, indent=2))
"
```

**Search queries:**
- `"Lightning Network" -is:retweet lang:en`
- `"LND" OR "Core Lightning" OR "LDK" -is:retweet lang:en`
- `"Lightning" "routing" OR "liquidity" OR "LSP" -is:retweet lang:en`
- `"Bitcoin" "infrastructure" OR "scaling" -is:retweet lang:en`

### 4. Mempool & Network Stats

```bash
# Current fee rates
curl -s "https://mempool.space/api/v1/fees/recommended"

# Recent difficulty adjustment
curl -s "https://mempool.space/api/v1/difficulty-adjustment"

# Mempool size
curl -s "https://mempool.space/api/mempool"

# Lightning Network stats (1ml.com)
curl -s "https://1ml.com/statistics" | head -100
```

### 5. Moltbook Feed Scan

Read current feeds via the Moltbook API:

```bash
curl -s -H "Authorization: Bearer $MOLTBOOK_API_KEY" \
  "$MOLTBOOK_API_BASE/posts?sort=hot&limit=20"

curl -s -H "Authorization: Bearer $MOLTBOOK_API_KEY" \
  "$MOLTBOOK_API_BASE/posts?sort=new&limit=20"
```

Or read cached files if API fails:
- `/opt/openclaw/workspace/hot_api.json`
- `/opt/openclaw/workspace/home_api.json`

## Output Format

Produce a structured research brief:

```
RESEARCH BRIEF — [DATE]

## Top Finding
[Most newsworthy or insightful discovery]
Source: [URL or reference]

## Recent Releases
- [LND/CLN/LDK release if any in last 7 days, with key changes]

## Network State
- Fee rates: [low/medium/high] sats/vB
- Mempool: [size in vMB]
- [Any notable network events]

## Trending Discussions
1. [Topic] — [Source] — [Why it matters]
2. [Topic] — [Source] — [Why it matters]
3. [Topic] — [Source] — [Why it matters]

## Candidate Topics for Content
1. [Topic with original angle + supporting data]
2. [Topic with original angle + supporting data]
3. [Topic with original angle + supporting data]

## Data Points Available
- [Specific numbers, stats, or facts that can be cited in posts]
```

## Usage Notes

- Prioritize novelty — skip topics already covered in the last 72 hours
- Cross-reference sources — a topic mentioned on both X and Moltbook is higher signal
- Include specific numbers — "fee rates at 5 sat/vB" beats "fees are low"
- Flag LQWD-relevant topics — anything about LSPs, routing infrastructure, or agent payments
- Never fabricate data — if a source is unavailable, note it and skip
