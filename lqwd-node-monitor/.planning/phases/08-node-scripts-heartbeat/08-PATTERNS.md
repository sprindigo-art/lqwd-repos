# Phase 8: Node Scripts + Heartbeat - Pattern Map

**Mapped:** 2026-06-17
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11 (every new file has a concrete analog — this phase is re-implementation, not invention)

> **Two analog sources** (both binding, both mined verbatim below):
> 1. **Live fleet bash scripts** — `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/` (the EXEC-01 distribution rail to mirror)
> 2. **In-repo frozen Phase-6 queue modules** — `src/lib/queue/*.ts`, `db/role-grants.sql`, `src/lib/db/schema/nodemon.ts` (the node-side bash re-implements these byte-identically)
>
> **Core fidelity rule:** the node is a faithful bash port of `claim.ts` + `stub-executor.ts` with a real `lncli updatechanpolicy` swapped in for the stub. Every TS→bash divergence is flagged inline (chiefly: `printf '%s'` not `echo` for HMAC input; `psql`/`SET LOCAL`+`FOR UPDATE SKIP LOCKED` in one transaction; argv `lncli` never string-eval).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `~/nodemon/check-queue` (fileserver) → `/lnd/nodemon/check-queue` | executor (node bash) | event-driven (cron tick) → CRUD on queue | `src/lib/queue/claim.ts` + `src/lib/queue/stub-executor.ts` | role+flow exact (TS→bash port) |
| `~/nodemon/apply-fee` (fileserver) → `/lnd/nodemon/apply-fee` | executor helper (node bash) | transform → file-I/O (`lncli` argv) | `run_liquidity_manager.sh` `run_auto_mode()` (lncli creds/argv) | role-match (Python→bash) |
| `~/bashScripts/run_check-queue.sh` (fileserver) | runner/wrapper (bash) | batch (self-update + invoke) | `run_liquidity_manager.sh` + `run_nodeAuditor.sh` | exact |
| `~/bashScripts/nodemonDownload.sh` (fileserver) | downloader (bash) | file-I/O (scp pull) | `aiLiquidityManagerDownload.sh` | exact |
| `updateCrontab.sh` (MODIFIED, fileserver) | config (crontab merge) | config | `updateCrontab.sh` (self — add `CRON_JOB_11`) | exact (extend in place) |
| `db/role-grants.sql` (MODIFIED / new section) | config (role + RLS SQL) | config | `db/role-grants.sql` (self — `nodemon_ro` block) | role-match (RO→RW least-priv + RLS) |
| `src/lib/queue/bounds.ts` (MODIFIED — freeze edit) | model (zod schema) | validation | `src/lib/queue/bounds.ts` (self — remove `[ASSUMED]`) | exact (in-place edit) |
| `tests/node/seed.sql` (new) | test fixture | batch (seed rows) | `src/lib/db/schema/nodemon.ts` (column shapes) | role-match (schema-derived) |
| `tests/node/assert.sql` (new) | test fixture | batch (assert state/audit) | `claim.ts` + `stub-executor.ts` state transitions | role-match |
| `tests/node/check-queue.bats` (new) | test (bats) | event-driven (drives check-queue) | (no in-repo bats; mirror `claim.ts` test intent) | partial (new harness) |
| `tests/node/hmac-vector.bats` (new) | test (bats) | transform (sign-TS / verify-bash) | `src/lib/queue/sign.ts` + `canonical.ts` | role-match (interop proof) |

---

## Pattern Assignments

### `check-queue` (node bash executor, event-driven → CRUD)

**Primary analog:** `src/lib/queue/claim.ts` (claim/expire/reaper mechanics) + `src/lib/queue/stub-executor.ts` (state chain). Port BOTH to one bash tick. **Secondary analog:** `run_nodeAuditor.sh` (flock single-flight + `log()` helper + cd-to-dir + exit-code reporting).

