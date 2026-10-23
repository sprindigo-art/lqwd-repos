---
phase: 13-nodes-service-health
plan: 15
subsystem: ui
tags: [next-app-router, rsc, node-detail, overview, liquidity-gauge]
gap_closure: true

requires:
  - phase: 13 (13-10 tabs/gauge, 13-12/13/14 sub-routes, 13-05/07 leaves)
    provides: NodeDetailTabs, LiquidityGauge, ServiceHealthGrid, header/vitals/signals/safety leaves
provides:
  - "Lean /[pubkey] overview (D-08 single-scroll superseded): summary strip + tabs + aggregate liquidity gauge + service grid + signals + safety"
  - "NodeSummaryStrip counts (Channels/Peers/Capacity/Local share)"
affects: [13-16, 13-17, 13-18]

tech-stack:
  added: []
  patterns:
    - "Lean overview composes shared leaves; heavy tables live on routed sub-routes (13-12/13/14)"

key-files:
  created:
    - src/components/node/NodeSummaryStrip.tsx
  modified:
    - src/app/(overview)/[pubkey]/page.tsx

key-decisions:
  - "Overview is lean (G1): channels/peers/forwards tables moved to sub-routes; overview keeps header/counts+tabs/gauge/vitals/service grid/signals/safety"

patterns-established:
  - "NodeDetailTabs active-prop nav + max-w-[1180px] constrained column"

requirements-completed: []

duration: ~3min
completed: 2026-07-10
---

# Phase 13 Plan 15: lean /[pubkey] Node-Detail overview

**The single-scroll Node Detail (D-08) is replaced by a lean, fast `/[pubkey]` overview — summary strip + Channels/Peers/Forwards tab bar + aggregate liquidity gauge + two-axis service grid + active signals + read-only safety posture — with the heavy tables on their routed sub-routes.**

## Performance

- **Completed:** 2026-07-10
- **Tasks:** 2/3 build tasks complete + committed; Task 3 (operator visual gate) surfaced polish gaps → see Acceptance.
- **Files:** 2 (1 created, 1 rewritten)

## Accomplishments

- **`src/components/node/NodeSummaryStrip.tsx`** — overview counts (Channels · Peers · Capacity · Local share).
- **`src/app/(overview)/[pubkey]/page.tsx`** — rewritten as the lean overview: header, summary strip + `NodeDetailTabs`, `LiquidityGauge` (aggregate), `ServiceHealthGrid`, active signals/logs, read-only safety posture; `max-w-[1180px]` column. The `[tab]` redirect and the three `export/route.ts` files were left untouched.

## Commits

- `8d41947` feat(13-15): add NodeSummaryStrip lean overview counts
- `b4a26b6` feat(13-15): rewrite /[pubkey] as the lean Node-Detail overview

## Verification

- `tsc --noEmit` clean; grep gate `lean overview wired` passes (NodeDetailTabs present, LightningState absent, `max-w-[1180px]` present); post-merge suite green (no new failures; only the pre-existing `nodemon_rw`-grant queue integration tests fail).

## Acceptance — gate surfaced polish gaps (routed forward)

The build shipped correctly; the operator visual gate found 5 polish/routing gaps against the running app (G5–G9 in `13-NODE-DETAIL-GATE-FEEDBACK.md` Round 2): table full-width/no-spurious-scroll (G5), stat-strip dead cell (G6), empty peers table — a `shapePeersTab` `closed` filter BUG (G7), non-clickable Ops Center alias (G8), and the Overview tab opening a modal (G9). These are addressed by **13-16 / 13-17 / 13-18**, whose consolidated operator visual gate (13-18) re-verifies the full Node-Detail surface. This plan's implementation is complete; final acceptance is deferred to the 13-18 gate.
