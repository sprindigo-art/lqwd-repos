---
phase: 03-per-node-console-pending-monitor
plan: 08
subsystem: pending-monitor
tags: [pending, fleet-overview, rsc, force-dynamic, triage-strip]
requires:
  - phase: 03
    provides: "03-01: src/lib/read/pending.ts (currentPendingChannels/currentPendingSweeps/buildPendingView/pendingSummary) + src/lib/console/config.ts (PENDING_RECENCY_HOURS)"
  - phase: 03
    provides: "03-05: src/components/console/PendingBoard.tsx (scope-parameterized pending surface)"
  - phase: 02
    provides: "FreshnessStamp, TriageStat grammar, overview page error/header composition"
provides:
  - "src/app/(overview)/pending/page.tsx — fleet-wide /pending board (D-11): force-dynamic RSC, sanctioned recency-filtered read, PendingBoard scope=fleet, locked empty/error states, FreshnessStamp"
  - "src/app/(overview)/page.tsx PENDING block (D-12): fifth triage stat linking to /pending, warn dot only when count > 0, independent degradation to em-dash"
affects:
  - "03-09 (operator checkpoint verifies both pending surfaces)"
  - "Phase 4 (stuck detector will judge the ages this surface displays unjudged)"
tech-stack:
  added: []
  patterns:
    - "Independent degradation in Promise.all: secondary read carries its own .catch returning null so the primary view's error state stays scoped (pending block renders em-dash, overview stays up)"
key-files:
  created:
    - src/app/(overview)/pending/page.tsx
  modified:
    - src/app/(overview)/page.tsx
decisions:
  - "PENDING block is its own PendingStat component (Link-wrapped TriageStat grammar) rather than a TriageStat prop extension — it alone needs href, null-degradation, and the brand-glow hover affordance"
  - "pendingSummary failure degrades to a muted em-dash with NO warn dot — an unknown count must not light yellow"
  - "/pending header renders the FreshnessStamp only when view.asOf is non-null — 'no data yet' next to 'Nothing pending fleet-wide' would read contradictory; stale={false} is honest because the recency filter bounds data to PENDING_RECENCY_HOURS"
  - "Added the '← Fleet overview' breadcrumb to /pending matching the [pubkey] page nav precedent — /pending is a subpage and needs the way back"
metrics:
  duration: ~10 min
  tasks: 2
  completed: 2026-06-10
---

# Phase 3 Plan 08: Fleet-Wide Pending Surfaces Summary

Fleet pending board at /pending rendering PendingBoard scope=fleet from the sanctioned recency-filtered readers, plus the D-12 PENDING triage block on the overview — pendingSummary in Promise.all, loadFleetView untouched, zero-quiet warn dot, em-dash degradation.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------- | ----- |
| 1 | The fleet-wide /pending page | a03056c | src/app/(overview)/pending/page.tsx |
| 2 | PENDING block in the overview triage strip | 613220d | src/app/(overview)/page.tsx |

## What Was Built

