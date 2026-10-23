-- seed-all-nodes.sql — fleet telemetry dimension seed (run ONCE as OWNER on the nodemon DB)
--   sudo -u postgres psql -d nodemon -f seed-all-nodes.sql
-- Idempotent: hosts upserts on host_id; service_inventory is DELETE+re-INSERT per host
-- (so re-running is safe AND it repairs lnd-ireland's earlier interval values).
-- All 16 nodes are type=routing → one uniform service profile.
-- NOTE: CTEs scope to a single statement, so the node list is repeated per statement.

BEGIN;

-- 1) hosts upsert
WITH nodes(host_id, alias, pubkey) AS (VALUES
  ('lnd-canada'::text,  'LQWD-Canada'::text,     '0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1'::text),
  ('lnd-southkorea',    'LQWD-SouthKorea',       '036982a2b2398b9835a9d6cd2371a08c6e221f9e1b879008959dae28413af78067'),
  ('lnd-tokyo',         'LQWD-Japan',            '031a01e29587952eda0ed5d10c4e79bf0fc88d61aeae89e8a7ea7c036badb8c793'),
  ('ip-10-0-5-202',     'LQWD-USA',              '036afe432cad4fd5a5671d9d95d3d3671e315825efdc10f734dba1f47a711a276b'),
  ('lnd-indonesia',     'LQWD-Indonesia',        '02b1afba6153f9668ea0be12f4dbfc396a782a52d3eccf868732a1088eb2cc5d69'),
  ('lnd-india',         'LQWD-India',            '02b20c736785ce8e801d50ae0bb6f6daa534a992445b44f4b6255ebedebd84c037'),
  ('lnd-brazil',        'LQWD-Brazil',           '02c4ad243f18d8ed3a40e98725bc6a795b941d7e3d64be9f7dab38144f1eb09cb8'),
  ('lnd-hongkong',      'LQWD-HongKong',         '02eb9dfcbe445ea0366635e932db3bf78e95eb5241ba9bd3f1c72b48fa9f3fc234'),
  ('lnd-italy',         'LQWD-Italy',            '0313827390afcae8876dc7d56c417d5698effb237e6eab45a364ac71e9e2044c9a'),
  ('lnd-singapore',     'LQWD-Singapore',        '026756a68c3437bdcdff8f43585db665fdd9585d082f4624d51bd0346bc396a73e'),
  ('lnd-ireland',       'LQWD-Ireland',          '0230b207b3385feddb1ed18d5c7a808015aeb668aaf9bf980bee62465a382112c1'),
  ('lnd-africa',        'LQWD-Africa',           '036fc6041f67b673e9357118eb2b74cb71aebf7e1e3535edcdba3b808b2a790c0a'),
  ('lnd-australia',     'LQWD-Australia',        '03e4f3d7ccf98bdbf24085b948f204a6c0c0b4464a7572cbac85c746085b14bbc9'),
  ('lnd-sweeden',       'LQWD-Sweden',           '032312e5e15e89211df36e473d76af60672e3efebfe42a9b2113acbb456050b502'),
  ('lnd-england',       'LQWD-England',          '02be8a325c61af50aebc2004e3a3db0dc8d255f2fb95036738392172f739fa1c3a'),
  ('lnd-france',        'LQWD-France',           '032ae3168ba52314da581d6b6693c562b437a9cf805933d4d69e7801547e07302e')
)
INSERT INTO hosts (host_id, hostname, node_pubkeys)
SELECT host_id, alias, ARRAY[pubkey] FROM nodes
ON CONFLICT (host_id) DO UPDATE SET hostname = EXCLUDED.hostname, node_pubkeys = EXCLUDED.node_pubkeys;

-- 2) clear service_inventory for these hosts (no unique key on host/service → clean replace)
DELETE FROM service_inventory
WHERE host_id IN ('lnd-canada','lnd-southkorea','lnd-tokyo','ip-10-0-5-202','lnd-indonesia',
                  'lnd-india','lnd-brazil','lnd-hongkong','lnd-italy','lnd-singapore','lnd-ireland',
                  'lnd-africa','lnd-australia','lnd-sweeden','lnd-england','lnd-france');

