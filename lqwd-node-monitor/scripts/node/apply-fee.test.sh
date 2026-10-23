#!/bin/bash
#
# apply-fee.test.sh — golden tests for Q1 (signed-payload binding), the
# pubkey_mismatch replay check, and I1 (live time_lock_delta resolution).
# ==========================================================================
# 18-02 Task 1. Drives scripts/node/apply-fee with a stub `lncli` (found via
# PATH — apply-fee invokes bare `lncli`) and row fields constructed exactly as
# a signed nodemon `commands` row would carry them (buildSignedPayload's 5
# newline-joined fields; HMAC-SHA256 lowercase hex over the verbatim string).
#
# NO DB and NO network: apply-fee's contract is argv-only, so a "seeded row"
# is fully represented by --canonical-payload/--signature-hex/--params/--pubkey.
# The stub lncli logs every argv invocation so the assertions can prove WHICH
# values reached updatechanpolicy (the signed ones) and which never did (the
# tampered `params` column values, the fabricated time_lock_delta 80).
#
# Cases:
#   1. TAMPERED-PARAMS (Q1)  — `params` column differs from the signed field 4:
#      apply-fee must apply ONLY the signed values; the tampered value must
#      never appear on any lncli argv.
#   2. PUBKEY-MISMATCH       — row signed for ANOTHER node's pubkey (valid HMAC
#      under this node's secret): fail-closed REASON=pubkey_mismatch, and
#      updatechanpolicy is NEVER called (replay-across-nodes blocked).
#   3. LIVE-TLD (I1)         — stub getchaninfo returns time_lock_delta=144:
#      updatechanpolicy must receive 144, never the signed placeholder 80.
#   4. TLD FAIL-CLOSED (I1)  — getchaninfo fails: REASON=time_lock_delta_unresolved,
#      updatechanpolicy NEVER called.
#
# Exit 0 = all cases pass; non-zero = failure (line names the case).

set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APPLY="${REPO_ROOT}/scripts/node/apply-fee"

for tool in openssl jq awk; do
  command -v "$tool" >/dev/null 2>&1 || { echo "FAIL: required tool missing: $tool"; exit 1; }
done
[ -x "$APPLY" ] || { echo "FAIL: $APPLY not found/executable"; exit 1; }

SECRET='nodemon-test-secret-do-not-use-in-prod'
PUBKEY='02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
OTHER_PUBKEY='03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
COMMAND_ID='11111111-1111-1111-1111-111111111111'
OTHER_COMMAND_ID='99999999-9999-9999-9999-999999999999'
EXPIRES='2999-01-01T00:00:00.000Z'
PAST_EXPIRES='2000-01-01T00:00:00.000Z'

# canonicalize() fidelity: sorted keys, no whitespace, single line (canonical.ts).
SIGNED_PARAMS='{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}'
# The tampered `params` COLUMN: suggestedPpm 250 → 4999 (in-bounds, so only the
# signed-payload binding — not the bounds gate — can stop it reaching lncli).
TAMPERED_PARAMS='{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":4999,"timeLockDelta":80}'

# buildSignedPayload: 5 newline-joined fields, NO trailing newline.
payload_for() { # $1 = nodePubkey
  printf '%s\n%s\n%s\n%s\n%s' "$1" "$COMMAND_ID" 'update_fee' "$SIGNED_PARAMS" "$EXPIRES"
}
# Full-control payload builder for the TTL (Q5) + commandId (Q5b) cases.
payload_full() { # $1=pubkey $2=commandId $3=expiresAt
  printf '%s\n%s\n%s\n%s\n%s' "$1" "$2" 'update_fee' "$SIGNED_PARAMS" "$3"
}
sign() { # $1 = payload → lowercase hex HMAC-SHA256 (sign.ts / openssl parity)
  printf %s "$1" | openssl dgst -sha256 -hmac "$SECRET" -r | awk '{print $1}'
}

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
STUB_LOG="${SCRATCH}/lncli-argv.log"

# Stub lncli: appends every argv to STUB_LOG (one line per call), then serves
# listchannels/getchaninfo (I1's live-TLD reads) and updatechanpolicy. Modes:
#   ok       — getchaninfo returns time_lock_delta 144 (≠ the signed 80)
#   tld_fail — getchaninfo exits non-zero (live delta unresolvable)
make_stub() { # $1 = mode
  mkdir -p "${SCRATCH}/bin"
  cat > "${SCRATCH}/bin/lncli" <<STUB
#!/bin/bash
echo "\$*" >> "${STUB_LOG}"
sub=""; skip_next=0
for a in "\$@"; do
  if [ "\$skip_next" = "1" ]; then skip_next=0; continue; fi
  case "\$a" in
    --tlscertpath|--macaroonpath) skip_next=1; continue ;;
    --*) continue ;;
    *) sub="\$a"; break ;;
  esac