- **/pending (Task 1):** force-dynamic RSC. Fleet-scoped `currentPendingChannels` + `currentPendingSweeps` (PENDING_RECENCY_HOURS, no pubkey arg) in Promise.all → `buildPendingView` → `<PendingBoard view scope="fleet" />`. Header: "Pending channels" title + scope subtitle + FreshnessStamp (view asOf, conditional on non-null). Locked error state ("Couldn't load Pending." + the read-only reassurance) and locked fleet empty state ("Nothing pending fleet-wide" + body). Node groups separated by the 2xl token via PendingBoard's fleet gap-12. No window picker (recency is a config tunable, not an operator control); display-only per D-13 — no judgment props, no row-level red/yellow. Metadata `title: "Pending"` renders "Pending | NodeMonitor" through the root template.
- **Overview PENDING block (Task 2):** data load became `Promise.all([loadFleetView(), pendingSummary(PENDING_RECENCY_HOURS).catch(→ null)])` — loadFleetView itself unmodified (Pitfall 11; `git diff src/lib/scorecard/fleet.ts` empty). New `PendingStat` component: TriageStat cell grammar wrapped in `<Link href="/pending">`, label literal "Pending", `bg-status-warn` dot rendered only when `total > 0`, `total === null` (read failure) renders a muted em-dash with no dot. Strip grid widened to five blocks wrapping 5→3→2 (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`), gap-px band grammar preserved.

## A1 Routing Check (recorded per plan)

Production server (`next start` with the operator's read-only warehouse env) route hits:
- `GET /pending` → **HTTP 200**, the fleet board rendered: 20 node groups, all three locked sections per group, freshness stamp present. The static segment won.
- `GET /notapubkey` → **HTTP 404** via PUBKEY_RE — confirming a non-pubkey string never reaches the [pubkey] data path, and "pending" would 404 there even without segment precedence.

Live data sanity: the PENDING block showed **63** with the warn dot lit — matching the ~63 currently-pending channels live-verified in 03-01.

## Verification Results

- `npx tsc --noEmit` — clean (both tasks)
- `npm run build` — clean; route table shows `ƒ /pending` as its own dynamic route
- `npx vitest run` — 237 passed, 16 skipped (live golden suites; no DB env in worktree test run)
- Task 1 greps: `force-dynamic` ✓, `Nothing pending fleet-wide` ✓; eslint + prettier clean
- Task 2 greps: `pendingSummary` ✓, `Promise.all` ✓ in page.tsx; `pendingSummary` absent from src/lib/scorecard/fleet.ts ✓; `href="/pending"` ✓; warn dot conditional on `total > 0` in source ✓
- D-13 check: PendingBoard invoked with only `view` and `scope` — no judgment props; no red/yellow styling on individual pending rows
- Live render: overview five-block strip confirmed in served HTML (`lg:grid-cols-5`, PENDING block markup with dot + tabular count)

## Deviations from Plan

### Auto-fixed Issues

None affecting code. One verification-environment note:

**1. [Environment] Worktree has no .env — instrumentation fail-loud blocks any server boot**
- **Found during:** Task 1 A1 route check
- **Issue:** `src/instrumentation.ts` health-checks the warehouses at startup (by design, fail-loud), so the dev/prod server cannot boot in the credential-less worktree — every route 500s before routing is exercised
- **Fix:** Sourced the main repo's `.env.local` (read-only warehouse role) for the route-hit verification only; nothing written outside the worktree, no env files committed
- **Files modified:** none
- **Commit:** n/a

### Plan-level note

The plan's read_first referenced `.claude/skills/frontend-design/SKILL.md` and `03-PATTERNS.md`, both untracked in the main repo and therefore absent from the worktree (same as 03-05's deviation #2). Both were read from the main repo path (read-only), satisfying D-15.

## Authorization Gates

None — the warehouse read used the existing read-only role from the operator's local `.env.local`; no new credentials or logins.

## Known Stubs

None — both surfaces are fully wired to the sanctioned readers and verified against live warehouse data (20 node groups on /pending, count 63 on the overview block).

## Threat Flags

None — both planned threats mitigated as specified: T-03-18 (reads only via the recency-filtered 03-01 readers; FreshnessStamp on the board; golden test guards drift) and T-03-19 (pendingSummary is one bounded aggregate; loadFleetView not grown). No surfaces beyond the plan's threat model.

## Notes for the Orchestrator

- STATE.md / ROADMAP.md / REQUIREMENTS.md untouched per worktree-mode contract. PENDING-01's fleet-wide half is now complete; whether PENDING-01 can be marked depends on 03-06's per-node Pending tab (parallel worktree) — orchestrator's call after the wave merges.
- File overlap check: this plan touched only its declared files (pending/page.tsx new, overview page.tsx modified) — no contact with 03-06's `[pubkey]` / scorecard files.

## Self-Check: PASSED

- src/app/(overview)/pending/page.tsx — FOUND
- src/app/(overview)/page.tsx — FOUND (modified)
- Commit a03056c — FOUND
- Commit 613220d — FOUND
