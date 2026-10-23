#!/bin/sh
# =====================================================
# zero-write-grep.sh — repeatable zero-write-path assertion (HARDEN-01 / T-18-27)
# =====================================================
# A repeatable, CI-wired version of the security review's "zero write path"
# assertion (CODE-REVIEW-2026-07-22, Verified-clean §3). The read/display and
# command-EXPORT surfaces are pure sinks: they render numbers and copy human-run
# command strings. They must NEVER be able to mutate the fleet — i.e. they must
# import NO write path:
#
#   • queue WRITE modules   — enqueue / claim / sign / canonical / withdraw /
#                             stub-executor / state (the intent lifecycle writers)
#   • queue write server-actions — @/app/actions/queue (enqueue/approve/withdraw)
#   • node crypto SIGNING   — createHmac / node:crypto (the command-signing path)
#
# EXPORT is held to a stricter bar (fully DB/queue/crypto-free, per the review):
# the copyable command artifact is built from an anchored allowlist only, never
# from a live DB read or a signed row.
#
# NOTE ON SCOPE: this battery targets the PURE read/display/export libraries
# (src/lib/read, src/lib/export). The interactive operator CONTROL affordances
# (src/components/queue/*, node/NodeFeeEnqueue, WithdrawAffordance, ...) are the
# DELIBERATE write surface — they import @/app/actions/queue on purpose and are
# out of scope by design. Pure validation schemas (@/lib/queue/bounds — a Zod
# schema) are NOT a write path and are intentionally not banned.
#
# Exit 0 = surfaces clean. Exit 1 = a write path leaked onto a display/export
# surface (fail the lint/CI gate). `.test.ts` files are excluded (they legitimately
# import the write modules under test).

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

READ_DIR="src/lib/read"
EXPORT_DIR="src/lib/export"

fail=0

# Portable grep over a surface, excluding *.test.ts. Emits matches to stdout.
# Returns 0 if a banned pattern was found (a FAILURE), 1 if clean.
scan() {
  # $1 = human label, $2 = extended-regex, $3.. = directories
  label="$1"
  pattern="$2"
  shift 2
  hits="$(grep -rnE "$pattern" "$@" --include="*.ts" 2>/dev/null | grep -vE '\.test\.ts:' || true)"
  if [ -n "$hits" ]; then
    echo "zero-write-grep FAIL: $label"
    echo "$hits" | sed 's/^/    /'
    fail=1
  fi
}

# 1. queue WRITE lifecycle modules must never be imported by read OR export.
scan "queue write module imported on a read/display/export surface" \
  'from "@/lib/queue/(enqueue|claim|sign|canonical|withdraw|stub-executor|state)"' \
  "$READ_DIR" "$EXPORT_DIR"

# 2. queue write server-actions must never be imported by read OR export.
scan "queue write server-action imported on a read/display/export surface" \
  'from "@/app/actions/queue"' \
  "$READ_DIR" "$EXPORT_DIR"

# 3. node crypto command-signing must never be imported by read OR export.
scan "node crypto signing imported on a read/display/export surface" \
  'createHmac|from "node:crypto"|from "crypto"|require\("crypto"\)' \
  "$READ_DIR" "$EXPORT_DIR"

# 4. EXPORT is held stricter: fully DB / queue / driver free (allowlist-only build).
scan "DB/queue/driver import on the command-EXPORT surface (must be allowlist-only)" \
  'from "@/lib/db|from "@/lib/queue|from "drizzle-orm"|from "postgres"' \
  "$EXPORT_DIR"

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "zero-write-grep: a write path reached a display/export surface — deploy gate BLOCKED."
  exit 1
fi

echo "zero-write-grep: read/display/export surfaces are write-path-free (zero-write-path re-affirmed)."
exit 0
