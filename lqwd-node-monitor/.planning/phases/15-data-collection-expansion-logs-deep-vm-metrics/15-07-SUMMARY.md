---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 07
subsystem: collector
tags: [python, psycopg2, procfs, pg-stat, deep-vm-metrics, rls, retention]
requires: [15-01, 15-06]
provides:
  - gather_host_metrics_ext (ctxt/intr, mem detail, vmstat incl. oom_kill, TCP snmp, fd/file-nr, ss sockets, failed units, clock offset, nproc, entropy, btime)
  - gather_cpu_cores / gather_disk_io / gather_net_ifaces child-row gatherers
  - gather_host_storage extended with df -i -P inode counts (additive nullable)
  - probe_pg_health (PG_PROBE_CONNINFO; pg_stat_activity/pg_stat_database counters + stats_reset + FATAL/40001/too-many-clients log counts)
  - _insert_host_metrics_ext / _insert_children / _insert_pg_health inside write_tick after SET LOCAL
  - 5 new fact tables in the plain-window PRUNE_TABLES allow-list
affects: [15-04, 15-05, 15-09]
tech-stack:
  added: []
  patterns:
    - pure parse helpers (text -> dict/list) split from thin /proc-reading wrappers so deep-VM parsing is offline unit-testable
    - honest no-data everywhere - every sub-source degrades independently to None/[] instead of failing the tick
    - RAW-only persistence (D-14) - counters stored cumulative; rate math, bands, and the AP-12a/b discriminator derived at read time
key-files:
  created: []
  modified:
    - scripts/fileserver/collect_telemetry.py
    - scripts/fileserver/test_extract.py
decisions:
  - "steal jiffies documented and tested as full-split-line index 8 of a /proc/stat cpuN line (= value-list index 7) - the plan's 'steal=idx8, iowait=idx4' mixed two bases; the kernel field order user nice system idle iowait irq softirq steal guest is authoritative and fixture-asserted"
  - "probe_pg_health uses current_database() as the datname (PG_PROBE_CONNINFO's dbname IS the lnd database) instead of inventing a new env var"
  - "PG-log signature counts are None (not 0) when no postgres inventory row with an artifact_path exists on the host - honest no-data over a fake zero"
  - "blocked_queries + slow_query_gt_1s (optional pg_health columns from Plan 01) are filled via two cheap pg_stat_activity counts since the schema columns already exist"
metrics:
  duration: ~12m
  completed: 2026-07-14
---

# Phase 15 Plan 07: Deep-VM Metrics + PG Counters Collection Summary

The collector now gathers the full COL-03 deep-VM set (per-core jiffies incl. steal/iowait, per-device disk I/O, per-iface errs/drops, TCP snmp, vmstat incl. oom_kill, fd/limits, failed units, clock skew, nproc, inodes) plus structured COL-02 pg_stat counters + AP-12 log-signature counts via PG_PROBE_CONNINFO — all RAW, all argv-only, all persisted inside the RLS write_tick transaction with the new facts on the prune allow-list.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Deep-VM gatherers (/proc + argv) + child-row gatherers (with tests) | 79ab17a | scripts/fileserver/collect_telemetry.py, scripts/fileserver/test_extract.py |
| 2 | probe_pg_health + deep inserts wired into write_tick + prune allow-list | a0425f2 | scripts/fileserver/collect_telemetry.py |

## What Was Built

