---
phase: 08-node-scripts-heartbeat
plan: 02
subsystem: node-side-executor
tags: [bash, lncli, hmac, rls, postgres, atomic-claim, bats, exec-02, exec-03]
requires:
  - "src/lib/queue/claim.ts (claimNext/expireSweep/reaperSweep — the frozen mechanics ported)"
  - "src/lib/queue/stub-executor.ts (the claimed->executing->outcome state chain ported)"
  - "src/lib/queue/sign.ts + canonical.ts (the HMAC digest + 5-field canonical payload reproduced byte-identically)"
  - "src/lib/queue/bounds.ts (frozen ppm/base/cltv bounds re-enforced node-side)"
  - "db/role-grants.sql (Plan 01 nodemon_node role + ENABLE/FORCE RLS the tick connects as)"
  - "drizzle/nodemon/0000_hard_random.sql (the nodemon DDL the disposable harness applies)"
provides:
  - "scripts/node/check-queue — node-side tick: RLS-scoped atomic claim + expire/reaper sweeps + per-node rate-limit + guarded state chain (bash port of claim.ts + stub-executor.ts with a real lncli)"
  - "scripts/node/apply-fee — HMAC verify (verbatim canonical_payload) + node-side bounds re-enforce + lncli updatechanpolicy via argv; fail-closed hmac_mismatch/bounds_violation with NO lncli (D-13)"
  - "tests/node/ — deterministic EXEC-03 proof harness: seed/assert SQL, TS-to-bash HMAC byte-identity vector, autonomous disposable-Postgres bats suite proving all 5 failure modes + bounds + overlapping-ticks + wrong-pubkey RLS-invisibility"
affects:
  - "Plan 04 (canary): the live happy-path apply runs check-queue/apply-fee on the pilot; the [ASSUMED] A1 (lncli flag spelling) and A2 (inbound-fee reset, lnd#8614) markers in apply-fee are verified there"
  - "Plan 03 (distribution): run_check-queue.sh self-updates + invokes these two scripts; updateCrontab adds the */5 heartbeat"
tech-stack:
  added: []
  patterns:
    - "printf %s | openssl dgst -sha256 -hmac SECRET -r | awk '{print $1}' — byte-identical to node createHmac digest (Pitfall 1 no trailing newline; Pitfall 4 -r field 1)"
    - "ONE psql transaction: SET LOCAL app.node_pubkey (Pitfall 2) + FOR UPDATE SKIP LOCKED single claim + expire/reaper sweeps; psql :'var' binding never string-concat"
    - "lncli updatechanpolicy via argv token list ONLY (no eval/sh -c); --fee_rate_ppm only (Pitfall 7)"
    - "Two-DB-identity RLS proof: privileged admin seeds/asserts (RLS-bypassing), non-superuser nodemon_node runs the tick so FORCE RLS bites (Pitfall 6)"
    - "Autonomous test harness via disposable docker Postgres (bats setup_file/teardown_file)"
key-files:
  created:
    - "scripts/node/check-queue"
    - "scripts/node/apply-fee"
    - "tests/node/seed.sql"
    - "tests/node/assert.sql"
    - "tests/node/hmac-vector.bats"
    - "tests/node/hmac-vector.sh"
    - "tests/node/check-queue.bats"
    - "tests/node/check-apply-fee-static.sh"
    - "tests/node/check-check-queue-static.sh"
    - "tests/node/README.md"
    - "tests/node/lib/pg-harness.sh"
  modified: []
decisions:
  - "D-13: apply-fee fails closed on hmac_mismatch/bounds_violation and NEVER reaches lncli; the lncli call is structurally after both gates"
  - "D-06: the DB FOR UPDATE SKIP LOCKED row-lock is the no-double-apply guarantee; flock is a belt only"
  - "D-08/D-09/D-10: expireSweep ttl_expired, reaperSweep 15-min window (releases only claimed, never executing — Pitfall 5), rate-limit 4/node/rolling-hour"
  - "Disposable docker Postgres makes the full EXEC-03 5-mode + overlapping-ticks + RLS-invisibility suite AUTONOMOUS; if no local Postgres the bats suite skips with an explicit blocking-checkpoint message (static != proven)"
metrics:
  duration: ~55m
  completed: 2026-06-17
  tasks: 3
  files: 11
---

# Phase 8 Plan 02: Node-Side Executor (check-queue + apply-fee) Summary

Built the node-side command executor — `check-queue` (the cron tick: RLS-scoped atomic claim + expire/reaper sweeps + per-node rate-limit + guarded state chain) and `apply-fee` (HMAC verify over the verbatim canonical_payload + node-side bounds re-enforce + `lncli updatechanpolicy` via argv) — as faithful pure-bash ports of the frozen Phase-6 modules `claim.ts`, `stub-executor.ts`, `sign.ts`, `canonical.ts`, and `bounds.ts`, with a real `lncli` swapped in for the stub. Then built the deterministic `tests/node/` proof harness that demonstrates all five failure modes + the bounds-violation case + overlapping-ticks no-double-apply + genuine wrong-pubkey RLS-invisibility against a disposable local Postgres, fully autonomously.

