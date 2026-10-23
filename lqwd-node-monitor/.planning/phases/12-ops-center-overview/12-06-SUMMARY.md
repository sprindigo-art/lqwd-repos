---
phase: 12-ops-center-overview
plan: 06
subsystem: overview
tags: [filter, whitelist-codec, pure-view, client-island, session-dismiss, tdd, security-critical]

# Dependency graph
requires:
  - plan: 12-03
    provides: "incidents.ts — GroupedIncident[] + IncidentLayer (the set the filter views over)"
  - plan: 12-05
    provides: "ai-band.ts — buildBandLines/buildCalmState (AiReadLine[] the AiBandClient renders)"
  - phase: 10
    provides: "df/AiReadPanel.tsx (frozen safety pill + parent-state dismiss) + Severity.ts (severityLabel/tokens)"
  - phase: 07
    provides: "insight/triage-facets.ts — the whitelist readRaw/whitelist/parseFacets codec pattern mirrored here"
provides:
  - "filter.ts — parseOverviewFacets whitelist codec + applyFilter pure no-resort view over GroupedIncident[]"
  - "QueueFilters.tsx — navy-structural layer/severity toggle-chip island (URL-synced, reload-safe)"
  - "AiBandClient.tsx — session-scoped dismiss wrapper around AiReadPanel (no persistence)"
