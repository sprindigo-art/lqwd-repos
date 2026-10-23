# Phase 14: Hosts + Infra Monitoring - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** 17 (12 new, 5 modified)
**Analogs found:** 16 / 17 (exact or role-match; 1 partial — host runbook builder)

Every analog below was read at source this session. Excerpts carry file paths and line
numbers so the planner can point each plan action at concrete code to copy.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/read/host-history.ts` (+test) | read helper | bounded time-window scan | `src/lib/read/host-metrics.ts` | exact |
| `src/lib/read/telemetry-bands.ts` (MODIFY) | config + pure evaluator | transform | itself (`evaluateBand`, lines 96-106) | exact |
| `src/lib/read/storage-projection.ts` (+test) | pure utility | transform | `src/lib/read/storage-growth.ts` | exact |
| `src/lib/overview/host-rollup.ts` (+test) | pure module | transform (severity reduction) | `src/lib/overview/severity-map.ts` + `incidents.ts` graders | exact |
| `src/lib/overview/host-filter.ts` (+test) | pure module | transform (facet codec/filter/sort) | `src/lib/overview/node-filter.ts` | exact |
| `src/lib/overview/host-runbook.ts` (+test) | pure module | transform (copy builder) | `CommandModal` `RunbookStep` contract (consumer side only) | partial — no builder analog exists |
| `src/components/df/ThresholdMeter.tsx` (+test) | df primitive (Server) | presentational | `src/components/df/FreshnessChip.tsx` + `Severity.ts` ramp API | role-match |
| `src/components/host/HostFilters.tsx` | client component | request-response (URL params) | `src/components/node/NodeFilters.tsx` | exact (verbatim clone) |
| `src/components/host/HostCard.tsx` | server component | presentational composition | `SeverityCard` + `TwoAxisPip` + `SeverityRow` dot grammar | role-match |
| `src/components/host/HostIncidentBanner.tsx` | server component (+client modal) | presentational | `SeverityCard` + `src/components/df/CommandModal.tsx` | role-match |
| `src/components/host/StorageVolumes.tsx` | server component | presentational | `src/components/node/VmVitals.tsx` (stale-branch grammar) | role-match |
| `src/components/host/OnHostNodes.tsx` | server component | presentational | `src/components/df/SeverityRow.tsx` | exact |
| `src/app/(overview)/hosts/page.tsx` | RSC route (list) | request-response | `src/app/(overview)/nodes/page.tsx` | exact (whole-file template) |
| `src/app/(overview)/hosts/[hostId]/page.tsx` | RSC route (detail) | request-response | `src/app/(overview)/[pubkey]/page.tsx` | exact (whole-file template) |
| `src/app/(design)/design-system/page.tsx` (MODIFY) | gallery registration | presentational | its own `Section`/`Cell` pattern (lines 68-90) | exact |
| `src/app/(overview)/page.tsx` (MODIFY: opsNav) | config edit | — | its own opsNav array (lines 484-490) | exact |
| `src/app/(overview)/nodes/page.tsx` (MODIFY: OPS_NAV) | config edit | — | its own `OPS_NAV` const (lines 24-30) | exact |

Optional (RESEARCH Open Q2, planner's call): back-fill `src/app/(overview)/[pubkey]/page.tsx:298`
(`<VmVitals charts={[]} />`) with the new history reader.

## Pattern Assignments

### `src/lib/read/host-history.ts` (read helper, bounded history scan)

**Analog:** `src/lib/read/host-metrics.ts` — copy the module conventions exactly.

**Exported `buildXxxSql` fragment, parameter-bound** (host-metrics.ts:72-82):
```typescript
export function buildLatestHostMetricsSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id) *
    FROM host_metrics
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
    ORDER BY host_id, collected_at DESC
  `;
}
```
History reads are plain bounded scans, NOT DISTINCT ON (that is the *latest* pattern):
`WHERE host_id = ${hostId} AND collected_at > now() - make_interval(secs => ${windowMs / 1000}) ORDER BY collected_at ASC`.

