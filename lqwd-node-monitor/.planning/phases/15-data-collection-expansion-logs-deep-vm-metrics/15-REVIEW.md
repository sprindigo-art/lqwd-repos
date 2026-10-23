---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - scripts/fileserver/collect_telemetry.py
  - src/lib/db/schema/nodemon.ts
  - drizzle/nodemon/0003_moaning_randall.sql
  - db/role-grants.sql
  - db/seed-log-patterns.sql
  - src/lib/read/telemetry-bands.ts
  - src/lib/read/counter-delta.ts
  - src/lib/read/service-log-events.ts
  - src/lib/read/host-metrics-ext.ts
  - src/lib/read/pg-health.ts
  - src/lib/insight/detectors/ap12-advisory.ts
  - src/lib/insight/engine.ts
  - src/components/node/VmVitals.tsx
  - src/app/(overview)/[pubkey]/page.tsx
  - src/app/(overview)/[pubkey]/service/[service]/page.tsx
findings:
  critical: 2
  warning: 4
  info: 3
  total: 9
status: resolved
resolution:
  resolved_at: 2026-07-14
  commits:
    - e2e7e4f  # CR-01, CR-02
    - 892a933  # WR-01, WR-02, WR-03, IN-01, IN-02, IN-03 (WR-04 absorbed by CR-02)
  note: All 9 findings addressed; WR-04 was resolved by the CR-02 _rls_admissible_node_rows filter.
---

# Phase 15: Code Review Report

> **Resolution (2026-07-14):** All 9 findings resolved — CR-01/CR-02 in commit
> `e2e7e4f`; the 4 warnings + 3 info in commit `892a933` (WR-04 absorbed by the
> CR-02 fix). Suites green: 27 Python + Phase-15 vitest passing.

**Reviewed:** 2026-07-14
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 15 expands the telemetry collector (logs + deep-VM metrics), adds eight
Drizzle read-model tables plus RLS grants, and un-stubs the log stream / deep-VM
charts. The stated security invariants largely hold and are well-engineered:

- **argv-only subprocess** — confirmed, no `shell=True` anywhere.
- **parameter-bound SQL** — confirmed; the only string-built query
  (`_prune_tiered`) concatenates a fixed allow-list constant, never user input.
- **secret redaction** — `_redact` scrubs `key=value` secrets plus long hex/base64
  blobs before persistence; applied to both `message` and `context_lines` before
  truncation. Robust.
- **read-time bands only** — no severity/band/stale column exists in any new fact
  table (schema + migration confirmed).
- **DISTINCT ON latest reads** — every latest-per-entity read uses `SELECT DISTINCT
  ON`; priors use `ROW_NUMBER … rn=2` / `OFFSET 1`, never `= MAX(...)`.
- **RLS grants** — `UPDATE` is granted only on `log_patterns`; raw fact tables get
  SELECT/INSERT/DELETE only, with an explicit misconfiguration probe.
- **UI path safety** — raw URL segments pass `PUBKEY_RE`/`SERVICE_SLUG_RE` and
  hostId/canonicalService resolution before any read; reads are parameter-bound.

However, two correctness defects break Phase 15's core classification/suppression
feature and risk whole-tick telemetry loss, plus four quality issues.

## Critical Issues

### CR-01: Seed `match_expression` values use regex metacharacters, but the collector matches by plain substring — benign suppression silently fails

**File:** `scripts/fileserver/collect_telemetry.py:650` and `db/seed-log-patterns.sql:35-74`

`_classify` matches a pattern with a plain substring test:

```python
expr = row.get("match_expression")
if not expr or expr not in line:   # substring membership, NOT regex
    continue
```

But several seeded `match_expression` values contain regex metacharacters that
will never appear literally in a real log line:

- `'Flushing large.*UTXO set to disk'` (BP-002, suppress=true)
- `'[ERR] HSWC.*Unhandled error'` (BP-004 paired, suppress=true)
- `'[WRN] HSWC.*insufficient bandwidth'` (BP-004, suppress=true)
- `'could not serialize|SQLSTATE 40001'` (BP-005)
- `'40P01|deadlock detected'` (critical)
- `'[ERR] GRDB: UpdateEdgePolicy failed.*SQLSTATE 40001'` (AP-12b)

