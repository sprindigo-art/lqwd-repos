-- =====================================================================
-- nodemon_ro — dedicated least-privilege READ-ONLY role for NodeMonitor
-- =====================================================================
-- OPERATOR-RUN ARTIFACT. The application's nodemon_ro role CANNOT create roles
-- or grant privileges — a warehouse superuser/owner must run this script.
--
-- Run ONCE PER WAREHOUSE DB: first against `routing_vm`, then `ldk-lspd-main`.
-- This is a DEDICATED role (D-01) — it does NOT reuse grafana_demo_ro, so it can
-- be audited and revoked independently. Read-only is enforced at the DB ROLE
-- (D-02), proven by NodeMonitor's boot health probe (SQLSTATE 25006/42501).
--
-- SECURITY: scoped GRANT SELECT on NAMED tables only — never a blanket
-- all-tables grant, never any INSERT/UPDATE/DELETE/TRUNCATE.
-- default_transaction_read_only forces
-- every session on this role to be read-only (the cleanest signal the boot probe
-- keys on). Replace <generated-strong-password> with an operator-generated secret;
-- it goes ONLY into the run-host's git-ignored .env.local, never into source.

-- ─────────────────────────────────────────────────────────────────────
-- ROLE (run once per cluster; CREATE ROLE is cluster-wide, the GRANTs below
-- are per-database). If the role already exists from the routing_vm run, skip
-- the CREATE ROLE on the ldk-lspd-main run and apply only the GRANT block.
-- ─────────────────────────────────────────────────────────────────────
CREATE ROLE nodemon_ro WITH LOGIN PASSWORD '<generated-strong-password>';

-- Belt-and-suspenders: force every transaction on this role to be read-only.
ALTER ROLE nodemon_ro SET default_transaction_read_only = on;

-- ═════════════════════════════════════════════════════════════════════
-- Run this block while connected to:  routing_vm
-- ═════════════════════════════════════════════════════════════════════
GRANT CONNECT ON DATABASE routing_vm TO nodemon_ro;
GRANT USAGE ON SCHEMA public TO nodemon_ro;

-- Read-layer tables (confirmed-granted-to-grafana_demo_ro set, authoritative).
GRANT SELECT ON
  public.lnd_node_info,
  public.lnd_node_forwards,
  public.lnd_node_channel_info,
  public.lnd_node_closed_channels,
  public.lnd_node_transaction_info,
  public.price_usd_cad
TO nodemon_ro;

-- A1 — OPTIONAL extended set referenced by the spec / later read phases but NOT in
-- the grafana_demo_ro enumerated grant list. CONFIRM each table EXISTS before
-- granting (uncomment as needed). Run this existence check first:
--
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('lnd_node_peer_info','lnd_node_pending_channels',
--                        'lnd_node_pending_sweeps','internal_rebalance_invoices',
--                        'lnd_restart');
--
-- GRANT SELECT ON
--   public.lnd_node_peer_info,
--   public.lnd_node_pending_channels,
--   public.lnd_node_pending_sweeps,
--   public.internal_rebalance_invoices,
--   public.lnd_restart
-- TO nodemon_ro;

-- Explicitly do NOT grant INSERT/UPDATE/DELETE/TRUNCATE anywhere.

-- ═════════════════════════════════════════════════════════════════════
-- Run this block while connected to:  ldk-lspd-main
-- (the role already exists cluster-wide; grant per-DB CONNECT + SELECT here)
-- ═════════════════════════════════════════════════════════════════════
GRANT CONNECT ON DATABASE "ldk-lspd-main" TO nodemon_ro;
GRANT USAGE ON SCHEMA public TO nodemon_ro;

GRANT SELECT ON
  public.lsps1_orders,
  public.lightning_channels,
  public.payments,
  public.transactions
TO nodemon_ro;

