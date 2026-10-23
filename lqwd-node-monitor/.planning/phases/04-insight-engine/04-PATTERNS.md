# Phase 4: Insight Engine - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 24 new/modified files
**Analogs found:** 21 / 24 (2 no-analog, 1 partial)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/insight/types.ts` | model (pure types) | — | `src/lib/scorecard/types.ts` | exact |
| `src/lib/insight/schema.ts` | model (zod contract) | transform | `src/lib/scorecard/types.ts` (purity) — zod itself is new | role-match |
| `src/lib/insight/config.ts` | config | — | `src/lib/scorecard/config.ts` | exact |
| `src/lib/insight/detectors/htlc-timeout.ts` | service (detector) | CRUD-read aggregate | `src/lib/scorecard/dimensions/force-close.ts` | exact |
| `src/lib/insight/detectors/close-cluster.ts` | service (detector) | CRUD-read aggregate | `src/lib/scorecard/dimensions/force-close.ts` (`buildSelfCloseStormSql`) | exact |
| `src/lib/insight/detectors/close-storm.ts` | service (detector, no SQL) | transform | `src/lib/scorecard/grade.ts` (`evaluateTier1`) + FleetView consumption | role-match |
| `src/lib/insight/detectors/fee-signals.ts` | service (detector) | CRUD-read + transform | `src/lib/console/fees.ts` (shaper) + `src/lib/console/trends.ts` (ns-window SQL) | role-match (composite) |
| `src/lib/insight/detectors/fee-stepdown.ts` | service (detector) | CRUD-read aggregate | `src/lib/console/trends.ts` (`buildForwardsDailySql`) | exact (SQL idiom) |
| `src/lib/insight/detectors/rebalance.ts` | service (detector) | CRUD-read aggregate | `src/lib/scorecard/dimensions/force-close.ts` (COUNT FILTER + NULLIF) | role-match |
| `src/lib/insight/detectors/stuck-pending.ts` | service (detector, no SQL) | transform | `src/lib/read/pending.ts` (`buildPendingView` consumer) | exact (data source) |
| `src/lib/insight/detectors/ap12-advisory.ts` | service (LLM-gated) | event/request | `gradeNoData` no-data pattern only | partial |
| `src/lib/insight/guardrails.ts` | service (pure post-pass) | transform | `src/lib/scorecard/grade.ts` (pure fns over typed views) | role-match |
| `src/lib/insight/rank.ts` | utility (pure sort) | transform | `src/lib/scorecard/fleet.ts` (`sortFleet`) | exact |
| `src/lib/insight/deeplink.ts` | utility (pure URL) | transform | `buildSignals` href in `src/app/(overview)/[pubkey]/[tab]/page.tsx` | exact |
| `src/lib/insight/engine.ts` | service (orchestrator) | request-response | `src/lib/scorecard/fleet.ts` (`loadFleetView`) | exact |
| `src/lib/insight/narrative.ts` | service (LLM) | request-response | `../lqwdclaw/src/lib/ai/provider.ts` (`getModel()`) | role-match (external repo) |
| `src/app/(overview)/inbox/page.tsx` | route (RSC page) | request-response | `src/app/(overview)/pending/page.tsx` | exact |
| `src/components/insight/*` (card row/list) | component (server) | render | `src/components/console/ActiveSignalsPanel.tsx` + `CriticalChip.tsx` | exact |
| Narrate button (client leaf) | component (client) | event-driven | none — no `"use client"` interactive component exists yet (`ExportButton` is a plain `<a>`) | none |
| `src/lib/insight/schema.contract.test.ts` + `schema-fixture.json` | test (contract) | — | `force-close.test.ts` "metric key contract" describe | role-match |
| `src/lib/insight/detectors/*.test.ts` | test (shape + fixture) | — | `src/lib/scorecard/dimensions/force-close.test.ts` | exact |
| `guardrails.test.ts`, `rank.test.ts` | test (pure unit) | — | `src/lib/scorecard/grade.test.ts` / `fleet.test.ts` pattern | exact |
| live golden test | test (live, skipIf) | — | `src/lib/read/golden.test.ts` | exact |
| `src/app/(overview)/[pubkey]/[tab]/page.tsx` | route (MODIFIED) | request-response | itself — extend `buildSignals` | exact |

## Pattern Assignments

### Detector modules with SQL — `htlc-timeout.ts`, `close-cluster.ts`, `fee-stepdown.ts`, `rebalance.ts`, `fee-signals.ts`

**Analog:** [src/lib/scorecard/dimensions/force-close.ts](src/lib/scorecard/dimensions/force-close.ts) — THE dimension-module pattern. Every detector module copies this 4-part anatomy: banner → exported SQL builder(s) → raw-row interface → lazy-import executor.

**Imports + banner pattern** ([force-close.ts](src/lib/scorecard/dimensions/force-close.ts#L1-L30)):
```typescript
import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import type { DimensionResult } from "@/lib/scorecard/types";

// =====================================================
// Force-close prevention dimension (D-01 #5) + AP-11 close-storm Tier-1 (D-08)
// =====================================================
// Source: `lnd_node_closed_channels` — ONE ROW PER CLOSE (verified 3,238 rows /
// 3,177 distinct chan_id for Canada — near 1:1). Aggregate BY ROW; no DISTINCT ON
// needed (this is NOT an event-duplicated table like lnd_node_channel_info).
```
Detectors import `type { InsightCard }` from `@/lib/insight/types` instead of `DimensionResult`. The banner MUST state the table, identity column (`local_pubkey` vs `lnd_pubkey` vs `requesting_node_pubkey` — Pitfall 6), and whether DISTINCT ON applies.

**Core SQL-builder pattern** — fleet-wide single aggregate, bound numeric params, fixed enum literals ([force-close.ts](src/lib/scorecard/dimensions/force-close.ts#L37-L52)):
```typescript
export function buildForceCloseAggSql(windowDays = 30): SQL {
  return sql`
    SELECT
      local_pubkey,
      COUNT(*) FILTER (WHERE close_type = 'LOCAL_FORCE_CLOSE'
        AND timestamp > now() - make_interval(days => ${windowDays})) AS local_fc_window,
      COUNT(*) FILTER (WHERE close_type = 'COOPERATIVE_CLOSE'
        AND close_initiator = 'INITIATOR_REMOTE')::float
        / NULLIF(COUNT(*) FILTER (WHERE close_type = 'COOPERATIVE_CLOSE'), 0)
        AS coop_remote_share,
      MAX(timestamp) AS as_of
    FROM lnd_node_closed_channels
    WHERE local_pubkey IS NOT NULL
    GROUP BY local_pubkey
  `;
}
```
`close-cluster.ts` starts from the hour-bucket twin [buildSelfCloseStormSql](src/lib/scorecard/dimensions/force-close.ts#L59-L72) (`date_trunc('hour', timestamp)` + `INITIATOR_LOCAL` + `make_interval(hours => ${windowHours})`) — keep the inner-subquery GROUP BY shape, but return per-bucket node lists instead of MAX. `rebalance.ts` copies the `COUNT(*) FILTER (...) / NULLIF(COUNT(*), 0)` success-rate idiom verbatim against `internal_rebalance_invoices` (identity: `requesting_node_pubkey`).

**Raw-row coercion pattern** ([force-close.ts](src/lib/scorecard/dimensions/force-close.ts#L75-L90)):
```typescript
interface AggRow {
  local_pubkey: string;
  local_fc_window: number | string | bigint;
  coop_remote_share: number | string | null;
  // STRING at runtime: drizzle's postgres-js adapter overrides the driver's
  // timestamp parsers, so raw .execute surfaces MAX(timestamp) as an ISO
  // string — coerce in the mapping below.
  as_of: Date | string | null;
}
```
Every numeric coerces via `Number(...)`, every timestamp via `parseDbTimestampUtc(...)` — at the mapping layer, once.

**Lazy-import executor pattern** ([force-close.ts](src/lib/scorecard/dimensions/force-close.ts#L97-L112)):
```typescript
export async function forceCloseForFleet(
  windowDays = 30,
): Promise<Map<string, DimensionResult>> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  const [aggResult, stormResult] = await Promise.all([
    dbRouting.execute(buildForceCloseAggSql(windowDays)),
    dbRouting.execute(buildSelfCloseStormSql()),
  ]);
  const aggRows = aggResult as unknown as AggRow[];
```
Detector twist per RESEARCH: split executor from a **pure `detect*(rows, config): InsightCard[]`** function so fixtures drive the detection logic with no DB.

**Nanosecond-window pattern for `fee-stepdown.ts` / `fee-signals.ts`** ([src/lib/console/trends.ts](src/lib/console/trends.ts#L26-L29) and [trends.ts](src/lib/console/trends.ts#L57-L67)):
```typescript
// Both window factors are parameter-bound, so each carries an explicit ::int
// cast — `$n * $m` with two untyped params is `unknown * unknown`, which
// Postgres rejects with "operator is not unique" (42725; found live, 03-07).
const SECONDS_PER_DAY = 86400;

export function buildForwardsDailySql(pubkey: string, days: number): SQL {
  return sql`
    SELECT to_timestamp(timestamp_ns / 1e9)::date AS day,
           COUNT(*)::int        AS n,
           SUM(fee_msat)/1000.0 AS fees_sat
    FROM lnd_node_forwards
    WHERE lnd_pubkey = ${pubkey}
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days}::int * ${SECONDS_PER_DAY}::int) * 1e9
    GROUP BY 1
    ORDER BY 1 ASC
  `;
}
```
The step-down baseline (`now-35d … now-7d`) needs BOTH bounds in this `×1e9` form with `::int` casts. `SUM(fee_msat)/1000.0` is the only sanctioned in-SQL fee math (AFM-002). Note identity column here is `lnd_pubkey`, NOT `local_pubkey`.

**Fee-policy reading for `fee-signals.ts`** — current PPM comes from the sanctioned reader, never new SQL ([src/lib/console/fees.ts](src/lib/console/fees.ts#L1-L14)):
```typescript
import { latestChannelsForNode } from "@/lib/read/latest";
// ZERO new SQL: wraps latestChannelsForNode and derives the per-channel fee
// report ... `outgoing_fee_rate_milli_msat` is msat-per-msat ×1e6 — i.e.
// it IS the PPM value; no conversion applies.
```
The hysteresis history query (per-chan_id windowed series scan over `lnd_node_channel_info`) is NEW SQL with no analog — document in the banner that it is a legitimate history read, not a latest-state read (RESEARCH Pitfall 1).

---

### `src/lib/insight/config.ts` (config)

**Analog:** [src/lib/scorecard/config.ts](src/lib/scorecard/config.ts)

**Header contract + purity** ([config.ts](src/lib/scorecard/config.ts#L3-L13)):
```typescript
// =====================================================
// D-02 — the SINGLE tuning surface
// =====================================================
// STARTING VALUES, NOT CONTRACT — the operator retunes here as fleet data
// accumulates; ... Phase 4's insight engine
// reads these SAME bands — do not fork a second threshold table.
//
// Pure module: NO server-only import — test-imported and safe anywhere.
```
`INSIGHT_CONFIG` copies the per-backend two-literal structure ([config.ts](src/lib/scorecard/config.ts#L53)): `Record<"lnd" | "ldk", InsightKnobs>` with `ldk` its own object literal "so the per-backend tuning surface exists from day one." Every knob carries a confidence/justification comment (e.g. `// MEDIUM confidence — cross-node-monitoring-matrix.md`). Where a detector grades a scorecard metric, READ `SCORECARD_CONFIG[backend].forceClose.tier1.value` / `.revenue.tier1.value` — never restate 50 or 10.

---

### `src/lib/insight/close-storm.ts`, `guardrails.ts` (pure post-processing)

**Analog:** [src/lib/scorecard/grade.ts](src/lib/scorecard/grade.ts) — pure, no server-only, no DB; threshold values arrive as parameters.

**Threshold evaluation pattern** ([grade.ts](src/lib/scorecard/grade.ts#L99-L111)):
```typescript
function evaluateTier1(result: DimensionResult, tier1: Tier1Line | undefined): Tier1Breach | null {
  if (!tier1) return null;
  const metricValue = tier1.metric === "raw" ? result.raw : result.extras?.[tier1.metric];
  if (typeof metricValue !== "number" || Number.isNaN(metricValue)) return null;
  const breached =
    (tier1.op === ">" && metricValue > tier1.value) || ...
  return breached ? { label: tier1.label } : null;
}
```
`close-storm.ts` consumes `loadFleetView()` extras — the metric is already computed; the typed access pattern for the suppression flag set (Pitfall 5, never label-matching) is:
```typescript
// from buildSignals, [pubkey]/[tab]/page.tsx lines 93-96 — typed tier1Breach access
for (const dim of node.dimensions) {
  if (dim.tier1Breach === null) continue;
  // → suppression flag: node.dimensions.find(d => d.key === "forceClose")?.tier1Breach !== null
}
```
The null-raw short-circuit precedent for detector noise floors ([grade.ts](src/lib/scorecard/grade.ts#L131-L133)): `if (result.raw === null) return { ...gradeNoData(key), ... }` — null PPM stays no-data, never 0 (Pitfall 4).

---

### `src/lib/insight/rank.ts` (pure sort)

**Analog:** [src/lib/scorecard/fleet.ts](src/lib/scorecard/fleet.ts#L138-L152) — `sortFleet`

```typescript
/** D-09 sort (pure, non-mutating): criticals first — among criticals, lowest
 *  compositePct first; ... A null compositePct sorts LAST within its group. */
