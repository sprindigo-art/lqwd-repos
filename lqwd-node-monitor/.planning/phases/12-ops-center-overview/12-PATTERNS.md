# Phase 12: Ops Center Overview - Pattern Map

**Mapped:** 2026-06-30
**Files analyzed:** 12 (5 new pure libs + 5 new tests + 1 page rework + ≥1 client island)
**Analogs found:** 12 / 12 (every file has a strong in-repo analog — zero greenfield)

## Scope note

This phase installs **zero new dependencies** and writes **zero new schema**. Every new
file is a read-time *derivation/composition* layer over already-tested code:
the Phase-4 insight engine (`src/lib/insight/*`), the Phase-11 read helpers
(`src/lib/read/*`), the Phase-10 df primitives (`src/components/df/*`) + ramp
(`src/components/df/Severity.ts`). The closest analog for **every** new pure module
is an existing pure module in `src/lib/insight/` or `src/lib/read/` — copy its
header-comment discipline, its named exports, and its fixture-test shape verbatim.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/overview/ownership.ts` | utility (pure) | transform | `src/lib/insight/triage.ts` (partition) + `schema/nodemon.ts` edges | role-match (pure partition) |
| `src/lib/overview/severity-map.ts` | utility (pure) | transform | `src/lib/read/telemetry-bands.ts` (`evaluateBand`) + `df/Severity.ts` + `insight/schema.ts` `SeveritySchema` | exact (pure evaluator → enum) |
| `src/lib/overview/incidents.ts` | service (pure) | transform / aggregation | `src/lib/insight/rank.ts` + `triage.ts` (group/partition, engine-order) | exact (pure ranked-card reshaping) |
| `src/lib/overview/vitals.ts` | utility (pure) | batch / aggregation | `src/lib/insight/triage.ts` `facetCounts` (count-over-array) | exact (pure counting) |
| `src/lib/overview/ai-band.ts` | service (pure) | transform | `src/lib/insight/narrative.ts` (`buildNarrationPrompt`) + `df/AiReadPanel.tsx` `AiReadLine` | role-match (pure line builder; LLM is optional plug-in) |
| `src/lib/overview/*.test.ts` | test | — | `src/lib/insight/rank.test.ts` (fixture-factory vitest) | exact |
| `src/app/(overview)/page.tsx` (rework) | route / server component | request-response | existing `src/app/(overview)/page.tsx` | exact (same route, generalize node→cross-layer) |
| `src/components/overview/QueueFilters.tsx` | component (client island) | event-driven | `src/lib/insight/triage-facets.ts` codec + `df/AiReadPanel.tsx` (`"use client"` shape) | role-match |
| `src/components/overview/AiBand*.tsx` (dismiss) | component (client island) | event-driven | `df/AiReadPanel.tsx` (`onDismiss` parent-state pattern) | exact |

## Shared Patterns

These cross-cutting conventions apply to **every** new file. Planner: state each in the
relevant plan's action list rather than re-deriving.

### Pure-module discipline (applies to ALL `src/lib/overview/*`)
**Source:** `src/lib/insight/rank.ts:6`, `src/lib/insight/triage.ts:6-11`, `src/lib/read/telemetry-bands.ts:11`
Every `src/lib/overview/*.ts` MUST be importable into vitest with no DB and no server runtime.
The three analogs open with a header comment that states exactly this — replicate it:
```ts
// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
```
Concretely: **no `import "server-only"`**, no `@/lib/db/*` import, inject any clock as a
param (`nowMs: number = Date.now()` — see `service-health.ts:162`, `host-metrics.ts:136`),
and never mutate inputs (`rank.ts:61` `[...cards].sort(...)`; `rank.test.ts:131` asserts non-mutation).

### Named exports + `@/` imports (workspace convention, CLAUDE.md)
**Source:** every analog. e.g. `rank.ts:1` `import type { DetectorId, InsightCard } from "@/lib/insight/types";`
Named exports only (no default exports for libs). Always `@/...`, never relative `../`.
The df `Severity` type is imported from `@/components/df/Severity` (`severity-map.ts` boundary).

### Single severity ramp — never a 6th taxonomy
**Source:** `src/components/df/Severity.ts:30-48`
The only `sev → class` mapping allowed lives in `severityVariants`/`severityAccent`/`severityIcon`/`severityLabel`.
New code maps *onto* the 5-state `Severity` union (`"critical" | "warning" | "watch" | "healthy" | "stale"`)
and then consumes those tokens — NO `if (sev === …)` class chains in JSX (RESEARCH anti-pattern).

### Advisory-only guardrail — plug in, don't rebuild
**Source:** `src/lib/insight/narrative.ts:1-24`, `src/app/actions/narrate.ts:9-17`, `src/lib/insight/guardrails.ts:36`
`narrate()` is server-only, env-gated (`isLlmEnabled()` checks `INSIGHT_LLM_ENABLED === "true"`,
`narrative.ts:34`), and **recomputes cards server-side** (`narrate.ts:30-38`) — it NEVER accepts
client cards. `AiReadLine` has no action field by construction (`AiReadPanel.tsx:43`). The new
`ai-band.ts` only builds deterministic lines; the LLM rephrases the same lines' text, never their
`sev` or which lines appear.

### Read-time staleness reuse (do NOT reinvent)
**Source:** `src/lib/read/host-metrics.ts:136` (`deriveStale`), `service-health.ts:117` (`COLLECTOR_WINDOW_MS`)
`deriveStale(collectedAt)` already exists: null ⇒ stale, >15min ⇒ stale. Views already carry
`stale`/`hasData`/`noData`/`collectedAt`. Overview reads those fields — never recomputes, never re-queries.
`stale` is orthogonal: never promoted to critical (D-08).

---

## Pattern Assignments

### `src/lib/overview/severity-map.ts` (utility, transform)

**Analogs:** `src/lib/read/telemetry-bands.ts` (pure evaluator shape) · `src/components/df/Severity.ts` (target type) · `src/lib/insight/schema.ts` (source vocab)

**The pure-evaluator pattern to copy** (`telemetry-bands.ts:91-106`) — same `(value, config) → enum`
shape, no clock, no DB; replicate the "documented boundary convention" comment for D-06:
```ts
export function evaluateBand(value: number, band: TelemetryBand): BandSeverity {
  if (band.direction === "higher-better") {
    if (value >= band.healthy) return "healthy";
    if (value >= band.warn) return "warn";
    return "critical";
  }
  if (value <= band.healthy) return "healthy";
  if (value <= band.warn) return "warn";
  return "critical";
}
```

**Source vocabularies that must be normalized (the #1 bug surface — they do NOT match):**
- Insight: `SeveritySchema = z.enum(["critical", "warn", "info"])` (`schema.ts:32`) — `warn` not `warning`, `info` not `watch`.
- Telemetry bands: `type BandSeverity = "healthy" | "warn" | "critical"` (`telemetry-bands.ts:21`) — no watch tier.
- Service-health: booleans `running`/`functioning`/`green`/`stale`/`noData` (`service-health.ts:122-143`) — two-axis, not a ramp.

**Target type to import** (`Severity.ts:48`):
```ts
export type Severity = NonNullable<VariantProps<typeof severityVariants>["sev"]>;
// "critical" | "warning" | "watch" | "healthy" | "stale"
```

**Service two-axis → ramp source of truth** (`service-health.ts:160-223`, `deriveServiceHealth`):
no-data and functioning-stale both produce honest states; `green = running && functioning`
("up but dead" guard). Map `noData`/`stale` → `"stale"`, `!running`/`!functioning` → `"critical"`,
both true → `"healthy"`. Add `worstSeverity(severities): Severity` reducer on rank
`critical > warning > watch > healthy` with `stale` orthogonal (D-02 + D-08).

**Convention to replicate:** type the boundary — accept the literal source union, return `Severity`,
so a raw `"warn"` cannot leak through (TS rejects it). Add a vitest asserting each mapper's output ∈ the df union (Pitfall 1).

---

### `src/lib/overview/ownership.ts` (utility, transform)

**Analogs:** `src/lib/insight/triage.ts` (pure Map-building partition) · `src/lib/db/schema/nodemon.ts` (edge shapes)

**Authoritative edges (verified — no new schema, D-03):**
- `hosts.nodePubkeys: text("node_pubkeys").array()` → `string[]` per `host_id` (`nodemon.ts:120`) — the ONLY host→node edge.
- `serviceInventory.hostId` + `serviceInventory.nodePubkey` (`nodemon.ts:129,132`) — `nodePubkey` NULL = host-level service.
- `getServiceHealth(hostId)` → `ServiceHealthState[]`, each carrying `hostId` + `nodePubkey` (`service-health.ts:122,231`).

**Map-building pattern to copy** (`triage.ts:59-83`, `partitionTriage`) — single pass, `Map.get(k) ?? new Map()` nesting, no sort:
```ts
const byNode = groups.get(card.signal) ?? new Map<string, InsightCard[]>();
const list = byNode.get(key) ?? [];
list.push(card);
byNode.set(key, list);
groups.set(card.signal, byNode);
```

**Honesty fallback to replicate** (`triage.ts:74`): a node absent from every `hosts.node_pubkeys`
must NOT crash — group it at node level, mirroring `card.node?.pubkey ?? "fleet"`. Guard the array
column with `?? []` even though postgres-js returns a real array.

**Suggested signature** (RESEARCH §Hard Part 1): `buildOwnershipMap({ hosts, services }) → { nodesByHost, hostByNode, servicesByHost, servicesByNode }`. Invert `node_pubkeys` once for `hostByNode`.

---

### `src/lib/overview/incidents.ts` (service, transform/aggregation)

**Analogs:** `src/lib/insight/rank.ts` (deterministic order) · `src/lib/insight/triage.ts` (group/partition over pre-ranked array)

**Engine-order-is-LAW invariant to copy** (`triage.ts:12-19`): consume the pre-ranked
`InsightCard[]` and ONLY partition/group — **never re-sort** (Pitfall 3). No `.sort(` over
already-ranked data anywhere in this file or the page.

**Ranked input** (`rank.ts:60`): `rankCards(cards)` gives the fixed total order; the cross-layer
severity reducer (`severity-map.worstSeverity`) is the only added ordering key for non-insight layers.

**Grouping pattern** = the same `partitionTriage` single-pass nesting (`triage.ts:59-83`) but keyed by
containment parent (host) per D-01: a parent failure collapses child alerts into one incident keyed by
the parent; children nest and drop from the top level. Incident severity = `worstSeverity(children)` (D-02).
Keep a separate `stale` flag per incident — a stale child never raises a healthy parent to critical (D-08, Pitfall 2).

---

### `src/lib/overview/vitals.ts` (utility, batch/aggregation)

**Analog:** `src/lib/insight/triage.ts` `facetCounts` (`triage.ts:99-121`) — count-over-the-full-array pattern:
```ts
const severity: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };
for (const card of cards) {
  severity[card.severity] += 1;
  ...
}
return { severity, node, signal, action };
```
Replicate the `Record<Severity, number>` accumulator, but keyed by the df 5-state `Severity`.

**D-07 literal proportionality:** segment width = `counts[state] / total`; denominator = ALL entities in
the layer (healthy included). Reduce a multi-signal entity (host cpu+mem+disk) to ONE ramp value via
`worstSeverity` BEFORE counting so each entity contributes exactly 1 (Pitfall 4). No-data ⇒ `stale`,
never `healthy` (`host-metrics.ts:62` `hasData`, `service-health.ts:137` `noData`). Suggested:
`rollupLayer(severities: Severity[]): { layer, counts, total, worst }`.

---

### `src/lib/overview/ai-band.ts` (service, transform)

**Analogs:** `src/lib/insight/narrative.ts` (pure-builder + gating) · `src/components/df/AiReadPanel.tsx` (`AiReadLine` contract)

**Output contract to import** (`AiReadPanel.tsx:43-58`):
```ts
export interface AiReadLine { sev: Severity; head?: string; body?: string; text?: string }
```
`buildBandLines(incidents): AiReadLine[]` — ≤4 lines, order = ranked incidents, per-line `sev` from
`severity-map`, and structurally **no action/param field** (the panel has none).

**Pure-builder-separate-from-LLM pattern to copy** (`narrative.ts:38-75` `buildNarrationPrompt` is the
pure, exported, env-free part; `narrateCards` `narrative.ts:82` is the gated network part). Mirror that
split: the band's line *selection + order* are pure (this file); the optional LLM rephrase stays in the
existing `narrate()` action — do NOT add a new LLM path here.

**Gating to honor** (`narrative.ts:34`): `INSIGHT_LLM_ENABLED === "true"` is the only ON state; OFF ⇒
deterministic templated lines (D-05, OVW-02 ships LLM-free). Add a `buildCalmState()` for the all-clear hero (D-08).

**Landmine (Pitfall 5):** never feed client-supplied cards into `narrate` — it recomputes server-side
(`narrate.ts:30`). The band's client island only toggles display + dismissal.

---

### `src/app/(overview)/page.tsx` (route / server component, request-response) — REWORK

**Analog:** the existing `src/app/(overview)/page.tsx` (same file — generalize node-only → cross-layer).

**Force-dynamic + server-only reads to keep** (`page.tsx:15-17`):
```ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
```

**Fail-soft `Promise.all` + per-read `.catch` to copy** (`page.tsx:228-236`):
```ts
const [fleetView, pending] = await Promise.all([
  loadFleetView(),
  currentPendingChannels(PENDING_RECENCY_HOURS).catch((error: unknown) => {
    console.error("Pending channels load failed:", error);
    return null; // degrade this layer, don't take the page down
  }),
]);
```
Extend to the five overview reads — `loadInsightView()` (`engine.ts:388`), `loadFleetView()`,
`getLatestHostMetrics()`, `getChainTelemetry()`, `getServiceHealth(host)` — each with its own
`.catch → empty`, plus the page-level `try/catch` honest-error fallback (`page.tsx:237-249`).

**No re-sort / no color re-derivation in JSX** (`page.tsx:28-37`, `253-275`): the queue/healthy split is a
pure FILTER of the pre-sorted order; counts only READ pre-computed fields. Carry this discipline forward.

**Server/client boundary:** the page is a Server Component (the analog notes a `"use client"` here fails the
build, `page.tsx:29-30`). Recharts primitives (`EvidenceChart`/`StaleChart`) and interactive islands are
the only `"use client"` regions — fetch in the RSC, pass plain serializable data into them.

**Composition target — df primitives already accept this phase's props:**
- `SeverityHeroCard` (`SeverityHeroCard.tsx:84-120`): `rootCauseChip`, `freshLabel`, `blast`, `aiLines`, `childAlerts`, `sev` (healthy variant = all-clear hero).
- `SeverityCard` (`SeverityCard.tsx:100-147`): `childAlerts`, `freshness: { asOf, stale }`, `aiLines`, `stalePill`, `evidence`, `onToggle`.
- `AiReadPanel` (`AiReadPanel.tsx:60-79`): `lines`, `allClear`, `calmDetail`, `onDismiss`; built-in frozen safety pill `AI_SAFETY_LABEL` (`AiReadPanel.tsx:32`).

---

### `src/components/overview/QueueFilters.tsx` + AI-band dismiss island (client, event-driven)

**Analogs:** `src/lib/insight/triage-facets.ts` (whitelist codec) · `src/components/df/AiReadPanel.tsx` (`"use client"` + parent-state dismiss)

**Filter param whitelisting to copy** (`triage-facets.ts:62-93`): validate `?layer`/`?sev` against a
CLOSED vocabulary, silently drop invalid (never throw — a bad URL widens the view, V5 control):
```ts
function whitelist<T extends string>(raw: string[], allow: (v: string) => v is T): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const value of raw) { if (!allow(value) || seen.has(value)) continue; seen.add(value); out.push(value); }
  return out;
}
```
Derive vocab from the frozen enum, never hand-list (`triage-facets.ts:31-32`). Filtering is a pure view
over the same grouped incident set (D-09) — no re-query, no re-sort.

**Dismiss pattern to copy** (`AiReadPanel.tsx:73-76,120-129`): the panel "never self-hides — dismissal is
the parent's state." Use a client `useState`, session-scoped, no persistence (D-05). `"use client"` exists
only for the `onClick`; SSR chrome renders identically without it.

---

### Test files `src/lib/overview/*.test.ts`

**Analog:** `src/lib/insight/rank.test.ts` (fixture-factory vitest unit pattern).

**Pattern to copy** (`rank.test.ts:1-47`): `import { describe, expect, it } from "vitest";`, a local
`makeCard()`/`makeRow()` fixture factory with `Overrides`, then `describe`/`it` blocks. No DB, no mocks —
pure-module tests run under `npx vitest run src/lib/overview`. Mirror the determinism + non-mutation
assertions (`rank.test.ts:131-172`) where ordering matters. Required Wave-0 tests: `ownership.test.ts`,
`severity-map.test.ts`, `incidents.test.ts`, `vitals.test.ts`, `ai-band.test.ts`, plus a filter test
(reuse the triage-facets pattern) and a band assertion extending `guardrails.test.ts`.

## No Analog Found

None. Every new file maps to a strong in-repo analog (the phase is composition-only).
Two discretionary mappings to confirm in planning (RESEARCH Assumptions A1/A2 + Open Questions):
- Insight `info → watch` (vs hide) — discretionary per D-06; `severity-map.ts` is the single place to change it.
- Service `noData` and functioning-`stale` both → df `stale` (vs separate buckets) — affects whether vitals gains a 6th segment.

## Metadata

**Analog search scope:** `src/lib/insight/`, `src/lib/read/`, `src/components/df/`, `src/app/(overview)/`, `src/app/actions/`, `src/lib/scorecard/`, `src/lib/db/schema/`
**Files read this session (for excerpts):** `rank.ts`, `triage.ts`, `triage-facets.ts`, `narrative.ts`, `guardrails.ts`, `schema.ts`, `rank.test.ts`, `engine.ts`, `telemetry-bands.ts`, `service-health.ts`, `host-metrics.ts`, `Severity.ts`, `AiReadPanel.tsx`, `SeverityCard.tsx`, `SeverityHeroCard.tsx`, `(overview)/page.tsx`, `actions/narrate.ts`, `schema/nodemon.ts`, `scorecard/types.ts`
**Pattern extraction date:** 2026-06-30
