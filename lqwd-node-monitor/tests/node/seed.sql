-- =====================================================================
-- tests/node/seed.sql — deterministic EXEC-03 proof fixture (6 rows)
-- =====================================================================
-- Phase 8 Plan 02. Seeds the `commands` table of a STAGING `nodemon` DB with
-- exactly six deterministic rows: one valid + the five failure modes + a
-- bounds-violation row. Run as the PRIVILEGED owner/admin identity
-- (NODEMON_TEST_ADMIN_DSN) — the non-superuser nodemon_node role has NO INSERT
-- on `commands`, so seeding MUST use the admin DSN. See README.md.
--
--   psql "$NODEMON_TEST_ADMIN_DSN" -f tests/node/seed.sql
--
-- NEVER run against the live `nodemon` DB. STAGING / disposable Postgres ONLY.
--
-- FIDELITY (do not drift): every canonical_payload is the EXACT 5-field
-- newline-joined string from src/lib/queue/canonical.ts:buildSignedPayload —
--   nodePubkey \n commandId \n actionType \n canonicalParams \n expiresAt
-- with INTERNAL \n separators and NO trailing newline. We build it here with
-- concat_ws(E'\n', ...) so the bytes are unambiguous. signature_hex is the
-- lowercase HMAC-SHA256 of that exact string under the TEST secret
--   NODEMON_HMAC_SECRET = 'nodemon-test-secret-do-not-use-in-prod'
-- (documented in README.md). The `params` jsonb is the canonicalize() output
-- (sorted keys, no whitespace) so apply-fee's value extraction matches.
--
-- Regenerate the signatures with the generator command in README.md if the
-- TEST secret, the param objects, or the pubkeys ever change.
--
-- Deterministic identities (66-hex):
--   THIS node : 02aaaa…aaaa   (the tick's pubkey, used by SET LOCAL app.node_pubkey)
--   OTHER node: 03bbbb…bbbb   (the wrong-pubkey row — RLS-invisible to THIS node)

BEGIN;

-- Idempotent re-seed: clear ONLY our six fixed UUIDs (children first for the FK).
DELETE FROM command_audit
 WHERE command_id IN (
   '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
   '55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666');
DELETE FROM command_executions
 WHERE command_id IN (
   '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
   '55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666');
DELETE FROM commands
 WHERE id IN (
   '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
   '55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666');

-- ─────────────────────────────────────────────────────────────────────
-- (1) VALID approved — state='approved', expires_at>now(), correct signature,
--     in-bounds params. EXPECT: claimed → executing → succeeded (lncli called).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO commands (id, node_pubkey, action_type, params, canonical_payload, signature_hex, state, expires_at, created_at)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'update_fee',
  '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}'::jsonb,
  concat_ws(E'\n',
    '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'update_fee',
    '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}',
    '2999-01-01T00:00:00.000Z'),
  '4b45547ed8d17bd54ae2b57885f712af31408b2976f5eda76054233cdf482cdd',
  'approved', '2999-01-01T00:00:00.000Z'::timestamptz, now() - interval '10 minutes');

-- ─────────────────────────────────────────────────────────────────────
-- (2) TAMPERED HMAC — valid canonical_payload but signature_hex mutated
--     (last hex nibble flipped). EXPECT: failed + audit reason 'hmac_mismatch',
--     lncli NEVER called.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO commands (id, node_pubkey, action_type, params, canonical_payload, signature_hex, state, expires_at, created_at)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'update_fee',
  '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}'::jsonb,
  concat_ws(E'\n',
    '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '22222222-2222-2222-2222-222222222222',
    'update_fee',
    '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}',
    '2999-01-01T00:00:00.000Z'),
  -- correct digest is d63a…02c9; the LAST nibble is tampered to 0 → must NOT verify.
  'd63a6852634a3858a541a11908546a2dec79053cc183ec04bebaaadcefe702c0',
  'approved', '2999-01-01T00:00:00.000Z'::timestamptz, now() - interval '9 minutes');

