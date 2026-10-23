# Phase 3: Per-Node Console + Pending Monitor - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 24 new/modified files (grouped into 16 pattern targets)
**Analogs found:** 15 / 16 (only the CSV Route Handler has no in-repo analog — first `route.ts` in the codebase)

> Mandatory reading for any UI plan: `.claude/skills/frontend-design/SKILL.md` (D-15) and
> `03-UI-SPEC.md` (approved design contract). This document maps *code* analogs; the
> UI-SPEC governs visual decisions.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/read/pending.ts` (NEW) | read module (sanctioned reader) | bounded warehouse read, DISTINCT ON + recency filter | `src/lib/read/latest.ts` | exact |
| `src/lib/read/pending.test.ts` (NEW) | test (no-DB shape) | — | `src/lib/read/latest.test.ts` | exact |
| `src/lib/read/golden-pending.test.ts` (NEW) | test (live golden, skipIf) | live cross-check | `src/lib/read/golden.test.ts` | exact |
| `src/lib/console/config.ts` (NEW) | config (tunables) | — | `src/lib/scorecard/config.ts` | exact |
| `src/lib/console/forwards.ts` (NEW) | read module | windowed event aggregate (ns epoch) | `src/lib/scorecard/dimensions/revenue.ts` | exact |
| `src/lib/console/closes.ts` (NEW) | read module | windowed event aggregate (timestamp col) | `src/lib/scorecard/dimensions/force-close.ts` | exact |
| `src/lib/console/channels.ts` / `fees.ts` / `liquidity.ts` / `peers.ts` (NEW) | read module | latest-state read (AFM-001 wrapper) | `src/lib/read/latest.ts` consumers (`latestChannelsForNode`) — these tabs WRAP the existing reader, never re-query | exact (reuse, not copy) |
| `src/lib/console/*.test.ts` (NEW) | test (no-DB shape) | — | `src/lib/scorecard/dimensions/revenue.test.ts` | exact |
| `src/lib/csv/serialize.ts` (+test) (NEW) | utility | pure transform (RFC-4180) | `src/lib/format/units.ts` (conventions only) + RESEARCH §Pattern 4 | role-match |
| `src/app/(overview)/pending/page.tsx` (NEW) | page (RSC) | request-response, server read | `src/app/(overview)/page.tsx` | exact |
| `src/app/(overview)/[pubkey]/[tab]/page.tsx` (NEW) | page (RSC, dynamic segment) | request-response, validated params | `src/app/(overview)/[pubkey]/page.tsx` | exact |
| `src/app/(overview)/[pubkey]/[tab]/export/route.ts` (NEW) | Route Handler | request-response, file download | **no analog** (validation pattern from `[pubkey]/page.tsx` + RESEARCH §Pattern 4) | partial |
| `src/components/ui/tabs.tsx`, `button.tsx` (NEW, vendored) | ui primitive | — | `src/components/ui/badge.tsx` (vendoring shape: cva + `radix-ui` Slot + `data-slot`) | exact |
| `src/components/console/*` (NEW: ConsoleTabs, WindowPicker, SummaryStrip, CapBanner, EventTable, PendingBoard, ExportButton) | server component | render pre-computed shapes verbatim | `TriageStat`/`FleetRow` in `(overview)/page.tsx`, `DimensionRow.tsx`, `FreshnessStamp.tsx` | role-match per component (mapped below) |
| `src/lib/db/schema/routing.ts` (MODIFY) | schema (read-only) | — | sibling table defs in same file + `withTimezone: true` precedent in `src/lib/db/schema/ldk.ts:70-82` | exact |
| `src/app/(overview)/page.tsx`, `[pubkey]/page.tsx`, `@modal/(.)[pubkey]/page.tsx`, `src/components/scorecard/{GradeBadge,DimensionRow,ScorecardPanel}.tsx` (MODIFY) | page / component edits | — | self (in-place edits per D-12/D-14/redirect) | exact |

## Pattern Assignments

### `src/lib/read/pending.ts` (read module, DISTINCT ON + recency)

**Analog:** `src/lib/read/latest.ts` — copy the whole-file shape: doc banner, exported SQL builder, lazy-import executor.

**Builder + NULL-key guard** (`latest.ts` lines 24-36):
```typescript
export function buildLatestChannelsSql(localPubkey: string): SQL {
  // `chan_id IS NOT NULL` is REQUIRED: DISTINCT ON (chan_id) collapses every
  // NULL-key row into ONE output row — ... (WR-01).
  return sql`
    SELECT DISTINCT ON (chan_id) *
    FROM lnd_node_channel_info
    WHERE local_pubkey = ${localPubkey}
      AND chan_id IS NOT NULL
    ORDER BY chan_id, timestamp DESC
  `;
}
```
For pending: key on `channel_point`, add `updated_at > now() - make_interval(hours => ${recencyHours})`, optional `local_pubkey` scope (fleet vs per-node). Sweeps: identity is **`lnd_pubkey`** (NOT `local_pubkey` — RESEARCH Pitfall 2), no DISTINCT ON needed. RESEARCH §Pattern 2 has the exact verified SQL.

**Lazy executor** (`latest.ts` lines 42-51):
```typescript
export async function latestChannelsForNode(localPubkey: string) {
  // Lazy import keeps the server-only `dbRouting` client (which constructs a
  // postgres() pool + requires env at module load) out of the no-DB shape test's
  // import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildLatestChannelsSql(localPubkey));
  return result as unknown as Record<string, unknown>[];
}
```

**Timestamp coercion in the result mapping** (`force-close.ts` lines 126-129):
```typescript
// WR-01: offset-less string (UTC wall time) — parse as UTC, never host-local.
asOf: parseDbTimestampUtc(row.as_of),
```
Note: the pending tables are the only `timestamptz` tables in routing_vm — `parseDbTimestampUtc` passes explicit-offset strings through correctly, so route through it uniformly anyway (RESEARCH Pitfall 3).

---

### `src/lib/read/pending.test.ts` + `src/lib/console/*.test.ts` (no-DB shape tests)

**Analog:** `src/lib/read/latest.test.ts` — the standard four-assertion shape test. Copy verbatim structure:

**PgDialect render harness** (lines 10-15):
```typescript
const dialect = new PgDialect();
function renderFor(pubkey: string) {
  const built = dialect.sqlToQuery(buildLatestChannelsSql(pubkey));
  return { sql: built.sql.toLowerCase(), params: built.params };
}
```

**The four assertions** (lines 17-42): shape present (`distinct on (...)` / window predicate), ordering, `expect(sql).not.toContain("max(")`, and the SQLi binding check:
```typescript
it("parameter-binds localPubkey ($1), never concatenated into the SQL text", () => {
  const evil = "'; DROP TABLE lnd_node_channel_info; --";
  const { sql, params } = renderFor(evil);
  expect(sql).not.toContain("drop table");
  expect(params).toContain(evil);
  expect(sql).toContain("$1");
});
```
For window builders add the ns-factor assertions from `revenue.test.ts` lines 25-29 (`toContain("timestamp_ns")`, `toContain("1e9")`) and a `LIMIT`/cap presence check. For pending add a recency-predicate + `channel_point is not null` + `distinct on (channel_point)` check.

---

### `src/lib/read/golden-pending.test.ts` (live golden test)

**Analog:** `src/lib/read/golden.test.ts` — copy the scaffold wholesale.

**skipIf gate + lazy db** (lines 8-11, 29, 82):
```typescript
async function routing() {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  return dbRouting;
}
const HAS_DB = !!process.env.ROUTING_VM_DATABASE_URL;
describe.skipIf(!HAS_DB)("... golden ... (live)", () => {
```

**Invariant-not-literal tolerance** (lines 102-103, 112-115):
```typescript
const tol = Math.max(3, Math.ceil(n.activeChannels * 0.03));
expect(Math.abs(n.distinctActiveNotClosed - n.activeChannels)).toBeLessThanOrEqual(tol);
```
Phase 3 invariants (RESEARCH §Golden invariant): per node, currently-pending PENDING_OPEN count ≈ `latestNodeInfo.pending_channels`; Σ limbo over currently-pending FORCE_CLOSE+WAITING_CLOSE ≈ `total_limbo_balance`. Also copy the `console.log("[golden] ...")` surfacing for the operator checkpoint (lines 100-109).

---

### `src/lib/console/config.ts` (central tunables)

**Analog:** `src/lib/scorecard/config.ts` — copy the philosophy banner and flat-const export style.

**Banner + pure-module rule** (lines 3-12):
```typescript
// =====================================================
// D-02 — the SINGLE tuning surface
// =====================================================
// STARTING VALUES, NOT CONTRACT — the operator retunes here as fleet data
// accumulates; computation code ... never embeds thresholds.
// Pure module: NO server-only import — test-imported and safe anywhere.
```

**Flat tunable export style** (lines 147-151):
```typescript
export const COMPARE_CONFIG = { madN: 3, minCohortForMedian: 3 };
/** D-13 staleness threshold — ~6h covers a couple missed channel_info snapshots (~3.7/day). */
export const STALENESS = { warnAfterHours: 6 };
```
Phase 3 contents: `WINDOW_PRESETS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 }` (URL key → bound integer days — never bind a user string into an interval), `DEFAULT_WINDOW = "7d"`, `ROW_CAP = 500`, `PENDING_RECENCY_HOURS = 6`, `TAB_KEYS` whitelist + `TabKey` type, `EXPORTABLE_TABS`.

---

### `src/lib/console/forwards.ts` (windowed event aggregate, ns epoch)

**Analog:** `src/lib/scorecard/dimensions/revenue.ts`

**ns-window predicate + AFM-002 sanctioned division in SQL** (lines 19, 41-54):
```typescript
const SECONDS_PER_DAY = 86400;
// ...
SUM(fee_msat) FILTER (
  WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - 7 * ${SECONDS_PER_DAY}) * 1e9
) / 1000.0 AS earnings_7d_sat,
// ...
FROM lnd_node_forwards
WHERE lnd_pubkey IS NOT NULL
  AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - 7 * ${SECONDS_PER_DAY}) * 1e9
