# Deferred Items — 260721-eos (Gap B)

Out-of-scope discoveries logged during execution (NOT fixed — SCOPE BOUNDARY).

## Pre-existing test failure: NavRailShell.test.tsx (4 failures)

- **File:** `src/components/df/NavRailShell.test.tsx`
- **Status:** Fails on the base commit `b680f345` — untouched by this task (empty diff vs base for both `NavRailShell.tsx` and its test).
- **Symptom:** `it("accepts a custom leading label and can hide the toggle")` expects markup to contain `"View"` (via `viewLabel` prop) but the rendered shell does not surface it; 4 assertions in the suite fail.
- **Why deferred:** Unrelated to Gap B service-health explainability. No file this task modifies feeds NavRailShell. Fixing it is outside the plan's scope.
</content>
</invoke>
