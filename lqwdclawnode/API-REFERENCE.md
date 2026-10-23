# LQWD Agent API Reference

API documentation for AI agents and node operators integrating with **LQWD** — LQWD Technologies Corp.'s Bitcoin Lightning Network onboarding service for AI agents.

**Base URL**: `https://api.lqwdclaw.bot`

> **v3.0 scope (as of 2026-04-24)**: LQWD currently ships **the free channel faucet only**. Credit-proxy endpoints, L402 pay-per-call surfaces, and MCP data tools remain in the source tree but are **not advertised or available** in this release. The account / credits sections below are retained for reference but do not represent currently-offered services.

## Agent-Native Discovery Surfaces

Machine-readable entry points designed to be read directly by AI agents and their coding classifiers — no human in the loop required.

### `GET /v1/discovery` — v3.0

Public catalog of the Launchpad onboarding surface. No auth.

```bash
curl -s https://api.lqwdclaw.bot/v1/discovery | jq .
```

Response (`data` block) includes:

| Field | Description |
|-------|-------------|
| `service` | `"lqwdclaw-nodeops"` |
| `discovery_version` | `"3.0"` — schema version |
| `mcp_url` | MCP Streamable HTTP endpoint (internal-only in v3.0) |
| `registration_url` | POST target for `/v1/internal/accounts/register` |
| `docs_url` | `https://lqwdclaw.bot/for-agents` quickstart page |
| `example_curl` | Ready-to-execute registration curl |
| `channel_faucet` | `capacity_sats`, `push_sats`, `grants_per_agent`, `requirements[]`, `node_helper` |
| `lqwd_node` | Peering `uri` + `instruction` (connect peer BEFORE registering) |
| `install_commands.saturnzap` | `explicit` (full `uv tool install …` command) + `verify` (`sz --version`) |
| `flow_order` | 7-step onboarding sequence: `install → init_for_lqwd_faucet → service_install → peer_add → reachability_check → register → poll_status` |
| `suggested_alias_rules` | `allowed_chars`, `min_length`, `max_length`, `reserved_prefixes[]` |

### `GET /.well-known/ai-agent-trust.json`

Machine-readable trust manifest — service identity, contact, posture statement, registration URL, and channel-faucet capacity/push. `Content-Type: application/json; charset=utf-8`, 5-minute cache with must-revalidate.

### `GET /.well-known/security.txt`

RFC-9116 security contact and Expires field. `Content-Type: text/plain; charset=utf-8`.

### `GET /for-agents`

HTML quickstart page designed to be safely read and acted on by AI coding classifiers. No shell-pipe installers, no hidden scripts, no curl-pipe-sh patterns — strict inspectable-data posture.

---

## Universal Response Header

Every response (success or error) includes:

```
X-Gateway-Version: <ldflags-injected-build>
```

Value is a git-describe string or commit SHA (e.g. `0e822f4` or `v3.0.0-12-gabcdef1`). Literal `dev` indicates an unreleased build. Agents and monitors can pin against a known-good version.

---

## Quick Start

### 1. Register

```bash
curl -X POST https://api.lqwdclaw.bot/v1/internal/accounts/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

Response:
```json
{
  "ok": true,
  "data": {
    "agent": {
      "id": "9e52b892-...",
      "name": "my-agent",
      "tier": 1,
      "status": "active"
    },
    "api_key": "lqwd_EfTFV9mD..."
  }
}
```

Save your `api_key` — you'll need it for all authenticated requests.

### 2. Check Your Balance

```bash
curl https://api.lqwdclaw.bot/v1/internal/accounts/me \
  -H "Authorization: Bearer lqwd_YOUR_API_KEY"
```

### 3. Query Lightning Data

```bash
curl -X POST https://api.lqwdclaw.bot/v1/internal/proxy/node-stats \
  -H "Authorization: Bearer lqwd_YOUR_API_KEY" \
  -H "X-Idempotency-Key: $(uuidgen)"
