---
review: lnd-gateway (Go HTTP gateway to LND)
reviewed: 2026-04-16
reviewer: Claude (gsd-code-reviewer)
depth: deep
files_reviewed: 78
scope: All `*.go` under `lnd-gateway/`, excluding macOS Finder duplicates (`* 2.go`)
findings:
  critical: 5
  high: 8
  medium: 9
  low: 6
  info: 4
  total: 32
status: issues_found
---

# lnd-gateway Code Review

**Reviewed:** 2026-04-16
**Depth:** deep (cross-file analysis)
**Files Reviewed:** ~78 `.go` files (Finder duplicates `* 2.go` excluded)
**Status:** **issues_found** — 5 CRITICAL, 8 HIGH, 9 MEDIUM, 6 LOW, 4 INFO

## Summary

The gateway is well-structured (clean dependency injection, defense-in-depth on internal endpoints, atomic L402 consumption via `UPDATE…RETURNING`, advisory-locked credit reserves, post-hoc kill-switch from audit log). Phase 16.1 hardening visibly landed CloseChannel timeouts and a budget-leak fix.

However, there are **5 CRITICAL bugs that break the destructive-operation confirmation flow end-to-end**, plus several payment-correctness, leak, and DoS concerns. The most serious is a **JSON tag mismatch** between the agent-facing handler structs and the internal LND request structs: the executor unmarshals the stored request body into a struct whose field tags do **not** match the names the agent sent, so on confirm:

- **OpenChannel** silently drops `push_sats` (PushSat=0 ⇒ no push, even though the agent and the audit log both record a push amount).
- **CloseChannel** silently drops `chan_id` (ChannelPoint="" ⇒ executor immediately fails, never closes the channel).
- **SendOnChain** silently drops `address` and `amount_sats` (Addr="", Amount=0 ⇒ LND rejects, but had it passed it would have been a wrong destination).

In addition, **`/v1/payments/send` has no executor case at all** — admin confirmation returns `unknown endpoint for execution`, so Lightning payments cannot be made through the gateway despite all the surrounding plumbing. Daily-spend accounting is also broken because confirmed-operation audit rows use `op_type = "confirmed_…"`, which the budget query does not recognize, so the post-hoc kill switch will never fire on real outflows.

The L402 server is mostly correct — atomic single-use consumption is well-tested — but the L402 *client* (`/v1/l402/pay`) never persists its idempotency response, leaving keys "in-flight" forever, and never refunds on upstream failure. The L402 server also has no refund path: if LND is down when the data is fetched, the user has paid but the token is consumed, with no way to retry.

Quick wins (next 24h): fix executor JSON tags, add `payments/send` executor case, fix kill-switch self-trap, fix `IsWriteEndpoint` typo, bound the in-memory rate-limiter and login-attempts maps.

---

## Critical Issues

### CR-01 — Executor unmarshals stored request body with mismatched JSON tags; admin-confirmed Open/Close/SendOnChain silently drop fields

**Files:**
- `internal/lnd/executor.go:24-46`
- `internal/lnd/client.go:57-101`
- `internal/handlers/write.go:21-29` (OpenChannel req struct)
- `internal/handlers/write.go:110-115` (CloseChannel req struct)
- `internal/handlers/write.go:333-340` (SendOnChain req struct)

**Issue:**
The agent-facing handlers in `write.go` declare local structs whose JSON tags match the documented public API (`push_sats`, `chan_id`, `address`, `amount_sats`). On request, those structs are marshalled via `json.Marshal(req)` and stored on the pending operation as `RequestBody`. On admin confirm, `Executor.Execute` unmarshals that stored body into `lnd.OpenChannelRequest` / `lnd.CloseChannelRequest` / `lnd.SendCoinsRequest` — which use **different** JSON tags:

| Field | Handler struct tag (write.go) | Executor target struct tag (lnd/client.go) |
|---|---|---|
| Push sats | `push_sats` | `push_sat` |
| Channel ID | `chan_id` | `channel_point` |
| On-chain dest | `address` | `addr` |
| On-chain amount | `amount_sats` | `amount` |

After the round-trip, `PushSat`, `ChannelPoint`, `Addr`, `Amount` end up zero/empty. Consequences:

