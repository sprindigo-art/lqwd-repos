# Architecture

**Analysis Date:** 2026-03-25

## Pattern Overview

**Overall:** Gateway + Middleware Stack

The lnd-gateway is a controlled HTTP/JSON gateway to LND that sits between the OpenClaw agent and the Lightning Network node. It implements a **layered middleware architecture** with **two-token authentication**, **budget enforcement**, **confirmation flows**, and **audit logging**.

**Key Characteristics:**
- **Middleware-first design**: All requests flow through a serialized middleware chain (recovery → logging → auth → rate limiting → kill switch)
- **Mock mode abstraction**: Handlers have no LND dependency knowledge—they call either LND gRPC or return static mock responses
- **Dual authentication**: Agent token (read + initiate writes) and Admin token (confirm operations + admin endpoints)
- **Database-backed subsystems**: Separate SQLite databases for audit, idempotency, and L402 tokens—no lock contention
- **Phase-gated endpoints**: Read-only (phase 1), write (phase 2), analytics (phase 3), audit (phase 4), orchestrator (phase 5)

## Layers

**HTTP Middleware Layer:**
- Purpose: Request validation, security, observability
- Location: `internal/middleware/` (auth.go, logging.go, ratelimit.go, l402.go, recovery.go)
- Contains: Bearer token validation, rate limiting (token bucket per category), structured JSON logging, panic recovery, L402 macaroon verification
- Depends on: Standard library net/http
- Used by: Main server in `cmd/lnd-gateway/main.go`

**Handler Layer:**
- Purpose: HTTP endpoint implementations—request parsing, delegating to subsystems, response encoding
- Location: `internal/handlers/` (handlers.go, write.go, analytics.go, audit.go, summary.go, l402.go, l402_client.go)
- Contains: 36 endpoint handlers (19 read-only, 9 write, 4 admin, 3 L402 server, 1 L402 client) that coordinate budget, confirm, idempotency, audit subsystems
- Depends on: LND client interface, budget enforcer, confirmation manager, audit logger, idempotency store, kill switch
- Used by: Main server router registration

**LND Abstraction Layer:**
- Purpose: Encapsulate all LND gRPC communication—handlers never import proto types
- Location: `internal/lnd/` (client.go, grpc.go, executor.go, macaroon.go)
- Contains: Client interface (read-only methods, channel ops, payments, on-chain, analytics), gRPC implementation, macaroon loading, request/response structs
- Depends on: github.com/lightningnetwork/lnd, google.golang.org/grpc
- Used by: Dependencies struct in handlers

**Enforcement Subsystems:**
- **Budget:** `internal/budget/enforcer.go` — Per-op and daily rolling window spend limits, serialized via mutex
- **Confirmation:** `internal/confirm/manager.go` — Two-phase confirmation flow for destructive ops, in-memory with TTL cleanup
- **Audit:** `internal/audit/logger.go` — SQLite WAL schema with JSON fallback, captures endpoint/token/amount/error
- **Idempotency:** `internal/idempotency/store.go` — Duplicate request prevention via client-generated keys, SQLite storage
- **Kill Switch:** `internal/killswitch/killswitch.go` — File-based emergency halt for write operations
- **L402:** `internal/l402/` (store.go, macaroon.go) — Token store + macaroon minting/verification, single-use tokens with configurable TTL

**Configuration Layer:**
- Purpose: Parse and validate all environment variables
- Location: `internal/config/config.go`
- Contains: Server (listen addr, tokens), LND (host, TLS cert, macaroons), Budget (limits), Rate limiting, L402, Mock mode toggle, Audit paths
- Depends on: os package
- Used by: Main.go during startup

**Mock Layer:**
- Purpose: Testing and demo mode—return static LND responses without real connection
- Location: `internal/mock/mock.go`
- Contains: Hardcoded responses for all LND queries (wallet, channels, info, fees, etc.)
- Depends on: None
- Used by: Handlers when cfg.MockMode == true

## Data Flow

**Read Operation (Agent Token):**

