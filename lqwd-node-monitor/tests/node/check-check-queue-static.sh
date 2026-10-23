#!/bin/bash
#
# check-check-queue-static.sh — static (no-DB) gate for scripts/node/check-queue
# ==============================================================================
# Phase 8 Plan 02 Task 3. The per-task autonomous static verify. Runs `bash -n`
# plus a grep battery asserting the check-queue structural invariants (the port
# of claim.ts + stub-executor.ts) and the ABSENCE of injection/eval. Exits
# non-zero on any failure.
#
# SHAPE only. Behavior (the 5 failure modes + overlapping-ticks + wrong-pubkey
# RLS invisibility) is proven by the seeded bats suite (check-queue.bats) against
# a disposable local Postgres — "static passes" is NOT "5 failure modes proven".
#
# Usage: bash tests/node/check-check-queue-static.sh

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CQ="$(cd "${SCRIPT_DIR}/../../scripts/node" 2>/dev/null && pwd)/check-queue"

FAILURES=0
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { echo "PASS: $*"; }

if [ ! -f "$CQ" ]; then
  echo "FAIL: scripts/node/check-queue not present" >&2
  exit 1
fi

NONCOMMENT="$(grep -v '^[[:space:]]*#' "$CQ")"

require() { # <regex> <desc>  (anywhere — SQL/comments both count for structure)
  if grep -Eq -- "$1" "$CQ"; then pass "$2"; else fail "MISSING: $2 [/$1/]"; fi
}
forbid_nc() { # <regex> <desc>  (non-comment only)
  if printf '%s\n' "$NONCOMMENT" | grep -Eq -- "$1"; then fail "FORBIDDEN (non-comment): $2 [/$1/]"; else pass "no $2"; fi
}

# bash -n
if bash -n "$CQ" 2>/dev/null; then pass "bash -n OK"; else fail "bash -n syntax error"; bash -n "$CQ"; fi

# At least 80 lines.
LINES="$(wc -l < "$CQ" | tr -d '[:space:]')"
if [ "$LINES" -ge 80 ]; then pass "at least 80 lines ($LINES)"; else fail "only $LINES lines (<80)"; fi

# RLS scope (Pitfall 2: SET LOCAL, not SET) + atomic claim primitive.
require 'SET LOCAL app\.node_pubkey' 'SET LOCAL app.node_pubkey (Pitfall 2)'
require 'FOR UPDATE SKIP LOCKED' 'FOR UPDATE SKIP LOCKED (atomic claim)'

# expireSweep — ttl_expired on pre-exec rows.
require "state IN \('pending_approval','approved','claimed'\)|expires_at < now\(\)" 'expireSweep predicate'
require 'ttl_expired' 'ttl_expired audit reason'

# reaperSweep — 15 minute window, releases ONLY claimed.
require "interval '15 minutes'" 'reaper 15-minute window (D-09)'
require 'reaper_released_stale_claim' 'reaper audit reason'

# Rate-limit gate (D-10) over command_executions in the rolling hour.
require "command_executions" 'command_executions reference'
require "interval '1 hour'" 'rate-limit rolling hour'
require 'rate_limited' 'rate_limited log token'

# State chain writes (stub-executor.ts): audit + executions, executing flips.
require 'command_audit' 'command_audit writes'
require "state='executing'|state = 'executing'" 'claimed->executing flip'

# Invokes apply-fee between the executing commits.
require 'apply-fee' 'invokes apply-fee'

# No SQL value string-concatenation / no eval/sh -c with interpolated params.
forbid_nc 'eval ' 'eval'
forbid_nc 'sh -c' 'sh -c'
# psql variable binding (:'var' / --set / -v) rather than concatenation.
require ":'pubkey'|--set |psql .* -v |:'id'|:id" 'psql variable binding (not string-concat)'

echo "----------------------------------------"
if [ "$FAILURES" -eq 0 ]; then echo "check-queue static: all checks passed."; exit 0; else echo "$FAILURES check(s) failed."; exit 1; fi