1. **OpenChannel:** the channel opens with `push_sat=0` regardless of what the agent requested or what the audit log records. The promised pushed sats never reach the peer.
2. **CloseChannel:** `grpc.go:332` does `strings.SplitN(req.ChannelPoint, ":", 2)` on `""` → returns `"invalid channel_point format, expected txid:index"` on every confirm. **All admin-approved channel closes fail.**
3. **SendOnChain:** `lnrpc.SendCoinsRequest{Addr:"", Amount:0}` — LND rejects but, more importantly, if a future LND version were lenient, this would silently swallow the request and lose money. Either way, no on-chain send ever succeeds via the gateway.

**Severity rationale:** These are the three most safety-critical operations in the gateway. Real LND testing (Phase 16.1) would have caught CR-01 immediately, suggesting end-to-end verification has not yet exercised any of the three confirmation flows against a live LND.

**Fix:** Either align JSON tags between the two struct families, or have `executor.go` use a shared canonical struct that both layers serialize against. Concretely:

```go
// internal/lnd/client.go
type OpenChannelRequest struct {
    NodePubkey         string `json:"node_pubkey"`
    LocalFundingAmount int64  `json:"local_funding_amount"`
    PushSat            int64  `json:"push_sats,omitempty"`        // was push_sat
    TargetConf         int32  `json:"target_conf,omitempty"`
    SatPerVbyte        int64  `json:"sat_per_vbyte,omitempty"`
    Private            bool   `json:"private,omitempty"`
    IdempotencyKey     string `json:"idempotency_key,omitempty"`
}

type CloseChannelRequest struct {
    ChannelPoint string `json:"chan_id"`        // was channel_point
    // ...
}

type SendCoinsRequest struct {
    Addr   string `json:"address"`   // was addr
    Amount int64  `json:"amount_sats"` // was amount
    // ...
}
```

Add a regression test in `internal/lnd/executor_test.go` that round-trips a JSON body produced by the handler-layer struct through the executor and asserts every field survives.

---

### CR-02 — Executor has no case for `/v1/payments/send`; admin confirmation always fails

**File:** `internal/lnd/executor.go:23-47`

**Issue:**
`Execute()` switches on endpoint and dispatches to `OpenChannel`, `CloseChannel`, `SendCoins` — but there is **no case for `/v1/payments/send`**. The handler in `write.go:188-273` enqueues a confirmation with that endpoint, and `handlers.go:184` calls `d.Executor.Execute(r.Context(), op.Endpoint, op.RequestBody)`. That falls through to:

```go
default:
    return nil, fmt.Errorf("unknown endpoint for execution: %s", endpoint)
```

So **every admin confirmation of a Lightning payment returns 502 with "lnd_error: unknown endpoint for execution: /v1/payments/send"**. No payment is ever sent.

This is especially concerning given Phase 16.1's stated goal was a "SendPayment confirmation flow refactor" — the refactor is incomplete.

**Fix:**
```go
case "/v1/payments/send":
    var req SendPaymentRequest
    if err := json.Unmarshal([]byte(requestBody), &req); err != nil {
        return nil, fmt.Errorf("unmarshal send payment request: %w", err)
    }
    return e.client.SendPayment(ctx, req)
```

(Also fix CR-01-style JSON tag drift between `write.go:189-195` and `lnd.SendPaymentRequest` — `fee_limit_sats` vs `fee_limit_sat`, `timeout_seconds` int vs int32. These will need the same alignment.)

Add a test mirroring `TestExecutor_OpenChannel` for the SendPayment case.

---

### CR-03 — Daily spend accounting double-broken: 202s excluded AND confirmed-200s use unmatched op_type → post-hoc kill switch never fires for L1 Lightning outflows

**Files:**
- `internal/audit/logger.go:152-166` (`DailySpend`)
- `internal/handlers/handlers.go:177, 196, 209` (confirmed audit OpType)
- `internal/handlers/write.go:262-272` (initial 202 audit OpType="payment")

**Issue:**
`DailySpend` filters with:

```sql
WHERE op_type IN ('payment','channel_open','onchain_send','rebalance')
  AND response_code < 400
  AND response_code != 202
  AND timestamp > datetime('now', '-24 hours')
```

But the gateway logs payment-flow rows in two distinct places:

