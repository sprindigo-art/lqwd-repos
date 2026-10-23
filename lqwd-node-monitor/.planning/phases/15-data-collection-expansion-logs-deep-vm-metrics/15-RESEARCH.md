# Phase 15: Data Collection Expansion — Logs + Deep VM Metrics - Research

**Researched:** 2026-07-14
**Domain:** Node-side telemetry collection (Python/psycopg2 collector) + Postgres schema design (Drizzle) + Next.js read-layer/UI un-stub
**Confidence:** HIGH (all findings verified against local codebase + the operator's Obsidian log-review library; no new external dependencies)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Persist **matched error/warn line + ±5 context lines** each (before + after), to capture multi-line PG/LND stack traces. NOT an unbounded tail — "signal, not firehose."
- **D-02:** **Both** a raw-events table (`service_log_events`) AND a derived pattern-aggregate table (`log_patterns`). Draft `service_log_events` columns: `id, host_id, service_name, node_pubkey, collected_at, level, message, signature (hash of normalized line), classification, source_path` + a context-line linkage mechanism (resolve in plan). RLS on `host_id`. Draft `log_patterns`: `signature, first_seen, last_seen, count_window, sample_message, classification`.
- **D-03:** Collector **upserts `log_patterns` per `*/5` tick** — bumps `count_window`/`last_seen`, sets `classification` from the config table (D-05). Guarantees a recurring signature's *fact* survives even when raw exemplars are evicted.
- **D-04:** **Persist everything, filter benign at read time.** Collector persists ALL matched lines each tagged with a `classification`; known-benign suppression happens in the **read layer**, never the collector. Rationale: RAW-everything posture (D-14); benign rules re-tunable retroactively with no fleet redeploy.
- **D-05:** **Pattern definitions live in a `nodemon` config table** (e.g. `log_patterns_config`: match expression, level, `classification`), seeded from the Obsidian library. Collector reads it to classify; read layer reads it to suppress benign. Tunable via SQL, no code/collector redeploy.
- **D-06:** **Deep VM metrics → a NEW `host_metrics_ext` fact** (do NOT widen shipped `host_metrics`). Hybrid: host-wide scalars on `host_metrics_ext`; variable-cardinality per-core CPU / per-device disk / per-iface net → **child facts** (`host_cpu_core`, `host_disk_io`, `host_net_iface`) keyed by `host_id + collected_at`. Also collect `nproc` (core count).
- **D-06a:** **Dedicated `pg_health` fact** for `pg_stat_activity`/database counters + AP-12 signature flags. PG *log lines* still flow into `service_log_events` (complementary sources).
- **D-06b:** All values stored **RAW** (D-14) — severity/bands derived at read time, never at collection.
- **D-07:** **No hard per-tick ceiling that silently drops data.** Never lose examples of important information.
- **D-08:** **Priority-aware retention = keep-N-exemplars per signature AND classification-tiered windows (both combined):** aggregate kept forever; up to N raw exemplars per signature (first-seen + newest); redundant middle copies of high-frequency/benign evicted first; retention window keyed by `classification` (benign short, warn/AP-11 longer, AP-12/critical indefinite). Tune N + windows in plan.
- **D-09:** **Canary-first, then roll the fleet together.** Land collection + schema + readers + un-stubbed UI on the canary, prove end-to-end, THEN splice all ~26 nodes. Fleet splice is its own rollout step.
- **D-10:** New readers in `src/lib/read/`: `getServiceLogEvents(hostId/pubkey/service, window)` (applies benign read-time filter), `host_metrics_ext` readers, a `pg_health` reader. Un-stub `NodeLogsStream` + `ServiceLogTail`; feed deep VM metrics into VmVitals/host detail. Honor "data as of"/stale states.
- **D-11:** Obsidian `LQWD Node Log Reviews` library is a **build-time reference ONLY** — source of truth for *which* patterns matter. Read to seed the config table + design the classifier, then everything is DB-resident. Zero runtime dependency on the vault.

### Claude's Discretion

- Exact `host_metrics_ext` scalar-vs-child-fact split and full column lists (D-06).
- Exact N (exemplars/signature) and per-classification retention windows (D-08).
- The `/proc`/`/sys` source list per metric — confirm Ubuntu norms (this research resolves it).
- Context-line linkage mechanism in `service_log_events` (D-01/D-02).
- Whether classification enum values beyond {benign, warn, ap11, ap12, critical, other} are needed once the Obsidian library is transcribed.

### Deferred Ideas (OUT OF SCOPE)

- **Dashboard auto-refresh heartbeat** — scheduled AFTER this phase (needs live data to refresh against).
- **Fleet-wide collector splice** — a rollout step after the canary proves the design (D-09).
- **AIX-02 narration + infra→HTLC impact edge** — Phase 16; derivable from existing warehouse data, not a collection gap.
- Node-detail all-channels + per-channel fee queue; fleet-console UI polish — belong to other phases.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COL-01 | Service log/error events (level, message, service, host, node, ts, normalized signature) persisted into a bounded, retention-capped `nodemon` table at `*/5`; known-benign suppressed; `NodeLogsStream`/`ServiceLogTail` render real data. | §Standard Stack (collector extension pattern), §Schema Design (`service_log_events`/`log_patterns`/`log_patterns_config`), §Obsidian Seed Data (benign patterns), §Read-layer + UI un-stub. Existing discard point: `grade_log_service` in `collect_telemetry.py`. |
| COL-02 | Postgres AP-12 signatures (`FATAL: too many clients`, serialization `40001`) + `pg_stat_*` counters ingested; AP-12 deterministic; retire `ap12-advisory` LLM fallback. | §COL-02 AP-12 Detection (exact signatures from Obsidian AP-12 runbook), §Schema Design (`pg_health` fact), §ap12-advisory retirement contract. |
| COL-03 | Deeper Ubuntu/VM metrics (per-core CPU + steal/iowait, disk I/O per device, net errors/drops/retransmits, mem detail + OOM, fd/limits, systemd failed units, clock skew, core count) collected RAW; surfaced on host/VM detail. | §COL-03 `/proc` + `/sys` Source Map (exact field parsing + counter/gauge semantics), §Schema Design (`host_metrics_ext` + child facts). |
</phase_requirements>

## Summary

This phase extends a **single, already-proven collection rail** — `scripts/fileserver/collect_telemetry.py`, the Python/psycopg2 `*/5` collector — rather than introducing anything new. The collector already tails each service's log (up to 64 KB via `_tail_text`), matches the inventory's `error_pattern`, computes `error_count`, and **throws the matched lines away** (keeps only an int + one `detail` string). COL-01 is fundamentally about *stopping the discard* at `grade_log_service` and persisting the lines (plus ±5 context) as real rows. COL-03 is about widening the `/proc`+`/sys` reads the collector already does (`gather_host_metrics`, `gather_meminfo`, `gather_net_bytes`, `_read_cpu_times`) into a much deeper, per-entity metric set. COL-02 adds a structured PG-counters probe using the existing `pg_isready`/psycopg2 infrastructure.

The **entire "which patterns matter" question is already answered** in the operator's Obsidian `LQWD Node Log Reviews` library (accessible, verified). The benign list (BP-001…BP-008), the AP-11 close-storm and AP-12a/b Postgres-contention signatures, and the healthy-range bands are concrete, node-confirmed, and directly transcribable into `log_patterns_config` seed rows and the read-time band derivations. This is the single highest-value research payload — it means the classifier is a **transcription job, not a design job**.

No new packages are needed anywhere. The Python side uses stdlib (`os`, `subprocess`, `socket`, `hashlib` for the signature) + the already-present `psycopg2`. The TS side uses the already-installed `drizzle-orm`, `zod`, `recharts`. Every established pattern — RAW storage + bands at read time (D-14), RLS on `host_id` (fail-closed two-arg `current_setting`), Drizzle-owns-`nodemon`-only, DISTINCT-ON latest-per-entity (never `WHERE ts = MAX(ts)`, AFM-001), `fee_msat/1000.0` guardrail — carries forward unchanged and the new tables must conform to them.

**Primary recommendation:** Extend `collect_telemetry.py` in place (new `gather_*`/`grade_log_service` persist-path + a `probe_pg_health` + deep-metric gatherers); add five new Drizzle-owned `nodemon` fact/config tables mirroring the existing fact-table shape (uuid pk, `host_id` RLS axis, `collected_at`, RAW columns, `(host_id, collected_at DESC)` + `(collected_at)` indexes); extend `db/role-grants.sql` RLS to the new tables; seed `log_patterns_config` from the Obsidian library; add `src/lib/read/` readers that apply benign suppression + band derivation at read time; un-stub `NodeLogsStream` and `ServiceLogTail`. Land canary-first (D-09).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Log-line capture + ±5 context | Node-side collector (Python) | — | Only the node can read `/var/log`; the collector already tails these files. Insertion point = `grade_log_service`. |
| Line normalization → signature hash | Node-side collector (Python) | — | Signature must be computed where the raw line lives; stdlib `hashlib` is sufficient. |
| Classification tagging | Node-side collector (Python) | DB config table (`log_patterns_config`) | Collector reads config table, applies classification at write. Config is data, not code (D-05). |
| `log_patterns` aggregate upsert | Node-side collector (Python) | Database (Postgres) | Per-tick UPSERT (D-03); ON CONFLICT on signature. |
| Deep VM metric sampling | Node-side collector (Python) | Linux `/proc`+`/sys` | Pure procfs reads + a few argv subprocesses (`ss`, `systemctl`, `chronyc`, `nproc`). |
| PG counter probe | Node-side collector (Python) | Postgres (`pg_stat_*`) | Reuse env-supplied PG conninfo; SELECT from `pg_stat_activity`/`pg_stat_database`. |
| RAW persistence + RLS isolation | Database (Postgres) | — | RLS on `host_id` (+ `node_pubkey` for service rows), fail-closed. New tables extend `db/role-grants.sql`. |
| Retention prune (keep-N + tiered) | Node-side collector (Python) | Database | Extends the existing `_prune()` RLS-scoped DELETE; new logic per D-08. |
| Benign suppression | Read layer (Next.js server) | DB config table | D-04: filter at read time using `log_patterns_config`, NOT at collection. |
| Band/severity derivation | Read layer (Next.js server) | — | D-14: RAW in DB, bands at read time. Mirrors `telemetry-bands.ts`. |
| Log/metric rendering | Frontend (Client Components) | — | `NodeLogsStream`/`ServiceLogTail`/VmVitals already built; only the data feed is missing. |
| AP-12 determinism | Read layer / insight engine | DB (`pg_health` + `service_log_events`) | Retires `ap12-advisory.ts` LLM fallback once counters + signatures land. |

## Standard Stack

**No new packages.** This phase is built entirely on the installed, production-proven stack.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Python stdlib (`os`, `subprocess`, `socket`, `hashlib`, `datetime`, `json`) | Python 3 (node runtime) | procfs/sysfs reads, argv subprocess, signature hashing | `collect_telemetry.py` is already stdlib-only except psycopg2 [VERIFIED: scripts/fileserver/collect_telemetry.py]. `hashlib.sha256` (stdlib) covers the normalized-line signature — no new dep. |
| psycopg2 | (already deployed on nodes) | Direct parameter-bound INSERT/UPSERT/DELETE under RLS | The collector's existing DB driver; `SET LOCAL app.host_id` + placeholder-bound SQL already in use [VERIFIED: collect_telemetry.py `write_tick`]. |
| drizzle-orm | ^0.45.1 | Typed schema for the 5 new `nodemon` tables; owns their migrations | Workspace standard; `nodemon` is the ONLY Drizzle-migrated DB [VERIFIED: package.json, src/lib/db/schema/nodemon.ts]. |
| postgres (postgres.js) | ^3.4.8 | Read-layer client (`dbNodemon`) for the new readers | Existing read client; `dbNodemon.execute(sql\`…\`)` pattern [VERIFIED: src/lib/read/host-metrics.ts]. |
| zod | ^3.25.76 | (Optional) validate any config-table write path / reader inputs | Already present; used across `src/lib/insight` [VERIFIED: package.json]. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| recharts | 3.9.0 | Time-series charts for deep VM metrics on host detail | Already installed + wrapped by df EvidenceChart; use existing `'use client'` chart wrappers [VERIFIED: package.json]. |
| vitest | (dev) | Unit tests for readers + pure derivations (band/suppression/staleness) | `npm test` → `vitest run`; 94 `.test.ts` files already exist [VERIFIED: package.json, `find src -name *.test.ts`]. |

### Node-side CLI tools invoked via argv (already the collector's pattern — EXEC-02 argv-only)
| Tool | Purpose | Availability note |
|------|---------|-------------------|
| `nproc` | Core count (fixes the CPU-cores UI gap; enables load-vs-cores) | coreutils; universally present on Ubuntu. |
| `ss -s` / `ss -tan` | Socket summary + TCP state counts (retransmits via `ss -ti` optional) | iproute2; present on Ubuntu. |
| `systemctl --failed --no-legend` | Count of failed units | systemd; present. |
| `chronyc tracking` (or `ntpq -p`) | Clock skew / offset | chrony typically installed; **fallback**: `/proc` has no offset — mark no-data if absent. |
| `df -i` | Inode usage per filesystem | coreutils; already using `df -P -B1`. |

**Installation:** none — all node-side tools ship with Ubuntu Server; all TS/Python libs already installed.

## Package Legitimacy Audit

> This phase installs **no external packages**. Every dependency is already present and production-proven in the workspace.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none — no new installs) | — | — | — | — | n/a | No audit required |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*No `npm install` / `pip install` occurs in this phase. The collector already vendors `psycopg2` + `python-dotenv` via the node's out-of-band bootstrap; the TS stack is unchanged.*

