---
phase: 03-per-node-console-pending-monitor
plan: 10
subsystem: ui
tags: [tailwind-v4, theme-tokens, next-font, noc-light, saira, ibm-plex-mono, inter]

# Dependency graph
requires:
  - phase: 03-per-node-console-pending-monitor (03-09 gate)
    provides: Operator visual verdict + sketch-findings-nodemonitor skill (validated NOC Light theme contract)
provides:
  - NOC Light @theme token set in globals.css (light surfaces, darkened severity hexes, five -dim tint tokens)
  - --font-display / --font-mono / --font-sans tokens wired to next/font variables (Saira Semi Condensed / IBM Plex Mono / Inter)
  - Light masthead chrome ("LQWD / Node Operations" Saira wordmark, routing_vm mono label, solid bg-card bar)
  - CLAUDE.md Brand constraint updated — light-first supersession recorded
affects: [03-11, 03-12, 03-13, 03-14, 03-15, 03-16]

# Tech tracking
tech-stack:
  added: [next/font/google self-hosted fonts (no package.json change)]
  patterns: ["Severity -dim tint tokens for chip/panel backgrounds", "font-display utility for Saira display headers", "tight radii 3/6/10px via fixed --radius-sm/md"]

key-files:
  created: []
  modified:
    - src/app/globals.css
    - src/app/layout.tsx
    - src/app/(overview)/layout.tsx
    - CLAUDE.md

key-decisions:
  - "Light NOC is the only mode — .dark block deleted entirely, no dark class on <html> (operator decision 2026-06-11)"
  - "Sidebar CSS variables set to neutral light equivalents (plan allowed leaving them; light values avoid dark remnants); chart-1..5 left as-is (unused)"
  - "--color-status-outlier kept defined for existing consumers; presentation update deferred to 03-12 per plan"

patterns-established:
  - "Severity tokens: 5 base + 5 -dim tints; -dim family is the only sanctioned chip/panel tint source"
  - "Fonts flow next/font variable -> @theme token -> Tailwind utility (font-display/font-mono/font-sans)"

requirements-completed: [NODE-01, PENDING-01]

# Metrics
duration: 3min
completed: 2026-06-11
---

# Phase 3 Plan 10: NOC Light Theme Foundation Summary

**NOC Light token foundation: light surfaces + darkened severity palette with five -dim tints in globals.css, three sketch fonts self-hosted via next/font, light masthead chrome, and the CLAUDE.md dark-default constraint superseded**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-11T16:20:29Z
- **Completed:** 2026-06-11T16:23:47Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- globals.css carries the complete NOC Light token set from the operator-validated sketch light.css: `#eef1f7` ground, white cards, `#0D1626`/`#34435E` text scale, darkened severity hexes (ok `#0B8A51`, warn `#8F5D00`, critical `#D92638`, stale/nodata `#5D6A80`) plus the five `-dim` rgba tints downstream plans (03-12 grade chip, 03-14 signals panel) compose on
- `.dark` override block deleted; `className="dark"` removed from `<html>` — light is the only mode
- Saira Semi Condensed (600/700), IBM Plex Mono (400/600), and Inter wired via next/font/google with zero package.json change; `--font-display`/`--font-mono`/`--font-sans` @theme tokens expose them as Tailwind utilities
- Tight radii per sketch contract: `--radius-sm: 3px`, `--radius-md: 6px` (fixed, not calc), `--radius-lg` stays 10px
- Masthead restyled for light NOC: radial navy wash deleted, "Node Operations" wordmark in Saira (font-display uppercase letterspaced), right-aligned `routing_vm` mono label, solid `bg-card border-b border-border` header bar
- CLAUDE.md Brand constraint no longer mandates "Dark theme default" — records the 2026-06-11 light-first operator decision; navy `#1A3C79` clause untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite globals.css theme tokens to NOC Light** - `b880129` (feat)
2. **Task 2: Wire sketch fonts via next/font and drop the dark class** - `9693a1f` (feat)
3. **Task 3: Light masthead chrome + CLAUDE.md Brand-line supersession** - `0a40d90` (feat)

## Files Created/Modified
- `src/app/globals.css` - NOC Light @theme tokens: 5 base + 5 -dim severity tokens, brand-glow `#2C5CB4`, light :root surfaces, fixed 3/6px radii, font tokens; .dark block removed
- `src/app/layout.tsx` - next/font/google imports (Saira_Semi_Condensed, IBM_Plex_Mono, Inter) with `--font-saira`/`--font-plex-mono`/`--font-inter` variables on `<html>`; dark class dropped
- `src/app/(overview)/layout.tsx` - Light masthead: no radial wash, Saira "Node Operations" wordmark, ms-auto `routing_vm` mono label, bg-card header
- `CLAUDE.md` - Brand constraint records light-first NOC supersession (operator decision 2026-06-11)

## Decisions Made
- Sidebar CSS variables set to neutral light equivalents rather than left dark (plan permitted either; light values prevent stale dark remnants); chart-1..5 grayscale oklch left in place (unused)
- `@custom-variant dark` line kept (inert — plan permitted; no `.dark` class ever fires)
- CLAUDE.md line 95 ("Brand + dark theme: set class=dark...") in the auto-generated Technology Stack research section was left untouched — the plan scopes the supersession to the binding `### Constraints` Brand line only, and that section is research notes, not a constraint

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None — theme/token work only; no data-flow components touched.

## Issues Encountered
None. Pre-existing Next.js multiple-lockfile workspace-root warning (worktree lockfile vs main repo) is environmental and out of scope.

## Verification Results
- `npx tsc --noEmit` — exit 0 (PASS)
- `npm run build` — compiled successfully; all 7 routes present (PASS)
- `npm test` — 252 passed, 16 skipped (PASS)
- Token greps: all ten status tokens + `--font-display` + `#eef1f7` present; no `#070a12`/`#0e1524`; no `.dark {` block (PASS)
- `! grep -q "Dark theme default" CLAUDE.md` (PASS); `Light-first NOC theme` present (PASS)
- `git diff -- package.json` empty — no dependency added (PASS, T-03-SC)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Token foundation in place: 03-12 (grade chip), 03-13, 03-14 (signals panel), 03-15 can compose `bg-status-*-dim`, `text-status-*`, `font-display` utilities directly
- All existing pages render on light tokens via opacity-based classes without component changes; component-level visual polish lands in the sibling gap-closure plans

---
*Phase: 03-per-node-console-pending-monitor*
*Completed: 2026-06-11*

## Self-Check: PASSED
