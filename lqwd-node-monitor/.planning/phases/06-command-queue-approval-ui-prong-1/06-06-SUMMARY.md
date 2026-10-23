---
phase: 06-command-queue-approval-ui-prong-1
plan: 06
subsystem: command-queue-approval-ui
tags: [queue, approval, rsc, client-leaf, afm-001, freshness, audit-timeline, shadcn]
requires:
  - approveCommand / rejectCommand server actions (06-05, src/app/actions/queue.ts)
  - latestChannelsForNode (AFM-001, src/lib/read/latest.ts)
  - isStale / worstCaseAsOf + STALENESS.warnAfterHours (D-09, src/lib/scorecard/freshness.ts + config.ts)
  - FreshnessStamp (src/components/scorecard/FreshnessStamp.tsx)
  - feeMsatToSat / formatSats (AFM-002, src/lib/format/units.ts)
  - commands / commandAudit schema (06-01, src/lib/db/schema/nodemon.ts)
  - radix-ui Checkbox primitive (allowlist)
provides:
  - /queue RSC approval page (fleet-wide pending + in-flight, live diff, freshness, timeline)
  - ApprovePanel client leaf (APPROVE/REJECT confirm + D-10 stale-ack gate)
  - QueueTimeline presentational audit timeline (D-08)
  - vendored checkbox primitive (src/components/ui/checkbox.tsx)
affects:
  - the /queue route surface; no shared orchestrator artifacts touched
tech-stack:
  added: [radix-ui Checkbox (vendored, allowlist — no new registry)]
  patterns:
    - RSC server-only loader with lazy dbNodemon import (latest.ts precedent)
    - client-leaf containment (serializable props only; reject reason as text node)
    - live current-policy re-query at render via AFM-001 (D-06), never the enqueue snapshot
key-files:
  created:
    - src/components/ui/checkbox.tsx
    - src/components/queue/ApprovePanel.tsx
    - src/components/queue/QueueTimeline.tsx
    - src/app/(overview)/queue/page.tsx
  modified: []
decisions:
  - D-06 live re-query: the current→proposed diff reads LIVE policy via latestChannelsForNode at render; the enqueue-time params.currentPpm snapshot is never used as the diff's current value.
  - D-09 freshness reuse: no new queue-specific threshold; isStale + STALENESS.warnAfterHours (6h) reused; the matched channel row's `timestamp` is the asOf.
  - D-10 blocked-by-default (not a hard lock): APPROVE disabled until the stale-ack checkbox is checked; the ack boolean flows to approveCommand and is audited.
  - Checkbox vendored from the unified `radix-ui` package (same source as button/dialog); components.json registries stays empty (T-02-SC / T-06-24).
metrics:
  duration: ~25m
  completed: 2026-06-15
---

# Phase 6 Plan 06: Command Queue + Approval UI Summary

The approval surface for QUEUE-03: a fleet-wide `/queue` RSC that re-queries the LIVE current fee policy per command (AFM-001, D-06), renders the current→proposed diff + a reused data-freshness stamp (D-09) + a per-command append-only audit timeline (D-08), and an `ApprovePanel` client leaf whose APPROVE/REJECT confirm gestures gate stale data behind an audited acknowledgement checkbox (D-10) — vendoring a radix `checkbox` primitive with no new registry.

## What was built