## Architecture Patterns

### System Architecture Diagram

```
  Ubuntu node (canary first, D-09)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  cron */5  →  collect_telemetry.py  (extend in place — NO new rail)     │
  │                                                                        │
  │   ┌─ fetch_inventory() ──────────────► service_inventory (error_pattern)│
  │   │                                                                    │
  │   ├─ grade_log_service()  ── tails 64KB, matches error_pattern         │
  │   │      │  (TODAY: keeps error_count int, DISCARDS lines)             │
  │   │      ▼  NEW: for each matched line →                               │
  │   │        · capture ±5 context lines (D-01)                           │
  │   │        · normalize + hashlib.sha256 → signature                    │
  │   │        · classify via log_patterns_config (D-05)                   │
  │   │        · emit service_log_events row(s) + UPSERT log_patterns (D-03)│
  │   │                                                                    │
  │   ├─ gather_host_metrics_ext()  NEW ── /proc/stat /proc/schedstat      │
  │   │        /proc/vmstat /proc/meminfo /proc/diskstats /proc/net/dev    │
  │   │        /proc/net/snmp /proc/sys/fs/file-nr + nproc/ss/systemctl    │
  │   │        → host_metrics_ext (scalars) + child facts                  │
  │   │          host_cpu_core / host_disk_io / host_net_iface             │
  │   │                                                                    │
  │   └─ probe_pg_health()  NEW ── pg_stat_activity / pg_stat_database     │
  │            + FATAL/40001 signature counts → pg_health fact             │
  │                                                                        │
  │   write_tick(): SET LOCAL app.host_id/app.node_pubkey → INSERT all →   │
  │                 UPSERT log_patterns → _prune()  (keep-N + tiered, D-08) │
  └───────────────────────────────┬──────────────────────────────────────┘
                                   │  psycopg2, RLS-boxed, outbound-only
                                   ▼
                         nodemon Postgres (RW, RLS on host_id)
   NEW: service_log_events · log_patterns · log_patterns_config
        host_metrics_ext · host_cpu_core · host_disk_io · host_net_iface · pg_health
                                   │
                                   │  dbNodemon.execute(sql`DISTINCT ON …`)  (RO reads)
                                   ▼
              src/lib/read/  (NEW readers — benign filter + bands AT READ TIME, D-04/D-14)
   getServiceLogEvents() · host-metrics-ext reader · pg-health reader
                                   │  plain serializable props
                                   ▼
        Next.js Server Components  →  Client Components
   NodeLogsStream (logs: []→real) · ServiceLogTail (logRows: []→real) · VmVitals (deep metrics)
```

