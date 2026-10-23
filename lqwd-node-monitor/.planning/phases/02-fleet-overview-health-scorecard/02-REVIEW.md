---
phase: 02-fleet-overview-health-scorecard
reviewed: 2026-06-10T04:06:17Z
depth: standard
files_reviewed: 51
files_reviewed_list:
  - components.json
  - package.json
  - src/app/(overview)/[pubkey]/page.tsx
  - src/app/(overview)/@modal/(.)[pubkey]/page.tsx
  - src/app/(overview)/@modal/default.tsx
  - src/app/(overview)/layout.tsx
  - src/app/(overview)/page.tsx
  - src/app/globals.css
  - src/components/scorecard/BackendBadge.tsx
  - src/components/scorecard/CriticalChip.tsx
  - src/components/scorecard/DimensionRow.tsx
  - src/components/scorecard/FreshnessStamp.tsx
  - src/components/scorecard/GradeBadge.tsx
  - src/components/scorecard/OutlierMarker.tsx
  - src/components/scorecard/ScorecardModal.tsx
  - src/components/scorecard/ScorecardPanel.tsx
  - src/components/ui/badge.tsx
  - src/components/ui/card.tsx
  - src/components/ui/dialog.tsx
  - src/components/ui/table.tsx
  - src/components/ui/tooltip.tsx
  - src/lib/config/backends.ts
  - src/lib/config/backends.test.ts
  - src/lib/db/schema/routing.ts
  - src/lib/read/node-info.ts
  - src/lib/read/node-info.test.ts
  - src/lib/scorecard/types.ts
  - src/lib/scorecard/config.ts
  - src/lib/scorecard/grade.ts
  - src/lib/scorecard/grade.test.ts
  - src/lib/scorecard/compare.ts
  - src/lib/scorecard/compare.test.ts
  - src/lib/scorecard/freshness.ts
  - src/lib/scorecard/freshness.test.ts
  - src/lib/scorecard/fleet.ts
  - src/lib/scorecard/fleet.test.ts
  - src/lib/scorecard/golden-scorecard.test.ts
  - src/lib/scorecard/dimensions/routing.ts
  - src/lib/scorecard/dimensions/routing.test.ts
  - src/lib/scorecard/dimensions/revenue.ts
  - src/lib/scorecard/dimensions/revenue.test.ts
  - src/lib/scorecard/dimensions/liquidity.ts
  - src/lib/scorecard/dimensions/liquidity.test.ts
  - src/lib/scorecard/dimensions/channel-health.ts
  - src/lib/scorecard/dimensions/channel-health.test.ts
  - src/lib/scorecard/dimensions/force-close.ts
  - src/lib/scorecard/dimensions/force-close.test.ts
  - src/lib/scorecard/dimensions/restart.ts
  - src/lib/scorecard/dimensions/restart.test.ts
  - src/lib/scorecard/dimensions/peer.ts
  - src/lib/scorecard/dimensions/peer.test.ts
findings:
  critical: 1
  critical_open: 0
  critical_fixed: 1
  warning: 6
  warning_open: 5
  warning_fixed: 1
  info: 7
  total: 14
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-10T04:06:17Z
**Depth:** standard
**Files Reviewed:** 51
**Status:** issues_found

## Summary

Reviewed the Phase 2 fleet-overview/scorecard implementation: 5 App Router surfaces, 8 scorecard components, 5 vendored shadcn primitives, the grading/comparison/freshness math, 7 dimension modules, and the full test suite. The architecture honors the project's guardrails well: `lnd_node_info` is read only through the DISTINCT ON helpers, all fee math routes through `fee_msat/1000.0` (no raw `fee` reference anywhere), every SQL builder parameter-binds its inputs (verified by injection-shape tests), no scorecard/UI component imports a db module, and the brand palette contains no `#F7931A`.

However, the fleet-wide liquidity query deviates from the Phase 1 sanctioned channel-state idiom in a way that silently misattributes liquidity whenever two fleet nodes share a channel (Critical), and there is a cluster of robustness gaps around timestamp/timezone handling, error boundaries on the deep-link routes, and freshness display granularity (Warnings).

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Fleet-wide `DISTINCT ON (chan_id)` collapses channel state across node partitions — intra-fleet channels are dropped from one node's liquidity

**Status:** FIXED — commit `70b0011` (2026-06-09). `buildLiquidityAllSql` now keys the latest-state subquery on `DISTINCT ON (local_pubkey, chan_id)` with `ORDER BY local_pubkey, chan_id, timestamp DESC`; both NULL-key guards (`chan_id IS NOT NULL AND local_pubkey IS NOT NULL`) moved into the subquery. `liquidity.test.ts` pins the corrected shape and adds a regression assertion that the bare `distinct on (chan_id)` form never returns. `channel-health.ts` checked — it is a pure transform over the per-node `DISTINCT ON (pubkey)` node-info read and does not share the bug. Verified: tsc clean (src), 92 scorecard tests green, live golden anchors (10/10) green.

