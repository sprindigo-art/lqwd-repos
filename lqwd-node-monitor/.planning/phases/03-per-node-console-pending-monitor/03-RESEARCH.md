# Phase 3: Per-Node Console + Pending Monitor - Research

**Researched:** 2026-06-10
**Domain:** Next.js App Router tabbed drill-down console over read-only Postgres warehouses; pending-channel monitoring; CSV audit export
**Confidence:** HIGH (every warehouse claim below was verified against the LIVE routing_vm this session; routing behavior verified against current Next.js docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Console layout & navigation
- **D-01:** **Tabbed console at /{pubkey}.** The existing scorecard page becomes the landing tab of a tabbed console: Scorecard | Channels | Fees | Liquidity | Forwards | Closes | Peers (+ Pending, see D-09). The quick-look scorecard modal from the fleet list stays as-is, gaining an "open full console" link.
- **D-02:** **Scorecard tiles deep-link to the relevant console tab** (Liquidity tile → Liquidity tab, force-close tile → Closes, etc.). The scorecard is the index into the evidence: fleet → scorecard → detail tab is the triage flow.
- **D-03:** **Tabs are URL-addressable** (stable URL per tab — route segment or query param at planner's discretion). Bookmarkable/sharable, and Phase 4 insight cards will deep-link straight to evidence views.
- **D-04:** **UI-polish pass covers the whole console shell** — fleet overview, scorecard, and the new tabs in one consistent design pass (the folded Phase-2 polish todo). Not just the new views.

#### Table windows & volume
- **D-05:** **Event-table tabs (Forwards, Closes) default to a 7-day window** — matches the scorecard's revenue/routing windows so console evidence lines up with the grades — and the window is operator-adjustable per view.
- **D-06:** **Window picker = fixed presets: 24h / 7d / 30d / 90d.** No custom range, no all-time — every query stays bounded and predictable (371k-row tables exist; no runaway pulls).
- **D-07:** **Capped + summary rendering** (chosen via mockup comparison): each event table shows the newest ~500 rows beneath an **aggregate summary strip** (count, totals through AFM-002, average, busiest channel — per table type), with a visible banner "showing newest 500 of N — Export CSV for the full window". No pagination, no infinite scroll.

#### CSV export (NODE-02)
- **D-08:** **CSV contains both formatted and raw columns** — human-readable values (sats/dates via AFM-002) alongside the raw source columns (fee_msat, epoch ns) for lossless audit verification.
- **D-09:** **Export scope = the full selected window**, not the visible 500-row cap (the cap banner's escape hatch). Bounded by the 90d preset max.
- **D-10:** **Provenance header block + stamped filename.** Comment rows at the top (# node alias+pubkey, table, window, exported-at UTC, data-as-of freshness) and filenames like `{alias}_{table}_{window}_{timestamp}.csv`. Every sat accounted for, every export traceable.

#### Pending monitor (PENDING-01)
- **D-11:** **Two surfaces: fleet-wide /pending page + a Pending tab in each node console.** The fleet page shows all pending opens/coop-closes/force-closes across the fleet grouped by node; the console tab shows that node's only.
- **D-12:** **Fleet overview entry = a PENDING count block in the existing triage stat strip** (alongside CRITICAL/WARN/HEALTHY/STALE) linking to /pending. Zero-count stays quiet; non-zero is visible exactly where the operator triages.
- **D-13:** **Grouped-by-type, age-sorted presentation:** sections for Opens / Coop closes / Force closes (sweeps nested under their force-close), oldest first within each, every row showing state, age, limbo/time-locked balance, and broadcast_attempts. Age-prominent layout pre-stages Phase 4's stuck-detector without judging. Display-only this phase.

#### UI design direction (operator directive — REVISES Phase 2 D-05)
- **D-14:** **Signal density must come down.** The operator's verdict on the Phase 2 tiles: "letter grade + color + percentage all in one line is overkill." The polish pass (D-04) must simplify to **intuitive, clean, easy to read, aligned items — not over-explained, no redundant encodings** of the same signal. Exact simplification (e.g. color + grade as the primary signal, percentage demoted or dropped, raw value kept as evidence) is design discretion, but the one-line triple+raw encoding must not survive as-is.
- **D-15:** **UI work MUST be driven through the design skills.** The `frontend-design` skill (installed at `.claude/skills/frontend-design/SKILL.md`) is mandatory reading for any agent writing UI in this phase, and the phase should run `/gsd-ui-phase 3` to produce a UI-SPEC design contract before planning the UI plans. Do not design tiles/tables ad-hoc. *(Done — `03-UI-SPEC.md` exists and is approved; it is binding on all UI plans.)*

### Claude's Discretion
- Tab routing mechanism (route segments vs query param) and tab-state preservation details — honor D-03's stable-URL requirement.
- Summary-strip contents per table type (which aggregates matter for channels vs forwards vs closes vs fees) and exact row cap (~500).
- CSV generation mechanics (server endpoint vs client blob), column ordering, and which tabs beyond channels/forwards/closes/fees get an export button.
- Empty states (no pending channels, quiet nodes), loading states, and how the freshness stamp (Phase 2 D-13 pattern) attaches per tab.
- Whether the per-node Pending tab and the fleet /pending page share one component parameterized by scope (preferred if clean).

### Deferred Ideas (OUT OF SCOPE)
- Stuck-pending detector with severity + evidence (force-close past maturity, stuck sweep, stuck open) — **PENDING-02, Phase 4** (the age-sorted display in D-13 pre-stages it)
- Insight-card deep links into console tabs — Phase 4 consumes D-03's stable URLs
- Custom date-range export for arbitrary audit periods — revisit if the 24h/7d/30d/90d presets prove insufficient
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NODE-01 | Operator can drill into one node and view its channels, fee report, liquidity balance, forwards, closes, and peers | §Tab Data-Source Map gives the verified per-tab query source (all 26 nodes — LND **and** LDK — live in routing_vm `lnd_*` tables, fleet.ts confirmed); §Tab Routing settles the D-03 mechanism with a doc-verified interception constraint; existing read helpers (`latestChannelsForNode`, `latestNodeInfo`) cover Channels/Fees/Liquidity/Peers |
| NODE-02 | Operator can export any per-node table (channels, forwards, closes, fees) to CSV | §CSV Export prescribes a server Route Handler + hand-rolled RFC-4180 serializer (supply-chain allowlist forbids CSV libs); export sizing verified live (worst case ≈ 96k rows / 90d forwards); CSV formula-injection mitigation required (peer aliases are attacker-controlled) |
| PENDING-01 | Operator sees all pending channels per node and fleet-wide with state, age, limbo balance, broadcast_attempts from `lnd_node_pending_channels` + `lnd_node_pending_sweeps` | §Pending Tables — full live column introspection (both tables typed below), residue-row semantics discovered and the currently-pending filter verified EXACTLY against `lnd_node_info.pending_channels` / `total_limbo_balance` golden cross-checks; sweep→force-close join verified (`closing_txid = outpoint_txid`, 26/38 joinable, orphans exist) |
</phase_requirements>

## Summary

This phase is pure read-layer + UI on top of a foundation that already exists: the AFM-001 sanctioned readers, the AFM-002 formatter, `loadFleetView()`, the scorecard component kit, and an approved UI-SPEC. No new npm packages are needed — the only "additions" are two vendored shadcn blocks (`tabs`, `button`) under the T-02-SC allowlist. The three genuinely new problems are (1) tab routing that coexists with the existing intercepting-route modal, (2) the semantics of the two untyped pending tables, and (3) safe CSV generation without a CSV library.

All three are settled by this research. **(1)** Tabs MUST be route segments (`/{pubkey}/{tab}`), not query params: the Next.js docs confirm `(.)[pubkey]` intercepts the same-level `[pubkey]` route on soft navigation regardless of query string — query-param tabs would open the modal instead of the console tab, breaking D-02 deep links. Deeper segments are never intercepted. **(2)** Live introspection of `lnd_node_pending_channels` (24 cols) and `lnd_node_pending_sweeps` (17 cols) revealed the critical trap: **rows persist after resolution**. The tables hold 1,790 / 2,019 rows but only ~63 / ~38 are *currently* pending — "current" means `updated_at` within the collector's recent tick window. A 6-hour recency filter reproduces `lnd_node_info.pending_channels` and `total_limbo_balance` **exactly** (verified on Indonesia, Brazil, Australia, Japan this session) — that's the golden invariant for this phase. Also: the sweeps identity column is `lnd_pubkey`, NOT `local_pubkey` as the schema stub comment claims. **(3)** CSV is a server Route Handler writing RFC-4180 text with a small hand-rolled, unit-tested serializer (allowlist forbids papaparse et al.), provenance `#` comment rows, raw values kept as strings (postgres.js already returns bigint as strings — lossless), and formula-injection escaping because Lightning peer aliases are attacker-controlled strings.

**Primary recommendation:** Build a `src/lib/read/pending.ts` + `src/lib/read/console/*.ts` read layer following the established builder/lazy-executor pattern, route tabs as `/{pubkey}/[tab]` segments validated against a whitelist (with `/{pubkey}` redirecting to `/{pubkey}/scorecard`), and gate the pending read behind the verified recency filter with a golden test against `lnd_node_info`.

## Project Constraints (from CLAUDE.md)

Directives extracted from `./CLAUDE.md` — same authority as locked decisions:

- **Tech stack locked:** Next.js App Router + TypeScript + Drizzle (read-only to warehouses) + Tailwind v4 CSS-first `@theme` + shadcn/ui + Recharts 3.x (no charts needed this phase). `@/` imports, named exports, Drizzle-only queries.
- **NEVER run `drizzle-kit push`/`migrate` against the warehouses** — hand-curated read-only schema; live `information_schema` introspection (SELECT-only) is the sanctioned typing path (02-01 pattern).
- **Read-only enforced at the DB role** (`grafana_demo_ro`-style) — the dashboard holds zero node credentials; this phase has NO write path.
- **Security:** Grade-A scan before production deploy; no CRITICAL/HIGH findings. Parameter-bound SQL everywhere.
- **Brand:** LQWD navy `#1A3C79` chrome-only — never a health signal; no `#F7931A`. Dark theme default.
- **Process:** No co-authored-by trailers; branch-per-task; worktree-parallel plan execution with files_modified isolation.
- **Deploy:** env-var DB URLs only — no `localhost` literals; local→VM flip is config-only.
- **GSD workflow:** all edits through GSD commands.
- Conventions: Prettier (2-space, double quotes, printWidth 100), functions < 30 lines, options-objects over positional args, early returns, named exports, interfaces for props.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tab navigation / URL state | Frontend Server (RSC routing) | Browser (link clicks) | D-03: URL is the source of truth; no client tab state. Route segments, server-rendered active styling |
| Per-tab warehouse reads | API/Backend (RSC server fns in `src/lib/read/`, `src/lib/console/`) | — | All queries server-only, parameter-bound, bounded windows (T-02-05 discipline) |
| Pending currently-vs-residue filtering | API/Backend (SQL, recency predicate) | — | Semantics live in the sanctioned reader, never re-derived in JSX (T-02-07 analog) |
| CSV generation | API/Backend (Route Handler) | Browser (download via Content-Disposition) | Server endpoint: full-window data never ships to the client twice; provenance stamped server-side at query time |
| Unit formatting (sats/BTC/dates) | Frontend Server (render layer via AFM-002) | — | Components receive pre-formatted strings; raw stays raw in models |
| Freshness computation | API/Backend (`MAX(updated_at)`/`MAX(timestamp)` per scope) | Frontend Server (FreshnessStamp render) | Existing D-13 pattern: stamp per view, stale flagged never hidden |
| Grade-density simplification (D-14) | Frontend Server (presentational components) | — | Pure component changes (GradeBadge/DimensionRow/FleetRow); zero data-layer impact |

## Standard Stack

### Core (all already installed — verified against `package.json` this session)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.1.6 (pinned) | Tabbed console routes, /pending page, CSV Route Handler | Locked stack; matches lqwdclaw `[VERIFIED: package.json]` |
| react / react-dom | 19.2.3 | UI runtime | Locked `[VERIFIED: package.json]` |
| drizzle-orm | ^0.45.1 | `sql` template builders + typed pending tables | Locked; builder/executor split is the established phase pattern `[VERIFIED: package.json]` |
| postgres (driver, devDep at runtime via drizzle clients) | ^3.4.8 | Warehouse reads | Locked `[VERIFIED: package.json]` |
| radix-ui | ^1.5.0 | Primitives behind vendored shadcn `tabs`/`button` | Already installed; T-02-SC allowlist member `[VERIFIED: package.json]` |
| tailwindcss / @tailwindcss/postcss | ^4 | Styling | Locked `[VERIFIED: package.json]` |
| lucide-react | ^0.577.0 | `Download` icon for Export CSV | Already installed `[VERIFIED: package.json]` |
| vitest | ^4 | No-DB shape tests, CSV serializer tests, golden pending test | Already configured (`vitest.config.ts` with `@/` alias + server-only stub) `[VERIFIED: vitest.config.ts]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn CLI (`npx shadcn@latest add tabs button`) | vendors source only | Tab chrome + Export button | UI-SPEC mandates these two blocks from the OFFICIAL registry only; vendored into `src/components/ui/` like Phase 2's card/table/badge `[CITED: 03-UI-SPEC.md §Design System]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Route-segment tabs `/{pubkey}/[tab]` | Query-param tabs `/{pubkey}?tab=` | **Query params are swallowed by the `(.)[pubkey]` modal interception on soft nav** (verified against Next docs — interception matches route segments; query string is irrelevant to matching). D-02 tile deep links would open the modal, not the tab. Route segments are the only mechanism that satisfies both D-01 (modal stays) and D-02/D-03 |
| Single `[tab]` dynamic segment + whitelist | 8 literal segment folders | 8 folders duplicate page scaffolding; one `[tab]` page with a `TAB_KEYS` whitelist + `notFound()` is less code and equally type-safe. Use folders only if per-tab `generateMetadata` divergence gets messy |
| Server Route Handler CSV | Client-side blob from rendered rows | Client only has the capped 500 rows — D-09 requires the FULL window. Server endpoint re-queries the window and stamps provenance at query time |
| Hand-rolled RFC-4180 serializer (~30 lines, unit-tested) | papaparse / csv-stringify | **Forbidden** — T-02-SC supply-chain allowlist is `{class-variance-authority, radix-ui, @radix-ui/*}` only. The serializer is small enough to own with tests |
| Buffered CSV response | postgres.js `.cursor()` streaming | Worst verified export ≈ 96k rows × ~15 cols ≈ 15–25 MB string — acceptable for a single-operator local/VM tool. Streaming adds cursor lifecycle complexity; revisit only if memory becomes real |

**Installation:** none. `npx shadcn@latest add tabs button` vendors source (commit CLI output; inline any `@import "shadcn/tailwind.css"` into globals.css and strip any `shadcn` runtime dep, exactly as Phase 2 did).

## Package Legitimacy Audit

**No new npm packages are installed this phase.** The shadcn CLI vendors component *source files* into `src/components/ui/`; their only runtime dependency (`radix-ui`) is already installed and on the T-02-SC allowlist. slopcheck not run — nothing to check.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Executor guard (from UI-SPEC, binding):** if `shadcn add` attempts to add `shadcn` as a runtime dependency or emit `@import "shadcn/tailwind.css"`, inline the CSS into `globals.css` and remove the dependency — the Phase 2 precedent.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────────────────────────────────┐
                         │                  Browser (operator)                  │
                         └───────┬──────────────────────────┬───────────────────┘
                  soft nav /{pk} │            /{pk}/{tab}, /pending, export click
                                 ▼                          ▼
              ┌──────────────────────────┐   ┌─────────────────────────────────────┐
              │ @modal/(.)[pubkey]       │   │ RSC pages (force-dynamic)           │
              │ ScorecardModal (existing)│   │  /(overview)/page.tsx  + PENDING    │
              │ + "Open full console →"  │   │  /(overview)/pending/page.tsx       │
              │   → /{pk}/scorecard      │   │  /(overview)/[pubkey]/page.tsx      │
              └──────────────────────────┘   │     → redirect /{pk}/scorecard      │
                                             │  /(overview)/[pubkey]/[tab]/page.tsx│
                                             │     (validates pk regex + tab key)  │
                                             └────────┬──────────────────┬─────────┘
                                                      │                  │
                                                      ▼                  ▼
   ┌──────────────────────────────┐   ┌────────────────────────┐  ┌─────────────────────────────┐
   │ Route Handler (CSV export)   │   │ Console read layer     │  │ Existing scorecard layer    │
   │ /[pubkey]/[tab]/export/route │──▶│ src/lib/console/*.ts   │  │ loadFleetView() (cache()'d) │
   │ validates pk+tab+window,     │   │  - windowed event reads│  │ → header grade + Scorecard  │
   │ full-window query, RFC4180 + │   │  - summary aggregates  │  │   tab content               │
   │ provenance + formula-escape  │   │ src/lib/read/pending.ts│  └──────────┬──────────────────┘
   └──────────────┬───────────────┘   │  - currently-pending   │             │
                  │                   │    recency filter      │             │
                  │                   │  - sweep→FC join       │             │
                  │                   └──────────┬─────────────┘             │
                  ▼                              ▼                           ▼
        ┌─────────────────────────────────────────────────────────────────────────┐
        │ routing_vm (read-only role) — lnd_node_info, lnd_node_channel_info,     │
        │ lnd_node_forwards, lnd_node_closed_channels, lnd_node_peer_info,        │
        │ lnd_node_pending_channels (NEW typed), lnd_node_pending_sweeps (NEW)    │
        │ — ALL 26 nodes (LND and LDK) live here; ldk-lspd-main not needed        │
        └─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── app/(overview)/
│   ├── page.tsx                          # MODIFY: + PENDING TriageStat block (D-12), D-14 density pass
│   ├── pending/page.tsx                  # NEW: fleet-wide pending board (static segment wins over [pubkey])
│   ├── [pubkey]/
│   │   ├── page.tsx                      # MODIFY: redirect(`/${pubkey}/scorecard`) after validation
│   │   ├── [tab]/page.tsx                # NEW: validated tab param → console header + tab bar + panel
│   │   └── [tab]/export/route.ts         # NEW: CSV Route Handler (GET)
│   └── @modal/(.)[pubkey]/page.tsx       # MODIFY: add "Open full console →" link to /{pk}/scorecard
├── components/
│   ├── console/                          # NEW: ConsoleTabs (links), WindowPicker (links), SummaryStrip,
│   │   ...                               #      CapBanner, EventTable, PendingBoard, ExportButton
│   └── scorecard/                        # MODIFY: GradeBadge (D-14 dot+letter), DimensionRow (tile simplify)
├── lib/
│   ├── console/                          # NEW: per-tab read modules (builder + lazy executor pattern)
│   │   ├── config.ts                     # WINDOW_PRESETS {24h,7d,30d,90d}, DEFAULT_WINDOW, ROW_CAP=500,
│   │   │                                 # PENDING_RECENCY_HOURS — central-config philosophy (Phase 2 D-02)
│   │   ├── forwards.ts / closes.ts / fees.ts / liquidity.ts / channels.ts / peers.ts
│   │   └── *.test.ts                     # no-DB shape tests per builder
│   ├── read/pending.ts (+ .test.ts)      # NEW: sanctioned currently-pending reader (recency + DISTINCT ON)
│   ├── csv/serialize.ts (+ .test.ts)     # NEW: RFC-4180 + formula-escape + provenance header
│   └── db/schema/routing.ts              # MODIFY: type the two pending tables (introspection below)
```

### Pattern 1: Tab routing — segments + redirect, modal untouched

**What:** `/{pubkey}` keeps its `(.)[pubkey]` modal interception for fleet-row clicks. The full page at `[pubkey]/page.tsx` becomes `redirect(\`/${pubkey}/scorecard\`)` (after the existing PUBKEY_RE gate). All eight tabs live at `/{pubkey}/{tab}` via one `[tab]` dynamic segment validated against a whitelist.
**Why it works (verified):** Next.js interception matches **route segments** — `(.)` matches *the same level* only; `/{pubkey}/channels` is a deeper route and is never intercepted; interception fires on soft navigation only; query strings don't change matching `[CITED: nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes]`. Static `/pending` wins over dynamic `[pubkey]` by Next's static-over-dynamic precedence (and `PUBKEY_RE` would 404 "pending" anyway) `[ASSUMED — standard App Router precedence, low risk]`.
**Consequences:**
- Fleet row → `/{pubkey}` soft nav → modal (unchanged).
- Modal "Open full console →" → `/{pubkey}/scorecard` → full console (not intercepted — different segment).
- Scorecard tiles deep-link `/{pubkey}/liquidity` etc. (D-02) — never intercepted.
- Phase 4 cards get stable URLs (D-03).
- Hard load of `/{pubkey}` redirects to the scorecard tab — one canonical URL per view.

```typescript
// Source: pattern composed from existing [pubkey]/page.tsx + verified interception semantics
const TAB_KEYS = ["scorecard","channels","fees","liquidity","forwards","closes","peers","pending"] as const;
export type TabKey = (typeof TAB_KEYS)[number];

// [tab]/page.tsx
const { pubkey, tab } = await params;             // Next 16: params is a Promise
if (!PUBKEY_RE.test(pubkey)) notFound();          // ASVS V5 — before any data access
if (!TAB_KEYS.includes(tab as TabKey)) notFound();
```

Render header + tab bar + panel in the page (not a `[pubkey]/layout.tsx`): each tab nav is a fresh request anyway, `cache(loadFleetView)` dedupes within the request, and the active tab is known synchronously from `params` — no client component, no `useSelectedLayoutSegment`. Tab bar = `next/link` anchors styled to the vendored `tabs` visual spec (UI-SPEC: "Radix Tabs is visual chrome only; URL is the source of truth").

### Pattern 2: The sanctioned currently-pending read (the heart of PENDING-01)

**What:** `src/lib/read/pending.ts` following the exact builder/lazy-executor shape of `latest.ts`. The non-obvious part is the **recency predicate** — see Pitfall 1.

```sql
-- Source: verified live against routing_vm 2026-06-10 (reproduced node_info cross-checks exactly)
-- Currently-pending channels (fleet-wide; add AND local_pubkey = $1 for per-node scope)
SELECT DISTINCT ON (channel_point) *
FROM lnd_node_pending_channels
WHERE channel_point IS NOT NULL                     -- WR-01 NULL-key guard
  AND updated_at > now() - make_interval(hours => ${PENDING_RECENCY_HOURS})
ORDER BY channel_point, updated_at DESC
```
```sql
-- Currently-pending sweeps (identity column is lnd_pubkey — NOT local_pubkey)
SELECT * FROM lnd_node_pending_sweeps
WHERE updated_at > now() - make_interval(hours => ${PENDING_RECENCY_HOURS})
```

- `DISTINCT ON (channel_point)` is required: 1,790 rows / 1,648 distinct channel_points (a channel that re-entered pending gets a second row). Sweeps need no DISTINCT ON (2,019 rows = 2,019 distinct outpoints — verified upsert-per-outpoint).
- `PENDING_RECENCY_HOURS = 6` as the starting tunable (lives in console config next to `STALENESS.warnAfterHours = 6` — same philosophy). At 6h the live data matched `lnd_node_info` exactly.
- Group rows by `channel_state ∈ {PENDING_OPEN, WAITING_CLOSE, FORCE_CLOSE}` (the complete verified enum). Sort `created_at` ASC within group (oldest first, D-13). Age = `now − created_at`.
- Sweep nesting: `LEFT JOIN`-style match `pending.closing_txid = sweep.outpoint_txid` — verified 26 of 38 current sweeps join to a current force-close. **12 orphans exist** (anchor outputs / sweeps whose close already left pending) — render them in a quiet "unattached sweeps" group per node, never drop them (every sat accounted for).
- Per-view freshness: `MAX(updated_at)` over the scoped rows → existing `FreshnessStamp` + `isStale`.

### Pattern 3: Windowed event reads — aggregate strip + capped rows (D-05/D-06/D-07)

Two queries per event tab, both bounded by the validated preset:

```sql
-- Source: window math verified in Phase 2 revenue.ts (ns epoch) + live this session
-- Forwards summary strip (one row)
SELECT COUNT(*)::int AS n,
       SUM(amt_out)        AS total_amt_out_sat,
       SUM(fee_msat)/1000.0 AS total_fees_sat,        -- AFM-002 sanctioned form
       AVG(fee_msat)/1000.0 AS avg_fee_sat,
       MAX(timestamp_ns)   AS max_ts_ns
FROM lnd_node_forwards
WHERE lnd_pubkey = ${pubkey}
  AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days} * 86400) * 1e9   -- NANOSECONDS

-- Capped newest rows
SELECT * FROM lnd_node_forwards
WHERE lnd_pubkey = ${pubkey}
  AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days} * 86400) * 1e9
ORDER BY timestamp_ns DESC
LIMIT ${ROW_CAP}
```

Closes use the `timestamp` column: `timestamp > now() - make_interval(days => ${days})`. Window presets map to bound integer days `{24h:1, 7d:7, 30d:30, 90d:90}` — the preset *key* comes from the URL, the *days* value from the config map; never bind a user string into an interval. "Busiest channel" for the strip = a `GROUP BY chan_id_out ORDER BY COUNT(*) DESC LIMIT 1` third mini-query or window-function CTE — planner discretion.

Static tabs (Channels, Liquidity, Fees, Peers) are AFM-001 latest-state reads via the EXISTING `latestChannelsForNode(pubkey)` — no window picker (a window is meaningless for current state).

### Pattern 4: CSV Route Handler (NODE-02)

```typescript
// Source: standard Web Response API; pattern composed for this repo
// src/app/(overview)/[pubkey]/[tab]/export/route.ts
export async function GET(req: Request, ctx: { params: Promise<{ pubkey: string; tab: string }> }) {
  const { pubkey, tab } = await ctx.params;
  if (!PUBKEY_RE.test(pubkey)) return new Response("Not found", { status: 404 });
  // validate tab ∈ EXPORTABLE_TABS, window ∈ WINDOW_PRESETS (searchParams)
  const csv = buildCsv(/* provenance + header + rows */);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}"`,
    },
  });
}
```

- **Raw columns stay strings:** Drizzle's raw `.execute()` over postgres.js surfaces `bigint` columns as strings — write them verbatim into the raw CSV columns (lossless, D-08). Formatted columns go through AFM-002 (`formatSats`, `feeMsatToSat`) and `parseDbTimestampUtc` → ISO-8601 UTC for dates.
- **Provenance block (D-10):** `#`-prefixed comment rows (node alias+pubkey, table, window, exported-at UTC, data-as-of = the view's freshness stamp) before the header row.
- **Filename (D-10):** `{alias}_{table}_{window}_{timestamp}.csv` — sanitize alias to `[A-Za-z0-9_-]` (aliases are free text) before it enters the filename or the `Content-Disposition` header (header-injection guard).
- **Formula-injection escape (security — see Pitfall 8):** any cell starting with `=`, `+`, `-`, `@`, tab, or CR gets a leading `'` *in formatted text columns only* (peer aliases!); raw numeric/hex columns are pattern-constrained and stay verbatim for lossless audit.
- The Export button is a plain `<a href={exportUrl} download>` styled as the UI-SPEC outline Button — no client JS needed for v1; busy/failure states per UI-SPEC if a client wrapper is added (planner discretion).