## What Was Built

### Task 1 — `tests/node/` harness (commit f503d7e)
- `seed.sql`: 6 deterministic rows (fixed UUIDs/expires_at) — valid + tampered-HMAC + un-approved + expired + wrong-pubkey + out-of-bounds — built with `concat_ws(E'\n', …)` so the canonical_payload bytes exactly match `canonical.ts:buildSignedPayload`; signatures precomputed under the documented TEST secret. Designed to run as the privileged `NODEMON_TEST_ADMIN_DSN` (nodemon_node has no INSERT on commands).
- `assert.sql`: per-row `commands.state` + `command_audit` reason assertions (hmac_mismatch / bounds_violation / ttl_expired; un-approved & wrong-pubkey unchanged with zero new audit rows) as `ASSERT`s that fail the script on violation; runs as the RLS-bypassing admin DSN.
- `hmac-vector.bats` + `hmac-vector.sh`: TS-to-bash HMAC byte-identity proof — node `createHmac` over `buildSignedPayload` equals `printf %s | openssl dgst -sha256 -hmac -r | awk '{print $1}'` (Pitfall 1: printf %s not echo; Pitfall 4: -r field 1). The `.sh` sibling runs the identical proof on hosts without bats.
- `lib/pg-harness.sh`: disposable docker/podman/pg_tmp Postgres lifecycle — applies the nodemon DDL + the nodemon_node role + ENABLE/FORCE RLS, derives the two DSNs.
- `README.md`: documents the two-DSN contract, the nodemon_node-must-not-be-superuser-or-owner requirement (Pitfall 6), the TEST secret + regeneration command, and the staging-only run order.