affects: [overview-page, 12-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Overview filter codec mirrors triage-facets (readRaw/whitelist) over a DIFFERENT closed vocab — layer enum + df severity SUBSET (critical|warning|watch), NOT the insight sev"
    - "Filtering as a pure view: applyFilter only .filter, never .sort — engine order preserved, input never mutated (D-09)"
    - "Toggle chips are reload-safe <Link> hrefs (query-relative) — URL is the single source of truth, mirrors FacetRail"
    - "Session-scoped dismiss = plain useState(false); no storage — reload re-derives from live state (D-05)"

key-files:
  created:
    - src/lib/overview/filter.ts
    - src/lib/overview/filter.test.ts
    - src/components/overview/QueueFilters.tsx
    - src/components/overview/AiBandClient.tsx
    - src/components/overview/QueueFilters.test.tsx
  modified: []

key-decisions:
  - "Severity filter vocab is the df subset critical|warning|watch — healthy/stale are honest states the queue surfaces but are NOT filter chips (UI-SPEC §5); typing the vocab arrays against IncidentLayer + df Severity makes the compiler reject drift"
  - "QueueFilters chips are query-relative <Link> hrefs (?layer=…&sev=…), so the island never hardcodes the overview route — Plan 07's page owns the path; clearing a dimension resolves to '?'"
  - "Severity chips read the SAME navy-active / hairline-inactive chrome as layer chips (DS-01) — navy is structure/active only, the severity ramp appears nowhere as chip chrome; chip labels come from severityLabel (no if(sev===) chains)"
  - "AiBandClient passes only advisory lines + a dismiss handler to AiReadPanel — the verbatim AI_SAFETY_LABEL stays built-in/caller-immutable (T-12-UI-01)"

patterns-established:
  - "applyFilter predicate: keep if (no layer facet OR layer matches) AND (no sev facet OR sev matches) — empty facets return the full set in order"
  - "Invalid ?layer/?sev values silently widen the view, never throw (V5 / T-12-02), exactly as triage-facets"

requirements-completed: [OVW-02, OVW-05]

# Metrics
duration: ~10min
completed: 2026-06-30
---

# Phase 12 Plan 06: Overview Filter Layer + Client Islands Summary

**A pure, whitelist-guarded `filter.ts` (`parseOverviewFacets` over a closed layer + df-severity-subset vocab; `applyFilter` a no-resort, no-mutate view over the grouped incident set, D-09/OVW-05) plus the two `"use client"` islands the overview page composes: `QueueFilters` (navy-structural, URL-synced layer/severity toggle chips with an honest empty-state via `[]`) and `AiBandClient` (a session-scoped `useState` dismiss around `AiReadPanel` with the frozen safety pill intact, OVW-02/D-05). No edit to `page.tsx` — Plan 07 wires them in.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-06-30
- **Tasks:** 2 (Task 1 TDD RED+GREEN; Task 2 islands + component test)
- **Files:** 5 created

## Accomplishments
- `parseOverviewFacets` whitelists `?layer` against the five-value `IncidentLayer` enum and `?sev` against the df severity SUBSET (`critical|warning|watch`) — CSV + repeated keys, first-seen dedupe; invalid values (`mars`, the insight `warn`/`info`, the non-chip `healthy`/`stale`) silently drop and widen the view, never throw (V5 / T-12-02).
- `applyFilter` is a pure view (D-09): `(no-layer OR layer match) AND (no-sev OR sev match)`, zero `.sort`, no input mutation; filtering a non-empty queue to zero matches yields `[]` so the page shows the honest "nothing matches this filter" empty state distinct from all-clear (OVW-05).
- `QueueFilters` renders the layer chips (All · Hosts · Services · bitcoind · Nodes · Storage) + severity chips (via `severityLabel`) as reload-safe query-relative `<Link>` toggles; the active chip carries navy STRUCTURE chrome (`bg-df-brand`/white), never a severity hue (DS-01).
- `AiBandClient` wraps `AiReadPanel` with a session-scoped `useState(false)` dismiss — no `localStorage`/`sessionStorage`/cookie; the panel never self-hides, so a reload re-derives the band from live state (D-05). The built-in verbatim `AI_SAFETY_LABEL` is preserved (T-12-UI-01).
- 20 new assertions green: `filter` 11/11, `QueueFilters`+`AiBandClient` 9/9.

## Task Commits

1. **Task 1: failing overview filter codec + pure-view tests (RED)** — `1f0aafc` (test)
2. **Task 1: implement filter codec + pure view (GREEN)** — `e6caeb3` (feat)
3. **Task 2: QueueFilters + AiBandClient islands + component test** — `751b0dd` (feat)

_No REFACTOR commit — the GREEN implementation was already clean and minimal._

## Files Created/Modified
- `src/lib/overview/filter.ts` — pure whitelist codec (`parseOverviewFacets`) + pure no-resort view (`applyFilter`); vocab typed against `IncidentLayer` + df `Severity`; no `.sort`, no `server-only`/`@/lib/db`.
- `src/lib/overview/filter.test.ts` — 11 vitest cases: whitelist parse, invalid-drops-never-throws, CSV/repeated dedupe, layer∩sev intersection, empty-facets-full-set, no-mutation, honest-empty `[]`, no-re-sort order preservation.
- `src/components/overview/QueueFilters.tsx` — `"use client"` toggle-chip island; navy-structural active / hairline-muted inactive; URL-synced `<Link>` hrefs; labels via `severityLabel`.
- `src/components/overview/AiBandClient.tsx` — `"use client"` session-scoped dismiss wrapper around `AiReadPanel`; `useState`-only hide, no persistence.
- `src/components/overview/QueueFilters.test.tsx` — 9 SSR (`renderToStaticMarkup`) cases mirroring `AiReadPanel.test.tsx`: chip-set render, prop-driven active count, no-severity-hue chrome, toggle hrefs; AiBandClient safety-pill + line pass-through + wired-dismiss + calm variant.

## Decisions Made
- **Severity filter vocab = df subset:** only `critical|warning|watch` are filter chips; `healthy`/`stale` are honest queue states, not facets (UI-SPEC §5). The vocab arrays are typed against `IncidentLayer` / df `Severity` so the compiler rejects any non-real value — the codec can't drift from the queue's actual types.
- **Query-relative chip hrefs:** chips emit `?layer=…&sev=…` (or `?` to clear), resolving against the current path, so `QueueFilters` never hardcodes the overview route — Plan 07's page owns it. Mirrors the FacetRail `serializeFacets` toggle pattern, reload-/back-safe.
- **Dismiss is `useState` only:** matching `AiReadPanel`'s "never self-hides — dismissal is the parent's state", the wrapper owns the single hide path with zero persistence; a real incident can never stay hidden across a reload (D-05 / T-12-DIS-01).

## Deviations from Plan

None — plan executed exactly as written. RED failed for the expected reason (`Cannot find package '@/lib/overview/filter'`); GREEN passed all 11 on the first implementation. The two grep "hits" (`localStorage`/`sessionStorage` in AiBandClient; `if (sev ===` in QueueFilters) are doc-comment references to the FORBIDDEN anti-patterns, not code — the same benign pattern noted in 12-03/12-05. No code uses storage or a `sev===` class chain.

## Known Stubs

None — `filter.ts`, `QueueFilters`, and `AiBandClient` are fully wired to their inputs. `page.tsx` integration is intentionally out of scope (Plan 07 wires the islands in), not a stub of this plan's goal.

## Issues Encountered

The full-suite `npx vitest run` reports 5 failed files / 932 passed / 47 skipped. All 5 failures are pre-existing live-Postgres integration/golden suites failing on `permission denied for table command_audit` (SQLSTATE 42501) — a sandbox DB-grant/env condition unrelated to this plan's pure-module + SSR view-layer changes (no DB access anywhere in 12-06). Logged to `deferred-items.md`; the 12-06 suites pass in isolation (`filter` 11/11, `QueueFilters` 9/9). Out of scope per the executor scope boundary.

## TDD Gate Compliance
- RED gate present: `1f0aafc` (test) — failed with unresolved import before implementation.
- GREEN gate present: `e6caeb3` (feat) after RED — 11/11 assertions pass.
- REFACTOR: not required.
- Task 2 (`type="auto"`, not a TDD task) ships its component test in the same `feat` commit, per plan.

## Next Phase Readiness
- Plan 07 (overview page) can import `parseOverviewFacets`/`applyFilter` from `@/lib/overview/filter`, mount `<QueueFilters facets={…} />` and `<AiBandClient lines={…} />`, and wire the URL → filtered view + the band over the SAME grouped incident set (no re-query, no re-sort).
- No blockers.

## Self-Check: PASSED

- FOUND: src/lib/overview/filter.ts
- FOUND: src/lib/overview/filter.test.ts
- FOUND: src/components/overview/QueueFilters.tsx
- FOUND: src/components/overview/AiBandClient.tsx
- FOUND: src/components/overview/QueueFilters.test.tsx
- FOUND commit: 1f0aafc (RED test)
- FOUND commit: e6caeb3 (GREEN impl)
- FOUND commit: 751b0dd (islands + component test)

---
*Phase: 12-ops-center-overview*
*Completed: 2026-06-30*
