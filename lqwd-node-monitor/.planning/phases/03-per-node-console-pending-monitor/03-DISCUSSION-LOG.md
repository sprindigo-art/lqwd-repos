# Phase 3: Per-Node Console + Pending Monitor - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 3-Per-Node Console + Pending Monitor
**Areas discussed:** Console layout & navigation, Table windows & volume, CSV export shape, Pending monitor placement

---

## Pre-discussion: UI-polish todo

| Option | Description | Selected |
|--------|-------------|----------|
| Fold into Phase 3 | One consistent design pass over shared console shell while building new views | ✓ |
| Keep separate | Standalone todo for a later /gsd-ui-review pass | |

**User's choice:** Fold into Phase 3

---

## Console layout & navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Tabbed console | /{pubkey} becomes Scorecard \| Channels \| Fees \| Liquidity \| Forwards \| Closes \| Peers; modal stays | ✓ |
| One deep page | All sections stacked on one scrollable page | |
| Separate detail route | New /{pubkey}/console route, scorecard untouched | |

**User's choice:** Tabbed console
**Follow-ups:** Tiles deep-link to tabs (✓ yes); tabs URL-addressable (✓ yes); polish scope = whole console shell (vs new-views-only or polish+design-tokens).

---

## Table windows & volume

| Option | Description | Selected |
|--------|-------------|----------|
| 7 days | Matches scorecard revenue/routing windows | ✓ (with "should be adjustable" note) |
| 24 hours | Sharpest triage, disconnected from 7d grades | |
| 30 days | More history, heavier first query | |

**User's choice:** 7 days default, adjustable
**Follow-ups:** Picker presets = 24h/7d/30d/90d (vs +custom-range or +all-time). Rendering decided via ASCII mockup comparison: **Capped + summary** (newest 500 + aggregate strip) over paginated table and infinite scroll. User explicitly asked for mockups before deciding.

---

## CSV export shape

| Option | Description | Selected |
|--------|-------------|----------|
| Both: formatted + raw cols | Human columns + raw source columns side by side | ✓ |
| Display-formatted only | Exactly what the table shows | |
| Raw warehouse columns | Verbatim msat/epoch ns | |

**User's choice:** Both
**Follow-ups:** Scope = full selected window (vs visible rows only); provenance = comment header block + stamped filename (vs filename-only or plain file).

---

## Pending monitor placement

| Option | Description | Selected |
|--------|-------------|----------|
| Fleet page + console tab | /pending fleet-wide page plus per-node Pending tab | ✓ |
| Fleet-wide page only | Single surface with node filter | |
| Console tab only | Per-node only, fleet view deferred | |

**User's choice:** Fleet page + console tab
**Follow-ups:** Overview entry = PENDING count in the triage stat strip (vs nav-link-only or per-row badges); presentation = grouped by type, age-sorted (vs flat sortable table or per-node cards).

---

## Closing directive (free-text)

At wrap-up the user directed (verbatim): "I want you to consult with ui based skills to improve the ui design and implementation further from what we have discussed. I want intuitive and clean and easy to read. Aligned items not over explained no need to be redundant with letter grade color percentage all in one line its overkill."

Captured as D-14 (signal-density reduction — revises Phase 2 D-05) and D-15 (frontend-design skill mandatory; run /gsd-ui-phase 3 before UI planning).

## Claude's Discretion

- Tab routing mechanism (segments vs query param), tab-state details
- Summary-strip aggregates per table type; exact row cap
- CSV generation mechanics, column order, which tabs get export
- Empty/loading states; per-tab freshness stamp attachment
- Shared component for per-node Pending tab vs fleet /pending page

## Deferred Ideas

- Stuck-pending detector (PENDING-02) — Phase 4
- Insight-card deep links into console tabs — Phase 4
- Custom date-range export — revisit if presets prove insufficient
