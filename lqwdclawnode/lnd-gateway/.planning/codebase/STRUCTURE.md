# Codebase Structure

**Analysis Date:** 2026-03-25

## Directory Layout

```
lnd-gateway/
├── cmd/
│   └── lnd-gateway/
│       └── main.go              # Server entry point, middleware chain, route registration
├── internal/
│   ├── config/
│   │   └── config.go            # Environment variable parsing + validation
│   ├── middleware/
│   │   ├── auth.go              # Bearer token validation + TokenLevel context
│   │   ├── logging.go           # Structured JSON logging middleware
│   │   ├── ratelimit.go         # Token bucket rate limiter (read/write categories)
│   │   ├── l402.go              # L402 macaroon verification middleware
│   │   ├── recovery.go          # Panic recovery middleware
│   │   ├── json.go              # Response envelope + JSON write helper
│   │   ├── l402_test.go
│   │   └── *_test.go            # (other test files)
│   ├── handlers/
│   │   ├── handlers.go          # Read-only endpoints, Dependencies struct, logAndRespond helper
│   │   ├── write.go             # Write endpoints (channel open/close, payments, on-chain, peers)
│   │   ├── analytics.go         # Analytics endpoints (fee report, graph, channel scores, rebalance)
│   │   ├── audit.go             # Audit query + summary endpoints
│   │   ├── summary.go           # Node summary (orchestrator endpoint)
│   │   ├── l402.go              # L402 server handlers (302 challenge, node-stats, network-analytics, promo)
│   │   ├── l402_client.go       # L402 client payment handler (/v1/l402/pay)
│   │   ├── write_test.go
│   │   ├── analytics_test.go
│   │   ├── audit_test.go
│   │   └── summary_test.go
│   ├── lnd/
│   │   ├── client.go            # Client interface (30+ methods), request/response structs
│   │   ├── grpc.go              # gRPC implementation of Client interface
│   │   ├── executor.go          # High-level LND operations wrapper
│   │   ├── macaroon.go          # Macaroon file loading
│   │   ├── executor_test.go
│   │   └── macaroon_test.go
│   ├── budget/
│   │   ├── enforcer.go          # Budget checker (per-op + daily rolling window)
│   │   └── enforcer_test.go
│   ├── confirm/
│   │   ├── manager.go           # Confirmation manager (pending ops, TTL cleanup, execute/reject)
│   │   └── manager_test.go
│   ├── audit/
│   │   └── logger.go            # SQLite WAL audit logger + JSON fallback
│   ├── idempotency/
│   │   ├── store.go             # SQLite idempotency store (dedup via client-generated keys)
│   │   └── store_test.go
│   ├── killswitch/
│   │   ├── killswitch.go        # File-based emergency write-op halt
│   │   └── killswitch_test.go
│   ├── l402/
│   │   ├── store.go             # SQLite token store (pending → paid → consumed lifecycle)
│   │   ├── macaroon.go          # L402 macaroon minting + verification (HMAC signing)
│   │   ├── store_test.go
│   │   └── macaroon_test.go
│   ├── fees/
│   │   └── (empty, reserved for future fee calculation logic)
│   └── mock/
│       └── mock.go              # Static LND responses (used when MockMode == true)
├── config/
│   └── (empty directory, reserved for config files)
├── go.mod                       # Go module definition + dependencies
├── go.sum                       # Dependency checksums
├── Makefile                     # Build targets (build, run, mock, test, lint)
├── CLAUDE.md                    # Project brief + architecture summary
└── .planning/
    └── codebase/
        └── (this document)
```

## Directory Purposes