**Tick skeleton (mirror `run_nodeAuditor.sh` lines 10-32 for source/log/flock):**
```bash
#!/bin/bash
source /lnd/bashScripts/config.sh
# source the root-only env file holding NODEMON_HMAC_SECRET_<pubkey> + nodemon_node DSN (D-03)
source /lnd/nodemon/.nodemon.env          # pre-placed by provisioning, NEVER shipped in scripts

LOCAL_DIR="${LND_DIR}/nodemon"
LOG_FILE="${LOCAL_DIR}/check-queue.log"
LOCK_FILE="${LOCAL_DIR}/.check-queue.lock"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*" | tee -a "${LOG_FILE}"; }

# flock belt (the DB row-lock is the real no-double-apply guarantee — RESEARCH Anti-Pattern)
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then log "Previous tick still running; skipping."; exit 0; fi
```

**Derive own pubkey (D-07 — feeds `SET LOCAL app.node_pubkey`):**
```bash
PUBKEY=$(lncli --tlscertpath /lnd/tls.cert \
  --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon \
  getinfo | sed -n 's/.*"identity_pubkey": "\([0-9a-f]*\)".*/\1/p')
```

**Atomic claim — port of `claim.ts:claimNext` lines 53-82.** The TS does `dbNodemon.transaction(... .for("update",{skipLocked:true}) ...)`; the bash equivalent is ONE `psql` transaction with `SET LOCAL` + `FOR UPDATE SKIP LOCKED`:
```sql
-- bash port of claim.ts lines 57-81 (SELECT approved/non-expired → flip claimed → audit)
BEGIN;
SET LOCAL app.node_pubkey = :'pubkey';     -- DIVERGENCE: RLS scope has no TS analog; SET LOCAL not SET (Pitfall 2)
-- expireSweep (port of claim.ts:expireSweep lines 91-125)
-- reaperSweep (port of claim.ts:reaperSweep lines 135-172)
-- rate-limit count (see Shared Patterns)
SELECT id, canonical_payload, signature_hex, params, action_type
  FROM commands
 WHERE state = 'approved' AND expires_at > now()
 ORDER BY created_at LIMIT 1
 FOR UPDATE SKIP LOCKED;                    -- == claim.ts line 64 .for("update",{skipLocked:true})
-- on a row:
UPDATE commands SET state='claimed', claimed_at=now() WHERE id=:id AND state='approved';  -- == lines 68-71
INSERT INTO command_audit (command_id, from_state, to_state, actor)
  VALUES (:id, 'approved', 'claimed', 'executor');                                          -- == lines 73-78
COMMIT;
```

**expireSweep port (claim.ts lines 91-125)** — pre-execution rows (`pending_approval`, `approved`, `claimed`) past `expires_at` → `expired` + audit `reason='ttl_expired'`:
```sql
UPDATE commands SET state='expired'
 WHERE expires_at < now() AND state IN ('pending_approval','approved','claimed');
-- one command_audit row per victim: from_state=<prev>, to_state='expired', actor='executor', reason='ttl_expired'
```

**reaperSweep port (claim.ts lines 135-172)** — release OWN stale `claimed` rows (only `claimed`, NEVER `executing` — Pitfall 5):
```sql
-- window = NODEMON_CLAIMED_TIMEOUT_MS = 900000 (15 min = 3× the */5 cadence, D-09 — replaces Phase 6 placeholder)
UPDATE commands SET state='approved', claimed_at=NULL
 WHERE state='claimed' AND claimed_at < now() - interval '15 minutes';
-- audit: from='claimed', to='approved', actor='executor', reason='reaper_released_stale_claim', stale_acknowledged=true
```

