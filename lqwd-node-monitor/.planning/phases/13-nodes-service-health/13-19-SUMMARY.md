---
phase: 13-nodes-service-health
plan: 19
subsystem: nodes-service-health
tags: [next-app-router, parallel-routes, soft-nav, regression-fix, gap-closure]
requires:
  - "src/app/(overview)/layout.tsx (@modal parallel slot)"
  - "src/app/(overview)/[pubkey]/page.tsx (children-slot lean-overview page)"
provides:
  - "Parallel-slot @modal presence at the [pubkey] segment depth so soft-nav reconciles"
affects:
  - "Client-side navigation into /[pubkey] and all Node-Detail sub-routes"
tech-stack:
  added: []
  patterns:
    - "Next.js parallel-route default.tsx at dynamic-segment depth for soft-nav slot reconciliation"
key-files:
  created:
    - "src/app/(overview)/@modal/[pubkey]/default.tsx"
  modified: []
decisions:
  - "Single [pubkey]-level null default.tsx chosen over per-sub-route defaults — Next resolves nearest default up the slot subtree, so one file covers channels/peers/forwards/[tab]/service."
  - "Did NOT re-introduce the retired (.)[pubkey] interceptor (G9) — fix is a pure null fallback, no modal chrome, no data read."
metrics:
  duration: "~3 min"
  completed: "2026-07-10"
requirements: [NODE-04]
---

# Phase 13 Plan 19: Fix Overview Soft-Nav 404 (G11) Summary

Added a null-returning `default.tsx` at the `[pubkey]` segment depth of the `(overview)/@modal` parallel slot, restoring client-side navigation into `/[pubkey]` and its sub-routes that G9 (interceptor deletion) had regressed into soft-nav 404s.

## What Was Built

`src/app/(overview)/@modal/[pubkey]/default.tsx` — a default export (`ModalNodeDefault`) returning `null`. The `(overview)` layout hosts two parallel slots (`children` + `@modal`). After G9 removed `@modal/(.)[pubkey]/page.tsx`, the `@modal` slot had only a root `default.tsx` plus `inbox`/`pending` — no presence at the `[pubkey]` dynamic segment. On soft navigation the router tracks each slot's active state independently and could not reconcile `@modal` at that depth → 404. Hard navigation rebuilt from root and the root `default.tsx` satisfied the unmatched slot, hence the reversed-symptom (soft 404 / hard OK) class.

The new file gives `@modal` a matched fallback at `[pubkey]`; Next.js resolves the nearest `default.tsx` up the slot subtree, so this one file also covers `/[pubkey]/channels`, `/peers`, `/forwards`, `/[tab]`, and `/service/[service]` — no per-sub-route defaults needed.

## Verification

- Automated (passed): `test -f "src/app/(overview)/@modal/[pubkey]/default.tsx" && grep -q "export default" ...` → `OK`. File exists with a null default export.
- Mechanism verified against Next.js 16 parallel-route + `default.tsx` docs (see plan `<mechanism>`): nearest-default resolution up the slot subtree covers all deeper unmatched paths at the `[pubkey]` depth.
- Behavioral soft-nav gauntlet (Ops Center → node, Overview ↔ Channels/Peers/Forwards, hard-refresh preservation) is an operator-driven browser check; the structural fix matches the documented resolution for this exact 404 class. Contingency (per-sub-route defaults) was not needed — the single `[pubkey]`-level default is the correct minimal fix.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- FOUND: src/app/(overview)/@modal/[pubkey]/default.tsx
- FOUND commit: 1e70c6f (fix(13-19): add @modal/[pubkey]/default.tsx to fix soft-nav 404)