### Pattern 5: D-14 density pass (prescriptive — from approved UI-SPEC)

Component-only changes, zero data-layer impact:
- `GradeBadge`: render `dot + letter` only; `pct` renders ONLY when an explicit `showPct` (composite scorecard header) — fleet rows and dimension tiles drop it.
- `DimensionRow` tile = mono label (top-left) · dot+letter (top-right) · raw evidence (bottom-left, Heading role); dimension pct moves into the tooltip.
- Fleet row: grade column = dot+letter, right-aligned; `%` column dies.
- Sweep all `text-[11px]` → `text-xs` (one micro size).
- Reason subtext, critical chips, outlier marker, stale marker all SURVIVE (each carries non-redundant information).

### Anti-Patterns to Avoid
- **Bare select on pending tables** — 1,790/2,019 rows of mostly-resolved residue; always the recency filter (Pitfall 1).
- **Query-param tabs** — swallowed by modal interception (verified).
- **`COUNT(*)` of `lnd_node_peer_info` as "current peers"** — lifetime log (Pitfall 5).
- **Re-deriving grade colors / pending grouping in JSX** — T-02-07 discipline: views render pre-computed shapes verbatim.
- **Inline `/1000`, `/1e8`, raw `fee` column** — AFM-002 grep guard will catch it; route everything through `units.ts`.
- **`new Date(rawString)` on raw-execute timestamps** — host-TZ shift (WR-01); always `parseDbTimestampUtc`.
- **Red/yellow age judgment on pending rows** — D-13: display-only; the stuck detector is Phase 4. Section markers only (FC section = critical red marker per UI-SPEC Color).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest channel state | New DISTINCT ON query in a tab module | `latestChannelsForNode()` (`src/lib/read/latest.ts`) | The one sanctioned AFM-001 path; Channels/Fees/Liquidity tabs are renders of its output |
| Latest node info | Bare `lnd_node_info` select | `latestNodeInfo*()` (`src/lib/read/node-info.ts`) | Table is append-only, 8.05M rows |
| Sat/BTC/msat math | Inline conversion | `feeMsatToSat`/`formatSats`/`formatBtc` (AFM-002) | Grep guard + single tested path |
| Timestamp coercion | `new Date(s)` | `parseDbTimestampUtc` | WR-01: offset-less warehouse strings are UTC |
| Freshness/staleness | New stale math | `worstCaseAsOf`/`isStale` + `FreshnessStamp` | Existing D-13 pattern, tunable threshold |
| Fleet/scorecard assembly | New per-node queries for the console header | `cache(loadFleetView)` | Header needs composite grade + freshness — already computed, deduped per request |
| Tab visual chrome | Custom tab CSS | vendored shadcn `tabs` styling over `next/link` anchors | UI-SPEC contract |
| Backend branching | Per-backend tab components | `UnifiedNode`/`backendFor()` + shared components | D-10 (Phase 1): app never branches on backend; all 26 nodes' data lives in routing_vm `lnd_*` tables anyway (verified in fleet.ts) |