**Lazy DB import + raw-execute coercion** (host-metrics.ts:146-156, 170-186):
```typescript
export async function getLatestHostMetrics(): Promise<HostMetricsView[]> {
  // Lazy import keeps the server-only `dbNodemon` client (postgres() pool +
  // requireEnv at module load) out of the no-DB shape test's import graph.
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const metricRows = (await dbNodemon.execute(
    buildFleetLatestHostMetricsSql(),
  )) as unknown as (LatestHostMetricsRow & { hostname: string | null })[];
  ...
  const collectedAt = parseDbTimestampUtc(row.collected_at as Date | string | null);
```
Coerce numerics with `Number()` (`cpu_pct` arrives as `string | number | null`) and
timestamps with `parseDbTimestampUtc` from `@/lib/read/db-timestamp` (Pitfall 3).
Storage history rows map to `StorageGrowthSample[]` per mount (`storage-growth.ts:26-30`:
`{ collectedAt: Date; usedBytes; totalBytes }`).

**Test analog:** `src/lib/read/host-metrics.test.ts:24-55` — the no-DB SQL-shape pattern:
```typescript
const dialect = new PgDialect();
function renderMetrics(hostId: string) {
  const built = dialect.sqlToQuery(buildLatestHostMetricsSql(hostId));
  return { sql: built.sql.toLowerCase(), params: built.params };
}
// asserts: shape strings present, `not.toContain("max(")`, and injection binding:
const evil = "'; DROP TABLE host_metrics; --";
const { sql, params } = renderMetrics(evil);
expect(sql).not.toContain("drop table");
expect(params).toContain(evil);
expect(sql).toContain("$1");
```
Also copy the `describe.skipIf(!process.env.NODEMON_QUEUE_URL)` seeded-DB block pattern
(host-metrics.test.ts:91-152) if a live test is wanted.

---

### `src/lib/read/telemetry-bands.ts` MODIFY (4-level days-to-full config)

**Analog:** the same file's config-object + pure-evaluator posture (lines 45-106).
Do NOT route through `TelemetryBand`/`severityFromBand` — 3-level, no `watch` (Pitfall 2).

**Existing shape to mirror** (telemetry-bands.ts:96-106):
```typescript
export function evaluateBand(value: number, band: TelemetryBand): BandSeverity {
  if (band.direction === "higher-better") {
    if (value >= band.healthy) return "healthy";
    if (value >= band.warn) return "warn";
    return "critical";
  }
  // higher-worse: lower values are healthier.
  if (value <= band.healthy) return "healthy";
  if (value <= band.warn) return "warn";
  return "critical";
}
```
Add (RESEARCH Pattern 3, D-13 locked): `DAYS_TO_FULL_BANDS = { critical: 7, warning: 30, watch: 90 }`
+ `evaluateDaysToFull(days: number): "critical" | "warning" | "watch" | "healthy"` — the
literals are already df `Severity` members, no mapper needed. Keep the file's boundary
convention comment ("boundary value belongs to the HEALTHIER band") and pin it in the test
(6.9→critical, 7→warning, 29.9→warning, 30→watch, 89.9→watch, 90→healthy). Additive only —
existing exports untouched. Extend the existing `telemetry-bands.test.ts`.

---

### `src/lib/read/storage-projection.ts` (pure utility — D-14 status copy + D-15 humanizer)

**Analog:** `src/lib/read/storage-growth.ts` — same pure-module posture (header comment:
"PURE transform (named exports, no server/DB imports — tested like units.ts)").

**The input types it renders from** (storage-growth.ts:33-48):
```typescript
export type StorageProjectionStatus =
  | "ok" | "insufficient-samples" | "insufficient-window" | "stale" | "flat-or-negative";

export interface StorageGrowth {
  status: StorageProjectionStatus;
  pctPerDay: number | null;     // null when not computable
  daysToFull: number | null;    // null unless status === "ok"
  latestPctUsed: number | null; // 0–100
}
```
Note (Pitfall 4): `flat-or-negative` still carries a non-null (possibly negative) `pctPerDay`
— render the signed rate plus "not growing".

