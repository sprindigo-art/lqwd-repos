# LQWDClaw-NodeOps — Architecture & Deploy-Readiness Review

**Date:** 2026-04-16
**Branch:** main (5 commits ahead of origin/main)
**Verdict:** **NOT-READY**

The Phase 16.1 hardening landed correctly for two of three fixes, but the SendPayment refactor is half-applied. Top reasons:
1. `internal/lnd/executor.go` has no case for `/v1/payments/send`, so admin-confirmed Lightning payments will fail with `unknown endpoint for execution`.
2. The `lnd-payments` operator skill and `API-REFERENCE.md` still describe the old synchronous 200-OK contract.
3. No admin UI exists for the confirmation queue.

---

## Top 5 Blockers

### 1. BLOCKER — Executor missing case for `/v1/payments/send`
`lnd-gateway/internal/lnd/executor.go:23-47` switches on `channels/open`, `channels/close`, `onchain/send` only. Phase 16.1-02 (commit `4f0c772`) made SendPayment create a confirmation with `endpoint="/v1/payments/send"`, but `Executor.Execute` returns `unknown endpoint for execution` when the admin confirms it.

**Net: deployed as-is, no Lightning payment can succeed.**

Fix: add a case unmarshalling into `lnd.SendPaymentRequest` and calling `e.client.SendPayment(ctx, req)`, plus an executor test.

### 2. BLOCKER — Operator skill `lqwdclaw-nodeops/skills/lnd-payments/SKILL.md` is now wrong
It tells the agent to expect `payment_hash` / `payment_preimage` / `status: SUCCEEDED` synchronously. The agent will treat the new 202 + `confirmation_required` reply as an error. Same applies to `API-REFERENCE.md`, which has no Confirmation Flow section.

### 3. BLOCKER — Phase 16.1 UAT is unverified in this branch
`.planning/phases/16.1-gateway-safety-hardening/16.1-UAT.md` shows `passed: 0, pending: 7`. The recent project-level commit log mentions `583a6ad test(16.1): complete UAT - 7 passed`, but that file state is not on disk in this checkout. Re-run and commit a green UAT before deploy.

### 4. SHOULD-FIX — No admin dashboard UI for `/v1/confirm/list` / confirm / reject
SPA has `agents`, `channels`, `dashboard`, `layout`, `login` — no pending-confirmations page. After 16.1, four destructive ops are gated; operator must `curl` with the admin Bearer for every payment. The "broken E2E flow" the milestone audit cites is real and got worse with 16.1.

### 5. SHOULD-FIX — SendPayment uses a hardcoded placeholder amount of 50,000 sats
`handlers/write.go:225-228` — when `amount_sats` is missing, the confirmation, audit row, and daily budget all use this fictional number. Decode BOLT11 or require explicit `amount_sats`.

---

## Milestone Audit Status

**The file `.planning/v1.0-MILESTONE-AUDIT.md` does not exist on disk.** No `*MILESTONE*` or `*AUDIT*.md` in the repo (only `.github/agents/second-pass-auditor.agent.md`). The audit referenced in project memory was never written to disk on this branch.

Independent confirmation of the alleged findings:
- **"Broken E2E flow — confirmation UI gap"**: CONFIRMED (blocker #4 above).
- **"2 auth inconsistencies"**: Plausible candidates found — `/v1/admin/restart-lnd` is wired with no `RequireAdmin` middleware (`main.go:219`), and rate-limit substrates are split (PG-backed for registration, in-memory for admin login — restart silently resets dashboard limits).
- **"2 unverified phases"**: Cannot identify without the audit file. Phase 16.1 itself is one (UAT shows 0/7 passed in this branch).

---

## Other Key Findings

- `.planning/phases/` contains *only* Phase 16.1. Phases 0–16 have no per-phase artifacts; all history lives in `PLAN.md` prose.
- 61 untracked macOS `* 2.*` duplicate files (28 are `.go` files inside the module path) break local `go build`/`go test` with redeclaration errors. Untracked, so a fresh `git pull` on the VM is unaffected — but local UAT can't run until removed.
- `internal/handlers/handlers.go:43` carries an unfixed `TODO: Real LND health check` — `/v1/health` does not actually probe LND.
- No `/metrics` endpoint, no Prometheus, no off-host alerting. Only `/v1/health` + `/v1/audit/recent` for visibility.
- `lqwdclaw-social/` lives in this repo but deploys to a separate DO droplet — orphaned in the build/test pipeline.

## Verified-Good 16.1 Work
- `audit/logger.go:159` has `AND response_code != 202`
- `lnd/grpc.go:354` has `closeCtx, closeCancel := context.WithTimeout(ctx, 60*time.Second)` correctly applied
