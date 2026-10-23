# Phase 11: Full-Stack Telemetry Ingestion - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 19 (create/modify)
**Analogs found:** 17 / 19 (2 partial — node-side Python has no in-repo analog, mirrors live-fleet tree)

> Read-model + collector phase. Almost nothing is greenfield — every file is a clone/extension of a proven in-repo or live-fleet pattern. The risk is *divergence* from the existing rails, not missing capability. Concrete excerpts + line numbers below; the executor copies these, not abstractions.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/db/schema/nodemon.ts` (MODIFY: +5 tables) | model/schema | persistence | same file — `commands`/`commandExecutions`/`commandAudit` defs | exact |
| `drizzle/nodemon/0001_*.sql` (+`meta/`) (GENERATED) | migration | DDL | `drizzle/nodemon/0000_hard_random.sql` + `meta/` | exact |
| `db/role-grants.sql` (MODIFY: +`nodemon_telemetry` role + host-axis RLS) | config/security | access-control | same file — `nodemon_node` role + RLS block | exact |
| `db/seed-dimensions.sql` (NEW, hand-authored) | config/data-seed | batch INSERT | `db/role-grants.sql` (operator-run, hand-authored, NOT Drizzle) | role-match |
| `src/lib/read/host-metrics.ts` (+`.test.ts`) | service/read-helper | CRUD (DISTINCT-ON read) | `src/lib/read/latest.ts` / `node-info.ts` | exact |
| `src/lib/read/storage-growth.ts` (+`.test.ts`) | utility | transform (pure math) | `src/lib/read/node-info.ts` coerce + `units.ts` | role-match |
| `src/lib/read/service-health.ts` (+`.test.ts`) | service/read-helper | CRUD (LEFT-JOIN + staleness) | `src/lib/read/node-info.ts` | exact |
| `src/lib/read/chain-telemetry.ts` (+`.test.ts`) | service/read-helper | CRUD (DISTINCT-ON read) | `src/lib/read/latest.ts` | exact |
| `src/lib/read/telemetry-bands.ts` (+`.test.ts`) | config/evaluator | transform (pure) | `src/lib/insight/config.ts` (`INSIGHT_CONFIG` + pure evaluators) | role-match |
| `src/lib/format/units.ts` (MODIFY: +bytes/percent) (+`units.test.ts`) | utility | transform (pure) | same file — `feeMsatToSat`/`formatBtc`/`formatSats` | exact |
| `scripts/fileserver/run_collect-telemetry.sh` (NEW) | node-side wrapper | batch (cron tick) | `run_check-queue.sh` (md5 self-update) + live `run_nodeAuditor.sh` (venv/flock) | exact (composite) |
| `scripts/fileserver/collect_telemetry.py` (NEW) | node-side collector | batch (gather→INSERT) | live-fleet `nodeAuditor/main.py` shape only | partial (no in-repo analog) |
| `scripts/fileserver/requirements.txt` (NEW) | config | — | live `nodeAuditor/requirements.txt` (psycopg2, dotenv) | partial |
| `scripts/fileserver/nodemonDownload.sh` (MODIFY) | distribution | file-I/O (scp) | same file — `find … -name "*.sh" chmod` line | exact |
| `scripts/fileserver/updateCrontab.snippet.sh` (MODIFY: +`CRON_JOB_12`) | config/cron | — | same file — `CRON_JOB_11` constant + merge block | exact |
| `scripts/fileserver/CANARY-RUNBOOK.md` (MODIFY: +telemetry proof) | docs/runbook | — | same file — existing pre-flight + live-apply sections | exact |
| Seeded-fixture test helper (NEW, under `src/lib/read/` test scope) | test | — | `health.test.ts` skipIf + `latest.test.ts` no-DB shape | role-match |

---

## Pattern Assignments

### `src/lib/db/schema/nodemon.ts` (model, MODIFY — add 5 tables)

**Analog:** same file, the existing `commands` / `commandExecutions` / `commandAudit` defs.

**Imports pattern** (line 1) — extend the import to add the column kinds the telemetry tables need (`numeric`, `bigint`, `integer`, `index`); keep the single `drizzle-orm/pg-core` import:
```typescript
import { pgTable, pgEnum, uuid, text, jsonb, timestamp, boolean,
         numeric, bigint, integer, index } from "drizzle-orm/pg-core";
