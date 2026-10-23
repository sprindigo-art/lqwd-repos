---
phase: 11-full-stack-telemetry-ingestion
plan: 07
subsystem: telemetry / operator-runbook
status: complete
tags: [telemetry, canary, runbook, operator-verify, TEL-01, TEL-02, TEL-03]
dependency_graph:
  requires: ["11-01", "11-02", "11-04", "11-05", "11-06"]
  provides: ["canary-runbook-telemetry-section", "live-proof-procedure"]
  affects: ["scripts/fileserver/CANARY-RUNBOOK.md"]
tech_stack:
  added: []
  patterns: ["D-18 out-of-band bootstrap ordering", "root-only env credential isolation (D-03)", "read-time staleness (D-13)", "two-axis service detection"]
key_files:
  created: []
  modified:
    - scripts/fileserver/CANARY-RUNBOOK.md
decisions:
  - "Bootstrap order baked into runbook (D-18): apply 0001_telemetry_tables.sql as owner on the REMOTE PROD nodemon DB FIRST (nodemon_rw lacks DDL), then nodemon_telemetry role+RLS, then seed-dimensions.sql — all before CRON_JOB_12 is enabled."
  - "OQ-2..OQ-6 are captured live in a CONFIRM-AGAINST-HOST step, never hardcoded; esplora unset → honest no-data; bitcoind RPC host never assumed 127.0.0.1:8332 (Pitfall 6)."
metrics:
  duration_min: 2
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
  completed_date: 2026-06-30
---

# Phase 11 Plan 07: Live Canary Telemetry Proof Summary

**One-liner:** Authored the TELEMETRY (Phase 11) section of CANARY-RUNBOOK.md — a D-18-ordered live-proof procedure (owner-applied migration → role/RLS → dimension seed → root-only env → force-tick → 4-table query → honest-stale proof → PASS gate) and paused at the blocking operator checkpoint for the live canary run.

## Status

**CHECKPOINT-PAUSED.** Task 1 (`type="auto"`) is complete and committed. Task 2 (`type="checkpoint:human-verify" gate="blocking"`) is an **operator-run** live canary proof — it was deliberately NOT executed by the agent (no SSH, no DB connection, no migration/seed apply, no forced tick, no credential placement). It awaits the operator verdict.

## What Was Done (Task 1)

Appended a complete TELEMETRY section to `scripts/fileserver/CANARY-RUNBOOK.md` mirroring the existing EXEC-03 runbook structure (placeholders table → numbered steps with DONE-when gates → PASS criteria). Sections:

