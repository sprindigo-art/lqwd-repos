---
phase: 13-nodes-service-health
plan: 17
subsystem: nodes-service-health
tags: [peers, routing, ops-center, gap-closure, node-detail]
requires:
  - src/lib/read/latest.ts (projectChannelBaseline — sanctioned active predicate)
  - src/app/(overview)/@modal/default.tsx (parallel-slot null fallback)
provides:
  - shapePeersTab active-only counterparty derivation (real peers render)
  - Ops Center healthy-node aliases linked to /{pubkey}
  - /{pubkey} always renders the full page (scorecard-modal interceptor retired)
affects:
  - /{pubkey}/peers
  - / (Ops Center healthy-node inventory)
  - (overview) parallel-route navigation
tech-stack:
  added: []
  patterns:
    - navy-structural (df-brand) link for navigation, never a health hue
    - align console shapers to the sanctioned latest reader predicate (active === true)
key-files:
  created: []
  modified:
    - src/lib/console/peers.ts
    - src/lib/console/peers.test.ts
    - src/app/(overview)/page.tsx
    - src/app/(overview)/layout.tsx
  deleted:
    - src/app/(overview)/@modal/(.)[pubkey]/page.tsx
decisions:
  - "Peers derive from active === true ONLY — routing_vm closed flag is unreliable (coexists with active=true), matches projectChannelBaseline/NodeChannelsTable"
  - "G8 alias link is navy structural (df-brand); internal relative href, destination re-validates PUBKEY_RE"
  - "Removing the (.)[pubkey] interceptor makes /{pubkey} soft-navs resolve to the full page; @modal falls back to default.tsx (null)"
metrics:
  duration: ~15m
  completed: 2026-07-10
  tasks: 3
  files: 5
---

# Phase 13 Plan 17: Node Detail Gap-Closure Round 2 (G7/G8/G9) Summary

Fixed the empty peers table (reader bug, not genuine no-peers), linked Ops Center node aliases to their detail pages, and retired the scorecard-modal interception so `/{pubkey}` always renders the full overview.

## What Was Built

### G7 — Peers reader root-cause fix (Task 1)
`shapePeersTab` excluded any channel whose latest row carried `closed === true`. In `routing_vm` the `closed` column is unreliable — it coexists with `active=true` on the latest row (fleet-wide 4463 active+closed rows vs 231 active+open; the top node had 1002 active counterparties but 0 survived the closed filter). Removed the `r.closed === true` sub-clause so the counterparty set derives from `active === true && remote_pubkey != null`, exactly matching `projectChannelBaseline` (the sanctioned reader the operator confirmed renders channels correctly). Capacity aggregation, `asOf` derivation, the honest headline, and flapcount-lifetime labeling are unchanged. Added a regression test asserting an `active:true, closed:true` counterparty now appears, plus a `remote_pubkey: null` exclusion case; existing assertions stay green (16 tests pass).

### G8 — Ops Center alias links (Task 2)
`HealthyCollapse` in `src/app/(overview)/page.tsx` now wraps each healthy-node alias in a `next/link` to `/${node.pubkey}`, styled navy-structural (`text-df-brand hover:underline`) — navigation is structure/action, never a health hue. The href is an internal relative path using a trusted 66-hex warehouse value; the destination page re-validates `PUBKEY_RE` before any read, so no open-redirect surface is introduced.

### G9 — Retire scorecard-modal interception (Task 3)
Deleted `src/app/(overview)/@modal/(.)[pubkey]/page.tsx`. With no interceptor, soft navigations to `/{pubkey}` (the Overview tab and the new G8 alias links) resolve to the real full page; the `@modal` slot falls back to `@modal/default.tsx` (null). Updated the stale `layout.tsx` comment to reflect that `/{pubkey}` renders as a full page and the modal slot only hosts the remaining inbox/pending modals.

## Scope Notes
- **G8 scope:** closes the alias-link gap for the healthy-node inventory (the node rows on the Ops Center). Linking node labels inside the incident-queue cards would require threading raw pubkeys through the shared df SeverityCard/SeverityHeroCard primitives — out of this minimal gap's scope and not requested by the gate wording.
- **G9 preservation:** only the `(.)[pubkey]` interceptor was removed. The sibling `@modal/inbox`, `@modal/pending` intercepts and `@modal/default.tsx` are untouched. `ScorecardModal`/`ScorecardPanel` components remain in the tree (now unreferenced by this route) — not deleted.

## Deviations from Plan
None — plan executed exactly as written.

## Verification
- `npm run test -- peers` — 16 passed (includes G7 regression).
- `grep -c "closed === true" src/lib/console/peers.ts` returns 0.
- `npm run build` succeeds after both the Link import (G8) and the intercept deletion (G9).
- Ops Center page imports `Link` from `next/link`; alias wrapped in `href={`/${node.pubkey}`}` with `text-df-brand`.
- `@modal/(.)[pubkey]/page.tsx` removed; `@modal/default.tsx` intact; inbox/pending present.

## Commits
- `51d6d2b` fix(13-17): derive peers from active-only predicate (G7)
- `0e61219` feat(13-17): link Ops Center node aliases to /{pubkey} (G8)
- `1b80682` refactor(13-17): retire /{pubkey} scorecard-modal interceptor (G9)

## Known Stubs
None.

## Self-Check: PASSED

All modified/created files present, interceptor removed, all 4 commits in git log.