Because the literal `.*` / `|` is never in the log text, `_classify` falls through
to `("other", None)`. The event is stored with `config_id = NULL`, so at read time
the `LEFT JOIN log_patterns_config` finds no row, `COALESCE(c.suppress, false) =
false`, and the line **survives into the UI** — exactly the benign lines that were
meant to be suppressed (e.g. the `[ERR] HSWC … Unhandled error` BP-004 pair). The
same lines are also mis-tagged `classification = "other"` instead of `benign`/`ap12`.

That the author already split `PG_SIG_SERIALIZATION = ("could not serialize",
"SQLSTATE 40001")` into two substrings in `_count_pg_log_signatures` confirms `|`
is not a supported operator — the seed rows are inconsistent with the matcher.

**Fix:** Pick one contract and make both sides obey it. Either (a) compile
`match_expression` with `re.search` in `_classify` (and document that config values
are regexes), or (b) rewrite the seed to plain substrings and split alternations
into multiple rows:
```sql
-- instead of 'could not serialize|SQLSTATE 40001'
('could not serialize', 'postgres', 'warn', 'benign', false, 'BP-005 …'),
('SQLSTATE 40001',      'postgres', 'warn', 'benign', false, 'BP-005 …'),
-- instead of '[ERR] HSWC.*Unhandled error'  → drop the .*:
('[ERR] HSWC', 'lnd', 'error', 'benign', true, 'BP-004 paired …'),
```
Option (a) is cleaner given the notes clearly intend regex semantics.

### CR-02: A failed/absent `lncli getinfo` (empty `app.node_pubkey`) makes RLS `WITH CHECK` abort the entire tick — total telemetry loss

**File:** `scripts/fileserver/collect_telemetry.py:1352-1362, 86-95` and `db/role-grants.sql:243-291`

`write_tick` wraps every INSERT in a single transaction (`with conn:`). Node-scoped
rows (`service_health`, `service_log_events`) carry `node_pubkey`, and their RLS
policy enforces:

```sql
WITH CHECK (host_id = current_setting('app.host_id', true)
  AND (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true)))
```

`resolve_node_pubkey()` returns `None` whenever `lncli getinfo` fails (rc≠0, empty
output, or JSON parse error). `write_tick` then runs `SET LOCAL app.node_pubkey =
''`. Any service row whose inventory `node_pubkey` is non-NULL now fails the
`WITH CHECK` (it equals neither NULL nor `''`), which **raises inside the
transaction and rolls back the whole tick** — including the host_metrics /
host_metrics_ext / cpu-core / disk / net / pg_health vitals that had nothing to do
with the node. A transient `lncli` blip therefore silently drops the entire host's
telemetry for that interval.

The same abort occurs on a multi-node host (schema comment: "a host runs 2+ nodes"):
`fetch_inventory` returns every service for the `host_id`, so a service scoped to a
*different* node's pubkey than the collector's own `lncli` identity will fail
`WITH CHECK` and nuke the tick.

**Fix:** Do not let one policy-rejected row destroy the whole tick. Options:
- Skip/omit node-scoped rows whose `node_pubkey` does not match the resolved
  identity (log a warning), keeping host-level vitals intact; or
- Insert node-scoped rows in a nested savepoint (`with conn.cursor(); SAVEPOINT`)
  so a `WITH CHECK` failure rolls back only that row; or
- Fail-fast the whole tick early when `node_pubkey is None` *before* gathering, so
  host vitals are not silently lost mid-transaction.

## Warnings

### WR-01: Overlapping substring patterns + unordered config SELECT → nondeterministic classification

**File:** `scripts/fileserver/collect_telemetry.py:642-660, 852-864`

`fetch_log_patterns_config` runs `SELECT … FROM log_patterns_config` with **no
`ORDER BY`**, and `_classify` returns the *first* row whose `match_expression` is a
substring of the line. Several seeded patterns are substrings of each other — e.g.
`'FATAL'` (critical) vs `'FATAL: sorry, too many clients already'` (ap12), and
`'[CRT]'` vs other `[…]` tags. A `FATAL: sorry, too many clients already` line can
be classified either `ap12` or `critical` depending on the (nondeterministic) row
order returned by Postgres, so the same line grades differently across ticks.

**Fix:** Impose a deterministic priority. Add `ORDER BY length(match_expression)
DESC, id` to the fetch (longest/most-specific pattern wins), or add an explicit
`priority` column, and document the "most specific match wins" rule.

