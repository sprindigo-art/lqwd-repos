---
phase: 8
slug: node-scripts-heartbeat
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-17
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bats-core for the node bash scripts; psql SQL fixtures (seed/assert) against a staging `nodemon` DB; the live canary apply is a manual operator-gated check |
| **Config file** | none yet — Wave 0 (Plan 02 Task 1) installs `tests/node/` (seed.sql, assert.sql, hmac-vector.bats, check-queue.bats) |
| **Test DB identities** | TWO distinct DSNs to the SAME staging `nodemon` DB: `NODEMON_TEST_ADMIN_DSN` (PRIVILEGED owner/admin — runs seed.sql INSERTs + assert.sql, bypasses RLS) and `NODEMON_TEST_NODE_DSN` (non-superuser `nodemon_node` role — runs the check-queue tick so FORCE RLS bites; `nodemon_node` must NOT be a superuser or table owner, Pitfall 6). The Plan-02 Task-3 seeded bats suite stands these up against a DISPOSABLE local Postgres (ephemeral container / `pg_tmp`) so it runs autonomously; if no local Postgres is available the suite SKIPs and the wave-merge becomes a BLOCKING checkpoint. |
| **Quick run command** | `bats tests/node/hmac-vector.bats` + `bash tests/node/check-apply-fee-static.sh` + `bash tests/node/check-check-queue-static.sh` + `bash tests/node/check-distribution-static.sh` |
| **Full suite command** | `psql "$NODEMON_TEST_ADMIN_DSN" -f tests/node/seed.sql` → run check-queue tick(s) over `NODEMON_TEST_NODE_DSN` → `psql "$NODEMON_TEST_ADMIN_DSN" -f tests/node/assert.sql` → `bats tests/node/check-queue.bats` (incl. overlapping-ticks + wrong-pubkey RLS-invisibility, autonomous against the disposable Postgres) |
| **Estimated runtime** | ~20-40 seconds (static + hmac vector); ~1-2 min for the full seeded suite incl. disposable-Postgres spin-up |

---

## Sampling Rate

