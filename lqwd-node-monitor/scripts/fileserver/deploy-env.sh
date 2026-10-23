#!/bin/bash
#
# deploy-env.sh — provision ONE node's NodeMonitor telemetry environment.
#
# Run as root ON the node:   sudo ./deploy-env.sh
#
# Secrets come from a gitignored `deploy-env.secrets` file next to this script
# (hardcode them there once — see the block below), OR from the environment
# (use `sudo -E` to pass exported vars through). This file itself stays secret-free.
#   Required:
#     NODEMON_TELEMETRY_PW   nodemon_telemetry role password (same fleet-wide)
#     PG_PROBE_PW            nodemon_probe role password (same fleet-wide)
#     BITCOIND_RPCHOST       host:port of bitcoind JSON-RPC
#     BITCOIND_RPCUSER
#     BITCOIND_RPCPASS
#   Optional (fleet defaults):
#     NODEMON_DB     default 192.243.215.101:5432
#     LNCLI_BIN      default $(command -v lncli) else the fleet ABSOLUTE default
#                    /usr/local/bin/lncli (operator-confirmed 2026-07-16). A thin
#                    cron/root PATH lacks /usr/local/bin, so a bare `command -v lncli`
#                    resolves empty and the collector reports pubkey=none — pinning
#                    the absolute default restores node identity. Must be absolute.
#     NODEMON_CHANNEL default stable (per-node D-08 self-update pin; set to `canary`
#                    by hand on the ONE canary node per CANARY-RUNBOOK.md)
#     CREATE_PROBE_ROLE   default 1 (also create the local read-only nodemon_probe role)
#
# What it does (all idempotent):
#   1. Writes the lncli wrapper (readonly macaroon) to /lnd/bashScripts/lncli-telemetry.sh
#   2. Ensures the local nodemon_probe role exists (optional)
#   3. Appends/updates a MANAGED telemetry block in /lnd/nodemon/.nodemon.env
#      (0600 root:root) — preserving the existing EXEC-03 lines (HMAC secret + node DSN)
#
# It does NOT enable cron or force a tick — see the printed next step.

set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root (sudo $0)"; exit 1; }

# ── Hardcode-without-env-vars option ────────────────────────────────────────
# Don't want to export vars each run? Drop a `deploy-env.secrets` file next to
# this script with the values hardcoded, e.g.:
#     NODEMON_TELEMETRY_PW=...
#     PG_PROBE_PW=...
#     BITCOIND_RPCHOST=host:port
#     BITCOIND_RPCUSER=...
#     BITCOIND_RPCPASS=...
# It is sourced here and is GITIGNORED (never committed). Env vars still work too.
SECRETS_FILE="${SECRETS_FILE:-$(cd "$(dirname "$0")" && pwd)/deploy-env.secrets}"
if [ -f "$SECRETS_FILE" ]; then
  set -a; . "$SECRETS_FILE"; set +a
  echo "Loaded secrets from $SECRETS_FILE"
fi
# ────────────────────────────────────────────────────────────────────────────

: "${NODEMON_TELEMETRY_PW:?set NODEMON_TELEMETRY_PW}"
: "${BITCOIND_RPCHOST:?set BITCOIND_RPCHOST}"
: "${BITCOIND_RPCUSER:?set BITCOIND_RPCUSER}"
: "${BITCOIND_RPCPASS:?set BITCOIND_RPCPASS}"
: "${PG_PROBE_PW:?set PG_PROBE_PW}"
NODEMON_DB="${NODEMON_DB:-192.243.215.101:5432}"
# Absolute fleet default (operator-confirmed 2026-07-16): a thin cron/root PATH
# lacks /usr/local/bin, so `command -v lncli` resolves empty under */5 cron and the
# collector's resolve_node_pubkey() falls back to bare `lncli` -> pubkey=none ->
# node-scoped rows RLS-skipped. Pinning the absolute path fixes the identity loss.
LNCLI_BIN="${LNCLI_BIN:-$(command -v lncli || echo /usr/local/bin/lncli)}"
NODEMON_CHANNEL="${NODEMON_CHANNEL:-stable}"
CREATE_PROBE_ROLE="${CREATE_PROBE_ROLE:-1}"

