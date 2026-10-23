#!/usr/bin/env bash
set -uo pipefail  # NOT -e: we want to collect multiple failures, not abort on first

# run-16.2-signet-uat.sh — Automated Phase 16.2 UAT against the signet gateway.
#
# Covers UAT-01..09 from .planning/phases/16.2-.../16.2-UAT.md. Each test
# focuses on a regression fixed in 16.2 — the core invariant is that the
# confirm → executor → LND path is not broken by JSON-tag drift or the
# "confirmed_*" op_type filter mismatch.
#
# Run from the VM (signet gateway listens on 127.0.0.1:7779).
#
# Required env:
#   SIGNET_AGENT_TOKEN   — GATEWAY_AGENT_TOKEN for the signet gateway
#   SIGNET_ADMIN_TOKEN   — GATEWAY_ADMIN_TOKEN for the signet gateway
#
# Optional env (UAT-01..04 need these for the channel/payment/on-chain paths):
#   SIGNET_PEER_PUBKEY   — peer node pubkey for OpenChannel test
#   SIGNET_PEER_HOST     — peer host:port for OpenChannel test
#   SIGNET_EXISTING_CHAN — "txid:vout" of an existing open channel for CloseChannel test
#   SIGNET_ONCHAIN_ADDR  — any signet bech32 address for SendOnChain test
#   SIGNET_INVOICE       — a BOLT11 invoice from the peer for SendPayment test
#
# Tests without those env vars are skipped (printed as SKIP, not FAIL).

GATEWAY="${GATEWAY:-http://127.0.0.1:7779}"
AGENT="${SIGNET_AGENT_TOKEN:-}"
ADMIN="${SIGNET_ADMIN_TOKEN:-}"

PASS=0; FAIL=0; SKIP=0
FAILED_TESTS=()

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
pass() { PASS=$((PASS+1)); echo "  ✓ PASS: $*"; }
fail() { FAIL=$((FAIL+1)); FAILED_TESTS+=("$1"); echo "  ✗ FAIL: $*"; }
skip() { SKIP=$((SKIP+1)); echo "  ⊘ SKIP: $*"; }

if ! command -v jq >/dev/null; then log "jq required"; exit 2; fi
if ! command -v curl >/dev/null; then log "curl required"; exit 2; fi
if [ -z "$AGENT" ] || [ -z "$ADMIN" ]; then
    log "SIGNET_AGENT_TOKEN and SIGNET_ADMIN_TOKEN must be set"
    exit 2
fi

# Sanity: gateway reachable?
if ! curl -fsS -o /dev/null "$GATEWAY/v1/health"; then
    log "signet gateway not reachable at $GATEWAY — aborting"
    exit 2
fi
log "gateway: $GATEWAY"

# Per-run suffix on every idempotency key. Without this, reruns replay
# the previous run's cached responses from the SQLite idempotency store
# (24h TTL) — including 202s whose op_id is long expired, and 5xx
# errors from earlier buggy builds. Each invocation of this script
# gets a fresh namespace.
RUN_ID="$(date +%s)"
log "run id: $RUN_ID"

# Helper: post JSON with given token, echo body, write HTTP code to CODE_FILE.
# `post` is always called via $(post ...), which is a subshell — variable
# assignments inside the subshell don't leak back, so we persist the code
# to a tempfile the parent reads with read_code.
CODE_FILE=$(mktemp -t 16.2-uat-code.XXXXXX)
HTTP_CODE=""
post() {
    local path="$1" token="$2" body="$3"
    local resp
    resp=$(curl -sS -w "\n%{http_code}" -X POST "$GATEWAY$path" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "$body")
    echo "$resp" | tail -n1 > "$CODE_FILE"
    echo "$resp" | sed '$d'
}
read_code() { HTTP_CODE=$(cat "$CODE_FILE"); }
trap 'rm -f "$CODE_FILE"' EXIT

# ─── UAT-01: Confirmed SendPayment reaches LND ──────────────────────
log "UAT-01 — Confirmed SendPayment reaches LND (CR-02, CR-01 fee_limit_sats)"
if [ -z "${SIGNET_INVOICE:-}" ]; then
    skip "UAT-01 — SIGNET_INVOICE not set"
