# Phase 15: Data Collection Expansion — Logs + Deep VM Metrics - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Fill the data-collection gap the AI layer (Phase 16) depends on. Extend the existing
`*/5` collector (`scripts/fileserver/collect_telemetry.py`) — **no new rail** — to persist two
new data streams into `nodemon`, add read-layer functions, and un-stub the log UI:

1. **Service log/error events (COL-01)** — the matched error/warn lines the collector already
   reads (tails up to 64 KB/service, matches `error_pattern`) and currently **discards** (keeps
   only `error_count` int + one `detail` string). Persist them as real rows so
   `NodeLogsStream` (`[pubkey]/page.tsx`, `logs: []`) and `ServiceLogTail`
   (`service/[service]/page.tsx`, `logRows: []`) render real data instead of the empty stub.
   Target shape already defined by `NodeLogLine` in `NodeLogsStream.tsx`:
   `{id, service, ts, level: info|warn|error, message, aiRead?}`.
2. **PostgreSQL signatures + counters (COL-02)** — AP-12 signatures (`FATAL: too many clients`,
   serialization `40001`/SQLSTATE) + `pg_stat_*` counters, ingested so AP-12 detection is
   **deterministic** and the `ap12-advisory` LLM fallback (`ap12-advisory.ts`) can retire.
3. **Deeper Ubuntu/VM metrics (COL-03)** — OS-level signals not currently stored at depth:
   per-core CPU + steal/iowait, disk I/O per device, network errors/drops/retransmits, memory
   detail + OOM, fd/limits, systemd failed units, clock skew, core count. Collected RAW,
   surfaced on host/VM detail (VmVitals / host detail).

**Guiding principle (operator, 2026-07-14):** Build for **robustness, comprehensiveness, and
future-proofing — not ease.** This is the data foundation for making nodes autonomous: the
system exists to identify key weaknesses and shore them up. When a decision is lean-vs-thorough,
choose thorough. Everything the running system needs is **DB-resident** — the Obsidian library
is a build-time reference only (see `<decisions>` D-11), never a runtime dependency.

