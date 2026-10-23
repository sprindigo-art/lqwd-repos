---
phase: 01-foundations-read-layer
plan: 01
subsystem: foundations
tags: [scaffold, nextjs, tailwind-v4, vitest, afm-002, formatter]
requires: []
provides:
  - "Next.js 16 App Router scaffold pinned to lqwdclaw stack"
  - "Vitest test runner + @/ alias resolution"
  - "AFM-002 single-source unit formatter (feeMsatToSat/formatBtc/formatSats)"
  - "cn() className helper (shadcn convention)"
affects:
  - "Every later Phase 1 plan (01-02..01-04) and all downstream phases build on this scaffold"
  - "All sat/BTC/msat rendering must route through src/lib/format/units.ts"
tech-stack:
  added:
    - "next@16.1.6, react/react-dom@19.2.3 (pinned to lqwdclaw)"
    - "tailwindcss@^4 + @tailwindcss/postcss (CSS-first, no tailwind.config.js)"
    - "vitest@^4 (first test runner in the workspace)"
    - "server-only, drizzle-orm, postgres, clsx, tailwind-merge, lucide-react, tw-animate-css"
  patterns:
    - "Tailwind v4 @theme brand token (navy #1A3C79); dark theme default via class=dark"
    - "Vitest plain node/ESM config, no Next.js/React plugin; @/ alias mirrored from tsconfig"
    - "AFM-002 centralized conversion (no ad-hoc /1e8 or *1000 anywhere in src)"
key-files:
  created:
    - "package.json, tsconfig.json, next.config.ts, eslint.config.mjs, .prettierrc, postcss.config.mjs"
    - ".gitignore, .env.example"
    - "src/app/layout.tsx, src/app/page.tsx, src/app/globals.css"
    - "vitest.config.ts"
    - "src/lib/utils.ts (cn)"
    - "src/lib/format/units.ts (AFM-002 formatter)"
    - "src/lib/format/units.test.ts (reference-value tests)"
  modified: []
decisions:
  - "Hand-authored the scaffold files (vs create-next-app) to guarantee exact lqwdclaw version pins and avoid interactive prompts / unpinned deps."
  - "globals.css uses navy #1A3C79 as the brand token; omitted lqwdclaw's orange palette entirely (brand constraint)."
  - "Added @/ alias to vitest.config.ts (Rule 3) — vitest does not read tsconfig paths; required for the @/lib import contract in the plan's key_links."
metrics:
  duration: "~14 min"
  completed: "2026-06-08"
  tasks: 3
  files: 15
---

# Phase 1 Plan 01: Foundations Scaffold + AFM-002 Formatter Summary

Greenfield Next.js 16 scaffold pinned to the lqwdclaw stack, Vitest installed (first runner in the workspace), and the AFM-002 single-source unit formatter sealed with 14 reference-value tests — the only sanctioned sat/BTC/msat conversion path (READ-03).

## What Was Built

- **Task 1 — Scaffold** (`d1eab6b`): Next.js 16.1.6 / React 19.2.3 app, `@/*`→`./src/*` alias, ESLint flat config + Prettier copied verbatim from lqwdclaw. Tailwind v4 CSS-first (no `tailwind.config.js`); brand token navy `#1A3C79` in `@theme`; `class="dark"` default. `.env.example` lists only DB URL env names; `.gitignore` excludes `.env.local`. `npm run build` exits 0; lint clean.
- **Task 2 — Vitest + cn()** (`f40e6b9`): `vitest.config.ts` (plain node/ESM, no Next.js/React plugin per RESEARCH §H); `test`/`test:format` npm scripts; `src/lib/utils.ts` `cn()` verbatim from lqwdclaw (skipped lqwdclaw-specific `hashIP`/`slugify`/etc.).
- **Task 3 — AFM-002 formatter (TDD)** (RED `e6f85ed` → GREEN `ef53904`): `src/lib/format/units.ts` with `feeMsatToSat` (msat/1_000), `formatBtc` (sats/1e8, dp=4), `formatSats` (en-US separators), all accepting `bigint | number`. `units.test.ts` asserts every documented lqwdLogs reference value (3,359,047,565 → 33.5905 BTC, etc.), `feeMsatToSat(1000)===1`, and the ±1% back-conversion rule. 14 tests pass.

