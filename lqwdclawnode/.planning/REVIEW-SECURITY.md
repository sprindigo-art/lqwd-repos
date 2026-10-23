# Security Threat Review — LQWDClaw-NodeOps Pre-Production Audit

**Date:** 2026-04-16
**Scope:** `/Users/joshuajackson/Desktop/LQwD/ClaudeCode/lqwdclawnode/`
  (`lnd-gateway/`, `lqwdclaw-nodeops/`, `lqwdclaw-social/`)
**Production Gate:** "Grade A scan, no CRITICAL/HIGH findings" (per `CLAUDE.md`).
**Overall Grade:** **D** — gate FAILED. 4 CRITICAL findings + 4 HIGH findings.

---

## 1. Macaroon Handling — Verdict: PARTIAL

### Evidence
- Loading: `lnd-gateway/internal/lnd/macaroon.go:47-82` reads four scoped macaroons
  (readonly / invoice / channeladmin / pay) once at startup, holds raw bytes hex-encoded
  inside a per-call gRPC credential.
- Transport: `internal/lnd/macaroon.go:24` enforces `RequireTransportSecurity()=true` —
  refuses to send macaroons without TLS.
- Scope discipline: each LND call passes the *correct* scope option, e.g.
  `c.macaroons.Pay` for `SendPayment` (`grpc.go:403`), `Readonly` for queries.
- Logs: `Grep` for sensitive identifiers in any
  `slog.Info/Debug/Error/Warn` call returned **no matches** — macaroons are not
  written to logs.
- `.macaroon` files are gitignored (`/.gitignore:35`).

### Issues
- **HIGH (M-1):** `LND_MACAROON_DIR` defaults to `/lnd/data/chain/bitcoin/mainnet`
  (`internal/config/config.go:98`). If the gateway and LND share a host where LND's
  data dir is readable by the gateway user, the gateway loads `admin.macaroon`-equivalent
  authority because `channeladmin.macaroon` plus `pay.macaroon` together cover almost
  every destructive RPC — there is no review of whether each macaroon is in fact
  scope-limited (no caveats verified). A misconfigured LND that bakes `admin` perms
  into `channeladmin.macaroon` would silently grant full control.
- **MEDIUM (M-2):** `NewAddress` uses `c.macaroons.ChannelAdmin` (`grpc.go:527`) instead
  of `Pay` or a dedicated wallet macaroon — broader privilege than required.

### Exploit Scenario
If anyone obtains the raw `agent` token (it is on disk at
`/etc/lnd-gateway/agent-token`, world-unreadable by convention but unverified
in code) they can drive any non-confirmation write call. There is no per-call
attestation that the gRPC scope matches the HTTP intent.

### Remediation
- Verify LND issues these macaroons with explicit caveats before deployment.
- Switch `NewAddress` to a less-privileged macaroon.
- Pre-startup self-check: call a known-forbidden gRPC on each macaroon and
  refuse to start if it succeeds.

---

## 2. L402 Token Lifecycle — Verdict: MITIGATED (with caveats)

### Evidence
- Single-use: `internal/l402/store.go:115-159` uses
  `UPDATE … RETURNING` in one statement to atomically transition `paid → consumed`
  while also enforcing `expires_at > ?`. This closes the TOCTOU window between
  state check and read-back (per D-01/D-02).
- Preimage check: `internal/l402/macaroon.go:130-141` uses `hmac.Equal` (constant-time).
- Macaroon HMAC: signing key validated to be 32 bytes (`macaroon.go:27`).
- Endpoint binding: caveats include `endpoint`, `method`, `expires_at`,
  `payment_hash` (`macaroon.go:42-47`); `middleware/l402.go:77-92` enforces all four.
- Cleanup runs hourly with batched `LIMIT 1000` deletes to avoid lock contention
  (`store.go:183-202`).
- Signing-key storage: hex env var only, no rotation mechanism.

### Issues
- **MEDIUM (L-1):** No signing-key rotation. A leak of `L402_SIGNING_KEY` makes
  every outstanding token forgeable until the binary is restarted with a new key,
  at which point all paid-but-unconsumed tokens become invalid (revenue loss).
  Add multi-key support (current key + previous key for grace window).
