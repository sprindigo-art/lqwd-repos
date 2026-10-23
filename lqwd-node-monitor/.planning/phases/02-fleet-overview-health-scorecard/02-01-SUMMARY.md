---
phase: 02-fleet-overview-health-scorecard
plan: 01
subsystem: read-layer
tags: [drizzle, routing_vm, afm-001, distinct-on, append-only, scorecard-foundation]
requires:
  - phase: 01-foundations-read-layer
    provides: "dbRouting warehouse client, AFM-001 latest.ts template, vitest @/ alias config"
provides:
  - "Typed lndNodeForwards, lndNodeClosedChannels, lndRestart, lndNodePeerInfo, internalRebalanceInvoices (live-verified)"
  - "Corrected lnd_node_info APPEND-ONLY annotation (TRUE SNAPSHOT landmine removed)"
  - "Sanctioned latestNodeInfo/latestNodeInfoAll DISTINCT ON (pubkey) helpers + LatestNodeInfoRow"
affects: [02-02, 02-03, 02-04, 02-05, 02-06, 02-07, phase-03]
tech-stack:
  added: []
  patterns:
    - "AFM-001 builder/executor split with lazy await import('@/lib/db/warehouse-routing') for no-DB shape tests"
    - "DISTINCT ON (key) ... ORDER BY key, timestamp DESC + key IS NOT NULL guard (WR-01)"
key-files:
  created:
    - src/lib/read/node-info.ts
    - src/lib/read/node-info.test.ts
  modified:
    - src/lib/db/schema/routing.ts
decisions:
  - "lnd_node_closed_channels.chan_id typed bigint mode 'bigint' (live information_schema says BIGINT — differs from varchar chan_id in lnd_node_channel_info)"
  - "lndRestart typed without a primaryKey — the live table has exactly 4 columns (alias, pubkey, restarted, last_restart), no id"
metrics:
  duration: ~5 min
  completed: 2026-06-09T23:16:00Z
  tasks: 2
  files: 3
---

# Phase 2 Plan 01: Data Foundation — Schema Extension + latestNodeInfo Helpers Summary

Typed the 5 routing_vm scorecard tables against the live information_schema, replaced the factually-wrong "TRUE SNAPSHOT" comment on append-only lnd_node_info, and shipped the sanctioned `latestNodeInfo*` DISTINCT ON (pubkey) helpers with no-DB shape + injection tests.

## What Was Built

