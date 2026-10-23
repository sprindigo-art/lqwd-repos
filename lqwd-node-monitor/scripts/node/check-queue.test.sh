#!/bin/bash
#
# check-queue.test.sh — golden proof that the claim rate-limit ceiling honors
# NODEMON_RATE_LIMIT_MAX (Q3), not a hardcoded literal.
# ==========================================================================
# 18-02 Task 2. DB-REQUIRED suite (bash analog of the 18-01 requireNodemonDb
# tagging convention): needs a disposable Postgres (docker/podman via
# tests/node/lib/pg-harness.sh). When no runtime is available:
#   * locally  → VISIBLE skip, exit 0 (mirrors requireNodemonDb's local path)
#   * under CI → exit 1 (a silently-skipped queue safety proof is a false
#     green — the 18-01 fail-on-skip principle, T-18-01/T-18-06)
#
# Proof shape: seed ONE valid approved row + THREE command_executions rows in
# the rolling hour (rl_count=3), then run the SAME tick twice with different
# ceilings:
#   Tick A: NODEMON_RATE_LIMIT_MAX=2 → 3 >= 2 → rate_limited, row stays approved
#   Tick B: NODEMON_RATE_LIMIT_MAX=6 → 3 <  6 → row IS claimed and executed
# Same DB state, different env ceiling, different enforcement outcome — proving
# the SQL gate binds :'rlmax' from the env (Q3), not the literal 4 (with the
# old hardcoded 4, BOTH ticks would have claimed).

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THIS_PUBKEY='02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
VALID_UUID='11111111-1111-1111-1111-111111111111'
TAMPERED_UUID='22222222-2222-2222-2222-222222222222'

# ── DB-required gate (18-01 convention, bash analog) ──────────────────────────
# Probe with a hard timeout: `docker info` HANGS (not fails) when the daemon
# socket is dead, which would wedge the suite before it could even skip.
_with_timeout() { # <seconds> <cmd...>
  # `shift` is load-bearing: without it "$@" still carries the seconds, so the
  # subshell ran `15 docker info` and died with rc=127 (command not found). The
  # probe therefore reported "no runtime" on EVERY machine — including CI runners
  # that do have Docker — so this DB-required suite was never actually executing.
  local secs="$1"; shift
  (
    "$@" >/dev/null 2>&1 & local c=$!
    ( sleep "$secs"; kill -9 "$c" 2>/dev/null ) & local w=$!
    wait "$c" 2>/dev/null; local rc=$?
    kill "$w" 2>/dev/null
    exit "$rc"
  )
}
_probe_runtime() {
  local rt
  for rt in docker podman; do
    command -v "$rt" >/dev/null 2>&1 || continue
    if _with_timeout 15 "$rt" info; then echo "$rt"; return 0; fi
  done
  return 1
}
if ! RUNTIME="$(_probe_runtime)"; then
  if [ -n "${CI:-}" ]; then
    echo "FAIL: check-queue.test.sh is DB-REQUIRED (T-18-06) and no docker/podman runtime is available under CI — refusing to silently skip."
    exit 1
  fi
  echo "SKIP (visible): no docker/podman runtime — DB-required Q3 rate-limit proof NOT executed locally. CI runs it (18-01 fail-on-skip)."
  exit 0
fi

# shellcheck source=../../tests/node/lib/pg-harness.sh
source "${REPO_ROOT}/tests/node/lib/pg-harness.sh"
PG_HARNESS_RUNTIME="$RUNTIME"

cleanup() { pg_harness_down || true; rm -rf "${TOOLBOX:-}"; }
trap cleanup EXIT

pg_harness_up "$REPO_ROOT" || { echo "FAIL: pg-harness could not stand up the disposable Postgres"; exit 1; }

admin_psql() { pg_harness_admin_psql "$@"; }

# ── seed: 1 valid approved row + 3 executions inside the rolling hour ─────────
admin_psql -q < "${REPO_ROOT}/tests/node/seed.sql" >/dev/null || { echo "FAIL: seed.sql"; exit 1; }
# Keep ONLY the valid approved row + the tampered row (an FK anchor for the
# execution rows); drop the rest so nothing else is claimable.
admin_psql -q -v ON_ERROR_STOP=1 <<SQL >/dev/null || { echo "FAIL: fixture trim"; exit 1; }
DELETE FROM command_audit;
DELETE FROM command_executions;
DELETE FROM commands WHERE id NOT IN ('${VALID_UUID}','${TAMPERED_UUID}');
-- Three executions in the rolling hour → rl_count = 3 for the next tick.
INSERT INTO command_executions (command_id, outcome, detail, executed_at) VALUES
  ('${TAMPERED_UUID}', 'succeeded', 'rate-limit fixture 1', now() - interval '10 minutes'),
  ('${TAMPERED_UUID}', 'succeeded', 'rate-limit fixture 2', now() - interval '20 minutes'),
  ('${TAMPERED_UUID}', 'succeeded', 'rate-limit fixture 3', now() - interval '30 minutes');