### Recommended Project Structure
```
scripts/fileserver/
  collect_telemetry.py        # EXTEND: grade_log_service persist-path, gather_host_metrics_ext,
                              #         probe_pg_health, keep-N+tiered prune

src/lib/db/schema/
  nodemon.ts                  # EXTEND: 5 new pgTable defs (+ child facts) mirroring fact-table shape
drizzle/nodemon/
  0003_*.sql                  # NEW Drizzle migration (generate/migrate — nodemon ONLY)
db/
  role-grants.sql             # EXTEND: RLS enable/force + policies + scoped grants for new tables
  seed-log-patterns.sql       # NEW: log_patterns_config seed rows transcribed from Obsidian library

src/lib/read/
  service-log-events.ts       # NEW: getServiceLogEvents() — benign suppression at read time (D-04)
  host-metrics-ext.ts         # NEW: latest-per-host + per-core/-device/-iface child reads
  pg-health.ts                # NEW: latest pg_health + AP-12 determinism
  telemetry-bands.ts          # EXTEND: bands for new metrics (steal%, iowait%, retransmits, 40001 rate…)

src/components/node/NodeLogsStream.tsx     # un-stub feed (page [pubkey]/page.tsx logs:[])
src/components/service/ServiceLogTail.tsx  # un-stub feed (service/[service]/page.tsx logRows:[])
```

### Pattern 1: Persist-at-the-discard-point (COL-01)
**What:** `grade_log_service` already has the tailed `text` and the matched `error`. Instead of only `text.count(error)`, iterate matches, capture ±5 context lines, and build event rows.
**When to use:** COL-01 line capture.
**Example (illustrative — mirrors existing collector style):**
```python
# Source: extends scripts/fileserver/collect_telemetry.py grade_log_service (VERIFIED existing)
import hashlib, re

def _normalize(line):
    # Strip timestamps/pids/hashes so recurring lines collapse to one signature.
    s = re.sub(r"\b[0-9a-f]{16,}\b", "<hex>", line)
    s = re.sub(r"\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\S*", "<ts>", s)
    s = re.sub(r"peer=\d+|=\d+", "=<n>", s)
    return s.strip()

def extract_events(text, error_pattern, level="error", context=5):
    lines = text.splitlines()
    events = []
    for i, line in enumerate(lines):
        if error_pattern and error_pattern in line:
            norm = _normalize(line)
            sig = hashlib.sha256(norm.encode("utf-8")).hexdigest()
            ctx = "\n".join(lines[max(0, i - context): i + context + 1])
            events.append({"level": level, "message": line[:8000],
                           "signature": sig, "context": ctx})
    return events
```

