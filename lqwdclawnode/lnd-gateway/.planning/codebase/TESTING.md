# Testing Patterns

**Analysis Date:** 2026-03-25

## Test Framework

**Runner:**
- `go test` (built-in Go testing)
- Config: `Makefile` with convenience targets (see `make test`, `make test-v`)

**Assertion Library:**
- Standard library `testing` package only
- Manual assertions with `if condition { t.Error(...) }` or `t.Fatalf(...)`
- No assertion library (testify, gocheck, etc.)

**Run Commands:**
```bash
make test              # Run all tests with CGO_ENABLED=1 (required for SQLite)
make test-v            # Run all tests with verbose output
CGO_ENABLED=1 go test ./...                    # Run all tests manually
CGO_ENABLED=1 go test -v ./internal/handlers/  # Run specific package
CGO_ENABLED=1 go test -run TestOpenChannel ./internal/handlers/
```

## Test File Organization

**Location:**
- Co-located with implementation: `manager.go` and `manager_test.go` in same directory
- Test directory mirrors source structure: `internal/confirm/manager_test.go`, `internal/budget/enforcer_test.go`, etc.

**Naming:**
- Test files end with `_test.go`: `manager_test.go`, `enforcer_test.go`, `write_test.go`, `audit_test.go`, `summary_test.go`
- Test functions start with `Test`: `TestCreateAndConfirm`, `TestOpenChannel_RequiresConfirmation`
- Helper functions marked with `t.Helper()` to improve error reporting

**Structure:**
```
internal/
├── confirm/
│   ├── manager.go
│   └── manager_test.go
├── handlers/
│   ├── handlers.go
│   ├── write.go
│   ├── audit.go
│   ├── summary.go
│   ├── analytics.go
│   ├── write_test.go
│   ├── audit_test.go
│   ├── summary_test.go
│   └── analytics_test.go
```

## Test Structure

**Suite Organization:**
- Tests for a single module grouped in one file per module feature
- No test suites or test classes; individual test functions
- Setup functions extracted as helpers to reduce duplication

**Patterns:**

```go
// Helper to create test dependencies (from internal/handlers/write_test.go)
func newTestDeps(t *testing.T) *Dependencies {
    t.Helper()
    tmpDir := t.TempDir()
    logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

    auditLog, err := audit.New(filepath.Join(tmpDir, "audit.db"), filepath.Join(tmpDir, "fallback.jsonl"), logger)
    if err != nil {
        t.Fatal(err)
    }

    idempStore, err := idempotency.New(filepath.Join(tmpDir, "idemp.db"), logger)
    if err != nil {
        t.Fatal(err)
    }

    t.Cleanup(func() {
        auditLog.Close()
        idempStore.Close()
    })

    return &Dependencies{
        MockMode: true,
        Audit:    auditLog,
        Budget:   budget.New(...),
        Idempotency: idempStore,
        Confirm:  confirm.New(300),
        KillSwitch: killswitch.New(filepath.Join(tmpDir, "kill-switch")),
        StartTime: time.Now(),
    }
}

// Test function
func TestOpenChannel_RequiresConfirmation(t *testing.T) {
    deps := newTestDeps(t)
    w := postJSON(deps.OpenChannel, map[string]any{
        "node_pubkey": "03peer...",
        "local_funding_amount": 500_000,
        "idempotency_key": "test-open-1",
    })

    if w.Code != http.StatusAccepted {
        t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
    }
    resp := decodeResp(t, w)
    if resp["confirmation_required"] != true {
        t.Fatal("expected confirmation_required=true")
    }
}
```

**Setup Pattern:**
- Use `t.TempDir()` for isolated file system (automatically cleaned up)
- Use `t.Cleanup(func() { ... })` for deferred cleanup of resources
- Use `t.Helper()` for test helper functions to improve error location reporting
- Create Dependencies struct with test-appropriate values

**Teardown Pattern:**
- Automatic via `t.Cleanup()` - no `defer` or explicit cleanup needed
- Resources (files, databases) automatically removed by `t.TempDir()`

**Assertion Pattern:**
- Direct comparison: `if w.Code != http.StatusAccepted { t.Fatalf(...) }`
- String comparison: `if resp["error"] != "budget_exceeded" { t.Fatalf(...) }`
- Type assertion in response: `if resp["confirmation_required"] != true { t.Fatal(...) }`
- Negative assertions: `if m.Confirm(op.ID) != nil { t.Error("should be nil after reject") }`

## Mocking

**Framework:** None; manual mocking via `internal/mock/` package

