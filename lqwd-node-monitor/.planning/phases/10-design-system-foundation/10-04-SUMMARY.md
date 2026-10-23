---
phase: 10-design-system-foundation
plan: 04
subsystem: design-system
tags: [ds-02, gallery, route-group, fixtures, rsc, client-island, phase-gate, df-slate]
requires:
  - df-* design tokens + DF TS mirror (10-01)
  - presentational primitives — SeverityCard/Row, TwoAxisPip, FreshnessChip, ImplTag, AiReadPanel, NavRailShell (10-02)
  - chart + command primitives — EvidenceChart, StaleChart, CommandModal (10-03)
  - "@/lib/format/units (AFM-002 formatSats)"
  - lint:noc-guard (DS-03)
provides:
  - "(design) route group with a minimal RSC layout (no masthead, no @modal slot)"
  - "/design-system gallery — every Phase-10 primitive × all 7 states from static fixtures (DS-02 proof artifact)"
  - "src/app/(design)/design-system/fixtures.ts — static, serializable per-state props for every primitive"
  - "df-slate token (#64748B) — the prototype neutral chart gray, added to globals.css + tokens.ts (fixes a latent EvidenceChart type bug)"
affects:
  - "src/app/(design)/layout.tsx"
  - "src/app/(design)/design-system/page.tsx"
  - "src/app/(design)/design-system/fixtures.ts"
  - "src/app/globals.css"
  - "src/lib/df/tokens.ts"