- **LOW (L-2):** Mock-mode auto-pays the invoice and returns the preimage in the
  402 challenge response (`internal/handlers/l402.go:101-117`). Acceptable for
  testing but the handler does not gate this behaviour on `MockMode` strictly —
  `cfg.MockMode` flows through `L402Deps.MockMode`. Verify production builds
  cannot be tricked into setting `GATEWAY_MOCK=true` post-deploy (env-var
  injection attack on the systemd unit).

### Remediation
- Add `L402_SIGNING_KEY_PREVIOUS` + try previous on Verify failure.
- Make `MockMode=true` panic at startup if the binary path or hostname matches a
  production allowlist.

---

## 3. Admin Authentication — Verdict: PARTIAL

### Evidence
- Sessions: 32-byte `crypto/rand` opaque tokens, base64url, in-memory store
  (`internal/admin/session.go:36-52`). `HttpOnly`, `Secure`, `SameSite=Strict`,
  scoped to `/admin/`.
- CSRF: double-submit cookie + `subtle.ConstantTimeCompare`
  (`internal/admin/csrf.go:44`).
- Brute-force: in-memory limiter `5/15min` per IP
  (`internal/admin/ratelimit.go`, `handlers.go:67`).
- Bcrypt: dummy-hash branch ensures bcrypt runs on wrong username to avoid timing
  oracle (`handlers.go:84-90`). Cost factor 12.
- Login emits both `session` and `csrf_token` cookies (`handlers.go:113-130`).

### Issues
- **HIGH (A-1):** Sessions live **only in process memory** (`session.go:24-26`).
  Restarting the gateway invalidates every admin session — but it also means a
  multi-replica deployment cannot share state. The dashboard cookie path is
  `/admin/` (line 116) but the admin API mux is mounted at `/admin/api/…`
  (covered by the prefix). Acceptable for single-instance, document this constraint.
- **HIGH (A-2):** `clientIP` (`handlers.go:44-55`) trusts the **first** entry of
  `X-Forwarded-For` *unconditionally*. Behind Cloudflare this is fine, but the
  rate limiter is the only brute-force defence and an attacker who can reach the
  gateway directly (e.g. internal LAN, leaked origin IP) can spoof
  `X-Forwarded-For: 1.2.3.4` to rotate IPs and bypass the 5/15min limit. The
  CF-Access JWT check does NOT cover `/admin/api/login` — only API key paths.
- **MEDIUM (A-3):** No session rotation after privilege change
  (`UpdateStatus`, `GrantCredits`) — a stolen pre-grant cookie keeps post-grant
  authority for the full 24h.
