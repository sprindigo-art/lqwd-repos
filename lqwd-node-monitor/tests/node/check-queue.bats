#!/usr/bin/env bats
#
# check-queue.bats — seeded behavioral proof of the node-side executor (EXEC-03)
# =============================================================================
# Phase 8 Plan 02. The REAL EXEC-03 proof: drives scripts/node/check-queue (the
# nodemon_node tick) against a DISPOSABLE local Postgres seeded by tests/node/
# seed.sql (as the admin DSN), then asserts via tests/node/assert.sql (admin DSN)
# and a direct RLS-invisibility query (node DSN).
#
# AUTONOMOUS: setup_file stands up a throwaway Postgres (docker/podman/pg_tmp),
# applies the nodemon DDL + the nodemon_node role + ENABLE/FORCE RLS, and exports
# the TWO DSNs. If no local Postgres mechanism is available the whole suite SKIPs
# with the explicit message below — and per the plan that makes the wave-merge a
# BLOCKING checkpoint: "static passes != 5 failure modes proven; run the seeded
# suite to prove EXEC-03." Static grep gates prove SHAPE; this suite proves BEHAVIOR.
#
# Runner: bats-core (NOT in package.json — OS dev tool). Two DB identities:
#   NODEMON_TEST_ADMIN_DSN — privileged owner/admin: seeds rows + runs assertions
#   NODEMON_TEST_NODE_DSN  — non-superuser nodemon_node: the check-queue tick +
#                            the wrong-pubkey RLS-invisibility query

load lib/pg-harness.sh

THIS_PUBKEY='02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
WRONG_PUBKEY_UUID='55555555-5555-5555-5555-555555555555'
VALID_UUID='11111111-1111-1111-1111-111111111111'

setup_file() {
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  export REPO_ROOT
  if pg_harness_available && pg_harness_up "$REPO_ROOT"; then
    export NODEMON_PG_HARNESS=ready
    # Persist the runtime/container/DSNs so the per-test subshells can reach them.
    export PG_HARNESS_RUNTIME PG_HARNESS_CONTAINER NODEMON_TEST_ADMIN_DSN NODEMON_TEST_NODE_DSN
  else
    export NODEMON_PG_HARNESS=unavailable
  fi
}

teardown_file() {
  pg_harness_down || true
}

# Skip the whole behavioral suite (with the blocking-checkpoint message) when no
# disposable Postgres is available. Static checks are NOT a substitute.
_require_pg() {
  if [ "${NODEMON_PG_HARNESS:-unavailable}" != "ready" ]; then
    skip "no local Postgres (docker/podman/pg_tmp) — static passes != 5 failure modes proven; this is a BLOCKING wave-merge checkpoint. Run the seeded suite to prove EXEC-03."
  fi
}

# psql shorthands bound to the two identities, run inside the harness container.
# Recompute the runtime + container name per call (the file-sourced PG_HARNESS_*
# globals are deterministic from BATS_FILE_TMPDIR, so they match setup_file's).
_rt() { pg_harness_runtime; }
_psql_admin() { "$(_rt)" exec -i "$PG_HARNESS_CONTAINER" psql -U postgres -d nodemon "$@"; }
_psql_node()  { "$(_rt)" exec -i "$PG_HARNESS_CONTAINER" psql -U nodemon_node -d nodemon "$@"; }

# =============================================================================
# Static grep gate (always runs — no DB needed). EXEC-02: argv-only, no eval.
# =============================================================================
@test "static: apply-fee has no eval / no sh -c / no bare --fee_rate flag" {
  APPLY="${BATS_TEST_DIRNAME}/../../scripts/node/apply-fee"
  [ -f "$APPLY" ] || skip "scripts/node/apply-fee not present yet"
  NONCOMMENT="$(grep -v '^[[:space:]]*#' "$APPLY")"
  ! printf '%s\n' "$NONCOMMENT" | grep -Eq 'eval '
  ! printf '%s\n' "$NONCOMMENT" | grep -Eq 'sh -c'
  ! printf '%s\n' "$NONCOMMENT" | grep -Eq '[-][-]fee_rate '
  printf '%s\n' "$NONCOMMENT" | grep -Eq '[-][-]fee_rate_ppm'
}

# =============================================================================
# Wrong-pubkey RLS invisibility — the GENUINE EXEC-03 proof.
# =============================================================================
@test "wrong-pubkey row is RLS-INVISIBLE to a nodemon_node connection (zero rows)" {
  _require_pg
  _psql_admin -q < "${REPO_ROOT}/tests/node/seed.sql" >/dev/null
  local count total
  count="$(_psql_node -tAc "SET app.node_pubkey = '${THIS_PUBKEY}'; SELECT count(*) FROM commands WHERE id = '${WRONG_PUBKEY_UUID}';" | tail -n1 | tr -d '[:space:]')"
  [ "$count" = "0" ]
  # And the node sees only THIS node's 5 rows (not the 6th wrong-pubkey row).
  total="$(_psql_node -tAc "SET app.node_pubkey = '${THIS_PUBKEY}'; SELECT count(*) FROM commands;" | tail -n1 | tr -d '[:space:]')"
  [ "$total" = "5" ]
}