1. HTTP request arrives → Middleware chain processes (logging, auth validates agent token, rate limiting)
2. Handler (e.g., GetInfo) calls d.logAndRespond() with callback
3. Callback checks MockMode: if true, calls mock.GetInfo(); else calls d.LND.GetInfo(ctx)
4. LND gRPC client marshals proto response to map[string]any
5. Response envelope {"ok": true, "data": {...}} written to client
6. Audit logger captures endpoint/token/response code

**Write Operation (Agent Token → Confirmation → Admin Token Execution):**

1. HTTP request (e.g., OpenChannel) arrives → middleware chain
2. Handler extracts request body + idempotency key
3. Idempotency check: if key exists in SQLite, return cached response (X-Idempotent-Replay header)
4. Budget check: serialized via mutex, queries audit log for daily spent, validates against limits
5. If budget allows: confirmation manager generates operation_id, stores PendingOp in memory with TTL
6. Response: 202 Accepted with operation_id + description + expiry time
7. Idempotency store caches response
8. Audit log captures: endpoint, token, request body, amount, response code
9. Human/bot polls /v1/confirm/list (admin token) to see pending operations
10. Admin calls /v1/confirm with operation_id (admin token required)
11. Confirmation manager looks up operation, executes against LND (real request)
12. Execution recorded in audit log with operation_id link

**L402 Protocol Flow (Alternative Auth):**

1. GET /v1/l402/node-stats (no Authorization header)
2. L402 middleware passes through to handler
3. Handler: no L402 token in context → generate invoice via LND, return 402 + WWW-Authenticate challenge
4. Client generates payment to invoice hash, extracts preimage
5. Client retries: GET /v1/l402/node-stats with Authorization: L402 <macaroon>:<preimage>
6. L402 middleware: verifies macaroon signature + preimage hash match
7. Macaroon service: extracts endpoint + payment_hash caveats from HMAC-signed binary
8. Middleware verifies endpoint caveat matches request path
9. Store marks token as consumed (single-use)
10. Handler executes, audit logs with L402 token reference
11. Periodic cleanup (1h) removes expired tokens

## Key Abstractions

**Client Interface:**
- Purpose: Decouple handlers from LND proto types—all responses are map[string]any
- Examples: `internal/lnd/client.go` defines GetInfo(), WalletBalance(), SendPayment(), etc.
- Pattern: Interface with 30+ methods, gRPC implementation translates proto → map, handlers never see protobufs

**Dependencies Struct:**
- Purpose: Singleton dependency injection—all handlers share single instances of audit, budget, confirm, etc.
- Location: `internal/handlers/handlers.go` — type Dependencies struct
- Pattern: Passed to every handler, prevents global state, testable, thread-safe by design

**logAndRespond Helper:**
- Purpose: Standardize response envelope and audit logging for read endpoints
- Pattern: Takes endpoint name + callback function that returns (data map[string]any, status int)
- Usage: d.logAndRespond(w, r, "info", func() (map[string]any, int) { return mock.GetInfo(), 200 })
- Benefit: Eliminates boilerplate, ensures consistent {"ok": true/false, "data": ...} format

