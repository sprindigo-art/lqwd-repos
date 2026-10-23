# Codebase Concerns

**Analysis Date:** 2026-03-25

## Tech Debt

**Incomplete Health Check Implementation:**
- Issue: `/v1/health` endpoint returns hardcoded "healthy" status without checking actual LND connectivity or wallet lock status
- Files: `cmd/lnd-gateway/main.go` (line 43 in `handlers.go`)
- Impact: Gateway reports healthy even if LND is unreachable or wallet is locked, causing orchestrator to send operations that will fail
- Fix approach: Implement real health check via gRPC connectivity test and wallet status query (UnlockWallet RPC), cache result with TTL to avoid excessive checks

**Database Connection Pool Not Configured:**
- Issue: SQLite databases (audit, idempotency, L402) are opened without configuring connection pool parameters (SetMaxOpenConns, SetMaxIdleConns)
- Files: `internal/audit/logger.go` (line 50), `internal/idempotency/store.go` (line 35), `internal/l402/store.go` (line 51)
- Impact: Under high concurrency, SQLite WAL mode may experience lock contention or excessive connection creation. Default pool settings are not tuned for the gateway's load
- Fix approach: After `sql.Open()`, call `db.SetMaxOpenConns(1)` and `db.SetMaxIdleConns(1)` for SQLite (WAL mode works best with single connection). Monitor connection usage in production

**Idempotency Store Race Condition in Pending Status Placeholder:**
- Issue: `idempotency.Store.Check()` uses INSERT OR IGNORE with status_code=0 as a placeholder, then reads to return cached response. Between insertion and read, another goroutine could update the row
- Files: `internal/idempotency/store.go` (lines 74-99)
- Impact: Race condition where concurrent identical requests might both proceed instead of one replaying cached result
- Fix approach: Use SQLite transaction with proper isolation level, or use atomic UPDATE to store response immediately rather than deferred Store() call

**Confirmation Manager Uses Only In-Memory Storage:**
- Issue: PendingOp operations are stored in map[string]*PendingOp with mutex protection, not persisted to disk
- Files: `internal/confirm/manager.go` (lines 25-59)
- Impact: If gateway crashes while confirmations are pending, all pending operations are lost. Admin cannot recover them from logs
- Fix approach: Add SQLite persistence layer for pending ops, or add graceful shutdown that persists state to JSON file

**Missing Response Body Size Limits:**
- Issue: Response bodies from LND are not checked for size before being logged or returned to clients
- Files: `internal/handlers/handlers.go`, `internal/lnd/grpc.go` (line 48 has MaxCallRecvMsgSize=50MB but responses are logged without size checks)
- Impact: Large responses (especially from ListChannels on nodes with many peers) could cause memory exhaustion or disk fill of audit log
- Fix approach: Add response size validation before logging, truncate oversized response bodies with "...truncated" marker

**Executor Missing Operation Dispatch:**
- Issue: `Executor.Execute()` only handles 3 endpoints (/v1/channels/open, /v1/channels/close, /v1/onchain/send) but 9+ write endpoints call it
- Files: `internal/lnd/executor.go` (lines 22-48)
- Impact: Operations for payment, invoice, rebalance, peer management will return "unknown endpoint" error at execution time, not at creation time. User only discovers this after confirmation
- Fix approach: Implement all write endpoint handlers in executor, or add validation at operation creation time to reject unsupported endpoints

**Config Validation Silently Ignores Invalid Integers:**
- Issue: `envIntOr()` and `envInt64Or()` silently fall back to default if env var fails to parse, no warning logged
- Files: `internal/config/config.go` (lines 164-180)
- Impact: Typos in integer env vars (e.g., MAX_DAILY_SPEND_SATS=abc) go undetected, gateway silently uses defaults instead of requested value
- Fix approach: Log a warning or error when env var parsing fails, consider failing startup for critical vars

---

## Known Bugs

**Idempotency Store Cleanup Race:**
- Symptoms: Idempotency check returns "key already exists" but then cannot find the cached response
- Files: `internal/idempotency/store.go` (line 68)
- Trigger: Concurrent requests with same key + server clock adjustment backward in time
- Workaround: Restart gateway to clear idempotency state

**L402 Token Verify Preimage Constant-Time Implementation Missing:**
- Symptoms: If preimage verification is timing-attacked, attacker might derive payment_hash
- Files: `internal/middleware/l402.go` (line 68) calls `l402.VerifyPreimage()`
- Trigger: Verify not found in visible code — check if `l402.VerifyPreimage()` uses constant-time comparison
- Workaround: Only use L402 with HTTPS and trusted clients

---

## Security Considerations

**Token Transmission Over HTTP Not Enforced:**
- Risk: Gateway can run on plain HTTP (default 127.0.0.1:7778). If exposed, Bearer tokens and L402 macaroons are sent in plaintext
- Files: `cmd/lnd-gateway/main.go` (line 221-227 creates unencrypted server)
- Current mitigation: Default bind to localhost only, but environment-configurable to any address
- Recommendations:
  - Add TLS configuration (GATEWAY_TLS_CERT, GATEWAY_TLS_KEY env vars)
  - Reject HTTP requests if TLS is enabled but client uses HTTP (307 redirect)
  - Add warning log if bound to 0.0.0.0 without TLS