**State chain after a verified+bounded claim — port of `stub-executor.ts` lines 39-70.** TS does two `dbNodemon.transaction()` blocks (claimed→executing, then executing→outcome + execution row). Bash reproduces the SAME guarded `UPDATE … WHERE id=? AND state=<expected>` + audit + one `command_executions` row, with a REAL `lncli` between the two commits (D-13 fail-closed ordering, Pitfall 5):
```sql
-- 1) claimed→executing (commit) — == stub-executor.ts lines 39-50
UPDATE commands SET state='executing' WHERE id=:id AND state='claimed';
INSERT INTO command_audit (command_id, from_state, to_state, actor)
  VALUES (:id, 'claimed', 'executing', 'executor');
-- 2) call apply-fee (lncli) HERE, between commits
-- 3) executing→succeeded|failed (commit) + execution row — == stub-executor.ts lines 53-70
UPDATE commands SET state=:outcome WHERE id=:id AND state='executing';
INSERT INTO command_audit (command_id, from_state, to_state, actor) VALUES (:id, 'executing', :outcome, 'executor');
INSERT INTO command_executions (command_id, outcome, detail, executed_at) VALUES (:id, :outcome, :detail, now());
```

**Exit-code reporting tail — mirror `run_nodeAuditor.sh` lines 62-68 / `run_liquidity_manager.sh` lines 179-182.**

---

### `apply-fee` (node bash executor helper, transform → file-I/O)

**Analog:** `run_liquidity_manager.sh` `run_auto_mode()` lines 122-142 (the only fleet script that calls a node-write tool with the exact `/lnd/tls.cert` + `/lnd/data/chain/bitcoin/mainnet/admin.macaroon` creds). Re-shape from Python-subprocess to direct `lncli` argv.

**Creds pattern (verbatim fleet paths — `run_liquidity_manager.sh` lines 13-14, 131-132):**
```bash
TLS_CERT="${LND_DIR}/tls.cert"
MACAROON="${LND_DIR}/data/chain/bitcoin/mainnet/admin.macaroon"
```

**Apply via ARGV — NEVER `eval`/`sh -c` (EXEC-02 hard constraint, RESEARCH Pattern 4 / Anti-Pattern):**
```bash
# DIVERGENCE from run_liquidity_manager (which shells python3); here lncli is called directly, argv tokens only.
lncli \
  --tlscertpath  "$TLS_CERT" \
  --macaroonpath "$MACAROON" \
  updatechanpolicy \
  --base_fee_msat   "$BASE_FEE_MSAT" \
  --fee_rate_ppm    "$FEE_RATE_PPM" \     # use --fee_rate_ppm ONLY, never --fee_rate (Pitfall 7)
  --time_lock_delta "$TIME_LOCK_DELTA" \
  --chan_point      "$FUNDING_TXID:$OUTPUT_INDEX"
# [ASSUMED] global flag spelling --tlscertpath/--macaroonpath — verify `lncli updatechanpolicy --help` on the pilot (A1)
```

**HMAC verify (gates apply) — bash port of `sign.ts:verifyPayload` lines 46-50 over `canonical.ts:buildSignedPayload` output.** The dashboard signs the verbatim 5-field newline-joined string with NO trailing newline:
```bash
# port of sign.ts line 37 createHmac("sha256",secret).update(payload,"utf8").digest("hex")
EXPECTED_HEX=$(printf '%s' "$CANONICAL_PAYLOAD" \
  | openssl dgst -sha256 -hmac "$NODEMON_HMAC_SECRET" -r | awk '{print $1}')
# CRITICAL DIVERGENCE: printf '%s' (NO trailing newline) — `echo`/heredoc appends \n and breaks the digest (Pitfall 1).
# Verify openssl output format in Wave 0: newer -r prints "<hex> *stdin" (field 1); older prints "...= <hex>" (Pitfall 4).
# constant-time intent: bash [ = ] is acceptable here (local secret; threat is a tampered DB row, not a timing oracle — CLAUDE.md §4).
[ "$EXPECTED_HEX" = "$SIGNATURE_HEX" ] || fail_closed "hmac_mismatch"   # NEVER call lncli on mismatch (D-13)
```