```

**Table-def pattern to mirror** (lines 41-70) — snake_case DB column ↔ camelCase TS field; `uuid("id").primaryKey().defaultRandom()` for fact tables; `timestamp(..., { withTimezone: true })` for every `collected_at`:
```typescript
export const commandExecutions = pgTable("command_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  commandId: uuid("command_id").notNull().references(() => commands.id),
  outcome: text("outcome").notNull(),
  detail: text("detail"),
  executedAt: timestamp("executed_at", { withTimezone: true }).defaultNow(),
});
```

**Apply to the 5 new tables** (RESEARCH §Schema): `hosts` (`hostId` text PK, `nodePubkeys text[]`), `serviceInventory` (uuid PK, `expectedIntervalSeconds` integer, `isExpected` boolean), `hostMetrics`, `hostStorage`, `serviceHealth`, `chainTelemetry`. Every fact table carries `collectedAt: timestamp("collected_at", { withTimezone: true })` (D-13). **Composite index per AFM-001 access pattern** (RESEARCH §Indexes) — the third-arg index callback, e.g. `(t) => [index("host_metrics_host_collected_idx").on(t.hostId, t.collectedAt.desc())]`. Bigint columns (`mem_total_kb`, `net_rx_bytes`, `size_on_disk_bytes`) use `bigint("...", { mode: "bigint" })`; raw values only (D-14 — no severity/derived columns).

**Anti-pattern note** (lines 16-21 doc-comment): commands.id has NO `defaultRandom()` (HMAC pre-sign). Telemetry has NO HMAC (D-11) — so fact tables DO use `defaultRandom()`. Do not copy the no-default discipline here.

---

### `drizzle/nodemon/0001_*.sql` + `meta/` (migration, GENERATED — never hand-write)

**Analog:** `drizzle/nodemon/0000_hard_random.sql` + `drizzle/nodemon/meta/{_journal.json,0000_snapshot.json}`.

**Generation command** (RESEARCH §Standard Stack, drizzle.nodemon.config.ts is the ONLY migrate-owned config):
```bash
npm run db:generate   # drizzle-kit generate → drizzle/nodemon/0001_*.sql + meta update
npm run db:migrate    # apply to nodemon ONLY — NEVER the warehouses
```
The generated SQL mirrors `0000_hard_random.sql` shape (`CREATE TABLE … --> statement-breakpoint`). **Do NOT** add RLS/roles/seed rows to this file — those are hand-authored in `db/role-grants.sql` + `db/seed-dimensions.sql` (CLAUDE.md: roles/RLS/grants NOT Drizzle-migrated). The migration is tables + indexes only.

---

### `db/role-grants.sql` (config/security, MODIFY — append `nodemon_telemetry` block)

**Analog:** same file, the `nodemon_node` role + RLS block (lines 90-160). The host-axis policy is a near-verbatim clone with `app.host_id` swapped in.

**Role + scoped-grant pattern** (lines 116-126) — CREATE ROLE, CONNECT, USAGE, then NAMED-table grants only (never blanket); explicit "no DELETE/TRUNCATE/DDL" comment:
```sql
CREATE ROLE nodemon_node WITH LOGIN PASSWORD '<generated-strong-password>';
GRANT CONNECT ON DATABASE nodemon TO nodemon_node;
GRANT USAGE  ON SCHEMA public TO nodemon_node;
GRANT SELECT, INSERT ON command_executions TO nodemon_node;  -- scoped, named
-- Explicitly do NOT grant DELETE/TRUNCATE/DDL anywhere (mirror the nodemon_ro rule).
```
**Telemetry variant** (RESEARCH §RLS lines 297-307): `GRANT SELECT, INSERT ON host_metrics, host_storage, service_health, chain_telemetry`; `GRANT SELECT ON hosts, service_inventory`; **plus** `GRANT DELETE` on the 4 fact tables IF the in-collector prune (D-02, recommended 21-day window) is chosen — still RLS-boxed to the node's own `host_id`.

**Two-arg fail-closed FORCE-RLS pattern** (lines 133-141) — copy exactly, swap key:
```sql
ALTER TABLE commands ENABLE ROW LEVEL SECURITY; ALTER TABLE commands FORCE ROW LEVEL SECURITY;
CREATE POLICY node_own_commands ON commands
  USING      (node_pubkey = current_setting('app.node_pubkey', true))
  WITH CHECK (node_pubkey = current_setting('app.node_pubkey', true));
