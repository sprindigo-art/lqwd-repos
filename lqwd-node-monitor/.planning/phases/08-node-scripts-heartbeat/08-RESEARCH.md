# Phase 8: Node Scripts + Heartbeat — Research

**Researched:** 2026-06-17
**Domain:** Node-side bash execution agent — HMAC-verified, RLS-scoped, atomic-claim queue consumer applying `lncli updatechanpolicy` on a real LND node
**Confidence:** HIGH (the binding contracts are all in-repo and were read verbatim; HMAC byte-identity and `lncli` syntax verified this session)

## Summary

Phase 8 is the only phase that touches a real Lightning node. It is **not** a greenfield build — it is a faithful **bash re-implementation of two frozen TypeScript modules** (`src/lib/queue/claim.ts` + `src/lib/queue/stub-executor.ts`) wired to a real `lncli updatechanpolicy` apply, distributed over the operator's **existing fleet rail** (`/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/`). Almost every "what library / what pattern" question is already answered by binding decisions D-01…D-14 in `08-CONTEXT.md` and the live fleet scripts. The research job here is to (1) confirm the consumed contracts are byte-stable, (2) resolve the Claude's-Discretion items (language, exact `lncli` argv, RLS SQL, rate-limit SQL, reaper window, self-update, logging, proof harness) against the actual files, and (3) flag the genuine execution risks.

The HMAC interop is **proven this session**: `openssl dgst -sha256 -hmac "$SECRET"` over the verbatim 5-field newline-joined canonical string produces a digest byte-identical to Node's `createHmac("sha256", secret).update(payload,"utf8").digest("hex")` (`7479841d…` for the test vector). This settles the only deep technical risk in pure-bash and is the decisive evidence for the language recommendation.

**Primary recommendation:** Implement `check-queue` + `apply-fee` in **pure bash** — `psql` (single transaction with `SET LOCAL app.node_pubkey` + `FOR UPDATE SKIP LOCKED`), `openssl dgst -sha256 -hmac` for verify (proven byte-identical), and `lncli updatechanpolicy` invoked via **argv array, never an `eval`/string**. This honors CLAUDE.md §4 (hex, verbatim canonical string, no jq, no base64), adds **zero new runtime** to the node (no Python venv, no psycopg2 — unlike `run_liquidity_manager.sh`), and keeps the security-scan surface (Phase 9) minimal. Enforce own-pubkey scoping with **Postgres RLS + `FORCE ROW LEVEL SECURITY`** so wrong-pubkey rows are physically invisible, not merely filtered.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Script distribution / self-update | Fileserver rail (existing) | Node cron | EXEC-01 must mirror `bashScriptDownloader.sh`; do NOT invent a channel |
| Crontab heartbeat install | Node OS (cron) | `updateCrontab.sh` | Self-installing `*/5` line via idempotent `grep -Fxq` merge (D-02) |
| Read approved jobs | Node → Postgres (direct) | — | D-05 house style; dashboard holds zero node creds |
| Own-pubkey isolation | **Postgres (RLS)** | Script (`SET LOCAL`) | D-07 — physical DB boundary, not script discipline |
| HMAC verify | Node script (`openssl`) | — | Byte-identical to dashboard signer; verifies the STORED canonical string |
| Bounds re-enforcement | Node script | (3rd of 3: client + server + node) | D-11 defense in depth |
| Atomic claim / no-double-apply | **Postgres (`FOR UPDATE SKIP LOCKED`)** | Script transaction | D-06 — the row lock IS the guarantee |
| Fee apply | Node (`lncli` local) | — | Local admin macaroon; argv invocation only |
| Write-back (execution + audit + state) | Node → Postgres | — | Mirrors `stub-executor.ts` state chain |
| Expire / reaper sweeps | Node script (each tick) | — | D-08 — no dashboard daemon; node self-heals its own rows |
| Rate-limit | Node script (query over `command_executions`) | — | D-10 — derived count, no new table |

## Standard Stack

This phase installs **no new packages on the dashboard**. The node-side stack is OS-native tools already present on every fleet node (proven by the existing scripts that use `scp`, `ssh`, `crontab`, `lncli`, `md5sum`, `flock`, `psql`/`psycopg2`).

### Core (node-side, pure-bash recommendation)
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| bash | node default | `check-queue` / `apply-fee` / `run_check-queue.sh` | Every fleet runner is bash; matches `run_*.sh` convention `[VERIFIED: read fleet scripts]` |
| `openssl dgst -sha256 -hmac` | system openssl | HMAC verify of `canonical_payload` | Byte-identical to dashboard `node:crypto` `[VERIFIED: tested this session]` |
| `psql` (libpq client) | PG client ≥ 9.6 | Direct queue read/claim/write-back in one transaction | House style is direct node→Postgres (D-05); `SET LOCAL`+`FOR UPDATE SKIP LOCKED` are plain SQL `[CITED: postgresql.org/docs/current/ddl-rowsecurity.html]` |
| `lncli updatechanpolicy` | LND v0.20.x (fleet) | Apply the fee change locally | The only sanctioned write path; creds via local macaroon `[VERIFIED: read fleet scripts + LND docs]` |
| `flock` | util-linux | Single-flight guard against overlapping ticks (belt; the DB lock is the real guarantee) | Already used by `run_nodeAuditor.sh` `[VERIFIED: read run_nodeAuditor.sh]` |
| `md5sum` | coreutils | Per-payload self-update compare | Pattern from `run_liquidity_manager.sh` `check_for_updates()` `[VERIFIED: read]` |