-- Explicitly do NOT grant INSERT/UPDATE/DELETE/TRUNCATE anywhere.

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (operator runs after granting, on EACH database)
-- Should list SELECT rows only; ANY write privilege row is a misconfiguration.
-- ─────────────────────────────────────────────────────────────────────
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'nodemon_ro'
ORDER BY table_name, privilege_type;

-- =====================================================================
-- nodemon_node — least-privilege READ-WRITE executor role + Row-Level Security
-- =====================================================================
-- OPERATOR-RUN ARTIFACT. Hand-authored; NOT a Drizzle migration (do not run
-- generate/migrate against this — the nodemon queue DB owner runs this block).
--
-- Run ONCE against the `nodemon` queue DB. This is the pre-placed least-privilege
-- credential the node-side executor (check-queue / apply-fee) connects to Postgres
-- with (D-05). It is a READ-WRITE sibling of the nodemon_ro pattern above, scoped to
-- the absolute minimum the executor needs, then hard-boxed by RLS to its own pubkey.
--
-- SECURITY (D-05 / D-07):
--   * scoped GRANTs on NAMED tables ONLY — never a blanket all-tables grant.
--   * NO DELETE / NO TRUNCATE / NO DDL anywhere — the executor can claim and
--     write back, never destroy. No INSERT on commands (rows originate dashboard-side).
--   * ROW LEVEL SECURITY is ENABLED + FORCED on all three queue tables, keyed on
--     current_setting('app.node_pubkey', true). The TWO-ARG form returns NULL (not an
--     error) when the GUC is unset → policies evaluate to no rows = FAIL-CLOSED.
--   * Each connection runs `SET LOCAL app.node_pubkey = '<identity_pubkey>'` (the node
--     derives it from `lncli getinfo`). Wrong-pubkey rows are physically INVISIBLE.
-- Replace <generated-strong-password> with an operator-generated secret; it goes ONLY
-- into the root-only node env file, never into source.

-- ─────────────────────────────────────────────────────────────────────
-- ROLE + least-privilege grants (mirror the nodemon_ro role+grant structure above).
-- ─────────────────────────────────────────────────────────────────────
CREATE ROLE nodemon_node WITH LOGIN PASSWORD '<generated-strong-password>';

GRANT CONNECT ON DATABASE nodemon TO nodemon_node;
GRANT USAGE ON SCHEMA public TO nodemon_node;

-- Scoped NAMED-table grants ONLY (per-node executor minimum):
GRANT SELECT, UPDATE ON commands TO nodemon_node;            -- claim/expire/reaper flips; NO INSERT/DELETE on commands
GRANT SELECT, INSERT ON command_executions TO nodemon_node;  -- SELECT for the D-10 rate-limit count; INSERT one outcome row
GRANT SELECT, INSERT ON command_audit TO nodemon_node;       -- append-only transition log

-- Explicitly do NOT grant DELETE/TRUNCATE/DDL anywhere (mirror the nodemon_ro rule).

-- ─────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — own-pubkey-only physical isolation (D-07).
-- ENABLE turns RLS on; FORCE makes it apply even to the table owner (Pitfall 6 belt
-- against owner-bypass). nodemon_node MUST NOT own these tables, or RLS is bypassed.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE commands           ENABLE ROW LEVEL SECURITY; ALTER TABLE commands           FORCE ROW LEVEL SECURITY;
ALTER TABLE command_executions ENABLE ROW LEVEL SECURITY; ALTER TABLE command_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE command_audit      ENABLE ROW LEVEL SECURITY; ALTER TABLE command_audit      FORCE ROW LEVEL SECURITY;

-- Policies keyed on the TWO-ARG current_setting (NULL-on-unset → fail-closed, zero rows).
-- WITH CHECK mirrors USING so a row can never be flipped OUT of the node's own scope.
CREATE POLICY node_own_commands ON commands
  USING      (node_pubkey = current_setting('app.node_pubkey', true))
  WITH CHECK (node_pubkey = current_setting('app.node_pubkey', true));

