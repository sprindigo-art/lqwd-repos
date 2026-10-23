---
phase: 03-per-node-console-pending-monitor
plan: 05
subsystem: console-ui
tags: [shadcn-vendoring, server-components, url-driven-navigation, pending-board, supply-chain]
requires:
  - phase: 03
    provides: "03-01: src/lib/console/config.ts (TAB_KEYS/TabKey, WINDOW_PRESETS/WindowKey, DEFAULT_WINDOW, ROW_CAP) + src/lib/read/pending.ts (PendingView/PendingNodeGroup/PendingRow/PendingSweepRow)"
  - phase: 02
    provides: "vendored ui kit precedent (badge.tsx shape), globals.css @theme tokens (brand navy, status family, no-scrollbar), TriageStat/FleetRow/FreshnessStamp grammar"
provides:
  - "src/components/ui/tabs.tsx + button.tsx — vendored shadcn blocks (official registry, allowlist-clean, zero new deps)"
  - "src/components/console/ConsoleTabs.tsx — eight TAB_KEYS as next/link anchors, navy active indicator, zero client tab state"
  - "src/components/console/WindowPicker.tsx — segmented 24h/7d/30d/90d links writing ?window={key}, selected segment bg-brand"
  - "src/components/console/ExportButton.tsx — <a download> styled as Button outline, Download 16px, locked 'Export CSV' label"
  - "src/components/console/SummaryStrip.tsx — TriageStat-grammar stat band, pre-formatted cells, wraps 5→3→2"
  - "src/components/console/CapBanner.tsx — locked cap copy with real counts, exportSlot, null when total <= shown"
  - "src/components/console/EventTable.tsx — generic capped table: console-label heads, mono tabular cells, px-3 py-2 rhythm"
  - "src/components/console/PendingBoard.tsx — scope-parameterized (fleet | node) pending surface rendering PendingView verbatim"
affects:
  - "03-06 (console pages compose ConsoleTabs/WindowPicker/SummaryStrip/CapBanner/EventTable)"
  - "03-07 (export route — ExportButton href target)"
  - "03-08 (pending surfaces compose PendingBoard)"
  - "03-09 (operator checkpoint — ExportButton deviation expectation recorded below)"
tech-stack:
  added: []
  patterns:
    - "URL-as-source-of-truth navigation: tab triggers and window segments are next/link anchors styled to the vendored tabs visual spec — zero client state (D-03)"
    - "Render-verbatim display kit: components receive pre-computed/pre-sorted shapes; sat values route through formatSats, durations format in-component per the FreshnessStamp precedent"
key-files:
  created:
    - src/components/ui/tabs.tsx
    - src/components/ui/button.tsx
    - src/components/console/ConsoleTabs.tsx
    - src/components/console/WindowPicker.tsx
    - src/components/console/ExportButton.tsx
    - src/components/console/SummaryStrip.tsx
    - src/components/console/CapBanner.tsx
    - src/components/console/EventTable.tsx
    - src/components/console/PendingBoard.tsx
  modified:
    - src/app/globals.css
decisions:
  - "ConsoleTabs/WindowPicker hand-style plain Link anchors to the vendored tabs line-variant grammar instead of mounting Radix Tabs — Radix manages client tab state the URL already owns (D-03); the vendored block stays as the visual spec"
  - "PendingBoard formats limbo/amounts via formatSats and durations via an in-component formatAge — pending.ts hands raw values on purpose ('render formats'); AFM-002 single-source-of-truth respected, FreshnessStamp date-formatting precedent followed"
  - "Section marker dots follow the zero-quiet TriageStat discipline: an empty force-close section never flashes red (D-07 applied to D-13 markers)"
  - "Unexpected channel_state keys render as extra sections with the nodata marker — every sat accounted for (03-01 open-Record decision honored at the render layer)"
  - "PendingBoard returns null on a fully-empty view — the pages own the locked 'Nothing pending fleet-wide' / 'No pending channels' empty states (UI-SPEC §Copywriting)"
metrics:
  duration: ~10 min
  tasks: 3
  completed: 2026-06-10
---

# Phase 3 Plan 05: Console Component Kit Summary

Vendored shadcn tabs+button with zero new dependencies and built the seven-piece console display kit — URL-driven ConsoleTabs/WindowPicker/ExportButton plus render-verbatim SummaryStrip/CapBanner/EventTable/PendingBoard, all Server Components.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------- | ----- |
| 1 | Vendor shadcn tabs + button under the supply-chain guard | 2cc32e1 | src/components/ui/tabs.tsx, button.tsx, src/app/globals.css |
| 2 | Navigation components — ConsoleTabs, WindowPicker, ExportButton | c0fb13f | src/components/console/{ConsoleTabs,WindowPicker,ExportButton}.tsx |
| 3 | Data-display components — SummaryStrip, CapBanner, EventTable, PendingBoard | 0b24556 | src/components/console/{SummaryStrip,CapBanner,EventTable,PendingBoard}.tsx |

## What Was Built

