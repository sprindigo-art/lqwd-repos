---
phase: 03-per-node-console-pending-monitor
plan: 04
subsystem: read-layer
tags: [console-tabs, windowed-events, ns-epoch, afm-002, shapers, tdd]
requires:
  - phase: 03-01
    provides: "console/config.ts (WINDOW_PRESETS, DEFAULT_WINDOW, ROW_CAP), the phase tuning surface"
  - phase: 02
    provides: "latest.ts latestChannelsForNode, node-info.ts latestNodeInfo, db-timestamp.ts parseDbTimestampUtc, revenue.ts/force-close.ts builder precedents"
provides:
  - "src/lib/console/forwards.ts — buildForwardsSummarySql/RowsSql/FullSql/BusiestChannelSql + forwardsTabData (ns-epoch windows, AFM-002 SUM(fee_msat)/1000.0, raw string rows)"
  - "src/lib/console/closes.ts — buildClosesSummarySql/RowsSql/FullSql + closesTabData (make_interval windows, per-close_type FILTER counts, parseDbTimestampUtc asOf)"
  - "src/lib/console/channels.ts / fees.ts / liquidity.ts — pure shapers over latestChannelsForNode with strips, raw+formatted pairing, per-tab asOf"
  - "src/lib/console/peers.ts — channel-counterparty view, buildPeerInfoLatestSql enrichment, honest {numPeers, shownPartners} headline, FLAP_COUNT_LIFETIME_NOTE"
affects:
  - "03-06 console tab pages (import all six tab data functions + view types)"
  - "03-07 CSV export route (imports buildForwardsFullSql/buildClosesFullSql and the channels shaper rows)"
tech-stack:
  added: []
  patterns:
    - "Windowed event reader trio per tab: summary strip + ROW_CAP-capped rows + capless full-window export builder, all bound to WINDOW_PRESETS integer days (D-06/D-07/D-09)"
    - "Pure shaper + fetch wrapper split: shapeXxxTab(rows) testable with fixtures, xxxTabData(pubkey) does the single sanctioned read"
key-files:
  created:
    - src/lib/console/forwards.ts
    - src/lib/console/forwards.test.ts
    - src/lib/console/closes.ts
    - src/lib/console/closes.test.ts
    - src/lib/console/channels.ts
    - src/lib/console/fees.ts
    - src/lib/console/liquidity.ts
    - src/lib/console/static-tabs.test.ts
    - src/lib/console/peers.ts
    - src/lib/console/peers.test.ts
  modified: []
decisions:
  - "Channels/Fees rows surface remotePubkey, not a remote alias — lnd_node_channel_info carries no alias column and the shapers are contractually SQL-free; alias enrichment lives in peers.ts (the one module allowed an enrichment query)"
  - "peers.ts enrichment fetches latest-per-peer rows for the whole node partition (DISTINCT ON peer_pubkey) and joins to counterparties in JS — avoids binding a pubkey array while satisfying the plan's latest-row-per-remote-pubkey shape test"
  - "Liquidity counts ACTIVE non-closed channels only (routable balance, Phase-2 liquidity precedent); Channels/Fees show all non-closed with the active flag visible"
  - "Raw row fields stay bigint-as-string verbatim (null preserved, never fabricated to 0) so the 03-07 CSV export is lossless; Number() coercion only on strip/summary display values"
metrics:
  duration: ~9 min
  tasks: 3
  completed: 2026-06-10
---

# Phase 3 Plan 04: Console Tab Read Layer Summary

Six per-tab read modules for the NODE-01 console: windowed Forwards/Closes event readers (summary strip + ROW_CAP rows + capless export builders, ns-epoch and make_interval windows bound to WINDOW_PRESETS integers) plus thin Channels/Fees/Liquidity/Peers shapers over the sanctioned AFM-001 readers — zero new DISTINCT ON latest-state SQL.

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | Forwards + Closes windowed event readers (TDD) | b071f95 (RED), 9a46e61 (GREEN) | forwards.ts, forwards.test.ts, closes.ts, closes.test.ts |
| 2 | Channels/Fees/Liquidity shapers over latestChannelsForNode | 954f461 | channels.ts, fees.ts, liquidity.ts, static-tabs.test.ts |
| 3 | Peers counterparty view with peer_info enrichment (TDD) | b9433be (RED), dc38190 (GREEN) | peers.ts, peers.test.ts |

## What Was Built