CREATE POLICY node_own_exec ON command_executions
  USING      (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)));

CREATE POLICY node_own_audit ON command_audit
  USING      (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (command_id IN (SELECT id FROM commands WHERE node_pubkey = current_setting('app.node_pubkey', true)));

-- ─────────────────────────────────────────────────────────────────────
-- SELF-APPROVE GUARD (HARDEN-01 / Q2) — DB-level state-machine enforcement.
-- CANONICAL SOURCE, kept in lock-step with the reproducible nodemon migration
-- drizzle/nodemon/0005_self_approve_guard.sql (that migration is what actually
-- installs this on the live nodemon DB via `drizzle-kit migrate`; this block is the
-- audited canonical copy alongside the grants it constrains).
--
-- The grant above (SELECT, UPDATE ON commands) plus RLS (which gates only node_pubkey,
-- NOT state edges) would otherwise let nodemon_node run
--   UPDATE commands SET state='approved' WHERE state='pending_approval'
-- i.e. SELF-APPROVE, bypassing the operator gate with no forged signature (T-18-24).
--
-- This BEFORE UPDATE trigger boxes the executor identity to an ALLOW-LIST of the
-- node/reaper-legal edges (mirrors src/lib/queue/state.ts LEGAL). Keyed on
-- current_user so it fires for a direct `nodemon_node` login AND for `SET ROLE
-- nodemon_node`; every OTHER role (dashboard-writer / owner running approve()/reject()
-- /enqueue) bypasses it, so the operator-approval path is untouched. RLS WITH CHECK
-- cannot express this — it sees only the NEW row, never OLD.state → NEW.state.
CREATE OR REPLACE FUNCTION nodemon_node_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user <> 'nodemon_node' THEN
    RETURN NEW;                       -- non-executor roles bypass (operator path intact)
  END IF;
  IF NEW.state = OLD.state THEN
    RETURN NEW;                       -- metadata-only bumps (e.g. claimed_at) allowed
  END IF;
  -- Executor-legal edges ONLY (node + reaper), mirroring state.ts LEGAL:
  IF (OLD.state = 'approved'  AND NEW.state = 'claimed')   OR  -- atomic claim
     (OLD.state = 'claimed'   AND NEW.state = 'executing') OR  -- commit1
     (OLD.state = 'executing' AND NEW.state = 'succeeded') OR  -- commit2 ok
     (OLD.state = 'executing' AND NEW.state = 'failed')    OR  -- commit2 fail
     (OLD.state = 'claimed'   AND NEW.state = 'approved')  OR  -- reaper release
     (OLD.state = 'claimed'   AND NEW.state = 'failed')    OR  -- reaper fail
     (NEW.state = 'expired'   AND OLD.state IN ('draft', 'pending_approval', 'approved', 'claimed')) -- TTL fail-close
  THEN
    RETURN NEW;
  END IF;
  -- Forbidden for the executor role — headline: pending_approval → approved (self-approve).
  RAISE EXCEPTION
    'nodemon_node may not transition commands.state % -> % (executor-illegal edge; approval is operator-only)',
    OLD.state, NEW.state
    USING ERRCODE = '42501'; -- insufficient_privilege
END;
$$;

DROP TRIGGER IF EXISTS nodemon_node_transition_guard ON commands;
CREATE TRIGGER nodemon_node_transition_guard
  BEFORE UPDATE ON commands
  FOR EACH ROW
  EXECUTE FUNCTION nodemon_node_transition_guard();

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (operator runs after granting, against the nodemon DB)
-- Should list SELECT/UPDATE/INSERT rows only; ANY DELETE/TRUNCATE row is a
-- misconfiguration. Separately confirm nodemon_node does NOT own the queue tables
-- (Pitfall 6) — otherwise FORCE RLS is the only thing keeping isolation intact.
-- ─────────────────────────────────────────────────────────────────────
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'nodemon_node'
ORDER BY table_name, privilege_type;

-- =====================================================================
-- nodemon_telemetry — least-privilege TELEMETRY collector role + Row-Level Security
-- =====================================================================
-- OPERATOR-RUN ARTIFACT. Hand-authored; NOT a Drizzle migration (do not run
-- generate/migrate against this — the nodemon DB owner runs this block as
-- owner/superuser, NOT as the role).
--
-- Run ONCE against the `nodemon` DB. This is the pre-placed least-privilege
-- credential the node-side telemetry collector (collect_telemetry.py) connects to
-- Postgres with (D-11). Telemetry rows are read-only OBSERVATIONS — there is NO HMAC
-- signing on this path; RLS + this least-privilege role ARE the integrity boundary
-- (D-11). The role is hard-boxed by RLS to its own host_id (+ node_pubkey for
-- node-scoped service rows), so a compromised node physically cannot forge another
-- host's telemetry.
--
-- SECURITY (D-04 / D-11):
--   * scoped GRANTs on NAMED tables ONLY — never a blanket all-tables grant.
--   * SELECT/INSERT on the 4 fact tables, plus scoped DELETE for the in-collector
--     21-day retention prune (D-02) — still RLS-boxed to the node's own host_id, so
--     the role can only prune ITS OWN rows.
--   * SELECT ONLY on the 2 dimensions (hosts, service_inventory) — they are seeded
--     out-of-band by the operator (db/seed-dimensions.sql, D-18); the SELECT/INSERT-only
--     role physically cannot INSERT dimension rows under RLS.
--   * NO UPDATE / NO TRUNCATE / NO DDL anywhere — telemetry is appended + pruned,
--     never mutated in place.
--   * ROW LEVEL SECURITY is ENABLED + FORCED on all four fact tables, keyed on the
--     TWO-ARG current_setting('app.host_id', true) (+ app.node_pubkey for service rows).
--     The two-arg form returns NULL (not an error) when the GUC is unset → policies
--     evaluate to no rows = FAIL-CLOSED.
--   * Each connection runs `SET LOCAL app.host_id = '<derived hostname>'` and, for
--     node-scoped service rows, `SET LOCAL app.node_pubkey = '<lncli getinfo
--     identity_pubkey>'`. Wrong-host / wrong-pubkey rows are physically INVISIBLE.
-- Replace <generated-strong-password> with an operator-generated secret; it goes ONLY
-- into the root-only node env file, never into source.

-- ─────────────────────────────────────────────────────────────────────
-- ROLE + least-privilege grants (mirror the nodemon_node role+grant structure above).
-- ─────────────────────────────────────────────────────────────────────
CREATE ROLE nodemon_telemetry WITH LOGIN PASSWORD '<generated-strong-password>';

GRANT CONNECT ON DATABASE nodemon TO nodemon_telemetry;
GRANT USAGE  ON SCHEMA public TO nodemon_telemetry;

-- Fact tables: INSERT observations + SELECT (for the in-collector prune count) +
-- scoped DELETE (the D-02 21-day retention prune — RLS still boxes it to host_id).
GRANT SELECT, INSERT, DELETE ON host_metrics, host_storage, service_health, chain_telemetry TO nodemon_telemetry;

-- Dimensions: SELECT ONLY — rows are seeded by the operator (db/seed-dimensions.sql,
-- D-18); the role cannot INSERT them under RLS.
GRANT SELECT ON hosts, service_inventory TO nodemon_telemetry;

-- Explicitly do NOT grant UPDATE/TRUNCATE/DDL anywhere (mirror the nodemon_ro /
-- nodemon_node rule). Telemetry is appended + pruned, never updated in place.

-- ─────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — host-axis physical isolation (D-04).
-- ENABLE turns RLS on; FORCE makes it apply even to the table owner (Pitfall 4 belt
-- against owner-bypass). nodemon_telemetry MUST NOT own these tables, or FORCE RLS is
-- bypassed — the migration (Plan 01) runs as the schema OWNER; this role gets the
-- scoped grants above and never owns the tables.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE host_metrics    ENABLE ROW LEVEL SECURITY; ALTER TABLE host_metrics    FORCE ROW LEVEL SECURITY;
ALTER TABLE host_storage    ENABLE ROW LEVEL SECURITY; ALTER TABLE host_storage    FORCE ROW LEVEL SECURITY;
ALTER TABLE chain_telemetry ENABLE ROW LEVEL SECURITY; ALTER TABLE chain_telemetry FORCE ROW LEVEL SECURITY;
ALTER TABLE service_health  ENABLE ROW LEVEL SECURITY; ALTER TABLE service_health  FORCE ROW LEVEL SECURITY;

-- Host-level facts: keyed on the TWO-ARG current_setting (NULL-on-unset → fail-closed,
-- zero rows). WITH CHECK mirrors USING so a row can never be written OUT of the node's
-- own host scope.
CREATE POLICY tel_own_host_metrics ON host_metrics
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_host_storage ON host_storage
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_chain ON chain_telemetry
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));

