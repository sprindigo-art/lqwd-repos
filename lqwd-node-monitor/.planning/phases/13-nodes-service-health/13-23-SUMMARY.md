---
phase: 13-nodes-service-health
plan: 23
subsystem: routing
tags: [next-app-router, parallel-routes, bugfix, gap-closure]
gap_closure: true
provides:
  - "Removal of the dead @modal parallel-route slot — eliminates the systemic client-side soft-nav 404"
affects: [overview route group navigation]
key-files:
  modified:
    - src/app/(overview)/layout.tsx
  deleted:
    - src/app/(overview)/@modal/ (default.tsx, [pubkey]/default.tsx, inbox/page.tsx, pending/page.tsx)
key-decisions:
  - "Full-page navigation everywhere; no modals (operator decision 2026-07-10)"
requirements-completed: [NODE-03]
duration: ~10min
completed: 2026-07-10
---

# Phase 13 Plan 23: remove dead @modal slot — fix systemic soft-nav 404

**Removed the `@modal` parallel-route slot from the `(overview)` group, eliminating the client-side
soft-navigation 404s that broke `/nodes`, `/[pubkey]`, the Overview tab, and every route without an
explicit `@modal` match. Operator-approved on the live app 2026-07-10.**

## Root cause

Every route hard-loaded 200 (verified by curl), but **soft navigation** 404'd across the board — the
textbook Next.js App Router parallel-routes reconciliation failure. Investigation showed the `@modal`
slot's remaining files (`default.tsx`, `[pubkey]/default.tsx`, `inbox/page.tsx`, `pending/page.tsx`)
**all returned `null`** — leftover placeholders that only existed to support the `(.)[pubkey]`
scorecard-modal interceptor already retired in 13-17. There was no live modal feature; the slot was pure
dead weight still forcing parallel-route reconciliation on every soft nav. The narrower 13-19 fix (one
`@modal/[pubkey]/default.tsx`) was insufficient because the failure spanned non-`[pubkey]` routes too.

## Fix

- `git rm -r "src/app/(overview)/@modal"` — deleted all four null placeholders + the slot.
- `src/app/(overview)/layout.tsx` — removed the `modal` prop, its type, and the `{modal}` render; now a
  plain `children` container. Header comment rewritten to document the removal + rationale.

With no parallel slot, there is no reconciliation to fail: every `(overview)` route is a plain full-page
navigation.

## Verification

- `test ! -d "src/app/(overview)/@modal"` ✓; `grep @modal src/app` → only explanatory comments; layout
  takes only `children`.
- `tsc --noEmit` clean.
- Hard-load regression: `/`, `/nodes`, `/[pubkey]`, `/inbox` all 200 on a fresh server.
- **Operator visual gate APPROVED** — soft-nav works everywhere (Ops Center → Nodes/alias → node,
  Overview ↔ Channels/Peers/Forwards, /inbox, /pending), no 404; hard refresh preserved.
