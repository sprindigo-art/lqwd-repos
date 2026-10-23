-- Custom SQL migration file, put your code below! --
-- =====================================================================
-- HARDEN-01 / Q2 — DB-level self-approve guard for the nodemon_node role
-- =====================================================================
-- CODE-REVIEW-2026-07-22 finding Q2 (HIGH): nodemon_node holds table-level
-- `GRANT SELECT, UPDATE ON commands` (db/role-grants.sql:122) and RLS `WITH CHECK`
-- gates only node_pubkey, NOT state edges. So `UPDATE commands SET state='approved'
-- WHERE state='pending_approval'` is permitted at the DB — the executor role could
-- self-approve, bypassing the operator gate WITHOUT forging a signature.
--
-- This migration installs a BEFORE UPDATE row trigger that enforces the
-- executor-legal transition set (mirroring src/lib/queue/state.ts LEGAL) for the
-- executor role ONLY. It is an ALLOW-LIST: for current_user = 'nodemon_node' every
-- state-changing UPDATE must be one of the node/reaper edges below; anything else
-- (most importantly pending_approval → approved) is rejected fail-closed.
--
-- Keyed on current_user (NOT session_user) so the guard responds to `SET ROLE
-- nodemon_node` — this makes it enforceable whether the role is reached by a direct
-- login (the real node) or via role membership (the integration test), and catches
-- privilege obtained through role membership. Other roles (the dashboard-writer /
-- schema owner that runs approve()/reject()/withdraw()/enqueue) are UNAFFECTED — the
-- operator-approval path keeps working; only the executor identity is boxed.
--
-- Mechanism: BEFORE UPDATE trigger (not an RLS WITH CHECK policy) because RLS
-- WITH CHECK sees only the NEW row and cannot compare OLD.state → NEW.state, which
-- is exactly what a transition guard needs. SECURITY INVOKER (default) so
-- current_user reflects the caller. Idempotent (CREATE OR REPLACE + DROP IF EXISTS).
--
-- Applies to the nodemon queue DB ONLY. NEVER run against the routing/ldk warehouses.

CREATE OR REPLACE FUNCTION nodemon_node_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only the executor identity is boxed. Reached by direct login (real node) or by
  -- `SET ROLE nodemon_node` (integration test / role membership). Every other role
  -- (dashboard-writer / owner) bypasses this guard, so operator approve/reject and
  -- dashboard-side enqueue keep working unchanged.
  IF current_user <> 'nodemon_node' THEN
    RETURN NEW;
  END IF;

  -- A no-op on state (e.g. claimed_at / metadata bumps that leave state unchanged)
  -- is always allowed — the guard governs STATE EDGES, not every column write.
  IF NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  -- Executor-legal edge allow-list, mirroring src/lib/queue/state.ts LEGAL restricted
  -- to what the node + reaper legitimately perform:
  --   approved  → claimed     (atomic claim)
  --   claimed   → executing   (commit1: begin apply)
  --   executing → succeeded   (commit2: write-back success)
  --   executing → failed      (commit2: write-back failure)
  --   claimed   → approved    (reaper release — puts an abandoned claim back)
  --   claimed   → failed      (reaper fail)
  --   {draft, pending_approval, approved, claimed} → expired  (TTL fail-close)
  IF (OLD.state = 'approved'  AND NEW.state = 'claimed')   OR
     (OLD.state = 'claimed'   AND NEW.state = 'executing') OR
     (OLD.state = 'executing' AND NEW.state = 'succeeded') OR
     (OLD.state = 'executing' AND NEW.state = 'failed')    OR
     (OLD.state = 'claimed'   AND NEW.state = 'approved')  OR
     (OLD.state = 'claimed'   AND NEW.state = 'failed')    OR
     (NEW.state = 'expired'   AND OLD.state IN ('draft', 'pending_approval', 'approved', 'claimed'))
  THEN
    RETURN NEW;
  END IF;

  -- Everything else is forbidden for the executor role. The headline threat
  -- (T-18-24): pending_approval → approved is NOT in the allow-list, so a self-approve
  -- is rejected here — independent of app code. Also blocks pending_approval → rejected,
  -- approved → withdrawn, and draft → pending_approval (operator / dashboard-writer only).
  RAISE EXCEPTION
    'nodemon_node may not transition commands.state % -> % (executor-illegal edge; approval is operator-only)',
    OLD.state, NEW.state
    USING ERRCODE = '42501'; -- insufficient_privilege
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS nodemon_node_transition_guard ON commands;
--> statement-breakpoint
CREATE TRIGGER nodemon_node_transition_guard
  BEFORE UPDATE ON commands
  FOR EACH ROW
  EXECUTE FUNCTION nodemon_node_transition_guard();
