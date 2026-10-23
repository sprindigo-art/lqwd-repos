# Phase 7: Inbox Triage Rebuild - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 7-inbox-triage-rebuild
**Areas discussed:** Triage partition rule, Bulk-enqueue model, Filter & drawer state, Drawer action depth

---

## Triage partition rule

### Q1 — Severity vs signal-type when they disagree for fee cards

| Option | Description | Selected |
|--------|-------------|----------|
| Severity wins | Any critical OR warn card is an individual row above the fold (even a warn fee card); only info folds into groups | ✓ |
| Signal-type wins for fee | All fee cards fold regardless of severity; only non-fee crit/warn get rows | |
| Severity wins, but warn-fee gets a callout | Info fee folds; warn/crit fee surfaces as a row AND the group shows a "N need attention" marker | |

**User's choice:** Severity wins.
**Notes:** Clean "no emergency ever hides" rule; resolves INBOX-01's "routine/info (fee)" conflation in favor of severity as the partition driver.

### Q2 — Info-bulk nesting + placement of non-fee info and suppressed cards

| Option | Description | Selected |
|--------|-------------|----------|
| Signal→node, suppressed pinned | Two-level signal→node nesting (all collapsed); non-fee info gets its own signal groups; suppressed pinned to an always-visible "SUPPRESSED — reason" block | ✓ |
| Signal→node, suppressed inline | Same nesting, but suppressed cards fold into their group like any other | |
| Node-first grouping | Per-node first then per-signal (rejected sketch variant C) | |

**User's choice:** Signal→node, suppressed pinned.

### Q3 — Render all ~89 crit/warn as rows, or cap with a tail fold

| Option | Description | Selected |
|--------|-------------|----------|
| Render all crit/warn | Every crit/warn is a row, no cap; facet rail narrows | |
| Cap critical-visible, warn folds tail | All critical shown; warn caps at N then "N more" fold | |
| You decide at build | Planner picks cap (or none) from live distribution | ✓ |

**User's choice:** You decide at build.
**Notes:** Constraint carried into CONTEXT — a critical is never folded.

---

## Bulk-enqueue model

### Q1 — Bulk-enqueue affordances

| Option | Description | Selected |
|--------|-------------|----------|
| Both: ENQUEUE ALL + multi-select | Per-node "ENQUEUE ALL ▸" AND cross-node multi-select checkboxes → batch | ✓ |
| Per-node ENQUEUE ALL only | Only the hero affordance, no checkboxes | |
| Multi-select only | Checkboxes everywhere + sticky "ENQUEUE N selected" bar | |

**User's choice:** Both: ENQUEUE ALL + multi-select.

### Q2 — Confirmation before firing N enqueues

| Option | Description | Selected |
|--------|-------------|----------|
| Aggregate summary confirm | One dialog: N intents → M nodes, ppm range, engine values, +24h; no per-card edit in bulk | ✓ |
| Fire immediately, undo on /queue | No dialog; approval gate is the safety net | |
| Per-card preview list | Scrollable list of all N previews before one confirm | |

**User's choice:** Aggregate summary confirm.

### Q3 — Partial-failure behavior/reporting

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort + per-result report | Each enqueues independently; tally "N queued, K skipped" with each reason verbatim; no rollback | ✓ |
| All-or-nothing transaction | Any failure rolls back all N | |
| Pre-flight filter then best-effort | Drop ineligible up front, then best-effort enqueue the rest | |

**User's choice:** Best-effort + per-result report.

### Q4 — Honoring per-node rate-limit guidance

| Option | Description | Selected |
|--------|-------------|----------|
| Surface as warning, don't block | Show guidance in the confirm but enqueue all; node-side is the real throttle | ✓ |
| Cap selection at the guidance | Refuse to queue more than guidance allows per node/window | |
| You decide | Planner chooses prominence within "never silently drop" | |

**User's choice:** Surface as warning, don't block.

---

## Filter & drawer state

### Q1 — Facet-rail filter-state location

| Option | Description | Selected |
|--------|-------------|----------|
| URL search params | Server re-renders narrowed spine; shareable/back-button; no 531-card client payload | |
| Ephemeral client state | Ship all cards once; filter in-browser with useState | |
| You decide | Planner picks from measured payload vs round-trip cost | ✓ |

**User's choice:** You decide.
**Notes:** CONTEXT records URL-params as the recommendation on file, but the decision is left open for the planner; must reconcile with the URL-synced drawer.

### Q2 — Drawer wiring + fate of @modal/inbox

| Option | Description | Selected |
|--------|-------------|----------|
| Client Sheet, URL-synced | shadcn Sheet toggled client-side, selected card id in URL (?card=ID); deep-linkable, back-button, reload-safe | ✓ |
| Pure client Sheet | Sheet by client state only, no URL sync | |
| You decide | Planner picks mechanism + @modal fate | |

**User's choice:** Client Sheet, URL-synced.
**Notes:** During scout, `@modal/inbox/page.tsx` was confirmed to be a no-op `null` interceptor guard (not a modal inbox) — the URL-synced drawer doesn't conflict with it.

---

## Drawer action depth

### Q1 — Full inline action vs compact handoff

| Option | Description | Selected |
|--------|-------------|----------|
| Full action inline (reuse leaves) | Drawer embeds EnqueuePreview / CommandExport / runbook per card type; act without leaving /inbox | ✓ |
| Compact affordance + handoff | Evidence + a button that routes to /queue or console | |
| Full inline, but enqueue only | EnqueuePreview inline for fee; handoff button for export/runbook | |

**User's choice:** Full action inline (reuse leaves).

### Q2 — Drawer 14-day trend sparkline data source

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing trend reader | Wire to Phase-3 src/lib/console/trends.ts + Sparkline; honest "no trend data" where a metric has no series | ✓ |
| Honest placeholder for now | Point-in-time evidence + "trend coming soon" placeholder | |
| You decide | Planner wires where it maps, falls back elsewhere | |

**User's choice:** Reuse existing trend reader.

---

## Claude's Discretion

- Row cap (or none) for the crit/warn spine, from the live card-count distribution (never fold a critical).
- Facet-rail filter-state location (URL params vs ephemeral client) and where facet counts are computed; reconcile with the URL-synced drawer.
- Server/client component split for the spine + rail + drawer shell; collapse/multi-select interaction state; aggregate-confirm dialog layout; per-result tally rendering.
- Whether to extend `enqueueCommand` with a batch server action or loop the single action server-side (honoring sign-once-per-row, server-only signing, per-row independent failure).
- Per-metric mapping of which evidence series feeds the sparkline.

## Deferred Ideas

- Bulk actions for non-fee cards (e.g. multi-select export of stuck-pending runbooks) — bulk scoped to `update_fee` this phase.
- Saved / named facet filter presets.
- Per-card param editing within a bulk batch (rejected for v1; single-card EnqueuePreview covers nudging one value).
