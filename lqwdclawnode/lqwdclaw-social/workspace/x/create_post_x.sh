#!/bin/bash
set -euo pipefail

XDIR="/opt/openclaw/workspace/x"
LOG="$XDIR/x_post.log"
REPLY_LOG="$XDIR/x_reply.log"
POSTER="$XDIR/post.py"
SECRETS_FILE="$XDIR/.x_secrets.env"

# Load X client credentials for token refresh
if [[ -f "$SECRETS_FILE" ]]; then
  set -a
  source "$SECRETS_FILE"
  set +a
fi

# Optional sanity check for refresh capability
if [[ -z "${X_CLIENT_ID:-}" || -z "${X_CLIENT_SECRET:-}" ]]; then
  echo "WARNING: X_CLIENT_ID or X_CLIENT_SECRET not set. Token refresh may fail." >&2
fi

if [[ ! -f "$POSTER" ]]; then
  echo "ERROR: missing $POSTER"
  exit 1
fi

# Refresh tokens if possible before posting
python3 - <<PY
import os
import sys

sys.path.insert(0, "$XDIR")

try:
    from x_client import load_tokens, refresh_tokens, normalize_tokens, needs_refresh
except Exception as e:
    print(f"WARNING: could not import x_client for refresh: {e}", file=sys.stderr)
    sys.exit(0)

try:
    tokens = load_tokens()
    tokens = normalize_tokens(tokens)
    if needs_refresh(tokens):
        refresh_tokens(tokens)
except Exception as e:
    print(f"WARNING: token refresh failed: {e}", file=sys.stderr)
PY

# Parse Arguments
REPLY_TO=""
FILE=""
TEXT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reply-to)
      REPLY_TO="$2"
      shift 2
      ;;
    --from-file)
      FILE="$2"
      shift 2
      ;;
    *)
      if [[ -n "$TEXT" ]]; then
        TEXT="$TEXT $1"
      else
        TEXT="$1"
      fi
      shift
      ;;
  esac
done

if [[ -n "$FILE" ]]; then
  if [[ ! -f "$FILE" ]]; then
    echo "Usage Error: file $FILE not found."
    exit 1
  fi
  TEXT="$(cat "$FILE")"
fi

if [[ -z "${TEXT}" ]]; then
  echo "Usage: $0 [--reply-to ID|URL] \"tweet text\""
  echo "   or: $0 [--reply-to ID|URL] --from-file /path/to/draft.txt"
  exit 1
fi

# Extract Tweet ID from URL if necessary
if [[ "$REPLY_TO" =~ status/([0-9]+) ]]; then
  REPLY_TO="${BASH_REMATCH[1]}"
elif [[ "$REPLY_TO" =~ ^[0-9]+$ ]]; then
  REPLY_TO="$REPLY_TO"
elif [[ -n "$REPLY_TO" ]]; then
  echo "ERROR: Invalid tweet ID or URL for --reply-to: $REPLY_TO"
  exit 1
fi

LEN="$(python3 - "$TEXT" <<'PY'
import sys
print(len(sys.argv[1]))
PY
)"

if [[ "$LEN" -gt 280 ]]; then
  echo "ERROR: Tweet is ${LEN} chars (>280). Shorten it."
  exit 1
fi

TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
CMD=(python3 "$POSTER")

if [[ -n "$REPLY_TO" ]]; then
  CMD+=("--reply-to" "$REPLY_TO")
  TARGET_LOG="$REPLY_LOG"
  echo "[$TS] REPLY_ATTEMPT reply_to=$REPLY_TO len=$LEN text=$(printf "%q" "$TEXT")" >> "$TARGET_LOG"
else
  TARGET_LOG="$LOG"
  echo "[$TS] POST_ATTEMPT len=$LEN text=$(printf "%q" "$TEXT")" >> "$TARGET_LOG"
fi

CMD+=("$TEXT")

OUT="$("${CMD[@]}" 2>&1)" || {
  echo "[$TS] FAIL $OUT" >> "$TARGET_LOG"
  echo "ACTION FAILED:"
  echo "$OUT"
  exit 1
}

echo "[$TS] SUCCESS $OUT" >> "$TARGET_LOG"
echo "$OUT"
