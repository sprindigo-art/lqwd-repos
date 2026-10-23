# Phase 15: Data Collection Expansion — Logs + Deep VM Metrics - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 12 (3 modify, 9 create)
**Analogs found:** 12 / 12 (every new file has a shipped in-repo analog — this phase is transcription + field-widening, not novel design)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/fileserver/collect_telemetry.py` (MODIFY) | collector (Python) | batch / event-driven | itself — extend `grade_log_service` + `write_tick` + `_prune` | exact (self-extend) |
| `src/lib/db/schema/nodemon.ts` (MODIFY) — 8 new tables | model / schema | CRUD (append-history + 1 upsert + 1 config) | shipped facts `hostMetrics` / `hostStorage` / `serviceInventory` in same file | exact |
| `drizzle/nodemon/0003_*.sql` (CREATE) | migration | DDL | `drizzle/nodemon/0001_telemetry_tables.sql` | exact |
| `db/role-grants.sql` (MODIFY) — grants+RLS for new tables | config / security | request-response (DB role) | `nodemon_telemetry` block in same file (lines 162-258) | exact |
| `db/seed-log-patterns.sql` (CREATE) | config / seed | batch | `db/seed-dimensions.sql` | exact |
| `src/lib/read/service-log-events.ts` (CREATE) | service / reader | request-response (read) | `src/lib/read/host-metrics.ts` + `chain-telemetry.ts` (benign-join twist) | role+flow match |
| `src/lib/read/host-metrics-ext.ts` (CREATE) | service / reader | request-response (read) | `src/lib/read/host-metrics.ts` (scalar) + `buildLatestHostStorageSql` (child facts) | exact |
| `src/lib/read/pg-health.ts` (CREATE) | service / reader | request-response (read) | `src/lib/read/chain-telemetry.ts` (band-at-read + counter derivation) | exact |
| `src/lib/read/telemetry-bands.ts` (MODIFY) | config / utility | pure transform | itself — add band entries | exact (self-extend) |
| `src/lib/insight/detectors/ap12-advisory.ts` (MODIFY/RETIRE) | service / detector | transform | itself — preserve signal-ids + placeholder contract | exact (self-extend) |
| `src/components/node/NodeLogsStream.tsx` (feed only — no code change) | component (Client) | request-response (render) | already built; swap point is the parent page | exact |
| `src/components/service/ServiceLogTail.tsx` (feed only — no code change) | component (Client) | request-response (render) | already built; swap point is the parent page | exact |
| `src/app/(overview)/[pubkey]/page.tsx` (MODIFY — un-stub) | route / page (RSC) | request-response | itself, line 347 `logs: []` swap point | exact |
| `src/app/(overview)/[pubkey]/service/[service]/page.tsx` (MODIFY — un-stub) | route / page (RSC) | request-response | itself, line 250 `logRows: []` swap point | exact |

---

## Pattern Assignments

### `scripts/fileserver/collect_telemetry.py` (collector, batch/event-driven) — MODIFY

**Analog:** itself (self-extend). Never build a new rail; extend the existing functions.

**argv-only subprocess helper** (lines 59-67) — reuse VERBATIM for new `nproc`/`ss`/`systemctl`/`chronyc`/`df -i` calls. EXEC-02: NEVER `shell=True`.
```python
def run_argv(argv, timeout=10):
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
        return proc.returncode, proc.stdout, proc.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as exc:
        return 1, "", str(exc)
