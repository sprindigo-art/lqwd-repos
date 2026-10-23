# Coding Conventions

**Analysis Date:** 2026-03-25

## Naming Patterns

**Files:**
- Package files match package directory names: `cmd/lnd-gateway/main.go`, `internal/handlers/handlers.go`, `internal/config/config.go`
- Test files use `_test.go` suffix: `manager_test.go`, `enforcer_test.go`
- No underscores in file names except for test suffix
- Handler files separated by concern: `handlers.go` (read), `write.go` (write), `analytics.go`, `audit.go`, `summary.go`, `l402.go`

**Functions:**
- PascalCase for exported functions: `GetInfo()`, `OpenChannel()`, `ListChannels()`, `NewService()`, `MintMacaroon()`
- camelCase for unexported functions: `logAndRespond()`, `lndErr()`, `tokenLevelStr()`, `setupL402()`
- Constructor functions follow pattern `New{Type}()`: `NewRateLimiter()`, `NewService()`, `NewStore()`, `NewExecutor()`
- Handler methods on receiver: `(d *Dependencies) GetInfo(w http.ResponseWriter, r *http.Request)`
- Test functions follow pattern `Test{Scenario}()`: `TestCreateAndConfirm()`, `TestOpenChannel_RequiresConfirmation()`, `TestBudgetExceeded()`

**Variables:**
- camelCase for local variables: `req`, `resp`, `err`, `logger`, `handler`, `deps`, `cfg`, `svc`
- Short receiver names: `d` for `*Dependencies`, `e` for `*Enforcer`, `m` for `*Manager`, `svc` for service types
- Configuration struct fields use PascalCase: `ListenAddr`, `AgentToken`, `AdminToken`, `LNDHost`, `TLSCertPath`, `MaxChannelSizeSats`
- Interface types named with `able` suffix: `Client` interface for LND client
- Struct type names in PascalCase: `Dependencies`, `Config`, `Enforcer`, `Limits`, `CheckResult`, `Operation`, `Service`, `Store`, `Entry`

**Types:**
- Interface names: `Client` (for LND client), no `I` prefix
- Error types wrapped as part of normal error handling, not custom types
- Constant grouping with `const ( ... )` and iota for enumeration: `const ( TokenNone TokenLevel = iota; TokenAgent; TokenAdmin; )`

## Code Style

**Formatting:**
- `go vet` enforces standard Go formatting
- Standard library import ordering: stdlib, then external packages
- Imports organized by category in groups
- Function parameter order: context, request struct, dependencies (w, r pattern for HTTP handlers)
- Error handling: `if err != nil { return ..., err }` pattern
- File header comments describe package purpose and key responsibilities

**Linting:**
- `go vet ./...` is the standard lint tool (see `Makefile`)
- No custom linter configuration detected
- Implicit style enforcement through code review

## Import Organization

**Order:**
1. Standard library (`fmt`, `net/http`, `log/slog`, `context`, `os`, etc.)
2. External packages from other projects (grpc, protobuf, macaroon)
3. Internal packages from `github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/...`

**Path Aliases:**
- No path aliases used; full module path always imported
- Relative imports not used

## Error Handling

**Patterns:**
- Check error immediately after operation: `if err := someFunc(); err != nil { ... }`
- Return error to caller when logic cannot continue, OR return error wrapped in response map
- For HTTP handlers, errors wrapped in `map[string]any` with `ok: false, error: "error_key"` format
- HTTP status codes match error type: `400` for bad request, `403` for budget/auth failures, `500` for server errors
- Error context added with `fmt.Sprintf()`: `"channel size %d sats exceeds limit of %d sats", actual, limit`
- LND gRPC errors wrapped with prefix: `"lnd_error: " + err.Error()`
- Fatal startup errors call `logger.Error()` then `os.Exit(1)`

**Response format for errors:**
```go
map[string]any{
    "ok": false,
    "error": "error_key",
    "message": "human readable message",
    // additional context...
}
```

**Success response format:**
```go
map[string]any{
    "ok": true,
    "data": ...,
    // additional fields...
}
```

