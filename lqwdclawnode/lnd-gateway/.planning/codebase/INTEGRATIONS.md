# External Integrations

**Analysis Date:** 2026-03-25

## APIs & External Services

**Lightning Network:**
- LND (Lightning Network Daemon) v0.20.1-beta - Complete node operation control
  - SDK/Client: `github.com/lightningnetwork/lnd` (gRPC proto package)
  - Connection: `LND_GRPC_HOST` (default: 127.0.0.1:10009)
  - Transport: gRPC with TLS certificate (`LND_TLS_CERT_PATH`)
  - Auth: Scoped macaroons (4 separate tokens for read/invoice/channel/pay)

## Data Storage

**Databases:**
- SQLite3 (local file-based)
  - **audit.db** - Complete audit trail of all operations
    - Connection: File at `AUDIT_DB_PATH` (default: data/audit.db)
    - Client: `database/sql` with `github.com/mattn/go-sqlite3`
    - Stores: endpoint, method, token level, request/response bodies, amounts, operation type
    - Fallback: JSON lines to `AUDIT_FALLBACK_PATH` if DB write fails
  - **idempotency.db** - Duplicate request detection
    - Connection: File at `data/idempotency.db`
    - Client: `database/sql` with `github.com/mattn/go-sqlite3`
    - Stores: idempotency keys and operation results
  - **l402.db** - L402 token lifecycle tracking
    - Connection: File at `L402_DB_PATH` (default: data/l402.db)
    - Client: `database/sql` with `github.com/mattn/go-sqlite3`
    - Stores: token state (pending, paid, consumed), payment hashes, expiry times

**File Storage:**
- Local filesystem only
- Macaroon files (read from `LND_MACAROON_DIR`):
  - `readonly.macaroon` - Read-only RPC access to LND
  - `invoice.macaroon` - Invoice creation only
  - `channeladmin.macaroon` - Channel operations only
  - `pay.macaroon` - Payment execution only
- TLS certificate: Read from `LND_TLS_CERT_PATH`

**Caching:**
- None (all requests are stateless, client handles retry logic)

## Authentication & Identity

**Gateway Auth Provider:**
- Two-token bearer token system (custom)
  - `GATEWAY_AGENT_TOKEN` - For OpenClaw agent (read + initiate writes)
  - `GATEWAY_ADMIN_TOKEN` - For human/bot (confirm operations + admin)
  - Implementation: `Authorization: Bearer <token>` header
  - Enforced in `internal/middleware/auth.go`
  - Agent token cannot call `/v1/confirm/*` or `/v1/admin/*` endpoints

**LND Auth Provider:**
- Macaroon-based bearer tokens
  - Implementation: Scoped macaroons loaded from files
  - Each operation uses appropriate macaroon based on scope
  - Macaroon parsing: `internal/lnd/macaroon.go`
  - TLS verification: Custom cert pool from `LND_TLS_CERT_PATH`

**L402 Protocol Auth:**
- HMAC-based macaroon tokens (separate from gateway auth)
  - Issuer: `internal/l402/macaroon.go`
  - Signing: HMAC-SHA256 with `L402_SIGNING_KEY` (32-byte hex)
  - Flow: GET endpoint → 402 response + invoice → client pays → retry with `Authorization: L402 <macaroon>:<preimage>`
  - Verification: `internal/middleware/l402.go`
  - Single-use tokens stored in `l402.db`
  - Caveats: payment_hash, expires_at, endpoint, method

## Rate Limiting

**Per-Token Limits:**
- Read requests: `RATE_LIMIT_READ` per minute (default: 60)
- Write requests: `RATE_LIMIT_WRITE` per minute (default: 10)
- Implementation: `internal/middleware/ratelimit.go`

**Per-Operation Budgets:**
- Channel size: `MAX_CHANNEL_SIZE_SATS` (default: 5M sats)
- Single payment: `MAX_PAYMENT_SATS` (default: 1M sats)
- Rebalance fee: `MAX_REBALANCE_FEE_SATS` (default: 10K sats)
- Daily total: `MAX_DAILY_SPEND_SATS` (default: 10M sats)
- On-chain fee rate: `MAX_FEE_RATE_SAT_VB` (default: 100 sat/vB)
- L402 payment: `MAX_L402_PAYMENT_SATS` (default: 1000 sats)
- Enforcement: `internal/budget/enforcer.go` with audit logging

## Monitoring & Observability

**Error Tracking:**
- None (no external service)

**Logs:**
- Structured JSON logging to stderr (via `log/slog`)
- Audit trail to SQLite + JSON fallback
  - Logs all requests (endpoint, method, token level, amounts)
  - Logs error details
  - Enables operation reconstruction

**Metrics:**
- None (no external metrics service; client-side responsibility)

## CI/CD & Deployment

**Hosting:**
- Self-hosted (likely systemd service on DigitalOcean/OneProvider)

**CI Pipeline:**
- None (no external CI service configured)

**Build System:**
- Makefile-based (see `Makefile`):
  - `make build` - Compile with CGO_ENABLED=1
  - `make test` - Run all tests
  - `make lint` - Run go vet

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None (gateway is request-response only)

---

*Integration audit: 2026-03-25*
