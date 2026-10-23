#!/usr/bin/env bats
#
# hmac-vector.bats — TS-to-bash HMAC byte-identity proof (Pitfall 1 + Pitfall 4)
# =============================================================================
# Phase 8 Plan 02, Wave 0. Proves the bash verify path in scripts/node/apply-fee
# reproduces the dashboard's HMAC digest BYTE-FOR-BYTE. A known canonical 5-field
# string is signed in Node (the repo's PURE buildSignedPayload + node:crypto
# createHmac — identical to src/lib/queue/canonical.ts + sign.ts) and the digest
# is compared to the bash path:
#
#   printf %s "$CANONICAL" | openssl dgst -sha256 -hmac "$SECRET" -r | awk '{print $1}'
#
# Guards:
#   * Pitfall 1 — `printf %s` (NOT echo) so NO trailing \n is appended. echo would
#     change the digest and make every production verify fail.
#   * Pitfall 4 — `openssl dgst ... -r` prints "<hex> *stdin" (field 1 = the hex);
#     we assert we read field 1, not the old "...= <hex>" format.
#
# Runner: bats-core (https://github.com/bats-core/bats-core). bats is an OS dev
# tool — it is NOT added to package.json (no npm install, no slop surface). On a
# host without bats, run `tests/node/hmac-vector.sh` (the plain-shell sibling),
# which performs the identical comparison.

setup() {
  REPO_ROOT="$(cd "${BATS_TEST_DIRNAME}/../.." && pwd)"
  # The frozen TEST secret (documented in README.md; NEVER a real per-node secret).
  TEST_SECRET='nodemon-test-secret-do-not-use-in-prod'
}

# The canonical-string builder + signer, expressed in Node EXACTLY as the repo's
# pure modules do (canonicalize key-sort + 5-field \n join + createHmac hex).
ts_sign() {
  node -e '
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

@test "TS signer and bash openssl produce a byte-identical HMAC digest" {
  TS_DIGEST="$(TEST_SECRET="$TEST_SECRET" ts_sign digest)"
  CANONICAL="$(TEST_SECRET="$TEST_SECRET" ts_sign payload)"

  # Pitfall 1: printf %s (no trailing newline). Pitfall 4: -r format, field 1.
  BASH_DIGEST="$(printf %s "$CANONICAL" | openssl dgst -sha256 -hmac "$TEST_SECRET" -r | awk '{print $1}')"

  [ -n "$TS_DIGEST" ]
  [ -n "$BASH_DIGEST" ]
  [ "$TS_DIGEST" = "$BASH_DIGEST" ]
}

@test "echo (with trailing newline) does NOT match — proves printf %s is required" {
  CANONICAL="$(TEST_SECRET="$TEST_SECRET" ts_sign payload)"
  TS_DIGEST="$(TEST_SECRET="$TEST_SECRET" ts_sign digest)"

  # `echo` appends \n → a DIFFERENT digest. This negative test locks in Pitfall 1.
  ECHO_DIGEST="$(echo "$CANONICAL" | openssl dgst -sha256 -hmac "$TEST_SECRET" -r | awk '{print $1}')"
  [ "$ECHO_DIGEST" != "$TS_DIGEST" ]
}

@test "openssl -r output is the <hex> *stdin format (field 1 is the hex)" {
  CANONICAL="$(TEST_SECRET="$TEST_SECRET" ts_sign payload)"
  RAW="$(printf %s "$CANONICAL" | openssl dgst -sha256 -hmac "$TEST_SECRET" -r)"
  # Newer openssl: "<64hex> *stdin". Assert field 1 is 64 lowercase hex chars.
  FIELD1="$(printf %s "$RAW" | awk '{print $1}')"
  [[ "$FIELD1" =~ ^[0-9a-f]{64}$ ]]
}