**Inversion this phase:** the CSV serializer MUST be hand-rolled (supply-chain allowlist) — own it as a ~30-line, fully unit-tested `src/lib/csv/serialize.ts` (RFC-4180 quoting: wrap fields containing `"`, `,`, `\n` in quotes; double internal quotes; plus the formula-escape rule). This is the deliberate, tested exception, not ad-hoc string concat scattered across routes.

## Common Pitfalls

### Pitfall 1: Pending tables retain resolved rows (THE landmine of this phase)
**What goes wrong:** A naive read shows 1,790 "pending channels" / 2,019 "pending sweeps" — months of resolved residue presented as live (e.g. Canada force-closes last updated 2026-02-06, `blocks_til_maturity: -29,639`).
**Why it happens:** The collector upserts rows per tick while an item is pending; when it resolves, the row simply stops being updated — it is never deleted. `[VERIFIED: live probe 2026-06-10 — recency buckets: FORCE_CLOSE 39/664 updated <6h, PENDING_OPEN 12/657, WAITING_CLOSE 12/469]`
**How to avoid:** Currently-pending = `updated_at > now() - 6h` (tunable). Verified exact against the independent snapshot: Indonesia PENDING_OPEN count 12 == `node_info.pending_channels` 12; Brazil FC limbo 70,621,359 + WAITING 16,570,308 = 87,191,667 == `node_info.total_limbo_balance` exactly (also exact: Australia, Japan, Sweden, HongKong, Italy, Ireland, Canada).
**Warning signs:** pending counts wildly above `lnd_node_info.pending_channels`; rows with negative `blocks_til_maturity` and months-old `updated_at`. **Encode the cross-check as this phase's golden live test.**

