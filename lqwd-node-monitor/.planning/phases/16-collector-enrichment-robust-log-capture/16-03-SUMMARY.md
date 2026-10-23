---
phase: 16-collector-enrichment-robust-log-capture
plan: 03
subsystem: node-collector
tags: [python, log-capture, capture-by-pattern, tier-gating, cursor, ip-normalize, col-05, tdd-green]

# Dependency graph
requires:
  - phase: 16-collector-enrichment-robust-log-capture
    plan: 01
    provides: "Wave-0 RED tests (TestCaptureByPattern / TestTierGating / TestIpPortNormalize) + the return_aggregate=(exemplars,aggregates) surface decision"
  - phase: 16-collector-enrichment-robust-log-capture
    plan: 02
    provides: "read_since / resolve_artifact / load_cursors / save_cursors cursor module + INITIAL_TAIL_BYTES demotion (call sites rewired here)"
provides:
  - "Capture-by-log_patterns_config-regex extract_events (COL-05): a line is captured on a _classify match ([WRN]/[CRT]/every seeded signature), error_pattern kept only as an extra trigger for the service_health.error_count axis"
  - "Tier-gated exemplar emission read from the matched row's classification (D-05): info=count-only, warn=KEEP_N first+newest, critical=KEEP_N_CRITICAL"
  - "return_aggregate=True -> (exemplars, aggregates); the D-06 per-signature tally survives to _upsert_log_patterns even when info-tier exemplars are suppressed"
  - "Cursor-tailed grade_log_service + decoupled native (postgres/bitcoind) tailing; PG log tailed ONCE and fanned to both _count_pg_log_signatures and extract_events"
  - "_RE_IP_PORT in _normalize collapsing per-peer a:p->b:p broken-pipe lines to one signature"
