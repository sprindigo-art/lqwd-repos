---
phase: 06-command-queue-approval-ui-prong-1
plan: 01
subsystem: command-queue
tags: [drizzle, schema, migration, hmac, env-contract, queue]
requires:
  - drizzle.nodemon.config.ts (the only Drizzle-owned generate/migrate config, D-08)
  - src/lib/db/nodemon.ts (dbNodemon RW client)
  - src/lib/insight/schema.ts (frozen update_fee params mirrored by commands.params)
provides:
  - commands + command_executions + command_audit Drizzle tables
  - commandState pgEnum (9-state machine)
  - applied migration on the live nodemon DB
  - NODEMON_HMAC_SECRET_<pubkey> / NODEMON_TTL_HOURS / NODEMON_CLAIMED_TIMEOUT_MS env contract
affects:
  - all Wave 2 queue modules (sign, enqueue, claim, state, bounds, stub-executor)
  - Phase 7 node-side downloader (mirrors the frozen HMAC key form)
tech-stack:
  added: []
  patterns:
    - "app-supplied signed UUID PK (no defaultRandom on commands.id) — RESEARCH Pitfall 2"
    - "canonical_payload stored VERBATIM + signature_hex (CLAUDE.md §4)"
    - "timestamptz columns via timestamp(..., { withTimezone: true }) — routing.ts grammar"
    - "append-only command_audit (A5, no UPDATE/DELETE in app code)"
key-files:
  created:
    - drizzle/nodemon/0000_hard_random.sql
    - drizzle/nodemon/meta/_journal.json
    - drizzle/nodemon/meta/0000_snapshot.json
  modified:
    - src/lib/db/schema/nodemon.ts
    - .env.example
decisions:
  - "Pass --config=drizzle.nodemon.config.ts explicitly to db:generate/db:migrate (npm scripts are bare; no default drizzle.config.json exists)"
  - "No transform on the HMAC env-key pubkey suffix — node pubkeys are pure 66-hex, valid POSIX env-name chars as-is (A3 freeze)"
metrics:
  duration: ~12m
  completed: 2026-06-15
  tasks: 3
  files: 5
---

# Phase 6 Plan 01: nodemon Queue Schema + Migration + Env Contract Summary

Defined the three Drizzle-owned `nodemon` queue tables (`commands`, `command_executions`, `command_audit`) with a 9-state `command_state` pgEnum, generated and applied the migration to the live nodemon DB, and froze the per-node `NODEMON_HMAC_SECRET_<pubkey>` env-key contract (plus TTL + reaper placeholders) that Phase 7's bash downloader will mirror byte-for-byte.

## What Was Built

### Task 1 — Schema (`src/lib/db/schema/nodemon.ts`)
Replaced the `export {}` placeholder with:
- **`commandState` pgEnum** — exactly `["draft","pending_approval","approved","claimed","executing","succeeded","failed","rejected","expired"]` in order.
- **`commands`** — `id uuid` PK with **NO `defaultRandom()`** (the id is signed before insert, RESEARCH Pitfall 2); `node_pubkey`, `action_type`, `params jsonb`, `canonical_payload text` (stored VERBATIM per CLAUDE.md §4), `signature_hex text` (lowercase hex), `state` enum default `pending_approval`, `expires_at` timestamptz NOT NULL, `claimed_at` timestamptz nullable, `created_at` timestamptz default now().
- **`command_executions`** — `id uuid` defaultRandom PK, `command_id` FK → `commands.id`, `outcome`, `detail` nullable, `executed_at`.
- **`command_audit`** — append-only (A5); `id` defaultRandom PK, `command_id`, `from_state` nullable, `to_state` NOT NULL, `actor` NOT NULL, `reason` nullable (D-07), `stale_acknowledged boolean` default false (D-10), `ts` default now().

`npx tsc --noEmit` reports **0** errors referencing `schema/nodemon`. Commit `0c2b66d`.

