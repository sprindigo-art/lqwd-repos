---
phase: 18-hardening-vm-deploy-v1-v2
plan: 10
subsystem: queue-db-security
tags: [HARDEN-01, Q2, self-approve-guard, rls, trigger, nodemon]
mode: authoring
requires:
  - "nodemon commands table + command_state enum (drizzle/nodemon 0000)"
  - "nodemon_node role + FORCE RLS (db/role-grants.sql)"
  - "requireNodemonDb DB-required tag convention (18-01)"
provides:
  - "DB-level self-approve guard: BEFORE UPDATE trigger nodemon_node_transition_guard on commands"
  - "reproducible nodemon migration 0005_self_approve_guard.sql (journaled)"
  - "self-approve-guard.test.ts DB-required integration proof"
affects:
  - "db/role-grants.sql (canonical trigger source, in sync with migration)"
tech-stack:
  added: []
  patterns:
    - "BEFORE UPDATE row trigger keyed on current_user for role-scoped state-machine enforcement"
    - "allow-list of executor-legal edges mirroring src/lib/queue/state.ts LEGAL"
key-files:
  created:
    - drizzle/nodemon/0005_self_approve_guard.sql
    - drizzle/nodemon/meta/0005_snapshot.json
    - src/lib/queue/self-approve-guard.test.ts
  modified:
    - db/role-grants.sql
    - drizzle/nodemon/meta/_journal.json
decisions:
  - "Trigger keyed on current_user (not session_user) so it fires for both a nodemon_node login and SET ROLE — enforceable AND testable, and catches role-membership privilege."
  - "Allow-list (deny-by-default) of executor-legal edges rather than a single deny of pending_approval->approved — strongest posture, mirrors transitions.ts/state.ts."
  - "BEFORE UPDATE trigger chosen over an RLS WITH CHECK policy because WITH CHECK sees only the NEW row and cannot compare OLD.state->NEW.state."
metrics:
  tasks_completed: 2
  tasks_deferred: 1
  files_created: 3
  files_modified: 2
  completed: 2026-07-27
---

# Phase 18 Plan 10: DB-Level Self-Approve Guard Summary

BEFORE UPDATE trigger boxes the `nodemon_node` executor role to the node/reaper-legal transition edges at the nodemon DB, so `pending_approval -> approved` (self-approve, finding Q2) is rejected independent of app code — authored as a reproducible journaled migration, kept canonical in `db/role-grants.sql`, and proven by a DB-required integration test.

## What was built (AUTHORING mode)

By explicit operator decision this plan ran in AUTHORING mode: all code artifacts were produced, committed, and verified up to (but not including) live-DB apply. **The DB-apply of the migration and the DB-backed run of the integration proof are NOT yet verified** (see OPERATOR STEP below).

### Task 1 — Confirm the gap + author the nodemon migration (commit 857b7b7)
- **Gap CONFIRMED from files (not a DB query):** at base `6d14e79`, `db/role-grants.sql:122` grants `SELECT, UPDATE ON commands` to `nodemon_node`, RLS gates only `node_pubkey` (not state edges), and there is **no** transition guard / trigger anywhere in the migration chain (`drizzle/nodemon/*.sql`) or in `role-grants.sql`. So the guard is **newly authored**, not previously applied. (A prior partial uncommitted attempt that only edited `role-grants.sql` was discarded per the task brief.)
- Authored **`drizzle/nodemon/0005_self_approve_guard.sql`** via `drizzle-kit generate --custom --config drizzle.nodemon.config.ts` (journaled: `_journal.json` idx 5 + `meta/0005_snapshot.json` created by drizzle-kit). It installs `CREATE OR REPLACE FUNCTION nodemon_node_transition_guard()` + a `BEFORE UPDATE` trigger on `commands`.
- **Enforcement model:** for `current_user = 'nodemon_node'` only, a state-changing UPDATE must be one of the executor-legal edges, else `RAISE EXCEPTION ... ERRCODE 42501`:
  - `approved -> claimed` (atomic claim)
  - `claimed -> executing` (commit1)
  - `executing -> succeeded | failed` (commit2)
  - `claimed -> approved` (reaper release), `claimed -> failed` (reaper fail)
  - `{draft, pending_approval, approved, claimed} -> expired` (TTL fail-close)
  - Everything else (headline: `pending_approval -> approved`; also `pending_approval -> rejected`, `approved -> withdrawn`, `draft -> pending_approval`) is rejected. These match `src/lib/queue/state.ts` LEGAL restricted to node/reaper actions.
