#!/bin/sh
# =====================================================
# df-faint-guard.sh — forbid `text-df-faint` on CONTENT text (U1)
# =====================================================
# `--color-df-faint` (#9AA3B4) is documented in globals.css as "DECORATIVE ONLY
# — fails 4.5:1 AND 3:1 as text". Using it to color meaning-bearing / honest-state
# / safety-critical text renders that text sub-contrast (the U1 legibility defect).
#
# This guard greps every src `.ts`/`.tsx` file for `text-df-faint` and FAILS the
# build on any hit that is NOT an explicitly-sanctioned decorative use. A genuinely
# decorative, non-content use (an aria-hidden icon glyph, a disclosure triangle, a
# hairline rule) may opt out by carrying the marker `df-faint-ok` on the SAME line.
#
# Exclusions (never content text):
#   - `*.test.ts` / `*.test.tsx`   — test assertions reference the class by name
#   - pure comment lines (`//` or `*`) — prose that documents the token
#   - any line carrying the `df-faint-ok` decorative-opt-out marker
#
# Mirrors the `lint:noc-guard` shape (grep rc: 0=hit/FAIL, 1=clean, >=2=error).

set -u

ROOT="src"
[ -d "$ROOT" ] || { echo "df-faint-guard: no src/ tree — skipping"; exit 0; }

# All `text-df-faint` hits, minus test files, comment-only lines, and opt-outs.
hits=$(grep -rnE "text-df-faint" "$ROOT" --include="*.ts" --include="*.tsx" \
  | grep -v "\.test\.tsx:" \
  | grep -v "\.test\.ts:" \
  | grep -vE ":[0-9]+:[[:space:]]*(//|\*|/\*)" \
  | grep -v "df-faint-ok")

if [ -n "$hits" ]; then
  echo "df-faint-guard FAIL: text-df-faint on content text (sub-contrast; use text-df-muted / text-df-ink / text-df-stale-text, or mark a decorative glyph with 'df-faint-ok'):"
  echo "$hits"
  exit 1
fi

echo "df-faint-guard: content text clean (no sub-contrast text-df-faint)"
exit 0