### Supporting (node provisioning, pre-placed — NOT shipped in scripts)
| Item | Location | Purpose | Notes |
|------|----------|---------|-------|
| Per-node HMAC secret | root-only env file the script sources (D-03) | `NODEMON_HMAC_SECRET_<pubkey>` | Same convention as `/lnd/id_rsa`; scripts NEVER carry it |
| `nodemon_node` DB creds | same root-only env file | psql connection string for the least-priv role | Dashboard holds zero node creds (D-05) |
| LND TLS + macaroon | `/lnd/tls.cert`, `/lnd/data/chain/bitcoin/mainnet/admin.macaroon` | `lncli` auth | Exact paths the existing runners use `[VERIFIED]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure bash | bash-wrapper + Python payload (`psycopg2` + `hmac`/`hashlib` + `subprocess`) — mirrors `run_liquidity_manager.sh` | Most battle-tested fleet pattern AND avoids psql-transaction-scripting awkwardness. **But** adds a Python venv + `pip install psycopg2-binary` runtime per node (larger Phase 9 scan surface), and the HMAC interop the freeze cares about is already proven for bash. Acceptable fallback; not recommended. |
| `openssl dgst` | recompute via `lncli`/node | No node runtime on the box; openssl is the frozen interop target |
| `psql` one-shot | a long-lived connection | Cron tick is short-lived; one psql invocation per tick is simplest and matches the model |

**Installation (node-side, no npm):** nothing to `npm install`. Node tooling is pre-present; the only new artifacts are the scripts themselves (scp'd) and the DB role/RLS SQL (operator-run).

## Package Legitimacy Audit

**No external packages are installed by this phase** (dashboard side adds nothing; node side uses OS-native tools already on every fleet node). The pure-bash recommendation specifically avoids `psycopg2-binary` (the only package the Python alternative would pull). slopcheck/registry verification is therefore **N/A** — there is no install step to gate.

*If the planner chooses the Python alternative, gate `psycopg2-binary` behind a `checkpoint:human-verify` and confirm on PyPI (it is a long-established, high-download package, but it must be verified on the correct ecosystem registry).*

## Architecture Patterns

### System Architecture Diagram

```
                       FILESERVER (38.128.236.4:18752, ~/nodemon)        [existing rail]
                                  |  scp -r via /lnd/id_rsa  (every 30 min, D-01)
                                  v
   [cron */30] bashScriptDownloader.sh ──> /lnd/nodemon/{check-queue, apply-fee, run_check-queue.sh}
                                  |  runs updateCrontab.sh (idempotent grep -Fxq merge, D-02)
                                  v
   [cron */5]  run_check-queue.sh ──(md5 self-update check)──> check-queue
                                  |
   PRE-PLACED (provisioning, D-03): root-only env file → NODEMON_HMAC_SECRET_<pubkey>, nodemon_node DSN
   PRE-PLACED: /lnd/tls.cert, /lnd/data/.../admin.macaroon
                                  |
                                  v
   check-queue tick:
     pubkey = lncli getinfo --json | identity_pubkey                 (derive own identity)
     ┌─ psql (ONE transaction) ───────────────────────────────────────────────┐
     │  SET LOCAL app.node_pubkey = '<pubkey>'    (RLS scope; resets on COMMIT) │
     │  expireSweep   → pre-exec rows past expires_at  => 'expired' + audit     │
     │  reaperSweep   → own 'claimed' older than 15min => 'approved' + audit    │
     │  rate-limit    → COUNT(command_executions in last hour) < 4 ?            │
     │  claimNext     → SELECT … state='approved' AND expires_at>now()          │
     │                  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED      │
     │                  => flip 'claimed' + approved→claimed audit              │
     └──────────────── returns {id, canonical_payload, signature_hex, params} ─┘
                                  |  (RLS makes wrong-pubkey rows INVISIBLE → never claimed)
                                  v
     verify:  openssl dgst -sha256 -hmac "$SECRET" <<< canonical_payload  == signature_hex ?
                |  NO → flip 'failed' reason='hmac_mismatch' + audit + execution(failed); NEVER call lncli (D-13)
                v  YES
     re-bound:  params within ppm 0–5000 / base 0–100000 / cltv 18–2016 ?
                |  NO → flip 'failed' reason='bounds_violation' + audit + execution(failed); NEVER call lncli
                v  YES
     apply-fee:  flip 'claimed'→'executing' + audit
                 lncli updatechanpolicy --base_fee_msat N --fee_rate_ppm P \
                       --time_lock_delta D --chan_point txid:idx \
                       --tls-cert … --macaroon …            (ARGV, never eval/string)
                |  exit 0 → 'executing'→'succeeded' + audit + execution(succeeded, detail=new policy)
                |  exit≠0 → 'executing'→'failed'    + audit + execution(failed, detail=stderr)
                v
     log → /lnd/nodemon/check-queue.log  (never log secret/macaroon/signature bytes)
