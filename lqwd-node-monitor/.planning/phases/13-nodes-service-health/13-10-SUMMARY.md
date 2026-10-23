---
phase: 13-nodes-service-health
plan: 10
subsystem: node-detail
tags: [liquidity, gauge, nav, node-detail, gap-closure, G1, G2, G4, DS-01]
requires:
  - src/lib/read/latest.ts (ChannelBaseline)
  - src/lib/format/units.ts (formatSats, formatPercent — AFM-002)
provides:
  - aggregateLiquidity + aggregateLiquidityByPeer (pure G4 aggregators)
  - LiquidityGauge (neutral capacity-weighted local/remote slider — lg + sm)
  - NodeDetailTabs (shared Overview/Channels/Peers/Forwards sub-nav)
affects:
  - wave-2 Node-Detail sub-routes (/[pubkey]/channels|peers|forwards) — consume NodeDetailTabs
  - wave-3 lean overview (/[pubkey]) — composes LiquidityGauge + NodeDetailTabs
tech-stack:
  added: []
  patterns:
    - pure DB-free/clock-free aggregator (mirrors node-services.ts) — no-DB vitest
    - renderToStaticMarkup render tests (dep-free, no jsdom) — mirrors NodeFeeEnqueue.test.tsx
    - neutral-only evidence chrome (DS-01 color law)
key-files:
  created:
    - src/lib/read/liquidity-split.ts
    - src/lib/read/liquidity-split.test.ts
    - src/components/node/LiquidityGauge.tsx
    - src/components/node/LiquidityGauge.test.tsx
    - src/components/node/NodeDetailTabs.tsx
    - src/components/node/NodeDetailTabs.test.tsx
  modified: []
decisions:
  - "localShare computed over ROUTABLE split local/(local+remote), not local/capacity — the gauge answers 'which way does routable liquidity lean' directly"
  - "localShare returns null (never 0/NaN) on empty — the gauge shows honest-empty instead of a fake centred 50% bar"
  - "capacity-weighting is inherent from summing raw sats — no per-channel ratio averaging (a tiny lopsided channel can't skew the node view)"
  - "active tab uses navy structural marker (df-brand) not usePathname — keeps NodeDetailTabs a Server Component"
metrics:
  tasks: 3
  files: 6
  tests: 19
  completed: 2026-07-09
requirements: [NODE-04]
---

# Phase 13 Plan 10: Node-Detail Shared Leaves (Liquidity Gauge + Tabs) Summary

Built the three wave-1 shared primitives the Node-Detail redesign depends on: the G4
capacity-weighted liquidity aggregators (pure), the neutral `LiquidityGauge` slider that
renders them, and the `NodeDetailTabs` nav strip that links the four routed surfaces — all
test-locked, no new dependencies.

## What was built

### Task 1 — Pure capacity-weighted liquidity aggregators (`liquidity-split.ts`)
`aggregateLiquidity(rows)` folds a node's `ChannelBaseline[]` into `{ localSat, remoteSat,
capacitySat, localShare }` in one pure pass; capacity weighting is inherent because summing
raw balances lets bigger channels contribute more. `aggregateLiquidityByPeer(rows)` keys the
same split per peer (adding `channelCount`) and **excludes null-pubkey rows** (a keyless
channel can't be honestly attributed — mirrors the AFM-001 NULL-key exclusion). `localShare`
is the routable share `local/(local+remote)`, returned as `null` (never `0`/`NaN`) when there
is no routable balance. Pure/DB-free/clock-free — runs in the no-DB vitest like
`node-services.ts`; returns raw sats (formatting is the component's job). Commit `06993e5`.

### Task 2 — `LiquidityGauge` component (G4)
A Server component taking `{ localSat, remoteSat, capacitySat, localShare, size?, label? }`.
Renders a horizontal track split into a local segment (left) and remote segment (right) sized
by `localShare`, a centre 50% reference mark, and a thumb at the local-share point so the
operator sees the lean at a glance. **Neutral-only** evidence chrome (df-muted / df-slate /
df-border / df-surface / df-faint) — no severity ramp, no navy-as-health (DS-01). Honest-empty
(`capacitySat === 0` or `localShare === null`) renders "No channel liquidity to report." with
**no thumb** — never a fabricated centred bar. `lg` renders the labelled overview block with a
sat legend; `sm` a compact inline variant for dense per-peer/per-channel rows. Sats via
`formatSats`, share via `formatPercent` (AFM-002 — no inline unit math). Commit `5ff6a52`.

### Task 3 — `NodeDetailTabs` shared nav strip (G1/G2)
A Server component taking `{ pubkey, active, counts? }` that renders the ONE tab bar shared by
the overview and every sub-route: Overview → `/${pubkey}`, Channels → `/${pubkey}/channels`,
Peers → `/${pubkey}/peers`, Forwards → `/${pubkey}/forwards`, all as `next/link`. The `active`
tab carries the navy structural marker (df-brand text + a brand underline, mirroring
NavRailShell's OperatorNav) — never a severity hue. `active` is a prop (not `usePathname`) so
it stays Server-safe. Optional `counts` render a mono badge beside Channels/Peers **only when a
real number is supplied** (undefined ⇒ no badge, never a fabricated 0). Commit `44e571d`.

## Verification

- `npx vitest run src/lib/read/liquidity-split src/components/node/LiquidityGauge src/components/node/NodeDetailTabs` → **3 files, 19 tests, all green**.
- `npx tsc --noEmit -p tsconfig.json` → clean.
- Neutral-color grep gate on `LiquidityGauge.tsx` → clean (no severity/brand class usage; comment tokens reworded so a literal grep passes).
- `npm run lint:noc-guard` → v2 surfaces clean.

## Threat model coverage

- **T-13-10-01** (info disclosure — liquidity math): aggregators return raw sats only; `formatSats`/`formatPercent` are the sole display path. Mitigated.
- **T-13-10-02** (spoofing — health via color): gauge is neutral-only, grep-gated; a lean can never masquerade as a severity state (DS-01). Mitigated.
- **T-13-10-SC** (tampering — npm installs): zero new packages; tests are dep-free (`renderToStaticMarkup`, no jsdom). Mitigated.

## Deviations from Plan

None — plan executed exactly as written. (One in-test regex was adjusted during Task 3 to be
attribute-order-independent, since React emits `aria-current` before `data-tab`; this is a test
authoring detail, not a behavior change.)

## Known Stubs

None. All three artifacts are fully wired: the aggregators compute over the real `ChannelBaseline`
shape, the gauge renders real props, and the tabs link the real sub-route paths. These are wave-1
leaves — the data wiring into the overview/sub-routes is the explicit job of wave-2/wave-3 plans.

## Self-Check: PASSED