```

**procfs read idiom to mirror for deep metrics** (lines 130-170) — `gather_meminfo` (extend with `Cached`/`Buffers`/`Dirty`/`Slab`), `gather_net_bytes` (extend per-iface `errs`/`drop`, keyed by iface, skip `lo`). Every gatherer is wrapped in `except (OSError, ValueError, IndexError)` and returns `None` on failure (honest no-data). Copy this exact defensive shape for `/proc/stat` per-core, `/proc/diskstats`, `/proc/vmstat`, `/proc/net/snmp`, `/proc/sys/fs/file-nr`.

**df-style child-row gatherer** (lines 193-217) — `gather_host_storage` returns a LIST of dicts (one per mount). This is the exact template for the new `host_cpu_core` / `host_disk_io` / `host_net_iface` child gatherers (one dict per core/device/iface).

**The discard point to fix — `grade_log_service`** (lines 272-302). Today line 289-290 does `error_count = text.count(error)` and throws the matched lines away. The `text` (tailed 64 KB) and `error` pattern are already in scope. Insert here: iterate matched lines, capture ±5 context (D-01), `hashlib.sha256(normalized)` signature (D-02), classify via `log_patterns_config` (record BOTH the matched row's `classification` AND its `id` as `config_id`; unmatched → `other`/NULL), build event dicts. RESEARCH §"Pattern 1" gives the `_normalize` + `extract_events` shape.

**inventory read (for `log_patterns_config`)** (lines 342-355) — `fetch_inventory` is the exact parameter-bound SELECT + `conn.rollback()` idiom to copy for reading `log_patterns_config` (dimensions are RLS-free / SELECT-only). Do a second such read for the patterns config each tick.

**Parameter-bound INSERT idiom** (lines 467-524) — `_insert_host_metrics` / `_insert_host_storage` (loop) / `_insert_chain`. All use psycopg2 `%s` placeholders, NEVER f-string/.format (SQLi rule, T-11-08). Copy verbatim structure for `_insert_host_metrics_ext`, `_insert_children` (loop like `_insert_host_storage`), `_insert_pg_health`, `_insert_log_events`.

**`log_patterns` UPSERT (D-03)** — new idiom, still parameter-bound. Conflict key `(host_id, signature)`:
```python
cur.execute(
    "INSERT INTO log_patterns (host_id, signature, service_name, first_seen, "
    "last_seen, count_window, sample_message, classification) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
    "ON CONFLICT (host_id, signature) DO UPDATE SET "
    "last_seen = EXCLUDED.last_seen, "
    "count_window = log_patterns.count_window + EXCLUDED.count_window, "
    "classification = EXCLUDED.classification",
    (host_id, sig, service, now, now, n_this_tick, sample, classification))