```
**Host-axis variant** (RESEARCH lines 310-329): ENABLE+FORCE on all 5 new tables; `host_metrics`/`host_storage`/`chain_telemetry` keyed `host_id = current_setting('app.host_id', true)`; `service_health` adds the pubkey clause for node-scoped rows: `AND (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true))`. Two-arg `current_setting(..., true)` = NULL-on-unset = fail-closed (zero rows). **Role MUST NOT own the tables** (Pitfall 4 — FORCE RLS bypassed otherwise; migration runs as schema owner).

**Verification query pattern** (lines 157-160) — append the same `information_schema.role_table_grants` check for `nodemon_telemetry` (must list SELECT/INSERT[/DELETE] only).

---

### `db/seed-dimensions.sql` (NEW config/data-seed — D-18 one-time operator bootstrap)

**Analog:** `db/role-grants.sql` overall structure (OPERATOR-RUN, hand-authored, NOT Drizzle, run-once header comment + verification query). This is a *data* seed, not a grant, but it follows the same out-of-band discipline because the SELECT/INSERT-only telemetry role cannot INSERT dimension rows under RLS (D-18).

**Header + run-once discipline to mirror** (role-grants.sql lines 1-17): `-- OPERATOR-RUN ARTIFACT … Run ONCE against the nodemon DB as owner`. Seeds `hosts` (the canary `host_id` → its `node_pubkeys`) + `service_inventory` (the 9 graded services + `rebalance` marked `is_expected = false`). Per D-17: SVC-01 six (`aiLiquidityManager`, `internalRebalancer`, `Monitoring`, `nodeAuditor`, `addressBalances`, `channelAcceptor`) + infra trio (`bitcoind`/`esplora`/`postgres`); each row carries `detection_method`, `running_target`, `artifact_path`, `success_pattern`, `error_pattern`, `expected_interval_seconds` (RESEARCH §Service Inventory table — verbatim per-service values). End with a `SELECT … FROM service_inventory` verification.

---

### `src/lib/read/host-metrics.ts` (read-helper, NEW) — and the shape mirrors all 3 read helpers

**Analog:** `src/lib/read/latest.ts` (DISTINCT-ON builder + lazy-import executor) and `src/lib/read/node-info.ts` (typed row + `parseDbTimestampUtc` coercion).

**Builder + executor split** (latest.ts lines 24-51) — `build…Sql()` exported separately for the no-DB shape test; key ALWAYS parameter-bound via `sql` template, never concatenated:
```typescript
export function buildLatestChannelsSql(localPubkey: string): SQL {
  return sql`
    SELECT DISTINCT ON (chan_id) *
    FROM lnd_node_channel_info
    WHERE local_pubkey = ${localPubkey}
      AND chan_id IS NOT NULL
    ORDER BY chan_id, timestamp DESC`;
}
export async function latestChannelsForNode(localPubkey: string) {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildLatestChannelsSql(localPubkey));
  return result as unknown as Record<string, unknown>[];
}
```
**Telemetry variant:** `buildLatestHostMetricsSql(hostId)` → `SELECT DISTINCT ON (host_id) * … WHERE host_id = ${hostId} AND host_id IS NOT NULL ORDER BY host_id, collected_at DESC` (RESEARCH lines 481-487). **CRITICAL — never `WHERE collected_at = MAX(...)`** (AFM-001, the documented 480-read-as-1 failure). `host_storage` uses `DISTINCT ON (host_id, mount_point)`. Executor lazy-imports `dbNodemon` from `@/lib/db/nodemon` (NOT `dbRouting` — telemetry reads the RW nodemon client; see `src/lib/db/nodemon.ts` line 26 `export const dbNodemon`).

**Timestamp coercion + staleness** (node-info.ts lines 81-85, db-timestamp.ts lines 30-40) — `collected_at` is read via `parseDbTimestampUtc` (offset-less driver strings are UTC); `stale = Date.now() - collectedAt.getTime() > maxAge`. NO stored stale flag (D-13). Collector-freshness maxAge ≈ 15 min for `host_metrics`/`chain_telemetry`:
```typescript
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
// row.collected_at: string | Date | null  →  parseDbTimestampUtc(...)  →  derive stale
```

**Typed row shape** (node-info.ts lines 22-32) — declare a `LatestHostMetricsRow` interface (no `any`); bigint columns typed `bigint | number | null`, coerced through AFM-002 units, never raw arithmetic (RESEARCH line 280).

---

### `src/lib/read/service-health.ts` (read-helper, NEW)

**Analog:** `src/lib/read/node-info.ts` (typed row + coercion) + the builder/executor split above.

**Two-axis + no-data join** (RESEARCH lines 349-352): `getServiceHealth()` does `DISTINCT ON (host_id, service_name)` on `service_health` **LEFT JOIN `service_inventory`** so a declared-but-never-reported service appears as NO-DATA, not absent (SC#4). Returns `{running, functioning, stale, lastSuccessAt, errorCount}`. **"Up but dead"** = `running=true, functioning=false` must read as not-functioning (D-16 test). **Per-service freshness** uses `service_inventory.expected_interval_seconds × grace` — NOT the 15-min collector clock (RESEARCH Pitfall 1, the headline nuance). `node_pubkey` + `host_id` parameter-bound.

---

### `src/lib/read/chain-telemetry.ts` (read-helper, NEW)

**Analog:** `src/lib/read/latest.ts` DISTINCT-ON.

`getChainTelemetry()` = `DISTINCT ON (host_id)` latest `chain_telemetry`; **derives `blocks_behind = headers - blocks` at read time** (D-14 — store raw `blocks`+`headers`, never a derived column); attaches D-14 bands from `telemetry-bands.ts`. Same builder/executor/`parseDbTimestampUtc` shape as host-metrics.

---

### `src/lib/read/storage-growth.ts` (utility/pure, NEW)

**Analog:** pure-transform style of `src/lib/format/units.ts` (named exports, no server imports) — tested like `units.test.ts`.

Computes storage `%/day` growth (first-vs-last / regression over the retained window) + projected time-to-full from the `host_storage` history (D-03 discretion → RESEARCH recommends READ-time, line 178). **Honesty gate (HOST-02):** return no projection when the window is insufficient or stale. Pure + unit-testable; no DB import (caller passes the rows). Mirror the `units.ts` "single source of truth, no inline math elsewhere" doc-comment posture.

---

### `src/lib/read/telemetry-bands.ts` (config/evaluator, NEW)

**Analog:** `src/lib/insight/config.ts` — the `INSIGHT_CONFIG` typed-knobs object consumed by pure evaluators; thresholds live in config, never embedded in logic.

**Config-object pattern** (config.ts lines 108-148) — a typed `TELEMETRY_BANDS` object (healthy/warn/critical per signal) + a pure `evaluateBand(value, band)` function. Carry the same `[ASSUMED]`/`[CITED]` confidence annotations the insight config uses (lines 28-105 doc-comments cite `healthy-range-bands.md`):
```typescript
export const INSIGHT_CONFIG: Record<"lnd" | "ldk", InsightKnobs> = {
  lnd: { htlcWindowDays: 30, feeFloorPpm: 30, /* … */ },
  ldk: { /* identical literal — per-backend surface from day one */ },
};
```
**Bands to seed** (RESEARCH §Threshold Config table): disk % free (>20/10-20/<10, CITED), blocks-behind (0-1/2-6/>6), verificationprogress, peers, CPU%, mem-available. Re-tuning edits config, never re-ingests (D-14). Pure module — test-imported, safe anywhere.

---

### `src/lib/format/units.ts` (utility, MODIFY — add bytes + percent)

**Analog:** same file, the existing AFM-002 named exports.

**Existing pattern to extend** (lines 7-20) — module-level constant + named export, no inline math anywhere else:
```typescript
const SATS_PER_BTC = 100_000_000;
export function feeMsatToSat(msat: bigint | number): number { return Number(msat) / MSAT_PER_SAT; }
export function formatBtc(sats: bigint | number, dp = 4): string { return (Number(sats) / SATS_PER_BTC).toFixed(dp); }
```
**Add:** `formatBytes(bytes, …)` (bytes→GiB/TiB — never inline `/1024**3`) and `formatPercent(...)` (RESEARCH line 280: host vitals need bytes→GiB + percent; AFM-002 stays the single source of truth). Add reference-value tests mirroring `units.test.ts` (lines 7-13 `BTC_REFERENCE` table → a `BYTES_REFERENCE` table).

---

### `scripts/fileserver/run_collect-telemetry.sh` (node-side wrapper, NEW)

**Analog (composite):** `scripts/fileserver/run_check-queue.sh` (md5 self-update + cron-runner wrapper) **+** live-fleet `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/run_nodeAuditor.sh` (venv bootstrap + psycopg2 import-check + flock).

**Header + config source + log helper** (run_check-queue.sh lines 25-34):
```bash
source /lnd/bashScripts/config.sh
REMOTE_DIR="${REMOTE_HOME}/nodemon"
LOCAL_DIR="${LND_DIR}/nodemon"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*" | tee -a "${LOG_FILE}"; }
```
**md5 self-update of the payload** (run_check-queue.sh lines 41-85) — back up to `old-scripts/`, scp fresh copy, `chmod +x`, md5-compare local vs remote; here the tracked payload is `collect_telemetry.py` (+ `requirements.txt`).

**venv + flock + psycopg2 bootstrap — copy VERBATIM** (run_nodeAuditor.sh lines 28-54):
```bash
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then log "Previous run still in progress; skipping."; exit 0; fi
if [ ! -x "${VENV_DIR}/bin/python3" ]; then python3 -m venv "${VENV_DIR}"; fi
PYTHON_BIN="${VENV_DIR}/bin/python3"
if ! "${PYTHON_BIN}" -c "import psycopg2, dotenv" 2>/dev/null; then
  "${PYTHON_BIN}" -m pip install -r "${REQUIREMENTS}"; fi
