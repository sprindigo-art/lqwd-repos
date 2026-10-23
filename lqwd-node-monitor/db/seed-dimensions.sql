-- =====================================================================
-- seed-dimensions — one-time operator bootstrap of the telemetry DIMENSIONS
-- =====================================================================
-- OPERATOR-RUN ARTIFACT. Hand-authored DATA seed; NOT a Drizzle migration (do not
-- run generate/migrate against this) and NOT collector self-seed.
--
-- Run ONCE against the `nodemon` DB as owner/superuser, BEFORE the collector's first
-- `*/5` tick. WHY out-of-band (D-18): the collector connects as nodemon_telemetry,
-- which has SELECT/INSERT only on the FACT tables and SELECT ONLY on the dimensions
-- (hosts, service_inventory) — under FORCE RLS it physically cannot INSERT dimension
-- rows. So the operator seeds them here, mirroring the db/role-grants.sql out-of-band
-- bootstrap discipline.
--
-- SCOPE (D-12): seeds the SINGLE Phase-8 canary host + its declared services (10
-- rows total). The canary's expected/graded set (D-17) = the SVC-01 six + the
-- host-level bitcoind + postgres = 8 services, is_expected = true. TWO rows are
-- declared-but-NOT-expected (is_expected = false, read as NO-DATA / never DOWN,
-- RESEARCH Pitfall 5): `rebalance` (run_rebalance.sh, cron DISABLED on the live
-- fleet) and `esplora` (OQ-2: runs centrally, not on every node). So the seed is
-- 8 expected + 2 not-expected, NOT "9 + 1" — see the verification note below.
--
-- PLACEHOLDERS: replace <CANARY_HOST_ID> and <CANARY_PUBKEY> with the real values
-- confirmed against the live canary at runbook time (OQ-6). host_id is recommended to
-- be the host's stable hostname (`hostname -f`); node_pubkey is `lncli getinfo`
-- identity_pubkey. Node-scoped service rows carry the pubkey; host-level infra (the
-- bitcoind/esplora/postgres trio) leave node_pubkey NULL.

-- ─────────────────────────────────────────────────────────────────────
-- hosts — the canary dimension row (host_id → its node pubkeys, D-03).
-- A host can run 2+ nodes; node_pubkeys is an array. Seed the canary's pubkey(s).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO hosts (host_id, hostname, node_pubkeys)
VALUES ('<CANARY_HOST_ID>', '<CANARY_HOST_ID>', '{<CANARY_PUBKEY>}');

-- ─────────────────────────────────────────────────────────────────────
-- service_inventory — the 8 graded services (D-17) + `esplora`/`rebalance` not-expected.
-- Per-service detection_method / running_target / artifact_path / success_pattern /
-- error_pattern / expected_interval_seconds are VERBATIM from RESEARCH §"Service
-- Inventory & Two-Axis Detection". expected_interval_seconds is the per-service
-- freshness clock (NOT the ~15-min collector clock) so batch/6-hourly services don't
-- false-alarm. Infra trio = host-level (node_pubkey NULL); the six custom services
-- are node-scoped (node_pubkey = the canary pubkey).
--
-- DAEMON-LOG PATHS + RECONCILER OWNERSHIP (D-07): the standard fleet daemon-log
-- conventions the capture pipeline (16-02/16-03) tails are:
--   lnd       /lnd/logs/bitcoin/mainnet/lnd.log      (node-scoped; stable-name rename-archive)
--   bitcoind  /bitcoin/debug.log                     (host-level; stable-name self-rotate)
--   postgres  /var/log/postgresql/postgresql-*.log   (host-level; GLOB, newest-match by mtime)
-- The D-07 reconciler (scripts/fileserver/path-reconciler.sql) is the ONGOING
-- MAINTAINER of these artifact_path values and ALSO owns the guarded UNIQUE
-- (host_id, service_name) constraint its UPSERT depends on (the live schema has PK
-- `id` only). The Phase-8 canary added real bitcoind/lnd paths live-in-DB (RESEARCH
-- Runtime State Inventory); the reconciler UPSERT DO-UPDATEs artifact_path ONLY, so
-- it RECONCILES those canary-added rows rather than clobbering their detection_method
-- / is_expected / node_pubkey. This seed documents the same conventions so the two
-- never diverge. (The generic node-scoped `lnd` log row itself is auto-registered
-- fleet-wide by the reconciler off the hosts dimension, not hand-seeded here.)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO service_inventory
  (host_id, service_name, node_pubkey, detection_method, running_target,
   artifact_path, success_pattern, error_pattern, expected_interval_seconds, is_expected)
