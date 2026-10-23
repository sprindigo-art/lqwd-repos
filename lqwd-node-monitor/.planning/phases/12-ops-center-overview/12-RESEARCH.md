# Phase 12: Ops Center Overview - Research

**Researched:** 2026-06-30
**Domain:** Full-stack read-time composition — root-cause grouping, cross-layer severity normalization, advisory narration, proportional rollup (Next.js App Router + TS, no new deps)
**Confidence:** HIGH (all findings verified by reading the actual source in this repo)

## Summary

Phase 12 builds **zero new monitoring capability and installs zero new dependencies**. It is a read-time *derivation + composition* layer that sits on top of code that already exists and is already tested: the Phase-4 insight engine (`src/lib/insight/*`), the Phase-11 telemetry read helpers (`src/lib/read/*`), the Phase-10 design tokens (`src/lib/df/tokens.ts`, `src/components/df/Severity.ts`), and the Phase-10 df primitives (`SeverityHeroCard`, `SeverityCard`, `AiReadPanel`, etc.). Critically, **the df primitives were already built with this phase's shape in mind** — `SeverityCard`/`SeverityHeroCard` already accept `childAlerts`, `rootCauseChip`, `aiLines`, `freshness`, and `evidence` props. The hard, novel work is **not UI** — it is the four read-time derivation helpers that produce the data those props consume.

The five hard parts decompose cleanly: (1) an **ownership/grouping helper** built from `hosts.node_pubkeys` (text array), `service_inventory.host_id` + `node_pubkey`, and node→channel from the read layer — no new schema, no stored graph; (2) a **cross-layer severity mapper** that normalizes four *different* existing severity vocabularies onto the canonical 5-state df ramp; (3) an **advisory band** that plugs into the existing `narrate` server action + `narrateCards` path — the guardrail is already structural and tested, the band must not rebuild it; (4) a **proportional vitals rollup** that is pure counting math over the per-layer read helpers; and (5) **read-time staleness reuse** via the already-exported `deriveStale` / per-entity `collected_at`.

**Primary recommendation:** Build one new pure module `src/lib/overview/` containing (a) `ownership.ts` (containment map), (b) `severity-map.ts` (per-source→ramp normalizer with a documented mapping table), (c) `incidents.ts` (assemble + group + worst-child rollup), (d) `vitals.ts` (proportional counts), (e) `ai-band.ts` (deterministic line builder). Keep every one of these PURE (no DB/server imports) so they are fixture-testable exactly like the existing `rank.ts`/`triage.ts`/`telemetry-bands.ts`. A thin server component (`src/app/(overview)/page.tsx` rework or a new route) loads the existing read helpers in `Promise.all`, feeds the pure layer, and composes df primitives.

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01…D-09, verbatim)