**Admin Token Cannot Be Rotated Without Restart:**
- Risk: GATEWAY_ADMIN_TOKEN is read once at startup, stored in memory. Compromised token requires full gateway restart
- Files: `internal/config/config.go` (line 69), `cmd/lnd-gateway/main.go` (line 216)
- Current mitigation: Token is only used by humans/confirm-bot, not agent, so agent token compromise is more critical
- Recommendations: Implement token rotation endpoint that requires both old and new admin token, persists to config file

**L402 Signing Key Not Validated for Production:**
- Risk: If L402_SIGNING_KEY is weak, macaroons can be forged. Validation only checks length, not entropy
- Files: `internal/config/config.go` (lines 130-139)
- Current mitigation: Config fails if key is not exactly 64 hex chars (32 bytes)
- Recommendations: Add runtime validation that key is not all-zeros, log warning if testing/example keys detected

**Audit Log Response Bodies May Contain Secrets:**
- Risk: If a write operation fails due to invalid invoice/pubkey, the error message is logged as-is, could contain sensitive request details
- Files: `internal/handlers/handlers.go` (line 339-346 logs full response including error details)
- Current mitigation: Only agent/admin tokens can trigger writes, JSON fallback is local filesystem
- Recommendations: Sanitize response bodies before logging, mask pubkeys/invoices to first 8 chars

---

## Performance Bottlenecks

**Serialized Budget Checks Limit Throughput:**
- Problem: `budget.Enforcer.Check()` holds mutex for entire operation, including audit database query for DailySpend()
- Files: `internal/budget/enforcer.go` (lines 47-106)
- Cause: Mutex lock prevents concurrent budget checks, DailySpend() query touches all-rows audit table
- Improvement path:
  - Cache DailySpend() result in memory with TTL (e.g., 5-10 second update interval)
  - Or: Move daily spend caching to audit logger, update only when operations are logged
  - Or: Add separate table for daily spend aggregate, update on each write operation

**Audit Log Summary Query Is O(n):**
- Problem: `audit.Logger.Summary()` scans entire audit table multiple times (total count, endpoint counts, op_type counts, recent errors)
- Files: `internal/audit/logger.go` (lines 239-340)
- Cause: No materialized views or pre-aggregated summary table
- Improvement path:
  - Create summary_stats table updated by triggers on audit_log inserts
  - Or: Cache summary result with 1-minute TTL, only recompute on endpoint changes

**Rate Limiter Creates Bucket Entries Per Category:**
- Problem: RateLimiter maintains only 2 buckets (read/write) but queries full History table on every request via IsWriteEndpoint() map lookup
- Files: `internal/middleware/ratelimit.go` (lines 72-103), `internal/handlers/handlers.go` (line 370-386)
- Cause: Bucket allocation is lazy, but works fine; actual issue is endpoint classification requires string map lookup (not in hot path)
- Improvement path: Pre-hash endpoints or use radix tree if endpoint list grows beyond 50+

---

## Fragile Areas

**Write Handler Error Handling Inconsistency:**
- Files: `internal/handlers/write.go` (all write endpoints)
- Why fragile: Each write endpoint manually checks idempotency, budget, creates confirmation. Copy-paste errors easy (e.g., wrong budget op type, missing audit log)
- Safe modification: Extract common write flow to helper function that handles idempotency+budget+confirmation, takes only endpoint-specific logic
- Test coverage: 13 tests across write handlers, but gaps for edge cases like budget exceeded + idempotency simultaneous

**L402 Macaroon Verification Chain Depends on Helper Functions:**
- Files: `internal/middleware/l402.go` (lines 25-120), `internal/l402/macaroon.go` (lines 70-120)
- Why fragile: Verification order matters (caveat parsing → preimage check → endpoint check). If order changes or check is skipped, security breaks
- Safe modification: Add constants for caveat field names, validate all caveats before accepting token
- Test coverage: `internal/middleware/l402_test.go` has 234 lines but missing test for expired token + concurrent consume race

**Pending Operation Expiry Depends on Manual Loop:**
- Files: `internal/confirm/manager.go` (lines 110+, cleanupLoop)
- Why fragile: Background goroutine cleanup runs every 5 seconds, but expiry check in Confirm/List is immediate. Race between cleanup and request
- Safe modification: Use time.Timer per operation instead of periodic cleanup, or use sync.Map with time.Time values
- Test coverage: `internal/confirm/manager_test.go` tests basic flow but not concurrent expiry races

---

## Scaling Limits

