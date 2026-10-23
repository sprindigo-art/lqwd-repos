# Phase 2: Fleet Overview + Health Scorecard - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 22 new/modified files (grouped into 9 pattern families)
**Analogs found:** 19 / 22 (3 are shadcn-CLI-generated or genuinely novel-but-trivial)

All analogs are Phase 1 files in this repo — they are small, recently written, and encode the exact disciplines (AFM-001, AFM-002, server-only, fail-loud) Phase 2 must carry forward. Every excerpt below was read this session; line numbers are current.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/read/node-info.ts` [NEW] | read helper (service) | CRUD (latest-state read) | `src/lib/read/latest.ts` | **exact** |
| `src/lib/read/node-info.test.ts` [NEW] | test (no-DB SQL shape) | — | `src/lib/read/latest.test.ts` | **exact** |
| `src/lib/read/peers.ts` [NEW] | read helper (service) | CRUD (aggregate read) | `src/lib/read/latest.ts` | exact |
| `src/lib/db/schema/routing.ts` [MODIFY — additive] | model/schema | — | itself (existing two typed tables) | **exact** |
| `src/lib/config/backends.ts` [NEW] | config | lookup | `src/lib/db/env.ts` + `src/lib/read/nodes.ts` (Backend type) | role-match |
| `src/lib/scorecard/types.ts` [NEW] | model (TS contracts) | — | `src/lib/read/nodes.ts` (interfaces) | exact |
| `src/lib/scorecard/config.ts` [NEW] | config (tunable bands) | lookup | `src/lib/format/units.ts` (named-constant module) + RESEARCH §Tunable shape | role-match |
| `src/lib/scorecard/dimensions/*.ts` (7: routing, revenue, liquidity, channel-health, force-close, restart, peer) [NEW] | service (compute) | request-response (SQL aggregate → `{raw, asOf}`) | `src/lib/read/latest.ts` (query side) + `src/lib/format/units.ts` (math side) | role-match |
| `src/lib/scorecard/dimensions/*.test.ts` [NEW] | test (unit, no DB) | — | `src/lib/format/units.test.ts` + `src/lib/read/latest.test.ts` | exact |
| `src/lib/scorecard/grade.ts` [NEW] | utility (pure transform) | transform | `src/lib/format/units.ts` | role-match |
| `src/lib/scorecard/compare.ts` [NEW] | utility (pure MAD stats) | transform | `src/lib/format/units.ts` (+ verbatim helper in RESEARCH §MAD) | role-match |
| `src/lib/scorecard/freshness.ts` [NEW] | utility (pure transform) | transform | `src/lib/format/units.ts` | role-match |
| `src/lib/scorecard/{grade,compare,freshness}.test.ts` [NEW] | test (unit) | — | `src/lib/format/units.test.ts` | exact |
| `src/lib/scorecard/golden-scorecard.test.ts` [NEW] | test (live golden, D-14) | — | `src/lib/read/golden.test.ts` | **exact** |
| `src/app/(overview)/page.tsx` [NEW] | page (RSC) | request-response (fleet read → render) | `src/app/(status)/page.tsx` | **exact** |
| `src/app/(overview)/[pubkey]/page.tsx` [NEW] | page (RSC, dynamic route) | request-response | `src/app/(status)/page.tsx` | role-match (adds param validation — pattern below) |
| `src/components/scorecard/*.tsx` (GradeBadge, CriticalChip, FreshnessStamp, DimensionRow, OutlierMarker) [NEW] | component (presentational) | props-in render-out | `src/app/(status)/page.tsx` badge/table JSX (lines 128–151) + shadcn `badge` | role-match |
| `src/components/ui/*` (card, table, badge, tooltip) [NEW] | component (vendored) | — | none needed — shadcn CLI writes these | n/a (generated) |
| `src/app/globals.css` [MODIFY — additive `@theme` tokens] | config (theme) | — | itself (existing `@theme` block) | exact |
| `src/lib/read/nodes.ts` [MODIFY — additive only, if planner extends UnifiedNode] | model | — | itself | exact |
| `src/app/(status)/page.tsx` [SUPERSEDED by (overview)] | page | — | — (Phase 2 replaces it; mine it for patterns, then remove/redirect per planner) | n/a |

## Pattern Assignments

### 1. `src/lib/read/node-info.ts` + `peers.ts` (read helpers — THE landmine fix)

**Analog:** `src/lib/read/latest.ts` (51 lines — copy its structure wholesale, swap the key)

This is the single most important pattern in the phase. RESEARCH verified `lnd_node_info` is **append-only** (371k rows for Canada), so `latestNodeInfo` must be a sanctioned DISTINCT ON helper exactly like `latestChannelsForNode` — with `pubkey` as the key instead of `chan_id`.

**Header-comment + exported SQL-builder pattern** (`latest.ts` lines 1–36):
```typescript
import { sql, type SQL } from "drizzle-orm";

// =====================================================
// AFM-001 — the ONLY sanctioned latest-channel-state read
// =====================================================
// ...explains the failure mode and why this module is the single centralized path...

/**
 * Build the AFM-001 DISTINCT ON (chan_id) latest-per-channel fragment for one
 * node. Exposed separately so the no-DB shape test can assert the emitted SQL
 * without a live warehouse connection. `localPubkey` is bound, not interpolated.
 */
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

