---
phase: 16-collector-enrichment-robust-log-capture
reviewed: 2026-07-16T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - db/seed-dimensions.sql
  - db/seed-log-patterns.sql
  - scripts/fileserver/CANARY-RUNBOOK.md
  - scripts/fileserver/collect_telemetry.py
  - scripts/fileserver/deploy-env.sh
  - scripts/fileserver/nodemonDownload.sh
  - scripts/fileserver/path-reconciler.sql
  - scripts/fileserver/run_collect-telemetry.sh
  - scripts/fileserver/test_extract.py
  - src/lib/db/schema/nodemon.ts
  - src/lib/insight/detectors/ap12-advisory.test.ts
  - src/lib/read/service-log-events.test.ts
  - src/lib/read/service-log-events.ts
findings:
  critical: 2
  warning: 5
  info: 2
  total: 9
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-07-16
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 16 hardens the node-side telemetry collector (absolute `LNCLI_BIN`, version
marker, cursor-based log tailing, tier-gated capture, IP:port normalization) and
introduces the D-08 channel-pin self-update gate to end the 2026-07-15 accidental
fleet-splice class.

The SELECT-only warehouse boundary is respected (all writes target the `nodemon`
queue/telemetry DB via parameter-bound psycopg2 inserts; seed/reconciler SQL is
clearly owner-scoped). The `run_collect-telemetry.sh` D-08 gate correctly
fail-safes to SKIP self-update on an unresolved channel — the specific invariant
called out for scrutiny holds *in that file*.

However, two BLOCKERs undercut the phase's core goals: (1) the path-reconciler
registers daemon-log rows without `is_expected`/`detection_method`, so
`fetch_inventory`'s expected-set filter silently drops them and the **lnd daemon
log is never tailed** (and no daemon logs are captured on any non-seeded fleet
host); (2) `nodemonDownload.sh` still blanket-pulls `scp -r ${REMOTE_DIR}/*`,
which re-opens the exact top-level-publish → fleet-splice path D-08 claims to
close. Five warnings and two info items follow.

## Critical Issues

### CR-01: Reconciler-registered daemon rows are dropped by the expected-set filter — lnd logs never tailed

**File:** `scripts/fileserver/path-reconciler.sql:69-79`, `scripts/fileserver/collect_telemetry.py:1107-1120`

**Issue:** The reconciler auto-registers the `lnd` / `bitcoind` / `postgres`
daemon-log rows by inserting only three columns:

```sql
INSERT INTO service_inventory (host_id, service_name, artifact_path)
SELECT h.host_id, conv.service_name, conv.artifact_path
FROM hosts h CROSS JOIN (VALUES ('lnd', ...), ('bitcoind', ...), ('postgres', ...)) ...
ON CONFLICT (host_id, service_name) DO UPDATE SET artifact_path = EXCLUDED.artifact_path;
```

`service_inventory.is_expected` has no DB default (`src/lib/db/schema/nodemon.ts:147`
declares `boolean("is_expected")` with no `.default()`), so a freshly-inserted
row gets `is_expected = NULL` and `detection_method = NULL`. But
`fetch_inventory` grades ONLY the expected set:

```python
return [inv for inv in inventory if inv.get("is_expected")]   # NULL -> None -> falsy -> dropped
```