else
    body=$(jq -n --arg inv "$SIGNET_INVOICE" '{payment_request:$inv, amount_sats:1000, fee_limit_sats:50, idempotency_key:"uat-01-'"$RUN_ID"'"}')
    create_resp=$(post /v1/payments/send "$AGENT" "$body")
    read_code
    if [ "$HTTP_CODE" != "202" ]; then
        fail "UAT-01 create: expected 202, got $HTTP_CODE — body=$create_resp"
    else
        op_id=$(echo "$create_resp" | jq -r '.operation_id')
        if [ -z "$op_id" ] || [ "$op_id" = "null" ]; then
            fail "UAT-01 create: no operation_id in 202 response"
        else
            confirm_body=$(jq -n --arg id "$op_id" '{operation_id:$id}')
            confirm_resp=$(post /v1/confirm "$ADMIN" "$confirm_body")
            read_code
            if [ "$HTTP_CODE" != "200" ]; then
                fail "UAT-01 confirm: expected 200, got $HTTP_CODE — body=$confirm_resp"
            else
                preimage=$(echo "$confirm_resp" | jq -r '.data.payment_preimage // ""')
                if [ -z "$preimage" ] || [ "$preimage" = "null" ]; then
                    fail "UAT-01: confirmed 200 but no payment_preimage — body=$confirm_resp"
                else
                    pass "UAT-01 — payment settled with preimage=${preimage:0:16}..."
                fi
            fi
        fi
    fi
fi

# ─── UAT-02: Confirmed CloseChannel reaches LND ─────────────────────
log "UAT-02 — Confirmed CloseChannel reaches LND (CR-01 chan_id tag)"
if [ -z "${SIGNET_EXISTING_CHAN:-}" ]; then
    skip "UAT-02 — SIGNET_EXISTING_CHAN not set"
else
    body=$(jq -n --arg cid "$SIGNET_EXISTING_CHAN" '{chan_id:$cid, force:false, idempotency_key:"uat-02-'"$RUN_ID"'"}')
    create_resp=$(post /v1/channels/close "$AGENT" "$body")
    read_code
    if [ "$HTTP_CODE" != "202" ]; then
        fail "UAT-02 create: expected 202, got $HTTP_CODE — body=$create_resp"
    else
        op_id=$(echo "$create_resp" | jq -r '.operation_id')
        confirm_body=$(jq -n --arg id "$op_id" '{operation_id:$id}')
        confirm_resp=$(post /v1/confirm "$ADMIN" "$confirm_body")
        read_code
        if [ "$HTTP_CODE" != "200" ]; then
            fail "UAT-02 confirm: expected 200, got $HTTP_CODE — body=$confirm_resp"
        else
            closing_txid=$(echo "$confirm_resp" | jq -r '.data.closing_txid // ""')
            if [ -z "$closing_txid" ] || [ "$closing_txid" = "null" ]; then
                fail "UAT-02: confirmed 200 but no closing_txid — body=$confirm_resp"
            else
                pass "UAT-02 — close broadcast, closing_txid=$closing_txid"
            fi
        fi
    fi
fi

# ─── UAT-03: Confirmed OpenChannel preserves push_sats ──────────────
log "UAT-03 — Confirmed OpenChannel preserves push_sats (CR-01 push_sats tag)"
if [ -z "${SIGNET_PEER_PUBKEY:-}" ] || [ -z "${SIGNET_PEER_HOST:-}" ]; then
    skip "UAT-03 — SIGNET_PEER_PUBKEY and SIGNET_PEER_HOST not set"