### Pitfall 2: Sweeps identity column is `lnd_pubkey`, not `local_pubkey`
**What goes wrong:** The schema stub comment in `routing.ts` (and 03-CONTEXT canonical refs) says both pending tables key on `local_pubkey`. Live introspection: `lnd_node_pending_channels` → `local_pubkey`; `lnd_node_pending_sweeps` → **`lnd_pubkey`** (same split as forwards vs closed_channels). `[VERIFIED: information_schema introspection 2026-06-10]`
**How to avoid:** Type from the introspection table below, not the stub. Fix the stub comment in the schema plan.

### Pitfall 3: Pending tables are `timestamp WITH time zone` — the only timestamptz tables in routing_vm
**What goes wrong:** Copying the `timestamp("created_at")` Drizzle column form from other tables loses the tz flag; conversely assuming WR-01's offset-less-string problem applies here and "fixing" already-offset strings.
**How to avoid:** `timestamp("created_at", { withTimezone: true })` (the `lsps1_orders` LDK table is the in-repo precedent). Raw-execute strings for these columns carry an explicit offset — `parseDbTimestampUtc` handles both shapes correctly (it passes explicit-offset strings through), so still route through it uniformly.

### Pitfall 4: `DISTINCT ON (channel_point)` needed for pending_channels — with the NULL-key guard
**What goes wrong:** 142 duplicate channel_points exist (re-entered pending); without DISTINCT ON, rows double-count limbo. Without `channel_point IS NOT NULL`, DISTINCT ON collapses all NULL-key rows to one (the WR-01 failure shape).
**How to avoid:** Copy the `latest.ts` guard pattern verbatim; order by `channel_point, updated_at DESC`.

