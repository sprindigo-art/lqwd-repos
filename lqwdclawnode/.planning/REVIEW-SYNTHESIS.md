# LQWDClaw-NodeOps — Unified Review Synthesis

**Date:** 2026-04-16
**Branch:** main (5 commits ahead of origin/main)
**Source reports:**
- `REVIEW-CODE-GATEWAY.md` — 32 findings (5C / 8H / 9M / 6L / 4I)
- `REVIEW-CODE-AGENTS.md` — 35 findings (4C / 8H / 11M / 7L / 5I)
- `REVIEW-SECURITY.md` — Grade **D**, 4C / 9H, production gate failed
- `REVIEW-ARCH-READINESS.md` — Verdict **NOT-READY** for VM deploy

---

## Headline

**Phase 16.1 ("Gateway Safety Hardening") is fictional in production.** All four reviewers independently surfaced the same root cause: the SendPayment + CloseChannel + OpenChannel + SendOnChain confirmation flows route through `internal/lnd/executor.go`, but (a) `/v1/payments/send` is not in the executor switch, and (b) the JSON tags on the handler request structs don't match the LND types the executor unmarshals into. The flow only "works" in mock mode because `ConfirmOperation` short-circuits before the executor runs. UAT recorded as "7/7 passed" was almost certainly run in mock.

If this branch deploys today:
- Every admin-confirmed Lightning payment returns 502 (CR-02 / P-1)
- Every admin-confirmed CloseChannel fails with "invalid channel_point format" (CR-01 / P-2)
- Every admin-confirmed OpenChannel silently sends `push_sats=0` regardless of input (CR-01)
- Daily spend cap enforces nothing — `op_type IN ('payment',…)` never matches the actual `confirmed_/v1/payments/send` rows (CR-03)
- Rebalance and RestartLND remain agent-callable with no confirmation (P-3, P-4)

---

## Cross-Cutting Themes

### Theme 1 — Confirmation flow is broken end-to-end
Findings: gateway CR-01, CR-02, CR-03, CR-04, security P-1, P-2, P-3, P-4, arch BLOCKER #1, #2.

The Phase 16.1 refactor introduced an asymmetry: handlers use one shape (`push_sats`, `chan_id`, `address`, `amount_sats`), executor unmarshals another (`push_sat`, `channel_point`, `addr`, `amount`). Plus one missing case. Plus an audit-filter mismatch that hides the resulting failures from the daily-spend kill switch.

### Theme 2 — Prompt-injection → financial loss is reachable
Findings: security AS-1, AS-2, P-3, P-4, agents CR-04, HIGH-04, MED-04.

`Rebalance` and `RestartLND` aren't behind confirmation. The X mentions pipeline has no prompt-injection defense. `post_reply.py --file` accepts arbitrary paths. UUID-per-call in skills defeats idempotency, so a network blip during a payment retries with a fresh ID and double-pays.

### Theme 3 — L402 has lossy / unrecoverable failure modes
Findings: gateway CR-04, CR-05, security P-5.

`/v1/l402/pay` consumes the token before fetching from LND, returns 502 on LND error with no refund. Idempotency cache never `Store`s the response, so retries see "duplicate request in progress" forever. `MaxSats` reserved but `AmountSats` actually paid → ledger drift.

### Theme 4 — Auth boundaries leak
Findings: security A-1, A-2, P-4, gateway HI-01, HI-03.

In-memory admin sessions (single-instance only, undocumented). Login limiter trusts `X-Forwarded-For` unconditionally → brute-force bypass off-Cloudflare. RestartLND has no `RequireAdmin`. Bearer token uses non-constant-time `switch`. Kill-switch is in its own write-block list (self-trap).

### Theme 5 — Agents repo is in worse shape than gateway
Findings: agents CR-01, CR-02, CR-03.

Four "Python" scripts have raw bash embedded inside the `.py` body — `SyntaxError` on import. `follow.py` shadows the working token-refresh helper. Zero HTTP timeouts. Operator Telegram ID and 22-failure runtime state checked into git.

### Theme 6 — Hygiene
- 61 macOS Finder `* 2.go` / `* 2.html` / `* 2.json` duplicates in `lnd-gateway/` (untracked, but break local `go build`)
- ~10 sync-artifact `SKILL 2.md` / `config 2/` duplicates in `lqwdclaw-social/`
- `.planning/phases/` only contains 16.1 — Phases 0–16 have no per-phase artifacts
- No `/metrics`, no Prometheus, no off-host alerting
- `internal/handlers/handlers.go:43` still has `TODO: Real LND health check`
- Agents repo has zero tests

---

## Pre-Deploy Action List (Ordered)

### MUST-FIX before VM deploy

1. **Fix the executor.** Add `/v1/payments/send` case. Align JSON tags between handler structs (`write.go`) and LND request types (`lnd/client.go`) — pick one shape and use it everywhere. Add executor unit tests covering all 4 op types.
2. **Fix `audit.DailySpend` filter.** Either log confirmed ops with the original `op_type` (recommended: strip `confirmed_` prefix when writing audit row), or change the SQL `IN` clause. Without this, the daily kill switch is non-functional.
3. **Gate Rebalance and RestartLND.** Either move them behind confirmation, or restrict to admin-token only (remove from agent-token route).
4. **Fix L402 idempotency Store.** `/v1/l402/pay` must `Store` after success.
5. **Add L402 refund path.** If LND fetch fails after token consumption, refund the L402 record (or move consumption to after a successful LND response).
6. **Re-run UAT with `GATEWAY_MOCK=false`** against signet. The "7 passed" record is suspect — mock mode bypasses the executor.
7. **Delete the 61 `* 2.*` duplicates** from `lnd-gateway/` (and ~10 from social).

### SHOULD-FIX before deploy

8. Build the admin-dashboard confirmation queue UI (no operator should `curl` to confirm payments).
9. Constant-time bearer-token compare in `auth.go`.
10. Per-IP rate limiting (currently global).
11. Stop trusting `X-Forwarded-For` outside the CF egress range.
12. Stop logging full BOLT11 `payment_request` to the audit DB (or strip on retrieval).
13. `http.MaxBytesReader` on every JSON handler.
14. Fix the 4 broken Python "scripts" in social (or delete them if obsolete).
15. Remove `follow.py` shadow definition; use the shared `get_valid_tokens`.
16. Add HTTP timeouts to all `requests.get/post` in social.
17. Remove operator Telegram ID + runtime failure-state files from git history.

### NICE-TO-HAVE

18. Real LND health check on `/v1/health`.
19. `/metrics` endpoint + Prometheus + alerting.
20. Per-phase artifacts for Phases 0–16 (or accept that audit trail lives in `PLAN.md` only).
21. Fix sync-artifact duplicates in `lqwdclaw-social/`.

---

## Verdict

**Do not deploy this branch to the VM.** The Phase 16.1 hardening is structurally incomplete and the in-mock UAT pass is misleading. Items 1–7 are non-negotiable; items 8–17 should follow before this is genuinely production-grade for a publicly-traded company's financial infrastructure.

Estimated work: items 1–7 are roughly 1–2 days of focused work, mostly mechanical (JSON tags + missing switch case + filter fix + idempotency Store). The L402 refund path and the prompt-injection surface are bigger conversations and should probably get their own phases (call them 16.2 and 16.3).