### Pattern 2: Latest-per-entity read (AFM-001 — MANDATORY)
**What:** All new fact reads use `SELECT DISTINCT ON (entity_key…) * … ORDER BY entity_key…, collected_at DESC`. NEVER `WHERE collected_at = (SELECT MAX(...))`.
**When to use:** every reader over the new fact tables.
**Example:**
```typescript
// Source: src/lib/read/host-metrics.ts buildLatestHostMetricsSql (VERIFIED existing pattern)
export function buildLatestPgHealthSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id) *
    FROM pg_health
    WHERE host_id = ${hostId} AND host_id IS NOT NULL
    ORDER BY host_id, collected_at DESC
  `;
}
```
Child facts (per-core/-device/-iface) key on `(host_id, <dim>, collected_at DESC)` — exactly like `host_storage` keys on `(host_id, mount_point, …)`.

### Pattern 3: Bands + benign suppression at read time (D-04 / D-14)
**What:** DB stores RAW counters/lines only. The reader (a) joins `log_patterns_config` to drop/flag benign classifications, and (b) derives severity bands from the Obsidian healthy-range numbers. No severity or `stale` flag is ever stored.
**When to use:** `getServiceLogEvents` (benign filter) and every metric reader (bands). Mirror `deriveStale()` in host-metrics.ts and the band logic in `telemetry-bands.ts`.

### Pattern 4: RLS write path (unchanged, carry forward)
**What:** `write_tick` runs `SET LOCAL app.host_id` + `SET LOCAL app.node_pubkey` before any INSERT; new tables get `ENABLE`+`FORCE ROW LEVEL SECURITY` with two-arg `current_setting('app.host_id', true)` policies (fail-closed = zero rows when unset). Collector role gets scoped `SELECT, INSERT, DELETE` (+ `UPDATE` only where `log_patterns` UPSERT needs it — note this is a **new privilege** the collector role currently lacks).
**When to use:** the migration + `db/role-grants.sql` extension.

### Anti-Patterns to Avoid
- **`WHERE collected_at = MAX(collected_at)` on any fact table** — AFM-001 "480-as-1"/fan-in failure. Always DISTINCT ON. [CITED: Library/Analytical Failure Modes.md AFM-001]
- **Storing severity/bands/stale flags in the DB** — violates D-14; bands live at read time.
- **Hardcoding benign/AP patterns in the collector** — violates D-05; they live in `log_patterns_config`.
- **Widening `host_metrics`** — violates D-06; shipped VmVitals/host-detail readers must not take migration risk. Use `host_metrics_ext`.
- **A blunt per-tick line cap that drops data** — violates D-07. Use keep-N-exemplars + tiered windows (D-08).
- **Shell-string subprocess** — EXEC-02: argv lists ONLY (`run_argv`), never `shell=True`.
- **Signing/HMAC on telemetry** — telemetry has NO HMAC (D-11); RLS + least-privilege role IS the integrity boundary. Do not add a secret column.
- **Lowering PG isolation to "fix" 40001** — LND requires SERIALIZABLE; this corrupts state. [CITED: Library/Operational Anti-Patterns.md AP-12b]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest-per-host query | A new MAX()-based query | `DISTINCT ON` fragment from host-metrics.ts | AFM-001 landmine; the centralized pattern exists. |
| Which log patterns are benign/critical | A guessed regex list | Transcribe Obsidian BP-001…008 + AP-11/12 into `log_patterns_config` | Node-confirmed, operator-owned truth (D-11). |
| Healthy thresholds | Invented numbers | Obsidian `Healthy Range Bands.md` values | Cross-node-confirmed bands (Canada+France). |
| CPU busy % / mem parse | New parser | Existing `_read_cpu_times`, `gather_meminfo` | Already correct; extend for per-core + extra fields. |
| RLS isolation | App-side host filtering | `SET LOCAL` GUC + FORCE RLS policies | DB-enforced, physical isolation; pattern proven in role-grants.sql. |
| Line signature/dedup | Custom hash scheme | `hashlib.sha256(normalized_line)` | Stdlib; normalization is the only design work. |
| Staleness display | Stored stale flag | `deriveStale(collectedAt)` at read time | D-13/D-14; pure + unit-tested. |

**Key insight:** The hard parts of this phase are already solved somewhere in the repo or the Obsidian vault. The net-new work is **transcription (patterns/bands), field-widening (procfs), and schema plumbing** — not novel algorithm design.

## COL-02 — AP-12 Detection (deterministic, retires ap12-advisory.ts)

The `ap12-advisory.ts` LLM fallback exists ONLY because PG log lines + `pg_stat_*` counters are not ingested. Ingest them and AP-12 becomes deterministic. Exact signatures (verified against the Obsidian AP-12 runbook + Operational Anti-Patterns AP-12):

| Variant | Signature (log) | Signature (counter) | Source location |
|---------|-----------------|---------------------|-----------------|
| **AP-12a** connection exhaustion | `FATAL: sorry, too many clients already` count (`grep -c "FATAL.*too many clients"`; threshold >100 confirms) | `count(*) FROM pg_stat_activity WHERE datname='lnd_<region>'` ≥ 80% of `SHOW max_connections` | [CITED: Library/Operational Anti-Patterns.md AP-12a] |
| **AP-12b** serialization storm | `could not serialize access … (SQLSTATE 40001)` high count WITH low/zero `too many clients`; LND-side `GRDB: UpdateEdgePolicy failed … SQLSTATE 40001` | `pg_stat_database.xact_rollback` rate ≥ 10× baseline (baseline 400–800/day); `pg_stat_database.deadlocks` for `40P01` | [CITED: Library/Operational Anti-Patterns.md AP-12b; Cross-Node Monitoring Matrix.md] |

**`pg_health` fact — recommended RAW columns** (counters are cumulative — rate math at read time):
- `max_connections` (int), `active_connections` (int, from `pg_stat_activity` for the lnd db), `datname` (text)
- `xact_commit` (bigint), `xact_rollback` (bigint), `deadlocks` (bigint), `numbackends` (int) — from `pg_stat_database`
- `too_many_clients_count` (bigint — from PG-log grep this tick), `serialization_40001_count` (bigint — from PG-log grep), `fatal_count` (bigint)
- (optional) `blocked_queries` (int, from `pg_locks`), `slow_query_gt1s` (int)

**Discriminator (the key AP-12a vs AP-12b split):** high `serialization_40001_count` **with** low `too_many_clients_count` ⇒ AP-12b; high `too_many_clients_count` ⇒ AP-12a. Both are RAW counts; the a/b decision is derived at read time. [CITED: AP-12 runbook step 5]

**Note on the `40001` benign-vs-anomaly nuance:** BP-005 documents 400–800 `40001`/day as **chronic-benign** LND workload on healthy nodes; AP-12b is the same signature at 15K–30K/day (Japan: 613,969 over 81 days). So `40001` is NOT a hard-critical signature — it is a **rate-banded** one. The classifier must tag `40001` as `benign` at baseline and only the read-time band promotes it to `ap12` above 10× baseline. This is exactly why D-04 (persist-all, band-at-read) is correct. [CITED: Library/Known Benign Patterns.md BP-005; Healthy Range Bands.md]

**Retirement contract for `ap12-advisory.ts`:** once `pg_health` + PG lines in `service_log_events` exist, replace the LLM advisory card with a deterministic detector reading (a) `too_many_clients_count`/`serialization_40001_count` from `pg_health`, (b) connection saturation ratio. The advisory's `AP12_NO_DATA_PLACEHOLDER` string and the `ap12a_conn_exhaustion`/`ap12b_serialization` signal ids are the contract to preserve. [VERIFIED: src/lib/insight/detectors/ap12-advisory.ts]

## COL-03 — /proc + /sys Source Map (Ubuntu)

Every value stored RAW (D-14). **Counter** = monotonic cumulative (rate = Δ/Δt at read time); **Gauge** = instantaneous. The collector already samples `/proc/stat` twice over ~1s for CPU% — reuse that windowing where a rate is needed at collection, but prefer **storing raw counters** and doing rate math at read time (consistent with net_rx_bytes today, which is stored cumulative).

| Signal (COL-03) | Source | Field parsing | Semantics | Target table |
|-----------------|--------|---------------|-----------|--------------|
| Per-core CPU busy / iowait / steal | `/proc/stat` lines `cpu0…cpuN` | Fields per core: `user nice system idle iowait irq softirq steal guest guest_nice`. steal = idx 8, iowait = idx 4. Compute % from two reads OR store raw jiffies. | Counter | `host_cpu_core` (child; `core_index`) |
| Context switches / interrupts | `/proc/stat` `ctxt`, `intr` (first field) | Single cumulative counters | Counter | `host_metrics_ext` scalar |
| Run-queue / sched latency (optional) | `/proc/schedstat` | Per-cpu rows; field 7 = time waiting on runqueue (jiffies) | Counter | `host_cpu_core` (optional) |
| Memory detail | `/proc/meminfo` | Add to existing parse: `Cached`, `Buffers`, `Dirty`, `Writeback`, `Slab`, `SReclaimable` (all kB) | Gauge | `host_metrics_ext` scalars |
| Page faults / paging / OOM | `/proc/vmstat` | `pgfault`, `pgmajfault`, `pswpin`, `pswpout`, `oom_kill` (cumulative) | Counter | `host_metrics_ext` scalars |
| Disk I/O per device | `/proc/diskstats` | Per device: fld4 reads completed, fld6 sectors read, fld8 writes completed, fld10 sectors written, fld12 I/Os in progress, fld13 ms doing I/O (utilization base). Sector = 512 B. Filter loop/ram/dm pseudo-devices. | Counter (fld12 gauge) | `host_disk_io` (child; `device`) |
| Filesystem inode usage | `df -i -P` (argv) | Per fs: iused / ifree / itotal | Gauge | `host_storage` extend OR `host_metrics_ext` |
| Network errors/drops/collisions per iface | `/proc/net/dev` | Extend existing parse: rx cols — bytes(0) errs(2) drop(3); tx cols — bytes(8) errs(10) drop(11) colls(13). Skip `lo`. | Counter | `host_net_iface` (child; `iface`) |
| TCP retransmits / segments | `/proc/net/snmp` | `Tcp:` line — `RetransSegs`, `OutSegs`, `InSegs`, `ActiveOpens`, `AttemptFails` | Counter | `host_metrics_ext` scalars |
| Socket state summary | `ss -s` / `ss -tan` (argv) | Parse totals + TIME-WAIT/ESTAB counts | Gauge | `host_metrics_ext` scalars |
| FD usage vs limit | `/proc/sys/fs/file-nr` | 3 fields: allocated, unused(0 on modern), max. Use allocated + max. | Gauge | `host_metrics_ext` scalars |
| Process counts | `/proc/loadavg` (last field = running/total), `/proc/stat` `procs_running`,`procs_blocked` | integers | Gauge | `host_metrics_ext` scalars |
| systemd failed units | `systemctl --failed --no-legend` (argv) | Count non-empty lines; optionally capture unit names as text | Gauge | `host_metrics_ext` scalar (`failed_units_count`) |
| Clock skew / NTP offset | `chronyc tracking` (argv; `System time … offset`) or `ntpq -pn` | Parse offset seconds; **no-data if neither present** | Gauge | `host_metrics_ext` scalar (`clock_offset_seconds`, nullable) |
| Core count | `nproc` (argv) | integer | Gauge | `host_metrics_ext` scalar (`nproc`) — fixes UI cores gap |
| Boot time / entropy (optional) | `/proc/stat` `btime`; `/proc/sys/kernel/random/entropy_avail` | integers | Gauge | `host_metrics_ext` scalars |
| OOM (log side) | kernel log — captured via `service_log_events` if a `kernel`/`syslog` inventory row exists; `/proc/vmstat oom_kill` is the numeric mirror | — | Counter + log | both |

**Healthy-range bands for the new metrics (read-time derivation, from Obsidian):** OOM kills/month = 0 (hard zero); EXT4/I/O errors/month = 0; kernel panics = 0; systemd `Failed to start`/month = 0; disk % free > 20%; PG conn < 80% of max; `40001` band 400–800/day baseline, ≥10× = investigate. [CITED: Library/Healthy Range Bands.md]

## Runtime State Inventory

> This phase EXTENDS an existing collector + adds tables; it is additive (not a rename), so most categories are empty. Checked explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `nodemon` tables (`service_log_events`, `log_patterns`, `log_patterns_config`, `host_metrics_ext`, `host_cpu_core`, `host_disk_io`, `host_net_iface`, `pg_health`) — do not yet exist. `log_patterns_config` must be **seeded** out-of-band (like `hosts`/`service_inventory` via `db/seed-dimensions.sql`), because the telemetry role is SELECT-only on config/dimension tables. | Drizzle migration (`0003_*.sql`) + `db/seed-log-patterns.sql` operator-run seed. |
| Live service config | `service_inventory.error_pattern` already drives matching per host. New PG-signature detection may need a `postgres`/`kernel` **inventory row with a PG-log `artifact_path` + error_pattern** on the canary if not already declared. Check `db/seed-dimensions.sql`. | Confirm/seed a PG (and optionally kernel/syslog) inventory row on the canary. |
| OS-registered state | cron `*/5` `CRON_JOB_12` is **canary-only** (not fleet-spliced). No cron change needed for canary; fleet splice is deferred (D-09). | None for canary; fleet splice is a later rollout step. |
| Secrets/env vars | Collector reads `NODEMON_TELEMETRY_DSN`, `BITCOIND_*`, `PG_PROBE_CONNINFO`, `LNCLI` from the root-only `/lnd/nodemon/.nodemon.env`. `probe_pg_health` needs PG conninfo with SELECT on `pg_stat_*` — `PG_PROBE_CONNINFO` already exists (used by `pg_isready`); confirm the role can read `pg_stat_database`/`pg_stat_activity`. | Verify `PG_PROBE_CONNINFO` role has `pg_stat_*` read; add env only if a distinct PG-stats DSN is required. |
| Build artifacts / installed packages | Collector is a plain `.py` (no build). New Drizzle migration regenerates `drizzle/nodemon/meta`. TS readers compiled by Next build. | Run `drizzle-kit generate` for `nodemon`; run migration against canary nodemon DB. |
| DB role privileges | The telemetry role (`nodemon_telemetry`) currently has `SELECT, INSERT, DELETE` on the 4 fact tables and `SELECT` on 2 dimensions. `log_patterns` UPSERT (D-03) needs **`UPDATE`** — a privilege the role does NOT currently hold. | Extend `db/role-grants.sql`: grant `SELECT, INSERT, UPDATE, DELETE` on `log_patterns`; `SELECT, INSERT, DELETE` on the other new facts; `SELECT` on `log_patterns_config`; add RLS ENABLE/FORCE + policies on all new tables. |

**Nothing found in category:** OS-registered state (beyond the existing canary cron) — verified: no new systemd/task registration; the collector is invoked by the existing cron rail.

## Common Pitfalls

### Pitfall 1: `log_patterns` UPSERT needs a privilege the telemetry role lacks
**What goes wrong:** The collector role is deliberately `INSERT`/`DELETE` only (no `UPDATE`) on facts. D-03's per-tick UPSERT (`INSERT … ON CONFLICT (signature) DO UPDATE`) will fail with `permission denied`.
**Why it happens:** Least-privilege role in `role-grants.sql` explicitly says "telemetry is appended + pruned, never mutated in place."
**How to avoid:** Grant `UPDATE` on `log_patterns` **specifically** (the one aggregate table), keeping the raw facts UPDATE-free. Document the exception.
**Warning signs:** SQLSTATE 42501 on the first canary tick.

### Pitfall 2: RLS fail-closed hides rows if the GUC is unset
**What goes wrong:** New tables get FORCE RLS; if `write_tick` doesn't `SET LOCAL app.host_id` before inserting into a new table, the two-arg `current_setting(...,true)` returns NULL → policy is false → INSERT rejected (WITH CHECK) or reads return zero rows.
**How to avoid:** All new INSERTs stay inside the existing `write_tick` transaction (after the two `SET LOCAL` lines). Add child-fact and pg_health inserts there, not in a separate connection.
**Warning signs:** Silent zero-row inserts; empty readers despite collector "wrote tick" logs.

### Pitfall 3: Storing bands/severity or a stale flag (D-14 violation)
**What goes wrong:** Tempting to store `is_critical` on a `40001` row. But BP-005 proves `40001` at 400–800/day is benign and only anomalous at 10× — severity is a *rate band*, computed at read time.
**How to avoid:** Store RAW counts + `classification` (which patterns config assigns), derive the band in the reader.

### Pitfall 4: Per-core/-device fan-out breaks DISTINCT-ON-per-host readers
**What goes wrong:** `host_cpu_core` emits N rows per tick (one per core). A `DISTINCT ON (host_id)` read collapses to one core.
**How to avoid:** Child facts key on `(host_id, <dim>, collected_at DESC)` — copy the `host_storage`/`(host_id, mount_point, …)` pattern exactly, including the composite index.

### Pitfall 5: Retention prune could starve a rare critical exemplar
**What goes wrong:** A naive `DELETE WHERE collected_at < now() - interval '21 days'` (the existing `_prune`) would evict a once-seen AP-12 exemplar at 21 days, losing the training material D-07/D-08 protect.
**How to avoid:** Implement keep-N + classification-tiered prune: benign → 21d window AND cap redundant middle exemplars per signature; warn/ap11 → longer; ap12/critical → keep indefinitely (never time-pruned); always keep first-seen + newest per signature; `log_patterns` aggregate never pruned.
**Warning signs:** A critical signature present in `log_patterns` (count>0) with zero exemplar rows in `service_log_events`.

### Pitfall 6: Log volume from a benign firehose (BP-003, BP-005, BP-006)
**What goes wrong:** BP-003 alone burst 2,065 events in 89 min; BP-005 is 400–800/day; BP-006 is continuous. Persisting every matched line raw with no dedup floods the table.
**How to avoid:** The signature dedup (D-02) + keep-N-exemplars (D-08) bounds it: the *aggregate* count climbs, raw exemplar rows stay capped. Confirm the collector inserts at most N new exemplars per signature per tick.

### Pitfall 7: `pg_stat_database` counters reset on PG restart
**What goes wrong:** Cumulative counters (`xact_rollback`, `deadlocks`) reset to 0 when PG restarts or `pg_stat_reset()` runs. A read-time Δ can go negative.
**How to avoid:** Store `stats_reset` timestamp (available in `pg_stat_database`) alongside counters; at read time, treat a decreased counter as a reset boundary (clamp Δ ≥ 0). Same discipline as net counters.

## Code Examples

### Extend `write_tick` for the new facts (RLS-safe)
```python
# Source: extends scripts/fileserver/collect_telemetry.py write_tick (VERIFIED existing)
def write_tick(conn, host_id, node_pubkey, now, host, host_ext, cpu_cores,
               disk_io, net_ifaces, storage, services, chain, pg_health, log_events):
    with conn:                                   # commit on success / rollback on error
        with conn.cursor() as cur:
            cur.execute("SET LOCAL app.host_id = %s", (host_id,))
            cur.execute("SET LOCAL app.node_pubkey = %s", (node_pubkey or "",))
            _insert_host_metrics(cur, host_id, now, host)        # unchanged
            _insert_host_metrics_ext(cur, host_id, now, host_ext)     # NEW
            _insert_children(cur, host_id, now, cpu_cores, disk_io, net_ifaces)  # NEW
            _insert_pg_health(cur, host_id, now, pg_health)      # NEW
            _insert_log_events(cur, host_id, now, log_events)    # NEW (raw exemplars, capped)
            _upsert_log_patterns(cur, host_id, now, log_events)  # NEW (D-03 aggregate)
            _insert_host_storage(cur, host_id, now, storage)     # unchanged
            _insert_service_health(cur, host_id, now, services)  # unchanged
            _insert_chain(cur, host_id, now, chain)              # unchanged
            _prune_tiered(cur)                                   # NEW keep-N + tiered (D-08)
