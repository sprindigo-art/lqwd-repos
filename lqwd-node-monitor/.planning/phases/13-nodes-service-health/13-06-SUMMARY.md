---
phase: 13-nodes-service-health
plan: 06
subsystem: node-detail-write-path
tags: [NODE-04, B8, fee-queue, enqueue-approve, stale-gate, withdraw, canary-08-04]
requires:
  - "13-03: enqueueAndApprove + withdrawCommand server actions (+ withdraw() transition, withdrawn enum)"
  - "src/lib/read/latest.ts: latestChannelsForNode (AFM-001 DISTINCT ON chan_id)"
  - "src/components/queue/EnqueuePreview.tsx: the fork source (params-only leaf)"
  - "src/components/queue/ApprovePanel.tsx: the stale-gate + transition-leaf grammar"
provides:
  - "projectChannelBaseline: typed channel projection with timestamp-derived baselineStale"
  - "FEE_BASELINE_STALE_MS (6h): pinned D-05 stale-baseline trigger"
  - "resolveChannelEnqueueProps: server-only LND-gated channel→EnqueuePreviewProps builder"
  - "NodeFeeEnqueue: forked B8 fee-queue leaf (enqueueAndApprove, no confirm dialog, D-05 gate)"
  - "feeEnqueueConfirmBlocked + buildEnqueueAndApproveArgs: pure, dep-free-testable helpers"
  - "WithdrawAffordance: client leaf for approved-but-unclaimed rows (withdrawCommand)"
  - "NodeChannelsTable (B8): all-channels table with per-channel fee-queue + freshness + withdraw"
affects:
  - "future Node Detail page wiring (/(overview)/[pubkey]) — mounts NodeChannelsTable"
tech-stack:
  added: []
  patterns:
    - "Fork-not-reuse of a client leaf (EnqueuePreview → NodeFeeEnqueue) with 4 pinned deltas"
    - "Pure exported predicate + pure params-builder for dep-free (no-jsdom) behavioral tests"
    - "Server-only backend gate resolved in a Server Component; serializable props to client leaves"
key-files:
  created:
    - src/lib/queue/channel-enqueue-props.ts
    - src/components/node/NodeFeeEnqueue.tsx
    - src/components/node/NodeFeeEnqueue.test.tsx
    - src/components/node/WithdrawAffordance.tsx
    - src/components/node/NodeChannelsTable.tsx
  modified:
    - src/lib/read/latest.ts
decisions:
  - "peer identifier exposed as peerPubkey (honest) — lnd_node_channel_info carries no alias column; the B8 row shows a truncated pubkey"
  - "timeLockDelta defaults to the LND default (80) — the channel warehouse snapshot has no time-lock column (mirrors fee-signals)"
  - "NodeChannelsTable is a Server Component with deterministic default ordering (active first, capacity desc); interactive column sort/filter is deferred to the page-level client wrapper (out of this component's server-shell scope)"
  - "approved-but-unclaimed intents surfaced via an approvedByChanId prop (chanId→commandId) — the queue lookup is page-level wiring, not in this plan's file set"
metrics:
  duration: ~30m
  completed: 2026-07-08
---

# Phase 13 Plan 06: B8 Node-Detail Write-Path UI Summary

Ships the B8 all-channels fee-queue: a per-channel, no-AI enqueue+approve gesture pre-bound to a specific `chan_id`, a 6h stale-baseline guard that forces explicit acknowledgement, and a Withdraw affordance for approved-but-unclaimed intents — the direct fix for the 08-04 LQWD-Ireland canary (rec-card-only enqueue → 3× channel mis-targeting off a stale snapshot with no clean revert).

## What was built

- **Task 1 — Typed channel baseline + pinned stale trigger + props builder** (`0f54210`)
  - `projectChannelBaseline(row, nowMs?)` in `latest.ts`: maps the untyped `latestChannelsForNode` row to a typed `ChannelBaseline`, deriving `baselineStale` from the row's **`timestamp`** column (Drift 4 — NOT `collected_at`), clock-injectable, null timestamp ⇒ stale.
  - Exported `FEE_BASELINE_STALE_MS = 6 * 60 * 60 * 1000` with a doc-comment justifying why neither `COLLECTOR_WINDOW_MS` (15m, would reflex-train) nor `STALENESS_CUTOFF_MS` (30d, too loose for a fee decision) fits.
  - `resolveChannelEnqueueProps` (server-only): LND-gated, `suggestedPpm = currentPpm` (no-AI), `expiresAtLabel` computed server-side (+TTL); LDK rows return a read-only marker.

- **Task 2 — Fork EnqueuePreview → NodeFeeEnqueue** (`5a72e90`)
  - Calls `enqueueAndApprove` (lands `approved` in one navy CONFIRM); the redundant browser confirm dialog is dropped (D-11). Params-only / server-signs invariant kept verbatim.
  - Pure exported `feeEnqueueConfirmBlocked({ baselineStale, staleAck })` binds the CONFIRM `disabled` state; pure exported `buildEnqueueAndApproveArgs` threads `staleAck` into the action input.
  - D-05 stale-baseline warning + blocking ack checkbox; verbatim UI-SPEC success/stale copy; ppm editable up AND down.

