# Phase 8: Node Scripts + Heartbeat - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

The **only phase that touches real nodes.** A NodeMonitor `scripts` folder (`check-queue` + `apply-fee`) plus a bash downloader, deployed via the operator's **existing fleet remote-fileserver + cron pattern** (`/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts`), installs/updates a node's crontab heartbeat — **no persistent daemon/agent/AI on the node**. On each tick the pilot node reads **only its own pubkey's** `approved` jobs from the `nodemon` Postgres directly, verifies the HMAC over the **identical canonical form** Phase 6 froze, re-enforces `update_fee` param bounds **node-side**, applies via local `lncli` using **argv invocation (never shell-string interpolation)**, and writes the result + execution row + audit row back — under a per-node write rate-limit. Proven end-to-end on **one pilot (canary) node**: an approved `update_fee` applies and reports `succeeded` with the new policy visible on-node, and the five failure modes (tampered HMAC, un-approved row, expired command, overlapping ticks, wrong-pubkey job) are rejected/handled. Requirements: EXEC-01, EXEC-02, EXEC-03.

**Explicitly NOT this phase:** the Grade-A security scan + env-only VM flip (Phase 9); any queued action type other than `update_fee` (closes/rebalances stay export-only per Prong 2); LDK fee application (enqueue is LND-only per Phase 6 D-01b, so no LDK rows exist to apply — deferred); fleet-wide rollout beyond the one pilot node (Phase 9 hardening territory); changes to the dashboard-side queue/approval/HMAC code frozen in Phase 6 (this phase consumes it byte-identically, it does not modify it).

</domain>

<decisions>
## Implementation Decisions

