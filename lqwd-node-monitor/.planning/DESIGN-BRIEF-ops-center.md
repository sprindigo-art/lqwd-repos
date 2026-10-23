# Design Brief: NodeMonitor — LQWD Fleet Operations Center (Evolution)

> Prompt for a Claude design session. Drop the fenced block below into claude.ai
> (artifacts) or a fresh Claude design chat. This is an IMPROVEMENT and EXPANSION
> of the in-progress NodeMonitor project — not a rebuild. Authored 2026-06-19.

---

```markdown
# Design Brief: NodeMonitor — LQWD Fleet Operations Center (Evolution)

## Your Role
You are a senior product designer + frontend architect designing the next
evolution of an existing, in-production internal tool. This is an IMPROVEMENT
and EXPANSION of a working platform — NOT a rebuild. You must inherit and
extend the existing design system exactly; do not reinvent the visual language.
Produce interactive HTML/CSS mockups (single-file, self-contained, no build
step) that I can open in a browser and click through.

## What Exists Today (inherit this)
NodeMonitor is a local-first node-operator control tool for LQWD's ~26-node
Lightning fleet (mixed LND routing nodes + LDK/LSPD nodes). It already ships:
- A **Fleet Triage** page: an attention-queue — an incident feed on top
  (breach text + a one-line "why"), with the healthy fleet collapsed below.
- A **per-node Console**: 3-slot header (one slot is data-freshness), a top
  "Active Signals" panel, a sticky left rail, evidence panels with sparklines.
- An **Inbox**: severity spine (triage-on-load) + collapsible facet rail +
  slide-in detail/act drawer. Routine fee work folds into per-signal → per-node
  counts so the queue stays readable.
- A **Pending Board**: totals strip + one collapsed row per node-with-pending;
  quiet nodes hidden, sweeps fold.
- **Inline command export**: high-risk actions (channel closes, rebalances) are
  exported as verify-step-first command blocks the operator copies and runs —
  the dashboard does NOT execute them.

Tech reality (design within it): Next.js App Router, React 19, Tailwind v4,
shadcn/ui, Recharts 3.x for charts. Maps cleanly to shadcn Sidebar + main + Sheet.

## The Expanded Mission
Grow NodeMonitor from a Lightning-node health/console tool into a full
**Fleet Operations Center** that monitors the entire stack behind the nodes and
eventually manages it. Four expansion pillars:

### 1. Full-stack monitoring (NEW breadth)
Monitor and surface health for everything, not just Lightning channels:
- **Lightning nodes** — LND routing + LDK/LSPD (already partly done; integrate).
- **Servers/hosts** — the VMs/machines the nodes run on (CPU, memory, load,
  uptime, disk I/O, network).
- **Services/daemons** — lnd, lit, tor, watchtowers, the gateway, the agent —
  up/down, restarts, version drift.
- **bitcoind** — sync %, block height vs. tip, mempool, peers, IBD state,
  reorg/stall detection.
- **Storage capacity** — disk usage and growth trend per host/volume; project
  time-to-full; flag chain-data volumes approaching limits.
Design how these layers compose: a host contains services; a service is a node;
a node has channels. The operator must be able to pivot fleet → host → service
→ node → channel and back without losing context.

### 2. Alerting & severity management (NEW)
- A severity model (critical / warn / ok / stale already exist as state colors).
- An alerts surface: active alerts, acknowledgement, snooze/mute, ownership,
  escalation, and a history/audit trail.
- Routing rules (which alerts page someone vs. sit in the inbox).
- De-duplication and grouping so one root cause (e.g. a host down) doesn't
  produce 8 channel alerts — show the causal rollup.

### 3. Node management controls (EXTEND the safe-action model)
Extend the existing signed-intent + command-export safety posture to:
- **Fees** — fee/policy updates (the already-supported signed-intent path).
- **Channels** — opens, closes, force-close handling.
- **Liquidity** — rebalances, inbound/outbound balance views, targets.
Honor the security posture absolutely (see Hard Constraints).

### 4. AI explanation layer (NEW)
An AI layer that reads logs and errors and:
- Explains what an error/log burst actually means in plain operator language.
- Triages: which signals deserve immediate human attention vs. noise.
- Correlates across layers ("bitcoind stalled on host-7 → these 3 nodes' HTLCs
  are at risk").
- Always advisory: the AI narrates and prioritizes; it NEVER generates the
  params that get signed/executed. It must be visually distinct from
  deterministic state, clearly labeled as AI, and dismissible/collapsible.

## Surfaces To Design (deliverables)
1. **Operations Center overview** — the new top-level home: fleet health across
   ALL layers (nodes, hosts, services, bitcoind, storage) as an attention queue,
   with the AI "what needs you now" summary at the top.
2. **Alerts console** — active/ack/history, grouping, severity management.
3. **Host/Infra detail** — a server's services, resources, storage trend.
4. **Node console (evolved)** — extend the existing console to include host +
   service health context and the AI log-explanation panel.
5. **AI insight panel** — the reusable explain/prioritize component, shown in
   context on multiple surfaces.
6. **Liquidity/channel management view** — balances, rebalance targets, the
   export-as-command flow for high-risk ops.
Mark a clear ★ winner where you present variants, and explain the tradeoffs.

## Visual Design System (USE THESE EXACT TOKENS — do not drift)
Theme: **NOC Light** (light mode is the primary and likely only mode). Navy is
STRUCTURE (chrome, active states, links, focus rings ONLY). Severity color is
STATE and appears NOWHERE else.

```css
:root{
  /* Surfaces */
  --color-bg:#eef1f7; --color-surface:#ffffff; --color-surface-2:#f4f7fc;
  --color-border:#d8dfeb; --color-border-strong:#b9c5da;
  /* Brand — structural only */
  --color-navy:#1a3c79; --color-navy-bright:#2c5cb4; --color-navy-glow:rgba(26,60,121,.15);
  /* Text — do NOT lighten this scale */
  --color-text:#0d1626; --color-text-muted:#34435e; --color-text-faint:#5a6880;
  /* Severity — state only */
  --color-critical:#d92638; --color-critical-dim:rgba(217,38,56,.08);
  --color-warn:#8f5d00;     --color-warn-dim:rgba(143,93,0,.09);
  --color-ok:#0b8a51;       --color-ok-dim:rgba(11,138,81,.08);
  --color-stale:#5d6a80;    --color-stale-dim:rgba(107,118,137,.10);
  --color-pending:#2c5cb4;
  /* Type */
  --font-display:"Saira Semi Condensed","Archivo",system-ui,sans-serif;
  --font-mono:"IBM Plex Mono","JetBrains Mono",monospace;
  --font-body:"Inter",system-ui,sans-serif;
  --text-xs:.72rem; --text-sm:.85rem; --text-base:1rem; --text-lg:1.15rem;
  --text-xl:1.35rem; --text-2xl:1.7rem;
  /* Spacing */ --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-6:24px;--space-8:32px;
  /* Shape — tight radii, instruments not bubbles */ --radius-sm:3px;--radius-md:6px;--radius-lg:10px;
  --shadow-panel:0 1px 2px rgba(22,32,47,.06),0 4px 16px rgba(22,32,47,.07);
}
```

Visual grammar (NON-NEGOTIABLE — this came out of a gate rejection, "signals and
grade were feeling all one… hideous"):
- **IBM Plex Mono** carries all data and labels; **Saira Semi Condensed** carries
  display headers; **Inter** is body text.
- **No emoji, no colored dots, no icons for state.** State is plain UPPERCASE
  MONO text (e.g. `CLOSE STORM`, `UNREACHABLE`, `SYNCING`) and grade letters in
  severity-tinted chips.
- Percentages live in tooltips; only the composite header shows an inline %.
- **Physically separate concerns** — signals must be visually severed from
  grades/metrics; do not blend them into one mushy block.
- Tight radii (3/6/10px), hairline borders, mono-first density. Dense but
  disciplined — a NOC wall, not a consumer dashboard.
- No animation for state changes; calm, instrument-like.

## Hard Constraints (security & truth — never violate)
- **Dashboard holds ZERO node credentials** and never silently mutates the fleet.
- High-risk actions (closes, rebalances) are **exported as signed/verify-first
  commands a human runs** — the UI must make this posture obvious, not hide it.
- Fee/policy changes go via **signed, operator-approved intents** (show the
  approval + signing step in the flow).
- The **AI layer is advisory only** — it explains and prioritizes; it must never
  produce executable params. Label it, separate it, make it dismissible.
- **Honest states** — never fake a command or hide a "no data / stale / unknown"
  state. Stale data owns its own freshness indicator.

## How To Work
1. Start by restating your understanding of the IA: how the layers
   (fleet → host → service → node → channel) compose and how the operator pivots.
2. Propose the navigation/shell model (sidebar + main + drawer), then the
   Operations Center overview, then drill-downs.
3. Build self-contained interactive HTML mockups using the tokens above. Make
   them clickable enough to feel the triage flow.
4. For each surface, give 1–2 variants, mark the ★ winner, justify it against the
   mission ("spot what's wrong fast") and the constraints.
5. Call out open questions for me (the operator) rather than guessing on
   anything that affects safety or severity semantics.

Begin with the IA restatement and the Operations Center overview.
```
