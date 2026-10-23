---
source: 13-08 operator visual gate (Task 3, blocking)
gate_outcome: gaps_found
date: 2026-07-09
supersedes: D-08 single-scroll Node Detail (operator override at live gate)
routes_to: /gsd-plan-phase 13 --gaps
---

# Node Detail (Screen B) — Operator Gate Feedback

The single-scroll Node Detail assembly (13-08) was rejected at the live operator visual gate.
8/9 Phase-13 plans are complete and merged; 13-08 Tasks 1–2 are committed but the plan is
NOT complete. The following gaps drive a Node-Detail redesign via gap-closure.

## Verbatim operator feedback

> page is too big for nodes change format to be a tabbed tables with pagination or add
> clicks and go to /pubkey/peers pubkey/forwards pubkey/channels etc. which ever will
> result in faster loading and responsiveness but regardless all should be interconnected
> so we can click a peer and see the channels if exists and from forwards to channels. I
> also see alignment issues for displaying information lots of dead space. also i want a
> slider like gauge for liquidity to make browsing easier so I can see if the slider is
> heavier for remote or local liquidity based on capacity

## Structured gaps

### G1 — Page too heavy; restructure for fast load + responsiveness
The single scroll renders header + VM vitals + service grid + Lightning + channels + active
signals + safety posture all at once. Break the heavy tabular data out — either dedicated
sub-routes (`/[pubkey]/channels`, `/[pubkey]/peers`, `/[pubkey]/forwards`) or in-page tabbed
tables with pagination — optimizing for fastest initial load + responsiveness. (Structural
choice locked separately — see decision below.)

### G2 — Everything must be interconnected (cross-navigation)
- Click a **peer** → see that peer's **channels** (if any exist).
- From a **forwarding** row → jump to the related **channel(s)**.
- Channels ↔ peers ↔ forwards are one connected graph, navigable by click.

### G3 — Layout/alignment: kill dead space
Information display has alignment issues and large dead space. Tighten the grid/alignment
so density is high and scannable (no fabricated content — honest-empty sections must still
read correctly, but should not waste whole rows/columns).

### G4 — Liquidity gauge (slider-style)
A slider/gauge visualization of channel liquidity so the operator can see at a glance whether
liquidity leans **local** or **remote**, weighted by capacity. Makes browsing/triage faster.
Applies per-node (aggregate) and is a strong candidate per-channel and per-peer too.

## Honest-empty limitations already surfaced at the gate (carry forward, not new gaps)
- VM vitals (B2): no per-host time-series reader exists → header + honest empty (no fabricated series).
- Node logs stream (B4): no per-node log reader exists → honest empty state.

## Locked structural decision (operator, 2026-07-09)
**Routed tabs + lean overview.**
- `/[pubkey]` = lean overview: header, VM vitals, service grid, **liquidity gauge (G4)**, summary counts.
- A tab bar (Channels / Peers / Forwards) navigates to **real RSC sub-routes**:
  `/[pubkey]/channels`, `/[pubkey]/peers`, `/[pubkey]/forwards` — each server-renders only its own
  data (fast initial load, code-split, deep-linkable), **paginated**.
- **Interconnection (G2):** channels row → peer; peers row → that peer's channels (if any);
  forwards row → related channel(s). One connected graph, navigable by click.
- The old single-scroll `/[pubkey]/page.tsx` (13-08 Tasks 1–2) is superseded by this overview;
  the `/[pubkey]/[tab]` redirect + CSV export path must be preserved.

## Next step (round 1)
`/gsd-plan-phase 13 --gaps` — plan the Node-Detail redesign (G1–G4) against this locked structure,
then `/gsd-execute-phase 13 --gaps-only`. — DONE (plans 13-10..15; redesign shipped).

---

# Round 2 — operator gate on 13-15 (redesign), 2026-07-10

Redesign (routed tabs + lean overview) is "close" but the operator returned 5 polish/routing gaps
at the 13-15 visual gate. Screenshot evidence: a sub-route (forwards) stat strip with a trailing
empty gray cell, and a channels table forcing an unnecessary horizontal scrollbar.