SQL

# ── toolbox: containerized psql wrapper + mock lncli (self-contained) ─────────
TOOLBOX="$(mktemp -d)"
cat > "${TOOLBOX}/psql-node" <<EOF
#!/bin/bash
args=(); for a in "\$@"; do case "\$a" in postgresql://*) ;; *) args+=("\$a") ;; esac; done
# SIMULATE_COMMIT1_NOOP: exercise the Q4 double-apply guard by DROPPING the
# EXECUTING<tab>id marker from the claimed→executing flip's stdout, so check-queue
# cannot CONFIRM the committed flip and must abort before apply-fee.
if [ -n "\${SIMULATE_COMMIT1_NOOP:-}" ]; then
  in="\$(cat)"
  if printf '%s' "\$in" | grep -q "'EXECUTING'"; then
    printf '%s' "\$in" | ${RUNTIME} exec -i ${PG_HARNESS_CONTAINER} psql -U nodemon_node -d nodemon "\${args[@]}" | grep -v '^EXECUTING'
  else
    printf '%s' "\$in" | ${RUNTIME} exec -i ${PG_HARNESS_CONTAINER} psql -U nodemon_node -d nodemon "\${args[@]}"
  fi
else
  exec ${RUNTIME} exec -i ${PG_HARNESS_CONTAINER} psql -U nodemon_node -d nodemon "\${args[@]}"
fi
EOF
chmod +x "${TOOLBOX}/psql-node"
# Mock lncli serving the live-TLD reads (listchannels/getchaninfo) + the apply,
# so a within-ceiling tick can run the full claim→execute chain to success.
cat > "${TOOLBOX}/lncli" <<LNCLI
#!/bin/bash
sub=""; skip_next=0
for a in "\$@"; do
  if [ "\$skip_next" = "1" ]; then skip_next=0; continue; fi
  case "\$a" in
    --tlscertpath|--macaroonpath) skip_next=1; continue ;;
    --*) continue ;;
    *) sub="\$a"; break ;;
  esac
done
case "\$sub" in
  listchannels) echo '{"channels":[{"channel_point":"aaaa1111:0","chan_id":"800000000000000001"}]}' ;;
  getchaninfo)  echo '{"node1_pub":"${THIS_PUBKEY}","node1_policy":{"time_lock_delta":80},"node2_pub":"03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","node2_policy":{"time_lock_delta":80}}' ;;
  updatechanpolicy) echo "policy updated" ;;
  *) echo '{}' ;;
esac
LNCLI
chmod +x "${TOOLBOX}/lncli"

# Q7: check-queue resolves the PER-PUBKEY secret NODEMON_HMAC_SECRET_<pubkey> with
# NO generic fallback, so the test must export the per-pubkey key (set to the seed
# fixture's TEST secret). Exporting the generic NODEMON_HMAC_SECRET alone would now
# fail closed — that is the Q7 behavior under proof elsewhere.
export "NODEMON_HMAC_SECRET_${THIS_PUBKEY}=nodemon-test-secret-do-not-use-in-prod"

run_tick() { # $1 = ceiling, $2 = out-suffix
  mkdir -p "${TOOLBOX}/tick_$2"
  PSQL="${TOOLBOX}/psql-node" \
  NODEMON_NODE_DSN="$NODEMON_TEST_NODE_DSN" \
  NODEMON_NODE_PUBKEY="$THIS_PUBKEY" \
  NODEMON_RATE_LIMIT_MAX="$1" \
  NODEMON_LOCAL_DIR="${TOOLBOX}/tick_$2" \
  NODEMON_LOG_FILE="${TOOLBOX}/tick_$2/check-queue.log" \
  LNCLI="${TOOLBOX}/lncli" \
  APPLY_FEE="${REPO_ROOT}/scripts/node/apply-fee" \
  PATH="${TOOLBOX}:$PATH" \
    "${REPO_ROOT}/scripts/node/check-queue" > "${TOOLBOX}/out_$2" 2>&1
}

state_of() { admin_psql -tAc "SELECT state FROM commands WHERE id='${1}';" | tail -n1 | tr -d '[:space:]'; }

fail() { echo "FAIL [$1]: $2"; echo "--- tick A ---"; cat "${TOOLBOX}/out_a" 2>/dev/null; echo "--- tick B ---"; cat "${TOOLBOX}/out_b" 2>/dev/null; exit 1; }

