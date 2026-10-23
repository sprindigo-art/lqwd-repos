---
phase: 11-full-stack-telemetry-ingestion
verified: 2026-06-30T11:00:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial verification — no prior VERIFICATION.md"
---

# Phase 11: Full-Stack Telemetry Ingestion — Verification Report

**Phase Goal:** Widen the read model beyond Lightning — host/VM vitals, two-axis
service-health, and bitcoind/chain telemetry land in the warehouse via the existing
Phase-8 heartbeat/collector pattern, so every v2 screen renders real signals against a
stable read model.

**Verified:** 2026-06-30
**Status:** PASS
**Re-verification:** No — initial verification
**Requirements:** TEL-01, TEL-02, TEL-03

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + merged plan must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC1 / TEL-01) | Host/VM metrics (CPU/mem/disk/network, storage usage + growth) ingested + queryable per host, extending the Phase-8 collector (no new daemon) | VERIFIED | `host_metrics` + `host_storage` tables (schema/nodemon.ts:149-195, migration 0001:18-43); `getLatestHostMetrics` uses `DISTINCT ON (host_id)` / `DISTINCT ON (host_id, mount_point)` (host-metrics.ts:76,90,112,124); `storage-growth.ts` computes %/day + days-to-full with HOST-02 honesty gate; collector `INSERT INTO host_metrics/host_storage` via `*/5` cron `CRON_JOB_12` (no daemon). Live proof on `lnd-ireland`: host_metrics=1, host_storage=8 mounts. |
| 2 (SC2 / TEL-02) | Two-axis service-health (RUNNING + FUNCTIONING: freshness, last-success, error counts) ingested for infra trio + 6 custom services, keyed per node/host | VERIFIED | `service_health` (running+functioning+lastSuccessAt+lastArtifactMtime+errorCount) + `service_inventory` (detection_method, expected_interval_seconds, is_expected) tables; `getServiceHealth` `DISTINCT ON (host_id, service_name)` + LEFT JOIN `service_inventory` for no-data + per-service `expected_interval_seconds` clock (service-health.ts:64,69,167); seed = 9 expected + rebalance not-expected. Live: service_health=9 rows; up-but-dead/no-data logic unit-tested + organically confirmed live (false-alarm seed-config corrections). |
| 3 (SC3 / TEL-03) | bitcoind/chain telemetry (blocks behind, verificationprogress, peers, mempool) ingested with thresholds attached as evidence | VERIFIED | `chain_telemetry` table (blocks/headers/verificationProgress/ibd/peers/mempool); `getChainTelemetry` `DISTINCT ON (host_id)`, derives `blocksBehind = headers - blocks` at read time, attaches D-14 bands via `evaluateBand` (chain-telemetry.ts:72,128,134-142); collector `INSERT INTO chain_telemetry`. Live: chain_telemetry=1, `chain=up`. |
| 4 (SC4) | Every ingested signal carries freshness/last-seen; stale/missing is representable as stale — never silently healthy | VERIFIED | Every fact table has `collected_at timestamptz NOT NULL` (D-13, schema lines 154/181/207/233; migration confirms); staleness DERIVED at read time (host ~15-min window; service `expected_interval_seconds × grace`); no-data via LEFT JOIN; no stored stale flag (raw-values-only D-14). Live: esplora/rebalance read no-data, never DOWN. |
| 5 | Six telemetry tables (2 dim + 4 fact) + AFM-001 composite indexes exist; migration 0001 committed + applied live | VERIFIED | `grep -c pgTable` = 9 (3 queue + 6 new); `drizzle/nodemon/0001_telemetry_tables.sql` present with all 6 CREATE TABLE + composite `(entity…, collected_at DESC)` + plain `(collected_at)` indexes; `meta/_journal.json` idx 1 = `0001_telemetry_tables`. Operator-attested live apply on remote prod nodemon (6 relations, owner=postgres). |
| 6 (security) | Least-privilege `nodemon_telemetry` role under host-axis FORCE RLS: SELECT/INSERT/DELETE on facts, SELECT-only on dims, no UPDATE/TRUNCATE/DDL; fail-closed | VERIFIED | role-grants.sql:200-247 — scoped named-table grants; `ENABLE + FORCE ROW LEVEL SECURITY` on all 4 fact tables; 4 policies keyed on two-arg `current_setting('app.host_id', true)` (NULL-on-unset = fail-closed); service policy adds node_pubkey clause. Operator-attested live: role NOT superuser / NOT bypassrls, RLS enabled+forced, no UPDATE/TRUNCATE grant. |
| 7 (security) | Collector SET LOCAL app.host_id/node_pubkey before INSERT; no secret literal in source or scp payload (creds from root-only env) | VERIFIED | collect_telemetry.py:539-540 `SET LOCAL app.host_id`/`app.node_pubkey` inside insert txn; all creds via `os.environ` (NODEMON_TELEMETRY_DSN, BITCOIND_RPC*, PG_PROBE_CONNINFO, ESPLORA_TIP_URL). Secret scan of scripts/fileserver + db: zero secret literals (only env reads, doc/comment refs, `<placeholder>` strings). |
| 8 | Operator runbook applies seed BEFORE first tick (D-18); live canary proof confirms rows land + read helpers return them | VERIFIED | CANARY-RUNBOOK.md TELEMETRY section: D-18-ordered (migration→role/RLS→seed→env→tick→query→PASS gate), references seed-dimensions, root-only env, all three read helpers, no-data/not-functioning, 6-point PASS gate. Operator verdict: APPROVED 2026-06-30, live proof PASSED on `lnd-ireland`. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/db/schema/nodemon.ts` | VERIFIED | 250 lines; 9 pgTable defs (6 new); collected_at on all 4 facts; AFM-001 indexes; no derived columns |
| `drizzle/nodemon/0001_telemetry_tables.sql` | VERIFIED | All 6 CREATE TABLE + composite/plain indexes; journal updated |
| `db/role-grants.sql` | VERIFIED | nodemon_telemetry role + FORCE RLS + fail-closed policies (258 lines) |
| `db/seed-dimensions.sql` | VERIFIED | hosts + 10-row service_inventory (9 expected + rebalance/esplora not-expected); live false-alarm corrections folded back |
| `src/lib/format/units.ts` | VERIFIED | formatBytes + formatPercent (AFM-002) |
| `src/lib/read/telemetry-bands.ts` | VERIFIED | TELEMETRY_BANDS versioned config + evaluateBand pure evaluator |
| `src/lib/read/telemetry-fixture.ts` | VERIFIED | seeded-fixture helper (301 lines) |
| `src/lib/read/host-metrics.ts` | VERIFIED | DISTINCT-ON host + per-mount; lazy `@/lib/db/nodemon` import |
| `src/lib/read/storage-growth.ts` | VERIFIED | pure %/day + days-to-full with insufficient/stale honesty gate |
| `src/lib/read/chain-telemetry.ts` | VERIFIED | DISTINCT-ON, read-time blocks_behind, D-14 bands |
| `src/lib/read/service-health.ts` | VERIFIED | two-axis DISTINCT-ON + LEFT JOIN no-data + per-service freshness clock |
| `scripts/fileserver/collect_telemetry.py` | VERIFIED | 588 lines; env-only creds; SET LOCAL; INSERT into all 4 facts |
| `scripts/fileserver/run_collect-telemetry.sh` | VERIFIED | flock + md5 self-update + venv bootstrap |
| `scripts/fileserver/updateCrontab.snippet.sh` | VERIFIED | idempotent CRON_JOB_12 */5 merge |
| `scripts/fileserver/CANARY-RUNBOOK.md` | VERIFIED | 657 lines; D-18 telemetry section + PASS gate |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| schema/nodemon.ts | 0001_telemetry_tables.sql | drizzle-kit generate | WIRED — all 6 tables in migration |
| role-grants.sql | collector SET LOCAL app.host_id | two-arg fail-closed RLS policy | WIRED — `current_setting('app.host_id', true)` matches collector `SET LOCAL` |
| telemetry-bands.ts | chain-telemetry.ts | evaluateBand at read time | WIRED — imported + consumed for blocksBehind/vp/peers evidence |
| host-metrics.ts | dbNodemon | lazy `@/lib/db/nodemon` import | WIRED |
| service-health.ts | service_inventory.expected_interval_seconds | LEFT JOIN | WIRED |
| collect_telemetry.py | nodemon fact tables | SET LOCAL + param-bound INSERT under RLS | WIRED — 4 INSERTs |
| seed-dimensions.sql | collector first tick | operator applies seed before CRON_JOB_12 | WIRED — D-18 ordering in runbook |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Read layer typechecks | `npx tsc --noEmit` | exit 0, no errors | PASS |
| Pure read/format tests | `npx vitest run src/lib/format src/lib/read` | 150 passed, 15 skipped (DB-gated), 11 files passed / 2 skipped | PASS |
| Schema table count | `grep -c pgTable schema/nodemon.ts` | 9 | PASS |
| No derived columns in schema | `grep blocks_behind\|severity\|stale-flag` | none (only D-13/D-14 doc comments + Phase-6 stale_acknowledged) | PASS |
| Secret scan (scripts/fileserver + db) | grep for password/DSN/keys/PEM | zero literals (env reads + placeholders only) | PASS |
| Debt markers (TBD/FIXME/XXX) in phase files | grep | none | PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| TEL-01 | Host/VM metrics ingested, extending Phase-8 collector | SATISFIED | Truths 1, 5, 7 |
| TEL-02 | Two-axis service-health for infra trio + 6 custom services per node/host | SATISFIED | Truths 2, 4 |
| TEL-03 | bitcoind/chain telemetry surfaced as evidence with thresholds | SATISFIED | Truth 3 |

### Security Assessment

PASS. The integrity boundary is real and defence-in-depth:
- **FORCE RLS** on all 4 fact tables (ENABLE + FORCE), keyed on two-arg `current_setting(...,true)` → NULL-on-unset = fail-closed (zero rows). WITH CHECK mirrors USING so a row can never be written out of the node's own host scope.
- **Least-privilege role:** SELECT/INSERT/DELETE on facts (DELETE only for the RLS-boxed retention prune), SELECT-only on dimensions, NO UPDATE/TRUNCATE/DDL. Live-attested NOT superuser / NOT bypassrls / not table-owner (Pitfall 4 belt against owner-bypass).
- **No credentials in source or scp payload** — DSN + bitcoind/pg/esplora creds read from the root-only `0600 root:root` env file at runtime; verified by secret scan.
- **Live fail-closed proof:** when `lncli getinfo` failed as root (unresolved node_pubkey), node-scoped service_health rows were RLS-rejected — the boundary held exactly as designed; operator added a least-privilege `lncli-telemetry.sh` readonly-macaroon wrapper to fix.

### Accepted Limitations (NOT gaps — per phase context + deferred-items.md)

| Item | Disposition |
|------|-------------|
| DB-gated tests skip without `NODEMON_QUEUE_URL` | Expected — 15 tests / 2 suites skipped cleanly via `describe.skipIf`. Pure logic (units/bands/storage-growth/two-axis derivation) is fully covered off-DB. |
| 4 pre-existing `src/lib/queue/` off-DB test failures | Out of scope — pre-existing (Phase-6 queue suites lack the skipIf gate); logged in deferred-items.md; Phase 11 touched zero queue files. Not re-run here. |
| `CRON_JOB_12` not spliced fleet-wide into `updateCrontab.sh` | Intentional — canary-only via manual ticks. Snippet is authored + idempotent; satisfies SC1 "no new persistent daemon". Fleet enablement is future work. |
| Per-node detection config may differ from lnd-ireland | Noted follow-up — seed is lnd-ireland-accurate; other nodes need per-node confirm-against-host at fleet rollout. |
| Deliberate stop-a-green-service flip test not run live | Operator deemed optional given organic evidence (honest not-blanket-green + seed-config false-alarm corrections + esplora/rebalance no-data). Two-axis up-but-dead logic is unit-tested. Left as low-priority future spot-check. |

### Anti-Patterns Found

None. No TBD/FIXME/XXX, no TODO/HACK/PLACEHOLDER, no stub returns, no committed secrets in the phase's modified files.

### Human Verification Required

None outstanding. The phase's one blocking human-verify checkpoint (11-07 Task 2, the live canary proof) was executed and **APPROVED by the operator on 2026-06-30** (live proof PASSED on `lnd-ireland`). The only residual item — a deliberate stop-a-green-service flip — was explicitly deemed optional by the operator and is recorded as a low-priority future spot-check.

### Gaps Summary

No gaps. All 8 must-haves (4 ROADMAP success criteria + 4 merged plan/security truths) are VERIFIED against the codebase. Schema, RLS, seed, read helpers, and collector together satisfy TEL-01/02/03; the security boundary (FORCE RLS + least-privilege role + env-only creds + fail-closed) is real and was demonstrated holding live; the read layer typechecks and its pure tests pass. The live canary proof on `lnd-ireland` wrote fresh rows in all four fact tables in one atomic tick, the two-axis read was honestly not blanket-green (surfacing real seed-config errors, since corrected in `db/seed-dimensions.sql`), and esplora/rebalance correctly read no-data rather than a false DOWN. The accepted limitations are intentional scope boundaries or pre-existing unrelated issues, not failures of this phase.

---

_Verified: 2026-06-30_
_Verifier: Claude (gsd-verifier)_