1. **Initial agent request** (`write.go:262`) records `op_type="payment"` with `response_code=202` (confirmation pending). `DailySpend` correctly excludes these (`!= 202`).
2. **Admin confirm execution** (`handlers.go:209`) records `op_type="confirmed_/v1/payments/send"` with `response_code=200`. `DailySpend`'s `op_type IN (…)` clause does **not** match this, so the executed outflow is **never counted**.

Net result: actual successful Lightning payments, channel opens, and on-chain sends contribute **zero** to `DailySpend`. The post-hoc kill switch in `audit.Log` (`logger.go:135-149`) will therefore never engage because the daily total stays at 0 forever. The same query is also used by `Budget.Check` (`enforcer.go:103`) to gate the next operation, so the daily ceiling is effectively unenforced for confirmed L1 ops.

(Note: the L402 client path `op_type="l402_payment"` also won't match, but those are budget-checked in `Check("l402_payment", …)` so the per-op cap still bounds them.)

**Fix:** Either:

- (Preferred) Have the confirm handler log with the original op_type (`"payment"`, `"channel_open"`, `"onchain_send"`) and remove the `confirmed_` prefix; record an additional column or an `is_confirmed` boolean if needed for telemetry.
- Or expand the query: `op_type IN ('payment','channel_open','onchain_send','rebalance') OR op_type LIKE 'confirmed_%payment%' OR op_type LIKE 'confirmed_%channel_open%' …` — fragile, but works without a schema change.

Either way, drop the `response_code != 202` filter when the new op_type comes from confirmation.

Add a regression test that creates a confirmation, executes it in mock mode, and asserts `DailySpend()` returns the executed amount.

---

### CR-04 — L402 client never persists idempotency response on success; subsequent retries return "duplicate request in progress" forever

**File:** `internal/handlers/l402_client.go:67-148`

**Issue:**
The `/v1/l402/pay` endpoint reserves an idempotency key via `Idempotency.CheckAndReserve` (line 69) — which inserts a row with `status_code=0` (in-flight marker). On every subsequent path through the handler — success, error, mock — there is **no corresponding `d.Idempotency.Store(key, …)` call**. The key remains at status_code=0 for the entire 24-hour TTL.

`CheckAndReserve` (`internal/idempotency/store.go:108-115`) maps status_code=0 to:

```json
{"ok":false,"error":"duplicate request in progress"}
```

So a client that legitimately retries (because their TCP connection dropped after the L402 handshake but before they got the response) can never get the data they paid for. The payment also cannot be safely re-attempted via a different idempotency key, because the *macaroon+preimage* on the original L402 are already consumed by the upstream.

**Severity rationale:** This is a "lost-payment" class bug: the user pays, the gateway records that the payment happened, but the user can never retrieve the result.

**Fix:** Store the response after every terminal path:

```go
defer func() {
    if req.IdempotencyKey != "" {
        respBytes, _ := json.Marshal(finalResp)
        ld.Deps.Idempotency.Store(req.IdempotencyKey, "/v1/l402/pay", finalStatus, string(respBytes))
    }
}()
```

Capture `finalResp` and `finalStatus` consistently in each branch.

---

### CR-05 — L402 server has no refund path: paid token is consumed before LND fetch, so a downstream LND error charges the user with no data delivered

**Files:**
- `internal/middleware/l402.go:95-101` (token consumed in middleware)
- `internal/handlers/l402.go:36-46` (NodeStats handler runs after consume)
- `internal/handlers/shared.go:18-25` (FetchNodeStats — can fail with 502)

**Issue:**
`L402Auth` middleware atomically marks the token consumed (`store.Consume(result.PaymentHash)`) **before** invoking the handler. The handler then calls `FetchNodeStats`/`FetchNetworkAnalytics`/`FetchPromo`, which call LND. If LND returns an error (`ld.LND.GetInfo` returns err → 502), the user receives 502 and **no data**, but the L402 token is gone forever.

For a 5-sat read this is annoying; for an L402 with `network-analytics` at 25 sats per call (`l402.go:30`) it's a meaningful operator-controlled loss vector.

**Fix options (any one):**

1. Add an `Unconsume` / status-revert call invoked from a `defer` in the handler when the response is ≥500. This requires a new SQL statement that flips `consumed → paid` only when the row's status is currently `consumed` and its expiry hasn't passed.
2. Move the `Consume` call out of middleware and into the handler, only after the data is successfully fetched. (Race: a concurrent caller might be able to consume, but `Consume` is already atomic; the worst case is one extra 5-sat charge per failed fetch.)
3. Issue a fresh L402 challenge in the 502 response and document the policy.

Option (1) is the cleanest and matches the proxy `RefundReserve` pattern already in use for credit-paid endpoints (`accounts/store.go:810`).

Whatever you choose, add a test: paid+consumed token → handler returns 502 → confirm token is no longer "consumed" (or the user is otherwise made whole).

---

## High-Severity Issues

### HI-01 — `/v1/admin/kill-switch` is on the kill-switch block-list; once engaged via API it cannot be disengaged via API

**Files:**
- `cmd/lnd-gateway/main.go:515-530` (`killSwitchMiddleware` blocks if `IsWriteEndpoint`)
- `internal/handlers/handlers.go:389` (`/v1/admin/kill-switch` listed as write endpoint)

**Issue:**
`killSwitchMiddleware` checks `IsWriteEndpoint(r.URL.Path)` and 503s anything that matches when the switch is active. `/v1/admin/kill-switch` is in the write-endpoints map, so once an admin engages it via `POST /v1/admin/kill-switch {action:"engage"}`, the disengage call is also blocked. The only recovery path is to remove the file at `KillSwitchPath` on disk (which only works for the file-based switch, not the programmatic one in `killswitch.manual`).

**Fix:** Exempt `/v1/admin/kill-switch` from the block list (or add an explicit allow-list in `killSwitchMiddleware`):

```go
if ks.IsActive() && handlers.IsWriteEndpoint(r.URL.Path) && r.URL.Path != "/v1/admin/kill-switch" {
    // ... block
}
```

Same exemption probably belongs for `/v1/admin/restart-lnd` (operator may need to restart LND after killing writes).

---

### HI-02 — `/v1/payments/send` budget check uses a placeholder of 50_000 sats when invoice amount is missing

**File:** `internal/handlers/write.go:222-228`

**Issue:**
```go
amount := req.AmountSats
if amount <= 0 {
    // In production, decode the bolt11 invoice to get the amount.
    // For mock mode, use a placeholder.
    amount = 50_000
}
```

In production, this means: a user submits a bolt11 invoice with no `amount_sats` override, and the budget is checked as if the payment were exactly 50,000 sats — regardless of the actual invoice amount. A 1M-sat invoice slips through the per-op `MaxPaymentSats` check (because 50k < default 1M cap), then the executor (when CR-02 is fixed) will pay the real 1M sats. The audit log also records `AmountSats: 50000`, so daily spend tracking is wrong.

**Fix:** Decode the bolt11 invoice (e.g., `github.com/lightningnetwork/lnd/zpay32`) to extract the actual amount before budget check; reject with 400 if neither the invoice nor the request has a value.

---

### HI-03 — Bearer token comparison in `Auth` middleware is not constant-time

**File:** `internal/middleware/auth.go:74-86`

**Issue:**
```go
switch token {
case adminToken: level = TokenAdmin
case agentToken: level = TokenAgent
default: ... 403
}
```

A `switch` in Go on strings uses early-return equality, which is timing-distinguishable based on the common-prefix length of `token` and the secret. With a single attacker hitting the gateway repeatedly (and in particular over Cloudflare Tunnel where round-trip jitter is bounded), per-byte timing oracles on the admin token are theoretically achievable.

The CSRF check at `admin/csrf.go:44` and the CF Access shared-secret check at `middleware/cfaccess.go:44` already use `subtle.ConstantTimeCompare`. Bearer auth should too.

**Fix:**
```go
isAdmin := subtle.ConstantTimeCompare([]byte(token), []byte(adminToken)) == 1
isAgent := subtle.ConstantTimeCompare([]byte(token), []byte(agentToken)) == 1
switch {
case isAdmin: level = TokenAdmin
case isAgent: level = TokenAgent
default: /* 403 */
}
```

(Run both compares unconditionally so the response time doesn't reveal which token matched.)

---

### HI-04 — Global rate-limiter buckets (one per category) — a single noisy IP starves all clients

**File:** `internal/middleware/ratelimit.go:36-103`

**Issue:**
The `RateLimiter.allow(category, …)` method keys buckets by the literal strings `"read"` and `"write"`. There is **no per-IP, per-token, or per-agent partitioning**. A misbehaving agent (or even a single stuck retry loop) consuming the 10/min write quota blocks all other agents and admin operations for that minute. This contradicts the per-IP login limiter (`admin/ratelimit.go`) and the per-IP registration limiter (`accounts/store.go:260-269`), suggesting the global behavior is unintentional.

**Fix:** Key by client identity. For agent tokens, use the token level; for accounts, use `agent.ID`; otherwise fall back to client IP (with the same `CF-Connecting-IP` extraction used in `accounts/handlers.go:64-70`).

Worth bounding the bucket map size, too (e.g., LRU or periodic GC) to prevent memory growth from spoofed `X-Forwarded-For`.

---

### HI-05 — `LoginRateLimiter.attempts` map is never trimmed; admin login DoS opens an unbounded memory growth vector

**File:** `internal/admin/ratelimit.go:14-74`

**Issue:**
The login limiter records every IP that fails (`RecordFailure`). The map is only cleaned up on a subsequent `Allow` call from the same IP (`l.attempts[ip]` → window expired → `delete`). An attacker hitting the login endpoint from rotating IPs (or spoofed `X-Forwarded-For`) inserts entries that never get pruned, producing unbounded memory growth.

`SessionStore` (`admin/session.go`) has the same problem: `delete` only fires inside `Validate`, so unused expired sessions accumulate.

**Fix:** Add a background cleanup goroutine for both maps (mirror `confirm/manager.go:117-131`), and cap map size — when above N entries, evict the oldest first.

---

### HI-06 — `UpdateChannelFees` and `Rebalance` execute immediately with no confirmation flow

**Files:**
- `internal/handlers/analytics.go:110-199` (`Rebalance`)
- `internal/handlers/analytics.go:204-273` (`UpdateChannelFees`)

**Issue:**
Both endpoints are write operations that move funds (rebalance) or change revenue policy (fees) — yet neither calls `d.Confirm.Create`. The agent token alone can:

- Initiate a circular rebalance up to `MaxRebalanceFeeSats` (default 10,000 sats).
- Drop fees on **all channels** to zero (`req.ChanID == "" → policyReq.Scope = Global{Global: true}`), instantly making the node a free-routing target.

`UpdateChannelFees` also does **no budget check at all** — it bypasses `d.Budget.Check` entirely. The audit row (`analytics.go:263-272`) records the operation but with no spend tracking.

**Fix:** Mirror the `OpenChannel` pattern: budget-check, create a confirmation, return 202. For fee changes, especially the `chan_id == ""` global case, require admin confirmation.

---

### HI-07 — Channel-faucet `openChannelAsync` ignores the `ConnectPeer` error after "already connected"; race against eviction

**File:** `internal/accounts/handlers.go:213-221`

**Issue:**
```go
_, err := h.LND.ConnectPeer(connectCtx, pubkey, host)
if err != nil && !strings.Contains(err.Error(), "already connected") {
    // mark failed
}
```

Substring-match on a string from a remote gRPC layer is fragile (LND has changed wording across minor versions). If `ConnectPeer` returns a transient error (e.g., context deadline because peer is slow), the handler still proceeds to `OpenChannel`, which immediately fails with "peer not connected" — but by then the slot has been reserved (`ReserveChannelSlot`) and now there is a `failed` grant burning a slot. Worse: under sustained network issues, `FaucetChannelCap` (default 100) gets exhausted quickly with phantom failures.

**Fix:**
- Use error type/wrapping (`errors.Is(err, lnd.ErrAlreadyConnected)`) — define a sentinel in the gateway and inspect gRPC status codes (`status.Code(err) == codes.AlreadyExists`).
- Distinguish "transient" (timeout, network) from "permanent" (peer banned, bad pubkey). For transient, retry once; for permanent, `failed`+`banned`.
- Consider only counting `failed` slots toward the cap if `banned == true`, so transient failures don't permanently reduce capacity.

---

### HI-08 — Channel-faucet poller's `pendingChannel → failed` recovery is asymmetric: `pending_open` rows with no LND match never time out

**File:** `internal/accounts/channel.go:92-174`

**Issue:**
The poller transitions `status='pending' AND funding_txid='' AND created_at < now-1h` to `failed` (lines 105-112). But `status='pending_open'` rows (funding txid set, awaiting confirmations) only transition forward to `open` or `closed` — there is **no failure path**. If `OpenChannel` returned a funding txid that never confirms (e.g., RBF dropped, mempool eviction, or LND lost track), the slot stays in `pending_open` forever, permanently consuming a faucet slot.

`AggregateMetrics` (`accounts/store.go:573-593`) counts `status != 'failed'` toward `TotalChannelsOpened` and `FaucetSlotsRemaining`, so the cap arithmetic also rots.

**Fix:** Add a stale recovery for `pending_open`:

```go
if grant.Status == "pending_open" && grant.CreatedAt.Before(time.Now().Add(-24*time.Hour)) {
    // not in active or closed channels per LND
    if !activeChannels[channelPoint] && !closedChannels[channelPoint] {
        ch.Store.UpdateChannelStatus(ctx, grant.ID, "failed", "", "stale_pending_open: not seen by LND after 24h", grant.OutputIndex)
    }
}
```

Plus an admin endpoint to manually fail a stuck grant.

---

## Medium-Severity Issues

### MD-01 — `IsWriteEndpoint` typo: `/v1/onchain/newaddr` does not match the registered route `/v1/onchain/newaddress`

**File:** `internal/handlers/handlers.go:383`
Rate-limit and kill-switch treat `NewAddress` as a read, so it slips both gates.
**Fix:** Change to `"/v1/onchain/newaddress": true`. Also add `/v1/admin/restart-lnd` if it should be rate-limited.

---

### MD-02 — `IsWriteEndpoint` does not list `/v1/reject`, `/v1/l402/pay`

**File:** `internal/handlers/handlers.go:376-392`
`/v1/l402/pay` initiates a Lightning payment — it is the most write-y endpoint there is — but is treated as a read by the rate limiter. `/v1/reject` is admin-only and probably fine, but the rate-limit miss is worth fixing for symmetry.

---

### MD-03 — Audit `request_body` and `response_body` may contain bolt11 invoices, preimages, and macaroon strings — operator-readable but log-leak-sensitive

**Files:**
- `internal/handlers/write.go:99` (RequestBody = full payment request including bolt11)
- `internal/handlers/handlers.go:344-353` (logAndRespond serializes full response into ResponseBody)
- `internal/audit/logger.go:113` (raw insert)

**Issue:** A bolt11 invoice contains the destination, payment hash, and (for some flows) preimage; admin confirm rows store request bodies that carry these. Anyone with read access to the audit DB can replay enough information to attribute every payment. There is no mention in `CLAUDE.md` of audit DB access controls, and the JSON fallback file is mode `0640` (owner+group read).

**Fix:** Either redact obviously-sensitive fields (preimages, full bolt11) before insert, or restrict audit DB perms to mode `0600` and document that the audit log is sensitivity-equivalent to LND state.

---

### MD-04 — `slog.Logger` may be nil in `audit.Logger.Log` post-hoc check; nil deref on misconfiguration

**File:** `internal/audit/logger.go:130, 138, 143`

The fallback path calls `l.logger.Error(...)`. If `audit.New` were ever invoked with `logger == nil` (unlikely from main, but plausible from tests or a future refactor), the program crashes inside the panic-recovery middleware → 500 to client. Same for `proxy.go:194-196` and `channel.go:120-121` which check `if h.Logger != nil` selectively but not consistently.

**Fix:** Guard or use `slog.Default()` if logger is nil.

---

### MD-05 — `accounts/store.go ListAgents` uses `LATERAL` subquery for sort-by-balance; the WHERE on `a.name` doesn't push down through the lateral join, causing full-scan on large datasets

**File:** `internal/accounts/store.go:451-498`

Functional-correctness OK; this is a perf/operational concern. With ~100 agents (current FaucetChannelCap) it's fine. If the gateway later scales and removes that cap, this query becomes O(N²).
Out of v1 scope per the task definition; flagging only because the comment says "performance is out of scope" — but this one is also a *DoS via expensive endpoint* concern: an unauthenticated request that triggers admin login → list_agents could pin a CPU.

---

### MD-06 — `accounts/handlers.go Register` returns 500 with generic "registration failed" — masks `ErrFaucetCap` from the inner txn check

**File:** `internal/accounts/handlers.go:107-114`

The handler does an explicit `CheckFaucetCap` first (lines 91-105), but `Store.Register` *also* checks the cap inside the transaction and returns `ErrFaucetCap`. If the cap is hit between the two checks, the user gets a 500 instead of the friendly 429 the first check would have produced. Switch on `errors.Is(err, ErrFaucetCap)` and return 429 in that case.

---

### MD-07 — `MarkPaid` is logged on every successful invoice settlement (assumed via `InvoiceCallback`), but I could not find the wire-up in `cmd/lnd-gateway/main.go`

**Files:**
- `internal/handlers/l402.go:181-183` (`InvoiceCallback`)
- `cmd/lnd-gateway/main.go` — no caller

`InvoiceCallback` exists but isn't subscribed to LND's `SubscribeInvoices` stream. In production, paying an L402 invoice externally would not transition the token from `pending → paid`, and the user could not consume it. The mock-mode autopay (`l402.go:101-103`) hides this in tests.

**Fix:** Wire up an LND `SubscribeInvoices` goroutine in main and call `InvoiceCallback` on `INVOICE_SETTLED`. Until then, document that L402 only works in mock mode, and add a runtime error if `L402_ENABLED && !MockMode` and the callback isn't attached.

---

### MD-08 — `Cleanup` loops in `idempotency/store.go:140-158` and `l402/store.go:183-202` use `time.Sleep(100ms)` between batches, but the outer loop has no upper bound on iterations

If the row count grows pathologically (say the audit DB grows to millions of rows due to no retention policy), this can hold the cleanup goroutine for hours. Add a max-iteration cap or a deadline.

---

### MD-09 — Recovery middleware logs the panic stack to slog but does not include the request ID

**File:** `internal/middleware/recovery.go:10-28`

The panic log lacks `request_id`, making correlation with the structured request log impossible. Add `"request_id", middleware.GetRequestID(r.Context())` to the slog call.

---

## Low-Severity Issues

### LO-01 — `gRPCClient.OpenChannel` uses `OpenChannelSync` but the comment in `lnd/client.go:26-28` (and the audit log shape) implies async — the synchronous variant blocks the gateway worker for the entire LND open

**File:** `internal/lnd/grpc.go:308`

`OpenChannelSync` returns once the funding tx is broadcast, which can take a few seconds on a busy mempool. With the 30s `WriteTimeout` (`main.go:457`), a slow open could time out the HTTP response while LND is still working. Switch to streaming `OpenChannel` with a bounded read of the first `ChanPending` message, then return.

---

### LO-02 — `lnd/grpc.go:235` uses `resp.SatPerKw / 250` to approximate sat/vB

The 250 divisor is "approximately right" (1 vB ≈ 4 wu, kw is per-1000-wu). The actual divisor is 250 only by coincidence (1000/4=250). Fine for budget guard arithmetic, but the audit value labelled `sat_per_vbyte` will be ±25% off in some regimes. Document or compute properly: `satPerVByte = (satPerKw + 999) / 1000 * 4` (rounded).

---

### LO-03 — `Rebalance.LastHopPubkey: []byte(info.IdentityPubkey)`

**File:** `internal/lnd/grpc.go:792`

`info.IdentityPubkey` is a hex string, but `LastHopPubkey` expects raw 33-byte pubkey. This passes the ASCII hex bytes as the pubkey, which LND will reject as "invalid pubkey length". The whole self-rebalance path is broken until this is decoded with `hex.DecodeString`.

(Demoted from CRITICAL because the rebalance endpoint is rarely the agent's first move and the failure is a clean error rather than a fund loss; promote to HIGH if production traffic uses this.)

**Fix:**
```go
selfPub, err := hex.DecodeString(info.IdentityPubkey)
if err != nil {
    return nil, fmt.Errorf("decode self pubkey: %w", err)
}
// ...
LastHopPubkey: selfPub,
```

---

### LO-04 — `inChanID` parsed but unused; comment `_ = inChanID` admits the IncomingChanID field has no effect

**File:** `internal/lnd/grpc.go:759, 800`

The route hint for last-hop is missing — rebalances can reroute through any channel, which defeats the purpose of "circular rebalance from A to B". Add the `RouteHints` for the incoming channel using `lnrpc.RouteHint` populated from `GetChanInfo`. Until done, the endpoint is misleading.

---

### LO-05 — MCP `handleRegister` always passes empty IP

**File:** `internal/mcpserver/handlers.go:84`

The per-IP registration limit (3/hour) effectively becomes "3 registrations total per hour from any MCP client" because all share the empty-IP key. Either extract IP from the upstream HTTP request via the MCP context or apply a separate MCP-specific limiter.

---

### LO-06 — Multiple `_ = mock.ConnectPeer()` discards in `handlers.go:211` and `executor_test.go` — easy to confuse with a real call site during refactor

Stylistic. Replace with a helper or comment block that explains "no-op in mock".

---

## Info / Cleanup

### IN-01 — 61 macOS Finder duplicate files (`* 2.go`, `* 2.html`, `* 2.json`) under `lnd-gateway/`

These compile as part of the package and **redefine the same symbols**, which means the build either fails or one file silently shadows another depending on file ordering. Several `* 2.go` files I sampled (e.g., `internal/handlers/l402_client 2.go`) contain code that diverges from the canonical version. **Run `find lnd-gateway -name "* 2.*" -delete` immediately** and re-run `go vet ./...` and `go test ./...`.

(Out of scope for review per task instructions, but the duplication is a real correctness risk.)

---

### IN-02 — Several `make test` runs would not fail on the CR-01/CR-02 bugs because `executor_test.go` uses fresh `OpenChannelRequest{...}` Go struct values, not JSON round-trip

Add a single integration test that exercises the full flow: handler → confirm → executor → mock LND, with the assertion that all original field values survive. This is the canary that would have caught CR-01 and CR-02 before deploy.

---

### IN-03 — Inconsistent JSON encoding helper: `middleware.WriteJSON` calls `json.NewEncoder(w).Encode(data)` which appends a trailing newline; some tests assert exact body strings without the newline and may be brittle

Stylistic. Consider `json.Marshal + Write` for predictability or document the trailing newline.

---

### IN-04 — `cmd/lnd-gateway/main.go:443-460` — graceful shutdown does NOT cancel the periodic cleanup goroutine, the channel-faucet poller, the proxy reserve cleanup, or the confirm cleanup loop

Most of these run forever and don't hold critical resources, so the leak is fine in practice. But on a reload/restart, the SQLite handles in `idempStore.Cleanup`/`l402Store.Cleanup` may run after `db.Close()` and log spurious errors. Pass the shutdown context into them.

---

## Test Coverage Gaps (Critical Paths)

The codebase has 247 tests but the following paths are unverified:

| Path | Why it matters |
|---|---|
| End-to-end agent → confirm → executor → LND for OpenChannel/CloseChannel/SendOnChain | Would have caught CR-01 |
| End-to-end agent → confirm → SendPayment | Would have caught CR-02 |
| `DailySpend` after a confirmed payment | Would have caught CR-03 |
| `/v1/l402/pay` with idempotency key on success path | Would have caught CR-04 |
| L402 token retention when downstream FetchNodeStats fails | Would have caught CR-05 |
| Kill-switch self-trap (engage → try disengage via API) | Would have caught HI-01 |
| Rebalance self-payment with hex-decoded pubkey | Would have caught LO-03 |
| InvoiceCallback wiring in non-mock mode | Would have caught MD-07 |
| Concurrent rate-limit consumption from N IPs | Would have caught HI-04 |

I'd suggest one test file per CRITICAL: a one-shot integration that drives the full path through the handler chain in mock mode. Each is small (50-100 lines) and tightly bounds the regression surface.

---

## Recommended Triage Order

1. **CR-01, CR-02** — fix executor JSON tags and add SendPayment case **before any LND-connected deploy**. Right now, the gateway can read but cannot reliably write.
2. **CR-03** — fix DailySpend op_type matching. Without this, the daily spend cap is unenforced for the most common operations.
3. **HI-01** — add kill-switch self-exemption. Trivial change, high recovery value.
4. **CR-04, CR-05** — close the L402 gaps. Both involve user funds.
5. **HI-02, HI-06** — payment-amount placeholder + missing confirmation on rebalance/fees.
6. **HI-03, HI-04, HI-05** — auth/limit hardening.
7. **MD-07** — wire up InvoiceCallback before enabling L402 in production.
8. **IN-01** — delete the Finder duplicates.

---

_Reviewed: 2026-04-16_
_Reviewer: Claude (gsd-code-reviewer), Opus 4.7 (1M)_
_Depth: deep — full-file read for handlers/lnd/l402/accounts/admin/middleware/audit/budget/idempotency/confirm/killswitch/mcp; spot-checked tests for critical-path coverage_
