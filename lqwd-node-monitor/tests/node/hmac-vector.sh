#!/bin/bash
#
# hmac-vector.sh — plain-shell sibling of hmac-vector.bats (no bats required)
# ===========================================================================
# Identical TS-to-bash HMAC byte-identity proof, runnable on a host WITHOUT
# bats-core installed (bats is an OS dev tool we deliberately do not add to
# package.json). The .bats file is the canonical artifact where bats is present;
# this script is the autonomous fallback the per-task verify uses.
#
# Usage:  bash tests/node/hmac-vector.sh
# Exit:   0 if the TS digest == bash openssl digest AND printf %s is required.

set -u
TEST_SECRET='nodemon-test-secret-do-not-use-in-prod'
FAILURES=0
fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { echo "PASS: $*"; }

ts_sign() {
  TEST_SECRET="$TEST_SECRET" node -e '
    const { createHmac } = require("node:crypto");
    function canonicalize(value){
      if (value === null || typeof value !== "object") return JSON.stringify(value);
      if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
      const keys = Object.keys(value).sort();
      return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
    }
    function buildSignedPayload(p){
      return [p.nodePubkey, p.commandId, p.actionType, p.canonicalParams, p.expiresAt].join("\n");
    }
    const secret = process.env.TEST_SECRET;
    const params = { chanId:"800000000000000001", channelPoint:"aaaa1111:0", currentPpm:100, suggestedPpm:250, baseFeeMsat:1000, timeLockDelta:80 };
    const payload = buildSignedPayload({
      nodePubkey: "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      commandId: "11111111-1111-1111-1111-111111111111",
      actionType: "update_fee",
      canonicalParams: canonicalize(params),
      expiresAt: "2999-01-01T00:00:00.000Z",
    });
    if (process.argv[1] === "payload") { process.stdout.write(payload); return; }
    process.stdout.write(createHmac("sha256", secret).update(payload, "utf8").digest("hex"));
  ' "$1"
}

TS_DIGEST="$(ts_sign digest)"
CANONICAL="$(ts_sign payload)"
BASH_DIGEST="$(printf %s "$CANONICAL" | openssl dgst -sha256 -hmac "$TEST_SECRET" -r | awk '{print $1}')"

[ -n "$TS_DIGEST" ]   || fail "TS digest empty"
[ -n "$BASH_DIGEST" ] || fail "bash digest empty"
if [ "$TS_DIGEST" = "$BASH_DIGEST" ]; then
  pass "TS digest == bash openssl digest ($TS_DIGEST)"
else
  fail "digest mismatch: TS=$TS_DIGEST bash=$BASH_DIGEST"
fi

ECHO_DIGEST="$(echo "$CANONICAL" | openssl dgst -sha256 -hmac "$TEST_SECRET" -r | awk '{print $1}')"
if [ "$ECHO_DIGEST" != "$TS_DIGEST" ]; then
  pass "echo (trailing \\n) differs — printf %s is required (Pitfall 1)"
else
  fail "echo digest equals TS digest — Pitfall 1 not exercised"
fi

FIELD1="$(printf %s "$CANONICAL" | openssl dgst -sha256 -hmac "$TEST_SECRET" -r | awk '{print $1}')"
if [[ "$FIELD1" =~ ^[0-9a-f]{64}$ ]]; then
  pass "openssl -r field 1 is 64 lowercase hex (Pitfall 4 format)"
else
  fail "openssl -r field 1 is not 64-hex: $FIELD1"
fi

echo "----------------------------------------"
if [ "$FAILURES" -eq 0 ]; then echo "hmac-vector: all checks passed."; exit 0; else echo "$FAILURES check(s) failed."; exit 1; fi