## Logging

**Framework:** `log/slog` (Go standard JSON structured logging)

**Patterns:**
- Logger created once at startup as `*slog.Logger` with `slog.NewJSONHandler` or `slog.NewTextHandler`
- Passed through dependency injection (`handlers.Dependencies`, middleware setup)
- Structured fields: `logger.Info("message", "key", value, "key2", value2)`
- Log levels: `Info` for normal operations, `Error` for exceptional cases, `Debug` for detailed flow (not actively used)
- HTTP request/response logged to audit database via `d.Audit.Log(audit.Entry{...})` NOT to stdout
- Middleware logs request arrival/exit only at Error or Info level

**Audit logging pattern:**
```go
d.Audit.Log(audit.Entry{
    Endpoint:     "info",
    Method:       r.Method,
    TokenLevel:   tokenLevelStr(r),
    ResponseCode: status,
    ResponseBody: string(respBytes),
})
```

## Comments

**When to Comment:**
- Package comments: describe package purpose, key contracts, usage patterns. Always present at top of files.
- Public function comments: 1-2 line summary of behavior, preconditions if any.
- Complex algorithms: explain decision logic, e.g., "Two-token system: agent token (OpenClaw) and admin token (human/confirm-bot)"
- TODO comments for incomplete work: `// TODO: Real LND health check (wallet lock detection, gRPC connectivity)`
- No inline comments for obvious code; comment non-obvious logic

**Examples from codebase:**
```go
// lnd-gateway is the HTTP/JSON gateway to LND for the LQWDClaw-NodeOps system.
// It exposes a controlled API surface with budget enforcement, idempotency,
// rate limiting, confirmation flows, and audit logging.

// Package handlers implements HTTP handlers for all gateway endpoints.
// In mock mode, handlers return static responses. In production, they call LND gRPC.

// logAndRespond is a helper that logs the request/response to the audit DB.
```

**JSDoc/TSDoc:**
- Not used; Go uses standard block comments for documentation

## Function Design

**Size:**
- Short functions preferred; most handlers are 30-50 lines
- Helper methods (`logAndRespond`, `lndErr`, `tokenLevelStr`) extract common patterns
- Middleware functions return `func(http.Handler) http.Handler`

**Parameters:**
- HTTP handlers always: `(d *Dependencies) FuncName(w http.ResponseWriter, r *http.Request)`
- Dependency injection via receiver `*Dependencies` struct, not function parameters
- Request body decoded into local struct: `var req struct { ... }; json.NewDecoder(r.Body).Decode(&req)`
- No variadic parameters in public API

**Return Values:**
- HTTP handlers return nothing; write to `http.ResponseWriter`
- Public service methods return `(*Result, error)` tuple
- Constructor functions return `(*Type, error)` tuple for initialization
- Response data always wrapped in `map[string]any` for JSON marshaling

## Module Design

**Exports:**
- Exported types exposed in package root: `type Dependencies struct {...}`, `type Config struct {...}`
- Internal modules separated by package: `internal/handlers/`, `internal/budget/`, `internal/l402/`, etc.
- Each package has clear responsibility and minimal cross-package coupling

**Barrel Files:**
- Not used; no `index.go` or `exports.go`
- Direct imports of subpackages required

**Package Layout:**
- `cmd/lnd-gateway/main.go` — entry point, wires dependencies, starts server
- `internal/config/` — configuration loading and validation
- `internal/handlers/` — HTTP handlers (organized by endpoint type)
- `internal/middleware/` — auth, logging, rate limiting, recovery, L402
- `internal/lnd/` — LND gRPC client and executor
- `internal/budget/` — spend limit enforcement
- `internal/confirm/` — two-phase confirmation manager
- `internal/idempotency/` — request deduplication via SQLite
- `internal/audit/` — audit logging to SQLite + fallback JSON
- `internal/l402/` — L402 protocol implementation (store, macaroon service)
- `internal/killswitch/` — write operation halting mechanism
- `internal/mock/` — static response data for testing without LND

---

*Convention analysis: 2026-03-25*
