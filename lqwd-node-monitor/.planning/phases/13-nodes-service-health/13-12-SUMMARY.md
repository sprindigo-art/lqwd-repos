---
phase: 13-nodes-service-health
plan: 12
subsystem: node-detail
tags: [node-detail, channels, sub-route, withdraw, interconnection, gap-closure]
requires:
  - "13-06 NodeChannelsTable (fee-queue + stale gate + WithdrawAffordance leaf)"
  - "13-09 two-gate validation pattern (service sub-route)"
  - "13-10 NodeDetailTabs shared sub-nav strip"
  - "13-11 paginate.ts + shared handleCsvExport handler"
provides:
  - "/[pubkey]/channels — paginated channels RSC sub-route with ?peer/?chan interconnection filters"
  - "/[pubkey]/channels/export — channels CSV export via shared handler (NODE-02 preserved)"
  - "approvedFeeIntentsByChanId(pubkey) — per-node approved-but-unclaimed update_fee reader (fail-soft)"
  - "NodeChannelsTable.peerHrefBase — optional G2 channels→peer link"
affects:
  - "src/components/node/NodeChannelsTable.tsx (additive optional prop; other callers unchanged)"
tech-stack:
  added: []
  patterns:
    - "Static sub-route folder shadows dynamic [tab]/export → sibling export/route.ts restores NODE-02 path"
    - "Lazy dbNodemon queue-read, parameter-bound drizzle and/eq/isNull, fail-soft to empty map"
    - "In-memory URL-param filter (invalid widens to unfiltered, never reaches a read)"
key-files:
  created:
    - "src/app/(overview)/[pubkey]/channels/page.tsx"
    - "src/app/(overview)/[pubkey]/channels/export/route.ts"
    - "src/lib/read/approved-fee-intents.ts"
  modified:
    - "src/components/node/NodeChannelsTable.tsx"
decisions:
  - "peerHrefBase kept optional so the overview + other NodeChannelsTable callers render plain-text peers (no regression)"
  - "approved-fee reader orders created_at ASC so a duplicate chanId resolves to the most recent intent (last write wins)"
  - "belt-and-suspenders isNull(claimedAt) added alongside state='approved' per the plan's optional guard"
metrics:
  duration: "~10m"
  completed: 2026-07-09
  tasks: 4
  files: 4
requirements: [NODE-04, NODE-02]
---

# Phase 13 Plan 12: Channels Sub-Route with Wired Withdraw Summary

Broke the channels firehose out of the single-scroll Node Detail into a real, paginated RSC sub-route at `/[pubkey]/channels` that reuses the 13-06 `NodeChannelsTable` verbatim, cross-links each row to its peer (G2), and — crucially — wires the previously-dead withdraw path live by reading this node's approved-but-unclaimed `update_fee` intents and feeding them as `approvedByChanId`.

## What Was Built

- **Task 1 — Channels RSC sub-route** (`channels/page.tsx`): `force-dynamic` two-gate page (PUBKEY_RE before any read → node resolved via `cache(loadFleetView)` + `latestNodeInfoFallback`). Reads `latestChannelsForNode` fail-soft, projects `ChannelBaseline[]`, applies format-validated `?peer` (PUBKEY_RE) / `?chan` (`/^\d+$/`) in-memory filters (invalid → unfiltered), paginates with `parsePageParam`/`slicePage`, and renders `NavRailShell` + `NodeDetailTabs active="channels"` + the reused table + a navy-structural filter/clear affordance + Prev/Next pager preserving filters.
- **Task 2 — Channels CSV export** (`channels/export/route.ts`): thin `GET` delegating to `handleCsvExport(req, { pubkey, tab: "channels" })`, restoring the NODE-02 path the new static folder would otherwise shadow.
- **Task 3 — Channels → peer link** (`NodeChannelsTable.tsx`): additive optional `peerHrefBase` prop; the Peer cell becomes a navy-structural `next/link` to `?focus={peerPubkey}` when set, plain text otherwise. Fee-queue / stale gate / withdraw / freshness / AFM-002 formatting untouched.
- **Task 4 — Live withdraw wiring** (`approved-fee-intents.ts` + page): server-only `approvedFeeIntentsByChanId(pubkey)` selects `commands` WHERE `nodePubkey=pubkey AND actionType='update_fee' AND state='approved' AND claimedAt IS NULL` (parameter-bound drizzle `and`/`eq`/`isNull`), reduces `params.chanId → id` (created_at ASC, last write wins), and degrades to `{}` on any error. The page reads it and passes `approvedByChanId`, so an approved-but-unclaimed row now renders the reused `WithdrawAffordance`.

## Deviations from Plan

**1. [Rule 3 — Blocking] Deferred `peerHrefBase` pass-through from Task 1 to Task 3.**
- **Found during:** Task 1
- **Issue:** Task 1's action mounts the reused table, but passing `peerHrefBase` there would reference a prop that does not exist until Task 3 — breaking the per-task `tsc --noEmit` gate.
- **Fix:** Task 1 mounts `NodeChannelsTable` without `peerHrefBase` (tsc-clean); Task 3 adds the optional prop to the component AND wires the page to pass it in the same commit (the page is already in the plan's `files_modified`).
- **Files modified:** `channels/page.tsx`, `NodeChannelsTable.tsx`
- **Commits:** 228d4bb (Task 1), 0bd8581 (Task 3)

## Verification

- `npx tsc --noEmit` clean (exit 0).
- `npx vitest run src/components/node/NodeFeeEnqueue` — 5/5 green (reused leaf intact).
- `channels/export/route.ts` present.
- Grep gate "withdraw wiring live": the channels page invokes `approvedFeeIntentsByChanId` and passes `approvedByChanId`.
- No file deletions across the four commits; no stray untracked files.

## Threat Surface

All four STRIDE register dispositions honored: URL params format-gated before any read (T-13-12-01); no signing added at the page/table layer, only the reused 13-06 leaf mutates (T-13-12-02); CSV export delegates to the shared gauntlet (T-13-12-03); the queue read is server-only, pubkey-scoped, parameter-bound, and fail-soft (T-13-12-04). Zero new package installs (T-13-12-SC).

## Commits

- 228d4bb feat(13-12): channels RSC sub-route (paginated + interconnection filters)
- 3e50daf feat(13-12): channels CSV export route (static folder)
- 0bd8581 feat(13-12): channels row → peer interconnection link (G2)
- 8c3c4b9 feat(13-12): live withdraw wiring — approved-fee-intents reader → approvedByChanId

## Self-Check: PASSED

All 4 key files present on disk; all 4 task commits present in git history.