Copy targets are verbatim in the UI-SPEC Copywriting Contract: humanize bands
(≥365 → `>1 year to full`; 90–365 → `~N months`; 28–90 → `~N days` rounded to 5;
7–28 → `~N weeks`; <7 → `~N days`) and per-status copy
(`projection unavailable — data stale (<t> old)` / `gathering data — projection in ~<N>h` /
`not growing`). The "~Nh" derives from `minWindow − currentSpan` (growth's
`DEFAULT_MIN_WINDOW_MS` is 1h, storage-growth.ts:21).

---

### `src/lib/overview/host-rollup.ts` (pure module — worst-of + D-05 driver line)

**Analogs:** `src/lib/overview/severity-map.ts` (the sanctioned mappers) +
`src/lib/overview/incidents.ts` graders (compose the SAME grading, do NOT edit incidents.ts).

**Module header convention** (severity-map.ts:1, node-filter.ts:1):
```typescript
// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
```

**The only worst-of reducer** (severity-map.ts:98-105) — stale is orthogonal, filtered out:
```typescript
export function worstSeverity(severities: Severity[]): Severity {
  let worst: Exclude<Severity, "stale"> = "healthy";
  for (const s of severities) {
    if (s === "stale") continue; // orthogonal — never promotes (D-08)
    if (RAMP_RANK[s] > RAMP_RANK[worst]) worst = s;
  }
  return worst;
}
```

**Chain grading to mirror for the bitcoind contributor** (incidents.ts:116-122):
```typescript
function gradeChain(c: ChainTelemetryView): Severity {
  if (c.stale || !c.hasData) return "stale";
  const bands = [c.bands.blocksBehind, c.bands.verificationProgress, c.bands.peers]
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .map((b) => severityFromBand(b.band));
  return worstSeverity(bands);
}
```

**Node grading to mirror** (nodes/page.tsx:37-47 — the sanctioned scorecard switch):
```typescript
function nodeSeverity(node: ScorecardView): Severity {
  if (node.stale) return "stale";
  switch (node.dot) {
    case "critical": return "critical";
    case "warn":     return "warning";
    case "ok":       return "healthy";
  }
}
```

**Service contributor:** `severityFromService(s)` (severity-map.ts:70-76, precedence
noData → stale → !running → !functioning → healthy). Resources: `evaluateBand` against
`TELEMETRY_BANDS.cpuPctBusy` / `memAvailablePct` / `diskPctFree` (note diskPctFree is
%-FREE, so pass `100 − usedPct`) mapped through `severityFromBand`. Storage:
`evaluateDaysToFull`. Driver line = phrase of the FIRST contributor whose sev equals the
rollup, precedence infra → nodes → resources → storage; omit when healthy. Verbatim phrase
targets: `driven by: bitcoind not functioning` · `driven by: disk filling — ~5 days to full`
· `driven by: 2 nodes critical`.

**Locked constraint:** `gradeHost` in incidents.ts:110-113 stays stale-or-healthy —
the rollup is view-side only, never wired into the incident tree.

---

### `src/lib/overview/host-filter.ts` (pure module — facets + the ONE sanctioned sort)

**Analog:** `src/lib/overview/node-filter.ts` — clone the whole module shape.

**Whitelist parse, widen-on-invalid** (node-filter.ts:81-90):
```typescript
export function parseNodeFacets(params: URLSearchParams): NodeFacets {
  const type = params.get("type");
  const status = params.get("status");
  const stale = params.get("stale");
  return {
    type: isType(type) ? type : "all",
    status: isStatus(status) ? status : "all",
    stale: stale === "1" || stale === "true",
  };
}
```