- Kept **`db/role-grants.sql` in sync** as the canonical source: the identical trigger DDL was inserted into the `nodemon_node` block (after the RLS policies, before that role's verification block).
- Routing/ldk warehouse configs untouched — nodemon queue DB only.

### Task 2 — Apply migration to the nodemon DB (DEFERRED — operator)
This is a `checkpoint:human-verify` (blocking) requiring a live nodemon DB. In AUTHORING mode it is **not** executed here (no nodemon DB credentials; MUST NOT mutate any live DB). See OPERATOR STEP.

### Task 3 — Integration proof (commit 8cfd456)
- Authored **`src/lib/queue/self-approve-guard.test.ts`** (DB-required, `requireNodemonDb` tag per 18-01). It reaches the executor identity with `SET LOCAL ROLE nodemon_node` inside one transaction (the trigger keys on `current_user`, so `SET ROLE` exercises it exactly as a real login would) and sets `app.node_pubkey` in the same tx so the seeded row is visible under FORCE RLS (otherwise the UPDATE matches zero rows and the trigger never fires — a false pass).
- Assertions: self-approve (`pending_approval -> approved`) is **rejected** and the row stays pending; the operator-only edges (`pending_approval -> rejected`, `approved -> withdrawn`) are rejected for the executor; the legal edges (`approved -> claimed`, reaper release `claimed -> approved`, TTL `pending_approval -> expired`) **succeed**; and the dashboard-writer `approve()` path is **unaffected**. A preflight test asserts the role + trigger are installed and fails loudly with remediation guidance if not.

## Verification performed (authoring-mode, no DB)
- `npx tsc --noEmit` — clean for `self-approve-guard.test.ts`.
- `npx eslint src/lib/queue/self-approve-guard.test.ts` — clean (exit 0).
- `npx vitest run src/lib/queue/self-approve-guard.test.ts` — **7 skipped, green** locally (no `NODEMON_QUEUE_URL`), confirming the DB-required tag works.
- SQL well-formedness: dollar-quoted body balanced (`$$` count = 2), statement-breakpoints present; reviewed by hand (no DB available to execute).
- Plan Task-1 grep verify: `grep -rn "pending_approval\|nodemon_node" drizzle/nodemon/0005_*.sql db/role-grants.sql` shows the guard present in both the migration and the canonical grants file.

## OPERATOR STEP (deferred — NOT yet verified)

DB-apply of the migration and the DB-backed integration proof still need to be run by the operator against the **nodemon queue DB ONLY**. NEVER run migrate/push against `drizzle.routing.config.ts` or `drizzle.ldk.config.ts`.

1. **Ensure the executor role + RLS exist** (once, as nodemon DB owner/superuser) if not already applied:
   ```bash
   psql "$NODEMON_QUEUE_URL" -f db/role-grants.sql   # or at minimum the nodemon_node block
   ```
2. **Apply the migration to nodemon ONLY:**
   ```bash
   npx drizzle-kit migrate --config drizzle.nodemon.config.ts
   ```
3. **Confirm the trigger is present on `commands`:**
   ```bash
   psql "$NODEMON_QUEUE_URL" -c "\d+ commands"        # shows BEFORE UPDATE trigger nodemon_node_transition_guard
   psql "$NODEMON_QUEUE_URL" -c "SELECT tgname FROM pg_trigger WHERE tgname='nodemon_node_transition_guard' AND NOT tgisinternal;"
   ```
4. **Confirm no warehouse DB was touched** (routing_vm / ldk-lspd-main unchanged).
5. **Run the integration proof against the provisioned DB:**
   ```bash
   NODEMON_QUEUE_URL="$NODEMON_QUEUE_URL" npx vitest run src/lib/queue/self-approve-guard.test.ts
   ```
   The test login role must be able to `SET ROLE nodemon_node` (superuser, or a member of `nodemon_node`). The preflight test fails loudly if the role or trigger is missing.

Until steps 1–5 are done, the DB-level guard is **authored and committed but not proven applied**.

## Deviations from Plan
None — plan executed as written for the two authoring-mode tasks; Task 2 (live-DB apply) intentionally deferred to the operator per the AUTHORING-mode directive.

## Known Stubs
None.

## Threat Flags
None — no new network endpoints, auth paths, or trust-boundary schema surface introduced; this plan closes T-18-24 (executor self-approve) and touches only the nodemon queue DB.

## Commits
- `857b7b7` feat(18-10): DB-level self-approve guard trigger for nodemon_node (Q2/HARDEN-01)
- `8cfd456` test(18-10): DB-required proof nodemon_node cannot self-approve (HARDEN-01/Q2)