**cmd/lnd-gateway/**
- Purpose: Server entry point and initialization
- Contains: main.go—loads config, initializes subsystems, registers HTTP routes, applies middleware chain
- Key files: `cmd/lnd-gateway/main.go` (lines 1–299)
- Exported symbols: main() function (no public API, only entry point)

**internal/config/**
- Purpose: Environment variable parsing and validation
- Contains: Config struct with all server/auth/budget/rate-limit/L402 settings
- Key files: `internal/config/config.go` (lines 1–145)
- Exported symbols: Config struct, Load() function, validation helpers

**internal/middleware/**
- Purpose: HTTP middleware chain—auth, logging, rate limiting, L402, panic recovery
- Contains: Bearer token validation (Agent/Admin), structured JSON logging, token bucket rate limiter, L402 macaroon verification, panic recovery
- Key files:
  - `internal/middleware/auth.go` — Auth() middleware, TokenLevel constants, RequireAdmin()
  - `internal/middleware/logging.go` — Logging() middleware, structured request/response capture
  - `internal/middleware/ratelimit.go` — RateLimiter struct, token bucket refill logic
  - `internal/middleware/l402.go` — L402Auth() middleware, macaroon + preimage verification
  - `internal/middleware/recovery.go` — Recovery() middleware, panic capture
  - `internal/middleware/json.go` — WriteJSON() helper, response envelope formatting
- Exported symbols: Auth, Logging, RateLimiter, Recovery, L402Auth, WriteJSON, GetTokenLevel, TokenLevel constants

**internal/handlers/**
- Purpose: HTTP endpoint implementations—request parsing, business logic coordination, response formatting
- Contains: 36 endpoint handlers across read, write, admin, analytics, audit, L402 categories
- Key files:
  - `internal/handlers/handlers.go` (386 lines) — Dependencies struct, Health(), read-only endpoints (GetInfo, WalletBalance, etc.), logAndRespond() helper, ConfirmOperation(), RejectOperation()
  - `internal/handlers/write.go` (523 lines) — Write endpoints (OpenChannel, CloseChannel, SendPayment, CreateInvoice, SendOnChain, ConnectPeer, etc.)
  - `internal/handlers/analytics.go` (271 lines) — FeeReport, GraphNodeInfo, GraphChannelInfo, ChannelScores, Rebalance, UpdateChannelFees
  - `internal/handlers/audit.go` (60 lines) — AuditRecent, AuditQuery, AuditSummary
  - `internal/handlers/summary.go` (136 lines) — NodeSummary (orchestrator endpoint)
  - `internal/handlers/l402.go` (258 lines) — NodeStats, NetworkAnalytics, Promo (L402 server handlers)
  - `internal/handlers/l402_client.go` (227 lines) — L402Pay (L402 client payment handler)
- Exported symbols: Dependencies struct, all endpoint handler methods (Health, GetInfo, OpenChannel, etc.), IsWriteEndpoint()

**internal/lnd/**
- Purpose: Encapsulate all LND gRPC communication—handlers never see proto types
- Contains: Client interface (30+ methods), gRPC implementation, executor wrapper, macaroon loading
- Key files:
  - `internal/lnd/client.go` (100+ lines) — Client interface definition, request/response structs (OpenChannelRequest, SendPaymentRequest, etc.)
  - `internal/lnd/grpc.go` — gRPC client implementation, proto → map[string]any translation
  - `internal/lnd/executor.go` — High-level LND operation wrapper (calls gRPC in sequence)
  - `internal/lnd/macaroon.go` — Macaroon file loading from directory
- Exported symbols: Client interface, gRPC implementation, request/response types, NewGRPCClient(), NewExecutor()

**internal/budget/**
- Purpose: Enforce per-operation and daily rolling window spend limits
- Contains: Limits struct, Enforcer with Check() method, daily calculation from audit log
- Key files: `internal/budget/enforcer.go` (100+ lines)
- Exported symbols: Limits struct, Enforcer struct, Check() method, CheckResult struct

**internal/confirm/**
- Purpose: Two-phase confirmation flow for destructive operations (e.g., opening channels, sending payments)
- Contains: PendingOp struct, Manager with Create/Confirm/Reject/List methods, in-memory storage, TTL cleanup
- Key files: `internal/confirm/manager.go` (80+ lines)
- Exported symbols: PendingOp struct, Manager struct, Create(), Confirm(), Reject(), List(), Count() methods

**internal/audit/**
- Purpose: Audit logging with SQLite WAL + JSON fallback
- Contains: Entry struct, Logger with Log/Query/Summary methods, SQLite schema with indices
- Key files: `internal/audit/logger.go` (80+ lines)
- Exported symbols: Entry struct, Logger struct, New(), Log(), Query(), Summary() methods

**internal/idempotency/**
- Purpose: Duplicate request prevention via client-generated keys
- Contains: Store backed by SQLite, Check() for lookup, Store() for caching response
- Key files: `internal/idempotency/store.go`
- Exported symbols: Store struct, New(), Check(), Store(), Cleanup() methods

**internal/killswitch/**
- Purpose: Emergency file-based halt for write operations
- Contains: KillSwitch struct, IsActive() check, Toggle() method
- Key files: `internal/killswitch/killswitch.go`
- Exported symbols: KillSwitch struct, New(), IsActive(), Toggle() methods

**internal/l402/**
- Purpose: L402 protocol implementation (macaroon-based paywalls)
- Contains: Token store (SQLite, single-use, TTL), macaroon minting/verification (HMAC-signed binary)
- Key files:
  - `internal/l402/store.go` — Token store (pending → paid → consumed)
  - `internal/l402/macaroon.go` — Service struct, MintMacaroon(), VerifyMacaroon(), VerifyPreimage()
- Exported symbols: Store, Service, Token, VerifyResult structs, New(), Mint(), Verify() methods

**internal/mock/**
- Purpose: Testing and demo mode—return static LND responses without real connection
- Contains: Hardcoded responses for all read-only operations
- Key files: `internal/mock/mock.go`
- Exported symbols: GetInfo(), WalletBalance(), ListChannels(), etc.—all return map[string]any

## Key File Locations

**Entry Points:**
- `cmd/lnd-gateway/main.go` — Server startup, subsystem initialization, route registration

**Configuration:**
- `internal/config/config.go` — Environment variable parsing, validation

**Core Logic:**
- `internal/handlers/handlers.go` — Read-only endpoint implementations
- `internal/handlers/write.go` — Write operation implementations (channel open/close, payments, on-chain)
- `internal/handlers/analytics.go` — Fee/graph/channel analysis endpoints
- `internal/handlers/audit.go` — Audit query endpoints
- `internal/handlers/summary.go` — Orchestrator summary endpoint
- `internal/handlers/l402.go` — L402 server-side challenge handlers
- `internal/handlers/l402_client.go` — L402 client payment handler

**Middleware:**
- `internal/middleware/auth.go` — Bearer token validation
- `internal/middleware/logging.go` — Request/response logging
- `internal/middleware/ratelimit.go` — Token bucket rate limiting
- `internal/middleware/l402.go` — L402 macaroon verification
- `internal/middleware/recovery.go` — Panic recovery

**Subsystems:**
- `internal/budget/enforcer.go` — Budget enforcement
- `internal/confirm/manager.go` — Confirmation manager
- `internal/audit/logger.go` — Audit logging
- `internal/idempotency/store.go` — Deduplication store
- `internal/killswitch/killswitch.go` — Emergency halt
- `internal/l402/store.go` — Token store
- `internal/l402/macaroon.go` — Macaroon signing/verification

**LND Abstraction:**
- `internal/lnd/client.go` — Client interface definition
- `internal/lnd/grpc.go` — gRPC implementation
- `internal/lnd/executor.go` — High-level operation wrapper

**Testing:**
- `internal/handlers/write_test.go`, `analytics_test.go`, `audit_test.go`, `summary_test.go` (378, 195, 167, 60 lines respectively)
- `internal/budget/enforcer_test.go`, `internal/confirm/manager_test.go`, `internal/idempotency/store_test.go`, `internal/killswitch/killswitch_test.go`, `internal/l402/store_test.go`, `internal/l402/macaroon_test.go`, `internal/middleware/l402_test.go`, `internal/lnd/executor_test.go`, `internal/lnd/macaroon_test.go`

## Naming Conventions

**Files:**
- `{package_name}.go` — Single exported file per package (e.g., handlers.go, enforcer.go, logger.go)
- `{name}_test.go` — Test file naming follows Go convention (table-driven tests inside package)
- `{feature}_test.go` — Multiple test files per large package (e.g., write_test.go, analytics_test.go)

**Directories:**
- `cmd/` — Runnable command (contains main)
- `internal/` — Unexported packages (Go convention—no external access)
- One logical package per directory (e.g., `internal/budget/` contains all budget enforcement logic)
- Descriptive names: config, middleware, handlers, lnd, audit, budget, confirm, idempotency, killswitch, l402, mock

**Go Symbols:**
- `type Dependencies struct` — Singleton containing all shared subsystems
- `type Limits struct`, `type Enforcer struct` — Configuration + behavior in separate types where config is immutable
- `func (e *Enforcer) Check()` — Receiver methods for logical grouping
- `func New*() *Type` — Constructor functions (NewRateLimiter, NewStore, NewLogger, etc.)
- `TokenLevel` constants (TokenNone, TokenAgent, TokenAdmin) — Enumeration-like usage
- Exported methods UPPERCASE (Health, GetInfo, OpenChannel), context keys lowercase with Key suffix (tokenLevelKey, l402TokenKey)

## Where to Add New Code

**New Read Endpoint:**
- Implementation: `internal/handlers/handlers.go` (or separate file if >200 lines)
- Pattern: `func (d *Dependencies) EndpointName(w http.ResponseWriter, r *http.Request) { d.logAndRespond(w, r, "operation_name", func() (map[string]any, int) { ... }) }`
- Registration: Add route in `cmd/lnd-gateway/main.go` (mux.HandleFunc or mux.Handle depending on auth requirement)
- Tests: Add test cases to existing *_test.go or create new test file if needed
- Audit: Automatically captured by middleware + logAndRespond helper
- Notes: Never call LND directly; always use d.LND.Method() or d.Executor.Method()

**New Write Endpoint:**
- Implementation: `internal/handlers/write.go` (or new file if >300 lines)
- Pattern: Idempotency check → Budget check → Confirmation creation (202 response) OR direct execution + response
- Registration: Add route in main.go with mux.HandleFunc (agent token required)
- Subsystems: Use d.Idempotency.Check(), d.Budget.Check(), d.Confirm.Create()
- Audit: Call d.Audit.Log() with full entry details
- Tests: Write table-driven tests with mock LND responses
- Notes: All destructive operations require confirmation (202 Accepted response with operation_id)

**New Middleware:**
- Implementation: Create new file in `internal/middleware/` (e.g., custom_check.go)
- Pattern: `func CustomMiddleware(config) func(http.Handler) http.Handler { return func(next http.Handler) http.Handler { ... } }`
- Integration: Register in main.go middleware chain (order matters: innermost first)
- Context: Use context.WithValue to pass state to handlers
- Tests: Create matching *_test.go file with unit tests
- Notes: Keep middleware focused on cross-cutting concerns; business logic belongs in handlers

**New Subsystem (e.g., Feature X):**
- Directory structure: Create `internal/featurex/` with main.go and test files
- Exported API: Define clear package-level functions (New*(), Close(), method receivers)
- Storage: Use SQLite in `internal/featurex/store.go` if persistence needed; use in-memory sync.Map if temporary
- Integration: Add to Dependencies struct in handlers.go (if handlers need it) or use standalone
- Config: Add fields to Config struct in internal/config/config.go + env var parsing
- Tests: Achieve >80% coverage; use table-driven tests; mock external dependencies

**New Test:**
- Files: Create test in same package as code (internal/handlers/write_test.go for handlers, etc.)
- Pattern: Table-driven tests with test cases struct { name, input, expected }
- Helpers: Use testdata directory for fixture JSON if >50 lines
- Naming: `TestFunctionName(t *testing.T)` or `TestFunctionName_Scenario(t *testing.T)`
- Mocks: Use internal/mock/mock.go responses or create test helper stubs
- Coverage: Run `make test-v` to check; aim for >80% on critical paths (budget, confirm, audit)

## Special Directories

**data/ (Generated, Not Committed)**
- Purpose: SQLite databases and JSON fallback logs
- Generated: During runtime (audit.db, idempotency.db, l402.db, audit-fallback.jsonl)
- Committed: No (add to .gitignore)
- Cleanup: `make clean` removes all data files

**/etc/lnd-gateway/ (System Config, Not Committed)**
- Purpose: Kill switch file and systemd unit configuration
- Generated: During deployment (kill-switch file created by operator)
- Committed: No (deployment-specific)
- Location: Checked by KillSwitch.IsActive() — file existence toggles write ops off

**cmd/ (Compiled to Binary)**
- Purpose: Runnable command
- Compiled: `make build` produces lnd-gateway binary
- Committed: Binary excluded via .gitignore
- Deploy: Copy binary + systemd unit to production

---

*Structure analysis: 2026-03-25*