### Pitfall 5: The Peers tab cannot show "current peers" from `lnd_node_peer_info`
**What goes wrong:** The table is a lifetime log — Canada: 22,872 rows, `num_peers` 1,290, but only **1** row has `timestamp` within 6h (timestamps are insert-time, not refreshed). Neither recency nor COUNT(*) yields current peers. `[VERIFIED: live probe 2026-06-10]`
**How to avoid:** Define the Peers tab as **channel counterparties**: distinct `remote_pubkey` from `latestChannelsForNode` (active channels), enriched by joining `peer_info` for alias/flapcount/total_capacity metadata; headline stat = `num_peers` from `latestNodeInfo` with honest labeling ("{num_peers} connected peers · showing {n} channel partners"). Flag flapcount as lifetime-cumulative in its column tooltip.

### Pitfall 6: Forwards windows are NANOSECONDS
**What goes wrong:** A window in seconds/ms selects nothing or everything. Established Phase 2 pitfall — repeats here because every Forwards query (summary, capped rows, CSV) re-states the window.
**How to avoid:** `timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days} * 86400) * 1e9`; `asOf` from `max_ts_ns / 1e6 → Date`. Add the `not.toContain("max(")` + ns-factor shape assertions to every new builder test.

### Pitfall 7: Modal interception vs tab URLs
**What goes wrong:** Query-param tabs (`/{pubkey}?tab=channels`) get intercepted on soft nav → modal opens instead of the console tab; "Open full console" linking to `/{pubkey}` is a no-op (already that URL while the modal is open).
**How to avoid:** Route segments (Pattern 1). `[CITED: nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes — "(.) to match segments on the same level"; interception on soft navigation only]`

