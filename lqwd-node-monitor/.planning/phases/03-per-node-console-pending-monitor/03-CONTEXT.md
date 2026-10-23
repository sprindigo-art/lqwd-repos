# Phase 3: Per-Node Console + Pending Monitor - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

The read-detail layer the fleet overview points at: drill into one node's full operational picture (channels, fee report, liquidity balance, forwards, closes, peers — LND and LDK through the same components), export any per-node table to CSV for accounting/audit, and see every pending channel per node and fleet-wide with state, age, limbo balance, and broadcast_attempts. Requirements: NODE-01, NODE-02, PENDING-01. Plus the folded Phase-2 UI-polish debt (whole console shell).

**Explicitly NOT this phase:** the stuck-pending *detector* (PENDING-02 — Phase 4), recommendation cards (Phase 4), any write path (Phases 5-7).

</domain>

<decisions>
## Implementation Decisions

### Console layout & navigation
- **D-01:** **Tabbed console at /{pubkey}.** The existing scorecard page becomes the landing tab of a tabbed console: Scorecard | Channels | Fees | Liquidity | Forwards | Closes | Peers (+ Pending, see D-09). The quick-look scorecard modal from the fleet list stays as-is, gaining an "open full console" link.
- **D-02:** **Scorecard tiles deep-link to the relevant console tab** (Liquidity tile → Liquidity tab, force-close tile → Closes, etc.). The scorecard is the index into the evidence: fleet → scorecard → detail tab is the triage flow.
- **D-03:** **Tabs are URL-addressable** (stable URL per tab — route segment or query param at planner's discretion). Bookmarkable/sharable, and Phase 4 insight cards will deep-link straight to evidence views.
- **D-04:** **UI-polish pass covers the whole console shell** — fleet overview, scorecard, and the new tabs in one consistent design pass (the folded Phase-2 polish todo). Not just the new views.

### Table windows & volume
- **D-05:** **Event-table tabs (Forwards, Closes) default to a 7-day window** — matches the scorecard's revenue/routing windows so console evidence lines up with the grades — and the window is operator-adjustable per view.
- **D-06:** **Window picker = fixed presets: 24h / 7d / 30d / 90d.** No custom range, no all-time — every query stays bounded and predictable (371k-row tables exist; no runaway pulls).
- **D-07:** **Capped + summary rendering** (chosen via mockup comparison): each event table shows the newest ~500 rows beneath an **aggregate summary strip** (count, totals through AFM-002, average, busiest channel — per table type), with a visible banner "showing newest 500 of N — Export CSV for the full window". No pagination, no infinite scroll.

### CSV export (NODE-02)
- **D-08:** **CSV contains both formatted and raw columns** — human-readable values (sats/dates via AFM-002) alongside the raw source columns (fee_msat, epoch ns) for lossless audit verification.
- **D-09:** **Export scope = the full selected window**, not the visible 500-row cap (the cap banner's escape hatch). Bounded by the 90d preset max.
- **D-10:** **Provenance header block + stamped filename.** Comment rows at the top (# node alias+pubkey, table, window, exported-at UTC, data-as-of freshness) and filenames like `{alias}_{table}_{window}_{timestamp}.csv`. Every sat accounted for, every export traceable.

### Pending monitor (PENDING-01)
- **D-11:** **Two surfaces: fleet-wide /pending page + a Pending tab in each node console.** The fleet page shows all pending opens/coop-closes/force-closes across the fleet grouped by node; the console tab shows that node's only.
- **D-12:** **Fleet overview entry = a PENDING count block in the existing triage stat strip** (alongside CRITICAL/WARN/HEALTHY/STALE) linking to /pending. Zero-count stays quiet; non-zero is visible exactly where the operator triages.
- **D-13:** **Grouped-by-type, age-sorted presentation:** sections for Opens / Coop closes / Force closes (sweeps nested under their force-close), oldest first within each, every row showing state, age, limbo/time-locked balance, and broadcast_attempts. Age-prominent layout pre-stages Phase 4's stuck-detector without judging. Display-only this phase.

### UI design direction (operator directive — REVISES Phase 2 D-05)
- **D-14:** **Signal density must come down.** The operator's verdict on the Phase 2 tiles: "letter grade + color + percentage all in one line is overkill." The polish pass (D-04) must simplify to **intuitive, clean, easy to read, aligned items — not over-explained, no redundant encodings** of the same signal. Exact simplification (e.g. color + grade as the primary signal, percentage demoted or dropped, raw value kept as evidence) is design discretion, but the one-line triple+raw encoding must not survive as-is.
- **D-15:** **UI work MUST be driven through the design skills.** The `frontend-design` skill (installed at `.claude/skills/frontend-design/SKILL.md`) is mandatory reading for any agent writing UI in this phase, and the phase should run `/gsd-ui-phase 3` to produce a UI-SPEC design contract before planning the UI plans. Do not design tiles/tables ad-hoc.

### Claude's Discretion
- Tab routing mechanism (route segments vs query param) and tab-state preservation details — honor D-03's stable-URL requirement.
- Summary-strip contents per table type (which aggregates matter for channels vs forwards vs closes vs fees) and exact row cap (~500).
- CSV generation mechanics (server endpoint vs client blob), column ordering, and which tabs beyond channels/forwards/closes/fees get an export button.
- Empty states (no pending channels, quiet nodes), loading states, and how the freshness stamp (Phase 2 D-13 pattern) attaches per tab.
- Whether the per-node Pending tab and the fleet /pending page share one component parameterized by scope (preferred if clean).

### Folded Todos
- **ui-polish-fleet-console.md** (from Phase 2's 02-07 checkpoint): operator approved the Phase 2 UI "with notes" — "still needs a lot of improvement." Folded into this phase as the whole-shell polish pass (D-04), now sharpened by the density directive (D-14) and the skill mandate (D-15). The todo file's constraints (display contract D-07/D-09/D-11/D-13 from Phase 2, navy = brand-only, honest no-data states) still bind.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design / UI
- `.claude/skills/frontend-design/SKILL.md` — mandatory design guidance for ALL Phase 3 UI work (D-15)
- `.planning/todos/pending/ui-polish-fleet-console.md` — the folded polish todo: scope, route, and constraints to preserve
- `.planning/phases/02-fleet-overview-health-scorecard/02-UI-SPEC.md` — Phase 2 design contract (display contract D-07/D-09/D-11/D-13 still binds; tile density is being REVISED per D-14)

### Prior decisions that bind this phase
- `.planning/phases/02-fleet-overview-health-scorecard/02-CONTEXT.md` — backend map (D-03/D-04), tunable-config principle (D-02), freshness stamp pattern (D-13), critical-vs-warn severity philosophy (D-07/D-08)
- `.planning/phases/01-foundations-read-layer/01-CONTEXT.md` — read-only role enforcement, reference-node validation set (Canada anchor), AFM-001/AFM-002 guardrails

### Data layer
- `src/lib/db/schema/routing.ts` — typed warehouse tables; note the comment markers: `lnd_node_pending_channels` and `lnd_node_pending_sweeps` are EVENT-DRIVEN (identity: local_pubkey, DISTINCT ON when read) and are NOT yet typed — this phase must type them following the 02-01 live-introspection pattern
- `src/lib/read/node-info.ts` + `src/lib/read/latest.ts` — the only sanctioned latest-state readers (AFM-001)
- `src/lib/read/db-timestamp.ts` — `parseDbTimestampUtc` MUST wrap every raw-execute timestamp coercion (WR-01 lesson: offset-less warehouse strings are UTC)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `UnifiedNode`/`Backend` model (`src/lib/read/nodes.ts`) — LND+LDK through one shape; console tabs render both backends identically
- `loadFleetView()` + dimension queries (`src/lib/scorecard/`) — per-pubkey windowed aggregates already exist for forwards/closes/liquidity/channel-health/peers; console tabs are the row-level drill-down of the same sources
- Console UI kit: `ScorecardPanel`/`ScorecardModal`, `GradeBadge`, `FreshnessStamp`, `BackendBadge`, `CriticalChip`, ui primitives (card/table/badge/tooltip/dialog), console theme tokens in `globals.css`
- Intercepting-route modal pattern at `src/app/(overview)/@modal/(.)[pubkey]/` — the tab routing must coexist with this
- AFM-002 unit formatter, freshness math (`src/lib/scorecard/freshness.ts`)

### Established Patterns
- Dimension-module shape: exported SQL builder (no-DB shape tests via PgDialect) + lazy-import executor — new pending/console queries should follow it
- Schema extension via live `information_schema` introspection, SELECT-only (02-01 pattern) — required for the two untyped pending tables
- Worktree-parallel plan execution with files_modified isolation

### Integration Points
- `/[pubkey]` page + `@modal` slot in `src/app/(overview)/` — becomes the tabbed console host
- Fleet overview stat strip in `src/app/(overview)/page.tsx` — gains the PENDING count block (D-12)
- `SCORECARD_CONFIG` tunables (`src/lib/scorecard/config.ts`) — window presets/staleness knobs belong in the same central-config philosophy

</code_context>

<specifics>
## Specific Ideas

- Operator verdict on current tiles (verbatim): "Aligned items not over explained no need to be redundant with letter grade color percentage all in one line its overkill." — this is the bar for the D-14 simplification.
- The capped+summary table mock the operator chose: aggregate strip on top (Σ count · Σ amount · Σ fees · avg · busiest), newest-500 rows below, cap banner with CSV escape hatch.
- Console evidence should line up with scorecard windows (7d default) so a grade and its drill-down tell the same story.

</specifics>

<deferred>
## Deferred Ideas

- Stuck-pending detector with severity + evidence (force-close past maturity, stuck sweep, stuck open) — **PENDING-02, Phase 4** (the age-sorted display in D-13 pre-stages it)
- Insight-card deep links into console tabs — Phase 4 consumes D-03's stable URLs
- Custom date-range export for arbitrary audit periods — revisit if the 24h/7d/30d/90d presets prove insufficient

</deferred>

---

*Phase: 3-Per-Node Console + Pending Monitor*
*Context gathered: 2026-06-10*