```

### Recommended Node File Layout
```
fileserver  ~/nodemon/                 # mirrors ~/aiLiquidityManager, ~/nodeAuditor
  check-queue                          # main tick logic (bash)
  apply-fee                            # lncli argv apply helper (bash, sourced or called)
  run_check-queue.sh                   # wrapper: md5 self-update + invoke check-queue
node        /lnd/nodemon/              # local working dir (D-01)
  check-queue, apply-fee, run_check-queue.sh
  check-queue.log                      # local log (D-claude-discretion → here)
  old-scripts/                         # backup-on-update, mirrors fleet convention
db          db/role-grants.sql         # EXTENDED (hand-authored) with nodemon_node role + RLS
```

### Pattern 1: Distribution mirrors `bashScriptDownloader.sh` exactly
**What:** A new fileserver folder `~/nodemon/`, pulled by the SAME `scp -r -i /lnd/id_rsa` mechanic. Add ONE crontab line to `updateCrontab.sh` as `CRON_JOB_11`.
**When:** EXEC-01 — do not build a separate downloader; the existing `bashScriptDownloader.sh` already scp's *all* of `~/bashScripts/*`. Either (a) place `run_check-queue.sh` in `~/bashScripts/` and a `nodemon/` payload folder pulled by its own tiny downloader (mirroring `aiLiquidityManagerDownload.sh`), or (b) add the nodemon pull to the existing flow.
**Crontab line to add (D-02, D-09):**
```bash
# Source: updateCrontab.sh pattern (verified)
CRON_JOB_11="*/5 * * * * /lnd/bashScripts/run_check-queue.sh >> /lnd/nodemon/check-queue.log 2>&1"
# merged idempotently:
if ! grep -Fxq "${CRON_JOB_11}" "${TEMP_CRON_FILE}"; then
    echo "${CRON_JOB_11}" >> "${TEMP_CRON_FILE}"
fi
```

### Pattern 2: HMAC verify over the VERBATIM stored canonical string
**What:** Read `canonical_payload` (the exact 5-field newline-joined string the dashboard stored) and hash it directly — NEVER reconstruct it from `params` in bash.
**Verified byte-identity (this session):**
```bash
# Source: tested locally — matches src/lib/queue/sign.ts createHmac(...).digest("hex")
EXPECTED_HEX=$(printf '%s' "$CANONICAL_PAYLOAD" \
  | openssl dgst -sha256 -hmac "$NODEMON_HMAC_SECRET" -r | awk '{print $1}')
# CRITICAL: printf '%s' (no trailing newline). The dashboard signs the string with
# NO trailing newline; `echo` or a heredoc that appends \n breaks the digest.
```
**Why `printf '%s'` not `echo`/heredoc:** the canonical string itself contains `\n` separators between the 5 fields but has **no trailing newline**. `openssl dgst -r` gives the bare `hexdigest *stdin` form; take field 1. (Older openssl prints `SHA2-256(stdin)= <hex>` — take field 2 / after `=`.) Verify the host's openssl output format in Wave 0.

### Pattern 3: Atomic claim with RLS in one psql transaction
**What:** Reproduce `claim.ts` mechanics. RLS scope + claim must be in the SAME transaction so `SET LOCAL` is in force during the `SELECT … FOR UPDATE SKIP LOCKED`.
```sql
-- Source: claim.ts (verbatim mechanics) + postgresql.org RLS docs
BEGIN;
SET LOCAL app.node_pubkey = :'pubkey';   -- resets on COMMIT/ROLLBACK; safe even though
                                          -- cron uses a fresh connection each tick
-- expire sweep, reaper sweep, rate-limit check, then:
SELECT id, canonical_payload, signature_hex, params, action_type, node_pubkey
  FROM commands
 WHERE state = 'approved' AND expires_at > now()
 ORDER BY created_at
 LIMIT 1
 FOR UPDATE SKIP LOCKED;
-- if a row: UPDATE … SET state='claimed', claimed_at=now() WHERE id=:id AND state='approved';
--           INSERT INTO command_audit (command_id, from_state, to_state, actor)
--                  VALUES (:id, 'approved', 'claimed', 'executor');
COMMIT;
```
**When to use:** every tick. Two overlapping ticks each open their own transaction; `SKIP LOCKED` guarantees the second sees zero rows → exactly one claim (Success Criterion 4 / overlapping-ticks proof).

### Pattern 4: argv invocation of `lncli` — NEVER shell-string
**What:** Build the command as an explicit token list; never interpolate `params` into a string passed to `sh -c`/`eval`.
```bash
# Source: LND docs (flags verified) + fleet macaroon paths (verified)
lncli \
  --tlscertpath /lnd/tls.cert \
  --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon \
  updatechanpolicy \
  --base_fee_msat "$BASE_FEE_MSAT" \
  --fee_rate_ppm  "$FEE_RATE_PPM" \
  --time_lock_delta "$TIME_LOCK_DELTA" \
  --chan_point "$FUNDING_TXID:$OUTPUT_INDEX"
