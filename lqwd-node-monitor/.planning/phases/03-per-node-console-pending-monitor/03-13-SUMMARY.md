---
phase: 03-per-node-console-pending-monitor
plan: 13
subsystem: ui
tags: [nextjs, react, tailwind, server-components, attention-queue, sketch-001]

# Dependency graph
requires:
  - phase: 03-per-node-console-pending-monitor (03-10)
    provides: NOC Light theme tokens (status palette, font-display, panel surfaces)
  - phase: 03-per-node-console-pending-monitor (03-12)
    provides: rewritten signal primitives — GradeBadge severity-tinted chip API (color/letter/title/size), CriticalChip plain breach text, amber OutlierMarker, no-glyph FreshnessStamp
provides:
  - Attention Queue fleet page (sketch 001 winner A) — Needs-attention incident panel + collapsible Healthy-fleet grid
  - Dedicated right-aligned meta slot per queue row (pending count + freshness) — gap 3 structural fix on fleet rows
  - Triage strip with severity-colored numbers (no dots), pending number in brand navy
  - Dot-free PendingBoard (severity-colored section heading text) and panel-grammar /pending page
affects: [03-14, 03-15, 03-16, phase-04-actions, verifier]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Native <details>/<summary> + Tailwind group-open variant for no-JS collapsible panels in Server Components"
    - "Panel grammar: bg-card border border-border rounded-lg with mono uppercase tracked panel-head (label left, count right, border-b)"
    - "Queue-row grid: grid-cols-[4px_1fr] severity edge bar + md:grid-cols-[minmax(0,200px)_max-content_minmax(0,1fr)_max-content] body"

key-files:
  created: []
  modified:
    - src/app/(overview)/page.tsx
    - src/components/console/PendingBoard.tsx
    - src/app/(overview)/pending/page.tsx

key-decisions:
  - "Queue/healthy split is a pure FILTER of the D-09 pre-sorted order (dot !== ok || stale vs dot === ok && !stale) — no re-sort, preserving T-02-07"
  - "One currentPendingChannels read feeds both the strip total and the per-node Map<local_pubkey, count> queue meta — pendingSummary call removed from the page"
  - "Show/Hide healthy toggle implemented with the Tailwind group-open variant on native <details> — zero client JS, no 'use client'"
  - "Unattached-sweeps heading stays muted (not severity-colored): it is inventory, not a severity section; dot removed"
  - "Extra (unexpected channel_state) sections wear text-status-nodata heading color"

patterns-established:
  - "Severity color only on state: edge bars, grade chips, breach/degraded/stale text, strip numbers — never dots, never structural chrome"
  - "Zero-quiet on colored text: heading/number wears its severity class only when count > 0"

requirements-completed: [NODE-01, PENDING-01]

# Metrics
duration: 10min
completed: 2026-06-11
---

# Phase 03 Plan 13: Attention Queue Fleet Page + Dot-Free Pending Surfaces Summary

**Fleet overview rebuilt as the sketch-001 Attention Queue (incident panel with severity edge bars, breach text, and a dedicated freshness meta slot; healthy nodes collapsed into a native-details grid) and all pending surfaces converted to the no-dot panel grammar.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-11T17:03:58Z
- **Completed:** 2026-06-11T17:13:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- GAP 4 closed (fleet): `/` is now a triage-first panel layout — "Needs attention" incident feed on top (criticals first, then worst grade, stale included — the existing D-09 order filtered, never re-sorted), healthy nodes compressed into a collapsible compact grid. FleetPulse strip and the old column-head table are gone.
- GAP 3 closed (fleet rows): freshness lives in each queue row's dedicated trailing `max-content` grid column (pending count above FreshnessStamp, right-aligned) — the "View scorecard" column it used to collide with no longer exists.
- Severity color now appears ONLY on state: 4px edge bars, GradeBadge chips, breach/degraded/stale text, and triage-strip numbers. TriageStat/PendingStat dots removed; strip numbers wear their state color only when non-zero (zero-quiet preserved); pending number wears brand navy (workload, not severity).
- PendingBoard section markers converted from dots to severity-colored heading text (`headClass`), zero-quiet preserved; unattached-sweeps dot removed; `/pending` wrapped in the fleet-page panel chrome with a scope-naming mono head and font-display title. D-13 display-only internals byte-identical.