- **Task 3 — NodeChannelsTable (B8) + WithdrawAffordance** (`8ab07ab`)
  - `NodeChannelsTable` (Server Component): lists ALL channels with chan_id, peer, capacity, local/remote + ratio bar, fee policy (ppm/base/cltv via AFM-002), state, honest freshness from the row `timestamp`. LND rows mount `NodeFeeEnqueue` pre-targeted to that chan_id; LDK rows render policy read-only. Approved-unclaimed rows mount `WithdrawAffordance`. Honest empty state (verbatim copy).
  - `WithdrawAffordance` (client leaf): `withdrawCommand({ id })` (no signature), verbatim D-01 confirm copy, surfaces the "too late, already claimed" lost-race copy.

- **Task 4 — D-05 stale-gate behavioral test** (`cd2265c`)
  - `NodeFeeEnqueue.test.tsx` (dep-free, `renderToStaticMarkup`, no jsdom): predicate blocked→ack→enabled + fresh-never-blocks; stale render shows DISABLED CONFIRM + verbatim warning; `buildEnqueueAndApproveArgs` threads staleAck (true/false) verbatim, params-only (no signature field).
  - Added a `defaultOpen` testability affordance to `NodeFeeEnqueue` so the expanded gate is present in first-paint static markup.

## Verification

- `tsc --noEmit` clean.
- `npx vitest run src/components/node/NodeFeeEnqueue` → 5 passed.
- `grep -c "window.confirm" NodeFeeEnqueue.tsx` == 0.
- `FEE_BASELINE_STALE_MS` exported from `latest.ts`; freshness from `timestamp` (not `collected_at`); no client-side HMAC/signature in `src/components/node/`; per-channel chanId targeting; LDK read-only.
- Existing tests touching `latest.ts` (`latest.test.ts`, `static-tabs.test.ts`) still green (16 passed).

## Threat model coverage

- **T-13-06-01** (wrong-channel targeting): `NodeFeeEnqueue` is pre-targeted to a specific `chanId` from the B8 row; the params carry that chanId (no rec-card path).
- **T-13-06-02** (stale baseline as current): freshness from the row `timestamp`; `baselineStale` (6h) forces the visible warning + explicit staleAck before CONFIRM, with automated behavioral coverage.
- **T-13-06-03** (client forges HMAC): forked leaf keeps params-only; `enqueueAndApprove` signs server-side; no signature constructed client-side.
- **T-13-06-04** (double-apply after approve): withdraw guarded on `state='approved'` (13-03); after node claim it fails cleanly.
- **T-13-06-05** (AI supplies the fee param): B8 is no-AI — `suggestedPpm = currentPpm`; params come only from the operator's bounds-clamped edit.
- **T-13-06-SC** (npm installs): zero new package installs; the stale-gate test is dep-free (no jsdom/@testing-library).

## Deviations from Plan

### Auto-added (Rule 3 — testability enablement)

**1. [Rule 3 - Blocking] `defaultOpen` prop on NodeFeeEnqueue**
- **Found during:** Task 4
- **Issue:** The D-05 render assertion requires the expanded preview (CONFIRM + stale warning) in first-paint static markup, but `open` defaults to `false` and `renderToStaticMarkup` cannot click to expand (no jsdom, per RESEARCH §H).
- **Fix:** Added an optional `defaultOpen?: boolean` prop seeding the initial `open` state (defaults to `false` — production behavior unchanged; also usable as a deep-link affordance).
- **Files modified:** `src/components/node/NodeFeeEnqueue.tsx`
- **Commit:** `cd2265c`

### Scope notes (not defects)

- **Interactive column sort/filter** (from the Task 3 action prose) is deferred to a page-level client wrapper: `NodeChannelsTable` is a Server Component (it must call the server-only `resolveChannelEnqueueProps` per row per its classification "Server + client leaf"). It ships deterministic default ordering (active first, capacity desc). Task 3 acceptance criteria (chanId targeting, withdrawCommand, AFM-002, freshness, LDK read-only, tsc) are all met.
- **Approved-but-unclaimed lookup:** surfaced via an `approvedByChanId` prop; the queue read that populates it is page-level wiring, outside this plan's file set.
- **Peer alias:** the plan's projection listed `peerAlias`, but `lnd_node_channel_info` has no alias column (confirmed in `console/channels.ts`); the honest field `peerPubkey` is exposed and the row renders a truncated pubkey. No acceptance grep depends on the field name.

## Known Stubs

None. No stubbed data paths introduced. `approvedByChanId` is an optional inbound prop (page-supplied), not a hardcoded placeholder.

## Live-DB note

No live-DB test was required or run for this plan — all four tasks are pure-logic / SSR-static and dep-free. The write path itself (13-03) exercises the `nodemon_rw` role; this plan only builds the UI on top of it.

## Self-Check: PASSED
