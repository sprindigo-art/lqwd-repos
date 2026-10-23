---
phase: 18-hardening-vm-deploy-v1-v2
plan: 01
subsystem: ci-infra
tags: [ci, github-actions, postgres, vitest, harden-01, fail-on-skip]
requires: []
provides:
  - "CI job with a postgres:16 service container seeded with the nodemon schema + role grants"
  - "requireNodemonDb() DB-required test tagging convention (test-helpers.ts) consumed by every downstream plan's new DB-integration tests"
  - "Fail-on-skip gate: pipeline turns red if any DB-tagged test is skipped/todo/zero-executed"
affects:
  - "18-02..18-12 (every downstream plan's tests run under this CI floor)"
tech-stack:
  added: []
  patterns:
    - "DB-required suites call requireNodemonDb() once at module top; describe.skipIf(!DB_AVAILABLE) + guarded top-level hooks"
    - "CI gate grep-discovers `requireNodemonDb(` in *.test.ts — downstream tests enroll automatically"
key-files:
  created:
    - .github/workflows/ci.yml
  modified:
    - src/lib/queue/test-helpers.ts
    - src/lib/queue/claim.test.ts
    - src/lib/queue/enqueue.test.ts
    - src/lib/queue/approve.test.ts
    - src/lib/queue/stub-executor.test.ts
    - vitest.config.ts
    - package.json
    - .gitignore
decisions:
  - "Guard applied to the 4 genuinely DB-touching suites (claim/enqueue/approve/stub-executor); state/ttl/withdraw stay ungated because they are pure/mocked — matches the plan's own truth that ttl runs DB-less"
  - "CI applies ONLY the nodemon-DB blocks of db/role-grants.sql (awk slice from the `-- nodemon_node` marker) — warehouse blocks reference DBs CI must never touch"
  - "Fail-on-skip gate auto-discovers DB-tagged files by grepping for requireNodemonDb( so downstream plans enroll with zero ci.yml edits"
metrics:
  duration: "~9 min"
  completed: "2026-07-22"
---

# Phase 18 Plan 01: CI Coverage Floor — Seeded Ephemeral nodemon Postgres Summary

CI now boots a postgres:16 service seeded via drizzle-kit migrate (nodemon config only) + role-grants.sql, and a grep-discovered fail-on-skip gate turns the pipeline red if any DB-gated queue safety proof is skipped instead of executed.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | CI workflow with seeded ephemeral nodemon Postgres | 2baa040 | .github/workflows/ci.yml |
| 2 | DB-required test tag + fail-on-skip gate | 5427763 | test-helpers.ts, 4 queue suites, vitest.config.ts, package.json, .gitignore, ci.yml |

## What Was Built

**Task 1 — `.github/workflows/ci.yml`:**
- Node 20 job with a `postgres:16` service container (health-checked).
- Creates the `nodemon` database, applies the schema via `npx drizzle-kit migrate --config drizzle.nodemon.config.ts` (the ONLY drizzle config invoked — no warehouse configs, no warehouse names anywhere in the workflow).
- Applies the nodemon-DB blocks of `db/role-grants.sql` (awk slice from the `-- nodemon_node` marker) so `nodemon_node`/`nodemon_telemetry` roles, RLS policies, and the `nodemon_node_transition_guard` trigger exist before tests run.
- Exports `NODEMON_QUEUE_URL` at job level (env wins over `.env.local` in test-helpers, `override: false`), then runs `npm run lint` + the test suite.

**Task 2 — DB-required tagging convention + gate:**
- `requireNodemonDb(suiteName)` in `src/lib/queue/test-helpers.ts`: THROWS when `CI` is set and `NODEMON_QUEUE_URL` is absent (module-load throw → red run, never a silent no-op); local DB-less run returns false with a visible `console.warn` skip notice.
- Applied to `claim.test.ts`, `enqueue.test.ts`, `approve.test.ts`, `stub-executor.test.ts`: `describe.skipIf(!DB_AVAILABLE)` on every suite + `if (!DB_AVAILABLE) return;` in top-level beforeAll/afterAll/beforeEach hooks.
- `test:ci` npm script emits the vitest JSON report (`vitest-report.json`, git-ignored); the ci.yml gate greps `src` for `requireNodemonDb(` in `*.test.ts` and fails the job if any test in a tagged file reports `skipped`/`todo`/`pending`/`disabled`, if a tagged file executed zero tests, or if a tagged file is missing from the report.
- Convention documented in `vitest.config.ts` for downstream plans (18-02..18-12 tests enroll automatically by calling the guard).

## Verification Evidence

- Plan's Task-1 automated check (postgres:16 + nodemon-config migrate + role-grants.sql present; zero warehouse references): PASS.
- YAML validity: PASS (yaml-lint).
- Local DB-less run (`NODEMON_QUEUE_URL=""`): 4 DB files skipped with visible warnings, 57 pure tests pass (canonical/sign/bounds/state/ttl/withdraw), exit 0 in 0.4 s.
- CI-simulated DB-less run (`CI=1 NODEMON_QUEUE_URL=""`): guard throws at module load, file fails, exit non-zero — the "unset URL turns the job red" verification.
- Fail-on-skip gate dry-run against a DB-less JSON report: gate exits 1 listing every skipped DB-tagged test by name.
- ESLint clean on all modified files; `tsc --noEmit` reports no errors in modified files.

## Deviations from Plan

### Clarifications applied (plan-internal inconsistency resolved)

**1. [Rule 1 - Plan inconsistency] Guard applied to the 4 DB-touching suites only, not state/ttl/withdraw**
- **Found during:** Task 2
- **Issue:** The task text listed "claim/enqueue/approve/state/stub-executor/ttl/withdraw", but the plan's own must-have truths require ttl to run DB-less ("pure suites (canonical/sign/bounds/ttl)"), and inspection shows `state.test.ts`/`ttl.test.ts` are pure and `withdraw.test.ts` fully mocks `@/lib/db/nodemon` (deliberately DB-free per its header). Gating them would have wrongly skipped pure coverage on DB-less checkouts.
- **Fix:** Guard applied to the suites that actually open a nodemon connection: claim, enqueue, approve, stub-executor. The grep-discovery gate means any suite later converted to a live-DB test enrolls by simply calling the guard.
- **Commit:** 5427763

**2. [Rule 2 - Missing support] Added `test:ci` script + `.gitignore` entry**
- **Found during:** Task 2
- **Issue:** The fail-on-skip gate needs the vitest JSON report; running it locally would leave `vitest-report.json` untracked.
- **Fix:** `test:ci` script in package.json (already in files_modified); `vitest-report.json` added to `.gitignore`.
- **Commit:** 5427763

## Known Pre-existing Condition (not a stub, not introduced here)

Local `.env.local` carries a `NODEMON_QUEUE_URL` pointing at a nodemon DB that is not currently reachable, so the enqueue suite's hooks time out locally exactly as documented in STATE.md (12-CLOSE note). The guard checks URL *presence* (the tagging contract), not connectivity — in CI the URL always points at the live service container, and locally an operator either runs the DB or removes the URL to get the visible-skip path.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. T-18-01 (fail-on-skip) and T-18-02 (no warehouse contact) mitigations are implemented as planned. T-18-SC: zero new dependencies installed.

## Self-Check: PASSED

- `.github/workflows/ci.yml` — FOUND
- `src/lib/queue/test-helpers.ts` requireNodemonDb — FOUND
- Commit 2baa040 — FOUND
- Commit 5427763 — FOUND
