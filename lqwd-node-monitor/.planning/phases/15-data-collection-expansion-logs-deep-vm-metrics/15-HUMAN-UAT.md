---
status: resolved
phase: 15-data-collection-expansion-logs-deep-vm-metrics
source: [15-VERIFICATION.md]
started: 2026-07-14T17:15:00Z
updated: 2026-07-15T21:52:00Z
---

## Current Test

All tests passed. Test 1 (live canary) + Test 2 (operator visual render) both confirmed.

## Tests

### 1. Live canary bootstrap + tick (COL-01/02/03)
expected: Apply `drizzle/nodemon/0003_moaning_randall.sql` → the Phase-15 `db/role-grants.sql` delta → `db/seed-log-patterns.sql` (in that order, as owner) to the canary nodemon DB, deploy the expanded collector, and run one `*/5` tick. All 8 new tables receive ≥1 canary row; no SQLSTATE 42501 (grant/RLS misconfig); no cross-host row leakage (T-15-02); secret redaction held on message/context_lines (T-15-05).
result: PASSED (2026-07-15, canary `lnd-ireland`, nodemon DB on `postgres-alby`).
evidence:
- Apply order executed as DB owner (`nodemon_admin`): migration 0003 (8 tables + host_storage inode cols), Phase-15 grants delta (misconfiguration probe returned 0 rows — UPDATE only on `log_patterns`; FORCE RLS `t/t` on all 7 fact tables), seed (15 rows / 6 suppress=true; escaped-bracket + alternation patterns confirmed = CR-01 fix live).
- One `*/5` tick landed rows in all 8 tables under `host_id='lnd-ireland'`: service_log_events 14, host_metrics_ext 4, host_cpu_core 8 (2 cores), host_disk_io 20 (5 devs), host_net_iface 4 (1 iface), pg_health 4, log_patterns 7. Tick exit 0, no SQLSTATE 42501.
- Isolation (T-15-02): FORCE RLS confirmed — `nodemon_admin` (non-superuser owner) sees 0 rows without app.host_id; superuser query shows each host's rows correctly boxed, no cross-host leakage.
- Redaction (T-15-05): `service_log_events.message` spot-checked — no macaroon/secret/token strings.
- CR-02 validated LIVE: a transient `lncli getinfo` failure (`pubkey=none`) skipped node-scoped rows and preserved host vitals (exit 0) instead of rolling back the tick.
- pg_health captured the real too-many-clients/fatal counters (this node has an active too-many-clients condition), proving the authoritative AP-12 counter path.
- service_health confirms every service actively health-checked (running/functioning per service; addressBalances correctly flagged functioning=false with error_count).

### 2. Operator visual render (COL-01/03)
expected: Open a node page (`/{pubkey}`) and a service page (`/{pubkey}/service/{service}`) against a DB with real rows. NodeLogsStream / ServiceLogTail render real newest-first rows with benign patterns suppressed and no secret leakage; the three deep-VM VmVitals charts (per-core CPU busy, disk-I/O delta, net errors+drops delta) render real data or an honest StaleChart "NO FRESH DATA" — never faked freshness.
result: PASSED (2026-07-15) — operator performed the visual check; dashboard renders correctly (node + service pages show real log rows and honest deep-VM chart states). "Good for now."

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None. Both human-verification tests passed. Capture-breadth enrichment (richer log capture, real-log classification patterns, incremental scan) is tracked separately in `.planning/todos/pending/2026-07-15-collector-log-capture-enrichment.md` and is out of scope for this phase (the collector code is proven).