**Bounds re-enforcement (3rd of 3) — port of `bounds.ts` lines 31-33 frozen values:**
```bash
# parse params (jsonb) ONLY after a successful HMAC verify (Pitfall 3 — never re-canonicalize params to verify)
in_range "$FEE_RATE_PPM"    0 5000   || fail_closed "bounds_violation"   # suggestedPpm  0..5000
in_range "$BASE_FEE_MSAT"   0 100000 || fail_closed "bounds_violation"   # baseFeeMsat   0..100000
in_range "$TIME_LOCK_DELTA" 18 2016  || fail_closed "bounds_violation"   # timeLockDelta 18..2016
# fail_closed: flip claimed→failed + audit(reason) + execution(failed); NEVER lncli (D-13). Log reason only, never secret/macaroon/signature.
```

---

### `run_check-queue.sh` (runner/wrapper, batch — self-update + invoke)

**Analog:** `run_liquidity_manager.sh` `check_for_updates()` lines 84-101 (md5 compare → scp) + `update_scripts()` lines 56-82 (timestamped `old-scripts/` backup). **Secondary:** `run_nodeAuditor.sh` lines 1-23 (header doc + source config + cd-to-dir).

**Self-update (md5 compare — `run_liquidity_manager.sh` lines 89-90, 95-97):**
```bash
LOCAL_HASH=$(md5sum "${LOCAL_DIR}/check-queue" 2>/dev/null | awk '{print $1}')
REMOTE_HASH=$(ssh -o StrictHostKeyChecking=no -p "${REMOTE_PORT}" -i "${LND_DIR}/id_rsa" \
  "${REMOTE_USER}@${REMOTE_SERVER}" "md5sum ${REMOTE_DIR}/check-queue" 2>/dev/null | awk '{print $1}')
[[ "${LOCAL_HASH}" != "${REMOTE_HASH}" ]] && update_scripts   # then scp pull (see nodemonDownload.sh)
```
**Recommendation:** md5-compare (not `--version`) — `check-queue` is a script not a versioned binary, matching the closest analog. **Backup-on-update** to `${LOCAL_DIR}/old-scripts/backup_${TIMESTAMP}/` exactly as lines 60-69. **Crontab redirect** (set by `updateCrontab.sh`): `>> /lnd/nodemon/check-queue.log 2>&1`.

---

### `nodemonDownload.sh` (downloader, file-I/O — scp pull)

**Analog:** `aiLiquidityManagerDownload.sh` (entire 19 lines — the minimal dedicated-folder downloader). Mirror exactly, swapping the dir names.

**Full pattern (port of `aiLiquidityManagerDownload.sh` lines 1-19):**
```bash
#!/bin/bash
source /lnd/bashScripts/config.sh
REMOTE_DIR="${REMOTE_HOME}/nodemon"      # mirrors ${REMOTE_HOME}/aiLiquidityManager
LOCAL_DIR="/lnd/nodemon"                 # mirrors /lnd/aiLiquidityManager
if [ ! -d "${LOCAL_DIR}" ]; then mkdir -p "${LOCAL_DIR}"; fi
chmod 600 ${LND_DIR}/id_rsa
yes | sudo scp -r -o StrictHostKeyChecking=no -P ${REMOTE_PORT} -i ${LND_DIR}/id_rsa \
  ${REMOTE_USER}@${REMOTE_SERVER}:${REMOTE_DIR}/* ${LOCAL_DIR}/
# DIVERGENCE: this folder also holds the EXECUTOR scripts → chmod +x like bashScriptDownloader.sh line 20:
find "${LOCAL_DIR}" -type f \( -name "check-queue" -o -name "apply-fee" -o -name "*.sh" \) -exec sudo chmod +x {} \;
```
**Note (RESEARCH Open Q2 — resolved):** dedicated `nodemonDownload.sh` for `~/nodemon/` + place `run_check-queue.sh` in `~/bashScripts/` (so it ships via the existing `bashScriptDownloader.sh` all-folder scp, lines 16-20). The secret env file is NEVER in either pull (D-03).

---

### `updateCrontab.sh` (MODIFIED — add `CRON_JOB_11`)