VALUES
  -- Infra trio (native probes; host-level; node_pubkey NULL) ──────────────
  -- DAEMON-LOG PATHS (D-07): artifact_path values below are the standard fleet
  -- conventions the path-reconciler (scripts/fileserver/path-reconciler.sql) OWNS
  -- and re-asserts. Seeded here so the two never diverge and so a fresh bootstrap
  -- already carries them; the reconciler DO-UPDATEs artifact_path ONLY, so these
  -- reconcile (self-heal on a path move) rather than clobber. bitcoind self-rotates
  -- to a stable-name /bitcoin/debug.log.
  ('<CANARY_HOST_ID>', 'bitcoind', NULL, 'native', 'systemctl is-active bitcoind',
   '/bitcoin/debug.log', NULL, NULL, 300, true),
  -- OQ-2 (lnd-ireland live proof): esplora runs centrally, NOT on every node →
  -- not-expected here so it reads no-data, never DOWN. Flip to true on hosts that run esplora locally.
  ('<CANARY_HOST_ID>', 'esplora', NULL, 'native', 'GET /blocks/tip/height',
   NULL, NULL, NULL, 300, false),
  -- postgres artifact_path is a GLOB (postgresql-*.log): the collector's
  -- resolve_artifact treats the '*' as a glob and resolves the NEWEST match by mtime.
  ('<CANARY_HOST_ID>', 'postgres', NULL, 'native', 'pg_isready',
   '/var/log/postgresql/postgresql-*.log', NULL, NULL, 300, true),
  -- SVC-01 six (node-scoped; node_pubkey = canary pubkey) ─────────────────
  ('<CANARY_HOST_ID>', 'aiLiquidityManager', '<CANARY_PUBKEY>', 'cron-mtime', NULL,
   '/var/log/liquidity_manager.log', 'completed successfully', 'failed with exit code', 300, true),
  -- OQ-5 (lnd-ireland live proof): real artifact is run_channelAcceptor.log (was channel_acceptor.log).
  ('<CANARY_HOST_ID>', 'channelAcceptor', '<CANARY_PUBKEY>', 'pgrep', 'channelAcceptorScript',
   '/lnd/channelAcceptor/run_channelAcceptor.log', NULL, NULL, 300, true),
  -- OQ-5 (fleet): internalRebalancer cron is */15 → 15-min freshness clock (900s).
  ('<CANARY_HOST_ID>', 'internalRebalancer', '<CANARY_PUBKEY>', 'cron-mtime', NULL,
   '/lnd/internalRebalance/internal_rebalance.log', NULL, NULL, 900, true),
  -- OQ-5 (lnd-ireland live proof): nodeAuditor is scheduled 0 0 * * * (DAILY), not hourly → 86400s.
  ('<CANARY_HOST_ID>', 'nodeAuditor', '<CANARY_PUBKEY>', 'cron-mtime', NULL,
   '/lnd/nodeAuditor/cron_nodeauditor.log', 'collection completed successfully',
   'collection failed with exit code', 86400, true),
  ('<CANARY_HOST_ID>', 'addressBalances', '<CANARY_PUBKEY>', 'cron-mtime', NULL,
   '/lnd/listAddresses/list_addresses.log', 'Successfully completed database update',
   'Database update failed with exit code', 21600, true),
  -- OQ-5 (lnd-ireland live proof): Monitoring is a 5-min cron go-script, not a persistent
  -- process — pgrep races the periodic run (false negatives), so detect by log mtime instead.
  ('<CANARY_HOST_ID>', 'Monitoring', '<CANARY_PUBKEY>', 'cron-mtime', NULL,
   '/lnd/check-node/cron_monitoring.log', NULL, NULL, 300, true),
  -- Declared-but-NOT-expected (is_expected = false): rebalance cron is disabled on the live
  -- fleet (D-17, RESEARCH Pitfall 5); esplora (above) runs centrally, not on this node.
  -- Both read as no-data, never DOWN.
  ('<CANARY_HOST_ID>', 'rebalance', '<CANARY_PUBKEY>', 'cron-mtime', NULL,
   '/lnd/rebalance/cron_rebalance.log', NULL, NULL, 21600, false);

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (operator runs after seeding, against the nodemon DB)
-- Should list 10 rows: 8 with is_expected = t and exactly TWO (esplora, rebalance) = f.
-- ─────────────────────────────────────────────────────────────────────
SELECT service_name, is_expected, expected_interval_seconds, artifact_path
FROM service_inventory
ORDER BY service_name;