# ── Tick A: ceiling 2 < rl_count 3 → NO claim ─────────────────────────────────
run_tick 2 a || fail tick-a "tick exited non-zero"
grep -q 'rate_limited: 3 applies in the last hour (>= 2)' "${TOOLBOX}/out_a" \
  || fail tick-a "expected the rate_limited skip log with ceiling 2"
[ "$(state_of "$VALID_UUID")" = "approved" ] \
  || fail tick-a "row was claimed despite NODEMON_RATE_LIMIT_MAX=2 (state=$(state_of "$VALID_UUID"))"
echo "PASS [ceiling=2: 3 executions >= 2 → claim refused, row still approved]"

# ── Tick B: ceiling 6 > rl_count 3 → row IS claimed and executed ──────────────
run_tick 6 b || fail tick-b "tick exited non-zero"
grep -q "claimed command_id=${VALID_UUID}" "${TOOLBOX}/out_b" \
  || fail tick-b "expected the row to be claimed with ceiling 6"
FINAL_STATE="$(state_of "$VALID_UUID")"
[ "$FINAL_STATE" = "succeeded" ] \
  || fail tick-b "expected the claimed row to reach 'succeeded' (state=${FINAL_STATE})"
echo "PASS [ceiling=6: 3 executions < 6 → row claimed and executed to succeeded]"

# ── Case C: commit1 double-apply guard (Q4) — unconfirmed flip aborts, no apply ─
# Reset the valid row to a freshly-claimable state, then run a tick whose
# claimed→executing flip confirmation is DROPPED (SIMULATE_COMMIT1_NOOP). The
# tick MUST abort before apply-fee: no command_executions row, never 'succeeded'.
admin_psql -q -v ON_ERROR_STOP=1 <<SQL >/dev/null || fail double-apply-setup "reset failed"
DELETE FROM command_audit;
DELETE FROM command_executions;
UPDATE commands SET state='approved', claimed_at=NULL WHERE id='${VALID_UUID}';
SQL
export SIMULATE_COMMIT1_NOOP=1
run_tick 6 c
RC_C=$?
unset SIMULATE_COMMIT1_NOOP
[ "$RC_C" -ne 0 ] \
  || fail double-apply "expected a non-zero exit when the executing flip is UNCONFIRMED (rc=0)"
grep -q 'aborting tick WITHOUT apply' "${TOOLBOX}/out_c" \
  || fail double-apply "expected the abort log when the executing flip is unconfirmed"
EXEC_C="$(admin_psql -tAc "SELECT count(*) FROM command_executions WHERE command_id='${VALID_UUID}';" | tail -n1 | tr -d '[:space:]')"
[ "$EXEC_C" = "0" ] \
  || fail double-apply "apply-fee ran despite the unconfirmed flip (command_executions=${EXEC_C})"
STATE_C="$(state_of "$VALID_UUID")"
[ "$STATE_C" != "succeeded" ] \
  || fail double-apply "row reached 'succeeded' despite the unconfirmed flip (double-apply risk)"
echo "PASS [double-apply: unconfirmed claimed→executing flip aborts the tick; no fee applied]"

# ── Case D: idle-tick sweep (Q-idle) — empty queue still commits the sweeps ────
# One EXPIRED approved row and NOTHING claimable. The sweep txn is SEPARATE from
# the claim, so the empty-queue claim (no candidate) must NOT roll back the
# fail-closed TTL expiry: the row must land 'expired' and the tick log the skip.
admin_psql -q -v ON_ERROR_STOP=1 <<SQL >/dev/null || fail idle-sweep-setup "reset failed"
DELETE FROM command_audit;
DELETE FROM command_executions;
DELETE FROM commands WHERE id <> '${VALID_UUID}';
UPDATE commands
   SET state='approved', claimed_at=NULL, expires_at=now() - interval '1 hour'
 WHERE id='${VALID_UUID}';
SQL
run_tick 6 d || fail idle-sweep "tick exited non-zero on an empty-queue tick"
grep -q 'No approved row to claim this tick' "${TOOLBOX}/out_d" \
  || fail idle-sweep "expected the empty-queue skip log"
STATE_D="$(state_of "$VALID_UUID")"
[ "$STATE_D" = "expired" ] \
  || fail idle-sweep "expire sweep did NOT commit on the empty-queue tick (state=${STATE_D})"
echo "PASS [idle-sweep: empty-queue tick still commits the expire/reaper sweep txn]"

# Same DB state, different NODEMON_RATE_LIMIT_MAX, different enforcement →
# the :'rlmax' binding (not a literal) drives the SQL gate. Q3 proven. Plus the
# Q4 double-apply guard and the Q-idle sweep-preservation invariant.
echo "check-queue.test.sh: Q3 rate-limit + Q4 double-apply guard + Q-idle sweeps PASSED"
exit 0