### WR-02: `db/seed-log-patterns.sql` verification comment says "exactly 5 suppress=true" but seeds 6

**File:** `db/seed-log-patterns.sql:78-79` (vs rows at `:38-54`)

The operator acceptance comment states: `-- Expect 15 rows; exactly 5 suppress=true
(BP-001/002/003/004-pair/006)`. The INSERT actually sets `suppress=true` on **six**
rows: BP-001, BP-002, BP-003, BP-004, BP-004-paired, and BP-006. An operator
running the verification `SELECT` will see 6 and believe the seed is wrong (or
approve a mismatched acceptance gate).

**Fix:** Update the comment to "exactly 6 suppress=true (BP-001/002/003/004 +
BP-004-pair/006)" — or, if 5 was intended, reconcile which BP-004 row should not be
suppressed.

### WR-03: AP-12b trigger threshold (`>= 10`) is inconsistent with the `pg_40001_rate_multiple` band boundary (`> 10`)

**File:** `src/lib/read/pg-health.ts:245` and `src/lib/read/telemetry-bands.ts:129-134`

`derivePgHealthVerdict` sets `ap12Variant = "ap12b"` when `rateMultipleValue >= 10`.
But the band is `{ healthy: 10, warn: 10, direction: "higher-worse" }`, and
`evaluateBand` grades `value <= healthy` as **healthy** — so exactly `10×` bands
`healthy`, and only `> 10×` bands `critical`. At exactly `10.0×` the detector fires
an AP-12b card whose derived band is `healthy`, so `buildAp12Card`
(`ap12-advisory.ts:125`) emits it at **`info`** severity — a "hard page" event
rendered as informational. The band note itself says "≥10× promotes straight to
critical", contradicting the `> 10` boundary.

**Fix:** Align the two. Either make the band boundary exclusive for the promotion
(`healthy: 9.999…` / a dedicated `>=` comparator) or change the trigger to
`rateMultipleValue > 10` so the card only fires when the band is actually critical.

### WR-04: Node-scoped RLS abort also blocks legitimate multi-node hosts (related to CR-02, worth an independent guard)

**File:** `scripts/fileserver/collect_telemetry.py:826-839, 1214-1263`

`fetch_inventory` returns *all* services for a `host_id`, but the collector binds a
single `app.node_pubkey` from one `lncli`. On a genuine 2-node host, every
`service_health` / `service_log_events` row for the *other* node aborts the tick
(same `WITH CHECK` mechanism as CR-02). Even if CR-02's `lncli`-null path is fixed,
this multi-node case remains.

**Fix:** Either filter inventory to the collector's own `node_pubkey` for
node-scoped detection methods, run one collector per node with a node-scoped
inventory view, or use per-row savepoints so a foreign-node row skips rather than
aborting the batch.

## Info

### IN-01: `pg_health` connection counts include the probe's own connection

**File:** `scripts/fileserver/collect_telemetry.py:987-1009`

`active_connections` (`count(*) FROM pg_stat_activity WHERE datname = …`) counts the
collector's own probe session, so read-time `pg_conn_saturation = active/max` is
inflated by ≥1. Near the 0.8 floor this can nudge a healthy node into the AP-12a
`saturationHigh` branch. Consider `AND pid <> pg_backend_pid()`.

### IN-02: `_parse_diskstats` filters out `dm-*` devices, hiding LVM/LUKS-backed disk I/O

**File:** `scripts/fileserver/collect_telemetry.py:400-411`

`re.match(r"^(loop|ram|dm-)", device)` drops device-mapper devices. On hosts whose
root/data volume is LVM or LUKS (dm-backed), per-device disk I/O is never captured
and the deep-VM Disk-I/O chart reads empty. If dm- volumes are in scope, match only
`loop`/`ram` (and optionally underlying physical devices) instead.

### IN-03: `buildDeepVitals` CPU-cores `series` is spatial (per-core), not the temporal series the chart contract expects

**File:** `src/app/(overview)/[pubkey]/page.tsx:217-241`

`VmVitalChart.series` is documented "oldest → newest" (a time series), but the
per-core chart passes `busySeries` = one point *per core* (spatial). The
`EvidenceChart` renders it, but the x-axis semantics are misleading (it looks like
time). Cosmetic; consider a distinct chart shape or a clarifying label.

---

_Reviewed: 2026-07-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