export function sortFleet(nodes: ScorecardView[]): ScorecardView[] {
  const group = (n: ScorecardView): number => (n.dot === "critical" ? 0 : 1);
  return [...nodes].sort((x, y) => {
    const byGroup = group(x) - group(y);
    if (byGroup !== 0) return byGroup;
    if (x.compositePct === null && y.compositePct === null) return 0;
    if (x.compositePct === null) return 1;
    if (y.compositePct === null) return -1;
    return x.compositePct - y.compositePct;
  });
}
```
Copy: non-mutating `[...cards].sort`, group-then-tiebreak structure (severity band → limbo-at-risk / evidence magnitude), nulls-last, doc comment naming the decision (D-06).

---

### `src/lib/insight/engine.ts` (server-only orchestrator)

**Analog:** [src/lib/scorecard/fleet.ts](src/lib/scorecard/fleet.ts) — `loadFleetView`

**server-only marker + banner** ([fleet.ts](src/lib/scorecard/fleet.ts#L1) and [fleet.ts](src/lib/scorecard/fleet.ts#L39-L52)):
```typescript
import "server-only";
// =====================================================
// FLEET-01/02/03 — the single server-side fleet assembly
// =====================================================
// loadFleetView() is THE one computation the pages render ... Bounded read
// (T-02-05): exactly 5 windowed aggregate queries + 1 DISTINCT ON snapshot
// per call ...
// server-only (T-02-02): this module imports backends.ts (process.env) and
// triggers warehouse reads. The pure helpers ... are still exported for unit tests.
```

**Parallel-fan + assemble + post-pass + sort + return pattern** ([fleet.ts](src/lib/scorecard/fleet.ts#L191-L249)):
```typescript
export async function loadFleetView(): Promise<FleetView> {
  const rows = await latestNodeInfoAll();
  const [routingMap, revenueMap, liquidityMap, forceCloseMap, restartMap] = await Promise.all([
    routingForFleet(), revenueForFleet(), liquidityForFleet(), forceCloseForFleet(), restartForFleet(),
  ]);
  // ... assemble per node, backendFor(pubkey) per-backend config lookup ...
  attachPeerRelative(views);   // second-pass post-processing — guardrails analog
  return { nodes: sortFleet(views), fetchedAt: new Date() };
}
```
`loadInsightView()` mirrors this exactly: `loadFleetView()` + `Promise.all(detector executors)` + pending readers → `detect*` pure fns → `applySuppression`/hysteresis post-pass → `rank` → **`InsightCardSchema.array().parse(cards)`** as the final gate → `{ cards, fetchedAt }`. State the query budget in the banner.

---

### `src/lib/insight/types.ts` + `schema.ts` (frozen contract)

**Analog:** [src/lib/scorecard/types.ts](src/lib/scorecard/types.ts) — purity + invariants-in-comments style ([types.ts](src/lib/scorecard/types.ts#L1-L16)):
```typescript
// =====================================================
// Scorecard type contracts (Phase 2 — FLEET-02/FLEET-03)
// =====================================================
// The interface-first surface every scorecard plan codes against. Pure types +
// constants only — no imports, no runtime dependencies, safe everywhere.
//
// Invariants encoded here:
//  - raw values stay RAW (sats, ratios, counts, PPM) — the AFM-002 formatter
//    applies at render only; nothing in this layer converts units.
```
The severity values reuse the existing taxonomy literally — `StatusColor = "ok" | "warn" | "critical" | "nodata"` ([types.ts](src/lib/scorecard/types.ts#L52)) and `Tier1Breach` ([types.ts](src/lib/scorecard/types.ts#L62-L64)) are the Phase-2 precedents; cards use `"critical" | "warn" | "info"` per D-01. **zod has no in-repo analog** — follow RESEARCH §Card Schema exactly (`.strict()` at every level, `.superRefine` for the D-12 invariants, `z.infer` re-export from types.ts, no `server-only` import).

---

### `src/lib/insight/deeplink.ts` (pure URL helper)

**Analog:** `buildSignals` + validation constants in [src/app/(overview)/[pubkey]/[tab]/page.tsx](src/app/(overview)/[pubkey]/[tab]/page.tsx#L96-L103):
```typescript
const evidenceTab = EVIDENCE_TAB[dim.key];
signals.push({
  kind: "breach",
  label: dim.tier1Breach.label,
  detail: rawDisplayFor(dim),
  href: evidenceTab && `/${node.pubkey}/${evidenceTab}`,
  tabLabel: evidenceTab,
});
```
Build only relative `/${pubkey}/${tab}?window=${key}` paths; tab values come from the `TAB_KEYS` whitelist and window keys from `WINDOW_PRESETS` (`@/lib/console/config`) — never reflected user input. `EVIDENCE_TAB` lives in `@/components/scorecard/ScorecardPanel`.

---

### `src/lib/insight/narrative.ts` (LLM, server-only)

**Analog:** ../lqwdclaw/src/lib/ai/provider.ts (external repo — copy shape, NOT the Google default):
```typescript
import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

