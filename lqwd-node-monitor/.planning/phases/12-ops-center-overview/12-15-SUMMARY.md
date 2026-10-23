---
phase: 12-ops-center-overview
plan: 15
subsystem: overview-ui
tags: [redesign, information-architecture, chrome, vitals-first, operator-nav, honest-freshness, D-R1, D-R7, OVW-03, OVW-04]
requires:
  - "src/components/overview/QueueIsland.tsx (12-14 condensed cards — reused)"
  - "src/components/df/NavRailShell.tsx (chrome shell — edited)"
provides:
  - "PollAge.tsx: client ticker rendering 'data as of HH:MM:SS · Ns ago' from the real fetch epoch (no 'Live' claim, no green status dot)"
  - "NavRailShell.tsx: top-bar operator nav (Ops Center · Inbox · Pending · Queue) with open counts when available"
  - "(overview)/page.tsx: vitals-first section order + honest PollAge wiring + Preview toggle removed from the overview"
affects:
  - "Phase 13+ inherit the vitals-first IA + functional top-bar nav pattern"
tech-stack:
  added: []
  patterns:
    - "Honest freshness: tick client-side from the real fetch epoch; never assert 'Live' or fake a healthy green dot"
    - "Chrome does real work: top-bar nav closes the overview dead-end into triage/approval surfaces"
key-files:
  created:
    - src/components/df/PollAge.tsx
  modified:
    - src/app/(overview)/page.tsx
    - src/components/df/NavRailShell.tsx
    - src/components/df/NavRailShell.test.tsx
decisions:
  - "Fleet Vitals moves to hero position (1st) per D-R1 — the first thing the operator sees is the fleet pulse, then the AI band, then the needs-attention queue, then healthy collapse, then footer"
  - "Replaced the fake 'Live · polled Ns ago' green-dot pill with a truthful ticking 'data as of HH:MM:SS · Ns ago' from the real fetch epoch — no 'Live' claim, no status dot (OVW-04 honesty)"
  - "Removed the meaningless 'Preview' view toggle from the overview but KEPT the prop/default so the design-system gallery is unaffected"
  - "Top-bar operator nav (Ops Center · Inbox · Pending · Queue) added to NavRailShell with open counts when available, closing the from-/ navigation dead-end"
metrics:
  duration: ~ (backfilled)
  tasks: 2
  files: 4
  completed: 2026-07-02
backfilled: "Summary written 2026-07-07 during Phase 12 close-out; code shipped in commits 1f6bc1d, 6139e3f, efed74a (2026-07-02)."
---

# Phase 12 Plan 15: Information Architecture + Chrome (Vitals-First, Operator Nav, Honest Freshness)

> **Backfilled summary.** The code shipped 2026-07-02 across commits `1f6bc1d` (honest ticking PollAge label), `6139e3f` (top-bar operator nav + honest PollAge pill in NavRailShell), and `efed74a` (vitals-first overview order + honest chrome wiring). This summary was reconstructed from the plan objective and the committed diff during the Phase 12 verification/close-out on 2026-07-07.

Reshaped the overview information architecture and chrome to the approved redesign: the fleet pulse leads, the top bar does real navigation + honest freshness work, and the freshness label tells the truth about data age.

## What Was Built

**Task 1 — honest `PollAge` ticker + chrome (D-R7):**
- Added `PollAge.tsx`, a client ticker that renders `data as of HH:MM:SS · Ns ago` from the real fetch epoch and updates client-side. It replaces the fake "Live · polled Ns ago" green-dot pill — no "Live" claim and no green status dot (OVW-04 honesty).
- Added the operator nav to `NavRailShell`'s top bar (Ops Center · Inbox · Pending · Queue) with open counts when available, closing the overview navigation dead-end so the triage/approval surfaces are reachable from `/`.

**Task 2 — vitals-first section reorder + Preview removal (D-R1):**
- Reordered `(overview)/page.tsx` so **Fleet Vitals is the first (hero) section** → AI "what needs you now" band → needs-attention queue → healthy collapse → footer. (Vitals previously rendered 4th.)
- Removed the meaningless "Preview" view toggle from the overview while keeping the prop/default so the design-system gallery is unaffected.

## How It Was Verified

- `NavRailShell` unit suite shipped with the change and passes; overview suite green at close-out (103/103 units).
- The overall Phase 12 redesign (12-13/14/15) was an operator-approved spec, and 12-VERIFICATION.md (2026-07-07) confirms OVW-03/OVW-04 PASS with the vitals-first layout and honest `PollAge` present in `src/`.