**Lazy-import executor pattern** (`latest.ts` lines 42–51) — keeps the pool out of no-DB test import graphs:
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

**For `node-info.ts`:** same skeleton, two builders — `buildLatestNodeInfoSql(pubkey)` (single node, `ORDER BY timestamp DESC LIMIT 1`) and `buildLatestNodeInfoAllSql()` (`DISTINCT ON (pubkey) ... ORDER BY pubkey, timestamp DESC` with `pubkey IS NOT NULL` guard, mirroring the WR-01 NULL-key comment). The fleet-wide form already exists verbatim inside `golden.test.ts` lines 49–58 (the `resolveByAlias` query) — promote that SQL into the helper.

**For `peers.ts`:** same skeleton; remember `lnd_node_peer_info` is **lifetime-cumulative** (RESEARCH Pitfall 2) — current peer count comes from `latestNodeInfo(...).num_peers`, never `COUNT(*)` of peer_info.

---

### 2. `src/lib/read/node-info.test.ts` (no-DB SQL shape test)

**Analog:** `src/lib/read/latest.test.ts` (42 lines — copy wholesale, retarget assertions)

**Render-and-assert pattern** (lines 10–41):
```typescript
import { PgDialect } from "drizzle-orm/pg-core";
import { buildLatestChannelsSql } from "@/lib/read/latest";

const dialect = new PgDialect();
function renderFor(pubkey: string) {
  const built = dialect.sqlToQuery(buildLatestChannelsSql(pubkey));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

it("emits DISTINCT ON (chan_id)", () => {
  expect(renderFor("0364913d18a19c").sql).toContain("distinct on (chan_id)");
});
it("never uses MAX( (the AFM-001 failure mode)", () => {
  expect(renderFor("0364913d18a19c").sql).not.toContain("max(");
});
it("parameter-binds localPubkey ($1), never concatenated into the SQL text", () => {
  const evil = "'; DROP TABLE lnd_node_channel_info; --";
  const { sql, params } = renderFor(evil);
  expect(sql).not.toContain("drop table");
  expect(params).toContain(evil);
  expect(sql).toContain("$1");
});
```
Retarget to `distinct on (pubkey)` / `order by pubkey, timestamp desc`. Reuse the same four-assertion set (DISTINCT ON present, ORDER BY shape, no `max(`, injection-bound param) for **every** new SQL builder in the phase, including dimension queries that expose a builder.

---

### 3. `src/lib/db/schema/routing.ts` (MODIFY — type 5 new tables, fix the landmine comment)