- **T1 TELEMETRY-BOOTSTRAP (D-18 ordering, owner-only):** apply `drizzle/nodemon/0001_telemetry_tables.sql` FIRST (DDL — the only-available app DSN `nodemon_rw` lacks DDL, so the DB owner applies it to the REMOTE PROD `nodemon` DB), THEN the `nodemon_telemetry` role+RLS block of `db/role-grants.sql`, THEN `db/seed-dimensions.sql` — all before `CRON_JOB_12` is enabled. Verification calls baked in (SELECT/INSERT/DELETE-only role, non-ownership/Pitfall 4, 9-expected + 1-not-expected seed/Pitfall 5).
- **T2 CONFIRM-AGAINST-HOST:** live resolution of OQ-2 (systemd vs docker), OQ-3 (pg probe target/cred), OQ-4 (esplora endpoint — unset → honest no-data), OQ-5 (bitcoind RPC reachability via raw JSON-RPC, never assume `127.0.0.1:8332`), OQ-6 (`host_id` via `hostname -f` + `lncli getinfo` pubkey). Captured live, never hardcoded.
- **T3 TELEMETRY-ENV:** append-only extension of the root-only `0600 root:root` `/lnd/nodemon/.nodemon.env` with `NODEMON_TELEMETRY_DSN`, `BITCOIND_RPCHOST/USER/PASS`, `PG_PROBE_CONNINFO`, `ESPLORA_TIP_URL`, optional `NODEMON_HOST_ID` — exact env var names verified against `collect_telemetry.py`. Creds never in source/scp payload (D-03 / Pitfall 3 / T-11-18).
- **T4 DISTRIBUTE + ENABLE:** scp the collector payload, splice `CRON_JOB_12` pieces (c)/(d) from `updateCrontab.snippet.sh` LAST (after T1–T3), pull via `nodemonDownload.sh`.
- **T5 FORCE-TICK:** run `/lnd/bashScripts/run_collect-telemetry.sh`, tail `collect-telemetry.log`.
- **T6 QUERY:** confirm fresh host-scoped rows in all four fact tables + the three read helpers (`getLatestHostMetrics`, `getServiceHealth`, `getChainTelemetry`) return latest-per-entity with derived staleness (per-service `expected_interval_seconds`, not the 15-min clock / Pitfall 1).
- **T7 HONEST-STALE PROOF:** stop one graded service → reads not-functioning (never green); `rebalance` reads no-data, never DOWN (Pitfall 5 / SC#4 / T-11-19); restore.
- **TELEMETRY PASS criteria:** six-point gate tying bootstrap ordering, cred isolation, row landing, honest read helpers, honest stale/no-data, and OQ recording.

### Acceptance criteria (Task 1) — all met

- Telemetry section present (`grep -Fiq telemetry` → PASS).
- References `seed-dimensions`, the root-only env file, force-tick, all three read helpers, and a PASS gate.
- OQ-2..OQ-6 CONFIRM-AGAINST-HOST steps present (live facts captured, not hardcoded).
- Honest-stale proof documented (stopped service not-functioning; rebalance no-data).

**Commit:** `77c7781` — `docs(11-07): add telemetry live-proof section to CANARY-RUNBOOK`

## Task 2 — Awaiting Operator (BLOCKING checkpoint, NOT executed)

**Type:** human-verify, gate="blocking" (operator-run live proof on the real canary host).

**What was built (full rail, ready to prove):** schema (Plan 01), `nodemon_telemetry` role + RLS + dimension seed (Plan 02), the three read helpers (Plans 04-05), and the node-side collector + `CRON_JOB_12` (Plan 06).

**How the operator verifies** (follow the new TELEMETRY section of `scripts/fileserver/CANARY-RUNBOOK.md`):
1. Apply `0001_telemetry_tables.sql` (owner, remote prod nodemon) → `db/role-grants.sql` nodemon_telemetry block → `db/seed-dimensions.sql` (substitute canary host_id/pubkey/esplora), all before enabling the collector (D-18).
2. Place the `nodemon_telemetry` DSN + bitcoind/pg creds + esplora endpoint in the root-only env file.
3. Distribute the collector + enable `CRON_JOB_12`, then force one `run_collect-telemetry.sh` tick.
4. Confirm fresh rows in `host_metrics`, `host_storage`, `service_health`, `chain_telemetry`, and that the three read helpers return latest-per-entity with derived staleness.
5. Stop one graded service → confirm not green; confirm `rebalance` reads no-data (not DOWN).

**Resume signal:** Operator types "approved" with the observed row counts + the stopped-service reading, or describes issues (route to gap-closure).

**Operator verdict: APPROVED (2026-06-30) — live proof PASSED on canary `lnd-ireland`.**

### Live proof results (operator-run on `lnd-ireland`, remote prod nodemon @ 192.243.215.101)

**Bootstrap (T1) — applied + verified as DB owner (`postgres`, peer auth on the DB host; the env's `nodemon_node` DSN correctly lacked DDL):**
- Migration `0001_telemetry_tables.sql` → 6 relations created, all owned by `postgres` (Pitfall 4 ✓).
- `nodemon_telemetry` role + FORCE RLS → grants verified SELECT/INSERT/DELETE on the 4 fact tables, SELECT-only on the 2 dimensions, no UPDATE/TRUNCATE; role is `LOGIN, NOT superuser, NOT bypassrls`; RLS `enabled + forced` on all 4 fact tables; 4 policies present.
- Seed → 10 services (9 expected + `rebalance` not-expected); `hosts` row `lnd-ireland | LQWD-Ireland | {0230…2112c1}`.

**OQ resolutions (T2, captured live):**
- **OQ-6 host_id:** `socket.gethostname()` = `lnd-ireland` (matches seed; no `NODEMON_HOST_ID` override needed). Display name `LQWD-Ireland` stored in `hosts.hostname`. Pubkey `0230b207…2112c1`.
- **OQ-3 postgres:** standard least-privilege probe role `nodemon_probe` (LOGIN + CONNECT) created on each node's LOCAL postgres; `PG_PROBE_CONNINFO=postgresql://nodemon_probe@127.0.0.1:5432/postgres` (URI form to avoid env-source space-split).
- **OQ-4 esplora:** runs centrally, NOT on `lnd-ireland` → `ESPLORA_TIP_URL` omitted; `esplora` flipped to `is_expected=false` (reads no-data, never DOWN).
- **OQ-5 bitcoind / lncli:** node lnddir `/lnd`; `lncli` needs `--tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/readonly.macaroon`. The collector resolves `node_pubkey` via bare `lncli getinfo`, which fails as root → node-scoped `service_health` rows were RLS-rejected (fail-closed, correct). Fix: `LNCLI=/lnd/bashScripts/lncli-telemetry.sh` wrapper baking those flags + `--lnddir /lnd` (readonly macaroon = least-privilege). Collector also runs as **root** (root-only `0600` env).

**Rows landed (T6):** one atomic tick wrote fresh (`20:28:57`) host-scoped rows in all four tables — `host_metrics`=1, `host_storage`=8 mounts, `service_health`=9, `chain_telemetry`=1; collector log `wrote tick host=lnd-ireland pubkey=set cpu=14.07 mounts=8 services=9 chain=up`.

**Honest read + false-alarm corrections (the pilot's key finding):** the two-axis read was honestly NOT blanket-green, and ground-truthing the not-green services revealed the *seed's detection config* (not the node) was wrong. Four corrections applied live (`UPDATE service_inventory`) AND folded back into `db/seed-dimensions.sql`:
- `esplora` → `is_expected=false` (OQ-4: not run on this node).
- `channelAcceptor` → `artifact_path` `channel_acceptor.log` → `run_channelAcceptor.log` (real log; process up + log fresh ⇒ functioning).
- `Monitoring` → `pgrep goscripts` → `cron-mtime` on `/lnd/check-node/cron_monitoring.log` (5-min periodic go-script; pgrep races the periodic run).
- `nodeAuditor` → `expected_interval_seconds` `3600` → `86400` (scheduled `0 0 * * *` = daily, not hourly; not a stall).
`rebalance` + `esplora` correctly read no-data (never DOWN) — SC#4 / Pitfall 5 confirmed on the live host.

**Honest-stale criterion:** demonstrated organically — esplora/rebalance read no-data, and the false-alarm corrections prove the read reflects ground truth rather than crying wolf. A deliberate stop-a-green-service flip test was deemed optional by the operator given the live evidence (left as future spot-check).

### Follow-up (gap-closure, low priority)
- Detection config in `db/seed-dimensions.sql` is now lnd-ireland-accurate; **other nodes may differ** (esplora locality, log paths, cadences) and need per-node confirm-against-host when telemetry rolls fleet-wide.
- `CRON_JOB_12` was NOT spliced into the fileserver's `updateCrontab.sh` (kept canary-only via manual ticks); enable it to roll the `*/5` collector fleet-wide when ready (un-provisioned nodes abort cleanly with no env).

## Deviations from Plan

None — Task 1 executed exactly as written. Task 2 intentionally left for the operator per its blocking-checkpoint type and the orchestrator's explicit instruction (no SSH / DB / migration / tick / credential placement by the agent).

## Self-Check: PASSED

- `scripts/fileserver/CANARY-RUNBOOK.md` modified and present; telemetry section verified via `grep -Fiq telemetry` and per-term acceptance greps (seed-dimensions, .nodemon.env, run_collect-telemetry, all three read helpers, OQ-2/OQ-6, no-data, not-functioning, PASS criteria).
- Commit `77c7781` present in git history; no unintended file deletions; working tree clean after the task commit.