-- 3) re-seed service_inventory = nodes × service template
WITH nodes(host_id, pubkey) AS (VALUES
  ('lnd-canada'::text, '0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1'::text),
  ('lnd-southkorea',   '036982a2b2398b9835a9d6cd2371a08c6e221f9e1b879008959dae28413af78067'),
  ('lnd-tokyo',        '031a01e29587952eda0ed5d10c4e79bf0fc88d61aeae89e8a7ea7c036badb8c793'),
  ('ip-10-0-5-202',    '036afe432cad4fd5a5671d9d95d3d3671e315825efdc10f734dba1f47a711a276b'),
  ('lnd-indonesia',    '02b1afba6153f9668ea0be12f4dbfc396a782a52d3eccf868732a1088eb2cc5d69'),
  ('lnd-india',        '02b20c736785ce8e801d50ae0bb6f6daa534a992445b44f4b6255ebedebd84c037'),
  ('lnd-brazil',       '02c4ad243f18d8ed3a40e98725bc6a795b941d7e3d64be9f7dab38144f1eb09cb8'),
  ('lnd-hongkong',     '02eb9dfcbe445ea0366635e932db3bf78e95eb5241ba9bd3f1c72b48fa9f3fc234'),
  ('lnd-italy',        '0313827390afcae8876dc7d56c417d5698effb237e6eab45a364ac71e9e2044c9a'),
  ('lnd-singapore',    '026756a68c3437bdcdff8f43585db665fdd9585d082f4624d51bd0346bc396a73e'),
  ('lnd-ireland',      '0230b207b3385feddb1ed18d5c7a808015aeb668aaf9bf980bee62465a382112c1'),
  ('lnd-africa',       '036fc6041f67b673e9357118eb2b74cb71aebf7e1e3535edcdba3b808b2a790c0a'),
  ('lnd-australia',    '03e4f3d7ccf98bdbf24085b948f204a6c0c0b4464a7572cbac85c746085b14bbc9'),
  ('lnd-sweeden',      '032312e5e15e89211df36e473d76af60672e3efebfe42a9b2113acbb456050b502'),
  ('lnd-england',      '02be8a325c61af50aebc2004e3a3db0dc8d255f2fb95036738392172f739fa1c3a'),
  ('lnd-france',       '032ae3168ba52314da581d6b6693c562b437a9cf805933d4d69e7801547e07302e')
),
svc(service_name, node_scoped, detection_method, running_target, artifact_path, success_pattern, error_pattern, expected_interval_seconds, is_expected) AS (VALUES
  ('bitcoind'::text,     false, 'native'::text, 'systemctl is-active bitcoind'::text, NULL::text,                                       NULL::text,                               NULL::text,                              300,  true),
  ('esplora',            false, 'native',       'GET /blocks/tip/height',             NULL,                                             NULL,                                     NULL,                                    300,  false),
  ('postgres',           false, 'native',       'pg_isready',                         NULL,                                             NULL,                                     NULL,                                    300,  true),
  ('aiLiquidityManager', true,  'cron-mtime',   NULL,                                 '/var/log/liquidity_manager.log',                 'completed successfully',                 'failed with exit code',                 300,  true),
  ('channelAcceptor',    true,  'pgrep',        'channelAcceptorScript',              '/lnd/channelAcceptor/run_channelAcceptor.log',   NULL,                                     NULL,                                    300,  true),
  ('internalRebalancer', true,  'cron-mtime',   NULL,                                 '/lnd/internalRebalance/internal_rebalance.log',  NULL,                                     NULL,                                    900,  true),
  ('nodeAuditor',        true,  'cron-mtime',   NULL,                                 '/lnd/nodeAuditor/cron_nodeauditor.log',          'collection completed successfully',      'collection failed with exit code',      86400, true),
  ('addressBalances',    true,  'cron-mtime',   NULL,                                 '/lnd/listAddresses/list_addresses.log',          'Successfully completed database update', 'Database update failed with exit code', 21600, true),
  ('Monitoring',         true,  'cron-mtime',   NULL,                                 '/lnd/check-node/cron_monitoring.log',            NULL,                                     NULL,                                    300,  true),
  ('rebalance',          true,  'cron-mtime',   NULL,                                 '/lnd/rebalance/cron_rebalance.log',              NULL,                                     NULL,                                    21600, false)
)
INSERT INTO service_inventory
  (host_id, service_name, node_pubkey, detection_method, running_target,
   artifact_path, success_pattern, error_pattern, expected_interval_seconds, is_expected)
SELECT n.host_id, s.service_name,
       CASE WHEN s.node_scoped THEN n.pubkey ELSE NULL END,
       s.detection_method, s.running_target, s.artifact_path, s.success_pattern, s.error_pattern,
       s.expected_interval_seconds, s.is_expected
FROM nodes n CROSS JOIN svc s;

COMMIT;

-- VERIFY: expect 16 hosts; 160 service rows (16 × 10) = 144 expected + 16 not.
SELECT count(*) AS hosts FROM hosts;
SELECT count(*) AS service_rows,
       count(*) FILTER (WHERE is_expected) AS expected,
       count(*) FILTER (WHERE NOT is_expected) AS not_expected
FROM service_inventory;
SELECT host_id, count(*) FILTER (WHERE is_expected) AS expected_per_host
FROM service_inventory GROUP BY host_id ORDER BY host_id;
