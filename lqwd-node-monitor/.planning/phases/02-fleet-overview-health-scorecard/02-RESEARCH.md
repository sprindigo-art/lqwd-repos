# Phase 2: Fleet Overview + Health Scorecard - Research

**Researched:** 2026-06-09
**Domain:** Warehouse-computed Lightning fleet health scoring + first UI phase (shadcn/ui over the Phase 1 read layer)
**Confidence:** HIGH (warehouse table+column mapping and reference values verified live against `routing_vm`; stack already pinned and proven in-repo)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 — Show all 10 dimensions; mark the gaps.** Breakdown vs `routing_vm`: **solid (6)** — routing, revenue, liquidity, channel health, force-close prevention, restart (latest via `lnd_restart`); **partial** — peer (`num_peers` available; flap-rate needs event history we don't have); **no warehouse source (3)** — stability (`[CRT]`/panic = logs), PG health (40001 = pg_stat/logs), visibility (observability coverage = meta). No-source dimensions render an explicit **"no data — needs log ingestion"** greyed state and are **excluded from the rollup**.
- **D-02 — Thresholds are planner-defined and explicitly NOT locked.** `lqwdLogs/_library` bands are a starting reference. **MANDATORY design implication:** thresholds live in **one central, easily-editable config — per-dimension AND per-backend (LDK vs LND).** Formulas compute raw numbers; the tunable table turns them into grades/severity. Phase 4's insight engine reads the same bands.
- **D-03 — Operator config map** (`pubkey → "lnd" | "ldk"`) identifies backend. No alias-guessing, no warehouse column dependency.
- **D-04 — Backend is a first-class node attribute, not just a UI badge.** Drives commands (`lncli` vs `lncmd`), recovery, per-backend thresholds (D-02/D-08), per-backend median cohorts (D-11). Carry `backend` on the per-node model; surface it visibly.
- **D-05 — Each dimension displays color + letter grade + percentage + raw value** (e.g. `Revenue 🟢 B 88% — 84 PPM`).
- **D-06 — Node rollup = composite grade/% + reason subtext + a SEPARATE critical chip.** Composite default = **unweighted average of the *available* dimensions** (no-data excluded; weighting deferred). Reason subtext = the critical breach if one exists, otherwise the lowest-grade non-healthy dimension.
- **D-07 — Critical is a separate, un-averaged signal — red is reserved for genuinely critical breaches.** A node is 🔴 **only if ≥1 dimension hits Tier-1 critical**; warn-level caps at 🟡; 🟢 all-clear. Tier-1 breach surfaces as a distinct critical chip NOT folded into the composite. Hard operator requirement: *"we certainly can't have any issue lead to a red badge making it appear critical."*
- **D-08 — Critical-vs-warn line is per-dimension, planner-defined, tunable**, anchored to the `lqwdLogs/_library` Tier-1/2/3 taxonomy. Only Tier-1 (force-close storm/AP-11, fee crash, node unreachable, PG FATAL) can turn a node red; Tier-2/3 cap at yellow. May differ per-backend.
- **D-09 — Overview sort: criticals first, then by grade** (worst grade first).
- **D-10 — Compare on BOTH axes: absolute band AND peer-relative median.** Surfaces "unhealthy" (absolute) vs "worst-vs-peers" (relative) separately.
- **D-11 — Per-backend cohort.** LND vs LND median, LDK vs LDK median. **Small-cohort suppression:** when a cohort is too small for a stable median (LDK currently ~1 node), suppress and show **"no peer baseline yet."**
- **D-12 — Outlier = median-absolute-deviation (MAD) based.** Flag when > **N MADs** from cohort median (N tunable). Surfaces as a separate "outlier/worst-in-fleet" marker; does **NOT** alter the absolute grade.
- **D-13 — Per-node worst-case freshness stamp + stale flag.** "Data as of" = the **OLDEST of the latest timestamps** across the tables the scorecard depends on. Past a tunable staleness threshold, show a "stale" marker; node still shown.
- **D-14 — Validate computed scorecard numbers against known `lqwdLogs` reference values for ≥1 known node** before any downstream phase consumes them. **Canada** is the safe anchor.

### Claude's Discretion

- shadcn/ui setup specifics (init, components, `npx shadcn@latest`), navy `#1A3C79` via `@theme`, Recharts wiring if any small viz is used — per the pinned stack in `CLAUDE.md`/`STACK.md` and sibling `lqwdclaw` conventions.
- Exact composite-grade math (unweighted-average default is the v1 baseline; may expose a weight hook but must NOT ship weighting on by default).
- Precise warehouse table+column mapping per dimension and time windows (e.g. 7d revenue vs 24h PPM) — honoring AFM-001 and AFM-002. **This research supplies that mapping below.**
- Default values for all tunable knobs — pick reasonable starting values from `_library`; they are config, not contract.

### Deferred Ideas (OUT OF SCOPE)

- **Log-fed dimensions actually computed** (PG health 40001, stability `[CRT]`/panic, visibility/observability, full restart-history attribution): need log/`pg_stat` ingestion not in the warehouse. "No data" placeholders only.
- **Peer flap-rate at full fidelity:** needs per-peer disconnect *event* history; Phase 2 uses `num_peers` + marks the limitation.
- **Weighted composite grade.**
- **Recommendation cards / AP-11/AP-12/force-close/fee detectors / triage inbox:** Phase 4.
- **Per-node console detail + pending-channel monitor:** Phase 3.
- **Size-tier cohorts (XL/Tier-M/edge):** Phase 2 uses per-backend cohorts (D-11).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLEET-01 | Fleet overview listing all nodes, at-a-glance health curated to operator-relevant signals (not a Grafana firehose), each with a freshness stamp. | §Architecture (overview row shape D-05/D-06/D-09), §Freshness (D-13 worst-case stamp — `lnd_node_info.timestamp` latest-per-node), §Dimension Map (the 6+1 curated signals). |
| FLEET-02 | Per-node 10-dimension health scorecard computed from the warehouse. | §Dimension Map (exact table+column+window+formula per dimension), §Tunable Config (grade bands), §D-01 no-data handling. |
| FLEET-03 | Compare each node against fleet-median bands (cross-node comparison). | §MAD Comparison Math (per-backend cohort, MAD outlier, small-cohort suppression), §Tunable Config (MAD N). |
</phase_requirements>

## Summary

Phase 2 is a **pure computation + first-UI phase** over the Phase 1 read layer. There is **no new external dependency and no new package to vet** beyond running `npx shadcn@latest` to scaffold UI primitives (card/table/badge/tooltip; chart only if a small viz is added). The entire stack is already pinned and production-proven in `CLAUDE.md`/`STACK.md` (Next 16.1.6 / React 19.2.3 / Tailwind v4 / shadcn 4 / Recharts 3.8.1 / Drizzle 0.45 / postgres.js 3.4).

The highest-value research — the **warehouse table+column→dimension mapping** — is complete and **verified live against `routing_vm`** (26 nodes, Canada anchor). All five tables Phase 2 must newly type were column-inspected directly; the §Dimension Map below gives exact tables, identity/timestamp columns, time windows, and raw formulas honoring AFM-001 (DISTINCT ON, never `MAX(timestamp)`) and AFM-002 (`fee_msat/1000.0`, sat→BTC discipline).

**One finding overrides a Phase 1 schema comment and is the single biggest landmine for Phase 2:** `lnd_node_info` is **NOT a snapshot** — it is append-only (8,055,099 rows / 26 nodes ≈ 310k rows per node; Canada alone has 371,545 rows). The inline comment in `src/lib/db/schema/routing.ts` ("TRUE SNAPSHOT (one current row per node) — safe to read directly, no DISTINCT ON needed") is factually wrong about the table's storage, even though the Phase 1 golden test happens to read it correctly via `ORDER BY timestamp DESC LIMIT 1` / `DISTINCT ON (pubkey)`. **Every Phase 2 read of `lnd_node_info` must take latest-per-node via `DISTINCT ON (pubkey) ORDER BY pubkey, timestamp DESC`** (or `ORDER BY timestamp DESC LIMIT 1` for a single node). A naive `SELECT * FROM lnd_node_info WHERE pubkey=$x` returns hundreds of thousands of historical rows.

**Primary recommendation:** Build a `src/lib/scorecard/` computation layer (one pure function per dimension returning a `{ raw, asOf }` result), a single `src/lib/scorecard/config.ts` tunable per-dimension × per-backend threshold/severity/MAD-N/staleness table (D-02), a `src/lib/scorecard/compare.ts` MAD cohort layer (D-11/D-12), and a `src/lib/scorecard/grade.ts` that turns raw→grade/color/critical-chip using the config. Wire it through Server Components into shadcn card/table UI with the navy theme. Validate Canada's computed numbers against the live reference values captured in §Reference-Node Validation before shipping (D-14, golden-test pattern reused from Phase 1).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Latest-state warehouse reads (channels, node_info, peers) | API / Backend (Server Component + `dbRouting`) | — | All DB access is server-only (`import "server-only"`); read-only role is the safety boundary. Charts/UI never touch the DB. |
| Dimension formulas (raw numbers) | API / Backend (`src/lib/scorecard/*.ts`, server-only) | — | Pure functions over warehouse rows; must honor AFM-001/AFM-002. No rendering, no thresholds — just raw values. |
| Grade/color/critical mapping | API / Backend (`grade.ts` reads `config.ts`) | — | Deterministic mapping raw→grade using tunable config. Same bands feed Phase 4. |
| Cross-node MAD comparison | API / Backend (`compare.ts`) | — | Needs the whole cohort; computed server-side once per fleet read. |
| Overview list + per-node scorecard rendering | Frontend Server (RSC) | Browser (interactive bits only) | RSC fetches + computes; passes plain serializable scorecard objects to thin client components. Recharts (if any) is `'use client'` only. |
| Freshness stamp + stale flag | API / Backend (compute) → Frontend (render) | — | Worst-case `asOf` computed alongside dimensions; rendered with the row. |
| Backend identity (`lnd`/`ldk`) | Config (`src/lib/config/backends.ts`) | API/Frontend (carries the attribute) | Config-driven map, not warehouse-derived (D-03). |

## Standard Stack

**No new dependencies required.** Everything is already in `package.json` or installed via the shadcn CLI. Confirmed against the in-repo `package.json` (read this session): `next@16.1.6`, `react@19.2.3`, `react-dom@19.2.3`, `drizzle-orm@^0.45.1`, `postgres@^3.4.8`, `tailwindcss@^4`, `@tailwindcss/postcss@^4`, `tw-animate-css@^1.4.0`, `clsx@^2.1.1`, `tailwind-merge@^3.5.0`, `lucide-react@^0.577.0`, `vitest@^4`.

### Core (already present)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.1 | Typed query builder over `routing_vm` | Phase 1 foundation; used as read-only query builder, never schema owner. [VERIFIED: in-repo package.json] |
| postgres (postgres.js) | ^3.4.8 | Read-only `dbRouting` client | Phase 1 foundation; Phase 2's ONLY data source. [VERIFIED: in-repo package.json] |
| next / react / react-dom | 16.1.6 / 19.2.3 / 19.2.3 | RSC fetch + UI | Workspace standard. [VERIFIED: in-repo package.json] |
| vitest | ^4 | Golden reference-node test (D-14) | Phase 1 test runner; `vitest run` already wired. [VERIFIED: in-repo package.json] |

### Supporting (install via shadcn CLI — components, not npm deps)
| Component | Install | Purpose | When to Use |
|-----------|---------|---------|-------------|
| shadcn primitives | `npx shadcn@latest init` then `npx shadcn@latest add card table badge tooltip` | Overview table + per-node scorecard cards + grade/critical badges + freshness tooltip | Always — this is the first UI phase. [CITED: ui.shadcn.com/docs/tailwind-v4] |
| shadcn `chart` (optional) | `npx shadcn@latest add chart` | Only if a small sparkline/bar viz is added to the scorecard | Optional per D-05 discretion; pulls in Recharts (already pinned). [CITED: ui.shadcn.com/docs/charts] |

**Installation:**
```bash
# UI scaffold only — no package.json dependency additions for the compute layer
npx shadcn@latest init          # canary NO LONGER required (Tailwind v4 + React 19 are GA)
npx shadcn@latest add card table badge tooltip
# npx shadcn@latest add chart    # only if a viz is used
```
`npx shadcn@latest` (init/add) writes component source into the repo and may add `class-variance-authority` + (for chart) `recharts` to `package.json` — both already in the pinned stack. No additional registry packages are introduced.

## Package Legitimacy Audit

> Phase 2 installs **no new npm registry packages.** The shadcn CLI copies component source into the repo; any transitive deps it pulls (`class-variance-authority`, `recharts`) are already in the pinned, production-proven workspace stack (`lqwdclaw`). slopcheck/registry verification is therefore N/A for this phase — there is nothing new to audit.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none — UI scaffolded via shadcn CLI; no new registry installs) | — | N/A |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs)
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         routing_vm  (read-only, role nodemon_ro / grafana_demo_ro)
                              │  26 nodes, append-only event tables
                              ▼
                  dbRouting  (src/lib/db/warehouse-routing.ts, server-only)
                              │  raw rows
            ┌─────────────────┴───────────────────────────────────────┐
            ▼                                                           ▼
  AFM-001 latest helpers                                    backend config map
  (DISTINCT ON per identity)                                (src/lib/config/backends.ts)
  - latestChannelsForNode (chan_id)   [exists]                pubkey → "lnd"|"ldk"  (D-03)
  - latestNodeInfo (pubkey)           [NEW - landmine]              │
  - latestPeersForNode (peer_pubkey)  [NEW, lifetime]              │
            │                                                       │
            ▼                                                       │
  src/lib/scorecard/*.ts  (server-only, pure)                      │
  one fn per dimension → { raw, asOf }   (AFM-002 in formulas)     │
  routing | revenue | liquidity | channelHealth |                  │
  forceClose | restart | peer(partial)                             │
            │                                                       │
            ▼                                                       ▼
  src/lib/scorecard/grade.ts  ◄────────  src/lib/scorecard/config.ts
  raw → grade/%/color + critical-chip      per-dimension × per-backend (D-02)
  (D-05/D-06/D-07/D-08)                     bands, Tier-1 severity, MAD N, staleness
            │
            ▼
  src/lib/scorecard/compare.ts   (per-backend cohort MAD, D-10/D-11/D-12)
  fleet[] → each node + {absoluteGrade, peerRelative, isOutlier, cohortSuppressed}
            │
            ▼
  app/(overview)/page.tsx  (RSC, force-dynamic)  ── sort: criticals first, then worst grade (D-09)
            │  plain serializable ScorecardView[]
            ▼
  shadcn card/table/badge  (+ optional 'use client' chart wrapper, navy @theme)
            │
            ▼
  app/(overview)/[pubkey]/  per-node 10-dimension scorecard view (still Phase 2)
```

### Recommended Project Structure
```
src/
├── lib/
│   ├── config/
│   │   └── backends.ts        # D-03 pubkey→backend map (env-overridable); Backend type re-exported
│   ├── read/                  # Phase 1 — extend with latest helpers, DO NOT modify existing contracts
│   │   ├── latest.ts          # [exists] latestChannelsForNode
│   │   ├── node-info.ts       # [NEW] latestNodeInfo / latestNodeInfoAll (DISTINCT ON pubkey)
│   │   └── peers.ts           # [NEW] latest peer rollup (lifetime cumulative — see §Dimension Map)
│   ├── scorecard/
│   │   ├── config.ts          # D-02 tunable: per-dimension × per-backend bands + Tier-1 lines + MAD N + staleness
│   │   ├── dimensions/        # one pure fn per dimension → { raw, asOf } (AFM-002 inside)
│   │   │   ├── routing.ts  revenue.ts  liquidity.ts  channel-health.ts
│   │   │   ├── force-close.ts  restart.ts  peer.ts
│   │   ├── grade.ts           # raw → grade/%/color; D-06 composite; D-07 separate critical chip
│   │   ├── compare.ts         # D-10/D-11/D-12 per-backend cohort + MAD outlier + suppression
│   │   └── types.ts           # DimensionResult, ScorecardView, FleetView contracts
│   └── format/units.ts        # [exists] AFM-002 — MANDATORY for all sat/BTC/fee
├── app/
│   └── (overview)/
│       ├── page.tsx           # FLEET-01 overview list (replaces Phase-1 (status)/page.tsx pattern)
│       └── [pubkey]/page.tsx  # FLEET-02 per-node 10-dimension scorecard
└── components/scorecard/      # shadcn-based: GradeBadge, CriticalChip, FreshnessStamp, DimensionRow
```

### Pattern 1: latest-per-node `DISTINCT ON (pubkey)` for `lnd_node_info` (THE landmine)
**What:** `lnd_node_info` is append-only (verified: 371,545 rows for Canada, 8.05M fleet-wide). Reading latest-per-node requires DISTINCT ON, not a direct read.
**When to use:** Every read of `lnd_node_info` in Phase 2 (channel counts, num_peers, balances, freshness stamp).
**Example:**
```sql
-- Source: live routing_vm verification, 2026-06-09. Mirrors src/lib/read/latest.ts AFM-001 idiom.
-- Whole-fleet latest snapshot, one row per node:
SELECT DISTINCT ON (pubkey) pubkey, alias, active_channels, inactive_channels,
       pending_channels, num_peers, local_channel_balance, remote_channel_balance, timestamp
FROM lnd_node_info
ORDER BY pubkey, timestamp DESC;
-- Single node: ... WHERE pubkey = $1 ORDER BY pubkey, timestamp DESC  (or ORDER BY timestamp DESC LIMIT 1)
```
**Build this as a sanctioned helper** (`src/lib/read/node-info.ts`) exactly like `latestChannelsForNode`, with `pubkey IS NOT NULL` guard, parameter-bound. Do not hand-write the DISTINCT ON at call sites.

### Pattern 2: dimension fn returns `{ raw, asOf }` — never a grade
**What:** Each dimension function computes only the raw number(s) + the source-data timestamp. Grading is a separate step that reads `config.ts`.
**When to use:** Every dimension. Keeps formulas (AFM-002 discipline) separate from tunable thresholds (D-02), so retuning never touches computation.
**Example:**
```typescript
// src/lib/scorecard/dimensions/revenue.ts  (server-only)
import { feeMsatToSat } from "@/lib/format/units";
export interface DimensionResult { raw: number | null; asOf: Date | null; note?: string; }
// 7-day fee revenue in sats. timestamp_ns is NANOSECONDS bigint (verified live).
export async function revenue7d(pubkey: string): Promise<DimensionResult> {
  // SUM(fee_msat)/1000.0 — AFM-002. NEVER raw `fee` column.
  // window: now - 7d in ns. asOf = MAX(timestamp_ns) for the node.
}
```

### Pattern 3: navy theme via `@theme`, charts `'use client'` only
**What/When:** Per `CLAUDE.md` §Stack Patterns and `STACK.md` §2/§3. Navy `#1A3C79` as a CSS variable in `globals.css` `@theme`; never hardcode Bitcoin orange `#F7931A`. Any Recharts component lives in a `'use client'` wrapper fed plain serializable props from an RSC, with a fixed-height container (avoid `ResponsiveContainer` SSR zero-size flash).

### Anti-Patterns to Avoid
- **Reading `lnd_node_info` without DISTINCT ON / LIMIT 1** → returns ~310k historical rows per node (the new AFM-001 trap for snapshot-looking-but-not tables).
- **Treating `lnd_node_peer_info` as a current-peer snapshot** → it is cumulative lifetime peer history (22,868 distinct peers ever seen for Canada; `flapcount` is lifetime). Current peer count = `lnd_node_info.num_peers`, not `COUNT(*)` of peer_info.
- **Using raw `fee` instead of `fee_msat/1000.0`** in `lnd_node_forwards` (both columns exist) → AFM-002 1000× error.
- **`WHERE timestamp = MAX(timestamp)`** on any event table → AFM-001.
- **Folding a Tier-2/3 issue into red** → violates D-07 (operator hard rule). Critical chip is separate and un-averaged.
- **Letting MAD outlier alter the absolute grade** → violates D-12 (two separate signals).
- **Importing Recharts/DB into a Server Component / `'use client'` boundary crossing of `dbRouting`.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest channel state | A new `MAX(timestamp)` query | Existing `latestChannelsForNode` (`src/lib/read/latest.ts`) | AFM-001 already sealed + WR-01 NULL-key guard. |
| Latest node_info | Direct `SELECT * WHERE pubkey` | NEW `latestNodeInfo` helper (DISTINCT ON pubkey) modeled on `latest.ts` | Append-only table; centralize the idiom so the trap can't reappear. |
| sat/BTC/msat math | Inline `/1e8`, `*1000`, raw `fee` | `feeMsatToSat`/`formatSats`/`formatBtc` (`src/lib/format/units.ts`) | AFM-002 single source of truth, already unit-tested. |
| Per-node model | A second node shape | Extend `UnifiedNode` (`src/lib/read/nodes.ts`) with `backend` + scorecard fields | One shape, both fleets (READ-04 contract). |
| UI primitives | Hand-built table/badge/card | shadcn `card`/`table`/`badge`/`tooltip` | Themed, accessible, matches `lqwdclaw`. |
| Median / MAD | A custom percentile lib | A ~15-line pure helper (formula below) | Trivial, no dependency; numpy-style robust stat is well-defined. |

**Key insight:** Phase 2 is mostly *correct SQL + simple statistics + tunable config*. The only genuinely error-prone parts are the AFM-001/AFM-002 disciplines (already solved by Phase 1 helpers — reuse, don't reimplement) and the new `lnd_node_info` append-only trap (build one new sanctioned helper).

## Dimension → Warehouse Map (THE core deliverable)

> All formulas honor AFM-001 (DISTINCT ON for event-driven tables; latest-per-node for `lnd_node_info`) and AFM-002 (`fee_msat/1000.0`; sat→BTC via formatter). Identity/timestamp columns verified **live** against `routing_vm` 2026-06-09. Time windows are starting values (tunable / discretion).

### Solid (6) — computed and rolled up

| # | Dimension | Table(s) | Identity col | Time col | Window | Raw formula | Notes |
|---|-----------|----------|--------------|----------|--------|-------------|-------|
| 1 | **Routing** | `lnd_node_forwards` | `lnd_pubkey` | `timestamp_ns` (BIGINT **nanoseconds**) | 7d | `COUNT(*)` forwards and/or `SUM(amt_out_msat)/1000.0` sats volume over `timestamp_ns > (epoch_now - 7d)*1e9` | `timestamp_ns` is ns since epoch — convert window to ns (`*1e9`). Verified: Canada 7d = 7,023 forwards, 739,079,154 sat volume. |
| 2 | **Revenue** | `lnd_node_forwards` | `lnd_pubkey` | `timestamp_ns` | 7d total + 24h PPM | 7d earnings = `SUM(fee_msat)/1000.0` sats. Fee-PPM (24h) = `SUM(fee_msat)::float / NULLIF(SUM(amt_in_msat),0) * 1e6` | **AFM-002: use `fee_msat`, never `fee`.** Verified: Canada 7d earnings = 208,389.7 sats; 24h fee-PPM = 631.7. PPM crash is the Tier-1 signal (see §Tunable). |
| 3 | **Liquidity** | `lnd_node_channel_info` (latest via `latestChannelsForNode`) | `local_pubkey` / `chan_id` | `timestamp` | latest state | outbound ratio = `SUM(local_balance) / NULLIF(SUM(capacity),0)`; also `SUM(local_balance)`, `SUM(remote_balance)` sats | Use the existing AFM-001 helper. Verified Canada latest active: local 2,306,430,464 / remote 718,830,410 / cap 3,026,674,239 → ~76% outbound. Balances RAW sats. |
| 4 | **Channel health** | `lnd_node_channel_info` (latest) + cross-check `lnd_node_info` | `local_pubkey` | `timestamp` | latest state | inactive ratio = `inactive_channels / NULLIF(active+inactive,0)` (from latest `lnd_node_info`); active count from DISTINCT ON helper filtered `active AND NOT closed` | Verified Canada: 487 active of 573 latest channel rows; `lnd_node_info.active_channels` is the cross-check ground truth. Inactive-ratio band <8% (France-derived, §Tunable). |
| 5 | **Force-close prevention** | `lnd_node_closed_channels` | `local_pubkey` | `timestamp` | 30d (rolling) + all-time share | LOCAL force-close rate = `COUNT(*) FILTER (close_type='LOCAL_FORCE_CLOSE')` over window; coop-REMOTE share = `COUNT FILTER (close_type='COOPERATIVE_CLOSE' AND close_initiator='INITIATOR_REMOTE') / NULLIF(COUNT FILTER (close_type='COOPERATIVE_CLOSE'),0)`; AP-11 storm = `COUNT(*)` self-initiated closes in any 1h bucket | One row per close (3,238 rows / 3,177 distinct chan_id for Canada — near 1:1; aggregate by row). `close_type` values verified: `COOPERATIVE_CLOSE`, `LOCAL_FORCE_CLOSE`, `REMOTE_FORCE_CLOSE`, `ABANDONED`, `BREACH_CLOSE`, `FUNDING_CANCELED`. `close_initiator`: `INITIATOR_LOCAL/REMOTE/BOTH`. AP-11 close-storm (≥50/hr self-initiated) is the Tier-1 line. |
| 6 | **Restart (latest only)** | `lnd_restart` | `pubkey` | `last_restart` (timestamp) | latest | recency = `now() - last_restart`; `restarted` boolean flag | **Only the LATEST restart is stored** (columns: `alias, pubkey, restarted, last_restart` — no history). D-01 correctly scopes this to "latest." Verified Canada last_restart = 2025-03-13 (>1yr ago — stale by design; full restart history is a data gap, deferred). |

### Partial (1) — computed with a documented limitation

| # | Dimension | Table(s) | Identity col | Time col | Available | Limitation |
|---|-----------|----------|--------------|----------|-----------|------------|
| 7 | **Peer** | `lnd_node_info.num_peers` (latest) + `lnd_node_peer_info` (cumulative) | `pubkey` / `local_pubkey` | `timestamp` | **current peer count** = `num_peers` from latest `lnd_node_info`. Optional lifetime context: `lnd_node_peer_info` is a **cumulative lifetime peer log** (one row per peer ever connected; `flapcount` is lifetime-cumulative, not recent). | **Flap-RATE is NOT computable** — needs per-peer disconnect *event* history (a data gap). Verified: Canada peer_info has 22,868 rows = 22,868 distinct peers ever seen, avg lifetime flapcount 61.5, max 89,820. Do NOT use `COUNT(*)` of peer_info as "current peers." Mark the dimension "partial — flap-rate needs event history." |

### No warehouse source (3) — render "no data — needs log ingestion", excluded from rollup (D-01)

| # | Dimension | Why no source | Future source (deferred) |
|---|-----------|---------------|--------------------------|
| 8 | **Stability** | `[CRT]`/panic events live in LND logs, not the warehouse | log ingestion (`data-gap-inventory.md`) |
| 9 | **PG health** | `40001` serialization conflicts live in `pg_stat`/PG logs | pg_stat ingestion |
| 10 | **Visibility** | observability coverage is meta about monitoring setup | meta/config inventory |

**Rollup rule (D-06):** composite % = unweighted mean of the **available** dimensions' percentages (dims 1–7; #7 included since `num_peers` is computable). Dims 8–10 are excluded and greyed. Weighting is deferred.

## Tunable Config (D-02) — recommended shape + starting defaults

> **All values below are STARTING config, not contract (D-02).** Many are Canada-only or France-derived and flagged provisional. The config must be **per-dimension × per-backend (LDK vs LND)** in ONE editable file. Phase 4 reads the same bands.

### Recommended shape (`src/lib/scorecard/config.ts`)
```typescript
// Per-dimension, per-backend. Grade bands map a raw value → A/B/C/D/F + %.
// "tier1" defines the SINGLE critical (red) line for D-07/D-08; everything else caps at yellow.
type Band = { a: number; b: number; c: number; d: number; direction: "higher-better" | "lower-better" };
type DimConfig = { band: Band; tier1?: { op: ">" | "<"; value: number; label: string } };
type BackendConfig = Record<DimensionKey, DimConfig>;
export const SCORECARD_CONFIG: Record<Backend, BackendConfig> = { lnd: {...}, ldk: {...} };
export const COMPARE_CONFIG = { madN: 3, minCohortForMedian: 3 };   // D-12 / D-11
export const STALENESS = { warnAfterHours: 6, lndStaleHours: 6, ldkStaleHours: 6 }; // D-13
```

### Starting defaults (LND; provisional — source flagged)

| Dimension | Healthy band (grade A/B target) | Tier-1 critical line (red) | Source / confidence |
|-----------|--------------------------------|----------------------------|---------------------|
| Routing | non-zero forwards/7d; relative to peers via MAD | — (not Tier-1 on its own) | operator practice — LOW (no absolute band documented) |
| Revenue (fee-PPM 24h) | 30–150 PPM industry-normal; ≥50 competitive | **< 10 PPM = fee crash (Tier-1)**; also earnings step-down `7d/4w_prior < 0.3` | `cross-node-monitoring-matrix.md` (France fee-crash) — MEDIUM |
| Liquidity (outbound ratio) | 0.2–0.8 balanced; extreme imbalance = warn | — (Tier-2 at most) | provisional — LOW (no firm band) |
| Channel health (inactive ratio) | < 8% healthy; >8% = warn (yellow) | — (Tier-2) | France-derived (France 10.4%) — MEDIUM |
| Force-close prevention | LOCAL force-close 0–1/mo; coop-REMOTE share <50–60% | **AP-11 close-storm ≥50 self-closes/hr = Tier-1** | `operational-anti-patterns.md` AP-11; `healthy-range-bands.md` — HIGH for AP-11, MEDIUM for shares |
| Restart (latest recency) | last restart not in a tight restart-loop; 0–2/mo target | **restart-loop ≥2 in rolling window = Tier-1** (history limited — see note) | `healthy-range-bands.md` + `cross-node-monitoring-matrix.md` — MEDIUM; **restart-loop detection limited by single-latest storage** |
| Peer (current count) | num_peers > 0; sudden drop = warn | **node unreachable / num_peers==0 with stale data = Tier-1 candidate** | derived — LOW |
| Rebalance success (feeds revenue/liquidity) | > 90% target | — | France/Canada (both degraded: Canada 18%, France 23%) — MEDIUM. Verified Canada 7d: 37 paid / 143 total ≈ 26%. |

**Provisional / Canada-only flags (must surface to operator as tunable):** all PPM bands, inactive-ratio 8%, coop-REMOTE share, restart counts, rebalance target — every one is one- or two-node-derived per `healthy-range-bands.md`'s own "provisional" header. The AP-11 ≥50/hr and fee-crash <10 PPM Tier-1 lines are the best-supported (HIGH/MEDIUM).

**Tier-1 → red mapping (D-07/D-08):** only `revenue.tier1` (fee crash), `forceClose.tier1` (AP-11 storm), `peer.tier1` (unreachable), and a future `pgHealth.tier1` (PG FATAL — no-data in Phase 2) can produce 🔴. Everything else caps at 🟡. The critical chip renders the `tier1.label` and is excluded from the composite mean.

## MAD Comparison Math (D-10 / D-11 / D-12)

> Median-Absolute-Deviation outlier detection, per-backend cohort, with small-cohort suppression. Pure helper, no dependency.

```typescript
// src/lib/scorecard/compare.ts
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// MAD (robust spread). 1.4826 scales MAD to ~σ for normal data (standard constant).
function mad(xs: number[]): number {
  const med = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)));
}
// Outlier if |x - median| > N * MAD. Robust small-sample guard:
//  - cohort < minCohortForMedian (default 3): SUPPRESS — "no peer baseline yet" (D-11)
//  - MAD === 0 (cohort identical / tight): NOBODY is an outlier (D-12 intent — don't always flag)
export function outlierCheck(value: number, cohort: number[], madN = 3, minCohort = 3) {
  if (cohort.length < minCohort) return { suppressed: true as const };
  const med = median(cohort);
  const spread = mad(cohort);
  const isOutlier = spread > 0 && Math.abs(value - med) > madN * spread;
  return { suppressed: false as const, median: med, isOutlier, deltaFromMedian: value - med };
}
```

**Per-backend cohort (D-11):** build the cohort array from only same-backend nodes (`backend === node.backend`). With one LDK node today (`LQwD-Lspd-ldk`), the LDK cohort is size 1 → suppressed → "no peer baseline yet." The LND cohort is ~25 nodes (verified 26 distinct pubkeys, minus LDK/LSP nodes per the backend map).

**Two separate signals (D-10/D-12):** `outlierCheck` result drives a *separate* "worst-in-fleet/outlier" marker and may feed the reason subtext (D-06); it does **NOT** change the absolute grade from `grade.ts`. Direction matters — for "lower-better" dimensions (inactive ratio, force-close rate) only the high tail is "bad"; for "higher-better" (revenue, routing) only the low tail is "bad." Compute `deltaFromMedian` sign against the dimension's `direction`.

## Freshness (D-13)

**Worst-case `asOf` per node** = `MIN(...)` over the latest timestamps of the tables that node's *available* dimensions depend on:
- `lnd_node_info.timestamp` (latest-per-node — DISTINCT ON pubkey) — peers, channel-health cross-check
- `lnd_node_channel_info.timestamp` (latest) — liquidity, channel health
- `MAX(timestamp_ns)→ms` from `lnd_node_forwards` — routing, revenue
- `lnd_node_closed_channels.timestamp` (latest) — force-close
- `lnd_restart.last_restart` — restart (note: legitimately old; consider EXCLUDING restart from the worst-case floor so a year-old last_restart doesn't make every node "stale" — recommend excluding restart and any "no data" dim from the freshness floor)

**Verified fleet freshness varies enormously** (latest `lnd_node_info` per node): `LQwD-Germany` 2025-08-22 (~10 mo stale), `LQWD-Japan-Osaka` 2025-12-25, `LQWD-Breez` 2024-09-19, vs Canada 2026-06-10 (live). **D-13's stale marker is real and necessary** — several nodes will legitimately show "stale." Starting `warnAfterHours` ≈ 6h (channel_info cadence is ~3.7/day per `data-gap-inventory.md`, so ~6h covers a couple missed snapshots without false-flagging healthy nodes). Tunable.

## Backend Identification Config (D-03)

**Shape:** a single committed map keyed by pubkey, env-overridable, in `src/lib/config/backends.ts`:
```typescript
import type { Backend } from "@/lib/read/nodes";   // reuse existing "lnd" | "ldk" type
// Default fleet map (operator-maintained). Override/extend via NODE_BACKENDS env (JSON) for the local→VM flip.
const DEFAULT_BACKENDS: Record<string, Backend> = {
  // "<pubkey>": "ldk",   // e.g. LQwD-Lspd-ldk
  // all others default to "lnd"
};
export function backendFor(pubkey: string): Backend {
  return resolveEnvOverrides()[pubkey] ?? DEFAULT_BACKENDS[pubkey] ?? "lnd"; // default lnd
}
```
- **Config-driven, NOT warehouse-derived** (D-03): LDK rows arrive in `routing_vm` in the `lnd_*` shape, so the warehouse cannot tell you the backend. The verified fleet alias list includes `LQwD-Lspd-ldk` (the LDK/LSPD node) plus `LQWD-Breez`/`LQWD-Breez-2` (LSP mobile) — the operator confirms which pubkeys are `ldk`.
- **Default to `"lnd"`** for any unmapped pubkey (the fleet is overwhelmingly LND). Surface the resolved backend visibly on the per-node model + UI (D-04).
- **Carry `backend` on `UnifiedNode`** (already typed; `mapLndNode` sets it `"lnd"`) — for Phase 2, override the label from `backendFor(pubkey)` rather than from which mapper ran, since everything comes through the LND-shaped path.

## Runtime State Inventory

> Phase 2 is build-on-don't-modify (no rename/refactor). Not applicable — no stored data, live-service config, OS-registered state, secrets, or build artifacts are mutated. New code only.

**Stored data:** None — read-only. **Live service config:** None. **OS-registered state:** None. **Secrets/env vars:** adds optional `NODE_BACKENDS` (JSON map) + reuses existing `ROUTING_VM_DATABASE_URL` (verified present in `.env.local`) — no new secret. **Build artifacts:** shadcn CLI writes component source into `src/components/ui/` (committed) — expected, not stale.

## Common Pitfalls

### Pitfall 1: `lnd_node_info` read as a snapshot (NEW, highest-risk)
**What goes wrong:** Schema comment says "TRUE SNAPSHOT — read directly, no DISTINCT ON needed," but the table is append-only (371k rows for Canada). A direct `SELECT … WHERE pubkey=$x` returns hundreds of thousands of rows; an aggregate without latest-filtering double/triple-counts.
**How to avoid:** Build + always use a `latestNodeInfo` DISTINCT ON (pubkey) helper. Treat `lnd_node_info` exactly like the other event tables for latest-state. (Recommend updating the misleading comment in `routing.ts` — but per "don't modify read-foundation contracts," only the *comment* and a new additive helper; the existing typed columns are fine.)
**Warning signs:** Fleet read pulls millions of rows / is slow; balances/channel counts implausibly large.

### Pitfall 2: `lnd_node_peer_info` treated as current peers
**What goes wrong:** It's cumulative lifetime peer history (22,868 distinct peers ever for Canada). `COUNT(*)` → "22,868 peers," `flapcount` → lifetime not recent.
**How to avoid:** Current peer count from `lnd_node_info.num_peers` (latest). Mark the peer dimension partial; flap-rate not computable.

### Pitfall 3: `fee` vs `fee_msat` and ns timestamps in forwards
**What goes wrong:** `lnd_node_forwards` has BOTH `fee` and `fee_msat`; using `fee` → 1000× off (AFM-002). `timestamp_ns` is **nanoseconds** — a window built in seconds/ms silently selects nothing or everything.
**How to avoid:** Always `fee_msat/1000.0`; convert windows to ns (`epoch*1e9`). Verified working: 7d window `timestamp_ns > (EXTRACT(EPOCH FROM now())-7*86400)*1e9`.

### Pitfall 4: Recharts SSR zero-size / Server-Component import
**What goes wrong:** `ResponsiveContainer` flashes/zero-sizes on first paint; importing Recharts into an RSC errors.
**How to avoid:** `'use client'` chart wrappers only, fixed-height container, plain serializable props from RSC (per `STACK.md` §2). Only relevant if a viz is added (optional, D-05).

### Pitfall 5: A non-critical issue producing red
**What goes wrong:** Folding any low grade into the color violates the operator's hard rule.
**How to avoid:** Color is driven ONLY by `tier1` breaches (D-07); composite grade is a separate number; MAD outlier is a separate marker.

## State of the Art

| Old Approach | Current Approach | Why |
|--------------|------------------|-----|
| Grafana firehose of all panels | Curated 10-dimension scorecard, criticals-first triage | Product framing (not a Grafana replacement) — `CLAUDE.md` core value |
| Absolute thresholds only | Absolute band + per-backend MAD peer-relative (D-10/D-12) | Robust to skew + small noisy cohorts; doesn't always flag someone |
| `tailwindcss-animate`, `npx shadcn@canary` | `tw-animate-css`, `npx shadcn@latest` | v4 + React 19 GA (STACK.md §3) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Time windows (7d revenue, 24h PPM, 30d force-close) are the right defaults | Dimension Map | Low — tunable/discretion (D-02); wrong window only changes a starting number |
| A2 | All non-AP-11/non-fee-crash bands as starting grade thresholds | Tunable Config | Medium — provisional/Canada-only per source's own header; operator expected to retune (D-02). Surfaced as config. |
| A3 | `LQwD-Lspd-ldk` (+ possibly Breez nodes) are the `ldk` backend; rest `lnd` | Backend Config | Low — operator-confirmed map is the authority (D-03); default `lnd` is safe for the LND-dominant fleet |
| A4 | Restart-loop Tier-1 detection is limited because `lnd_restart` stores only the latest restart | Tunable / Dimension 6 | Medium — full restart-loop detection isn't possible from this table; D-01 already scopes restart to "latest." Flag the limitation. |
| A5 | Excluding `lnd_restart` from the freshness floor is correct (legitimately old) | Freshness | Low — design choice; alternative is to include it and accept many "stale" flags |
| A6 | `minCohortForMedian = 3`, `madN = 3`, `staleness = 6h` starting values | MAD / Freshness | Low — all tunable (D-02/D-12) |

## Open Questions (RESOLVED)

1. **Exact `ldk` pubkey set for the backend map (D-03).**
   - What we know: `LQwD-Lspd-ldk` is in the fleet alias list; LDK arrives via `routing_vm`.
   - What's unclear: whether `LQWD-Breez`/`LQWD-Breez-2` are LDK or LND; precise pubkeys.
   - Recommendation: operator confirms the `ldk` pubkey list at plan/build time; default everything else to `lnd`.
   - **RESOLVED:** 02-02 Task 1 — `DEFAULT_BACKENDS` seeded with `LQwD-Lspd-ldk` as `ldk` (everything else defaults `lnd`) plus the `NODE_BACKENDS` env override, so the operator can correct the set without code changes (D-03).
2. **Whether restart-loop (≥2 in window) Tier-1 is achievable at all in Phase 2.**
   - What we know: `lnd_restart` has only `last_restart` (single latest) — no count, no history.
   - Recommendation: ship restart as a *recency* signal only; treat restart-loop Tier-1 as deferred until restart-history ingestion (data gap). Do not promise loop detection.
   - **RESOLVED:** 02-04 — restart ships as recency-only; the restart-loop Tier-1 deferral is stated in that plan's truths and surfaced via the banner + config comment in restart.ts (no loop detection promised).
3. **Should the misleading `lnd_node_info` "TRUE SNAPSHOT" comment be corrected?**
   - Recommendation: yes — correct the comment + add the `latestNodeInfo` helper (additive; doesn't change existing typed columns or contracts). Flag for planner.
   - **RESOLVED:** 02-01 Task 1 — the misleading "TRUE SNAPSHOT" comment is corrected and the `latestNodeInfo`/`latestNodeInfoAll` helpers are added.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `routing_vm` warehouse | All dimensions | ✓ (verified live this session) | PG, role read-only | — |
| `ROUTING_VM_DATABASE_URL` | `dbRouting` | ✓ (`.env.local`) | — | — |
| shadcn CLI (`npx shadcn@latest`) | UI scaffold | ✓ (network npx) | latest | hand-build primitives (not recommended) |
| Phase 1 helpers (`latest.ts`, `units.ts`, `nodes.ts`) | reuse | ✓ (in-repo) | — | — |
| `ldk-lspd-main` / `dbLdk` | NOT used in Phase 2 | n/a | — | LDK rows arrive via `routing_vm` |

**Missing dependencies with no fallback:** none. **Missing with fallback:** none.

## Validation Architecture

> nyquist_validation is enabled (`.planning/config.json: workflow.nyquist_validation: true`). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4 (in-repo) |
| Config file | `vitest.config.ts` (node env, `@/` alias, `server-only` stubbed) |
| Quick run command | `npx vitest run src/lib/scorecard` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLEET-02 | Each dimension formula returns correct raw value (AFM-002 discipline) | unit | `npx vitest run src/lib/scorecard/dimensions` | ❌ Wave 0 |
| FLEET-02 | `latestNodeInfo` returns ONE row/node (not 310k) — the append-only trap | unit/live | `npx vitest run src/lib/read/node-info.test.ts` | ❌ Wave 0 |
| FLEET-02 | grade.ts: composite excludes no-data dims; Tier-1 → red only; non-critical never red (D-07) | unit | `npx vitest run src/lib/scorecard/grade.test.ts` | ❌ Wave 0 |
| FLEET-03 | MAD outlier: suppressed for cohort<3; MAD==0 flags nobody; outlier doesn't change grade | unit | `npx vitest run src/lib/scorecard/compare.test.ts` | ❌ Wave 0 |
| FLEET-01 | Freshness = worst-case MIN across depended-on tables; stale flag past threshold | unit | `npx vitest run src/lib/scorecard/freshness.test.ts` | ❌ Wave 0 |
| FLEET-02 (D-14) | **Reference-node golden:** Canada computed dimensions within tolerance of live reference | live (skipIf no DB) | `ROUTING_VM_DATABASE_URL=… npx vitest run src/lib/scorecard/golden-scorecard.test.ts` | ❌ Wave 0 |

### Reference-Node Validation (D-14) — Canada anchor
**Pattern:** reuse the Phase 1 golden-test pattern (`src/lib/read/golden.test.ts`): `describe.skipIf(!HAS_DB)`, resolve Canada by alias `%canada%` (fallback pubkey `0364913d…907e1`), assert computed values against live reference within a tolerance (Phase 1 used `Math.max(3, ceil(x*0.03))` — **~3% tolerance — confirmed and reuse**). Because warehouse data drifts, assert **invariant ranges**, not frozen literals.

**Live reference values captured this session (2026-06-09, will drift — use as sanity ranges):**
- Canada channel count (DISTINCT ON active, not closed): **487** ≈ `lnd_node_info.active_channels` (cross-check, already in Phase 1 golden).
- Canada 7d forwards: **7,023** count; **739,079,154 sat** volume → routing dimension non-zero, hundreds-to-thousands range.
- Canada 7d earnings: **208,389.7 sat** (`SUM(fee_msat)/1000.0`) → revenue dimension > 0.
- Canada 24h fee-PPM: **631.7** → must be a plausible PPM (not 0, not millions); proves `fee_msat` (not `fee`) + `amt_in_msat` denominator.
- Canada liquidity outbound ratio: **~0.76** (local 2.306B / cap 3.027B sat) → between 0 and 1.
- Canada 7d rebalance success: **37/143 ≈ 26%** (paid_status true/total).
- Canada force-close mix: LOCAL_FORCE_CLOSE 803, REMOTE_FORCE_CLOSE 820+33, COOPERATIVE 1,499 → close_type/initiator filters return non-zero, sane proportions.

**Golden assertions to encode (invariant, not literal):** 24h fee-PPM in `(0, 100000)`; 7d earnings > 0 and `≈ SUM(fee_msat)/1000` (back-convert ±1%, AFM-002); routing count > 0; liquidity ratio in `[0,1]`; channel-count cross-check inherits Phase 1's ±3%. The numeric snapshots above are the human-readable checkpoint for the operator, not hardcoded equalities.

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/scorecard` (pure-function dims/grade/compare/freshness — fast, no DB).
- **Per wave merge:** `npm test` (full suite) + the live golden with `ROUTING_VM_DATABASE_URL` set.
- **Phase gate:** full suite green + Canada golden passes before `/gsd:verify-work` and before any downstream phase consumes scorecard numbers (D-14).

### Wave 0 Gaps
- [ ] `src/lib/read/node-info.ts` + `node-info.test.ts` — sanctioned `latestNodeInfo` DISTINCT ON (pubkey) helper (closes Pitfall 1)
- [ ] `src/lib/scorecard/config.ts` — tunable per-dimension × per-backend table (D-02)
- [ ] `src/lib/scorecard/dimensions/*.ts` + tests — 7 computable dimensions
- [ ] `src/lib/scorecard/grade.ts` + `grade.test.ts` — composite + separate critical chip (D-06/D-07)
- [ ] `src/lib/scorecard/compare.ts` + `compare.test.ts` — MAD cohort (D-11/D-12)
- [ ] `src/lib/scorecard/freshness.ts` + test — worst-case stamp (D-13)
- [ ] `src/lib/config/backends.ts` — backend map (D-03)
- [ ] `src/lib/scorecard/golden-scorecard.test.ts` — Canada reference golden (D-14), skipIf no DB
- [ ] shadcn primitives via CLI: `card table badge tooltip` (+ `chart` if viz)

## Security Domain

> `security_enforcement` not explicitly false; included. Phase 2 is read-only + UI — the threat surface is narrow.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-operator local tool; no auth in v1 (RBAC deferred). |
| V3 Session Management | no | — |
| V4 Access Control | yes (DB) | Read-only DB role is the boundary (Phase 1); Phase 2 must NOT issue any write to `routing_vm`. |
| V5 Input Validation | yes (limited) | `pubkey` route param must be validated (`^[0-9a-f]{66}$`) before use; all SQL is parameter-bound via Drizzle `sql` template (never string-concatenated — mirror `latest.ts`). |
| V6 Cryptography | no | No signing/crypto in Phase 2 (HMAC is Phase 6). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via pubkey/alias param | Tampering | Parameter-bound Drizzle `sql` (existing `buildLatestChannelsSql` pattern); validate pubkey regex |
| DB connection string / secret leaking to client bundle | Info Disclosure | `import "server-only"` on all DB + config-with-secrets modules; never pass `dbRouting` or env to a `'use client'` component (Pitfall 12, PITFALLS.md) |
| Accidental warehouse write | Tampering | Read-only DB role (Phase 1); no `INSERT/UPDATE/DELETE` in any scorecard query; never point drizzle-kit at `routing_vm` |
| Stale data presented as authoritative | (UX/integrity) | D-13 freshness stamp + stale marker on every node (sets up Phase 6 stale-approval block) |

## Sources

### Primary (HIGH confidence)
- **Live `routing_vm` warehouse** (probed 2026-06-09 via `dbRouting` URL) — exact columns of `lnd_node_forwards`, `lnd_node_closed_channels`, `lnd_restart`, `lnd_node_peer_info`, `internal_rebalance_invoices`; append-only nature of `lnd_node_info` (8.05M rows/26 nodes); Canada reference values; fleet freshness spread; 26-node fleet + alias list.
- In-repo code (read this session): `src/lib/db/schema/routing.ts`, `src/lib/read/{nodes,latest}.ts`, `src/lib/format/units.ts`, `src/lib/read/golden.test.ts`, `vitest.config.ts`, `package.json`, `.planning/config.json`.
- `.planning/phases/02-fleet-overview-health-scorecard/02-CONTEXT.md` (D-01..D-14), `.planning/REQUIREMENTS.md` (FLEET-01/02/03), `.planning/phases/01-foundations-read-layer/01-CONTEXT.md`.
- `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` (AFM-001/002, Recharts/shadcn rules).

### Secondary (MEDIUM confidence)
- `../lqwdLogs/_library/cross-node-monitoring-matrix.md` — Tier-1/2/3 severity taxonomy; fee-crash <10 PPM, AP-11 ≥50/hr, inactive >8%, coop-REMOTE >60%, earnings step-down <0.3.
- `../lqwdLogs/_library/healthy-range-bands.md` — provisional/Canada-derived bands (PPM 30–150, restart 0–2/mo, rebalance >90%).
- `../lqwdLogs/_library/data-gap-inventory.md` — confirms no-data dimensions (logs/pg_stat) + restart-history gap + 3.7/day channel cadence.
- `../lqwdLogs/_library/operational-anti-patterns.md` — AP-11 close-storm definition.

### Tertiary (LOW confidence)
- Absolute grade bands for routing/liquidity/peer (no firm documented band) — flagged in Assumptions Log; tunable.

## Metadata

**Confidence breakdown:**
- Dimension→warehouse mapping: HIGH — every table column + Canada values verified live.
- Tunable defaults: MEDIUM (AP-11/fee-crash) to LOW (routing/liquidity bands) — provisional per source; explicitly config, not contract (D-02).
- MAD math / architecture / stack: HIGH — standard statistics + already-pinned proven stack.
- `lnd_node_info` append-only landmine: HIGH — directly measured (371k rows Canada / 8.05M fleet).

**Research date:** 2026-06-09
**Valid until:** ~2026-07-09 (warehouse schema stable; reference *values* drift continuously — golden asserts ranges, not literals)