### Pitfall 8: CSV formula injection via peer aliases (and alias header injection)
**What goes wrong:** Lightning node aliases are arbitrary attacker-controlled strings broadcast on the public network; they land in forwards (`peer_alias_in/out`), peers, closes exports. An alias like `=HYPERLINK(...)` executes when the operator opens the audit CSV in Excel/Sheets. Aliases in the `Content-Disposition` filename can inject header characters.
**How to avoid:** Formula-escape text cells (leading `'` when first char ∈ `= + - @ \t \r`); sanitize alias to `[A-Za-z0-9_-]` for filenames; unit-test both. This satisfies the Grade-A scan posture (HARDEN-01 is later, but findings created now resurface then).

### Pitfall 9: BigInt leaks across the RSC boundary
**What goes wrong:** Drizzle select-builder reads with `{ mode: "bigint" }` columns produce JS `BigInt`, which throws on serialization to Client Components and in `JSON.stringify`.
**How to avoid:** All tab tables are server-rendered (no client components receive rows). Where a raw value must cross (e.g. future chart wrappers), convert via `Number()`/AFM-002 at the read layer. Raw `.execute()` returns strings for bigints — preferred for CSV (lossless).

### Pitfall 10: WAITING_CLOSE is not strictly "coop close"
**What goes wrong:** Labeling the WAITING_CLOSE section "Coop closes" implies cooperation; LND's `waiting_close_channels` covers any channel whose closing tx is unconfirmed (usually coop, occasionally pre-confirmation force-close). `[ASSUMED — LND pendingchannels RPC semantics from training; warehouse enum verified, mapping nuance not]`
**How to avoid:** Keep the UI-SPEC section labels (locked copywriting) but render the verbatim `channel_state` in each row's state cell — the operator sees the source truth. Note for Phase 4's detector.

### Pitfall 11: Don't grow `loadFleetView()` for pending
**What goes wrong:** Bolting the pending count into the fleet assembly adds a 6th query to every scorecard/modal render that doesn't need it.
**How to avoid:** Separate `pendingSummary()` read; the overview page calls it in `Promise.all` with `loadFleetView()`. The PENDING TriageStat lights warn-yellow only when count > 0 (D-12; existing zero-quiet discipline).

## Code Examples

### Verified pending-table columns (type these — live `information_schema`, 2026-06-10)

```
lnd_node_pending_channels                       lnd_node_pending_sweeps
  id                        bigint                id                         bigint
  local_pubkey              text   ← identity     lnd_alias                  text
  lnd_alias                 text                  lnd_pubkey                 text   ← identity (NOT local_pubkey)
  channel_point             text   ← DISTINCT ON  outpoint_txid              text   ← joins pending.closing_txid
  remote_node_pub           text                  outpoint_output_index      integer
  capacity                  bigint                witness_type               integer
  local_balance             bigint                amount_sat                 integer
  remote_balance            bigint                sat_per_byte               integer
  local_chan_reserve_sat    bigint                requested_sat_per_byte     integer
  remote_chan_reserve_sat   bigint                sat_per_vbyte              bigint
  initiator                 text                  requested_sat_per_vbyte    bigint
  commitment_type           text                  broadcast_attempts         integer  ← PENDING-01 field
  num_forwarding_packages   integer               next_broadcast_height      integer
  chan_status_flags         text                  requested_conf_target      integer
  channel_state             text  ← PENDING_OPEN | WAITING_CLOSE | FORCE_CLOSE (complete verified enum)
  closing                   boolean               force                      boolean
  limbo_balance             bigint                created_at                 timestamptz
  closing_txid              text                  updated_at                 timestamptz
  maturity_height           integer
  blocks_til_maturity       integer             (sweeps: 2,019 rows = 2,019 distinct outpoints — no DISTINCT ON needed)
  recovered_balance         bigint
  anchor_state              text
  created_at                timestamptz   ← age anchor (first observed)
  updated_at                timestamptz   ← recency filter + per-tick upsert
```

### Golden invariant for the pending reader (live-verified values)