"${PYTHON_BIN}" "${MAIN_SCRIPT}"
```
**Constraints:** flock guards against `*/5` pile-up; sources the **root-only env file** (DB DSN + bitcoind/pg creds) at runtime — NEVER ships secrets in the payload (D-03, Pitfall 3, the static gate greps for absence). No persistent daemon. Working dir `/lnd/nodemon`.

---

### `scripts/fileserver/collect_telemetry.py` (node-side collector, NEW — partial analog)

**Analog:** No in-repo Python exists. Mirror the live-fleet `nodeAuditor/main.py` structure referenced by `run_nodeAuditor.sh` (venv-run, psycopg2 direct INSERT, dotenv-loaded creds). NO in-repo excerpt available — flag for the planner as the one genuinely new artifact.

**Required shape (RESEARCH §Collector Mechanism lines 386-395):** each `*/5` tick — (1) SELECT `service_inventory` rows to drive the per-service detection map; (2) gather host vitals (`/proc/stat`, `/proc/meminfo`, `df -P -B1`, `/proc/net/dev`, `/proc/uptime` — RESEARCH §Host-Vitals table), two-axis service health (`systemctl is-active` / `pgrep -f` / log-mtime per `detection_method`), bitcoind/esplora/pg probes (RESEARCH §bitcoind — `BITCOIND_RPCHOST` from env, never hardcode port 8332); (3) `SET LOCAL app.host_id` + `SET LOCAL app.node_pubkey` inside the insert txn (mirrors Phase-8 GUC scoping, role-grants.sql line 108 comment); (4) INSERT one tick across the 4 fact tables; (5) in-collector prune `DELETE … WHERE collected_at < now() - interval '21 days'`.

**Security constraints (verbatim):** argv subprocess invocation, NEVER shell-string (V5/EXEC-02 injection rule); parameter-bound SQL (AFM-001 discipline); never log RPC pass / DSN (CLAUDE.md). Stores RAW observed values only (D-14) — no thresholds, no derived `blocks_behind`, no stale flag.

---

### `scripts/fileserver/nodemonDownload.sh` (distribution, MODIFY — minimal)

**Analog:** same file. It already `scp -r`'s the whole `~/nodemon` folder (line 37), so `collect_telemetry.py` is picked up automatically. Only confirm the executable-mark line covers the new wrapper:
```bash
find "${LOCAL_DIR}" -type f \( -name "check-queue" -o -name "apply-fee" -o -name "*.sh" \) -exec sudo chmod +x {} \;
```
`run_collect-telemetry.sh` matches `*.sh` already; `collect_telemetry.py` runs via the venv python, so it needs no `+x`. Likely **no change required** — verify and note.

---

### `scripts/fileserver/updateCrontab.snippet.sh` (config/cron, MODIFY — add `CRON_JOB_12`)

**Analog:** same file, the `CRON_JOB_11` constant + idempotent `grep -Fxq` merge (lines 23-29):
```bash
CRON_JOB_11="*/5 * * * * /lnd/bashScripts/run_check-queue.sh >> /lnd/nodemon/check-queue.log 2>&1"
if ! grep -Fxq "${CRON_JOB_11}" "${TEMP_CRON_FILE}"; then
    echo "${CRON_JOB_11}" >> "${TEMP_CRON_FILE}"
