---
phase: 13-nodes-service-health
plan: 22
subsystem: ui
tags: [operator-gate, node-detail, gap-closure]
gap_closure: true
provides:
  - "Operator visual-gate acceptance of round-3 fixes (G10 forwards columns, G12 gauge color)"
requirements-completed: []
duration: n/a
completed: 2026-07-10
---

# Phase 13 Plan 22: operator visual gate — round 3 (G10, G12; G11 → 13-23)

**Blocking operator visual gate for the round-3 fixes. Approved 2026-07-10.**

## Gate outcome — APPROVED

Verified live (built by 13-19/13-20/13-21):
- **G10** — Forwards table gained **Fees earned** (AFM-002 sats) + **Timestamp** columns.
- **G12** — Liquidity gauge recolored **navy = local / grey = remote** (reference distinction, not the
  severity ramp; color law preserved).
- **G11** — the parallel-route soft-nav 404 was first attempted here (13-19 added `@modal/[pubkey]/default.tsx`);
  it proved insufficient (systemic across `/nodes`, `/[pubkey]`, sub-routes). The true root cause — the
  leftover dead `@modal` parallel-route slot — was fully removed in **13-23**, which the operator approved.

This gate covers G10 + G12; the routing root-fix acceptance is recorded in 13-23.
