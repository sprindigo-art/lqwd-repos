-- =====================================================================
-- seed-log-patterns — one-time operator bootstrap of log_patterns_config
-- =====================================================================
-- OPERATOR-RUN ARTIFACT. Hand-authored DATA seed; NOT a Drizzle migration (do
-- not run generate/migrate against this) and NOT collector self-seed — mirrors
-- db/seed-dimensions.sql discipline.
--
-- Run ONCE against the `nodemon` DB as owner/superuser, AFTER the 0003
-- migration + the Phase-15 role-grants block, BEFORE the collector's first
-- log-persisting tick. WHY out-of-band (D-11): the collector connects as
-- nodemon_telemetry, which has SELECT ONLY on log_patterns_config — it
-- physically cannot INSERT config rows.
--
-- SOURCE (Phase-16 re-derivation, COL-06 / D-01/D-03): the classification is
-- re-derived from REAL fleet + canary log signatures, REPLACING the earlier
-- Obsidian `LQWD Node Log Reviews` transcription that the canary proved wrong
-- (real HSWC errors are "broken pipe"/"failing link", never "Unhandled error").
-- The vault stays a BUILD-TIME reference only — after this seed all patterns are
-- DB-resident with ZERO runtime vault dependency (D-11).
--
-- TAXONOMY (Phase-16): classification ∈ {info, warn, critical} — plain text,
-- SQL-tunable (D-05): retune classification/suppress/category with an UPDATE, no
-- fleet redeploy, and reads re-filter immediately (D-04). The opaque ap11/ap12
-- codes are GONE — AP-11 is a read-time RATE signature (see below) and AP-12 is
-- a pg_health COUNTER detector (telemetry-bands.ts / ap12-advisory.ts, D-04),
-- neither is a log-line class. Each row now carries a human-readable `category`
-- label (e.g. postgres-connection-exhaustion, channel-reconnect) for the
-- Phase-17 AI/incident layer, instead of the opaque codes.
--
-- match_expression is a PYTHON REGEX (collect_telemetry._classify → re.search,
-- D-05). Literal metacharacters MUST be escaped: the LND log-level tags are
-- written \[WRN\]/\[ERR\]/\[CRT\] so the brackets stay literal (an unescaped
-- [WRN] would be a char-class matching W|R|N and over-match). Alternations use
-- `a|b`; `.*` spans an intra-line gap. standard_conforming_strings=on keeps the
-- backslashes literal in these single-quoted string literals.
--
-- SUPPRESSION IS PER-ROW, RESOLVED VIA config_id (NOT classification). Each row
-- carries its own `suppress` flag and its own `id`; the collector records the
-- matched row's id on each event as service_log_events.config_id, and the
-- reader joins THIS table on that primary key (service-log-events.ts). That is
-- why an info row can be suppressed at read (exemplars hidden) while its
-- AGGREGATE COUNT still survives in log_patterns (info is count-only at collect
-- time — D-06), and why the warn `SQLSTATE 40001` row stays suppress=false and
-- SURVIVES at read (rate-banded there) even though other warn rows differ — the
-- event points at exactly one config row via the PK join.
--
-- AP-11 note: AP-11 is a RATE signature (>=50 closes/hour), derived at read
-- time — the `closechannel` row below only tags captured exemplar lines as
-- warn/close-event; it is NOT itself a mass-close verdict.

-- ─────────────────────────────────────────────────────────────────────
-- OWNER-APPLIED ADDITIVE DDL (Phase-16, RESEARCH A5). Additive nullable column
-- only — applied owner-side by THIS operator-run SQL, NEVER by drizzle-kit
-- push/generate/migrate (the config table is externally managed; the collector
-- grant stays SELECT-only — T-16-04). Idempotent so a re-run is safe.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE log_patterns_config ADD COLUMN IF NOT EXISTS category text;

-- ─────────────────────────────────────────────────────────────────────
-- RECONCILE existing rows (Runtime State Inventory / A6). Rows seeded before
-- Phase-16 carry the OLD {benign,ap11,ap12,other} classification. This seed is
-- authoritative: clear and reseed so the LIVE set is 100% new-taxonomy. This is
-- a DIMENSION reset, not a fact delete — historical service_log_events rows keep
-- their config_id; a now-deleted id LEFT-JOINs to nothing → COALESCE(suppress)
-- is false → the line SURVIVES as unmatched (A6: accept historical mixed
-- classification, NO backfill). Owner-run only (collector cannot DELETE here).
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM log_patterns_config;