```
NOTE: this UPSERT needs `UPDATE` on `log_patterns` — a privilege the telemetry role does NOT currently hold (see Shared Patterns → DB grants).

**RLS write transaction — `write_tick`** (lines 535-545). The single `with conn:` txn does `SET LOCAL app.host_id` + `SET LOCAL app.node_pubkey` THEN all inserts THEN `_prune`. ALL new inserts (`host_metrics_ext`, children, `pg_health`, log events, `log_patterns` upsert) MUST go inside this same txn, after the two `SET LOCAL` lines — otherwise FORCE RLS fail-closes the insert to zero rows (RESEARCH Pitfall 2).

**Retention prune — `_prune`** (lines 527-532). Today a blunt `DELETE ... WHERE collected_at < now() - interval '21 days'` over a fixed table allow-list. Extend to `_prune_tiered` (keep-N-exemplars + classification-tiered windows, D-08) for `service_log_events`; NEVER time-prune `log_patterns` (aggregate kept forever). Add the new fact tables to the plain-21-day allow-list `PRUNE_TABLES` (line 464). Table names stay from the fixed allow-list, never user input.

---

### `src/lib/db/schema/nodemon.ts` (model, 8 new pgTables) — MODIFY

**Analog:** the shipped fact tables in the SAME file — `hostMetrics` (152-174), `hostStorage` (179-198, the child-fact template), `serviceInventory` (130-147, the config/dimension template).

**Fact-table shape to mirror** (lines 152-174) — every new fact gets: `id: uuid().primaryKey().defaultRandom()` (telemetry has NO HMAC, D-11 — unlike `commands.id`), `hostId: text().notNull()` (RLS axis), `collectedAt: timestamp({withTimezone:true}).notNull()` (D-13), RAW numeric/bigint columns (NO severity/bands/stale — D-14), and TWO indexes:
```typescript
(t) => [
  index("host_metrics_host_collected_idx").on(t.hostId, t.collectedAt.desc()),
  index("host_metrics_collected_idx").on(t.collectedAt),   // keeps the retention DELETE cheap
]
```

**Child-fact keying (MANDATORY for per-core/-device/-iface)** — copy `hostStorage`'s composite index EXACTLY (lines 190-197). The entity key is `(host_id, <dim>, collected_at DESC)`, NOT `(host_id, collected_at)` — otherwise the DISTINCT-ON reader collapses N children to 1 (RESEARCH Pitfall 4):
```typescript
index("host_disk_io_host_device_collected_idx").on(t.hostId, t.device, t.collectedAt.desc())
// host_cpu_core → (hostId, coreIndex, collectedAt.desc())
// host_net_iface → (hostId, iface, collectedAt.desc())
```

**Config/dimension table (`log_patterns_config`)** — mirror `serviceInventory` (130-147): `id` uuid pk + text columns for `matchExpression` / `level` / `classification` / `suppress: boolean`. It is a DIMENSION (seeded out-of-band, SELECT-only to the collector), NOT a fact — no `collectedAt`, no RLS write policy needed beyond SELECT. The collector records the matched row's `id` on each event as `service_log_events.config_id` (Plan 06) so the reader resolves `suppress` per matched pattern via a `c.id = e.config_id` join (Plan 03) — never a classification join.

**`log_patterns` aggregate** — needs a UNIQUE constraint on `(host_id, signature)` to back the ON CONFLICT upsert. Draft cols per D-02/RESEARCH: `signature, service_name, first_seen, last_seen, count_window, sample_message, classification` + `hostId` RLS axis.

**`pg_health` fact** — RAW cumulative counter columns per RESEARCH §COL-02: `max_connections`, `active_connections`, `datname`, `xact_commit`/`xact_rollback`/`deadlocks`/`numbackends` (bigint), `too_many_clients_count`/`serialization_40001_count`/`fatal_count` (bigint), plus `stats_reset: timestamp` (Pitfall 7 — clamp Δ≥0 at read). NO a/b verdict stored — derived at read.

Column names are snake_case in DB ↔ camelCase in TS (per file convention, comment line 35).

---

### `drizzle/nodemon/0003_*.sql` (migration) — CREATE

**Analog:** `drizzle/nodemon/0001_telemetry_tables.sql` (whole file).

Generated by `drizzle-kit generate` (nodemon is the ONLY Drizzle-migrated DB). The 0001 file is the exact idiom: `CREATE TABLE ... id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL`, `host_id text NOT NULL`, `collected_at timestamp with time zone NOT NULL`, then `--> statement-breakpoint` between statements, then the composite `CREATE INDEX ... USING btree ("host_id","<dim>","collected_at" DESC NULLS LAST)` (lines 80-87). The migration DOES NOT contain RLS/grants — those are hand-authored in `db/role-grants.sql` (see schema comment lines 108-110). Do NOT let drizzle own the warehouses; migrate nodemon only.

---

### `src/lib/read/service-log-events.ts` (reader) — CREATE

**Analog:** `src/lib/read/host-metrics.ts` (execute/lazy-import/shape) + `chain-telemetry.ts` (benign filter is the new twist).

**Lazy dbNodemon import + execute** (host-metrics.ts lines 146-156) — copy exactly so the no-DB shape test can import the SQL builders without a live pool:
```typescript
const { dbNodemon } = await import("@/lib/db/nodemon");
const rows = (await dbNodemon.execute(buildServiceLogEventsSql(hostId, service))) as unknown as Row[];
```

**Benign suppression at read time (D-04)** — the ONE net-new SQL shape. LEFT JOIN `log_patterns_config` on the event's `config_id` (the matched-pattern PRIMARY KEY) and drop `suppress = true` rows AT READ, never at write. Join on `config_id`, NOT on `classification`: a classification does not uniquely determine `suppress` (the `benign` class holds both suppress=true BP-rows and the suppress=false `40001` row; `critical` holds 5 rows), so a classification join would invert suppression (BP-001 leaks) and fan out rows (critical rendered 5×). The `config_id` PK join is 1:1. Parameter-bound via `sql\`\``:
```typescript
export function buildServiceLogEventsSql(hostId: string, service: string | null): SQL {
  return sql`
    SELECT e.*
    FROM service_log_events e
    LEFT JOIN log_patterns_config c ON c.id = e.config_id   -- matched-pattern PK (1:1), NOT classification
    WHERE e.host_id = ${hostId} AND e.host_id IS NOT NULL
      ${service ? sql`AND e.service_name = ${service}` : sql``}
      AND COALESCE(c.suppress, false) = false
    ORDER BY e.collected_at DESC
    LIMIT 500`;
}
```
This is a log STREAM (not latest-per-entity) so it orders `collected_at DESC LIMIT N`, unlike the DISTINCT-ON facts. Map output to the `NodeLogLine` shape (id, service, ts, level, message, aiRead?).

