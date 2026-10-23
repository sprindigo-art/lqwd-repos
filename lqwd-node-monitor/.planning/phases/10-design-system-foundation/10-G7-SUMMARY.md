---
phase: 10-design-system-foundation
plan: G7
subsystem: ui
tags: [design-system, gallery, df-primitives, recharts, fixtures, ssr]

# Dependency graph
requires:
  - phase: 10-design-system-foundation (Wave A + G6)
    provides: fidelity-complete df/* primitives (SeverityHeroCard, SeverityCard enriched, EvidenceChart discriminated axis union, BlastRadius, WhyChain, NavRailShell instrumented, AiReadPanel ranks/all-clear, CommandModal tiers, TwoAxisPip, SeverityRow, FreshnessChip relative, ImplTag role+impl)
provides:
  - "Rebuilt /design-system gallery that exercises every df/* primitive at full prototype fidelity from static fixtures"
  - "Prototype-matching fixtures.ts mirroring the Ops Center v2 host-03 hero + Node Detail scenarios"
affects: [design-system, verification, future-df-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-Component gallery renders expand-driven primitives with `expanded` + NO `onToggle` so drawers show OPEN statically (no client wiring)"
    - "Deterministic FreshnessChip `now` prop for stable relative-age rendering in a static gallery"
    - "Per-primitive fixture sections mirroring locked prototype scenarios/copy"

key-files:
  created: []
  modified:
    - "src/app/(design)/design-system/fixtures.ts"
    - "src/app/(design)/design-system/page.tsx"

key-decisions:
  - "Reframed the gallery's column grammar: the 7-state matrix is retained ONLY for SeverityCard (default/critical/warning/watch/healthy/stale/loading); every other primitive is shown in ITS OWN meaningful variants, not forced through 7 states."
  - "Rendered the expanded SeverityCard + SeverityHeroCard with `expanded` and no `onToggle` to keep the page a pure Server Component while still showing the full open drawer."
  - "Passed a fixed `FRESHNESS_NOW` to every FreshnessChip / SeverityCard freshness so relative ages are deterministic (no wall-clock drift in a static surface)."

patterns-established:
  - "Gallery fixtures carry raw series/strings; the page formats units only where needed via the primitives' own units-aware paths (EvidenceChart sats axis labels)."

requirements-completed: []

# Metrics
duration: ~30min
completed: 2026-06-24
---

# Phase 10 Plan G7: Primitive Gallery Rebuild Summary

**Rebuilt the in-app /design-system gallery so it showcases every fidelity-complete df/* primitive (SeverityHeroCard, enriched + expanded SeverityCard, all EvidenceChart variants + StaleChart, BlastRadius, WhyChain, instrumented NavRailShell, AiReadPanel ranks/all-clear, CommandModal tiers, TwoAxisPip, SeverityRow, FreshnessChip, ImplTag) from realistic, prototype-matching static fixtures.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-06-24
- **Tasks:** 1 (gap-closure G7)
- **Files modified:** 2

## Accomplishments
- **SeverityHeroCard** rendered as the prototype TOP-PRIORITY scenario: "bitcoind on host-03 stalled — 22 min behind chain tip" — CRITICAL, ROOT CAUSE · 3 nodes roll up, the +22m area-above-threshold evidence sparkline, the BlastRadius fan-out to lqwd-rtr-04/-09 + lqwd-lsp-02, the resolution callout, and the expand grid (why-chain + AI grouping + 3 grouped child rows + the Restart bitcoind runbook export) shown open.
- **SeverityCard** across all 7 states (default bare / critical-DOWN-marker / warning-projection / watch-fee-drift-band / healthy-sats-band / honest-stale-StaleChart / loading skeleton), each with the ImplTag + FreshnessChip meta row where data is present, PLUS a separate fully-EXPANDED hero-grade card showing the drawer (WhyChain timeline + AiReadPanel + child SeverityRows + CommandModal export).
- **EvidenceChart** exercised across area-above-threshold, area-under + vertical "lost" marker, dashed projection + "now" marker, peer-median band, shade-window (Node-Detail fee-drift) + sats axis, and time axes (-30m/now) — each inside the EvidencePanel chrome — plus the honest **StaleChart** "NO FRESH DATA" fallback.
- **BlastRadius** at N=3 (hero fan-out) and N=1 (single-node blast); **WhyChain** as the multi-severity (healthy→warning→critical) detection timeline.
- **NavRailShell** instrumented LIVE around the whole gallery: fleet ramp + tally (4 crit · 1 warn · 2 watch · 19 ok), Mid-incident/All-clear view toggle, and "Live · polled 4s ago" pill.
- **AiReadPanel** in both ranked (numbered priority squares; inert shell-metachar line) and all-clear (green-check calm) variants; **CommandModal** in all three tiers (runbook / command / investigate); **TwoAxisPip** up / up-but-dead / down with last-run; **SeverityRow** square-dot records; **FreshnessChip** fresh/stale/no-data; **ImplTag** Routing·LND / LSP·LDK.

## Task Commits

1. **G7: rebuild primitive gallery + fixtures** - committed on branch `gap-g7`

## Files Created/Modified
- `src/app/(design)/design-system/fixtures.ts` - Rewritten with rich, prototype-matching per-primitive fixture sections (hero scenario, card states + expanded card, every EvidenceChart variant + stale + shade, blast 1..N, why-chain, nav instrumentation, AI ranks + all-clear, command tiers, two-axis permutations, severity rows, freshness, impl tags).
- `src/app/(design)/design-system/page.tsx` - Rebuilt to a section-per-primitive showcase importing the REAL df/* components; renders SeverityHeroCard + enriched/expanded SeverityCard + EvidenceChart variants + StaleChart + BlastRadius + WhyChain + AiReadPanel variants + CommandModal tiers + TwoAxisPip + SeverityRow + FreshnessChip + ImplTag using each primitive's CURRENT prop API.

## Decisions Made
- The 7-state column matrix is retained ONLY for SeverityCard (the one primitive whose grammar maps onto default/critical/warning/watch/healthy/stale/loading). Every other primitive is shown in its own meaningful variants rather than forced through 7 states — this matches each primitive's actual prop surface (e.g. EvidenceChart is a chart-variant family, not a severity ramp; BlastRadius is a 1..N count; AiReadPanel is ranked vs all-clear).
- Expand-driven primitives are rendered with `expanded` and NO `onToggle`, keeping the page a pure Server Component while still displaying the full open drawer (the caller owns toggle state by contract).
- A fixed `FRESHNESS_NOW` reference is passed to every freshness consumer so relative ages render deterministically on this static surface.

## Deviations from Plan
None - executed exactly as written. Used each primitive's current prop API as the source of truth (read every component first): SeverityCard groups children via `childAlerts`, freshness via the `{ asOf, stale, now }` object; ImplTag shows role+impl by default; EvidenceChart axis labels are the discriminated `AxisLabel` union; FreshnessChip is relative with an injectable `now`; CommandModal tiers via `kind`; AiReadPanel `head`/`body` ranked lines + `allClear`/`calmDetail`.

## Issues Encountered
None.

## Self-Check

- `npx tsc --noEmit` → **0 errors** (the real gallery compile check).
- `npm run lint:noc-guard` → **exit 0** ("v2 surfaces clean").
- `CI=true npx vitest run --pool=forks --no-file-parallelism src/components/df` → **101 passed (13 files)** — primitives unchanged, still green.
- `git status --short` → only `src/app/(design)/design-system/fixtures.ts` and `page.tsx` modified; no primitive/token edits.
- NO `next build` run (hangs this env; orchestrator runs it separately).
- Pre-existing 19 `src/lib/queue/*` Postgres permission-denied failures left untouched (out of scope).

## Self-Check: PASSED

## Next Phase Readiness
- The gallery now serves as the visual proof artifact for the fidelity-complete df/* primitive set — ready for the orchestrator's `next build` watchdog pass and design-system verification.

---
*Phase: 10-design-system-foundation*
*Completed: 2026-06-24*
