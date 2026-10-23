---
phase: quick-260721-lgm
plan: 01
subsystem: overview / df top-bar chrome
tags: [refresh, server-action, ssr-safe, cache, noc]
requires:
  - "NavRailShell top-bar right cluster (ms-auto)"
  - "overview 20s TTL memo global (was inline in page.tsx)"
provides:
  - "src/lib/overview/overview-cache.ts — single-owner overview memo (get/set/clear + OVERVIEW_TTL_MS)"
  - "src/app/actions/refresh.ts — refreshData() server action (bust cache + revalidatePath)"
  - "src/components/df/RefreshControl.tsx — SSR-safe Refresh button + Auto·60s toggle island"
affects:
  - "Every NavRailShell page (overview, nodes, hosts, incident detail) now has the top-bar refresh control"
tech-stack:
  added: []
  patterns:
    - "Client island invoking a server action inside useTransition; revalidatePath drives the re-render (NO useRouter)"
    - "localStorage read in a mount useEffect (never in the useState initializer) for SSR safety"
key-files:
  created:
    - src/lib/overview/overview-cache.ts
    - src/lib/overview/overview-cache.test.ts
    - src/app/actions/refresh.ts
    - src/components/df/RefreshControl.tsx
    - src/components/df/RefreshControl.test.tsx
  modified:
    - "src/app/(overview)/page.tsx"
    - src/components/df/NavRailShell.tsx
    - src/components/df/NavRailShell.test.tsx
decisions:
  - "One cache owner: page.tsx and refreshData both address the SAME globalThis._overviewDataCache via the helper, so the bust can never be a no-op."
  - "No useRouter — it throws under renderToStaticMarkup and would break NavRailShell's locked suite; the server action's revalidatePath re-fetches the RSC payload instead."
metrics:
  duration: ~15m
  completed: 2026-07-21
---

# Phase quick-260721-lgm Plan 01: Top-bar Refresh Button + Auto-refresh Toggle Summary

Added a shared top-bar Refresh button plus an "Auto · 60s" toggle to NavRailShell (so it renders on every page), backed by a relocated single-owner overview cache and a `refreshData()` server action that busts that cache and revalidates the route — honestly labeled as a warehouse re-READ, not a node-collection trigger.

## What was built

**Task 1 — shared cache helper + server action**
- `src/lib/overview/overview-cache.ts`: the sole owner of the `globalThis._overviewDataCache` memo. Exports `OVERVIEW_TTL_MS` (20_000), `getOverviewCache()`, `setOverviewCache(at, promise)`, `clearOverviewCache()`. The promise payload is typed via a **type-only** import of `OverviewData` from `page.tsx` (erased — no runtime cycle, no server-only module pulled into the unit-test graph).
- `src/app/(overview)/page.tsx`: `loadOverviewData()` now reads/writes through the helper; the old inline `OVERVIEW_TTL_MS` / `OverviewCacheEntry` / `globalForOverview` / duplicate cache were removed. The failure-eviction `.catch` is preserved with the "only if OUR entry is still current" identity guard (`getOverviewCache() === entry`). `OverviewData` is now `export`ed.
- `src/app/actions/refresh.ts` (`"use server"`): `refreshData()` calls `clearOverviewCache()` then `revalidatePath("/", "layout")`. No input, returns void, logs nothing sensitive. Honest doc comment: re-reads the warehouse, does NOT trigger collectors.

**Task 2 — RefreshControl island** (`src/components/df/RefreshControl.tsx`, `"use client"`)
- Manual button: `aria-label="Refresh data"`, honest `title` ("Re-reads the warehouse now. Collectors tick on their own (~5 min); this does not force a node collection."). `useTransition` → `refreshData()`; `RefreshCw` gets `animate-spin` and the button is `disabled` while pending.
- Auto toggle: `role="switch"`, `aria-pressed`, visible "Auto · 60s" text. State persists to `localStorage["nodemon.autoRefresh"]`, read in a mount `useEffect` (guarded by `typeof window`). A 60s `setInterval` fires the same refresh; the effect cleanup clears it (OFF + unmount = no leak).
- SSR-safe hooks only (`useTransition`/`useState`/`useEffect`) — **no `useRouter`**. `defaultPending?: boolean` is a test-only hook to force the pending visual under static markup. df tokens only; navy `bg-df-chrome` accent when ON.

**Task 3 — mount** (`src/components/df/NavRailShell.tsx`)
- `<RefreshControl />` inserted in the `ms-auto` right cluster, immediately before the `showLivePill`/PollAge block, so it sits beside the "data as of" stamp on every NavRailShell page. NavRailShell stays a Server Component. Exactly one new test assertion added; the 23 existing assertions were untouched.

## Deviations from Plan

None — plan executed exactly as written. No auto-fixes were required.

## Verification

- `npx vitest run src/components/df src/app/actions src/lib/overview` → **385 passed, 4 failed**. The 4 failures are the documented **pre-existing NavRailShell view-toggle failures** (`view-tab toggle` describe block: default segmented control, active-chip selection, href Links, custom label/hide) — unrelated to this work and untouched. No new breakage; the RefreshControl mount assertion moved NavRailShell from 19→20 passing.
- `npx tsc --noEmit` → clean.
- `npm run lint:noc-guard` → "v2 surfaces clean" (RefreshControl uses df-* tokens only).

## Known Stubs

None.

## Threat Flags

None — `refreshData` takes no client input, writes to neither warehouse nor queue (only the in-process read memo), and the honesty copy prevents misreading it as a live node action (T-QR-02 / T-QR-03 mitigations present).

## Commits

- `eb8dd40` test(260721-lgm): add failing test for single-owner overview cache
- `fa528f5` feat(260721-lgm): extract shared overview-cache helper + refreshData action
- `af68019` test(260721-lgm): add failing test for RefreshControl island
- `535f6eb` feat(260721-lgm): add SSR-safe RefreshControl top-bar island
- `8d51341` test(260721-lgm): assert NavRailShell mounts the refresh control
- `86eb715` feat(260721-lgm): mount RefreshControl in NavRailShell top bar

## Self-Check: PASSED

All 5 created files exist on disk; all 6 task commits present in git log.
