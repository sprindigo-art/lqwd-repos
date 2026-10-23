#!/bin/bash
#
# tests/node/lib/pg-harness.sh — disposable local Postgres lifecycle for the
# autonomous EXEC-03 seeded bats suite.
# ===========================================================================
# Sourced by check-queue.bats (setup_file/teardown_file). Stands up a THROWAWAY
# Postgres so the full 5-mode + bounds + overlapping-ticks + wrong-pubkey-RLS
# suite runs WITHOUT operator hand-off. Mechanism preference order:
#   (1) ephemeral container: `docker run --rm postgres:16`  (preferred)
#   (2) podman equivalent
#   (3) throwaway local cluster: pg_tmp / initdb+pg_ctl in a tempdir
# If NONE is available, pg_harness_available returns 1 and the suite SKIPs with
# the explicit "static != proven; blocking wave-merge checkpoint" message.
#
# It then:
#   * applies the nodemon DDL (drizzle/nodemon/0000_hard_random.sql),
#   * applies db/role-grants.sql's nodemon_node role + ENABLE/FORCE RLS section,
#   * exports NODEMON_TEST_ADMIN_DSN (bootstrap superuser/owner — seed + assert)
#     and NODEMON_TEST_NODE_DSN (the non-superuser nodemon_node — the tick),
#   * so FORCE ROW LEVEL SECURITY actually bites on the tick connection.
#
# All DSNs point at the SAME disposable DB; the two identities differ ONLY in role.
# psql is invoked INSIDE the container (the host need not have a psql client).

PG_HARNESS_IMAGE="${PG_HARNESS_IMAGE:-postgres:16}"
# Stable per-run container name. Under bats, BATS_FILE_TMPDIR is shared by
# setup_file and every test in the file, so a name derived from it (or persisted
# into it) survives across the per-test subshells. Outside bats it falls back to $$.
if [ -n "${BATS_FILE_TMPDIR:-}" ]; then
  PG_HARNESS_CONTAINER="nodemon-test-pg-$(basename "$BATS_FILE_TMPDIR" | tr -cd '[:alnum:]')"
else
  PG_HARNESS_CONTAINER="${PG_HARNESS_CONTAINER:-nodemon-test-pg-$$}"
fi
PG_HARNESS_PASSWORD="harness_admin_pw"
PG_HARNESS_NODE_PASSWORD="harness_node_pw"
PG_HARNESS_HOSTPORT=""
PG_HARNESS_RUNTIME=""

pg_harness_runtime() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    echo docker; return 0
  fi
  if command -v podman >/dev/null 2>&1; then
    echo podman; return 0
  fi
  return 1
}

# Returns 0 if a disposable-Postgres mechanism is available, else 1.
pg_harness_available() {
  PG_HARNESS_RUNTIME="$(pg_harness_runtime)" || return 1
  return 0
}

# psql executed inside the running container as the bootstrap superuser.
_pg_psql_admin() {
  "$PG_HARNESS_RUNTIME" exec -i "$PG_HARNESS_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U postgres -d nodemon "$@"
}

# Bring up the container, create DB, apply schema + role-grants, export DSNs.
pg_harness_up() {
  PG_HARNESS_RUNTIME="$(pg_harness_runtime)" || return 1
  local repo_root="$1"

  # Find a free ephemeral host port (best-effort) for external DSN exposure.
  # process.stdout.write avoids console.log's possible ANSI coloring; strip any
  # stray non-digit bytes defensively.
  PG_HARNESS_HOSTPORT="$( node -e 'const s=require("net").createServer();s.listen(0,()=>{process.stdout.write(String(s.address().port));s.close()})' | tr -cd '0-9' )"

  "$PG_HARNESS_RUNTIME" run -d --rm \
    --name "$PG_HARNESS_CONTAINER" \
    -e POSTGRES_PASSWORD="$PG_HARNESS_PASSWORD" \
    -e POSTGRES_DB=nodemon \
    -p "${PG_HARNESS_HOSTPORT}:5432" \
    "$PG_HARNESS_IMAGE" >/dev/null || return 1

  # Wait for readiness.
  local tries=0
  until "$PG_HARNESS_RUNTIME" exec -i "$PG_HARNESS_CONTAINER" pg_isready -U postgres -d nodemon >/dev/null 2>&1; do
    tries=$((tries + 1)); [ "$tries" -gt 60 ] && { echo "pg-harness: DB never became ready" >&2; return 1; }
    sleep 1
  done

  # Apply the nodemon DDL — EVERY migration in journal order, not just 0000.
  # Applying only 0000 left the container without host_metrics/host_storage/
  # service_health/chain_telemetry (added in 0001+), so the nodemon_telemetry
  # GRANTs below died with `relation "host_metrics" does not exist` and the whole
  # harness failed to stand up. That went unnoticed because the container-runtime
  # probe was broken, so this harness had never actually run.
  local _mig
  for _mig in $(ls -1 "${repo_root}"/drizzle/nodemon/[0-9][0-9][0-9][0-9]_*.sql | sort); do
    _pg_psql_admin < "$_mig" >/dev/null || {
      echo "pg-harness: migration failed: $(basename "$_mig")" >&2
      return 1
    }
  done

  # Create the non-superuser nodemon_node role + ENABLE/FORCE RLS, sed-substituting
  # the password placeholder so the file's own SQL applies verbatim otherwise.
  # We extract ONLY the nodemon_node section (from its CREATE ROLE to EOF) since the
  # nodemon_ro block targets the warehouses, not this nodemon DB.
  awk '/CREATE ROLE nodemon_node/{f=1} f' "${repo_root}/db/role-grants.sql" \
    | sed "s/<generated-strong-password>/${PG_HARNESS_NODE_PASSWORD}/g" \
    | _pg_psql_admin >/dev/null || return 1

  # nodemon_node must NOT own the tables (it doesn't — postgres owns them) so
  # FORCE RLS bites. Two DSNs, same DB, different identities.
  export NODEMON_TEST_ADMIN_DSN="postgresql://postgres:${PG_HARNESS_PASSWORD}@127.0.0.1:${PG_HARNESS_HOSTPORT}/nodemon"
  export NODEMON_TEST_NODE_DSN="postgresql://nodemon_node:${PG_HARNESS_NODE_PASSWORD}@127.0.0.1:${PG_HARNESS_HOSTPORT}/nodemon"
  return 0
}