**Analog:** self — the existing idempotent `grep -Fxq` merge block (lines 23-61). Add one constant + one merge block, mirroring lines 4-14 (definitions) and lines 59-61 (the `CRON_JOB_10` merge, copy verbatim with `_11`).

**New constant (after line 14, `*/5` matching the fleet default cadence — D-09):**
```bash
CRON_JOB_11="*/5 * * * * /lnd/bashScripts/run_check-queue.sh >> /lnd/nodemon/check-queue.log 2>&1"
```
**New merge block (copy of lines 59-61):**
```bash
if ! grep -Fxq "${CRON_JOB_11}" "${TEMP_CRON_FILE}"; then
    echo "${CRON_JOB_11}" >> "${TEMP_CRON_FILE}"
fi
```
**Critical:** insert the merge block BEFORE line 62 (`crontab "${TEMP_CRON_FILE}"`). Idempotent re-run on every downloader tick — no divergence from the established pattern.

---

### `db/role-grants.sql` (MODIFIED — new `nodemon_node` role + RLS section)

**Analog:** self — the `nodemon_ro` role block (lines 24-27 role create + `default_transaction_read_only`; lines 36-43 scoped named-table GRANTs; lines 85-88 verification query). The new section is a least-privilege READ-WRITE sibling with RLS added. **Do NOT Drizzle-migrate** (hand-authored file convention, RESEARCH Anti-Pattern).

**Role + grants (mirror lines 24-43 structure; scoped NAMED tables only, never blanket):**
```sql
-- nodemon_node — least-privilege node-side executor role (extends the file's nodemon_ro pattern)
CREATE ROLE nodemon_node WITH LOGIN PASSWORD '<generated-strong-password>';   -- mirror line 24, per-node creds (D-03)
GRANT CONNECT ON DATABASE nodemon TO nodemon_node;                            -- mirror line 32
GRANT USAGE ON SCHEMA public TO nodemon_node;                                 -- mirror line 33
GRANT SELECT, UPDATE ON commands TO nodemon_node;            -- no INSERT/DELETE on commands
GRANT SELECT, INSERT ON command_executions TO nodemon_node;  -- SELECT for the rate-limit count (D-10)
GRANT SELECT, INSERT ON command_audit TO nodemon_node;
-- Explicitly do NOT grant DELETE/TRUNCATE/DDL anywhere (mirror lines 63/79).
```
**RLS section (NO analog in current file — net-new; from RESEARCH Code Examples lines 290-314):**
```sql
ALTER TABLE commands           ENABLE ROW LEVEL SECURITY; ALTER TABLE commands           FORCE ROW LEVEL SECURITY;
ALTER TABLE command_executions ENABLE ROW LEVEL SECURITY; ALTER TABLE command_executions FORCE ROW LEVEL SECURITY;  -- FORCE = Pitfall 6 belt
ALTER TABLE command_audit      ENABLE ROW LEVEL SECURITY; ALTER TABLE command_audit      FORCE ROW LEVEL SECURITY;

CREATE POLICY node_own_commands ON commands
  USING      (node_pubkey = current_setting('app.node_pubkey', true))   -- two-arg form → NULL (not error) when unset = fail-closed (no rows)
  WITH CHECK (node_pubkey = current_setting('app.node_pubkey', true));  -- prevents flipping a row to a different pubkey
CREATE POLICY node_own_exec ON command_executions
  USING      (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)));
CREATE POLICY node_own_audit ON command_audit
  USING      (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)));
```
**Verification query (mirror lines 85-88, grantee `nodemon_node`):** assert SELECT/UPDATE/INSERT rows only, no DELETE/TRUNCATE. **Pitfall 6:** `nodemon_node` must NOT own the queue tables, or RLS is bypassed.

---

### `src/lib/queue/bounds.ts` (MODIFIED — freeze edit, in place)