## Verification Results

- `npm run build` → exit 0 (Next.js 16.1.6, Turbopack).
- `npx vitest run` → exit 0, 14/14 tests pass.
- `grep -rn "1e8|/ 100000000" src --include=*.ts | grep -v format/units` → empty (no ad-hoc sat→BTC outside the formatter; AFM-002 guard holds).
- No `tailwind.config.js`; `globals.css` contains `#1A3C79`, not `#F7931A`.
- `package.json` pins `"next": "16.1.6"`, `"react": "19.2.3"`; `tsconfig.json` maps `@/*`→`./src/*`.

## TDD Gate Compliance

- RED commit `e6f85ed` (`test(...)`, failing) precedes GREEN commit `ef53904` (`feat(...)`, passing). REFACTOR not needed — implementation is already the canonical RESEARCH §E form. Gate sequence satisfied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest could not resolve the `@/` path alias**
- **Found during:** Task 3 (GREEN phase)
- **Issue:** `units.test.ts` imports `@/lib/format/units` (the plan's `key_links` contract mandates the `@/` form), but Vitest does not read `tsconfig.json` `paths` by default — the import failed with "Cannot find package '@/lib/format/units'."
- **Fix:** Added a `resolve.alias` entry to `vitest.config.ts` mapping `@` → `./src` via `fileURLToPath`, mirroring the tsconfig alias.
- **Files modified:** `vitest.config.ts`
- **Commit:** `ef53904`

**2. [Rule 2 - Acceptance correctness] Added bare-literal `3359047565` assertion**
- **Found during:** Task 3 verification
- **Issue:** The plan artifact requires `units.test.ts` to `contain: "3359047565"` (bare digits); the test originally used only the underscore-separated form `3_359_047_565`, which would fail a substring check.
- **Fix:** Added an explicit `formatBtc(3359047565)` → `"33.5905"` assertion (also strengthens coverage of the raw-integer form).
- **Files modified:** `src/lib/format/units.test.ts`
- **Commit:** `ef53904`

### Other notes
- **`--reporter=basic` removed in Vitest 4:** the plan's Task 2 verify command used `npx vitest run --reporter=basic`, but the `basic` reporter no longer exists in Vitest 4.1.8. Used plain `npx vitest run` instead — functionally equivalent for the acceptance check (exit code). No file change needed.
- **Scaffold authored by hand** rather than via `create-next-app`: deliberate, to guarantee exact lqwdclaw version pins and avoid interactive prompts. Not a deviation from intent — the plan's `<action>` permits matching lqwdclaw verbatim.

## Authentication Gates

None — this plan is pure scaffold + pure functions, no network or credentials.

## Known Stubs

None. `src/app/page.tsx` is a minimal placeholder landing page (no data source needed in Phase 1); it is not a stubbed data path — fleet UI lands in Phases 2+.

## Notes for Downstream

- Import all sat/BTC/msat conversions from `@/lib/format/units` — the AFM-002 guard `grep` will catch any inline `/1e8` or `*1000`.
- The DB clients, schema, read helpers, health check, and `server-only` modules described in PATTERNS/RESEARCH are **not** in this plan — they are plans 01-02..01-04. This plan is the no-database foundation only.
- `vitest.config.ts` now carries the `@/` alias; downstream test files can import `@/lib/...` directly.

## Self-Check: PASSED

All 10 declared files exist on disk; all 4 task commits (`d1eab6b`, `f40e6b9`, `e6f85ed`, `ef53904`) present in git log.