**Pure AND-semantics filter, never mutates, no sort** (node-filter.ts:99-106):
```typescript
export function applyNodeFilters<T extends NodeFilterRow>(nodes: T[], facets: NodeFacets): T[] {
  return nodes.filter(
    (node) =>
      (facets.type === "all" || node.backend === facets.type) &&
      (facets.status === "all" || STATUS_SEVERITIES[facets.status].has(node.severity)) &&
      (!facets.stale || node.stale),
  );
}
```
Hosts vocabulary: `?sev` ∈ {all, critical, warning, watch, healthy} + `?stale` toggle
(D-08 — note the sev chips are the direct df ramp, unlike the nodes status buckets).
ADD `sortHostsWorstFirst` — the ONLY `.sort` this phase introduces: severity rank desc,
stale grouped after at-risk, healthy last, ties by hostId. Pin the stale placement in the
test (RESEARCH Open Q3).

---

### `src/lib/overview/host-runbook.ts` (pure module — verify-first runbook copy, NO analog)

No builder analog exists (`buildExportBlock` is insight-card-keyed). Author against the
**consumer contract** in `src/components/df/CommandModal.tsx:81-101`:
```typescript
export interface RunbookStep { n: number; text: string; }

export interface CommandPanelProps {
  command: string;          // rendered as INERT escaped text
  runbook: RunbookStep[];   // ordered steps shown above the command
  kind?: CommandKind;       // "command" | "investigate" | "runbook" — risk-tier chrome
  cmdLabel?: string;
  note?: string;
}
```
Use `kind: "runbook"` (COMMAND_KIND_META.runbook, CommandModal.tsx:72-77: kicker
"Runbook · host operation", note "Higher-risk host operation — review each step.
NodeMonitor runs nothing for you."). Map driver class (bitcoind down / service not
functioning / disk filling / node critical) → `{ title, runbook, command }` with
"Verify first" steps preceding any command. Copy must not embed credentials or internal
DB names (`routing_vm` grep must stay 0).

---

### `src/components/df/ThresholdMeter.tsx` (the ONE new df primitive)

**Analogs:** `src/components/df/FreshnessChip.tsx` (small Server df primitive shape:
props interface with `className`, `cn()` merge, honest-stale branch) +
`src/components/df/Severity.ts` (the ONLY sanctioned sev→class maps).

**Ramp API to consume — never an `if (sev === …)` chain** (Severity.ts:55-61):
```typescript
export const severityAccent: Record<Severity, string> = {
  critical: "bg-df-critical",
  warning: "bg-df-warning",
  watch: "bg-df-watch",
  healthy: "bg-df-ok",
  stale: "bg-df-stale-dot",
};
```

**Props/className/stale-branch grammar to copy** (FreshnessChip.tsx:20-32, 55-68):
```typescript
interface FreshnessChipProps {
  asOf: Date | null;
  stale: boolean;
  now?: Date;
  className?: string;   // Extra classes merged last via `cn()`.
}
export function FreshnessChip({ asOf, stale, now, className }: FreshnessChipProps) {
  // Honest no-data early-return — never paint a fresh/stale chip without a stamp.
  if (asOf === null) { return ( <span className={cn("…", className)}>no data yet</span> ); }
```
Contract (UI-SPEC D-03 table, locked): props `{ pct, sev, stale?, label?, className? }`;
6px track, `rounded-df-pill`, track `border-df-border-soft`/`#ECEFF4`, fill class from
`severityAccent[sev]`, fill width = `pct` literally; `stale` → `df-stale-*` hatched/dashed
track with NO fill; `role="meter"` + `aria-valuenow/min/max` + `aria-label`; always rendered
adjacent to a mono value by callers. Presentation-pure: NEVER derives severity from `pct`.
Plain div/CSS — no SVG.

**Test analog:** any df primitive vitest; assert ramp class per sev, stale hatch (no fill),
0%/100% edges, a11y attributes. Must pass `npm run lint` (noc-guard greps
`src/components/df` + `src/app/(design)`).