tech-stack:
  added: []
  patterns:
    - route-group isolation (a (design) group whose layout deliberately omits the (overview) masthead + @modal parallel-route slot)
    - static-fixtures-only gallery (per-state props as compile-time constants; no DB/fetch import — T-10-10)
    - real-primitive gallery (imports @/components/df/* verbatim; client islands EvidenceChart/CommandModal mount inside the RSC page)
    - 7-state × N-primitive matrix driven by a single GALLERY_STATES iteration + STATE_TO_SEVERITY map (no inline sev chains)
key-files:
  created:
    - "src/app/(design)/layout.tsx"
    - "src/app/(design)/design-system/page.tsx"
    - "src/app/(design)/design-system/fixtures.ts"
  modified:
    - src/app/globals.css
    - src/lib/df/tokens.ts
decisions:
  - "next build's TypeScript phase could not complete in this sandbox (compile succeeded in 11.9s; the separate TS-check phase was watchdog-killed at 360s — the documented phase-10 environmental hang). Build TS-correctness was instead proven by a targeted `tsc --noEmit` over the gallery files + EvidenceChart (exit 0). Full `next build` exit-0 is deferred to operator manual-verify."
  - "df-slate (#64748B) added as a canonical token rather than rerouting EvidenceChart's neutral to an existing df hue — preserves the exact prototype #64748B threshold/band gray the Plan-03 code already referenced, and keeps CSS<->TS parity (both globals.css + tokens.ts gain the key, so tokens.test.ts stays green)."
  - "the 7 gallery states map onto the 5-value severity ramp + 2 render modes: default = the CVA default (healthy), loading = an evidence-less skeleton; stale is a first-class honest state (FreshnessChip dashed/square-dot, EvidenceChart -> StaleChart 'NO FRESH DATA')."
metrics:
  duration: ~35m
  completed: 2026-06-24
requirements: [DS-02, DS-03]
---

# Phase 10 Plan 04: In-App DS-02 Primitive Gallery + Phase Gate Summary

The DS-02 proof artifact: an in-app App Router `/design-system` gallery under an isolated
`(design)` route group that renders every Phase-10 `df` primitive across all seven gallery
states (default/critical/warning/watch/healthy/stale/loading) from **static fixtures only**,
using the **real** `@/components/df/*` components (no re-implementation, no Storybook, no new
tooling — D-04). The gallery is a pure RSC; the two client primitives (EvidenceChart,
CommandModal) mount as client islands inside it. Closing the phase, the gate ran:
`lint:noc-guard` exit 0, the df/design-system vitest suite green (52/52), the full suite green
except the known phase-06 queue DB-permission failures, and a targeted `tsc --noEmit`
(exit 0) — with the full `next build` TS phase deferred to operator manual-verify (sandbox hang).

## What Was Built

- **Task 1 — `(design)` route group + minimal layout + gallery page + fixtures (`baf7d0a`):**
  - `src/app/(design)/layout.tsx` — a minimal RSC shell wrapping `{children}` on the `bg-df-bg`
    ground. It is in its OWN route group, so it does NOT inherit the `(overview)` masthead and has
    NO `@modal` parallel-route slot (route groups isolate layouts). df-* tokens only.
  - `src/app/(design)/design-system/fixtures.ts` — static, serializable per-state props for every
    primitive: `GALLERY_STATES` (the 7-column grammar), `STATE_TO_SEVERITY`/`STATE_LABEL`, severity
    card/row fixtures (raw sats the page formats via `formatSats`), `TwoAxisPip` running×functioning
    permutations **including the up-but-dead** (`running:true, functioning:false`) and DOWN states,
    `FreshnessChip` fresh/stale/honest-no-data fixtures, `ImplTag` LND/LDK, an `AiReadPanel` line set
    with **shell metacharacters** (`<script>…</script>`, `` `rm -rf /` ``) to prove inert rendering,
    `EvidenceChart` series+threshold+band+projection per state plus a `stale` fixture (→ StaleChart),
    and a `CommandModal` command bearing shell metacharacters (`&&`, `|`, `>`, `$()`, `;`) to confirm
    the command renders inert. Pure constants — **no DB, no fetch** (T-10-10).
  - `src/app/(design)/design-system/page.tsx` — a pure RSC importing every real primitive and
    rendering each across all 7 states via a single `GALLERY_STATES.map(...)` iteration grouped by
    primitive with a state caption. Hosts the gallery in `NavRailShell`. Reachable at `/design-system`.
  - **[Rule 1 fix] df-slate token:** `EvidenceChart` (Plan 03) referenced `DF.slate` (the prototype
    neutral `#64748B` threshold/band gray) but no `slate` key existed in `tokens.ts` — a latent type
    error (3× `TS2339`) the Plan-03 SSR tests never surfaced. Added `--color-df-slate: #64748B` to
    `globals.css` and `slate: "#64748B"` to `tokens.ts` (CSS↔TS parity preserved).

## Verification Evidence

- `npm run lint:noc-guard` → **exit 0** ("v2 surfaces clean") over `src/components/df` + `src/app/(design)`.
- `CI=true npx vitest run --pool=forks --no-file-parallelism src/lib/df src/components/df` →
  **52/52 passed** (12 files) — incl. the `tokens.test.ts` CSS↔TS parity test, which stayed green
  after the `df-slate` addition (both sides gained the key).
- `CI=true npx vitest run --pool=forks --no-file-parallelism` (full suite) → **699 passed, 20 skipped**;
  **21 failed — all in `src/lib/queue/*`** (approve/claim/enqueue/stub-executor) with Postgres
  `permission denied` code **42501** on `command_audit`/`command_executions`. These are the documented
  pre-existing phase-06 environmental DB-role failures (the test DB role lacks write grants), NOT a
  phase-10 regression. Per the execution objective, this is a PASS (all non-queue + all design-system
  tests green).
- Targeted `tsc --noEmit` over the three gallery files + `EvidenceChart.tsx` (skipLibCheck) →
  **exit 0** after the `df-slate` fix (was 3 errors before). This proves the gallery wiring + its
  chart dependency are type-correct.
- `next build` → **Turbopack compiled successfully in 11.9s**, then entered "Running TypeScript …"
  and was killed by the 360s watchdog (the documented phase-10 sandbox hang — see Deferred).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Latent `DF.slate` type error in EvidenceChart (Plan 03) blocked the build gate**
- **Found during:** Task 1 acceptance (targeted `tsc --noEmit` over the gallery + its chart import).
- **Issue:** `src/components/df/EvidenceChart.tsx` references `DF.slate` in three places (threshold
  stroke, peer-median band fill, threshold label fill — the prototype neutral `#64748B`), but
  `src/lib/df/tokens.ts` shipped no `slate` key. `tsc` reported 3× `TS2339 Property 'slate' does not
  exist`. Plan-03's tests used `renderToStaticMarkup`/pure-helper assertions and never type-checked
  the chart in a build, so the error was latent. The `next build` Turbopack **compile** also missed it
  (compile transpiles without full type-checking) — it only surfaces in the TS-check phase. Because the
  gallery imports `EvidenceChart`, this blocks the phase truth "next build succeeds".
- **Fix:** Added the canonical neutral token — `--color-df-slate: #64748B` to `globals.css` and
  `slate: "#64748B"` to `tokens.ts` — preserving the exact prototype hue the Plan-03 code intended.
  Both sides gain the key, so the `tokens.test.ts` CSS↔TS bijection stays green; `slate` is neutral
  (≠ chrome/brand, not in the severity ramp), so the set-disjoint ramp test is unaffected.
- **Files modified:** src/app/globals.css, src/lib/df/tokens.ts
- **Commit:** baf7d0a

**2. [Rule 3 — Blocking] noc-guard tripped on a literal forbidden token inside a layout comment**
- **Found during:** Task 1 first `lint:noc-guard` run.
- **Issue:** A `(design)/layout.tsx` comment literally spelled retired NOC utilities to say they are
  forbidden; the guard greps comments too and flagged the literal.
- **Fix:** Reworded the comment to "no retired NOC v1 utilities" without the literal token strings
  (same pattern Plan 02 used). Guard returned to exit 0.
- **Files modified:** src/app/(design)/layout.tsx
- **Commit:** baf7d0a

## Deferred / Environmentally-Blocked

- **`next build` exit-0 (manual-verify):** The Turbopack compile **succeeded** (11.9s); the separate
  TypeScript phase could not complete in this sandbox (watchdog-killed at 360s — the documented
  phase-10 hang; this host has no `timeout` binary). Build **TS-correctness** was instead proven by a
  targeted `tsc --noEmit` over the gallery + `EvidenceChart` (exit 0). **Operator action:** run
  `CI=true npx next build` on a normal host and confirm exit 0 (expected to pass — compile is already
  green and the full-project types are clean over the changed surface).

## Known Stubs

None. The gallery renders the real primitives against trusted static fixtures; no placeholder data
flows to a UI that should be live (the gallery is intentionally static — that is its DS-02 contract).

## Threat Surface

- **T-10-09 (NOC token leak into the gallery):** mitigated — `lint:noc-guard` exit 0 over
  `src/app/(design)` + `src/components/df`.
- **T-10-10 (gallery accessing live data):** accept/verified — the gallery files contain no `fetch`
  and no DB import; all props are compile-time constants in `fixtures.ts`.
- **T-10-11 (CommandModal implying execution):** mitigated — the modal renders the fixture command
  (with shell metacharacters) as inert, copyable text; the manual checkpoint re-confirms nothing runs.

No new security-relevant surface beyond the plan's threat model (static RSC + client islands over
trusted fixtures; no network/auth/file/schema surface; the `df-slate` token is a presentational color).

## Checkpoint Status

Task 2 is a **blocking `checkpoint:human-verify`** — the operator's visual fidelity sign-off against
the locked prototypes (VALIDATION.md flags this as the one human-only verification). The automated
gate is green (vitest + noc-guard + targeted tsc; `next build` compile green, TS-phase deferred). This
plan is **paused awaiting operator approval**; the phase closes on "approved".

## Self-Check: PASSED (with one deferred item)

- Files: all 3 created `(design)` files FOUND on disk; both modified files (globals.css, tokens.ts) carry the `df-slate` token.
- Commit: baf7d0a FOUND in git log.
- Gates: lint:noc-guard exit 0; df/design-system vitest 52/52; full suite green except the 21 known phase-06 queue 42501 failures; targeted `tsc --noEmit` exit 0.
- **Deferred:** full `next build` exit-0 — operator manual-verify (sandbox TS-phase hang; compile already green + targeted tsc clean).
