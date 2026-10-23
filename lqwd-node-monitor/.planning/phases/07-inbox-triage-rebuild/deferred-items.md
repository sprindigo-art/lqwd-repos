# Phase 07 — Deferred Items (out-of-scope discoveries)

| Discovered During | Item | Evidence | Disposition |
|-------------------|------|----------|-------------|
| 07-01 full-suite run | `src/lib/queue/stub-executor.test.ts:115` intermittently fails with a `randomUUID()` mismatch (`expect(result).toEqual({ id })`) under the parallel `npm test` run. Passes in isolation; passed on a clean re-run of the full suite (662/682). Pre-existing flake in the Phase-6 queue subsystem; references no 07-01 file. | `npx vitest run src/lib/queue/stub-executor.test.ts` → 3/3 green; second `npm test` → 662 passed, 0 failed | OUT OF SCOPE — not caused by 07-01 (pure insight modules + vendored Sheet). Surface to the queue-subsystem owner; do not fix in a presentation-foundation plan. |