### Distribution & install (EXEC-01)
- **D-01:** **Pull model on the existing rail.** Each node already runs a cron that connects to the fileserver and `scp`s scripts down (`bashScriptDownloader.sh` → `/lnd/bashScripts/*`, `chmod +x`, then runs `updateCrontab.sh`); the downloader re-runs **every 30 min** as a self-update. NodeMonitor's scripts get their own folder on the fileserver (under `~/` on the fileserver, mirroring `~/aiLiquidityManager` etc.) and a local working dir `/lnd/nodemon`. Mirror this pattern exactly — do NOT invent a new distribution channel.
- **D-02:** **Self-installing crontab entry** = add a new `CRON_JOB_N` line (a `*/5 * * * *` `run_check-queue.sh` line) to `updateCrontab.sh` on the fileserver. `updateCrontab.sh` already merges lines idempotently via `grep -Fxq`, so re-running just refreshes it. NodeMonitor owns its own dedicated cron line, separate from the existing fetch cron.
- **D-03:** **Secrets pre-placed once, out-of-band.** The per-node HMAC secret (`NODEMON_HMAC_SECRET_<pubkey>`) and the node's DB connection creds are installed on the node by existing provisioning, in a **root-only env file the scripts source** — same convention as the already-present `/lnd/id_rsa`, `/lnd/tls.cert`, `/lnd/data/chain/bitcoin/mainnet/admin.macaroon`. **The scp'd scripts NEVER carry secrets**; they only reference an already-present local file. Keeps the dashboard credential-less and the secret out of the script distribution channel.
- **D-04:** **Manual one-time bootstrap, then self-update.** On the pilot, the operator runs the downloader once by hand (it scp's the scripts + writes its crontab line); from then on the 30-min downloader cron self-updates the scripts. The per-payload self-update may follow the `run_liquidity_manager.sh` md5-hash-compare convention.

### Node↔queue transport (EXEC-02)
- **D-05:** **Direct Postgres from the node** — matches the house style (`aiLiquidityManager` already connects node→Postgres via `psycopg2`). The node connects to the `nodemon` DB with **pre-placed least-privilege creds**; the dashboard holds **zero node creds** either way. No new dashboard API surface.
- **D-06:** **The node runs the atomic claim + write-back itself**, byte-identical to `src/lib/queue/claim.ts` and `src/lib/queue/stub-executor.ts`: `SELECT … FOR UPDATE SKIP LOCKED` over one `approved`, non-expired row → flip `claimed` → `executing` → `succeeded|failed`, each guarded `UPDATE … WHERE id=? AND state=<expected>` paired with a `command_audit` insert, plus one `command_executions` row. **The DB row-lock is the no-double-apply guarantee** (Success Criterion / EXEC-03 overlapping-ticks).
- **D-07:** **Own-pubkey-only enforced by Postgres RLS.** A shared `nodemon_node` role; each connection runs `SET app.node_pubkey = '<identity_pubkey>'` and RLS policies hard-limit every SELECT/UPDATE to that pubkey. The script derives its own pubkey from `lncli getinfo` (`identity_pubkey`). Even a buggy/compromised script physically cannot touch another node's rows → wrong-pubkey jobs are **invisible**, not just filtered.
- **D-08:** **Node runs expire + reaper sweeps each tick.** Because there is no dashboard daemon and RLS scopes the node to its own rows, `check-queue` runs `expireSweep` (fail-close past-TTL pre-execution rows → `expired`) + `reaperSweep` (release its own stale `claimed` rows older than the reaper window → `approved`) **before** `claimNext` + apply. Self-contained stale-claim recovery on the pilot.

### Cadence, rate-limit & bounds (EXEC-02)
- **D-09:** **`*/5 * * * *` heartbeat** (fleet default, matching `run_monitoring`/`run_liquidity_manager`/`run_channelAcceptor`). This sets the real **stale-claim reaper window ≈ 3× = 15 min** → `NODEMON_CLAIMED_TIMEOUT_MS = 900000` (replaces the Phase 6 D-14 placeholder).
- **D-10:** **Per-node write rate-limit = 1 apply per tick + 4 applies/node/hour**, the hourly count **derived from `command_executions.executedAt`** over a rolling hour — **no new table**. A real backstop against a flood of approved rows; pairs with the engine's hysteresis (Phase 4 D-15) + operator approval as the upstream throttle.
- **D-11:** **`update_fee` bounds CONFIRMED and frozen** (removing the `[ASSUMED]` flag in `src/lib/queue/bounds.ts`): `suggestedPpm` 0–5000, `baseFeeMsat` 0–100000, `timeLockDelta` 18–2016. The dashboard, server, AND node all re-enforce these identical values (defense in depth, third enforcement node-side).

### Pilot & failure-mode proof (EXEC-03)
- **D-12:** **Canary node + one low-stakes channel.** Pick a low-traffic LND node + a single low-importance channel, apply a small real fee nudge, confirm the new policy via `lncli`, then **revert**. The exact node + channel are named by the operator at the execute-phase live gate (not pinned in CONTEXT.md), but the path is proven live.
- **D-13:** **Fail-closed "refuse-and-record".** On a tampered HMAC or out-of-bounds params, the node **NEVER calls `lncli`**; it flips the claimed row to `failed` with a specific reason (`hmac_mismatch` / `bounds_violation`) + an audit row, and logs locally. Un-approved/expired/wrong-pubkey jobs are **structurally never claimed** (state filter + TTL filter + RLS), proven by their absence. Overlapping ticks proven by `SKIP LOCKED` single-claim.
- **D-14:** **Five failure modes proven via seeded rows in a test/staging `nodemon` DB** (deterministic, repeatable, zero risk to live channels): tampered HMAC, un-approved, expired, wrong-pubkey, plus two overlapping `check-queue` invocations for the no-double-apply proof. Assert resulting state + audit rows. The **happy-path apply is proven live** on the canary (D-12).

### Claude's Discretion
- **Implementation language for `check-queue`/`apply-fee`** — planner picks **pure bash** (`psql` + `openssl dgst` HMAC verify per CLAUDE.md §4 + `lncli` via argv; no Python runtime) **vs bash-wrapper + Python payload** (mirroring `run_liquidity_manager.sh`: `psycopg2` + `hmac`/`hashlib` + `subprocess lncli`). Hard constraints regardless of choice: (a) reproduce the canonical HMAC **byte-identically** over the verbatim `canonical_payload` string, (b) do the atomic `FOR UPDATE SKIP LOCKED` claim, (c) `lncli` via **argv, never shell-string interpolation**. Recommendation leans pure-bash for the openssl-interop freeze + zero new runtime, but Python is acceptable as the most battle-tested node pattern.
- Exact `lncli updatechanpolicy` argv form (chan_point parsing, base_fee_msat / fee_rate_ppm / time_lock_delta flags), local logging format/location under `/lnd/nodemon`, the per-payload self-update mechanism (md5-compare vs `--version`), and the precise RLS policy SQL — planner/researcher decide against the existing `bashScripts` conventions + `db/role-grants.sql`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Paths relative to the project root unless absolute; `../` points into the parent `ClaudeCode/` workspace.

### Operator's existing fleet pattern (binding — MUST mirror; the most important ref)
- `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/` — the live fleet script distribution pattern EXEC-01 must mirror:
  - `config.sh` — `REMOTE_SERVER`/`REMOTE_PORT`/`REMOTE_USER`/`LND_DIR=/lnd`/`REMOTE_HOME=/home/josh`
  - `bashScriptDownloader.sh` — `sudo scp -r -i /lnd/id_rsa` of `~/bashScripts/*` → `/lnd/bashScripts/`, `chmod +x`, then runs `updateCrontab.sh`
  - `updateCrontab.sh` — idempotent `grep -Fxq` crontab line merge; add NodeMonitor's `CRON_JOB_N` here
  - `run_liquidity_manager.sh` + `aiLiquidityManagerDownload.sh` — **closest analog**: bash wrapper, md5-hash self-update, **`psycopg2` direct Postgres connection**, `lncli` creds via `/lnd/tls.cert` + `/lnd/data/chain/bitcoin/mainnet/admin.macaroon`
  - `run_monitoring.sh` — `--version` self-update + background-run pattern
  - `README.md` — script catalog/purpose

### Phase-6 frozen queue/HMAC contract (in-repo, binding — consume byte-identically, do NOT modify)
- `src/lib/queue/canonical.ts` — `canonicalize()` (recursive key-sorted, whitespace-free JSON) + `buildSignedPayload()` (5 fields newline-joined: `nodePubkey, commandId, actionType, canonicalParams, expiresAt`). The node hashes the **stored `canonical_payload` verbatim** — never re-serialize.
- `src/lib/queue/sign.ts` — HMAC-SHA256 lowercase hex; `NODEMON_HMAC_SECRET_<pubkey>` env key form; proven byte-identical to `openssl dgst -sha256 -hmac "$SECRET"`. Node-side verify must match.
- `src/lib/queue/claim.ts` — `claimNext` / `expireSweep` / `reaperSweep` — the EXACT mechanics the node re-implements (atomic claim, fail-closed TTL, stale-claim reaper). `NODEMON_CLAIMED_TIMEOUT_MS`.
- `src/lib/queue/stub-executor.ts` — the reference state-transition chain (`claimed→executing→succeeded|failed` + audit + execution row) the node-side executor reproduces against a real `lncli`.
- `src/lib/queue/bounds.ts` — `updateFeeBoundsSchema`; remove the `[ASSUMED]` flag, freeze D-11 values; node re-enforces the same bounds.
- `src/lib/db/schema/nodemon.ts` — `commands` / `command_executions` / `command_audit` tables + `command_state` enum. **No new tables.**
- `src/lib/db/nodemon.ts` — the `nodemon` Drizzle client (dashboard side); the node connects to the same DB.
- `db/role-grants.sql` — three-role least-privilege model; the new `nodemon_node` role + RLS policies (D-07) extend this hand-authored file (NOT Drizzle-migrated).

### Project planning (in-repo)
- `.planning/REQUIREMENTS.md` — EXEC-01/02/03 acceptance criteria (verbatim).
- `.planning/ROADMAP.md` §"Phase 8" + §"Coupling Notes" — the HMAC-secret cross-phase dependency (designed Phase 6, delivered here).
- `.planning/phases/06-command-queue-approval-ui-prong-1/06-CONTEXT.md` — the Phase 6 freeze this phase consumes (D-04 canonical form, D-12 secret format/location, D-13 stub-executor, D-14 reaper placeholder, D-01b LND-only enqueue).
- `../CLAUDE.md` (NodeMonitor §4) — HMAC TS↔bash interop: hex lowercase, key-sorted canonical JSON, **store/hash the canonical string verbatim** (no `jq`, no base64), per-node secret, constant-time compare; §1 read-only role boundary.

### Backends / units (in-repo)
- `src/lib/config/backends.ts` — `backendFor(pubkey)`; pilot is LND (LDK fee apply deferred — no LDK rows enqueued).
- `src/lib/format/units.ts` — AFM-002 formatter (any ppm/msat value the node logs/echoes).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`bashScripts/` fleet pattern** — `bashScriptDownloader.sh` + `updateCrontab.sh` + `run_liquidity_manager.sh` are the structural templates for the NodeMonitor downloader, crontab line, and `run_check-queue.sh` wrapper.
- **`src/lib/queue/{canonical,sign,claim,stub-executor,bounds}.ts`** — the exact dashboard-side logic the node-side scripts mirror; the node is a faithful re-implementation of `claim.ts` + `stub-executor.ts` with a real `lncli` apply in place of the stub.
- **Existing `/queue` UI + `QueueTimeline`** — already render execution outcomes + the audit transition timeline, so the node's write-backs surface in the UI with **no new dashboard UI needed** this phase.
- **`db/role-grants.sql`** — the hand-authored grants file the new `nodemon_node` role + RLS policies extend.

### Established Patterns
- Bash run-script that self-updates its payload (md5/version compare) then executes — `run_liquidity_manager.sh` / `run_monitoring.sh`.
- Direct node→Postgres connection from a node-side process (`aiLiquidityManager` via `psycopg2`).
- `nodemon` is the only Drizzle-owned (generate/migrate) DB for **tables**; roles/RLS/grants live in the hand-authored `db/role-grants.sql`, not Drizzle migrations.
- `lncli` invoked with explicit `--tls-cert` / `--macaroon` paths (`/lnd/tls.cert`, `/lnd/data/chain/bitcoin/mainnet/admin.macaroon`).

### Integration Points
- Node reads `approved` rows + the verbatim `canonical_payload` + `signature_hex` from `commands`; verifies with `NODEMON_HMAC_SECRET_<pubkey>`; re-validates against `bounds.ts` values; applies via `lncli updatechanpolicy` (argv); writes `command_executions` + `command_audit` + state flips back.
- Crontab line added to `updateCrontab.sh` on the fileserver; scripts land in `/lnd/nodemon` via the 30-min downloader.
- RLS policies + the `nodemon_node` role bind the node to its own pubkey via `SET app.node_pubkey`.

## DB objects the operator will create (no new tables)

The core flow reuses `commands` / `command_executions` / `command_audit`. Phase 8 needs only **role + RLS objects** (hand-authored in `db/role-grants.sql`, NOT Drizzle migrations) — the planner will write the exact SQL for the operator to run:
1. A shared least-privilege role `nodemon_node` (CONNECT + SELECT/UPDATE on `commands`, INSERT on `command_executions`/`command_audit`, SELECT where needed). No DELETE, no DDL.
2. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on `commands`, `command_executions`, `command_audit`.
3. RLS policies keyed on `current_setting('app.node_pubkey')`:
   - `commands`: `node_pubkey = current_setting('app.node_pubkey')`
   - `command_executions` / `command_audit`: `command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey'))`
4. The node sets `SET app.node_pubkey = '<lncli getinfo identity_pubkey>'` per connection.

</code_context>

<specifics>
## Specific Ideas

- The operator pointed to the live fleet scripts at `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts` and confirmed the master `bashScriptDownloader.sh` scp's all scripts + updates crontab fleet-wide, then cron runs the downloaded scripts regularly — this IS the EXEC-01 pattern to mirror.
- Operator will create any required DB objects — confirmed no new tables are needed; only the `nodemon_node` role + RLS policies (spec above).
- "Reads only its own pubkey's jobs" is implemented as a **physical DB boundary (RLS)**, not script-discipline filtering — wrong-pubkey rows are invisible.
- The pilot apply is a **real `lncli` fee change on a real (low-stakes) channel, then reverted** — proving the path live without meaningful fleet impact.
- Bounds (`ppm 0–5000`, `base 0–100000 msat`, `CLTV 18–2016`) are now operator-confirmed — the `[ASSUMED]` flag in `bounds.ts` should be removed.

</specifics>

<deferred>
## Deferred Ideas

- **LDK fee application** — enqueue is LND-only (Phase 6 D-01b), so no LDK rows reach the queue; the node-side LDK `updatechanpolicy` equivalent (`lncmd`) stays deferred until LDK enqueue is added.
- **Fleet-wide rollout beyond the one pilot node** — Phase 8 proves one canary; fleet-wide secret distribution + multi-node enablement is Phase 9 / hardening territory.
- **Dedicated `node_heartbeat`/liveness table** — a "node last checked in at X" surface was considered; not required by EXEC-* and not built (rate-limit + status are derived from existing tables). Revisit if operator wants explicit heartbeat liveness in the UI.
- **Dashboard-run sweeps** — considered for `expire`/`reaper`; rejected in favor of node-run sweeps (D-08) so the pilot is self-contained.
- **Queued action types beyond `update_fee`** (closes/rebalances) — carried from Phase 6; still out of scope.

</deferred>

---

*Phase: 8-Node Scripts + Heartbeat*
*Context gathered: 2026-06-17*
