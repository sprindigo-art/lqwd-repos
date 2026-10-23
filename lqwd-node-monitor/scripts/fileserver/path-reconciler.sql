-- =====================================================================
-- path-reconciler — owner-run reconciler of per-host daemon-log paths (COL-06, D-07)
-- =====================================================================
-- OPERATOR-RUN ARTIFACT. Hand-authored SQL; NOT a schema migration (do NOT run
-- generate/migrate against this) and NOT collector self-seed — mirrors the
-- db/seed-dimensions.sql discipline.
--
-- Run against the `nodemon` DB as owner/superuser, SCHEDULED owner-side (e.g. an
-- owner cron invoking `psql -f scripts/fileserver/path-reconciler.sql`), SEPARATE
-- from the collector. WHY out-of-band (D-18): the collector connects as
-- nodemon_telemetry, which has SELECT ONLY on the dimensions (hosts,
-- service_inventory) — under FORCE RLS it physically cannot write dimension rows,
-- and NO write privilege on service_inventory is ever handed to it (Pitfall 7 —
-- the collector's SELECT-only warehouse boundary is preserved). This reconciler is
-- the ONLY writer of the daemon-log artifact_path values, run with owner creds.
--
-- PURPOSE (D-07): the Phase-8 canary showed native-probed daemon logs (lnd /
-- bitcoind / postgres) were UNREGISTERED, so extract_events had nothing to tail
-- (0/8639 PG FATALs captured). This reconciler auto-registers the standard
-- fleet-layout daemon-log paths for EVERY hosts row via a convention-driven UPSERT
-- (no SSH, no per-node probing) so the capture pipeline (16-02/16-03) has a live
-- path surface each tick. Re-running self-heals: it re-asserts the convention
-- paths and picks up any newly-added hosts, WITHOUT clobbering canary-tuned rows.
--
-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 — Guarded UNIQUE (host_id, service_name) constraint (owner-side DDL).
-- The LIVE schema (src/lib/db/schema/nodemon.ts service_inventory) has PK `id`
-- (uuid) ONLY and NO composite unique on (host_id, service_name). Without this
-- constraint the ON CONFLICT (host_id, service_name) in STEP 2 raises:
--   "no unique or exclusion constraint matching the ON CONFLICT specification".
-- ADD CONSTRAINT has no IF NOT EXISTS, so we mirror 16-04's owner-side
-- `ADD COLUMN IF NOT EXISTS` idempotency discipline with a pg_constraint guard so
-- re-runs never error or duplicate. This is owner-side SQL — NOT a schema
-- generate/migrate step and NOT a collector write.
--
-- SCHEMA-TYPE NOTE (for future readers): the type surface for service_inventory in
-- src/lib/db/schema/nodemon.ts is NOT edited by this plan, but it SHOULD document
-- this owner-created UNIQUE (host_id, service_name) constraint so the type surface
-- and the live DB stay in sync for future readers.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_inventory_host_service_uniq'
  ) THEN
    ALTER TABLE service_inventory
      ADD CONSTRAINT service_inventory_host_service_uniq UNIQUE (host_id, service_name);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 — Convention-driven UPSERT of the standard daemon-log paths (D-07).
-- Keyed off the `hosts` dimension CROSS JOIN an inline VALUES list carrying the
-- three fleet daemon conventions (RESEARCH Pattern 7). Fanning off `hosts` means a
-- NEW host auto-registers all three paths on the next scheduled run with no SSH.
--
--   service_name  artifact_path (convention)                    rotation style
--   ────────────  ────────────────────────────────────────────  ─────────────────────
--   lnd           /lnd/logs/bitcoin/mainnet/lnd.log             stable-name rename-archive
--   bitcoind      /bitcoin/debug.log                            stable-name (bitcoind self-rotates)
--   postgres      /var/log/postgresql/postgresql-*.log          GLOB — collector resolve_artifact
--                                                                picks the newest match by mtime
--
-- CR-01 (16-REVIEW): a freshly-inserted daemon row MUST carry the columns the
-- collector's capture pipeline requires, or it is silently dropped:
--   - fetch_inventory() grades ONLY the expected set (`is_expected` truthy); a
--     NULL is_expected -> falsy -> the row is filtered out BEFORE the tail loop,
--     so the daemon log (lnd.log [CRT] lines etc.) is NEVER tailed.
--   - detection_method drives BOTH the RUNNING axis AND the tail dispatch.
-- So the INSERT sets is_expected=true and a 300s freshness clock, and a
-- PER-SERVICE detection_method (see below) for the daemon-log rows it creates.
--
-- UAT-16 (lnd-ireland canary 2026-07-17): the earlier revision hardcoded
-- detection_method='native' for ALL THREE daemons. That is correct for the infra
-- trio (bitcoind/postgres are probed by grade_native_service), but WRONG for lnd:
-- grade_native_service has no lnd branch, so a native lnd row grades as
-- "unknown native service" (running=None) — mis-reading lnd health on every host
-- that lacked a prior lnd row. lnd is a long-lived PROCESS, so it must be
-- detection_method='pgrep' with running_target='lnd' (pgrep -f lnd) — mirroring
-- the proven lnd-ireland row (running_target='lnd', error_pattern='[ERR]'). A
-- non-'native' method routes lnd through grade_service, which STILL tails the log
-- via read_since(artifact_path) — so daemon-log capture (COL-04/05) is preserved;
-- only the RUNNING axis is corrected. error_pattern='[ERR]' feeds the
-- service_health.error_count axis (capture itself is by log_patterns_config match,
-- not this substring).
--
-- ON CONFLICT DO UPDATE re-asserts artifact_path (self-heal on a path move) and
-- BACKFILLS detection_method / running_target / error_pattern / is_expected via
-- COALESCE(existing, excluded) — it only fills a NULL, so canary-tuned rows
-- (db/seed-dimensions.sql, which already carry native/true) are NEVER overwritten
-- and expected_interval_seconds / node_pubkey are left untouched. This RECONCILES
-- rather than CLOBBERS. NOTE: because COALESCE never overwrites a non-NULL
-- detection_method, hosts whose lnd row was ALREADY seeded 'native' by the earlier
-- revision are NOT healed by this UPSERT — STEP 3 below repairs them explicitly. No
-- collector write privilege is introduced here (owner-run SQL only).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO service_inventory
  (host_id, service_name, artifact_path, detection_method, running_target, error_pattern, is_expected, expected_interval_seconds)