**Analog:** itself — the existing `lndNodeChannelInfo` block (lines 25–58) is the template for the new tables.

**Per-table annotated pgTable pattern** (lines 25–43, abridged):
```typescript
// -----------------------------------------------------
// lnd_node_channel_info
// AFM-001: EVENT-DRIVEN. Latest channel state ONLY via
//   SELECT DISTINCT ON (chan_id) ... ORDER BY chan_id, timestamp DESC
//   NEVER MAX(timestamp) (the documented 480-channels-as-1 failure).
// Identity column (per-node partition): local_pubkey
// Latest-state key: chan_id   |   Time column: timestamp
// -----------------------------------------------------
export const lndNodeChannelInfo = pgTable("lnd_node_channel_info", {
  id: integer("id").primaryKey(),
  active: boolean("active"),
  localPubkey: text("local_pubkey"), // AFM-001 identity (per-node partition)
  chanId: varchar("chan_id"), // AFM-001 DISTINCT ON key
  capacity: bigint("capacity", { mode: "bigint" }),
  ...
  timestamp: timestamp("timestamp"), // AFM-001 ORDER BY ... DESC key
});
```

Apply identically to `lnd_node_forwards` (identity `lnd_pubkey`, time `timestamp_ns` BIGINT **nanoseconds** — annotate that, plus `// AFM-002: use fee_msat/1000.0, NEVER raw fee` on the fee columns), `lnd_node_closed_channels` (identity `local_pubkey`, one row per close, `close_type`/`close_initiator` text), `lnd_restart` (`alias, pubkey, restarted, last_restart` — latest-only, no history), `lnd_node_peer_info` (annotate CUMULATIVE LIFETIME, not current peers), `internal_rebalance_invoices`. The identity/time annotations for these are already stubbed in the trailing comment block (lines 93–102) — convert each stub line into a full typed table and delete the stub.

**MANDATORY correction (RESEARCH Pitfall 1):** the `lnd_node_info` comment at lines 61–65 ("TRUE SNAPSHOT ... safe to read directly, no DISTINCT ON needed") is **factually wrong** — the table is append-only. Rewrite that comment to "APPEND-ONLY — latest-per-node ONLY via DISTINCT ON (pubkey) (see src/lib/read/node-info.ts)". Comment-only + additive changes; do not touch existing typed columns.

---

### 4. `src/lib/config/backends.ts` (D-03 backend map)

**Analogs:** `src/lib/db/env.ts` (env-read pattern) + `src/lib/read/nodes.ts` line 22 (`export type Backend = "lnd" | "ldk";` — **reuse, do not redeclare**).

**Server-only + documented env contract pattern** (`env.ts` lines 1–17):
```typescript
import "server-only";

// =====================================================
// Fail-loud env contract (RESEARCH §I)
// =====================================================
/** Reads `process.env[name]`; throws if missing/empty. No dev-DB fallback. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error("Missing required env: " + name);
  return value;
}
```

For `backends.ts`: `NODE_BACKENDS` is **optional** (defaults apply), so read it directly with a `?? "{}"` fallback rather than `requireEnv` — but keep `import "server-only"`, the banner-comment style, and named exports. RESEARCH §Backend Identification gives the target shape verbatim:
```typescript
import type { Backend } from "@/lib/read/nodes";
const DEFAULT_BACKENDS: Record<string, Backend> = { /* "<pubkey>": "ldk" */ };
export function backendFor(pubkey: string): Backend {
  return envOverrides()[pubkey] ?? DEFAULT_BACKENDS[pubkey] ?? "lnd";
}
```

---

### 5. `src/lib/scorecard/types.ts` + dimension functions (`dimensions/*.ts`)

**Analogs:** `src/lib/read/nodes.ts` (interface/contract style) for types; `src/lib/read/latest.ts` (SQL side) + `src/lib/format/units.ts` (math side) for dimension fns.

