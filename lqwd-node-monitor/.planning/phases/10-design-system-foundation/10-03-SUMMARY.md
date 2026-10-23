---
phase: 10-design-system-foundation
plan: 03
subsystem: design-system
tags: [recharts, charts, evidence-chart, stale-fallback, command-modal, ds-02, inert-text, wave-2]
requires:
  - df-* design tokens + DF TS mirror (10-01)
  - vitest .tsx renderToStaticMarkup discovery (10-01)
  - lint:noc-guard (10-01)
  - "@/components/ui/dialog vendored Radix Dialog"
  - "@/lib/format/units (AFM-002)"
provides:
  - recharts@3.9.0 dependency (exact pin, no react-is override)
  - "src/components/df/EvidenceChart.tsx (Recharts inline evidence chart + deriveChartModel)"
  - "src/components/df/StaleChart.tsx (honest 'NO FRESH DATA' stale fallback)"
  - "src/components/df/CommandModal.tsx (inert command/runbook export + CommandPanel body)"
affects:
  - package.json
  - package-lock.json
  - src/components/df/EvidenceChart.tsx
  - src/components/df/StaleChart.tsx
  - src/components/df/CommandModal.tsx
tech-stack:
  added:
    - recharts@3.9.0 (exact pin, dependencies, React-19 native peer support)
  patterns:
    - pure exported deriveChartModel grammar (unit-testable without a DOM — Recharts 3.x renders SVG client-side only)
    - StaleChart pure-SVG honest-stale fallback (no Recharts, SSR-renderable)
    - exported CommandPanel inert body (renderToStaticMarkup-testable; <script> fixture asserts escaped output)
    - SSR-safe literal DF hex in SVG attrs (no getComputedStyle)
key-files:
  created:
    - src/components/df/EvidenceChart.tsx
    - src/components/df/EvidenceChart.test.tsx
    - src/components/df/StaleChart.tsx
    - src/components/df/StaleChart.test.tsx
    - src/components/df/CommandModal.tsx
    - src/components/df/CommandModal.test.tsx
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Recharts 3.x renders its SVG surface client-side only (empty `.recharts-wrapper` under renderToStaticMarkup, confirmed by probe with explicit width/height AND renderToString). Rather than add jsdom+RTL (a package install excluded from auto-fix), the chart grammar (line/threshold/band/area/projection/last-dot) was extracted into a pure exported `deriveChartModel` that the test asserts directly; the SSR-renderable paths (StaleChart fallback + units.ts axis labels) are asserted via renderToStaticMarkup."
metrics:
  duration: ~30m
  completed: 2026-06-24
requirements: [DS-01, DS-02]
---

# Phase 10 Plan 03: Chart + Command DS-02 Primitives Summary

Installed `recharts@3.9.0` behind the operator-approved supply-chain gate and built the three v2 client-island primitives: `EvidenceChart` (Recharts inline chart rebuilt to the locked prototype `chart()` grammar — peer-median band, dashed threshold, accent area, 2px line, dashed projection, last-dot — with SSR-safe DF hex colors and units.ts axis labels), `StaleChart` (the hatched gold "NO FRESH DATA" honest-stale fallback EvidenceChart renders when `stale=true`, DS-01), and `CommandModal` (Radix Dialog rendering command/runbook strings as inert, React-escaped, copyable text — never executed). All NOC-guard clean.

## What Was Built

- **Task 1 — recharts@3.9.0 install (`fec1c80`):** Operator approved the blocking supply-chain checkpoint; ran `npm install recharts@3.9.0 --save-exact`. Exact pin in `dependencies`; NO `react-is` override (obsolete on Recharts 3.x — verified peerDeps allow `react@^19`). package.json + package-lock.json committed.
- **Task 2 — EvidenceChart + StaleChart (TDD: tests + impl `310f4b8`):**
  - `StaleChart.tsx` — pure SVG (no Recharts), ported verbatim from prototype `staleChart()` (519-531): `#F7F2E4` panel, 5px diagonal `#D9D2BC` stripes @ .5 opacity, `#E4D9B6` hairline border, bold `#8A7426` "NO FRESH DATA" + a `#A1924F` last-good line; unique clip id per `idSuffix`.
  - `EvidenceChart.tsx` — `"use client"` Recharts island reproducing prototype `chart()` (472-517): `ReferenceArea` peer-median band, dashed neutral `ReferenceLine` threshold w/ right-aligned label, accent `Area` fill (`accent+"1f"`), 2px accent `Line`, dashed projection (0.65 opacity), last-dot. Colors are literal DF hex (no `getComputedStyle`); fixed wrapper height (58 inline / 104 hero) avoids the `ResponsiveContainer` zero-size flash. The grammar is derived by a pure exported `deriveChartModel`; `stale=true` returns `<StaleChart>` (DS-01); sat/BTC axis labels route through `formatSats`/`formatBtc`.
  - Tests (renderToStaticMarkup, 8): grammar derivation (line/threshold/band/area/projection/last-dot), `<2`-point guard, stale fallback markup, units.ts label formatting.
