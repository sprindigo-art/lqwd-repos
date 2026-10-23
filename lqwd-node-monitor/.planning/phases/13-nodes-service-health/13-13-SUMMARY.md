---
phase: 13-nodes-service-health
plan: 13
subsystem: node-detail-peers
tags: [peers, node-detail-redesign, gap-closure, liquidity-gauge, interconnection, pagination]
requires:
  - "src/lib/console/peers.ts (peersTabData → channel counterparties, PeerRowView, FLAP_COUNT_LIFETIME_NOTE)"
  - "src/lib/read/liquidity-split.ts (aggregateLiquidityByPeer, PeerLiquiditySplit — 13-10)"
  - "src/lib/read/latest.ts (latestChannelsForNode + projectChannelBaseline — AFM-001)"
  - "src/components/node/LiquidityGauge.tsx (G4 neutral gauge, size=sm — 13-10)"
  - "src/components/node/NodeDetailTabs.tsx (active=peers sub-nav — 13-10)"
  - "src/lib/console/paginate.ts (parsePageParam + slicePage — 13-11)"
  - "src/components/df/NavRailShell.tsx (single-surface chrome)"
  - "src/lib/scorecard/fleet.ts (loadFleetView + latestNodeInfoFallback, PERF-01 no-404)"
provides:
  - "/[pubkey]/peers RSC sub-route — paginated channel-partner table with per-peer gauge + focus highlight"
  - "NodePeersTable — peers table composing LiquidityGauge(sm) + peer→channels links"
affects:
  - "closes G1 (peers off the heavy single-scroll), G2 (peer ↔ channels interconnection), G4 (per-peer gauge)"
  - "the (future) /[pubkey]/channels?peer=&focus= route is the interconnection target of every peer row"
tech-stack:
  added: []
  patterns:
    - "peers = CHANNEL COUNTERPARTIES via peersTabData, never a COUNT over the lnd_node_peer_info lifetime log (Pitfall 5)"
    - "per-peer routable split derived from real channel rows (aggregateLiquidityByPeer), honest-empty gauge when unknowable"
    - "two-gate validation (PUBKEY_RE before read → notFound; node resolved before render) mirrors 13-09/13-08"
    - "?focus PUBKEY_RE-validated; the focused peer's page is computed so its highlight is on the shown page; pager preserves ?focus"
    - "focus highlight + peer link are NEUTRAL / navy-structural — never a severity hue (DS-01 color law)"
key-files:
  created:
    - "src/components/node/NodePeersTable.tsx"
    - "src/components/node/NodePeersTable.test.tsx"
    - "src/app/(overview)/[pubkey]/peers/page.tsx"
  modified: []
decisions:
  - "the per-peer gauge's local/remote lean is derived from latestChannelsForNode (aggregateLiquidityByPeer), NOT peersTabData — peersTabData carries per-peer capacity but not the routable split, so deriving from real channel rows keeps the lean honest (honest-empty when no split is derivable)"
  - "NodePeersTable keeps an optional `now?` prop for API parity with the other node tables even though peer rows carry no per-row freshness (flapcount is lifetime, not timestamped); left un-destructured to avoid an unused-var"
  - "focus wins over ?page: when a valid ?focus peer is a known partner, its computed page overrides the ?page frame so the highlight is always visible"
metrics:
  duration: ~7m
  completed: 2026-07-10
  tasks: 2
  files: 3
---

# Phase 13 Plan 13: Peers Sub-Route + Per-Peer Gauge Summary

Added the routed `/[pubkey]/peers` RSC sub-route: a paginated channel-partner table where every peer
row carries a capacity-weighted per-peer `LiquidityGauge` (built from that peer's real channel
local/remote sats) and links to that peer's channels — closing the redesign gaps G1 (peers off the
heavy single-scroll page), G2 (peer ↔ channels interconnection), and G4 (per-peer liquidity gauge).

## What shipped

- **`NodePeersTable`** (Server) — a df-grammar table with columns Partner / Alias / Channels /
  Capacity / Liquidity / Flaps. The Partner cell is a navy-structural `next/link` to
  `/{pubkey}/channels?peer={remotePubkey}` (G2). Each Liquidity cell composes `LiquidityGauge size="sm"`
  fed the peer's `{ localSat, remoteSat, capacitySat, localShare }` from the `aggregateLiquidityByPeer`
  Map — honest-empty gauge (no thumb) when a peer has no derivable channel split. The focused row
  (when `focus === remotePubkey`) gets a NEUTRAL `df-border-soft` highlight (never a severity hue).
  Flap count is surfaced with the lifetime label + `FLAP_COUNT_LIFETIME_NOTE` title (never as "recent").
  Honest-empty copy ("No channel partners to show.") when there are no partners.
- **`/[pubkey]/peers/page.tsx`** (`dynamic="force-dynamic"`, `revalidate=0`) — two-gate validation
  (PUBKEY_RE → `notFound()`; node resolved via `cache(loadFleetView)` + `latestNodeInfoFallback` →
  `notFound()`), then a fail-soft `Promise.all` of `peersTabData(pubkey)` + `latestChannelsForNode(pubkey)`.
  Channel rows are projected + folded into the per-peer split. `?focus` is PUBKEY_RE-validated (invalid
  ignored); the focused peer's page is computed so its highlight is on the shown page. Renders
  `NavRailShell` + `NodeDetailTabs active="peers"` + the honest "{num_peers} connected peers · showing
  {n} channel partners" headline + `NodePeersTable` + a Prev/Next pager that preserves `?focus`.

## Verification

- `npx vitest run src/components/node/NodePeersTable` — 7 passed (peer href, per-peer gauge, honest-empty
  gauge, single-row focus highlight, no-focus, honest-empty copy, lifetime flap label).
- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint` on all three new files — clean.

## Threat mitigations (from the plan's register)

- **T-13-13-01 (Tampering, pubkey/?focus):** PUBKEY_RE gate before any read; `?focus` PUBKEY_RE-validated,
  invalid silently ignored; `?page` clamped via `parsePageParam`.
- **T-13-13-02 (Spoofing, peer count):** peers derived from `peersTabData` channel counterparties, never a
  COUNT over `lnd_node_peer_info`.
- **T-13-13-03 (Info disclosure, per-peer liquidity):** split derived from real channel local/remote via
  `aggregateLiquidityByPeer`; honest-empty gauge when unknowable — no fabricated split.
- **T-13-13-SC (npm installs):** zero new packages installed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test assertion] Loosened the "never recent" flap assertion**
- **Found during:** Task 1 (test run)
- **Issue:** The test asserted the rendered HTML `not.toContain("recent")`, but the honest
  `FLAP_COUNT_LIFETIME_NOTE` title legitimately contains the substring "not recent activity", so the
  assertion failed on correct, honest output.
- **Fix:** Tightened the assertion to confirm the honest note IS present (`"not recent activity"`) and
  that no standalone `>recent<` label is rendered — preserving the intent (flaps never labelled as recent)
  without flagging the honest note.
- **Files modified:** src/components/node/NodePeersTable.test.tsx
- **Commit:** cb7e5e4

## Known Stubs

None — every rendered value flows from a real read (`peersTabData`, `latestChannelsForNode`) or an honest-empty
state. No hardcoded empty data reaches the UI.

## Self-Check: PASSED
- FOUND: src/components/node/NodePeersTable.tsx
- FOUND: src/components/node/NodePeersTable.test.tsx
- FOUND: src/app/(overview)/[pubkey]/peers/page.tsx
- FOUND commit: cb7e5e4 (Task 1 — NodePeersTable)
- FOUND commit: 0bb543f (Task 2 — peers sub-route)
