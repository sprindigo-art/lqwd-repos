# Phase 11: Full-Stack Telemetry Ingestion - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Widen the read model beyond Lightning. Three new **per-domain telemetry tables** land in the `nodemon` DB (the only read-write Drizzle-owned DB — the `routing_vm` / `ldk-lspd-main` warehouses are read-only via `grafana_demo_ro`): host/VM vitals (CPU/mem/disk/network, storage usage + growth), **two-axis service-health** (RUNNING + FUNCTIONING NORMALLY) for the infra trio (bitcoind/esplora/postgres) + the 6 custom LQWD services, and bitcoind/chain telemetry (blocks-behind-tip, verificationprogress, peers, mempool). A new **Python telemetry collector** (its own cron line, its own script, mirroring the `nodeAuditor` venv pattern) runs on the **existing Phase-8 heartbeat/collector rail** — `*/5` cron, scp distribution via the fileserver, direct node→Postgres write, RLS-scoped — **no new persistent daemon/agent/AI on the node**. Every signal carries a `collected_at` stamp so a stale/missing signal is **derivable as stale at read time, never silently rendered as healthy** (SC#4). Phase 11 also ships the **typed Drizzle read API** (latest-per-entity DISTINCT-ON via AFM-001 + read-time staleness + threshold evidence) that Phases 12–15 render against. Requirements: TEL-01, TEL-02, TEL-03.

**Explicitly NOT this phase:** any UI/screen (Phases 12–15 render this read model — no "UI hint" on Phase 11); fleet-wide rollout beyond the single Phase-8 canary host (later/hardening territory); the Grade-A security scan + env-only VM flip (Phase 16); modifying the Phase-6/8 command-queue/HMAC/apply path (telemetry is a strictly separate, read-only collector that never touches the credentialed apply path); rewriting or instrumenting the 6 custom services (their existing artifacts are scraped, not changed); AI/correlation/root-cause grouping (Phase 15).

</domain>

<decisions>
## Implementation Decisions

