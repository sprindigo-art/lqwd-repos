---
phase: 13-nodes-service-health
plan: 08
subsystem: ui
tags: [next-app-router, node-detail, superseded]
requires:
  - phase: 13 (13-05/06/07 leaves)
    provides: read leaves composed by the original single-scroll assembly
provides:
  - "[pubkey]/[tab] legacy redirect shim (preserved + reused by the redesign)"
affects: [13-15, 13-12, 13-14]
key-files:
  modified:
    - src/app/(overview)/[pubkey]/page.tsx
    - src/app/(overview)/[pubkey]/[tab]/page.tsx
requirements-completed: []
duration: n/a
completed: 2026-07-10
---

# Phase 13 Plan 08: single-scroll Node Detail (SUPERSEDED)

**Superseded by the routed-tabs redesign. The D-08 single-scroll `/[pubkey]` page this plan built was
rejected at its operator visual gate and replaced; its legacy `[tab]` redirect + CSV export path were
preserved and reused by the redesign.**

## Outcome

13-08 assembled the single-scroll Node Detail (`[pubkey]/page.tsx`, committed `0efd32e`) and retired the
v1 `[tab]` console to a redirect shim (`9b271ed`). At the operator visual gate the single-scroll layout
was rejected as too heavy (see `13-NODE-DETAIL-GATE-FEEDBACK.md`), triggering the routed-tabs redesign:

- `[pubkey]/page.tsx` was rewritten as the lean overview by **13-15**.
- Heavy tables moved to sub-routes **13-12** (channels), **13-13** (peers), **13-14** (forwards).
- The `[tab]` redirect shim + the CSV export route path this plan preserved were carried forward and are
  still live.

This plan is marked complete as **superseded**: its durable contribution (the redirect + export
preservation) persists; its single-scroll page does not. No separate SUMMARY work remained.
