# Phase 13: Nodes + Service Health - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

The Lightning depth of the v2 redesign. Delivers four surfaces against the LOCKED
Phase-10 Data-Forward design system (no new tokens/primitives):

- **NODE-03** — rebuilt Nodes list (at-risk rows pop, type/status/stale filters, sortable
  columns, liquidity/forwarding evidence, row→detail nav).
- **NODE-04** — rebuilt Node Detail (identity, Lightning performance, active diagnostics with
  evidence charts, adaptive action, visible read-only safety posture).
- **SVC-01** — the CENTERPIECE per-node two-axis service-health grid (6 LQWD services + infra
  deps), green only when RUNNING **and** FUNCTIONING; "up but dead" unmistakable.
- **SVC-02** — Service Detail (two-axis health, heartbeat/last-run/error-count, log tail, restart
  history, dependents, unified verify-first runbook; infra + custom-service variants).

Plus **one deliberate human-gated write path** folded in from two `resolves_phase: 13` todos:
a per-channel fee-queue on Node Detail (no AI required) driven by a one-click `enqueue+approve`
gesture. This is a QUEUE-01/03 write to the `nodemon` queue DB — **not** a node mutation, **not**
an AI action. Safety boundary unchanged: zero node credentials in the dashboard; HMAC signed
server-side; the node re-verifies + re-bounds + atomic-claims; the AI never emits a command.

**Not in scope:** Hosts/infra screens (Phase 14), incident lifecycle + AI explanation (Phase 15),
node-side/tooling hardening (cron PATH, inbound-fee) — see Deferred.
</domain>

<decisions>
## Implementation Decisions

The 13-UI-SPEC (approved) already resolved the visual/interaction contract. This discussion
settled its 7 flagged Open Assumptions. Decisions below OVERRIDE the "assumption" hedges in that
spec.

### Withdraw affordance (Assumption #6) — RESOLVED: ship in Phase 13
- **D-01:** Add an operator **Withdraw** for an `approved`-but-unclaimed fee intent. New terminal
  transition **`approved → withdrawn`** in `src/lib/queue/state.ts` (`LEGAL`) +
  `src/lib/queue/transitions.ts`, following the exact guarded pattern of `approve`/`reject`:
  `UPDATE commands SET state='withdrawn' WHERE id=? AND state='approved' RETURNING id` (0 rows ⇒
  throw the lost-race error) + a `command_audit` row (actor `operator`, audit-preserving:
  `∅ → pending_approval → approved → withdrawn`).
- **D-02:** The `WHERE state='approved'` predicate **is** the claim-race safety — if the node
  already claimed the row (`approved → claimed`) the update matches zero rows and Withdraw fails
  cleanly ("too late, already claimed"). No separate contingency needed; it cannot race an
  in-flight execution.
- **D-03:** Purpose/placement: Withdraw is the **undo** for the minutes-long window between the
  operator's approve and the node's next ~5-min claim tick (today only a 24h TTL or a manual DB
  write can clear an approved-unclaimed row). It is the safety counterweight to the one-click
  gesture (which removes the old two-step reconsider beat). Surfaces as a **Withdraw affordance on
  the pending-approved channel row** (Screen B8, `enqueued+approved` state).

### Stale fee baseline guard (Assumption #5) — RESOLVED: warn + explicit confirm
- **D-04:** Per-channel fee-queue is **IN SCOPE** (confirmed). Baseline freshness source is the
  existing **AFM-001 `src/lib/read/latest.ts`** DISTINCT ON (chan_id) latest-per-channel read; the
  row's own timestamp derives honest staleness. No new read needed for the baseline.
- **D-05:** When a channel's latest fee row is stale: **warn + explicit confirm** (NOT hard-block).
  Show the stale treatment + "baseline may be stale (<t> old)" warning; the operator must
  explicitly acknowledge before CONFIRM enables. Record the acknowledgement as **`staleAck=true`**
  in the audit — the field **already exists** on `approve()` / `command_audit`
  (`staleAcknowledged`); reuse it, do not add a new one. Rationale: keeps the feature usable when
  the warehouse legitimately lags, while forcing a knowing decision (the 08-04 canary lesson).
  Never render a stale fee value as current.

