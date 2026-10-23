---
phase: 11-full-stack-telemetry-ingestion
plan: 06
subsystem: node-scripts
tags: [telemetry, collector, python, psycopg2, rls, cron, fileserver, security]

# Dependency graph
requires:
  - phase: 11-01
    provides: nodemon telemetry schema (host_metrics, host_storage, service_health, chain_telemetry fact tables + hosts, service_inventory dimensions)
  - phase: 11-02
    provides: nodemon_telemetry least-privilege role + host-axis FORCE RLS (app.host_id/app.node_pubkey) + seeded dimensions
provides:
  - "collect_telemetry.py — node-side */5 telemetry collector (host vitals + two-axis service health + bitcoind/esplora/pg probes) writing RAW rows to the 4 fact tables under host-scoped RLS"
  - "run_collect-telemetry.sh — venv/flock/md5-self-update wrapper sourcing the root-only env file at runtime"
  - "CRON_JOB_12 */5 idempotent crontab merge on the existing Phase-8 distribution rail"
affects: [11-07, CANARY-RUNBOOK]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "argv-only subprocess invocation (never shell=True) for every host/service probe (EXEC-02)"
    - "SET LOCAL app.host_id + app.node_pubkey as psycopg2-bound GUCs inside the insert txn so FORCE RLS hard-boxes the write to the node's own host (D-04)"
    - "Two distinct freshness clocks: per-service expected_interval_seconds × grace for FUNCTIONING vs the 15-min collector clock (RESEARCH Pitfall 1)"
    - "Cron-batch services dispatch RUNNING on log-mtime, never pgrep (Pitfall 2); persistent Go procs use pgrep; infra trio use native probes"
    - "RAW values only (D-14): no blocks_behind, no severity, no stale flag stored — derived at read time"

key-files:
  created:
    - scripts/fileserver/collect_telemetry.py
    - scripts/fileserver/requirements.txt
    - scripts/fileserver/run_collect-telemetry.sh
  modified:
    - scripts/fileserver/updateCrontab.snippet.sh
    - scripts/fileserver/nodemonDownload.sh

key-decisions:
  - "bitcoind reached via raw urllib JSON-RPC (no requests dep) with BITCOIND_RPCHOST from env — never the loopback default port (Pitfall 6)"
  - "esplora tip-height + pg_isready are env-gated native probes that read honest no-data when their target env var is unset (OQ-3/OQ-4)"
  - "node_pubkey GUC set to '' (empty) when underivable so host-level service rows (node_pubkey NULL) still pass WITH CHECK; node-scoped rows require the real pubkey"
  - "Per-node venv at .venv-telemetry (separate from the Phase-8 executor dir) so the collector bootstrap never collides with check-queue"
  - "In-collector 21-day prune over a fixed table allow-list (string-concat, not f-string) — RLS-scoped so it only deletes the node's own rows"

patterns-established:
  - "Third clone of the Phase-8 rail: config.sh source + md5 payload self-update (run_check-queue.sh) fused with venv/flock/psycopg2 bootstrap (run_nodeAuditor.sh)"
  - "Static SEC grep battery as acceptance: no secret literal, no shell=True, no f-string SQL, no hardcoded RPC host/port in the scp'd payload or wrapper"

requirements-completed: [TEL-01, TEL-02, TEL-03]

# Metrics
duration: ~18min
completed: 2026-06-29
---

# Phase 11 Plan 06: Node-Side Telemetry Collector Summary

**A read-only Python collector (`collect_telemetry.py`) plus a venv/flock/md5 bash wrapper that each */5 tick gathers host vitals, two-axis service health, and bitcoind/esplora/pg probes and INSERTs RAW rows into the four nodemon fact tables under host-scoped RLS — no secret in the payload, argv-only subprocesses, parameter-bound SQL, a 21-day prune, and a CRON_JOB_12 install on the existing Phase-8 rail. No daemon; HMAC-free (D-11).**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 3

## What Was Built

