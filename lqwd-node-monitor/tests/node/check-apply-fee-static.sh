#!/bin/bash
#
# check-apply-fee-static.sh — static (no-DB, no-lncli) gate for scripts/node/apply-fee
# ====================================================================================
# Phase 8 Plan 02 Task 2. The per-task automated verify. Runs `bash -n` plus a
# grep battery asserting the apply-fee structural invariants and the ABSENCE of
# forbidden tokens. Exits non-zero on any failure.
#
# What it proves (SHAPE only — behavior is proven by the seeded bats suite):
#   * bash -n parses
#   * the LIVE HMAC verify pipeline `printf %s ... | openssl dgst -sha256 -hmac ... -r`
#     exists on a NON-COMMENT line (not a bare `openssl dgst` a comment could satisfy)
#   * --fee_rate_ppm is used; a bare `--fee_rate ` flag is ABSENT (Pitfall 7)
#   * no `eval ` and no `sh -c` on non-comment lines (argv-only, EXEC-02)
#   * an [ASSUMED] inbound-fee marker is present (lnd#8614 / A2)
#   * fail-closed reasons hmac_mismatch and bounds_violation are present
#   * the frozen bounds 0..5000 / 0..100000 / 18..2016 appear
#
# Usage: bash tests/node/check-apply-fee-static.sh

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY="$(cd "${SCRIPT_DIR}/../../scripts/node" 2>/dev/null && pwd)/apply-fee"

FAILURES=0
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { echo "PASS: $*"; }

if [ ! -f "$APPLY" ]; then
  echo "FAIL: scripts/node/apply-fee not present" >&2
  exit 1
fi

# Non-comment view of the file (strip full-line comments + indentation-leading #).
NONCOMMENT="$(grep -v '^[[:space:]]*#' "$APPLY")"

require_nc() { # <regex> <desc>
  if printf '%s\n' "$NONCOMMENT" | grep -Eq -- "$1"; then pass "$2"; else fail "MISSING (non-comment): $2 [/$1/]"; fi
}
forbid_nc() { # <regex> <desc>
  if printf '%s\n' "$NONCOMMENT" | grep -Eq -- "$1"; then fail "FORBIDDEN (non-comment): $2 [/$1/]"; else pass "no $2"; fi
}
require_any() { # <regex> <desc>  (anywhere, incl. comments — for [ASSUMED] markers)
  if grep -Eq -- "$1" "$APPLY"; then pass "$2"; else fail "MISSING: $2 [/$1/]"; fi
}

# bash -n
if bash -n "$APPLY" 2>/dev/null; then pass "bash -n OK"; else fail "bash -n syntax error"; bash -n "$APPLY"; fi

# LIVE verify pipeline SHAPE on a single non-comment line (Pitfall 1 + Pitfall 4).
require_nc 'printf %s .*\| *openssl dgst -sha256 -hmac' 'live HMAC verify pipeline (printf %s | openssl dgst -sha256 -hmac)'
require_nc 'openssl dgst -sha256 -hmac .* -r' 'openssl -r raw-hex output (Pitfall 4)'

# --fee_rate_ppm ONLY; bare --fee_rate ABSENT (Pitfall 7).
require_nc '[-][-]fee_rate_ppm' 'uses --fee_rate_ppm'
forbid_nc '[-][-]fee_rate ' 'bare --fee_rate flag (Pitfall 7)'

# argv-only (EXEC-02): no eval / no sh -c on non-comment lines.
forbid_nc 'eval ' 'eval'
forbid_nc 'sh -c' 'sh -c'

# lncli updatechanpolicy via argv.
require_nc 'lncli' 'invokes lncli'
require_nc 'updatechanpolicy' 'lncli updatechanpolicy'

# Fail-closed reasons.
require_any 'hmac_mismatch' 'hmac_mismatch fail-closed reason'
require_any 'bounds_violation' 'bounds_violation fail-closed reason'

# Applied values are bound to the SIGNED canonical_payload, never the mutable
# `params` column (Q1). The signed params substring is line 4 of the payload.
require_nc 'SIGNED_PARAMS' 'binds applied values to the signed payload (SIGNED_PARAMS)'
require_nc "sed -n '4p'" 'extracts signed params from canonical_payload line 4'
require_any 'pubkey_mismatch' 'fail-closed on node pubkey != signed nodePubkey'

# time_lock_delta is read LIVE from the node, never the fabricated placeholder (I1).
require_nc 'getchaninfo' 'reads the live channel policy (getchaninfo)'
require_any 'time_lock_delta_unresolved' 'fail-closed when live time_lock_delta cannot be resolved'

# Frozen bounds (3rd of 3 enforcement points).
require_nc '5000' 'ppm ceiling 5000'
require_nc '100000' 'base_fee_msat ceiling 100000'
require_nc '2016' 'time_lock_delta ceiling 2016'
require_nc '18' 'time_lock_delta floor 18'

# [ASSUMED] inbound-fee passthrough marker (lnd#8614 / A2).
require_any '\[ASSUMED\].*inbound' '[ASSUMED] inbound-fee passthrough marker (A2)'

# No secret/macaroon/signature ever echoed (defensive grep — log lines only print reason/state).
forbid_nc 'echo .*NODEMON_HMAC_SECRET' 'secret echoed'

echo "----------------------------------------"
if [ "$FAILURES" -eq 0 ]; then echo "apply-fee static: all checks passed."; exit 0; else echo "$FAILURES check(s) failed."; exit 1; fi
