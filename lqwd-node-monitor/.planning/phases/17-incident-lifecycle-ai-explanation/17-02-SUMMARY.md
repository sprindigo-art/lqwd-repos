---
phase: 17-incident-lifecycle-ai-explanation
plan: 02
subsystem: overview/incident-tracking
tags: [incident-lifecycle, state-machine, pure-module, INC-02]
requires:
  - "GroupedIncident (src/lib/overview/incidents.ts)"
provides:
  - "reconcileTracking pure state machine (D-04..D-07)"
  - "TrackingRow / TrackingWrite / ReconcileResult exported types"
affects:
  - "Plan 05 loader (executes the returned writes)"
  - "overview queue + snoozed-critical banner"
tech-stack:
  added: []
  patterns:
    - "engine-order-is-law: partition only, no .sort"
    - "pure post-pass with injected now (deterministic tests)"
    - "writes-as-data: module returns writes, loader persists"
key-files:
  created:
    - src/lib/overview/incident-tracking.ts
    - src/lib/overview/incident-tracking.test.ts
  modified: []
decisions:
  - "Breakthrough (D-06) reconciled BEFORE the snooze filter so a broken-through critical is never dropped"
  - "clearedAt on a passed row is informational; D-07 write fires purely on live-set membership"
  - "isSnoozed uses snoozeUntil > now (strict); an elapsed snooze re-surfaces the incident"
metrics:
  duration: ~15m
  completed: 2026-07-20
  tasks: 1
  files: 2
---

# Phase 17 Plan 02: Incident Tracking State Machine Summary

`reconcileTracking(incidents, activeRows, now)` — the pure INC-02 state machine encoding snooze-drop + snoozed-critical banner collection (D-04), ack stable-partition lower-never-hide (D-05), escalation breakthrough (D-06), and resolution/recurrence writes (D-07), with the LOCKED ordering that runs breakthrough before the snooze filter.

## What Was Built

A single pure module `src/lib/overview/incident-tracking.ts` exporting:

- `reconcileTracking(incidents, activeRows, now) → { view, snoozedCriticals, writes }` — the highest-risk logic in the phase ("make or break INC-02"), isolated as a fixture-tested, DB-free state machine.
- Types `TrackingRow` (Plan 03 schema, snake→camel), `TrackingWrite` (discriminated `clear-mute` | `set-cleared`, each carrying the row `id`), and `ReconcileResult`.

The four decisions apply in the LOCKED sequence:

1. **D-06 breakthrough FIRST** — for each muted (acked OR snoozed) incident, breakthrough fires when live critical-child count exceeds `mutedCriticalChildren`, or worstSeverity rose to `critical` while `mutedAtSeverity` was below critical. Emits a `clear-mute` write; the incident holds its natural (top) position. Running this before the snooze filter is what prevents a broken-through critical from being silently dropped.
2. **D-04 snooze-drop** — a still-snoozed (`snoozeUntil > now`), non-broken-through incident drops from `view`; a snoozed `critical` is collected into `snoozedCriticals` for the always-visible banner.
3. **D-05 ack-partition** — acked incidents stay in `view` but stable-partition below all un-acked; both groups preserve engine order (no `.sort`, mirroring QueueIsland.tsx:93). A broken-through incident is treated as un-acked so it stays at top.
4. **D-07 resolution** — any active row whose `incidentKey` left the live top-level set emits a `set-cleared` write; recurrence starts a fresh row (loader concern).

Purity is enforced: no DB/`server-only` imports, inputs never mutated, `now` injected (no wall clock).

## Verification

- `npx vitest run src/lib/overview/incident-tracking.test.ts` — 10 tests pass, covering all four decisions plus purity and empty-input.
- `grep -n "\.sort(" src/lib/overview/incident-tracking.ts` — clean (no matches).
- `grep -nE "server-only|dbNodemon|drizzle" src/lib/overview/incident-tracking.ts` — clean (pure module).
- `npx tsc --noEmit` — no type errors in the new module.
- Behavior proof: a snoozed critical that gained a new critical child appears in `view` and NOT in `snoozedCriticals` (breakthrough beats snooze); an acked incident is present in `view` but ordered after all un-acked.

## TDD Gate Compliance

- RED: `test(17-02)` commit `ef6edd7` — fixtures failed (module absent) before implementation.
- GREEN: `feat(17-02)` commit `3f7363a` — implementation makes all 10 tests pass.
- REFACTOR: none needed; the first green implementation was already clean.

## Deviations from Plan

None — plan executed exactly as written. The referenced `17-PATTERNS.md` (ordering rules 1-4) was not present in this worktree (untracked on another branch); the equivalent ordering rules were taken directly from the plan's `<behavior>` block and `17-CONTEXT.md` (D-04..D-07), which are authoritative.

## Threat Surface

Mitigations from the plan threat register are satisfied:

- **T-17-04** (info hiding) — breakthrough reconciled before the snooze filter; snoozed criticals collected for the non-dismissible banner; pinned by ordering tests.
- **T-17-05** (tampering) — pure module, no DB writes; writes returned as data for the guarded loader (Plan 05).
- **T-17-SC** — zero new packages; no install task.

No new security-relevant surface introduced beyond the plan's threat model.

## Self-Check: PASSED

- FOUND: src/lib/overview/incident-tracking.ts
- FOUND: src/lib/overview/incident-tracking.test.ts
- FOUND commit ef6edd7 (RED test)
- FOUND commit 3f7363a (GREEN impl)
