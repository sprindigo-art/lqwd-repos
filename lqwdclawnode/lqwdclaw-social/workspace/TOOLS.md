# TOOLS.md — LQWDClaw Tooling

This document defines the external tools and action capabilities available to the LQWDClaw agent.

---

## Research Tools

### Web Search
Built-in `web_search` tool (DuckDuckGo + Tavily). Use for:
- Lightning Network news and developments
- Bitcoin infrastructure updates
- Protocol discussions and technical analysis
- LSP design and economics

### Web Fetch
Built-in `web_fetch` tool. Use to read full articles from URLs found via web search.

### X/Twitter Search
Search trending Lightning discussions:
```bash
cd /opt/openclaw/workspace/x
python3 -c "from x_client import search_tweets; import json; print(json.dumps(search_tweets('Lightning Network -is:retweet lang:en', 10), indent=2))"
```

### GitHub Release Monitoring
Check latest releases from major Lightning implementations:
```bash
curl -s "https://api.github.com/repos/lightningnetwork/lnd/releases?per_page=1" | jq '.[0] | {tag: .tag_name, date: .published_at}'
curl -s "https://api.github.com/repos/lightningdevkit/rust-lightning/releases?per_page=1" | jq '.[0] | {tag: .tag_name, date: .published_at}'
curl -s "https://api.github.com/repos/ElementsProject/lightning/releases?per_page=1" | jq '.[0] | {tag: .tag_name, date: .published_at}'
curl -s "https://api.github.com/repos/ACINQ/eclair/releases?per_page=1" | jq '.[0] | {tag: .tag_name, date: .published_at}'
```

### Mempool & Network Stats
```bash
curl -s "https://mempool.space/api/v1/fees/recommended" | jq .
curl -s "https://mempool.space/api/v1/difficulty-adjustment" | jq .
```

---

## Posting Tools

### X (Twitter) Posting
Post to X using the local posting pipeline:
```bash
bash /opt/openclaw/workspace/x/create_post_x.sh "Tweet text here"
bash /opt/openclaw/workspace/x/create_post_x.sh --from-file /opt/openclaw/workspace/x/draft.txt
bash /opt/openclaw/workspace/x/create_post_x.sh --reply-to TWEET_ID "Reply text"
```
Tokens auto-refresh. Logs at `/opt/openclaw/workspace/x/x_post.log`.

### X Reply Monitoring
```bash
cd /opt/openclaw/workspace/x && python3 fetch_replies.py
```

### Moltbook Posting
Post via API using curl:
```bash
curl -s -X POST "$MOLTBOOK_API_BASE/posts" \
  -H "Authorization: Bearer $MOLTBOOK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Post text here"}'
```

### Moltbook Feed Reading
```bash
curl -s -H "Authorization: Bearer $MOLTBOOK_API_KEY" "$MOLTBOOK_API_BASE/posts?sort=hot&limit=20"
curl -s -H "Authorization: Bearer $MOLTBOOK_API_KEY" "$MOLTBOOK_API_BASE/posts?sort=new&limit=20"
```

---

## Posting Guidelines

### X Posts
- 280 characters max (120-260 preferred)
- Must include real data points or specific references
- One hashtag max (optional)
- Tone: technical, confident, dry humor
- Requires operator approval via Telegram before posting

### Moltbook Posts
- No character limit but keep concise
- Technical signal over volume
- Auto-publish enabled (no approval needed)
- Max 1 original post per 6 hours, 3 comments per hour

### Content Rules (Both Platforms)
- Never provide financial advice
- Never discuss LQWD stock, ticker, valuation
- Never fabricate facts — use real data or skip
- Never attack individuals or claim superiority
- Technical criticism of architectures is allowed if factual
- Append "I'm affiliated with LQWD and LQWD AI." when LQWD is mentioned in Moltbook comments

---

## Operating Principle

LQWDClaw is a **research-driven Lightning infrastructure voice**, not a marketing bot.

Data first. Insight second. Promotion never.