### Task 1 — Schema extension (commit 2960072)
- `src/lib/db/schema/routing.ts` now has 7 `pgTable(` exports (was 2):
  - `lndNodeForwards` — `timestamp_ns` as `bigint(..., { mode: "bigint" })` with NANOSECONDS/*1e9 comment (Pitfall 3); raw `fee` column marked **FORBIDDEN — AFM-002: use fee_msat/1000.0**.
  - `lndNodeClosedChannels` — one row per close (3,238 rows / 3,177 distinct chan_id Canada); verified `close_type`/`close_initiator` enums annotated.
  - `lndRestart` — exactly `alias, pubkey, restarted, last_restart`; "LATEST restart only — restart-loop detection NOT possible" annotation (Open Question 2).
  - `lndNodePeerInfo` — CUMULATIVE LIFETIME peer log annotation; "current peers = lnd_node_info.num_peers via latestNodeInfo, NEVER COUNT(*)" (Pitfall 2).
  - `internalRebalanceInvoices` — paid_status success-rate read annotated (Canada 7d: 37/143 ≈ 26%).
- lnd_node_info comment rewritten: **APPEND-ONLY (8.05M rows / 26 nodes; Canada 371,545)** — latest-per-node ONLY via DISTINCT ON (pubkey), NEVER a bare select. "TRUE SNAPSHOT" no longer appears anywhere in the file.
- Stub block trimmed to the two Phase-3 tables (lnd_node_pending_channels, lnd_node_pending_sweeps); typed columns of lndNodeInfo/lndNodeChannelInfo untouched.

### Task 2 — Sanctioned helpers (commit 00d981b)
- `src/lib/read/node-info.ts` mirrors latest.ts: exported SQL builders (`buildLatestNodeInfoAllSql`, `buildLatestNodeInfoSql`) + lazy-import executors (`latestNodeInfoAll`, `latestNodeInfo`) + `LatestNodeInfoRow`. No top-level db import; `pubkey IS NOT NULL` guard with WR-01 comment; single-node path is bound `WHERE pubkey = $1 ORDER BY timestamp DESC LIMIT 1`.
- `src/lib/read/node-info.test.ts` — 6 passing no-DB tests via `PgDialect.sqlToQuery`: DISTINCT ON shape, ORDER BY shape, NULL-key guard, LIMIT 1 shape, MAX( ban on both builders, SQLi payload lands in params not SQL text.

## Schema-Accuracy Evidence (live information_schema introspection, 2026-06-09)

Read-only query against routing_vm (`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_name IN (...) ORDER BY table_name, ordinal_position`):

```
internal_rebalance_invoices | internal_invoice_id | integer
internal_rebalance_invoices | payment_request | text
internal_rebalance_invoices | requesting_node_pubkey | character varying
internal_rebalance_invoices | requesting_node_alias | text
internal_rebalance_invoices | outgoing_channel_id | character varying
internal_rebalance_invoices | remote_pubkey | character varying
internal_rebalance_invoices | remote_alias | text
internal_rebalance_invoices | amount | bigint
internal_rebalance_invoices | paid_status | boolean
internal_rebalance_invoices | timestamp | timestamp without time zone
lnd_node_closed_channels | id | integer
lnd_node_closed_channels | channel_point | text
lnd_node_closed_channels | chan_id | bigint
lnd_node_closed_channels | chain_hash | text
lnd_node_closed_channels | closing_tx_hash | text
lnd_node_closed_channels | remote_pubkey | text
lnd_node_closed_channels | capacity | bigint
lnd_node_closed_channels | close_height | bigint
lnd_node_closed_channels | settled_balance | bigint
lnd_node_closed_channels | time_locked_balance | bigint
lnd_node_closed_channels | close_type | text
lnd_node_closed_channels | open_initiator | text
lnd_node_closed_channels | close_initiator | text
lnd_node_closed_channels | local_pubkey | text
lnd_node_closed_channels | lnd_alias | text
lnd_node_closed_channels | timestamp | timestamp without time zone
lnd_node_forwards | id | integer
lnd_node_forwards | chan_id_in | character varying
lnd_node_forwards | chan_id_out | character varying
lnd_node_forwards | amt_in | bigint
lnd_node_forwards | amt_out | bigint
lnd_node_forwards | fee | bigint
lnd_node_forwards | fee_msat | bigint
lnd_node_forwards | amt_in_msat | bigint
lnd_node_forwards | amt_out_msat | bigint
lnd_node_forwards | timestamp_ns | bigint
lnd_node_forwards | lnd_pubkey | character varying
lnd_node_forwards | peer_alias_in | text
lnd_node_forwards | peer_alias_out | text
lnd_node_peer_info | id | integer
lnd_node_peer_info | peer_pubkey | text
lnd_node_peer_info | address | text
lnd_node_peer_info | alias | text
lnd_node_peer_info | flapcount | bigint
lnd_node_peer_info | total_capacity | bigint
lnd_node_peer_info | num_channels | bigint
lnd_node_peer_info | local_pubkey | text
lnd_node_peer_info | connected_to | text
lnd_node_peer_info | timestamp | timestamp without time zone
lnd_restart | alias | text
lnd_restart | pubkey | text
lnd_restart | restarted | boolean
lnd_restart | last_restart | timestamp without time zone
```

Every column above is typed 1:1 in routing.ts. No drizzle-kit push/generate/migrate was run; no migration artifacts exist or were committed (T-02-03 honored — introspection was SELECT-only on information_schema).

## Verification Results

- `npx tsc --noEmit` — exit 0
- `npx vitest run src/lib/read` — 18 passed, 3 skipped (existing latest/golden/nodes tests unaffected; 6 new node-info tests pass, no DB required)
- `grep -c "pgTable(" src/lib/db/schema/routing.ts` = 7; "APPEND-ONLY" present; "TRUE SNAPSHOT" absent
- `grep -c "DISTINCT ON (pubkey)" src/lib/read/node-info.ts` = 4 (comment + builder); "pubkey IS NOT NULL" present; lazy `await import("@/lib/db/warehouse-routing")`, no top-level dbRouting import

## Deviations from Plan

None - plan executed exactly as written.

Execution environment note (not a code deviation): the worktree lacks the git-ignored `node_modules` and `.env.local`; node_modules was symlinked from the main checkout (gitignored, not committed) and the one-off introspection script loaded `ROUTING_VM_DATABASE_URL` from the main checkout's `.env.local` read-only.

## Known Stubs

None — no placeholder values or unwired data paths introduced.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 2960072 | feat(02-01): type 5 routing_vm scorecard tables, correct lnd_node_info to APPEND-ONLY |
| 2 | 00d981b | feat(02-01): sanctioned latestNodeInfo DISTINCT ON (pubkey) helpers + shape tests |

## Self-Check: PASSED

- src/lib/read/node-info.ts: FOUND
- src/lib/read/node-info.test.ts: FOUND
- routing.ts 7 pgTable calls: CONFIRMED
- Commit 2960072: FOUND
- Commit 00d981b: FOUND