```
**Notes verified against LND docs:** flags are flag-based (not positional); `--fee_rate_ppm` and `--fee_rate` are mutually exclusive — use `--fee_rate_ppm` (matches the queue's `suggestedPpm`); `chan_point` is `funding_txid:output_index`; global auth flags on most distros are `--tlscertpath` / `--macaroonpath` (confirm with `lncli --help` in Wave 0 — some builds accept `--tls-cert`/`--macaroon`). `[CITED: docs.lightning.engineering/lightning-network-tools/lnd/channel-fees]` `[ASSUMED: exact global flag spelling — verify on the pilot node's LND build]`

### Anti-Patterns to Avoid
- **Reconstructing the canonical string in bash** (jq re-serialize) — key-order/whitespace drift breaks the signature. Hash the STORED string verbatim (CLAUDE.md §4).
- **base64 HMAC across the bash boundary** — openssl wrapping/padding mismatches. Use lowercase hex.
- **`eval "lncli … $params"`** — shell-injection + a malformed param can become a different command. Argv only (EXEC-02 hard constraint).
- **Filtering own-pubkey in the WHERE clause instead of RLS** — a bug drops the filter and you touch another node's rows. RLS makes them invisible (D-07).
- **Script-discipline single-flight (pidfile only) as the no-double-apply guarantee** — the DB row lock is the guarantee; `flock` is only a cheap belt.
- **Logging the macaroon, secret, or full signature** — CLAUDE.md logging rule; log state/reason/chan_point only.
- **Drizzle-migrating the role/RLS** — these live in hand-authored `db/role-grants.sql`, not migrations (D-08, existing file convention).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mutual exclusion of overlapping ticks | A custom lockfile state machine | `SELECT … FOR UPDATE SKIP LOCKED` | The DB lock is correct under concurrency; a lockfile races on NFS/clock skew |
| Canonical JSON in bash | jq re-serialization | The stored `canonical_payload` verbatim | The dashboard already froze the exact bytes |
| HMAC | A hand-rolled hex routine | `openssl dgst -sha256 -hmac` | Proven byte-identical; constant-time enough for the local threat |
| Per-node isolation | WHERE-clause pubkey filter | Postgres RLS + FORCE ROW LEVEL SECURITY | Physical boundary survives script bugs |
| Crontab merge | Rewriting crontab | `updateCrontab.sh` `grep -Fxq` idempotent merge | Already battle-tested fleet-wide |
| Stale-claim recovery | A dashboard daemon | Node-run `reaperSweep` each tick (D-08) | Pilot is self-contained; no daemon to deploy |

**Key insight:** Nearly every "hard part" here is *already solved* in the frozen Phase 6 TS and the live fleet scripts. The phase's risk is **fidelity of re-implementation**, not invention.

## Runtime State Inventory

> This is a deployment/distribution phase that creates node-side runtime state. Inventory of what exists on the node after the scripts land:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `nodemon` Postgres rows — node writes `command_executions` + `command_audit` + flips `commands.state`. No new tables (D-14). | Code: faithful state-chain writes; seed test rows for proof harness |
| Live service config | **Crontab entry** `*/5 run_check-queue.sh` registered via `updateCrontab.sh` (not in git on the node — set at cron-merge time). Fileserver `~/nodemon/` folder. | Re-register on each downloader run (idempotent grep -Fxq) |
| OS-registered state | Cron line (above). No systemd/Task Scheduler. | Owned by `updateCrontab.sh` |
| Secrets/env vars | `NODEMON_HMAC_SECRET_<pubkey>` + `nodemon_node` DSN in a **root-only env file pre-placed by provisioning** (D-03) — NOT in git, NOT shipped in scripts. | Provisioning step (out-of-band, one-time); scripts only `source` it |
| Build artifacts | `/lnd/nodemon/old-scripts/` backups on self-update; `check-queue.log`. No compiled binaries (pure bash). | md5 self-update keeps payload current |

**DB objects (operator-run, hand-authored in `db/role-grants.sql` — NOT Drizzle):**
- New role `nodemon_node` (LOGIN; CONNECT on nodemon DB; SELECT+UPDATE on `commands`; INSERT on `command_executions`, `command_audit`; SELECT on those two for the rate-limit count; NO DELETE, NO DDL). It is **not** the table owner, so RLS applies to it without needing FORCE (but set FORCE anyway as belt — see Pitfall 6).
- `ALTER TABLE commands ENABLE ROW LEVEL SECURITY; ALTER TABLE commands FORCE ROW LEVEL SECURITY;` (and same for `command_executions`, `command_audit`).
- Policies keyed on `current_setting('app.node_pubkey')`.

## Common Pitfalls

### Pitfall 1: Trailing newline in the bash HMAC input
**What goes wrong:** `echo "$CANONICAL_PAYLOAD" | openssl …` appends `\n`, producing a different digest than the dashboard's `update(payload,"utf8")`. All verifies fail → everything flips `failed`/`hmac_mismatch`.
**Why:** The canonical string has internal `\n` separators but NO trailing newline.
**How to avoid:** `printf '%s' "$CANONICAL_PAYLOAD" | openssl dgst …`. Add a Wave-0 test that signs a known vector in TS and re-verifies in bash (the test this session passed).
**Warning sign:** 100% hmac_mismatch on the canary even with the right secret.

### Pitfall 2: `SET` instead of `SET LOCAL` for `app.node_pubkey`
**What goes wrong:** With any connection reuse/pooling, a leaked session GUC scopes the next tick to the wrong pubkey.
**Why:** `SET` persists for the session; `SET LOCAL` resets on COMMIT.
**How to avoid:** `SET LOCAL` inside the same transaction as the claim. (Cron opens a fresh connection per tick so the blast radius is small, but `SET LOCAL` is the correct, free safety.) `[CITED: bytebase / supabase RLS guides]`

### Pitfall 3: Reading `params` (jsonb) instead of `canonical_payload` for verify
**What goes wrong:** Re-canonicalizing `params` in bash drifts from the stored bytes; signature never matches.
**How to avoid:** Verify against `canonical_payload`; only parse `params` (after a *successful* verify) to extract the `lncli` argv values.

### Pitfall 4: openssl output format differs by version
**What goes wrong:** Old openssl prints `SHA2-256(stdin)= <hex>`; newer with `-r` prints `<hex> *stdin`. A hardcoded `awk '{print $2}'` breaks on one of them.
**How to avoid:** Use `openssl dgst -sha256 -hmac "$SECRET" -r | awk '{print $1}'` and assert the format in Wave 0 on the pilot's openssl.

### Pitfall 5: Re-applying after a crash between `lncli success` and write-back
**What goes wrong:** `lncli` succeeds, the script dies before flipping `executing→succeeded`; the reaper later releases the `claimed`/`executing` row and a future tick re-applies.
**Why:** The window between the real-world side effect and the DB commit is not transactional.
**How to avoid:** Order operations to minimize the window: flip to `executing` (commit) → `lncli` → flip to terminal + execution row (commit). The reaper releases only **`claimed`** rows (per `claim.ts` it does NOT release `executing`), so a row mid-apply is not auto-released — it requires operator attention, which is the safe failure. Document this; do not have the reaper touch `executing`. **Idempotency note:** a duplicate `updatechanpolicy` with identical params is a no-op on LND (it just re-sets the same policy), so even a rare double-apply of the *same* fee is harmless — but the reaper-window design above prevents it structurally.
**Warning sign:** an `executing` row lingering past one tick → alert, don't auto-recover.

### Pitfall 6: Forgetting FORCE ROW LEVEL SECURITY / role being a table owner
**What goes wrong:** Table owners and superusers bypass RLS. If `nodemon_node` ever owned a table (or someone tests as the owner), the pubkey scope silently does nothing → wrong-pubkey rows become visible.
**How to avoid:** Ensure `nodemon_node` is a plain LOGIN role that does NOT own the queue tables, and add `FORCE ROW LEVEL SECURITY` as belt-and-suspenders. `[CITED: postgresql.org/docs/current/ddl-rowsecurity.html]`
**Warning sign:** the wrong-pubkey seeded row is claimable in the proof harness.

### Pitfall 7: `--fee_rate` vs `--fee_rate_ppm` collision
**What goes wrong:** Passing both, or passing `--fee_rate` with a ppm integer, applies a wildly wrong fee (1000 ppm vs 1000 proportional).
**How to avoid:** Use ONLY `--fee_rate_ppm` with `suggestedPpm`. They are mutually exclusive per LND. `[CITED: LND docs]`

### Pitfall 8: InboundFees overwrite (LND quirk)
**What goes wrong:** Some LND builds reset inbound-fee fields if not explicitly passed on `updatechanpolicy` (see lnd#8614).
**How to avoid:** On the canary, capture the channel's full policy before/after; if the fleet uses inbound fees, pass them through explicitly. Verify on the pilot build. `[ASSUMED: applicability depends on LND version — confirm on pilot]`

## Code Examples

### Rate-limit count (D-10, no new table)
```sql
-- Source: derived from D-10 + schema/nodemon.ts command_executions.executedAt
-- 1 apply/tick is enforced by claimNext LIMIT 1; this is the 4/node/hour backstop.
-- Under RLS, command_executions is already scoped to this node's commands.
SELECT count(*) FROM command_executions ce
  JOIN commands c ON c.id = ce.command_id
 WHERE ce.executed_at > now() - interval '1 hour';
-- if >= 4 → skip claim/apply this tick, log 'rate_limited', exit 0.
```

### Reaper window (D-09 → replaces Phase 6 D-14 placeholder)
```
*/5 cadence ⇒ ~3 missed ticks ⇒ NODEMON_CLAIMED_TIMEOUT_MS = 900000 (15 min)
```
```sql
-- reaperSweep mechanics from claim.ts: release OWN stale 'claimed' rows back to 'approved'
UPDATE commands SET state='approved', claimed_at=NULL
 WHERE state='claimed' AND claimed_at < now() - interval '15 minutes';
-- + a command_audit row (from='claimed', to='approved', reason='reaper_released_stale_claim', stale_acknowledged=true)
```

### `nodemon_node` role + RLS (sketch — planner finalizes, operator runs)
```sql
-- Source: extends db/role-grants.sql convention + postgresql.org RLS docs
CREATE ROLE nodemon_node WITH LOGIN PASSWORD '<generated-strong-password>';
GRANT CONNECT ON DATABASE nodemon TO nodemon_node;
GRANT USAGE ON SCHEMA public TO nodemon_node;
GRANT SELECT, UPDATE ON commands TO nodemon_node;          -- no INSERT/DELETE on commands
GRANT SELECT, INSERT ON command_executions TO nodemon_node; -- SELECT for rate-limit count
GRANT SELECT, INSERT ON command_audit TO nodemon_node;
-- explicitly NO DELETE / NO TRUNCATE / NO DDL anywhere

ALTER TABLE commands           ENABLE ROW LEVEL SECURITY; ALTER TABLE commands           FORCE ROW LEVEL SECURITY;
ALTER TABLE command_executions ENABLE ROW LEVEL SECURITY; ALTER TABLE command_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE command_audit      ENABLE ROW LEVEL SECURITY; ALTER TABLE command_audit      FORCE ROW LEVEL SECURITY;

CREATE POLICY node_own_commands ON commands
  USING (node_pubkey = current_setting('app.node_pubkey', true));   -- true = NULL (not error) if unset → matches nothing
CREATE POLICY node_own_exec ON command_executions
  USING     (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)));
CREATE POLICY node_own_audit ON command_audit
  USING     (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)));
```
Note: the two-arg `current_setting(name, true)` returns NULL (not an error) when `app.node_pubkey` is unset, so a connection that forgot `SET LOCAL` sees ZERO rows (fail-closed). `[VERIFIED: PG missing_ok form, ≥9.6]` Also add a `WITH CHECK` on `commands` for the UPDATE so a node cannot flip a row to a different pubkey.

### Self-update (md5 compare — `run_liquidity_manager.sh` pattern)
```bash
# Source: aiLiquidityManagerDownload.sh / run_liquidity_manager.sh check_for_updates()
LOCAL_HASH=$(md5sum "$LOCAL_DIR/check-queue" 2>/dev/null | awk '{print $1}')
REMOTE_HASH=$(ssh -p "$REMOTE_PORT" -i /lnd/id_rsa "$REMOTE_USER@$REMOTE_SERVER" \
  "md5sum $REMOTE_DIR/check-queue" 2>/dev/null | awk '{print $1}')
[[ "$LOCAL_HASH" != "$REMOTE_HASH" ]] && scp -P "$REMOTE_PORT" -i /lnd/id_rsa \
  "$REMOTE_USER@$REMOTE_SERVER:$REMOTE_DIR/check-queue" "$LOCAL_DIR/check-queue"
```
**Recommendation:** md5-compare (not `--version`) — `check-queue`/`apply-fee` are scripts, not versioned binaries; md5 matches the closest analog (`run_liquidity_manager.sh`).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 6 D-14 placeholder reaper window (5 min fallback) | `NODEMON_CLAIMED_TIMEOUT_MS = 900000` (15 min = 3× the `*/5` cadence) | This phase (D-09) | Replace the placeholder; set in the node's env file |
| `bounds.ts` `[ASSUMED]` provisional bounds | Operator-confirmed & frozen: ppm 0–5000, base 0–100000 msat, CLTV 18–2016 (D-11) | This phase | Remove the `[ASSUMED]` comment block; node re-enforces identical values |
| Dashboard-run sweeps (considered) | Node-run expire+reaper each tick (D-08) | This phase | Pilot is self-contained; no daemon |

**Deprecated/outdated:** none new. The Python+psycopg2 fleet pattern remains valid but is intentionally NOT chosen for the no-runtime benefit.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `lncli` global auth flags are `--tlscertpath`/`--macaroonpath` (some builds `--tls-cert`/`--macaroon`) | Pattern 4 | Apply call errors out; caught on canary — verify with `lncli updatechanpolicy --help` in Wave 0 |
| A2 | Pilot LND build does NOT silently reset inbound fees on `updatechanpolicy` (lnd#8614) | Pitfall 8 | Could unintentionally change inbound fees; mitigated by before/after policy capture on canary |
| A3 | openssl `-r` output is `<hex> *stdin` on the pilot's openssl | Pitfall 4 | Wrong awk field → all verifies fail; assert format in Wave 0 |
| A4 | Pure bash chosen over Python | Standard Stack | If psql-transaction scripting proves too brittle, Python fallback is pre-approved (D-discretion) |
| A5 | `nodemon_node` will not own the queue tables | Pitfall 6 | RLS would be bypassed; FORCE RLS + ownership check mitigates |

## Open Questions (RESOLVED)

1. **Exact `lncli` global flag spelling + inbound-fee behavior on the pilot's LND build.**
   - What we know: docs show `--base_fee_msat/--fee_rate_ppm/--time_lock_delta/--chan_point`; fleet uses `/lnd/tls.cert` + admin macaroon.
   - What's unclear: `--tlscertpath` vs `--tls-cert`; whether inbound fees reset.
   - Recommendation: resolve on the canary at the live gate via `lncli updatechanpolicy --help` and a before/after `lncli getchaninfo`. Cheap, deterministic.
   - **RESOLVED:** deferred to the Plan-04 live gate (A1/A2). Plan 04 Task 2 is a blocking-human checkpoint that confirms the build via `--help` + before/after `getchaninfo`; Plan 02 Task 2(d) carries the `[ASSUMED]` flag/inbound-fee markers + the fold-back path. Not an open design unknown.

2. **Does the fileserver pull reuse the existing `bashScriptDownloader.sh` (all-folder scp) or a dedicated `nodemonDownload.sh` (mirroring `aiLiquidityManagerDownload.sh`)?**
   - Recommendation: dedicated `nodemonDownload.sh` for `~/nodemon/` + the `run_check-queue.sh` wrapper in `~/bashScripts/`, matching how `aiLiquidityManager` is structured. Keeps the nodemon payload isolated.
   - **RESOLVED:** dedicated `nodemonDownload.sh` (PATTERNS.md line 191; implemented in Plan 03). Decision taken.

## Environment Availability

> The node-side tools cannot be probed from this dev machine (no LND/psql here, expected). Availability is asserted from the live fleet scripts that already use them.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bash | all scripts | ✓ (fleet) | node default | — |
| openssl | HMAC verify | ✓ (assume; assert in Wave 0) | system | none — blocking if absent |
| psql (libpq) | queue access | ⚠ verify on pilot | — | Python+psycopg2 (D-discretion fallback) |
| lncli | fee apply | ✓ (fleet uses it) | LND v0.20.x | none — blocking |
| flock | single-flight belt | ✓ (run_nodeAuditor uses it) | util-linux | pidfile |
| md5sum | self-update | ✓ (run_liquidity_manager uses it) | coreutils | — |
| scp/ssh + /lnd/id_rsa | distribution | ✓ (fleet rail) | — | — |
| `nodemon` Postgres reachable from node | queue | ⚠ verify network path | — | none — blocking |

**Missing dependencies with no fallback:** none confirmed missing; `openssl`, `psql` reachability, and `nodemon` DB network path are the three to verify on the pilot before the live apply.
**Missing dependencies with fallback:** `psql` → psycopg2 (only if pure-bash psql proves unworkable).

## Validation Architecture

> nyquist_validation is enabled. The happy path is proven LIVE on the canary (D-12); the five failure modes are proven via SEEDED ROWS in a test/staging `nodemon` DB (D-14) — deterministic, repeatable, zero live-channel risk.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bats-core for the bash scripts (or shell assertions); SQL fixtures seeded via psql; the canary apply is a manual operator-gated live check |
| Config file | none yet — Wave 0 establishes a `tests/node/` harness with seed + assert SQL |
| Quick run command | `bats tests/node/check-queue.bats` (against a local/staging nodemon DB) |
| Full suite command | seed-all → run check-queue → assert state+audit for all 5 modes + happy path |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-01 | downloader scp's scripts + merges `*/5` crontab line idempotently | integration | assert `grep -Fxq` line present once after 2 runs | ❌ Wave 0 |
| EXEC-02 | HMAC verify byte-identical to dashboard | unit | sign-in-TS / verify-in-bash known-vector test (passed this session) | ❌ Wave 0 |
| EXEC-02 | bounds re-enforced node-side | unit | seed out-of-bounds row → assert `failed`/`bounds_violation`, no lncli | ❌ Wave 0 |
| EXEC-02 | argv invocation (no shell-string) | static | grep gate: no `eval`/`sh -c` with `$params` in apply-fee | ❌ Wave 0 |
| EXEC-03 | happy path applies + `succeeded` + policy visible | manual (live, canary) | operator runs on canary, `lncli getchaninfo` before/after, then reverts | n/a (live gate) |
| EXEC-03 | tampered HMAC rejected | integration | seed row w/ bad signature → assert `failed`/`hmac_mismatch`, no lncli | ❌ Wave 0 |
| EXEC-03 | un-approved never claimed | integration | seed `pending_approval` row → assert untouched | ❌ Wave 0 |
| EXEC-03 | expired never claimed | integration | seed past-`expires_at` row → assert `expired` after sweep, no apply | ❌ Wave 0 |
| EXEC-03 | wrong-pubkey invisible | integration | seed other-pubkey `approved` row → assert NOT claimed (RLS) | ❌ Wave 0 |
| EXEC-03 | overlapping ticks = single apply | integration | two concurrent check-queue invocations on one approved row → exactly one `succeeded`, one no-op | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant `bats` test for the touched script.
- **Per wave merge:** full seeded 5-mode + state/audit assertion suite against staging nodemon DB.
- **Phase gate:** full suite green AND the canary live happy-path proven (apply → verify via lncli → revert) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/node/seed.sql` — seeds the 5 failure-mode rows + 1 valid row (deterministic UUIDs, fixed `expires_at`, valid+invalid signatures)
- [ ] `tests/node/assert.sql` — asserts resulting `commands.state` + `command_audit` transitions per mode
- [ ] `tests/node/check-queue.bats` — drives check-queue against the staging DB; includes the concurrent-invocation (overlapping-ticks) case
- [ ] `tests/node/hmac-vector.bats` — TS-signs a known canonical string, bash-verifies; guards Pitfall 1/4
- [ ] grep gate — no `eval`/`sh -c`/string-interpolated lncli in `apply-fee`
- [ ] Wave 0 must seed signatures using a TEST per-node secret so the seed is self-contained and never needs a real secret

## Security Domain

> security_enforcement is not disabled in config → included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Per-node HMAC secret authenticates the queued intent; `lncli` authenticated by local macaroon |
| V3 Session Management | no | No sessions; one-shot cron process |
| V4 Access Control | yes | Postgres RLS + `nodemon_node` least-privilege grants scope each node to its own pubkey; no DELETE/DDL |
| V5 Input Validation | yes | Node re-enforces `updateFeeBoundsSchema` values (ppm/base/cltv) before any apply (3rd of 3 enforcement points) |
| V6 Cryptography | yes | HMAC-SHA256 lowercase hex via `openssl dgst` (never hand-rolled); secret read from root-only env file, never logged, never in DB or scripts |
| V12 Files/Resources | yes | Scripts carry no secrets; macaroon/tls paths fixed; `id_rsa` chmod 600 (fleet convention) |

### Known Threat Patterns for {node bash + Postgres + lncli}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered queue row (forged fee) | Tampering | HMAC verify over verbatim canonical_payload; fail-closed `refuse-and-record` (D-13) |
| Cross-node row access | Information Disclosure / Elevation | RLS + FORCE RLS keyed on `app.node_pubkey`; least-priv role |
| Shell injection via params | Tampering / Elevation | `lncli` argv invocation, never `eval`/string (EXEC-02) |
| Double-apply under concurrency | Tampering | `FOR UPDATE SKIP LOCKED` single-claim; reaper only releases `claimed`, not `executing` |
| Replay of an expired intent | Tampering | TTL fail-closed (`expireSweep` + `expires_at > now()` filter); nonce/expiry already in the signed payload |
| Secret leakage | Information Disclosure | Secret in root-only env file, never shipped/logged; no secret column in DB |
| Privilege creep on the queue DB | Elevation | `nodemon_node`: SELECT/UPDATE commands, INSERT exec/audit only; no DELETE/TRUNCATE/DDL |

## Sources

### Primary (HIGH confidence)
- **In-repo frozen contracts (read verbatim this session):** `src/lib/queue/{canonical,sign,claim,stub-executor,bounds}.ts`, `src/lib/db/schema/nodemon.ts`, `src/lib/db/nodemon.ts`, `db/role-grants.sql`, `08-CONTEXT.md`, `REQUIREMENTS.md`, `ROADMAP.md`.
- **Live fleet scripts (read verbatim):** `config.sh`, `bashScriptDownloader.sh`, `updateCrontab.sh`, `run_liquidity_manager.sh`, `aiLiquidityManagerDownload.sh`, `run_monitoring.sh`, `run_nodeAuditor.sh`, `run_channelAcceptor.sh`, `README.md`.
- **HMAC byte-identity:** verified locally — `openssl dgst -sha256 -hmac` == Node `createHmac(...).digest("hex")` (`7479841d…`).
- **PostgreSQL RLS:** https://www.postgresql.org/docs/current/ddl-rowsecurity.html — owner/superuser bypass, FORCE RLS, USING applies to SELECT/UPDATE.

### Secondary (MEDIUM confidence)
- LND `updatechanpolicy` flags: https://docs.lightning.engineering/lightning-network-tools/lnd/channel-fees and https://lightning.engineering/api-docs/api/lnd/lightning/update-channel-policy/ — flag-based, `--fee_rate_ppm` mutually exclusive with `--fee_rate`, chan_point = `funding_txid:output_index`.
- `SET LOCAL` for RLS under pooling: bytebase / Supabase RLS guides (verified against PG docs).
- lnd#8614 (InboundFees overwrite quirk) — GitHub issue.

### Tertiary (LOW confidence)
- Exact `lncli` global auth flag spelling — must confirm on pilot (`lncli --help`).

## Metadata

**Confidence breakdown:**
- Standard stack / language choice: HIGH — fleet scripts + proven HMAC interop decide it.
- Architecture / contracts: HIGH — re-implementing read-verbatim frozen modules.
- RLS SQL: HIGH for mechanism, MEDIUM for final policy text (operator runs it).
- `lncli` argv exact flags: MEDIUM — verify global flag spelling + inbound-fee behavior on the canary.
- Pitfalls: HIGH — grounded in the actual code and PG/LND docs.

**Research date:** 2026-06-17
**Valid until:** 2026-07-17 (stable; the only volatile item is the pilot LND build's exact CLI flags — verify at the live gate)
```