**File:** `src/lib/scorecard/dimensions/liquidity.ts:50-66`
**Issue:** `lnd_node_channel_info` is partitioned per node by `local_pubkey` (the schema's own annotation: "Identity column (per-node partition): local_pubkey"). A channel between two LQWD fleet nodes (A↔B) produces rows under **both** partitions with the **same `chan_id`** (the short channel ID is identical on both sides): A's row carries A's `local_balance`, B's row carries B's. The Phase 1 sanctioned idiom (`src/lib/read/latest.ts:29-35`) applies `DISTINCT ON (chan_id)` only **after** filtering `WHERE local_pubkey = $x`. This fleet-wide builder runs `DISTINCT ON (chan_id)` across **all** partitions at once, so for any intra-fleet channel only one perspective row survives (whichever has the later timestamp) — the other node's side of that channel silently vanishes from its `SUM(local_balance)` / `SUM(capacity)`, skewing its outbound ratio, its grade, and the MAD cohort it feeds. This is exactly the LSP topology where intra-fleet channels are expected (the warehouse has an `internal_rebalance_invoices` table). The golden test cannot catch it: the ratio stays in [0,1] and capacity stays > 1e9. The liquidity shape test (`liquidity.test.ts:28-32`) pins the wrong form.
**Fix:** Partition the latest-state key by node:
```sql
SELECT DISTINCT ON (local_pubkey, chan_id) *
FROM lnd_node_channel_info
WHERE chan_id IS NOT NULL
  AND local_pubkey IS NOT NULL
ORDER BY local_pubkey, chan_id, timestamp DESC
```
(move the `local_pubkey IS NOT NULL` guard into the subquery; keep `active AND NOT closed` in the outer query), and update `liquidity.test.ts` to assert `distinct on (local_pubkey, chan_id)` / `order by local_pubkey, chan_id, timestamp desc`.

## Warnings

### WR-01: Timezone-ambiguous `new Date(string)` at the driver boundary can skew the 6-hour staleness flag by the server's UTC offset

**Status:** FIXED — commit `441d02a` (2026-06-09). Elevated to FAILED by the phase verifier with live evidence (+7h skew confirmed on the America/Vancouver host). Added a single shared boundary helper `parseDbTimestampUtc` (`src/lib/read/db-timestamp.ts`) that treats offset-less warehouse strings as UTC (space→`T` normalize + append `Z`), passes Date instances and explicit-offset strings (`Z`, `+00`, `-07:00`) through unchanged, and returns null for null/unparseable input. All four raw-execute coercion sites now route through it: `node-info.ts` `coerceTimestamp`, `liquidity.ts` `as_of`, `force-close.ts` `as_of`, and `restart.ts` `toRestartDate`. Regression suite `db-timestamp.test.ts` pins the UTC interpretation with offset-less fixtures (`"2026-06-10 04:10:00"` → `Date.UTC(2026,5,10,4,10,0)`), and `restart.test.ts` gains an offset-less consumer-site assertion (the prior `"+00"` fixture masked the bug). Verified: tsc clean (src), full suite 141 tests green, live D-14 golden 10/10 — no golden freshness expectations required updating.

**File:** `src/lib/read/node-info.ts:77-82`, `src/lib/scorecard/dimensions/liquidity.ts:125`, `src/lib/scorecard/dimensions/force-close.ts:125`, `src/lib/scorecard/dimensions/restart.ts:42-46`
**Issue:** Raw `.execute()` surfaces `timestamp` columns as strings (the code documents this). For a Postgres `timestamp` **without time zone** column, postgres.js returns a string with no offset suffix (e.g. `"2026-06-09 22:00:00"`), and JavaScript `new Date()` parses offset-less date-times as **local** time. `isStale()` then compares that epoch against the wall clock (`Date.now()`). If the warehouse writes UTC and the dashboard host is not running in UTC (e.g. America/Vancouver, −7/−8h), every node reads 7-8 hours older or newer than reality — against a 6-hour threshold, that flips the stale flag fleet-wide in one direction or the other. The restart test fixture uses a `"+00"`-suffixed string, which masks this case.
**Fix:** Make the timezone explicit at the SQL boundary rather than trusting host TZ. Either select epoch directly — `EXTRACT(EPOCH FROM MAX(timestamp)) * 1000 AS as_of_ms` and `new Date(Number(as_of_ms))` — or `MAX(timestamp) AT TIME ZONE 'UTC' AS as_of` (yields a timestamptz string with offset). At minimum, in the coercion helpers append `Z`/treat offset-less strings as UTC, and add a test with an offset-less string asserting the UTC interpretation.

### WR-02: Deep-link and modal scorecard routes have no error handling — warehouse outage renders the raw Next.js error screen

**File:** `src/app/(overview)/[pubkey]/page.tsx:52`, `src/app/(overview)/@modal/(.)[pubkey]/page.tsx:34`
**Issue:** `FleetOverviewPage` wraps `loadFleetView()` in try/catch and renders a friendly read-only failure message, but both `/{pubkey}` surfaces call `loadFleetView()` (and `getFleet()` in `generateMetadata`) unguarded, and there is no `error.tsx` anywhere under `src/app/` (verified). A transient warehouse failure on a deep link or a row click produces the default unstyled Next error boundary instead of the operator-facing "data unchanged, view is read-only" message the overview promises. Inconsistent error handling across surfaces that share the same data source.
**Fix:** Add `src/app/(overview)/error.tsx` (client component) rendering the same "Couldn't load fleet health / read-only" copy, or wrap the `loadFleetView()` calls in both `[pubkey]` pages with the overview's try/catch pattern.

### WR-03: Overview row can show "◆ Worst-in-fleet" from the peer dimension, but the scorecard panel suppresses peer's outlier marker — operator cannot find the source

**File:** `src/app/(overview)/page.tsx:36-38`, `src/components/scorecard/DimensionRow.tsx:91-107`
**Issue:** The row-level marker fires when ANY dimension has `peerRelative.isOutlier === true` — including `peer`, which gets a real MAD comparison in `attachPeerRelative` (it is in `COMPUTABLE_KEYS`). But in `DimensionRow`, the `isPartial` branch wins over the peer-relative branch, so the peer tile renders "Partial — flap-rate needs event history" and **never** shows an outlier marker. A node whose only MAD flag is on `peer` shows ◆ on the overview, yet when the operator opens the scorecard no dimension carries the marker — the signal is untraceable. Either the row aggregation should match what the panel can display, or the peer tile should show both states.
**Fix:** Either exclude partial dimensions from `hasOutlier` (`node.dimensions.some((d) => d.key !== "peer" && d.peerRelative?.isOutlier === true)` — or better, skip the comparison for partial dims in `attachPeerRelative`), or render the OutlierMarker alongside the partial note in `DimensionRow` instead of making the states mutually exclusive.

### WR-04: FreshnessStamp renders an empty tooltip for fresh nodes without a breakdown (every overview row)

**File:** `src/components/scorecard/FreshnessStamp.tsx:49-74`
**Issue:** The overview rows call `<FreshnessStamp asOf={...} stale={...} />` with no `breakdown`. For a non-stale node, `TooltipContent` contains `{stale && ...}` (false) and `{breakdown?.map(...)}` (undefined) — an empty content bubble. The dotted underline explicitly "advertises the per-dimension breakdown tooltip" (the component's own comment), so hovering any healthy row pops an empty tooltip box.
**Fix:** Compute `const hasTooltipContent = stale || (breakdown !== undefined && breakdown.length > 0);` and return the bare `stamp` (without the Tooltip wrapper and without the dotted underline) when false.

### WR-05: Freshness rendered date-only against a 6-hour staleness threshold — the stamp cannot explain its own stale flag

**File:** `src/components/scorecard/FreshnessStamp.tsx:17-26`
**Issue:** `dateFormat` emits `YYYY-MM-DD` only (no time). With `STALENESS.warnAfterHours = 6`, a node stale at 7 hours shows "⚠ Stale — data as of 2026-06-10" — today's date — which reads as a contradiction, and the per-dimension breakdown rows in the tooltip will usually all show the same date, making the D-13 fail-loud diagnostic non-actionable. The fleet header already prints a full ISO `fetchedAt`, so hour-level precision is the established norm on this screen.
**Fix:** Add time to the formatter, e.g. `hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC"` and suffix "UTC" — or render relative age ("7h ago") next to the date for the stamp and breakdown rows.

### WR-06: Partial-dimension state detected via fragile substring match on a free-text note

**File:** `src/components/scorecard/DimensionRow.tsx:73`
**Issue:** `const isPartial = dimension.note?.toLowerCase().includes("partial")` couples the render state to an unstructured string. The exported constant `PEER_PARTIAL_NOTE` exists in `peer.ts` precisely to pin this contract, but the consumer does not use it — any future note that happens to contain "partial" (e.g. a "partial window" data note from another dimension) silently flips that tile into the peer-partial UI, and a reworded peer note silently breaks the partial state. Notes are also set by `resolveInput` ("no rows in window"), so the namespace is shared.
**Fix:** Compare against the constant (`dimension.note === PEER_PARTIAL_NOTE` — peer.ts is a pure module, importable by components), or better, add an explicit `partial?: boolean` to `GradedDimension` and set it in the peer dimension.

## Info

### IN-01: `shortPubkey` and `PUBKEY_RE` duplicated across four files

**File:** `src/app/(overview)/[pubkey]/page.tsx:26-33`, `src/app/(overview)/@modal/(.)[pubkey]/page.tsx:19-23`, `src/app/(overview)/page.tsx:31-33`, `src/components/scorecard/ScorecardPanel.tsx:24-26`
**Issue:** Identical `shortPubkey` helper exists in 4 files and `PUBKEY_RE` in 2; the two route validators must stay byte-identical to guarantee "both routes validate the pubkey the same way."
**Fix:** Extract to `src/lib/format/pubkey.ts` (e.g. `shortPubkey`, `PUBKEY_RE`) and import everywhere.

### IN-02: Dimension display-name map duplicated between DimensionRow and ScorecardPanel

**File:** `src/components/scorecard/DimensionRow.tsx:20-31`, `src/components/scorecard/ScorecardPanel.tsx:29-40`
**Issue:** `DIMENSION_LABELS` and `DIMENSION_NAMES` are identical `Record<DimensionKey, string>` literals; a rename in one drifts the freshness-breakdown labels away from the tile labels.
**Fix:** Export one map (e.g. from `DimensionRow.tsx` or a shared `labels.ts`) and reuse it.

### IN-03: fleet.ts bounded-read comment understates the query count (claims 5+1, actual is 7+1)

**File:** `src/lib/scorecard/fleet.ts:46-47`
**Issue:** The T-02-05 banner says "exactly 5 windowed aggregate queries + 1 DISTINCT ON snapshot per call", but `liquidityForFleet` issues 2 queries (liquidity + rebalance) and `forceCloseForFleet` issues 2 (agg + storm), plus the restart DISTINCT ON — 7 aggregates + 1 snapshot. The bound holds; the documented number is wrong and will mislead the next person auditing T-02-05.
**Fix:** Update the comment to the real count (7 windowed/aggregate queries + 1 DISTINCT ON snapshot).

### IN-04: OutlierMarker has an unused prop and a literal "N" placeholder in operator-facing copy

**File:** `src/components/scorecard/OutlierMarker.tsx:11,28`
**Issue:** `deltaFromMedian?: number` is declared but never used (dead prop). The tooltip says "More than N MADs from the … median" — `N` is a placeholder; the actual knob is `COMPARE_CONFIG.madN` (3).
**Fix:** Remove the unused prop (or render the delta), and interpolate the configured value: `More than {COMPARE_CONFIG.madN} MADs…` (`config.ts` is a pure module).

### IN-05: Pubkey route validation rejects uppercase hex

**File:** `src/app/(overview)/[pubkey]/page.tsx:26`, `src/app/(overview)/@modal/(.)[pubkey]/page.tsx:19`
**Issue:** `/^[0-9a-f]{66}$/` 404s an uppercase-hex deep link (pasted from explorers/tools that uppercase hex), even though it identifies a real node.
**Fix:** Add the `i` flag and lowercase before lookup (`pubkey.toLowerCase()`), or document lowercase-only as intended.

### IN-06: Exported `median()`/`mad()` return NaN on empty input

**File:** `src/lib/scorecard/compare.ts:13-23`
**Issue:** `median([])` computes `(s[-1] + s[0]) / 2` → NaN; `mad([])` follows. Current callers are guarded by the `cohort.length < minCohort` check in `outlierCheck`, but these are exported pure utilities a future caller can misuse silently.
**Fix:** Guard explicitly (throw or return NaN deliberately with a doc comment), e.g. `if (xs.length === 0) throw new Error("median of empty input")`.

### IN-07: `WHERE active AND NOT closed` silently excludes channels with NULL booleans

**File:** `src/lib/scorecard/dimensions/liquidity.ts:64`
**Issue:** Both `active` and `closed` are nullable in the schema. `NOT closed` over NULL is NULL → row excluded. If the warehouse ever emits NULL `closed` for open channels, those channels vanish from the liquidity sums with no signal. Live golden validation currently passes, so this is latent, not active.
**Fix:** Make the intent explicit: `WHERE active AND NOT COALESCE(closed, false)` (or document that NULL booleans are intentionally excluded).

---

_Reviewed: 2026-06-10T04:06:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