```
Identity column on forwards is `lnd_pubkey`. Bind `${days}` (a config-map integer). Two builders per event tab (RESEARCH §Pattern 3): summary strip (one aggregate row) + capped rows (`ORDER BY timestamp_ns DESC LIMIT ${ROW_CAP}`).

**asOf conversion from ns** (revenue.ts line 77):
```typescript
// timestamp_ns is ns since epoch; Date wants ms → /1e6.
asOf: new Date(Number(row.max_ts_ns) / 1e6),
```

**Typed row interface + Map return** (lines 22-27, 71-81) — declare the `interface XxxRow { ... }` for the raw `.execute()` shape; bigints surface as strings, coerce with `Number()` at the boundary (or keep as strings for CSV raw columns).

---

### `src/lib/console/closes.ts` (windowed event aggregate, timestamp column)

**Analog:** `src/lib/scorecard/dimensions/force-close.ts`

**make_interval window + FILTER aggregates + verified enum literals** (lines 36-49):
```typescript
return sql`
  SELECT
    local_pubkey,
    COUNT(*) FILTER (WHERE close_type = 'LOCAL_FORCE_CLOSE'
      AND timestamp > now() - make_interval(days => ${windowDays})) AS local_fc_window,
    ...
    MAX(timestamp) AS as_of
  FROM lnd_node_closed_channels
  WHERE local_pubkey IS NOT NULL
  GROUP BY local_pubkey
`;
```
Identity column on closes is `local_pubkey`. Closes table is ONE ROW PER CLOSE — no DISTINCT ON (banner, lines 8-10). Verified `close_type` enum is documented in `schema/routing.ts` lines 130-133.

**Parallel multi-query executor** (lines 100-103):
```typescript
const [aggResult, stormResult] = await Promise.all([
  dbRouting.execute(buildForceCloseAggSql(windowDays)),
  dbRouting.execute(buildSelfCloseStormSql()),
]);
```
Same shape for summary-strip + capped-rows + busiest-channel mini-query per event tab.

---

### `src/lib/console/channels.ts` / `fees.ts` / `liquidity.ts` / `peers.ts` (latest-state tabs)

**Analog/reuse:** do NOT write new DISTINCT ON queries — these tabs are renders of `latestChannelsForNode(pubkey)` (`src/lib/read/latest.ts:42`) and `latestNodeInfo*()` (`src/lib/read/node-info.ts`) output (Don't-Hand-Roll table in RESEARCH). The modules here are thin shapers: filter/derive columns from the rows already in hand (e.g. Fees tab = `outgoing_fee_base_msat`/`outgoing_fee_rate_milli_msat` columns of the latest-channels rows; Liquidity = local/remote balance per channel; Peers = distinct `remote_pubkey` of active channels enriched via `peer_info` join per RESEARCH Pitfall 5 — never `COUNT(*)` of `lnd_node_peer_info`).

If a module needs its own SQL (peer-info enrichment join), follow the `latest.ts` builder/executor split and shape-test it.

---

### `src/lib/csv/serialize.ts` (hand-rolled RFC-4180 serializer)

**Analog:** none in-repo (deliberate inversion — supply-chain allowlist forbids CSV libs). Conventions analog: `src/lib/format/units.ts` — single-source-of-truth banner, small named exports:
```typescript
// AFM-002 single source of truth for all sat / BTC / msat math.
// No inline `/ 1e8`, `* 1000`, or raw `fee` is permitted anywhere else ...
export function feeMsatToSat(msat: bigint | number): number { ... }
```
Implementation contract is RESEARCH §Code Examples (`csvCell` with `FORMULA_TRIGGER = /^[=+\-@\t\r]/`, RFC-4180 quote-doubling) — copy it and unit-test per the Validation Architecture map. Formatted columns route through `formatSats`/`feeMsatToSat` (units.ts) and `parseDbTimestampUtc` → ISO-8601 UTC.

---

### `src/app/(overview)/[pubkey]/[tab]/page.tsx` (tabbed console page)

**Analog:** `src/app/(overview)/[pubkey]/page.tsx` — copy the whole page skeleton.

**Force-dynamic directives** (lines 8-10) — required on every new page:
```typescript
// Live warehouse read at request time (Server Component) — never prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;
```

**ASVS V5 gate + Promise params + cache() dedupe** (lines 26-29, 35-54):
```typescript
const PUBKEY_RE = /^[0-9a-f]{66}$/;
/** Per-request dedupe so generateMetadata + page share ONE warehouse read. */
const getFleet = cache(loadFleetView);

