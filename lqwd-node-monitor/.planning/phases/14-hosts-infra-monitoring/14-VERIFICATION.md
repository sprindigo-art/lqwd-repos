---
phase: 14-hosts-infra-monitoring
verified: 2026-07-13T16:00:00Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
human_verification:
  - test: "Operator visual gate (14-07 Task 3) — run `npm run dev` against real fleet data and walk the 9-point checklist in 14-07-SUMMARY.md § Pending Human Verification"
    expected: "/hosts renders all declared hosts (canary live, silent hosts gold NO TELEMETRY, never green); facets/sort work; node dots + card-body click navigate correctly; Host Detail shows D-10 order with runbook copy-to-run only; storage projection honest; /hosts/not-a-real-host → 404; Hosts entry in nav rail + top opsNav on /, /nodes and both hosts pages; Node Detail VM vitals draw real 24h sparklines; visual bar meets 14-UI-SPEC"
    why_human: "Live browser + real fleet data required; a background agent cannot drive a dev server or judge visual quality. This is a deliberately deferred blocking checkpoint, not a code defect — all deterministic checks are green."
---

# Phase 14: Hosts + Infra Monitoring Verification Report

**Phase Goal:** The infrastructure layer made operable — the Hosts list and Host Detail surfacing VM vitals, the infra trio two-axis, storage time-to-full, the nodes on each host, and the root-cause incident.
**Verified:** 2026-07-13T16:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + HOST-01/HOST-02)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | **HOST-01 / SC#1** — Hosts list shows per-host cards with worst-of severity rollup (infra + nodes + resources), CPU/mem/disk meters with threshold coloring, infra trio two-axis, node-health dots, filters/sort incl. stale | ✓ VERIFIED | `src/app/(overview)/hosts/page.tsx` (365 lines): unfiltered `getLatestHostMetrics()` fleet-shaped enumeration (D-06), `computeMeters()` derives CPU/MEM/DISK via `severityFromBand(evaluateBand(...))`, `computeTrio()` builds bitcoind/esplora/postgres tiles, `buildHostRollup()` worst-of + D-05 driver, `parseHostFacets`→`applyHostFilters`→`sortHostsWorstFirst`. `HostCard.tsx` imports and renders `ThresholdMeter` ×3 + `TwoAxisPip` ×3 + interactive node dots (Link to `/${pubkey}`). Data flows from real reads. |
| 2 | **HOST-02 / SC#2** — Host Detail shows VM vitals (CPU/mem/disk + sparklines), infra two-axis, storage volumes with %/day + time-to-full, on-host nodes, root-cause incident + runbook | ✓ VERIFIED | `src/app/(overview)/hosts/[hostId]/page.tsx` (519 lines): membership gate against hosts dimension → `notFound()` outside try/catch; D-10 order header → `HostIncidentBanner` (incident + inert `CommandModal` runbook) → `VmVitals charts={vitals}` from real 24h `getHostMetricsHistory`/`getHostStorageHistory` → `TwoAxisPip` infra trio → `StorageVolumes` (per-mount `computeStorageGrowth` + projection) → `OnHostNodes` `SeverityRow`→Node Detail. All health computed at read time. |
| 3 | **SC#3** — Storage time-to-full computed from ingested growth, rendered honestly (no projection when stale/insufficient) | ✓ VERIFIED | `src/lib/read/storage-projection.ts` (`humanizeDaysToFull` D-15, `projectionStatusCopy` D-14, `formatPctPerDay`); `StorageVolumes.tsx` branches on `growth.status` (not `daysToFull` presence): `ok`→humanized, else verbatim honest status copy. `evaluateDaysToFull` (D-13 four-level bands) in `telemetry-bands.ts`. Consumes real `computeStorageGrowth` output. |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/app/(overview)/hosts/page.tsx` | HOST-01 list RSC | ✓ VERIFIED | 13.8 KB, force-dynamic RSC, real reads → HostCard grid |
| `src/app/(overview)/hosts/[hostId]/page.tsx` | HOST-02 detail RSC | ✓ VERIFIED | 21.3 KB, membership-gated, D-10 single-scroll |
| `src/components/df/ThresholdMeter.tsx` | D-03 primitive | ✓ VERIFIED | `role="meter"`, `severityAccent[sev]` fill only, never derives sev from pct, honest-stale hatch |
| `src/components/host/HostCard.tsx` | worst-of card + ThresholdMeter ×3 + TwoAxisPip ×3 + dots | ✓ VERIFIED | Imports both primitives; no-telemetry variant; stretched-link |
| `src/components/host/HostFilters.tsx` | facet chips | ✓ VERIFIED | URL-serialized sev/stale, navy-structural |
| `src/components/host/HostIncidentBanner.tsx` | incident + inert runbook (D-11) | ✓ VERIFIED | CommandModal kind:runbook, zero lifecycle affordance |
| `src/components/host/StorageVolumes.tsx` | dense volume rows | ✓ VERIFIED | ThresholdMeter + honest projection gate |
| `src/components/host/OnHostNodes.tsx` | compact SeverityRow rows | ✓ VERIFIED | Rows → Node Detail |
| `src/lib/overview/host-rollup.ts` | worst-of + D-05 driver | ✓ VERIFIED | 10.6 KB pure module, sanctioned mappers only |
| `src/lib/overview/host-filter.ts` | facets/sort | ✓ VERIFIED | parseHostFacets/applyHostFilters/sortHostsWorstFirst |
| `src/lib/overview/host-runbook.ts` | verify-first runbook | ✓ VERIFIED | Four-class closed union builder |
| `src/lib/read/host-history.ts` | bounded 24h history reads | ✓ VERIFIED | Param-bound scans, no DISTINCT ON |
| `src/lib/read/storage-projection.ts` | D-14/D-15 copy | ✓ VERIFIED | Pure module |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| hosts/page.tsx | host-rollup / host-filter | import + call | ✓ WIRED | buildHostRollup, parseHostFacets, applyHostFilters, sortHostsWorstFirst all invoked |
| HostCard | ThresholdMeter, TwoAxisPip | import + render | ✓ WIRED | `<ThresholdMeter>` line 116, `<TwoAxisPip>` line 244 |
| hosts/[hostId]/page.tsx | host-history reads | import + call | ✓ WIRED | getHostMetricsHistory/getHostStorageHistory (real 24h) feed VmVitals + StorageVolumes |
| hosts/[hostId]/page.tsx | assembleIncidents | `.find(i => i.key === hostId)` | ✓ WIRED | Incident banner + buildHostRunbook |
| StorageVolumes | ThresholdMeter + projection copy | import + render | ✓ WIRED | Branches on growth.status |
| opsNav Hosts entry | /hosts | href | ✓ WIRED | Top opsNav on `/` (page.tsx) + `/nodes` (nodes/page.tsx) + both hosts pages; nav RAIL (`NavRailShell` RAIL_ITEMS, line 32) carries Hosts across ALL shell pages incl. `/[pubkey]` |
| [pubkey]/page.tsx | getHostMetricsHistory backfill | import + `charts={vitals}` | ✓ WIRED | `charts={[]}` count = 0; getHostMetricsHistory count = 4 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| hosts/page.tsx | `allRows` | `getLatestHostMetrics()` + supplementary reads | Yes (LEFT-JOIN warehouse read) | ✓ FLOWING |
| host detail | `vitals` | `getHostMetricsHistory(hostId, 24h)` | Yes (bounded param scan; not `[]`) | ✓ FLOWING |
| host detail | `volumes` | `computeStorageGrowth(getHostStorageHistory)` | Yes | ✓ FLOWING |
| host detail | `incident` | `assembleIncidents(...).find(key===hostId)` | Yes (live incident engine) | ✓ FLOWING |
| [pubkey] VmVitals | `vitals` | `getHostMetricsHistory` backfill | Yes (replaced prior `charts={[]}`) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Typecheck clean | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Phase test suites green | `npx vitest run src/lib/overview src/lib/read src/components` | 48 files / 505 passed, 17 skipped (live-DB), 0 failed | ✓ PASS |
| ThresholdMeter gallery registered | grep design-system page/fixtures | 6 + 3 refs | ✓ PASS |
| Node Detail no longer empty-charts | grep `charts={[]}` in [pubkey] | 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| HOST-01 | 14-05 (+01/03/04) | Hosts list worst-of cards, meters, trio, dots, filters/sort | ✓ SATISFIED | hosts/page.tsx + HostCard + ThresholdMeter + host-rollup + host-filter |
| HOST-02 | 14-06 (+02/03/04) | Host Detail vitals, two-axis, storage time-to-full, nodes, incident+runbook | ✓ SATISFIED | hosts/[hostId]/page.tsx + host components + host-history + storage-projection |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TBD/FIXME/XXX/placeholder debt markers in any phase-14 file | ℹ️ Info | The single "placeholder" grep hit is an honest StaleChart comment, not a stub. No unreferenced debt markers. |

