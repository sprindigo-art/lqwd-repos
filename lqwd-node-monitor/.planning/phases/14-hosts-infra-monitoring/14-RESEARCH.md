# Phase 14: Hosts + Infra Monitoring - Research

**Researched:** 2026-07-13
**Domain:** Next.js RSC UI composition over the shipped Phase-11 read model + Phase-12 overview machinery (internal codebase; zero new dependencies)
**Confidence:** HIGH (nearly all findings verified directly against repo source at file:line)

## Summary

Phase 14 is, as CONTEXT states, "almost purely a UI composition phase" — but the codebase audit found **three genuine build gaps the CONTEXT undersells**, and the planner must schedule them explicitly:

1. **No time-series (history) read helpers exist.** `getLatestHostMetrics` is latest-only (DISTINCT ON), and the shipped Node Detail renders `<VmVitals charts={[]} />` with the comment "the per-host time-series reader is out of the reads inventory" (`src/app/(overview)/[pubkey]/page.tsx:295-298`). `computeStorageGrowth` has **zero production callers** — only its test. HOST-02's vitals sparklines (SC#2) and storage time-to-full (SC#3) are unbuildable without new bounded history reads on `host_metrics` / `host_storage`. This is the single biggest planning item; the CONTEXT line "it must not write new warehouse/nodemon queries" must be read as "never re-derive the shipped *latest* reads" — the history reads do not exist and must be added, following the read-layer conventions (parameter-bound `sql` template, lazy `dbNodemon` import, exported `buildXxxSql` for no-DB shape tests).

2. **The D-13 days-to-full bands cannot use the existing band machinery.** `TelemetryBand`/`evaluateBand` is a 3-level type (`healthy|warn|critical`, `telemetry-bands.ts:21`), and `severityFromBand` has no `watch` output. D-13 mandates FOUR levels (critical <7d · warning <30d · watch <90d · healthy). A dedicated 4-level config + pure evaluator returning df `Severity` directly is needed (same file/pattern, new shape).

3. **Host worst-of rollup logic does not exist.** `gradeHost` in `incidents.ts:110-113` grades hosts stale-or-healthy only ("until a band ships"), and the overview's `hostSeverity` does the same. HOST-01's worst-of (infra + nodes + resources) plus the D-05 driver line is a new pure module composing `evaluateBand` + `severityFromBand` + `severityFromService` + `gradeChain`-style chain grading + scorecard node grading through `worstSeverity`.

Everything else is verbatim reuse: the Hosts rail entry **already exists** in `NavRailShell` (`RAIL_ITEMS` includes `{ key: "hosts", href: "/hosts", label: "Hosts", Icon: Server }` — UI-SPEC assumption 5 is pre-satisfied), the facet grammar clones `node-filter.ts` + `NodeFilters.tsx`, the incident banner reads `assembleIncidents` output keyed by hostId, and the routes clone the Phase-13 RSC page shape.