pg_harness_down() {
  [ -n "$PG_HARNESS_RUNTIME" ] || return 0
  "$PG_HARNESS_RUNTIME" rm -f "$PG_HARNESS_CONTAINER" >/dev/null 2>&1 || true
}

# Resolve the runtime on demand (PG_HARNESS_RUNTIME may be unset in a fresh
# per-test subshell; the container name is deterministic from BATS_FILE_TMPDIR).
_pg_rt() { [ -n "${PG_HARNESS_RUNTIME:-}" ] && { echo "$PG_HARNESS_RUNTIME"; return 0; }; pg_harness_runtime; }

# psql as the ADMIN identity (seed/assert), executed inside the container.
pg_harness_admin_psql() {
  "$(_pg_rt)" exec -i "$PG_HARNESS_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U postgres -d nodemon "$@"
}

# psql as the NON-SUPERUSER nodemon_node identity (the tick / RLS queries).
pg_harness_node_psql() {
  "$(_pg_rt)" exec -i "$PG_HARNESS_CONTAINER" \
    psql -U nodemon_node -d nodemon "$@"
}

# Build a per-run scratch dir holding a containerized $PSQL wrapper (so the host
# need not have a psql client) + a mock lncli. Echoes the scratch dir path.
pg_harness_make_toolbox() {
  local outcome="${1:-success}"   # success | fail
  local rt; rt="$(_pg_rt)"
  local dir; dir="$(mktemp -d)"
  cat > "${dir}/psql-node" <<EOF
#!/bin/bash
# Drop the DSN arg; connect as nodemon_node inside the harness container.
args=(); for a in "\$@"; do case "\$a" in postgresql://*) ;; *) args+=("\$a") ;; esac; done
exec ${rt} exec -i ${PG_HARNESS_CONTAINER} psql -U nodemon_node -d nodemon "\${args[@]}"
EOF
  chmod +x "${dir}/psql-node"
  if [ "$outcome" = "fail" ]; then
    printf '#!/bin/bash\necho "boom" >&2\nexit 1\n' > "${dir}/lncli"
  else
    # Mock lncli: serves the two READ subcommands apply-fee uses to resolve the
    # channel's LIVE time_lock_delta (listchannels -> chan_id, getchaninfo ->
    # policy), plus the updatechanpolicy apply. The subcommand is the first
    # non-flag argument (apply-fee prefixes --tlscertpath/--macaroonpath).
    cat > "${dir}/lncli" <<'LNCLI'
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
  listchannels)
    echo '{"channels":[{"channel_point":"aaaa1111:0","chan_id":"800000000000000001"},{"channel_point":"ffff6666:0","chan_id":"800000000000000006"}]}'
    ;;
  getchaninfo)
    echo '{"node1_pub":"02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","node1_policy":{"time_lock_delta":80},"node2_pub":"03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","node2_policy":{"time_lock_delta":80}}'
    ;;
  *)
    echo "policy updated"
    ;;
esac
LNCLI
  fi
  chmod +x "${dir}/lncli"
  echo "$dir"
}

# Run ONE check-queue tick (as nodemon_node) against the harness DB.
#   $1 = repo root, $2 = this-node pubkey, $3 = toolbox dir, [$4 = extra env DSN]
pg_harness_run_tick() {
  local repo_root="$1" pubkey="$2" toolbox="$3"
  PSQL="${toolbox}/psql-node" \
  NODEMON_NODE_DSN="$NODEMON_TEST_NODE_DSN" \
  NODEMON_NODE_PUBKEY="$pubkey" \
  NODEMON_HMAC_SECRET='nodemon-test-secret-do-not-use-in-prod' \
  NODEMON_LOCAL_DIR="$toolbox" \
  NODEMON_LOG_FILE="${toolbox}/check-queue.log" \
  LNCLI="${toolbox}/lncli" \
  APPLY_FEE="${repo_root}/scripts/node/apply-fee" \
  PATH="${toolbox}:$PATH" \
    "${repo_root}/scripts/node/check-queue"
}