-- service_health: host_id always set; node_pubkey checked only for node-scoped rows
-- (host-level infra services leave node_pubkey NULL → the pubkey clause is skipped).
CREATE POLICY tel_own_service ON service_health
  USING      (host_id = current_setting('app.host_id', true)
              AND (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (host_id = current_setting('app.host_id', true)
              AND (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true)));

-- ═════════════════════════════════════════════════════════════════════
-- Phase 15 — data-collection expansion (COL-01/02/03): grants + RLS for the
-- 8 new tables (drizzle/nodemon/0003_*.sql). Run AFTER the 0003 migration,
-- against the nodemon DB, as owner/superuser. Extends the nodemon_telemetry
-- block above; everything above stays intact.
-- ═════════════════════════════════════════════════════════════════════

-- New fact tables: INSERT observations + SELECT + scoped DELETE (retention
-- prune, RLS-boxed to the node's own host_id) — mirrors the Phase-11 grant.
GRANT SELECT, INSERT, DELETE ON service_log_events, host_metrics_ext, host_cpu_core,
  host_disk_io, host_net_iface, pg_health TO nodemon_telemetry;

-- log_patterns is the DELIBERATE SINGLE UPDATE exception (Pitfall 1 / T-15-03):
-- the D-03 aggregate upsert (INSERT ... ON CONFLICT (host_id, signature) DO UPDATE)
-- fails with SQLSTATE 42501 without UPDATE. Every RAW fact table stays UPDATE-free.
GRANT SELECT, INSERT, UPDATE, DELETE ON log_patterns TO nodemon_telemetry;

-- Config dimension: SELECT ONLY — seeded out-of-band by db/seed-log-patterns.sql
-- (D-11); the role physically cannot INSERT it.
GRANT SELECT ON log_patterns_config TO nodemon_telemetry;

-- ─────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — host-axis physical isolation for the 7 new FACT tables
-- (T-15-02). log_patterns_config is a dimension — no RLS write policy needed.
-- ENABLE + FORCE per the Phase-11 pattern (FORCE belts against owner-bypass;
-- nodemon_telemetry MUST NOT own these tables).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE service_log_events ENABLE ROW LEVEL SECURITY; ALTER TABLE service_log_events FORCE ROW LEVEL SECURITY;
ALTER TABLE log_patterns       ENABLE ROW LEVEL SECURITY; ALTER TABLE log_patterns       FORCE ROW LEVEL SECURITY;
ALTER TABLE host_metrics_ext   ENABLE ROW LEVEL SECURITY; ALTER TABLE host_metrics_ext   FORCE ROW LEVEL SECURITY;
ALTER TABLE host_cpu_core      ENABLE ROW LEVEL SECURITY; ALTER TABLE host_cpu_core      FORCE ROW LEVEL SECURITY;
ALTER TABLE host_disk_io       ENABLE ROW LEVEL SECURITY; ALTER TABLE host_disk_io       FORCE ROW LEVEL SECURITY;
ALTER TABLE host_net_iface     ENABLE ROW LEVEL SECURITY; ALTER TABLE host_net_iface     FORCE ROW LEVEL SECURITY;
ALTER TABLE pg_health          ENABLE ROW LEVEL SECURITY; ALTER TABLE pg_health          FORCE ROW LEVEL SECURITY;

-- service_log_events ALSO carries node_pubkey → compound policy mirroring
-- tel_own_service above: host_id always checked; the pubkey clause is skipped
-- for host-level rows (node_pubkey NULL). Two-arg current_setting = fail-closed.
CREATE POLICY tel_own_log_events ON service_log_events
  USING      (host_id = current_setting('app.host_id', true)
              AND (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true)))
  WITH CHECK (host_id = current_setting('app.host_id', true)
              AND (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true)));

