# Phase 16: Collector Enrichment — Robust Log Capture - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the `*/5` telemetry collector's **log capture** interval-complete, rotation-safe, and *usefully classified* — so the AI/incident layer (Phase 17) reads a meaningful, low-noise error signal instead of the current thin/mis-classified capture. Delivers COL-04 (interval-complete + rotation-safe capture), COL-05 (capture breadth + fidelity), COL-06 (real-log classification + self-maintaining paths + operational fixes).

**In scope:** collector log-capture behavior (`collect_telemetry.py`), `log_patterns_config` re-derivation, `service_inventory` path population, the lncli-wrapper fix, an owner-side path reconciler, and a version-gated rollout mechanism. Mostly collector behavior + config + seed — **no new warehouse tables expected**.

**Out of scope:** the Phase-17 AI/incident layer that consumes this data; the cron→systemd migration (separate future task); new fact tables.
</domain>

<decisions>
## Implementation Decisions

### Classification (re-derivation + taxonomy)
- **D-01 — Hybrid bootstrap sourcing:** Build the real `log_patterns_config` set by (a) mining the top real signatures from the live `log_patterns` aggregate across the fleet AND (b) cross-referencing the operator's local Obsidian "LQWD Node Log Reviews" library, then an **operator categorization pass** on the merged set. Patterns must come from reality — the seeded Obsidian-only set was proven wrong on the canary (real HSWC errors are "broken pipe"/"failing link", not the seeded "Unhandled error").
- **D-02 — Obsidian is bootstrap-only:** Obsidian is LOCAL and will not exist on the VM. Use it ONCE now to prime the initial patterns. The **ongoing** tuning mechanism must be data-driven only: the `log_patterns` aggregate (always in the warehouse) + operator `UPDATE`s to `log_patterns_config` (SQL-tunable per D-05, read live each tick, no fleet redeploy). No runtime Obsidian dependency.
- **D-03 — Clean 3-tier taxonomy:** Classification severity is **info** (benign/background) / **warn** (attention — real, worth noticing, not paging) / **critical** (pages/incidents). **Drop the opaque `ap11`/`ap12` codes** from log classification — operator finds them unclear and unhelpful. If a signature needs semantic grouping for the AI/incident layer, use a **human-readable category label** (e.g. "postgres-connection-exhaustion", "channel-reconnect"), not a cryptic code.
- **D-04 — pg_health counter path is untouched:** The deterministic too-many-clients detection (COL-02) reads `pg_health.too_many_clients_count` (a counter), NOT the log classification label. Dropping the `ap12` log-class does not break it. Planner must reconcile the existing `classification` enum + read-time bands (`telemetry-bands.ts`) + `ap12-advisory.ts` to the new info/warn/critical scheme.

### Capture policy (signal vs noise)
- **D-05 — Tier-driven capture:** Storage is governed by the D-03 tier. **info → count-only** in the `log_patterns` aggregate (the "happened N times" tally always survives; zero `service_log_events` exemplar rows — kills the CMGR/connid flood). **warn → capped exemplars + count.** **critical → more exemplars + count + longer retention.** The operator always sees the count even for suppressed noise, but `service_log_events` only fills with things worth reading.
- **D-06 — Count always survives:** Even for suppressed/transient errors that LND recovers from, the aggregate count is preserved (operator explicitly wants "make note of those errors even if LND continues"). This is the natural outcome of D-05's count-only info tier + the interval-complete scan (COL-04).

### Path discovery
- **D-07 — Recurring owner-side reconciler:** A scheduled OWNER-run job (not the collector) probes each node's standard log locations against a declarative service→path convention and UPSERTs `service_inventory`. Self-heals on path moves / new nodes; **auto-registers the daemon logs (lnd.log / bitcoind debug.log / local postgres) fleet-wide by default.** The collector stays **SELECT-only** on the warehouse (T-15 least-privilege boundary preserved).

### Rollout
- **D-08 — Version-gated canary rollout:** Add a self-update gate so nodes only pull a collector version they're pinned to (a version/channel field the node reads), letting a new build prove on ONE canary node first, then promote fleet-wide. Ends accidental splices permanently (an accidental fleet splice occurred 2026-07-15 when the expanded collector was published to the shared fileserver — it landed safely, but the "canary-only" isolation was not achievable via the shared rail). This is the right posture before the VM/production move.

### Design constraints
- **D-09 — Source-agnostic capture cursor:** Build the interval-complete scanner (COL-04) as a **"log source" interface** with a cursor: `read_since(cursor) → (lines, new_cursor)`. Ship the **file-tailing** implementation this phase (byte-offset + inode cursor; two rotation styles — LND stable-name rename-archive, Postgres timestamped-filename glob/newest-match). This deliberately mirrors journald's native cursor model so a future **journald** source (for the cron→systemd migration) is a bolt-on implementation, not a capture rewrite.

### Claude's Discretion (route to research/planning, not gray areas)
- Incremental offset-checkpoint scan mechanics (byte offset + inode + size; local node state file `/lnd/nodemon/.log-cursors.json`; bounded per-tick bytes with LOGGED truncation).
- Dual rotation detection algorithm (inode-change / size-shrink → drain newest archive → reset).
- Capture-by-`log_patterns_config`-match vs the single `error_pattern` substring gate (so `[WRN]`/`[CRT]` are captured); decoupling log-tailing from `detection_method` (so native-probed postgres/bitcoind get tailed).
- IP:port signature normalization in `_normalize`.
- `LNCLI_BIN` absolute-path fix in `/lnd/bashScripts/lncli-telemetry.sh`.
- Exact version/channel field + self-update gate design (D-08).