---

### `src/components/host/HostFilters.tsx` (client chips)

**Analog:** `src/components/node/NodeFilters.tsx` — verbatim clone with hosts vocabulary.

**href serializer + chip chrome** (NodeFilters.tsx:29-54):
```typescript
/** Serialize facets to a query-relative href — `?` clears when everything is the widest default. */
function hrefFor(next: NodeFacets): string {
  const sp = new URLSearchParams();
  if (next.type !== "all") sp.set("type", next.type);
  if (next.status !== "all") sp.set("status", next.status);
  if (next.stale) sp.set("stale", "1");
  const query = sp.toString();
  return query.length > 0 ? `?${query}` : "?";
}

function chipClass(active: boolean): string {
  return cn(
    "inline-flex items-center rounded-df-pill border px-2.5 py-1 font-df-mono text-[11.5px] font-medium tracking-[0.02em] transition-colors",
    active
      ? "border-df-brand bg-df-brand text-white"          // navy = structure, never a health hue
      : "border-df-border text-df-muted hover:border-df-brand/40 hover:text-df-brand",
  );
}

function Chip({ active, label, href }: { active: boolean; label: string; href: string }) {
  return (
    <Link href={href} aria-pressed={active} className={chipClass(active)}>
      {label}
    </Link>
  );
}
```
Chips: All · Critical · Warning · Watch · Healthy + the "Stale only" toggle
(NodeFilters.tsx:100-105 — `href={hrefFor({ ...facets, stale: !facets.stale })}`).

---

### `src/components/host/HostCard.tsx` (server composition)

**Analogs:** `SeverityCard` chrome (`severityVariants`/`severityAccent` from Severity.ts),
`TwoAxisPip` (props at TwoAxisPip.tsx:28-46 — feed `running`/`functioning` booleans; the
combinedState precedence at lines 49-57 is internal, never re-derive), `ThresholdMeter` ×3,
node dots + `ui/tooltip`.

**Trio wiring** (RESEARCH Code Example, verified against `TwoAxisPip.tsx`):
```typescript
const trio = ["bitcoind", "esplora", "postgres"] as const;
const hostLevel = services.filter((s) => s.hostId === hostId && s.nodePubkey === null);
// per key: s may be undefined (not declared) or noData → honest unknown tile, never green
<TwoAxisPip name={serviceDisplay(s.serviceName).label} running={s.running}
            functioning={s.functioning} errorCount={s.errorCount} />
```

**Nested-link law (Pitfall 6):** card container is a plain div + an absolutely-positioned
stretched `Link` (`z-0`) covering it; dots/pips render `z-10 relative` above — never
`<a>` inside `<a>`. Dot = 8px `severityAccent[sev]` circle + tooltip (alias +
`severityLabel[sev]`) + `next/link` to `/${pubkey}`.

**No-telemetry variant (D-06):** gold `df-stale-*` treatment, `NO TELEMETRY` chip,
`ThresholdMeter stale`, honest-unknown trio. Copy per UI-SPEC Copywriting Contract.

---

### `src/components/host/HostIncidentBanner.tsx`

**Analogs:** `SeverityCard` (sev/title/why/childAlerts from `GroupedIncident.children`) +
`CommandModal` (trigger + `CommandPanel` props above).

**Incident selection** (assembleIncidents input shape, incidents.ts:85-92):
```typescript
export interface AssembleIncidentsInput {
  rankedCards: InsightCard[];   // engine-ranked — consumed IN ORDER, never re-sorted
  hosts: HostMetricsView[];
  chain: ChainTelemetryView[];
  services: ServiceHealthState[];
  nodes: ScorecardView[];
}
```
`incidents.find((i) => i.key === hostId) ?? null` — banner absent entirely when null
(D-10/D-11). No "Open incident" affordance, not even disabled. Engine-order-is-LAW:
never `.sort` the incident children.

---

### `src/components/host/StorageVolumes.tsx`