**Staleness derivation** (host-metrics.ts lines 136-139) — reuse `deriveStale(collectedAt)` pattern for "data as of" honesty.

---

### `src/lib/read/host-metrics-ext.ts` (reader) — CREATE

**Analog:** `src/lib/read/host-metrics.ts` — scalar via `buildLatestHostMetricsSql` (72-82), children via `buildLatestHostStorageSql` (88-96).

**Latest-per-host scalar (AFM-001 — MANDATORY, NEVER `WHERE collected_at = MAX(...)`)** (lines 72-82):
```typescript
export function buildLatestHostMetricsExtSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id) *
    FROM host_metrics_ext
    WHERE host_id = ${hostId} AND host_id IS NOT NULL
    ORDER BY host_id, collected_at DESC`;
}
```

**Child facts key on `(host_id, <dim>)`** (lines 88-96 — the storage template):
```typescript
// host_cpu_core:  DISTINCT ON (host_id, core_index) ... ORDER BY host_id, core_index, collected_at DESC
// host_disk_io:   DISTINCT ON (host_id, device)     ... ORDER BY host_id, device, collected_at DESC
// host_net_iface: DISTINCT ON (host_id, iface)      ... ORDER BY host_id, iface, collected_at DESC
```
Group child rows into a `Map<hostId, Row[]>` at the JS layer (host-metrics.ts lines 159-168 shows the storage grouping). Counter-reset clamp (Δ≥0) for cumulative counters — same discipline the module notes for net counters.

---

### `src/lib/read/pg-health.ts` (reader) — CREATE

**Analog:** `src/lib/read/chain-telemetry.ts` — `buildChainEvidence` (119-145) is the RAW→derived-at-read template.

**Band/verdict derivation at read (D-14)** — mirror `buildChainEvidence`: a PURE function taking the RAW `pg_health` row and returning `{ ap12aRatio, ap12bBand, verdict }`. The AP-12a-vs-b discriminator (high `serialization_40001_count` + low `too_many_clients_count` ⇒ AP-12b; high `too_many_clients_count` ⇒ AP-12a) is DERIVED here, never stored. Use `evaluateBand` from `telemetry-bands.ts` (chain-telemetry.ts line 137 shows the call). The 40001 rate-band (benign 400-800/day → ap12 at ≥10×, BP-005) is a read-time band, NOT a stored classification.

**Latest-per-host DISTINCT ON** — same fragment as host-metrics-ext above.

---

### `src/lib/read/telemetry-bands.ts` (config) — MODIFY

**Analog:** itself. Add entries to the `TELEMETRY_BANDS` object (lines 45+) following the existing `TelemetryBand` shape: `{ direction: "higher-worse"|"higher-better", healthy, warn, note: "[CITED: Healthy Range Bands.md ...]" }`. New bands per RESEARCH §COL-03: steal%, iowait%, retransmit rate, 40001 rate (≥10× baseline), disk% free (already exists), PG conn <80% of max, OOM/EXT4 hard-zero. Pure module — no DB imports; unit-tested directly.

---

### `src/lib/insight/detectors/ap12-advisory.ts` (detector) — MODIFY / RETIRE

**Analog:** itself. Once `pg_health` + PG lines land, replace the LLM advisory with a deterministic detector. **Preserve the contract** (RESEARCH retirement contract): keep the exported `AP12_NO_DATA_PLACEHOLDER` string (line 34) and the signal ids `ap12a_conn_exhaustion` / `ap12b_serialization` (lines 84, 135-137). The new deterministic detector reads `too_many_clients_count` / `serialization_40001_count` from `pg_health` + connection-saturation ratio. Keep the `InsightCard` output shape (lines 88-110) and the untrusted-data delimiter discipline (`DATA_OPEN`/`DATA_CLOSE`, lines 53-54) if any log text is still narrated.

---

### `src/components/node/NodeLogsStream.tsx` + `src/app/(overview)/[pubkey]/page.tsx` — un-stub feed

**No component change needed** — `NodeLogsStream` (whole file) already renders `NodeLogLine[]` and shows an honest empty state when `logs` is empty. The swap point is the PARENT PAGE:
- `src/app/(overview)/[pubkey]/page.tsx` **line 347**: `logs: []` → `logs: await getServiceLogEvents(hostId, null, window)` mapped to `NodeLogLine`.
- Line 37 already imports `NodeLogsStream, type NodeLogLine`; line 451 renders `<NodeLogsStream logs={logs} />`.
- Follow the page's existing fail-soft `.catch(() => [])` per-section pattern (lines 323-330) so a broken reader degrades to honest-empty, never a page crash.

`NodeLogLine` target shape (NodeLogsStream.tsx lines 27-43): `{ id, service, ts (pre-formatted string), level: "info"|"warn"|"error", message, aiRead? }`. The reader/page does ALL formatting (ts, ordering) — the component does no unit math.

---

### `src/components/service/ServiceLogTail.tsx` + `service/[service]/page.tsx` — un-stub feed

**No component change needed** — `ServiceLogTail` already renders `rows` + honest empty state. Swap point:
- `src/app/(overview)/[pubkey]/service/[service]/page.tsx` **line 250**: `const logRows: Record<string, string>[] = []` → `getServiceLogEvents(hostId, canonicalService, window)` mapped to `{ time, level, message }` string rows (column keys from `LOG_COLUMNS`, ServiceLogTail.tsx lines 27-31).
- Line 310 already renders `<ServiceLogTail rows={logRows} aiLines={aiLines} />`.
- Reads happen STRICTLY AFTER the PUBKEY_RE / SERVICE_SLUG_RE validation gauntlet (page lines 123-124) and use `hostId` (parameter-bound), never the raw service segment in SQL.

**Deep-VM feed:** `VmVitals` consumes `VmVitalChart[]` (VmVitals.tsx lines 36-60); the page already builds it via `buildHostVitals` (page lines 320-331). Feed new `host_metrics_ext` reader output through the same serializable-prop path — add per-core/disk/net charts as new `VmVitalChart` entries.

---

## Shared Patterns

### RLS write path (host_id fail-closed)
**Source:** `db/role-grants.sql` `nodemon_telemetry` block (lines 200-247) + `collect_telemetry.py write_tick` (535-545).
**Apply to:** every new fact table (`service_log_events`, `log_patterns`, `host_metrics_ext`, `host_cpu_core`, `host_disk_io`, `host_net_iface`, `pg_health`).
```sql
ALTER TABLE host_metrics_ext ENABLE ROW LEVEL SECURITY; ALTER TABLE host_metrics_ext FORCE ROW LEVEL SECURITY;
CREATE POLICY tel_own_host_metrics_ext ON host_metrics_ext
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
```
TWO-ARG `current_setting(..., true)` returns NULL when the GUC is unset → policy false → fail-closed (zero rows). `service_log_events` carries `node_pubkey` too → copy the `tel_own_service` compound policy (role-grants.sql lines 243-247) which allows NULL node_pubkey for host-level services. The migration must run as schema OWNER; the telemetry role must NOT own the tables or FORCE RLS is bypassed.

### DB role grants (least-privilege, the flagged UPDATE pitfall)
**Source:** `db/role-grants.sql` lines 205-214.
**Apply to:** `db/role-grants.sql` extension for the new tables.
```sql
-- New facts: append + prune only (mirror the existing 4-table grant, line 207)
GRANT SELECT, INSERT, DELETE ON service_log_events, host_metrics_ext, host_cpu_core,
  host_disk_io, host_net_iface, pg_health TO nodemon_telemetry;