INSERT INTO log_patterns_config (match_expression, service, level, classification, category, suppress, note)
VALUES
  -- info tier — count-only at collect (D-06); exemplars hidden at read ────────
  -- Aggregate count still survives in log_patterns even when suppress=true here.
  ('Outbound peer has old chain', 'bitcoind', 'info', 'info', 'chain-sync-noise', true,
   'was BP-001; chain-sync noise, alert only >10/day x 3d'),
  ('Flushing large.*UTXO set to disk', 'bitcoind', 'info', 'info', 'utxo-flush-noise', true,
   'was BP-002; watch flush size growth'),
  ('\[WRN\] ACSM: Peer is banned', 'lnd', 'info', 'info', 'peer-ban-noise', true,
   'was BP-003; restricted-slot hygiene'),
  ('\[WRN\] HSWC.*insufficient bandwidth', 'lnd', 'info', 'info', 'routing-normal', true,
   'was BP-004; routing-normal'),
  ('rate limiting gossip replies', 'lnd', 'info', 'info', 'gossip-backpressure', true,
   'was BP-006; back-pressure normal'),
  -- Real canary connection noise (re-derivation table) ───────────────────────
  ('CMGR.*Unknown connid=', 'lnd', 'info', 'info', 'conn-noise', true,
   'CMGR connection churn; count-only'),
  ('CMGR.*Cant accept connection.*i/o timeout', 'lnd', 'info', 'info', 'conn-noise', true,
   'CMGR inbound i/o timeout; count-only'),
  ('PEER.*peer exiting|resend failed', 'lnd', 'info', 'info', 'peer-churn', true,
   'PEER churn/resend; count-only'),
  -- warn tier — SURVIVES at read (suppress=false), rate/exemplar surfaced ─────
  -- BP-005: benign at normal rate (400-800/day), AP-12b band at >=10x — kept
  -- suppress=FALSE so it SURVIVES at read and is rate-banded there. The config_id
  -- PK join is what keeps this visible independent of any shared class.
  ('could not serialize|SQLSTATE 40001', 'postgres', 'warn', 'warn', 'pg-serialization-retry', false,
   'was BP-005; benign 400-800/day; AP-12b band >=10x — rate-banded at read, NEVER suppressed'),
  -- REPLACES the Obsidian-proven-wrong "\[ERR\] HSWC.*Unhandled error" row: the
  -- real canary HSWC errors are failing-link / broken-pipe / resuming-link-failed.
  ('HSWC.*failing link|HSWC.*broken pipe', 'lnd', 'warn', 'warn', 'channel-reconnect', false,
   'real HSWC link failure (replaces the proven-wrong Unhandled-error row)'),
  ('HSWC.*resuming link failed', 'lnd', 'warn', 'warn', 'channel-reconnect', false,
   'HSWC link resume failure; reconnect churn'),
  ('SWPR.*Failed to sweep|UTXN.*Failed to sweep', 'lnd', 'warn', 'warn', 'sweep-failure', false,
   'sweeper/utxo-nursery sweep failure'),
  -- AP-11 is a read-time RATE signature (>=50 closes/hr), NOT a log class — this
  -- row only TAGS exemplar close lines as warn/close-event (was ap11).
  ('closechannel', 'lnd', 'warn', 'warn', 'close-event', false,
   'close-event exemplar tag; AP-11 mass-close is a read-time RATE signature, not this class (was ap11)'),
  ('\[ERR\] GRDB: UpdateEdgePolicy failed.*SQLSTATE 40001', 'lnd', 'warn', 'warn', 'graph-serialization-retry', false,
   'LND graph-DB serialization retry (was ap12b log surface; AP-12 detection is a pg_health counter — D-04)'),
  -- critical tier — hard-zero / incident bands, SURVIVES at read ──────────────
  ('FATAL: sorry, too many clients already', 'postgres', 'critical', 'critical', 'postgres-connection-exhaustion', false,
   'PG connection exhaustion (was ap12a log surface; AP-12 detection is a pg_health counter — D-04)'),
  ('40P01|deadlock detected', 'postgres', 'critical', 'critical', 'pg-deadlock', false,
   'Deadlock cluster >5/hr'),
  ('FATAL', 'postgres', 'critical', 'critical', 'postgres-fatal', false,
   'PG general FATAL; healthy band = 0/month'),
  ('\[CRT\]', 'lnd', 'critical', 'critical', 'lnd-critical', false,
   'LND critical; hard-zero band; major incident'),
  ('Out of memory: Killed', 'kernel', 'critical', 'critical', 'oom-kill', false,
   'OOM hard-zero band'),
  ('EXT4-fs error', 'kernel', 'critical', 'critical', 'filesystem-error', false,
   'Filesystem/I-O error; hard-zero band');

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION (operator runs after seeding)
-- Expect 20 rows; exactly 8 suppress=true (the 8 info-tier count-only rows).
-- Every row MUST have classification IN ('info','warn','critical') and a
-- non-null category. No pre-Phase-16 opaque codes remain (taxonomy_ok asserts).
-- ─────────────────────────────────────────────────────────────────────
SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE suppress) AS suppressed_rows,
  bool_and(classification IN ('info', 'warn', 'critical')) AS taxonomy_ok,
  bool_and(category IS NOT NULL) AS category_ok
FROM log_patterns_config;

SELECT match_expression, classification, category, suppress FROM log_patterns_config
ORDER BY classification, category, match_expression;