**Patterns:**

Mock mode is controlled via config flag `GATEWAY_MOCK=true`. When enabled:
- LND gRPC client is not instantiated
- All handlers check `d.MockMode` and return static responses via `mock.GetInfo()`, `mock.ListChannels()`, etc.
- Tests run in mock mode by default: `deps.MockMode = true` in `newTestDeps()`

```go
// From handlers/handlers.go pattern
func (d *Dependencies) GetInfo(w http.ResponseWriter, r *http.Request) {
    d.logAndRespond(w, r, "info", func() (map[string]any, int) {
        if d.MockMode {
            return mock.GetInfo(), http.StatusOK
        }
        resp, err := d.LND.GetInfo(r.Context())
        if err != nil {
            return lndErr(err), http.StatusBadGateway
        }
        return resp, http.StatusOK
    })
}

// From internal/mock/mock.go
func GetInfo() map[string]any {
    return map[string]any{
        "ok": true,
        "data": map[string]any{
            "identity_pubkey": "...",
            "num_pending_channels": 0,
            "num_active_channels": 5,
            // ... static test data
        },
    }
}
```

**HTTP Testing Pattern:**

```go
// Helper to POST JSON and inject context (from write_test.go)
func postJSON(handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
    b, _ := json.Marshal(body)
    req := httptest.NewRequest("POST", "/test", bytes.NewReader(b))
    req.Header.Set("Content-Type", "application/json")
    // Set agent token context
    ctx := middleware.SetTokenLevel(req.Context(), middleware.TokenAgent)
    req = req.WithContext(ctx)
    w := httptest.NewRecorder()
    handler.ServeHTTP(w, req)
    return w
}

// Helper to decode response (from write_test.go)
func decodeResp(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
    t.Helper()
    var resp map[string]any
    if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
        t.Fatalf("decode response: %v\nbody: %s", err, w.Body.String())
    }
    return resp
}

// Usage in test
w := postJSON(deps.OpenChannel, map[string]any{...})
if w.Code != http.StatusAccepted {
    t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
}
resp := decodeResp(t, w)
```

**What to Mock:**
- LND gRPC client: replaced with mock static responses in test/mock modes
- HTTP server: use `httptest.NewRequest()` and `httptest.NewRecorder()`
- Time-based operations: use `time.Sleep()` for expiry tests

**What NOT to Mock:**
- SQLite databases: use real temp databases via `t.TempDir()` for isolation
- Internal service logic (budget, confirmation, idempotency): use real implementations
- JSON marshaling/unmarshaling: use real `encoding/json`
- Middleware: test real middleware in handler tests

## Fixtures and Factories

**Test Data:**
- No factories or builders used
- Test data created inline in test functions:
```go
func TestCreateAndConfirm(t *testing.T) {
    m := New(60)
    op := m.Create("/v1/channels/open", "Open 500k sat channel to 02abc", `{"pubkey":"02abc","amount":500000}`, 500_000)
    // ...
}
```

- For complex setup, extracted into helper functions:
```go
func setupL402(t *testing.T) (*l402.Service, *l402.Store) {
    t.Helper()
    svc, err := l402.NewService(testKey)
    if err != nil {
        t.Fatalf("NewService: %v", err)
    }
    // ... setup store
    return svc, store
}
```