- **Vendored blocks (Task 1):** `npx shadcn@latest add tabs button` against the official registry only (components.json `registries: {}`). The CLI created exactly two files and touched nothing else — no `shadcn` runtime dep, no `@import "shadcn/tailwind.css"`, package.json byte-identical. Both follow the badge.tsx vendoring shape (cva variants, `radix-ui` package imports, data-slot attributes). tabs.tsx carries `"use client"` (Radix primitive, same as the vendored table.tsx) — it is visual chrome only and is not imported by any console component.
- **Navigation kit (Task 2):** ConsoleTabs renders the eight TAB_KEYS in D-01 order as `next/link` anchors to `/{pubkey}/{tab}` — active tab gets the navy `after:` underline (brand-light) + full-strength foreground, inactive tabs muted console-label, `overflow-x-auto no-scrollbar` wrapper, `--ring` focus. WindowPicker derives its four segments from WINDOW_PRESETS keys (picker and SQL window can never disagree), hairline `gap-px` segmented framing, selected segment `bg-brand`. ExportButton is a plain `<a href download>` wearing `buttonVariants({ variant: "outline" })` + 16px lucide Download + the locked "Export CSV" label. Zero `"use client"` across all three.
- **Display kit (Task 3):** SummaryStrip copies the TriageStat grammar exactly (mono micro-label over text-2xl tabular value, gap-px cells on border ground, 5→3→2 wrap). CapBanner renders the locked copy with real mono-tabular counts from props and the right-aligned exportSlot; null when `total <= shown`. EventTable is fully generic — column descriptors + rows of pre-formatted strings, console-label heads, divide-y hairlines, hover:bg-card, px-3 py-2 rhythm. PendingBoard renders PendingView verbatim for both scopes: fleet groups separated by the 2xl token (gap-12) and headed by alias + short pubkey; three locked sections (opens=ok / coop=warn / force=critical markers, zero-quiet dots, count in the heading); rows carry truncated channel point + remote peer, prominent unjudged Heading-mono age, verbatim channel_state, formatSats limbo with blocks-til-maturity subtext; sweeps nest indented under their force-close parent; orphan sweeps render in a quiet nodata-marked per-node group; unexpected state keys still render; empty sections collapse to the quiet "No pending …" line.

## Verification Results

- `npx tsc --noEmit` — clean
- `npx vitest run` — 190 passed, 16 skipped (live golden suites, no DB env in worktree)
- `npx eslint src/components/console/ src/components/ui/{tabs,button}.tsx` — clean; Prettier applied
- `grep -r '"use client"' src/components/console/` — nothing
- `grep -rE "/ *1000|/ *1e8" src/components/console/` — nothing; no `sort(` in any component
- `grep '"shadcn"' package.json` — nothing; `grep 'shadcn/tailwind.css' src/app/globals.css` — nothing
- `grep -r dangerouslySetInnerHTML src/components/` — nothing (T-03-10)
- PendingBoard 264 lines (min_lines 60 met); imports PendingView from "@/lib/read/pending"; ConsoleTabs imports TAB_KEYS/TabKey from "@/lib/console/config"

## Recorded UI-SPEC Deviation — ExportButton (for the 03-09 checkpoint)

UI-SPEC §CSV export specifies button states default → busy ("Exporting…", disabled) → done, with the locked failure copy ("Export failed — the window query didn't complete. Try a shorter window."). **v1 intentionally ships a server-direct download with NO client wrapper** — the busy/failure states are omitted this phase; browser-native download behavior stands in and failure surfaces as the export route's error response. This is the plan's deliberate, recorded deviation (not executor discretion). **The 03-09 operator checkpoint should expect a plain immediate download, not the Exporting… flow.** A thin client wrapper restoring the locked states is the known follow-up if the operator flags it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phase 2 doc comments in globals.css tripped the supply-chain grep gate**
- **Found during:** Task 1 verification
- **Issue:** The Phase 2 inlined-CSS banner comments contained the literal strings `@import "shadcn/tailwind.css"` and `end inlined shadcn/tailwind.css`, making the acceptance gate `! grep -q 'shadcn/tailwind.css' src/app/globals.css` fail on documentation, not on an actual import (same class as 03-01 deviation #2)
- **Fix:** Reworded both comments to describe the import without the literal path; CSS rules untouched
- **Files modified:** src/app/globals.css
- **Commit:** 2cc32e1

**2. [Rule 3 - Blocking] Plan-referenced 03-PATTERNS.md and frontend-design SKILL.md absent from worktree**
- **Found during:** Execution start
- **Issue:** Both files are untracked in the main repo, so the worktree (committed state only) lacks them; the plan marks the skill mandatory (D-15)
- **Fix:** Read both from the main repo path (read-only) — no worktree writes outside scope
- **Files modified:** none
- **Commit:** n/a

## Authorization Gates

None — no auth required; no live warehouse access needed for this UI plan.

## Known Stubs

None — all seven components are fully wired presentational kits awaiting composition by 03-06/03-07/03-08 (by design: this wave builds the kit, the page plans compose it). No hardcoded empty data, no placeholder copy outside the locked UI-SPEC strings.

## Threat Flags

None — both planned threats are mitigated as specified: T-03-SC (official registry verified, zero new dependencies, vendored source committed and reviewed) and T-03-10 (React JSX auto-escaping for warehouse aliases; no dangerouslySetInnerHTML anywhere, grep-verified). No new surfaces beyond the plan's threat model.

## Notes for the Orchestrator

- REQUIREMENTS.md intentionally not modified: NODE-01 and PENDING-01 complete only when the pages (03-06, 03-08) compose these components — marking now would be premature (same call as 03-01).
- STATE.md / ROADMAP.md untouched per worktree-mode contract.
- tabs.tsx ships with `"use client"` as vendored (Radix primitive precedent: table.tsx). The console kit does not import it; it exists as the visual spec + future chrome. Flag only if the 03-09 grep gates ever widen to src/components/ui/.

## Self-Check: PASSED

All 10 created/modified files exist on disk; all 3 task commits (2cc32e1, c0fb13f, 0b24556) present in git log.