# =============================================================================
# Executor role cannot self-approve — DB state-machine trigger (approved-only).
# =============================================================================
@test "nodemon_node CANNOT flip pending_approval -> approved (state-machine trigger)" {
  _require_pg
  _psql_admin -q < "${REPO_ROOT}/tests/node/seed.sql" >/dev/null
  # As the non-superuser executor, scoped to THIS node, try to self-approve the
  # seeded pending_approval row (row 3, own-pubkey → RLS-visible).
  run _psql_node -v ON_ERROR_STOP=1 -c \
    "SET app.node_pubkey = '${THIS_PUBKEY}'; UPDATE commands SET state='approved' WHERE id = '33333333-3333-3333-3333-333333333333';"
  [ "$status" -ne 0 ]
  echo "$output" | grep -qi 'illegal state transition'
  # The row is UNCHANGED (admin read bypasses RLS).
  local s
  s="$(_psql_admin -tAc "SELECT state FROM commands WHERE id = '33333333-3333-3333-3333-333333333333';" | tail -n1 | tr -d '[:space:]')"
  [ "$s" = "pending_approval" ]
}

# =============================================================================
# Overlapping ticks — no-double-apply (FOR UPDATE SKIP LOCKED).
# =============================================================================
@test "two concurrent ticks on one approved row: exactly one applies, one no-ops" {
  _require_pg
  _psql_admin -q < "${REPO_ROOT}/tests/node/seed.sql" >/dev/null
  _psql_admin -q -c "DELETE FROM command_audit; DELETE FROM command_executions; DELETE FROM commands WHERE id <> '${VALID_UUID}';" >/dev/null

  # Slow lncli widens the concurrency window so the row-lock is genuinely contended.
  local tb rt; tb="$(mktemp -d)"; rt="$(_rt)"
  cat > "${tb}/psql-node" <<EOF
#!/bin/bash
args=(); for a in "\$@"; do case "\$a" in postgresql://*) ;; *) args+=("\$a") ;; esac; done
exec ${rt} exec -i ${PG_HARNESS_CONTAINER} psql -U nodemon_node -d nodemon "\${args[@]}"
EOF
  chmod +x "${tb}/psql-node"
  # Mock lncli: serves listchannels/getchaninfo (live time_lock_delta resolution)
  # and a SLOW updatechanpolicy that widens the concurrency window so the row-lock
  # is genuinely contended.
  cat > "${tb}/lncli" <<'LNCLI'
#!/bin/bash
sub=""; skip_next=0
for a in "$@"; do
  if [ "$skip_next" = "1" ]; then skip_next=0; continue; fi
  case "$a" in
    --tlscertpath|--macaroonpath) skip_next=1; continue ;;
    --*) continue ;;
    *) sub="$a"; break ;;
  esac
done
case "$sub" in
  listchannels) echo '{"channels":[{"channel_point":"aaaa1111:0","chan_id":"800000000000000001"}]}' ;;
  getchaninfo)  echo '{"node1_pub":"02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","node1_policy":{"time_lock_delta":80},"node2_pub":"03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","node2_policy":{"time_lock_delta":80}}' ;;
  updatechanpolicy) sleep 1; echo "policy updated" ;;
  *) echo ok ;;
esac
LNCLI
  chmod +x "${tb}/lncli"

  _run_tick() { # $1 = lock/output suffix
    PSQL="${tb}/psql-node" NODEMON_NODE_DSN="$NODEMON_TEST_NODE_DSN" \
    NODEMON_NODE_PUBKEY="$THIS_PUBKEY" NODEMON_HMAC_SECRET='nodemon-test-secret-do-not-use-in-prod' \
    NODEMON_LOCAL_DIR="${tb}/$1" NODEMON_LOG_FILE="${tb}/$1.log" \
    LNCLI="${tb}/lncli" APPLY_FEE="${REPO_ROOT}/scripts/node/apply-fee" PATH="${tb}:$PATH" \
      "${REPO_ROOT}/scripts/node/check-queue" >"${tb}/out_$1" 2>&1
  }
  _run_tick a & local pa=$!
  _run_tick b & local pb=$!
  wait "$pa" "$pb"

  local c=0 n=0
  grep -q "claimed command_id=${VALID_UUID}" "${tb}/out_a" && c=$((c+1)) || true
  grep -q "claimed command_id=${VALID_UUID}" "${tb}/out_b" && c=$((c+1)) || true
  grep -q 'No approved row to claim' "${tb}/out_a" && n=$((n+1)) || true
  grep -q 'No approved row to claim' "${tb}/out_b" && n=$((n+1)) || true
  [ "$c" = "1" ]
  [ "$n" = "1" ]

  # Exactly ONE command_executions row → no double-apply.
  local execs
  execs="$(_psql_admin -tAc "SELECT count(*) FROM command_executions WHERE command_id='${VALID_UUID}';" | tail -n1 | tr -d '[:space:]')"
  [ "$execs" = "1" ]
  rm -rf "$tb"
}

# =============================================================================
# Full seeded suite — all 5 failure modes + bounds → assert.sql.
# =============================================================================
@test "full seeded tick: all five failure modes + bounds end in expected states" {
  _require_pg
  _psql_admin -q < "${REPO_ROOT}/tests/node/seed.sql" >/dev/null

  local tb; tb="$(pg_harness_make_toolbox success)"
  # claimNext takes one approved row per tick; loop enough ticks to drain the
  # three approved-and-claimable rows (valid, tampered, bounds). The expired,
  # un-approved and wrong-pubkey rows are never claimed.
  local i
  for i in 1 2 3 4 5 6; do
    pg_harness_run_tick "$REPO_ROOT" "$THIS_PUBKEY" "$tb" >/dev/null 2>&1 || true
  done

  # assert.sql (admin, RLS-bypassing) raises on any violated assertion → non-zero.
  run _psql_admin -v ON_ERROR_STOP=1 < "${REPO_ROOT}/tests/node/assert.sql"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q 'all six failure-mode assertions PASSED'
  rm -rf "$tb"
}