**TokenLevel Context:**
- Purpose: Pass authentication state through middleware and into handlers
- Pattern: Stored in request context as middleware.TokenNone / TokenAgent / TokenAdmin
- Usage: GetTokenLevel(r.Context()) called by handlers to enforce role-based access
- Example: RequireAdmin middleware wraps /v1/confirm/* endpoints

**Budget CheckResult:**
- Purpose: Return detailed budget decision with daily spend accounting
- Pattern: { Allowed: bool, Reason: string, DailySpent: int64, DailyRemaining: int64 }
- Serialization: Daily spent calculated from audit log via time-range query, no separate balance DB

## Entry Points

**HTTP Server:**
- Location: `cmd/lnd-gateway/main.go` (main function)
- Triggers: Process start via `make run`
- Responsibilities: Load config, initialize subsystems (audit, idempotency, L402, budget, LND gRPC), register routes, apply middleware chain, start listener

**Health Check:**
- Location: `internal/handlers/handlers.go` — Health() method
- Triggers: GET /v1/health (always public, no auth)
- Responsibilities: Return uptime, kill switch status, pending confirmation count, budget limits

**Write Operation Initiation:**
- Location: `internal/handlers/write.go` — OpenChannel, CloseChannel, SendPayment, etc.
- Triggers: Agent token POST requests to /v1/channels/open, /v1/payments/send, etc.
- Responsibilities: Parse request, check idempotency, enforce budget, create confirmation, return 202 Accepted

**Confirmation Execution:**
- Location: `internal/handlers/handlers.go` — ConfirmOperation()
- Triggers: Admin token POST /v1/confirm with operation_id
- Responsibilities: Look up pending operation, execute real LND call via executor, record success/error, return result

**L402 Challenge (Server-side):**
- Location: `internal/handlers/l402.go` — NodeStats(), NetworkAnalytics(), Promo()
- Triggers: GET /v1/l402/node-stats (no auth header)
- Responsibilities: Generate invoice via LND, mint macaroon, return 402 + WWW-Authenticate

**L402 Payment (Client-side):**
- Location: `internal/handlers/l402_client.go` — L402Pay()
- Triggers: Agent token POST /v1/l402/pay with target endpoint + payment request
- Responsibilities: Route through LND pay, generate preimage proof, return for agent to sign and retry external L402 service

## Error Handling

**Strategy:** Return error responses in {"ok": false, "error": "code", "message": "..."} format. Audit all errors. Distinguish client errors (400) from gateway errors (500) from upstream errors (502).

**Patterns:**

- **Validation errors:** json.NewDecoder() or missing required fields → 400 Bad Request + audit
- **Auth errors:** Missing/invalid Bearer token → 401 Unauthorized or 403 Forbidden (no audit)
- **Budget violations:** CheckResult.Allowed == false → 403 Forbidden + audit with reason
- **Confirmation required:** Write operation needs approval → 202 Accepted with operation_id (not an error, expected flow)
- **LND unavailable:** lndClient.GetInfo() returns error → 502 Bad Gateway + audit with LND error details
- **Kill switch active:** Write attempt while active → 503 Service Unavailable (expected graceful degradation)
- **Rate limit:** Too many requests → 429 Too Many Requests + Retry-After header
- **L402 invalid token:** Preimage doesn't match payment_hash → 401 Unauthorized (L402-specific)

**Panic Recovery:** Middleware catches all panics, logs to stderr, returns 500 to client.

## Cross-Cutting Concerns

**Logging:**
- Approach: JSON structured logging via slog (log/slog package)
- Handler: os.Stderr for process logs, SQLite audit table for request history
- Middleware captures: timestamp, endpoint, method, token level, request body (truncated), response code, error
- Budget checks log: operation type, amount, limits, daily totals

**Validation:**
- Config validation in `config.Load()` — required env vars (tokens, LND host), range checks (budget limits, rate limits)
- Request body validation in each handler — JSON decode errors, required fields (e.g., node_pubkey for OpenChannel)
- Budget validation in `budget.Check()` — per-op limits + daily ceiling
- Idempotency key validation: must be non-empty, no reserved prefixes
- L402 macaroon validation: HMAC signature verification via gopkg.in/macaroon.v2

**Authentication:**
- Two-token system: Bearer scheme with GATEWAY_AGENT_TOKEN and GATEWAY_ADMIN_TOKEN env vars
- Agent token: read + write initiation (can create confirmations, cannot confirm)
- Admin token: confirmation execution + admin operations (kill switch toggle)
- Health endpoint and L402 routes bypass Bearer auth (L402 uses its own scheme)
- TokenLevel extracted once in Auth middleware, passed via context to handlers

**Rate Limiting:**
- Token bucket per category (read/write), separate limits configurable
- Default: 60 read req/min, 10 write req/min
- Health endpoint exempt
- Refill rate: tokens/second = (perMin / 60)
- 429 response includes Retry-After header
- No per-IP tracking (assumes reverse proxy does rate limiting if needed)

**Audit Trail:**
- SQLite WAL database with indices on timestamp, op_type, idempotency_key
- Captures: timestamp, endpoint, method (POST), token level, request body (full JSON), response code, response body (truncated), amount sats, op_type, idempotency key, error message
- JSON fallback file written if SQLite write fails
- Queries: /v1/audit/recent (last N entries), /v1/audit/query (filtered by time range, op type, token level), /v1/audit/summary (daily totals by op type)

---

*Architecture analysis: 2026-03-25*