SELECT h.host_id, conv.service_name, conv.artifact_path, conv.detection_method, conv.running_target, conv.error_pattern, true, 300
FROM hosts h
CROSS JOIN (
  VALUES
    ('lnd',      '/lnd/logs/bitcoin/mainnet/lnd.log',     'pgrep',  'lnd',  '[ERR]'),
    ('bitcoind', '/bitcoin/debug.log',                    'native', NULL,   NULL),
    ('postgres', '/var/log/postgresql/postgresql-*.log',  'native', NULL,   NULL)
) AS conv(service_name, artifact_path, detection_method, running_target, error_pattern)
ON CONFLICT (host_id, service_name)
DO UPDATE SET
  artifact_path = EXCLUDED.artifact_path,
  detection_method = COALESCE(service_inventory.detection_method, EXCLUDED.detection_method),
  running_target = COALESCE(service_inventory.running_target, EXCLUDED.running_target),
  error_pattern = COALESCE(service_inventory.error_pattern, EXCLUDED.error_pattern),
  is_expected = COALESCE(service_inventory.is_expected, EXCLUDED.is_expected);

-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 — Heal lnd rows wrongly seeded detection_method='native' (UAT-16).
-- STEP 2's COALESCE deliberately preserves an existing non-NULL detection_method,
-- so it will NOT flip an lnd row that an earlier reconciler revision already set to
-- 'native'. lnd is a long-lived process with no grade_native_service branch, so a
-- native lnd row can only mis-grade (running=None, "unknown native service"). This
-- UPDATE is the one legitimate correction: force any 'native' lnd row to the pgrep
-- convention. It is idempotent — a no-op once every lnd row is 'pgrep' — and only
-- backfills running_target/error_pattern where they are NULL (never clobbers a
-- canary-tuned value). bitcoind/postgres are untouched (they are correctly native).
-- ─────────────────────────────────────────────────────────────────────
UPDATE service_inventory
SET detection_method = 'pgrep',
    running_target  = COALESCE(running_target, 'lnd'),
    error_pattern   = COALESCE(error_pattern, '[ERR]')
WHERE service_name = 'lnd'
  AND detection_method = 'native';

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (owner runs after reconciling, against the nodemon DB).
-- Asserts EVERY hosts row now carries lnd/bitcoind/postgres artifact_path, that
-- the postgres row carries the '*' glob resolve_artifact resolves newest-match, and
-- that NO lnd row is left detection_method='native' (UAT-16 heal check).
-- ─────────────────────────────────────────────────────────────────────
-- Should return 0: no lnd row may remain 'native' after STEP 3.
SELECT count(*) AS lnd_native_remaining
FROM service_inventory
WHERE service_name = 'lnd' AND detection_method = 'native';

SELECT si.host_id,
       bool_and(si.service_name = 'lnd')      FILTER (WHERE si.service_name = 'lnd')      AS has_lnd,
       bool_and(si.artifact_path IS NOT NULL)                                             AS all_paths_set,
       bool_or(si.service_name = 'postgres' AND si.artifact_path LIKE '%*%')              AS postgres_glob_present
FROM service_inventory si
JOIN hosts h ON h.host_id = si.host_id
WHERE si.service_name IN ('lnd', 'bitcoind', 'postgres')
GROUP BY si.host_id
ORDER BY si.host_id;
