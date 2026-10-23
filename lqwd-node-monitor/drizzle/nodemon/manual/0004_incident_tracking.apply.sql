-- Phase 17 (17-03) — incident_tracking, applied out-of-band with an admin/owner role.
-- Scoped to Phase 17 ONLY. Deliberately excludes the log_patterns_config.category
-- ALTER that drizzle bundled into 0004 (that is pre-existing Phase-16 drift and that
-- table does not exist in this DB — handle it separately).
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS "incident_tracking" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "incident_key"             text NOT NULL,
  "opened_at"                timestamptz DEFAULT now() NOT NULL,
  "acked_at"                 timestamptz,
  "owner"                    text,
  "snooze_until"             timestamptz,
  "muted_at_severity"        text,
  "muted_critical_children"  integer,
  "cleared_at"               timestamptz
);

-- D-01: at most one ACTIVE (uncleared) tracking row per incident_key
CREATE UNIQUE INDEX IF NOT EXISTS "incident_tracking_active_key_uniq"
  ON "incident_tracking" USING btree ("incident_key")
  WHERE "cleared_at" IS NULL;

CREATE INDEX IF NOT EXISTS "incident_tracking_key_idx"
  ON "incident_tracking" USING btree ("incident_key");

-- The app connects as nodemon_rw (no DDL). Grant it CRUD on the new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "incident_tracking" TO "nodemon_rw";

COMMIT;