- **`src/components/ui/checkbox.tsx`** — radix `Checkbox` vendored matching the existing `button`/`dialog` style (`import { Checkbox as CheckboxPrimitive } from "radix-ui"`). Hairline border, tight radius; navy reserved for the checked chrome + focus-visible ring; the check glyph is the only icon. No new third-party registry (T-02-SC / T-06-24).
- **`src/components/queue/ApprovePanel.tsx`** — `"use client"` leaf taking serializable props only (`commandId`, server-computed `isStale`, pre-formatted `asOf`). APPROVE (navy) + REJECT (critical-red) each take a `window.confirm` gesture (D-07) with the verbatim UI-SPEC confirm copy. When `isStale`, the warn-tinted gate line renders, APPROVE stays disabled until the "I acknowledge the data is stale" checkbox is checked (blocked-by-default, D-10), and the ack boolean flows to `approveCommand`. The optional reject reason is captured and sent to `rejectCommand`; it is never serialized as HTML. The client never sends a signature.
- **`src/components/queue/QueueTimeline.tsx`** — presentational RSC-safe component (no `"use client"`, no logic) mapping ordered `AuditRow[]` to one row per transition: a mono uppercase state chip (SUCCEEDED ok-green; REJECTED/FAILED/EXPIRED critical-red; in-flight neutral — no dots/icons), actor + timestamp, and an optional second line for the reason (text node) / stale-ack marker. Empty copy `No transitions recorded.`
- **`src/app/(overview)/queue/page.tsx`** — RSC mirroring `inbox/page.tsx`: `dynamic = "force-dynamic"`, `revalidate = 0`, `metadata = { title: "Queue" }`. A lazy-imported server-only loader reads all `commands` + `commandAudit`, surfaces only `pending_approval` + in-flight (`approved`/`claimed`/`executing`), re-queries LIVE policy per command via `latestChannelsForNode` (matching `chan_id`), computes the diff via `@/lib/format/units` with `tabular-nums`, stamps freshness via `isStale`/`worstCaseAsOf`, renders `FreshnessStamp` + `QueueTimeline`, and mounts `ApprovePanel` on pending rows. Pending sorts first. `QUEUE IS EMPTY` + suppressed-only empty copy and an honest read-only error main are verbatim from the UI-SPEC.

## Verification

- `npx tsc --noEmit` — exit 0 (clean) for all four files and the whole project.
- `npm run build` — succeeds; `/queue` is registered as a dynamic (ƒ) route and renders.
- Grep gates: `latestChannelsForNode` present (AFM-001); `force-dynamic` present; `MAX(` count 0 (the two doc-comment references were reworded so the T-06-22 grep gate passes with zero); checkbox vendored from the `radix-ui` allowlist.
- `npm test` — 610 passed, 30 skipped. The only failures are the 4 live-DB queue integration suites (`approve`, `claim`, `enqueue`, `stub-executor`) failing solely on `Missing required env: NODEMON_QUEUE_URL` — the documented expected behavior in a worktree without `.env.local` (they pass on main). No NEW failures introduced.

## Deviations from Plan

**1. [Rule 3 — Blocking issue] Reworded two `MAX(` doc-comment references in queue/page.tsx.**
- **Found during:** Task 3 verification.
- **Issue:** Two header comments warning against the greatest-timestamp anti-pattern contained the literal `MAX(timestamp)`, which tripped the T-06-22 grep gate (`grep -c 'MAX(' == 0`). The gate is a hard security guard and is intentionally text-blind to comment vs. SQL context.
- **Fix:** Reworded both comments to "greatest-timestamp form" without the literal `MAX(`; the AFM-001 DISTINCT-ON read is unchanged. No SQL `MAX(timestamp)` ever existed in the file.
- **Files modified:** src/app/(overview)/queue/page.tsx
- **Commit:** bc1a000

## Known Stubs

None. The page reads real `commands`/`commandAudit` rows and the live AFM-001 policy; the `live channel policy not found` line is an honest fail-loud state (channel absent from the live warehouse read), not a placeholder.

## Threat surface notes

No new security surface beyond the plan's threat register. APPROVE/REJECT route through the existing server actions (server re-validates + re-guards); the client sends params + the stale-ack boolean only, never a signature (T-06-21). The reject reason renders as a text node (T-06-23). The checkbox is vendored from the allowlist with no new registry (T-06-24). The diff reads LIVE policy via the only sanctioned AFM-001 read, never a greatest-timestamp form (T-06-22).

## Self-Check: PASSED
