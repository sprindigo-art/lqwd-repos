---
phase: 02-fleet-overview-health-scorecard
plan: 03
subsystem: database
tags: [drizzle, postgres, sql, lightning, lnd, scorecard, vitest]

# Dependency graph
requires:
  - phase: 02-fleet-overview-health-scorecard (plan 02-01)
    provides: typed warehouse schema (lndNodeForwards, lndNodeChannelInfo, internalRebalanceInvoices), LatestNodeInfoRow / latestNodeInfoAll, sanctioned DISTINCT ON idiom in src/lib/read/latest.ts
  - phase: 02-fleet-overview-health-scorecard (plan 02-02)
    provides: DimensionResult type, scorecard config (revenue tier1 entry), grade/compare/freshness pure layer
provides:
  - buildRoutingAllSql/routingForFleet — 7d forwards count + volume per node (fleet-wide GROUP BY lnd_pubkey, ns window)
  - buildRevenueAllSql/revenueForFleet — 24h fee-PPM (raw, null on no flow) + 7d earnings sats via FILTER windows
  - buildLiquidityAllSql/buildRebalanceSuccessAllSql/liquidityForFleet — outbound ratio over AFM-001 latest channel state + rebalance-success extras
  - channelHealthFromNodeInfo — pure inactive-ratio transform over LatestNodeInfoRow[]
  - null-PPM semantics comment on config.ts revenue tier1 (checker I-3)
affects: [02-06 fleet.ts aggregation, fleet overview page, per-node scorecard]

# Tech tracking
tech-stack:
  added: []
  patterns: [exported raw-SQL builder + lazy-import executor pair per dimension, PgDialect.sqlToQuery no-DB shape tests, fleet-wide GROUP BY (one query per dimension, not 26x)]

key-files:
  created:
    - src/lib/scorecard/dimensions/routing.ts
    - src/lib/scorecard/dimensions/routing.test.ts
    - src/lib/scorecard/dimensions/revenue.ts
    - src/lib/scorecard/dimensions/revenue.test.ts
    - src/lib/scorecard/dimensions/liquidity.ts
    - src/lib/scorecard/dimensions/liquidity.test.ts
    - src/lib/scorecard/dimensions/channel-health.ts
    - src/lib/scorecard/dimensions/channel-health.test.ts
  modified:
    - src/lib/scorecard/config.ts

key-decisions:
  - "Rebalance success rate computed per requesting_node_pubkey (schema-confirmed identity column) and joined into liquidity extras only when the node issued invoices in the window"
  - "revenueForFleet preserves SQL NULL as raw null (never coerces to 0) so the fee-crash Tier-1 only fires with nonzero 24h flow"
  - "MAX(timestamp)/MAX(timestamp_ns) used strictly as per-group as-of aggregates, documented in-code as distinct from the AFM-001 WHERE timestamp = MAX(...) anti-pattern"

patterns-established:
  - "Dimension module shape: exported SQL builder (testable without DB) + lazy-import *ForFleet executor returning Map<pubkey, DimensionResult>"
  - "Latest channel state always via DISTINCT ON (chan_id) subquery with chan_id IS NOT NULL WR-01 guard"

requirements-completed: [FLEET-02]

# Metrics
duration: ~35min (split across two executor sessions due to provider quota interruption)
completed: 2026-06-09
---

# Phase 02 Plan 03: Forwards/Channel Dimensions Summary

**Four fleet-wide dimension modules (routing, revenue, liquidity, channel health) returning Map<pubkey, DimensionResult> over lnd_node_forwards / lnd_node_channel_info / internal_rebalance_invoices with AFM-001/AFM-002 discipline proven by 21 no-DB shape tests**

## Performance