```typescript
// Source: live cross-check 2026-06-10 — encode as golden-pending.test.ts (skipIf no DB)
// 1. Per node: COUNT of currently-pending PENDING_OPEN rows == latestNodeInfo.pending_channels
//    (Indonesia: 12 == 12)
// 2. Per node: SUM(limbo_balance) over currently-pending FORCE_CLOSE + WAITING_CLOSE rows
//    == latestNodeInfo.total_limbo_balance
//    (Brazil: 70_621_359 + 16_570_308 == 87_191_667; Australia 74_602_049; Japan 19_118_508)
// Use invariant-not-literal tolerance (snapshot ticks differ by minutes): small absolute/percent slack,
// following golden.test.ts's tol = Math.max(3, ceil(n * 0.03)) precedent.
```

### Sanctioned reader skeleton (copy `latest.ts` shape)

```typescript
// Source: src/lib/read/latest.ts pattern (in-repo, verified) — new file src/lib/read/pending.ts
import { sql, type SQL } from "drizzle-orm";

export function buildCurrentPendingChannelsSql(recencyHours: number, localPubkey?: string): SQL {
  // channel_point IS NOT NULL: WR-01 NULL-key guard (DISTINCT ON collapses NULL keys to one row)
  return localPubkey === undefined
    ? sql`SELECT DISTINCT ON (channel_point) * FROM lnd_node_pending_channels
          WHERE channel_point IS NOT NULL
            AND updated_at > now() - make_interval(hours => ${recencyHours})
          ORDER BY channel_point, updated_at DESC`
    : sql`SELECT DISTINCT ON (channel_point) * FROM lnd_node_pending_channels
          WHERE channel_point IS NOT NULL
            AND local_pubkey = ${localPubkey}
            AND updated_at > now() - make_interval(hours => ${recencyHours})
          ORDER BY channel_point, updated_at DESC`;
}

export async function currentPendingChannels(recencyHours: number, localPubkey?: string) {
  const { dbRouting } = await import("@/lib/db/warehouse-routing"); // lazy — no-DB tests stay pure
  return (await dbRouting.execute(buildCurrentPendingChannelsSql(recencyHours, localPubkey)))
    as unknown as Record<string, unknown>[];
}
```

Pair with the standard four-assertion shape test (DISTINCT ON present, NULL guard present, no `max(`, SQLi payload lands in params).

### RFC-4180 cell serializer with formula escape

```typescript
// Source: RFC 4180 rules + OWASP CSV-injection guidance — hand-rolled per T-02-SC allowlist
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export function csvCell(value: string | null, opts: { escapeFormula: boolean }): string {
  if (value === null) return "";
  let v = value;
  if (opts.escapeFormula && FORMULA_TRIGGER.test(v)) v = `'${v}`; // text columns only (aliases)
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
```

### Export sizing facts (live-verified, drives D-07/D-09 implementation)

```
Busiest node forwards:  96,461 rows / 90d   7,030 rows / 7d   (buffered CSV ≈ 15–25 MB worst case — OK)
Busiest node closes:        137 rows / 90d                    (trivial)
Busiest node channels:      574 open channels (latest state)  (Channels tab renders all; no cap needed but
                                                               keep the 500 cap uniform for predictability)