done
case "\$sub" in
  listchannels)
    echo '{"channels":[{"channel_point":"aaaa1111:0","chan_id":"800000000000000001"}]}'
    ;;
  getchaninfo)
    if [ "${1}" = "tld_fail" ]; then echo "unable to fetch channel" >&2; exit 1; fi
    echo '{"node1_pub":"${PUBKEY}","node1_policy":{"time_lock_delta":144},"node2_pub":"${OTHER_PUBKEY}","node2_policy":{"time_lock_delta":40}}'
    ;;
  updatechanpolicy)
    echo "policy updated"
    ;;
  *)
    echo '{}'
    ;;
esac
STUB
  chmod +x "${SCRATCH}/bin/lncli"
  : > "$STUB_LOG"
}

run_apply() { # $1=payload $2=sig $3=params-column $4=pubkey [$5=claimed-id] → sets OUT/RC
  local claimed_id="${5:-$COMMAND_ID}"   # default: the claimed id MATCHES the signed commandId
  OUT="$(PATH="${SCRATCH}/bin:$PATH" NODEMON_HMAC_SECRET="$SECRET" \
    TLS_CERT=/dev/null MACAROON=/dev/null \
    "$APPLY" \
    --canonical-payload "$1" \
    --signature-hex "$2" \
    --params "$3" \
    --pubkey "$4" \
    --claimed-id "$claimed_id" 2>&1)"
  RC="$?"
}

fail() { echo "FAIL [$1]: $2"; echo "--- apply-fee output ---"; echo "$OUT"; echo "--- stub argv log ---"; cat "$STUB_LOG" 2>/dev/null; exit 1; }
pass() { echo "PASS [$1]"; }

# ── Case 1: TAMPERED-PARAMS (Q1) — signed values applied, tampered ignored ────
make_stub ok
PAYLOAD="$(payload_for "$PUBKEY")"
SIG="$(sign "$PAYLOAD")"
run_apply "$PAYLOAD" "$SIG" "$TAMPERED_PARAMS" "$PUBKEY"
[ "$RC" -eq 0 ] || fail tampered-params "expected success applying the SIGNED values (rc=$RC)"
printf '%s\n' "$OUT" | grep -q '^OUTCOME=succeeded' || fail tampered-params "expected OUTCOME=succeeded"
UPDATE_ARGV="$(grep 'updatechanpolicy' "$STUB_LOG" || true)"
[ -n "$UPDATE_ARGV" ] || fail tampered-params "updatechanpolicy was never called"
printf '%s\n' "$UPDATE_ARGV" | grep -q -- '--fee_rate_ppm 250' \
  || fail tampered-params "updatechanpolicy did not receive the SIGNED fee_rate_ppm 250"
grep -q '4999' "$STUB_LOG" && fail tampered-params "the TAMPERED params value 4999 reached an lncli argv"
pass "tampered-params: lncli received the signed value (250), never the tampered 4999"

# ── Case 2: PUBKEY-MISMATCH — replay across nodes blocked, no lncli ───────────
make_stub ok
PAYLOAD="$(payload_for "$OTHER_PUBKEY")"   # signed FOR the other node
SIG="$(sign "$PAYLOAD")"                   # valid HMAC under this node's secret
run_apply "$PAYLOAD" "$SIG" "$SIGNED_PARAMS" "$PUBKEY"
[ "$RC" -ne 0 ] || fail pubkey-mismatch "expected fail-closed exit (rc=0)"
printf '%s\n' "$OUT" | grep -q '^OUTCOME=failed REASON=pubkey_mismatch' \
  || fail pubkey-mismatch "expected OUTCOME=failed REASON=pubkey_mismatch"
grep -q 'updatechanpolicy' "$STUB_LOG" && fail pubkey-mismatch "updatechanpolicy was called despite pubkey mismatch"
pass "pubkey-mismatch: fail-closed, updatechanpolicy never called"