**Not in scope (own phases):**
- AI log/error read, AI cross-layer correlation, incident lifecycle (Phase 16 — INC/AIX).
- Dashboard auto-refresh heartbeat (deferred — see `<deferred>`; scheduled *after* collection so
  there's live data to refresh against).
- AIX-02 cross-layer correlation is **mostly not a collection gap** — the grouping spine
  (`assembleIncidents`) already exists; missing narration + infra→HTLC edge is derivable from
  warehouse data that already exists (`lnd_node_forwards`, `closed_channels`,
  `pending_sweeps.broadcast_attempts`) and belongs in Phase 16, not here.
</domain>

<decisions>
## Implementation Decisions

### Log capture scope & shape (COL-01)
- **D-01:** **Matched error/warn lines + ±5 context lines** each. Persist the pattern-matched
  line plus the 5 lines before and 5 after it, to capture full multi-line stack traces / PG/LND
  errors that span lines. NOT a broader unbounded tail — this stays "signal, not firehose."
- **D-02:** **Raw events + a derived pattern-aggregate table** (both, not raw-only):
  - `service_log_events` — raw rows. Draft columns:
    `id, host_id, service_name, node_pubkey, collected_at, level, message,
    signature (hash of normalized line), classification, source_path` (+ context-line linkage/
    grouping so the ±5 lines stay associated with their matched line — resolve exact mechanism in
    plan). RLS on `host_id` like the other facts.
  - `log_patterns` — derived aggregate: `signature, first_seen, last_seen, count_window,
    sample_message, classification`.
- **D-03:** **Collector upserts `log_patterns` per tick** — each `*/5` tick the collector bumps
  `count_window` / updates `last_seen` and sets `classification` from the pattern config table
  (D-05). The aggregate is always current. This upsert is also what guarantees the *fact* of a
  recurring signature survives even when redundant raw exemplars are evicted (D-07/D-08).

### Suppression & pattern source (COL-01 / COL-02)
- **D-04:** **Persist everything, filter at read time.** The collector persists *all* matched
  lines, each tagged with a `classification` (benign / warn / ap11 / ap12 / critical / other);
  known-benign suppression happens in the **read layer**, not the collector. Rationale: honors
  the RAW-everything posture (D-14 from prior phases); benign rules can be retuned retroactively
  without a fleet collector redeploy; no important data is thrown away.
- **D-05:** **Pattern definitions live in a `nodemon` config table**, not hardcoded. A patterns
  table (e.g. `log_patterns_config`: match expression, level, `classification`) seeded from the
  Obsidian library (D-11). The collector reads it to classify each event; the read layer reads it
  to suppress benign. Tunable via SQL with no code/collector redeploy. (Chosen over hardcoded
  constants deliberately per the robustness/future-proof principle.)

### Schema layout (COL-02 / COL-03)
- **D-06:** **Deep VM metrics → a new `host_metrics_ext` fact** (do NOT widen the existing
  `host_metrics` row that Phase 14 VmVitals/host-detail already read — avoids migration risk to
  shipped readers). Likely **hybrid**: host-wide scalars can live on `host_metrics_ext`, but
  per-core CPU and per-device disk/net are variable-cardinality and need **child facts**
  (e.g. `host_cpu_core`, `host_disk_io`, `host_net_iface`) keyed by `host_id + collected_at`.
  Resolve exact scalar-vs-child split + column lists in the plan. Also collect `nproc` (core
  count) — fixes the earlier uncollected CPU-cores UI gap and enables load-vs-cores ratio.
- **D-06a:** **Dedicated `pg_health` fact** for `pg_stat_activity`/database counters + AP-12
  signature flags — structured numeric counters belong in a typed fact, not a log-line table;
  makes AP-12 thresholds deterministic. Postgres *log lines* still flow into `service_log_events`
  like any other service — the two are complementary sources.
- **D-06b:** All values stored **RAW** (D-14 carried forward) — severity/bands derived at read
  time, never at collection.

### Volume ceiling & retention (COL-01)
- **D-07:** **No hard per-tick ceiling that silently drops data.** Operator directive: never
  lose examples of important information — rare/distinct signatures are the training/debug
  material that makes future analysis (and node autonomy) possible. A blunt cap is rejected.
- **D-08:** **Priority-aware retention = keep-N-exemplars per signature AND classification-tiered
  windows (both combined):**
  - Per distinct signature: keep the `log_patterns` aggregate **forever** (count/first/last seen)
    + retain up to N raw exemplar rows (e.g. first-seen + newest). Redundant middle copies of
    high-frequency/benign signatures are evicted first.
  - Retention window keyed by `classification`: benign → short, warn/AP-11 → longer,
    AP-12/critical → kept indefinitely as exemplars.
  - Net effect: benign churn is bounded, but a distinct important signature's exemplar is never
    starved, and the aggregate fact of recurrence always survives. (21-day telemetry retention is
    the *baseline* for benign; important classes exceed it.) Tune N + windows in the plan.

### Rollout (COL-01/02/03)
- **D-09:** **Canary-first, then roll the fleet together.** Land collection + schema + readers +
  un-stubbed UI on the canary node (telemetry is currently canary-only — `CRON_JOB_12` not yet
  spliced fleet-wide), prove real log/metric data flows end-to-end, THEN splice all ~26 nodes.
  Lowest blast radius; matches current posture. Fleet splice can be its own rollout step.

### Read layer + UI un-stub
- **D-10:** New readers in `src/lib/read/`: `getServiceLogEvents(hostId/pubkey/service, window)`
  (applies the benign read-time filter, D-04), `host_metrics_ext` readers, a `pg_health` reader.
  Un-stub `NodeLogsStream` and `ServiceLogTail` with the log reader; feed deep VM metrics into
  VmVitals / host detail. Honor honest "data as of" / stale states (DS-01, OVW-04 carried
  forward).

### Obsidian library role
- **D-11:** The Obsidian `LQWD Node Log Reviews` library is a **build-time reference ONLY** — the
  source of truth for *which* patterns matter (benign list, AP-11/AP-12 signatures, healthy
  bands, real fleet log excerpts). Researcher/planner read it to **seed the pattern config table
  (D-05) and design the classifier**, then everything is **persisted in the DB**. The running
  system has **zero runtime dependency** on the vault (accessibility = DB-resident).

### Claude's Discretion
- Exact `host_metrics_ext` scalar-vs-child-fact split and full column lists (D-06).
- Exact N (exemplars/signature) and the per-classification retention windows (D-08).
- The `/proc`/`/sys` source list per metric — confirm Ubuntu norms via research
  (`/proc/stat`, `/proc/schedstat`, `/proc/meminfo`, `/proc/vmstat`, `/proc/diskstats`,
  `/proc/net/dev`, `/proc/net/snmp`, `ss -s`, `/proc/sys/fs/file-nr`, `systemctl --failed`,
  chrony/ntp offset, `df -i`, `nproc`).
- Context-line linkage mechanism in `service_log_events` (D-01/D-02).
- Whether classification enum values beyond {benign, warn, ap11, ap12, critical, other} are
  needed once the Obsidian library is transcribed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase brief & requirements
- `.planning/COLLECTOR-EXPANSION-BRIEF.md` — the full phase brief (gap analysis, proposed
  collection design, open decisions this CONTEXT resolves).
- `.planning/REQUIREMENTS.md` §COL — COL-01, COL-02, COL-03 requirement text.
- `.planning/ROADMAP.md` §Phase 15 — goal + success criteria.

### Log-pattern source of truth (Obsidian — build-time reference, D-11)
Vault: `~/Obsidian Vault/LQWD Node Log Reviews/`. Read before designing the log-event schema +
classifier + seeding the pattern config table:
- `Library/Data-Gap Inventory.md` — canonical gap list from real fleet reviews.
- `Library/Known Benign Patterns.md` — lines to NOT alarm on (suppress from signal).
- `Library/Operational Anti-Patterns.md` — the failure signatures that matter.
- `Library/Analytical Failure Modes.md` — how log analysis goes wrong (classifier guardrails).
- `Library/Healthy Range Bands.md` — thresholds for graded signals.
- `Library/Runbooks/AP-12 PG-LND Tuning Deploy.md` + `Force-Close Prevention*.md` — the PG/LND
  AP-11/AP-12 signatures to detect.
- `Nodes/*/*—Full Log Analysis.md`, `*—Correlated Events.md`,
  `*—Resource Saturation Windows.md` — concrete log excerpts (France, Sweden, Japan,
  SouthAfrica) = classifier training/spec material.

### Code the phase extends
- `scripts/fileserver/collect_telemetry.py` — the collector to extend. Key existing functions:
  `grade_log_service` (reads tail, computes `error_count`/`detail` — the discard point),
  `gather_host_metrics`, `gather_host_storage`, `fetch_inventory` (reads `error_pattern`).
- `src/components/node/NodeLogsStream.tsx` — defines `NodeLogLine` target shape; currently fed
  `logs: []`.
- `ServiceLogTail` (rendered from `service/[service]/page.tsx`) — currently fed `logRows: []`.
- `src/lib/read/` — existing readers to mirror (`host-metrics.ts`, `chain-telemetry.ts`,
  `host-history.ts`). New readers land here.
- `src/lib/db/schema/nodemon` — where the new `nodemon` tables + migrations go (Drizzle owns
  `nodemon` migrations ONLY; never the warehouses).
- `ap12-advisory.ts` — the LLM stopgap this phase's COL-02 ingestion retires.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Collector rail** — `collect_telemetry.py` already tails per-service artifacts, matches
  `error_pattern` from inventory, and does direct psycopg2 INSERTs each `*/5` tick under the
  least-privilege RLS role. Extend it; do not build a new collection path.
- **Read-layer pattern** — `src/lib/read/*.ts` (e.g. `host-metrics.ts`, `chain-telemetry.ts`)
  are the template for the new `getServiceLogEvents` / `host_metrics_ext` / `pg_health` readers,
  including the latest-per-`chan_id` / `fee_msat/1000.0` guardrails and RAW-then-band-at-read
  posture.
- **Log UI shells** — `NodeLogsStream` + `ServiceLogTail` are already built and render honest-
  empty; only the data feed is missing.

### Established Patterns
- **RAW storage, bands at read time (D-14)** — new facts store raw values; no severity in the DB.
- **RLS on `host_id`** — every `nodemon` fact carries host-scoped RLS; new tables match.
- **Drizzle owns `nodemon` only** — `generate`/`migrate` for the new tables; warehouses are
  read-only, hand-curated schema.
- **Canary-only telemetry** — `CRON_JOB_12` is not fleet-wide; design canary-first (D-09).

### Integration Points
- Collector `grade_log_service` is where matched lines are currently discarded — the insertion
  point for `service_log_events` + `log_patterns` upsert.
- The pattern config table (D-05) is read by both the collector (classify) and the read layer
  (suppress benign).
- Un-stub swaps `logs: []` / `logRows: []` in the two page components for the new reader output.

</code_context>

<specifics>
## Specific Ideas

- **±5 context lines** specifically (not ±2) — multi-line PG/LND errors are the target.
- **Both** exemplar-keeping AND classification-tiered retention — the strongest guarantee that
  critical signatures persist while benign churn stays bounded.
- The whole phase is explicitly framed as the **substrate for node autonomy** — favor the
  comprehensive/future-proof option at every fork (operator, 2026-07-14).

</specifics>

<deferred>
## Deferred Ideas

- **Dashboard auto-refresh heartbeat** — a client poller that re-reads `nodemon` on an interval
  so the dashboard shows telemetry updating near-real-time, honoring the honest "data as of"
  pill. Scheduled *after* this phase so there's live data to refresh against. (Operator follow-up,
  brief §Follow-up.)
- **Fleet-wide collector splice** — rolling the expanded collector to all ~26 nodes is a rollout
  step after the canary proves the design (D-09), not part of the core build.
- **AIX-02 narration + infra→HTLC impact edge** — Phase 16; derivable from existing warehouse
  data, not a collection gap.

### Reviewed Todos (not folded)
- `2026-06-23-node-detail-all-channels-fee-queue.md` (Node Detail all-channels + per-channel fee
  queue) — UI/fee-queue work, unrelated to collector expansion. Belongs to a node-detail/fee
  phase.
- `ui-polish-fleet-console.md` (fleet console UI polish) — UI polish, out of scope for a data-
  collection phase.

</deferred>

---

*Phase: 15-data-collection-expansion-logs-deep-vm-metrics*
*Context gathered: 2026-07-14*