**Interface contract pattern** (`nodes.ts` lines 24–34) — JSDoc'd, named export, RAW-units comment discipline:
```typescript
/** The single per-node shape the UI consumes — identical across both backends. */
export interface UnifiedNode {
  backend: Backend;
  pubkey: string;
  alias: string | null;
  activeChannels: number;
  ...
  localBalanceSats: number; // RAW sats — formatter applied only at render (AFM-002)
}
```
`types.ts` defines `DimensionResult { raw: number | null; asOf: Date | null; note?: string }`, `ScorecardView`, `FleetView` the same way (RESEARCH Pattern 2). Keep raw numbers raw; formatting happens only in components.

**Discriminated-union-over-`any` pattern** (`nodes.ts` lines 73–75) — if per-backend scorecard extras are needed:
```typescript
export type UnifiedNodeWithExtras =
  | (UnifiedNode & { backend: "lnd"; lnd?: { numPeers?: number } })
  | (UnifiedNode & { backend: "ldk"; ldk?: { lspBalanceSats?: number } });
```

**Nullable-coercion helpers** (`nodes.ts` lines 80–82) — copy for any warehouse-row normalization:
```typescript
const intOrZero = (v: number | null | undefined): number => v ?? 0;
const satsOrZero = (v: bigint | number | null | undefined): number =>
  v == null ? 0 : Number(v);
```

**Dimension fn rules** (composite of analogs — non-negotiable):
- SQL: parameter-bound Drizzle `sql` template + lazy `await import("@/lib/db/warehouse-routing")` (latest.ts lines 42–51). Channel-state dims call the EXISTING `latestChannelsForNode`; node_info dims call the NEW `latestNodeInfo`.
- Fees: `SUM(fee_msat)/1000.0` in SQL or `feeMsatToSat()` in TS (`units.ts` lines 7–10) — never the raw `fee` column, never inline `/1000`.
- Forwards windows in **nanoseconds**: `timestamp_ns > (EXTRACT(EPOCH FROM now()) - 7*86400)*1e9` (RESEARCH Pitfall 3, verified working).
- Return `{ raw, asOf }` only — no grades, no thresholds in dimension files (D-02 separation).

---

### 6. `src/lib/scorecard/{config,grade,compare,freshness}.ts` (pure transform layer)

**Analog:** `src/lib/format/units.ts` (20 lines) — the named-constant + tiny-pure-named-export module shape:
```typescript
// AFM-002 single source of truth for all sat / BTC / msat math.
// No inline `/ 1e8`, `* 1000`, or raw `fee` is permitted anywhere else ...
const SATS_PER_BTC = 100_000_000; // 1e8
const MSAT_PER_SAT = 1_000;

/** Millisatoshis → satoshis. Always use for any `*_msat` column (never raw `fee`). */
export function feeMsatToSat(msat: bigint | number): number {
  return Number(msat) / MSAT_PER_SAT;
}
```
Apply the same "single source of truth, top-of-file contract comment" framing to `config.ts` (the D-02 tunable table — RESEARCH §Tunable Config supplies the exact `SCORECARD_CONFIG`/`COMPARE_CONFIG`/`STALENESS` shape and starting values) and to `grade.ts`/`freshness.ts`. `compare.ts`'s `median`/`mad`/`outlierCheck` implementation is given verbatim in RESEARCH §MAD Comparison Math — copy it as written (includes the cohort<3 suppression and MAD===0 nobody-flagged guards). These modules are pure (no DB import) so they stay fast-testable without the lazy-import dance; do NOT add `import "server-only"` to pure math modules (units.ts doesn't) — only to anything touching DB/env.

**Hard D-07 rule to encode in `grade.ts`:** color comes ONLY from `tier1` breaches; composite = unweighted mean of available dims; no-data dims excluded; outlier never alters grade.

---

### 7. Unit tests for the pure layer (`grade.test.ts`, `compare.test.ts`, `freshness.test.ts`, `dimensions/*.test.ts`)