# ── Case 3: LIVE-TLD (I1) — the stub's live 144 applied, never the signed 80 ──
make_stub ok
PAYLOAD="$(payload_for "$PUBKEY")"
SIG="$(sign "$PAYLOAD")"
run_apply "$PAYLOAD" "$SIG" "$SIGNED_PARAMS" "$PUBKEY"
[ "$RC" -eq 0 ] || fail live-tld "expected success (rc=$RC)"
UPDATE_ARGV="$(grep 'updatechanpolicy' "$STUB_LOG" || true)"
printf '%s\n' "$UPDATE_ARGV" | grep -q -- '--time_lock_delta 144' \
  || fail live-tld "updatechanpolicy did not receive the LIVE time_lock_delta 144"
printf '%s\n' "$UPDATE_ARGV" | grep -q -- '--time_lock_delta 80' \
  && fail live-tld "updatechanpolicy received the fabricated placeholder 80"
printf '%s\n' "$OUT" | grep -q 'time_lock_delta=144' \
  || fail live-tld "success detail does not report the applied live delta 144"
pass "live-tld: applied the live getchaninfo delta (144), never the placeholder 80"

# ── Case 4: TLD FAIL-CLOSED (I1) — unresolvable live delta blocks the apply ───
make_stub tld_fail
PAYLOAD="$(payload_for "$PUBKEY")"
SIG="$(sign "$PAYLOAD")"
run_apply "$PAYLOAD" "$SIG" "$SIGNED_PARAMS" "$PUBKEY"
[ "$RC" -ne 0 ] || fail tld-fail-closed "expected fail-closed exit (rc=0)"
printf '%s\n' "$OUT" | grep -q '^OUTCOME=failed REASON=time_lock_delta_unresolved' \
  || fail tld-fail-closed "expected OUTCOME=failed REASON=time_lock_delta_unresolved"
grep -q 'updatechanpolicy' "$STUB_LOG" && fail tld-fail-closed "updatechanpolicy was called despite unresolved live delta"
pass "tld-fail-closed: getchaninfo failure blocks the apply"

# ── Case 5: TTL from the SIGNED expiresAt (Q5) — expired even if the column lies ─
# The signed field 5 is in the past. apply-fee re-checks TTL from the SIGNED bytes,
# NOT the mutable expires_at column (which a DB-tamper attacker could extend). The
# claimed id still matches the signed commandId, so ONLY the TTL gate can stop it.
make_stub ok
PAYLOAD="$(payload_full "$PUBKEY" "$COMMAND_ID" "$PAST_EXPIRES")"
SIG="$(sign "$PAYLOAD")"
run_apply "$PAYLOAD" "$SIG" "$SIGNED_PARAMS" "$PUBKEY" "$COMMAND_ID"
[ "$RC" -ne 0 ] || fail signed-ttl "expected fail-closed exit for an expired signed expiresAt (rc=0)"
printf '%s\n' "$OUT" | grep -q '^OUTCOME=failed REASON=ttl_expired' \
  || fail signed-ttl "expected OUTCOME=failed REASON=ttl_expired"
grep -q 'updatechanpolicy' "$STUB_LOG" && fail signed-ttl "updatechanpolicy was called despite an expired signed expiresAt"
pass "signed-ttl: expiry read from the SIGNED expiresAt, updatechanpolicy never called"

# ── Case 6: commandId ↔ claimed-id binding (Q5b) — transplant blocked, no lncli ─
# A genuine (payload,signature) pair for THIS node whose signed commandId does NOT
# match the row the executor claimed (an older approved command transplanted onto a
# different claimed id). Fail-closed, updatechanpolicy never called.
make_stub ok
PAYLOAD="$(payload_full "$PUBKEY" "$COMMAND_ID" "$EXPIRES")"
SIG="$(sign "$PAYLOAD")"
run_apply "$PAYLOAD" "$SIG" "$SIGNED_PARAMS" "$PUBKEY" "$OTHER_COMMAND_ID"
[ "$RC" -ne 0 ] || fail commandid-binding "expected fail-closed exit for a commandId≠claimed-id (rc=0)"
printf '%s\n' "$OUT" | grep -q '^OUTCOME=failed REASON=command_id_mismatch' \
  || fail commandid-binding "expected OUTCOME=failed REASON=command_id_mismatch"
grep -q 'updatechanpolicy' "$STUB_LOG" && fail commandid-binding "updatechanpolicy was called despite commandId≠claimed-id"
pass "commandid-binding: transplanted (payload,signature) blocked, updatechanpolicy never called"

echo "apply-fee.test.sh: all 6 golden cases PASSED"
exit 0
