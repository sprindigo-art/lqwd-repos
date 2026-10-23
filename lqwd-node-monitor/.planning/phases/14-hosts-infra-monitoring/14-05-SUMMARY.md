---
phase: 14-hosts-infra-monitoring
plan: 05
subsystem: hosts-ui
tags: [hosts, host-card, threshold-meter, two-axis-trio, node-dots, facets, worst-first, fleet-shaped, honest-stale, rsc]
requires:
  - "14-03 (src/lib/overview/host-rollup.ts): buildHostRollup worst-of severity + D-05 driver"
  - "14-04 (src/lib/overview/host-filter.ts): parseHostFacets / applyHostFilters / sortHostsWorstFirst"
  - "14-01 (src/components/df/ThresholdMeter.tsx): the D-03 severity fill meter"
  - "Phase 11 (LOCKED): getLatestHostMetrics / getChainTelemetry / getServiceHealth read model"
  - "Phase 12 (LOCKED): buildOwnershipMap, severityFromBand, TELEMETRY_BANDS/evaluateBand"
provides:
  - "src/components/host/HostFilters.tsx — navy-structural URL-serialized facet chips"
  - "src/components/host/HostCard.tsx — SeverityCard chrome + ThresholdMeter ×3 + TwoAxisPip ×3 + node dots + no-telemetry variant + HostCardModel contract"
  - "src/app/(overview)/hosts/page.tsx — HOST-01 fleet-shaped list RSC"
affects:
  - "14-06/14-07 Host Detail + gate (consume the same card model grammar + HostCardModel type)"
  - "The nav rail Hosts surface is now reachable and populated"
tech-stack:
  added: []
  patterns:
    - "Stretched-link card (Pitfall 6): plain div root + absolute z-0 Link to Host Detail; node dots relative z-10 as their own Links — never nested <a>"
    - "Presentation-pure card (12-10 lesson): every severity — worst-of, per-meter, per-dot — arrives via props; the component grades nothing"
    - "Fleet-shaped enumeration (D-06): unfiltered getLatestHostMetrics; silent host → gold no-telemetry card, never hidden/green"
key-files:
  created:
    - src/components/host/HostFilters.tsx
    - src/components/host/HostCard.tsx
    - src/app/(overview)/hosts/page.tsx
  modified: []
decisions:
  - "DISK meter shows the MOST-FULL mount (max used%) with that mount's read-time band severity — one glanceable disk meter per card, worst mount surfaced"
  - "MEM meter fill is USED memory (100 − availPct); severity graded off availPct against memAvailablePct band (fill and grade read the same fact, honest direction)"
  - "No-telemetry hosts never reach buildHostRollup (its caller-branch contract): filter row = healthy rollup + stale flag (14-04 pinned fixture), rendered as the A4 gold card and grouped in the stale sort band"
  - "Stale-with-data hosts render the normal card but with hatched ThresholdMeter (stale) + '—' values — never a fresh-looking fill off old data (ThresholdMeter stale contract)"
  - "OPS_NAV extended locally with the hosts item; NavRailShell RAIL_ITEMS already carries Hosts (no shell edit)"
metrics:
  duration: "~18 min"
  completed: "2026-07-13"
  tasks: 3
  files: 3
---

# Phase 14 Plan 05: Hosts List (HOST-01) Summary

**One-liner:** The `/hosts` list ships fleet-shaped from day one — per-host cards fold worst-of chrome + a D-05 driver line, CPU/MEM/DISK read-time-band `ThresholdMeter`s, the bitcoind/esplora/postgres two-axis trio, and interactive node dots, with URL facets, the one sanctioned worst-first sort, and honest gold no-telemetry cards for declared-but-silent hosts — every surface composed strictly from existing df primitives, the card computing zero health.

## What Was Built

### Task 1 — HostFilters.tsx (client facet chips)
Verbatim structural clone of `NodeFilters` with the hosts vocabulary: sev chips **All · Critical · Warning · Watch · Healthy** (serializing `?sev=`) + a single **Stale only** toggle (`?stale=1`). `hrefFor` clears to bare `?` at the widest default. Navy-active / hairline-inactive chrome only — **no severity hue on any chip** (DS-01); `aria-pressed` on each. Imports `HostFacets`/`HostSevFacet` from the 14-04 codec.

### Task 2 — HostCard.tsx (composition + no-telemetry variant)
Server Component composing existing primitives per UI-SPEC A3:
1. **Header** — name (15.5/600) + worst-of severity chip (or `NO TELEMETRY`) + `FreshnessChip`; chrome via `severityVariants`/`severityAccent`.
2. **Driver line** — renders the pre-formatted `driven by: …` prop; omitted when healthy.
3. **Meters** — three `ThresholdMeter` rows (`CPU`/`MEM`/`DISK` mono kickers + mono % value), hatched + `—` value when stale.
4. **Infra trio** — three `TwoAxisPip` tiles (labels via `serviceDisplay().label`); an undeclared/no-data service renders an honest-unknown (gold, "no data") tile, never green.
5. **Node dots** — 8px `severityAccent[sev]` circles, each a `next/link` to `/${pubkey}` with a radix tooltip (alias + `severityLabel`) and sr-only text (never color alone).

