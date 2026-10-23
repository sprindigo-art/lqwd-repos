# Phase 13: Nodes + Service Health - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 13-nodes-service-health
**Areas discussed:** Withdraw affordance scope, Stale fee-baseline strictness, Paused-by-design service state, Routes / columns / Service Detail layout

> Setup: the 13-UI-SPEC (approved) had already resolved the visual/interaction contract. The
> operator elected to decide all 4 of the spec's genuinely-open assumptions; the low-stakes ones
> (columns, section order) were confirmed as spec defaults. The two `resolves_phase: 13` todos
> (all-channels fee queue, one-click enqueue+approve) were folded (already synthesized in the spec);
> three node-side/overview todos were reviewed and not folded.

---

## Withdraw affordance scope

The operator asked for clarity on the withdraw process/purpose first. Explained the command
lifecycle (`draft → pending_approval → approved → claimed → executing`), the gap (an
`approved`-but-unclaimed row can only clear via 24h TTL or a manual DB write, but the node claims +
executes within ~5 min), and that Withdraw is a guarded `approved → withdrawn` edge whose
`WHERE state='approved'` predicate gives claim-race safety for free.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — ship it in Phase 13 | Guarded `approved → withdrawn` transition + Withdraw button on the pending-approved channel row; predicate gives claim-race safety; pairs with the one-click gesture as its undo | ✓ |
| No — defer it | Phase 13 ships read + one-click enqueue+approve only; no operator undo until a later queue-hardening phase | |
| Ship, gated on claim-safety proof | (from an earlier framing) include only if planning proves no claim race | withdrawn from final ask — the guarded predicate already provides it |

**User's choice:** Yes — ship it in Phase 13.
**Notes:** Operator specifically wanted the process + purpose explained before deciding. Once the
approve→(node executes) window and the audit-preserving guarded pattern were clear, chose to ship.
The one-click gesture removing the old reconsider beat was the deciding rationale for the undo.

---

## Stale fee-baseline strictness

Grounded in the 08-04 canary (a fee set off a Jan-14 snapshot treated as "current"). The baseline
freshness source is confirmed to exist: AFM-001 `latest.ts` row timestamp.

| Option | Description | Selected |
|--------|-------------|----------|
| Warn + explicit confirm | Show stale treatment + "baseline may be stale (<t> old)"; operator must explicitly acknowledge (record `staleAck=true`, existing field) before CONFIRM enables | ✓ |
| Hard-block past a threshold | Disable enqueue entirely when baseline stale beyond a set age; no override | |
| Hybrid: warn short, block long | Warn+confirm for mildly stale; hard-block only past a wildly-stale cutoff (2 thresholds) | |

**User's choice:** Warn + explicit confirm.
**Notes:** Keeps the feature usable when the warehouse legitimately lags, while forcing a knowing
decision. Reuses the existing `staleAcknowledged` audit field on `approve()` — no new field.

---

## Paused-by-design service state

Grounded in the finding that `ServiceHealthState` has NO field expressing "intentionally paused"
(only `running`/`functioning`/`stale`/`collectorStale`/`noData`; `is_expected` ≠ paused). So this
was framed as an honesty call, not a free design choice.

| Option | Description | Selected |
|--------|-------------|----------|
| Honest fallback — no synthetic state | Render every service by its true two-axis state; no "paused = watch" softener; defer a real paused-by-design telemetry signal | ✓ |
| Add telemetry signal now | Extend Phase-11 collector + `service_inventory` to carry intentional-degraded reason (telemetry-layer, arguably out of scope) | |
| Static UI softener map | Hardcoded known-pausable-services list softening to watch — rejected by default (fakes health, violates D-08) | |

**User's choice:** Honest fallback — no synthetic state.
**Notes:** NodeMonitor won't invent health the telemetry can't back. A real "paused-by-design"
signal is deferred to a future telemetry change. Supersedes the UI-SPEC's "represent as watch" hedge
for the paused-by-design case specifically.

---

## Routes / columns / Service Detail layout

| Option | Description | Selected |
|--------|-------------|----------|
| Single-scroll page at `/[pubkey]` | Rebuild Node Detail as one top-to-bottom page (prototype order); replace the v1 redirect; retire/redirect v1 `[tab]` sub-routes | ✓ |
| Keep tabbed `[tab]` sub-routes | Preserve v1 URL structure, render new sections as tabs | |

**User's choice:** Single-scroll page at `/(overview)/[pubkey]`.
**Notes:** Matches the locked prototype grammar and keeps the centerpiece grid beside its Lightning
context. Nodes list at `/(overview)/nodes`, Service Detail at `/(overview)/[pubkey]/service/[service]`
accepted as spec defaults. Nodes-list column set + Service Detail section order left to Claude's
discretion (spec defaults). The `enqueueAndApprove` Option-A shape (sign once, land `approved`,
drop the redundant `window.confirm`) was already confirmed by the operator's todo and carried
through unchanged.

## Claude's Discretion

- Exact Nodes-list column set/order (UI-SPEC A3 default).
- Service Detail section order (UI-SPEC C1–C6 default: health → vitals → log tail → restart history
  → dependents → runbook).
- Whether the v1 `[pubkey]/[tab]` retirement is a hard removal or a redirect shim (keep the CSV
  export read path reachable).

## Deferred Ideas

- **"Paused-by-design" telemetry signal** — collector + `service_inventory` schema change to express
  intentional-degraded/paused, so the grid could render watch + a note. Future telemetry-layer work.
- Node-side/overview todos reviewed, not folded: `pin-lncli-cron-path-hardening` (node-op tooling),
  `exercise-inbound-fee-a2-lnd8614` (node-side verification), `ui-polish-fleet-console` (Phase-12
  overview surface).
