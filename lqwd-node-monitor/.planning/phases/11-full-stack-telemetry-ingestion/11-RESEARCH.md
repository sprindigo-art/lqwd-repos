# Phase 11: Full-Stack Telemetry Ingestion - Research

**Researched:** 2026-06-25
**Domain:** Node-side telemetry collection (host vitals / two-axis service-health / bitcoind-chain) on the Phase-8 cron rail → typed Drizzle read model in `nodemon`
**Confidence:** HIGH (every binding artifact read first-hand: live fleet scripts, in-repo schema/role-grants/AFM helpers, Phase-8 fileserver rail, threshold library)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 .. D-16 — research THESE, do not re-decide)

- **D-01:** Per-domain typed tables in `nodemon` — `host_metrics`, `service_health`, `chain_telemetry` — NOT one generic `telemetry_samples` table.
- **D-02:** Append history + retention. Each `*/5` tick INSERTs a timestamped row; a rolling window (~14–30 days; exact duration planner's discretion) pruned by a sweep. "Latest per entity" is a DISTINCT-ON read via AFM-001 — never `WHERE timestamp = MAX(timestamp)`.
- **D-03:** Keyed by explicit `host_id` + `node_pubkey`. A small `hosts` dimension table maps `host_id` → its node pubkeys (a host can run 2+ nodes). `host_metrics`/`chain_telemetry` keyed by `host_id`; `service_health` keyed by `(host_id, service_name)` plus `node_pubkey` for node-scoped services.
- **D-04:** RLS extended to a host axis. Collector additionally `SET app.host_id = '<derived>'` per connection. Host-level tables allow write where `host_id = current_setting('app.host_id')`; node-scoped service rows keep the pubkey check. Policy SQL extends `db/role-grants.sql` (hand-authored, NOT Drizzle-migrated).
- **D-05:** RUNNING axis via a per-service detection map: `systemctl is-active <unit>` for systemd daemons (infra trio); `pgrep`/process-pattern or recent-cron-invocation for cron-launched custom services. Researcher enumerates the actual 9 services + method per service.
- **D-06:** FUNCTIONING axis for the 6 custom cron services = scrape existing artifacts (zero changes to services NodeMonitor doesn't own): log-file mtime → freshness; grep success/error markers → last-successful-run + error count. Per-service parse rules declared in the collector.
- **D-07:** FUNCTIONING axis for the infra trio = native health probe per daemon: bitcoind → `getblockchaininfo` responds + not far behind tip; postgres → `SELECT 1`/`pg_isready`; esplora → HTTP health/tip returns OK. Green only when both axes true.
- **D-08:** Declared expected-set per host/node (a `service_inventory` dimension) declares which of the 9 services each host/node SHOULD run. Collector emits a row per expected service; a missing expected signal → stale/down; a non-expected service → simply no row.
- **D-09:** Separate collector — a new `run_collect-telemetry.sh` with its own `CRON_JOB_N`, distributed via `nodemonDownload.sh`, writing to `nodemon`. Keeps the HMAC/claim/`lncli` apply path cleanly isolated.
- **D-10:** Uniform `*/5` cadence, all signal types each tick. One ~5-min freshness expectation drives the collector stale threshold. Tiering heavy signals is a deferred knob.
- **D-11:** Python collector (venv + psycopg2) mirroring `run_nodeAuditor.sh`. Telemetry writes are read-only observations → NO HMAC signing. RLS + least-privilege role is the integrity boundary.
- **D-12:** Scope: prove on the single Phase-8 canary host; schema + collector designed fleet-ready. Honest stale/no-data covers every not-yet-onboarded host.
- **D-13:** Staleness is DERIVED at read time, never stored. Every row carries `collected_at`. Stale if `now - collected_at > per-type max-age` (~3× the `*/5` cadence ≈ 15 min). A declared host with zero rows reads as no-data via the `hosts` dimension.
- **D-14:** Thresholds live in a versioned config/insight layer, applied at read time — collector stores raw observed values only. Bands extend the existing `healthy-range-bands.md` / insight-engine pattern.
- **D-15:** Phase 11 ships the full read API: `getLatestHostMetrics`, `getServiceHealth`, `getChainTelemetry` doing latest-per-entity DISTINCT-ON (AFM-001) + read-time staleness (D-13) + threshold evidence (D-14). Phases 12–15 call these.
- **D-16:** Verification = seeded-fixtures tests (stale-reads-stale, never-reported-host-as-no-data, up-but-dead-service) + one live pilot proof extending `CANARY-RUNBOOK.md`.

### Claude's Discretion (research options, recommend)
Retention-window duration (D-02); exact RLS policy SQL (D-04); per-service RUNNING detection + FUNCTIONING parse rules for each of the 9 services (D-05/06/07); exact host-vitals commands (`top`/`free`/`df`/`/proc`/`ip`); `bitcoin-cli` invocation + credential access; esplora health endpoint + postgres functioning check (D-07); table column layouts/indexes; storage time-to-full / %-day-growth computation location (collector vs read helper).

### Deferred Ideas (OUT OF SCOPE — ignore)
Service heartbeat-file convention (touches the 6 services); tiered collection cadence; fleet-wide rollout beyond one canary; AI/cross-layer correlation/root-cause grouping (Phase 15); the screens that render this read model (Phases 12–14). **Also explicitly NOT this phase:** any UI/screen, the Grade-A scan + VM flip (Phase 16), modifying the Phase-6/8 HMAC/apply path, rewriting/instrumenting the 6 custom services.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|---------------------------------------------|------------------|
| **TEL-01** | Host/VM metrics (CPU/mem/disk/network, storage usage + growth) ingested into the read model, extending the Phase 8 heartbeat/collector pattern. | §Host-Vitals Commands (collector probes) + §Schema (`host_metrics` table) + §Read API (`getLatestHostMetrics`) + §Collector Mechanism (`run_collect-telemetry.sh`). |
| **TEL-02** | Service-health signals (running + functioning: heartbeat freshness, last-successful-run, error counts) ingested for the infra trio and the 6 custom services, per node/host. | §Service Inventory & Two-Axis Detection (enumerated 9 services + per-service method) + §Schema (`service_health` + `service_inventory`) + §Read API (`getServiceHealth`). **Open Question OQ-1: the "6" list disagrees between CONTEXT and SVC-01.** |
| **TEL-03** | bitcoind/chain telemetry (sync lag / blocks behind tip, verificationprogress, peers, mempool) ingested and surfaced as evidence with thresholds. | §bitcoind / Chain Telemetry (RPC invocation + credentials) + §Schema (`chain_telemetry`) + §Threshold Config (D-14 bands) + §Read API (`getChainTelemetry`). |
</phase_requirements>

---

## Summary

Phase 11 is **not** a greenfield build — it is a faithful **third rail** clone of the Phase-8 heartbeat infrastructure, plus a typed read-model extension to the one Drizzle-owned DB. Every structural decision already exists in the repo or the live fleet tree; the research job was to fill the concrete gaps the 16 locked decisions leave to discretion. All binding artifacts were read first-hand: the live fleet scripts at `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/` (the actual 9 services, their cadences, log paths, and success/error markers), the in-repo Phase-8 fileserver rail (`scripts/fileserver/*`), `db/role-grants.sql` (the RLS/role pattern to extend), the AFM-001 DISTINCT-ON helpers (`src/lib/read/latest.ts`, `node-info.ts`), the Drizzle nodemon schema + migration config, and `lqwdLogs/_library/healthy-range-bands.md`.

**Two findings change the planning surface materially.** (1) **The "6 custom services" set is genuinely ambiguous** — CONTEXT.md's canonical-refs list (`run_rebalance.sh` …) and the SVC-01 UI requirement (`Monitoring` …) disagree by one service, and `run_rebalance.sh`'s cron line is **commented out / disabled** on the live fleet (OQ-1, must be operator-resolved). (2) **The uniform 15-min staleness threshold (D-13) applies to the COLLECTOR's own `collected_at`, but it CANNOT be the per-service "functioning" freshness threshold** — the real services run at wildly different cadences (`*/5`, hourly, every-6-hours, disabled). A 6-hourly `listAddresses` log will always look "stale" under a 15-min window. The two freshness concepts are distinct and the `service_inventory` row must carry a **per-service `expected_interval_seconds`** so functioning-freshness is judged against each service's own schedule.

**Primary recommendation:** Build one Python collector (`collect_telemetry.py` + `run_collect-telemetry.sh` wrapper, venv+psycopg2, mirroring `run_nodeAuditor.sh`) that each `*/5` tick gathers host vitals (`/proc` + `df` + `ip`), two-axis service health (a declared per-service detection+parse map), and bitcoind/esplora/postgres probes; writes raw values to three new typed `nodemon` tables (+ two dimension tables) under a new least-privilege `nodemon_telemetry` role hard-boxed by `app.host_id`/`app.node_pubkey` RLS; ship three AFM-001 read helpers that derive staleness (D-13) and apply threshold bands (D-14) at read time; prove it with seeded-fixture vitest tests + a live canary-runbook extension.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Host vitals gathering (CPU/mem/disk/net) | Node (Python collector via `/proc`,`df`,`ip`) | — | Only the node can read its own kernel counters; no daemon (cron `*/5`). |
| Service RUNNING/FUNCTIONING detection | Node (collector: `systemctl`/`pgrep`/log-scrape) | — | Process liveness + artifact mtime are local-only facts. |
| bitcoind/chain RPC + esplora/pg probes | Node (collector: `bitcoin-cli`/curl/psql) | — | Uses on-node creds (D-03 root-only env file); never touches the dashboard. |
| Raw-value persistence | Database (`nodemon` 3 tables + 2 dims) | Node (INSERT via RLS-scoped role) | nodemon is the only RW Drizzle-owned DB; RLS is the integrity boundary. |
| Latest-per-entity + staleness + threshold evidence | API/Backend (`src/lib/read/*` Drizzle helpers) | — | D-15: read-time derivation; one source of truth; prevents DISTINCT-ON/faked-freshness failure modes. |
| Threshold bands ("what is bad") | API/Backend (versioned config) | — | D-14: applied at read time so re-tuning never re-ingests. |
| Rendering stale/no-data/evidence | Frontend (Phases 12–15) | — | OUT OF SCOPE this phase — primitives already exist (Phase-10 freshness chip / StaleChart). |
| Pruning old rows | Node-collector OR DB sweep | — | D-02; recommendation below (in-collector prune each tick). |

---

## Standard Stack

This phase adds **no new npm packages** and **no new Python packages beyond what the fleet already runs**. Everything is an extension of installed, production-proven tooling.

### Core (all already present)
| Library | Version (verified) | Purpose | Why Standard |
|---------|--------------------|---------|--------------|
| drizzle-orm | `^0.45.1` (package.json) | Typed schema for 5 new tables + read helpers | `[VERIFIED: package.json]` The only sanctioned DB access (CLAUDE.md). |
| drizzle-kit | `^0.31.9` | `generate`/`migrate` the new tables into `nodemon` ONLY | `[VERIFIED: drizzle.nodemon.config.ts]` nodemon is the only migrate-owned DB (D-08). |
| postgres (postgres.js) | `^3.4.8` | nodemon RW client (dashboard read side) | `[VERIFIED: src/lib/db/nodemon.ts]` existing client; helpers live alongside. |
| vitest | (installed; `npm test`=`vitest run`) | Seeded-fixture + no-DB shape tests (D-16) | `[VERIFIED: package.json scripts]` mirror `health.test.ts` skipIf pattern. |
| Python 3 + venv | system py3 (node-side) | The collector runtime (D-11) | `[VERIFIED: run_nodeAuditor.sh]` battle-tested fleet pattern. |
| psycopg2 (`psycopg2-binary`) | fleet-installed | Node→nodemon direct INSERT | `[VERIFIED: run_liquidity_manager.sh L41-43, run_nodeAuditor.sh L47]` already imported on every node. |

### Supporting (node-side, all standard CLI tools — no install)
| Tool | Purpose | Availability |
|------|---------|--------------|
| `bitcoin-cli` (or raw `curl` JSON-RPC) | TEL-03 chain telemetry | `[VERIFIED: updateLndConfig.sh]` bitcoind RPC creds present on-node; see §bitcoind. |
| `systemctl is-active` | RUNNING for systemd daemons (D-05) | `[ASSUMED]` standard on the Linux nodes; confirm infra-trio units are systemd-managed (OQ-2). |
| `pgrep -f` / `pgrep -x` | RUNNING for persistent Go services | `[VERIFIED: run_channelAcceptor.sh L17, run_monitoring.sh L16]` already used by the fleet. |
| `df` / `/proc/meminfo` / `/proc/stat` / `/proc/loadavg` / `ip -s link` | Host vitals (TEL-01) | `[ASSUMED]` standard procfs/iproute2 on Linux; see §Host-Vitals Commands. |
| `pg_isready` / `psql -c 'SELECT 1'` | Postgres functioning (D-07) | `[ASSUMED]` confirm which postgres + creds (OQ-3). |
| `curl` | esplora HTTP health/tip (D-07) | `[ASSUMED]` esplora endpoint unknown (OQ-4). |

**Installation:** No `npm install`. Schema migration only:
```bash
npm run db:generate   # drizzle-kit generate → drizzle/nodemon/000X_*.sql
npm run db:migrate    # apply to nodemon ONLY (never the warehouses)
```
Node-side venv bootstrap is handled by the wrapper exactly as `run_nodeAuditor.sh` does (create venv on first run, `pip install psycopg2 python-dotenv` if import fails).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Python collector (D-11 locked) | Pure bash (Phase-8 style) | Rejected by D-11: log-parsing + multi-domain row shaping + many subprocess probes are far cleaner in Python; no HMAC interop need here (unlike Phase 8). |
| `bitcoin-cli` | Raw `curl` JSON-RPC to bitcoind | `curl` avoids needing the `bitcoin-cli` binary on the node but must hand-handle the cookie/`rpcuser` auth + JSON; `bitcoin-cli -conf=` is simpler if the binary exists. Confirm at build (OQ-5). |
| In-collector prune (recommended) | Separate prune-sweep cron line | A separate sweep is one more cron line + one more failure surface; in-collector `DELETE WHERE collected_at < now()-interval` each tick is self-contained and idempotent (matches the Phase-8 node-runs-its-own-sweeps philosophy, 08-CONTEXT D-08). |

---

## Package Legitimacy Audit

This phase installs **no new registry packages**. All node-side Python deps (`psycopg2-binary`, `python-dotenv`) are already installed and invoked by the live fleet (`run_nodeAuditor.sh`, `run_liquidity_manager.sh`). All npm deps (drizzle-orm, drizzle-kit, postgres, vitest) are already in `package.json`.

| Package | Registry | Status | Disposition |
|---------|----------|--------|-------------|
| (none added) | — | — | N/A — phase extends existing, production-proven deps only. |

slopcheck not run: no new packages to audit. If the planner later decides to add a Python charting/parsing lib, gate it behind a `checkpoint:human-verify` and run the legitimacy gate then.

---

## Service Inventory & Two-Axis Detection (TEL-02 — the core research deliverable)

The live crontab (`updateCrontab.sh`) + each runner script are the **authoritative source**. Enumerated against the live fleet tree:

### The 9 services, RUNNING + FUNCTIONING methods

| # | Service (canonical name) | Runner | Cron cadence | Process model | Log / artifact path | RUNNING method (D-05) | FUNCTIONING method (D-06/07) | Success marker (grep) | Error marker (grep) |
|---|--------------------------|--------|-------------|---------------|---------------------|------------------------|------------------------------|-----------------------|---------------------|
| 1 | **bitcoind** (infra) | (systemd) | daemon | persistent | bitcoind debug.log | `systemctl is-active bitcoind` *(OQ-2)* | native: `getblockchaininfo` responds + `blocks≈headers` (reuses TEL-03 RPC) | RPC returns + not far behind tip | RPC timeout / `verificationprogress<0.9999` |
| 2 | **esplora** (infra) | (systemd/docker) | daemon | persistent | — *(OQ-4)* | `systemctl is-active` *or* `pgrep` *(OQ-4)* | native: HTTP `GET /blocks/tip/height` → 200 + integer | HTTP 200 + numeric height | non-200 / connection refused |
| 3 | **postgres** (infra) | (systemd) | daemon | persistent | PG log | `systemctl is-active postgresql` *(OQ-2/3)* | native: `pg_isready` / `SELECT 1` | `pg_isready` rc=0 | rc≠0 / refused |
| 4 | **aiLiquidityManager** | `run_liquidity_manager.sh` | `*/5` (CRON_JOB_8) | cron batch (Python) | `/var/log/liquidity_manager.log` | recent-cron-invocation (log mtime ≤ ~10 min) | log mtime freshness + grep markers | `completed successfully` | `failed with exit code` |
| 5 | **channelAcceptor** | `run_channelAcceptor.sh` | `*/5` (CRON_JOB_4) | **persistent Go bg proc** (`&`) | `/lnd/channelAcceptor/channel_acceptor.log` (+ crontab redirect `run_channelAcceptor.log`) | `pgrep -f channelAcceptorScript` | process alive AND log mtime fresh | (Go binary; mtime-driven) | log error lines |
| 6 | **internalRebalancer** | `run_internal_rebalancer.sh` | hourly (CRON_JOB_6/7) | cron batch (Python) | `/lnd/internalRebalance/internal_rebalance.log` (+ `_create.log`, `_pay.log`) | recent-cron-invocation (log mtime ≤ ~70 min) | log mtime + markers | run completion lines | psycopg2/exit-code errors |
| 7 | **nodeAuditor** | `run_nodeAuditor.sh` | hourly (CRON_JOB_10) | cron batch (Python, flock) | `/lnd/nodeAuditor/cron_nodeauditor.log` (+ `nodeauditor.log`) | recent-cron-invocation (log mtime ≤ ~70 min) | log mtime + markers | `collection completed successfully` | `collection failed with exit code` |
| 8 | **addressBalances / listAddresses** | `run_listaddresses.sh` | **every 6 h** (CRON_JOB_9) | cron batch (Go) | `/lnd/listAddresses/list_addresses.log` | recent-cron-invocation (log mtime ≤ ~6.5 h) | log mtime + markers | `Successfully completed database update` | `Database update failed with exit code` |
| 9 | **Monitoring** | `run_monitoring.sh` | `*/5` (CRON_JOB_3) | **persistent Go bg proc** (`goscripts &`) | `/lnd/check-node/cron_monitoring.log` | `pgrep -x goscripts` | process alive AND log mtime fresh | (Go binary; mtime-driven) | log error lines |
| (alt) | **rebalance** | `run_rebalance.sh` | **DISABLED** (CRON_JOB_5 commented out) | cron batch (Go) | `/lnd/rebalance/cron_rebalance.log` | recent-cron-invocation | log mtime + markers | run completion | failure lines |

**Process-model insight that drives detection:** the services split into three RUNNING archetypes —
- **Persistent background process** (channelAcceptor `channelAcceptorScript`, Monitoring `goscripts`): use `pgrep` — these are *supposed* to be alive continuously; `pgrep` miss = DOWN.
- **Cron batch** (liquidityManager, internalRebalancer, nodeAuditor, listAddresses, rebalance): there is **no long-lived process** — `pgrep` would almost always miss. RUNNING here means "ran on schedule recently" = log-mtime ≤ its expected interval. This is why D-05 says "recent-cron-invocation" for cron-launched services.
- **Systemd daemon** (infra trio): `systemctl is-active`.

### CRITICAL: per-service freshness ≠ uniform 15-min (D-13 nuance)
D-13's ~15-min staleness applies to the **collector's own `collected_at`** (is the telemetry itself fresh — did the `*/5` collector run?). It is the **wrong threshold for service FUNCTIONING freshness**: a 6-hourly `listAddresses` or a disabled `rebalance` log will always exceed 15 min and false-alarm as "dead." Therefore:

> **Recommendation:** `service_inventory` carries a per-service **`expected_interval_seconds`** (e.g. liquidityManager=300, internalRebalancer/nodeAuditor=3600, listAddresses=21600, persistent procs=300 for log-liveness). Functioning-freshness = `now - last_artifact_mtime > expected_interval × grace_factor` (grace ≈ 2–3×). Collector-freshness (D-13, ~15 min) is judged separately on `host_metrics.collected_at`. Two distinct clocks; do not conflate them.

### OQ-1 — the "6 custom services" disagreement (MUST be operator-resolved before planning the inventory seed)
- **CONTEXT.md canonical-refs list (the 6):** `run_liquidity_manager.sh`, `run_channelAcceptor.sh`, `run_internal_rebalancer.sh`, **`run_rebalance.sh`**, `run_listaddresses.sh`, `run_nodeAuditor.sh`.
- **SVC-01 (REQUIREMENTS.md) list (the 6):** aiLiquidityManager, internalRebalancer, **Monitoring**, nodeAuditor, addressBalances, channelAcceptor.
- **Difference:** SVC-01 has **Monitoring** (`run_monitoring.sh`); CONTEXT has **rebalance** (`run_rebalance.sh`). And `run_rebalance.sh`'s cron (CRON_JOB_5) is **commented out** on the live fleet → it does not run today. `[VERIFIED: updateCrontab.sh L9]`
- **Recommendation:** Collector should support **all** services in the `service_inventory` dimension (it costs nothing — a row per declared service), and the *expected-set per host* (D-08) decides which are graded. Default the canary's expected-set to the **SVC-01 six** (the UI contract the downstream screens render) + the infra trio = 9, and mark `rebalance` as a known/declared-but-not-expected service so it reads as no-data rather than DOWN. **Surface this to the operator at discuss/plan time.**

---

## Host-Vitals Commands (TEL-01 — D-03 discretion)

Collector parses procfs/coreutils — **no third-party agent**. Store **raw** values (D-14); formatting/thresholds happen at read time.

| Metric | Source command / file | Parse | Stored column (raw) |
|--------|-----------------------|-------|---------------------|
| CPU % busy | `/proc/stat` (two reads ~1s apart) OR `/proc/loadavg` | delta of `(total-idle)/total` × 100; loadavg fields 1/5/15 | `cpu_pct` (numeric), `load_1/load_5/load_15` |
| Memory | `/proc/meminfo` | `MemTotal`, `MemAvailable` (kB) | `mem_total_kb`, `mem_available_kb` (bigint) |
| Swap | `/proc/meminfo` | `SwapTotal`, `SwapFree` | `swap_total_kb`, `swap_free_kb` |
| Disk usage per mount | `df -P -B1` (POSIX, bytes) | per-filesystem total/used/avail/mount | one `host_storage` row per mount (see schema) |
| Network counters | `/proc/net/dev` or `ip -s link` | per-iface rx/tx bytes (cumulative) | `net_rx_bytes`, `net_tx_bytes` (bigint, cumulative — rate derived at read time from two samples) |
| Uptime | `/proc/uptime` | seconds | `uptime_seconds` |

**Storage growth / time-to-full computation location (D-03 discretion):**
> **Recommendation: compute at READ time, not in the collector.** The collector stores raw `used_bytes`/`total_bytes` per mount per tick (append history, D-02). The read helper computes `%/day growth` via linear regression / first-vs-last over the retained window and projects `time-to-full` — because (a) D-14 says re-tuning/derivation must not require re-ingest, (b) the projection math is pure and unit-testable in TS alongside the read helpers, (c) HOST-02 explicitly requires "no projection shown when data is stale/insufficient," which is a read-time honesty gate. The collector's only job is honest raw samples + `collected_at`.

CPU% needs two `/proc/stat` reads ~1s apart (a single read gives cumulative jiffies, not a rate). Alternatively store cumulative jiffies and derive rate at read time (same philosophy as net counters) — **recommended** to keep the collector a pure sampler and avoid a 1-s sleep inside every tick.

---

## bitcoind / Chain Telemetry (TEL-03 — D-07 discretion)

### Credentials & topology (VERIFIED from the live tree)
`updateLndConfig.sh` exports the bitcoind RPC creds the fleet already uses:
- `BITCOIND_RPCUSER="lqwd_btcd_user_for_2023"`, `BITCOIND_RPCPASS="…"` `[VERIFIED: updateLndConfig.sh L39-40]`
- `BITCOIND_RPCHOST` — **default `192.243.215.104:20853` (REMOTE)**, with a `127.0.0.1:853` override branch. `[VERIFIED: updateLndConfig.sh L43, L147]`

**Implication:** bitcoind may be **remote** to the LND/host node (split architecture). The collector must target `BITCOIND_RPCHOST` from the root-only env file (D-03 convention) — **never hardcode** creds in the distributed `collect_telemetry.py` (the script ships over scp; secrets do not — see §Security). The RPC port (`20853`/`853`) is non-standard (not 8332), confirming a custom deployment — read it from env, do not assume.

### RPC calls → stored raw values
| Call | Fields extracted | Stored column (raw) |
|------|------------------|---------------------|
| `getblockchaininfo` | `blocks`, `headers`, `verificationprogress`, `initialblockdownload`, `size_on_disk` | `blocks`, `headers`, `verification_progress` (numeric), `ibd` (bool), `size_on_disk_bytes` |
| `getnetworkinfo` / `getpeerinfo` | `connections` (in/out) | `peer_count`, `peers_in`, `peers_out` |
| `getmempoolinfo` | `size`, `bytes`, `mempoolminfee` | `mempool_tx_count`, `mempool_bytes`, `mempool_min_fee` |

`blocks_behind_tip` = `headers - blocks` — **derive at read time** (D-14), store raw `blocks`+`headers`.

### Invocation (recommend raw curl JSON-RPC; confirm bitcoin-cli availability — OQ-5)
```bash
# from the root-only env file: BITCOIND_RPCUSER, BITCOIND_RPCPASS, BITCOIND_RPCHOST
curl -s --user "$BITCOIND_RPCUSER:$BITCOIND_RPCPASS" \
  --data-binary '{"jsonrpc":"1.0","id":"nm","method":"getblockchaininfo","params":[]}' \
  -H 'content-type: text/plain;' "http://$BITCOIND_RPCHOST/"
```
Python: use `psycopg2` for DB + `requests`/`urllib` for the JSON-RPC (urllib avoids a new dep; `requests` may already be present — confirm at build). `bitcoin-cli -rpcconnect=$host -rpcport=$port -rpcuser=… getblockchaininfo` is the alternative if the binary exists on the host.

### esplora (D-07 — OQ-4, lowest confidence)
No esplora reference exists anywhere in the fleet scripts. Esplora's standard health signal is `GET /blocks/tip/height` (returns a bare integer) or `/blocks/tip/hash`. **The endpoint host/port is unknown** — flag as an open question; the canary operator must supply it. Until known, the collector should emit esplora as a declared service whose probe target comes from the env file, defaulting to no-data (honest stale) if unset.

### postgres functioning (D-07 — OQ-3)
`pg_isready -h <host> -p <port>` (rc=0) or `psql 'SELECT 1'`. **Which postgres?** Likely the per-host postgres backing the warehouse, but the connection target + a read-only probe credential must be confirmed (do NOT reuse a write cred for a liveness probe). Recommend `pg_isready` against the host's local PG socket if infra-trio postgres is co-located; confirm topology with operator.

---

## Schema — Drizzle Table Layouts (D-01/03/08)

Add to `src/lib/db/schema/nodemon.ts` (the ONLY migrate-owned schema). Snake_case DB ↔ camelCase TS, matching the existing `commands`/`command_audit` convention. Five new objects: 3 telemetry fact tables + 2 dimension tables. `host_storage` is split from `host_metrics` because disk is per-mount (1:N per tick).

### Dimension tables (low-churn, declared)
```
hosts                                  service_inventory
─────────────────────────────         ──────────────────────────────────────
host_id        text PK                 id                 uuid PK
hostname       text                    host_id            text  → hosts.host_id
node_pubkeys   text[]   (D-03: a       service_name       text  (canonical, e.g. "nodeAuditor")
               host runs 2+ nodes)     node_pubkey        text NULL (node-scoped services only)
created_at     timestamptz             detection_method   text  ("systemctl"|"pgrep"|"cron-mtime"|"native")
                                       running_target     text  (unit name | pgrep pattern | n/a)
                                       artifact_path      text NULL (log path for FUNCTIONING scrape)
                                       success_pattern    text NULL (grep marker)
                                       error_pattern      text NULL (grep marker)
                                       expected_interval_seconds  integer  (per-service freshness clock!)
                                       is_expected        boolean (D-08 expected-set; false = declared-but-not-graded)
```

### Fact tables (append history, D-02; every row carries `collected_at`)
```
host_metrics (TEL-01)                  service_health (TEL-02)
─────────────────────────────         ──────────────────────────────────────
id            uuid PK defaultRandom    id              uuid PK defaultRandom
host_id       text  (RLS axis)         host_id         text  (RLS axis)
collected_at  timestamptz  (D-13)      service_name    text
cpu_pct       numeric                  node_pubkey     text NULL
load_1/5/15   numeric                  collected_at    timestamptz (D-13)
mem_total_kb  bigint                   running         boolean  (RUNNING axis)
mem_available_kb bigint                functioning     boolean  (FUNCTIONING axis)
swap_total_kb / swap_free_kb bigint    last_success_at timestamptz NULL (parsed from artifact)
net_rx_bytes / net_tx_bytes bigint     last_artifact_mtime timestamptz NULL
uptime_seconds bigint                  error_count     integer  (window grep count)
                                       detail          text NULL (probe note / reason for not-functioning)

host_storage (TEL-01, per-mount)       chain_telemetry (TEL-03)
─────────────────────────────         ──────────────────────────────────────
id            uuid PK defaultRandom    id                 uuid PK defaultRandom
host_id       text  (RLS axis)         host_id            text  (RLS axis)
collected_at  timestamptz              collected_at       timestamptz (D-13)
mount_point   text                     blocks             bigint
total_bytes   bigint                   headers            bigint
used_bytes    bigint                   verification_progress numeric
avail_bytes   bigint                   ibd                boolean
                                       size_on_disk_bytes bigint
                                       peer_count / peers_in / peers_out integer
                                       mempool_tx_count   integer
                                       mempool_bytes      bigint
                                       mempool_min_fee    numeric
```

### Indexes (tuned per the AFM-001 latest-per-entity access pattern, D-02/D-15)
The dominant read is DISTINCT-ON latest-per-entity ordered by `collected_at DESC`. Each fact table needs a composite index on **`(entity_key, collected_at DESC)`**:
- `host_metrics`: `(host_id, collected_at DESC)`
- `host_storage`: `(host_id, mount_point, collected_at DESC)`
- `service_health`: `(host_id, service_name, collected_at DESC)` (+ optionally `node_pubkey`)
- `chain_telemetry`: `(host_id, collected_at DESC)`
- Also a plain `(collected_at)` index on each to make the retention prune `DELETE WHERE collected_at < …` cheap.

**Bigint note:** mirror the AFM-002 / routing.ts discipline — postgres.js returns bigint columns as strings; coerce through the unit formatter, never raw arithmetic. AFM-002 (`units.ts`) currently has only sat/BTC/msat helpers — **host vitals need bytes→GiB and percent formatters**; add them to `units.ts` (still one source of truth) for the downstream screens (collector stores raw, so this is a read-side concern but worth flagging now).

---

## RLS & Role — Host-Axis Extension (D-04)

Extend `db/role-grants.sql` (hand-authored, **NOT** Drizzle-migrated) with a new least-privilege **`nodemon_telemetry`** role + RLS on the five new tables, mirroring the proven `nodemon_node` block (two-arg `current_setting(..., true)` → NULL-on-unset → fail-closed; `ENABLE` + `FORCE` RLS; role must not own the tables).

```sql
-- =====================================================================
-- nodemon_telemetry — least-privilege TELEMETRY collector role + RLS
-- Run ONCE against the `nodemon` DB as owner/superuser (NOT as the role).
-- Read-only observations (D-11): SELECT/INSERT only on fact tables, SELECT on
-- dimensions. NO UPDATE/DELETE/TRUNCATE/DDL (the in-collector prune DELETE, if
-- chosen, needs DELETE on fact tables — see note). Hard-boxed by app.host_id
-- (host-level facts) and app.node_pubkey (node-scoped service rows).
-- =====================================================================
CREATE ROLE nodemon_telemetry WITH LOGIN PASSWORD '<generated-strong-password>';
GRANT CONNECT ON DATABASE nodemon TO nodemon_telemetry;
GRANT USAGE  ON SCHEMA public TO nodemon_telemetry;

-- Fact tables: INSERT observations (+ SELECT for the in-collector prune count).
GRANT SELECT, INSERT ON host_metrics, host_storage, service_health, chain_telemetry TO nodemon_telemetry;
-- Dimensions: SELECT only (rows seeded by the operator / a separate provisioning step).
GRANT SELECT ON hosts, service_inventory TO nodemon_telemetry;
-- If the in-collector prune (D-02) is chosen, additionally:
--   GRANT DELETE ON host_metrics, host_storage, service_health, chain_telemetry TO nodemon_telemetry;
--   (DELETE is still RLS-scoped to the node's own host_id — it can only prune its own rows.)

-- ── RLS: host-axis on host-level tables; pubkey-axis on node-scoped service rows ──
ALTER TABLE host_metrics    ENABLE ROW LEVEL SECURITY; ALTER TABLE host_metrics    FORCE ROW LEVEL SECURITY;
ALTER TABLE host_storage    ENABLE ROW LEVEL SECURITY; ALTER TABLE host_storage    FORCE ROW LEVEL SECURITY;
ALTER TABLE chain_telemetry ENABLE ROW LEVEL SECURITY; ALTER TABLE chain_telemetry FORCE ROW LEVEL SECURITY;
ALTER TABLE service_health  ENABLE ROW LEVEL SECURITY; ALTER TABLE service_health  FORCE ROW LEVEL SECURITY;

CREATE POLICY tel_own_host_metrics ON host_metrics
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_host_storage ON host_storage
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_chain ON chain_telemetry
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
-- service_health: host_id always set; node_pubkey checked only for node-scoped rows.
CREATE POLICY tel_own_service ON service_health
  USING      (host_id = current_setting('app.host_id', true)
              AND (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (host_id = current_setting('app.host_id', true)
              AND (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true)));
```

**Per-connection scoping (collector):** `SET app.host_id = '<derived>'` and `SET app.node_pubkey = '<lncli getinfo identity_pubkey>'` (D-04, mirroring Phase-8 D-07). `host_id` derivation: recommend `hostname` (`/etc/hostname` or `hostname -f`) as the stable host key, recorded in the `hosts` dimension at provisioning — confirm with operator (OQ-6). Use `SET LOCAL` inside the insert transaction so the GUC cannot leak across pooled connections (matches the `nodemon_node` two-arg fail-closed pattern).

**Pitfall (carried from Phase 8):** `nodemon_telemetry` MUST NOT own the new tables, or `FORCE RLS` is bypassed. The migration runs as the schema owner; the role only gets the scoped grants above.

---

## Read API Helpers (D-15) — `src/lib/read/`

Mirror the AFM-001 pattern in `src/lib/read/latest.ts` / `node-info.ts`: a `build…Sql()` exposed separately (no-DB shape test) + an async executor; `host_id`/`pubkey` always **parameter-bound**, never concatenated. Read against the nodemon RW client (`dbNodemon`). Three helpers, each = DISTINCT-ON latest-per-entity + read-time staleness (D-13) + threshold evidence (D-14).

```ts
// getLatestHostMetrics(): latest host_metrics + host_storage per host_id.
//   SELECT DISTINCT ON (host_id) * FROM host_metrics ORDER BY host_id, collected_at DESC
//   (host_storage: DISTINCT ON (host_id, mount_point))
// Plus: storage %/day growth + time-to-full computed over the retained window
// (first-vs-last / regression); NO projection when window insufficient/stale (HOST-02 honesty).

// getServiceHealth(): LEFT JOIN service_inventory (expected-set, D-08) so a
//   declared-but-never-reported service appears as NO-DATA, not absent.
//   functioning-freshness judged vs service_inventory.expected_interval_seconds
//   (NOT the 15-min collector clock). Returns {running, functioning, stale, lastSuccessAt, errorCount}.

// getChainTelemetry(): DISTINCT ON (host_id) latest chain_telemetry; derives
//   blocks_behind = headers - blocks at read time; attaches D-14 bands.
```

**Staleness (D-13):** every helper computes `stale = now - collected_at > maxAge`. Use the existing `parseDbTimestampUtc` (`src/lib/read/db-timestamp.ts`) to read `collected_at` as a UTC floor (the project already standardized this for warehouse timestamps). Collector-freshness maxAge ≈ 15 min (`host_metrics`/`chain_telemetry`); service functioning-freshness uses the per-service interval. **No stored stale flag** (D-13).

**Declared-host-with-zero-rows = no-data:** drive the host list from the `hosts` dimension and LEFT JOIN the facts, so a provisioned-but-silent host is detectable (SC#4) rather than vanishing.

---

## Threshold Config Layer (D-14)

Collector stores **raw values only**; "what is bad" lives in a versioned read-time config extending `lqwdLogs/_library/healthy-range-bands.md` (which already has bitcoind/Postgres/System bands). The existing Phase-2/4 pattern is a typed `*_CONFIG` object (e.g. `SCORECARD_CONFIG`, `INSIGHT_CONFIG`) consumed by pure evaluators — mirror it with a `TELEMETRY_BANDS` config in `src/lib/insight/` or `src/lib/read/`.

Bands available / recommended from the library + standard practice:
| Signal | Healthy | Warn | Critical | Source |
|--------|---------|------|----------|--------|
| Disk % free | >20% | 10–20% | <10% | `[CITED: healthy-range-bands.md "Disk space % free >20%"]` |
| bitcoind blocks-behind-tip | 0–1 | 2–6 | >6 | `[ASSUMED]` standard (1 block ≈ 10 min); confirm. |
| verificationprogress | ≥0.9999 | 0.999–0.9999 | <0.999 / IBD | `[ASSUMED]` standard bitcoind sync. |
| bitcoind peers | ≥8 | 3–7 | <3 | `[ASSUMED]` default `maxconnections` sanity. |
| CPU % busy | <70 | 70–90 | >90 | `[ASSUMED]` generic; operator may tune. |
| mem available | >15% | 5–15% | <5% (OOM risk) | `[CITED: healthy-range-bands.md "OOM kills/month 0"]` (related). |
| service functioning | fresh+success | stale | down / error-spike | derived from D-06 markers + interval. |

All `[ASSUMED]` numeric bands are config defaults the operator should confirm (logged in Assumptions). Re-tuning edits config, never re-ingests (D-14).

---

## Collector Mechanism (D-09/D-11)

### Files (mirror the Phase-8 + nodeAuditor pattern)
1. **`scripts/fileserver/run_collect-telemetry.sh`** — bash wrapper, structural clone of `run_check-queue.sh` (md5 self-update of the payload) + `run_nodeAuditor.sh` (venv bootstrap + flock + psycopg2 import-check). Sources `/lnd/bashScripts/config.sh`; working dir `/lnd/nodemon` (same dir the Phase-8 executors live in, pulled by `nodemonDownload.sh`). Sources the **root-only env file** for DB DSN + bitcoind/pg creds (D-03 — never shipped). Adds a `flock` overlap guard (a slow host probe must not pile up at `*/5`).
2. **`collect_telemetry.py`** — the Python payload: gather host vitals + per-service two-axis (driven by the `service_inventory` rows it SELECTs) + bitcoind/esplora/pg probes; `SET LOCAL app.host_id/app.node_pubkey`; INSERT one tick's rows across the 4 fact tables in a transaction; run the retention prune. Ships in `~/nodemon` on the fileserver → `/lnd/nodemon` via `nodemonDownload.sh` (the downloader already `chmod +x`'s `*.sh` and the executors; add `collect_telemetry.py` to its pull — it already `scp -r`'s the whole `~/nodemon` folder, so a new file is picked up automatically). `[VERIFIED: nodemonDownload.sh L37,41]`
3. **`scripts/fileserver/updateCrontab.snippet.sh`** — add a **`CRON_JOB_12`** constant + idempotent `grep -Fxq` merge block, exactly like the existing `CRON_JOB_11` snippet:
   ```bash
   CRON_JOB_12="*/5 * * * * /lnd/bashScripts/run_collect-telemetry.sh >> /lnd/nodemon/collect-telemetry.log 2>&1"
   ```
   (CRON_JOB_11 is the Phase-8 check-queue line; 12 is the next free slot. `[VERIFIED: updateCrontab.snippet.sh, updateCrontab.sh L4-14]`)

### Retention prune (D-02) — recommended in-collector
At the end of each tick: `DELETE FROM <each fact table> WHERE collected_at < now() - interval '<N> days'` (RLS-scoped → only the node's own rows). **Recommend N = 21 days** (mid-range of the 14–30 window): comfortably covers Phase-13/14 sparklines + storage %/day-growth regression while bounding table size at `*/5` cadence (≈ 288 rows/host/day × 21 ≈ 6k rows/host/table — trivial). Requires adding `DELETE` to the role grant (still RLS-boxed). Self-contained, idempotent, no extra cron line (matches 08-CONTEXT D-08 "node runs its own sweeps").

### Cadence reconciliation (D-10)
The collector runs `*/5` and emits **all** signal types each tick — correct per D-10. The per-service *interval* (above) governs only the functioning-freshness judgement at read time, not the collection cadence.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest-per-entity read | `WHERE collected_at = MAX(...)` | AFM-001 DISTINCT-ON helper pattern (`src/lib/read/latest.ts`) | The documented Canada "480-read-as-1" failure; D-02/D-15 mandate AFM-001. |
| Distribution channel | A new scp/rsync mechanism | `nodemonDownload.sh` + the 30-min downloader rail (D-09) | Phase-8 already proved it; a new channel is a new failure + secret surface. |
| Crontab install | Editing crontab directly | `updateCrontab.sh` `grep -Fxq` idempotent merge (CRON_JOB_12) | Re-runs every downloader tick; must be idempotent. |
| Node→DB integrity | HMAC-signing telemetry rows | RLS + least-privilege `nodemon_telemetry` role (D-11) | Telemetry is observed, never executed; HMAC is for the apply path only. A tampered row is *displayed*, never run. |
| venv/psycopg2 bootstrap | Custom installer | The `run_nodeAuditor.sh` import-check + `python3 -m venv` block | Battle-tested; copy verbatim. |
| Staleness flag | Storing `stale`/`fresh` | Derive at read time from `collected_at` (D-13) | A stored flag lies the moment the collector stops. |
| Unit conversion | Inline `/1e8`, `/1024**3`, `%` math | AFM-002 `units.ts` (extend with bytes/percent) | Single source of truth (CLAUDE.md). |

**Key insight:** Almost nothing here is new infrastructure — it is a third clone of a rail the operator already runs 9 services on. The risk is *divergence* from the proven pattern, not missing capability.

---

## Runtime State Inventory

> This phase **adds** new collection; it does not rename/migrate existing runtime state. But it provisions new on-node + DB state the planner must account for.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `nodemon` tables (`host_metrics`, `host_storage`, `service_health`, `chain_telemetry`, `hosts`, `service_inventory`) — created via `npm run db:generate`/`migrate`. Dimension rows (`hosts`, `service_inventory`) must be **seeded** (operator/provisioning), not collected. | Drizzle migration (code) + a dimension-seed step (operator data task — who seeds `hosts`/`service_inventory`? OQ-7). |
| Live service config | New `CRON_JOB_12` line merged into the **live** `updateCrontab.sh` on the fileserver (not just the in-repo snippet). New `~/nodemon/collect_telemetry.py` placed on the fileserver. | Operator splices snippet into live `updateCrontab.sh` + places the payload on the fileserver (mirror Phase-8 bootstrap). |
| OS-registered state | New crontab entry on the canary host (via the downloader). | Self-installs via the 30-min downloader once CRON_JOB_12 is live. |
| Secrets/env vars | bitcoind RPC creds, pg probe creds, esplora endpoint, nodemon_telemetry DSN — all go in the **root-only env file** (D-03), NEVER in the scp'd payload. New `nodemon_telemetry` password generated by operator. | Operator pre-places creds out-of-band (mirror Phase-8 D-03 `.nodemon.env`). |
| Build artifacts | New per-host venv at `/lnd/nodemon/.venv` (or reuse pattern); `psycopg2` install on first run. | Handled by the wrapper's bootstrap (copy `run_nodeAuditor.sh` block). |

**The canonical question (after every repo file is updated, what still has old state?):** N/A — additive phase. The provisioning state above is *new* and must be created, not migrated.

---

## Common Pitfalls

### Pitfall 1: Conflating collector-freshness with service-freshness
**What goes wrong:** Judging a 6-hourly `listAddresses` or hourly `nodeAuditor` against the 15-min D-13 clock → every batch service reads "dead/stale."
**How to avoid:** Per-service `expected_interval_seconds` in `service_inventory`; functioning-freshness uses it; the 15-min clock judges only `host_metrics`/`chain_telemetry.collected_at`.
**Warning sign:** All cron-batch services show red on a healthy host.

### Pitfall 2: `pgrep` on cron-batch services
**What goes wrong:** Cron-batch services (liquidityManager, nodeAuditor, …) have no long-lived process; `pgrep` almost always misses → false DOWN.
**How to avoid:** `detection_method='cron-mtime'` for batch services; `pgrep` only for the persistent Go procs (channelAcceptor `channelAcceptorScript`, Monitoring `goscripts`).

### Pitfall 3: Secrets in the distributed payload
**What goes wrong:** Hardcoding bitcoind RPC pass / DB DSN into `collect_telemetry.py` → secrets ride the scp channel (the live tree already leaks them in `updateLndConfig.sh` — do not repeat that in NodeMonitor).
**How to avoid:** Source the root-only env file at runtime (D-03); the static gate must assert no secret literal in the shipped script.

### Pitfall 4: RLS bypass via table ownership
**What goes wrong:** If `nodemon_telemetry` owns the new tables, `FORCE RLS` is bypassed and a buggy node could write another host's rows.
**How to avoid:** Migration runs as schema owner; role gets scoped grants only; verify ownership (Phase-8 Pitfall 6).

### Pitfall 5: Disabled / disagreeing service set (OQ-1)
**What goes wrong:** Seeding `rebalance` as expected → false DOWN (it's cron-disabled); or omitting `Monitoring` → SVC-01 screen has no data.
**How to avoid:** Resolve OQ-1 with the operator; seed the expected-set to the SVC-01 six + infra trio; mark `rebalance` declared-but-not-expected.

### Pitfall 6: bitcoind assumed local on 8332
**What goes wrong:** Defaulting to `127.0.0.1:8332` → connection refused (fleet uses `192.243.215.104:20853`, may be remote).
**How to avoid:** Read `BITCOIND_RPCHOST` from env; never assume host/port.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Generic `telemetry_samples` EAV table | Per-domain typed tables (D-01) | Clean per-screen Drizzle queries, tuned indexes. |
| Stored `stale` boolean | Read-time staleness from `collected_at` (D-13) | Truthful when the collector dies. |
| Severity baked onto rows | Read-time threshold bands (D-14) | Re-tune without re-ingest; history not frozen. |
| Persistent monitoring agent (node_exporter etc.) | Cron `*/5` pull collector, no daemon | Matches fleet ethos (no daemon/agent); reuses Phase-8 rail. |

**Not used (and why):** Prometheus/node_exporter/Grafana agents — explicitly out of scope (not-a-Grafana, no persistent daemon). Generic metrics libs — overkill; procfs parsing is trivial and dependency-free.

---

## Code Examples

### AFM-001 latest-per-entity (the pattern all three read helpers follow)
```ts
// Source: src/lib/read/latest.ts (in-repo, VERIFIED) — adapt host_id for host_metrics
export function buildLatestHostMetricsSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id) *
    FROM host_metrics
    WHERE host_id = ${hostId} AND host_id IS NOT NULL
    ORDER BY host_id, collected_at DESC`;
}
```

### Two-arg fail-closed RLS (the pattern the host-axis policy follows)
```sql
-- Source: db/role-grants.sql (in-repo, VERIFIED) — host-axis variant
CREATE POLICY tel_own_host_metrics ON host_metrics
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
```

### venv + psycopg2 bootstrap (collector wrapper)
```bash
# Source: run_nodeAuditor.sh L36-54 (live fleet, VERIFIED) — copy verbatim
if [ ! -x "${VENV_DIR}/bin/python3" ]; then python3 -m venv "${VENV_DIR}"; fi
PYTHON_BIN="${VENV_DIR}/bin/python3"
if ! "${PYTHON_BIN}" -c "import psycopg2, dotenv" 2>/dev/null; then
  "${PYTHON_BIN}" -m pip install -r "${REQUIREMENTS}"; fi
```

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The "6 custom services" = SVC-01 set (Monitoring, not rebalance); rebalance is declared-but-not-expected | Service Inventory / OQ-1 | Wrong expected-set → false DOWN or missing screen data. **Operator must confirm.** |
| A2 | Infra trio (bitcoind/postgres/esplora) is systemd-managed → `systemctl is-active` | Service Inventory / OQ-2 | If docker/tmux, RUNNING detection differs (use pgrep/`docker inspect`). |
| A3 | Postgres functioning probe target + read-only cred | bitcoind§/OQ-3 | Wrong target → false DOWN; reusing a write cred = security regression. |
| A4 | Esplora exists + `GET /blocks/tip/height` health; endpoint from env | bitcoind§/OQ-4 | No esplora ref in fleet tree — may not exist or use a different probe. |
| A5 | `bitcoin-cli` binary may be absent → use raw curl JSON-RPC | bitcoind§/OQ-5 | If neither curl-auth nor bitcoin-cli works, RPC access blocked. |
| A6 | `host_id` = hostname; seeded in `hosts` dimension at provisioning | RLS§/OQ-6 | Wrong key → RLS scoping + host rollup (OVW-01) break. |
| A7 | Threshold band numerics (blocks-behind, CPU%, peers) are config defaults | Threshold Config | Cosmetic only — config-tunable at read time, never re-ingested. |
| A8 | Retention window = 21 days, in-collector prune (DELETE grant) | Collector / Retention | Too short → sparkline/growth gaps; too long → table bloat (trivial at this scale). |
| A9 | Store CPU/net as cumulative counters, derive rate at read time | Host-Vitals | If single-sample %, collector needs a 1s sleep each tick. |
| A10 | Who seeds `hosts`/`service_inventory` dimension rows (operator vs migration seed) | Runtime State / OQ-7 | Unseeded dimensions → collector has no expected-set → emits nothing. |

**Resolve A1–A6 + A10 with the operator at discuss/plan time** (compliance/topology facts, not code choices).

---

## Open Questions (RESOLVED)

> Disposition at plan time (2026-06-25): OQ-1 → **D-17** (CONTEXT.md), OQ-7 → **D-18** (CONTEXT.md) — both binding operator resolutions. OQ-2..OQ-6 are live-host topology facts unknowable from the repo; **RESOLVED as deferred** to the Plan-07 CONFIRM-AGAINST-HOST canary-runbook step + the blocking operator checkpoint (07 Task 2), with honest fallbacks designed in (env-driven bitcoind/pg/esplora targets, esplora→no-data when unset, host_id from hostname, operator-substituted seed placeholders). See VALIDATION.md §"Manual-Only Verifications."

1. **OQ-1 (the "6") — RESOLVED → D-17:** Monitoring vs rebalance. Graded set = SVC-01 six + infra trio = 9; `rebalance` declared-but-not-expected (no-data, never DOWN).
2. **OQ-2 — RESOLVED (deferred to canary runbook):** Are bitcoind/postgres/esplora systemd units (→ `systemctl is-active`) or docker/tmux? Confirm unit/container names against the canary; detection method is env/inventory-driven.
3. **OQ-3 — RESOLVED (deferred to canary runbook):** Postgres functioning probe host:port + read-only probe credential — read from root-only env on the host; falls back to psycopg2 `SELECT 1`.
4. **OQ-4 — RESOLVED (deferred to canary runbook):** Does esplora run on the canary? host:port + health endpoint — env-driven; unset → honest no-data.
5. **OQ-5 — RESOLVED (deferred to canary runbook):** `bitcoin-cli` vs raw curl JSON-RPC; `requests` vs `urllib` in venv — confirm on host; raw JSON-RPC fallback designed in.
6. **OQ-6 — RESOLVED (deferred to canary runbook):** `host_id` derivation (hostname) + host↔node_pubkey mapping — seeded via D-18 `seed-dimensions.sql` with operator-substituted values.
7. **OQ-7 — RESOLVED → D-18:** Dimension-row seeding = one-time operator psql bootstrap (`db/seed-dimensions.sql`), NOT a Drizzle migration, NOT collector self-seed.
2. **OQ-2:** Are bitcoind/postgres/esplora systemd units (→ `systemctl is-active`) or docker/tmux? Provide unit/container names.
3. **OQ-3:** Postgres functioning probe — which host:port, and a read-only probe credential?
4. **OQ-4:** Does esplora run on the canary? What host:port + health endpoint?
5. **OQ-5:** Is `bitcoin-cli` on the host, or should the collector use raw curl JSON-RPC? Is `requests` available in the venv or use `urllib`?
6. **OQ-6:** Canonical `host_id` derivation (hostname?) and the host↔node_pubkey mapping for the canary.
7. **OQ-7:** Who seeds the `hosts` + `service_inventory` dimension rows — a one-time operator psql step (like the role-grants bootstrap) or a migration seed? (RLS means the collector can't INSERT dimensions itself with SELECT-only grant.)

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 + venv (node-side) | Collector (D-11) | ✓ (fleet) | system | — `[VERIFIED: run_nodeAuditor.sh]` |
| psycopg2-binary (node-side) | Node→nodemon INSERT | ✓ (fleet) | installed | — `[VERIFIED: run_liquidity_manager.sh]` |
| procfs / `df` / `ip` (node-side) | Host vitals | ✓ (assumed Linux) | — | — `[ASSUMED]` |
| bitcoind RPC | TEL-03 | ✓ creds present | RPC `…:20853` | — `[VERIFIED: updateLndConfig.sh]` |
| `bitcoin-cli` binary | TEL-03 (optional) | ? | — | raw curl JSON-RPC (OQ-5) |
| esplora HTTP | D-07 functioning | ? | — | declared no-data until known (OQ-4) |
| `pg_isready`/`psql` (node-side) | D-07 postgres | ? | — | `SELECT 1` via psycopg2 (OQ-3) |
| drizzle-kit (dashboard-side) | Schema migration | ✓ | `^0.31.9` | — `[VERIFIED: package.json]` |
| vitest (dashboard-side) | D-16 tests | ✓ | installed | — `[VERIFIED: package.json]` |

**Missing dependencies with no fallback:** none confirmed (esplora/bitcoin-cli have fallbacks; all are OQs, not blockers).
**Missing with fallback:** bitcoin-cli → curl; pg_isready → psycopg2 SELECT 1; esplora → honest no-data.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (`npm test` = `vitest run`) `[VERIFIED: package.json]` |
| Config file | vitest (project-default; existing tests under `src/lib/**`) |
| Quick run command | `npx vitest run src/lib/read` |
| Full suite command | `npm test` |
| Live-DB pattern | `describe.skipIf(!process.env.NODEMON_QUEUE_URL)` (mirror `health.test.ts`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEL-01 | `getLatestHostMetrics` returns latest-per-host (DISTINCT-ON), not N rows | unit (seeded nodemon) | `npx vitest run src/lib/read/host-metrics.test.ts` | ❌ Wave 0 |
| TEL-01 | storage %/day-growth + time-to-full; NO projection when window insufficient/stale | unit (pure) | `npx vitest run src/lib/read/storage-growth.test.ts` | ❌ Wave 0 |
| TEL-01 | `buildLatestHostMetricsSql` emits DISTINCT-ON, param-bound (no-DB shape) | unit | same file (no-DB describe) | ❌ Wave 0 |
| TEL-02 | "up but dead" (running=true, functioning=false) reads as not-functioning | unit (seeded) | `npx vitest run src/lib/read/service-health.test.ts` | ❌ Wave 0 |
| TEL-02 | never-reported declared service → no-data (LEFT JOIN service_inventory) | unit (seeded) | same file | ❌ Wave 0 |
| TEL-02 | per-service freshness uses `expected_interval_seconds`, not 15-min | unit | same file | ❌ Wave 0 |
| TEL-03 | `getChainTelemetry` derives blocks-behind + attaches bands | unit (seeded) | `npx vitest run src/lib/read/chain-telemetry.test.ts` | ❌ Wave 0 |
| SC#4 | stale row (`collected_at` old) reads as stale; never-reported host → no-data | unit (seeded) | across the above + `hosts`-dim test | ❌ Wave 0 |
| D-14 | threshold band evaluator (raw value → healthy/warn/critical) | unit (pure) | `npx vitest run src/lib/read/telemetry-bands.test.ts` | ❌ Wave 0 |
| live | real host/service/bitcoind signals land + are queryable end-to-end on canary | manual (canary) | extend `scripts/fileserver/CANARY-RUNBOOK.md` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/read` (the new helpers + bands)
- **Per wave merge:** `npm test` (full suite — must stay green; AFM re-verification)
- **Phase gate:** full suite green + the live canary telemetry proof + security greps (no secret literal in shipped collector; RLS verification query) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/read/host-metrics.ts` + `.test.ts` — TEL-01 latest + shape
- [ ] `src/lib/read/storage-growth.ts` + `.test.ts` — %/day + time-to-full honesty
- [ ] `src/lib/read/service-health.ts` + `.test.ts` — two-axis + no-data + per-service freshness
- [ ] `src/lib/read/chain-telemetry.ts` + `.test.ts` — blocks-behind + bands
- [ ] `src/lib/read/telemetry-bands.ts` + `.test.ts` — D-14 evaluator
- [ ] Seeded-fixture helper for a test `nodemon` DB (the stale / no-data / up-but-dead rows) — mirror the Phase-6 live-nodemon fixture approach
- [ ] `units.ts` bytes/percent formatters (AFM-002 extension) + tests
- [ ] CANARY-RUNBOOK telemetry section (D-16 live proof)

*(Existing infra reused: vitest, `health.test.ts` skipIf pattern, AFM-001 build…Sql shape-test pattern, `parseDbTimestampUtc`.)*

---

## Security Domain

> `security_enforcement` not set to false → included. This phase touches node-side creds + a new DB write role.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | New `nodemon_telemetry` role, operator-generated password in root-only env file; never in source/scp payload (D-03). |
| V4 Access Control | yes | RLS (`app.host_id`/`app.node_pubkey`, two-arg fail-closed + FORCE) — physical isolation; role must not own tables. |
| V5 Input Validation | yes | Collector parses procfs/JSON-RPC output; validate numeric coercion (no shell injection — argv subprocess, never shell-string, mirror EXEC-02 rule). |
| V6 Cryptography | no | Telemetry is read-only observation — NO HMAC (D-11); a tampered row is displayed, never executed. |
| V7 Errors/Logging | yes | Never log bitcoind RPC pass / DSN (CLAUDE.md: never log secrets); collector logs to `/lnd/nodemon/collect-telemetry.log`. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-host row forgery | Spoofing/Tampering | RLS `app.host_id` USING+WITH CHECK, FORCE, fail-closed two-arg `current_setting` |
| Secret leakage via scp'd script | Information Disclosure | Root-only env file (D-03); static-gate grep asserts no secret literal in payload |
| Shell injection via subprocess | Tampering/Elevation | argv invocation (never shell-string), parameter-bound SQL (AFM-001 discipline) |
| Privilege creep on the new role | Elevation | SELECT/INSERT (+scoped DELETE for prune) only; no UPDATE/TRUNCATE/DDL; verification query in role-grants.sql |
| Stale data shown as healthy | (data integrity) | Read-time staleness (D-13); declared-host-zero-rows → no-data; honest projections (HOST-02) |

**Note:** This phase deliberately does NOT touch the Phase-6/8 HMAC/claim/apply path (D-09). A telemetry bug physically cannot reach command execution — separate script, separate cron line, separate read-only-observation role. The Grade-A scan itself is Phase 16 (out of scope here), but the zero-secret-in-payload + RLS-isolation posture must be in place now so Phase 16 passes.

---

## Project Constraints (from CLAUDE.md)

- **Drizzle-only** DB access; `nodemon` is the **only** generate/migrate-owned DB; warehouses read-only via `nodemon_ro`. Roles/RLS hand-authored in `db/role-grants.sql`, **NOT** Drizzle-migrated.
- **`@/` imports** (no relative), **named exports**, functions <30 lines, objects-over-positional-args, `??` for defaults, early returns.
- **AFM-001** (DISTINCT-ON, never `WHERE ts=MAX(ts)`) + **AFM-002** (`units.ts`, no inline conversions) are mandatory and re-verified at phase gates.
- **No co-authored-by** trailers; branch-per-task; multi-agent parallel build.
- **No new persistent daemon/agent/AI on nodes** — cron + pre-downloaded scripts only.
- **Never log** macaroon bytes / keys / tokens / DSN / RPC pass.
- **HMAC hex-only** where signing applies — but **telemetry needs NO HMAC** (D-11).
- **Brand:** LQWD navy `#1A3C79`; NOC Light theme — but **no UI this phase**; v2 surfaces obey the `noc-guard` lint (not triggered here — backend/collector only).
- **GSD workflow enforcement:** edits go through a GSD command.
- **Project skill:** `Skill("sketch-findings-nodemonitor")` is UI-only — not relevant to this backend/collector phase.

---

## Sources

### Primary (HIGH confidence — read first-hand this session)
- `db/role-grants.sql` — the `nodemon_node`/`nodemon_ro` role + two-arg fail-closed FORCE-RLS pattern the host-axis extends.
- `src/lib/db/schema/nodemon.ts`, `drizzle.nodemon.config.ts`, `drizzle/nodemon/` — the only migrate-owned schema + migration setup.
- `src/lib/read/latest.ts`, `node-info.ts`, `db-timestamp.ts` — AFM-001 DISTINCT-ON helper + staleness-floor parsing pattern.
- `src/lib/format/units.ts` — AFM-002 (needs bytes/percent extension).
- `src/lib/db/health.ts` + `health.test.ts` — boot-check + vitest skipIf test pattern.
- `scripts/fileserver/{run_check-queue.sh,nodemonDownload.sh,updateCrontab.snippet.sh,CANARY-RUNBOOK.md}` — Phase-8 rail to clone.
- Live fleet tree `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/` — `config.sh`, `updateCrontab.sh` (cron map + cadences + log paths), `run_nodeAuditor.sh` (venv/psycopg2/flock), `run_liquidity_manager.sh`, `run_channelAcceptor.sh`, `run_internal_rebalancer.sh`, `run_listaddresses.sh`, `run_rebalance.sh` (disabled), `run_monitoring.sh`, `updateLndConfig.sh` (bitcoind RPC creds/host).
- `lqwdLogs/_library/healthy-range-bands.md` — threshold bands (disk %, bitcoind, postgres, system).
- `.planning/{REQUIREMENTS.md,ROADMAP.md,PROJECT.md}` + `08-CONTEXT.md` + `11-CONTEXT.md` — requirement/decision authority.

### Secondary (MEDIUM)
- Standard procfs/bitcoind-RPC/esplora conventions (cross-checked against fleet artifacts where present).

### Tertiary (LOW — flagged as Assumptions/OQs)
- Esplora endpoint, systemd-unit assumption, threshold numerics, host_id derivation — all OQs requiring operator confirmation.

---

## Metadata

**Confidence breakdown:**
- Standard stack & collector mechanism: HIGH — exact Phase-8 + nodeAuditor artifacts read; no new deps.
- Schema, RLS, read helpers: HIGH — direct extension of in-repo proven patterns.
- Service inventory (RUNNING/FUNCTIONING per service): HIGH on detection mechanics (scripts read first-hand); MEDIUM on the *expected-set* (OQ-1 disagreement requires operator).
- bitcoind/esplora/postgres probes: MEDIUM — bitcoind creds VERIFIED; esplora/pg targets are OQs.
- Threshold band numerics: LOW-MEDIUM — config-tunable defaults; disk % CITED, others ASSUMED.

**Research date:** 2026-06-25
**Valid until:** ~2026-07-25 (stable internal infra; the OQs are operator facts, not version drift).