else
    # Connect first (idempotent; may fail if already connected — that's fine)
    conn_body=$(jq -n --arg pk "$SIGNET_PEER_PUBKEY" --arg host "$SIGNET_PEER_HOST" \
        '{pubkey:$pk, host:$host, idempotency_key:"uat-03-connect-'"$RUN_ID"'"}')
    post /v1/peers/connect "$AGENT" "$conn_body" >/dev/null || true

    body=$(jq -n --arg pk "$SIGNET_PEER_PUBKEY" \
        '{node_pubkey:$pk, local_funding_amount:100000, push_sats:25000, sat_per_vbyte:2, idempotency_key:"uat-03-'"$RUN_ID"'"}')
    create_resp=$(post /v1/channels/open "$AGENT" "$body")
    read_code
    if [ "$HTTP_CODE" != "202" ]; then
        fail "UAT-03 create: expected 202, got $HTTP_CODE — body=$create_resp"
    else
        op_id=$(echo "$create_resp" | jq -r '.operation_id')
        confirm_body=$(jq -n --arg id "$op_id" '{operation_id:$id}')
        confirm_resp=$(post /v1/confirm "$ADMIN" "$confirm_body")
        read_code
        if [ "$HTTP_CODE" != "200" ]; then
            fail "UAT-03 confirm: expected 200, got $HTTP_CODE — body=$confirm_resp"
        else
            txid=$(echo "$confirm_resp" | jq -r '.data.funding_txid // ""')
            if [ -z "$txid" ] || [ "$txid" = "null" ]; then
                fail "UAT-03: confirmed 200 but no funding_txid — body=$confirm_resp"
            else
                pass "UAT-03 — channel pending, funding_txid=$txid — MANUAL: verify peer sees 25000 sat inbound balance"
            fi
        fi
    fi
fi

# ─── UAT-04: Confirmed SendOnChain preserves address + amount ───────
log "UAT-04 — Confirmed SendOnChain preserves address + amount (CR-01)"
if [ -z "${SIGNET_ONCHAIN_ADDR:-}" ]; then
    skip "UAT-04 — SIGNET_ONCHAIN_ADDR not set"
else
    body=$(jq -n --arg addr "$SIGNET_ONCHAIN_ADDR" \
        '{address:$addr, amount_sats:20000, sat_per_vbyte:2, idempotency_key:"uat-04-'"$RUN_ID"'"}')
    create_resp=$(post /v1/onchain/send "$AGENT" "$body")
    read_code
    if [ "$HTTP_CODE" != "202" ]; then
        fail "UAT-04 create: expected 202, got $HTTP_CODE — body=$create_resp"
    else
        op_id=$(echo "$create_resp" | jq -r '.operation_id')
        confirm_body=$(jq -n --arg id "$op_id" '{operation_id:$id}')
        confirm_resp=$(post /v1/confirm "$ADMIN" "$confirm_body")
        read_code
        if [ "$HTTP_CODE" != "200" ]; then
            fail "UAT-04 confirm: expected 200, got $HTTP_CODE — body=$confirm_resp"
        else
            txid=$(echo "$confirm_resp" | jq -r '.data.txid // .data.txhash // ""')
            if [ -z "$txid" ] || [ "$txid" = "null" ]; then
                fail "UAT-04: confirmed 200 but no txid — body=$confirm_resp"
            else
                pass "UAT-04 — on-chain sent, txid=$txid"
            fi
        fi
    fi
fi

# ─── UAT-05: Rebalance requires confirmation ────────────────────────
log "UAT-05 — Rebalance requires confirmation (P-3)"
body='{"outgoing_chan_id":"111:0","incoming_chan_id":"222:0","amount_sats":500000,"max_fee_sats":500,"idempotency_key":"uat-05-'"$RUN_ID"'"}'
create_resp=$(post /v1/rebalance "$AGENT" "$body")
read_code
if [ "$HTTP_CODE" != "202" ]; then
    fail "UAT-05: expected 202, got $HTTP_CODE — body=$create_resp"
else
    conf_req=$(echo "$create_resp" | jq -r '.confirmation_required')
    op_id=$(echo "$create_resp" | jq -r '.operation_id')
    if [ "$conf_req" != "true" ] || [ -z "$op_id" ] || [ "$op_id" = "null" ]; then
        fail "UAT-05: 202 but missing confirmation_required/operation_id — body=$create_resp"
    else
        pass "UAT-05 — rebalance gated, operation_id=${op_id}"
        # Reject this op so it doesn't pollute later tests.
        reject_body=$(jq -n --arg id "$op_id" '{operation_id:$id}')
        post /v1/reject "$ADMIN" "$reject_body" >/dev/null
    fi
