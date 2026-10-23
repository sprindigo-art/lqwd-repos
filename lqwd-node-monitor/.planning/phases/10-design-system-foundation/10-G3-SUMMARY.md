---
phase: 10-design-system-foundation
plan: G3
subsystem: ui
tags: [react, tailwind, shadcn, df-primitives, security-inert-text, design-fidelity]

# Dependency graph
requires:
  - phase: 10-design-system-foundation
    provides: df/* primitives, df-* tokens, Severity ramp, vendored Radix Dialog
provides:
  - "AiReadPanel rebuilt to prototype fidelity — numbered priority ranks, bold-lead/muted-body text split, ✕ dismiss control, all-clear calm variant"
  - "CommandModal rebuilt to prototype fidelity — sev-chip + kicker header, info ⓘ note icon, three risk-tier variants (command/investigate/runbook)"
  - "CommandKind type + COMMAND_KIND_META frozen per-tier framing copy"

affects: [ops-center page, node-detail page, command-export flows]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive/optional props keep the gallery + existing callers compiling (back-compat AiReadLine.text, CommandPanel.cmdLabel/note overrides)"
    - "Risk-tier framing as a frozen lookup table (COMMAND_KIND_META) — single source for kicker/cmdLabel/note/copy copy"
    - "Inert-text security property preserved across all variants — React-escaped <code>/<p>, no dangerouslySetInnerHTML, copy via navigator.clipboard only"

key-files:
  created: []
  modified:
    - "src/components/df/AiReadPanel.tsx"
    - "src/components/df/AiReadPanel.test.tsx"
    - "src/components/df/CommandModal.tsx"
    - "src/components/df/CommandModal.test.tsx"

key-decisions:
  - "AiReadPanel became a Client Component only to wire the optional ✕ onClick; without onDismiss it renders identically SSR so string tests still pass"
  - "Rank squares reuse severityAccent (bg-df-*) so the prototype's per-severity colored ordinal squares map onto existing tokens — no new global token needed"
  - "AiReadLine.head/body are optional; legacy single-string `text` still renders as the muted body for back-compat with the gallery fixture"
  - "CommandPanel.kind defaults to 'command'; explicit cmdLabel/note props override the tier default so the existing gallery call is unchanged"

patterns-established:
  - "Frozen verbatim safety/framing copy exported as consts (AI_ALL_CLEAR_LEAD, COMMAND_KIND_META) — testable and drift-proof"

requirements-completed: []

# Metrics
duration: ~20min
completed: 2026-06-24
---

# Phase 10 Plan G3: AiReadPanel + CommandModal Fidelity Rebuild Summary

**Rebuilt the AI-read advisory band and command/runbook modal to prototype fidelity — numbered priority ranks + bold-lead/muted-body split + dismiss + all-clear calm variant on AiReadPanel; sev-chip/kicker header + info ⓘ note + three risk-tier variants on CommandModal — while preserving the zero-credential inert-text security property end to end.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-24T15:36Z
- **Completed:** 2026-06-24T15:42Z
- **Tasks:** 2 (AiReadPanel, CommandModal) + tests
- **Files modified:** 4

## Accomplishments

**AiReadPanel** (ranked gap #7):
- Numbered priority tags — `1`/`2`/`3` rendered as colored ordinal squares using `severityAccent` (per-severity `bg-df-*`).
- Head/body text split — bold-white lead clause (`head`) + muted-blue body (`#CBD6EC`), matching the prototype typography. Legacy single-`text` lines still render (back-compat).
- ✕ dismiss control — optional, rendered only when `onDismiss` is supplied (panel never self-hides; dismissal is parent state).
- All-clear "calm" variant — green check tile + frozen `AI_ALL_CLEAR_LEAD` ("Nothing needs you right now.") + optional `calmDetail`.
- Kept the navy `bg-df-chrome` band, the sparkle tile, the verbatim `AI_SAFETY_LABEL`, and the `AI_ZERO_CREDENTIAL_NOTE` footnote.

**CommandModal** (ranked gap #6):
- Sev-chip + kicker header — white-on-accent severity chip (`severityAccent`/`severityLabel`) + risk-tier kicker (e.g. "CRITICAL · Runbook · host operation").
- Info ⓘ note icon — lucide `Info` glyph beside the note line.
- Three risk-tier variants via `kind` prop (`command` / `investigate` / `runbook`), each with distinct kicker / cmdLabel / note / copy-button copy, frozen in `COMMAND_KIND_META`.
- Copy label flips to "Copied ✓" (prototype copy).
- **Inert property preserved**: command/runbook strings render as React-escaped text inside `<code>`/`<p>`; no `dangerouslySetInnerHTML`; copy via `navigator.clipboard.writeText` only; never executed. Verified across all three tiers with the hostile fixture.

## Task Commits

Single atomic commit (two coupled components + their tests, one fidelity-closure unit):

1. **AiReadPanel + CommandModal fidelity rebuild + tests** — see commit below (feat)

**Plan metadata:** this SUMMARY committed with the same change set on branch `gap-g3`.

## Files Created/Modified

- `src/components/df/AiReadPanel.tsx` — ranked tags, head/body split, dismiss, all-clear variant; now `"use client"` for the optional dismiss onClick.
- `src/components/df/AiReadPanel.test.tsx` — extended: numbered ranks, head/body split, legacy back-compat, all-clear variant, dismiss omission; kept verbatim-label + inert-escape assertions.
- `src/components/df/CommandModal.tsx` — sev-chip/kicker header, info ⓘ note, `CommandKind` + `COMMAND_KIND_META`, per-tier resolution with explicit-prop overrides.
- `src/components/df/CommandModal.test.tsx` — extended: three-tier framing assertions, inert-across-all-tiers, info-svg, override behavior; kept the hostile-fixture React-escape assertions.

## Decisions Made

- **AiReadPanel is now a Client Component** purely to wire the optional ✕ `onClick`. Without `onDismiss` it emits identical markup server-side, so the gallery (server-rendered, no `onDismiss`) and the `renderToStaticMarkup` tests are unaffected.
- **Rank squares reuse `severityAccent`** rather than introducing a new token — the prototype's per-severity colored ordinal squares map directly onto existing `bg-df-*` accents. No `globals.css`/`tokens.ts` edit needed.
- **Additive/back-compat props throughout**: `AiReadLine.head/body` optional with legacy `text` fallback; `CommandPanel.kind` defaults to `command` with explicit `cmdLabel`/`note` overriding tier defaults. The existing gallery call sites compile unchanged.

## Deviations from Plan

None — plan executed exactly as written. Only the four owned files were touched; no other `df/*` component, no `globals.css`/`tokens.ts`, no gallery edits.

## Issues Encountered

None. `npx tsc --noEmit` reports 7 pre-existing errors, all in `EvidenceChart.test.tsx` (not an owned file, not touched) — out of scope, logged only. The known 19 `src/lib/queue/*` Postgres permission-denied failures were excluded per constraints (df-only self-check).

## Self-Check

- AiReadPanel: numbered ranks + head/body split + dismiss + all-clear variant ✓
- CommandModal: sev-chip/kicker header + ⓘ note + 3 risk-tier variants, still fully INERT (escaped text, never executes) ✓
- Additive props; gallery compiles; tests extended + green; lint:noc-guard exit 0; NO next build ✓
- Only AiReadPanel + CommandModal files touched ✓
- Self-check commands: `CI=true npx vitest run --pool=forks --no-file-parallelism src/components/df` → **46 passed (10 files)**; `npm run lint:noc-guard` → **exit 0 (v2 surfaces clean)**

## Next Phase Readiness

Both primitives now reproduce the locked prototype's AI panel + command/runbook modal. Ranked gaps #6 and #7 are closed. Ready for page-level wiring (Ops Center / Node Detail) to consume the new ranked/calm AiReadPanel modes and the three CommandModal risk tiers.

---
*Phase: 10-design-system-foundation*
*Completed: 2026-06-24*
