---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
verified: 2026-07-15T21:52:00Z
status: passed
score: 3/3 must-haves verified (code + live canary); operator UAT passed 2026-07-15
overrides_applied: 0
human_verification:
  - test: "Apply migration 0003 + Phase-15 role-grants delta + seed-log-patterns.sql (in that order) to the live canary nodemon DB as owner, then run one */5 collect_telemetry tick"
    expected: "All 8 new tables receive >=1 canary row; no SQLSTATE 42501 (grant/RLS misconfig); no cross-host row leakage (T-15-02); secret redaction held on message/context_lines (T-15-05)"
    result: "PASSED 2026-07-15 (canary lnd-ireland, nodemon DB on postgres-alby). All 8 tables populated by one tick, exit 0, no 42501; FORCE RLS isolation confirmed (owner sees 0 without app.host_id; no cross-host leakage); redaction held; CR-02 validated live via a real pubkey=none blip preserving host vitals. See 15-HUMAN-UAT.md Test 1 for full evidence."
  - test: "Open a node page (/{pubkey}) and a service page (/{pubkey}/service/{service}) against a DB that has real log rows + deep-VM samples"
    expected: "NodeLogsStream / ServiceLogTail render real newest-first rows with benign patterns suppressed and no secret leakage; the three deep-VM VmVitals charts (per-core CPU busy, disk-I/O delta, net errors+drops delta) render real data or an honest StaleChart 'NO FRESH DATA' — never faked freshness"
    result: "PASSED 2026-07-15 — operator performed the visual check; dashboard renders correctly. See 15-HUMAN-UAT.md Test 2."
followup: ".planning/todos/pending/2026-07-15-collector-log-capture-enrichment.md — log-capture breadth enrichment (incremental scan, real-log classification patterns, native-service tailing). Out of scope for this phase; collector code proven."
---

# Phase 15: Data-Collection Expansion (Logs, Deep-VM Metrics) Verification Report

