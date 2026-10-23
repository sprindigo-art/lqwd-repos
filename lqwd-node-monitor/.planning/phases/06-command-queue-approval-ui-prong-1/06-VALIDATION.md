---
phase: 6
slug: command-queue-approval-ui-prong-1
status: draft
nyquist_compliant: true
wave_0_complete: n/a  # tests authored within plans 02/03/04 (tdd-bundled), not a separate Wave 0
created: 2026-06-15
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 06-RESEARCH.md § Validation Architecture.
> **Test model: tdd-bundled.** Each test file is authored *within* its owning plan task
> (plans 06-02 / 06-03 / 06-04 carry `tdd="true"` tasks that write the `*.test.ts` alongside the
> implementation; the task's `<automated>` verify runs that test). There is NO separate "Wave 0"
> stub-first pass — the `*.test.ts` files come into existence with their implementations, plan by plan.
> Rows below are keyed by the `src/lib/queue/*` module and name the owning plan.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (`vitest run`) — already present, zero installs |
| **Config file** | `vitest.config.*` (carries `@/` alias; plain node/ESM, no Next plugin — Phase 1 decision) |
| **Quick run command** | `npx vitest run src/lib/queue` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15–30 seconds (pure units fast; live-`nodemon` integration adds DB round-trips) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/queue`
- **After every plan wave:** Run `npm test` (full suite must be green)
- **Before `/gsd:verify-work`:** Full suite green + the three QUEUE-04 concurrency/TTL/reaper tests green + operator visual checkpoint on `/queue`
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Module / Task | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Authored In | Status |
|---------------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| `canonical.ts` | 1 | QUEUE-02 | — | Canonicalizer is key-sorted, whitespace-free, stable across input ordering | unit (pure) | `npx vitest run src/lib/queue/canonical.test.ts` | 06-02 | ⬜ pending |
| `sign.ts` (HMAC) | 1 | QUEUE-02 | T-tamper / T-info | HMAC hex digest matches openssl over the verbatim canonical string; secret never logged | integration | `npx vitest run src/lib/queue/sign.test.ts` | 06-02 | ⬜ pending |
| `sign.ts` (verify) | 1 | QUEUE-02 | T-spoof | `timingSafeEqual` verify accepts good sig, rejects tampered | unit | `npx vitest run src/lib/queue/sign.test.ts` | 06-02 | ⬜ pending |
| `state.ts` | 1 | QUEUE-01 / QUEUE-03 | — | Transition table rejects illegal flips (e.g. `approved→pending_approval`) | unit (pure) | `npx vitest run src/lib/queue/state.test.ts` | 06-02 | ⬜ pending |
| `bounds.ts` | 1 | QUEUE-03 | T-tamper (OOB fee) | zod bounds reject out-of-range ppm/base/timelock; flag operator-override when ≠ engine suggestion | unit (pure) | `npx vitest run src/lib/queue/bounds.test.ts` | 06-02 | ⬜ pending |
| `enqueue` (server action) | 2 | QUEUE-01 | T-access | Writes `pending_approval` + audit row in one transaction; signs once | integration (live nodemon) | `npx vitest run src/lib/queue/enqueue.test.ts` | 06-03 | ⬜ pending |
| `approve` (server action) | 2 | QUEUE-03 | T-stale | Approve flips only from `pending_approval`; records stale-data acknowledgement in audit | integration | `npx vitest run src/lib/queue/approve.test.ts` | 06-03 | ⬜ pending |
| `claim` (no-double-apply) | 2 | QUEUE-04 | T-double-apply | 2 concurrent `claimNext()` on 1 approved row → exactly 1 claim (`FOR UPDATE SKIP LOCKED`) | integration (live nodemon) | `npx vitest run src/lib/queue/claim.test.ts` | 06-04 | ⬜ pending |
| `claim` (TTL fail-closed) | 2 | QUEUE-04 | T-replay | Row past `expires_at` → `expired`, not claimable (injected clock) | integration | `npx vitest run src/lib/queue/claim.test.ts` | 06-04 | ⬜ pending |
| `claim` (reaper) | 2 | QUEUE-04 | T-DoS | `claimed` past `claimed_timeout` → released/failed (injected clock) | integration | `npx vitest run src/lib/queue/claim.test.ts` | 06-04 | ⬜ pending |
| `stub-executor` | 2 | QUEUE-04 | — | Stub drives `claimed→executing→succeeded\|failed` + writes execution row | integration | `npx vitest run src/lib/queue/stub-executor.test.ts` | 06-04 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Clock control: inject `now`/Date into expire + reaper sweeps (mirrors `isStale(now=…)`) so TTL/reaper run deterministically without `sleep`.*

---

## Test Authoring (tdd-bundled — no separate Wave 0)

Tests are authored inside the owning plan tasks (each a `tdd="true"` task that writes the `*.test.ts`
alongside its implementation; the task's `<automated>` verify runs that test). No stub-first Wave 0 pass.

- **Plan 06-02** authors `canonical.test.ts` (QUEUE-02 serializer), `sign.test.ts` (QUEUE-02 HMAC + verify, + optional openssl cross-check), `state.test.ts` (QUEUE-01/03 transition guards), `bounds.test.ts` (QUEUE-03 bounds + override flag) — pure units.
- **Plan 06-03** authors `enqueue.test.ts` and `approve.test.ts` (QUEUE-01/03) against live `nodemon`, plus `test-helpers.ts` — the shared fixture/helper that seeds a `commands` row + truncates between tests.
- **Plan 06-04** authors `claim.test.ts` (QUEUE-04 no-double-apply / TTL / reaper) and `stub-executor.test.ts` (QUEUE-04) against live `nodemon`.
- Framework install: none — Vitest 4 already present.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/queue` page renders enqueue preview, live current→proposed diff, freshness stamp, and per-command audit timeline (NOC Light theme, mono data, no icons-for-state) | QUEUE-01/03 | Visual layout + design-contract conformance not assertable in unit tests | Operator visual checkpoint: enqueue an `update_fee` card → confirm → review on `/queue` → approve (and exercise the stale-data acknowledgement checkbox path) → confirm audit timeline reflects every transition |

*All deterministic queue/state-machine/crypto behaviors have automated verification; only the operator visual checkpoint is manual.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify (every impl task in plans 06-01..06-07 carries an `<automated>` command)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Tests authored in-plan (tdd-bundled in plans 02/03/04 — see note below); no separate Wave 0 needed
- [x] No watch-mode flags (all `vitest run` / `tsc --noEmit` / `grep`, one-shot)
- [x] Feedback latency < 30s (`npx vitest run src/lib/queue` ~15–30s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved (revision — Nyquist substance satisfied; tdd-bundled test model)
