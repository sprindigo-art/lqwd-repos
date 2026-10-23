# Tool Usage Guide

## Primary Tool: lnd-gateway HTTP API

All LND interaction goes through the gateway at `http://127.0.0.1:7778`.
Every request is a POST with JSON body (except health which is GET).
Authentication via Bearer token.

### Read Endpoints (safe, no side effects)
| Endpoint | Purpose |
|----------|---------|
| `GET /v1/health` | Gateway health, kill switch status, uptime |
| `POST /v1/info` | Node pubkey, alias, sync status, version |
| `POST /v1/wallet/balance` | On-chain balance (confirmed/unconfirmed) |
| `POST /v1/wallet/channel-balance` | Lightning balance (local/remote) |
| `POST /v1/channels` | All open channels with details |
| `POST /v1/peers` | Connected peers |
| `POST /v1/fees/estimate` | Current mempool fee estimates |
| `POST /v1/audit/recent` | Recent audit log entries |
| `POST /v1/invoices/lookup` | Look up invoice by payment hash |
| `POST /v1/onchain/newaddress` | Generate new on-chain address |
| `POST /v1/onchain/transactions` | On-chain transaction history |
| `POST /v1/routing/forwarding` | Forwarding event history |
| `POST /v1/routing/fee-report` | Per-channel fee policies and aggregate revenue |
| `POST /v1/graph/node` | Network graph info for a node by pubkey |
| `POST /v1/graph/channel` | Network graph info for a channel by chan_id |
| `POST /v1/analytics/channel-scores` | Computed channel health scores and recommendations |
| `POST /v1/audit/query` | Query audit log with filters (endpoint, time, errors) |
| `POST /v1/audit/summary` | Aggregate stats (success rate, spend, top endpoints) |
| `POST /v1/node/summary` | Aggregated node status for orchestrator/external queries |

### L402 Endpoints (separate auth — no Bearer token needed for server endpoints)
| Endpoint | Auth | Price | Purpose |
|----------|------|-------|---------|
| `GET /v1/l402/node-stats` | L402 | 5 sats | Public-safe node stats (pubkey, alias, channels, peers) |
| `GET /v1/l402/network-analytics` | L402 | 25 sats | Aggregated fee earnings and channel data |
| `GET /v1/l402/promo` | L402 | 1 sat | LQWD Technologies promotional content |
| `POST /v1/l402/pay` | Bearer | budget | Pay for an external L402 endpoint (agent client) |

**L402 server endpoints** return 402 with a macaroon + invoice. After payment, retry with `Authorization: L402 <macaroon>:<preimage>`.

**L402 client endpoint** (`/v1/l402/pay`) uses Bearer auth and handles the full flow: fetch URL → detect 402 → pay invoice → retry with token → return result. See `l402-client` skill for usage.

### Write Endpoints (modify state, budget-checked)
| Endpoint | Purpose | Confirmation |
|----------|---------|-------------|
| `POST /v1/channels/open` | Open a channel | YES — requires admin confirm |
| `POST /v1/channels/close` | Close a channel | YES — requires admin confirm |
| `POST /v1/payments/send` | Send a Lightning payment | No — budget-checked only |
| `POST /v1/invoices/create` | Create a Lightning invoice | No |
| `POST /v1/onchain/send` | Send on-chain | YES — requires admin confirm |
| `POST /v1/peers/connect` | Connect to a peer | No |
| `POST /v1/peers/disconnect` | Disconnect from a peer | No |
| `POST /v1/routing/fees` | Update channel fee policy | No — idempotency required |
| `POST /v1/rebalance` | Circular rebalance between channels | No — budget-checked |

### Agent Onboarding Endpoints (Cloudflare Access or X-Internal-Auth)

These endpoints serve external AI agents registering for LQWD services. Auth is via Cloudflare Access JWT or `X-Internal-Auth` shared secret (not Bearer token).

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /v1/internal/accounts/register` | CF/Internal | Register new agent, get `lqwd_` API key + 150 sat credit |
| `GET /v1/internal/accounts/me` | CF + API key | Agent profile with balance breakdown |
| `POST /v1/internal/accounts/rotate-key` | CF + API key | Rotate API key (old key revoked immediately) |
| `POST /v1/internal/accounts/claim-tier2` | CF + API key | Claim Tier 2 grant (500 sats, requires name + 1hr account age) |
| `GET /v1/internal/accounts/transactions` | CF + API key | Paginated credit transaction history |

### Credit Proxy Endpoints (debit agent credits for data)

| Endpoint | Auth | Cost | Purpose |
|----------|------|------|---------|
| `POST /v1/internal/proxy/node-stats` | CF + API key | 10 sats | Proxied node stats (debits credits) |
| `POST /v1/internal/proxy/network-analytics` | CF + API key | 10 sats | Proxied network analytics |
| `POST /v1/internal/proxy/promo` | CF + API key | 10 sats | Proxied promotional data |

Proxy calls require `X-Idempotency-Key` header (UUID v4). Same key returns cached response without double debit.

### Channel Faucet Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /v1/internal/channel/status` | CF + API key | Poll channel grant status (pending/open/failed) |
| `POST /v1/internal/admin/channel/unban` | CF Access | Admin: clear pubkey ban after failed channel open |