- **Forwards (Task 1):** four builders over `lnd_node_forwards` (identity `lnd_pubkey`), every window predicate `timestamp_ns > (EXTRACT(EPOCH FROM now()) - $days * $86400) * 1e9` with the ×1e9 factor in SQL text (Pitfall 6) and `days` as the bound integer from WINDOW_PRESETS (D-06). Summary uses the AFM-002 sanctioned `SUM(fee_msat)/1000.0` / `AVG(fee_msat)/1000.0` forms; rows builder binds the ROW_CAP LIMIT (D-07); full builder has no limit token (D-09, export route input); busiest = `GROUP BY chan_id_out ORDER BY COUNT(*) DESC LIMIT 1`. `forwardsTabData` runs all three via Promise.all, keeps rows as raw bigint strings (CSV-lossless), converts asOf via `max_ts_ns / 1e6 → Date`.
- **Closes (Task 1):** summary/capped/full builders over `lnd_node_closed_channels` (identity `local_pubkey`, one row per close, no DISTINCT ON), window `timestamp > now() - make_interval(days => $bound)`. Summary carries `SUM(capacity)`, `SUM(settled_balance)`, and per-close_type FILTER counts on all six verified enum literals; asOf routes through `parseDbTimestampUtc` (WR-01).
- **Static shapers (Task 2):** `shapeChannelsTab` / `shapeFeesTab` / `shapeLiquidityTab` (pure, fixture-testable) + `xxxTabData(pubkey)` wrappers calling `latestChannelsForNode` once. Strips computed from rows in hand (Open Question 2): channels {count, ΣcapacitySat, Σlocal, Σremote}; fees {count, avgRatePpm, avgBaseFeeSat via feeMsatToSat}; liquidity {Σlocal, Σremote, Σcapacity, overallLocalPct} with per-row localRatio (null on zero capacity). Raw strings paired with formatSats displays; asOf = max row timestamp via parseDbTimestampUtc.
- **Peers (Task 3):** counterparties = distinct `remote_pubkey` of active latest channels (Pitfall 5 resolution — never COUNT(*) of the lifetime log), enriched by `buildPeerInfoLatestSql` (DISTINCT ON (peer_pubkey) with NULL-key guard, bound `local_pubkey`, no count(*) token). Headline `{numPeers, shownPartners}` from `latestNodeInfo` powers the honest copy; `flapCountLifetime` + exported `FLAP_COUNT_LIFETIME_NOTE` for the tooltip; per-tab asOf from the latest-channel rows.

## Verification Results

- `npx vitest run src/lib/console` — 53 passed (5 files)
- `npx vitest run src/lib` — 237 passed, 16 skipped (live golden suites; no DB env in worktree)
- `npx tsc --noEmit` — clean
- `grep -c "DISTINCT ON" channels.ts fees.ts liquidity.ts` — 0/0/0 (zero new latest-state SQL); all three import latestChannelsForNode from `@/lib/read/latest`
- No inline `/1000`, `/1e8`, or `* 1000` outside the sanctioned `(fee_msat)/1000.0` SQL forms; `parseDbTimestampUtc` present in closes.ts (4 refs) and all shapers
- Full-window builders assert `not.toContain("limit")`; SQLi payloads land in params for `lnd_pubkey` and `local_pubkey` identities (tested)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan-referenced 03-PATTERNS.md absent from worktree**
- **Found during:** Execution start
- **Issue:** `.planning/phases/.../03-PATTERNS.md` is untracked in the main repo, so the worktree (committed state only) lacks it — same condition 03-01 hit
- **Fix:** Proceeded on the plan's inline task detail + 03-RESEARCH.md Patterns 3 and Pitfalls 5/6, which fully specify the contracts
- **Files modified:** none
- **Commit:** n/a

**2. [Rule 1 - Plan detail vs schema reality] "remote alias" not available in Channels/Fees rows**
- **Found during:** Task 2
- **Issue:** The plan's row spec says "remote alias/pubkey", but `lnd_node_channel_info` has no alias column, and Task 2 contractually forbids new SQL in these shapers
- **Fix:** Rows surface `remotePubkey` (the source truth); alias enrichment is delivered by the Peers tab module, which is the one place allowed an enrichment query
- **Files modified:** src/lib/console/channels.ts, fees.ts (documented in module banners)
- **Commit:** 954f461

## Authorization Gates

None — no live-warehouse runs required by this plan; all tests are no-DB shape/fixture tests.

## Known Stubs

None — every exported function is wired to real query or shaping logic; no UI surfaces in this plan.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: dos-surface | src/lib/console/peers.ts | buildPeerInfoLatestSql scans the node's full lifetime peer_info partition (DISTINCT ON peer_pubkey — up to ~22k distinct peers for Canada) with no window/limit. Not in the plan's threat register (T-03-08 covers event reads only). Acceptable for a local single-operator VM app, but worth a LIMIT or counterparty-set bind if it ever fronts untrusted traffic. |

## TDD Gate Compliance

Both TDD tasks completed RED → GREEN with separate commits: b071f95 → 9a46e61 (forwards/closes), b9433be → dc38190 (peers). No refactor commits needed.

## Notes for the Orchestrator

- REQUIREMENTS.md intentionally untouched: NODE-01 completes with the console pages (03-06); marking now would be premature (03-01 precedent).
- STATE.md / ROADMAP.md untouched per worktree-mode contract.

## Self-Check: PASSED

All 10 created files exist; all 5 task commits (b071f95, 9a46e61, 954f461, b9433be, dc38190) present in git log.
