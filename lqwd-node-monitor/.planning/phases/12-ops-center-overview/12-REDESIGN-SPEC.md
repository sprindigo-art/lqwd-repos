---
status: approved
phase: 12-ops-center-overview
approved_by: operator
approved_on: 2026-07-01
source: operator live-verify of 12-11/12-12 → sketch review
sketch: .planning/design-explorations/ops-center-overview-redesign-v1.html (v1.1, APPROVED)
supersedes: 12-13-PLAN.md, 12-14-PLAN.md
intent: >
  Redesign the Ops Center Overview after the operator rejected the piecemeal card/layout
  state. Keep the Phase-12 data engine (severity-map, incidents, fee-grouping, 30-day
  cutoff, cache, client-filter mechanism); rebuild the information architecture, the card
  model, and fix two real taxonomy/grouping BUGS surfaced during live verification.
---

# Phase 12 — Ops Center Overview Redesign Spec

The approved visual reference is the interactive sketch
`.planning/design-explorations/ops-center-overview-redesign-v1.html` (v1.1). This spec is
the written source of truth; where the sketch and this doc agree, both are LOCKED.

## Bugs this redesign MUST fix (found in live verify)

1. **Duplicate / orphaned services.** `incidents.ts::place()` pushes children with NO dedup,
   and `service_inventory` carries the same service multiple times (host-level row +
   per-node rows) → "Address List Sync" repeats. Any service whose `hostId` is
   null/undefined floats as a **context-free top-level incident** (`incidents.ts:194-201`).
2. **Layer filter broken / "nodes confused with hosts."** `applyFilter` matches only the
   TOP-LEVEL incident's `layer`. Grouped cards carry `layer:"hosts"`, so filtering by
   `nodes`/`services` hides everything nested → "nothing appears." Severity filter works
   because it is checked differently.

## LOCKED decisions

### D-R1 — Information architecture (order)
Top → bottom: **(1) Fleet Vitals** (hero, first thing) → **(2) AI "what needs you now"**
advisory band → **(3) Needs-attention queue** (with layer+severity filters) → **(4) Healthy
fleet collapse** → footer. Vitals-first was explicitly chosen by the operator.

### D-R2 — One card per owner
Every attention card is exactly ONE owner: a **node** or a **host**. All of that owner's
alerts — node issues, adjacent services, host metrics, storage, and fee summaries — **nest
inside** its card. A service NEVER renders as a standalone top-level row.

### D-R3 — Taxonomy / grouping fix (data layer)
- **Dedup services** by `(ownerKey, serviceName)` where ownerKey = hostId (or the node's
  host). Collapse the host-level + per-node duplicates of the same service into ONE child;
  keep the worst severity + most specific reason. No repeated labels.
- **Attach every service to an owner.** hostId → that host; else nodePubkey → that node's
  host; else the service is **bucketed under a clearly-labeled "Unattributed" group, never a
  bare top-level row** (operator: orphan rows are "useless"). Prefer bucketing over dropping
  so nothing is silently lost, but it must read as a labeled group, not a floating alert.
- **Layer classification:** a card's owner layer is `host` or `node`; each child carries its
  own category (`node | service | host | storage | chain | fee`). Keep the underlying layer
  data on children so the filter can read it.

### D-R4 — Tree-aware filter
`applyFilter` matches a card when **any alert in its tree** (the owner OR any descendant)
matches the selected layer/severity set (empty set = all). When a **layer** filter is
active, narrow the visible children of surviving cards to matching categories and
auto-expand, so the filter visibly changes the card. Fixes both filter bugs.

### D-R5 — Iconography
**Category icons** (lucide) label WHAT each alert is: `node`, `service`, `host`, `storage`,
`chain`, `fee-raise (↑)`, `fee-lower (↓)`. **Severity stays state-only** — tinted chips +
severity edge bar + severity-colored status text. Per the locked NOC brief, do NOT use icons
for severity. (Child-row right-side status: severity-colored text; keep any severity dot
minimal — confirm with operator during build.)

### D-R6 — Condensed cards & rows
Cards **collapsed to a one-liner by default** (edge · name · backend badge · grade chip ·
one-line why · freshness/stale). Expand to see children. Child row = category icon + single
label + right-pinned severity-colored status; **suppress the redundant note when it equals
the label** (kills the `addressBalances · services · addressBalances` echo). **Critical
children always shown; non-critical capped at top 5 + "show N more".** Fee children render as
≤2 per-owner summary lines (raise/lower) with count N, routing to `/{pubkey}/fees`, never
critical (already enforced in 12-09).

### D-R7 — Functional chrome
- **Left rail** = app sections (Ops Center / Nodes / Hosts / Security).
- **Top bar** carries **operator nav** (Ops Center · Inbox · Pending · Queue, with open
  counts) + an **honest ticking data-age** ("data as of HH:MM:SS · Ns ago"). Remove the fake
  "Live" claim/green dot and the non-functional "Preview" view toggle (absorbs old #5/#6).
  This closes the overview nav dead-end (old #2 follow-up) and makes the top bar do real work.

### D-R8 — Interactivity
Cards expand/collapse; child rows are click-through to the owner's node/host detail or the
relevant tab; fee lines route to `/{pubkey}/fees`.

### D-R9 — Reuse the engine, keep it safe
Reuse severity-map, incidents assembly, fee-grouping, the 30-day cutoff, the assembly cache,
and the client-filter mechanism from 12-01…12-12. This is presentation + taxonomy, not a
re-derivation of data. All safety invariants hold: advisory-only (no executed params from the
band), honest-stale, no credential/DB-name leaks, LQWD navy structure / severity-for-state,
light NOC theme, `@/` imports, zero new package installs.

## Proposed plan breakdown (supersedes 12-13, 12-14)

- **12-13 (rewrite) — Taxonomy & tree-aware filter (data, TDD, autonomous):** dedup + owner
  attach + unattributed bucket in `incidents.ts`/`ownership.ts`; child-layer retention;
  rewrite `applyFilter` (`filter.ts`) to match the tree + narrow children. Pure logic + tests.
- **12-14 (rewrite) — Card & row rebuild (UI, non-autonomous):** category-icon map;
  condensed collapsed cards + one-line child rows; tree-filter child narrowing/auto-expand;
  click-through. `SeverityCard`/`SeverityRow`/`QueueIsland` (+ df primitives).
- **12-15 (new) — Layout + chrome (UI, non-autonomous):** vitals-first section order in
  `page.tsx`; `NavRailShell` top-bar operator nav (Inbox/Pending/Queue) + honest ticking
  PollAge; remove fake Live + Preview toggle.

Waves: 12-13 (W1, data) → 12-14 (W2, needs the new tree shape) → 12-15 (W2/W3, layout can
proceed in parallel with 12-14 since it touches page.tsx/NavRailShell, not the card
primitives — confirm no file overlap at plan time).