### Task 2 [BLOCKING] — Migration (`drizzle/nodemon/`)
Ran `db:generate` then `db:migrate` against `drizzle.nodemon.config.ts` (the ONLY Drizzle-owned config, D-08 — warehouses never targeted). The migration `0000_hard_random.sql` creates the enum + 3 tables + the FK. **Applied successfully to the live nodemon DB** at `127.0.0.1:5433/nodemon`; a live `information_schema` query confirmed all three tables exist and the enum carries the 9 values in order. The BLOCKING gate (live schema, not just TypeScript) is satisfied. Commit `ffa3581`.

### Task 3 — Env contract (`.env.example`)
Documented and froze:
- **`NODEMON_HMAC_SECRET_<pubkey>`** (D-12) — per-node, server-only, never-in-DB, never-in-client; `<pubkey>` = full 66-hex pubkey used VERBATIM as the env-key suffix (no transform — A3 freeze for Phase 7); plus the Phase-6 TEST-secret-in-`.env.local` requirement for Wave 2 sign/enqueue tests.
- **`NODEMON_TTL_HOURS`** (D-11, default 24).
- **`NODEMON_CLAIMED_TIMEOUT_MS`** (D-14, provisional 300000; note that Phase 7 sets the real value once heartbeat cadence is fixed).

Commit `db3f627`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `db:generate` / `db:migrate` npm scripts have no config path**
- **Found during:** Task 2.
- **Issue:** `npm run db:generate` runs bare `drizzle-kit generate`, which looks for a default `drizzle.config.json` that does not exist (the repo has three named configs: `drizzle.routing.config.ts`, `drizzle.ldk.config.ts`, `drizzle.nodemon.config.ts`). The command failed with "file does not exist".
- **Fix:** Invoked with `-- --config=drizzle.nodemon.config.ts` for both generate and migrate. This is the plan's explicit intent (PATTERNS line 266, D-08 — only the nodemon config may generate/migrate) and keeps warehouses untouched. No script file was changed.
- **Files modified:** none (invocation-only).
- **Downstream note:** Wave 2 / future drizzle generate/migrate runs MUST pass `--config=drizzle.nodemon.config.ts`. A follow-up could add a `db:generate:nodemon` script, but that is out of scope for this plan.

## Threat Surface

No new security-relevant surface beyond the plan's `<threat_model>`. Confirmed:
- **T-06-01** (HMAC secret never in DB): no secret column exists on any of the three tables — verified in the migration SQL and live schema. The DB holds only `canonical_payload` + `signature_hex`.
- **T-06-02** (migrate target): generate/migrate pointed ONLY at `drizzle.nodemon.config.ts`; `routing_vm` / `ldk-lspd-main` warehouses were never a target.
- **T-06-03** (audit append-only): `command_audit` defined append-only by convention (A5); DB-trigger enforcement deferred as accepted.

## Known Stubs

None. The `command_state` default `pending_approval`, the nullable `claimed_at`/`reason`/`from_state`, and the `NODEMON_CLAIMED_TIMEOUT_MS` provisional default are all intentional per D-10/D-07/D-14 — not placeholder stubs. The TTL/reaper values are config-tunable and documented; Phase 7 finalizes the reaper window.

## Self-Check: PASSED

- `src/lib/db/schema/nodemon.ts` — FOUND (exports `commands`, `commandExecutions`, `commandAudit`, `commandState`; tsc clean).
- `drizzle/nodemon/0000_hard_random.sql` — FOUND (references all three tables + enum).
- `.env.example` — FOUND (`NODEMON_HMAC_SECRET_`, `NODEMON_TTL_HOURS`, `NODEMON_CLAIMED_TIMEOUT_MS` present).
- Live nodemon DB — VERIFIED (three tables + 9-value enum present via information_schema query).
- Commits `0c2b66d`, `ffa3581`, `db3f627` — present in branch history.