**Analog:** self. The values are ALREADY the D-11 confirmed numbers (lines 31-33: `0..5000`, `0..100_000`, `18..2016`); the edit is purely to REMOVE the `[ASSUMED]` provisional framing now that the operator confirmed them.

**Edit scope:**
- **Delete** the `[ASSUMED]` block comment lines 12-21 (the boxed provisional-bounds warning).
- **Update** the header comment lines 4-10 to drop "provisional" / "MUST be confirmed" language → "operator-confirmed and frozen (D-11); node-side re-enforces these identical values (3rd of 3 enforcement points)".
- **Strip** the trailing `// [ASSUMED] …` inline comments on lines 31-33 → replace with `// frozen D-11`.
- **Do NOT change any numeric value** — the bounds are already correct; this is a documentation freeze, not a logic change.

---

### `tests/node/seed.sql` + `tests/node/assert.sql` (test fixtures, batch)

**Analog:** `src/lib/db/schema/nodemon.ts` column shapes (lines 41-84) + the `claim.ts`/`stub-executor.ts` transitions for the expected end-states.

**Seed the 6 rows (column shapes from schema lines 41-57 — note `commands.id` is app-supplied, NO defaultRandom, line 42-43):**
```sql
-- All rows use deterministic UUIDs + fixed expires_at + signatures from a TEST per-node secret (Wave 0 self-contained).
-- 1) VALID approved   : state='approved', expires_at>now(), valid signature_hex over canonical_payload
-- 2) tampered HMAC    : state='approved', signature_hex mutated → expect failed/hmac_mismatch
-- 3) un-approved      : state='pending_approval' → expect UNTOUCHED (never claimed)
-- 4) expired          : state='approved', expires_at<now() → expect 'expired' after expireSweep
-- 5) wrong-pubkey     : state='approved', node_pubkey=<other> → expect INVISIBLE under RLS (never claimed)
-- 6) out-of-bounds    : state='approved', params.suggestedPpm=9999 → expect failed/bounds_violation, NO lncli
```

**Assert (expected end-states map to claim.ts + stub-executor.ts terminal transitions):**
```sql
-- assert commands.state per id AND the command_audit transition rows:
--   tampered → failed   + audit(executing? no: claimed→failed, reason hmac_mismatch)   [D-13: no lncli]
--   bounds   → failed   + audit reason bounds_violation                                 [D-13: no lncli]
--   expired  → expired  + audit(reason='ttl_expired')                  (== claim.ts line 119)
--   un-approved/wrong-pubkey → unchanged, zero audit rows from this tick
```

---

### `tests/node/check-queue.bats` + `tests/node/hmac-vector.bats` (bats tests)

**Analog:** no in-repo bats suite exists (`tests/` is net-new). `check-queue.bats` mirrors the INTENT of `claim.ts`'s concurrency guarantee (two concurrent `check-queue` invocations on one approved row → exactly one `succeeded`, one no-op — Success Criterion 4). `hmac-vector.bats` is the byte-identity proof: sign a known canonical string with `sign.ts` (TS), verify it in bash, guarding Pitfall 1 (trailing newline) and Pitfall 4 (openssl output format). The TS side calls `buildSignedPayload` (canonical.ts lines 35-43) + `signPayload` (sign.ts lines 36-38); the bash side reproduces the `apply-fee` verify excerpt above.

**Static grep gate (EXEC-02):** assert NO `eval` / `sh -c` with `$params`, and NO `--fee_rate ` (only `--fee_rate_ppm`) in `apply-fee`.

---

## Shared Patterns