-- Plain host_id policies (two-arg current_setting, NULL-on-unset → fail-closed;
-- WITH CHECK mirrors USING so rows can never be written out of the host scope).
CREATE POLICY tel_own_log_patterns ON log_patterns
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_host_metrics_ext ON host_metrics_ext
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_host_cpu_core ON host_cpu_core
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_host_disk_io ON host_disk_io
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_host_net_iface ON host_net_iface
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));
CREATE POLICY tel_own_pg_health ON pg_health
  USING      (host_id = current_setting('app.host_id', true))
  WITH CHECK (host_id = current_setting('app.host_id', true));

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (operator runs after granting, against the nodemon DB)
-- Should list SELECT/INSERT/DELETE rows ONLY — with EXACTLY ONE exception:
-- log_patterns may (and must) show UPDATE (the D-03 upsert grant). ANY OTHER
-- UPDATE row, and ANY TRUNCATE row anywhere, is a misconfiguration.
-- Separately confirm nodemon_telemetry does NOT own the fact tables
-- (Pitfall 4) — otherwise FORCE RLS is the only thing keeping isolation intact.
-- ─────────────────────────────────────────────────────────────────────
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'nodemon_telemetry'
ORDER BY table_name, privilege_type;

-- Explicit misconfiguration probe: MUST return ZERO rows. Any row here means a
-- raw fact table gained UPDATE/TRUNCATE it must never have (T-15-03).
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'nodemon_telemetry'
  AND (privilege_type = 'TRUNCATE'
       OR (privilege_type = 'UPDATE' AND table_name <> 'log_patterns'))