fi
```
**Add (RESEARCH line 390):**
```bash
CRON_JOB_12="*/5 * * * * /lnd/bashScripts/run_collect-telemetry.sh >> /lnd/nodemon/collect-telemetry.log 2>&1"
```
plus its own `grep -Fxq` merge block. 12 is the next free slot after the Phase-8 `CRON_JOB_11`. Keeps the merge idempotent across every 30-min downloader tick.

---

### `scripts/fileserver/CANARY-RUNBOOK.md` (docs/runbook, MODIFY)

**Analog:** same file — the existing `## 1. PRE-FLIGHT` (role-grants apply + `.nodemon.env`), `## 3. LIVE-APPLY` (force a tick / confirm on-node), `## PASS criteria` sections. Add a telemetry section mirroring that structure: (a) apply `db/seed-dimensions.sql` on the canary BEFORE the collector's first tick (D-18); (b) place `nodemon_telemetry` DSN + bitcoind/pg creds + esplora endpoint in the root-only env file; (c) force a `*/5` collect tick and assert real host/service/bitcoind rows land + are queryable (D-16 live proof); (d) PASS gate = rows present + read helpers return latest-per-entity + derived staleness.

---

### Seeded-fixture test helper (test, NEW)

**Analog:** `src/lib/db/health.test.ts` (live-DB skipIf guard) + `src/lib/read/latest.test.ts` (no-DB shape test via `PgDialect`).