**Primary recommendation:** Plan the phase in three waves — (Wave 0/1) the pure logic + read-layer additions with tests (`ThresholdMeter`, history reads, days-to-full bands, host rollup + driver line, `parseHostFacets`, projection humanizer), then (Wave 2) the two RSC routes composing them, then (Wave 3) cross-links + gallery + gates. No new dependency of any kind.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Design source & visual contract (no prototype exists for these screens)
- **D-01:** The visual contract is a **14-UI-SPEC produced by `/gsd-ui-phase 14`**, derived from the sibling grammar (Node Detail single-scroll structure, Ops Center card patterns, Phase-13 list/detail conventions). No new prototype pass — unlike Phases 12/13 there is no locked `.dc.html` snapshot for hosts, so **the spec IS the visual source of truth**.
- **D-02:** **Strict reuse only**: the spec composes exclusively from existing df primitives (`SeverityCard`, `SeverityRow`, `TwoAxisPip`, `EvidenceChart`, `StaleChart`, `FreshnessChip`, `CommandModal`, `Sparkline`, …). No new tokens, no new base primitives — with exactly one scoped exception (D-03). Anything else missing gets composed from what exists or flagged back to the operator.
- **D-03:** **One new df primitive: `ThresholdMeter`** — a severity-ramp-colored fill meter (HOST-01's "CPU/mem/disk meters with threshold coloring" is unbuildable without it; no meter/progress primitive exists in `src/components/df/` or `src/components/ui/`). It must be registered in the `/design-system` gallery like every other primitive and is shared by the vitals meters AND the storage volume rows. This is the ONLY design-system addition.
- **D-04:** **Blocking operator sign-off on the 14-UI-SPEC before planning** — consistent with the Phase-10 gallery gate and the approved 13-UI-SPEC. `/gsd-plan-phase 14` must not run until the operator approves the spec. *(Status: the 14-UI-SPEC frontmatter reads `status: approved`, `reviewed_at: 2026-07-13`.)*

#### Hosts list composition (HOST-01)
- **D-05:** **Worst-of rollup shows its driver**: card chrome takes the worst-of severity (SeverityCard) plus ONE plain-language driver line naming the worst contributor — e.g. "driven by: bitcoind not functioning" — matching the overview's root-cause framing. No per-source chip breakdown.
- **D-06:** **The list enumerates ALL declared hosts** from the `hosts` dimension table. Hosts with no telemetry (everything except the canary today, per P11 D-12) render as explicit no-data/stale cards — never green, never hidden. The list is fleet-shaped from day one; rollout just lights cards up.
- **D-07:** **Node-health dots are interactive**: one severity-colored dot per on-host node (via `buildOwnershipMap`), hover tooltip shows alias + status, click deep-links to that node's `/(overview)/[pubkey]` detail. The card body click navigates to Host Detail.
- **D-08:** **Filters/sort mirror the Nodes-list facet grammar**: severity/status facet (all/critical/warning/watch/healthy) + stale toggle, default sort worst-first, URL-param driven following the `parseNodeFacets` pattern (`src/lib/overview/node-filter.ts`).

#### Host Detail structure (HOST-02)
- **D-09:** **Routes**: Hosts list at `/(overview)/hosts`, Host Detail nested at `/(overview)/hosts/[hostId]`. Self-describing URLs; no ambiguity with the root-level `[pubkey]` node route.
- **D-10:** **Single-scroll, incident-first section order**: header → root-cause incident banner (only when an incident exists; absent when healthy) → VM vitals with sparklines → infra services two-axis → storage volumes → on-host nodes. "What's wrong" leads; evidence follows.
- **D-11:** **Incident + runbook render NOW, without Phase 15**: the banner shows the grouped incident from the existing `assembleIncidents` helper (severity, driver, affected children) plus the verify-first runbook via the inert `CommandModal`. Phase 15 later adds the "open incident" deep-link to Incident Detail — Phase 14 does not build any incident lifecycle or detail surface.
- **D-12:** **On-host nodes section = compact Nodes-list rows**: reuse the Phase-13 `SeverityRow` row grammar trimmed to a compact variant (alias, type, severity, key liquidity/forwarding figures, freshness); row click → Node Detail.

#### Storage time-to-full display (HOST-02, SC#3)
- **D-13:** **Severity bands for days-to-full: critical < 7d, warning < 30d, watch < 90d, healthy beyond.** Bands live in the read-time threshold config (per P11 D-14 — applied at read time, re-tunable without re-ingesting), following `telemetry-bands` conventions.
- **D-14:** **Distinct honest copy per no-projection status** (the `StorageProjectionStatus` from `computeStorageGrowth`): stale → "projection unavailable — data stale (2h old)"; insufficient-samples / insufficient-window → "gathering data — projection in ~Nh"; flat-or-negative → "not growing". The operator always knows WHY there's no number. Never hide the projection row silently.
- **D-15:** **Projection rendering**: `daysToFull ≥ 365` renders as ">1 year" (healthy, calm); below that, humanized units ("~45 days", "~3 weeks", "~5 days") alongside the "+0.4%/day" rate. No absurd long-horizon precision, no calendar-date rendering.
- **D-16:** **Volume row = ThresholdMeter (used-% severity fill) + current % + %/day rate + projection line.** One dense glanceable row per volume. Sparklines stay on the CPU/mem/disk vitals only — no per-volume history chart in this phase.

### Claude's Discretion
- Exact card grid layout/breakpoints, compact-node-row column trim, sparkline window for the vitals (follow the sibling Node Detail treatment), the humanize rules for projection copy, empty/all-clear states (reuse Phase-10/12 empty-state primitives), and hosts nav-rail entry placement — all within D-01…D-16 and the locked design system. *(The approved 14-UI-SPEC has since decided most of these: 1/2-col grid, compact row columns, 24h sparkline window, humanize bands, `Server` icon after Nodes, volume-row severity = worse of used-% and days-to-full bands.)*

### Deferred Ideas (OUT OF SCOPE)
- **Per-volume growth sparkline** — rejected for this phase in D-16; vitals keep sparklines, volumes stay dense rows.
- **Fleet hosts dimension seeding** — belongs with fleet rollout / Phase-16 hardening territory.
- **Incident deep-link from the Host Detail banner** — Phase 15 activates it when Incident Detail exists (D-11).
- Reviewed todos not folded: `ui-polish-fleet-console.md`, `2026-06-23-pin-lncli-cron-path-hardening.md`, `2026-06-23-exercise-inbound-fee-a2-lnd8614.md`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HOST-01 | Hosts list: per-host cards with worst-of severity rollup (infra + nodes + resources), CPU/mem/disk meters with threshold coloring, infra trio two-axis, node-health dots, filters/sort incl. stale | Host rollup module design (§Patterns 2–3), `ThresholdMeter` contract (UI-SPEC, verified no meter primitive exists), `TwoAxisPip` props verified, facet grammar clone of `node-filter.ts`/`NodeFilters.tsx`, `getLatestHostMetrics` already fleet-shaped (LEFT JOIN from `hosts` dimension → D-06 free) |
| HOST-02 | Host Detail: VM vitals (CPU/mem/disk + sparklines), infra services two-axis, storage volumes with %/day growth + projected time-to-full, on-host nodes, root-cause incident + runbook | New history reads required (§Gap 1), `computeStorageGrowth` honesty statuses verified shipped, days-to-full band gap (§Gap 2), `assembleIncidents` host-keyed incident verified, `CommandModal`/`RunbookStep` props verified, `VmVitals` presentational component reusable, `SeverityRow` compact-row props verified |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack locked**: Next.js App Router + TS + Drizzle (read-only to warehouses, RW only to `nodemon`) + Tailwind v4 + shadcn/ui; `@/` imports; named exports; Drizzle-only queries.
- **Security**: Grade-A posture; dashboard holds zero node credentials; this phase is **read-only end to end** (no write path, no enqueue — reaffirmed by the approved UI-SPEC).
- **Brand**: LQWD navy `#1A3C79`; light-first NOC theme; navy = structure/action only, severity ramp = state only (DS-01).
- **Process**: no co-authored-by trailers; branch-per-task; multi-agent parallel execution.
- **GSD enforcement**: all edits through GSD workflows.
- **Project skill**: `Skill("sketch-findings-nodemonitor")` must be loaded before UI implementation work (validated design decisions; note the v2 df system supersedes its NOC-instrument specifics per the Phase-10 decision, but its triage/density philosophy still applies).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Hosts list / Host Detail rendering | Frontend Server (RSC) | — | Server Components read telemetry, compose df primitives; `force-dynamic`, no prerender (pattern: overview/nodes pages) |
| Latest host/service/chain reads | Database (nodemon) via read layer | — | Shipped Phase-11 helpers; AFM-001 DISTINCT ON inside the helpers |
| **NEW** history reads (vitals series, storage samples) | Database (nodemon) via read layer | — | Bounded time-window scans, parameter-bound, added to `src/lib/read/` |
| Severity rollup / driver line / bands / projections | Pure lib modules (`src/lib/overview/`, `src/lib/read/`) | — | No component computes health (12-10 lesson); `ThresholdMeter` receives `sev`, never derives it |
| Facet filtering + worst-first sort | Client `<Link>` chips + RSC re-parse | Browser (URL params) | Mirror `NodeFilters.tsx`: URL is source of truth; pure view filter, no re-query |
| Node dots / on-host rows navigation | Browser (next/link) | — | Read-only deep-links; dot click stops propagation |
| Runbook display | Browser (CommandModal client island) | — | Inert copy-to-run only; never executes |

## Standard Stack

### Core (all already installed — verified in package.json; ZERO new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next (App Router) | 16.x (repo) | RSC routes `/hosts`, `/hosts/[hostId]` | Workspace standard; `force-dynamic` + `revalidate = 0` pattern |
| react / react-dom | 19.2.x | UI runtime | Locked |
| drizzle-orm | 0.45.x | `sql` template for the new history reads | Read-layer convention (`host-metrics.ts:72-96`) |
| lucide-react | ^0.577 | `Server` icon (already in `RAIL_ITEMS`) | Locked icon set |
| vitest | 4.x (`vitest.config.ts` present) | Tests for every new pure module + primitive | Established gate |

`[VERIFIED: repo package.json + source]` — this phase's UI-SPEC Registry Safety section states "Zero new dependency installs expected" and the audit confirms nothing new is needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `getHostMetricsHistory` read | Deriving sparklines client-side from repeated latest reads | Absurd; history read is the only honest source |
| `SeverityRow` compact variant for on-host nodes | Reusing `NodesTable` | NodesTable carries sortable headers + full column set D-12 explicitly trims; SeverityRow is the locked compact grammar |
| `VmVitals` component reuse for HOST-02 B3 | Raw `Sparkline` + `ThresholdMeter` composition | `VmVitals` (`src/components/node/VmVitals.tsx`) is presentational, serializable-prop-driven, already implements the honest-stale `StaleChart` branch — reuse it (see Open Question 2 on the spec's `Sparkline` wording) |

## Package Legitimacy Audit

**No external packages are installed by this phase.** The approved 14-UI-SPEC's Registry Safety gate confirms: no new shadcn blocks, no third-party registry (`components.json` → `"registries": {}` verified 2026-07-13), the only new component is the hand-written `ThresholdMeter` df primitive. slopcheck run not required — nothing to audit.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────────────────────────┐
                         │  nodemon DB (RW client, telemetry)           │
                         │  hosts (dim) · host_metrics · host_storage   │
                         │  chain_telemetry · service_inventory/health  │
                         └───────┬──────────────────────┬───────────────┘
                                 │ latest (shipped)     │ history (NEW, Wave 1)
             ┌───────────────────▼──────────┐   ┌───────▼─────────────────────┐
             │ src/lib/read/*               │   │ getHostMetricsHistory(hostId)│
             │ getLatestHostMetrics()       │   │ getHostStorageHistory(hostId)│
             │ getChainTelemetry()          │   │  (bounded window, param-bound)│
             │ getServiceHealth(hostId)     │   └───────┬─────────────────────┘
             └───────┬──────────────────────┘           │
   warehouse ────────┤                                  │
   loadFleetView()   │                                  │
   (ScorecardView[]) │                                  │
             ┌───────▼──────────────────────────────────▼─────────────────────┐
             │ PURE LAYER (all unit-tested, no DB imports)                    │
             │ severity-map · ownership · incidents (shipped, reuse)          │
             │ NEW: host-rollup (worst-of + driver line)                      │
             │ NEW: days-to-full band evaluator (4-level, in telemetry-bands) │
             │ NEW: host-filter (parseHostFacets/applyHostFilters/sort)       │
             │ NEW: projection humanizer + status copy                        │
             │ NEW: host runbook builder (verify-first steps per driver)      │
             │ computeStorageGrowth (shipped, first production consumer)      │
             └───────┬──────────────────────────────┬────────────────────────┘
                     │                              │
      ┌──────────────▼───────────────┐  ┌───────────▼──────────────────────┐
      │ /(overview)/hosts (RSC)      │  │ /(overview)/hosts/[hostId] (RSC) │
      │ HostFilters (client chips)   │  │ header → incident banner (SC+    │
      │ HostCard grid:               │  │ CommandModal runbook) → VmVitals │
      │  SeverityCard chrome +       │  │ (EvidenceChart/StaleChart) →     │
      │  ThresholdMeter ×3 +         │  │ TwoAxisPip trio → StorageVolumes │
      │  TwoAxisPip ×3 + node dots   │  │ (ThresholdMeter rows) →          │
      │  (tooltip + deep-link)       │  │ OnHostNodes (SeverityRow compact)│
      └──────────────┬───────────────┘  └───────────┬──────────────────────┘
                     │  card click → /hosts/[hostId] │ dots/rows → /[pubkey]
                     └──────────── read-only navigation only ───────────────┘
```

### Recommended Project Structure

```
src/
├── app/(overview)/hosts/
│   ├── page.tsx                      # HOST-01 list RSC (analog: nodes/page.tsx)
│   └── [hostId]/page.tsx             # HOST-02 detail RSC (analog: [pubkey]/page.tsx)
├── components/
│   ├── df/ThresholdMeter.tsx (+test) # D-03 — the ONE new primitive
│   └── host/                         # composition leaves (Server unless noted)
│       ├── HostCard.tsx              # SeverityCard + meters + trio + dots
│       ├── HostFilters.tsx           # "use client" chips (clone NodeFilters.tsx)
│       ├── HostIncidentBanner.tsx    # SeverityCard + CommandModal
│       ├── StorageVolumes.tsx        # ThresholdMeter rows + projection copy
│       └── OnHostNodes.tsx           # compact SeverityRow rows
├── lib/
│   ├── overview/
│   │   ├── host-rollup.ts (+test)    # worst-of severity + D-05 driver line
│   │   └── host-filter.ts (+test)    # parseHostFacets/applyHostFilters/sortWorstFirst
│   └── read/
│       ├── host-history.ts (+test)   # NEW bounded history reads (metrics + storage)
│       ├── telemetry-bands.ts        # MODIFY: add 4-level days-to-full config+evaluator
│       └── storage-projection.ts (+test)  # humanizer (D-15) + status copy (D-14)
└── app/(design)/design-system/       # MODIFY: register ThresholdMeter states
```

### Pattern 1: RSC list/detail page shape (clone Phase 13 verbatim)

**What:** `force-dynamic` + `revalidate = 0`, server reads in `try/catch` with the honest read-only error copy, `NavRailShell` wrap, `searchParams` → `URLSearchParams` → whitelist parse.
**Source:** `src/app/(overview)/nodes/page.tsx` (whole file, 208 lines) — the exact template for `hosts/page.tsx`. The `[pubkey]` gauntlet in `src/app/(overview)/[pubkey]/page.tsx` is the detail-page template — substitute the pubkey regex with a hosts-dimension membership check (see Security Domain).
**Key detail:** `NavRailShell` already carries the hosts rail item — `RAIL_ITEMS` at `NavRailShell.tsx:29-34` includes `{ key: "hosts", href: "/hosts", label: "Hosts", Icon: Server }`. **No NavRailShell edit is needed**; pass `active="hosts"`. The per-page `opsNav` arrays (overview `page.tsx:484-490`, nodes `page.tsx:24-30`) do NOT yet include a Hosts entry — add `{ key: "hosts", label: "Hosts", href: "/hosts" }` to each (3 pages: overview, nodes, and the new hosts pages' own array).

### Pattern 2: Host worst-of rollup + driver line (NEW pure module)

**What:** One df `Severity` per host card + ONE driver phrase (D-05). Compose only sanctioned mappers:

```typescript
// src/lib/overview/host-rollup.ts — pure, no DB imports (pattern: severity-map.ts)
// Inputs: HostMetricsView, ChainTelemetryView | undefined, ServiceHealthState[],
//         node severities (pre-reduced ScorecardView → Severity via the overview's
//         nodeSeverity mapping), latest storage rows + growth results.
// Contributors, each { sev: Severity, phrase: string }:
//  resources: evaluateBand(Number(cpu_pct), TELEMETRY_BANDS.cpuPctBusy) → severityFromBand
//             mem: (mem_available_kb / mem_total_kb) * 100 → memAvailablePct band
//             disk (per mount): (avail/total)*100 → diskPctFree band (worst mount)
//  infra:     severityFromService(s) per host-level trio service; bitcoind ALSO
//             graded by the chain bands (mirror gradeChain in incidents.ts:116-122)
//  nodes:     the pre-reduced node severities for ownership.nodesByHost[hostId]
//  storage:   daysToFullSeverity(growth) — the NEW 4-level evaluator (D-13)
// rollup.sev = worstSeverity(all contributor sevs)  // stale filtered out, D-08
// rollup.driver = phrase of the FIRST contributor whose sev === rollup.sev,
//                 in fixed precedence infra → nodes → resources → storage
//                 (a host card is a mini-incident summary; omit when healthy)
```

**Critical constraint:** do NOT modify `gradeHost` in `incidents.ts` (`:110-113`) — the incident tree's semantics are Phase-12-locked (its stale-or-healthy host grading feeds the queue). The card rollup is a **view-side** composition consumed only by the hosts screens. `[VERIFIED: incidents.ts source]`

**Driver phrases (Copywriting Contract, verbatim targets):** `driven by: bitcoind not functioning` · `driven by: disk filling — ~5 days to full` · `driven by: 2 nodes critical`.

### Pattern 3: Days-to-full 4-level band (extends telemetry-bands, NEW shape)

**What:** D-13 requires critical <7d / warning <30d / watch <90d / healthy — FOUR levels. The existing `TelemetryBand` type is three-level and `severityFromBand` cannot emit `watch` (`severity-map.ts:45-54`). Add a dedicated config + evaluator in `telemetry-bands.ts` returning df ramp values directly:

```typescript
// telemetry-bands.ts addition — read-time, re-tunable (D-13 / P11 D-14)
export const DAYS_TO_FULL_BANDS = {
  critical: 7, warning: 30, watch: 90, // healthy beyond; [ASSUMED-free: D-13 locked]
} as const;
export type DaysToFullSeverity = "critical" | "warning" | "watch" | "healthy";
export function evaluateDaysToFull(days: number): DaysToFullSeverity {
  if (days < DAYS_TO_FULL_BANDS.critical) return "critical";
  if (days < DAYS_TO_FULL_BANDS.warning) return "warning";
  if (days < DAYS_TO_FULL_BANDS.watch) return "watch";
  return "healthy";
}
```

These literals are already df `Severity` members — no mapper needed, but keep the function in the config module so no component hardcodes a threshold (locked invariant, 12-10 lesson). Volume-row severity = `worstSeverity([usedPctSev, daysToFullSev])` per UI-SPEC assumption 6.

### Pattern 4: NEW bounded history reads (read-layer conventions)

**What:** `host_metrics` / `host_storage` are append-history tables; the sparkline series and growth samples need time-window scans (NOT DISTINCT ON — that is the *latest* pattern). Follow the module conventions in `host-metrics.ts`:

```typescript
// src/lib/read/host-history.ts — conventions verified against host-metrics.ts:72-96
export function buildHostMetricsHistorySql(hostId: string, windowMs: number): SQL {
  return sql`
    SELECT host_id, collected_at, cpu_pct, mem_total_kb, mem_available_kb
    FROM host_metrics
    WHERE host_id = ${hostId}                       -- ALWAYS parameter-bound
      AND collected_at > now() - make_interval(secs => ${windowMs / 1000})
    ORDER BY collected_at ASC
  `;
}
// storage: same shape over host_storage, +mount_point, +used_bytes/total_bytes
// → maps to StorageGrowthSample[] per mount for computeStorageGrowth
export async function getHostMetricsHistory(...) {
  const { dbNodemon } = await import("@/lib/db/nodemon"); // lazy — no-DB test graph
  ...
}
```

**Coercions (verified pitfalls):** raw `.execute()` surfaces numerics as strings (`cpu_pct: string | number | null` in `LatestHostMetricsRow`) and timestamps as ISO strings — coerce with `Number()` and `parseDbTimestampUtc` (`src/lib/read/db-timestamp.ts`), exactly as `getLatestHostMetrics` does. bigints stay raw; ratios computed in pure code; display bytes only via AFM-002 `units.ts`.
**Row volume:** 24h at the collector cadence is bounded (~≤1500 rows/host) — acceptable for a per-host detail page; the list page needs NO history (meters use latest values only).
**Growth-sample window:** `computeStorageGrowth` refuses to project below a 1h span (`DEFAULT_MIN_WINDOW_MS`) and requires the latest sample within 15 min. Fetch ≥24h of storage samples so the slope is trustworthy; "gathering data — projection in ~Nh" copy (D-14) derives N from `minWindow − currentSpan`.

### Pattern 5: Incident banner + runbook (compose shipped pieces + one new copy module)

**What:** Run `assembleIncidents` over the same inputs the overview builds (fail-soft `Promise.all` of the five reads — the pipeline in `(overview)/page.tsx:185-242` is the template; its TTL memo is page-local and NOT exported, so the host detail composes its own reads) and select `incidents.find(i => i.key === hostId)`. Render `SeverityCard` (sev/title/why/`childAlerts` from `GroupedIncident.children`) + `CommandModal` trigger.
**Gap:** `GroupedIncident` carries **no runbook** and `buildExportBlock` (`src/lib/export/commands.ts`) is insight-card-keyed (fee/pending exports) — there is no host-operation runbook source. A small pure builder is needed: map the incident driver class (bitcoind down / service not functioning / disk filling / node critical) → `{ title, runbook: RunbookStep[], command: string }` with "Verify first" steps preceding the command (CommandModal `kind` selects the risk-tier chrome; `RunbookStep` = `{ n, text }`, `CommandModal.tsx:81-108`). Content is operator-facing copy (e.g. verify `systemctl status bitcoind`, check `bitcoin-cli getblockchaininfo`, then the restart command) — inert, copy-to-run only. `[VERIFIED: CommandModal.tsx source]`
**D-11 guard:** no "Open incident" affordance at all — not even disabled.

### Pattern 6: Facets + worst-first sort (clone node-filter, ONE sanctioned sort)

**What:** `parseHostFacets` clones `parseNodeFacets` (`node-filter.ts:81-90`) with the hosts vocabulary: `?sev` ∈ {all,critical,warning,watch,healthy} + `?stale` toggle. `applyHostFilters` = pure `.filter` only. **`sortHostsWorstFirst` is the ONLY `.sort` this phase introduces** — view-side over the loaded card models (severity rank desc → stale grouped after at-risk → healthy last → ties by hostId), applied in the new module with a test, never to incident children (engine-order-is-LAW applies to `assembleIncidents` output only). Chips: clone `NodeFilters.tsx` (`Link`-based, navy-active, `hrefFor` serializer).

### Pattern 7: Ownership / node dots data wiring

**What:** `buildOwnershipMap` needs `hosts: { hostId, nodePubkeys }[]`. **No production code reads `hosts.node_pubkeys` directly** — the shipped convention (both `incidents.ts:154-168` and `node-services.ts:50-64`) synthesizes the host→node edge from service `(hostId, nodePubkey)` pairs. Recommendation: follow that convention (services are already loaded per host for the trio). Caveat flagged as Assumption A1: a node declared in `hosts.node_pubkeys` but with zero node-scoped services in inventory would be invisible to the dots; if the fleet declares such nodes, add a direct dimension read (`hosts` table is in `src/lib/db/schema/nodemon.ts:120-123` with `nodePubkeys: text("node_pubkeys").array()`).
**Dot severity:** map `loadFleetView()` ScorecardViews through the overview's `nodeSeverity` (stale → dot switch, `(overview)/page.tsx:76-87`), group by `hostByNode`. Dot = 8px severity-accent circle + `ui/tooltip` (alias + `severityLabel`) + `next/link` to `/${pubkey}` with `e.stopPropagation()` (dot links inside a clickable card require a client leaf or the anchor-in-anchor-safe layered layout — see Pitfall 6).

### Pattern 8: ThresholdMeter (the one new primitive — full contract in UI-SPEC)

Presentation-pure div/CSS meter, props `{ pct, sev, stale?, label?, className? }`; fill class via `severityAccent[sev]` (NEVER an `if (sev === …)` chain); `stale` renders the gold hatched track with NO fill; `role="meter"` + `aria-valuenow/min/max` + adjacent mono value. Register in `/design-system` gallery with all severity states + stale + 0%/100% edges (fixtures pattern: `src/app/(design)/design-system/fixtures.ts`); ships with a vitest test; must pass `npm run lint:noc-guard` (df tokens only — the guard greps `src/components/df` + `src/app/(design)` for NOC tokens, `package.json:10`).

### Anti-Patterns to Avoid

- **Component computing health:** `ThresholdMeter` deriving its own severity from `pct` — forbidden (12-10 lesson; UI-SPEC locks "presentation-pure").
- **`severityFromBand` for days-to-full:** it has no `watch` output — the 4-level evaluator is separate (Pattern 3).
- **Re-deriving two-axis precedence:** `TwoAxisPip.combinedState()` is locked (`TwoAxisPip.tsx:50-57`); feed booleans, never pre-compute labels.
- **`WHERE collected_at = MAX(...)`:** the AFM-001 landmine; latest reads are shipped, history reads are plain bounded scans.
- **Applying `applyFreshnessCutoff` to the hosts-list enumeration:** the 30-day cutoff is an overview-queue fix; D-06 mandates ALL declared hosts render (no-data cards). `getLatestHostMetrics` already returns every dimension row with `hasData: false` when silent — use it unfiltered for the list.
- **Rendering raw machine keys:** trio labels via `serviceDisplay().label` (bitcoind/esplora seeded in `SERVICE_DISPLAY`).
- **Editing `incidents.ts` / `severity-map.ts` / `ownership.ts`:** Phase-12 locked pure modules — compose, never modify.
- **Inline `/1000` byte/sat math:** AFM-002 `units.ts` is the sole display-unit path; pure ratio math (used/total fractions) is fine in lib code (per `storage-growth.ts` precedent).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest per-host/service/chain state | New DISTINCT ON queries | `getLatestHostMetrics` / `getServiceHealth` / `getChainTelemetry` | AFM-001 centralized; tested |
| Growth math + honesty gates | New projection logic | `computeStorageGrowth` (`storage-growth.ts:71-121`) | All 5 `StorageProjectionStatus` cases shipped + tested; SC#3 is a rendering task |
| Severity normalization / worst-of reduction | Inline `=== "warn"` chains | `severity-map.ts` mappers + `worstSeverity` | The single documented boundary; type system is the guard |
| Host→node/service containment | A stored graph or ad-hoc joins | `buildOwnershipMap` | Read-time, drift-proof, tested |
| Incident grouping | Per-screen alert assembly | `assembleIncidents` keyed by hostId | Engine-order-is-LAW; host-keyed tree shipped |
| Facet parsing | Free-string param reads | Clone `parseNodeFacets` whitelist-widen | V5 discipline, tested pattern |
| Relative freshness display | New age formatting | `FreshnessChip` / `PollAge` / `deriveStale` | Honest-stale treatment locked |
| Stale chart placeholder | Custom empty chart | `StaleChart` (`width`, `height`, `lastGoodLabel`, `idSuffix`) | "NO FRESH DATA" hatched gold, locked |
| Runbook/command display | Custom modal | `CommandModal`/`CommandPanel` (`command`, `runbook: RunbookStep[]`, `kind`, `title`, `sev`, `trigger`) | Inert-by-construction; React-escaped `<code>` |
| Timestamp coercion | `new Date(row.x)` inline | `parseDbTimestampUtc` | Offset-less UTC strings handled (WR-01) |

**Key insight:** the read model and severity machinery were built in Phases 11–12 precisely so these screens are composition; every piece of health *logic* this phase writes must be a new pure module with its own test, never inline in a component or route.

## Common Pitfalls

### Pitfall 1: Assuming the history reads exist
**What goes wrong:** Plans wire `Sparkline`/`computeStorageGrowth` to reads that don't exist; execution stalls or ships empty sections (the shipped Node Detail did exactly this — `VmVitals charts={[]}`).
**Why:** CONTEXT says "the full read API exists" — true for *latest* reads only.
**How to avoid:** Schedule `src/lib/read/host-history.ts` as an early wave with a no-DB SQL-shape test (pattern: `host-metrics.test.ts`).
**Warning signs:** any plan task saying "wire the sparkline" without a named history reader.

### Pitfall 2: 3-level band type vs 4-level D-13 bands
**What goes wrong:** Forcing days-to-full through `TelemetryBand`/`severityFromBand` silently loses the `watch` tier.
**How to avoid:** Pattern 3's dedicated evaluator; test all four boundaries (6.9→critical, 7→warning, 29.9→warning, 30→watch, 89.9→watch, 90→healthy, per the deterministic boundary-belongs-to-healthier convention — pin the chosen convention in the test).

### Pitfall 3: Raw-execute type coercion
**What goes wrong:** `cpu_pct` arrives as a string (`"42.5"`), `collected_at` as an ISO string; naive arithmetic yields `NaN`/string concat; `Date` math on strings throws.
**How to avoid:** `Number()` + `parseDbTimestampUtc` at the read boundary, exactly as `getLatestHostMetrics:159-186` does. bigint kb columns → `Number()` only inside pure ratio math.

### Pitfall 4: Stale data leaking into meters/projections
**What goes wrong:** A `ThresholdMeter` painted green/red off a stale reading, or a projection rendered when `status !== "ok"`.
**How to avoid:** Stale host → `stale` prop on every meter (hatched, no fill) + `StaleChart` panels; projection slot ALWAYS renders (number or status copy, D-14) — never hidden. `computeStorageGrowth` already refuses stale projections (Gate 2); the renderer must branch on `status`, not on `daysToFull != null` alone. Note `flat-or-negative` still carries a non-null (possibly negative) `pctPerDay` — render the rate with its sign plus "not growing".

### Pitfall 5: hostId as an unvalidated dynamic segment
**What goes wrong:** `[hostId]` is operator-editable text (no 66-hex regex analog); passing it straight into reads is injection-safe (parameter-bound) but yields confusing empty pages, and echoes attacker-controlled text into the header.
**How to avoid:** Load the hosts dimension first (`getLatestHostMetrics()` — it enumerates the dimension), membership-check `hostId` against the returned `hostId` set, `notFound()` on miss — the hosts-list analog of the PUBKEY_RE gauntlet. Never render a hostId that failed the membership check.

### Pitfall 6: Interactive dots inside a clickable card
**What goes wrong:** Nested `<a>` inside `<a>` (card link wrapping dot links) is invalid HTML — React/Next will hydrate-warn or break navigation.
**How to avoid:** Do NOT wrap the whole card in `<Link>`. Pattern: card container is a plain div; a card-level "stretched link" (absolutely-positioned `Link` covering the card, `z-0`) + dots/pips rendered `z-10 relative` above it — or make dot clicks a small client leaf calling `router.push` with `stopPropagation`. Either satisfies D-07's "stops propagation".

### Pitfall 7: Trio tile deep-links to a node-scoped route
**What goes wrong:** The Phase-13 Service Detail route is `/(overview)/[pubkey]/service/[service]` — host-level infra services have `nodePubkey === null`, so most trio tiles have NO valid target.
**How to avoid:** Per UI-SPEC B4: link only when a node scope applies (a node-scoped instance of the service exists via `servicesByNode`); otherwise the tile is informational — no dead link, no disabled affordance.

### Pitfall 8: Divergent per-page opsNav arrays
**What goes wrong:** Hosts ships without a top-bar entry from the overview/nodes pages (the 12-11 gap repeats).
**How to avoid:** Add the `hosts` opsNav item to the overview and nodes pages (and use the same array on both hosts pages). Consider extracting one shared `OPS_NAV` const while touching them (small, planner's call).

## Code Examples

All from repo source (authoritative):

### Reading everything a Host Detail needs (fail-soft, per the overview template)
```typescript
// analog: src/app/(overview)/page.tsx:185-242 — per-read .catch degrade
const [hostsAll, chain, fleet] = await Promise.all([
  getLatestHostMetrics().catch(() => [] as HostMetricsView[]),
  getChainTelemetry().catch(() => [] as ChainTelemetryView[]),
  loadFleetView().catch(() => ({ nodes: [], fetchedAt: new Date() })),
]);
const host = hostsAll.find((h) => h.hostId === hostId);
if (!host) notFound();                       // membership gate BEFORE echoing hostId
const services = await getServiceHealth(hostId).catch(() => []);
// derived: ownership (services-pairs convention), rollup, incident:
const incidents = assembleIncidents({ rankedCards, hosts: hostsAll, chain, services: allServices, nodes: fleet.nodes });
const incident = incidents.find((i) => i.key === hostId) ?? null;  // banner absent when null
```

### Trio tile from the shipped state (never re-derive)
```typescript
// TwoAxisPip props (TwoAxisPip.tsx:30-47) — booleans in, precedence internal
const trio = ["bitcoind", "esplora", "postgres"] as const;
const hostLevel = services.filter((s) => s.hostId === hostId && s.nodePubkey === null);
trio.map((key) => {
  const s = hostLevel.find((x) => x.serviceName.toLowerCase() === key);
  // s may be undefined (not declared) or noData — render honest unknown, never green
  return s && !s.noData
    ? <TwoAxisPip name={serviceDisplay(s.serviceName).label} running={s.running} functioning={s.functioning} errorCount={s.errorCount} /* heartbeat/lastRun humanized upstream */ />
    : /* honest no-data tile treatment */;
});
```

### Storage volume row inputs (first production use of computeStorageGrowth)
```typescript
// per mount: samples from the NEW getHostStorageHistory, latest % from host.storage
const growth = computeStorageGrowth(samplesForMount);         // pure, shipped
const usedPct = growth.latestPctUsed;                          // 0–100 | null
const usedSev = severityFromBand(evaluateBand(100 - (usedPct ?? 0), TELEMETRY_BANDS.diskPctFree)); // band is %-FREE
const rowSev = growth.status === "ok"
  ? worstSeverity([usedSev, evaluateDaysToFull(growth.daysToFull!)])
  : usedSev;                                                   // UI-SPEC assumption 6