### Task 2 — `scripts/node/apply-fee` (commit 34ab5e3)
- Port of `sign.ts:verifyPayload`: recompute HMAC over the verbatim `canonical_payload` (never re-serializing params — Pitfall 3), lowercase hex, fail-closed `hmac_mismatch` with NO lncli.
- Node-side bounds re-enforce (3rd of 3): `in_range` ppm 0..5000 / base 0..100000 / cltv 18..2016; fail-closed `bounds_violation` with NO lncli.
- `lncli updatechanpolicy` via an argv token list ONLY (no eval/sh -c), `--fee_rate_ppm` only (Pitfall 7).
- `[ASSUMED]` markers: global-flag spelling (A1) and inbound-fee passthrough (lnd#8614 / A2 — documents that the pilot omits inbound-fee flags and the A2 finding folds back into this argv).
- Returns OUTCOME/REASON + a safe detail (never the secret/macaroon/signature); `check-queue` owns all DB writes.
- `check-apply-fee-static.sh`: `bash -n` + non-comment grep battery (verify-pipeline shape, argv-only, frozen bounds, fail-closed reasons) — green.

### Task 3 — `scripts/node/check-queue` (commit a913e60)
- Single nodemon_node transaction: `SET LOCAL app.node_pubkey` (Pitfall 2) scopes FORCE RLS; expireSweep (ttl_expired), reaperSweep (15-min window, releases only `claimed`, never `executing` — Pitfall 5), rate-limit gate (skip at ≥4 executions in the rolling hour — D-10), and `claimNext` (oldest approved non-expired row `FOR UPDATE SKIP LOCKED` → claimed + audit). All values bound via psql `:'var'`, never string-concatenated.
- State chain (port of `stub-executor.ts`): commit1 claimed→executing + audit; call apply-fee BETWEEN commits; commit2 executing→outcome + audit (reason on failure) + one `command_executions` row.
- `check-check-queue-static.sh`: `bash -n` + grep battery (SKIP LOCKED, SET LOCAL, sweeps, rate-limit, no eval/sh -c) — green.
- Finalized `check-queue.bats`: un-skipped the wrong-pubkey RLS-invisibility test (0 rows + node sees only 5/6), the overlapping-ticks no-double-apply test (exactly 1 execution row), and the full 5-mode + bounds seeded suite → assert.sql; runs autonomously via the disposable docker Postgres.

## Verification Results

- `bats tests/node/hmac-vector.bats` — **3/3 pass** (TS↔bash byte identity, echo-differs negative test, -r format).
- `bats tests/node/check-queue.bats` — **4/4 pass** against a disposable docker Postgres:
  - static argv-only gate
  - wrong-pubkey RLS-invisibility: `count=0` for the wrong-pubkey UUID + node sees only its own 5 rows
  - overlapping ticks: exactly one claimed + one no-op, exactly one `command_executions` row
  - full seeded tick: `assert.sql: all six failure-mode assertions PASSED`
- `bash tests/node/check-apply-fee-static.sh` and `bash tests/node/check-check-queue-static.sh` — both exit 0.
- `bash -n` clean on both `scripts/node/check-queue` and `scripts/node/apply-fee`.
- Manual disposable-Postgres run confirmed final states: valid→succeeded, tampered→failed/hmac_mismatch, un-approved→pending_approval (untouched), expired→expired (ttl_expired), wrong-pubkey→approved (RLS-invisible, untouched), out-of-bounds→failed/bounds_violation. Reaper releases a stale `claimed` row (reaper_released_stale_claim, stale_acknowledged=true) and leaves `executing` untouched. Rate-limit gate logs `rate_limited` and leaves the valid row approved when ≥4 executions exist in the rolling hour.

## Threat Model Coverage

All `mitigate` dispositions in the plan's STRIDE register are implemented and proven:
- T-08-05 (tampered HMAC) — seed row 2 ends failed/hmac_mismatch, no lncli.
- T-08-06 (shell injection) — argv-only; static gates assert no eval/sh -c, --fee_rate_ppm only.
- T-08-07 (out-of-bounds bypass) — seed row 6 ends failed/bounds_violation, no lncli.
- T-08-08 (double-apply) — overlapping-ticks test: one claim, one execution row.
- T-08-09 (secret/macaroon/signature leakage) — log() and detail strings emit state/reason/chan_point only.
- T-08-10 (expired-intent replay) — seed row 4 expired by expireSweep; claimNext filters expires_at > now().
- T-08-11 (cross-node access) — wrong-pubkey row RLS-invisible to the non-superuser nodemon_node connection (0 rows).
- T-08-SC (package installs) — accept: pure bash; `bats` is an OS dev tool (NOT in package.json); the disposable Postgres is an ephemeral container, not an npm dependency. No install step.

## Deviations from Plan

### Auto-fixed Issues (Rule 1 / Rule 3)

**1. [Rule 3 - Blocking] `read_field`/claim psql output corrupted by command tags**
- Found during: Task 3 behavioral validation.
- Issue: piping multi-statement SQL via stdin made psql print `BEGIN`/`SET`/`COMMIT` command tags to stdout, corrupting the captured `canonical_payload` bytes → every HMAC verify failed.
- Fix: added `-q` (quiet) to the field-read and claim psql invocations so only the SELECT value is captured.

**2. [Rule 3 - Blocking] `:'var'` interpolation does not run with multi-statement `psql -c`**
- Found during: Task 3 behavioral validation.
- Issue: psql sends a multi-statement `-c` string raw to the server, bypassing the meta-variable lexer, so `:'pubkey'` did not interpolate (syntax error). 
- Fix: switched the per-field reads to stdin (here-doc) which always runs the lexer; used `:col` (unquoted) for the column expression and `:'id'`/`:'pubkey'` for literals.

**3. [Rule 1 - Bug] heredoc-inside-`$()` parse failure**
- Found during: Task 3 `bash -n`.
- Issue: a quoted heredoc nested in `$( … )` combined with `$'\t'` tripped bash's parser ("unexpected EOF looking for matching `'`").
- Fix: assigned the claim SQL to a variable via `read -r -d '' CLAIM_SQL <<'SQL'` then piped it into psql, removing the heredoc-in-substitution nesting.

**4. [Rule 1 - Bug] lock/log dir hardcoded to /lnd/nodemon broke local runs**
- Found during: Task 3 behavioral validation.
- Issue: `LOCAL_DIR=/lnd/nodemon` does not exist off-node, so the flock fd failed to open and every tick falsely "skipped".
- Fix: added `NODEMON_LOCAL_DIR`/`NODEMON_LOCK_FILE`/`NODEMON_LOG_FILE` overrides and made the flock belt optional (proceed if the lock fd can't be opened — the DB row-lock is the real guarantee).

**5. [Rule 1 - Bug] ANSI color bytes in the harness free-port helper**
- Found during: Task 3 bats run.
- Issue: the node free-port snippet emitted ANSI color codes around the port number, producing `docker: invalid hostPort`.
- Fix: switched to `process.stdout.write` + `tr -cd '0-9'`.

**6. [Rule 1 - Bug] static-check helper `--` argument shadowing**
- Found during: Task 2 static gate.
- Issue: passing `--` before the pattern to `require_nc`/`forbid_nc` made `$1` the literal `--`, so the grep matched `/--/`.
- Fix: used bracketed `[-][-]fee_rate` patterns, dropping the stray `--`.

No architectural (Rule 4) changes; the plan was executed as written. `bats-core` was installed on the runner (OS dev tool, NOT added to package.json) so the autonomous EXEC-03 suite runs green rather than falling back to the documented blocking-checkpoint skip.

## Known Stubs

None. The two scripts are fully wired; `apply-fee` calls a real `lncli` (mocked only inside the test harness via a PATH override). The `[ASSUMED]` lncli-flag-spelling (A1) and inbound-fee-reset (A2) markers are intentional pilot-verification flags resolved on the Plan-04 canary, documented inline.

## Self-Check: PASSED

- FOUND: scripts/node/check-queue (251 lines)
- FOUND: scripts/node/apply-fee (143 lines)
- FOUND: tests/node/seed.sql, assert.sql, hmac-vector.bats, hmac-vector.sh, check-queue.bats, check-apply-fee-static.sh, check-check-queue-static.sh, README.md, lib/pg-harness.sh
- FOUND commit: f503d7e (Task 1)
- FOUND commit: 34ab5e3 (Task 2)
- FOUND commit: a913e60 (Task 3)