- **Duration:** ~35 min across two sessions (first executor terminated mid-plan by a provider quota limit; continuation executor verified and completed Task 2)
- **Completed:** 2026-06-09
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Routing + revenue dimensions over `lnd_node_forwards` with nanosecond windows (`timestamp_ns` x `1e9` in SQL text, windowDays parameter-bound) and `fee_msat/1000.0` — never the raw `fee` column (AFM-002, RESEARCH Pitfall 3)
- Revenue computes both windows (24h PPM graded raw, 7d earnings extras) in a single fleet-wide query via `FILTER`, with `NULLIF` keeping zero-flow nodes at raw null instead of a false 0-PPM
- Liquidity outbound ratio over AFM-001 latest channel state (`DISTINCT ON (chan_id)` subquery with WR-01 NULL-key guard, outer `GROUP BY local_pubkey`, `active AND NOT closed` filter), extras in raw sats, plus 7d rebalance success rate per `requesting_node_pubkey`
- Channel health as a pure transform (zero DB imports) over `LatestNodeInfoRow[]` — raw null when a node reports zero channels
- Null-PPM semantics comment added above the config.ts revenue tier1 entry (checker I-3); no config values changed, 02-02 tests stay green

## Task Commits

Each task was committed atomically:

1. **Task 1: routing.ts + revenue.ts (lnd_node_forwards, ns windows, fee_msat) + shape tests** - `5b19773` (feat)
2. **Task 2: liquidity.ts (AFM-001 latest channel state + rebalance extras) + channel-health.ts (pure) + tests** - `b18e39b` (feat)

**Plan metadata:** see final docs commit on this branch

## Files Created/Modified
- `src/lib/scorecard/dimensions/routing.ts` - buildRoutingAllSql + routingForFleet (7d forwards count, volume_sat extras)
- `src/lib/scorecard/dimensions/routing.test.ts` - SQL shape tests (ns window, group by, param binding)
- `src/lib/scorecard/dimensions/revenue.ts` - buildRevenueAllSql + revenueForFleet (24h PPM raw, 7d earnings extras)
- `src/lib/scorecard/dimensions/revenue.test.ts` - SQL shape tests (fee_msat, NULLIF, amt_in_msat, no SUM(fee))
- `src/lib/scorecard/dimensions/liquidity.ts` - buildLiquidityAllSql + buildRebalanceSuccessAllSql + liquidityForFleet
- `src/lib/scorecard/dimensions/liquidity.test.ts` - SQL shape tests (DISTINCT ON, WR-01 guard, boolean filter, $1 binding)
- `src/lib/scorecard/dimensions/channel-health.ts` - channelHealthFromNodeInfo pure transform
- `src/lib/scorecard/dimensions/channel-health.test.ts` - table-driven pure tests (Canada 487/86 reference ≈ 0.1501)
- `src/lib/scorecard/config.ts` - null-PPM semantics comment on revenue tier1 (comment only)

## Decisions Made
- Rebalance identity column read from the typed schema (`requesting_node_pubkey`) rather than guessed, per plan instruction; rebalanceSuccessRate set in extras only when the node has invoices in the window
- `MAX(timestamp_ns)` / `MAX(timestamp)` documented in-code as legitimate per-group as-of aggregates, explicitly distinguished from the AFM-001 `WHERE timestamp = MAX(...)` row-selection anti-pattern
- `internal_rebalance_invoices.timestamp` is a real timestamptz (not nanoseconds), so the rebalance window uses `now() - $1 * interval '1 day'` instead of the ns idiom

## Deviations from Plan

### Execution Interruption (not a plan deviation)

**1. Provider quota termination mid-plan**
- **Found during:** Between Task 1 commit and Task 2 commit
- **Issue:** The original executor was terminated by a provider quota limit after committing Task 1 (`5b19773`) and writing — but not committing — the four Task 2 files
- **Fix:** A continuation executor resumed in the same worktree, verified the uncommitted liquidity/channel-health files against Task 2's requirements and the typed schema, ran the full verification suite (55 scorecard tests + tsc + write-verb grep), and committed Task 2 (`b18e39b`)
- **Impact:** None on code content — all acceptance criteria met as written

Otherwise: none — plan executed exactly as written.

## Issues Encountered
None beyond the quota interruption documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four dimension contracts consumed by 02-06 `fleet.ts` are exported exactly as specified in the plan's interfaces block
- Verification green: `npx vitest run src/lib/scorecard` (7 files, 55 tests), `npx tsc --noEmit`, no INSERT/UPDATE/DELETE verbs in dimension files
- No grades or thresholds in any dimension file (D-02 separation held)

---
*Phase: 02-fleet-overview-health-scorecard*
*Completed: 2026-06-09*
