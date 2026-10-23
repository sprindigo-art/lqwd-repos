---
phase: 14-hosts-infra-monitoring
plan: 06
subsystem: host-detail-ui
tags: [host-02, host-detail, incident-banner, storage-volumes, on-host-nodes, vm-vitals, rsc, membership-gate]
requires:
  - phase: 14-hosts-infra-monitoring plan 02
    provides: "host-history reads (getHostMetricsHistory/getHostStorageHistory) + storage-projection copy (humanizeDaysToFull/projectionStatusCopy/formatPctPerDay)"
  - phase: 14-hosts-infra-monitoring plan 03
    provides: "evaluateDaysToFull (D-13 four-level band) + buildHostRollup (worst-of + D-05 driver)"
  - phase: 14-hosts-infra-monitoring plan 04
    provides: "buildHostRunbook(driverClass) → verify-first HostRunbook"
  - phase: 12 (LOCKED)
    provides: "assembleIncidents/GroupedIncident, severity-map, ownership, service-display; df primitives (SeverityCard, SeverityRow, CommandModal, ThresholdMeter, TwoAxisPip, FreshnessChip, VmVitals, NavRailShell)"
provides:
  - "HOST-02 Host Detail RSC at /(overview)/hosts/[hostId] — D-10 single-scroll, membership-gated, fail-soft"
  - "HostIncidentBanner: incident chrome + inert verify-first runbook (D-11, zero lifecycle affordance)"
  - "StorageVolumes: dense volume rows with honest projection-or-status gate (D-13…D-16)"
  - "OnHostNodes: compact SeverityRow rows → Node Detail (D-12)"
affects:
  - 14-07 (operator visual gate + zero-write-path grep battery consumes these screens)
tech-stack:
  added: []
  patterns:
    - "Presentation-pure host components: the page computes all severity at read time (bands + rollup); components only paint"
    - "Projection branches on growth.status, never on daysToFull null-presence (Pitfall 4)"
    - "Membership gate against the hosts dimension BEFORE any echo; notFound() outside the try/catch"
    - "Date.now() kept out of the RSC render body (module-level sampleAges helper) — react-hooks/purity clean"
key-files:
  created:
    - src/components/host/HostIncidentBanner.tsx
    - src/components/host/StorageVolumes.tsx
    - src/components/host/OnHostNodes.tsx
    - src/app/(overview)/hosts/[hostId]/page.tsx
  modified: []
decisions:
  - "On-host node forwards column labeled 'fwds' (no window claim) — the scorecard routing dimension supplies 7d forwards, not the spec's 30d; honesty-first over a fabricated window"
  - "WhyChain omitted from the incident banner — GroupedIncident children carry no timestamped events; fabricating times would violate the honesty invariant"
  - "host-layer incident driver maps to the disk-filling runbook (closest available host operation in the closed HostRunbookDriver union)"
metrics:
  duration: ~20 min
  completed: 2026-07-13
  tasks: 3/3
---

# Phase 14 Plan 06: Host Detail (HOST-02) Summary

Ships the HOST-02 single-scroll Host Detail at `/(overview)/hosts/[hostId]` — a membership-gated RSC that renders the D-10 incident-first order (header → incident banner → VM vitals with real 24h sparklines → infra two-axis → storage volumes → on-host nodes), composing three new presentation-pure host components over the locked df primitives and the 14-02/03/04 read+rollup+runbook layers.

## What Was Built

- **`src/components/host/HostIncidentBanner.tsx`** (Server) — the root-cause incident banner (D-11). `SeverityCard` chrome at the incident severity carries the `driven by:` root-cause driver line and the affected children rendered IN ENGINE ORDER (mapped, never re-ranked), and the inert `CommandModal` (`kind: "runbook"`) exposes the verify-first steps + copy-to-run command behind the single `Open runbook` trigger. Zero incident-lifecycle affordance of any kind (no deep link, no disabled placeholder). Rendered only when a host-keyed incident exists — no green variant.
- **`src/components/host/StorageVolumes.tsx`** (Server) — dense volume rows (D-13…D-16). Each row: mono mount + `ThresholdMeter` (used-% fill, page-computed severity) + mono `%` + signed `%/day` rate + the projection slot, which ALWAYS renders and branches on `growth.status` (never on `daysToFull` presence): `ok` → `humanizeDaysToFull`, every other status → verbatim `projectionStatusCopy`. `status === "stale"` flips the whole row to the gold stale treatment. Honest empty state.
- **`src/components/host/OnHostNodes.tsx`** (Server) — compact `SeverityRow` rows (D-12) using ONLY the new columnar props (`id`/`note`/`status`/`statusSev`/`href`); `href` promotes each row to a Node-Detail Link. Evidence (impl tag, active channels, a compact liquidity bar, forwards, freshness) rides the `note` slot, pre-read from the scorecard dimensions. Honest infrastructure-only empty state.
- **`src/app/(overview)/hosts/[hostId]/page.tsx`** — the HOST-02 detail RSC. `force-dynamic` + `revalidate = 0`. Security gauntlet: `hostId` (operator free text) is membership-gated against `getLatestHostMetrics()` BEFORE any echo — a miss resolves to `notFound()` placed OUTSIDE the try/catch; a total read failure renders the honest generic `Couldn't load host telemetry.` copy (no hostId echo, no DB name). Fail-soft reads (chain, fleet, insight, fleet-wide services, 24h metrics+storage history) each carry their own `.catch`. Health is computed HERE at read time (telemetry bands, days-to-full band, `buildHostRollup`) and passed to the presentation-pure components; the incident is `assembleIncidents(...).find(i => i.key === hostId)`, and the runbook is `buildHostRunbook` on the incident's driver class.

