---
phase: 13-nodes-service-health
plan: 18
subsystem: ui
tags: [operator-gate, node-detail, gap-closure]
gap_closure: true
provides:
  - "Operator visual-gate acceptance of the Node-Detail redesign polish round (G5–G9)"
requirements-completed: []
duration: n/a
completed: 2026-07-10
---

# Phase 13 Plan 18: operator visual gate — redesign polish (G5–G9)

**Blocking operator visual gate for the Node-Detail redesign polish round. Approved by the operator on
2026-07-10 against the live app.**

## Gate outcome — APPROVED

The operator verified the round-2 fixes (built by 13-16/13-17) live:
- **G5** — channels/peers/forwards tables fill the column; no spurious horizontal scroll.
- **G6** — stat/summary strip cells distribute; no empty trailing cell.
- **G7** — peers table populated (the `shapePeersTab` `closed`-filter bug fixed → active-only predicate).
- **G8** — Ops Center node aliases link to `/{pubkey}`.
- **G9** — Overview tab / node navigation goes to the full page (the `(.)[pubkey]` interceptor removed).

Operator verdict: "rest looks great" (G5–G9 accepted); three follow-ups (G10–G12) were routed to round 3
(13-19/20/21) and a residual soft-nav 404 to 13-23. This gate covers G5–G9 only.

Verification along the way: tsc clean; suite green (only the pre-existing `nodemon_rw`-grant queue
integration tests fail, untouched by this phase).