### Task 1 — collect_telemetry.py: host vitals + two-axis service detection (commit 4fe4c46)
- Host vitals from procfs + coreutils, RAW (D-14): CPU% via two `/proc/stat` reads ~1s apart, 1/5/15 load from `/proc/loadavg`, mem/swap kB from `/proc/meminfo`, uptime from `/proc/uptime`, cumulative rx/tx from `/proc/net/dev` (non-loopback), and one `host_storage` row per mount via `df -P -B1`.
- Identity: `host_id` = `NODEMON_HOST_ID` env override else `socket.gethostname()` (OQ-6); `node_pubkey` from `lncli getinfo`.
- Two-axis service health driven by the `service_inventory` SELECT: RUNNING dispatched on `detection_method` (`pgrep -f` for persistent Go procs, `systemctl is-active` for systemd, **log-mtime for cron-batch — never pgrep, Pitfall 2**); FUNCTIONING via log mtime freshness against the per-service `expected_interval_seconds` × grace plus success/error grep markers.
- Every subprocess runs via `run_argv` (a list), never `shell=True`. `requirements.txt` pins `psycopg2-binary` + `python-dotenv`.

### Task 2 — probes + RLS INSERT + prune (commit 0ce1a39)
- `probe_chain()`: raw bitcoind JSON-RPC (`getblockchaininfo`/`getnetworkinfo`/`getmempoolinfo`) via `urllib` + basic auth, host from `BITCOIND_RPCHOST` — never the loopback default port (Pitfall 6). Stores raw `blocks`/`headers`/`verification_progress`/`ibd`/`size_on_disk`/peers/mempool (no `blocks_behind` — read-time, D-14).
- `probe_esplora_tip()` (env `ESPLORA_TIP_URL`) and `probe_postgres()` (`pg_isready`, optional `PG_PROBE_CONNINFO`): env-gated native FUNCTIONING probes (D-07) that read honest no-data when unset.
- `write_tick()`: one transaction — `SET LOCAL app.host_id = %s` + `SET LOCAL app.node_pubkey = %s` (psycopg2-bound GUCs → FORCE RLS hard-box), then parameter-bound INSERTs across `host_metrics`, `host_storage` (per mount), `service_health` (per service), `chain_telemetry`, then a 21-day retention prune (`DELETE … WHERE collected_at < now() - interval '21 days'`) over a fixed table allow-list.

### Task 3 — wrapper + CRON_JOB_12 + downloader verify (commit 03e589a)
- `run_collect-telemetry.sh`: config.sh source + `log()` + md5 self-update of the python payload (mirror `run_check-queue.sh`) fused with the flock overlap guard + per-node `.venv-telemetry` bootstrap + psycopg2/dotenv import-check (mirror `run_nodeAuditor.sh`). Sources the root-only `/lnd/nodemon/.nodemon.env` at runtime (DSN + bitcoind/pg credentials) — never shipped (D-03). No daemon.
- `updateCrontab.snippet.sh`: `CRON_JOB_12` */5 constant + its own `grep -Fxq` idempotent merge block (PIECE c/d), mirroring the Phase-8 `CRON_JOB_11`.
- `nodemonDownload.sh`: confirming comment — `scp -r` already pulls the new `.py` payload; `collect_telemetry.py` runs via the venv python (no +x), the wrapper ships in `~/bashScripts`. No functional change needed.

## Verification Results

- `python3 -m py_compile scripts/fileserver/collect_telemetry.py` → clean.
- `bash -n` clean on `run_collect-telemetry.sh` and `updateCrontab.snippet.sh` (and `nodemonDownload.sh`).
- SEC grep battery across the payload + wrapper: no `RPCPASS=`, `password=`, `postgresql://`, `shell=True`, `127.0.0.1`, or `8332` matches.
- `SET LOCAL app` appears twice (host_id + node_pubkey); no f-string/`.format` SQL in any `execute`; `21 days` prune present; `CRON_JOB_12` + its `grep -Fxq` merge present.
- Live ingestion proof is deferred to Plan 07 (canary runbook) per the plan — no DB/cron/host was contacted by this executor.

## Deviations from Plan

None — plan executed exactly as written. The esplora/postgres "honest no-data when env unset" behavior is the planned OQ-3/OQ-4 resolution, not a stub.

## Known Stubs

None. Every fact table is wired to a real probe/gatherer. `ESPLORA_TIP_URL` and `PG_PROBE_CONNINFO` are intentionally env-gated (honest no-data until the operator supplies the canary endpoints, OQ-3/OQ-4) — this is the planned behavior, not placeholder data.

## Self-Check: PASSED

- All 6 created/modified files present on disk.
- All 3 task commits present in git log (4fe4c46, 0ce1a39, 03e589a).
