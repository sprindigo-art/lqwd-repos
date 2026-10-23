---
phase: 08-node-scripts-heartbeat
plan: 01
subsystem: queue-contract-foundations
tags: [bounds, rls, postgres-role, least-privilege, security, documentation-freeze]
requires:
  - "src/lib/queue/bounds.ts (frozen update_fee bounds — already existed, framing updated)"
  - "src/lib/db/schema/nodemon.ts (commands/command_executions/command_audit table + column shapes RLS keys on)"
  - "db/role-grants.sql (existing nodemon_ro block — mirrored, untouched)"
provides:
  - "Frozen update_fee bounds contract (ppm 0-5000 / base 0-100000 msat / CLTV 18-2016) with no [ASSUMED] framing — ready for Plan 02 node-side 3rd-enforcement re-implementation"
  - "nodemon_node least-privilege RW role + 3 ENABLE/FORCE RLS policies on the queue tables — the pre-placed creds + own-pubkey physical isolation Plan 02's check-queue/apply-fee connect with"
affects:
  - "Plan 02 (node-side bash executor) consumes both artifacts: bounds re-enforced in apply-fee; RLS scoped via SET LOCAL app.node_pubkey in check-queue"
tech-stack:
  added: []
  patterns:
    - "PostgreSQL Row-Level Security: ENABLE + FORCE, two-arg current_setting('app.node_pubkey', true) for fail-closed (NULL-on-unset = zero rows)"
    - "WITH CHECK mirroring USING so a row cannot be flipped out of its own pubkey scope"
    - "Least-privilege named-table grants only; explicit no DELETE/TRUNCATE/DDL"
key-files:
  created: []
  modified:
    - "src/lib/queue/bounds.ts (documentation freeze — comments only, zero logic/value change)"
    - "db/role-grants.sql (appended nodemon_node role + RLS section; nodemon_ro block untouched)"
decisions:
  - "D-11: update_fee bounds operator-confirmed and frozen; [ASSUMED] framing removed without changing any numeric value"
  - "D-05/D-07: node connects to nodemon DB as least-privilege nodemon_node; own-pubkey isolation enforced physically by FORCE RLS, not application code"
metrics:
  duration: ~10m
  completed: 2026-06-17
---

# Phase 8 Plan 01: Queue Contract Foundations Summary

Froze the `update_fee` bounds contract (documentation-only, removed `[ASSUMED]` framing per D-11) and added the least-privilege `nodemon_node` Postgres role plus ENABLE/FORCE Row-Level-Security policies that make wrong-pubkey queue rows physically invisible (D-05/D-07) — the two non-script contract foundations Plan 02's node-side executor depends on.

## What Was Built

### Task 1 — Freeze update_fee bounds in `src/lib/queue/bounds.ts` (commit bc36e17)
- Deleted the boxed `[ASSUMED] — PROVISIONAL BOUNDS, FLAG FOR OPERATOR CONFIRMATION` block comment.
- Rewrote the header comment to state the bounds are operator-confirmed and frozen per D-11 and that the node-side executor re-enforces these identical values as the 3rd of 3 enforcement points (client + server + node).
- Replaced the three trailing `// [ASSUMED] …` inline comments on the numeric bound lines with `// frozen D-11`.
- **No numeric value, zod chain, `.strict()` modifier, `UpdateFeeParams` type, or `isOperatorOverride` function was changed** — pure documentation freeze. `git diff` shows only comment lines changed; the code portion of the three bound lines is byte-identical.

### Task 2 — Append `nodemon_node` role + RLS to `db/role-grants.sql` (commit d8314b9)
- New clearly-delimited section appended after the existing verification query; the `nodemon_ro` block above is untouched.
- `CREATE ROLE nodemon_node WITH LOGIN PASSWORD '<generated-strong-password>'` — placeholder kept verbatim (operator substitutes into the root-only node env file, never source).
- Scoped NAMED-table grants only: `SELECT, UPDATE ON commands`; `SELECT, INSERT ON command_executions`; `SELECT, INSERT ON command_audit`. No INSERT on commands; explicit comment that no DELETE/TRUNCATE/DDL is granted anywhere.
- `ENABLE` + `FORCE ROW LEVEL SECURITY` on all three queue tables (FORCE is the Pitfall-6 belt against owner-bypass).
- Three policies (`node_own_commands`, `node_own_exec`, `node_own_audit`) keyed on the two-arg `current_setting('app.node_pubkey', true)` form (NULL-on-unset → fail-closed, zero rows), with `WITH CHECK` mirroring `USING` so a row can never be flipped out of its own pubkey scope.
- Trailing verification query filtering `grantee = 'nodemon_node'`, plus a comment that `nodemon_node` must NOT own the queue tables or RLS is bypassed.

## Verification Results

- `grep -c ASSUMED src/lib/queue/bounds.ts` → 0.
- Three inline `// frozen D-11` markers present on the numeric bound lines (header block additionally documents them).
- Numeric bounds unchanged: `max(5000)`, `max(100_000)`, `min(18).max(2016)`; `.strict()` present.
- `npx tsc --noEmit` reports no errors in bounds.ts.
- `db/role-grants.sql`: 3 ENABLE RLS, 3 FORCE RLS, 3 CREATE POLICY, 7 two-arg `current_setting('app.node_pubkey', true)` occurrences (≥5 required), no DELETE/TRUNCATE grant, `node_own_commands` has WITH CHECK on `node_pubkey`, verification query filters `grantee = 'nodemon_node'`, nodemon_ro section unchanged.
- Full Vitest suite: 647 passed, 37 skipped, 4 failed.

## Deviations from Plan

None for the implementation — plan executed exactly as written. Both artifacts are clean per the acceptance criteria.

## Deferred / Out-of-Scope Issues

The 4 failing Vitest tests are pre-existing **environmental** failures, NOT caused by this plan:
- Failing files: `src/lib/queue/{enqueue,approve,claim,stub-executor}.test.ts`.
- All fail with `Missing required env: NODEMON_QUEUE_URL` thrown from `src/lib/db/nodemon.ts:18` (via `requireEnv` in `src/lib/db/env.ts`) — they require a live `nodemon` Postgres connection that is not provisioned in this worktree environment.
- None of these tests import or reference `bounds.ts`; `role-grants.sql` is a hand-run SQL file imported by no test. The changes in this plan cannot affect these tests.
- Per the SCOPE BOUNDARY rule these are out of scope (pre-existing, env-gated integration tests in unrelated files). Logged here rather than fixed.

## Threat Surface

No new security surface beyond the plan's threat model. This plan implements the `mitigate` dispositions T-08-01 (RLS own-pubkey isolation), T-08-02 (least-privilege grants, no DELETE/TRUNCATE/DDL), T-08-03 (WITH CHECK prevents pubkey re-flip), and freezes the contract for T-08-04 (bounds). No package installs (T-08-SC N/A).

## Self-Check: PASSED

- FOUND: src/lib/queue/bounds.ts (modified, committed in bc36e17)
- FOUND: db/role-grants.sql (modified, committed in d8314b9)
- FOUND commit: bc36e17 (Task 1)
- FOUND commit: d8314b9 (Task 2)