## Task Commits

Each task was committed atomically:

1. **Task 1: Attention Queue fleet page** - `f2ea8d3` (feat)
2. **Task 2: Dot-free pending surfaces** - `24c7cf9` (feat)

## Files Created/Modified

- `src/app/(overview)/page.tsx` - Attention Queue layout: triage strip (colored numbers, no dots), Needs-attention panel with queue rows (edge bar / identity / grade chip / WHY cell / meta slot), collapsible Healthy-fleet grid via native `<details open>` + group-open label flip
- `src/components/console/PendingBoard.tsx` - `LOCKED_SECTIONS` `dot:` field replaced with `headClass:` text-color classes; section headings render as colored mono uppercase text with no dot span
- `src/app/(overview)/pending/page.tsx` - Board wrapped in panel grammar (`Pending · fleet-wide` head + node count), title moved to font-display uppercase tracking-wide; locked copy strings untouched

## Decisions Made

- Healthy panel's Show/Hide toggle uses `group-open:hidden` / `hidden group-open:inline` spans inside `<summary>` so the label flips without client JS — keeps the page a pure Server Component (T-02-02).
- Per-node pending counts keyed on `local_pubkey` (confirmed as the channels identity column in `src/lib/read/pending.ts`, Pitfall 2).
- A warn-and-stale row shows `degraded` as its label (severity wins the edge bar and label); its staleness still shows loud via the STALE FreshnessStamp in the meta slot. `stale telemetry` labels rows that queue only for staleness (dot ok).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Copied gitignored `.env.local` into the worktree for the dev-server probe**
- **Found during:** Plan-level verification (dev-server probe)
- **Issue:** Worktrees don't carry gitignored files; the instrumentation hook fails on missing `ROUTING_VM_DATABASE_URL`, returning 500 on every route before any page code runs
- **Fix:** Copied `.env.local` from the main checkout into the worktree (gitignored — never staged or committed)
- **Files modified:** none committed
- **Verification:** `/` → 200, `/pending` → 200 against live warehouse data
- **Committed in:** n/a (runtime config only)

---

**Total deviations:** 1 auto-fixed (1 blocking, environment-only)
**Impact on plan:** No code-scope change; purely enabled the sanctioned verification probe.

## Issues Encountered

- First Task-1 grep gate failed on the literal `FleetPulse` surviving in a code comment ("no FleetPulse color strip") — reworded the comment; component and all usages were already removed.
- Live-data probe note: all 26 nodes currently sit in the queue (mostly stale/degraded warehouse data), so the Healthy-fleet panel is correctly omitted per the plan's empty-healthy edge case ("26 of 26 nodes" renders in the panel head). The healthy grid path is exercised by the markup but not observable against today's live data.

## Known Stubs

None — both surfaces render live warehouse data end to end; no placeholder values or unwired components introduced.

## Threat Flags

None — no new endpoints, no new dependencies, no auth/file-access changes; the fleet page's pending read reuses the already-sanctioned recency-bounded `currentPendingChannels` with `.catch` degrade (T-03-25 mitigated as planned).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Fleet + pending surfaces now follow the sketch-validated panel grammar; remaining gap-closure plans (03-14..03-16) can compose against the QueueRow/panel patterns established here.
- Sibling-agent console components (Sparkline, EvidencePanel, ActiveSignalsPanel, ConsoleRail) were not touched, as required.

---
*Phase: 03-per-node-console-pending-monitor*
*Completed: 2026-06-11*

## Self-Check: PASSED

All modified files exist on disk; task commits f2ea8d3 and 24c7cf9 verified in git log.