Note: Pre-existing lint issues (`NavRailShell.test.tsx`, `ServiceHealthGrid.tsx`, prototype-snapshot `support.js`) and the 4 `src/lib/queue/*` live-DB test failures are documented, out-of-scope, and NOT phase-14 regressions (excluded per verification scope).

### Human Verification Required

**14-07 Task 3 — Operator visual gate (blocking, deferred by design).** A background worktree agent cannot drive a live browser. The operator must run `npm run dev` against real fleet data and confirm the 9-point checklist in `14-07-SUMMARY.md § Pending Human Verification` (fleet-shaped list, honest no-telemetry cards, facets/sort, node-dot vs card-body navigation, D-10 detail order, copy-to-run runbook, honest storage projection, 404 on bogus hostId, Hosts nav presence, Node Detail sparklines, 14-UI-SPEC visual bar). This is the ONLY outstanding item; all deterministic checks are green.

### Gaps Summary

No code gaps. All three ROADMAP success criteria and both requirements (HOST-01, HOST-02) are satisfied by substantive, fully-wired, real-data-flowing implementations. Typecheck is clean and the phase-14 test suites pass (505 tests, 0 failures). The one open item is the human visual gate — an intentional deferred checkpoint, not a defect — which sets status to `human_needed` rather than `passed`.

Minor observations (non-blocking, consistent with locked decisions):
- Node Detail `/[pubkey]` reaches Hosts via the nav RAIL (`NavRailShell` RAIL_ITEMS) rather than a top-bar opsNav prop; the two pages with an inline top opsNav (`/`, `/nodes`) plus both hosts pages carry the top-bar entry. This matches the 14-07 documented inline-vs-extraction decision; Hosts is reachable from every ops surface.
- On-host node forwards labeled `fwds` (7d scorecard window, not spec's 30d) and WhyChain omitted from the incident banner — both documented honesty-first deviations in 14-06, not gaps.

---

_Verified: 2026-07-13T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