interface PageProps {
  params: Promise<{ pubkey: string }>;   // Next 16: params is a Promise
}
// in the page:
const { pubkey } = await params;
// ASVS V5 — validate BEFORE any data access. Invalid shape → 404, no query.
if (!PUBKEY_RE.test(pubkey)) notFound();
const fleet = await getFleet();
const node = fleet.nodes.find((n) => n.pubkey === pubkey);
if (!node) notFound();
```
Add the second gate: `if (!TAB_KEYS.includes(tab as TabKey)) notFound();` (RESEARCH §Pattern 1). `generateMetadata` shape: lines 39-45. Console header reuses the `ScorecardPanel` header composition (`ScorecardPanel.tsx` lines 88-119: alias + `BackendBadge` + pubkey + `GradeBadge size="lg"` + `FreshnessStamp`).

The existing `[pubkey]/page.tsx` itself is MODIFIED to `redirect(\`/${pubkey}/scorecard\`)` after the PUBKEY_RE gate (keep `generateMetadata` or move it to `[tab]`). Tabs MUST be route segments — query params are swallowed by the `(.)[pubkey]` modal interception (RESEARCH Pitfall 7).

---

### `src/app/(overview)/pending/page.tsx` (fleet pending board)

**Analog:** `src/app/(overview)/page.tsx`

**Try/catch error state with the read-only reassurance copy** (lines 157-173):
```typescript
let fleet: FleetView;
try {
  fleet = await loadFleetView();
} catch (error) {
  console.error("Fleet overview load failed:", error);
  return (
    <main className="py-10">
      <h1 className="text-2xl font-semibold">{"Couldn't load fleet health."}</h1>
      <p className="mt-4 text-base text-foreground/70">
        {"The routing warehouse didn't respond. Your data is unchanged — this view is read-only. ..."}
      </p>
    </main>
  );
}
```
(Exact Phase 3 copy strings are locked in `03-UI-SPEC.md` §Copywriting.)

**Page header composition** (lines 184-195): `<main className="flex flex-col gap-6 py-8">`, `text-2xl font-semibold tracking-tight` title, mono `fetched <time>` stamp. Group-by-node sections use the `2xl` (48px) spacing token between node groups (UI-SPEC §Spacing).

Per RESEARCH Pitfall 11: do NOT grow `loadFleetView()` — call a separate `pendingSummary()` in `Promise.all` with it on the overview page.

---

### `src/app/(overview)/[pubkey]/[tab]/export/route.ts` (CSV Route Handler)

**Analog:** NONE — first `route.ts` in this repo. Compose from:
1. The ASVS V5 gate from `[pubkey]/page.tsx` lines 26, 49-50 (PUBKEY_RE before any data access; return `new Response("Not found", { status: 404 })` instead of `notFound()`).
2. RESEARCH §Pattern 4 handler skeleton (GET, `ctx.params` is a Promise, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="..."` with alias sanitized to `[A-Za-z0-9_-]`).
3. Full-window re-query through the same `src/lib/console/*` builders (D-09 — never the capped rows).
4. Provenance `#` rows + formatted/raw columns via `src/lib/csv/serialize.ts`.

---

### `src/components/ui/tabs.tsx` + `button.tsx` (vendored shadcn)

**Analog:** `src/components/ui/badge.tsx` — what a correctly vendored block looks like here:

**Vendoring shape** (lines 1-8, 30-47):
```typescript
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

const badgeVariants = cva("group/badge inline-flex h-5 ...", { variants: { variant: { ... } } })

function Badge({ className, variant = "default", asChild = false, ...props }) {
  const Comp = asChild ? Slot.Root : "span"
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
}
export { Badge, badgeVariants }
```
Vendor via `npx shadcn@latest add tabs button` and commit the source. Executor guard (UI-SPEC, binding): if the CLI adds `shadcn` as a runtime dep or emits `@import "shadcn/tailwind.css"`, inline the CSS into `globals.css` and strip the dep — the Phase 2 precedent. Allowlist: `{class-variance-authority, radix-ui, @radix-ui/*}` only. Radix Tabs is visual chrome only — active tab driven by the URL, tab triggers are `next/link` anchors.

---

### `src/components/console/*` (per-component analog map)

All Server Components rendering pre-computed shapes verbatim (T-02-07 — no color derivation, no unit math, no sorting in JSX).

| New component | Analog | What to copy |
|---|---|---|
| `SummaryStrip` | `TriageStat` + its grid wrapper, `(overview)/page.tsx` lines 51-71 and 199-204 | mono micro-label over `text-2xl tabular-nums` value; `grid ... gap-px overflow-hidden rounded-xl border border-border bg-border` band with `bg-card px-4 py-3` cells |
| `CapBanner` | empty-state block, `(overview)/page.tsx` lines 238-247 | Body-role muted full-width band; copy string locked in UI-SPEC ("Showing newest 500 of {N} — Export CSV for the full window.") |
| `EventTable` | `FleetRow` + column-head header, `(overview)/page.tsx` lines 107-155 and 211-231, plus `src/components/ui/table.tsx` primitives | console-label column heads, `hover:bg-card` rows, `divide-y divide-border`, mono `tabular-nums` numeric cells, `px-3 py-2` cell rhythm (UI-SPEC exception) |
| `PendingBoard` | section grammar of `ScorecardPanel` (lines 122-128 label-over-grid) + `FleetRow` grid-collapse responsive pattern (lines 110-153) | one component parameterized by scope (fleet vs node — CONTEXT discretion, preferred); section heading = console label + count + status-dot per Color table; age = Heading-role mono, unjudged |
| `ConsoleTabs` | the breadcrumb link styling in `[pubkey]/page.tsx` lines 59-64 (`font-mono text-xs font-semibold tracking-[0.14em] ... uppercase`) + vendored `tabs.tsx` visual spec | `next/link` anchors; active = navy indicator + full-strength foreground (UI-SPEC) |
| `WindowPicker` | same link-anchor pattern as ConsoleTabs | four `next/link` anchors writing a query param; selected segment carries navy; NO client component |
| `ExportButton` | vendored `button.tsx` outline variant + `lucide-react` icon usage (BackendBadge/OutlierMarker import style) | plain `<a href={exportUrl} download>` styled as Button; `Download` icon 16px |

**Tooltip composition** (for column-head explainers like lifetime flapcount): `DimensionRow.tsx` lines 33-44 `LabeledTooltip` — `TooltipProvider > Tooltip > TooltipTrigger asChild > TooltipContent`.

---

### `src/lib/db/schema/routing.ts` (MODIFY — type the two pending tables)

**Analog:** sibling table defs in the same file. Copy the per-table doc banner shape (lines 125-134: identity column, row semantics, verified enum values inline) and the column style of `lndNodeClosedChannels` (lines 135-152). Column list is fully specified in RESEARCH §Verified pending-table columns.

**timestamptz precedent** — `src/lib/db/schema/ldk.ts` lines 70-71 (RESEARCH Pitfall 3: these are the only timestamptz tables in routing_vm):
```typescript
createdAt: timestamp("created_at", { withTimezone: true }),
```

**Fix the stub comment** at lines 210-215: `lnd_node_pending_sweeps` identity is `lnd_pubkey`, NOT `local_pubkey` (live-verified, RESEARCH Pitfall 2). Replace the stub block with the two typed tables.

---

### D-14 density pass (MODIFY `GradeBadge.tsx`, `DimensionRow.tsx`, `ScorecardPanel.tsx`, `(overview)/page.tsx`)

These are in-place edits to files mapped above; the change spec is UI-SPEC §Density Revision (prescriptive, six rules). The load-bearing current code:

**`GradeBadge.tsx` lines 36-39 and 52-54** — the pct spans to demote/gate behind an explicit `showPct` (only the composite scorecard header keeps it):
```typescript
{pct !== null && (
  <span className="font-mono text-sm tabular-nums text-foreground/60">{pct}%</span>
)}
```
The component NEVER derives color (line 5 contract) — keep that; only the rendering of `pct` changes.

**`(overview)/page.tsx` line 132** — fleet row currently passes pct; the `%` dies per UI-SPEC rule 4:
```typescript
<GradeBadge size="lg" dot={node.dot} letter={node.compositeLetter} pct={node.compositePct} />
```

**Micro-size sweep:** every `text-[11px]` in `(overview)/page.tsx` (lines 62, 77, 150, 218-228) → `text-xs` (UI-SPEC Typography: one micro size).

**`DimensionRow.tsx` lines 76-108** — tile re-layout to: mono label top-left · dot+letter top-right · raw evidence bottom-left (Heading role); dimension pct moves into the tooltip. Keep the strict state precedence (nodata > partial > peer-relative, lines 53-57 comment) and the separate `CriticalChip` (line 88).

**`@modal/(.)[pubkey]/page.tsx`** gains the "Open full console →" link to `/{pubkey}/scorecard` — style per the affordance pattern in `(overview)/page.tsx` line 150 (`group-hover:text-brand-glow` mono uppercase) inside the existing `ScorecardModal` children (`ScorecardModal.tsx` is a client shell; the link is server-rendered content passed as children, no client change needed).

---

## Shared Patterns

### Builder + lazy-executor split (every new SQL module)
**Source:** `src/lib/read/latest.ts` lines 24-51 (excerpted above)
**Apply to:** `pending.ts`, all `src/lib/console/*.ts` with SQL
Exported `buildXxxSql(): SQL` (testable without DB) + async executor that lazy-imports `@/lib/db/warehouse-routing`. Every builder gets the four-assertion shape test.

### ASVS V5 validation before data access
**Source:** `src/app/(overview)/[pubkey]/page.tsx` lines 26, 49-50
**Apply to:** `[tab]/page.tsx`, `pending/page.tsx` (no params, but window query-param validates against `WINDOW_PRESETS` keys), `export/route.ts`
```typescript
const PUBKEY_RE = /^[0-9a-f]{66}$/;
if (!PUBKEY_RE.test(pubkey)) notFound();   // pages
// route handlers: return new Response("Not found", { status: 404 })
```
Plus tab-key whitelist and window-preset whitelist (URL key → config-map integer).

### AFM-002 unit formatting at the render layer
**Source:** `src/lib/format/units.ts` (whole file, 20 lines) + `ScorecardPanel.tsx` lines 43-70 (`rawDisplayFor` — pre-formatted strings handed to components)
**Apply to:** EventTable cells, SummaryStrip values, PendingBoard balances, CSV formatted columns
Components receive pre-formatted strings; never inline `/1000`, `/1e8`, never the raw `fee` column (grep guard exists). In SQL, the sanctioned form is `SUM(fee_msat)/1000.0`.

### WR-01 timestamp coercion
**Source:** `src/lib/read/db-timestamp.ts` lines 30-40 (`parseDbTimestampUtc`) + usage at `force-close.ts` line 128
**Apply to:** every raw-execute timestamp in pending/console readers and CSV date columns. Never `new Date(rawString)`.

### Freshness stamp per view
**Source:** `src/lib/scorecard/freshness.ts` lines 15-32 (`worstCaseAsOf`, `isStale`) + `src/components/scorecard/FreshnessStamp.tsx` lines 34-76
**Apply to:** every console tab panel header (right-aligned) and both pending surfaces. Compute `MAX(updated_at)`/`MAX(timestamp_ns)` per scope in the read module; render with the existing component; stale shown, never hidden.

### Force-dynamic RSC pages + render-verbatim discipline
**Source:** `(overview)/page.tsx` lines 12-14 (directives) and lines 18-29 banner (T-02-07: no re-sorting, no color re-derivation in JSX)
**Apply to:** all new pages. Pending grouping/sorting happens in `src/lib/read/pending.ts` (or a shaper), never in JSX.

### Console-label typography string
**Source:** `[pubkey]/page.tsx` line 61 (post-sweep canonical form)
```
font-mono text-xs font-semibold tracking-[0.14em] text-foreground/45 uppercase
```
**Apply to:** column heads, tab labels, stat labels, section headings. (Existing `text-[11px]` occurrences get swept to `text-xs` as part of D-14.)

### Central config, no embedded thresholds
**Source:** `src/lib/scorecard/config.ts` lines 3-12 banner, 147-151 exports
**Apply to:** `src/lib/console/config.ts` (WINDOW_PRESETS, ROW_CAP, PENDING_RECENCY_HOURS, TAB_KEYS). Pure module — no server-only import.

### Parallel reads, bounded queries
**Source:** `src/lib/scorecard/fleet.ts` lines 196-202 (`Promise.all` dimension fan-out) and `[pubkey]/page.tsx` line 29 (`cache(loadFleetView)` per-request dedupe)
**Apply to:** `[tab]/page.tsx` (console header via cached `loadFleetView` + tab-specific reads in parallel), overview page (`Promise.all([loadFleetView(), pendingSummary()])` — Pitfall 11: never grow loadFleetView).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/app/(overview)/[pubkey]/[tab]/export/route.ts` | Route Handler | file download (request-response) | Zero `route.ts` files exist in the repo. Compose from the page-level ASVS V5 gate + RESEARCH §Pattern 4 skeleton (verified against the Web Response API). |
| `src/lib/csv/serialize.ts` | utility | pure transform | Deliberate hand-roll (supply-chain allowlist forbids CSV libs). RESEARCH provides the `csvCell` reference implementation; `units.ts` provides the module-convention analog. |

## Metadata

**Analog search scope:** `src/lib/read/`, `src/lib/scorecard/` (+dimensions), `src/lib/db/schema/`, `src/lib/format/`, `src/app/(overview)/**`, `src/components/scorecard/`, `src/components/ui/`
**Files scanned:** 17 read in full (all ≤ 252 lines); full src tree enumerated (45 source files)
**Pattern extraction date:** 2026-06-10