- **After every task commit:** Run the relevant static/bats check for the touched script (the task's `<automated>` verify).
- **After every plan wave:** Run the full seeded suite. NOTE: "static grep passes" is NOT "the 5 failure modes are proven" — the static check proves shape only; the seeded bats suite (5 modes + bounds + overlapping-ticks + wrong-pubkey RLS-invisibility, run as admin-seed → nodemon_node-tick → admin-assert) proves behavior. It runs autonomously against the disposable local Postgres; if no local Postgres is available it is a BLOCKING wave-merge checkpoint.
- **Before `/gsd:verify-work`:** Full seeded behavioral suite green (or its blocking checkpoint cleared) AND the canary live happy-path proven (apply → getchaninfo → revert) AND the D-04 self-update behaviorally confirmed.
- **Max feedback latency:** ~120 seconds (full seeded suite); ~40s for per-task static/vector checks.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | EXEC-02 | T-08-04 | bounds frozen at ppm 0-5000 / base 0-100000 / CLTV 18-2016; no [ASSUMED] | static + tsc | grep ASSUMED==0 + grep 'frozen D-11' + `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | EXEC-02 | T-08-01/02/03 | nodemon_node least-priv + FORCE RLS fail-closed | static | grep CREATE ROLE/FORCE RLS/CREATE POLICY/current_setting(...,true) | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 2 | EXEC-02/03 | T-08-05..11 | seed 6 rows (as admin DSN) + HMAC byte-identity vector + TWO-DSN contract (admin seed/assert vs non-superuser nodemon_node tick) documented | unit (bats) | `bats tests/node/hmac-vector.bats` + `grep NODEMON_TEST_ADMIN_DSN tests/node/README.md` + `grep NODEMON_TEST_NODE_DSN tests/node/README.md` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 2 | EXEC-02 | T-08-05/06/07/09/16 | printf %s\|openssl verify pipeline (shape-matched, not bare substring); argv lncli; [ASSUMED] inbound-fee marker (A2); fail-closed; no secret log | static | `bash tests/node/check-apply-fee-static.sh` | ❌ W0 | ⬜ pending |
| 08-02-03 | 02 | 2 | EXEC-02/03 | T-08-08/10/11 | SET LOCAL + FOR UPDATE SKIP LOCKED + sweeps + rate-limit; overlapping-ticks no-double-apply; wrong-pubkey RLS-INVISIBLE (zero rows over non-superuser nodemon_node DSN, not "unchanged-as-owner") | static + integration (bats, autonomous vs disposable Postgres) | `bash tests/node/check-check-queue-static.sh`; `bats tests/node/check-queue.bats` (disposable local Postgres; else BLOCKING checkpoint) | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 1 | EXEC-01 | T-08-12 | downloader carries no secret; chmod +x executors | static | `bash tests/node/check-distribution-static.sh nodemonDownload` | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 1 | EXEC-01 | T-08-14 | md5 self-update + backup; no package install | static | `bash tests/node/check-distribution-static.sh run_check-queue` | ❌ W0 | ⬜ pending |
| 08-03-03 | 03 | 1 | EXEC-01 | T-08-13 | idempotent grep -Fxq CRON_JOB_11 */5 | static | `bash tests/node/check-distribution-static.sh updateCrontab` | ❌ W0 | ⬜ pending |
| 08-04-01 | 04 | 3 | EXEC-03 | T-08-15/16/17 | runbook covers pre-flight + confirm-build + live-apply + revert + record + self-update-check; refs role-grants.sql + .nodemon.env | static | one token per REQUIRED section: `grep -qi pre-flight && grep -q -- --help && grep -qi live-apply && grep -qi revert && grep -qi record && grep -qi self-update && grep -q getchaninfo && grep -q role-grants.sql && grep -q .nodemon.env` | ❌ W0 | ⬜ pending |
| 08-04-02 | 04 | 3 | EXEC-03/EXEC-01 | T-08-15/16/17 | live apply succeeded + visible on-node + reverted; modified script re-pulled (D-04 self-update) | manual (live) | operator runs CANARY-RUNBOOK.md (human-check) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*File Exists ❌ W0 = the test artifact is created in Wave 0 (Plan 02 Task 1 for the node harness; Plan 03 Task 1 for the distribution static helper) before it is referenced.*

---

## Wave 0 Requirements

- [ ] `tests/node/seed.sql` — seeds the 6 rows (valid + 5 failure modes + bounds-violation) with deterministic UUIDs + a TEST per-node secret; designed to run as the PRIVILEGED `NODEMON_TEST_ADMIN_DSN` (nodemon_node has no INSERT on commands) (Plan 02 Task 1)
- [ ] `tests/node/assert.sql` — asserts resulting `commands.state` + `command_audit` transitions per mode; runs as `NODEMON_TEST_ADMIN_DSN` (RLS-bypassing, sees all 6 rows) (Plan 02 Task 1)
- [ ] `tests/node/hmac-vector.bats` — TS-signs a known canonical string, bash-verifies; guards Pitfall 1 (trailing newline) + Pitfall 4 (openssl format) (Plan 02 Task 1)
- [ ] `tests/node/check-queue.bats` — drives check-queue (over `NODEMON_TEST_NODE_DSN`) against the staging DB incl. the overlapping-ticks (no-double-apply) case AND the wrong-pubkey RLS-invisibility assertion (zero rows over the non-superuser nodemon_node connection) (Plan 02 Tasks 1+3)
- [ ] `tests/node/check-apply-fee-static.sh` — static gate for apply-fee (printf %s\|openssl pipeline shape, argv-only, no --fee_rate, [ASSUMED] inbound-fee marker, fail-closed reasons) (Plan 02 Task 2)
- [ ] `tests/node/check-check-queue-static.sh` — static gate for check-queue (SET LOCAL, FOR UPDATE SKIP LOCKED, sweeps, rate-limit, no eval) (Plan 02 Task 3)
- [ ] `tests/node/check-distribution-static.sh` — static gate for the three fileserver scripts (Plan 03 Task 1)
- [ ] `tests/node/README.md` — documents the TWO DSNs (`NODEMON_TEST_ADMIN_DSN` = privileged seed/assert; `NODEMON_TEST_NODE_DSN` = non-superuser nodemon_node tick), the nodemon_node-must-not-be-superuser-or-owner rule (Pitfall 6), the disposable-local-Postgres autonomous suite (else blocking checkpoint), and the TEST-secret env contract (Plan 02 Task 1)
- [ ] Wave 0 must seed signatures using a TEST per-node secret so the seed is self-contained and never needs a real secret

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Approved update_fee applies live + reports succeeded + new policy visible on-node, then reverted | EXEC-03 (happy path) | Touches a real LND node + channel (D-12); no safe way to automate a live fee write on the fleet | scripts/fileserver/CANARY-RUNBOOK.md: bootstrap → `lncli getchaninfo` before → enqueue+approve small update_fee → wait one */5 tick → confirm succeeded + on-node new policy → enqueue+approve revert → confirm restored. Operator names node + channel at the gate. |
| Pilot LND build flag spelling (--tlscertpath vs --tls-cert) + inbound-fee reset behavior (lnd#8614) | EXEC-03 (A1/A2) | Depends on the live node's LND build; not knowable from the dev machine | `lncli updatechanpolicy --help`; capture inbound-fee fields in getchaninfo before/after the apply. If a reset is found, the inbound-fee passthrough folds back into apply-fee's argv (Plan-02 Task 2d). |
| Modified check-queue re-pulls on the next self-update tick (D-04 md5 self-update) | EXEC-01 ("updates") | Requires the live fileserver + node downloader loop; the Plan-02/03 static greps only prove md5sum is referenced, not that a changed script actually re-pulls | CANARY-RUNBOOK.md self-update-check section: make a trivial reversible marker change to the ~/nodemon source check-queue → wait one tick (or run run_check-queue.sh) → confirm `md5sum /lnd/nodemon/check-queue` matches the modified source + the prior copy is in /lnd/nodemon/old-scripts/ → revert the marker. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the live canary apply + self-update behavioral check are the Manual-Only entries, justified above; the seeded behavioral bats suite is autonomous against a disposable Postgres, else a blocking checkpoint)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the node harness + the three static helpers + the two-DSN README)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-17 (revised 2026-06-17 — two-DSN RLS proof, autonomous seeded suite, extended runbook grep battery, self-update behavioral check)
