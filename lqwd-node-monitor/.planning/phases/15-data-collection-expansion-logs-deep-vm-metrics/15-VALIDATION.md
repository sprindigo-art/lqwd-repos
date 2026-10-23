---
phase: 15
slug: data-collection-expansion-logs-deep-vm-metrics
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-14
updated: 2026-07-14
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | Vitest (installed) — `vitest.config.ts` carries the `@/` alias |
| **Framework (Python)** | pytest/unittest (stdlib) for `scripts/fileserver/test_extract.py` |
| **Quick run command (TS)** | `npx vitest run <file>` |
| **Quick run command (Py)** | `cd scripts/fileserver && python3 -m pytest test_extract.py -q` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~30–60 seconds full suite |

---

## Sampling Rate

- **After every task commit:** Run the task's quick command (targeted vitest file or pytest).
- **After every plan wave:** Run `npm test`.
- **Before `/gsd:verify-work`:** Full suite green + canary tick proven (Plan 09).
- **Max feedback latency:** ~60 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | COL-01/02/03 | T-15-02 | RAW-only schema, no severity col, child composite keys | tsc + shipped reader tests | `npx tsc --noEmit` + `npx vitest run src/lib/read/host-metrics.test.ts` | ✅ | ⬜ |
| 15-01-02 | 01 | 1 | COL-01/02/03 | T-15-02 | additive migration, nodemon only | shape | `ls drizzle/nodemon/0003_*.sql && grep -c "CREATE TABLE"` | ❌ W0→created | ⬜ |
| 15-01-03 | 01 | 1 | COL-01/02/03 | T-15-03 | UPDATE on log_patterns only; FORCE RLS | grep | `grep "UPDATE ON log_patterns" db/role-grants.sql` | ❌ W0→created | ⬜ |
| 15-02-01 | 02 | 1 | COL-02/03 | T-15-08 | bands at read (pure) | unit | `npx vitest run src/lib/read/telemetry-bands.test.ts` | ❌ W0→created | ⬜ |
| 15-02-02 | 02 | 1 | COL-02/03 | T-15-08 | Δ≥0 counter clamp (pure) | unit | `npx vitest run src/lib/read/counter-delta.test.ts` | ❌ W0→created | ⬜ |
| 15-03-01 | 03 | 2 | COL-01 | T-15-01/05 | benign read-time suppress, bound params | unit (no-DB shape) | `npx vitest run src/lib/read/service-log-events.test.ts` | ❌ W0→created | ⬜ |
| 15-04-01 | 04 | 2 | COL-03 | T-15-01 | DISTINCT-ON child keying, no MAX | unit | `npx vitest run src/lib/read/host-metrics-ext.test.ts` | ❌ W0→created | ⬜ |
| 15-04-02 | 04 | 2 | COL-03 | T-15-08 | grouped children, Δ≥0 rates, bands | unit | `npx vitest run src/lib/read/host-metrics-ext.test.ts` | ❌ W0→created | ⬜ |
| 15-05-01 | 05 | 2 | COL-02 | T-15-08 | AP-12a/b discriminator + benign-baseline no-false-page | unit | `npx vitest run src/lib/read/pg-health.test.ts` | ❌ W0→created | ⬜ |
| 15-05-02 | 05 | 2 | COL-02 | T-15-07 | deterministic detector, contract preserved, LLM retired | unit | `npx vitest run src/lib/insight/detectors/ap12-advisory.test.ts` | ✅ (extend) | ⬜ |
| 15-06-01 | 06 | 2 | COL-01 | T-15-05 | stable signature + secret redaction | unit (pytest) | `cd scripts/fileserver && python3 -m pytest test_extract.py -q` | ❌ W0→created | ⬜ |
| 15-06-02 | 06 | 2 | COL-01 | T-15-01/03/04 | RLS-txn inserts, upsert, tiered prune, bound SQL | compile + grep | `python3 -m py_compile collect_telemetry.py` + upsert/prune greps | ✅ (extend) | ⬜ |
| 15-07-01 | 07 | 3 | COL-03 | T-15-06 | /proc parse, argv-only | unit (pytest) | `cd scripts/fileserver && python3 -m pytest test_extract.py -q` | ✅ (extend) | ⬜ |
| 15-07-02 | 07 | 3 | COL-02/03 | T-15-01/06/09 | probe + RLS-txn deep inserts, argv-only | compile + grep | `python3 -m py_compile collect_telemetry.py` + probe/insert greps | ✅ (extend) | ⬜ |
| 15-08-01 | 08 | 3 | COL-01/03 | T-15-01/05 | logs:[] swap fail-soft, deep vitals | tsc + grep | `npx tsc --noEmit` + logs:[] grep=0 | ✅ (edit) | ⬜ |
| 15-08-02 | 08 | 3 | COL-01 | T-15-01 | logRows:[] swap after validation gauntlet | tsc + grep | `npx tsc --noEmit` + logRows:[] grep=0 | ✅ (edit) | ⬜ |
| 15-08-03 | 08 | 3 | COL-01/03 | T-15-05 | operator visual: real logs, no secret leak | manual | operator gate | n/a | ⬜ |
| 15-09-01 | 09 | 4 | COL-01/02/03 | T-15-03/09 | canary migrate+grants+seed apply order | manual | operator (owner psql) | n/a | ⬜ |
| 15-09-02 | 09 | 4 | COL-01/02/03 | T-15-02/05 | live tick: rows in all 8 tables, no 42501, no leak | manual | operator (canary tick) | n/a | ⬜ |
| 15-09-03 | 09 | 4 | COL-01/02/03 | T-15-06/08 | full suite + security grep battery | full suite + grep | `npm test` + security greps | ✅ | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 test scaffolds are created INSIDE the plans that own them (TDD RED step), not as a separate plan:

- [x] `src/lib/read/telemetry-bands.test.ts` (extend) + `counter-delta.test.ts` (new) — Plan 02
- [x] `src/lib/read/service-log-events.test.ts` (new) — Plan 03
- [x] `src/lib/read/host-metrics-ext.test.ts` (new) — Plan 04
- [x] `src/lib/read/pg-health.test.ts` (new) + `ap12-advisory.test.ts` (extend) — Plan 05
- [x] `scripts/fileserver/test_extract.py` (new) — Plan 06 (signature/redaction), extended Plan 07 (/proc parse)
- [x] Framework install: none — Vitest + pytest already available.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Canary end-to-end log/metric flow | COL-01/02/03 | Requires live canary node + `*/5` tick against the migrated DB | Plan 09 Task 2 — deploy collector, run one tick, query all 8 tables for canary rows, confirm no 42501 / no cross-host leak / redaction held |
| Migration + grants + seed apply | COL-01/02/03 | Owner-only DDL/grants/seed on a live DB | Plan 09 Task 1 — apply 0003 → role-grants delta → seed-log-patterns in order; verify grant matrix + A1/A3 |
| Operator visual (real logs + deep vitals) | COL-01/03 | Visual/functional render check | Plan 08 Task 3 — open node + service pages, confirm real rows, benign suppression, honest stale, no secret leak |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a manual-only justification (canary/visual gates)
- [x] Sampling continuity: no 3 consecutive code tasks without automated verify
- [x] Wave 0 covers all MISSING references (folded into the owning TDD plans)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned — ready for execution.