- **D-01 — Topology roll-up.** Grouping is containment-driven along host → service → node → channel. A parent failure (e.g. a host down/unreachable) collapses its child alerts (its services, the nodes running on it, those nodes' channels) into **one incident keyed by the parent**; children nest under it and drop out of the top-level queue.
- **D-02 — Incident severity = worst child** (max across the grouped children), on the canonical ramp (D-06).
- **D-03 — Ownership map is derivable from existing data:** `hosts.node_pubkeys`, `service_inventory.host_id` + `node_pubkey`, and node→channel from the nodes read layer. No new schema; build a read-time ownership/grouping helper, not a stored graph.
- **D-04 — Deterministic selection + ranking is the source of truth; the LLM only narrates phrasing.** Which incidents appear and their order come from the insight `rank` + cross-layer severity (D-06). LLM is **off by default behind an env flag**, and `src/lib/insight/guardrails.ts` MUST forbid any command/param emission — the band is provably **advisory-only**.
- **D-05 — The band is always present** — LLM off ⇒ deterministic templated lines (OVW-02 ships with zero LLM dependency); LLM on ⇒ rephrases the same lines. 1–4 lines, per-line severity. **Dismissal is session-scoped** (hides until reload; re-derives from live state each load). No new persistence.
- **D-06 — One canonical 4-level ramp** — `critical / warning / watch / healthy` (+ `stale` as its own state) — reusing the Phase-10 severity ramp verbatim. Every source maps via a **documented per-source mapping**: insight-engine ranking, `telemetry-bands` (host/chain thresholds), and `service-health` two-axis (RUNNING ∧ FUNCTIONING). Drives queue ordering, incident roll-up severity, and the vitals bar.
- **D-07 — Strictly proportional by entity count per state.** Health-bar segments sized by the **number of entities** in each state (critical/warn/watch/ok/stale) within a layer — literal proportionality, no severity weighting. Per-layer counts shown alongside. Denominator = all entities in that layer.
- **D-08 — Reuse Phase-11 read-time staleness** (`deriveStale` / per-entity `collected_at`); `stale` is its own state, **never rendered as critical** and never faked-fresh. All-clear = calm-hero state. No-data reads honestly everywhere — never green-by-default.
- **D-09 — Queue filters by layer and severity**, honest empty states from Phase-10 primitives. Filtering is a view concern over the same grouped incident set.

### Claude's Discretion

- The exact templated phrasing of deterministic AI-band lines.
- The read-time helper structure for grouping/ownership.
- The precise per-source→ramp threshold mapping (within the D-01…D-09 frame).

### Deferred Ideas (OUT OF SCOPE)

- Pivot navigation + deep per-entity screens (Nodes/Node Detail/Service Detail = Phase 13; Hosts/Infra = Phase 14). Overview rows LINK into these; the screens are not built here.
- Incident lifecycle (ack/assign/resolve) + AI explanation of an incident = Phase 15.
- Alerting / notification channels (push, email, Telegram).
- Durable / snooze dismissal for the AI band (session-scoped chosen).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OVW-01 | Full-stack root-cause-grouped attention queue across nodes/hosts/services/bitcoind/storage; row = severity + one-line why + layer | Ownership helper (§Hard Part 1) + severity map (§Hard Part 2) + `incidents.ts` assemble/group; feeds `SeverityCard.childAlerts` / `SeverityHeroCard.rootCauseChip` (both props already exist) |
| OVW-02 | AI "what needs you now" band, 1–4 prioritized lines, advisory-only, dismissible, per-line severity | `ai-band.ts` deterministic line builder over ranked incidents + existing `narrate` action / `narrateCards` (§Hard Part 3); renders into existing `AiReadPanel` (`AiReadLine[]`, `onDismiss`, `allClear`) |
| OVW-03 | Fleet-vitals rollup: per-layer counts + strictly proportional health bar | `vitals.ts` pure counting over the five read helpers (§Hard Part 4) |
| OVW-04 | Honest all-clear (calm hero) + honest stale/no-data everywhere, never faked freshness | `deriveStale` + per-entity `collected_at` reuse (§Hard Part 5); `AiReadPanel allClear`, `AllClearHero` via `SeverityHeroCard` healthy variant |
| OVW-05 | Queue filters by layer + severity, honest empty states | View-layer filter over grouped incident set; pattern mirrors existing `triage-facets.ts` whitelisting codec |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ownership/containment grouping | Pure lib (`src/lib/overview/ownership.ts`) | — | Derivable from already-loaded read data; pure + fixture-testable like `triage.ts`. NO DB query of its own. |
| Cross-layer severity normalization | Pure lib (`severity-map.ts`) | — | Four source vocabularies → one ramp; must be a documented pure mapping, no DB/clock. Mirrors `telemetry-bands.evaluateBand`. |
| Incident assembly + worst-child rollup | Pure lib (`incidents.ts`) | — | Consumes ranked insight cards + telemetry views, returns grouped tree. Pure. |
| Proportional vitals math | Pure lib (`vitals.ts`) | — | Pure counting (D-07 literal proportion). |
| AI-band deterministic lines | Pure lib (`ai-band.ts`) | Server action (`narrate`) for optional LLM upgrade | Determinism is source of truth (D-04); LLM is an OPTIONAL server-side rephrase. |
| Data loading (warehouse + nodemon reads) | API/Backend (Server Component + existing `src/lib/read/*` + `src/lib/insight/engine`) | — | All reads are server-only; `force-dynamic`, never prerendered (existing page pattern). |
| Rendering (queue/hero/band/vitals/filters) | Frontend Server (RSC) + thin Client islands | — | df primitives are mostly server-renderable; only interactivity (expand toggle, dismiss, filter chips) needs `"use client"`. Charts (`EvidenceChart`/`StaleChart` = Recharts) require `'use client'`. |

## Standard Stack

**Zero new dependencies.** This phase composes existing libraries already pinned in `package.json`. Confirmed installed and in use:

| Library | Version (installed) | Purpose here | Provenance |
|---------|--------------------|--------------|------------|
| next | 16.x (App Router) | RSC page + `force-dynamic` server reads | [VERIFIED: package.json + existing `(overview)/page.tsx`] |
| react / react-dom | 19.2.x | UI runtime | [VERIFIED: package.json] |
| recharts | 3.x | `EvidenceChart`/`StaleChart` (already built `df/*` primitives) | [VERIFIED: `src/components/df/EvidenceChart.tsx` imports] |
| zod | ^3.23 | Already governs the InsightCard contract (`schema.ts`); reuse for any filter-param whitelisting | [VERIFIED: `src/lib/insight/schema.ts`] |
| ai + @ai-sdk/anthropic | ^6.0 / ^3.0 | OPTIONAL narration via existing `narrateCards` (lazy-imported, off by default) | [VERIFIED: `src/lib/insight/narrative.ts`] |
| vitest | ^4 | Test runner (`vitest run`) — all `*.test.ts` use it | [VERIFIED: package.json line 12, `telemetry-bands.test.ts` imports] |
| lucide-react | ^0.577 | State/layer icons via `severityIcon` | [VERIFIED: `src/components/df/Severity.ts`] |

**Installation:** none. `npm install` adds nothing for this phase.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** All code composes existing, already-vetted workspace dependencies. The UI-SPEC §Registry Safety confirms: *"zero new dependency installs expected."* No slopcheck run required. If planning later discovers a genuinely missing primitive, escalate (UI-SPEC says "escalate rather than invent") and run the legitimacy gate before any install.

## Hard Part 1 — Read-time Ownership / Grouping Helper (D-01/D-03)

### Existing data the map is derived from (all verified)

| Edge | Source | Exact shape |
|------|--------|-------------|
| host → nodes | `hosts.node_pubkeys` (`src/lib/db/schema/nodemon.ts:120`) | `text("node_pubkeys").array()` → `string[]` per `host_id` |
| host → services | `service_inventory.host_id` (`nodemon.ts:129`) | one row per declared service; also carries `nodePubkey` (nullable — NULL = host-level service) |
| service → node | `service_inventory.node_pubkey` (`nodemon.ts:132`) | node-scoped services only; NULL for host-level |
| node → channels | `latestChannelsForNode(localPubkey)` (`src/lib/read/latest.ts:42`) | `Record<string,unknown>[]`, one row per `chan_id` (DISTINCT ON) |
| service-health observed | `getServiceHealth(hostId)` → `ServiceHealthState[]` carries `hostId`, `nodePubkey` | `src/lib/read/service-health.ts:231` |

**The host dimension is the spine.** `getLatestHostMetrics()` and `getChainTelemetry()` both already drive from the `hosts` dimension via LEFT JOIN and return one `HostMetricsView`/`ChainTelemetryView` per declared `host_id` (each carrying `hostId`). `service_inventory` is the per-host service list. So the containment tree is:

```
host (host_id, node_pubkeys[])
 ├── chain/bitcoind  (chain_telemetry per host_id)
 ├── storage         (host_storage per host_id, per mount)
 ├── service[]       (service_inventory.host_id == host_id)
 │     └── (optional) node_pubkey  → links a service to a node
 └── node[]          (pubkey ∈ host.node_pubkeys)
        └── channel[] (latestChannelsForNode(pubkey))
```

### Recommended helper: `src/lib/overview/ownership.ts` (PURE)

Build an in-memory containment map at read time. **Do NOT add schema or a stored graph (D-03).** Suggested signatures:

```ts
export interface OwnershipMap {
  /** host_id → its declared node pubkeys (from hosts.node_pubkeys). */
  nodesByHost: Map<string, string[]>;
  /** node pubkey → host_id (inverted; a node belongs to exactly one host). */
  hostByNode: Map<string, string>;
  /** host_id → service rows on that host. */
  servicesByHost: Map<string, ServiceHealthState[]>;
  /** node pubkey → service rows scoped to that node (node_pubkey match). */
  servicesByNode: Map<string, ServiceHealthState[]>;
}
export function buildOwnershipMap(inputs: {
  hosts: { hostId: string; nodePubkeys: string[] }[];
  services: ServiceHealthState[];
}): OwnershipMap;
```

`hosts.node_pubkeys` is the **only** authoritative host→node edge (D-03). Invert it once for `hostByNode`. Channels attach lazily per node only when an incident needs the blast-radius detail (keep the top-level map cheap).

### Landmines

- **A node with no host entry** (pubkey present in fleet but absent from any `hosts.node_pubkeys`) must NOT crash grouping — treat as "unattached," group at node level. Mirror the `triage.ts` `card.node?.pubkey ?? "fleet"` honesty pattern.
- **Host-level services** carry `nodePubkey === null` — they roll up to the host, not to any node. Don't drop them.
- **Array column quirk:** `text().array()` comes back as a real JS array from postgres-js; still guard `?? []`.

## Hard Part 2 — Cross-layer Severity Map (D-06)

### The core problem: four different vocabularies → one ramp

This is the highest-landmine area. The existing sources do **not** share a severity vocabulary:

| Source | Module | Vocabulary | Notes |
|--------|--------|-----------|-------|
| Insight engine | `src/lib/insight/schema.ts:32` (`SeveritySchema`) | `critical \| warn \| info` (3) | **`warn` not `warning`; `info` not `watch`** |
| Telemetry bands | `src/lib/read/telemetry-bands.ts:21` (`BandSeverity`) | `healthy \| warn \| critical` (3) | **no watch tier** |
| Service-health | `src/lib/read/service-health.ts:122` (`ServiceHealthState`) | booleans: `running`, `functioning`, `green`, `stale`, `noData` | two-axis, not a ramp |
| Scorecard (fleet) | `src/lib/scorecard/types.ts:49,92` | dot `ok \| warn \| critical` + separate `stale` boolean | already feeds the v1 page |
| **Canonical target** | `src/components/df/Severity.ts:48` (`Severity`) | **`critical \| warning \| watch \| healthy \| stale` (5)** | the df ramp; **`warning` with -ing, plus `watch` + `stale`** |

**The naming mismatch is the #1 bug source.** Insight `warn` → df `warning`; insight `info` is NOT df `watch` (info is below-the-fold advisory, watch is a real teal state). A blind string passthrough will silently produce invalid df `sev` values and break `severityVariants`.

### Recommended helper: `src/lib/overview/severity-map.ts` (PURE)

One exported function per source, all returning the df `Severity` (import the type from `@/components/df/Severity`). Document each mapping inline (D-06 requires a *documented* per-source mapping). Proposed canonical mapping:

```ts
import type { Severity } from "@/components/df/Severity"; // critical|warning|watch|healthy|stale

// Insight engine (critical|warn|info). `info` advisory ⇒ watch (a real "keep an eye" state),
// NOT healthy — info cards are surfaced, not silent. Stale handled separately (cards carry asOf).
export function severityFromInsight(s: "critical" | "warn" | "info"): Severity {
  return s === "critical" ? "critical" : s === "warn" ? "warning" : "watch";
}

// Telemetry bands (healthy|warn|critical) — no native watch tier.
export function severityFromBand(b: "healthy" | "warn" | "critical"): Severity {
  return b === "critical" ? "critical" : b === "warn" ? "warning" : "healthy";
}

// Service-health two-axis → ramp. Order matters: stale/no-data are honest states (D-08),
// never critical. RUNNING ∧ FUNCTIONING ⇒ healthy; running-but-not-functioning ("up but
// dead") ⇒ critical; not running ⇒ critical; functioning-stale ⇒ stale; no-data ⇒ stale.
export function severityFromService(s: ServiceHealthState): Severity {
  if (s.noData) return "stale";          // declared-but-never-reported — honest, not green
  if (s.stale) return "stale";           // functioning-staleness (D-17 clock), its own state
  if (!s.running) return "critical";     // process down
  if (!s.functioning) return "critical"; // up-but-dead — the unmistakable two-axis failure
  return "healthy";
}
```

Plus a `worstSeverity(severities: Severity[]): Severity` reducer implementing D-02 (max across grouped children) on a fixed rank: `critical > warning > watch > healthy`, with `stale` handled as an orthogonal flag (D-08: stale is never *promoted* to critical, and a stale child does not raise a healthy parent to critical — surface stale separately).

### Landmines

- **Do not invent thresholds.** `telemetry-bands.ts` already owns host/chain thresholds (`TELEMETRY_BANDS` + `evaluateBand`) and `chain-telemetry.ts` already attaches bands (`ChainBands`). The severity map consumes those band verdicts — it does NOT re-threshold raw numbers. Re-deriving would duplicate (and drift from) the tuned config.
- **`stale` is orthogonal, not a ramp rung.** D-08: stale never renders as critical. Keep a separate `stale: boolean` alongside the ramp severity on each incident; the df ramp's `stale` slot + `StaleChart` handle the visual.
- **`info` ≠ healthy.** Insight `info` cards are real surfaced advisories; mapping them to `healthy` would hide them from the queue.

## Hard Part 3 — Advisory AI Band (D-04/D-05) — plug in, don't rebuild

### The existing narration path (all verified — reuse verbatim)

- **Determinism is already the source of truth.** `loadInsightView()` (`engine.ts:388`) returns `InsightView { cards, fetchedAt, llmEnabled, ap12Placeholder }`. `rankCards()` (`rank.ts:60`) gives the fixed, total deterministic order. The band's line *selection + order* come from this — NOT the LLM (D-04).
- **The LLM path is already gated and contained.** `narrate(scope)` server action (`src/app/actions/narrate.ts:69`) is the ONLY UI trigger. `isLlmEnabled()` checks `process.env.INSIGHT_LLM_ENABLED === "true"` (`narrative.ts:34`) — **off by default**. `narrateCards()` (`narrative.ts:82`) throws before any dynamic import when off, lazy-imports the AI SDK only when on, and returns `result.text` **verbatim** — *"cards go IN, prose comes OUT; NOTHING parses LLM output back into params, suggestedAction, config"* (`narrative.ts:8-12`). The action **never accepts cards from the client** — it recomputes server-side (`narrate.ts:30`).
- **The guardrail is structural and tested.** The advisory-only invariant is enforced at the *contract* level, not by the band:
  - `schema.ts` `.superRefine` (lines 193-227): `provenance: "llm-inference"` ⇒ `severity` MUST be `info` AND `suggestedAction` MUST be `null` — enforced by zod, structurally impossible to violate.
  - `guardrails.ts` `applySuppression` (line 115) nulls `suggestedAction` on flagged nodes; `WRITE_ACTION_TYPES` (line 36) is the closed set of write actions.
  - `guardrails.test.ts` proves it (lines 331-364): *"post-guardrail output parses via InsightCardArraySchema,"* *"suppressed cards never carry params on the contract surface,"* *"guardrails.ts never references criticalChips."*

### Recommended helper: `src/lib/overview/ai-band.ts` (PURE)

A deterministic line builder that takes the top-ranked grouped incidents and emits 1–4 `AiReadLine` objects (the `AiReadPanel` contract, `src/components/df/AiReadPanel.tsx:43`):

```ts
import type { AiReadLine } from "@/components/df/AiReadPanel"; // { sev, head?, body?, text? }
export function buildBandLines(incidents: GroupedIncident[]): AiReadLine[]; // ≤4, templated
export function buildCalmState(fleetSummary): { allClear: true; calmDetail: string };
```

When `INSIGHT_LLM_ENABLED` is on, the optional `narrate()` action rephrases the **same** lines' `head`/`body` text — it never changes which lines appear or their `sev` (D-04/D-05). The `AiReadPanel` already carries the verbatim, **caller-immutable** safety pill `AI_SAFETY_LABEL = "AI · explains & ranks, never runs commands"` (`AiReadPanel.tsx:32,118`) and renders all lines as INERT React-escaped text.

### Hard invariants the band MUST preserve (verify in Validation)

- The band renders **no runnable command and no signed param** (UI-SPEC §2 invariant). `AiReadLine` has no action field — structurally safe; keep it that way.
- LLM **off by default**; band **always present** with deterministic lines (OVW-02 ships LLM-free).
- Dismissal is **session-scoped parent state** — `AiReadPanel` "never self-hides; dismissal is the parent's state" (`AiReadPanel.tsx:73-76`). Use a client `useState`, no persistence.

### Landmine

- **Do not feed client-supplied cards to `narrate`.** The existing action deliberately recomputes server-side (`narrate.ts:30-38`). Any new band wiring must keep that — client cards are attacker-controllable prompt input.

## Hard Part 4 — Proportional Fleet-Vitals Rollup (D-07)

### The five layers and their entity-count sources (all verified)

| Layer | Read helper | Entity unit | State per entity |
|-------|------------|-------------|------------------|
| Nodes | `loadFleetView()` → `ScorecardView[]` (dot `ok\|warn\|critical` + `stale`) | one per node pubkey | map dot+stale → ramp |
| Hosts | `getLatestHostMetrics()` → `HostMetricsView[]` (`stale`, `hasData`, `metrics`) | one per `host_id` | worst-of cpu/mem/disk bands + stale |
| Services | `getServiceHealth(hostId)` → `ServiceHealthState[]` | one per declared service | `severityFromService` |
| bitcoind | `getChainTelemetry()` → `ChainTelemetryView[]` (`bands`, `stale`, `ibd`) | one per host with bitcoind | worst-of `bands` (blocksBehind/verificationProgress/peers) + IBD |
| Storage | `getLatestHostMetrics().storage` + `computeStorageGrowth()` | one per mount | band on `latestPctUsed` / projection status |

### Recommended helper: `src/lib/overview/vitals.ts` (PURE)

```ts
export interface LayerVitals {
  layer: "nodes" | "hosts" | "services" | "bitcoind" | "storage";
  counts: Record<Severity, number>; // critical|warning|watch|healthy|stale
  total: number;                     // denominator = ALL entities in the layer
  worst: Severity;
}
export function rollupLayer(severities: Severity[]): LayerVitals;
```

**D-07 is literal proportionality:** each health-bar segment width = `counts[state] / total`. **No severity weighting.** Per-layer counts shown alongside. **Stale entities get their own gold segment, not folded into healthy** (UI-SPEC §6).

### Landmines

- **Denominator = all entities in the layer**, including healthy ones — not just the at-risk subset. A bar that omits healthy entities is not proportional.
- **No-data ≠ healthy.** A declared host/service with `hasData === false` / `noData === true` counts as `stale`, never `healthy` (D-08). The read helpers already expose `hasData`/`noData` — use them.
- **Worst-of within a multi-signal entity** (e.g. a host has cpu + mem + disk bands): reduce to one ramp value with `worstSeverity` before counting, so each entity contributes exactly 1 to the denominator (don't double-count signals).

## Hard Part 5 — Read-time Staleness Reuse (D-08)

### The exact staleness API (verified — reuse, do NOT reinvent)

- **`deriveStale(collectedAt: Date | null, maxAgeMs = COLLECTOR_WINDOW_MS): boolean`** — exported from `src/lib/read/host-metrics.ts:136`. `COLLECTOR_WINDOW_MS = 15 * 60 * 1000` (~15 min). Null `collectedAt` ⇒ stale/no-data. Pure, no DB. Already re-imported by `chain-telemetry.ts:3`.
- Every telemetry view already carries `collectedAt: Date | null` + `stale: boolean` + `hasData/noData` — **the helpers already did the derivation.** The overview reads those fields; it does NOT recompute or re-query.
- **Two distinct clocks (do not conflate — `service-health.ts:104-114` "Pitfall 1"):**
  - *Collector freshness* (~15 min on `collected_at`) → `stale` / `collectorStale`.
  - *Functioning freshness* (per-service `expected_interval_seconds × FUNCTIONING_GRACE` on `last_artifact_mtime`) → the service `stale` axis. A 6-hourly batch 20 min old is NOT stale.
- Scorecard nodes expose `asOf: Date | null` + `stale: boolean` (`scorecard/types.ts:96-97`) — the worst-case stamp; the df `FreshnessChip` takes exactly `{ asOf, stale, now? }` (`FreshnessChip.tsx:55`).

### Honest states (D-08/D-09)

- **All-clear / calm hero:** render `AllClearHero` via `SeverityHeroCard` healthy variant + `AiReadPanel allClear` when no incident exists. Copy is frozen verbatim in UI-SPEC §Copywriting.
- **Stale incident:** carries gold `STALE DATA` chip + `StaleChart` (the hatched "NO FRESH DATA" placeholder) instead of a live chart — never recolored to critical, never an interpolated value (UI-SPEC §4, `df/StaleChart.tsx`).
- **No-data:** declared-but-silent host/service reads honestly (no-data), never green-by-default. The read helpers already surface this via `hasData`/`noData`/`collected_at NULL`.

## Architecture Patterns

### System Architecture (data flow)

```
                       ┌─────────── Server Component: (overview)/page.tsx ───────────┐
 warehouses (RO) ─────►│  Promise.all([                                              │
   routing_vm          │    loadInsightView()      → InsightCard[] (ranked, guarded) │
   ldk-lspd            │    loadFleetView()         → ScorecardView[] (nodes)         │
                       │    getLatestHostMetrics()  → HostMetricsView[] (hosts/storage)│
 nodemon DB (RW) ─────►│    getChainTelemetry()     → ChainTelemetryView[] (bitcoind) │
   hosts               │    getServiceHealth(host)  → ServiceHealthState[] (services) │
   service_inventory   │    currentPendingChannels()→ pending meta                    │
   *_health/_metrics   │  ])  each .catch → fail-soft empty (degrade pattern)         │
                       └───────────────────────────┬────────────────────────────────┘
                                                   ▼
         ┌──────────────── src/lib/overview/* (ALL PURE — fixture-testable) ────────────────┐
         │ ownership.buildOwnershipMap  →  severity-map.severityFrom*  →  incidents.assemble  │
         │   (host→svc→node→chan)            (4 vocab → df ramp)          + group (D-01)        │
         │                                                              + worstChild (D-02)    │
         │              vitals.rollupLayer (D-07 proportional)   ai-band.buildBandLines (D-04) │
         └──────────────────────────────────────────┬───────────────────────────────────────┘
                                                     ▼
   df primitives (already built): SeverityHeroCard · SeverityCard{childAlerts,rootCauseChip} ·
   AiReadPanel{aiLines,allClear,onDismiss} · FleetVitals(grid) · FreshnessChip · StaleChart ·
   QueueFilters(client) · CommandModal(inert)        │
                                                     ▼  (optional, env-gated)
                                       narrate() server action → narrateCards() → LLM rephrase
```

### Recommended structure (new code only)

```
src/lib/overview/
├── ownership.ts      # buildOwnershipMap (D-01/D-03) — pure
├── severity-map.ts   # severityFromInsight/Band/Service + worstSeverity (D-06) — pure
├── incidents.ts      # assemble cross-layer incidents + group + worst-child (D-01/D-02) — pure
├── vitals.ts         # rollupLayer proportional counts (D-07) — pure
├── ai-band.ts        # buildBandLines / buildCalmState (D-04/D-05) — pure
└── *.test.ts         # vitest fixtures (mirror rank.test.ts / triage.test.ts)
src/app/(overview)/page.tsx   # rework: Promise.all reads → pure layer → df compose (server)
src/components/overview/       # thin client islands: QueueFilters, AiBand dismiss, expand toggles
```

### Patterns to follow (existing precedent)

- **Pure-module + fixture test** (`rank.ts`, `triage.ts`, `telemetry-bands.ts`): no `server-only`, no DB import, injectable `now`/`nowMs`. Enables vitest without a DB. **Every `src/lib/overview/*` file must be pure.**
- **Engine order is LAW** (`triage.ts:14-17`): consume the pre-ranked `InsightCard[]` — partition/group only, **never re-sort**. The overview queue ordering inherits `rankCards` + the cross-layer severity reducer; do not introduce a second sort.
- **Fail-soft loading** (`engine.ts:115` `degrade()`, `page.tsx:228` `Promise.all` + per-read `.catch`): one broken read degrades to empty with a loud `console.error`, never takes the page down.
- **`force-dynamic` + `revalidate = 0`** (`page.tsx:16-17`): live read at request time, never prerendered.
- **Server vs client boundary:** Recharts (`EvidenceChart`/`StaleChart`) require `'use client'` — fetch in the Server Component, pass plain serializable data into thin client chart wrappers (per workspace CLAUDE.md §2).

### Anti-Patterns to Avoid

- **Re-querying raw warehouse/nodemon tables** when a read helper exists. Always go through `src/lib/read/*` / `src/lib/insight/engine` / `src/lib/scorecard/fleet`.
- **A second severity taxonomy.** Map onto the df 5-state ramp via `severity-map.ts`; never add a 6th state or a parallel scale.
- **`if (sev === …)` class chains** in JSX. The ramp→class mapping lives ONLY in `severityVariants`/`severityAccent`/`severityIcon`/`severityLabel` (`Severity.ts`). Consume those.
- **Letting the LLM produce structured data.** Narration is prose-only, verbatim out, off by default.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest-per-entity reads | A `WHERE collected_at = MAX(...)` query | The `getLatestHostMetrics`/`getChainTelemetry`/`getServiceHealth`/`latestChannelsForNode` helpers (DISTINCT ON) | The MAX form is the documented "N-read-as-1" failure (480 channels → 1). |
| Staleness | A new freshness scheme | `deriveStale` + view `stale`/`collected_at` fields | Already derived read-time; two-clock subtlety already handled. |
| Host/chain thresholds | New threshold constants | `TELEMETRY_BANDS` + `evaluateBand` + `ChainBands` | Tuned, versioned, read-time config (D-14). |
| Incident ranking | A new sort | `rankCards` + cross-layer `worstSeverity` reducer | Deterministic, total, tested order. |
| LLM narration + guardrail | A new prompt path or client LLM call | `narrate` action + `narrateCards` (server-only, lazy, gated) | Prompt-injection containment + advisory-only already structural + tested. |
| msat→sat / fee_msat | Inline `/1000.0` math | `feeMsatToSat` (AFM-002) | The single sanctioned conversion path; inline math is a known failure mode. |
| Two-axis service grade | Re-deriving running∧functioning | `deriveServiceHealth` / `getServiceHealth` (`green`, `stale`, `noData`) | "Up-but-dead" + no-data already correct. |

**Key insight:** every "hard" capability in this phase already has a tested, pure analog. The novel work is the *normalization + grouping glue* between them, not the primitives.

## Runtime State Inventory

> Not a rename/refactor/migration phase — greenfield composition only. No stored data, live-service config, OS-registered state, secrets, or build artifacts are renamed or migrated by this phase. The only env var introduced/honored is the **existing** `INSIGHT_LLM_ENABLED` flag (read-only consumption; not set or changed here). **None — verified by reading the phase scope (compose existing read + ranking machinery into one screen; D-03 explicitly forbids new schema).**

## Common Pitfalls

### Pitfall 1: Severity vocabulary passthrough
**What goes wrong:** Passing insight `warn`/`info` or band `warn` straight into a df `sev` prop produces invalid values (`warning`/`watch` expected) — `severityVariants` silently falls to default `healthy`, mis-coloring incidents.
**Why:** Four sources, three vocabularies, none matching the df ramp's `critical|warning|watch|healthy|stale`.
**How to avoid:** Route **every** severity through `severity-map.ts`. Add a vitest that asserts each mapper's output ∈ the df `Severity` union.
**Warning sign:** A critical incident rendering green/uncolored, or TS accepting a raw `"warn"` where df `Severity` is expected (it won't compile if typed correctly — type the boundary).

### Pitfall 2: Stale promoted to critical
**What goes wrong:** A stale or no-data entity gets bucketed as critical, faking an outage or hiding "we don't know."
**Why:** Conflating "bad" with "unknown."
**How to avoid:** Keep `stale` orthogonal (D-08): a separate boolean/segment, its own gold ramp slot + `StaleChart`. `worstSeverity` must not let a stale child raise a healthy parent to critical.
**Warning sign:** Vitals bar with no gold segment; a stale incident wearing a red accent.

### Pitfall 3: Re-sorting the queue
**What goes wrong:** Adding a sort in the page/component after `rankCards`, breaking the deterministic order the inbox/engine agree on.
**Why:** Forgetting "engine order is LAW."
**How to avoid:** Group/partition/filter only. The only ordering input is the cross-layer severity reducer feeding into the existing rank.
**Warning sign:** A `.sort(` in `incidents.ts` or the page over already-ranked data.

### Pitfall 4: Double-counting entities in vitals
**What goes wrong:** A host with cpu+mem+disk signals counted 3× inflates the denominator; proportions wrong (D-07 violated).
**How to avoid:** Reduce each entity's multiple signals to ONE ramp value (`worstSeverity`) before counting; each entity contributes exactly 1 to `total`.
**Warning sign:** `total` exceeds the real entity count for a layer.

### Pitfall 5: Client-supplied cards into narration
**What goes wrong:** Wiring the band to pass client state into `narrate`, opening a prompt-injection surface.
**How to avoid:** Keep `narrate`'s server-side recompute; the band's client island only toggles LLM-on display + dismissal, never supplies card data.

### Pitfall 6: Node without a host
**What goes wrong:** Grouping crashes or silently drops a node absent from every `hosts.node_pubkeys`.
**How to avoid:** Treat unattached nodes honestly (group at node level), mirroring the `?? "fleet"` fallback in `triage.ts`.

## Code Examples (verified signatures to consume)

```ts
// Insight (ranked, guarded) — engine.ts:103, 388
export interface InsightView { cards: InsightCard[]; fetchedAt: Date; llmEnabled: boolean; ap12Placeholder: string | null; }
const view = await loadInsightView();           // server-only, cached 45s
const ranked = rankCards(view.cards);            // rank.ts:60 — deterministic total order

// InsightCard shape — schema.ts:160 (consume, never widen)
//   { schemaVersion, id, severity: "critical"|"warn"|"info", node: {pubkey,alias,backend}|null,
//     target: {kind:"node"|"channel"|"sweep"|"fleet", ...}, signal: DetectorId,
//     evidence: {metric, observed, threshold, unit, window, asOf(ISO string), deepLink, detail?},
//     suggestedAction: <discriminated>|null, suppressed:{active,reason}, provenance, rateLimitGuidance }

// Telemetry views — host-metrics.ts:55 / chain-telemetry.ts:53 / service-health.ts:122
const hosts = await getLatestHostMetrics();      // HostMetricsView[] { hostId, stale, hasData, metrics, storage }
const chain = await getChainTelemetry();         // ChainTelemetryView[] { hostId, stale, ibd, blocksBehind, bands }
const svc   = await getServiceHealth(hostId);    // ServiceHealthState[] { running, functioning, green, stale, noData, ... }

// Staleness — host-metrics.ts:136 (reuse, do not reinvent)
const isStale = deriveStale(collectedAt);        // null ⇒ true; >15min ⇒ true

// Ownership edge — schema/nodemon.ts:120 + read/latest.ts:42
// hosts.node_pubkeys : string[]  ;  service_inventory.{host_id,node_pubkey}  ;  latestChannelsForNode(pubkey)

// df ramp target — components/df/Severity.ts:48
export type Severity = "critical" | "warning" | "watch" | "healthy" | "stale";

// AiReadPanel contract — AiReadPanel.tsx:43,60
export interface AiReadLine { sev: Severity; head?: string; body?: string; text?: string }
// <AiReadPanel lines={...} allClear={...} calmDetail={...} onDismiss={...} />  (safety pill is built-in)

// Optional LLM rephrase — actions/narrate.ts:69 (server action, gated, server-recomputed)
const r = await narrate({ level: "fleet" });     // { ok, text } | { ok:false, error }; off unless INSIGHT_LLM_ENABLED==="true"
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| v1 fleet page (`(overview)/page.tsx`) renders nodes-only attention queue (scorecard dots) | v2 full-stack overview spanning 5 layers, root-cause grouped, on df primitives | The v1 page is the structural precedent (queue/healthy split, fail-soft, force-dynamic) but is node-scoped; Phase 12 generalizes to cross-layer incidents. |
| Stored severity/stale flags | Read-time derivation (bands + deriveStale) | Re-tuning never re-ingests; honesty by construction (D-08/D-14). |
| Separate scorecard taxonomy vs df ramp | Documented per-source map onto one df ramp | Single visual scale; no severity hue as chrome (DS-01). |

**Deprecated/outdated:** The v1 NOC-instrument tokens/components (Saira/Inter, dot-less mono) are superseded by Data-Forward v2 (IBM Plex Sans/Mono, df tokens) per DS-03. The sketch-findings SKILL.md still references the v1 "no icons for state" rule — **superseded** for v2: UI-SPEC §Accessibility and `Severity.ts` `severityIcon` explicitly permit one lucide glyph per state (D-06). Use the UI-SPEC + df primitives as the authority, not the older sketch text.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4 |
| Config file | none (zero-config; `vitest run`) |
| Quick run command | `npx vitest run src/lib/overview` |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req | Behavior | Type | Automated Command | File |
|-----|----------|------|-------------------|------|
| OVW-01 | Host-down collapses its services + nodes + channels into ONE incident keyed by the host; children nest, absent from top level | unit | `npx vitest run src/lib/overview/incidents.test.ts` | ❌ Wave 0 |
| OVW-01/D-03 | Ownership map: `hosts.node_pubkeys` inverts to `hostByNode`; unattached node grouped at node level (no crash) | unit | `npx vitest run src/lib/overview/ownership.test.ts` | ❌ Wave 0 |
| OVW-01/D-02 | Incident severity = worst child on the ramp; stale child does NOT promote a healthy parent to critical | unit | `npx vitest run src/lib/overview/severity-map.test.ts` | ❌ Wave 0 |
| OVW-03/D-06 | Each source mapper outputs a valid df `Severity`; insight `warn`→`warning`, `info`→`watch`; band `warn`→`warning`; service up-but-dead→critical, no-data→stale | unit | `npx vitest run src/lib/overview/severity-map.test.ts` | ❌ Wave 0 |
| OVW-03/D-07 | Segment widths = count/total; healthy in denominator; stale own segment; multi-signal entity counts once | unit | `npx vitest run src/lib/overview/vitals.test.ts` | ❌ Wave 0 |
| OVW-02/D-04 | `buildBandLines` ≤4 lines, order = ranked incidents, per-line `sev` from severity map; lines carry NO action/param field | unit | `npx vitest run src/lib/overview/ai-band.test.ts` | ❌ Wave 0 |
| OVW-02 guardrail | Advisory-only: post-pipeline cards still parse `InsightCardArraySchema`; suppressed carry no params; band emits no command string | unit (extend existing) | `npx vitest run src/lib/insight/guardrails.test.ts` | ✅ exists (extend with band assertion) |
| OVW-04/D-08 | All-clear path when no incident; stale incident keeps `stale` flag (never critical); no-data never healthy | unit | `npx vitest run src/lib/overview/incidents.test.ts` | ❌ Wave 0 |
| OVW-05/D-09 | Layer+severity filter is a pure view over the grouped set; honest empty state distinct from all-clear | unit | `npx vitest run src/lib/overview/filter.test.ts` (or reuse triage-facets pattern) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/overview` (pure modules, fast, no DB)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** full suite green before `/gsd:verify-work`; plus a manual visual check against the prototype + UI-SPEC (UI phase, `ui_safety_gate: true`).

### Wave 0 Gaps
- [ ] `src/lib/overview/ownership.test.ts` — D-01/D-03 containment + unattached-node honesty
- [ ] `src/lib/overview/severity-map.test.ts` — D-06 four-vocabulary normalization + D-02 worst-child + stale orthogonality
- [ ] `src/lib/overview/incidents.test.ts` — D-01 grouping, D-02 rollup, D-08 stale/no-data honesty, all-clear
- [ ] `src/lib/overview/vitals.test.ts` — D-07 proportionality, denominator, single-count
- [ ] `src/lib/overview/ai-band.test.ts` — D-04/D-05 deterministic lines, ≤4, no-action shape
- [ ] Extend `src/lib/insight/guardrails.test.ts` (or a band test) with the OVW-02 advisory-only assertion
- [ ] Component tests (vitest + the existing `*.test.tsx` pattern) for the new client islands (QueueFilters, AiBand dismiss) — follow `AiReadPanel.test.tsx`
- [ ] Framework install: none (vitest present)

## Security Domain

> `security_enforcement` not present in config → treat as enabled. This phase is read-only + advisory; threat surface is narrow.

### Applicable ASVS Categories
| ASVS | Applies | Standard Control |
|------|---------|------------------|
| V2 Authentication | no | Public read-only dashboard; no auth on overview (project: no user auth). |
| V3 Session Management | no | Dismissal is ephemeral client state; no server session. |
| V4 Access Control | yes (DB-level) | Warehouse reads via SELECT-only `grafana_demo_ro` role; nodemon RW is queue-only. Overview adds no writes. |
| V5 Input Validation | yes | Filter params (layer/severity) MUST be whitelisted against closed vocabularies — reuse the `triage-facets.ts` `parseFacets` pattern (silently drop invalid, never throw). Pubkey gate = `/^[0-9a-f]{66}$/`. |
| V6 Cryptography | no (this phase) | No signing on the overview; HMAC lives in the command-export/queue path, not surfaced here. |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via peer alias (Lightning graph strings) into LLM band | Tampering / Info-disclosure | Already contained: `narrateCards` wraps untrusted card JSON in BEGIN/END delimiters, filters to deterministic cards, returns verbatim prose rendered as plain text — never markdown-to-HTML (`narrative.ts:20-75`). Band must keep rendering INERT escaped text. |
| Operator-edited filter query params | Tampering | Whitelist against the closed layer/severity vocabulary; invalid → wider view, not an error (triage-facets precedent). |
| LLM coerced to emit a command/param | Elevation | Structural: `schema.ts` superRefine forbids LLM-provenance cards from carrying `suggestedAction`; band `AiReadLine` has no action field. Re-affirm in Phase 16 (HARDEN-03). |
| Accidental in-app mutation from an action button | Tampering | UI-SPEC: every action opens the **inert** `CommandModal` (copy-to-run); no overview component writes. |

## Sources

### Primary (HIGH — read directly this session)
- `src/lib/insight/{rank,triage,triage-facets,narrative,guardrails,schema,types,engine}.ts` — ranking, partition, narration, guardrail, contract, view loader.
- `src/lib/read/{service-health,host-metrics,storage-growth,chain-telemetry,telemetry-bands,nodes,latest}.ts` — per-layer read shapes + `deriveStale`.
- `src/lib/df/tokens.ts` + `src/components/df/Severity.ts` — canonical ramp tokens + `Severity` type (5 states).
- `src/components/df/{AiReadPanel,SeverityCard,SeverityHeroCard,FreshnessChip}.tsx` — primitive prop contracts (already accept childAlerts/rootCauseChip/aiLines/freshness).
- `src/lib/db/schema/nodemon.ts` — `hosts.node_pubkeys`, `service_inventory.{host_id,node_pubkey}`, fact tables.
- `src/app/actions/narrate.ts` + `src/app/(overview)/{page,layout}.tsx` — server-recompute narration + existing page patterns.
- `src/lib/scorecard/types.ts` — `ScorecardView` dot/stale/asOf.
- `.planning/phases/12-ops-center-overview/{12-CONTEXT,12-UI-SPEC}.md`, `.planning/REQUIREMENTS.md`, `.claude/skills/sketch-findings-nodemonitor/SKILL.md`.
- `package.json` (vitest ^4, `test: vitest run`), `.planning/config.json` (nyquist enabled).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Insight `info` ⇒ df `watch` (not `healthy`) is the intended mapping | Hard Part 2 | Low — D-06 says exact thresholds are Claude's discretion; if `info` should be hidden instead, the queue would surface fewer rows. Confirm with planner/discuss. |
| A2 | Service no-data and functioning-stale both ⇒ df `stale` (not separate buckets) | Hard Part 2 | Low — both are "not fresh" honest states; if no-data needs its own treatment the vitals bar gains a 6th segment. D-08 only mandates stale ≠ critical. |
| A3 | `worstSeverity` ranks `critical>warning>watch>healthy` with `stale` orthogonal | Hard Part 2 | Low — follows D-02 "max across children" + D-08 "stale never critical"; exact tie-break with stale is discretionary. |
| A4 | New code lives in a fresh `src/lib/overview/` namespace | Architecture | None — organizational; matches the `src/lib/insight` / `src/lib/read` precedent. |

**Note:** The `telemetry-bands.ts` thresholds themselves carry their own `[CITED]`/`[ASSUMED]` provenance in-code (e.g. `blocksBehind`, `peers`, `cpuPctBusy` are `[ASSUMED]` operator-tunable). This phase consumes those verdicts and does not re-decide them — the assumptions there are out of this phase's scope to resolve.

## Open Questions (RESOLVED)

1. **Should host-level services (node_pubkey NULL) appear as their own queue rows or only under the host incident?**
   - Known: D-01 collapses children under the parent host. A host-level service failure with the host otherwise up is ambiguous.
   - Recommendation: surface it as a service-layer incident keyed by host (it has a `host_id` but no node), nesting under the host only when the host itself is also down. Confirm in planning.
   - **RESOLVED (Plan 03):** A host-level service incident is keyed by `host_id` as its own service-layer row, and is nested under the host incident only when the host itself is also failing (host owns the failing child). `incidents.ts` (Plan 03) implements this grouping.

2. **bitcoind layer entity count — per host or per bitcoind instance?**
   - Known: `getChainTelemetry()` returns one view per host (LEFT JOIN on `hosts`). A host without bitcoind still returns a row (no-data).
   - Recommendation: count bitcoind entities as hosts that *declare* bitcoind (filter `hasData || expected`), so a non-bitcoind host doesn't inflate the bitcoind denominator. Needs a "which hosts run bitcoind" signal — likely `service_inventory` rows for bitcoind. Flag for planning.
   - **RESOLVED (Plan 07):** The bitcoind layer's entity set = hosts that DECLARE bitcoind in `service_inventory` (a `serviceInventory` row on that `hostId` whose `serviceName` is bitcoind). Plan 07 feeds `rollupLayer("bitcoind", …)` only the chain-telemetry rows for declared-bitcoind hosts; non-bitcoind hosts are excluded from the bitcoind denominator (D-07 proportionality preserved, denominator now = bitcoind instances).

3. **Layer filter chip set vs five vitals layers** — UI-SPEC lists filter chips `Hosts·Services·bitcoind·Nodes·Storage` and severity `Critical·Warning·Watch`. Confirm storage incidents are filterable as their own layer (they currently derive from `host_storage` under hosts).
   - **RESOLVED (Plan 06):** Storage is its own filter-layer vocabulary — the filter facet set treats `storage` as a first-class layer chip distinct from `hosts`, matching the five vitals layers. `filter.ts` (Plan 06) whitelists `storage` as its own layer facet.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node (built-in `crypto`, etc.) | runtime | ✓ | 20+ | — |
| nodemon Postgres (`dbNodemon`) | telemetry reads (hosts/services/chain/storage) | env-driven | — | `degrade()` → empty layer; overview renders honest no-data |
| routing warehouse (`dbRouting`, RO) | insight + scorecard reads | env-driven | — | page-level catch → "couldn't load" honest error (existing pattern) |
| ANTHROPIC_API_KEY + `INSIGHT_LLM_ENABLED=true` | OPTIONAL LLM rephrase only | ✗ by default | — | Deterministic templated band lines (D-05 — OVW-02 ships LLM-free) |
| vitest | tests | ✓ | ^4 | — |

**Missing with no fallback:** none — every external dependency degrades honestly.
**Missing with fallback:** LLM (off by default → templated lines); any single read (→ empty layer, fail-soft).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all versions verified in `package.json` and import sites.
- Architecture / hard-part guidance: HIGH — every consumed signature read directly from source this session.
- Severity mapping specifics: MEDIUM-HIGH — vocabularies verified; exact `info→watch` rung is discretionary (A1).
- Pitfalls: HIGH — derived from in-code "Pitfall"/"landmine" comments and the documented DISTINCT-ON failure.

**Research date:** 2026-06-30
**Valid until:** ~2026-07-30 (stable — internal code surfaces; refresh if Phase 11 read helpers or df primitives change).
