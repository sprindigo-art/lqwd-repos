#!/usr/bin/env bash
set -euo pipefail

# verify-l402.sh — End-to-end L402 mock-mode verification
# Starts a temporary mock gateway on a separate port, exercises the full
# 402 challenge -> pay -> retry flow, and reports pass/fail.
#
# Safe to run while production gateway is running on :7778.
# Requires: jq, curl, lnd-gateway binary at /usr/local/bin/lnd-gateway
#
# Usage: ./verify-l402.sh [binary-path]
#   binary-path  Path to lnd-gateway binary (default: /usr/local/bin/lnd-gateway)

BINARY="${1:-/usr/local/bin/lnd-gateway}"
MOCK_PORT=7779
MOCK_ADDR="127.0.0.1:$MOCK_PORT"
MOCK_PID=""
TMPDIR=$(mktemp -d -t verify-l402.XXXXXX)
PASS=0
FAIL=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

pass() {
    PASS=$((PASS + 1))
    log "  PASS: $*"
}

fail() {
    FAIL=$((FAIL + 1))
    log "  FAIL: $*"
}

cleanup() {
    if [ -n "$MOCK_PID" ] && kill -0 "$MOCK_PID" 2>/dev/null; then
        log "Stopping mock gateway (PID: $MOCK_PID)..."
        kill "$MOCK_PID" 2>/dev/null || true
        wait "$MOCK_PID" 2>/dev/null || true
    fi
    if [ -d "$TMPDIR" ]; then
        rm -rf "$TMPDIR"
    fi
}

trap cleanup EXIT

# ─── Dependency checks ──────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
    log "jq not found. Install with: apt install -y jq"
    exit 1
fi

if ! command -v curl &>/dev/null; then
    log "curl not found. Install with: apt install -y curl"
    exit 1
fi

if [ ! -f "$BINARY" ]; then
    log "Binary not found at $BINARY"
    log "Usage: $0 [path-to-lnd-gateway-binary]"
    exit 1
fi

# ─── Start mock gateway on separate port ─────────────────────────────

log "Starting mock gateway on $MOCK_ADDR..."

GATEWAY_MOCK=true \
GATEWAY_LISTEN="$MOCK_ADDR" \
GATEWAY_AGENT_TOKEN="test-agent-token" \
GATEWAY_ADMIN_TOKEN="test-admin-token" \
L402_ENABLED=true \
GATEWAY_DATA_DIR="$TMPDIR" \
AUDIT_DB_PATH="$TMPDIR/audit.db" \
AUDIT_FALLBACK_PATH="$TMPDIR/audit-fallback.jsonl" \
L402_DB_PATH="$TMPDIR/l402.db" \
KILL_SWITCH_PATH="$TMPDIR/kill-switch" \
"$BINARY" &
MOCK_PID=$!

# Wait for health
for i in $(seq 1 10); do
    if curl -sf "http://$MOCK_ADDR/v1/health" -o /dev/null 2>/dev/null; then
        break
    fi
    if [ "$i" -eq 10 ]; then
        fail "Mock gateway failed to start within 5 seconds"
        exit 1
    fi
    sleep 0.5
done
log "Mock gateway running on $MOCK_ADDR (PID: $MOCK_PID)"

# ─── Test 1: 402 Challenge ──────────────────────────────────────────

log "Test 1: GET /v1/l402/node-stats without auth -> expect 402"
RESPONSE=$(curl -s -w "\n%{http_code}" "http://$MOCK_ADDR/v1/l402/node-stats")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "402" ]; then
    pass "Received 402 Payment Required"
else
    fail "Expected 402, got $HTTP_CODE"
fi

# ─── Test 2: Parse macaroon and preimage ─────────────────────────────

log "Test 2: Parse macaroon and preimage from 402 response"
MACAROON=$(echo "$BODY" | jq -r '.data.macaroon // empty')
PREIMAGE=$(echo "$BODY" | jq -r '.data.preimage // empty')

if [ -n "$MACAROON" ] && [ -n "$PREIMAGE" ]; then
    pass "Extracted macaroon (${#MACAROON} chars) and preimage (${#PREIMAGE} chars)"
else
    fail "Failed to extract macaroon or preimage from response body"
    echo "Body: $BODY"
fi

# ─── Test 3: Retry with L402 header -> 200 ──────────────────────────

log "Test 3: GET /v1/l402/node-stats with L402 header -> expect 200"
L402_HEADER="L402 ${MACAROON}:${PREIMAGE}"
RETRY_RESPONSE=$(curl -s -w "\n%{http_code}" -H "Authorization: $L402_HEADER" "http://$MOCK_ADDR/v1/l402/node-stats")
RETRY_CODE=$(echo "$RETRY_RESPONSE" | tail -1)
RETRY_BODY=$(echo "$RETRY_RESPONSE" | sed '$d')

if [ "$RETRY_CODE" = "200" ]; then
    pass "Received 200 OK with L402 token"
else
    fail "Expected 200, got $RETRY_CODE"
    echo "Body: $RETRY_BODY"
fi

# ─── Test 4: Verify response data ───────────────────────────────────

log "Test 4: Verify response contains node stats data"
HAS_OK=$(echo "$RETRY_BODY" | jq -r '.ok // empty')
if [ "$HAS_OK" = "true" ]; then
    pass "Response .ok is true"
else
    fail "Response .ok is not true"
fi

# ─── Test 5: Token replay rejected ──────────────────────────────────

log "Test 5: Replay same L402 token -> expect rejection (single-use)"
REPLAY_RESPONSE=$(curl -s -w "\n%{http_code}" -H "Authorization: $L402_HEADER" "http://$MOCK_ADDR/v1/l402/node-stats")
REPLAY_CODE=$(echo "$REPLAY_RESPONSE" | tail -1)

if [ "$REPLAY_CODE" = "402" ] || [ "$REPLAY_CODE" = "401" ]; then
    pass "Token replay rejected with $REPLAY_CODE (single-use enforced)"
else
    fail "Expected 401 or 402 for replay, got $REPLAY_CODE"
fi

# ─── Summary ─────────────────────────────────────────────────────────

log "=========================================="
log "Results: $PASS passed, $FAIL failed"
log "=========================================="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
log "L402 end-to-end verification PASSED"
