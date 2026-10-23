---
phase: 04-insight-engine
plan: 01
subsystem: insight
tags: [zod, contract, schema, insight-card, wave-0]
requires: []
provides:
  - "InsightCardSchema zod validator (src/lib/insight/schema.ts) — THE frozen contract Phases 5/6 import"
  - "InsightCard / CardEvidence / SuggestedAction / CardTarget / Severity / DetectorId inferred types + CARD_SCHEMA_VERSION (src/lib/insight/types.ts)"
  - "Committed fixture + shape-snapshot contract test that fails on any schema change without a deliberate version bump"
affects:
  - "04-02..04-N detectors and UI (code against InsightCard)"
  - "Phase 5 export (imports InsightCardSchema client-side)"
  - "Phase 6 signed queue (signs canonical(params) from SuggestedAction)"
tech-stack:
  added:
    - "zod ^3.25.76 (v3 line — CLAUDE.md pin + ai@6 peer range)"
    - "ai ^6.0.202"
    - "@ai-sdk/anthropic ^3.0.83"
  patterns:
    - "z.infer type derivation — type and validator cannot drift"
    - ".strict() at every object level — additions are breaking by design"
    - "superRefine for cross-field safety invariants (D-12, node<=>fleet)"
key-files:
  created:
    - src/lib/insight/schema.ts
    - src/lib/insight/types.ts
    - src/lib/insight/schema-fixture.json
    - src/lib/insight/schema.contract.test.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Shape snapshot embeds enum memberships (DetectorId values), not just key paths — adding a detector id also requires a deliberate snapshot regen + CARD_SCHEMA_VERSION bump, since detector ids cross the Phase 5/6 boundary"
  - "remediate_pending case mapping in fixture: restart_procedure for stuck_fc_past_maturity, bump_fee for stuck_sweep, aged_funding for stuck_open"
metrics:
  duration: "~10 min"
  completed: "2026-06-12T06:34:00Z"
  tasks: 3
  files: 6
---

# Phase 4 Plan 01: Card Schema Contract Freeze Summary

**One-liner:** InsightCard frozen as a zod v3 contract — 14-detector enum, discriminated-union actions with canonical-signing-safe params, D-12 enforced via superRefine, locked by a 14-card fixture plus an 85-line shape snapshot that embeds schemaVersion 1.

## What Was Built

- **Task 1 — deps (`002022d`)**: Installed `zod@^3.25.76`, `ai@^6.0.202`, `@ai-sdk/anthropic@^3.0.83`. All three Approved per the 04-RESEARCH Package Legitimacy Audit (no postinstall scripts, lqwdclaw-proven); existing suite stayed green (268 passed).
- **Task 2 — contract (`45e2a77`)**: `src/lib/insight/schema.ts` defines `InsightCardSchema` with `.strict()` at all 19 object levels, the 14-member `DetectorIdSchema`, scorecard-verbatim `SeveritySchema` (D-01), discriminated-union `CardTargetSchema` and `SuggestedActionSchema` (D-03 — `investigate` carries `{}` never undefined), structured `CardEvidenceSchema` with ISO-string `asOf` (D-04), and a `superRefine` enforcing D-12 (`llm-inference` ⇒ `info` + null action) and `node === null ⇔ target.kind === "fleet"`. `src/lib/insight/types.ts` derives every type via `z.infer` and documents the dedupe-id rule and raw-units (AFM-002) invariant in the banner. Both are pure modules — no server-only/DB imports.
- **Task 3 — freeze (`e6d9a3d`)**: `schema-fixture.json` carries exactly 14 cards (one per detector) covering all 5 action variants, one suppressed card (fee_raise under AP-11 suppression), two llm-inference cards (ap12a/ap12b), and one fleet card (node: null). `schema.contract.test.ts` runs 13 tests: all-fixture parse, signal/edge-case coverage, 8 mutation rejections (wrong severity "error", strict extra key, missing `suggestedPpm`, both D-12 violations, both node/fleet refinement violations, `params: undefined`), and a shape-snapshot comparison against a committed constant embedding `literal(1)`.

## Verification

- `npx vitest run src/lib/insight` — 13/13 passed
- Full suite — 28 files passed, 281 tests passed, 16 skipped
- `npx tsc --noEmit` — clean
- `grep -c "server-only" src/lib/insight/{schema,types}.ts` — 0 in both (pure modules)
- Freeze proven during dev: temporarily adding `tempField` to `InsightCardSchema` failed the snapshot test (1 failed); reverted, green again

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Banner comments tripped the literal "server-only" grep verify**
- **Found during:** Task 2 verification
- **Issue:** The plan's automated verify greps for the literal string `server-only`; the purity banner comments ("NO server-only import") matched even though nothing is imported
- **Fix:** Reworded both banners to "NO server-side-only imports" so the grep check stays meaningful
- **Files modified:** src/lib/insight/schema.ts, src/lib/insight/types.ts
- **Commit:** 45e2a77

## Authentication Gates

None.

## Known Stubs

None — schema, types, fixture, and tests are fully wired; no placeholder data paths.

## TDD Gate Compliance

Plan type is `execute` (not tdd); per-task flow followed. Test commit (`e6d9a3d`) lands after the implementation it freezes by design — the contract test IS the deliverable, not a RED gate.

## Self-Check: PASSED

All 4 created files exist; all 3 task commits (002022d, 45e2a77, e6d9a3d) present in git log.
