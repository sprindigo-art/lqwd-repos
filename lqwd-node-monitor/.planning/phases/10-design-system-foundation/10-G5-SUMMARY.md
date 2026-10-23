---
phase: 10
plan: G5
subsystem: design-system / df primitives
tags: [navrailshell, top-bar, fleet-ramp, tally, view-toggle, live-poll, avatar, gap-closure]
requires:
  - df severity tokens (df-critical/warning/watch/ok-text) — globals.css §severity ramp
  - df chrome/radius/shadow tokens (df-chrome, rounded-df-pill/btn, shadow-df-rest)
provides:
  - NavRailShell top-bar operator instrumentation as reusable, props-driven parts
  - FleetCounts + ViewTab exported types for callers
affects:
  - src/app/(design)/design-system/page.tsx (consumer — unchanged, additive props)
tech-stack:
  added: none
  patterns:
    - Server-Component-safe segmented toggle (active via prop, navigation via href, no client onClick)
    - decorative ramp is aria-hidden; accessible numbers live in the tally
    - df severity TOKENS only on the instruments; chrome/brand never carries a health hue
key-files:
  created:
    - src/components/df/NavRailShell.test.tsx
  modified:
    - src/components/df/NavRailShell.tsx
decisions:
  - View-tab toggle is presentational + Server-safe (active = activeView prop, navigation = per-tab href); no "use client"
  - Ramp is aria-hidden decorative; tally carries the accessible crit/warn/watch/ok numbers
  - Live-poll pill renders a glanceable relative age (4s/3m/2h), matching the prototype's recency cue (not a wall-clock stamp)
metrics:
  duration: ~12m
  completed: 2026-06-24
---

# Phase 10 Plan G5: NavRailShell Top-Bar Instrumentation Summary

Rebuilt `NavRailShell` from a chrome skeleton into the prototype's full operator top bar — fleet severity ramp, crit/warn/watch/ok tally, Mid-incident/All-clear view toggle, "Live · polled Ns ago" pill, and the rail's bottom avatar — all as additive, props-driven, Server-Component-safe parts (gap-analysis ranked gap #8).

## What was built

Reproduced the prototype "Operations Center / LQWD Technologies · fleet overview" top bar (`Ops Center - Data-Forward v2.dc.html` lines 39–88, logic 747–752) as reusable shell parts:

1. **Fleet ramp bar** (`FleetRamp`) — a 230px segmented severity strip; one flex segment per non-zero bucket, width proportional to its share of the fleet. All-clear collapses to a solid `bg-df-ok` strip; an empty fleet renders a bare neutral track (no divide-by-zero, no `NaN` widths). `aria-hidden` (decorative) — the tally carries the numbers.
2. **Tally counts** (`FleetTally`) — `4 crit · 1 warn · 2 watch · 19 ok`; each count in its severity TEXT hue (`text-df-critical/warning/watch` + `text-df-ok-text` for the AA-text ok role), tabular numerals so counts don't jitter.
3. **View-tab toggle** (`ViewToggle`) — the "Preview" segmented Mid-incident/All-clear control. Active segment (driven by the `activeView` prop) lifts onto a white `bg-df-surface` chip with `shadow-df-rest`; each segment is a `Link` when it supplies an `href`, else a presentational `span`. `role="tablist"`/`role="tab"`/`aria-selected` for a11y. No client `onClick` → stays Server-safe.
4. **Live-poll pill** (`LivePollPill`) — "Live · polled Ns ago" with a green-ring `bg-df-ok` status dot; `formatPollAge` renders a compact relative age (`4s`/`3m`/`2h`) and clamps negative/non-finite ages to `0s`.
5. **Bottom avatar** — the rail's `mt-auto` (`margin-top:auto`) `#2C4A7E` circle affordance.

All new props are **optional with defaults** (`counts` → all-clear baseline, `viewTabs` → Mid-incident/All clear, `pollAgeSeconds` → 0, plus `show*` flags). The existing `active`/`title`/`subtitle`/`topBarEnd`/`children` props are untouched, so the gallery keeps compiling without an edit. Exported `FleetCounts` and `ViewTab` types for callers.

## Constraints honored

- **Files owned only:** `NavRailShell.tsx` (modified) + `NavRailShell.test.tsx` (new). No other `df/*` component touched.
- **No token edits:** consumes existing `df-*` severity/chrome/radius/shadow utilities; no `globals.css`/`tokens.ts` change. No new global token was needed (the live-pill's faint ok ring uses an inline `shadow-[…]` rgba of the existing ok hue, scoped local).
- **Additive / gallery compiles:** gallery (`design-system/page.tsx`) unchanged; `tsc --noEmit` reports zero errors on `NavRailShell.tsx`/`.test.tsx`.
- **Server Component preserved:** no `"use client"`; the toggle is presentational (active via prop, nav via href).

## Self-checks (the only two required)

- `CI=true npx vitest run --pool=forks --no-file-parallelism src/components/df` → **11 files, 54 tests passed** (18 new NavRailShell tests).
- `npm run lint:noc-guard` → **exit 0** ("v2 surfaces clean").
- No `next build` run (per constraint). No `timeout` used.

## Deviations from Plan

None — objective executed as written. One in-scope test-authoring correction during the loop: two initial assertions were attribute-order-/substring-sensitive (`aria-selected` precedes `data-view-tab` in React's source-order output; Tailwind's `mb-5` contains the substring `-5`). Tightened those assertions to match the pill's bolded age node and order-independent attribute groups. No component behavior changed.

## Known Stubs

None. Every part is wired to real props with honest defaults; no placeholder/empty-data flows to render.

## Threat Flags

None — no new network endpoints, auth paths, file access, or trust-boundary schema. The toggle exposes navigation via caller-supplied `href` only (no execution), consistent with the dashboard's "never silently mutates" posture.

## Deferred / Out-of-scope (not touched)

- Pre-existing `EvidenceChart.test.tsx` TS18047 "'model' possibly null" errors (7) — out of scope (not an owned file).
- Known pre-existing 19 `src/lib/queue/*` Postgres permission-denied test failures — ignored per constraint (not run; df-only self-check).

## Self-Check: PASSED

- FOUND: src/components/df/NavRailShell.tsx (modified)
- FOUND: src/components/df/NavRailShell.test.tsx (created)
- vitest df: 54/54 passed · noc-guard: exit 0