# Guard: LNCLI_BIN must be a NON-EMPTY, ABSOLUTE path. A relative or empty value
# (heterogeneous outlier, thin PATH) fails loudly here rather than silently
# resolving to nothing and leaving pubkey=none on the node (T-16-09 / T-16-10).
[ -n "$LNCLI_BIN" ] || { echo "ERROR: LNCLI_BIN empty; export LNCLI_BIN=/full/path/to/lncli"; exit 1; }
case "$LNCLI_BIN" in
  /*) : ;;  # absolute — OK
  *)  echo "ERROR: LNCLI_BIN='$LNCLI_BIN' is not absolute; export LNCLI_BIN=/full/path/to/lncli"; exit 1 ;;
esac

mkdir -p /lnd/nodemon

# 1) lncli wrapper (root reads creds from /lnd) ------------------------------
cat > /lnd/bashScripts/lncli-telemetry.sh <<EOF
#!/bin/bash
exec "${LNCLI_BIN}" --lnddir /lnd --tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/readonly.macaroon "\$@"
EOF
chmod +x /lnd/bashScripts/lncli-telemetry.sh

# sanity: does the node_pubkey resolve as root? (else node-scoped rows get RLS-rejected)
PUBKEY="$(/lnd/bashScripts/lncli-telemetry.sh getinfo 2>/dev/null | grep -oE '[0-9a-f]{66}' | head -1 || true)"
if [ -n "$PUBKEY" ]; then
  echo "lncli OK as root (pubkey ${PUBKEY:0:12}…)"
else
  echo "WARN: lncli getinfo returned no pubkey as root — node-scoped service rows will be RLS-rejected until this resolves."
fi

# 2) local read-only probe role (best-effort) --------------------------------
if [ "$CREATE_PROBE_ROLE" = "1" ]; then
  if command -v psql >/dev/null 2>&1; then
    if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='nodemon_probe'" 2>/dev/null | grep -q 1; then
      echo "nodemon_probe role already exists"
    else
      # WR-04 (16-REVIEW): do NOT pass the probe password on the psql command line —
      # `-c "... PASSWORD '${PG_PROBE_PW}'"` leaks the fleet-wide secret to any local
      # user running `ps aux` and lets a single-quote in the value break/inject SQL.
      # Instead feed the DDL over stdin via a here-doc (never in argv) and double any
      # single-quotes for a safe SQL string literal.
      pg_probe_pw_esc=${PG_PROBE_PW//\'/\'\'}
      if sudo -u postgres psql -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
CREATE ROLE nodemon_probe WITH LOGIN PASSWORD '${pg_probe_pw_esc}';
SQL
      then
        echo "created nodemon_probe role"
      else
        echo "WARN: could not create nodemon_probe (no local PG / no access?) — pg probe will read no-data"
      fi
    fi
    sudo -u postgres psql -c "GRANT CONNECT ON DATABASE postgres TO nodemon_probe;" >/dev/null 2>&1 || true
  else
    echo "WARN: psql not found locally — skipping nodemon_probe role"
  fi
fi

# 3) managed telemetry block in the root-only env (preserve existing lines) ---
ENV_FILE=/lnd/nodemon/.nodemon.env
touch "$ENV_FILE"
chown root:root "$ENV_FILE"
chmod 600 "$ENV_FILE"

# strip any prior managed block, then append a fresh one (idempotent re-runs)
sed -i '/# >>> nodemon telemetry (managed) >>>/,/# <<< nodemon telemetry (managed) <<</d' "$ENV_FILE"

cat >> "$ENV_FILE" <<EOF
# >>> nodemon telemetry (managed) >>>
# Managed by deploy-env.sh — edit secrets via env vars + re-run, not here.
NODEMON_TELEMETRY_DSN=postgres://nodemon_telemetry:${NODEMON_TELEMETRY_PW}@${NODEMON_DB}/nodemon
PG_PROBE_CONNINFO=postgresql://nodemon_probe:${PG_PROBE_PW}@127.0.0.1:5432/postgres
BITCOIND_RPCHOST=${BITCOIND_RPCHOST}
BITCOIND_RPCUSER=${BITCOIND_RPCUSER}
BITCOIND_RPCPASS=${BITCOIND_RPCPASS}
LNCLI=/lnd/bashScripts/lncli-telemetry.sh
# D-08 self-update channel pin (default stable). Set to `canary` by hand on the ONE
# canary node so run_collect-telemetry.sh pulls only that channel's pinned version —
# fleet promotion is a single fileserver pointer flip. See CANARY-RUNBOOK.md Phase-16.
NODEMON_CHANNEL=${NODEMON_CHANNEL}
# <<< nodemon telemetry (managed) <<<
EOF
chmod 600 "$ENV_FILE"

echo "Provisioned $(hostname): telemetry block written to ${ENV_FILE} (0600 root), lncli wrapper ready."
echo "Next: sudo /lnd/bashScripts/run_collect-telemetry.sh && tail -n 20 /lnd/nodemon/collect-telemetry.log"
echo "      (the */5 CRON_JOB_12 must run as root to read this 0600 env)"
