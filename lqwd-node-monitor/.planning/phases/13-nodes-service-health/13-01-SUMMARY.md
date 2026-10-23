---
phase: 13-nodes-service-health
plan: 01
subsystem: database
tags: [drizzle, postgres, pgenum, state-machine, command-queue, migration]

# Dependency graph
requires:
  - phase: 06-command-queue (v1)
    provides: command_state pgEnum + LEGAL transition table + canTransition
provides:
  - "command_state pgEnum extended to 10 values incl. terminal 'withdrawn' (D-01 operator-undo)"
  - "LEGAL.approved → withdrawn edge; withdrawn terminal; no other edge added"
  - "withdrawn value live at runtime on the nodemon queue DB (enum_range confirmed 10 values)"
affects: [13-03 withdraw transition, queue write-path]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Schema-first enum add gated by a BLOCKING human-verify checkpoint so the runtime value exists before any code path writes it (closes the TS-passes/DB-rejects false-positive trap)"

key-files:
  created:
    - drizzle/nodemon/0002_productive_the_order.sql
    - drizzle/nodemon/meta/0002_snapshot.json
  modified:
    - src/lib/queue/state.ts
    - src/lib/queue/state.test.ts
    - src/lib/db/schema/nodemon.ts
    - drizzle/nodemon/meta/_journal.json

key-decisions:
  - "Only the approved→withdrawn edge added; pending_approval→withdrawn stays illegal (D-01/D-02)"
  - "Live enum ALTER applied by the operator as the postgres type-owner, NOT via drizzle-kit migrate (see Deviations)"

patterns-established:
  - "Pure state-machine change locked RED→GREEN before the schema/DB change"

requirements-completed: [NODE-04]

# Metrics
duration: ~15min
completed: 2026-07-08
---

# Phase 13 Plan 01: withdrawn terminal state + live enum migration

**The command queue now legally admits the D-01 operator-undo edge `approved → withdrawn` in the pure state machine AND accepts `'withdrawn'` at runtime on the live nodemon queue DB — unblocking Plan 03's honestly-verifiable `withdraw()` transition.**

## Performance

- **Duration:** ~15 min (execution) + operator DB-apply gate
- **Completed:** 2026-07-08
- **Tasks:** 3/3 (2 TDD + 1 blocking human-verify)
- **Files modified/created:** 6

## Accomplishments

- **Task 1 (RED→GREEN):** `src/lib/queue/state.ts` — extended `LEGAL.approved` to `["claimed","expired","withdrawn"]` and added `withdrawn: []` as terminal; doc-comment diagram updated. `canTransition` untouched (reads LEGAL). `state.test.ts` gained the positive edge, the negative `pending_approval→withdrawn`, the no-exit-from-terminal case, the extended terminal loop, and no-regression assertions. `npx vitest run src/lib/queue/state` → 16 passed.
- **Task 2:** `src/lib/db/schema/nodemon.ts` — appended `"withdrawn"` as the 10th `command_state` pgEnum value; the "EXACTLY these 9 values" comment updated to 10. `tsc --noEmit` clean.
- **Task 3 (BLOCKING checkpoint):** generated `drizzle/nodemon/0002_productive_the_order.sql` (`ALTER TYPE "public"."command_state" ADD VALUE 'withdrawn';`), inspected clean for the PG ADD-VALUE-in-transaction caveat, committed the migration + journal/snapshot. The live-DB apply was gated to the operator.

## Verification

- `npx vitest run src/lib/queue/state` → 16/16 green (withdrawn edges + negatives + terminal loop).
- `npx tsc --noEmit` → clean.
- **Runtime, live nodemon DB:** `SELECT unnest(enum_range(NULL::command_state))` returns all 10 values including `withdrawn` (confirmed 2026-07-08 post-operator-apply).
- Warehouses (`routing_vm` / `ldk-lspd`) NOT touched — only the nodemon enum type was altered.

## Commits

- `8b55f53` test(13-01): add failing withdrawn state-machine edges (RED)
- `d5549a6` feat(13-01): add withdrawn terminal state to pure state machine (GREEN)
- `06cfba8` feat(13-01): add withdrawn as 10th command_state pgEnum value
- `8fe3798` feat(13-01): generate nodemon 0002 migration adding withdrawn enum value

## Deviations

- **Migration applied by direct `ALTER TYPE` as the postgres owner, not `drizzle-kit migrate`.** The nodemon DB has no `drizzle.__drizzle_migrations` tracking table — the Phase-11 telemetry tables (`0001`) were applied out-of-band (via `push`/manual), so `drizzle-kit migrate` tried to replay `0001` (whose tables already exist) and aborted before reaching `0002`. Separately, the `command_state` type is owned by `postgres`, and the only credential in `.env.local` (`nodemon_rw`) lacks ALTER ownership. The operator therefore ran the idempotent `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'withdrawn'` as the `postgres` owner. The committed `0002` migration file remains the source-of-record for the schema change; the DB migration-history mismatch is pre-existing infra, out of scope for this plan.

## Follow-ups / notes

- The unmanaged drizzle migration history on the nodemon DB (missing `__drizzle_migrations`, `0001` applied out-of-band) will keep `drizzle-kit migrate` from running cleanly until reconciled. Not a Phase-13 concern; flag for infra.
- Pre-existing: the `src/lib/queue/*` live-DB integration tests fail under vitest because `nodemon_rw` lacks DELETE grants on `command_audit`/`command_executions` (grant issue, not a code defect).