**Analog:** `src/lib/format/units.test.ts` (66 lines) — reference-value table + behavioral assertions:
```typescript
import { describe, it, expect } from "vitest";
import { feeMsatToSat, formatBtc, formatSats } from "@/lib/format/units";

// AFM-002 reference values from ../lqwdLogs/_library/analytical-failure-modes.md
const BTC_REFERENCE: ReadonlyArray<[number, string, string]> = [
  [3_359_047_565, "33.5905", "Canada capacity"],
  ...
];

describe("formatBtc (sat → BTC, dp=4)", () => {
  for (const [sats, expected, note] of BTC_REFERENCE) {
    it(`${sats} → ${expected} BTC (${note})`, () => {
      expect(formatBtc(sats)).toBe(expected);
    });
  }
```
Use the same table-driven style: grade.test.ts feeds synthetic dimension sets and asserts (a) Tier-1 → red, (b) all-warn → yellow never red, (c) no-data excluded from mean; compare.test.ts asserts suppression at cohort<3, MAD===0 flags nobody, outlier flag doesn't change grade input. Test infra is already wired — `vitest.config.ts` aliases `@/` and stubs `server-only`; include pattern is `src/**/*.test.ts` (co-located tests, not a `tests/` dir).

---

### 8. `src/lib/scorecard/golden-scorecard.test.ts` (D-14 Canada validation)

**Analog:** `src/lib/read/golden.test.ts` (132 lines — copy the full scaffold)

**skipIf + lazy DB + alias-resolution pattern** (lines 1–61):
```typescript
const HAS_DB = !!process.env.ROUTING_VM_DATABASE_URL;

async function routing() {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  return dbRouting;
}

const REFERENCE_FALLBACK: Record<string, string> = {
  Canada: "0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1",
  ...
};

async function resolveByAlias(name: string, like: string) {
  const db = await routing();
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (pubkey) pubkey, active_channels
    FROM lnd_node_info
    WHERE alias ILIKE ${like}
      AND alias NOT ILIKE ${"%breez%"} AND alias NOT ILIKE ${"%lspd%"} AND alias NOT ILIKE ${"%ldk%"}
    ORDER BY pubkey, timestamp DESC
    LIMIT 1
  `)) as unknown as Array<{ pubkey: string; active_channels: number }>;
  ...
}