Consequences:
- On the **canary**, no `lnd` row is hand-seeded (`db/seed-dimensions.sql:54-55`
  explicitly defers it to the reconciler), so the reconciler's `lnd` row is the
  only one — and it is `is_expected = NULL`. It is filtered out before the tail
  loop, so **`/lnd/logs/bitcoin/mainnet/lnd.log` is never tailed** and `[CRT]`
  LND lines (the highest-value critical signature) are never captured. This
  directly contradicts CANARY-RUNBOOK P16-4 ("daemon-log lines are now
  captured").
- On **every non-canary fleet host** (deferred D-09 rollout), the reconciler
  creates all three daemon rows with `is_expected = NULL`, so bitcoind/postgres/lnd
  are all invisible to the collector — zero daemon-log capture fleet-wide.
- Even if the row survived the filter, `detection_method = NULL` means the native
  fan-out tail at line 1765 (`inv.get("detection_method") == "native"`) would not
  fire for it.

**Fix:** Have the reconciler set the columns the collector requires when it
creates a daemon row, without clobbering canary-tuned values on conflict:

```sql
INSERT INTO service_inventory
  (host_id, service_name, artifact_path, detection_method, is_expected, expected_interval_seconds)
SELECT h.host_id, conv.service_name, conv.artifact_path, 'native', true, 300
FROM hosts h CROSS JOIN ( ... ) AS conv(service_name, artifact_path)
ON CONFLICT (host_id, service_name)
DO UPDATE SET
  artifact_path = EXCLUDED.artifact_path,
  detection_method = COALESCE(service_inventory.detection_method, EXCLUDED.detection_method),
  is_expected = COALESCE(service_inventory.is_expected, EXCLUDED.is_expected);
```

(Verify the `lnd` daemon-log path should be tailed as a `native`/decoupled source
and set the intended `detection_method` accordingly.)

### CR-02: `nodemonDownload.sh` blanket `scp -r` re-opens the fleet-splice path D-08 is supposed to close

**File:** `scripts/fileserver/nodemonDownload.sh:45`

**Issue:** The Phase-16 gate's stated purpose is to replace "publish to
`~/nodemon/` and every node pulls it" with a per-node channel pin. But this
downloader — run on the ~30-minute fleet cron — still does exactly that:

```bash
yes | sudo scp -r -o StrictHostKeyChecking=no -P ${REMOTE_PORT} -i ${LND_DIR}/id_rsa \
  ${REMOTE_USER}@${REMOTE_SERVER}:${REMOTE_DIR}/* ${LOCAL_DIR}/
```

`${REMOTE_DIR}/*` includes the top-level `~/nodemon/collect_telemetry.py`, copied
straight to `/lnd/nodemon/collect_telemetry.py` — which is exactly `MAIN_SCRIPT`
in `run_collect-telemetry.sh:31`. The D-08 gate in the wrapper only scopes the
*md5 self-update* to `releases/<version>/`; it never reverts a file the blanket
downloader overwrote. The documented workflow **guarantees** a new build sits at
top-level: CANARY-RUNBOOK T4a scp's `collect_telemetry.py` to `~/nodemon/`, and
P16-3 does `cp ~/nodemon/collect_telemetry.py ~/nodemon/releases/<VERSION>/`
(reading from top-level). So any new build lands at top-level and
`nodemonDownload.sh` splices it to every node within one cron cycle, regardless
of channel pin — defeating PASS criterion #6 ("the blanket `scp -r`
accidental-splice path is closed").

**Fix:** Stop pulling `collect_telemetry.py` / `requirements.txt` via the blanket
downloader; exclude the collector payload (and the `releases/`/`channels/` tree)
from the `scp -r`, leaving the wrapper's gated md5 self-update as the ONLY path
that lands a collector version. E.g. pull the executor scripts explicitly rather
than `${REMOTE_DIR}/*`, or `--exclude` the payload, and never store the live
build at top-level `~/nodemon/`.

## Warnings

### WR-01: A single log line larger than `MAX_BYTES_PER_TICK` stalls the cursor forever (livelock)

**File:** `scripts/fileserver/collect_telemetry.py:690-710`

**Issue:** When `pending > MAX_BYTES_PER_TICK`, the read is capped and the offset
advances only to the last newline inside the capped window:

```python
raw = fh.read(min(pending, MAX_BYTES_PER_TICK))
last_nl = raw.rfind(b"\n")
new_offset = start + (last_nl + 1 if last_nl >= 0 else 0)
```

If the first 8 MB from `start` contains **no** newline (a single line ≥ 8 MB —
e.g. a giant stack dump / base64 blob), `last_nl == -1`, `complete == b""`, and
`new_offset == start`. The cursor never advances, nothing is emitted, and every
subsequent tick re-reads the same 8 MB and defers again — a permanent livelock
that also blocks all later lines in that file.

**Fix:** When the capped window yields no newline, force progress: advance the
offset by the cap (dropping/oversized-truncating the pathological line) and log
it, e.g.

```python
if last_nl < 0 and pending > MAX_BYTES_PER_TICK:
    log(f"OVERSIZE single line > {MAX_BYTES_PER_TICK} at {path}; advancing past it")
    new_offset = start + len(raw)
```

### WR-02: `seed-dimensions.sql` verification counts contradict the seeded data (esplora) — the P16/T1c gate check fails

**File:** `db/seed-dimensions.sql:14-18, 106, 108-110`

**Issue:** The header scope says "the infra trio + SVC-01 six = **9 services, all
`is_expected = true`**" and the verification query comment says "Should list 10
rows: **9 with `is_expected = t` and exactly ONE (`rebalance`) = f**." But
`esplora` is seeded `is_expected = false` (line 72-73, intentionally, "runs
centrally"). The actual data is **8 true / 2 false** (esplora + rebalance). The
operator gate (CANARY-RUNBOOK T1c) asserts "9 `is_expected = t` + exactly one
`rebalance` = f" — that assertion will FAIL against this seed, and a reviewer
following the gate would treat a correct seed as broken (or "fix" it wrongly).

**Fix:** Reconcile the comments/gate with the data. Either state "8 expected
(bitcoind/postgres + SVC-01 six), 2 not-expected (esplora, rebalance)" in the
header, the verification comment, and CANARY-RUNBOOK T1c, or seed esplora
`is_expected = true` if central-esplora nodes are genuinely expected to grade it.

### WR-03: All captured log events are hardcoded `level = "error"`, so warn/critical lines render identically in the stream

**File:** `scripts/fileserver/collect_telemetry.py:1042-1050, 1770-1774`

**Issue:** `extract_events` is always called with the literal `"error"` level:

```python
log_events, log_aggregates = extract_events(text, error, inv.get("service_name"), "error", config, ...)
```

Every `service_log_events.message` is stored with `level = "error"` regardless of
its `classification` (info/warn/critical). Since info-tier lines are suppressed
(zero exemplars), stored rows are warn/critical — but `mapServiceLogEventRow`
(`src/lib/read/service-log-events.ts:98-105, 119-127`) narrows off `row.level`,
so a warn line (e.g. `closechannel`, `HSWC failing link`) shows as a red "error"
chip. The `narrowLevel` tests exercise warn/info paths that the collector can
never actually produce.

**Fix:** Derive the stored `level` from the matched row's `classification`
(map info→info, warn→warn, critical→error) instead of passing a constant, so the
UI chip reflects severity.

### WR-04: `deploy-env.sh` passes the probe-role password on the psql command line (visible via `ps`)

**File:** `scripts/fileserver/deploy-env.sh:101`

**Issue:**

```bash
sudo -u postgres psql -c "CREATE ROLE nodemon_probe WITH LOGIN PASSWORD '${PG_PROBE_PW}';" ...
```

The plaintext `PG_PROBE_PW` is embedded in a process argument, so any local user
running `ps aux`/`ps -ef` during execution can read the fleet-wide probe
password. A single-quote in `PG_PROBE_PW` also breaks the statement / allows SQL
breakage. (The env-file write at lines 119-133 is fine — 0600 root.)

**Fix:** Feed the password via stdin/`\password` or a `psql -v` variable with
`\gset`, or via `PGPASSWORD`/a here-doc, rather than interpolating into `-c`.
Escape/validate the secret before use.

### WR-05: Retention config still references the retired taxonomy; critical exemplars are never pruned

**File:** `scripts/fileserver/collect_telemetry.py:1589-1600`

**Issue:** After the 16-04 reseed, classifications are `{info, warn, critical}`
(plus `other` for unmatched). But `LOG_RETENTION_WINDOWS` and
`LOG_MIDDLE_EVICT_CLASSES` still key on `benign` / `ap11` (dead — no rows carry
them) and the comment claims `ap12` is exempt (also dead). Net effect: `warn` and
`other` prune at 90 days, but `critical` is absent from the map and therefore
**never time-pruned** — critical exemplars (≤10/signature/tick) accumulate
indefinitely, and `benign` middle-eviction is now a no-op. This is a
correctness/maintenance hazard, not just style: the retention policy no longer
matches the taxonomy it's meant to govern.

**Fix:** Rewrite the windows against the live taxonomy (`info` never stored,
`warn`/`other` windowed, `critical` given an explicit long-but-bounded window or
an intentional documented "keep forever"), and drop the dead `benign`/`ap11`/`ap12`
references.

## Info

### IN-01: `test_extract.py` fixtures assert the retired `benign`/`ap12` classification strings

**File:** `scripts/fileserver/test_extract.py:28-43, 161-168`

**Issue:** `BENIGN_CONFIG_ROW`/`AP12_CONFIG_ROW` and the assertions
(`classification == "benign"` / `"ap12"`) use the pre-16-04 taxonomy the phase
explicitly retired. The tests still pass (they only check `_classify` echoes the
row's string), but they no longer reflect the shipped `{info,warn,critical}`
vocabulary and could mislead future readers.

**Fix:** Update fixtures/assertions to `info`/`warn`/`critical` to match the
reseeded config.

### IN-02: `read_since` can `KeyError` on a malformed cursor entry

**File:** `scripts/fileserver/collect_telemetry.py:672-674`

**Issue:** The rotation branches read `prev["offset"]` via direct subscript while
guarding other fields with `.get(...)`. `load_cursors` only validates that the
top-level JSON is a dict; a truncated/hand-edited `.log-cursors.json` entry
missing `offset` would raise `KeyError` and abort the tick for that source.

**Fix:** Use `prev.get("offset", 0)` consistently (as `_drain_previous` already
does at line 728), or validate entry shape in `load_cursors`.

---

_Reviewed: 2026-07-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
