# lnd-gateway

Go HTTP/JSON gateway to LND for LQWDClaw-NodeOps.

## Build & Run

```bash
make build          # Build binary (CGO_ENABLED=1 for SQLite)
make run            # Build + run
make mock           # Build + run in mock mode (no LND needed)
make test           # Run all tests
make test-v         # Run all tests with verbose output
make lint           # Run go vet
make clean          # Remove binary + data files
```

## Architecture

### Core (v1)
- `cmd/lnd-gateway/main.go` — entry point, server, middleware chain, route registration
- `internal/config/` — env var parsing + validation (40+ vars)
- `internal/middleware/` — auth (Bearer, L402, CF Access, API key, session), rate limiting, logging, panic recovery
- `internal/handlers/handlers.go` — read endpoints, dependencies struct, logAndRespond helper
- `internal/handlers/write.go` — write endpoints (open/close channel, send, invoice, on-chain, peers)
- `internal/handlers/analytics.go` — analytics endpoints (fee report, graph info, channel scores, rebalance)
- `internal/handlers/audit.go` — audit query + summary endpoints
- `internal/handlers/summary.go` — aggregated node summary for orchestrator
- `internal/handlers/l402.go` — L402 server handlers (402 challenge, node-stats, network-analytics, promo)
- `internal/handlers/l402_client.go` — L402 client pay endpoint (fetch → detect 402 → pay → retry)
- `internal/handlers/internal.go` — internal data endpoints (CF Access protected, shared with L402)
- `internal/handlers/shared.go` — shared data functions reused by L402 + internal endpoints
- `internal/l402/store.go` — SQLite WAL L402 token store (pending -> paid -> consumed lifecycle, atomic consume)
- `internal/l402/macaroon.go` — L402 macaroon minting + verification (gopkg.in/macaroon.v2)
- `internal/audit/` — SQLite WAL audit logging with JSON fallback
- `internal/budget/` — per-op + daily rolling window budget enforcement
- `internal/confirm/` — two-phase confirmation flow (admin token only)
- `internal/idempotency/` — duplicate request prevention via client-generated keys
- `internal/killswitch/` — emergency write operation halt
- `internal/lnd/` — LND gRPC client wrappers + channel executor (async open/close)
- `internal/fees/` — fee estimation helpers
- `internal/mock/` — static LND responses for testing

### v2 Account System
- `internal/accounts/store.go` — PostgreSQL store (agents, credits, channel_grants tables)
- `internal/accounts/handlers.go` — registration, profile, key rotation, tier claims, transactions
- `internal/accounts/middleware.go` — API key auth middleware (`lqwd_` prefix, 401/403)
- `internal/accounts/proxy.go` — credit proxy with Reserve-Execute-Settle debit flow
- `internal/accounts/channel.go` — channel faucet (async open, background poller, ban-on-failure)
- `internal/accounts/models.go` — agent, credit entry, channel grant models
- `internal/accounts/mock.go` — mock account store for testing
- `internal/admin/handlers.go` — admin dashboard API (metrics, agents, credits, channels, transactions)
- `internal/admin/session.go` — opaque session tokens with crypto/rand
- `internal/admin/csrf.go` — double-submit CSRF with constant-time compare
- `internal/admin/ratelimit.go` — in-memory login rate limiter (5/15min)
- `internal/mcpserver/` — MCP Streamable HTTP server (mcp-go v0.46.0), tool registration, billing
- `admin/` — embedded React SPA (built assets served at /admin/)

## Two-Token Auth

- `GATEWAY_AGENT_TOKEN` — for OpenClaw (read + initiate writes)
- `GATEWAY_ADMIN_TOKEN` — for human/confirm-bot (confirm operations + admin)

The agent token CANNOT call /v1/confirm/* or /v1/admin/*.

## L402 Protocol Auth

- `L402_ENABLED=true` — enables `/v1/l402/*` endpoints
- `L402_SIGNING_KEY` — hex-encoded 32-byte HMAC key for macaroon signing (required in production)
- L402 endpoints bypass Bearer auth entirely — they use their own auth scheme
- Flow: `GET /v1/l402/node-stats` → 402 + WWW-Authenticate → pay invoice → retry with `Authorization: L402 <macaroon>:<preimage>` → 200
- Tokens are single-use, stored in SQLite, with configurable TTL (default 24h)
- Mock mode auto-pays invoices for testing without real Lightning

## Key Environment Variables

See `internal/config/config.go` for all variables and defaults.

Key L402 variables:
- `L402_ENABLED` — Enable L402 pay-per-call endpoints (default: false)
- `L402_SIGNING_KEY` — 64-char hex HMAC key for macaroon signing (required when L402 enabled)
- `L402_DB_PATH` — SQLite path for L402 token store (default: `./data/l402.db`)
- `L402_TOKEN_EXPIRY` — Token lifetime in seconds (default: 86400)
- `L402_INVOICE_EXPIRY` — Invoice expiry in seconds (default: 600)
- `MAX_L402_PAYMENT_SATS` — Max sats per outbound L402 payment (default: 1000)

Key v2 variables:
- `DATABASE_URL` — PostgreSQL connection string for accounts, credits, channels
- `CF_ACCESS_TEAM` / `CF_ACCESS_AUD` — Cloudflare Access JWT validation
- `INTERNAL_AUTH_SECRET` — Shared secret for X-Internal-Auth defense-in-depth
- `FAUCET_CHANNEL_SIZE_SATS` — Channel size (default: 20000 — LND minchansize floor)
- `FAUCET_PUSH_SATS` — Sats pushed on channel open (default: 1354 = 1000 spendable + 354-sat p2wsh dust/reserve buffer)
- `FAUCET_CHANNEL_CAP` — Max channel grants (default: 100)
- `PROXY_PRICE_SATS` — Cost per proxy call (default: 10)
- `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` — Dashboard login credentials
- `MCP_BILLING_ENABLED` — Enable credit billing for MCP tool calls (default: false)

## Stats

- **62 routes**: 19 read + 9 write + 5 admin + 3 L402 server + 1 L402 client + 3 internal + 5 account + 2 channel + 3 proxy + 1 MCP + 9 admin dashboard + 2 admin misc
- **247 tests** across 32 test files in 15 packages
- **15 internal packages**: config, middleware, handlers, accounts, admin, mcpserver, audit, budget, confirm, idempotency, killswitch, l402, lnd, fees, mock
- **6 auth layers**: Bearer (agent/admin), L402, CF Access JWT, API key, session cookie, CSRF
- **Security scan profiles**: `security/gateway-l402.yaml` (L402 compliance) + `security/gateway-internal.yaml` (auth boundary isolation)
- **Deployment**: systemd service with security hardening (see `scripts/`)