affects: [16-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capture gate = config-regex match OR legacy error_pattern substring — keeps the 27 pre-existing empty-config extract tests green while widening capture (COL-05)"
    - "Tier = the matched row's classification value (no separate tier column); _tier_of defaults non-{info,warn,critical} rows to warn-capped so a pre-reseed tick never crashes"
    - "return_aggregate threaded grade_log_service -> main -> write_tick -> _upsert_log_patterns so the aggregate count is driven by the per-signature tally, not the (tier-suppressed) exemplars (D-06)"
    - "Cursor map threaded through the grading path and persisted via save_cursors only AFTER write_tick commits (at-least-once, never silently skip unwritten lines)"

key-files:
  created: []
  modified:
    - scripts/fileserver/collect_telemetry.py

key-decisions:
  - "Capture gate is config-match OR error_pattern substring (not config-match ONLY): the plan's 'capture iff _classify matches' would drop every empty-config / unmatched-substring line, breaking TestConfigClassification.test_unmatched_line_is_other_with_null_config_id and the empty-config extract suite — those pre-existing tests pin substring capture as an additional trigger. The literal `error_pattern not in line` gate is gone (acceptance grep passes); substring survives only as an OR trigger feeding error_count."
  - "critical retains MORE exemplars than warn via KEEP_N_CRITICAL=10 (vs KEEP_N=2) to honor the must_have 'critical -> more exemplars'; warn keeps first-seen+newest (D-08), info keeps zero."
  - "Aggregate survival wired end-to-end (grade_log_service/main/write_tick/_upsert_log_patterns) rather than only returning the shape from extract_events — otherwise info-tier signatures produce zero exemplars and their D-06 count would vanish before reaching log_patterns."
  - "Removed the now-dead _tail_text helper after rewiring both call sites to read_since (no test coupling); the PG double-tail is replaced by a single cursor read fanned to both consumers."

patterns-established:
  - "Native (detection_method='native') services are tailed in main() independent of grade_native_service's running/functioning probe — decoupling capture from detection_method (COL-05)"

requirements-completed: [COL-05]

# Metrics
duration: ~35min
completed: 2026-07-16
---

# Phase 16 Plan 03: Widen + Sharpen Log Capture (COL-05) Summary

**Replaced the single-substring capture gate with capture-by-log_patterns_config-regex, added classification-driven tier gating (info=count-only / warn=capped / critical=more) with the aggregate count surviving for every tier via a return_aggregate surface, rewired both tail sites to the 16-02 cursor so native postgres/bitcoind logs are tailed once (unifying the PG double-tail), and folded IPv4:port out of signatures so per-peer broken-pipe lines collapse to one — turning the last four RED tests GREEN.**

## Performance
- **Duration:** ~35 min
- **Tasks:** 2 (both `tdd="true"`, turning Wave-0 RED tests GREEN)
- **Files modified:** 1

## Accomplishments
- **Task 1 — capture-by-pattern + tier-gated emission** (`de016b0`): `extract_events` now captures a line when `_classify` returns a config match (or the legacy `error_pattern` substring hits, kept for `error_count`), reads the tier from the matched row's `classification` value, and gates exemplars — info→zero, warn→KEEP_N (first+newest), critical→KEEP_N_CRITICAL — while `sig_tick_count` is produced for ALL matched signatures. Added `return_aggregate=True → (exemplars, aggregates)` and threaded the aggregates through `grade_log_service → main → write_tick → _upsert_log_patterns` so the D-06 count survives info-tier suppression. `_redact` still wraps every stored message/context line.
- **Task 2 — decouple tailing + unify PG double-tail + IP:port normalize** (`37badcc`): rewired both former `_tail_text` sites to `read_since` (cursor threaded through the grading path, keyed on stable `service_name`, persisted after the warehouse write); native-probed services with a resolvable `artifact_path` are now tailed in `main()` independent of `detection_method`; the PG log is tailed once and fanned to both `_count_pg_log_signatures` and `extract_events`; added `_RE_IP_PORT` applied in `_normalize` before `_RE_EQ_NUM`. Removed the dead `_tail_text` helper.

## Task Commits
1. **Task 1: Capture-by-pattern + tier-gated exemplar emission in extract_events** — `de016b0` (feat)
2. **Task 2: Decouple tailing from detection_method + unify PG double-tail + IP:port normalize** — `37badcc` (feat)

_RED phase was authored in 16-01; this plan is the GREEN implementation (no separate RED commit here by design)._

## Files Created/Modified
- `scripts/fileserver/collect_telemetry.py` — refactored `extract_events` (capture-by-pattern, tier gating, `return_aggregate`); `_tier_of` + `KEEP_N_CRITICAL`; `_RE_IP_PORT` in `_normalize`; `grade_log_service`/`grade_service` cursor threading + `read_since` rewire; `main()` native tailing + PG double-tail unification + `load_cursors`/`save_cursors`; `write_tick`/`_upsert_log_patterns` aggregate wiring; removed dead `_tail_text`.

## Deviations from Plan

### Adjusted-from-plan-instruction
**1. [Rule 1 — Correctness] Capture gate is config-match OR substring, not config-match ONLY**
- **Found during:** Task 1
- **Issue:** The plan action says "a line is captured iff `_classify` returns a non-null match." Taken literally that drops every empty-config line and every substring-matched-but-config-unmatched line, which would turn RED the pre-existing (must-stay-green) tests `TestConfigClassification.test_unmatched_line_is_other_with_null_config_id`, `TestExtractEvents`, `TestRedaction`, `TestContextWindow`, and `TestExemplarCap` (all call `extract_events(..., [])` with an empty config and rely on substring capture).
- **Fix:** Capture when `config_id is not None` OR the `error_pattern` substring hits. The forbidden literal `error_pattern not in line` gate is removed (acceptance grep returns 0); the substring survives only as an additional OR trigger. Capture-by-pattern is fully honored (TestCaptureByPattern passes with `error_pattern` absent).
- **Files modified:** `scripts/fileserver/collect_telemetry.py`
- **Commit:** `de016b0`

### Auto-added critical functionality
**2. [Rule 2 — D-06 correctness] Threaded aggregate survival end-to-end**
- **Found during:** Task 1
- **Issue:** `_upsert_log_patterns` was driven off the emitted exemplars; info-tier signatures emit zero exemplars, so their D-06 aggregate count would never reach `log_patterns`.
- **Fix:** `extract_events(return_aggregate=True)` returns a per-signature aggregate list; `grade_log_service`/`main`/`write_tick` thread it and `_upsert_log_patterns` now bumps `count_window` from the aggregates, not the exemplars.
- **Commit:** `de016b0`

## Known Stubs
None. The `.zst` archive skip-drain is a 16-02 accepted limitation, untouched here.

## Threat Flags
None. No new network endpoint, no warehouse write, no new dependency. Widened capture stays inert parameter-bound data; `_redact` runs on every stored warn/critical exemplar and context line (T-16-02); only compiled-cache regexes are evaluated, bad ones cache None (T-16-03); tier gating suppresses the info exemplar flood inside `extract_events` (T-16-05); native tailing only touches owner-seeded `service_inventory` paths via `resolve_artifact` (T-16-06); the SELECT-only boundary is intact (cursor is LOCAL state).

## Sequencing Note (live/canary)
Info-tier suppression only matches live rows once 16-04's owner-run reseed replaces the old `benign/ap11/ap12` classification VALUES with `info/warn/critical`. Pre-reseed, `_tier_of` maps any non-`{info,warn,critical}` classification to the defensive warn-capped path, so a tick never crashes — but info suppression is inert until the reseed is applied owner-side (documented in 16-06 CANARY-RUNBOOK).

## Verification
- `python3 scripts/fileserver/test_extract.py` → **Ran 43 tests … OK** (all four target classes green: TestCaptureByPattern, TestTierGating, TestIpPortNormalize + full regression).
- `python3 -m py_compile collect_telemetry.py` → clean.
- Source assertions: `grep -c "error_pattern not in line"` == 0; `return_aggregate` present; no bogus `tier` column reference; `_RE_IP_PORT` present and applied before `_RE_EQ_NUM`; `read_since` at both former tail sites; `_tail_text` code removed (only a comment mention remains); `_redact(line)`/`_redact(ctx)` still wrap stored lines.
- End-to-end tempfile smoke (no DB): `[WRN]` captured with `error_pattern=None`; two broken-pipe lines to different IPv4:ports collapse to ONE signature; cursor offset advances; classifications warn+critical.

## Self-Check: PASSED
- `scripts/fileserver/collect_telemetry.py` present on disk with `def _tier_of`, `_RE_IP_PORT`, `return_aggregate`.
- Both task commits present in git history (`de016b0`, `37badcc`).

---
*Phase: 16-collector-enrichment-robust-log-capture*
*Completed: 2026-07-16*