- **Deep-VM gatherers (Task 1):** Pure parse helpers (`_parse_cpu_cores`, `_parse_proc_stat_scalars`, `_parse_vmstat`, `_parse_snmp_tcp`, `_parse_file_nr`, `_parse_ss_summary`, `_parse_chronyc_tracking`, `_parse_diskstats`, `_parse_net_dev_ifaces`, `_parse_df_inodes`) take text and return dicts/lists so test_extract.py exercises them offline against fixture /proc text. Thin `gather_*` wrappers add the defensive `except (OSError, ValueError, IndexError)` → None/[] shape from 15-PATTERNS. `gather_host_metrics_ext()` assembles the 30-scalar host_metrics_ext row (each sub-source degrades independently); `gather_cpu_cores`/`gather_disk_io`/`gather_net_ifaces` emit child-row lists per the df-child template (loop*/ram*/dm-* and `lo` filtered); `gather_meminfo` extended with Cached/Buffers/Dirty/Writeback/Slab/SReclaimable without touching the original host_metrics keys; `gather_host_storage` merges `df -i -P` inode counts into its row dicts (nullable). `gather_clock_offset` tries `chronyc tracking` then `ntpq -c rv`, returning None when neither is present (A2). All subprocesses go through `run_argv` (argv lists — `nproc`, `ss -s`, `systemctl --failed --no-legend`, `chronyc tracking`, `ntpq -c rv`, `df -i -P`); no `shell=True` anywhere (EXEC-02 / T-15-06).
- **PG counters probe (Task 2):** `probe_pg_health(pg_log_text)` reuses the existing `PG_PROBE_CONNINFO` env var (A1, no new secret) via psycopg2: `SHOW max_connections`, active/blocked/slow counts from `pg_stat_activity`, `numbackends`/`xact_commit`/`xact_rollback`/`deadlocks` **+ `stats_reset`** from `pg_stat_database` (Pitfall 7 — read-time deltas clamp at reset boundaries), and per-line counts of `FATAL`, `sorry, too many clients already`, and `could not serialize`/`SQLSTATE 40001` from the tailed PG log (`_count_pg_log_signatures`, pure). Returns one RAW dict — no a/b verdict, no band (D-14/A5); None on any failure.
- **Persistence + retention (Task 2):** `_insert_host_metrics_ext` (32-column %s-bound insert, skipped when ext empty), `_insert_children` (three loops mirroring `_insert_host_storage`), `_insert_pg_health` (15 columns, no variant/severity/band), and the extended `_insert_host_storage` (inode columns) all run inside the existing `with conn:` transaction **after** the two `SET LOCAL` lines in `write_tick` (Pitfall 2 / T-15-02). The five new fact tables (`host_metrics_ext`, `host_cpu_core`, `host_disk_io`, `host_net_iface`, `pg_health`) joined the fixed `PRUNE_TABLES` plain-21-day allow-list; `service_log_events` keeps its tiered prune; `log_patterns` is never pruned. `main()` gathers the deep facts, locates a postgres inventory row's artifact_path for the PG-log tail, and the tick log line now reports cores/disks/ifaces/pg_health.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pytest not installed locally (verify command uses `python3 -m pytest`)**
- **Found during:** Task 1 verification (same environment condition documented in 15-06)
- **Issue:** No pytest module on this machine; plan 15-06 established stdlib unittest as the runner
- **Fix:** New tests authored as stdlib `unittest.TestCase` classes (pytest-collectable `def test_` methods); verified via `python3 -m unittest test_extract` — 27/27 green. No package install attempted (package-install exclusion respected).
- **Files modified:** scripts/fileserver/test_extract.py
- **Commit:** 79ab17a

**2. [Clarification, no code deviation] Plan's "steal=idx8, iowait=idx4" mixes index bases**
- **Found during:** Task 1 (`/proc/stat` per-core parse)
- **Issue:** The kernel field order is `user nice system idle iowait irq softirq steal guest` — steal is full-line index 8 but value-list index 7; iowait is value-list index 4 but full-line index 5. The plan quoted one of each.
- **Fix:** Parser uses the authoritative kernel field order; the fixture test asserts steal values land where the full-line index 8 column puts them (satisfying the acceptance criterion) and iowait at value index 4.
- **Files modified:** scripts/fileserver/collect_telemetry.py, scripts/fileserver/test_extract.py
- **Commit:** 79ab17a

## Verification

- `python3 -m py_compile collect_telemetry.py` — clean.
- `python3 -m unittest test_extract` — 27/27 green (17 prior + 10 new): 4-core fixture → 4 core dicts with steal asserted per-core (10/11/12/13); diskstats fixture skips loop0/ram0/dm-0 and asserts fld4/6/8/10/12/13 values on sda; /proc/net/snmp fixture extracts RetransSegs=4242 (+ 4 more Tcp counters); /proc/net/dev skips `lo` and asserts errs/drop/colls columns; file-nr, ss -s, vmstat oom_kill, df -i, chronyc sign handling; `gather_clock_offset` returns None (no crash) with run_argv forced to rc=1.
- Grep gates: `shell=True` absent; `f"INSERT` / `.format(` absent (T-15-01/T-15-06); `probe_pg_health`, `_insert_pg_health`, `PG_PROBE_CONNINFO` present.
- Source assertions: `_insert_host_metrics_ext`/`_insert_children`/`_insert_pg_health` called inside `write_tick` after both `SET LOCAL` lines; PRUNE_TABLES contains exactly the 5 new facts and excludes `log_patterns` + `service_log_events`; `_insert_pg_health` column list has no `variant`/`severity`/`band` (D-14).
- Live gather+insert (incl. A1 least-privilege confirmation on `PG_PROBE_CONNINFO`) is proven on the canary in Plan 09 (migration 0003 apply is operator-gated per 15-01).

## Threat Flags

None — all new surface is inside the plan's threat model: T-15-06 (argv-only, grep-gated), T-15-01 (%s binding, grep-gated), T-15-02 (inserts inside the SET LOCAL txn), T-15-09 (PG_PROBE_CONNINFO restricted to pg_stat_* SELECTs; A1 confirmation deferred to the Plan 09 canary as planned).

## Known Stubs

None introduced by this plan.

## Self-Check: PASSED

- FOUND: scripts/fileserver/collect_telemetry.py (contains "probe_pg_health")
- FOUND: scripts/fileserver/test_extract.py (contains "TestDeepVmParsers")
- FOUND commits: 79ab17a, a0425f2
