---
phase: 11
slug: full-stack-telemetry-ingestion
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-25
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `11-RESEARCH.md` §"Validation Architecture". The read-model helpers are deterministically testable against a seeded `nodemon` test DB; the live telemetry landing is a one-shot canary proof.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (`npm test` = `vitest run`) — [VERIFIED: package.json] |
| **Config file** | vitest project-default (existing tests under `src/lib/**`) |
| **Quick run command** | `npx vitest run src/lib/read` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10–30 seconds (unit); live canary proof is manual/out-of-band |

**Live-DB pattern:** `describe.skipIf(!process.env.NODEMON_QUEUE_URL)` — mirror `src/lib/db/health.test.ts`. Seeded-fixture helper provisions stale / no-data / up-but-dead rows in a test `nodemon` DB.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/read` (new helpers + bands)
- **After every plan wave:** Run `npm test` (full suite — must stay green; AFM-001/002 re-verification)
- **Before `/gsd:verify-work`:** Full suite green + live canary telemetry proof + security greps (no secret literal in shipped collector; RLS verification query)
- **Max feedback latency:** ~30 seconds (unit loop)

---

## Per-Task Verification Map

| Req ID | Behavior | Wave | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists |
|--------|----------|------|------------|-----------------|-----------|-------------------|-------------|
| TEL-01 | `getLatestHostMetrics` returns latest-per-host (DISTINCT-ON, AFM-001), not N rows | 1 | — | N/A | unit (seeded) | `npx vitest run src/lib/read/host-metrics.test.ts` | ❌ W0 |
| TEL-01 | `buildLatestHostMetricsSql` emits DISTINCT-ON, param-bound | 1 | T-11 shell/SQL inj | parameter-bound SQL | unit (no-DB) | `npx vitest run src/lib/read/host-metrics.test.ts` | ❌ W0 |
| TEL-01 | storage %/day-growth + time-to-full; NO projection when window insufficient/stale | 1 | — | honest no-projection | unit (pure) | `npx vitest run src/lib/read/storage-growth.test.ts` | ❌ W0 |
| TEL-02 | "up but dead" (running=true, functioning=false) reads as not-functioning | 1 | — | N/A | unit (seeded) | `npx vitest run src/lib/read/service-health.test.ts` | ❌ W0 |
| TEL-02 | never-reported declared service → no-data (LEFT JOIN service_inventory) | 1 | — | honest no-data | unit (seeded) | `npx vitest run src/lib/read/service-health.test.ts` | ❌ W0 |
| TEL-02 | per-service freshness uses `expected_interval_seconds`, not the 15-min collector clock | 1 | — | no false-alarm | unit (seeded) | `npx vitest run src/lib/read/service-health.test.ts` | ❌ W0 |
| TEL-03 | `getChainTelemetry` derives blocks-behind + attaches bands | 1 | — | N/A | unit (seeded) | `npx vitest run src/lib/read/chain-telemetry.test.ts` | ❌ W0 |
| SC#4 | stale row (`collected_at` old) reads as stale; never-reported host → no-data | 1 | T-11 stale-as-healthy | read-time staleness (D-13) | unit (seeded) | across the above + `hosts`-dim test | ❌ W0 |
| D-14 | threshold band evaluator (raw value → healthy/warn/critical) | 1 | — | N/A | unit (pure) | `npx vitest run src/lib/read/telemetry-bands.test.ts` | ❌ W0 |
| SEC | no secret literal in shipped `collect_telemetry.py` payload | n | T-11 secret-leak | secret in root-only env | static grep | `! grep -RInE 'RPCPASS=|password=' scripts/fileserver/collect_telemetry.py` | ❌ W0 |
| SEC | `nodemon_telemetry` role has no UPDATE/TRUNCATE/DDL; RLS FORCE + two-arg fail-closed | n | T-11 priv-creep / forgery | least-privilege + RLS | SQL verify query | role-grants verification query | ❌ W0 |
| live | real host/service/bitcoind signals land + queryable end-to-end on canary | n | — | N/A | manual (canary) | extend `scripts/fileserver/CANARY-RUNBOOK.md` | ❌ W0 |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · W0 = created in Wave 0.*

---

## Wave 0 Requirements

- [ ] `src/lib/read/host-metrics.ts` + `.test.ts` — TEL-01 latest-per-host + build…Sql shape
- [ ] `src/lib/read/storage-growth.ts` + `.test.ts` — %/day + time-to-full honesty (no projection when stale/insufficient)
- [ ] `src/lib/read/service-health.ts` + `.test.ts` — two-axis + no-data + per-service freshness (`expected_interval_seconds`)
- [ ] `src/lib/read/chain-telemetry.ts` + `.test.ts` — blocks-behind + bands
- [ ] `src/lib/read/telemetry-bands.ts` + `.test.ts` — D-14 threshold evaluator
- [ ] Seeded-fixture helper for a test `nodemon` DB (stale / no-data / up-but-dead rows) — mirror the live-nodemon fixture approach
- [ ] `src/lib/format/units.ts` bytes/percent formatters (AFM-002 extension) + tests
- [ ] `scripts/fileserver/CANARY-RUNBOOK.md` telemetry section (D-16 live proof)

*Existing infra reused: vitest, `health.test.ts` skipIf pattern, AFM-001 `build…Sql` shape-test pattern, `parseDbTimestampUtc`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real host/service/bitcoind signals land in `nodemon` and are queryable end-to-end | TEL-01/02/03, SC#4 | Requires the live canary host + scp distribution + cron tick + bitcoind RPC reachability — cannot run in CI | Follow the new telemetry section of `CANARY-RUNBOOK.md`: seed dimensions (D-18), distribute collector, await `*/5` tick, query read helpers, confirm fresh rows + one deliberately-stopped service reading not-functioning |
| OQ-2..OQ-6 host facts (systemd vs docker, pg/esplora targets, bitcoin-cli vs curl, host_id) | TEL-02/03 | Live-host topology facts unknowable from repo | Confirm against canary during runbook; collector reads targets/creds from root-only env, never hardcoded |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (plan-checker confirmed every impl task carries a real `<automated>` verify; tdd tasks co-create test+impl)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (read-helper test files created in their owning plans; no orphan MISSING refs)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

> `wave_0_complete` stays `false` until execution actually creates the test files (tracked by /gsd-execute-phase).

**Approval:** approved 2026-06-25 (plan-checker: 0 blockers; Nyquist PASS on substance)
