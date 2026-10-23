# Phase 2: Fleet Overview + Health Scorecard - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers the operator's **"where do I look first" entry point**: a fleet overview listing every node with at-a-glance health + a freshness stamp, a per-node **10-dimension health scorecard** computed from the warehouse, and **cross-node comparison** against per-backend fleet-median bands. It builds entirely on the Phase 1 read layer (`UnifiedNode`, the AFM-001 `DISTINCT ON` helper, the AFM-002 formatter) — it does not modify the read foundation.

**In scope:** FLEET-01, FLEET-02, FLEET-03 — fleet overview, 10-dimension scorecard, per-backend median/outlier comparison, per-node freshness. First real UI phase (adds shadcn/ui). Scorecard numbers validate against known `lqwdLogs` reference values for ≥1 reference node (success criterion 4).

**Not in scope:** Per-node console / channels / forwards / closes detail (Phase 3); pending-channel monitor (Phase 3); the recommendation-card insight engine + AP-11/AP-12/force-close/fee detectors (Phase 4); any write path, export, or queue (Phases 5–6). Log-fed scorecard dimensions (PG health, stability, visibility) are surfaced as "no data" placeholders here — actual log ingestion is a future/out-of-scope data-pipeline effort.

**Key scope clarification — single warehouse:** Phase 2 reads **`routing_vm` only**. The operator is consolidating LDK-node monitoring **into** `routing_vm` (warehouse-side; tables stay unchanged, LDK rows simply appear within the existing `lnd_*` tables). The `ldk-lspd-main` warehouse / `dbLdk` client is **NOT a Phase 2 data source** (it stays wired from Phase 1 but unused here). No NodeMonitor-side work is needed to enable this; LDK rows appear automatically when present.
</domain>

<decisions>
## Implementation Decisions