**Analogs:** `ThresholdMeter` rows + `storage-projection` copy; the honest-stale branch
grammar from `VmVitals` (VmVitals.tsx:92-101: explicit `chart.stale ? <StaleChart…> :
<EvidenceChart…>` — make the branch legible in-file, same discipline for
`status === "ok" ? projection : statusCopy`).

**Row severity** (RESEARCH Code Example — UI-SPEC assumption 6):
```typescript
const growth = computeStorageGrowth(samplesForMount);          // pure, shipped
const usedSev = severityFromBand(evaluateBand(100 - (usedPct ?? 0), TELEMETRY_BANDS.diskPctFree)); // band is %-FREE
const rowSev = growth.status === "ok"
  ? worstSeverity([usedSev, evaluateDaysToFull(growth.daysToFull!)])
  : usedSev;
```
Projection slot ALWAYS renders (number or D-14 status copy) — branch on `status`, never on
`daysToFull != null` alone. `stale` status flips the whole row to the stale treatment.

---

### `src/components/host/OnHostNodes.tsx`

**Analog:** `src/components/df/SeverityRow.tsx` — use the NEW columnar props only
(`id`/`note`/`status`/`statusSev`/`href`; `identity`/`evidence`/`kind`/`detail` are
deprecated v1 aliases, SeverityRow.tsx:51-58).

**Row promotion via href** (SeverityRow.tsx:144-151):
```typescript
if (href !== undefined) {
  return (
    <Link href={href} className={rowClass}>
      {content}
    </Link>
  );
}
return <div className={rowClass}>{content}</div>;
```
Compact trim (D-12/UI-SPEC B6): alias · `ImplTag` type · severity · channels · liquidity
ratio · 30d forwards · `FreshnessChip`; no sortable headers (do NOT reuse `NodesTable`).
Evidence figures read from the loaded scorecard dimensions exactly as
`toRow`/`dimOf` do (nodes/page.tsx:50-79) — no new read, no unit math (AFM-002 formatters
at render).

---

### `src/app/(overview)/hosts/page.tsx` (HOST-01 list RSC)

**Analog:** `src/app/(overview)/nodes/page.tsx` — the whole 208-line file is the template.

**Route directives + searchParams whitelist** (nodes/page.tsx:15-16, 127-141):
```typescript
export const dynamic = "force-dynamic";
export const revalidate = 0;
...
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) for (const v of value) usp.append(key, v);
    else if (value !== undefined) usp.append(key, value);
  }
  const facets = parseNodeFacets(usp);
```

**Honest read-only error fallback** (nodes/page.tsx:149-162):
```typescript
  } catch (error) {
    console.error("Nodes list load failed:", error);
    return (
      <main className="py-10">
        <h1 className="text-2xl font-semibold">{"Couldn't load the fleet."}</h1>
        <p className="mt-4 text-base text-foreground/70">
          {"The warehouse reads didn't respond. Your data is unchanged — this view is read-only. Check the connections and reload."}
        </p>
      </main>
    );
  }
```
(Hosts copy per UI-SPEC: "Couldn't load host telemetry." + the read-model line.)

**Shell + kicker + empty-state grammar** (nodes/page.tsx:94-110, 166-207):
```typescript
<NavRailShell active="hosts" title="Hosts" subtitle="Fleet" counts={…}
              pollSinceMs={fetchedAt.getTime()} opsNav={OPS_NAV} showViewToggle={false}>
  <div className="flex flex-col gap-6 pb-16">
    <SectionKicker>HOSTS · {rows.length}</SectionKicker>
    <HostFilters facets={facets} />
    {rows.length === 0 ? <EmptyState heading="No matching hosts." body="Clear the filter to see all declared hosts." /> : …}
```
`NavRailShell` already carries the hosts rail item (NavRailShell.tsx:32:
`{ key: "hosts", href: "/hosts", label: "Hosts", Icon: Server }`) — pass `active="hosts"`,
no shell edit. Do NOT apply `applyFreshnessCutoff` to the list enumeration (D-06:
`getLatestHostMetrics()` is already fleet-shaped via LEFT JOIN — use it unfiltered).

