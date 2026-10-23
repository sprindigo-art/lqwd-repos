# Collector Expansion — Logs + Deep VM Metrics into nodemon (NEW PHASE, pre-AI)

**Decision (operator, 2026-07-14):** Fill the data-collection gap BEFORE building the AI ingestion layer — "without the data AI will fail to be meaningful." Sequence this new phase **before** the current Phase 15 (Incident Lifecycle + AI). Keep collector cadence at **`*/5`** for now.

## Goal
Expand `scripts/fileserver/collect_telemetry.py` to persist, into new `nodemon` tables at `*/5`:
1. **Log/error events** — the matched log lines the collector already reads but currently discards (keeps only `error_count` + one `detail`). This is the #1 AI-ingestion gap (AIX-01).
2. **Deeper VM/host metrics** — Ubuntu/VM-specific signals not currently stored at sufficient depth (this is OS-level, NOT node-specific).

Then wire read-layer functions + un-stub the log UI (`NodeLogsStream`, `ServiceLogTail` are built but fed `[]`).

## Gap analysis (from 3-agent investigation, 2026-07-14)
- **No log-line/error-event table exists** in any DB. Collector tails up to 64 KB per service, computes `error_count` (int) + `detail` (one string), throws the lines away. `NodeLogsStream`/`ServiceLogTail` render honest-empty (`logs: []`, `logRows: []`).
- **`NodeLogLine` type already defines the target shape**: `{id, service, ts, level: info|warn|error, message, aiRead?}` (`src/components/node/NodeLogsStream.tsx`).
- **PG logs / `pg_stat_*` not ingested** — the AP-12 signatures (`FATAL: too many clients`, serialization `40001` / SQLSTATE) are an acknowledged open gap; `ap12-advisory.ts` is an LLM stopgap **designed to retire once log ingestion lands**.
- **AIX-02 (cross-layer correlation) is mostly NOT a collection gap** — the grouping spine exists (`assembleIncidents` folds cards/hosts/chain/services/nodes). Missing = narrated rationale + an infra→HTLC impact edge, derivable from **warehouse data that already exists** (`lnd_node_forwards`, `closed_channels`, `pending_sweeps.broadcast_attempts`) but has no reader. Handle in the AI phase, not here.
- Current VM metrics are shallow: `host_metrics` = cpu_pct, load_1/5/15, mem_total/available_kb, swap_total/free_kb, uptime_seconds, net_rx/tx_bytes; `host_storage` = per-mount total/used/avail bytes. That's it.

## Source of truth for WHICH log patterns matter (Obsidian)
Vault: `~/Obsidian Vault/LQWD Node Log Reviews/`. Load these before designing the log-event schema + classifier:
- `Library/Data-Gap Inventory.md` — the canonical gap list from real fleet reviews.
- `Library/Known Benign Patterns.md` — lines to NOT alarm on (suppress from signal).
- `Library/Operational Anti-Patterns.md` — the failure signatures that matter.
- `Library/Analytical Failure Modes.md` — how log analysis goes wrong (guardrails).
- `Library/Healthy Range Bands.md` — thresholds for graded signals.
- `Library/Runbooks/AP-12 PG-LND Tuning Deploy.md` + `Force-Close Prevention*.md` — the PG/LND signatures (AP-11/AP-12) to detect.
- `Nodes/*/*—Full Log Analysis.md`, `*—Correlated Events.md`, `*—Resource Saturation Windows.md` — concrete example log excerpts (France, Sweden, Japan, SouthAfrica) = training/spec material for the classifier.

