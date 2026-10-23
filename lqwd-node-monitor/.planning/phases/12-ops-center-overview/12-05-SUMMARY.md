---
phase: 12-ops-center-overview
plan: 05
subsystem: overview
tags: [ai-band, advisory-only, deterministic, pure-module, tdd, security-critical, llm-free]

# Dependency graph
requires:
  - plan: 12-03
    provides: "incidents.ts — GroupedIncident[] (engine-ranked, host-keyed root-cause tree)"
  - phase: 10
    provides: "df/AiReadPanel.tsx — AiReadLine contract + frozen calm/safety copy constants"
provides:
  - "ai-band.ts — buildBandLines: deterministic <=4 advisory AiReadLines off ranked incidents (OVW-02/D-04)"
  - "buildCalmState — all-clear continuation copy for the calm hero (OVW-04/D-08)"
affects: [overview-page, ai-band-island, 12-06, 12-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-builder-separate-from-LLM split (narrative.ts analog): line selection+order is pure here; optional LLM rephrase stays in the existing server-recomputing narrate() action — no new LLM path"
    - "Advisory-only BY CONSTRUCTION: AiReadLine has no action field; buildBandLines adds none; Object.keys allow-set test pins it at the band boundary"
    - "Engine-order-is-LAW: slice first <=4 incidents in order, zero .sort (Pitfall 3/D-04)"

key-files:
  created:
    - src/lib/overview/ai-band.ts
    - src/lib/overview/ai-band.test.ts
  modified:
    - src/lib/insight/guardrails.test.ts

key-decisions:
  - "buildCalmState takes a CalmSummary { nodeCount, lastIncidentAgo? } and emits the UI-SPEC §Copywriting continuation verbatim; the last-incident clause drops honestly when no prior incident exists (never a faked value)"
  - "Line template: head = `<entityLabel> — ` (bold lead), body = incident.why (the one-line operator reason already on the incident) — copy only, no markup"
  - "Advisory-only re-affirmed in guardrails.test.ts at the band boundary (not just ai-band.test.ts) — feeding incidents named after every WRITE_ACTION_TYPE still yields inert lines"

patterns-established:
  - "MAX_BAND_LINES=4 cap via slice (UI-SPEC §2: 1–4 lines); empty queue returns [] so the page shows the calm hero instead"

requirements-completed: [OVW-02]

# Metrics
duration: ~4min
completed: 2026-06-30
---

# Phase 12 Plan 05: Deterministic AI-Band Line Builder Summary

**Pure `ai-band.ts` that folds the engine-ranked `GroupedIncident[]` into 1–4 inert `AiReadLine`s — per-line severity straight off each incident, order = ranked order (no re-sort, D-04), and provably advisory-only because `AiReadLine` has no action field and `buildBandLines` adds none (T-12-01). Ships with ZERO LLM dependency (D-05): the optional, env-gated rephrase stays in the existing server-recomputing `narrate()` action. `buildCalmState` supplies the all-clear continuation copy for the calm hero (OVW-04/D-08).**

## Performance

- **Duration:** ~4 min
- **Completed:** 2026-06-30
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files:** 2 created, 1 modified

## Accomplishments
- `buildBandLines(incidents)` takes the FIRST ≤4 incidents IN ORDER and templates each into `{ sev, head, body }` — `sev` is the incident's own severity (per-line, D-04), `head` is the bold `<entityLabel> — ` lead, `body` is the incident `why`. Empty queue → `[]`.
- Advisory-only by construction (T-12-01, central phase threat): no `action`/`param`/`command`/`suggestedAction` key on any line; pinned by an `Object.keys` allow-set test in BOTH `ai-band.test.ts` and a new band-boundary block in `guardrails.test.ts`.
- D-05 / OVW-02 LLM-free: `grep` finds no `ai-sdk` / `narrate` / `@/lib/ai` / `generateText` import in `ai-band.ts` (only a doc-comment reference to the existing `narrate()` action). No new LLM path added.
- Engine-order-is-LAW (Pitfall 3): `grep -c "\.sort("` → 0; the ranked order is preserved, proven by the watch→critical→warning order test (a re-sort would float `critical` to the top).
- `buildCalmState({ nodeCount, lastIncidentAgo })` emits the UI-SPEC §Copywriting continuation; the last-incident clause drops honestly when none is supplied.
- Inputs never mutated (structuredClone equality test).

## Task Commits

1. **Task 1: Write the failing ai-band vitest + band-boundary advisory-only assertion (RED)** - `d37d88b` (test)
2. **Task 2: Implement deterministic band builder (GREEN)** - `6c6a7f0` (feat)

_No REFACTOR commit — the GREEN implementation was already clean and minimal._

## Files Created/Modified
- `src/lib/overview/ai-band.ts` — pure deterministic line builder: `buildBandLines` (≤4 ranked, per-line sev, inert lines) + `buildCalmState` (all-clear copy); no LLM/AI-SDK/server/DB import, no `.sort`.
- `src/lib/overview/ai-band.test.ts` — vitest with a `makeIncident` factory: ≤4 lines, ranked-order preservation, per-line sev, `why`→body, no-action `Object.keys` guard, empty queue, determinism, no-mutation, calm-state copy.
- `src/lib/insight/guardrails.test.ts` — extended (not rewritten): a band-boundary block confirming `buildBandLines` over write-action-named incidents emits no runnable command/param.

## Decisions Made
- **CalmSummary shape:** `buildCalmState` takes `{ nodeCount, lastIncidentAgo? }` rather than the full incident set — the calm hero only needs the healthy-count and the resolved-time string; keeps the builder pure and trivially testable. The last-incident clause is conditional so an honest "no prior incident" state never fabricates a `<t>`.
- **Line template:** `head = "<entityLabel> — "`, `body = incident.why`. The `why` is already a one-line operator reason from `incidents.ts` (e.g. "2 alerts on host-3"), so the band reuses it verbatim — no second source of truth for the prose.
- **Double-boundary advisory-only test:** the no-action guarantee is asserted both in `ai-band.test.ts` and at the `guardrails.test.ts` boundary, matching the plan's directive to re-affirm the invariant where the guardrails hand off to the band.

## Deviations from Plan

None — plan executed exactly as written. RED failed for the expected reason (`Cannot find package '@/lib/overview/ai-band'`); GREEN passed all assertions on the first implementation (ai-band + guardrails 33/33, full overview suite 53/53). The single `grep` hit for forbidden LLM imports is a doc comment referencing the existing `narrate()` action, not an import — same benign pattern noted in 12-03.

## Known Stubs

None — `buildBandLines` and `buildCalmState` are fully wired to their inputs. The optional LLM rephrase is intentionally absent here (D-05): it lives in the existing server-recomputing `narrate()` action and is out of this plan's scope by design, not a stub.

## Issues Encountered
None.

## TDD Gate Compliance
- RED gate present: `d37d88b` (test) — failed with unresolved import before implementation.
- GREEN gate present: `6c6a7f0` (feat) after RED — 33/33 assertions pass.
- REFACTOR: not required.

## Next Phase Readiness
- The overview page (12-07) and the AI-band client island (12-06) can import `buildBandLines` + `buildCalmState` from `@/lib/overview/ai-band` to feed `AiReadPanel` over the SAME grouped incident set (no re-query, no re-sort).
- No blockers.

## Self-Check: PASSED

- FOUND: src/lib/overview/ai-band.ts
- FOUND: src/lib/overview/ai-band.test.ts
- FOUND: .planning/phases/12-ops-center-overview/12-05-SUMMARY.md
- FOUND commit: d37d88b (RED test)
- FOUND commit: 6c6a7f0 (GREEN impl)

---
*Phase: 12-ops-center-overview*
*Completed: 2026-06-30*