### G5 — Sub-route tables don't use full width → spurious horizontal scroll
The channels table (and likely peers/forwards) does not fill the available container width and
forces a horizontal scrollbar when the content fits. Tables should fill the width; horizontal
scroll only when columns genuinely overflow.

### G6 — Stat/summary strip has dead trailing cell(s)
The 4-stat strip (e.g. FORWARDS · ROUTED OUT · FEES EARNED · AVG FEE) renders inside a fixed
grid with an empty trailing gray cell. Stat cells must distribute to fill the row — no empty
placeholder gaps. Applies to the shared stat-strip pattern across overview + sub-routes.

### G7 — Peers table empty → populate (root-cause first)
The peers table shows empty. Determine WHY: is `peersTabData(pubkey)` returning [] for this node
(genuine no-peers → then verify a node WITH peers renders), or is there a reader/wiring bug in the
peers sub-route? Fix the bug if one exists; a node with channel-counterparty peers MUST render them.

### G8 — Ops Center (/) node alias not clickable
On the home Ops Center, a node's alias should be a clickable link to that node's `/{pubkey}`
detail page.

### G9 — "Overview" tab opens a modal, should go to the full page
Clicking the OVERVIEW tab (NodeDetailTabs) brings up a modal (the @modal intercepting route),
but it should navigate to the canonical full `/{pubkey}` overview page from the start.

## Next step (round 2)
Focused gap-closure for G5–G9 (mostly CSS/layout + routing + one data root-cause). Reuse existing
components; minimal targeted edits. Plans numbered from 13-16. — DONE (13-16/17/18).

---

# Round 3 — operator gate on 13-18, 2026-07-10

### G10 — Forwards table: add Fees Earned + Timestamp columns
The `/[pubkey]/forwards` table (`NodeForwardsTable`) shows CHAN IN / CHAN OUT / AMT OUT only.
Add a **Fees earned** column (per-forward fee, AFM-002 sats) and a **Timestamp** column (the
forward event time). Data is in the forwards reader (`forwardsPageData` / `forwardsTabData`);
if the fee/timestamp fields aren't projected yet, extend the reader (read-only) to carry them.

### G11 — Overview tab 404s on soft-nav (REGRESSION from G9)
Clicking OVERVIEW (or otherwise soft-navigating to `/[pubkey]`) yields a **404**, but a **hard
refresh loads the full page correctly**. Introduced by G9 (deleting `@modal/(.)[pubkey]/page.tsx`).
Symptom = the classic Next.js App Router **parallel-routes soft-navigation 404**: the `@modal`
parallel slot cannot reconcile a client-side transition to the `[pubkey]` dynamic segment; hard
navigation rebuilds from root `@modal/default.tsx` and succeeds. Root-cause against Next 16 docs
and apply the minimal correct fix (candidate: add `default.tsx` for the `@modal` slot at the
`[pubkey]` segment depth — and any sub-route depth that also 404s — so soft nav reconciles; verify
Overview + Channels/Peers/Forwards ↔ Overview soft-nav no longer 404s). This is a real bug, not
polish — treat with systematic debugging; confirm the fix by driving the soft-nav in the running app.

### G12 — Liquidity gauge is hard to see → add reference color (NOT severity)
The `LiquidityGauge`/`LiquidityBar` was built neutral/monochrome (grep-gated to no color), which
makes the local-vs-remote split hard to read. Give the two segments **distinguishable reference
colors** — operator suggestion: **blue (brand navy) for one side, grey for the other**. This is a
REFERENCE distinction, not health: do NOT use the severity ramp (no red/green — neither side is
good/bad). Navy is the sanctioned structural/reference hue (color law preserved); relax the
neutral-only grep gate to permit exactly the brand-navy + neutral-grey pairing (still no severity
hues). Applies to the aggregate gauge (overview) and the per-peer `size="sm"` gauges.

## Next step (round 3)
Focused gap-closure for G10 (forwards columns) + G11 (soft-nav 404 fix) + G12 (gauge reference
color). Plans from 13-19. "Rest looks great" per operator — G5–G9 accepted.