```

### `log_patterns` UPSERT (D-03)
```python
# Parameter-bound ONLY (psycopg2 placeholders). Signature is the conflict key.
cur.execute(
    "INSERT INTO log_patterns (host_id, signature, service_name, first_seen, "
    "last_seen, count_window, sample_message, classification) "
    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
    "ON CONFLICT (host_id, signature) DO UPDATE SET "
    "last_seen = EXCLUDED.last_seen, "
    "count_window = log_patterns.count_window + EXCLUDED.count_window, "
    "classification = EXCLUDED.classification",
    (host_id, sig, service, now, now, n_this_tick, sample, classification),
)
```

### Read-time benign suppression (D-04)
Suppression joins on the event's `config_id` — the id of the matched `log_patterns_config`
row recorded at classify time — **NOT** on `classification`. A classification does NOT
uniquely determine `suppress`: the `benign` class holds both suppress=true BP-rows AND the
suppress=false `SQLSTATE 40001` row, and `critical` holds 5 sibling rows. A `classification`
join would therefore (a) **invert suppression** — a benign `BP-001` event joins the
suppress=false `40001` sibling, `COALESCE(c.suppress,false)=false` passes, and the benign
line leaks; and (b) **fan out rows** — `SELECT e.*` over the one-to-many join emits a
`critical` event 5×. Joining on the `config_id` primary key is strictly 1:1, so it does
neither, while preserving D-04 read-time retunability (change `config.suppress` and reads
re-filter with no re-collection). `config_id` is a raw matched-pattern identity pointer, not
a severity/band/verdict — D-14-safe, consistent with the existing `classification` column.
```typescript
// Source: mirrors src/lib/read/host-metrics.ts execute pattern (VERIFIED existing)
export function buildServiceLogEventsSql(hostId: string, service: string | null): SQL {
  // Join config on the matched-pattern id so benign lines are excluded AT READ TIME, never at write.
  return sql`
    SELECT e.*
    FROM service_log_events e
    LEFT JOIN log_patterns_config c ON c.id = e.config_id   -- matched-pattern PK (1:1), NOT classification
    WHERE e.host_id = ${hostId} AND e.host_id IS NOT NULL
      ${service ? sql`AND e.service_name = ${service}` : sql``}
      AND COALESCE(c.suppress, false) = false      -- suppress resolved per matched pattern
    ORDER BY e.collected_at DESC
    LIMIT 500
  `;
}
```

## Obsidian Seed Data (`log_patterns_config` — transcription targets, D-11)

These are the concrete, node-confirmed rows to seed. `classification` ∈ {benign, warn, ap11, ap12, critical, other}; `suppress` = read-time benign hide. All [CITED: Library/Known Benign Patterns.md and Library/Operational Anti-Patterns.md].

| match_expression (substring/regex) | service | level | classification | suppress | Note |
|---|---|---|---|---|---|
| `Outbound peer has old chain` | bitcoind | warn | benign | true | BP-001; alert only >10/day×3d |
| `Flushing large` … `UTXO set to disk` | bitcoind | warn | benign | true | BP-002; watch flush size growth |
| `[WRN] ACSM: Peer is banned` | lnd | warn | benign | true | BP-003; restricted-slot hygiene |
| `[WRN] HSWC` insufficient bandwidth | lnd | warn | benign | true | BP-004; routing-normal |
| `[ERR] HSWC` "Unhandled error" | lnd | error | benign | true | BP-004 paired; upstream mislabel |
| `could not serialize` / `SQLSTATE 40001` | postgres/lnd | warn | benign→ap12 (rate-banded) | false | BP-005 benign 400–800/day; AP-12b ≥10× |
| `rate limiting gossip replies` | lnd | debug | benign | true | BP-006; back-pressure normal |
| `FATAL: sorry, too many clients already` | postgres | error | ap12 | false | AP-12a signature (SA: 93K+) |
| `40P01` / `deadlock detected` | postgres | error | critical | false | Deadlock cluster >5/hr |
| `FATAL` (PG, general) | postgres | error | critical | false | Healthy band = 0/month |
| `closechannel` storm ≥50/hr | lnd | error | ap11 | false | AP-11 mass close-storm |
| `[CRT]` (LND) | lnd | error | critical | false | Hard-zero band; major incident |
| `[ERR] GRDB: UpdateEdgePolicy failed … SQLSTATE 40001` | lnd | error | ap12 | false | AP-12b LND-side surface |
| `oom` / `Out of memory: Killed` (kernel) | kernel | error | critical | false | OOM hard-zero band |
| `EXT4-fs error` / I/O error | kernel | error | critical | false | Hard-zero band |

**Suppress is per-row, resolved via `config_id` (NOT classification).** Each seeded row carries its own `suppress` flag and its own `id`. The collector records the matched row's `id` on each event as `service_log_events.config_id`; the reader joins `log_patterns_config` on that primary key. This is why `SQLSTATE 40001` can stay `classification=benign, suppress=false` and still SURVIVE at read even though it shares the `benign` class with the suppress=true BP-rows — the event points at exactly one config row, so the shared classification never drags 40001 into (or a BP-row out of) suppression.

**AP-11 note (context, not a per-line matcher):** AP-11 is a *rate* signature (≥50 closes/hour), best derived at read time from the aggregate/warehouse, not a single log substring — but `closechannel` lines should still be captured to `service_log_events` for the exemplar trail. [CITED: Operational Anti-Patterns.md AP-11]

## State of the Art

| Old Approach | Current Approach | Why |
|--------------|------------------|-----|
| `error_count` int + discarded lines | Raw `service_log_events` + `log_patterns` aggregate | AI phase needs the lines, not a count (AIX-01). |
| AP-12 via LLM advisory (`ap12-advisory.ts`) | Deterministic `pg_health` counters + PG-log signatures | Retires the LLM stopgap; the module itself says it "RETIRES when log ingestion lands." |
| Shallow `host_metrics` (11 cols) | `host_metrics_ext` + 3 child facts + deep procfs | Cross-subsystem correlation for autonomy substrate. |
| Hardcoded thresholds | `log_patterns_config` (SQL-tunable) + read-time bands | Retune without fleet redeploy (D-05). |

**Deprecated/outdated:** none — this phase adds to a current, shipped architecture. The `ap12-advisory.ts` LLM path is intentionally superseded (keep its signal-id/placeholder contract).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `PG_PROBE_CONNINFO` role can read `pg_stat_activity`/`pg_stat_database` on the canary. | Runtime State Inventory / COL-02 | `probe_pg_health` returns no-data; needs a broader PG grant. Low risk (pg_stat views are world-readable by default for own-db activity). |
| A2 | `chronyc` (or `ntpq`) is installed on the canary for clock skew. | COL-03 | Clock-offset column reads null (honest no-data). Low risk — nullable field, fallback documented. |
| A3 | A PG-log (and optionally kernel/syslog) `service_inventory` row with a readable `artifact_path` exists or can be seeded on the canary. | Runtime State Inventory | Without it, PG log lines aren't tailed → AP-12 signatures missing from `service_log_events` (counters still work via `pg_health`). Verify in plan. |
| A4 | Normalization regex set (timestamps/pids/hex) is sufficient to collapse recurring lines to stable signatures. | Pattern 1 | Over-/under-normalization changes dedup granularity; tune against real France/Japan excerpts (available in vault `Nodes/`). |
| A5 | The `40001` rate-band promotion (benign→ap12 at ≥10× baseline) is best done at read time, not as a stored classification. | COL-02 | If done wrong, benign chronic 40001 could false-page. Mitigated by D-04 (band at read). |
| A6 | Keep-N exemplar value (e.g. first-seen + newest, N≈2–5) is adequate; operator may want more. | D-08 retention | Too-low N loses middle exemplars a human might want; tune N in plan with operator. |

## Open Questions (RESOLVED)

1. **Exact keep-N and per-classification retention windows (D-08).**
   - What we know: aggregate forever; benign ~21d; ap12/critical indefinite; keep first-seen + newest.
   - What's unclear: numeric N and the warn/ap11 window length.
   - Recommendation: start N=first-seen+2-newest, benign=21d, warn/ap11=90d, ap12/critical=∞; make windows a small config constant so they're tunable.
   - RESOLVED: adopted — Plan 06 `_prune_tiered` keeps first-seen+newest exemplars per signature, benign 21d / warn/ap11 90d / ap12/critical ∞ as config constants; `log_patterns` never time-pruned.

2. **Context-line linkage mechanism (D-01/D-02).**
   - What we know: each matched line needs its ±5 context associated.
   - Options: (a) a `context_lines` text column on the event row (simplest, self-contained); (b) a parent `event_id` + child `context_line` rows; (c) a `group_id` UUID shared by the matched line + its context rows.
   - Recommendation: **(a) `context_lines text` on the event row** — self-contained, no join, matches the "signal not firehose" bound; escalate to (c) only if the AI phase needs per-line addressing.
   - RESOLVED: adopted (a) — Plan 01 defines `service_log_events.context_lines text`; Plan 06 stores the ±5 context inline, no child/join.

3. **Is `40001`/`too many clients` counted from PG logs or from LND logs, or both?**
   - What we know: AP-12a is a PG-log FATAL; AP-12b surfaces both PG-side (`could not serialize`) and LND-side (`GRDB … SQLSTATE 40001`).
   - Recommendation: count from whichever `service_inventory` rows exist on the node (postgres + lnd); `pg_health` counters are the authoritative discriminator.
   - RESOLVED: adopted — Plan 06 tails whichever postgres+lnd `service_inventory` rows exist; Plan 01 `pg_health` counters (serialization40001Count/tooManyClientsCount) are the authoritative discriminator.

4. **Should inode usage extend `host_storage` or live on `host_metrics_ext`?**
   - Recommendation: extend `host_storage` (per-mount is its natural grain) with `inodes_total/used/free` — avoids a redundant child fact.
   - RESOLVED: adopted — Plan 01 Task 1 adds additive nullable `inodes_total/used/free` columns to `host_storage`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| psycopg2 (node) | Collector DB writes | ✓ (already deployed) | existing | — |
| `nproc`, `df -i` (coreutils) | COL-03 cores/inodes | ✓ | Ubuntu default | — |
| `ss` (iproute2) | COL-03 sockets | ✓ | Ubuntu default | Parse `/proc/net/snmp` only |
| `systemctl` | COL-03 failed units | ✓ | systemd | — |
| `chronyc` / `ntpq` | COL-03 clock skew | ? (A2) | — | Null clock-offset (honest no-data) |
| `/proc`, `/sys` | COL-03 all procfs | ✓ | Linux | — |
| drizzle-kit | nodemon migration | ✓ | 0.31.x | — |
| recharts | COL-03 host-detail charts | ✓ | 3.9.0 | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `chronyc` (clock skew → null/no-data if absent — non-blocking).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (installed) |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test` (`vitest run`) — or `npx vitest run src/lib/read/service-log-events.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COL-01 | `getServiceLogEvents` emits DISTINCT-ON-safe SQL, applies benign suppression, binds `hostId` | unit (no-DB shape) | `npx vitest run src/lib/read/service-log-events.test.ts` | ❌ Wave 0 |
| COL-01 | Line normalization → stable signature (pure) | unit | (python) `python3 -m pytest scripts/fileserver/test_extract.py` OR a TS mirror | ❌ Wave 0 |
| COL-02 | `pg-health` reader derives AP-12a/b discriminator + conn-saturation band from RAW counters | unit | `npx vitest run src/lib/read/pg-health.test.ts` | ❌ Wave 0 |
| COL-02 | ap12 deterministic detector replaces LLM card, preserves signal ids | unit | `npx vitest run src/lib/insight/detectors/ap12-advisory.test.ts` (extend) | ✅ (extend) |
| COL-03 | `host-metrics-ext` reader: latest-per-host + per-core/-device/-iface child grouping, band derivation | unit | `npx vitest run src/lib/read/host-metrics-ext.test.ts` | ❌ Wave 0 |
| COL-03 | Counter-reset clamp (Δ ≥ 0) for pg/net counters | unit | included in the reader tests | ❌ Wave 0 |
| COL-01/03 | RLS migration + role grants apply cleanly (incl. new `UPDATE` on log_patterns) | integration (manual/canary) | apply `drizzle/nodemon/0003_*.sql` + `db/role-grants.sql` to a scratch nodemon DB, run canary tick | manual-only (needs live PG) |

### Sampling Rate
- **Per task commit:** `npm test` (targeted file) + `npx tsc --noEmit` on touched TS.
- **Per wave merge:** full `npm test`.
- **Phase gate:** full suite green + a canary end-to-end tick proving real rows land in each new table and the UI renders them (D-09 canary proof).

### Wave 0 Gaps
- [ ] `src/lib/read/service-log-events.test.ts` — COL-01 reader shape + benign suppression
- [ ] `src/lib/read/pg-health.test.ts` — COL-02 counters + AP-12 discriminator
- [ ] `src/lib/read/host-metrics-ext.test.ts` — COL-03 latest-per-host + children + counter clamp
- [ ] `scripts/fileserver/test_extract.py` (or a TS normalization mirror) — signature normalization
- [ ] Extend `src/lib/insight/detectors/ap12-advisory.test.ts` — deterministic replacement contract
- [ ] Framework install: none — Vitest already configured.

## Security Domain

> `security_enforcement` not disabled in config → included. This is a data-collection phase; the primary surfaces are input handling (untrusted log lines + node data) and least-privilege DB roles.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth (internal tool); DB roles are the boundary. |
| V3 Session Management | no | — |
| V4 Access Control | yes | RLS on `host_id` (+ `node_pubkey`), FORCE + two-arg fail-closed policies; least-privilege telemetry role; per-node physical isolation. |
| V5 Input Validation | yes | Log lines are UNTRUSTED data (alias/message strings attacker-influenced). Store as data, never eval/interpolate. Reader route already validates `PUBKEY_RE`/`SERVICE_SLUG_RE` before reads; keep the message rendered as React-escaped inert text (EventTable already does). Truncate message length (≤8 KB). |
| V6 Cryptography | partial | Signature hash is `hashlib.sha256` for DEDUP only (not security). Telemetry has NO HMAC by design (D-11) — RLS is the integrity boundary. Do not add a secret column. |

### Known Threat Patterns for {node collector + nodemon Postgres + Next reader}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via log content / service name | Tampering | Parameter-bound psycopg2 placeholders ONLY (never f-string/.format); reader binds via Drizzle `sql\`\`` template. Both already the codebase rule. |
| Cross-host telemetry forgery from a compromised node | Spoofing | FORCE RLS keyed on `SET LOCAL app.host_id`; wrong-host rows physically invisible. |
| Prompt-injection via captured log lines feeding a later AI read | Tampering/Elevation | AI is Phase 16; but capture-side must store lines as inert data. The existing AI-read panels are advisory-only, no command emission, and wrap untrusted data in delimiters (see ap12-advisory `DATA_OPEN/CLOSE`). Preserve that boundary. |
| Shell injection via subprocess | Elevation | `run_argv` (argv list) ONLY, never `shell=True` (EXEC-02). New `ss`/`systemctl`/`chronyc`/`nproc` calls use argv. |
| Log-flood DoS (benign firehose fills disk/DB) | DoS | Signature dedup + keep-N exemplars + tiered retention (D-08); message truncation. |
| Privilege creep on the collector role | Elevation | Grant only the minimal new privilege (`UPDATE` on `log_patterns` alone; `SELECT` on config; `SELECT/INSERT/DELETE` on facts). No DDL/TRUNCATE. |