function parseModelOverride(modelStr: string): ModelConfig {
  if (modelStr.startsWith("claude")) return { provider: "anthropic", modelId: modelStr };
  // ...
}
export function getModel(): LanguageModel {
  const config = getModelConfig();   // process.env.AI_MODEL override
  switch (config.provider) {
    case "anthropic": return anthropic(config.modelId);
    // ...
  }
}
```
Per RESEARCH: ship anthropic-only with the same `parseModelOverride` switch shape, **default Claude** (CLAUDE.md mandate — lqwdclaw defaults to Google; do not copy that), throw a descriptive error for unconfigured providers (fail-loud, matching the [backends.ts](src/lib/config/backends.ts#L33-L46) `parseEnvOverrides` throw pattern). `import "server-only"` + lazy-import behind the `INSIGHT_LLM_ENABLED` gate.

---

### `src/app/(overview)/inbox/page.tsx` (RSC page)

**Analog:** [src/app/(overview)/pending/page.tsx](src/app/(overview)/pending/page.tsx) — the sibling fleet-surface page. Copy its full skeleton:

**Page directives + metadata** ([pending/page.tsx](src/app/(overview)/pending/page.tsx#L13-L18)):
```typescript
// Live warehouse read at request time (Server Component) — never prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Pending" };
```

**Error-degrade fetch pattern** ([pending/page.tsx](src/app/(overview)/pending/page.tsx#L40-L60)):
```typescript
export default async function FleetPendingPage() {
  let view: PendingView;
  try {
    const [channels, sweeps] = await Promise.all([...]);
    view = buildPendingView(channels, sweeps);
  } catch (error) {
    console.error("Fleet pending load failed:", error);
    return (
      <main className="py-10">
        <h1 className="text-2xl font-semibold">{"Couldn't load Pending."}</h1>
        <p className="mt-4 text-base text-foreground/70">
          {"The warehouse didn't respond. Your data is unchanged — this view is read-only. ..."}
        </p>
      </main>
    );
  }
```

**Header + honest empty state + panel grammar** ([pending/page.tsx](src/app/(overview)/pending/page.tsx#L64-L120)):
```tsx
<nav>
  <Link href="/" className="font-mono text-xs font-semibold tracking-[0.14em] text-brand-glow uppercase underline-offset-4 hover:underline">
    ← Fleet overview
  </Link>
</nav>
<header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
  <h1 className="font-display text-2xl font-semibold tracking-wide uppercase">Pending channels</h1>
  {view.asOf !== null && <FreshnessStamp asOf={view.asOf} stale={false} />}
</header>
{isEmpty ? (
  <div className="rounded-lg border border-border bg-card px-4 py-12 text-center">
    <span className="block text-2xl font-semibold">Nothing pending fleet-wide</span>
    ...
) : (
  <section className="overflow-hidden rounded-lg border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-4 py-2 font-mono text-xs font-semibold tracking-[0.14em] text-foreground/45 uppercase">
      <span>Pending · fleet-wide</span>
      <span className="tabular-nums">{view.nodes.length} node{...}</span>
    </div>
```
Inbox empty state: "no active recommendations — fleet clear at {timestamp}" (absence IS the signal). Severity sections replace node groups.

---

### Card components — `src/components/insight/*`

**Analog:** [src/components/console/ActiveSignalsPanel.tsx](src/components/console/ActiveSignalsPanel.tsx) — the row anatomy and the no-logic-in-JSX contract:

**Caller-builds-rows contract + healthy-absence rule** ([ActiveSignalsPanel.tsx](src/components/console/ActiveSignalsPanel.tsx#L8-L33)):
```typescript
// One row per tier-1 breach (red) or fleet-outlier (amber). The SignalRow[] is
// BUILT BY THE CALLER (03-15) from node.dimensions — this component renders it
// VERBATIM, no health logic (T-02-07).
export function ActiveSignalsPanel({ signals }: ActiveSignalsPanelProps) {
  // Healthy node → no panel at all (sketch rule: the absence IS the signal).
  if (signals.length === 0) return null;
```

**Severity row anatomy** ([ActiveSignalsPanel.tsx](src/components/console/ActiveSignalsPanel.tsx#L43-L71)):
```tsx
<div className="flex items-baseline gap-4 border-b border-border px-4 py-3 last:border-b-0">
  <span className="font-mono text-xs font-semibold tracking-[0.06em] text-status-critical uppercase">
    {signal.label}
  </span>
  <span className="font-mono text-xs text-foreground/60">{signal.detail}</span>
  {signal.href !== undefined && (
    <Link href={signal.href} className="ms-auto font-mono text-xs whitespace-nowrap text-brand-light transition-colors hover:text-brand-glow">
      {`open ${signal.tabLabel ?? "evidence"} →`}
    </Link>
  )}
</div>
```

**Severity chip = plain uppercase mono text, never a boxed chip** ([src/components/scorecard/CriticalChip.tsx](src/components/scorecard/CriticalChip.tsx#L12-L18)):
```tsx
export function CriticalChip({ label }: CriticalChipProps) {
  return (
    <span className="font-mono text-xs font-semibold tracking-[0.06em] uppercase whitespace-nowrap text-status-critical">
      {label}
    </span>
  );
}
```
Severity tokens: `text-status-critical` / `text-status-warn` (see kind branch in ActiveSignalsPanel lines 52-57). Card components are Server Components rendering pre-built card objects verbatim — all ranking/suppression/formatting happened in the engine.

---

### Console integration (MODIFY `src/app/(overview)/[pubkey]/[tab]/page.tsx`)

**Analog:** itself — extend [buildSignals](src/app/(overview)/[pubkey]/[tab]/page.tsx#L89-L124) (full excerpt above in deeplink section). Insight cards for `node.pubkey` map into additional `SignalRow`-shaped rows (or an adjacent section) composed at line 213: `<ActiveSignalsPanel signals={buildSignals(node)} />`. The supplementary-read precedent for adding `loadInsightView()` is the `.catch`-degraded `Promise.all` at [page.tsx](src/app/(overview)/[pubkey]/[tab]/page.tsx#L182-L190) — garnish reads never take the page down. Note `const getFleet = cache(loadFleetView)` ([page.tsx](src/app/(overview)/[pubkey]/[tab]/page.tsx#L70)) — wrap `loadInsightView` in `cache()` the same way if both metadata and page need it.

---

### Test files

**Analog:** [src/lib/scorecard/dimensions/force-close.test.ts](src/lib/scorecard/dimensions/force-close.test.ts) — the no-DB PgDialect shape-test pattern every detector test copies:

**Render harness + shape assertions** ([force-close.test.ts](src/lib/scorecard/dimensions/force-close.test.ts#L17-L52)):
```typescript
import { PgDialect } from "drizzle-orm/pg-core";
const dialect = new PgDialect();
function render(built: ReturnType<typeof buildForceCloseAggSql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

it("binds the window-days param ($1) instead of interpolating it", () => {
  const { sql, params } = render(buildForceCloseAggSql(30));
  expect(sql).toContain("$1");
  expect(params).toContain(30);
});
it("never pins the AFM-001 failure shape WHERE timestamp =", () => {
  const { sql } = render(buildForceCloseAggSql());
  expect(sql).not.toContain("where timestamp =");
});
```

**Injection-surface + key-contract describes** ([force-close.test.ts](src/lib/scorecard/dimensions/force-close.test.ts#L87-L113)):
```typescript
describe("injection surface", () => {
  it("builders accept only number args — enum strings are fixed literals...", () => {
    expect(agg.params.every((p) => typeof p === "number")).toBe(true);
  });
});
describe("AP-11 tier1 metric key contract (T-02-07)", () => {
  it('config tier1 metric for forceClose is exactly "maxHourlySelfCloses" on both backends', () => {
    expect(SCORECARD_CONFIG.lnd.forceClose.tier1?.metric).toBe("maxHourlySelfCloses");
  });
});
```
The key-contract describe is the seed pattern for `schema.contract.test.ts` (D-02): committed-fixture parse + deliberate-mutation rejection + shape snapshot embedding `CARD_SCHEMA_VERSION`. Shape tests additionally assert: the `1e9` literal (ns windows), the correct identity column name per table (Pitfall 6), and `::int` casts on multiplied bound params.

**Live golden pattern** ([src/lib/read/golden.test.ts](src/lib/read/golden.test.ts#L1-L30)):
```typescript
// dbRouting is loaded lazily (only when HAS_DB) so this suite imports cleanly —
// and skips via skipIf — without ROUTING_VM_DATABASE_URL
async function routing() {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  return dbRouting;
}
const HAS_DB = !!process.env.ROUTING_VM_DATABASE_URL;
// The assertion is the INVARIANT, not a frozen literal — it survives live drift
```

---

### `stuck-pending.ts` (detector over existing reader)

**Analog:** [src/lib/read/pending.ts](src/lib/read/pending.ts) — consume, never re-query. The detector takes `buildPendingView()` output (or the raw `PendingRow`/`PendingSweepRow` arrays) — see the page-side composition in [pending/page.tsx](src/app/(overview)/pending/page.tsx#L42-L46):
```typescript
const [channels, sweeps] = await Promise.all([
  currentPendingChannels(PENDING_RECENCY_HOURS),
  currentPendingSweeps(PENDING_RECENCY_HOURS),
]);
view = buildPendingView(channels, sweeps);
```
Rank-key fields are already raw on the rows: `limboBalance: string | null` ([pending.ts](src/lib/read/pending.ts#L50-L62)) and `amountSat`, `broadcastAttempts`, `satPerVbyte`/`requestedSatPerVbyte` on `PendingSweepRow` ([pending.ts](src/lib/read/pending.ts#L33-L47)) — coerce `Number(limboBalance)` once at the detector layer. `buildPendingView` itself is the model for the injectable-`now` pure-shaper test style ([pending.ts](src/lib/read/pending.ts#L218-L224)): `now: Date = new Date()` parameter for deterministic age math — copy this for all age-window detector logic.

## Shared Patterns

### Timestamp coercion
**Source:** [src/lib/read/db-timestamp.ts](src/lib/read/db-timestamp.ts#L30-L41)
**Apply to:** every detector executor mapping raw `.execute` rows
```typescript
export function parseDbTimestampUtc(value: Date | string | null): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const s = value.trim();
  const hasExplicitOffset = /[Zz+-]/.test(s.slice(10));
  const date = hasExplicitOffset ? new Date(s) : new Date(`${s.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
```

### Unit formatting (AFM-002)
**Source:** [src/lib/format/units.ts](src/lib/format/units.ts#L7-L20)
**Apply to:** every sat/BTC/fee value rendered on cards — detectors keep values RAW; format only in components
```typescript
export function feeMsatToSat(msat: bigint | number): number {
  return Number(msat) / MSAT_PER_SAT;
}
export function formatSats(sats: bigint | number): string {
  return Number(sats).toLocaleString("en-US");
}
```
A grep guard blocks ad-hoc `/1e8` / `*1000` in src — never inline conversions.

### Per-backend resolution
**Source:** [src/lib/config/backends.ts](src/lib/config/backends.ts#L64-L66) — `backendFor(pubkey)` (server-only; reads `process.env.NODE_BACKENDS`)
```typescript
export function backendFor(pubkey: string): Backend {
  return ENV_OVERRIDES[pubkey] ?? DEFAULT_BACKENDS[pubkey] ?? "lnd";
}
```
**Apply to:** engine.ts config lookup (`INSIGHT_CONFIG[backendFor(pubkey)]`), exactly as [fleet.ts](src/lib/scorecard/fleet.ts#L222) does with `SCORECARD_CONFIG[backend]`.

### server-only vs pure module split
**Apply to:** all of `src/lib/insight/`
- `import "server-only"`: `engine.ts`, `narrative.ts` (env + DB pools) — [fleet.ts](src/lib/scorecard/fleet.ts#L1) precedent.
- NO server-only: `types.ts`, `schema.ts`, `config.ts`, `rank.ts`, `guardrails.ts`, `deeplink.ts`, pure `detect*` fns — [config.ts](src/lib/scorecard/config.ts#L12) "Pure module: NO server-only import — test-imported and safe anywhere."
- SQL-builder modules: no server-only at top; DB client via lazy `await import("@/lib/db/warehouse-routing")` inside the executor only.

### Fail-loud env parsing
**Source:** [src/lib/config/backends.ts](src/lib/config/backends.ts#L33-L46) — descriptive `throw` at boot for malformed config; apply to any `INSIGHT_LLM_ENABLED`/`AI_MODEL` handling that can be malformed (absent = off, never throw on absence).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/lib/insight/schema.ts` (zod mechanics) | model | transform | zod not yet in the repo — follow RESEARCH §Card Schema (`.strict()`, `.superRefine`, `z.infer`); purity conventions from scorecard/types.ts still apply |
| Narrate button (client leaf) | component | event-driven | No `"use client"` interactive component exists; `ExportButton` is a plain `<a download>` with no client JS. Use a thin client leaf invoking a server action; styling via `buttonVariants({ variant: "outline", size: "sm" })` + `font-mono text-xs font-semibold tracking-[0.14em] uppercase` per [ExportButton.tsx](src/components/console/ExportButton.tsx#L22-L31) |
| `src/lib/insight/detectors/ap12-advisory.ts` | service | request-response | No LLM call site exists in-repo; provider shape from ../lqwdclaw provider.ts, no-data placeholder honesty pattern from `gradeNoData` ([grade.ts](src/lib/scorecard/grade.ts#L116-L126)) |

## Metadata

**Analog search scope:** `src/lib/scorecard/**`, `src/lib/read/**`, `src/lib/console/**`, `src/lib/config/**`, `src/lib/format/**`, `src/components/{console,scorecard}/**`, `src/app/(overview)/**`, `../lqwdclaw/src/lib/ai/`
**Files scanned:** 15 read in full or targeted section (force-close.ts, force-close.test.ts, config.ts, grade.ts, types.ts, fleet.ts, pending.ts, trends.ts, fees.ts, ActiveSignalsPanel.tsx, CriticalChip.tsx, ExportButton.tsx, pending/page.tsx, [pubkey]/[tab]/page.tsx, golden.test.ts, db-timestamp.ts, units.ts, backends.ts, lqwdclaw provider.ts)
**Pattern extraction date:** 2026-06-11