### Read-model schema & history (TEL-01/02/03)
- **D-01:** **Per-domain typed tables** in `nodemon` — `host_metrics`, `service_health`, `chain_telemetry` — NOT one generic `telemetry_samples` table. Strong typing, clean per-screen Drizzle queries, indexes tuned per access pattern. Matches the curated read-model philosophy and the 13-table warehouse precedent.
- **D-02:** **Append history + retention.** Each `*/5` tick INSERTs a new timestamped row; a rolling window (target ~14–30 days; exact duration is planner's discretion) is pruned by a sweep. Required for Phase-14 storage %/day growth + projected time-to-full and Phase-13/14 sparklines. "Latest per entity" is a DISTINCT-ON read using the existing **AFM-001** helper — never `WHERE timestamp = MAX(timestamp)`.
- **D-03:** **Keyed by explicit `host_id` + `node_pubkey`.** A small **`hosts` dimension table** maps `host_id` → its node pubkeys (a host can run 2+ nodes). `host_metrics` / `chain_telemetry` keyed by `host_id`; `service_health` keyed by `(host_id, service_name)` plus `node_pubkey` for node-scoped services. Enables the Phase-12/14 host-outage→child-node rollup the root-cause grouping (OVW-01) needs.
- **D-04:** **RLS extended to a host axis.** Per the Phase-8 RLS model, the collector additionally `SET app.host_id = '<derived>'` per connection (derived once, like `identity_pubkey` from `lncli getinfo`). RLS on host-level tables allows write where `host_id = current_setting('app.host_id')`; node-scoped service rows keep the pubkey check. The physical DB boundary stays — no node can forge another host's rows. Exact policy SQL extends `db/role-grants.sql` (hand-authored, NOT Drizzle-migrated) — researcher writes it.

### Service-health two-axis (TEL-02)
- **D-05:** **RUNNING axis** via a per-service detection map: `systemctl is-active <unit>` is authoritative for systemd-managed daemons (infra trio); fall back to `pgrep`/process-pattern or recent-cron-invocation for the cron-launched custom services. Researcher enumerates the actual 9 services and picks the method per service against the real host.
- **D-06:** **FUNCTIONING axis for the 6 custom cron services** = **scrape existing artifacts** (zero changes to services NodeMonitor doesn't own): log-file mtime → freshness; grep success/error markers → last-successful-run + error count; known output files where they exist. Per-service parse rules are declared in the collector. (Format-coupled by design; a status-file convention is a possible future upgrade — see Deferred.)
- **D-07:** **FUNCTIONING axis for the infra trio** = **native health probe per daemon**, beyond "process alive": bitcoind → `getblockchaininfo` responds + not far behind tip (reuses the TEL-03 RPC calls); postgres → `SELECT 1` / `pg_isready`; esplora → an HTTP health/tip request returns OK. This is what catches the "up but dead" state the two-axis exists for. Green only when both axes true.
- **D-08:** **Declared expected-set per host/node** (a `service_inventory` dimension, or expected-services on the `hosts`/node mapping) declares which of the 9 services each host/node SHOULD run. Collector emits a row per expected service; a **missing expected signal → stale/down**, a non-expected service → simply no row. Makes honest-stale (SC#4) provable and avoids false "down" on services never meant to run there.

### Collector mechanism & cadence (TEL-01/02/03)
- **D-09:** **Separate collector**, not an extension of `run_check-queue.sh`: a new `run_collect-telemetry.sh` with its own `CRON_JOB_N` in `updateCrontab.sh`, distributed via the same `nodemonDownload.sh` rail, writing to the same `nodemon` DB. Keeps the safety-critical HMAC/claim/`lncli` **apply path cleanly isolated** from read-only telemetry — a telemetry bug can never touch the apply path; each fails and cadences independently.
- **D-10:** **Uniform `*/5` cadence**, all signal types each tick (matches the fleet-default heartbeat — `check-queue`, `run_monitoring`). One ~5-min freshness expectation drives the stale threshold uniformly. Tiering heavy signals to a slower cadence is left as a later knob if pilot load warrants — not built now.
- **D-11:** **Python collector (venv + psycopg2)** mirroring `run_nodeAuditor.sh`. Telemetry writes are **read-only observations → NO HMAC signing needed** (RLS + the least-privilege role is the integrity boundary; a tampered telemetry row is displayed, never executed). So the Phase-8 pure-bash openssl-interop rationale does NOT apply here. Python handles log-parsing + per-domain row shaping + multiple subprocess probes (systemctl/`bitcoin-cli`/df/free) far more cleanly than bash.
- **D-12:** **Scope: prove on the single Phase-8 canary host; schema + collector designed fleet-ready.** All TEL-01/02/03 signals land live for that one host; honest stale/no-data covers every not-yet-onboarded host. Fleet rollout (per-host creds, expected-set, `host_id` provisioning) is deferred — mirrors the Phase-8 one-canary discipline.

### Freshness & thresholds (TEL-03, SC#4)
- **D-13:** **Staleness is DERIVED at read time**, never stored. Every row carries `collected_at` (and the entity's last-seen). A signal is stale if `now - collected_at > its per-type max-age` (target ~3× the `*/5` cadence ≈ 15 min, matching the Phase-8 reaper window). No stored `stale`/`fresh` flag — a stored flag would lie the moment the collector stops. A **declared host with zero rows** reads as no-data via the `hosts` dimension, so a never-reported host is still detectable.
- **D-14:** **Thresholds live in a versioned config/insight layer, applied at read time** — the collector stores **raw observed values only** (blocks-behind, verifprogress, peers, mempool, CPU%, disk%, …). The "what is bad" bands extend the existing `healthy-range-bands.md` / insight-engine pattern and are evaluated when rendering evidence. Re-tuning a threshold doesn't require re-ingesting; one source of truth across all screens. (No baked-in severity on rows — history must not freeze stale judgments.)
- **D-15:** **Phase 11 ships the full read API**, not just tables+collector: `src/lib/db` typed query helpers (e.g. `getLatestHostMetrics`, `getServiceHealth`, `getChainTelemetry`) that do latest-per-entity DISTINCT-ON (AFM-001) + read-time staleness (D-13) + threshold evidence (D-14). Phases 12–15 call these — they never re-derive queries (prevents the DISTINCT-ON / faked-freshness failure modes the project guards against).
- **D-16:** **Verification = seeded-fixtures tests + one live pilot proof** (mirrors Phase 8): (a) deterministic tests against a seeded test `nodemon` DB assert the read helpers return correct latest-per-entity + derived staleness + threshold evidence — including a stale row reading as stale, a never-reported host as no-data, and an "up but dead" service as not-functioning; (b) a live proof on the canary host that real host/service/bitcoind signals actually land and are queryable end-to-end.

### Operator-resolved at plan time (2026-06-25) — binding
- **D-17 (resolves OQ-1, the service-set conflict):** The canary's **expected/graded set = the SVC-01 six + infra trio = 9**: `aiLiquidityManager`, `internalRebalancer`, `Monitoring` (`run_monitoring.sh`), `nodeAuditor`, `addressBalances` (`run_listaddresses.sh`), `channelAcceptor` + `bitcoind`/`esplora`/`postgres`. `run_rebalance.sh` (cron DISABLED on the live fleet) is **declared in `service_inventory` but marked not-expected** — it reads as **no-data, never DOWN**. SVC-01 (REQUIREMENTS) wins over the CONTEXT canonical-refs list where they disagree (Monitoring in, rebalance out of the graded set). Per-service `expected_interval_seconds` lives in `service_inventory` (research §"per-service freshness ≠ uniform 15-min") so batch/6-hourly services don't false-alarm against the ~15-min collector clock.
- **D-18 (resolves OQ-7, dimension seeding):** The `hosts` + `service_inventory` dimension rows are seeded by a **one-time operator psql bootstrap** — a hand-authored seed SQL committed **alongside `db/role-grants.sql`** (NOT a Drizzle migration, NOT collector self-seed — the SELECT/INSERT-only telemetry role cannot INSERT dimension rows under RLS). Mirrors the Phase-8 out-of-band role-grants bootstrap discipline. The plan must include this seed artifact + a runbook step to apply it on the canary before the collector's first tick.

### Claude's Discretion
- Exact retention-window duration (D-02), the precise RLS policy SQL extending `db/role-grants.sql` (D-04), the per-service RUNNING detection method and FUNCTIONING parse rules for each of the 9 services (D-05/D-06/D-07), the exact host-vitals commands (`top`/`free`/`df`/`/proc`/`ip` parsing), the `bitcoin-cli` invocation + credential access on the host, the esplora health endpoint + postgres functioning check (D-07), table column layouts/indexes, and the storage time-to-full / %-day-growth computation location (collector vs read helper) — all planner/researcher discretion against the existing `bashScripts` + `nodeAuditor` conventions and the `lqwdLogs/_library` thresholds.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Paths relative to the project root; `../` points into the parent `ClaudeCode/` workspace; absolute paths point into the operator's live fleet tree.

### Phase-8 heartbeat/collector rail (binding — MUST mirror; the structural template)
- `.planning/phases/08-node-scripts-heartbeat/08-CONTEXT.md` — the heartbeat pattern this phase extends: `*/5` cron (D-09), direct node→Postgres (D-05), own-pubkey RLS via `SET app.node_pubkey` (D-07), fileserver scp distribution (D-01/D-02), secrets pre-placed out-of-band in a root-only env file (D-03), no daemon. Telemetry adds a parallel collector on the same rail.
- `scripts/fileserver/run_check-queue.sh` — the existing NodeMonitor heartbeat wrapper (md5 self-update + cron-runner) the new `run_collect-telemetry.sh` mirrors structurally.
- `scripts/fileserver/nodemonDownload.sh` + `scripts/fileserver/updateCrontab.snippet.sh` — the distribution rail + idempotent crontab merge; add the telemetry collector's `CRON_JOB_N` here.
- `scripts/fileserver/CANARY-RUNBOOK.md` — the Phase-8 pilot runbook; the live telemetry proof (D-16) extends it.

### Operator's existing fleet pattern (binding — mirror conventions)
- `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/run_nodeAuditor.sh` — **closest analog for D-11**: bash wrapper + venv + `psycopg2` + `flock` overlap guard + hourly cron. The Python telemetry collector copies this venv/runner shape.
- `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/config.sh` — `REMOTE_SERVER`/`REMOTE_PORT`/`REMOTE_USER`/`LND_DIR=/lnd`/`REMOTE_HOME`; sourced by all runners.
- `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/run_monitoring.sh` — the existing fleet host/node Go collector (`goscripts`/`check-node`) that populates the warehouse; reference for what host signals are already gathered and the `*/5` background-run pattern (NOT extended — telemetry uses the nodemon rail).
- `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/updateCrontab.sh` + `bashScriptDownloader.sh` — fleet-wide idempotent crontab merge + all-folder scp; the upstream of `scripts/fileserver/updateCrontab.snippet.sh`.
- The 6 custom-service runners whose artifacts D-06 scrapes: `run_liquidity_manager.sh`, `run_channelAcceptor.sh`, `run_internal_rebalancer.sh`, `run_rebalance.sh`, `run_listaddresses.sh`, `run_nodeAuditor.sh` — researcher enumerates the canonical 6 + their log/output locations against the live tree.

### In-repo schema, DB, queries (binding — extend, don't rebuild)
- `src/lib/db/schema/nodemon.ts` — the ONLY Drizzle generate/migrate schema; add `host_metrics` / `service_health` / `chain_telemetry` + `hosts`/`service_inventory` dimension tables here (D-01/D-03/D-08).
- `src/lib/db/nodemon.ts` — the `nodemon` Drizzle client (read-write); telemetry read helpers (D-15) live alongside.
- `db/role-grants.sql` — hand-authored three-role least-privilege + RLS; the host-axis RLS (D-04) + the telemetry-collector role extend this file (NOT Drizzle migrations).
- `src/lib/db/queries` (AFM-001 DISTINCT-ON helper) + `src/lib/format/units.ts` (AFM-002 formatter) — latest-per-entity reads (D-02/D-15) use AFM-001; any ppm/msat/byte value the collector or helpers echo uses AFM-002.
- `src/lib/db/health.ts` / `health.test.ts` — boot-time health-check + test pattern to mirror for the collector/read-helper tests (D-16).

### Thresholds / encoded insight (source of "what is bad")
- `lqwdLogs/_library/healthy-range-bands.md` + `operational-anti-patterns.md` — the existing threshold bands the read-time threshold config (D-14) extends for chain/host/service evidence. (Path under the workspace `lqwdLogs/_library/` per PROJECT.md §"Encoded insight".)

### Project planning (in-repo)
- `.planning/REQUIREMENTS.md` — TEL-01/02/03 acceptance criteria (verbatim).
- `.planning/ROADMAP.md` §"Phase 11" + §"Coupling Notes" — the goal, the four Success Criteria, and the telemetry-feeds-the-screens dependency (Phases 12–15 render this read model).
- `.planning/PROJECT.md` — warehouse read-only constraint, the `nodemon`-only-writable rule, the not-a-Grafana curated-signals scope.
- `../CLAUDE.md` (NodeMonitor) §1 — Drizzle read-only-warehouse boundary, three-client model, `nodemon` as the only migrate-owned DB.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-8 fileserver scripts** (`scripts/fileserver/*`) — `run_check-queue.sh`, `nodemonDownload.sh`, `updateCrontab.snippet.sh` are the structural templates for the telemetry collector wrapper, its distribution, and its cron line.
- **`run_nodeAuditor.sh` + venv pattern** — the battle-tested Python-on-node collector shape (venv bootstrap, `psycopg2`, `flock` overlap guard) to copy for D-11.
- **`src/lib/db/schema/nodemon.ts`** — the writable Drizzle schema to extend with the three telemetry tables + dimension tables.
- **AFM-001 DISTINCT-ON helper + AFM-002 units formatter** — directly reused by the latest-per-entity read helpers (D-15) and any value the collector logs.
- **`db/role-grants.sql`** — the hand-authored grants/RLS file the host-axis policy + collector role extend.
- **Phase-10 honest-stale primitives** (freshness chip, StaleChart) — already exist to render the stale/no-data states this phase makes derivable (consumed downstream in Phases 12–15, not this phase).

### Established Patterns
- Node-side Python collector: bash runner + venv + `psycopg2` direct Postgres + `flock` (`run_nodeAuditor.sh`).
- `nodemon` is the only Drizzle-owned (generate/migrate) DB for tables; roles/RLS/grants live in hand-authored `db/role-grants.sql`.
- Per-connection RLS scoping via `SET app.<key>` (Phase 8: `app.node_pubkey`; this phase adds `app.host_id`).
- Latest-per-entity reads via AFM-001 DISTINCT-ON — never `WHERE ts = MAX(ts)`; `fee_msat/1000.0` and related guardrails.
- Self-updating cron scripts on the fileserver scp rail + idempotent `updateCrontab.sh` merge.

### Integration Points
- Collector writes `host_metrics` / `service_health` / `chain_telemetry` (+ dimension rows) to `nodemon` via the new least-privilege telemetry role, RLS-scoped by `app.host_id` / `app.node_pubkey`.
- New `CRON_JOB_N` line in `updateCrontab.snippet.sh`; collector lands in `/lnd/nodemon` via `nodemonDownload.sh`.
- Read helpers in `src/lib/db` are consumed by Phases 12–15 screens; threshold config (D-14) extends the insight layer the screens render as evidence.

</code_context>

<specifics>
## Specific Ideas

- The two-axis "green only when both true" semantics, with the "up but dead" (RUNNING true, FUNCTIONING false) state made unmistakable, is the headline reason FUNCTIONING uses native probes / artifact-scraping rather than mere liveness (D-06/D-07).
- "Honest stale" is a hard invariant: derived-at-read staleness with NO stored fresh/stale flag (D-13), and a declared-but-silent host reading as no-data rather than vanishing.
- Telemetry is deliberately walled off from the credentialed apply path — separate script, separate cron, no HMAC, read-only role — so a collector bug can never affect command execution (D-09/D-11).
- Scope discipline carried from Phase 8: design fleet-ready, prove on one canary, defer fleet rollout (D-12).

</specifics>

<deferred>
## Deferred Ideas

- **Service heartbeat-file convention** — a uniform status file (last_run_ts/last_success_ts/error_count) each custom service emits, read in place of log-scraping (D-06). Cleaner and more robust, but requires touching the 6 services (outside this phase's domain). Possible future upgrade; the collector could read it if present and fall back to scraping.
- **Tiered collection cadence** — moving heavy signals (full host vitals, storage growth) to a slower cadence than `*/5` (D-10). Left as a tunable knob; revisit if pilot load warrants.
- **Fleet-wide rollout** — onboarding all ~26 nodes / N hosts beyond the single canary (D-12). Later / Phase-16 hardening territory.
- **AI / cross-layer correlation + root-cause grouping** — consumes this telemetry but is Phase 15 (AIX-01/02); not built here.
- **The screens that render this read model** — Ops Center overview, Nodes/Service Health, Hosts/Infra (Phases 12–14). Phase 11 provides the read API + honest stale states they render against.

</deferred>

---

*Phase: 11-Full-Stack Telemetry Ingestion*
*Context gathered: 2026-06-25*