**Phase Goal:** Fill the data-collection gap the AI layer depends on — expand the */5 collector to persist service log/error events + deeper Ubuntu/VM metrics into new nodemon tables, add read-layer functions, and un-stub the log UI (NodeLogsStream/ServiceLogTail).
**Verified:** 2026-07-15T21:52:00Z
**Status:** passed (code + live canary + operator UAT)
**Re-verification:** Yes — canary proof completed 2026-07-15 (both human-verification tests passed; initial code-level verification was 2026-07-14 post CR-01/CR-02 fix at commit e2e7e4f)

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | **COL-01** — Log/error events (level, message, service, host, node, ts, signature) persisted into a bounded, retention-capped nodemon table at */5; NodeLogsStream/ServiceLogTail render real data; benign patterns suppressed. | ✓ VERIFIED (code); live proof → human | `service_log_events` table in schema ([nodemon.ts L280](src/lib/db/schema/nodemon.ts#L280)) + migration ([0003 L122](drizzle/nodemon/0003_moaning_randall.sql#L122)); `_prune_tiered` enforces 21-day + tiered-classification windows + keep-N exemplar eviction ([collect_telemetry.py](scripts/fileserver/collect_telemetry.py)); `write_tick` inserts events; reader `getServiceLogEvents` joins `config_id → log_patterns_config` for per-pattern suppression ([service-log-events.ts](src/lib/read/service-log-events.ts)); UI stubs replaced — `logs:[]`/`logRows:[]` gone, `NodeLogsStream logs={logs}` + `ServiceLogTail rows={logRows}` fed real reader output. CR-01 fixed: `_classify` uses `pattern.search(line)` regex; seed escapes `\[WRN\]/\[ERR\]/\[CRT\]`. |
| 2 | **COL-02** — PG AP-12 signatures (`FATAL: too many clients`, serialization 40001) + `pg_stat_*` counters ingested; AP-12 deterministic; `ap12-advisory` LLM fallback retired. | ✓ VERIFIED | `pg_health` table in schema ([nodemon.ts L478](src/lib/db/schema/nodemon.ts#L478)) + migration ([0003 L103](drizzle/nodemon/0003_moaning_randall.sql#L103)); collector counts PG-log signatures + `pg_stat_*` counters and inserts via `_insert_pg_health`; reader derives AP-12a/b + bands ([pg-health.ts](src/lib/read/pg-health.ts)); `ap12-advisory.ts` now `provenance: "deterministic"` with **zero AI-SDK import** (grep for `@ai-sdk\|generateText\|streamText\|getModel` returns empty), severity from read-time band. |
| 3 | **COL-03** — Deeper Ubuntu/VM metrics (per-core CPU + steal/iowait, disk I/O per device, net errors/drops/retransmits, memory detail + OOM, fd/limits, systemd failed units, clock skew, core count) collected RAW into nodemon and surfaced on host/VM detail. | ✓ VERIFIED (code); visual → human | 4 fact tables `host_metrics_ext`/`host_cpu_core`/`host_disk_io`/`host_net_iface` in schema + migration; collector `/proc` parsers (diskstats, net/dev, per-core CPU, tcp estab/timewait, clock offset) present; reader `host-metrics-ext.ts` uses `DISTINCT ON (host_id,<dim>)` child keying (no MAX-timestamp); `buildDeepVitals` appends 3 deep charts to VmVitals on the node page ([page.tsx L211/L438](src/app/(overview)/[pubkey]/page.tsx#L211)); `host_storage` gained additive nullable inode columns. |

**Score:** 3/3 truths verified at code level. End-to-end live-DB proof (all 8 tables populated by a real tick) is operator-gated and deferred.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| [src/lib/db/schema/nodemon.ts](src/lib/db/schema/nodemon.ts) | 8 new pgTable defs | ✓ VERIFIED | All 8 present (serviceLogEvents, logPatterns, logPatternsConfig, hostMetricsExt, hostCpuCore, hostDiskIo, hostNetIface, pgHealth). |
| [drizzle/nodemon/0003_moaning_randall.sql](drizzle/nodemon/0003_moaning_randall.sql) | additive CREATE TABLE ×8 + host_storage inode cols | ✓ VERIFIED | 8 CREATE TABLE + 3 `ADD COLUMN inodes_*`. Additive only. |
| [db/role-grants.sql](db/role-grants.sql) | least-priv grants + FORCE RLS for new tables | ✓ VERIFIED | Raw facts get SELECT/INSERT/DELETE; `UPDATE` granted only on `log_patterns` (L264); `log_patterns_config` SELECT-only (L268); all 8 ENABLE+FORCE RLS; compound `tel_own_log_events` policy for node_pubkey axis. |
| [db/seed-log-patterns.sql](db/seed-log-patterns.sql) | operator-run config seed, BP-001..008 + AP-11/12 | ✓ VERIFIED | 15 rows; bracket tags escaped for regex; per-row `config_id` suppression contract documented. |
| [scripts/fileserver/collect_telemetry.py](scripts/fileserver/collect_telemetry.py) | expanded collector (logs + deep VM + pg) | ✓ VERIFIED | `py_compile` clean; argv-only (no `shell=True`); `_redact` scrubs secrets; CR-01 regex `_classify`; CR-02 `_rls_admissible_node_rows` guards the tick. |
| [src/lib/read/service-log-events.ts](src/lib/read/service-log-events.ts), [host-metrics-ext.ts](src/lib/read/host-metrics-ext.ts), [pg-health.ts](src/lib/read/pg-health.ts) | read-layer functions, bound params, DISTINCT ON | ✓ VERIFIED | Parameter-bound Drizzle `sql`; DISTINCT-ON latest reads; read-time bands/suppression (no stored severity). |
| [src/lib/insight/detectors/ap12-advisory.ts](src/lib/insight/detectors/ap12-advisory.ts) | deterministic AP-12, LLM retired | ✓ VERIFIED | No AI import; deterministic provenance; consumes `pg_health` counters only, emits no runnable command. |
| Un-stubbed UI (node + service pages, VmVitals) | real reader data | ✓ VERIFIED | `logs:[]`/`logRows:[]` removed; components fed `getServiceLogEvents`/`getHostMetricsExt`; fail-soft `.catch(() => null)` honest-empty. |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| collector `_upsert_log_patterns` | `nodemon_telemetry` UPDATE grant on `log_patterns` | `GRANT SELECT, INSERT, UPDATE, DELETE ON log_patterns` (L264) | ✓ WIRED |
| `service_log_events.config_id` | `log_patterns_config.id` read-time suppress join | reader `LEFT JOIN` on config_id | ✓ WIRED |
| node/service pages | `getServiceLogEvents` / `getHostMetricsExt` | imports + `.catch(() => null)` calls | ✓ WIRED |
| `ap12-advisory` | `pg_health` reader (`getFleetPgHealth`) | deterministic verdict → card | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| NodeLogsStream / ServiceLogTail | `logs` / `logRows` | `getServiceLogEvents(hostId, service)` → `service_log_events` table | Yes (once collector tick lands) | ✓ FLOWING (source is real DB read; rows require live tick — see human check 1) |
| VmVitals deep charts | `buildDeepVitals(hostExt)` | `getHostMetricsExt(hostId)` → ext/child fact tables | Yes (honest StaleChart when absent) | ✓ FLOWING |
| AP-12 cards | `views` | `getFleetPgHealth()` → `pg_health` counters | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Python collector tests (signature/redaction/parse) | `python3 -m unittest discover` | Ran 27 tests — OK | ✓ PASS |
| Phase-15 read-layer + detector suites | `npx vitest run <6 suites>` | 6 files, 163 passed / 4 skipped | ✓ PASS |
| Collector compiles | `python3 -m py_compile collect_telemetry.py` | PY_COMPILE_OK | ✓ PASS |
| AP-12 LLM retired | grep `@ai-sdk\|generateText\|streamText\|getModel` in ap12-advisory.ts | empty | ✓ PASS |
| UI stubs removed | grep `logs: []` / `logRows: []` in pages | 0 matches | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| COL-01 | 15-01/03/06/08 | Log events persisted + benign suppression + un-stubbed UI | ✓ SATISFIED | Table + collector + reader + UI wiring all present; CR-01 fix restores suppression. |
| COL-02 | 15-01/05/07 | PG AP-12 signatures + pg_stat_* ingested; deterministic; LLM retired | ✓ SATISFIED | pg_health table + reader + deterministic detector; no AI import. |
| COL-03 | 15-01/02/04/07/08 | Deep VM metrics RAW + surfaced | ✓ SATISFIED | 4 fact tables + /proc parsers + reader + VmVitals deep charts. |

**Traceability note (documentation, non-blocking):** `.planning/REQUIREMENTS.md` defines COL-01/02/03 in the body under "Data Collection Expansion (Phase 15)" but omits them from both Traceability tables; the v2 table instead maps INC-01/INC-02/AIX-01/AIX-02 to "Phase 15", which conflicts with this phase's actual data-collection goal. Recommend reconciling the traceability table to add COL-01/02/03 → Phase 15 and re-home the INC/AIX rows. Does not affect goal achievement.

### Anti-Patterns / Open Review Items

| Item | Severity | Status | Impact |
| --- | --- | --- | --- |
| CR-01 (regex vs substring suppression) | 🛑 was Blocker | ✅ FIXED (e2e7e4f) | `_classify` now `re.search`; seed escapes bracket tags. |
| CR-02 (RLS WITH CHECK aborts whole tick) | 🛑 was Blocker | ✅ FIXED (e2e7e4f) | `_rls_admissible_node_rows` filters inadmissible node-scoped rows; host vitals preserved. |
| WR-01 (unordered config SELECT → nondeterministic first-match) | ⚠️ Warning | OPEN (non-blocking) | Overlapping substrings can grade differently across ticks; recommend `ORDER BY length(match_expression) DESC` or a priority column. |
| WR-02 (seed comment "5 suppress" vs 6 rows) | ⚠️ Warning | OPEN (non-blocking) | Operator acceptance comment mismatch; cosmetic. |
| WR-03 (AP-12b `>=10` vs band `>10` boundary) | ⚠️ Warning | OPEN (non-blocking) | At exactly 10× a card can emit at info while band note says critical. |
| WR-04 (multi-node host node-scoped rows) | ⚠️ Warning | LARGELY ADDRESSED by CR-02 | `_rls_admissible_node_rows` now skips foreign-node rows rather than aborting; remaining concern is those rows are dropped, not routed per-node. |
| IN-01/02/03 (probe conn self-count; dm-* disk filter; spatial CPU series label) | ℹ️ Info | OPEN (non-blocking) | Minor accuracy/labeling. |

No `TBD`/`FIXME`/`XXX` debt markers were found in the phase-modified files.

### Human Verification Required

**1. Live canary bootstrap + tick (COL-01/02/03).** Apply `drizzle/nodemon/0003_moaning_randall.sql` → the Phase-15 `db/role-grants.sql` delta → `db/seed-log-patterns.sql` (in that order, as owner) to the canary nodemon DB, deploy the expanded collector, run one `*/5` tick.
- **Expected:** ≥1 canary row in all 8 new tables; no SQLSTATE 42501; no cross-host leakage; secret redaction held.
- **Why human:** owner-only DDL/grants/seed + a live node tick; no live DB in this environment. Explicitly deferred by operator (Plan 15-09 Tasks 1 & 2).

**2. Operator visual render (COL-01/03).** Open a node page and a service page against a DB with real rows.
- **Expected:** real newest-first logs with benign suppression and no secret leak; three deep-VM charts render real data or honest StaleChart.
- **Why human:** visual/functional correctness; deferred from Plan 15-08 Task 3.

### Gaps Summary

No code-level gaps. Every artifact the phase promised exists, is substantive, is wired, and has a real data path; both prior blockers (CR-01, CR-02) are fixed and confirmed in the source; all automated suites (27 Python + 163 vitest) pass; the AP-12 LLM fallback is retired. The phase cannot be marked fully *proven* only because its two inherently operator-gated steps — applying the migration/grants/seed to a live DB and observing one real `*/5` tick populate the 8 tables — were deliberately deferred by the operator. Those are the sole outstanding items, captured as human-verification checks. Status is therefore **human_needed**, not gaps_found.

---

_Verified: 2026-07-14T17:15:00Z_
_Verifier: Claude (gsd-verifier)_