---

### `src/app/(overview)/hosts/[hostId]/page.tsx` (HOST-02 detail RSC)

**Analog:** `src/app/(overview)/[pubkey]/page.tsx` — the whole 313-line file is the template.

**Fail-soft supplementary reads** ([pubkey]/page.tsx:158-165 and overview page.tsx:185-220):
```typescript
const hosts: HostMetricsView[] = await getLatestHostMetrics().catch(() => []);
const serviceArrays = await Promise.all(
  hosts.map((h) => getServiceHealth(h.hostId).catch(() => [] as ServiceHealthState[])),
);
const allServices = serviceArrays.flat();
```

**Segment validation → membership gate, notFound OUTSIDE the try** ([pubkey]/page.tsx:145-146, 215-235):
```typescript
  // ASVS V5 — validate the segment BEFORE any read. Hosts analog (Pitfall 5): no
  // regex exists for hostId — membership-check against the loaded dimension instead:
  //   const host = hostsAll.find((h) => h.hostId === hostId);
  //   if (!host) notFound();   // BEFORE echoing hostId anywhere
  ...
  } catch (error) {
    console.error("Node Detail load failed:", error);
    loadFailed = true;
  }
  if (loadFailed) { return ( /* honest read-only error copy */ ); }
  // notFound() lives OUTSIDE the try so its control-flow signal is never swallowed.
  if (data === null) notFound();
```

**Column + section composition** ([pubkey]/page.tsx:253-311):
```typescript
<NavRailShell active="hosts" title={hostname ?? hostId} subtitle="Host Detail">
  <div className="mx-auto flex max-w-[1180px] flex-col gap-6 pb-16">
    {/* D-10 order: HostHeader → HostIncidentBanner (only when incident) →
        VmVitals/HostVitals → HostInfraServices → StorageVolumes → OnHostNodes */}
```
Reuse `VmVitals` (VmVitals.tsx:36-70 `VmVitalChart` props: `key/label/value/sev/series/
threshold/stale/lastGoodLabel/projection`) fed by the new history reader — it IS the
sibling treatment, honest `StaleChart` branch included (RESEARCH Open Q2 recommendation).
Trio tiles link to `/(overview)/[pubkey]/service/[service]` ONLY where a node-scoped
instance exists via `servicesByNode` (Pitfall 7); otherwise informational, no dead link.

**Ownership wiring** (incidents.ts:154-168 — the shipped convention; synthesize host→node
edges from service pairs, do not read `hosts.node_pubkeys` directly unless fleet data
shows the A1 gap):
```typescript
const nodePubkeysByHost = new Map<string, Set<string>>();
for (const s of services) {
  if (s.nodePubkey !== null) {
    const set = nodePubkeysByHost.get(s.hostId) ?? new Set<string>();
    set.add(s.nodePubkey);
    nodePubkeysByHost.set(s.hostId, set);
  }
}
const ownership = buildOwnershipMap({
  hosts: hosts.map((h) => ({ hostId: h.hostId, nodePubkeys: [...(nodePubkeysByHost.get(h.hostId) ?? [])] })),
  services,
});
```

---

### `src/app/(design)/design-system/page.tsx` MODIFY (ThresholdMeter gallery entry)

**Analog:** the file's own `Section`/`Cell` grammar (page.tsx:68-90):
```typescript
function Section({ name, blurb, children }: { name: string; blurb: string; children: ReactNode }) {
  return (
    <section className="mb-14">
      <header className="mb-5 border-b border-df-border pb-2">
        <h2 className="font-df-mono text-sm font-bold tracking-[0.08em] text-df-ink uppercase">{name}</h2>
        <p className="mt-1 text-[13px] text-df-muted">{blurb}</p>
      </header>
      {children}
    </section>
  );
}
```
Add a `<Section name="ThresholdMeter" …>` with Cells for all severity states + stale +
0%/100% edges. Deterministic fixtures go in `fixtures.ts` (pattern: `FRESHNESS_NOW_ISO`,
page.tsx:60-65). Gallery is greppable by noc-guard — df tokens only.