## Sources

### Primary (HIGH confidence)
- `scripts/fileserver/collect_telemetry.py` — the collector to extend; `grade_log_service` (discard point), `gather_host_metrics`, `write_tick`, `_prune`, `run_argv`, RLS `SET LOCAL`. [VERIFIED: read in full]
- `src/lib/db/schema/nodemon.ts` + `drizzle/nodemon/0001_telemetry_tables.sql` — fact-table shape, indexes, RAW/D-14 posture, RLS notes. [VERIFIED]
- `db/role-grants.sql` — `nodemon_telemetry` least-privilege + FORCE RLS + two-arg fail-closed policies (proves the `UPDATE`-missing pitfall). [VERIFIED]
- `src/lib/read/host-metrics.ts` — DISTINCT-ON latest-per-host, `deriveStale`, `dbNodemon.execute` reader template, AFM-001 discipline. [VERIFIED]
- `src/lib/insight/detectors/ap12-advisory.ts` — the LLM fallback + its retirement contract (signal ids, placeholder). [VERIFIED]
- `src/components/node/NodeLogsStream.tsx` + `src/components/service/ServiceLogTail.tsx` + `service/[service]/page.tsx` — un-stub targets (`logs: []`, `logRows: []`), `NodeLogLine` shape. [VERIFIED]
- Obsidian `LQWD Node Log Reviews/Library/Known Benign Patterns.md` — BP-001…008 (benign seed rows). [CITED, VERIFIED: read in full]
- Obsidian `Library/Operational Anti-Patterns.md` — AP-11 close-storm, AP-12a/b exact signatures + detection queries. [CITED, VERIFIED: grepped]
- Obsidian `Library/Healthy Range Bands.md` — read-time band numbers (LND/bitcoind/PG/system). [CITED, VERIFIED: read in full]
- Obsidian `Library/Data-Gap Inventory.md`, `Cross-Node Monitoring Matrix.md`, `Analytical Failure Modes.md` — pg_stat counter list, AFM-001 rule. [CITED, VERIFIED: grepped]
- `.planning/COLLECTOR-EXPANSION-BRIEF.md`, `15-CONTEXT.md`, `REQUIREMENTS.md §COL`, `ROADMAP.md §Phase 15`. [VERIFIED]

### Secondary (MEDIUM confidence)
- Linux `/proc` field layouts (diskstats, net/dev, meminfo, vmstat, net/snmp, stat) — standard, stable kernel ABI; the collector already parses `/proc/stat`, `/proc/meminfo`, `/proc/net/dev` correctly, so extension is low-risk. [ASSUMED from stable procfs ABI + existing correct parsers]

### Tertiary (LOW confidence)
- Exact availability of `chronyc` on the canary (A2). — verify on canary.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; everything verified in package.json + existing files.
- Schema/architecture: HIGH — mirrors shipped `nodemon` fact tables + RLS pattern verbatim.
- Log patterns/bands (seed data): HIGH — transcribed from operator-owned, node-confirmed Obsidian library.
- `/proc` field offsets: MEDIUM-HIGH — stable kernel ABI; existing parsers confirm the approach.
- Retention N / windows: MEDIUM — operator to confirm exact numbers (Open Q1).

**Research date:** 2026-07-14
**Valid until:** 2026-08-14 (stable — internal codebase + kernel ABI + operator library; no fast-moving external deps)