// projection slot: status === "ok" → humanizeDaysToFull(growth.daysToFull) + `+${rate}%/day`
//                  else → the D-14 status copy (row NEVER hidden; stale → stale row treatment)
```

### Facet chips (verbatim clone target)
```typescript
// NodeFilters.tsx:29-56 — Link-based chips, navy-active, URL serializer.
// hosts version: sev chips (All/Critical/Warning/Watch/Healthy) + Stale-only toggle.
```

## State of the Art (repo-internal)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dark NOC theme, emoji/icons for state | Light-first df system, text+color+label | Phase 10 (DS-03) | Hosts screens are df-only; noc-guard lint enforces |
| URL-navigation filtering (8s/toggle) | `Link` chips over TTL-memoized reads (nodes) or client island (overview) | 12-12 | Hosts list: `Link`-chip + RSC re-parse (nodes pattern) is sufficient; a client island is optional if reads prove slow |
| Stored severity/stale flags | Read-time derivation (`deriveStale`, bands, `deriveServiceHealth`) | Phase 11 D-13/D-14 | All Phase-14 health values computed at read time |
| Bare top-level orphan incidents | "Unattributed" bucket appended last | 12-13 | Host detail banner only reads host-keyed incidents; unattributed never appears there |

**Deprecated/outdated:** `SeverityRow` `identity`/`evidence`/`kind`/`detail` props are v1 back-compat aliases — new code uses `id`/`note`/`status`/`href`.

## Runtime State Inventory

Not applicable — greenfield UI phase (new routes + new pure modules; no rename/refactor/migration). No schema change, no migration, no stored state touched. The only MODIFY targets are `telemetry-bands.ts` (additive export), the two `opsNav` arrays (additive item), and the design-system gallery (additive fixtures).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Deriving host→node edges from service `(hostId, nodePubkey)` pairs (the shipped convention) covers every declared on-host node; no node exists in `hosts.node_pubkeys` without a node-scoped service in `service_inventory` | Pattern 7 | Node dots / on-host rows silently miss a declared node. Mitigation: cheap direct `hosts` dimension read (schema exists) if the fleet data shows the gap — confirm against real `service_inventory` during planning |
| A2 | The collector cadence keeps a 24h `host_metrics` window ≤ a few thousand rows/host (fine for one detail-page read) | Pattern 4 | Slow detail page; mitigate by down-sampling in SQL (`date_trunc` bucket) — decide at plan time if cadence is sub-minute |
| A3 | Host runbook copy (verify-first steps per driver class) is Claude-authored operator prose; no canonical runbook source exists in the repo | Pattern 5 | Operator may reject copy at the visual gate; low risk — inert text, easily revised |
| A4 | `make_interval`/`now()` interval predicate is acceptable on the nodemon Postgres (standard PG) | Pattern 4 | Trivial rewrite to a bound epoch-ms comparison if not |

## Open Questions (RESOLVED)

1. **How should planning reconcile "must not write new warehouse/nodemon queries" (CONTEXT code-context) with the missing history reads?**
   - What we know: sparklines + growth samples are unbuildable without them; the CONTEXT line sits in the *insights* section, not the locked decisions; the locked decisions (D-13…D-16) *require* growth computed "from ingested growth".
   - Recommendation: treat the two bounded history reads as in-scope read-layer additions (they are reads of Phase-11 tables, not new telemetry), follow the module conventions, flag in the plan header so the operator sees the scope call.
   - **RESOLVED:** Adopted — the two bounded history reads are in-scope read-layer additions. 14-02's objective flags the scope call to the operator; the conflicting "no new nodemon queries" line sits in CONTEXT `<code_context>` (insight), not the locked `<decisions>` block, and locked D-13…D-16 + SC#2/SC#3 require these reads.

2. **UI-SPEC B3 says `Sparkline`; the shipped Node Detail vitals treatment is `VmVitals` (EvidenceChart-based).**
   - What we know: the spec's discretion note says "matching the Node Detail VM-vitals treatment … confirm against the shipped `VmVitals` window during planning" — but VmVitals shipped EMPTY (no window exists to mirror). `VmVitals` is presentational and directly reusable; `EvidenceChart` is richer (threshold line, projection, axis labels) than bare `Sparkline`.
   - Recommendation: reuse `VmVitals`/`EvidenceChart` for HOST-02 vitals (it IS the sibling treatment, honest-stale branch included) with a 24h window; optionally back-fill the Node Detail's empty `charts={[]}` with the same new history reader (small win, planner's call whether in-scope).
   - **RESOLVED:** Adopted — 14-06 reuses `VmVitals` for HOST-02 vitals; 14-07 back-fills Node Detail's empty `charts={[]}` with the same host-history reader.

3. **Hosts list severity facet vocabulary vs the stale state.** D-08/UI-SPEC list chips are All/Critical/Warning/Watch/Healthy + "Stale only" — note `stale` is NOT a severity chip (mirrors the overview's honest-state discipline). A no-telemetry host has rollup severity `healthy`-after-stale-filter; it must surface under the stale toggle and sort after at-risk. Pin this in the `host-filter` test (stale grouped after at-risk, before/among healthy per D-08 sort spec).
   - **RESOLVED:** Adopted — stale placement (grouped after at-risk, before/among healthy) is pinned in 14-04 Task 1's behavior and acceptance criteria for `host-filter.test.ts`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| nodemon Postgres (env-var URL) | all telemetry reads | ✓ (existing `dbNodemon` client; Phase 11/12/13 run against it) | — | fail-soft `.catch` → honest error/empty states (pattern shipped) |
| Warehouse reads (`loadFleetView`) | node dots / on-host rows | ✓ (existing) | — | per-read degrade |
| Node.js / npm / vitest / next | build + test | ✓ (repo toolchain) | vitest.config.ts present | — |

No new external dependency, service, or tool. Known pre-existing caveat: `next build` may hang in the sandbox TS phase (STATE.md deferred item) — operator confirms builds out-of-band.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`vitest.config.ts` — carries the `@/` alias; plain node/ESM) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run <path>` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOST-01 | Worst-of rollup + driver line (D-05) | unit | `npx vitest run src/lib/overview/host-rollup.test.ts` | ❌ Wave 0 |
| HOST-01 | Facet codec + pure filter + worst-first sort (D-08) | unit | `npx vitest run src/lib/overview/host-filter.test.ts` | ❌ Wave 0 |
| HOST-01 | `ThresholdMeter` states (sev fill via ramp API, stale hatch, 0/100 edges, a11y attrs) | unit | `npx vitest run src/components/df/ThresholdMeter.test.tsx` | ❌ Wave 0 |
| HOST-02 | History-read SQL shape (param-bound, bounded window) — no-DB | unit | `npx vitest run src/lib/read/host-history.test.ts` | ❌ Wave 0 |
| HOST-02 | Days-to-full 4-level boundaries (D-13) | unit | `npx vitest run src/lib/read/telemetry-bands.test.ts` (extend existing) | ✅ extend |
| HOST-02 | Projection humanizer bands (D-15) + status copy map (D-14) | unit | `npx vitest run src/lib/read/storage-projection.test.ts` | ❌ Wave 0 |
| HOST-02 | Growth honesty gates | unit | `npx vitest run src/lib/read/storage-growth.test.ts` | ✅ shipped |
| both | noc-guard token discipline on new df/(design) surfaces | lint | `npm run lint` | ✅ shipped gate |
| both | Live visual gate (operator) — cards, no-telemetry card, detail sections, honest projections | manual-only | — (justification: visual quality bar per D-01/DESIGN-BRIEF-02; matches Phase 12/13 operator gates) | — |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched module test>`
- **Per wave merge:** `npm test` (full vitest suite; note 4 pre-existing `src/lib/queue/*` live-DB test timeouts without a nodemon connection are known-unrelated per 12-CLOSE)
- **Phase gate:** full suite green + `npm run lint` (noc-guard) before `/gsd:verify-work`; `next build` confirmed by operator out-of-band (sandbox hang caveat)

### Wave 0 Gaps
- [ ] `src/lib/overview/host-rollup.test.ts` — HOST-01 rollup + driver
- [ ] `src/lib/overview/host-filter.test.ts` — HOST-01 facets/sort
- [ ] `src/components/df/ThresholdMeter.test.tsx` — D-03 primitive
- [ ] `src/lib/read/host-history.test.ts` — HOST-02 series/samples SQL shape
- [ ] `src/lib/read/storage-projection.test.ts` — D-14/D-15 copy + humanize
- [ ] extend `src/lib/read/telemetry-bands.test.ts` — D-13 boundaries

## Security Domain

Phase is **read-only end to end** (UI-SPEC locked: no write path, no enqueue, inert runbook modal). `security_enforcement` posture: Grade-A required at Phase 16; this phase must add zero CRITICAL/HIGH surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | local-first operator tool; unchanged |
| V3 Session Management | no | — |
| V4 Access Control | no (no write path this phase) | — |
| V5 Input Validation | **yes** | `[hostId]` segment: membership-check against the loaded hosts dimension → `notFound()` (Pitfall 5); `?sev`/`?stale` params: closed-vocab whitelist, invalid silently widens (clone `parseNodeFacets`) |
| V6 Cryptography | no (no HMAC path touched) | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via hostId | Tampering | Drizzle `sql` template parameter binding (every read helper; the NEW history reads must follow — pin in the SQL-shape test) |
| Reflected untrusted text (hostId/hostname/service detail in headers/driver lines) | Tampering/Info | React auto-escaping only (no `dangerouslySetInnerHTML` anywhere — grep gate); hostId rendered only after membership check |
| Command execution from runbook UI | Elevation | `CommandModal` renders command as escaped text child; copy-to-clipboard only (verified `CommandModal.tsx:108-160`); zero-write-path grep battery re-run at gate |
| DB name / infra info-leak | Info disclosure | 12-11 precedent: never render internal DB names (`routing_vm` grep = 0 stays green); host runbook copy must not embed credentials or internal endpoints |
| Fake freshness / stale-as-healthy | (honesty invariant) | `deriveStale` read-time only; stale/no-data treatments locked (D-06/D-14) |

## Sources

### Primary (HIGH confidence — repo source, read in full this session)
- `src/lib/read/host-metrics.ts`, `storage-growth.ts`, `telemetry-bands.ts`, `service-health.ts`, `chain-telemetry.ts` (shapes + gaps)
- `src/lib/overview/incidents.ts`, `ownership.ts`, `severity-map.ts`, `node-filter.ts`; `src/lib/read/node-services.ts`
- `src/app/(overview)/page.tsx`, `nodes/page.tsx`, `[pubkey]/page.tsx:295-298` (the empty `VmVitals` proof)
- `src/components/df/`: `TwoAxisPip`, `SeverityCard`, `SeverityRow`, `StaleChart`, `FreshnessChip`, `CommandModal`, `NavRailShell` (RAIL_ITEMS hosts entry), `Severity.ts`; `src/components/node/VmVitals.tsx`, `NodeFilters.tsx`
- `src/lib/db/schema/nodemon.ts:118-123` (hosts dimension, `node_pubkeys`)
- `package.json` scripts (vitest, noc-guard), `vitest.config.ts` presence
- `.planning/phases/14-hosts-infra-monitoring/14-CONTEXT.md` + `14-UI-SPEC.md` (approved), `.planning/phases/13-nodes-service-health/13-PATTERNS.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md:108-109`
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md`

### Secondary / Tertiary
- None needed — zero external-technology questions; no WebSearch performed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero installs; everything verified in-repo
- Architecture: HIGH — every composition target read at source; the three gaps verified by absence (grep + file reads), not assumed
- Pitfalls: HIGH — each derived from a shipped precedent or a locked invariant

**Research date:** 2026-07-13
**Valid until:** phase completion (repo-internal findings; re-verify only if Phases 12–13 modules change)