### Dimension data-sourcing (FLEET-02)
- **D-01:** **Show all 10 dimensions; mark the gaps.** The 10 dimensions break down against `routing_vm` as: **solid (6)** — routing, revenue, liquidity, channel health, force-close prevention, restart (latest via `lnd_restart`); **partial** — peer (`peer_info`/`num_peers` available; flap-rate needs event history); **no warehouse source (3)** — stability (`[CRT]`/panic = logs), PG health (40001 conflicts = pg_stat/logs), visibility (observability coverage = meta). Dimensions with no warehouse source render an explicit **"no data — needs log ingestion"** state (greyed) and are **excluded from the rollup**. This keeps the documented 10-dimension contract intact + visible for Phase 4, is honest about gaps (project fail-loud ethos), and lights up later with zero schema churn.
- **D-02:** **Thresholds are planner-defined and explicitly NOT locked.** `lqwdLogs/_library` bands are a **starting reference, not a hard contract**. The operator expects to **tune thresholds over time** as more fleet data is collected to find what produces the best operating results (may vary by season/context). **Design implication (MANDATORY):** thresholds must live in **one central, easily-editable config** — per-dimension, and **per-backend (LDK vs LND)** since backends differ in services/recovery — so retuning never requires touching computation code or redeploying logic. Formulas compute raw numbers; the tunable threshold table turns them into grades/severity. (Phase 4's insight engine should read the same tunable bands.)

### Backend identification (LDK vs LND)
- **D-03:** **Operator config map** (e.g. env/config file: `pubkey → "lnd" | "ldk"`) identifies a node's backend. No alias-guessing, no dependency on a warehouse column (tables stay unchanged). Easy to update as the fleet changes.
- **D-04:** **Backend is a first-class node attribute, not just a UI badge.** LDK and LND differ in **commands** (`lncli` vs `lncmd`), **recovery procedures**, and the **resources/services running on the node**. Downstream phases key off this (Phase 5 export command type, Phase 7 node scripts), and per-backend threshold/severity lines (D-02, D-08) and per-backend median cohorts (D-11) all depend on it. Carry `backend` on the per-node model and surface it visibly in the UI.

### Scoring & display (FLEET-01 + FLEET-02)
- **D-05:** **Each dimension displays as color + letter grade + percentage + raw value** (e.g. `Revenue 🟢 B 88% — 84 PPM`). Color = instant scan; grade/% = detail; raw value = the evidence behind the judgment. (Chosen specifically because collapsing 10 dimensions into 3 colors alone is too vague.)
- **D-06:** **Node rollup = composite grade/% + reason subtext + a SEPARATE critical chip.** The node's overall health is a composite grade/percentage (default: **unweighted average of the *available* dimensions**, no-data dimensions excluded; weighting is a later tuning option, not v1). A short **reason subtext** names the dominant driver in plain English (e.g. *"Yellow — low revenue"*, *"Yellow — high inactive channels"*). The reason = the **critical breach if one exists, otherwise the lowest-grade non-healthy dimension.**
- **D-07:** **Critical is a separate, un-averaged signal — red is reserved for genuinely critical breaches.** A node row carries a color dot (🟢🟡🔴) AND the grade. **A node is 🔴 only if ≥1 dimension hits Tier-1 critical**; warn-level issues cap at 🟡 (never red on their own); 🟢 when all-clear. A Tier-1 breach surfaces as a **distinct critical chip** (e.g. `🔴 critical: fee crash`) that is NOT folded into the composite grade — so a critical problem is never diluted by 9 healthy dimensions, and a minor issue never fakes a critical. Hard requirement from operator: *"we certainly can't have any issue lead to a red badge making it appear critical."*
- **D-08:** **The critical-vs-warn severity line is per-dimension, planner-defined, and tunable**, anchored to the operator's own `lqwdLogs/_library` severity taxonomy: **Tier-1 ("page immediately")** breaches (force-close storm/AP-11, fee crash, node unreachable, PG FATAL) are the **only** ones that can turn a node red; **Tier-2/3 ("investigate/digest")** breaches cap at yellow. May differ per-backend (LDK vs LND).
- **D-09:** **Overview sort order: criticals first, then by grade** (worst grade first) — triage order for a "where do I look first" tool.

### Cross-node comparison (FLEET-03)
- **D-10:** **Compare on BOTH axes: absolute band AND peer-relative median.** Each dimension keeps its absolute grade (from D-02 tunable thresholds) and *additionally* gets a peer-relative read. This surfaces two distinct problems: "this node is unhealthy" (absolute) and "this node is worst-vs-peers" (relative) — e.g. a node inside its absolute band but worst-in-fleet on revenue.
- **D-11:** **Per-backend cohort.** Compare LND nodes vs the LND median, LDK vs the LDK median (respects the LDK/LND separation, D-04). **Small-cohort suppression:** when a cohort is too small for a stable median (LDK is currently ~1 node), suppress the comparison and show **"no peer baseline yet"** — consistent with the mark-the-gaps approach (D-01).
- **D-12:** **Outlier = median-absolute-deviation (MAD) based.** Flag a node when it's more than **N MADs** from the cohort median (**N tunable**). Chosen over percentile/worst-N because MAD is robust to skew/small noisy samples and — critically — does **not** always flag someone (if the whole cohort is tight, nobody is an outlier). The outlier surfaces as a **separate "outlier / worst-in-fleet" marker** (can feed the reason subtext, D-06) and does **NOT** alter the absolute grade — same two-separate-signals philosophy as D-07.

### Freshness (FLEET-01)
- **D-13:** **Per-node worst-case freshness stamp + stale flag.** Each node shows one "data as of" = the **OLDEST of the latest timestamps** across the tables its scorecard depends on (the honest staleness floor — the grade is only as fresh as its stalest input). Past a **tunable staleness threshold**, the node gets a **"stale" marker** so the operator knows the grade rests on old data; the node is still shown, not hidden. (Honest, matches the fail-loud ethos and sets up Phase 6's stale-data approval block.) Tables are event-driven at different cadences (e.g. `lnd_node_info` snapshot vs `lnd_node_channel_info` ~3.7/day), so per-node worst-case is the correct granularity.

### Reference-node validation (success criterion 4)
- **D-14:** Validate computed scorecard numbers against known `lqwdLogs` reference values for **≥1 known node** before any downstream phase consumes them. Reuse the Phase 1 reference set rationale: **Canada** (best-documented correctness anchor) at minimum; optionally a Tier-M node + an edge node (Phase 1 D-04). Exact node(s) + which `_library` doc supplies the reference values is a planning detail — Canada is the safe anchor.

### Claude's Discretion
- shadcn/ui setup specifics (init, which components, `npx shadcn@latest`), navy `#1A3C79` theming via `@theme`, Recharts wiring if any small viz is used — implement per the stack already pinned in this repo's `CLAUDE.md` and matching sibling `lqwdclaw` conventions.
- Exact composite-grade math (the unweighted-average default in D-06 is the v1 baseline; planner may expose a weight hook but must not ship weighting on by default).
- The precise warehouse table+column mapping for each of the 6 solid + 1 partial computable dimensions, and the time windows used (e.g. 7d revenue vs 24h PPM) — planner/researcher to map from the warehouse schema, honoring AFM-001 (`DISTINCT ON` for event-driven tables) and AFM-002 (formatter for all sat/BTC/fee), grounded in `_library` formula guidance.
- Default values for all tunable knobs (per-dimension thresholds, severity Tier lines, MAD N, staleness threshold) — pick reasonable starting values from `_library`; they are config, not contract (D-02).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Paths are relative to the project root (`/Users/joshuajackson/Desktop/LQwD/ClaudeCode/NodeMonitorDashboard`); `../` points into the parent `ClaudeCode/` workspace.

### Project planning (in-repo)
- `.planning/PROJECT.md` — project context, constraints, locked decisions, warehouse table list
- `.planning/REQUIREMENTS.md` — FLEET-01/02/03 with acceptance criteria
- `.planning/ROADMAP.md` §"Phase 2" — goal + success criteria + coupling note ("AFM-001/002 re-verified at Phase 2")
- `.planning/phases/01-foundations-read-layer/01-CONTEXT.md` — Phase 1 decisions carried forward (reference set D-04/D-05/D-06, unified model, AFM guards)
- `/Users/joshuajackson/.claude/plans/vast-popping-starlight.md` — full approved design spec (scorecard = Component 2)

### Research (in-repo, this project)
- `.planning/research/SUMMARY.md` — synthesized findings
- `.planning/research/STACK.md` — Recharts 3.x, shadcn `chart` block, version pins (this is the first phase that uses charts/shadcn)
- `.planning/research/PITFALLS.md` — AFM-001/AFM-002 detail (re-verified here)
- `.planning/research/ARCHITECTURE.md` — read-layer trust boundary

### Scorecard formulas, thresholds & severity (parent workspace — REFERENCE not contract, per D-02)
- `../lqwdLogs/_library/healthy-range-bands.md` — per-subsystem healthy bands (revenue PPM 30–150, inactive-channel ratio <8%, restart 0–2/mo, coop-close REMOTE share, rebalance success, etc.); many flagged **provisional/Canada-only** — starting values only
- `../lqwdLogs/_library/cross-node-monitoring-matrix.md` — **Tier 1 (page) / Tier 2 (investigate) / Tier 3 (digest)** severity taxonomy → the anchor for the critical-vs-warn line (D-07/D-08); fee-PPM-crash + AP-11 close-storm critical thresholds
- `../lqwdLogs/_library/operational-anti-patterns.md` — AP-11 close-storm (≥50/hr), AP-12a/AP-12b definitions (severity inputs; full detectors are Phase 4)
- `../lqwdLogs/_library/lqwd-fleet-tuning-standard.md` — fleet tuning standard (fee/policy norms feeding revenue + fee dimensions)
- `../lqwdLogs/_library/data-gap-inventory.md` — **which signals are NOT in the warehouse** (PG lock-contention, OS resources, full restart history, mission control, Tor) — the basis for D-01's "no data" dimensions
- `../lqwdLogs/_library/analytical-failure-modes.md` — AFM-001/AFM-002 reproductions (must re-honor when computing dimensions)

### Existing read-layer code (in-repo — build on, don't modify)
- `src/lib/read/nodes.ts` — `UnifiedNode`, `mapLndNode`/`mapLdkNode`, per-backend boundary. **Note (D-04):** for Phase 2, LDK rows arrive via `routing_vm` (`lnd_*` shape) → effectively `mapLndNode`; the `ldk-lspd-main` `mapLdkNode` path is unused here. The `backend` label becomes a config-driven attribute (D-03), not a function of which warehouse was read.
- `src/lib/read/latest.ts` — the sanctioned AFM-001 `DISTINCT ON (chan_id)` latest-state helper; use for any latest-channel-state read
- `src/lib/format/units.ts` — AFM-002 formatter (`feeMsatToSat`, `formatSats`, `formatBtc`); ALL sat/BTC/fee rendering routes through it
- `src/lib/db/schema/routing.ts` — curated `routing_vm` schema; only `lnd_node_channel_info` + `lnd_node_info` typed so far. **Phase 2 must type the additional tables it consumes** (`lnd_node_forwards`, `lnd_node_closed_channels`, `lnd_restart`, `lnd_node_peer_info`, `internal_rebalance_invoices`) — identity columns + AFM-001 semantics already annotated inline in that file.
- `src/lib/db/warehouse-routing.ts` — the read-only `dbRouting` client (Phase 2's only data source)
- `src/app/(status)/page.tsx` — the thin Phase-1 status page; pattern reference (Server Component, `force-dynamic`, navy styling) for the overview, but Phase 2 replaces it with the real UI

### Stack convention (parent workspace)
- `../lqwdclaw/package.json` — exact stack versions to match (Next.js 16, React 19, shadcn, Tailwind v4, Recharts)
- `CLAUDE.md` (this repo) — full pinned stack + the §"Stack Patterns" for Recharts/shadcn/`'use client'` chart rules

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`UnifiedNode` + mappers** (`src/lib/read/nodes.ts`): the per-node shape the overview iterates. Extend with a `backend` attribute (D-03/D-04) and the scorecard fields; keep balances RAW sats (formatter at render).
- **AFM-001 latest helper** (`src/lib/read/latest.ts`): mandatory for any latest-channel-state read feeding channel-health/liquidity dimensions.
- **AFM-002 formatter** (`src/lib/format/units.ts`): mandatory for every sat/BTC/fee value rendered in the scorecard/overview.
- **Phase-1 status page** (`src/app/(status)/page.tsx`): Server-Component + `force-dynamic` + navy table pattern to mirror.

### Established Patterns
- **Read-only, server-only:** all DB access is server-side via `dbRouting`; `import "server-only"` guards; charts (Recharts) must be `'use client'` wrappers fed plain serializable data from Server Components (per `CLAUDE.md` §Stack Patterns).
- **AFM-001 / AFM-002 guards re-verified at Phase 2** (ROADMAP coupling note) — the scorecard computes on top of them.
- **Tunable config over magic numbers** (D-02): thresholds/severity lines/MAD-N/staleness all live in one editable config, per-dimension + per-backend.

### Integration Points
- Single data source: `dbRouting` → `routing_vm` (LND + consolidated LDK rows). `dbLdk`/`ldk-lspd-main` not used in Phase 2.
- New: a scorecard computation layer (formulas → raw values), a tunable threshold/severity config, a per-backend median/MAD comparison layer, and the overview + scorecard UI (shadcn/ui, navy theme).
- Forward contract: the scorecard's dimension definitions + severity taxonomy feed Phase 4's recommendation-card engine (it should read the SAME tunable bands).

</code_context>

<specifics>
## Specific Ideas

- Overview row, concrete shape the operator described: **color dot + grade + % + reason subtext + (conditional) critical chip** — e.g. `France — 🔴 C 68% — "critical: fee crash"`, `Sweden — 🟡 B 84% — "low revenue"`, `Canada — 🟢 A 91%`.
- Operator's hard rule (verbatim intent): a minor/non-critical issue must **never** make a node look critical (red); red = Tier-1 only. Granularity (grade/%) was explicitly requested because 3 colors alone are "too vague given all the dimensions."
- LDK/LND separation is **operationally meaningful** (different commands, recovery, services), not cosmetic — keep it first-class through the model and into later phases.
- Thresholds are a living tuning surface, not a fixed spec — the operator intends to iterate on them with accumulating data.

</specifics>

<deferred>
## Deferred Ideas

- **Log-fed dimensions actually computed** (PG health 40001 conflicts, stability `[CRT]`/panic, visibility/observability coverage, full restart-history attribution): require log/`pg_stat` ingestion not present in the warehouse (`data-gap-inventory.md`). Surfaced as "no data" placeholders in Phase 2; real ingestion is a future data-pipeline effort, out of Phase 2 scope.
- **Peer flap-rate dimension at full fidelity:** needs per-peer disconnect event history (event-driven); Phase 2 uses what `lnd_node_peer_info`/`num_peers` provides and marks the limitation.
- **Weighted composite grade:** v1 ships unweighted average (D-06); per-dimension weighting is a later tuning enhancement.
- **Recommendation cards / AP-11/AP-12/force-close/fee detectors / triage inbox:** Phase 4 (the scorecard severity taxonomy here is the input, not the detectors).
- **Per-node console detail + pending-channel monitor:** Phase 3.
- **Size-tier cohorts (XL/Tier-M/edge) for comparison:** considered; Phase 2 uses per-backend cohorts (D-11). Tier-aware comparison can be revisited if per-backend proves too coarse.

None of the above is scope creep — all surfaced as boundary clarifications and routed to their owning phase/effort.

</deferred>

---

*Phase: 2-Fleet Overview + Health Scorecard*
*Context gathered: 2026-06-09*