-- log_patterns is the ONE exception — the D-03 UPSERT needs UPDATE (a NEW privilege
-- the role currently lacks; SQLSTATE 42501 on first tick without it — RESEARCH Pitfall 1):
GRANT SELECT, INSERT, UPDATE, DELETE ON log_patterns TO nodemon_telemetry;
-- Config dimension: SELECT only (seeded out-of-band, like hosts/service_inventory line 211):
GRANT SELECT ON log_patterns_config TO nodemon_telemetry;
```
Keep the raw facts UPDATE-free; grant UPDATE on `log_patterns` ONLY. No TRUNCATE/DDL anywhere. Add the VERIFICATION SELECT (lines 255-258) coverage.

### Out-of-band seed (config table)
**Source:** `db/seed-dimensions.sql` (header + INSERT idiom, lines 1-40).
**Apply to:** `db/seed-log-patterns.sql` (new). OPERATOR-RUN, hand-authored DATA seed — NOT a Drizzle migration, NOT collector self-seed (the SELECT-only role physically cannot INSERT config rows under RLS). Transcribe the RESEARCH §"Obsidian Seed Data" table (BP-001…008 + AP-11/12 signatures) into `INSERT INTO log_patterns_config (match_expression, service, level, classification, suppress) VALUES (...)`.

### Latest-per-entity read (AFM-001 — MANDATORY)
**Source:** `src/lib/read/host-metrics.ts` (72-96) + module comment (11-13).
**Apply to:** every new fact reader. `SELECT DISTINCT ON (entity_key…) * … ORDER BY entity_key…, collected_at DESC`. NEVER `WHERE collected_at = (SELECT MAX(...))` (AFM-001 480-as-1 fan-in failure). Child facts key on `(host_id, <dim>)`. `service_log_events` is the exception (a stream: `ORDER BY collected_at DESC LIMIT N`).

### RAW storage → bands at read time (D-14)
**Source:** `src/lib/read/chain-telemetry.ts buildChainEvidence` (119-145) + `telemetry-bands.ts` (whole).
**Apply to:** `pg-health.ts`, `host-metrics-ext.ts`, band additions in `telemetry-bands.ts`. DB stores RAW counters/lines only; a PURE evaluator attaches `{ value, band }` at read. NEVER store `is_critical`/severity/stale — re-tuning a band must never re-ingest history.

### Parameter-bound SQL everywhere (SQLi mitigation)
**Source:** psycopg2 `%s` placeholders (collect_telemetry.py 467-524) + Drizzle `sql\`${x}\`` binding (host-metrics.ts 75-82).
**Apply to:** all new inserts and readers. Log content + service names are UNTRUSTED (ASVS V5) — never f-string/.format/string-concat into SQL. Truncate `message` ≤8 KB; render as React-escaped inert text (EventTable already does).

---

## No Analog Found

None. Every file has a shipped in-repo analog. The only NET-NEW logic (no direct analog, but bounded) is:
| Concern | Nearest guide | Note |
|---------|--------------|------|
| Line normalization → signature hash | RESEARCH §Pattern 1 `_normalize` | stdlib `hashlib.sha256`; the only real design work (tune regex vs France/Japan excerpts, A4) |
| keep-N + tiered retention prune | extends `_prune` (527-532) | new eviction logic per D-08; no in-repo analog for the tiering |
| benign read-time JOIN | extends host-metrics reader | the LEFT JOIN `log_patterns_config` is new SQL shape |

## Metadata

**Analog search scope:** `scripts/fileserver/`, `src/lib/db/schema/`, `drizzle/nodemon/`, `db/`, `src/lib/read/`, `src/lib/insight/detectors/`, `src/components/node/`, `src/components/service/`, `src/app/(overview)/[pubkey]/`.
**Files scanned:** 12 analog files read in full or in targeted range.
**Pattern extraction date:** 2026-07-14
</content>
</invoke>