- Constants for test data:
```go
const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const testSigningKeyHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

**Location:**
- Test data defined within test files themselves
- No separate fixtures directory
- Magic values embedded in tests for clarity (HTTP status codes, satoshi amounts, etc.)

## Coverage

**Requirements:** Not enforced (no coverage threshold enforced in CI)

**View Coverage:**
```bash
CGO_ENABLED=1 go test -cover ./...                    # Quick coverage percentage
CGO_ENABLED=1 go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html  # HTML report
```

## Test Types

**Unit Tests:**
- Scope: Individual function or method behavior
- Approach: Test single responsibility in isolation with mock/stub dependencies
- Examples:
  - `TestCreateAndConfirm` — confirm manager creates and retrieves operations
  - `TestMintAndVerify` — L402 macaroon creation and verification
  - `TestBudgetExceeded` — budget enforcer rejects over-limit operations
  - `TestExpiry` — operations expire after configured time

**Integration Tests:**
- Scope: Multiple components working together (handlers + dependencies)
- Approach: Real SQLite databases, real middleware, full request/response cycle
- Examples:
  - `TestOpenChannel_RequiresConfirmation` — handler creates pending operation
  - `TestOpenChannel_Idempotency` — handler + idempotency store + confirmation
  - `TestOpenChannel_BudgetExceeded` — handler + budget enforcer coordination
  - `TestL402ValidFlow` — L402 auth middleware + store + macaroon verification

**E2E Tests:**
- Framework: Not used
- Approach: Could be added as separate test suite calling live server, but currently only unit + integration

## Common Patterns

**Async Testing:**
```go
func TestExpiry(t *testing.T) {
    m := New(1) // 1 second expiry
    op := m.Create("/v1/channels/open", "Test op", `{}`, 100_000)
    time.Sleep(1500 * time.Millisecond)

    // Should be expired
    if m.Confirm(op.ID) != nil {
        t.Error("expired operation should not be confirmable")
    }
}
```

**State Verification After Operations:**
```go
func TestReject(t *testing.T) {
    m := New(60)
    op := m.Create("/v1/payments/send", "Send 100k sats", `{}`, 100_000)

    if !m.Reject(op.ID) {
        t.Error("Reject should return true for existing op")
    }

    // Should not be confirmable after reject
    if m.Confirm(op.ID) != nil {
        t.Error("Confirm after Reject should return nil")
    }

    // Reject non-existent
    if m.Reject("op_nonexistent") {
        t.Error("Reject non-existent should return false")
    }
}
```

**Error Testing:**
```go
func TestOpenChannel_BudgetExceeded(t *testing.T) {
    deps := newTestDeps(t)
    w := postJSON(deps.OpenChannel, map[string]any{
        "node_pubkey": "03peer...",
        "local_funding_amount": 50_000_000, // exceeds 5M limit
        "idempotency_key": "test-open-exceed",
    })

    if w.Code != http.StatusForbidden {
        t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
    }
    resp := decodeResp(t, w)
    if resp["error"] != "budget_exceeded" {
        t.Fatalf("expected budget_exceeded error, got %v", resp["error"])
    }
}
```

**Boundary Testing:**
```go
func TestUniqueIDs(t *testing.T) {
    m := New(300)
    ids := make(map[string]bool)

    for i := 0; i < 100; i++ {
        op := m.Create("/v1/test", "test", `{}`, 0)
        if ids[op.ID] {
            t.Errorf("duplicate ID generated: %s", op.ID)
        }
        ids[op.ID] = true
    }
}
```

**HTTP Response Assertions:**
```go
func TestOpenChannel_Idempotency(t *testing.T) {
    deps := newTestDeps(t)
    body := map[string]any{...}

    w1 := postJSON(deps.OpenChannel, body)
    if w1.Code != http.StatusAccepted {
        t.Fatalf("first call: expected 202, got %d", w1.Code)
    }
    resp1 := decodeResp(t, w1)

    // Second call with same key — should return cached
    w2 := postJSON(deps.OpenChannel, body)
    if w2.Code != http.StatusAccepted {
        t.Fatalf("second call: expected 202, got %d", w2.Code)
    }
    if w2.Header().Get("X-Idempotent-Replay") != "true" {
        t.Fatal("expected X-Idempotent-Replay header on second call")
    }
    resp2 := decodeResp(t, w2)
    if resp1["operation_id"] != resp2["operation_id"] {
        t.Fatal("idempotent replay should return same operation_id")
    }
}
```

## Test Coverage Status

**Tested Areas:**
- `internal/confirm/` — confirmation manager (5 tests: create, confirm, reject, expiry, list, count, IDs)
- `internal/handlers/` — HTTP handlers (multiple tests per handler file: write_test.go, audit_test.go, summary_test.go, analytics_test.go)
- `internal/l402/` — L402 protocol (macaroon_test.go, store_test.go with mint/verify, challenges, payment flow)
- `internal/middleware/` — auth and L402 middleware (l402_test.go with no-auth, invalid-scheme, valid-flow, replay)
- `internal/lnd/` — LND client (executor_test.go, macaroon_test.go)
- `internal/budget/` — budget enforcement (enforcer_test.go with per-op limits, daily ceiling, fee rates)
- `internal/idempotency/` — request deduplication (store_test.go)
- `internal/killswitch/` — write operation halting (killswitch_test.go)

**Untested Areas:**
- `internal/audit/` — audit logging (no dedicated test file, but tested indirectly via handler tests)
- `internal/config/` — environment variable loading (no test file)
- `cmd/lnd-gateway/` — main function and server wiring (no test file)
- `internal/lnd/` — live LND gRPC interactions (tested via mock mode, not real LND)
- `internal/mock/` — mock response generation (implicitly tested, no dedicated tests)

---

*Testing analysis: 2026-03-25*