**SQLite Write Throughput Ceiling:**
- Current capacity: ~100-200 writes/sec to SQLite (audit + idempotency + L402 combined) before WAL contention
- Limit: Beyond ~500 requests/sec, SQLite lock wait times become noticeable (1-5ms latency increase per request)
- Scaling path:
  - Phase 1: Batch audit writes (collect 10 operations, commit every 100ms)
  - Phase 2: Move audit log to PostgreSQL via Supabase, keep idempotency in SQLite
  - Phase 3: Move idempotency to Redis with PG fallback

**Goroutine Leak in Confirm Manager Cleanup Loop:**
- Problem: `Manager.cleanupLoop()` launched on New() has no stop mechanism
- Files: `internal/confirm/manager.go` (line 38)
- Limit: Gateway cannot gracefully shutdown confirm manager, cleanup goroutine runs forever
- Scaling path: Add context.WithCancel(context.Background()) to cleanup loop, call cancel on shutdown

**Memory Growth from Pending Operations:**
- Problem: PendingOp map grows unbounded if operations expire but cleanup doesn't run
- Files: `internal/confirm/manager.go` (lines 110-118, cleanupLoop)
- Limit: After 1000 pending operations (possible in high-load scenario), map entries not cleaned for 5 seconds
- Scaling path: Add maxPending cap, reject new operations above threshold, or decrease cleanup interval to 1 second

---

## Dependencies at Risk

**gopkg.in/macaroon.v2 — Maintenance Risk:**
- Risk: macaroon library is not actively maintained (last release ~2018), no recent security updates
- Impact: If vulnerability found in macaroon library, no patch path available
- Migration plan: Evaluate PASETO (https://paseto.io) as replacement for L402 tokens, or implement custom macaroon fork

**github.com/lightningnetwork/lnd — Version Pinning:**
- Risk: LND API may change between versions, gateway tight-coupled to LND gRPC API
- Impact: If LND major version change released, gateway may break (macaroon format, RPC signatures)
- Migration plan: Add LND version detection in health check, emit warning if LND version > tested version

---

## Missing Critical Features

**No Circuit Breaker for LND Failures:**
- Problem: If LND becomes unresponsive, gateway returns 502 errors for every request but keeps trying
- Blocks: Cannot implement graceful degradation (e.g., return cached node info, reject new writes)
- Impact: Under LND outage, gateway becomes blackhole for client requests
- Recommendation: Implement circuit breaker: after 5 consecutive LND errors in 10 seconds, fail-open with "lnd_unavailable" for 30 seconds, then retry

**No Request Signing/Verification (Beyond Bearer Auth):**
- Problem: All requests are HTTP POST with Bearer token — no body signature verification
- Blocks: Cannot detect if request was modified in transit (only TLS prevents this)
- Impact: Over unencrypted channels (if TLS not enforced), requests could be tampered
- Recommendation: Add optional HMAC-SHA256 signature validation for request body

**No Admin Action Audit Trail Beyond Logs:**
- Problem: When admin confirms operation, no structured record of who confirmed (IPs, User-Agent, etc.)
- Blocks: Cannot investigate unauthorized confirmations
- Impact: If admin token compromised, cannot audit which operations were confirmed by attacker
- Recommendation: Add confirmation_user_agent, confirmation_ip, confirmation_timestamp to confirmation record

---

## Test Coverage Gaps

**Write Operation Executor Endpoints Missing Tests:**
- What's not tested: `/v1/payments/send`, `/v1/invoices/create`, `/v1/peers/connect`, `/v1/peers/disconnect`, `/v1/routing/fees`, `/v1/rebalance` execution
- Files: `internal/lnd/executor_test.go` (only 155 lines, tests 3 endpoints)
- Risk: Changes to executor routing could break untested operations silently
- Priority: High — these are critical payment operations

**L402 Token Expiry Edge Cases:**
- What's not tested: Token consumption after expiration, concurrent consume calls, expired token refresh
- Files: `internal/l402/store_test.go` (157 lines but focuses on create/mark_paid/consume basic flow)
- Risk: Race condition where expired token is consumed by two concurrent requests
- Priority: High — L402 is new feature

**Budget Enforcer Daily Spend Rollover:**
- What's not tested: Budget check at midnight (24h rollover boundary), concurrent operations that exceed limit together
- Files: `internal/budget/enforcer_test.go` (minimal tests, no time-boundary tests)
- Risk: Off-by-one errors at midnight, or race where two operations both think they have headroom
- Priority: High — directly affects spending controls

**Idempotency Key Lifetime Edge Cases:**
- What's not tested: Idempotency key reuse after 24h expiry, concurrent request with expired key + new request same key, cleanup race
- Files: No dedicated idempotency tests found (check `internal/idempotency/store_test.go`)
- Risk: Key reuse violation or cleanup race could allow duplicate operations
- Priority: High — idempotency is critical for write safety

**Middleware Auth Token Boundary Cases:**
- What's not tested: Empty token, whitespace token, token with special chars, very long token (>10KB)
- Files: `internal/middleware/auth.go` (check if tests exist)
- Risk: Malformed tokens could trigger nil deref or panic
- Priority: Medium — recovery middleware catches panics, but logs should be clean

---

*Concerns audit: 2026-03-25*
