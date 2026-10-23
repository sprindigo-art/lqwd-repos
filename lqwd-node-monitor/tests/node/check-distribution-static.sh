#!/bin/bash
#
# check-distribution-static.sh — static (no-network, no-DB) gate for the
# EXEC-01 fileserver distribution scripts.
#
# Shared by Plan 08-03 Tasks 1/2/3. For each PRESENT fileserver script it runs
# `bash -n` plus a grep battery asserting the structural invariants and the
# absence of forbidden tokens (secrets, package installs). Files not yet created
# are skipped (test -f guarded) so the helper is runnable mid-plan.
#
# Usage:
#   check-distribution-static.sh                  # check all three scripts
#   check-distribution-static.sh nodemonDownload  # check one
#   check-distribution-static.sh run_check-queue
#   check-distribution-static.sh updateCrontab
#
# Exit code: non-zero if any PRESENT, requested file fails a check.

set -u

# Resolve the repo's fileserver dir relative to this script (tests/node/..).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FS_DIR="$(cd "${SCRIPT_DIR}/../../scripts/fileserver" 2>/dev/null && pwd)"

DOWNLOAD="${FS_DIR}/nodemonDownload.sh"
RUNNER="${FS_DIR}/run_check-queue.sh"
SNIPPET="${FS_DIR}/updateCrontab.snippet.sh"

FAILURES=0

fail() {
    echo "FAIL: $*" >&2
    FAILURES=$((FAILURES + 1))
}

pass() {
    echo "PASS: $*"
}

# require_grep <file> <pattern> <human-description>  (pattern is a grep -E regex)
require_grep() {
    local file="$1" pattern="$2" desc="$3"
    if grep -Eq -- "$pattern" "$file"; then
        pass "$(basename "$file"): contains ${desc}"
    else
        fail "$(basename "$file"): MISSING ${desc} (pattern: ${pattern})"
    fi
}

# forbid_grep <file> <pattern> <human-description>
forbid_grep() {
    local file="$1" pattern="$2" desc="$3"
    if grep -Eq -- "$pattern" "$file"; then
        fail "$(basename "$file"): FORBIDDEN ${desc} present (pattern: ${pattern})"
    else
        pass "$(basename "$file"): no ${desc}"
    fi
}

check_syntax() {
    local file="$1"
    if bash -n "$file" 2>/dev/null; then
        pass "$(basename "$file"): bash -n OK"
    else
        fail "$(basename "$file"): bash -n syntax error"
        bash -n "$file"
    fi
}

check_nodemonDownload() {
    [ -f "$DOWNLOAD" ] || { echo "SKIP: nodemonDownload.sh not present yet"; return 0; }
    check_syntax "$DOWNLOAD"
    require_grep "$DOWNLOAD" 'REMOTE_DIR=.*nodemon' 'REMOTE_DIR -> ~/nodemon'
    require_grep "$DOWNLOAD" 'LOCAL_DIR=.*/lnd/nodemon' 'LOCAL_DIR -> /lnd/nodemon'
    require_grep "$DOWNLOAD" 'scp -r' 'scp -r recursive pull'
    require_grep "$DOWNLOAD" 'id_rsa' 'id_rsa key auth'
    require_grep "$DOWNLOAD" 'REMOTE_PORT' 'REMOTE_PORT (fleet rail)'
    require_grep "$DOWNLOAD" 'chmod \+x|chmod \+x|-name "\*\.sh".*chmod' 'chmod +x of executors'
    require_grep "$DOWNLOAD" 'chmod' 'chmod for executor scripts'
    # D-03: no secret tokens in the distribution channel.
    forbid_grep "$DOWNLOAD" 'NODEMON_HMAC_SECRET|\.nodemon\.env|HMAC_SECRET' 'HMAC secret / .nodemon.env reference (D-03)'
}

check_run_check_queue() {
    [ -f "$RUNNER" ] || { echo "SKIP: run_check-queue.sh not present yet"; return 0; }
    check_syntax "$RUNNER"
    require_grep "$RUNNER" 'md5sum' 'md5 self-update compare'
    require_grep "$RUNNER" 'old-scripts' 'old-scripts/ backup dir'
    require_grep "$RUNNER" 'check-queue' 'invokes check-queue'
    require_grep "$RUNNER" 'apply-fee' 'self-updates apply-fee'
    # Pure bash: no Python/package install.
    forbid_grep "$RUNNER" 'psycopg2|pip install|python3 -m venv|python -m venv' 'package install / venv (must be pure bash)'
    # D-03: no secret tokens.
    forbid_grep "$RUNNER" 'NODEMON_HMAC_SECRET|\.nodemon\.env' 'HMAC secret reference (D-03)'
}

check_updateCrontab() {
    [ -f "$SNIPPET" ] || { echo "SKIP: updateCrontab.snippet.sh not present yet"; return 0; }
    check_syntax "$SNIPPET"
    require_grep "$SNIPPET" 'CRON_JOB_11' 'CRON_JOB_11 constant'
    require_grep "$SNIPPET" 'run_check-queue\.sh' 'invokes run_check-queue.sh'
    require_grep "$SNIPPET" 'grep -Fxq' 'idempotent grep -Fxq merge'
    require_grep "$SNIPPET" '\*/5 \* \* \* \*' '*/5 heartbeat cadence'
}

TARGET="${1:-all}"
case "$TARGET" in
    nodemonDownload)  check_nodemonDownload ;;
    run_check-queue)  check_run_check_queue ;;
    updateCrontab)    check_updateCrontab ;;
    all)
        check_nodemonDownload
        check_run_check_queue
        check_updateCrontab
        ;;
    *)
        echo "Unknown target: ${TARGET}" >&2
        echo "Usage: $0 [nodemonDownload|run_check-queue|updateCrontab]" >&2
        exit 2
        ;;
esac

echo "----------------------------------------"
if [ "$FAILURES" -eq 0 ]; then
    echo "All static checks passed."
    exit 0
else
    echo "${FAILURES} check(s) failed."
    exit 1
fi