ORDER BY table_name, privilege_type;

-- ─────────────────────────────────────────────────────────────────────
-- DASHBOARD WRITER (nodemon_rw) — role attributes + the reads it needs
-- ─────────────────────────────────────────────────────────────────────
-- Added 2026-07-31 after rebuilding `nodemon` on a test server from this file
-- and finding it did NOT reproduce a working install. Both gaps below were
-- verified against the live production role set; this section closes them.
--
-- (1) BYPASSRLS — MANDATORY, and previously undocumented.
--     The queue policies above are defined for PUBLIC (no `TO <role>` clause),
--     so they constrain EVERY role, and the tables carry FORCE ROW LEVEL
--     SECURITY (which defeats even owner-bypass). The dashboard never sets
--     `app.node_pubkey` — only a node executor does — so for the dashboard the
--     two-arg current_setting() returns NULL, every policy evaluates false, and
--     a plain INSERT fails with:
--        ERROR: new row violates row-level security policy for table "commands"
--     Production therefore grants nodemon_rw the BYPASSRLS attribute: RLS exists
--     to isolate NODE connections, not to constrain the trusted dashboard.
--     Rebuilding without this yields a dashboard that cannot enqueue at all.
-- Guarded: CI applies this file to an ephemeral DB that creates only
-- nodemon_node + nodemon_telemetry, so a bare ALTER ROLE nodemon_rw would abort
-- the run under ON_ERROR_STOP=1. Conditional keeps one artifact valid for CI,
-- a fresh test box, and production.
DO $rls$
BEGIN
  -- Only ALTER when the attribute actually differs: ALTER ROLE ... BYPASSRLS
  -- requires superuser, and re-asserting an already-correct value would fail
  -- needlessly for a non-superuser operator applying this file.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nodemon_rw' AND NOT rolbypassrls) THEN
    EXECUTE 'ALTER ROLE nodemon_rw BYPASSRLS';       -- dashboard writer: RLS-exempt
  ELSIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nodemon_rw') THEN
    RAISE NOTICE 'nodemon_rw absent — skipping BYPASSRLS (expected in CI)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nodemon_node' AND rolbypassrls) THEN
    EXECUTE 'ALTER ROLE nodemon_node NOBYPASSRLS';   -- executor: stays under policy
  END IF;
