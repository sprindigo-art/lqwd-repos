# Deferred Items — Phase 14

Out-of-scope discoveries logged during execution (not fixed per scope boundary).

## Pre-existing lint errors (present on base commit 74a8b8d, unrelated to Phase 14 work)

Found during 14-01 Task 2 verification (`npm run lint` → 4 errors, 15 warnings, all pre-existing):

1. `.planning/phases/10-design-system-foundation/.prototype-snapshot/support.js:184` — `react/no-deprecated` (ReactDOM.render)
2. `.planning/phases/10-design-system-foundation/.prototype-snapshot/support.js:1023` — `@next/next/no-assign-module-variable`
3. `src/components/df/NavRailShell.test.tsx:25` — `react/no-children-prop`
4. `src/components/node/ServiceHealthGrid.tsx:118` — impure function call during render

All 14-01 touched files (`ThresholdMeter.tsx`, `ThresholdMeter.test.tsx`, gallery `page.tsx`, `fixtures.ts`) lint clean when linted directly.