**No-DB shape test pattern** (latest.test.ts lines 10-41) — render the builder's SQL and assert DISTINCT-ON, never MAX(, param-binding ($1):
```typescript
const dialect = new PgDialect();
const built = dialect.sqlToQuery(buildLatestHostMetricsSql(hostId));
expect(built.sql.toLowerCase()).toContain("distinct on (host_id)");
expect(built.sql.toLowerCase()).not.toContain("max(");
expect(built.params).toContain(hostId);  // bound, not concatenated
```
**Live-DB skipIf pattern** (health.test.ts lines 33-41) — gate seeded-fixture tests behind the nodemon URL so they skip cleanly without a DB:
```typescript
describe.skipIf(!process.env.NODEMON_QUEUE_URL)("seeded nodemon reads", () => { ... });
```
Seed the stale-row / never-reported-host / up-but-dead-service fixtures (D-16) into the test nodemon, assert each derives correctly.

---

## Shared Patterns

### Latest-per-entity (AFM-001) — apply to ALL 3 read helpers
**Source:** `src/lib/read/latest.ts` (lines 24-36), `node-info.ts` (lines 39-52)
**Apply to:** `host-metrics.ts`, `service-health.ts`, `chain-telemetry.ts`
`SELECT DISTINCT ON (<entity_key>) … ORDER BY <entity_key>, collected_at DESC` with `<key> IS NOT NULL`. **NEVER `WHERE collected_at = MAX(...)`** (the documented 480-read-as-1 failure). Builder exported separately for the no-DB shape test; key parameter-bound via `sql` template.