- **MEDIUM (A-4):** Login does not require CSRF token (it's the bootstrap step),
  but neither does it use a bound CSRF on the login *form*. A login-CSRF
  attacker could log a victim in as the attacker. Low impact (no destructive
  cross-account actions possible) but should be documented.

### Remediation
- Pin admin login to CF Access in production (move login behind the CF tunnel).
- Use `RemoteAddr` as the rate-limiter key, not XFF, OR validate XFF chain
  against a CF Access allowlist.
- Rotate session ID after privilege escalation.

---

## 4. Payment Authorization — Verdict: **EXPOSED**

### Evidence
- Two-phase confirmation flow exists for `OpenChannel`, `CloseChannel`,
  `SendPayment`, `SendOnChain` (`internal/handlers/write.go:80, 160, 247, 391`).
- Admin-only confirm/reject/list (`cmd/lnd-gateway/main.go:213-215`).

### CRITICAL Issues
- **CRITICAL (P-1):** `internal/lnd/executor.go:23-47` only handles
  `/v1/channels/open`, `/v1/channels/close`, `/v1/onchain/send`. **The
  `SendPayment` and `Rebalance` confirmation paths fall through to
  `default → "unknown endpoint for execution"` error.** Phase 16.1's
  SendPayment confirmation flow is therefore *not actually executed* in
  production: an admin clicking "confirm" returns a 502 and the payment never
  goes through. (Note: the request reaches LND only via the executor — there is
  no fallback path.) Either an inadvertent denial-of-service for the operator,
  *or* a sign that the team has been testing only in mock mode where
  `ConfirmOperation` returns success on line 165-181 of `handlers.go` regardless.
  Verify against Phase 16.1 UAT — if UAT was mock-only, **this gate is not met**.
- **CRITICAL (P-2):** `internal/handlers/write.go:111-118` defines `CloseChannel`
  request as `chan_id`, but `internal/lnd/executor.go:31-36` unmarshals the
  cached request body into `lnd.CloseChannelRequest` whose JSON tag is
  `channel_point` (`internal/lnd/client.go:69`). So **even cooperative close
  confirmations would fail at LND** with "invalid channel_point format" because
  the field never deserialises. Same field-name mismatch class as P-1.
- **CRITICAL (P-3):** `Rebalance` (`internal/handlers/analytics.go:110-199`)
  executes immediately, **bypassing the confirmation flow** even though it
  initiates a real Lightning payment through `routerrpc.SendPaymentV2` with a
  fee budget. The agent token alone can drain up to `MaxRebalanceFeeSats`
  (default 10_000) per call without admin approval, repeatedly until the daily
  cap is reached. Combined with rate-limit-write of 10/min (default), this is
  ~6_000_000 sat in fees per day at the per-op limit before daily cap kicks in
  (cap default 10_000_000 sat). The agent could also grief the node by
  scheduling many rebalances that fail at routing but consume gateway resources.
- **CRITICAL (P-4):** `RestartLND` (`internal/handlers/handlers.go:289-320`)
  is reachable by the **agent** token (registered without `RequireAdmin` —
  `cmd/lnd-gateway/main.go:219`). The handler writes a trigger file at
  `filepath.Join(d.DataDir, "restart-lnd")`. While the path itself is
  controlled, this gives an attacker who steals the agent token (or who
  prompt-injects the LLM) the ability to repeatedly restart LND, causing
  channel force-close cascades from peers that interpret unresponsive nodes
  as offline. Should be `RequireAdmin`.

### HIGH Issues
- **HIGH (P-5):** `L402Pay` (`internal/handlers/l402_client.go:84`) reserves
  budget for `req.MaxSats` but the actual amount paid is
  `challengeBody.Data.AmountSats` (`l402_client.go:201`). After the call:
  - Audit log entry records `result.PaidSats` (line 134) — different number
  - Daily-spend ceiling tracks the actual paid amount, not the reserved one
  - The unspent reservation is silently released (no explicit refund step)
  This means the daily budget can be **over-consumed** if an attacker passes a
  large `MaxSats` then is served a tiny invoice — repeat to OOM the budget
  accounting. Also enables a confused-deputy: budget thinks 1000 sat were
  spent (the `MaxSats`), agent records 5 sat in audit, and ledger drifts.

### Remediation
- Add `/v1/payments/send` and `/v1/rebalance` to `executor.go` switch.
- Fix `chan_id`/`channel_point` field mismatch — either change handler struct
  or pre-translate in the handler before storing the request body.
- Move `Rebalance` behind confirmation OR cap it strictly to `MaxRebalanceFeeSats`
  and prove daily aggregation is correct.
- Wrap `RestartLND` with `middleware.RequireAdmin`.
- Re-budget `L402Pay` against the true invoice amount after parsing the 402
  response, not `MaxSats`.

---

## 5. Input Validation — Verdict: PARTIAL

### Evidence
- All write handlers `json.NewDecoder(r.Body).Decode` then validate required
  fields (`internal/handlers/write.go` throughout).
- Pubkey hex validation: `accounts.ValidatePubkey` enforces 66-char hex
  (`accounts/handlers.go:122`).
- Idempotency keys for proxy require UUID v4 (`accounts/proxy.go:51`).
- SQL: every accounts query uses parameterised `pgx` placeholders. Sort
  columns are allow-listed (`accounts/store.go:435-449, 503-518`) → no SQL
  injection observed.

### Issues
- **HIGH (V-1):** `internal/middleware/json.go` has *no body-size limit* —
  `http.MaxBytesReader` is not used anywhere in the codebase
  (verified via Grep). The HTTP server's `ReadTimeout=30s` slows but does not
  stop a multi-gigabyte JSON DoS that would exhaust memory before the timeout.
- **MEDIUM (V-2):** `OpenChannel` slices into `req.NodePubkey[:8]` /
  `[len-8:]` (`write.go:75`) without checking length first. If the agent
  posts a pubkey shorter than 8 chars (validation only checks `!= ""`,
  line 36) the handler panics — caught by `Recovery` middleware but still
  spammy and DoS-friendly. Same pattern in `SendOnChain` for `Address`
  (`write.go:385`).
- **MEDIUM (V-3):** `ConnectPeer` slices `pubkey[:16]` in `grpc.go:553` and
  `557` without length check; LND may return a 33-byte hex pubkey but if a
  caller sends a shorter value through the executor, the LND error path
  panics.
- **LOW (V-4):** `LookupInvoice` accepts any hex length for `r_hash` and
  passes to LND without local validation.

### Prompt-Injection Surface
- The agent reads tool output verbatim and acts on it. A malicious peer
  alias / channel memo / invoice memo returned by `ListChannels` or
  `LookupInvoice` could embed adversarial instructions instructing the LLM
  to call destructive endpoints. The identity files (`SOUL.md`, `AGENTS.md`)
  instruct caution but there is **no sanitisation** of LND-returned strings
  before they enter the LLM context window. The L402 invoice memo
  (`handlers/l402.go:147 — "L402 access: %s"`) is fully attacker-controlled.

### Remediation
- Wrap the gateway mux in a `http.MaxBytesReader(64 KiB)` (or per-route).
- Add `len(req.NodePubkey) >= 16` and similar guards before slicing.
- Add an LLM-side prompt-injection filter in `lqwdclaw-nodeops` skills
  (truncate / escape known instruction patterns in tool output).

---

## 6. Secrets — Verdict: PARTIAL

### Evidence
- `.env` is gitignored (`/.gitignore:14-16`).
- `.env` actually present at `lnd-gateway/.env` containing
  `ADMIN_PASSWORD_HASH` (bcrypt) and `GATEWAY_MOCK=true`. No raw passwords.
- No sensitive identifier literal logged via `slog` (verified Grep).
- Macaroons / TLS gitignored (`*.macaroon`, `tls.cert`, `tls.key`).

### Issues
- **HIGH (S-1):** `internal/audit/logger.go:113-128` writes the entire
  `request_body` JSON to SQLite for every call. For `/v1/payments/send`,
  this includes the **bolt11 invoice**. After payment succeeds (and the
  preimage is later revealed in `payment_preimage`), an attacker with audit
  DB read access can reconstruct payments and prove value flows. More
  immediately: the bolt11 invoice itself is a payable token until it
  settles — anyone who reads the audit log within seconds of submission
  could pay-and-forward it. The `_test.go` writes `0640` to the fallback
  file, but the SQLite file inherits umask. Verify deployment perms.
- **MEDIUM (S-2):** `audit_log` retains `IdempotencyKey` indefinitely.
  Combined with request bodies, this is a permanent ledger of every
  payment — fine for accounting, but consider a retention policy /
  encryption-at-rest.
- **MEDIUM (S-3):** `ADMIN_PASSWORD_HASH` is in the on-disk `.env` file at
  `lnd-gateway/.env`. Bcrypt cost 12 buys ~250 ms per try; combined with
  the 5/15min limiter this is acceptable, but consider moving secrets to
  systemd `LoadCredentialEncrypted=` or a vault.
- **LOW (S-4):** `clientIP` puts the (possibly spoofed) IP into the rate
  limiter map — unbounded growth if attacker rotates spoofed IPs.

### Remediation
- Redact `payment_request` from audit `request_body` before persisting
  (store only `invoice_hash` and `amount_sats`).
- Tighten audit DB file mode and document deployment permissions.

---

## 7. Faucet Abuse — Verdict: MITIGATED

### Evidence
- Three layers of caps:
  1. Per-IP registration: 3/hour (`accounts/store.go:260-269`).
  2. Daily faucet sat cap inside the registration transaction
     (`store.go:142-151`) — TOCTOU-safe.
  3. Channel-grant cap (`FAUCET_CHANNEL_CAP=100`) enforced via PG advisory
     lock `channelCapLockKey` (`store.go:90`).
- Pubkey reused → ban flag (`accounts/handlers.go:160` + `ChannelHandlers`).
- Pubkey format validated (`ValidatePubkey`).
- Failed channel opens transition to `failed` after 1 hour by the poller
  (`channel.go:104-112`) so slots are reclaimed.

### Issues
- **MEDIUM (F-1):** `clientIP` for registration uses `CF-Connecting-IP` then
  `RemoteAddr` (`accounts/handlers.go:64-71`). It does **not** validate that
  the request actually came through Cloudflare — anyone hitting the origin
  directly with their own `CF-Connecting-IP: 1.1.1.1` bypasses the
  per-IP cap. If `INTERNAL_AUTH_SECRET` leaks the entire faucet can be
  drained from one host.
- **LOW (F-2):** MCP `handleRegister` (`internal/mcpserver/handlers.go:84`)
  passes empty IP `""` to `Register`. All MCP-channel registrations share
  one bucket — first attacker to hit "" wins 3/hour, but every honest agent
  shares the same bucket, blocking legitimate registrations during attacks.

### Remediation
- Verify CF token before trusting `CF-Connecting-IP`, OR use `RemoteAddr`
  as the canonical IP when the request lacks a valid CF Access JWT.
- For MCP, use the MCP session ID or per-connection identifier as the IP
  surrogate.

---

## 8. Supply Chain — Verdict: PARTIAL

### Evidence
- Go modules pinned in `go.mod`/`go.sum` with checksums.
- Key deps: `lightningnetwork/lnd v0.20.1-beta`, `coreos/go-oidc v3`,
  `mark3labs/mcp-go v0.46.0`, `golang.org/x/crypto`, `pgx/v5`,
  `mattn/go-sqlite3`, `gopkg.in/macaroon.v2`.
- Frontend: `admin/package.json` + `package-lock.json` present.

### Issues
- **MEDIUM (SC-1):** `lnd v0.20.1-beta` is a **beta** release of LND. Beta
  releases of consensus-relevant software in production are a known risk.
  Pin to a stable LND release.
- **LOW (SC-2):** No CI step in repo runs `govulncheck` /
  `npm audit --production`. No SBOM. No Dependabot config visible.

### Remediation
- Add `govulncheck ./...` to the build pipeline and gate releases on it.
- Move LND off `-beta`.

---

## 9. DoS Surface — Verdict: PARTIAL

### Evidence
- Server: `ReadTimeout=30s`, `WriteTimeout=30s`, `IdleTimeout=120s`
  (`cmd/lnd-gateway/main.go:456-458`).
- L402 HTTP client: 15 s timeout, capped idle conns
  (`handlers/l402_client.go:17-24`).
- LND payment / rebalance / close paths have explicit `context.WithTimeout`
  (`grpc.go:354, 395, 785`).
- Recovery middleware catches panics (`middleware/recovery.go`).

### Issues
- **HIGH (D-1):** Rate limiter is **global, not per-IP**
  (`internal/middleware/ratelimit.go:72-103`). One token bucket per
  category (`read` / `write`) for the entire gateway. A single noisy
  client consumes the whole budget and starves everyone else. Also a free
  DoS for attackers — fill the bucket with cheap reads to deny writes.
- **MEDIUM (D-2):** Read endpoints have **no per-call gRPC timeout** — they
  rely on `WriteTimeout=30s`. A slow LND `ListChannels` (large nodes can
  return 100+ kB) blocks one connection and counts toward the global rate
  limit — combined with D-1, DoS is plausible.
- **MEDIUM (D-3):** No request-body cap (see V-1). A single
  `Content-Length: 1G` POST will buffer the entire body in
  `json.NewDecoder(r.Body).Decode` before failing.
- **LOW (D-4):** `audit_log` and `idempotency` SQLite stores grow forever
  except for cleanup-by-expiry — disk DoS is bounded only by `expires_at`.

### Remediation
- Per-IP token bucket (use `golang.org/x/time/rate` with `sync.Map`).
- Add `http.MaxBytesReader`.
- Add `context.WithTimeout(ctx, 10*time.Second)` to read RPCs.

---

## 10. Agent Safety / Prompt Injection → Destructive Tools — Verdict: PARTIAL

### Evidence
- `lqwdclaw-nodeops/workspace/AGENTS.md` rule #1: never execute destructive
  operations without explicit user confirmation. Rule #2: never bypass the
  gateway.
- `SOUL.md` echoes safety posture.
- `lnd-payments/SKILL.md:18` calls out idempotency. `action-reviewer/SKILL.md`
  is read-only.
- Server-side enforcement: `OpenChannel`, `CloseChannel`, `SendPayment`,
  `SendOnChain` create pending confirmations (`internal/handlers/write.go`)
  and `/v1/confirm` requires admin token (`cmd/lnd-gateway/main.go:213`).

### Issues
- **HIGH (AS-1):** As shown in §4, the **Rebalance** path is *not* gated
  by confirmation server-side. The LLM, instructed by a poisoned tool
  output (e.g. an attacker-controlled peer alias containing operator-style
  directives), can call `/v1/rebalance` without operator approval. The
  agent identity file says "always check fee estimates" but this is a
  soft norm, not enforced.
- **HIGH (AS-2):** `RestartLND` is agent-callable (P-4 above). Prompt
  injection → repeated restarts → channel force-closes by impatient peers.
- **MEDIUM (AS-3):** `UpdateChannelFees` (`/v1/routing/fees`) modifies
  routing economics with no confirmation flow and no per-call dollar
  amount the budget enforcer can guard against (it's a percentage). An
  attacker setting `fee_rate_ppm` to 1_000_000 effectively closes the
  node to traffic. The handler accepts *any* int64 (`analytics.go:209`).
- **MEDIUM (AS-4):** Tool output (channel memos, peer aliases, invoice
  memos) is fed to the LLM verbatim with no
  injection-pattern stripping. See §5 V-4.

### Remediation
- Move `Rebalance`, `UpdateChannelFees`, and `RestartLND` behind
  confirmation OR enforce hard ceilings (max ppm, max restart frequency).
- Pre-process LLM-bound tool output with a deny-list of known injection
  phrasings and truncate untrusted strings (memos, aliases).

---

## Summary Scorecard

| #   | Threat                              | Verdict   |
|-----|-------------------------------------|-----------|
| 1   | Macaroon handling                   | PARTIAL   |
| 2   | L402 token lifecycle                | MITIGATED |
| 3   | Admin authentication                | PARTIAL   |
| 4   | Payment authorization               | EXPOSED   |
| 5   | Input validation                    | PARTIAL   |
| 6   | Secrets                             | PARTIAL   |
| 7   | Faucet abuse                        | MITIGATED |
| 8   | Supply chain                        | PARTIAL   |
| 9   | DoS surface                         | PARTIAL   |
| 10  | Agent safety / prompt injection     | PARTIAL   |

### CRITICAL findings (must fix before production)
- **P-1** — `SendPayment` confirmation flow does not execute (Executor switch
  missing case). Phase 16.1 work is **not actually wired through** outside
  mock mode.
- **P-2** — `CloseChannel` confirmation will fail at LND because of
  `chan_id` ↔ `channel_point` field-name mismatch between handler request
  struct and `lnd.CloseChannelRequest`.
- **P-3** — `Rebalance` skips the confirmation flow entirely. Agent token
  alone can move sats up to per-op fee limit per call.
- **P-4** — `RestartLND` is exposed to the agent token (no `RequireAdmin`).
  Agent compromise = remote LND restart loop = channel force-close cascade.

### HIGH findings
- **M-1** — Macaroon scopes assumed correct, never verified at startup.
- **A-1** — Sessions are in-memory only (single-instance constraint
  undocumented).
- **A-2** — Login rate limiter trusts unverified `X-Forwarded-For` →
  brute-force bypass when reachable off-CF.
- **P-5** — `L402Pay` reserves `MaxSats` but pays `AmountSats` → daily
  budget over-consumed; audit/budget ledger drifts.
- **V-1** — No body-size limit anywhere → memory-exhaustion DoS.
- **S-1** — Bolt11 invoices stored verbatim in audit DB → invoice/preimage
  reconstruction risk.
- **D-1** — Rate limiter is **global, not per-IP** → one client starves all
  others.
- **AS-1** — Rebalance reachable via prompt injection without operator
  confirmation.
- **AS-2** — RestartLND reachable via prompt injection.

### Production Gate Decision
**FAIL.** CLAUDE.md requires "Grade A scan, no CRITICAL/HIGH findings".
Current posture: **D**. Block deploy until all CRITICAL findings are fixed
and HIGH findings have either patches or written compensating controls.