describe.skipIf(!HAS_DB)("READ-02 golden cross-consistency invariant (live)", () => {
```

**Invariant-not-literal tolerance pattern** (lines 100–119):
```typescript
const tol = Math.max(3, Math.ceil(n.activeChannels * 0.03)); // ~3% tolerance — REUSE
expect(Math.abs(n.distinctActiveNotClosed - n.activeChannels)).toBeLessThanOrEqual(tol);
// Anchor must be a real fleet node, proving the helper did NOT collapse to ~1
expect(n.distinctActiveNotClosed).toBeGreaterThan(50);
```
Plus the `console.log("[golden] ...")` operator-checkpoint loop (lines 101–109). For the scorecard golden, assert the invariant ranges RESEARCH §Reference-Node Validation lists (24h fee-PPM in (0, 100000); 7d earnings > 0 with ±1% fee_msat back-conversion; liquidity ratio in [0,1]; routing count > 0) — never frozen literals.

---

### 9. `src/app/(overview)/page.tsx` + `[pubkey]/page.tsx` (RSC pages)

**Analog:** `src/app/(status)/page.tsx` (165 lines — Phase 2 supersedes this page but copies its skeleton)

**Server-Component + force-dynamic header pattern** (lines 1–14):
```typescript
import { dbRouting } from "@/lib/db/warehouse-routing";
import { mapLndNode, type UnifiedNode } from "@/lib/read/nodes";
import { formatSats, formatBtc } from "@/lib/format/units";

// This page reads the LIVE warehouses at request time (Server Component). Mark it
// dynamic so `npm run build` does NOT try to prerender it against a live DB.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Fleet Status" };
```

**Loader-function + null-pubkey filter pattern** (lines 32–48):
```typescript
async function loadUnifiedNodes(): Promise<{ nodes: UnifiedNode[]; fetchedAt: Date }> {
  const lndRows = await dbRouting.select({ pubkey: lndNodeInfo.pubkey, ... }).from(lndNodeInfo);
  const lndNodes = lndRows
    .filter((r) => r.pubkey != null)
    .map((r) => mapLndNode({ ...r, pubkey: r.pubkey as string }));
```
**CRITICAL DELTA:** this Phase 1 loader does a bare `.from(lndNodeInfo)` under the (wrong) "true snapshot" assumption. The Phase 2 overview MUST instead go through the new `latestNodeInfoAll()` helper (Pattern 1) — the bare select would now pull 8M rows. Do NOT copy lines 34–44 literally; copy the loader *shape* and swap the read.

**Table/density/empty-state JSX patterns to carry forward** (lines 109–158): `overflow-x-auto rounded-lg border border-white/10` wrapper, `px-3 py-2` cells, `tabular-nums` on every numeric cell, `font-mono text-xs` short pubkeys (`shortPubkey` helper lines 90–92), `colSpan` empty-state row. Phase 2 swaps the hand-rolled `<table>`/badge `<span>` for shadcn `table`/`badge` and replaces the empty-state copy with the UI-SPEC Copywriting Contract strings.

**Pattern to REPLACE, not copy:** inline `style={{ color: "#1A3C79" }}` / `style={{ backgroundColor: ... }}` (lines 100, 114, 131). Phase 2 uses `@theme` tokens (`text-brand`, `bg-brand`) — UI-SPEC explicitly names this the pattern to replace.

**`[pubkey]/page.tsx` additions (no in-repo analog — security requirement from RESEARCH §Security V5):** validate the route param before any query:
```typescript
const PUBKEY_RE = /^[0-9a-f]{66}$/;
if (!PUBKEY_RE.test(params.pubkey)) notFound(); // next/navigation
```
All downstream SQL stays parameter-bound regardless (the builders already guarantee this).

---

### 10. `src/components/scorecard/*.tsx` (GradeBadge, CriticalChip, FreshnessStamp, DimensionRow, OutlierMarker)

**Analogs:** badge JSX in `(status)/page.tsx` lines 128–135 (shape) + shadcn `badge` (replaces it) + `src/lib/utils.ts` `cn()`.

Existing badge shape to evolve:
```tsx
<span className="rounded px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: n.backend === "lnd" ? "#1A3C79" : "#2A5299" }}>
  {n.backend.toUpperCase()}
</span>
```
Phase 2 form: shadcn `<Badge>` variants driven by status tokens, classes merged with `cn()` from `@/lib/utils` (already present, lines 5–7 — shadcn init will detect it). Components are **presentational and server-renderable** — props in (plain serializable `ScorecardView` fields), JSX out; no `"use client"` unless a component needs interactivity (tooltip trigger comes from shadcn's own client component). Define a props interface per component (workspace convention), named exports. Never import `dbRouting`, schema, or `backends.ts` into these files.

**Status colors:** add to `globals.css` `@theme` (existing block lines 6–13 is the template):
```css
@theme {
  --color-brand: #1A3C79;
  --color-brand-light: #2A5299;
  /* Phase 2 additions — health status palette (UI-SPEC §Color) */
  --color-status-ok: #22c55e;
  --color-status-warn: #eab308;
  --color-status-critical: #dc2626;
  --color-status-nodata: #6b7280;
  --color-status-stale: #a16207;
  --color-status-outlier: #8b5cf6;
}
```

---

## Shared Patterns

### Server-only guard
**Source:** `src/lib/db/warehouse-routing.ts` line 1 / `src/lib/db/env.ts` line 1
**Apply to:** every new module that touches DB, env, or secrets (`node-info.ts`, `peers.ts`, `backends.ts`, all `dimensions/*.ts` that execute SQL)
```typescript
import "server-only";
```
(Read helpers in `src/lib/read/` keep the *lazy-import* variant instead — see Pattern 1 — so their pure SQL builders stay testable; latest.ts itself has no top-level server-only import for exactly this reason. Follow whichever the file's analog does.)

### Banner-comment module contract
**Source:** every Phase 1 module (e.g. `latest.ts` lines 3–17, `nodes.ts` lines 3–20, `warehouse-routing.ts` lines 7–20)
**Apply to:** every new module
```typescript
// =====================================================
// <RULE-ID> — one-line statement of the invariant this module owns
// =====================================================
// Why it exists, the failure mode it prevents, and references (D-xx / AFM-xxx / T-xx).
```
Decision IDs (D-01..D-14), AFM IDs, and requirement IDs are cited inline throughout Phase 1 code — continue this.

### AFM-002 formatter at render only
**Source:** `src/lib/format/units.ts` (whole file) + usage in `(status)/page.tsx` lines 141–149
**Apply to:** all components/pages rendering sats/BTC/fees; all dimension math
```tsx
<td className="px-3 py-2 text-right tabular-nums">{formatSats(n.localBalanceSats)}</td>
```
Models and `DimensionResult.raw` carry RAW numbers; `formatSats`/`formatBtc`/`feeMsatToSat` are the only conversion/formatting paths.

### Parameter-bound SQL (V5)
**Source:** `src/lib/read/latest.ts` lines 29–35; verified by `latest.test.ts` lines 33–41
**Apply to:** every SQL fragment in the phase — Drizzle `sql` template interpolation only (`${value}` → bound `$1`), never string concatenation. Pair each new builder with the injection-shape test.

### `@/` imports, named exports
**Source:** all Phase 1 files (e.g. `nodes.ts` line 1: `import { feeMsatToSat } from "@/lib/format/units";`)
**Apply to:** everything. No relative cross-directory imports, no default exports for utilities (pages keep their required default export).

### Fail-loud, mark-the-gaps
**Source:** `src/instrumentation.ts` (boot throws), `src/lib/db/env.ts` (`requireEnv` throws)
**Apply to:** UI states — no silent blanks. "No data — needs log ingestion", "no peer baseline yet", "⚠ stale" are explicit labeled states (UI-SPEC Copywriting Contract supplies the exact strings).

## No Analog Found

| File | Role | Data Flow | Reason / Guidance |
|------|------|-----------|-------------------|
| `src/components/ui/*` (card, table, badge, tooltip) | vendored components | — | Generated by `npx shadcn@latest init` + `add card table badge tooltip` — do not hand-write; commit CLI output as-is (UI-SPEC §Design System) |
| `components.json` | config | — | Written by shadcn init; first UI phase, nothing pre-exists |
| `src/lib/scorecard/compare.ts` math internals | utility | transform | No stats code in repo, but RESEARCH §MAD Comparison Math contains the complete verbatim implementation (median/mad/outlierCheck) — copy from RESEARCH, not from codebase |

## Metadata

**Analog search scope:** entire `src/` (21 files total — full inventory listed and all 16 relevant files read), `vitest.config.ts`, `globals.css`, `layout.tsx`
**Files scanned:** 21 (16 read in full)
**Pattern extraction date:** 2026-06-09
**Key planner flags:**
1. **Do not copy the `(status)/page.tsx` bare `lnd_node_info` select** — it predates the append-only discovery; route all node_info reads through the new `latestNodeInfo*` helpers.
2. **Fix the `routing.ts` "TRUE SNAPSHOT" comment** (lines 61–65) as part of the schema-typing plan — comment-only correction, additive table typing otherwise.
3. **`Backend` type already exists** (`nodes.ts` line 22) and `UnifiedNode` already carries `backend` — `backends.ts` imports the type; it overrides the *label source* (config map, not mapper provenance) per D-03.
4. Test infra needs zero changes — vitest config already aliases `@/`, stubs `server-only`, includes `src/**/*.test.ts` (co-locate tests next to source).
