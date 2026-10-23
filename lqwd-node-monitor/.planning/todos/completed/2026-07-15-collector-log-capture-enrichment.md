---
created: 2026-07-15T21:41:58.152Z
title: Collector log-capture enrichment (Phase 15 follow-up)
area: tooling
scope: phase-sized (recommend its own planned phase)
files:
  - scripts/fileserver/collect_telemetry.py
  - db/seed-log-patterns.sql
  - db/seed-dimensions.sql
  - scripts/fileserver/deploy-env.sh
  - src/lib/read/service-log-events.ts
---

## Problem

Discovered during the Phase 15 canary on `lnd-ireland` (2026-07-15). The collector
CODE is proven end-to-end (rows land in all 8 new tables, RLS isolation holds,
redaction works, CR-02 validated live, all services health-checked, real
too-many-clients signal captured in `pg_health`). But live testing exposed that the
log-capture behavior and its seed config are too narrow to be operationally useful.
This is behavior/config enrichment, not a code bug — it belongs in its own reviewed
phase.

## Solution

Eleven items (roughly in priority order):

1. **Incremental offset-checkpoint log scan** — replace the fixed
   `LOG_TAIL_BYTES=65536` (64KB) tail with a per-log cursor (byte offset + inode +
   size) persisted in a LOCAL node state file (e.g. `/lnd/nodemon/.log-cursors.json`)
   so the collector stays SELECT-only on the warehouse (no new DB grants). Read
   `last_offset → EOF` each tick so EVERY `[ERR]` in the interval is captured (feeds
   the existing signature-dedup → `KEEP_N` exemplars → `log_patterns.count_window`
   aggregate). Bound max bytes/tick (~5–10MB) with a LOGGED truncation, never a
   silent cap. Rationale: LND at debug is ~500 lines/min; 64KB ≈ 15s of log, so
   errors early in a 5-min interval scroll past and are missed.

2. **Dual rotation handling** in that scanner:
   - LND: stable current name `lnd.log`, archives renamed to numbered files. Detect
     inode-change / size-shrink → optionally drain the newest archive
     (`lnd.log.<N>`) from `last_offset`, then reset to the new file from 0.
   - Postgres: timestamped `postgresql-YYYY-MM-DD.log` → needs glob/newest-match
     `artifact_path` resolution in `_tail_text`/`_artifact_mtime`.

3. **Capture-by-pattern, not just `error_pattern`** — `extract_events` gates on a
   single `error_pattern` substring (e.g. `[ERR]`), so `[WRN]`/`[CRT]` lines and the
   seeded benign/critical patterns are never captured. Capture any line matching a
   `log_patterns_config` pattern regardless of the single `error_pattern` gate.

4. **Tail logs for native-probed services** — postgres/bitcoind use
   `detection_method='native'` (systemctl/pg_isready), so `grade_log_service` (log
   tailing) is skipped and their logs aren't tailed even with `artifact_path` set.
   Decouple log-tailing from `detection_method`. (Confirmed on canary: 8639 FATALs in
   the local PG log, 0 captured, because postgres is native-probed.)

5. **Re-derive `log_patterns_config` from REAL logs (HIGH VALUE)** — the seed was
   written from Obsidian notes and does NOT match actual LND errors. Real HSWC errors
   are `resuming link failed` / `failing link: unable to synchronize channel states:
   … broken pipe`, NOT the seeded `\[ERR\] HSWC.*Unhandled error`. Categorize from
   observed data: `CMGR Unknown connid=N` = suppress noise; `CMGR Can't accept
   connection … i/o timeout` = suppress; `HSWC broken-pipe/failing-link` = benign
   reconnection churn (esp. post-restart bursts); `SWPR/UTXN Failed to sweep` =
   attention; `PEER` = mostly benign. Add LND's actual "too many clients" phrasing →
   `ap12`.

6. **Signature normalization** — add IP:port stripping (e.g.
   `172.31.11.142:9735->x.x.x.x:port`) so broken-pipe-to-different-peers collapses to
   one signature instead of fragmenting.

7. **Owner-side log-path discovery + declarative service→path convention** — a
   maintenance script that UPSERTs `service_inventory` as the OWNER (collector stays
   SELECT-only), auto-populating per-node paths incl. rotation globs.

8. **`LNCLI_BIN` absolute-path fix** — the lncli wrapper
   (`/lnd/bashScripts/lncli-telemetry.sh`) calls bare `lncli` (PATH-dependent); under
   root/cron's thin PATH it fails → `pubkey=none` → CR-02 skips node-scoped rows.
   Hardcode the absolute lncli path / set `LNCLI_BIN` before provisioning so it's
   env-independent. (Observed live: `pubkey=none` blips on `lnd-ireland`.)

9. **Tunables** — `LOG_TAIL_BYTES` becomes obsolete after the incremental scan;
   review `KEEP_N` exemplar cap.

10. **Minor cleanups** — esplora shows a stale DOWN `service_health` row from
    2026-06-29 though `is_expected=false` on per-node hosts (should read clean
    no-data). Document the bitcoind/lnd inventory paths added on the canary:
    `bitcoind=/bitcoin/debug.log`, `lnd=/lnd/logs/bitcoin/mainnet/lnd.log`, both
    `node_pubkey=NULL` host-level.

11. **Deploy-isolation note** — publishing `collect_telemetry.py` to the SHARED
    fileserver `~/nodemon/` auto-distributes to the whole fleet on each node's next
    `*/5` self-update, so the "canary-only" D-09 isolation is NOT achievable via the
    shared rail. An accidental fleet splice occurred 2026-07-15 and landed safely
    (reviewed collector, FORCE RLS held across 16 host_ids, no cross-host leakage). If
    true canary isolation is ever needed, deploy by direct `scp` to one node's
    `/lnd/nodemon/` and bypass the fileserver, or gate the self-update.
