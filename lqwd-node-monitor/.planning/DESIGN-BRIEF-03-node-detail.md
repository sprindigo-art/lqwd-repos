# Design Brief 03: NodeMonitor — Node Detail page (sibling of the locked Ops Center overview)

> Run this in the SAME claude.ai/design project as the locked data-forward
> overview so it inherits the system. If it's a fresh chat, paste the locked
> overview's HTML first and tell it "match this exactly." Authored 2026-06-19.

---

```markdown
# Design: NodeMonitor "Node Detail" — sibling screen to the data-forward overview

## Your role & the hard constraint
Design ONE screen — the per-node detail page — as a self-contained, interactive
HTML/CSS file. This is a SIBLING of the already-locked "Operations Center —
Data-Forward" overview. MATCH THAT SYSTEM EXACTLY: same tokens, type pairing
(serif headline + sans body), navy chrome, teal "watch", semantic severity
ramp, left nav rail, freshness chips, and the card / inline-evidence-chart /
why-chain / honest-stale grammar. This is not a new look — it's the same product,
one level deeper. Light mode only.

## The product (recap)
NodeMonitor is LQWD Technologies' operations console for ~26 Lightning nodes.
The overview answers "what needs me across the fleet?" THIS screen answers
"is this one node — and everything running alongside it — healthy, and if not,
why?" The operator reaches it by clicking a node from the overview incident or
the node list.

## The architecture this page must reflect (4 layers)
Every node runs inside its own VM with a full stack:
1. The VM/host — compute (CPU, memory, disk).
2. Adjacent infrastructure services (shared deps): bitcoind, esplora, postgres.
3. The Lightning node itself (LND routing or LDK/LSPD).
4. Custom LQWD control services running alongside the node, each of which must be
   confirmed RUNNING and FUNCTIONING NORMALLY:
   aiLiquidityManager, internalRebalancer, Monitoring, nodeAuditor,
   addressBalances, channelAcceptor.
This page is the SINGLE PLACE to see all of it and the logs/tables that prove it.

## THE CENTERPIECE: the service-health grid (two-axis health)
The whole point of this screen. Every service shows TWO signals, never one:
- RUNNING — the process is alive / responding.
- FUNCTIONING NORMALLY — fresh heartbeat, recent successful run, no error spike.
A service is only "green" when BOTH are true. The dangerous state to make
UNMISTAKABLE is "up but dead": RUNNING = yes, FUNCTIONING = no (stale heartbeat /
failing runs). Never collapse the two into one dot.

Show the grid in two labeled groups — "Infrastructure" (bitcoind, esplora,
postgres) and "LQWD services" (the six custom ones). Each service tile shows:
its name, the two-axis state (clearly distinct), last heartbeat, last successful
run, error count in the window, and a tiny status strip. Clicking a tile reveals
that service's recent logs + an AI read of them inline.

## Page layout (top to bottom)
1. Node header — alias + truncated pubkey (mono), role (LND routing / LDK-LSP),
   the VM/host it runs on, overall health pill + freshness ("data fresh · 4s").
   A back-to-overview affordance.
2. VM vitals — CPU / memory / disk for this node's VM, as compact evidence charts
   (disk with a projected time-to-full if relevant). Same chart style as overview.
3. Service-health grid — the centerpiece above. Infrastructure group + LQWD group.
4. Logs / events — a stream filterable BY SERVICE (chips per service). Each notable
   error gets an inline AI explanation: what it means + does it need attention +
   how it relates to other services. AI is advisory only — it explains, never runs
   anything.
5. Lightning state — channels (active/pending), local/remote liquidity, fee policy,
   pending HTLCs — as the overview's evidence cards.
6. Active signals — this node's own incidents, using the SAME card + why-chain +
   export/runbook/investigate system as the overview.

## The scenario to render (continuity with the overview — important)
Design the detail page for **lqwd-rtr-04 · LND routing · host-03** — one of the
three nodes rolled up under the overview's "bitcoind on host-03 stalled" incident.
Clicking from that incident lands here, and the story must be legible:

Node header: lqwd-rtr-04, host-03, overall CRITICAL, data fresh 4s.

Service grid states (show a real mix so the two-axis design is exercised):
- Infrastructure:
  • bitcoind — CRITICAL: running but NOT functioning — stalled, 22 min behind tip.
  • esplora — WARNING: running, functioning DEGRADED — lagging behind bitcoind.
  • postgres — OK: running + healthy, low query latency.
- LQWD services:
  • Monitoring — OK.
  • nodeAuditor — OK, last audit 12 min ago.
  • channelAcceptor — OK, accepted 3 channels today.
  • internalRebalancer — OK but IDLE: holding off because the chain backend is stalled.
  • aiLiquidityManager — WATCH: running but intentionally PAUSED while bitcoind is
    stalled (won't act on unconfirmable state) — functioning "as designed, degraded".
  • addressBalances — the "UP BUT DEAD" showcase: RUNNING = yes, but FUNCTIONING =
    NO — heartbeat stale 2h, last successful run failed ("connection refused" ×14).
    Make this tile visibly alarming despite the process being "up".

Logs example (filtered to addressBalances): repeated "connection refused" to the
address-index DB; AI inline read: "addressBalances can't reach its index DB —
balances shown are ~2h stale; rebalance decisions would use stale data. Same
dependency chain as the host-03 stall. Not customer-facing."

Lightning state: pending HTLCs flagged at risk (can't confirm while bitcoind stalled).
Active signals: the host-03 stall (as this node's view of it) + the addressBalances
stale-data signal.

Use realistic values throughout; mono only for pubkeys/IDs/commands/timestamps,
tabular figures elsewhere.

## Interactions to make real
- Expand a service tile → its recent logs + the AI read.
- Filter the logs stream by service.
- Expand a node signal → its why-chain (same as overview).
- Where an action exists, the same adaptive control as the overview: Export fix
  (real one-liner), Open runbook (host-op steps), or Investigate (read-only).

## Guard rails (identical to the overview)
Light theme; LQWD navy #1A3C79 as brand anchor; severity ramp (critical/warning/
watch=teal) stays semantic and separate from navy; never Bitcoin orange; WCAG AA;
operator-grade legibility. Honest states everywhere — stale/no-data/unknown are
representable and never faked. AI explains and prioritizes only; it never emits a
runnable command.

## Deliver
Start with one short paragraph on the information hierarchy (what dominates, what
recedes) and how this screen continues the overview's story. Then the interactive
HTML. Call out the two-axis service grid as the centerpiece and explain how the
"up but dead" state is made unmissable. Then ask me what to push further.
```