### "Paused-by-design" service state (Assumption #4) — RESOLVED: honest fallback, no synthetic state
- **D-06:** The read model (`ServiceHealthState` in `src/lib/read/service-health.ts`) has **no
  field that expresses "intentionally paused"** — it carries `running`, `functioning`, `stale`,
  `collectorStale`, `noData` only (`service_inventory.is_expected` = "should run at all", not
  "temporarily paused on purpose"). Therefore Phase 13 renders **every service by its true
  two-axis state** from the collector. No synthetic "paused = watch" softener. If a paused service
  self-reports `functioning=true`, it reads healthy/watch naturally; if it reports
  not-functioning, it reads red. **NodeMonitor does not invent health the telemetry can't back**
  (D-08 honesty invariant). This supersedes the UI-SPEC's "represent as watch" hedge for
  paused-by-design specifically.
- **D-07:** [informational — DEFERRED, out of Phase 13 scope; see Deferred Ideas] A real "paused-by-design / intentional-degraded" signal (collector + `service_inventory`
  schema change so the grid could show watch + a note) is **DEFERRED** to a future telemetry-layer
  change — out of Phase 13's UI scope. (See Deferred.)

### Routes & structure (Assumptions #1, #2, #3) — RESOLVED
- **D-08:** **Node Detail = single-scroll page at `/(overview)/[pubkey]`**, prototype-locked
  top-to-bottom order (header → VM vitals → service grid → Lightning → channels → active signals →
  safety posture). **Replace** the current v1 redirect at `[pubkey]/page.tsx`; **retire/redirect**
  the v1 `[pubkey]/[tab]/` sub-routes (keep the CSV `export/route.ts` read path reachable). No
  tabbed node detail.
- **D-09:** Routes (accepted spec defaults): Nodes list at **`/(overview)/nodes`**; Service Detail
  at **`/(overview)/[pubkey]/service/[service]`** rendering ONE component tree with infra
  (`bitcoind`) + custom-service (`addressBalances`) variants.
- **D-10:** Nodes-list columns + Service Detail section order = **spec defaults** (Claude's
  discretion, see below).

### `enqueueAndApprove` server action (Assumption #7) — RESOLVED: Option A (confirmed)
- **D-11:** Add the ONE new server action **`enqueueAndApprove`** in `src/app/actions/queue.ts`
  (the only new code surface beyond the withdraw transition — no new UI primitive). It re-validates
  params with `updateFeeBoundsSchema`, **signs once** via `src/lib/queue/enqueue.ts`, and lands the
  row directly at **`approved`** (actor `operator`), preserving the full audit trail
  `∅ → pending_approval → approved`. The client sends **params only, never an HMAC**. Explicitly
  NOT auto-approve-on-enqueue and NOT queue-bypass — it collapses two operator clicks into one
  deliberate gesture (operator Option-A decision, todo `one-click-enqueue-approve`). The redundant
  `window.confirm` in `EnqueuePreview` is dropped; the navy CONFIRM button IS the deliberate act.

### Claude's Discretion
- Exact Nodes-list column set/order (default: alias, type, status/severity, active channels,
  local/remote liquidity ratio, 30d forwarding count+earned, last-seen freshness — per UI-SPEC A3).
- Service Detail section order (default: health → vitals → log tail → restart history → dependents
  → runbook — per UI-SPEC C1–C6).
- Whether the `[pubkey]/[tab]` retirement is a hard removal or a redirect shim — planner's call,
  keep the CSV export read path reachable.

### Folded Todos
- **`2026-06-23-node-detail-all-channels-fee-queue.md`** (`resolves_phase: 13`) — all-channels view
  + per-channel "Queue fee change" (no AI rec). Fixes the 08-04 LQWD-Ireland canary (rec-card-only
  enqueue → 3× channel mis-targeting, no clean revert). Folded as Node Detail Screen B8
  (`NodeChannelsTable`) + the stale-baseline guard (D-04/D-05) + Withdraw (D-01).