-- ─────────────────────────────────────────────────────────────────────
-- (3) UN-APPROVED — state='pending_approval'. EXPECT: UNTOUCHED (never claimed,
--     never expired since expires_at>now()); zero new audit rows from the tick.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO commands (id, node_pubkey, action_type, params, canonical_payload, signature_hex, state, expires_at, created_at)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'update_fee',
  '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}'::jsonb,
  concat_ws(E'\n',
    '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '33333333-3333-3333-3333-333333333333',
    'update_fee',
    '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}',
    '2999-01-01T00:00:00.000Z'),
  'e9a3cfb0b819a54ec9c3d67a761bf4e8af72e20181b00a42dc5f90843ccbea13',
  'pending_approval', '2999-01-01T00:00:00.000Z'::timestamptz, now() - interval '8 minutes');

-- ─────────────────────────────────────────────────────────────────────
-- (4) EXPIRED — state='approved' but expires_at<now(). EXPECT: 'expired' after
--     expireSweep + audit reason 'ttl_expired'; never claimed, no lncli.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO commands (id, node_pubkey, action_type, params, canonical_payload, signature_hex, state, expires_at, created_at)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'update_fee',
  '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}'::jsonb,
  concat_ws(E'\n',
    '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '44444444-4444-4444-4444-444444444444',
    'update_fee',
    '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}',
    '2000-01-01T00:00:00.000Z'),
  'ef3a262bf23f3b8424d8e1b47692d1fb9a15b63157d1f854dfbcc27f03bd08c4',
  'approved', '2000-01-01T00:00:00.000Z'::timestamptz, now() - interval '7 minutes');

-- ─────────────────────────────────────────────────────────────────────
-- (5) WRONG-PUBKEY — state='approved', node_pubkey = the OTHER node (03bbbb…).
--     EXPECT: physically INVISIBLE under RLS to a nodemon_node connection that
--     has SET LOCAL app.node_pubkey = '02aaaa…' — never claimed, count(*)=0.
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO commands (id, node_pubkey, action_type, params, canonical_payload, signature_hex, state, expires_at, created_at)
VALUES (
  '55555555-5555-5555-5555-555555555555',
  '03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'update_fee',
  '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}'::jsonb,
  concat_ws(E'\n',
    '03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '55555555-5555-5555-5555-555555555555',
    'update_fee',
    '{"baseFeeMsat":1000,"chanId":"800000000000000001","channelPoint":"aaaa1111:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":80}',
    '2999-01-01T00:00:00.000Z'),
  'f5c85fa1a37fcb71b8d316367d2465077b8832278581837a40157a48193298cf',
  'approved', '2999-01-01T00:00:00.000Z'::timestamptz, now() - interval '6 minutes');

-- ─────────────────────────────────────────────────────────────────────
-- (6) OUT-OF-BOUNDS — state='approved', VALID signature, params.suggestedPpm=9999
--     (> the frozen 5000 ceiling). EXPECT: failed + audit reason
--     'bounds_violation'; lncli NEVER called (node re-enforces bounds = 3rd point).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO commands (id, node_pubkey, action_type, params, canonical_payload, signature_hex, state, expires_at, created_at)
VALUES (
  '66666666-6666-6666-6666-666666666666',
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'update_fee',
  '{"baseFeeMsat":1000,"chanId":"800000000000000006","channelPoint":"ffff6666:0","currentPpm":100,"suggestedPpm":9999,"timeLockDelta":80}'::jsonb,
  concat_ws(E'\n',
    '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '66666666-6666-6666-6666-666666666666',
    'update_fee',
    '{"baseFeeMsat":1000,"chanId":"800000000000000006","channelPoint":"ffff6666:0","currentPpm":100,"suggestedPpm":9999,"timeLockDelta":80}',
    '2999-01-01T00:00:00.000Z'),
  'e4b095d8406662f06337f68ad9e9aa37cd2af48e7fac84c13d56bafdc9dfcba4',
  'approved', '2999-01-01T00:00:00.000Z'::timestamptz, now() - interval '5 minutes');

COMMIT;

-- Sanity echo (admin sees all 6; RLS is bypassed for the owner/admin identity).
SELECT id, state, node_pubkey FROM commands
 WHERE id IN (
   '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
   '55555555-5555-5555-5555-555555555555','66666666-6666-6666-6666-666666666666')
 ORDER BY id;