---

### opsNav MODIFY (overview + nodes pages — Pitfall 8)

**Analog:** the arrays themselves. nodes/page.tsx:24-30:
```typescript
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Ops Center", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];
```
Add `{ key: "hosts", label: "Hosts", href: "/hosts" }` here, in the overview's inline
array (overview page.tsx:484-490), and use the same array on both new hosts pages.
Optionally extract one shared `OPS_NAV` const while touching them (planner's call).

## Shared Patterns

### Severity normalization (apply to ALL health logic)
**Source:** `src/lib/overview/severity-map.ts` + `src/components/df/Severity.ts`
Every severity crosses into the df ramp through `severityFromInsight` /
`severityFromBand` / `severityFromService` / `worstSeverity` — never a raw string
passthrough, never an inline `=== "warn"` chain. Sev→class only via
`severityVariants` / `severityAccent` / `severityText` / `severityLabel`.

### Honest-stale (apply to every card/meter/chart/row)
**Source:** `deriveStale` (host-metrics.ts:136-139), `FreshnessChip`, `StaleChart`,
`VmVitals` stale branch (VmVitals.tsx:92-101). Staleness derived at read time from
`collected_at`, never stored; stale renders the gold shape-distinct treatment
(hatched meter, `StaleChart`, `STALE — last good <t>` chip), never green, never hidden.

### Pure-module discipline (apply to host-rollup, host-filter, storage-projection, host-runbook)
**Source:** node-filter.ts:1, severity-map.ts:1, storage-growth.ts header. First line:
`// Pure module: no server runtime imports, no DB — fixture-testable anywhere.`
Named exports, typed closed vocabularies, vitest beside the module. No component or
route computes health (12-10 lesson).

### Read-layer discipline (apply to host-history)
**Source:** host-metrics.ts. Exported `buildXxxSql(…): SQL` with parameter binding, lazy
`await import("@/lib/db/nodemon")`, `parseDbTimestampUtc` + `Number()` coercion at the
boundary, no-DB `PgDialect().sqlToQuery` shape test.

### Fail-soft reads + honest error copy (apply to both RSC routes)
**Source:** overview page.tsx:185-220 (per-read `.catch` with `console.error` context
label), nodes/page.tsx:149-162 and [pubkey]/page.tsx:215-235 (page-level try/catch →
honest read-only error; `notFound()` outside the try).

### Navy-is-structure (apply to all new components)
**Source:** NodeFilters.tsx chipClass, UI-SPEC Color section. Navy `df-brand` only for
nav/links/active chips/focus; severity ramp only for state. noc-guard + the visual gate
enforce.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/lib/overview/host-runbook.ts` | pure module | copy builder | No runbook-builder exists (`buildExportBlock` is insight-card-keyed). Author fresh against the `CommandModal` `RunbookStep`/`kind:"runbook"` consumer contract (excerpted above); copy is Claude-authored operator prose (RESEARCH A3). |

## Metadata

**Analog search scope:** `src/lib/read/`, `src/lib/overview/`, `src/components/df/`,
`src/components/node/`, `src/app/(overview)/`, `src/app/(design)/design-system/`
**Files read at source this session:** 16 (node-filter, host-metrics + test, telemetry-bands,
storage-growth, severity-map, ownership, incidents §80-190, nodes/page, [pubkey]/page,
overview/page §180-250 + opsNav, NodeFilters, SeverityRow, FreshnessChip, VmVitals,
CommandModal §55-170, TwoAxisPip §25-65, Severity.ts, design-system/page §58-90)
**Pattern extraction date:** 2026-07-13