- **Task 3 — CommandModal (TDD: tests + impl `7c02ed2`, comment reword in same commit):** `"use client"` modal reusing the vendored `@/components/ui/dialog` (focus-trap/scroll-lock/ESC already solved — no hand-rolled overlay). Runbook steps + the command in a navy `#13284F` `<code>` block (`white-space:pre`), all React-escaped text — no raw-HTML sink, never executed. Copies via `navigator.clipboard.writeText` (zero-write-path). The inert body is the exported `CommandPanel` so the inert-text behavior is testable; the test renders a `<script>`/`rm -rf /`-bearing fixture and asserts it is escaped (no live `<script>` tag) inside `<code>`. Tests (renderToStaticMarkup, 3).

## Verification Evidence

- `CI=true npx vitest run --pool=forks --no-file-parallelism src/components/df` → **11/11 passed** (3 files).
- `npm run lint:noc-guard` → **exit 0** ("v2 surfaces clean").
- `npx eslint src/components/df` → **exit 0** (no findings).
- `recharts` = `3.9.0` in dependencies; no `react-is` override (`node -e` check passed).
- `grep -rn 'dangerouslySetInnerHTML' src/components/df` → **nothing** (the plan's `! grep` verify passes).
- `grep getComputedStyle src/components/df` → only doc-comment mentions (the anti-pattern we avoid); no runtime use.
- DF import + units import present in EvidenceChart; `@/components/ui/dialog` reused in CommandModal; `navigator.clipboard.writeText` present.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Recharts SVG internals are not assertable under the dep-free SSR test path; grammar extracted to a pure helper**
- **Found during:** Task 2 (writing the EvidenceChart RED test).
- **Issue:** The plan's `<behavior>` requires the test to assert that EvidenceChart's "output is an SVG containing a line path, a dashed threshold reference line, and the band area." A probe confirmed Recharts 3.x renders its SVG surface **client-side only** — under `renderToStaticMarkup` (and even `renderToString`, with explicit `width`/`height`) it emits only an empty `.recharts-wrapper` div. The chosen test infra (10-01) is the dep-free `renderToStaticMarkup` node path with **no jsdom / no @testing-library/react** installed. Adding jsdom+RTL is a package install — excluded from auto-fix (slopsquat policy) and would itself need a checkpoint; moreover Recharts 3.x's effect-driven render would not synchronously contain the path even under jsdom.
- **Fix:** Extracted the chart grammar into a **pure, exported `deriveChartModel`** (returns the line/threshold/band/area/projection/last-dot descriptors the Recharts tree is built from) and assert it directly — faithfully verifying the prototype grammar without a DOM. The two paths that DO render server-side (the `StaleChart` honest-stale fallback markup and the units.ts-formatted axis labels) are asserted via `renderToStaticMarkup`. This satisfies the behavior's intent (grammar + stale fallback + units labels are all proven) within the established no-new-deps test path.
- **Files modified:** src/components/df/EvidenceChart.tsx, src/components/df/EvidenceChart.test.tsx
- **Commit:** 310f4b8

**2. [Rule 1 — Verify correctness] Reworded inert-text doc comments so the plan's `! grep dangerouslySetInnerHTML` check passes**
- **Found during:** Task 3 acceptance verification.
- **Issue:** The plan's verify is `! grep -rn 'dangerouslySetInnerHTML' src/components/df` (must return nothing). My security doc comments mentioned the literal token to document that it is avoided — which made the grep *find* matches and fail the check.
- **Fix:** Reworded the two comments to "raw-HTML sink prop" without the literal token. No behavior change; the component never used the sink. Grep now returns nothing (exit 1 → the `!`-inversion passes).
- **Files modified:** src/components/df/CommandModal.tsx
- **Commit:** 7c02ed2

### Tooling note (not a code deviation)

Per the execution objective (a prior agent hung on a full `next build`), self-check used `CI=true npx vitest run --pool=forks --no-file-parallelism` + `npm run lint:noc-guard` — **no `next build`** (owned by the Phase-10 gate in plan 10-04). `CI=true` is the effective hang-prevention on this macOS host (bare `vitest run` hangs at 0% CPU in this non-TTY env; there is no `timeout` binary). The worktree had no `node_modules`; `npm install recharts@3.9.0` produced a fresh real tree (gitignored — only package.json + package-lock.json are committed).

## Threat Surface

- **T-10-SC (recharts supply chain):** mitigated — installed only after the operator approved the blocking `checkpoint:human-verify`; exact pin; npmjs peerDeps spot-checked (react `^19`).
- **T-10-06 (command HTML sink):** mitigated — command/runbook render as React-escaped text in `<code>`; `<script>` fixture asserted escaped; no raw-HTML sink (grep clean).
- **T-10-07 (command execution):** mitigated — modal only `navigator.clipboard.writeText`; never executes; static fixtures, no node credential.
- **T-10-08 (NOC token leak):** mitigated — `npm run lint:noc-guard` exit 0 on all three primitives.

No new security surface beyond the plan's threat model.

## Known Stubs

None. All three primitives are fully wired to their declared inputs (DF tokens, units.ts, the Radix Dialog). The gallery that mounts them with fixtures is Plan 10-04 (downstream, out of this plan's scope).

## Self-Check: PASSED

- Files: all 6 created + 2 modified files FOUND on disk.
- Commits: fec1c80, 310f4b8, 7c02ed2 all FOUND in git log.
- Gates: vitest 11/11 green; lint:noc-guard exit 0; eslint exit 0; recharts@3.9.0 pinned; no react-is override; no dangerouslySetInnerHTML; dialog reuse + clipboard present.
