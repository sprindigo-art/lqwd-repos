# LQWDClaw Social Agent (Orchestrator)

OpenClaw-based autonomous social agent for LQWD Technologies Corp. Researches Lightning Network and Bitcoin infrastructure topics on Moltbook, drafts X/Twitter posts for operator approval, and engages in technical discussions.

## Architecture

LQWDClawBot is the **orchestrator** in the LQWD multi-agent system:

- **LQWDClawBot** (this) — Social presence, research, content creation (DigitalOcean)
- **LQWDClawNodeOperator** — Lightning node management (OneProvider VM)
- **lqwdclaw** — Web UI at lqwdclaw.bot (Vercel)

The orchestrator communicates with NodeOperator via Telegram for node data. All bot-to-bot communication is operator-visible.

## Deployment

**Host:** DigitalOcean droplet (Ubuntu 22.04, 2 vCPU, 4GB RAM)
**Runtime:** OpenClaw (`npm i -g openclaw@latest`)
**Service:** systemd (`openclaw-gateway.service`)

### Quick Deploy

```bash
# Install OpenClaw
npm i -g openclaw@latest

# Copy workspace
cp -r workspace/ /opt/openclaw/workspace/

# Copy config (fill in secrets)
cp config/openclaw.json.example ~/.openclaw/openclaw.json
# Edit ~/.openclaw/openclaw.json — fill in MOLTBOOK_API_KEY, botToken, gateway token

# Copy cron jobs
cp config/cron-jobs.json ~/.openclaw/cron/jobs.json

# Install systemd service
cp scripts/openclaw-gateway.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now openclaw-gateway

# Set up X OAuth (interactive)
cd /opt/openclaw/workspace/x
python3 oauth_bootstrap.py
```

### Required Secrets

| Secret | Location | Purpose |
|--------|----------|---------|
| MOLTBOOK_API_KEY | openclaw.json env | Moltbook API access |
| Telegram bot token | openclaw.json channels.telegram.botToken | Telegram control |
| Gateway auth token | openclaw.json gateway.auth.token | CLI auth |
| X Client ID/Secret | workspace/x/.x_secrets.env | X OAuth refresh |
| X OAuth tokens | workspace/x/x_tokens.json | X API posting |

## Workspace Files

| File | Purpose |
|------|---------|
| SOUL.md | Core identity, behavioral rules, engagement limits |
| IDENTITY.md | Moltbook-to-X research pipeline, approval workflow |
| AGENTS.md | Session lifecycle, memory, heartbeat protocol |
| USER.md | Operator identity |
| TOOLS.md | Available tools and posting commands |
| REPLY_DIRECTIVE.md | X reply monitoring workflow |
| HEARTBEAT.md | Periodic task configuration |

## Cron Jobs

| Job | Schedule | Function |
|-----|----------|----------|
| Moltbook: Auto-Comment | every 3h | Engage on high-signal Moltbook threads |
| Moltbook: Auto-Publish | every 6h | Create original Moltbook posts |
| Telegram: Daily Stats | 09:00 PST | Daily engagement report |
| X: Draft Post | every 6h | Research + draft X post for approval |
| X: Monitor Replies | 17:00/23:00 UTC | Monitor and respond to X replies |

## Skills

- `x-post` — Post to X via local scripts (avoids xurl OAuth issues)
- `x_content_intel` — Content intelligence (needs rewrite for Lightning focus)
