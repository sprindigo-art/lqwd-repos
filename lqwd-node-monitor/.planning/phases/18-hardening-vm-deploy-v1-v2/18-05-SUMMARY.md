---
phase: 18-hardening-vm-deploy-v1-v2
plan: 05
subsystem: insight-ai-narration
tags: [security, ai-guardrail, advisory-only, hardening, HARDEN-03]
requires: ["18-01"]
provides:
  - "narrateCards advisory-only gate (assertAdvisoryOnly) + bounded generation"
  - "narrate.test.ts coverage for the legacy fleet/node narrate path"
affects:
  - src/lib/insight/narrative.ts
  - src/app/actions/narrate.ts
tech-stack:
  added: []
  patterns:
    - "assertAdvisoryOnly post-check on ALL LLM narration output (both narrate paths)"
    - "maxOutputTokens: 400 + temperature: 0.3 bound on every generateText narration call"
key-files:
  created:
    - src/app/actions/narrate.test.ts
  modified:
    - src/lib/insight/narrative.ts
    - src/lib/insight/narrative.test.ts
decisions:
  - "narrateCards withholds by throwing on advisory-only failure; narrate() catches → { ok:false } (consistent with existing flag-off throw path)"
  - "temperature 0.3 chosen to match narrateIncident exactly"
metrics:
  duration: ~12m
  completed: 2026-07-27
requirements: [HARDEN-03]
---

# Phase 18 Plan 05: Advisory-Only Backstop on the Legacy Narrate Path Summary

Restored the AI-emits-no-commands last line of defense on the older fleet/node
`narrateCards` path — it now routes model output through the same non-negotiable
`assertAdvisoryOnly` gate `narrateIncident` uses and bounds generation with
`maxOutputTokens: 400` + `temperature: 0.3`, with a full `narrate.test.ts` proving
the path's four invariants.

## What Was Built

**Task 1 (AI1, AI2) — `narrateCards` gating + generation caps:**
- Added `@/lib/insight/guardrails` to the lazy-import triple in `narrateCards`, so
  flag-off still runs zero AI SDK / provider / guardrail code.
- Model output now passes `assertAdvisoryOnly`; a command-shaped narration is
  withheld entirely (`throw` → caller returns `{ ok:false }`), mirroring
  `narrate-incident.ts`.
- The `generateText` call now sets `maxOutputTokens: 400` and `temperature: 0.3`,
  closing the unbounded-generation DoS surface (T-18-08).

**Task 2 (AI3) — `narrate.test.ts`:**
- New test file mirroring `narrate-incident.test.ts` (hoisted mocks for the AI SDK,
  provider, `loadInsightView`, and `loadFleetView`; `assertAdvisoryOnly` stays real).
- Covers: flag-off short-circuit (zero SDK/loader calls), malformed-pubkey rejection
  before recompute, server-recompute of the card set (never trusts client input), and
  advisory-only withholding of a command-shaped generation.
- Asserts the returned read line carries no `action`/`params` structured surface.

## Invariant Enforcement (HARDEN-03)

The AI-emits-no-commands invariant already held **structurally** on this path —
nothing parses `narrateCards`' returned text into params, `suggestedAction`, or any
config. This plan restored the defense-in-depth backstop and proved it: both narrate
paths (`narrateCards` and `narrateIncident`) now gate every generation through
`assertAdvisoryOnly` with bounded output. Threat register T-18-07 / T-18-08 / T-18-09
are all mitigated with passing tests.

## Deviations from Plan

None — plan executed exactly as written.

## Verification

- `npx vitest run src/lib/insight/narrative src/app/actions/narrate` → 21 passed (3 files).
- `npx tsc --noEmit` → no errors in touched files.
- `npx eslint` on the three touched files → clean.
- `grep -n "assertAdvisoryOnly\|maxOutputTokens" src/lib/insight/narrative.ts` → both present.

## TDD Gate Compliance

Both tasks followed RED → GREEN:
- Task 1: `test(18-05)` RED commit (8ecd17c) → `feat(18-05)` GREEN commit (fbd19fd).
- Task 2: `test(18-05)` commit (5a1fe2d) — test-only task exercising existing +
  Task-1-added behavior; all four cases green on first run.

## Commits

- `8ecd17c` test(18-05): failing tests for narrateCards advisory-only gate + caps
- `fbd19fd` feat(18-05): gate narrateCards through assertAdvisoryOnly + bound generation
- `5a1fe2d` test(18-05): add narrate.test.ts proving the legacy narrate path invariants

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/insight/narrative.ts (modified)
- FOUND: src/app/actions/narrate.test.ts (created)
- FOUND: src/lib/insight/narrative.test.ts (modified)
- FOUND commits: 8ecd17c, fbd19fd, 5a1fe2d