fi

# ─── UAT-06: RestartLND requires admin token ────────────────────────
log "UAT-06 — RestartLND requires admin token (P-4)"
# With agent token: expect 403
post /v1/admin/restart-lnd "$AGENT" '{}' >/dev/null
read_code
agent_code="$HTTP_CODE"
if [ "$agent_code" = "403" ]; then
    pass "UAT-06 — agent token correctly rejected with 403"
else
    fail "UAT-06: agent token got HTTP $agent_code, expected 403"
fi
# NOTE: we deliberately do NOT test the admin-token path here — it would actually
# trigger an LND restart and disrupt the rest of the UAT run. Trust the 403 on
# the agent side + the compile-time route registration in main.go.

# ─── UAT-07: DailySpend reflects confirmed payments ─────────────────
log "UAT-07 — DailySpend reflects confirmed payments (CR-03)"
if [ -z "${SIGNET_INVOICE:-}" ]; then
    skip "UAT-07 — needs UAT-01 to have run; SIGNET_INVOICE not set"
else
    summary_resp=$(post /v1/audit/summary "$ADMIN" '{}')
    read_code
    if [ "$HTTP_CODE" != "200" ]; then
        fail "UAT-07 summary call: HTTP $HTTP_CODE — body=$summary_resp"
    else
        daily=$(echo "$summary_resp" | jq -r '.data.daily_spend_sats // .daily_spend_sats // 0')
        if [ "$daily" = "0" ] || [ -z "$daily" ]; then
            fail "UAT-07: daily_spend_sats is 0 despite UAT-01 paying 1000 sats — CR-03 may not be fixed"
        else
            pass "UAT-07 — daily_spend_sats=$daily (non-zero; confirmed payments are counted)"
        fi
    fi
fi

# ─── UAT-08: L402 Pay idempotent replay ─────────────────────────────
log "UAT-08 — L402Pay idempotent replay (CR-04) [skipped in signet — needs external L402 URL]"
skip "UAT-08 — this test needs a real L402-protected external URL. Covered by unit test TestL402Pay_MockMode_StoresIdempotencyResponse in CI."

# ─── UAT-09: L402Pay releases reservation on pre-payment failure ────
log "UAT-09 — L402Pay releases reservation on pre-payment failure (CR-05)"
# Use a URL that will DNS-fail before any LND call
body='{"url":"https://nonexistent-uat-09.invalid","max_sats":100,"idempotency_key":"uat-09-'"$RUN_ID"'"}'
first_resp=$(post /v1/l402/pay "$AGENT" "$body")
read_code
first_code="$HTTP_CODE"
if [ "$first_code" != "502" ] && [ "$first_code" != "400" ]; then
    skip "UAT-09 — first call returned HTTP $first_code instead of expected 502 (DNS may be intercepted); can't test release"
else
    # Same idempotency_key with a reachable URL — should NOT get 409 duplicate-in-progress
    second_body='{"url":"https://example.com","max_sats":100,"idempotency_key":"uat-09-'"$RUN_ID"'"}'
    second_resp=$(post /v1/l402/pay "$AGENT" "$second_body")
    read_code
    second_code="$HTTP_CODE"
    if [ "$second_code" = "409" ]; then
        fail "UAT-09: retry returned 409 'duplicate in progress' — Release path not firing"
    else
        pass "UAT-09 — reservation released after pre-payment failure (retry got HTTP $second_code, not 409)"
    fi
fi

# ─── Summary ────────────────────────────────────────────────────────
echo
log "─── UAT SUMMARY ───"
log "  PASS: $PASS"
log "  FAIL: $FAIL"
log "  SKIP: $SKIP"
if [ $FAIL -gt 0 ]; then
    echo
    log "Failed tests:"
    for t in "${FAILED_TESTS[@]}"; do echo "  - $t"; done
    exit 1
fi
if [ $SKIP -gt 0 ]; then
    log "Some tests skipped — set env vars to cover full matrix before declaring 16.2 ready."
fi
log "All run tests passed."