- **`2026-06-23-one-click-enqueue-approve.md`** (`resolves_phase: 13`) — operator Option-A decision
  to collapse confirm-dialog + separate `/queue` approval into one `enqueue+approve`. Folded as
  the `enqueueAndApprove` action (D-11).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design contract (LOCKED — read first)
- `.planning/phases/13-nodes-service-health/13-UI-SPEC.md` — the approved visual + interaction
  contract for all four surfaces + the write path. The source of truth for layout, color law,
  typography, copywriting, and the reconciled write-path safety boundary. This CONTEXT resolves its
  7 Open Assumptions (§ "Open Assumptions") — the decisions above OVERRIDE those hedges.
- `.planning/DESIGN-BRIEF-03-node-detail.md` — operator-authored Node Detail intent brief.
- `.planning/phases/10-design-system-foundation/.prototype-snapshot/Node Detail.dc.html` — the
  locked visual source of truth for the service grid (SVC-01) + Node Detail (NODE-04).
- `.planning/phases/12-.../12-UI-SPEC.md` (Phase-12 contract) — sibling list/detail grammar reused.

### Requirements
- `.planning/REQUIREMENTS.md` — NODE-03, NODE-04, SVC-01, SVC-02 (lines ~101–104).
- `.planning/ROADMAP.md` § "Phase 13: Nodes + Service Health" (line ~296) — goal + success criteria.

### Design system (LOCKED, do NOT extend)
- `src/lib/df/tokens.ts` + `src/app/globals.css` (`--color-df-* / --radius-df-* / --shadow-df-*`).
- `src/components/df/Severity.ts` — `severityVariants`, `severityAccent`, `severityIcon`,
  `severityLabel`.
- Reused primitives (compose, do NOT rebuild): `src/components/df/*` (`NavRailShell`,
  `SeverityCard`, `SeverityRow`, `EvidenceChart`, `StaleChart`, **`TwoAxisPip`**, `FreshnessChip`,
  `PollAge`, `AiReadPanel`, `CommandModal`, `WhyChain`, `BlastRadius`, `CategoryIcon`),
  `src/components/queue/*` (`EnqueuePreview`, `ApprovePanel`, `QueueTimeline`),
  `src/components/console/*` (`EventTable`, `SummaryStrip`, `Sparkline`, `ExportButton`),
  `src/components/ui/*` (vendored shadcn).

### Read model (Phase 11, already shipped — read before wiring)
- `src/lib/read/service-health.ts` — `ServiceHealthState`, `deriveServiceHealth`,
  `COLLECTOR_WINDOW_MS`, `FUNCTIONING_GRACE`. **NB (D-06):** no "paused" field exists here.
- `src/lib/read/latest.ts` — AFM-001 DISTINCT ON (chan_id) latest-per-channel read; the fee
  **baseline + freshness** source for the channels table (D-04). Row timestamp = honest staleness.
- `src/lib/read/chain-telemetry.ts` — bitcoind blocks-behind + bands (Service Detail infra variant).
- `src/lib/overview/service-display.ts` — `SERVICE_DISPLAY`, `serviceDisplay()` (never render the
  raw machine key on screen).

### Queue write path (Phase 6, existing — reuse, one guarded extension)
- `src/lib/queue/state.ts` — `LEGAL` transition table (**add `approved → withdrawn`**, D-01).
- `src/lib/queue/transitions.ts` — `approve` (has `staleAcknowledged`, reuse for D-05) / `reject`
  (**add `withdraw`** in the same guarded pattern, D-01/D-02).
- `src/lib/queue/enqueue.ts`, `sign.ts`, `canonical.ts`, `bounds.ts` (`updateFeeBoundsSchema`),
  `claim.ts`.
- `src/app/actions/queue.ts` — `enqueueCommand` / `enqueueBatch` / `approveCommand` (**add
  `enqueueAndApprove`**, D-11; likely a `withdrawCommand` action for D-01).