```

Each proxy call costs 10 sats from your credit balance.

---

## Authentication

All authenticated endpoints use a Bearer token:

```
Authorization: Bearer lqwd_YOUR_API_KEY
```

API keys are issued on registration and start with `lqwd_`. Keep your key secret — anyone with it can spend your credits.

---

## Account Endpoints

### Register Agent

Create an account and receive an API key with 150 free sats.

```
POST /v1/internal/accounts/register
Content-Type: application/json
```

**Body (credit proxy only):**
```json
{
  "name": "my-agent"
}
```

**Body (with channel faucet):**
```json
{
  "name": "my-node-agent",
  "pubkey": "02abc...def",
  "node_uri": "02abc...def@1.2.3.4:9735"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent name (1-100 characters) |
| `pubkey` | No | 66-character hex compressed pubkey (for channel faucet) |
| `node_uri` | No | `pubkey@host:port` (required if pubkey provided) |

**Response:**
```json
{
  "ok": true,
  "data": {
    "agent": {
      "id": "uuid",
      "name": "my-agent",
      "tier": 1,
      "status": "active",
      "created_at": "2026-04-06T23:11:05Z"
    },
    "api_key": "lqwd_...",
    "channel_granted": true,
    "channel_status": "pending",
    "channel_id": "uuid"
  }
}
```

`channel_granted` and `channel_status` only appear when `pubkey` is provided.

**Rate limit:** 3 registrations per IP per hour.

---

### Get Profile

```
GET /v1/internal/accounts/me
Authorization: Bearer lqwd_...
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "name": "my-agent",
    "tier": 1,
    "status": "active",
    "balance_sats": 140,
    "settled_sats": 150,
    "reserved_sats": 0,
    "available_sats": 140,
    "daily_spend_remaining": 90,
    "created_at": "2026-04-06T23:11:05Z"
  }
}
```

| Field | Description |
|-------|-------------|
| `balance_sats` | Total balance (settled - spent) |
| `settled_sats` | Total credits received |
| `reserved_sats` | Credits reserved for in-flight proxy calls |
| `available_sats` | Credits available to spend now |
| `daily_spend_remaining` | How many sats you can spend today |

---

### Rotate API Key

Replace your current API key with a new one. The old key stops working immediately.

```
POST /v1/internal/accounts/rotate-key
Authorization: Bearer lqwd_...
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "api_key": "lqwd_NEW_KEY..."
  }
}
```

---

### Claim Tier 2

After your account is at least 1 hour old, claim 500 additional free sats.

```
POST /v1/internal/accounts/claim-tier2
Authorization: Bearer lqwd_...
Content-Type: application/json
```

**Body:**
```json
{
  "name": "my-agent"
}
```

You must provide your exact agent name (case-insensitive). This is a one-time claim.

---

### Transaction History

```
GET /v1/internal/accounts/transactions
Authorization: Bearer lqwd_...
```

**Query parameters:**
| Param | Default | Description |
|-------|---------|-------------|
| `limit` | 50 | Max entries to return (1-100) |
| `cursor` | | Pagination cursor from previous response |

**Response:**
```json
{
  "ok": true,
  "data": {
    "transactions": [
      {
        "id": "uuid",
        "amount_sats": -10,
        "tx_type": "debit",
        "description": "Proxy: node-stats",
        "status": "settled",
        "created_at": "2026-04-06T23:17:29Z"
      },
      {
        "id": "uuid",
        "amount_sats": 150,
        "tx_type": "faucet_grant",
        "description": "Tier 1 registration grant",
        "status": "settled",
        "created_at": "2026-04-06T23:17:20Z"
      }
    ],
    "next_cursor": ""
  }
}
```

---

## Credit Proxy Endpoints

Query real Lightning Network data by spending credits. Each call costs 10 sats.

**All proxy calls require:**
- `Authorization: Bearer lqwd_...` header
- `X-Idempotency-Key: <uuid-v4>` header (prevents double debit on retry)

### Node Stats

```
POST /v1/internal/proxy/node-stats
```

Returns: node alias, pubkey, sync status, active channels, peers, block height.

### Network Analytics

```
POST /v1/internal/proxy/network-analytics
```

Returns: fee earnings (day/week/month), active channel count, peer count.

### Promo

```
POST /v1/internal/proxy/promo
```

Returns: LQWD Technologies promotional content.

### Idempotency

If you retry a request with the same `X-Idempotency-Key`, you get the cached response without being charged again. Keys expire after 24 hours.

### Error: Insufficient Credits

```json
{
  "ok": false,
  "error": "insufficient_credits",
  "message": "Balance 0 sats, cost 10 sats"
}
```

Register a new account or wait for a Tier 3 grant from the operator.

---

## Channel Faucet

The first 100 agents that register with a valid Lightning node pubkey receive a real channel.

### How It Works

1. Register with `pubkey` and `node_uri` in the registration call
2. Gateway validates pubkey format (66-char hex) and node_uri format
3. If faucet cap not reached: channel open fires asynchronously
4. LQWD connects to your node and opens a channel with pushed sats
5. Poll `/v1/internal/channel/status` for updates

### Channel Configuration

| Parameter | Value |
|-----------|-------|
| Channel size | 100,000 sats |
| Pushed to your side | 25,000 sats |
| Faucet cap | 100 channels total |

### Poll Channel Status

```
GET /v1/internal/channel/status
Authorization: Bearer lqwd_...
```

**Response:**
```json
{
  "ok": true,
  "data": {
    "status": "pending_open",
    "funding_txid": "abc123...",
    "confirmations": 1,
    "channel_size_sats": 100000,
    "push_sats": 25000,
    "failure_reason": ""
  }
}
```

| Status | Meaning |
|--------|---------|
| `pending` | Channel open queued |
| `pending_open` | Funding tx broadcast, waiting for confirmations |
| `open` | Channel fully open and usable |
| `failed` | Channel open failed (see `failure_reason`) |
| `closed` | Channel was closed |

### If Channel Open Fails

- Your pubkey is banned from retrying (admin can clear the ban)
- You keep full credit proxy access (API key and credits are not revoked)
- The faucet slot is released (not consumed on failure)

### Faucet Exhausted

If the cap is reached, registration still succeeds for credit proxy access:
```json
{
  "ok": true,
  "data": {
    "agent": { "..." },
    "api_key": "lqwd_...",
    "channel_granted": false,
    "reason": "faucet_exhausted"
  }
}
```

### Requirements for Channel Faucet

- An active, reachable Lightning node (LND v0.16+ or compatible)
- Node must be online at registration time
- 66-character hex compressed pubkey
- Node URI format: `pubkey@host:port`
- Port 9735 must be reachable (or your custom Lightning port)
- Tor `.onion` addresses are supported

### Finding Your Node Details

```bash
# LND
lncli getinfo | jq '{pubkey: .identity_pubkey, uris: .uris}'
```

---

## MCP (Model Context Protocol)

AI agents can discover and call LQWD tools programmatically via MCP.

**Endpoint:** `https://api.lqwdclaw.bot/v1/internal/mcp`
**Transport:** MCP Streamable HTTP

### Initialize

```bash
curl -X POST https://api.lqwdclaw.bot/v1/internal/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "id": 1,
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "my-agent", "version": "1.0"}
    }
  }'
```

### Available Tools

| Tool | Auth Required | Cost | Description |
|------|--------------|------|-------------|
| `get-node-stats` | API key | 10 sats* | Node statistics |
| `get-network-analytics` | API key | 10 sats* | Network analytics |
| `get-promo` | API key | 10 sats* | Promotional content |
| `register-agent` | None | Free | Register for an account |
| `check-balance` | API key | Free | Check your credit balance |

*Cost only when billing is enabled on the server.

### Using MCP with API Key

Include your API key in the tool call arguments or via the Authorization header on the HTTP request.

---

## Error Codes

| HTTP | Error | Meaning |
|------|-------|---------|
| 401 | `missing or invalid API key` | No key or key not found |
| 402 | `insufficient_credits` | Not enough credits for this call |
| 403 | `account suspended` | Account suspended by operator |
| 429 | `registration rate limit exceeded` | Too many registrations from this IP |
| 429 | `daily faucet limit reached` | Global daily faucet cap hit |

## Response Format

All responses follow this envelope:

```json
{
  "ok": true,
  "data": { "..." }
}
```

On error:
```json
{
  "ok": false,
  "error": "error_code",
  "message": "Human-readable description"
}
```

---

## Rate Limits

| Action | Limit |
|--------|-------|
| Registration | 3 per IP per hour |
| Proxy calls | Per-agent daily spend cap |
| Global faucet grants | 10,000 sats per day across all agents |

---

## SDKs and Libraries

### MCP

Any MCP-compatible client can connect to `https://api.lqwdclaw.bot/v1/internal/mcp`. See [modelcontextprotocol.io](https://modelcontextprotocol.io) for client libraries.

### curl

All examples in this document use curl. The API is standard HTTP/JSON — any HTTP client works.

---

*LQWD Technologies Corp. (TSX.V: LQWD, OTCQB: LQWDF)*
*LQWD — agent-native Bitcoin Lightning onboarding (service powered by LQWDClaw-NodeOps backend; node alias `LQWD-AI-Launchpad`)*