### Folded Todos
- **Collector log-capture enrichment** (`.planning/todos/pending/2026-07-15-collector-log-capture-enrichment.md`) — this todo IS the phase source; its 11 items map onto COL-04/05/06 and the decisions above.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase source & requirements
- `.planning/todos/pending/2026-07-15-collector-log-capture-enrichment.md` — the 11-item scope this phase implements; full rationale from the Phase-15 canary.
- `.planning/REQUIREMENTS.md` — COL-04/05/06 definitions (the testable outcomes).
- `.planning/ROADMAP.md` §"Phase 16: Collector Enrichment" — goal + success criteria.

### Collector + config (the code being changed)
- `scripts/fileserver/collect_telemetry.py` — the collector. Key functions: `extract_events` (L688, the `error_pattern` capture gate + `_classify`), `_normalize` (signature normalization), `grade_service`/`grade_log_service` (L814/L766, detection_method dispatch — native services skip log tailing), `_tail_text`/`_artifact_mtime` (L573, the fixed `LOG_TAIL_BYTES=65536` tail to replace), `_insert_log_events`/`_prune_tiered` (exemplar storage + retention), `resolve_node_pubkey` (L86, the bare-`lncli` call). Tunables: `LOG_TAIL_BYTES` (L53), `KEEP_N` (L600).
- `db/seed-log-patterns.sql` — the `log_patterns_config` seed to re-derive (currently Obsidian-derived, proven mismatched); `classification` enum + `suppress` flag + regex `match_expression` (D-05 SQL-tunable).
- `db/seed-dimensions.sql` — `service_inventory` seed (detection_method, running_target, artifact_path, error_pattern) the reconciler will maintain.
- `scripts/fileserver/deploy-env.sh` — writes the lncli wrapper (bare-`lncli` bug) + `.nodemon.env`; where the version-gate / `LNCLI_BIN` fix lands.
- `scripts/fileserver/run_collect-telemetry.sh` — the wrapper (flock, self-update, env sourcing) that the version-gate (D-08) modifies.
- `scripts/fileserver/nodemonDownload.sh` — the shared-fileserver `scp -r` pull (the accidental-splice mechanism D-08 gates).

### Read-layer + detector (must stay consistent with the new taxonomy)
- `src/lib/read/telemetry-bands.ts` — read-time severity bands (reconcile to info/warn/critical).
- `src/lib/read/service-log-events.ts` — reader joining `config_id → log_patterns_config` for suppression.
- `src/lib/insight/detectors/ap12-advisory.ts` — deterministic detector on `pg_health` counters (D-04: unaffected by the log-class change, but rename/clarify away from `ap12` label if it surfaces in UI).
- `scripts/fileserver/CANARY-RUNBOOK.md` §"Data-Collection Expansion (Phase 15)" — the canary procedure + verification queries; extend for this phase's canary rollout (D-08).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Signature dedup + `KEEP_N` exemplar + `log_patterns` aggregate machinery** (`extract_events`, `_insert_log_events`): already collapses duplicates to exemplars + a `count_window` aggregate. D-05 (tier-driven capture) and COL-04 (interval-complete scan) feed INTO this existing machinery — the count-window is the "always-survives tally". Do not rebuild; extend.
- **`detection_method` dispatch** (`detect_running`): already supports `pgrep`/`systemctl`/`cron-mtime`/`native`. The cron→systemd migration is mostly a `service_inventory` data change here, not code (informs D-09 / the deferred migration).
- **`log_patterns_config` SQL-tunable contract (D-05):** the collector reads it live each tick; operator `UPDATE`s retune classification with no fleet redeploy — the permanent tuning surface (D-02).

### Established Patterns
- **Collector is SELECT-only on the warehouse** (grants: `GRANT SELECT ON hosts, service_inventory`; the ONLY write exception is the scoped `UPDATE` on `log_patterns`). D-07's reconciler runs OWNER-side to preserve this — never grant the collector write on `service_inventory`.
- **FORCE RLS host-boxing** contains blast radius (proven across 16 host_ids during the splice) — the safety net behind D-08's rollout.
- **Canary-first proof** (D-09 Phase-15 pattern): prove on `lnd-ireland` before fleet promotion.

### Integration Points
- The classified/captured output is what Phase 17 (Incident Lifecycle + AI Explanation) reads — the 3-tier taxonomy (D-03) + human-readable category labels are the interface to that layer.
</code_context>

<specifics>
## Specific Ideas

- Operator wants the taxonomy **clear**: "benign/info, attention/warn, critical" — `ap11`/`ap12` are unclear and unhelpful (verbatim).
- Real error examples observed on `lnd-ireland` (for the re-derivation categorization): `CMGR Unknown connid=N` and `CMGR Can't accept connection … i/o timeout` → info/suppress noise; `HSWC broken-pipe/failing-link/resuming-link-failed` → warn (reconnection churn, esp. post-restart bursts); `SWPR/UTXN Failed to sweep` → warn/attention; `PEER … peer exiting/resend failed` → mostly info; postgres `FATAL: too many clients` → critical (this node has an active condition).
- Obsidian source: the "LQWD Node Log Reviews" library (local, bootstrap-only per D-02).
</specifics>

<deferred>
## Deferred Ideas

- **Cron → systemd services migration** — the operator will scope this as a SEPARATE agent task (review the current crons, then decide the best conversion approach). Out of Phase 16 scope. Impact when it happens: monitored scripts shift `cron-mtime` → `systemctl` detection (already supported); log source may shift files → journald (needs a journald source impl — enabled cleanly by D-09's source-agnostic cursor); and a systemd unit would fix the lncli/PATH/env + `.nodemon.env` permission fragility via `Environment=`/`User=`/`EnvironmentFile=`.
- **UI surfacing of the new tiers/categories** — how info/warn/critical + category labels render in the incident/log UI belongs to Phase 17.
</deferred>
