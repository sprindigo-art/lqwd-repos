---
created: 2026-06-23T16:57:48Z
title: One-click enqueue+approve — reduce fee-queue prompt friction
area: ui
resolves_phase: 13
files:
  - src/app/actions/queue.ts
  - src/components/queue/EnqueuePreview.tsx
  - src/lib/queue/enqueue.ts
  - src/lib/queue/transitions.ts
---

## Problem

Queuing a routine fee change today requires three deliberate steps: the
`window.confirm` in `EnqueuePreview`, a separate **approve** in `/queue`, then
the node tick. The Phase 08-04 canary operator found this to be "too many
prompts" for routine work.

## Solution

**Operator decision 2026-06-23: Option A — one-click enqueue+approve.**
Explicitly NOT auto-approve-on-enqueue, and explicitly NOT bypass-the-queue.

Collapse the confirm-dialog + separate `/queue` approval into a single
deliberate action:
- Add an `enqueueAndApprove` server action that signs once (reusing
  `enqueue.ts`) and lands the row directly as `approved`, preserving the full
  audit trail (`∅ → pending_approval → approved`, actor `operator`).
- `EnqueuePreview` drops the redundant `window.confirm` — the CONFIRM button
  itself is the deliberate gesture.

**KEEP UNCHANGED (the safety boundary is node-side, not the click count):**
HMAC-signed command rows, node-side HMAC re-verification, node-side bounds
re-enforcement, and the atomic `FOR UPDATE SKIP LOCKED` claim. This preserves
the CLAUDE.md core value — the dashboard holds zero node credentials and the
node only applies changes it can cryptographically verify and re-bounds-check.

Pairs with [[node-detail-all-channels-fee-queue]] (per-channel actions use this
flow).
