-- =====================================================================
-- tests/node/assert.sql — post-tick state + audit assertions (EXEC-03)
-- =====================================================================
-- Phase 8 Plan 02. Run AFTER one (or more) check-queue tick(s) over the seeded
-- staging DB. Run as the PRIVILEGED owner/admin identity (NODEMON_TEST_ADMIN_DSN)
-- so it BYPASSES RLS and can read ALL six rows to verify their final state —
-- including the wrong-pubkey row that the nodemon_node tick can never see.
--
--   psql -v ON_ERROR_STOP=1 "$NODEMON_TEST_ADMIN_DSN" -f tests/node/assert.sql
--
-- Every assertion is an ASSERT inside a DO block: a violated assertion raises
-- and (with ON_ERROR_STOP=1) makes psql exit non-zero, so the bats harness and
-- CI see a hard failure. Expected end-states map to claim.ts + stub-executor.ts
-- terminal transitions and the apply-fee fail-closed reasons.
--
-- Expected end-states for the six seed rows:
--   (1) valid        → 'succeeded'        + audit approved→claimed, claimed→executing, executing→succeeded
--   (2) tampered     → 'failed'           + audit reason 'hmac_mismatch'   (lncli NEVER called)
--   (3) un-approved  → 'pending_approval' UNCHANGED, zero audit rows
--   (4) expired      → 'expired'          + audit reason 'ttl_expired'
--   (5) wrong-pubkey → 'approved' UNCHANGED, zero audit rows (RLS-invisible to the tick)
--   (6) out-of-bounds→ 'failed'           + audit reason 'bounds_violation' (lncli NEVER called)

\set ON_ERROR_STOP on

DO $$
DECLARE
  s text;
  n int;
BEGIN
  -- (1) VALID → succeeded, full happy-path audit chain.
  SELECT state INTO s FROM commands WHERE id = '11111111-1111-1111-1111-111111111111';
  ASSERT s = 'succeeded',
    format('row1 (valid) expected succeeded, got %L', s);
  SELECT count(*) INTO n FROM command_audit
   WHERE command_id = '11111111-1111-1111-1111-111111111111'
     AND from_state = 'approved' AND to_state = 'claimed';
  ASSERT n >= 1, 'row1 missing approved->claimed audit';
  SELECT count(*) INTO n FROM command_audit
   WHERE command_id = '11111111-1111-1111-1111-111111111111'
     AND from_state = 'claimed' AND to_state = 'executing';
  ASSERT n >= 1, 'row1 missing claimed->executing audit';
  SELECT count(*) INTO n FROM command_audit
   WHERE command_id = '11111111-1111-1111-1111-111111111111'
     AND from_state = 'executing' AND to_state = 'succeeded';
  ASSERT n >= 1, 'row1 missing executing->succeeded audit';
  SELECT count(*) INTO n FROM command_executions
   WHERE command_id = '11111111-1111-1111-1111-111111111111' AND outcome = 'succeeded';
  ASSERT n >= 1, 'row1 missing succeeded command_executions row';

  -- (2) TAMPERED → failed + audit reason hmac_mismatch.
  SELECT state INTO s FROM commands WHERE id = '22222222-2222-2222-2222-222222222222';
  ASSERT s = 'failed',
    format('row2 (tampered) expected failed, got %L', s);
  SELECT count(*) INTO n FROM command_audit
   WHERE command_id = '22222222-2222-2222-2222-222222222222'
     AND to_state = 'failed' AND reason = 'hmac_mismatch';
  ASSERT n >= 1, 'row2 missing failed/hmac_mismatch audit';
  SELECT count(*) INTO n FROM command_executions
   WHERE command_id = '22222222-2222-2222-2222-222222222222' AND outcome = 'failed';
  ASSERT n >= 1, 'row2 missing failed command_executions row';

  -- (3) UN-APPROVED → unchanged, zero audit rows from any tick.
  SELECT state INTO s FROM commands WHERE id = '33333333-3333-3333-3333-333333333333';
  ASSERT s = 'pending_approval',
    format('row3 (un-approved) expected pending_approval, got %L', s);
  SELECT count(*) INTO n FROM command_audit WHERE command_id = '33333333-3333-3333-3333-333333333333';
  ASSERT n = 0, format('row3 (un-approved) expected 0 audit rows, got %s', n);

  -- (4) EXPIRED → expired + audit reason ttl_expired.
  SELECT state INTO s FROM commands WHERE id = '44444444-4444-4444-4444-444444444444';
  ASSERT s = 'expired',
    format('row4 (expired) expected expired, got %L', s);
  SELECT count(*) INTO n FROM command_audit
   WHERE command_id = '44444444-4444-4444-4444-444444444444'
     AND to_state = 'expired' AND reason = 'ttl_expired';
  ASSERT n >= 1, 'row4 missing expired/ttl_expired audit';

  -- (5) WRONG-PUBKEY → unchanged (the tick can never see it), zero audit rows.
  SELECT state INTO s FROM commands WHERE id = '55555555-5555-5555-5555-555555555555';
  ASSERT s = 'approved',
    format('row5 (wrong-pubkey) expected approved (untouched), got %L', s);
  SELECT count(*) INTO n FROM command_audit WHERE command_id = '55555555-5555-5555-5555-555555555555';
  ASSERT n = 0, format('row5 (wrong-pubkey) expected 0 audit rows, got %s', n);

  -- (6) OUT-OF-BOUNDS → failed + audit reason bounds_violation.
  SELECT state INTO s FROM commands WHERE id = '66666666-6666-6666-6666-666666666666';
  ASSERT s = 'failed',
    format('row6 (out-of-bounds) expected failed, got %L', s);
  SELECT count(*) INTO n FROM command_audit
   WHERE command_id = '66666666-6666-6666-6666-666666666666'
     AND to_state = 'failed' AND reason = 'bounds_violation';
  ASSERT n >= 1, 'row6 missing failed/bounds_violation audit';
  SELECT count(*) INTO n FROM command_executions
   WHERE command_id = '66666666-6666-6666-6666-666666666666' AND outcome = 'failed';
  ASSERT n >= 1, 'row6 missing failed command_executions row';

  RAISE NOTICE 'assert.sql: all six failure-mode assertions PASSED';
END $$;
