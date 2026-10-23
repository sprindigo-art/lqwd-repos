---
created: 2026-06-23T16:57:48Z
title: Node Detail — all-channels view + per-channel fee queue (no AI rec required)
area: ui
resolves_phase: 13
files:
  - src/app/(overview)/page.tsx
  - src/components/queue/EnqueuePreview.tsx
  - src/lib/db/schema/routing.ts:35
  - src/lib/read/
---

## Problem

The ONLY way to enqueue a fee change today is through AI recommendation cards
(`EnqueuePreview` is mounted on insight cards, and those cards only ever suggest
*raising* ppm). There is no way to open a node and act on an arbitrary channel.

This was surfaced live by the Phase 08-04 canary on LQWD-Ireland (`0230b207…`):
because the only entry point was rec cards, the operator **mis-targeted channels
three times** and could not compose a clean revert (rec cards can't express
"lower ppm back to 1"). Channels `1024943848780464130` and `997414276675993605`
were left at ppm 30 with no straightforward in-UI path back.

Operator requirement (2026-06-23): "I should be able to open a node from the
fleet and see all channels and queue fees for any channel without AI
recommendations."

## Solution

Phase 13 (Nodes + Node Detail). Node Detail page that lists **all** channels for
the node with, per channel: chan_id, peer alias, capacity, local/remote balance,
current fee policy (ppm / base_msat / cltv), active/inactive. Each row exposes a
**"queue fee change"** action that opens the enqueue flow for THAT channel
directly — independent of any AI recommendation.

Design caveats from the canary:
- **Freshness:** the routing warehouse (`lnd_node_channel_info`) lagged badly —
  a Jan-14 snapshot was the latest row for a live channel. Per-channel
  current-fee values can be stale, so the design needs an honest freshness
  signal (or a fresher read) for the channel a fee is queued against, or the
  operator will set fees off a wrong baseline.
- **No "cancel approved" affordance:** an approved-but-unclaimed command can only
  clear via 24h TTL or a manual DB write (there is no reject for `approved`).
  Consider an operator cancel/withdraw for approved-but-unclaimed rows so a
  wrong-channel command can be pulled before the node claims it.

Pairs with [[one-click-enqueue-approve]] (the per-channel action should use the
one-click enqueue+approve flow).