END
$rls$;

-- (2) Missing SELECT on five tables the dashboard actively queries.
--     `pg_health`, `host_metrics_ext`, `host_cpu_core`, `host_disk_io` and
--     `host_net_iface` are owned by nodemon_admin and were never granted to
--     nodemon_rw. src/lib/read/pg-health.ts and host-metrics-ext.ts query all
--     five. The reads are degrade()-wrapped, so nothing crashes — the failure is
--     SILENT: Host Detail's Postgres-health panel and the deep VM-metric panels
--     render empty in production, and the server log shows only
--        permission denied for table pg_health
--     Confirmed live 2026-07-30. Read-only: the dashboard never writes these.
-- Guarded for the same reason, and because these five tables are owned by
-- nodemon_admin and may not exist on every target.
DO $ro$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nodemon_rw') THEN
    RAISE NOTICE 'nodemon_rw absent — skipping dashboard read grants (expected in CI)';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['pg_health','host_metrics_ext','host_cpu_core',
                           'host_disk_io','host_net_iface'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO nodemon_rw', t);
    ELSE
      RAISE NOTICE 'table % absent — skipping grant', t;
    END IF;
  END LOOP;
END
$ro$;

-- VERIFICATION — (1) must return one row with rolbypassrls = t for nodemon_rw
-- and f for nodemon_node; (2) must return all five table names.
SELECT rolname, rolbypassrls
FROM pg_roles
WHERE rolname IN ('nodemon_rw','nodemon_node')
ORDER BY rolname;

SELECT table_name
FROM information_schema.role_table_grants
WHERE grantee = 'nodemon_rw'
  AND privilege_type = 'SELECT'
  AND table_name IN ('pg_health','host_metrics_ext','host_cpu_core','host_disk_io','host_net_iface')
ORDER BY table_name;

-- ─────────────────────────────────────────────────────────────────────
-- NOT OURS — third-party triggers on NodeMonitor tables (audit note)
-- ─────────────────────────────────────────────────────────────────────
-- Production carries five triggers installed by the external `sft_backup`
-- session-capture tooling, owned outside this project:
--   commands        AFTER UPDATE  -> capture_session_settings()   <-- queue table
--   host_metrics    AFTER INSERT  -> capture_session_settings(),
--                                    _capture_all(), _cap_allvars_trg()
--   service_health  AFTER INSERT  -> capture_session_settings()
-- They write to _captured_settings/_all_vars/_agent_captures (also not ours).
-- Flagged because the `commands` trigger runs on EVERY state transition of the
-- table whose state machine Phase 18 hardened — third-party code inside that
-- trust boundary, invisible to a source-only security scan. Not removed here:
-- it is another team's tooling. Review before the next security sign-off.
-- (A `pg_dump -t` of these tables carries the triggers but NOT their functions,
-- so any restore elsewhere fails until they are stripped — see db-dumps kit.)