```

## State of the Art

| Old Approach (Phase 2) | Current Approach (Phase 3) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `/{pubkey}` = single scorecard page | `/{pubkey}` redirects → `/{pubkey}/scorecard`; 8 tab segments | this phase (D-01/D-03) | Modal interception preserved; every view gets a stable deep-linkable URL |
| GradeBadge = dot + letter + pct everywhere | dot + letter only; pct survives solely in the composite scorecard header | this phase (D-14, operator directive) | Fleet rows and dimension tiles simplify; pct → tooltip |
| Two micro text sizes (`text-[11px]` + `text-xs`) | One micro size: `text-xs` | this phase (UI-SPEC Typography) | Mechanical sweep across (overview) + scorecard components |
| Pending tables = untyped stubs | Fully typed from live introspection | this phase | Stub comment's `local_pubkey` claim for sweeps corrected to `lnd_pubkey` |

**Deprecated/outdated:** nothing external — stack pinned; no package version moves this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Static `/pending` route wins over dynamic `[pubkey]` segment (Next static-over-dynamic precedence) | Pattern 1 | Low — `PUBKEY_RE` 404s "pending" on the dynamic path anyway; verify with one manual route hit during execution |
| A2 | WAITING_CLOSE ≅ coop-close for section grouping (LND `waiting_close_channels` can transiently hold pre-confirm force-closes) | Pitfall 10 | Mislabeled section for rare rows; mitigated by rendering verbatim `channel_state` per row |
| A3 | 6h recency threshold remains correct as collector cadence evolves (cadence appeared to be ~hourly-or-better at probe time; only the last tick was observable) | Pattern 2 | Stale-but-shown rows or briefly-missed rows; threshold is a central-config tunable + golden test catches drift |
| A4 | `pending_channels` in `lnd_node_info` counts pending OPENS only (matched 12==12 on the one node with nonzero count) | Golden invariant | Golden test assertion 1 may need loosening; assertion 2 (limbo) was verified on 9 nodes and stands alone |
| A5 | `peer_alias_in/out` and `lnd_alias` are the only attacker-controlled text columns reaching CSV | Pitfall 8 | Under-escaping another text column; mitigation: apply formula-escape to ALL non-numeric text columns by default |

## Open Questions (RESOLVED)

1. **Does the LDK LSP node appear in the pending tables?**
   - What we know: pending_channels covers 20 distinct nodes; fleet = 26. All 26 nodes (incl. LDK) live in `lnd_node_info`.
   - What's unclear: whether the LDK node is among the 20 (it has no LND pendingchannels RPC, so probably not).
   - Recommendation: nothing to build — absence renders the honest empty state ("No pending channels … nothing in flight"), already specified in the UI-SPEC copywriting contract.

2. **Summary-strip aggregate set per static tab (Channels/Fees/Liquidity/Peers)**
   - What we know: D-07 locks the event-table strip shape (Σ count · Σ amount · Σ fees · avg · busiest); static tabs are "optional per planner".
   - Recommendation: give Channels a strip (count, Σ capacity, Σ local, Σ remote — all from rows already in hand, zero extra queries); skip strips on Peers.

3. **`recovered_balance` / `anchor_state` / `num_forwarding_packages` display**
   - What we know: columns exist and are typed; D-13 row contract lists state/age/limbo/broadcast_attempts only.
   - Recommendation: keep rows to the D-13 contract; surface extras in a row tooltip or expanded detail at planner discretion — they become Phase 4 detector evidence either way.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/test/runtime | ✓ | v22.22.2 | — |
| npm | package scripts | ✓ | 10.9.7 | — |
| vitest / tsc (local bins) | tests, typecheck | ✓ | vitest ^4, TS ^5 | — |
| `.env.local` → `ROUTING_VM_DATABASE_URL` | all reads, golden tests, this research's probes | ✓ (queried live this session) | — | — |
| `.env.local` → `LDK_LSPD_DATABASE_URL` | not needed this phase (all tab data is in routing_vm) | ✓ present | — | — |
| shadcn CLI (`npx shadcn@latest`) | vendoring `tabs`, `button` | ✓ (network npx; components.json initialized, zero third-party registries) | 4.x | hand-vendor from ui.shadcn.com source if registry unreachable |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4 (node environment, no Next plugin) |
| Config file | `vitest.config.ts` (`@/` alias + `server-only` stub already wired) |
| Quick run command | `npx vitest run src/lib/<module>` |
| Full suite command | `npm test` (`vitest run`, includes `src/**/*.test.ts`; live golden tests auto-skip without `ROUTING_VM_DATABASE_URL`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PENDING-01 | Pending SQL builders: recency predicate, DISTINCT ON + NULL guard, identity binding, no `max(`, SQLi-bound params | unit (no DB) | `npx vitest run src/lib/read/pending.test.ts` | ❌ Wave 0 |
| PENDING-01 | Golden: currently-pending opens count == node_info.pending_channels; Σ limbo == total_limbo_balance (tolerance) | live golden (skipIf no DB) | `npx vitest run src/lib/read/golden-pending.test.ts` | ❌ Wave 0 |
| NODE-01 | Per-tab window builders: bound days param, ns *1e9 factor on forwards, LIMIT cap present | unit (no DB) | `npx vitest run src/lib/console` | ❌ Wave 0 |
| NODE-02 | CSV serializer: RFC-4180 quoting, formula escape, provenance block shape, alias/filename sanitization | unit | `npx vitest run src/lib/csv` | ❌ Wave 0 |
| NODE-01/D-03 | Tab param + pubkey validation (whitelist → notFound), redirect target | unit on exported pure helpers + manual route hit | `npx vitest run src/lib/console/config.test.ts` | ❌ Wave 0 |
| D-14 polish, pending board layout, modal coexistence | visual/manual | manual-only — operator checkpoint (matches the 02-07 precedent; no component-render test infra exists and adding it is out of scope) | — | — |

### Sampling Rate
- **Per task commit:** module-scoped `npx vitest run src/lib/<touched>` + `npx tsc --noEmit`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** full suite green + golden pending test run once against the live warehouse + operator visual checkpoint before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/lib/read/pending.test.ts` — covers PENDING-01 builder shapes
- [ ] `src/lib/read/golden-pending.test.ts` — covers PENDING-01 invariants (copy `golden.test.ts` scaffold: HAS_DB skipIf, lazy db, tolerance)
- [ ] `src/lib/console/*.test.ts` — covers NODE-01 window/cap builders
- [ ] `src/lib/csv/serialize.test.ts` — covers NODE-02 serializer
- Framework install: none — vitest fully wired.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-operator local tool; no auth surface this phase (unchanged posture) |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | Read-only views; DB role is the enforcement boundary (READ-01, already in place) |
| V5 Input Validation | **yes** | Pubkey regex `^[0-9a-f]{66}$` before any data access (existing pattern, extend to [tab] page + export route); tab key whitelist; window preset whitelist (URL key → config-map integer, never bound user strings into intervals); all SQL parameter-bound via Drizzle `sql` templates with injection-shape tests |
| V6 Cryptography | no | None this phase (HMAC is Phase 6) |
| V12 Files & Resources | **yes** | CSV download: sanitized filename in `Content-Disposition` (header-injection guard); `text/csv; charset=utf-8`; bounded query (90d max) prevents resource-exhaustion exports |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via route/search params | Tampering | Drizzle bound params only; whitelist tab/window keys; PUBKEY_RE gate before queries (all established — extend to the 3 new entry points: [tab] page, /pending page, export route) |
| CSV formula injection via Lightning peer aliases | Tampering (downstream code exec in operator's spreadsheet) | Formula-escape leading `=+-@\t\r` in text cells (Pitfall 8); unit-tested |
| HTTP header injection via alias in Content-Disposition | Tampering | Alias sanitized to `[A-Za-z0-9_-]` before filename construction |
| Unbounded query DoS (371k+-row tables) | Denial of Service | Window presets only (90d max), LIMIT cap on rendered rows, no custom ranges (D-06 is also the security control) |
| Supply-chain (shadcn add) | Tampering | T-02-SC allowlist; official registry only (components.json `"registries": {}` verified); vendored source committed and reviewed |
| Residue rows presented as live state | Information disclosure (misleading operator) | Recency filter + golden cross-check + FreshnessStamp on every surface (success criterion 4) |

## Sources

### Primary (HIGH confidence)
- **Live routing_vm warehouse** (read-only, SELECT-only probes, 2026-06-10): `information_schema.columns` for both pending tables; recency-bucket, DISTINCT, enum, join, cross-check, and sizing queries — all reproduced in this document
- In-repo verified code: `src/lib/read/latest.ts`, `node-info.ts`, `db-timestamp.ts`, `nodes.ts`, `src/lib/scorecard/{fleet,config,freshness,types}.ts`, `src/lib/db/schema/{routing,ldk}.ts`, `src/app/(overview)/**`, `vitest.config.ts`, `components.json`, `package.json`
- nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes (fetched this session, doc version 16.2.9) — interception matches same-level segments, soft-nav only
- `.planning/phases/03-*/03-CONTEXT.md`, `03-UI-SPEC.md` (approved design contract), `02-PATTERNS.md`, `02-01-SUMMARY.md` (live-introspection precedent)

### Secondary (MEDIUM confidence)
- RFC 4180 quoting rules + OWASP CSV-injection guidance (training knowledge, low-drift domain; serializer is unit-tested regardless)

### Tertiary (LOW confidence)
- LND `pendingchannels` RPC category semantics for the WAITING_CLOSE nuance (A2) — training knowledge, display-labeling impact only

## Metadata

**Confidence breakdown:**
- Pending-table semantics: HIGH — every claim live-verified this session, including exact golden cross-checks on 9 nodes
- Tab routing mechanism: HIGH — interception behavior verified against current official docs; existing modal code read in full
- Standard stack: HIGH — zero new packages; everything pinned and present
- CSV approach: HIGH on mechanics (sizing verified live), MEDIUM on the full set of formula-injection vectors (A5 — mitigated by escaping all text columns)
- Peers-tab data constraint: HIGH — lifetime-log behavior re-verified live (1 recent row vs 1,290 num_peers)

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (stable pinned stack; re-verify pending-table recency behavior if the warehouse collector changes cadence)