- `src/lib/format/units.ts` — AFM-002 the sole sat/BTC/msat/ppm path (`feeMsatToSat`, `formatSats`).
  No inline unit math.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TwoAxisPip` (`src/components/df/TwoAxisPip.tsx`) — the two-axis color law + `combinedState()`
  precedence (`HEALTHY` / `UP · NOT HEALTHY` / `DOWN`) is ALREADY implemented and tested. The
  service grid (SVC-01) composes N of these; do not re-derive or soften the precedence.
- `EnqueuePreview` (`src/components/queue/EnqueuePreview.tsx`) — the inert expand→preview→CONFIRM
  leaf that sends params only (never an HMAC). Reuse verbatim, pre-targeted to a `chan_id`, for the
  per-channel fee-queue (B8). Its `window.confirm` is dropped per D-11.
- `approve()` audit already carries `staleAcknowledged` — the D-05 stale-baseline ack has an
  existing home; do not invent a new field.

### Established Patterns
- **Guarded transition + audit** (`transitions.ts`): every state flip is a transactional
  `UPDATE … WHERE id=? AND state=<expected> RETURNING id` (0 rows ⇒ throw lost-race) + a
  `command_audit` insert. The new `withdraw` (D-01) MUST follow this exactly — it's what gives
  claim-race safety for free.
- **AFM-001 latest-per-key reads** (`latest.ts`, `service-health.ts`): DISTINCT ON the per-entity
  key ORDER BY key, timestamp DESC — NEVER `WHERE timestamp = MAX(...)`. Both the channels read and
  the service-health read already follow this; consume them, don't re-query.
- **Honest freshness everywhere (D-08):** derive staleness from raw timestamps at read time; a
  service with no heartbeat in `COLLECTOR_WINDOW_MS` reads stale, never green; a stale channel
  baseline reads stale and warns (D-05).

### Integration Points
- Node Detail rebuild REPLACES `src/app/(overview)/[pubkey]/page.tsx` (currently a redirect) and
  retires `src/app/(overview)/[pubkey]/[tab]/page.tsx` (keep `[tab]/export/route.ts` reachable).
- New routes: `src/app/(overview)/nodes/` (list) + `src/app/(overview)/[pubkey]/service/[service]/`
  (Service Detail).
- Overview rows (Phase 12) already link into these screens — the `/{pubkey}` deep-link contract
  must stay stable.
- The one-click write path adds `enqueueAndApprove` (+ likely `withdrawCommand`) server actions and
  the `approved → withdrawn` legal edge — the ONLY new logic surface. No new UI primitive.
</code_context>

<specifics>
## Specific Ideas

- The **08-04 LQWD-Ireland canary** is the north star for the write path: rec-card-only enqueue
  caused 3× channel mis-targeting and set a fee off a Jan-14 snapshot treated as "current". Every
  write-path decision (per-channel targeting B8, stale-baseline warn D-05, Withdraw D-01) traces to
  that failure. The planner should treat "could this repeat the canary?" as the acceptance lens.
- The service grid is explicitly the **CENTERPIECE** — the "up but dead" state (e.g. showcase:
  `addressBalances` heartbeat stale 2h, last run "failed · connection refused ×14") must be
  unmistakable (red tile chrome + red Functioning box + pulsing alarm dot). Not a design nicety —
  it's the SVC-01 load-bearing invariant.
</specifics>

<deferred>
## Deferred Ideas

- **"Paused-by-design" telemetry signal** — a collector + `service_inventory` schema change to
  carry an intentional-degraded/paused reason so the grid could render watch (teal) + a note
  (D-07). Telemetry-layer work, out of Phase 13 UI scope. Revisit if operators find the honest
  fallback (D-06) too blunt for genuinely-paused services.

### Reviewed Todos (not folded)
- **`2026-06-23-pin-lncli-cron-path-hardening.md`** — node-side cron PATH / `LNCLI` pin. Node-op
  tooling, not a Phase 13 UI/dashboard concern. Belongs with node deployment hardening.
- **`2026-06-23-exercise-inbound-fee-a2-lnd8614.md`** — verify inbound-fee (lnd#8614) on a real
  channel. Node-side execution verification, not Phase 13 UI scope.
- **`ui-polish-fleet-console.md`** — overview/fleet-console polish (Phase 12 surface), not the
  Phase 13 Nodes/Service surfaces.
</deferred>

---

*Phase: 13-nodes-service-health*
*Context gathered: 2026-07-08*