Register with pubkey + node_uri in the `/accounts/register` call to request a channel. First 100 nodes get a real Lightning channel (100,000 sats) with 25,000 sats pushed to their side.

### MCP Endpoint (AI Agent Tool Discovery)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `/v1/internal/mcp` | CF Access | MCP Streamable HTTP — tool discovery + execution |

AI agents connect via Model Context Protocol to discover available tools (node-stats, network-analytics, register, check-balance).

### Internal Data Endpoints (same data as L402, no payment required)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /v1/internal/node-stats` | CF/Internal | Node statistics (free, CF Access protected) |
| `GET /v1/internal/network-analytics` | CF/Internal | Network analytics (free, CF Access protected) |
| `GET /v1/internal/promo` | CF/Internal | Promotional data (free, CF Access protected) |

### Admin Dashboard Endpoints (session cookie auth)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /admin/api/login` | None | Dashboard login (returns session cookie) |
| `GET /admin/api/metrics` | Session | Dashboard metrics (agents, credits, channels) |
| `GET /admin/api/agents` | Session | List all agents with balances |
| `GET /admin/api/channels` | Session | List all channel grants |
| `GET /admin/api/agents/` | Session | Agent transaction history |
| `POST /admin/api/agents/` | Session + CSRF | Grant credits to agent (Tier 3) |
| `PATCH /admin/api/agents/` | Session + CSRF | Suspend/activate agent |

### Admin Endpoints (admin token ONLY — agent cannot call these)
| Endpoint | Purpose |
|----------|---------|
| `POST /v1/confirm` | Confirm a pending write operation by `operation_id` |
| `POST /v1/reject` | Reject a pending write operation by `operation_id` |
| `POST /v1/confirm/list` | List all pending confirmations |
| `POST /v1/admin/kill-switch` | Engage or disengage the kill switch |
| `POST /v1/admin/restart-lnd` | Emergency LND restart (agent can call) |

> **NOTE**: Confirm/reject/kill-switch require the admin token (`GATEWAY_ADMIN_TOKEN`).
> The agent token will receive `403 Forbidden`. The agent CANNOT confirm, reject,
> or toggle the kill switch. Only the human operator can perform these actions.

### Write Request Pattern
All write requests MUST include an `idempotency_key`:
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/payments/send \
  -d '{"payment_request": "lnbc...", "idempotency_key": "'$(uuidgen)'"}'
```

### Confirmation Flow
When a write endpoint returns `confirmation_required: true`:
1. Show the `description` and `operation_id` to the operator
2. Tell them to confirm or reject
3. You CANNOT confirm operations — only the operator can via admin token
4. The confirmation expires at `expires_at`

### Read Request Pattern
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/endpoint \
  -d '{}' | jq .
```

### Response Envelope
All responses follow this structure:
```json
{
  "ok": true,
  "data": { ... }
}
```
Or on error:
```json
{
  "ok": false,
  "error": "error_code",
  "message": "Human-readable description"
}
```

### Error Handling
- `401` — Missing or invalid token. Check token file exists.
- `403` — Endpoint requires admin token or budget exceeded. Report to operator.
- `429` — Rate limited. Wait and retry.
- `503` — Kill switch active. All writes blocked. Report to operator.
- `202` — Confirmation required. Show details to operator and wait.

### Emergency: Restart LND

If the gateway health check shows `lnd_connected: false` or returns connection errors,
and you have confirmed the issue is not transient (retry health 2-3 times over 30 seconds),
you may restart LND via the gateway API:

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/admin/restart-lnd -d '{}' | jq .
```

After restarting, wait 10 seconds then verify via:
- `GET /v1/health` — should show `status: healthy`

LND auto-unlocks on restart (wallet password file configured in systemd).

**Only use this as a last resort after confirming LND is unresponsive. Always report
the restart and the reason to the operator.**

### Tools NOT to use
- Do NOT use `lncli` directly
- Do NOT use `grpcurl` or any gRPC client
- Do NOT read files from `/lnd/` or any LND data directory
- Do NOT attempt to read macaroon files
