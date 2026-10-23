---
phase: 13-nodes-service-health
plan: 04
subsystem: nodes-list-ui
tags: [NODE-03, nodes-list, rsc, filters, evidence-table, severity-ramp]
requires:
  - loadFleetView (src/lib/scorecard/fleet.ts) — the memoized fleet read
  - parseNodeFacets + applyNodeFilters (src/lib/overview/node-filter.ts, Plan 02) — pure view
  - NavRailShell + Severity ramp API + FreshnessChip (df/*)
provides:
  - /nodes RSC route (NODE-03 nodes-list surface)
  - NodesTable (sortable evidence table, at-risk row pop, row→detail link)
  - NodeFilters (type/status/stale toggle chips, URL-synced pure view)
  - opsNav "nodes" entry reachable from every screen
affects:
  - src/app/(overview)/page.tsx (opsNav array — added nodes entry)
tech-stack:
  added: []
  patterns:
    - RSC force-dynamic read → pure-view filter → client islands for interaction
    - Severity → class ONLY via severityAccent/severityVariants/severityLabel (DS-01)
    - AFM-002 unit formatters (formatSats/formatPercent) at render; no inline math
    - Evidence read from ScorecardView.dimensions (no new warehouse read)
key-files:
  created:
    - src/components/node/NodesTable.tsx
    - src/components/node/NodeFilters.tsx
    - src/app/(overview)/nodes/page.tsx
  modified:
    - src/app/(overview)/page.tsx
decisions:
  - "Forwarding evidence uses the honest 7d window (routing/revenue dims), not a fabricated 30d — the only no-new-read source is 7d."
  - "Sparkline omitted: no honest time-series in loadFleetView output; rendering a fabricated series would violate honest-data discipline (D-08). Earned sats + forward count carry the forwarding evidence instead."
metrics:
  duration: ~15m
  completed: 2026-07-08
  tasks: 2
  files: 4
---

# Phase 13 Plan 04: Nodes List (NODE-03) Summary

The rebuilt Nodes list ships at `/nodes` — an RSC route in `NavRailShell` chrome that reads the memoized `loadFleetView()`, applies the Plan-02 pure filter view, and renders a sortable evidence table where at-risk rows pop via the locked severity ramp and the whole row links to Node Detail. The fleet is now reachable from the ops nav on every screen.

## What shipped

- **`NodeFilters`** (client island): three facet groups of reload-safe `<Link>` toggle chips — type (All / LND routing / LDK/LSP), status (All / Healthy / At-risk / Offline), and a single "Stale only" toggle. Each chip sets its facet in the URL; the RSC page re-runs `parseNodeFacets` + `applyNodeFilters` over the TTL-memoized fleet, so a chip click narrows the view with no warehouse re-query. Active chip = navy structural fill (DS-01), never a health hue.
- **`NodesTable`** (client island): composes `ui/table` with columns per UI-SPEC A3 (Node · Type · Status · Active ch. · Local/remote · 7d forwarding · Last seen). Column-header click toggles view-only sort (asc → desc → loaded order); the active sort column shows a navy indicator (structure, not state). At-risk (critical/warning) and stale rows pop via a left `severityAccent` bar + `severityVariants` tint + `severityLabel` chip + one-line "why"; healthy/watch rows stay quiet (dot only). Whole row links to `/{pubkey}`; the alias cell is a keyboard/crawler-safe `<Link>`. Liquidity ratio renders as a compact neutral bar; earned sats via `formatSats` (AFM-002).
- **`/nodes` route**: `dynamic="force-dynamic"`, `revalidate=0`, `NavRailShell active="nodes"` with `pollSinceMs` from the real fetch epoch, `NODES · <n>` kicker, honest empty states (filtered / all-healthy / genuinely-empty verbatim copy) and the read-only error fallback. Evidence is mapped from `ScorecardView.dimensions` (channelHealth/liquidity/revenue/routing) — no new read.
- **opsNav**: added `{ key: "nodes", label: "Nodes", href: "/nodes" }` to the overview page's array so the fleet is no longer a nav dead-end.

## Deviations from Plan

### Honest-data adjustments (D-08 discipline)

**1. [Rule 1 — honest data] Forwarding column labeled 7d, not 30d**
- **Found during:** Task 1/2 wiring. The plan/UI-SPEC copy says "30d forwarding", but the only no-new-read source (`ScorecardView` routing/revenue dimensions from `loadFleetView`) exposes a 7d window.
- **Fix:** Render the true 7d forward count + 7d earned sats and label the column "7d forwarding". Faking a 30d figure would violate the no-new-read constraint and honest-data discipline.
- **Files:** src/components/node/NodesTable.tsx, src/app/(overview)/nodes/page.tsx

**2. [Rule 1 — honest data] Sparkline omitted**
- **Found during:** Task 1. `Sparkline` needs a `TrendPoint[]` series from `@/lib/console/trends` — a NEW read the plan forbids ("adds no new read"). `loadFleetView` carries no per-node time series.
- **Fix:** The forwarding cell shows earned sats (`formatSats`) + forward count as the honest in-row evidence; the liquidity ratio renders as the compact bar. No fabricated series. A future plan can add the trend read behind the row if desired.

## Verification

- `tsc --noEmit` clean.
- `eslint` clean on all four files.
- No `sev ===` class chain in JSX (matches only in comments); no navy class on an at-risk row marker (navy appears only on the active-sort indicator, which is structure).
- Earned sats + liquidity ratio render via `formatSats`/`formatPercent` — no inline unit math in the new files.
- `NodesTable` row links to `/${row.pubkey}`.
- opsNav in overview page.tsx contains the `{ key: "nodes", href: "/nodes" }` entry.
- Page uses `parseNodeFacets`/`applyNodeFilters` (pure view) — no per-filter re-query (loadFleetView is TTL-memoized).

## Commits

- `12438ab` feat(13-04): NodesTable + NodeFilters components
- `b42ec40` feat(13-04): /nodes RSC route + opsNav nodes entry