### Read-time staleness, never stored (D-13)
**Source:** `src/lib/read/db-timestamp.ts` (`parseDbTimestampUtc`, lines 30-40)
**Apply to:** all 3 read helpers
Coerce `collected_at` through `parseDbTimestampUtc` (offset-less driver strings are UTC — host-local parse skewed the Phase-2 stale flag by the host's TZ offset), then `stale = now - collectedAt > maxAge`. No stored `stale`/`fresh` column (it lies the moment the collector dies). Two clocks: ~15-min collector-freshness for host/chain; per-service `expected_interval_seconds` for service functioning.

### Two-arg fail-closed FORCE-RLS (D-04)
**Source:** `db/role-grants.sql` (lines 133-149)
**Apply to:** all 5 new tables in the `nodemon_telemetry` block
`ENABLE` + `FORCE` RLS; `USING` + `WITH CHECK` both keyed on `current_setting('app.<key>', true)` (two-arg → NULL-on-unset → zero rows). Role MUST NOT own the tables (Pitfall 4). Connection sets `SET LOCAL app.host_id` / `app.node_pubkey`.

### Unit conversion single-source (AFM-002)
**Source:** `src/lib/format/units.ts` (lines 1-20)
**Apply to:** every byte/percent/sat value any read helper or the collector echoes
No inline `/1024**3`, `/1e8`, or `%` math anywhere — route through `units.ts` named exports (extend with bytes/percent). Collector stores raw, so this is read-side; bigint columns coerce through the formatter, never raw arithmetic.

### Hand-authored DB artifacts, NOT Drizzle-migrated
**Source:** `db/role-grants.sql` header (lines 1-17)
**Apply to:** `db/role-grants.sql` extension + `db/seed-dimensions.sql`
Roles, RLS, grants, and dimension seeds are operator-run, run-once, hand-authored with a verification query. Drizzle (`drizzle/nodemon/`) owns tables + indexes ONLY. `nodemon` is the only generate/migrate DB; warehouses are read-only.

### No-secret-in-payload + no-daemon node posture (D-03/D-11)
**Source:** `scripts/fileserver/run_check-queue.sh` (lines 16-19), `nodemonDownload.sh` (lines 11-15)
**Apply to:** `run_collect-telemetry.sh`, `collect_telemetry.py`
Secrets (DSN, bitcoind/pg creds) live in the root-only env file, sourced at runtime, NEVER shipped over scp (the static gate greps for absence). Cron + pre-downloaded scripts only — no persistent daemon/agent/AI. Telemetry needs NO HMAC (read-only observation; RLS + least-privilege role is the integrity boundary).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/fileserver/collect_telemetry.py` | collector | batch | No in-repo Python exists. Structure mirrors the live-fleet `nodeAuditor/main.py` (venv + psycopg2 + dotenv) referenced by `run_nodeAuditor.sh`, but there is no in-repo excerpt to copy — planner should treat the collector body as the one genuinely new artifact, built against the RESEARCH §Collector Mechanism / §Host-Vitals / §bitcoind specs. The *wrapper* (`run_collect-telemetry.sh`) has a strong composite analog; only the Python payload is new. |
| `scripts/fileserver/requirements.txt` | config | — | Trivial; mirror the live `nodeAuditor/requirements.txt` (`psycopg2-binary`, `python-dotenv`). No in-repo file. |

---

## Metadata

**Analog search scope:** `src/lib/read/`, `src/lib/db/`, `src/lib/db/schema/`, `src/lib/format/`, `src/lib/insight/`, `drizzle/nodemon/`, `db/`, `scripts/fileserver/`, and the live-fleet tree `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/`.
**Files scanned:** 16 read first-hand (schema, latest.ts, node-info.ts, db-timestamp.ts, latest.test.ts, units.ts, units.test.ts, role-grants.sql, health.test.ts, nodemon.ts, nodes.ts, insight/config.ts, 0000_hard_random.sql, drizzle.nodemon.config.ts, run_check-queue.sh, nodemonDownload.sh, updateCrontab.snippet.sh, CANARY-RUNBOOK.md, live run_nodeAuditor.sh).
**Pattern extraction date:** 2026-06-25
</content>
</invoke>