**Stretched-link law (Pitfall 6):** the card root is a plain `div`; an absolute `z-0` `Link` carries the whole-body click to `/hosts/${hostId}`; dots render `relative z-10` above it — no nested `<a>`. **No-telemetry variant (A4):** gold `df-stale` chrome, `NO TELEMETRY` chip, `ThresholdMeter stale` meters, honest-unknown trio, and the exact copy `No telemetry yet.` + the honest body. Exposes the serializable `HostCardModel` contract the page (and 14-06) build against. The card grades nothing — every severity arrives via props.

### Task 3 — hosts/page.tsx (HOST-01 list RSC)
`force-dynamic` / `revalidate = 0` RSC cloning the nodes/page template. **Unfiltered `getLatestHostMetrics()` enumeration (D-06)** — no `applyFreshnessCutoff`, so the LEFT-JOIN fleet shape yields every declared host and silent hosts render as no-telemetry cards. Supplementary reads (`getChainTelemetry`, `loadFleetView`, per-host `getServiceHealth`) degrade fail-soft with `console.error` context labels; a total failure hits the page-level try/catch → the honest `Couldn't load host telemetry.` copy. Per host it derives on-host node severities/dots (`buildOwnershipMap` over host→node edges synthesized from service `(hostId, nodePubkey)` pairs → the sanctioned `nodeSeverity` switch), read-time meter severities (`severityFromBand(evaluateBand(...))`, disk band receives `100 − used%`), the host-level infra trio, then `buildHostRollup` per host (storage-less on the list — D-05). `parseHostFacets` → `applyHostFilters` → `sortHostsWorstFirst`; `NavRailShell active="hosts"`, 1180px column, `HOSTS · {n}` kicker, `HostFilters`, `grid-cols-1 md:grid-cols-2 gap-4`, and the honest `No matching hosts.` empty state.

## Task Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 | bf0d29f | feat(14-05): add HostFilters facet chips (navy-structural, URL-serialized) |
| 2 | 24baebb | feat(14-05): add HostCard composition + no-telemetry variant |
| 3 | 5160d12 | feat(14-05): add HOST-01 hosts list RSC (fleet-shaped, honest states) |

## Verification

- `npx tsc --noEmit` — clean (zero errors in the three new files).
- `npx vitest run src/lib/overview` — 12 files / 157 tests passed.
- `npx vitest run src/components` (df + host) — 22 files / 176 tests passed (incl. `ThresholdMeter.test.tsx`).
- `npm run lint` — the three new files report **zero problems**. (Pre-existing lint errors exist in unrelated files — see Deferred Issues.)
- Acceptance greps all pass: HostFilters `bg-df-brand`≥1 / sev-hue=0 / aria-pressed≥1; HostCard serviceDisplay/ThresholdMeter/TwoAxisPip≥1, `evaluateBand|evaluateDaysToFull|worstSeverity`=0, exact strings present; page `force-dynamic`+`revalidate`≥1, `applyFreshnessCutoff`=0, `sortHostsWorstFirst`/`parseHostFacets`≥1, `"use client"`=0, exact error/empty copy present.

## Threat Model Compliance

- **T-14-12 (searchParams tampering):** the nodes-page whitelist loop + `parseHostFacets` closed vocab — no `?sev`/`?stale` value reaches SQL or the DOM raw; invalid widens the view.
- **T-14-13 (XSS):** hostname/driver text renders through React auto-escaping only; zero `dangerouslySetInnerHTML`; driver text originates from our own pure `host-rollup` module.
- **T-14-14 (info disclosure):** the error fallback is honest generic copy; detail goes to `console.error` server-side only; no internal DB names on screen.
- **T-14-15 (fake freshness):** unfiltered enumeration + explicit gold no-telemetry cards; `stale` derived read-time; stale meters carry no fill (hatched, `—` value).
- **T-14-SC (npm installs):** zero packages installed this plan.

## Deviations from Plan

None — plan executed exactly as written. Choice points the plan delegated were resolved and pinned (see `decisions`): DISK = most-full mount, MEM fill = used memory, no-telemetry filter-row shape, stale-with-data meter hatching.

## Deferred Issues

Out-of-scope pre-existing `npm run lint` failures in files this plan did NOT touch (SCOPE BOUNDARY — not introduced here, not fixed here):
`src/components/df/NavRailShell.test.tsx` (react/no-children-prop), `src/components/node/ServiceHealthGrid.tsx` (react-hooks/purity on `Date.now()` default arg), `src/components/node/NodeDetailTabs.tsx` + `src/lib/insight/triage.test.ts` (unused-vars warnings).

## Known Stubs

None. The `UnknownTile` (honest-unknown infra tile) and the no-telemetry card are honest no-data surfaces, not stubs — they render explicit "no data" / "No telemetry yet." copy by design (D-06/A4), never faked-healthy placeholders.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema surface. All rendering is read-only over the shipped Phase-11 read model.

## Self-Check: PASSED

- src/components/host/HostFilters.tsx — FOUND
- src/components/host/HostCard.tsx — FOUND
- src/app/(overview)/hosts/page.tsx — FOUND
- Commits bf0d29f, 24baebb, 5160d12 — FOUND in git log
