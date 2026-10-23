---
phase: 07-inbox-triage-rebuild
plan: 01
subsystem: ui
tags: [insight, triage, facets, url-search-params, shadcn, radix-ui, vitest, pure-module]

# Dependency graph
requires:
  - phase: 04-insight-engine
    provides: FROZEN InsightCard contract (schema.ts/types.ts), SIGNAL_LABELS, DetectorId/Severity enums
  - phase: 06-command-queue-prong-1
    provides: PUBKEY_RE 66-hex whitelist discipline (queue.ts line 24), enqueue path the batch action will loop
provides:
  - partitionTriage — severity spine vs collapsed info groups (signal → pubkey|fleet) vs suppressed block, suppression-precedence, engine-order-preserved, no-card-dropped
  - facetCounts — per-dimension counts over the UNFILTERED set (single-arg, cannot leak active facets)
  - applyFacets — AND-across / OR-within facet narrowing of the rendered set
  - seriesKindFor — per-card sparkline-series classification (forwards-fees | closes | null)
  - parseFacets/serializeFacets — whitelisted ?sev/?node/?signal/?action codec, ?card-orthogonal, never-throws
  - vendored shadcn Sheet drawer primitive (src/components/ui/sheet.tsx)
affects: [07-02-presentation, 07-03-facet-rail-drawer, 07-04-batch-enqueue, inbox-page-rewrite]

# Tech tracking
tech-stack:
  added: [shadcn Sheet primitive (vendored, zero new npm dep)]
  patterns:
    - "Pure transform module law: partition only, never re-rank (engine order is law)"
    - "facetCounts(cards) is single-arg by design so counts can never derive from a post-filter subset (Pitfall 2)"
    - "Whitelist-parse every URL facet against the FROZEN schema enums; invalid dropped silently, never thrown (T-07-01)"
    - "?card stays orthogonal to the facet codec (D-09/D-10, T-07-02)"

key-files:
  created:
    - src/lib/insight/triage.ts
    - src/lib/insight/triage.test.ts
    - src/lib/insight/triage-facets.ts
    - src/lib/insight/triage-facets.test.ts
    - src/components/ui/sheet.tsx
  modified: []

key-decisions:
  - "FacetState is defined once in triage.ts and re-exported by triage-facets.ts — single source of truth for the facet shape across partition + codec"
  - "ACTION_FACET_VALUES is derived from SuggestedActionSchema.options (+ synthetic 'none'), never hand-listed — stays in lockstep with the FROZEN contract"
  - "seriesKindFor checks node===null (fleet) FIRST → null, before signal classification (fleet cards have no single pubkey to read a per-node series for)"

patterns-established:
  - "Pure insight transforms live in src/lib/insight/*.ts with a *.test.ts purity guard (no server-only, no @/lib/db|queue import)"
  - "URL facet codec: repeatable-key + CSV read, first-seen dedupe, deterministic fixed-key-order serialize so serialize(parse(x)) is stable"

requirements-completed: [INBOX-01, INBOX-02, INBOX-03]

# Metrics
duration: 4min
completed: 2026-06-16
---

# Phase 7 Plan 01: Triage Core + Facet Codec + Sheet Summary

**Pure, unit-locked triage core — severity-spine/info-group/suppressed partition with a no-card-dropped invariant, an unfiltered-count + AND/OR facet codec whitelist-parsed against the FROZEN schema, per-card sparkline-series classification, and the vendored shadcn Sheet drawer — all with zero DB/React/new-dependency.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-17T00:08:13Z
- **Completed:** 2026-06-17T00:13:00Z
- **Tasks:** 3
- **Files created:** 5

## Accomplishments
- `partitionTriage` locks the three load-bearing inbox invariants by test BEFORE any UI: no card dropped (count-in === count-out), a critical is never folded into a group, suppression takes precedence over severity, and engine order is preserved within every partition.
- `facetCounts` is single-argument by construction (no facet-state parameter), so the rail's fleet-wide counts can never silently derive from a post-filter subset (Pitfall 2). `applyFacets` is a separate function that narrows the rendered set (AND across dimensions, OR within).
- `parseFacets`/`serializeFacets` whitelist `?sev`/`?node`/`?signal`/`?action` against the FROZEN schema enums + the 66-hex `PUBKEY_RE`, drop invalid values silently (never throw), and leave `?card` untouched — a round-trip is deterministic and stable.
- `seriesKindFor` classifies each card to one of the three sanctioned daily series (`forwards-fees` for fee/revenue signals, `closes` for close-evidence) or `null` for latest-state dims and fleet-target cards (honest "no trend data").
- The shadcn `Sheet` primitive was vendored cleanly against the unified `radix-ui` package with no new npm dependency.