### HMAC byte-identity (TS signer ↔ bash verifier)
**Source:** `src/lib/queue/sign.ts` lines 36-38 (signer) + `src/lib/queue/canonical.ts` lines 35-43 (the 5-field payload).
**Apply to:** `apply-fee` (verify), `hmac-vector.bats` (proof), `seed.sql` (test signatures).
```typescript
// sign.ts:37 — the digest bash must reproduce
createHmac("sha256", secretFor(pubkey)).update(payload, "utf8").digest("hex");
// canonical.ts:42 — the exact string that is hashed (stored verbatim in commands.canonical_payload, schema line 49)
[p.nodePubkey, p.commandId, p.actionType, p.canonicalParams, p.expiresAt].join("\n");
```
**Bash divergence (load-bearing):** `printf '%s'` not `echo` (no trailing newline, Pitfall 1); `openssl dgst -sha256 -hmac "$SECRET" -r | awk '{print $1}'`; hex lowercase, never base64; hash the STORED `canonical_payload` verbatim, never re-serialize `params` (Pitfall 3).

### Atomic claim / no-double-apply
**Source:** `src/lib/queue/claim.ts` lines 57-81 (`.for("update",{skipLocked:true})`).
**Apply to:** `check-queue` (every tick), `check-queue.bats` (overlapping-tick proof).
**Bash divergence:** Drizzle `dbNodemon.transaction()` → one `psql` `BEGIN … FOR UPDATE SKIP LOCKED … COMMIT`; add `SET LOCAL app.node_pubkey` (no TS analog — RLS scope, Pitfall 2).

### Fleet config sourcing + creds
**Source:** `config.sh` lines 4-8 (`REMOTE_SERVER`/`REMOTE_PORT`/`REMOTE_USER`/`LND_DIR=/lnd`/`REMOTE_HOME=/home/josh`) + `run_liquidity_manager.sh` lines 13-14 (TLS/macaroon paths).
**Apply to:** `check-queue`, `apply-fee`, `run_check-queue.sh`, `nodemonDownload.sh` — all `source /lnd/bashScripts/config.sh` first.

### Logging discipline
**Source:** `run_nodeAuditor.sh` line 19 (`log() { echo "$(date …): $*" | tee -a "${LOG_FILE}"; }`) + CLAUDE.md logging rule.
**Apply to:** all node scripts → log to `/lnd/nodemon/check-queue.log`; log state/reason/chan_point ONLY — NEVER the secret, macaroon, or full signature (RESEARCH Anti-Pattern, V6).

### Self-update + idempotent install
**Source:** `run_liquidity_manager.sh` lines 84-101 (md5 compare) + `updateCrontab.sh` lines 23-61 (`grep -Fxq` merge) + `bashScriptDownloader.sh` line 20 (`chmod +x`).
**Apply to:** `run_check-queue.sh`, `nodemonDownload.sh`, `updateCrontab.sh`.

### Single-flight belt (flock)
**Source:** `run_nodeAuditor.sh` lines 28-32 (`exec 9>LOCK; flock -n 9 || exit 0`).
**Apply to:** `check-queue` — belt only; the DB row-lock is the real guarantee (do NOT rely on flock for no-double-apply).

---

## No Analog Found

| File | Role | Data Flow | Reason / Mitigation |
|------|------|-----------|---------------------|
| `tests/node/check-queue.bats` | test (bats) | event-driven | No existing bats harness in repo; `tests/` is net-new. Structure from the EXEC-03 test map (RESEARCH §Validation Architecture) + the `claim.ts` concurrency contract. |
| RLS policy block in `db/role-grants.sql` | config (RLS) | config | The current file has roles+grants but NO RLS. Net-new RLS comes from RESEARCH Code Examples lines 290-314 + postgresql.org RLS docs — planner finalizes policy text, operator runs it. |

---

## Metadata

**Analog search scope:**
- Fleet rail: `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/` (read: `config.sh`, `bashScriptDownloader.sh`, `aiLiquidityManagerDownload.sh`, `updateCrontab.sh`, `run_liquidity_manager.sh`, `run_nodeAuditor.sh`)
- In-repo frozen queue: `src/lib/queue/{canonical,sign,claim,stub-executor,bounds}.ts`, `src/lib/db/schema/nodemon.ts`, `db/role-grants.sql`

**Files scanned:** 13 (6 fleet scripts + 7 in-repo modules), all read in full (each ≤ 182 lines)
**Pattern extraction date:** 2026-06-17