## Task Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 | bb4f5d1 | feat(14-06): add HostIncidentBanner — incident chrome + inert verify-first runbook |
| 2 | b2b36c5 | feat(14-06): add StorageVolumes + OnHostNodes host-detail sections |
| 3 | 4216865 | feat(14-06): add HOST-02 Host Detail RSC with membership gate |

## Verification

- Plan verify command `npx vitest run src/lib/overview src/lib/read` — **329 passed, 17 skipped** (live-DB blocks skip without env); no regression to the read/overview layers this plan consumes.
- `npx tsc --noEmit` — clean (zero errors across the repo, including the four new files).
- `npx eslint` on all four new files — clean (fixed a `react-hooks/purity` `Date.now()`-in-render error by hoisting the age math to a module-level `sampleAges` helper).
- All plan acceptance greps pass (Task 1: CommandModal ≥1, `"runbook"` ≥1, `open incident` = 0, `.sort` = 0, `Open runbook` present; Task 2: `projectionStatusCopy`/`humanizeDaysToFull` ≥1, `daysToFull !== null` = 0, no `evaluateBand|evaluateDaysToFull|worstSeverity` in components, no deprecated SeverityRow props, exact empty strings; Task 3: `notFound()` ≥1 outside try, `getHostMetricsHistory`/`getHostStorageHistory`/`assembleIncidents`/`.key === hostId` ≥1, `force-dynamic` ≥1, `"use client"` = 0, error copy present).

## Threat Model Compliance

- **T-14-16 (SQLi):** the page passes `hostId` only into the 14-02 param-bound bounded scans (`getHostMetricsHistory`/`getHostStorageHistory`) — no raw interpolation anywhere.
- **T-14-17 (reflected text):** membership gate against the loaded hosts dimension precedes any echo; `notFound()` is outside the try; only the matched, trusted `host.hostId`/`host.hostname` is rendered (React auto-escaped); zero `dangerouslySetInnerHTML`.
- **T-14-18 (command execution):** the runbook renders through `CommandModal` as escaped text + copy-to-clipboard only; no exec path introduced.
- **T-14-19 (fake freshness):** `VmVitals` degrades to `StaleChart` on a stale host; `ThresholdMeter stale` on stale rows; projection refused unless `growth.status === "ok"` (branch-on-status, pinned in acceptance).
- **T-14-20 (info disclosure):** the error copy is honest and generic — no hostId echo, no DB name.
- **T-14-SC (npm installs):** zero packages installed this plan.

## Deviations from Plan

**1. [Rule 3 - Blocking] Fresh worktree had no node_modules**
- **Found during:** Task 1 setup (tsc/eslint/vitest unavailable).
- **Fix:** symlinked the main repo's gitignored `node_modules` into the worktree (zero packages installed).
- **Files modified:** none tracked (symlink is gitignored).
- **Commit:** n/a.

**2. [Rule 1 - Bug] `Date.now()` in the RSC render body tripped `react-hooks/purity`**
- **Found during:** Task 3 lint.
- **Issue:** computing per-mount sample ages inline in the component body is flagged as an impure call during render.
- **Fix:** hoisted the age math to a module-level `sampleAges(samples)` helper; the component reads its result.
- **Files modified:** `src/app/(overview)/hosts/[hostId]/page.tsx`.
- **Commit:** 4216865.

Choice points the plan delegated (see `decisions`): forwards column labeled `fwds` (scorecard supplies 7d, not the spec's 30d — honesty over a fabricated window); WhyChain omitted (no honest timestamped events on `GroupedIncident` children); host-layer driver → disk-filling runbook.

## Known Stubs

None — all four files are fully wired. VM vitals feed off real 24h `getHostMetricsHistory`/`getHostStorageHistory` reads (not empty arrays); storage projection consumes real `computeStorageGrowth` output; the incident banner and rollup consume the live incident/rollup engines. Empty states are honest data-driven branches, not stubs.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. The one new route segment (`/hosts/[hostId]`) is read-only and membership-gated; its history reads reuse the 14-02 param-bound builders already in the plan's threat model (T-14-16).

## Self-Check: PASSED

- src/components/host/HostIncidentBanner.tsx — FOUND
- src/components/host/StorageVolumes.tsx — FOUND
- src/components/host/OnHostNodes.tsx — FOUND
- src/app/(overview)/hosts/[hostId]/page.tsx — FOUND
- Commits bb4f5d1, b2b36c5, 4216865 — FOUND
