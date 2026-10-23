---
phase: 16
slug: collector-enrichment-robust-log-capture
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Python stdlib `unittest` (collector — `scripts/fileserver/test_extract.py`, DB-free, also pytest-compatible) + `vitest ^4` (read-layer TS) |
| **Config file** | none for unittest (stdlib-runnable); `package.json` `"test": "vitest run"` for the TS side |
| **Quick run command** | `python3 scripts/fileserver/test_extract.py` (offline, no DB, no network) |
| **Full suite command** | `python3 scripts/fileserver/test_extract.py && npm test` |
| **Estimated runtime** | ~30 seconds (collector unittest is sub-second DB-free; vitest run dominates) |

---

## Sampling Rate

- **After every task commit:** Run the task's scoped command (e.g. `python3 scripts/fileserver/test_extract.py -k "<TestClass>"` or the TS `npx vitest run <file>`)
- **After every plan wave:** Run `python3 scripts/fileserver/test_extract.py && npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> One row per task; each mapped to COL-04/05/06 and its threat ref. Owner-run SQL tasks (16-05) and the 16-06 decision checkpoint are verified by grep-gate / operator apply, not CI DB apply.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 0 | COL-04/05/06 | T-16-01 | RED scaffolding writes ONLY to tempfiles (never real `/lnd` logs) | unit | `python3 scripts/fileserver/test_extract.py` (expected RED) | ✅ creates test_extract.py classes | ⬜ pending |
| 16-01-02 | 01 | 0 | COL-06 | T-16-01 | D-04 detector independence + config_id=NULL survival guard | unit (vitest) | `npx vitest run src/lib/read/service-log-events.test.ts src/lib/insight/detectors/ap12-advisory.test.ts` | ✅ extends TS tests | ⬜ pending |
| 16-02-01 | 02 | 1 | COL-04 | T-16-06 | cursor is LOCAL node state, collector stays SELECT-only; bounded-bytes defer+log | unit | `python3 scripts/fileserver/test_extract.py -k "Cursor or PgGlob or Bounded"` | ✅ W0 (16-01) | ⬜ pending |
| 16-02-02 | 02 | 1 | COL-04 | T-16-06 | rotation drain reads prior file before reset; no path from log content | unit | `python3 scripts/fileserver/test_extract.py -k "Rotation"` | ✅ W0 (16-01) | ⬜ pending |
| 16-03-01 | 03 | 2 | COL-05 | T-16-02 / T-16-05 | capture-by-pattern + tier(=classification) gating; `_redact` on every stored line | unit | `python3 scripts/fileserver/test_extract.py -k "CaptureByPattern or TierGating"` | ✅ W0 (16-01) | ⬜ pending |
| 16-03-02 | 03 | 2 | COL-05 | T-16-06 | native tail only owner-seeded paths; IP:port normalized out | unit | `python3 scripts/fileserver/test_extract.py -k "IpPort or Native or Normalize"` | ✅ W0 (16-01) | ⬜ pending |
| 16-04-01 | 04 | 1 | COL-06 | T-16-04 | info/warn/critical + category reseed applied owner-side (no drizzle push, no collector write) | grep gate | `bash -c "grep -q category db/seed-log-patterns.sql && grep -q 'ADD COLUMN IF NOT EXISTS category' db/seed-log-patterns.sql && grep -q 'postgres-connection-exhaustion' db/seed-log-patterns.sql && ! grep -Eq \"'ap11'|'ap12'|'benign'\" db/seed-log-patterns.sql && echo OK"` | ✅ | ⬜ pending |
| 16-04-02 | 04 | 1 | COL-06 | T-16-02 | config_id PK join intact; D-04 counter detector untouched | unit (vitest) | `npx vitest run src/lib/read/service-log-events.test.ts src/lib/insight/detectors/ap12-advisory.test.ts src/lib/read/telemetry-bands.test.ts` | ✅ | ⬜ pending |
| 16-05-01 | 05 | 3 | COL-06 | T-16-05 / T-16-07 | guarded UNIQUE (host_id,service_name) before UPSERT; no GRANT, no drizzle; SELECT-only preserved | grep gate (owner-run SQL) | `bash -c "test -f scripts/fileserver/path-reconciler.sql && grep -q 'service_inventory_host_service_uniq' scripts/fileserver/path-reconciler.sql && grep -q 'ADD CONSTRAINT' scripts/fileserver/path-reconciler.sql && grep -q 'ON CONFLICT (host_id, service_name)' scripts/fileserver/path-reconciler.sql && grep -q 'DO UPDATE SET artifact_path' scripts/fileserver/path-reconciler.sql && ! grep -qi 'GRANT' scripts/fileserver/path-reconciler.sql && ! grep -qi 'drizzle' scripts/fileserver/path-reconciler.sql && echo OK"` | ✅ | ⬜ pending |
| 16-05-02 | 05 | 3 | COL-06 | T-16-06 | seed documents daemon paths/globs consistent with reconciler; reconcile-not-clobber note | grep gate | `bash -c "grep -q '/bitcoin/debug.log' db/seed-dimensions.sql && grep -q 'postgresql-\*.log' db/seed-dimensions.sql && grep -q '/lnd/logs/bitcoin/mainnet/lnd.log' db/seed-dimensions.sql && grep -qi 'reconcil' db/seed-dimensions.sql && echo OK"` | ✅ | ⬜ pending |
| 16-06-01 | 06 | 3 | COL-06 | T-16-08 / T-16-10 | operator confirms A2 lncli path + A3 gate mechanism before encoding (no guess frozen) | checkpoint:decision (blocking) | N/A — operator resume-signal (manual) | N/A | ⬜ pending |
| 16-06-02 | 06 | 3 | COL-06 | T-16-09 / T-16-11 | absolute LNCLI_BIN; COLLECTOR_VERSION observability; NO warehouse write | grep + ast | `bash -c "grep -q 'NODEMON_CHANNEL' scripts/fileserver/deploy-env.sh && grep -q 'COLLECTOR_VERSION' scripts/fileserver/collect_telemetry.py && python3 -c 'import ast; ast.parse(open(\"scripts/fileserver/collect_telemetry.py\").read())' && echo OK"` | ✅ | ⬜ pending |
| 16-06-03 | 06 | 3 | COL-06 | T-16-08 / T-16-11 | D-08 channel gate before pull; NO INSERT/UPDATE/GRANT (SELECT-only) | grep + bash -n | `bash -c "grep -q 'NODEMON_CHANNEL' scripts/fileserver/run_collect-telemetry.sh && bash -n scripts/fileserver/run_collect-telemetry.sh && grep -qi 'channel' scripts/fileserver/CANARY-RUNBOOK.md && ! grep -qiE 'INSERT|UPDATE .*SET|GRANT' scripts/fileserver/run_collect-telemetry.sh && echo OK"` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Cursor unit tests — inode-change, size-shrink, offset-advance, bounded-bytes truncation (COL-04) — 16-01-01, turned GREEN by 16-02
- [ ] Dual-rotation fixtures — LND rename-archive + Postgres timestamped-glob line-continuity across a rotation boundary (COL-04) — 16-01-01 / 16-02-02
- [ ] Capture-by-pattern tests — `[WRN]`/`[CRT]`/regex match vs old single-substring gate; native-service tailing (COL-05) — 16-01-01, GREEN by 16-03
- [ ] `_normalize` IP:port collapse tests (COL-05) — 16-01-01, GREEN by 16-03-02
- [ ] Taxonomy migration tests — info/warn/critical tier gating (tier read from `classification`; count-only info; capped warn; critical exemplars) + read-layer band reconciliation (COL-06) — 16-01, GREEN by 16-03/16-04
- [ ] Confirm existing `test_extract.py` harness + vitest config; use stdlib `unittest` (pytest absent on dev box — the harness is stdlib-runnable by design)

*New capture mechanics require Wave 0 stubs (16-01) that fail RED before 16-02/16-03 implement them. `wave_0_complete: false` — Wave 0 not yet executed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Canary rollout gate (D-08) proves on the ONE canary before fleet promotion | COL-06 | Requires a live node + owner-side deploy rail; cannot run in CI | Follow `scripts/fileserver/CANARY-RUNBOOK.md` Phase-16 section; verify only the canary-pinned node pulls the new collector version |
| Owner-run reconciler creates the guarded UNIQUE constraint + UPSERTs `service_inventory` fleet-wide | COL-06 | Runs owner-side against the live warehouse (collector stays SELECT-only) | Apply `scripts/fileserver/path-reconciler.sql` with owner creds; verify `service_inventory_host_service_uniq` exists, rows populated, collector grants unchanged |
| Owner-run reseed replaces old benign/ap11/ap12 classification VALUES before canary | COL-06 | Owner-side SQL against live `log_patterns_config`; info-tier suppression only matches after it | Apply `db/seed-log-patterns.sql` (16-04) with owner creds BEFORE the canary tick — else info-tier flood is unsuppressed and daemon logs are not tailed (see CANARY-RUNBOOK Owner-Side Prerequisite) |
| `LNCLI_BIN` absolute-path fix resolves root/cron `pubkey=none` skip | COL-06 | Depends on node PATH/cron env | Confirm absolute lncli path on a node; run under cron-equivalent env; verify pubkey resolves and the tick summary logs the resolved path |
| Interval-complete capture on real fleet logs (errors no longer scroll past 64KB tail) | COL-04 | Requires live log volume | Canary verification queries per runbook; compare captured `[ERR]` count to log truth |

---

## Validation Sign-Off

- [x] All auto tasks have `<automated>` verify or Wave 0 dependencies (16-06-01 is a `checkpoint:decision` — exempt from automated verify)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (16-01 scaffolds cursor/rotation/capture/tier/normalize + TS guardrails)
- [x] No watch-mode flags (`vitest run`, not `vitest`; unittest one-shot)
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready (Wave 0 pending execution)
</content>