## Proposed collection design (refine on execution)
- **Extend the existing collector, no new rail.** Same `*/5` cron, same least-privilege RLS role, outbound-only, per-node bash→python. Stays in the zero-credentials-on-dashboard model.
- **Collect signal, not the firehose.** Persist only error/warn matched lines (via existing `errorPattern`), capped per tick, deduped by signature, 21-day retention (match telemetry). This bound is the most important design constraint.
- **New nodemon tables (draft — finalize in plan):**
  - `service_log_events` — `id, host_id, service_name, node_pubkey, collected_at, level, message, signature(hash of normalized line), source_path`. RLS on host_id like the other facts.
  - Optional `log_patterns` (derived/aggregate) — `signature, first_seen, last_seen, count_window, sample_message, classification` — or derive at read time from events. Decide raw-only vs raw+pattern in plan.
  - PG signatures: either a dedicated `pg_health` fact (pg_stat_activity/database counters + AP-12 signature flags) or fold into service_log_events for postgres. Retires the ap12-advisory LLM fallback → deterministic.
- **Deeper VM metrics (OS-level; expand `host_metrics` or a new `host_metrics_ext` fact).** Candidate set to add (confirm via web research for Ubuntu norms + `/proc`/`/sys` sources):
  - CPU: per-core busy %, iowait %, steal % (VM contention signal), context switches/s, interrupts/s (`/proc/stat`, `/proc/schedstat`).
  - Memory detail: cached, buffers, dirty, writeback, slab, page faults, OOM-kill count (`/proc/meminfo`, `/proc/vmstat`, dmesg OOM).
  - Disk I/O per device: reads/writes completed, sectors r/w, io_in_progress, utilization %, await (`/proc/diskstats`); filesystem inode usage (`df -i`).
  - Network detail: errors, drops, collisions per iface, TCP retransmits + socket states (`/proc/net/dev`, `/proc/net/snmp`, `ss -s`).
  - Process/limits: total procs, running/blocked, fd usage vs limit (`/proc/sys/fs/file-nr`), thread count.
  - systemd: count of failed units (`systemctl --failed`), degraded state.
  - Time sync: chrony/ntp offset (clock skew matters for Lightning).
  - Load-vs-cores ratio (needs core count — currently uncollected; add `nproc` → also fixes the earlier CPU-cores UI gap).
  - Uptime/boot, entropy avail, temp if available.
- Every value RAW (D-14) — severity/bands derived at read time.

## Read layer + UI (after collection lands)
- New readers in `src/lib/read/`: `getServiceLogEvents(hostId/pubkey/service, window)`, host-metrics-ext readers, pg-health reader.
- Un-stub `NodeLogsStream` (page `[pubkey]/page.tsx` `logs: []`) and `ServiceLogTail` (`service/[service]/page.tsx` `logRows: []`) with the new reader.
- Feed deeper VM metrics into VmVitals / host detail.

## Open decisions to lock in the plan
1. Log scope: error/warn matched lines only (rec) vs broader bounded tail; context lines per error.
2. Raw events vs pattern aggregation vs both.
3. Volume ceiling: per-node/per-tick cap + retention (rec: cap N lines/tick, 21d).
4. Fleet rollout: telemetry is **canary-only** (`CRON_JOB_12` not spliced fleet-wide). Design canary-first, roll out together.
5. Schema: extend `host_metrics` vs new `host_metrics_ext` fact (wide table vs join).

## Follow-up (operator, after collection lands)
- **Dashboard auto-refresh heartbeat**: add a client refresh that re-reads `nodemon` on an interval so the dashboard shows telemetry updating in near-real-time ("see how it functions in real"). Scoped AFTER collection so there is live data to refresh against. Likely a polling revalidate on the force-dynamic pages or a lightweight client poller hitting a read endpoint; honor the honest "data as of" pill.

## Sequencing
1. THIS phase: collector expansion (logs + deep VM metrics) → schema → readers → un-stub UI → (optional) canary proof.
2. Then dashboard auto-refresh heartbeat.
3. Then the current Phase 15 (Incident Lifecycle + AI Explanation) — now with real data to ingest. Provider layer is already swappable (D17, commit ff0fc65).

## State
- AI provider made swappable already (D17): `src/lib/ai/provider.ts` registry, committed `ff0fc65`.
- Branch: `chore/close-phase-12` (198+ commits ahead of main — shipping is a separate open item).