## Task Commits

Each task was committed atomically:

1. **Task 1: Pure triage partition + facet-count module with tests** — `5396ed9` (feat) — 17 tests
2. **Task 2: Facet search-param codec with whitelist parse + tests** — `923ebb1` (feat) — 14 tests
3. **Task 3: Vendor the shadcn Sheet primitive** — `8464301` (feat)

_Note: Tasks 1 & 2 are TDD — the failing test was authored first (RED, confirmed by a "module not found" run), then the implementation made it green (GREEN). No refactor commit was needed._

## Files Created/Modified
- `src/lib/insight/triage.ts` (184 lines) — `partitionTriage`, `facetCounts`, `applyFacets`, `seriesKindFor`, plus the `FacetState`/`FacetCounts`/`ActionFacetKey` types
- `src/lib/insight/triage.test.ts` (292 lines) — no-card-dropped, critical-never-folded, unfiltered-counts, combined-narrowing, series-mapping, purity guard (17 tests)
- `src/lib/insight/triage-facets.ts` (108 lines) — `parseFacets`/`serializeFacets`/`ACTION_FACET_VALUES`, whitelist codec
- `src/lib/insight/triage-facets.test.ts` (164 lines) — invalid-dropped, injection-rejected, round-trip, ?card-orthogonal, purity guard (14 tests)
- `src/components/ui/sheet.tsx` (147 lines) — vendored shadcn Sheet drawer (unified `radix-ui`)

## Decisions Made
- **`FacetState` lives in `triage.ts`, re-exported by `triage-facets.ts`** — one shape consumed by both the partition layer and the codec, no drift.
- **Action vocabulary derived from the schema** — `ACTION_FACET_VALUES = SuggestedActionSchema.options.map(m => m.shape.type.value)` + `"none"`, so a contract change to the action union flows through automatically.
- **Fleet check precedes signal classification in `seriesKindFor`** — `node === null` returns `null` first, because fleet-target cards have no single pubkey for a per-node series read.

## Deviations from Plan

None - plan executed exactly as written. (Tasks 1 & 2 followed the TDD RED→GREEN cycle; no auto-fixes under Rules 1-3 were required.)

## Issues Encountered
- **Pre-existing flaky test, out of scope:** the full `npm test` run intermittently fails `src/lib/queue/stub-executor.test.ts:115` with a `randomUUID()` mismatch under parallel execution. It passes in isolation (3/3) and a second full-suite run was fully green (662 passed). The test references no 07-01 file and lives in the Phase-6 queue subsystem. Logged to `deferred-items.md`; not fixed (scope boundary — only the current task's changes are auto-fixed). My two new test files pass deterministically (31/31).

## User Setup Required
None - no external service configuration required. The Sheet primitive was vendored from the already-trusted shadcn CLI against the already-installed `radix-ui` package; zero new npm dependency, zero lockfile churn.

## Next Phase Readiness
- The pure triage core is ready for consumption: 07-02/07-03 import `partitionTriage`/`facetCounts`/`applyFacets`/`seriesKindFor` to build the server spine/groups/suppressed/facet-rail, and `parseFacets`/`serializeFacets` to drive URL-synced facet navigation.
- The `Sheet` primitive is ready for the 07-03 detail/act drawer (`DetailDrawer.tsx`).
- No blockers. The downstream batch-enqueue plan (07-04) will add `enqueueBatch` to `queue.ts` and should be aware of the flaky `stub-executor.test.ts` noted above when running the full suite.

## Self-Check: PASSED

All 5 created artifacts exist on disk; all 3 task commits (`5396ed9`, `923ebb1`, `8464301`) are present in git history.

---
*Phase: 07-inbox-triage-rebuild*
*Completed: 2026-06-16*
