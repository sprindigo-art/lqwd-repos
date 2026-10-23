# Phase 1: Foundations + Read Layer - Pattern Map

**Mapped:** 2026-06-07
**Files analyzed:** 19 new files (greenfield repo)
**Analogs found:** 12 / 19 (all analogs are cross-repo from `../lqwdclaw/` or `../lqwdLogs/`)

> **Greenfield notice:** NodeMonitor has no source code yet. Every analog below lives in a **sibling workspace project** (`../lqwdclaw/` = production Next 16 / React 19 / Drizzle / postgres.js / Tailwind v4, or `../lqwdLogs/` = battle-tested SQL). Paths are relative to the workspace root `/Users/joshuajackson/Desktop/LQwD/ClaudeCode/`. Planner: treat these as **patterns to copy + adapt for the three-client RO setup**, not files to import. The single most important adaptation is that lqwdclaw uses ONE optional-write client; NodeMonitor needs THREE clients (2 RO warehouses + 1 RW local), each `import "server-only"`, each from its own env URL, no graceful-null fallback (fail loud instead).

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/lib/db/warehouse-routing.ts` | db-client | request-response (RO) | `../lqwdclaw/src/lib/db/index.ts` | role-match (cross-repo) |
| `src/lib/db/warehouse-ldk.ts` | db-client | request-response (RO) | `../lqwdclaw/src/lib/db/index.ts` | role-match (cross-repo) |
| `src/lib/db/nodemon.ts` | db-client | request-response (RW) | `../lqwdclaw/src/lib/db/index.ts` | role-match (cross-repo) |
| `src/lib/db/env.ts` | config | transform | _(no analog — lqwdclaw uses inline `process.env`, no validator)_ | no-analog |
| `src/lib/db/health.ts` | service | request-response | _(no analog — boot read-only probe is novel)_ | no-analog |
| `src/lib/db/schema/routing.ts` | model | — | `../lqwdclaw/src/lib/db/schema.ts` | role-match (cross-repo) |
| `src/lib/db/schema/ldk.ts` | model | — | `../lqwdclaw/src/lib/db/schema.ts` | role-match (cross-repo) |
| `src/lib/db/schema/nodemon.ts` | model | — | `../lqwdclaw/src/lib/db/schema.ts` | role-match (cross-repo) |
| `src/lib/read/latest.ts` | service (query helper) | CRUD-read (DISTINCT ON) | `../lqwdclaw/src/lib/db/queries.ts` + `../lqwdLogs/.../00-sanity-checks.sql` | role+flow-match (cross-repo) |
| `src/lib/read/nodes.ts` | service (normalizer) | transform | `../lqwdclaw/src/lib/db/queries.ts` | role-match (cross-repo) |
| `src/lib/format/units.ts` | utility | transform (pure) | `../lqwdclaw/src/lib/utils.ts` | role-match (cross-repo) |
| `src/lib/utils.ts` | utility | transform (pure) | `../lqwdclaw/src/lib/utils.ts` (`cn()`) | exact (cross-repo) |
| `src/instrumentation.ts` | provider (boot hook) | event-driven (startup) | _(no analog — lqwdclaw has none)_ | no-analog |
| `drizzle.routing.config.ts` | config | — | `../lqwdclaw/drizzle.config.ts` | exact (cross-repo) |
| `drizzle.ldk.config.ts` | config | — | `../lqwdclaw/drizzle.config.ts` | exact (cross-repo) |
| `drizzle.nodemon.config.ts` | config | — | `../lqwdclaw/drizzle.config.ts` | exact (cross-repo) |
| `db/role-grants.sql` | config (operator artifact) | — | _(no analog — RESEARCH §B is the spec)_ | no-analog |
| `vitest.config.ts` | config | — | _(no analog — no test framework in workspace)_ | no-analog |
| `src/lib/format/units.test.ts` (+ `latest.test.ts`, `golden.test.ts`, `health.test.ts`) | test | — | _(no analog — first tests in workspace)_ | no-analog |

## Pattern Assignments

### `src/lib/db/warehouse-routing.ts` + `warehouse-ldk.ts` + `nodemon.ts` (db-client)

**Analog:** `../lqwdclaw/src/lib/db/index.ts` (the only Drizzle-client init in the workspace)

**Imports + client init pattern** (`index.ts` lines 1-16):
```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Gracefully handle missing DATABASE_URL (e.g. during build or before Supabase setup)
const client = connectionString
  ? postgres(connectionString)
  : (null as unknown as ReturnType<typeof postgres>);

export const db = connectionString
  ? drizzle(client, { schema })
  : (null as unknown as ReturnType<typeof drizzle>);

export const isDatabaseConnected = !!connectionString;
```

**REQUIRED ADAPTATIONS for NodeMonitor (do NOT copy verbatim):**
1. **Add `import "server-only";` as the first line** — lqwdclaw omits it; NodeMonitor requires it on every DB/env module (CONTEXT D-02, RESEARCH Pitfall 3). This is the client-bundle-leak guard.
2. **Drop the graceful-null fallback.** lqwdclaw returns `null` when `DATABASE_URL` is missing so builds don't break. NodeMonitor must **fail loud** — read the URL via `requireEnv()` from `env.ts` which throws on missing (RESEARCH §I "no dev-DB default; no localhost literals").
3. **Per-warehouse env var, not `DATABASE_URL`:** `ROUTING_VM_DATABASE_URL`, `LDK_LSPD_DATABASE_URL`, `NODEMON_QUEUE_URL` (RESEARCH §I table).
4. **Add postgres.js pool options + dev hot-reload singleton** (RESEARCH Pattern 1, resolves Pitfall 4):
```typescript
import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/routing";
import { requireEnv, warehousePrepareFlag } from "./env";

const globalForDb = globalThis as unknown as { _routingSql?: postgres.Sql };
const sql =
  globalForDb._routingSql ??
  postgres(requireEnv("ROUTING_VM_DATABASE_URL"), {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: warehousePrepareFlag(), // false only if PgBouncer txn-mode pooler (D-03 probe)
  });
if (process.env.NODE_ENV !== "production") globalForDb._routingSql = sql;

export const dbRouting = drizzle(sql, { schema });
```
5. **No SSL on the warehouse host** — put `?sslmode=prefer` in the URL (RESEARCH Pattern 1 note; `grafana-demo-vm.txt`). Do not force SSL.
6. **`nodemon.ts` is identical in shape but RW** — same singleton, no `prepare` override needed (local PG), schema import is the empty/placeholder `schema/nodemon.ts` (tables land Phase 6, D-07).

---

### `src/lib/db/schema/routing.ts` + `ldk.ts` + `nodemon.ts` (model)

**Analog:** `../lqwdclaw/src/lib/db/schema.ts`

**Imports + `pgTable` definition style** (`schema.ts` lines 1-35):
```typescript
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ==========================================
// CONTENT ARCHIVE
// ==========================================

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(), // 'moltbook' | 'x' | 'website'
    // ...
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_posts_dedup").on(table.platform, table.platformPostId),
    index("idx_posts_feed").on(table.postedAt),
  ]
);
```

**Pattern to copy:** named exports, `// =====` section headers (CLAUDE.md convention), inline `//` comments documenting enum-like string columns, snake_case DB column names mapped to camelCase TS keys.

**REQUIRED ADAPTATIONS:**
1. **`routing.ts` / `ldk.ts` are hand-curated from `drizzle-kit pull`, NOT authored fresh** (CONTEXT D-09). Run pull once (read-only metadata), copy the real table defs in, then **delete the generated migration/meta artifacts** so the warehouses never look Drizzle-owned (RESEARCH Runtime State Inventory).
2. **Add AFM-001 annotations as comments** on each table marking snapshot vs event-driven (RESEARCH §D table). Example required header comments:
   - `lnd_node_channel_info` → `// AFM-001: EVENT-DRIVEN. Latest state ONLY via DISTINCT ON (chan_id). NEVER MAX(timestamp). Identity col: local_pubkey`
   - `lnd_node_info` → `// AFM-001: TRUE SNAPSHOT. MAX(timestamp)/ORDER BY ... LIMIT 1 is correct. Identity col: pubkey`
   - `lnd_node_forwards` → `// AFM-002: use fee_msat/1000.0, NEVER raw fee. Identity col: lnd_pubkey. time col: timestamp_ns (nanoseconds)`
3. **Per-table identity column differs** (RESEARCH Pitfall 6 / §D): `lnd_node_channel_info`/`closed`/`pending` → `local_pubkey`; `lnd_node_info` → `pubkey`; `lnd_node_forwards` → `lnd_pubkey`. Lock these in the curated schema.
4. **`ldk.ts` columns are `[ASSUMED]` until introspected** (RESEARCH §F) — first impl task runs `information_schema.columns` against `lightning_channels`, `lsps1_orders`, `payments`, `transactions`. Do NOT hardcode LDK columns from memory.
5. **`schema/nodemon.ts` is empty/placeholder in Phase 1** — only this DB gets `drizzle-kit generate/migrate`. Queue tables (`commands`/`executions`/`audit`) are Phase 6 (D-07).

---

### `src/lib/read/latest.ts` (service — AFM-001 helper)

**Analog (query-builder shape):** `../lqwdclaw/src/lib/db/queries.ts`
**Analog (the SQL idiom + real columns):** `../lqwdLogs/canada/lqwd-canada-node-analytics/queries/00-sanity-checks.sql`

**Query-function organization pattern** (`queries.ts` lines 1-43): server-only query functions grouped under `// =====` section headers, each `async function get*`, parameterized via Drizzle, `result[0] ?? null` for single-row. The raw-SQL escape hatch is the `sql` tag:
```typescript
import { db, isDatabaseConnected } from ".";
import { desc, eq, and, lt, ilike, sql } from "drizzle-orm";

export async function searchPosts(query: string, limit = 20) {
  if (!isDatabaseConnected) return [];
  return db
    .select()
    .from(posts)
    .where(sql`to_tsvector('english', ${posts.content}) @@ plainto_tsquery('english', ${query})`)
    .orderBy(desc(posts.postedAt))
    .limit(limit);
}
```

**Core AFM-001 pattern to BUILD** (RESEARCH Pattern 2; the ground-truth columns `local_pubkey`/`chan_id`/`timestamp` are confirmed in `00-sanity-checks.sql` lines 28-52). This is the **only** sanctioned latest-channel-state path:
```typescript
// src/lib/read/latest.ts  (server-only via its importers)
import { sql } from "drizzle-orm";
import { dbRouting } from "@/lib/db/warehouse-routing";

// AFM-001: NEVER `WHERE timestamp = (SELECT MAX(timestamp) …)` — that returns ~1 row, not 480.
export async function latestChannelsForNode(localPubkey: string) {
  return dbRouting.execute(sql`
    SELECT DISTINCT ON (chan_id) *
    FROM lnd_node_channel_info
    WHERE local_pubkey = ${localPubkey}
    ORDER BY chan_id, timestamp DESC
  `);
}
```

**ADAPTATIONS:** drop the `isDatabaseConnected` short-circuit (NodeMonitor fails loud at boot instead of degrading); use the `${param}` binding form from `searchPosts` (never string-concat — RESEARCH SQL-injection mitigation). Cross-validate the count vs `lnd_node_info.active_channels` (the golden invariant, see `golden.test.ts`).

---

### `src/lib/read/nodes.ts` (service — unified LND+LDK normalizer)

**Analog:** `../lqwdclaw/src/lib/db/queries.ts` (normalization functions like `MoltbookClient.normalizePost` pattern referenced in CLAUDE.md "Data Normalization" abstraction)

**Core pattern to BUILD** (RESEARCH §F — the per-backend boundary, READ-04):
```typescript
// src/lib/read/nodes.ts
export type Backend = "lnd" | "ldk";
export interface UnifiedNode {
  backend: Backend;
  pubkey: string;
  alias: string | null;
  activeChannels: number;
  inactiveChannels: number;
  pendingChannels: number;
  localBalanceSats: number;   // sat (formatter applied at render, NOT here)
  remoteBalanceSats: number;
}
// mapLndNode(row): UnifiedNode  — from lnd_node_info + latestChannelsForNode() cross-check
// mapLdkNode(row): UnifiedNode  — from lightning_channels/lsps1_orders (columns TBD by introspection)
```
**Rule:** `mapLndNode` / `mapLdkNode` are the **only** translation surface (D-10). UI sees only `UnifiedNode`. Backend-specific fields go in a discriminated union / optional sub-object — never leaked as `any`.

---

### `src/lib/format/units.ts` (utility — AFM-002 formatter)

**Analog:** `../lqwdclaw/src/lib/utils.ts` (pure named-export helpers like `slugify`, `truncate`, `formatRelativeTime`)

**Pattern to match** (`utils.ts` lines 13-49): named exports, single-responsibility pure functions, JSDoc-free brevity (CLAUDE.md: "one sentence" doc, named exports for utilities).

**Core AFM-002 contract to BUILD** (RESEARCH §E — the single source of truth for all sat/BTC/msat math):
```typescript
// src/lib/format/units.ts
const SATS_PER_BTC = 100_000_000;     // 1e8
const MSAT_PER_SAT = 1_000;

/** millisatoshis → satoshis. Always use for any `*_msat` column (never raw `fee`). */
export function feeMsatToSat(msat: bigint | number): number {
  return Number(msat) / MSAT_PER_SAT;
}

/** satoshis → BTC, fixed precision. */
export function formatBtc(sats: bigint | number, dp = 4): string {
  return (Number(sats) / SATS_PER_BTC).toFixed(dp);
}

/** satoshis display with thousands separators. */
export function formatSats(sats: bigint | number): string {
  return Number(sats).toLocaleString("en-US");
}
```
**Rule:** no inline `/1e8` or `* 1000` anywhere else (RESEARCH Anti-Patterns). Accept `bigint | number` (postgres.js int8 handling).

---

### `src/lib/utils.ts` (utility — `cn()`)

**Analog:** `../lqwdclaw/src/lib/utils.ts` lines 1-7 — **copy `cn()` verbatim**, it is the exact workspace convention used by shadcn:
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```
(Skip `hashIP`/`slugify`/`generateSessionToken` — those are lqwdclaw-specific, not needed in Phase 1.)

---

### `drizzle.routing.config.ts` + `drizzle.ldk.config.ts` + `drizzle.nodemon.config.ts` (config)

**Analog:** `../lqwdclaw/drizzle.config.ts` (lines 1-11) — copy the shape exactly:
```typescript
import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/lib/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**REQUIRED ADAPTATIONS:**
1. **Three separate config files**, one per DB, each pointing `schema` at its curated file (`./src/lib/db/schema/routing.ts`, `.../ldk.ts`, `.../nodemon.ts`) and `url` at its env var.
2. **`routing` + `ldk` configs are `pull`-ONLY** (CONTEXT D-02/D-09). They exist solely to bootstrap types via `drizzle-kit pull`; `push`/`migrate` is NEVER run against them. Add a top comment: `// PULL ONLY — never push/migrate against the externally-managed warehouse.`
3. **`drizzle.nodemon.config.ts` is the ONLY config that gets `generate`/`migrate`** (D-08) — give it its own `out: "./drizzle/nodemon"`.
4. Reuse the `import "dotenv/config"` env-loading line verbatim.

---

### `src/instrumentation.ts` + `src/lib/db/health.ts` (boot hook + health service)

**Analog:** none in workspace — lqwdclaw has no `instrumentation.ts` and no boot health check. **Build from RESEARCH §C verbatim.**

**Boot hook** (RESEARCH Next.js boot hook excerpt):
```typescript
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupHealthCheck } = await import("@/lib/db/health");
    await runStartupHealthCheck(); // throws → server fails to start (fail loud)
  }
}
```

**Read-only verification** (RESEARCH §C — key the PASS on SQLSTATE `25006` `read_only_sql_transaction` or `42501` `insufficient_privilege`; validate exact code at impl time, PG 14):
```typescript
// src/lib/db/health.ts  (server-only)
import "server-only";
import { sql } from "drizzle-orm";
// For each warehouse client: a write under default_transaction_read_only must be REJECTED.
await db.transaction(async (tx) => {
  await tx.execute(sql`CREATE TEMP TABLE _ro_probe(x int)`);
});
// Reaching here = write SUCCEEDED = role NOT read-only → throw (fail loud).
```
`health.ts` must also: assert all required env vars present (throw with missing var name), `SELECT 1` against all three DBs (throw on connection failure with DB name), and assert `nodemon` is **writable** (inverse probe — a rolled-back write must succeed).

---

### `db/role-grants.sql` (operator-run config artifact)

**Analog:** none — this is an **operator artifact**, not app code (the app's `nodemon_ro` cannot create roles). **Produce verbatim from RESEARCH §B.** Key elements: `CREATE ROLE nodemon_ro WITH LOGIN`, `ALTER ROLE nodemon_ro SET default_transaction_read_only = on` (belt-and-suspenders that the §C probe keys on), scoped `GRANT SELECT ON <named tables>` (no blanket `GRANT SELECT ON ALL`), run once per warehouse DB. Include the `information_schema.role_table_grants` verification query. Flag A1 (some tables may not exist — confirm via `information_schema.tables` before granting).

---

### Test files (`vitest.config.ts`, `units.test.ts`, `latest.test.ts`, `golden.test.ts`, `health.test.ts`)

**Analog:** none — no test framework exists in the workspace (CLAUDE.md: "Not detected"). **Build from RESEARCH §H + Validation Architecture.**

- `units.test.ts` — assert formatter against the documented reference table (RESEARCH Validation Architecture): `3,359,047,565 sats → "33.5905" BTC`, `feeMsatToSat(1000) === 1`, and back-conversion `BTC × 1e8 ≈ source sats within ±1%`. No DB.
- `latest.test.ts` — assert the helper's emitted SQL contains `DISTINCT ON (chan_id)` + `ORDER BY chan_id, timestamp DESC` and **never** `MAX`. No DB.
- `golden.test.ts` — parameterized loop over `[Canada, Sweden, India]` pubkeys asserting `|distinctCount − active_channels| ≤ max(2, ceil(active_channels*0.02))`. **Live warehouse** — guard with `describe.skipIf(!process.env.ROUTING_VM_DATABASE_URL)` so it skips without network. Canada pubkey: `0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1`; resolve Sweden/India pubkeys via `lnd_node_info` lookup at plan time (RESEARCH Open Q4).
- `health.test.ts` — RO rejection + reachability + writable-nodemon. Live DBs, same env guard.

## Shared Patterns

### `import "server-only"` guard (cross-cutting — every DB/env/secret module)
**Source:** NOT in lqwdclaw (it omits this — a gap NodeMonitor must close). Spec: RESEARCH Pitfall 3 / §I.
**Apply to:** `warehouse-routing.ts`, `warehouse-ldk.ts`, `nodemon.ts`, `env.ts`, `health.ts`.
```typescript
import "server-only"; // FIRST line — build fails if imported into a "use client" module
```

### Fail-loud env contract (cross-cutting — no localhost literals, no dev-DB default)
**Source:** RESEARCH §I. lqwdclaw's `index.ts` does the OPPOSITE (graceful null) — deliberately diverge.
**Apply to:** `env.ts` (the `requireEnv()` thrower) consumed by all three clients + `health.ts`.
- Each DB module reads its URL from env at boot and throws (with the missing var name) if absent.
- No `localhost` string in any source file — the local `nodemon` URL lives ONLY in git-ignored `.env.local` (gitignore pattern confirmed at `../lqwdclaw/.gitignore` lines 34-37: `.env.local`, `.env.*.local`).
- `WAREHOUSE_PG_TXN_POOLER` flag drives `warehousePrepareFlag()` (D-03).

### Named-export utility convention
**Source:** `../lqwdclaw/src/lib/utils.ts` (all helpers are named exports, no default).
**Apply to:** `units.ts`, `utils.ts`, `latest.ts`, `nodes.ts`, `env.ts` (CLAUDE.md: "named exports for utilities, not default").

### `@/` path alias + tsconfig
**Source:** `../lqwdclaw/tsconfig.json` lines 21-23 (`"paths": { "@/*": ["./src/*"] }`), strict mode on, `moduleResolution: "bundler"`. Copy the whole tsconfig; add the Next plugin block as-is.
**Apply to:** all `@/lib/...` imports (CLAUDE.md: "Always use `@/`, never relative paths").

### ESLint + Prettier config
**Source:** `../lqwdclaw/eslint.config.mjs` (flat config: `nextVitals` + `nextTs` + `globalIgnores`) and `../lqwdclaw/.prettierrc` (`semi:true`, `singleQuote:false`, `tabWidth:2`, `trailingComma:"es5"`, `printWidth:100`). Copy both verbatim.
**Apply to:** repo root.

## No Analog Found

Planner: use RESEARCH.md sections directly for these (the cited section is the spec):

| File | Role | Data Flow | Reason | Use Instead |
|------|------|-----------|--------|-------------|
| `src/instrumentation.ts` | provider | event-driven | lqwdclaw has no boot hook | RESEARCH "Next.js boot hook" |
| `src/lib/db/health.ts` | service | request-response | RO-probe is novel to this app | RESEARCH §C |
| `src/lib/db/env.ts` | config | transform | lqwdclaw uses inline `process.env`, no validator | RESEARCH §I |
| `db/role-grants.sql` | config | — | operator artifact, not app code | RESEARCH §B (copy verbatim) |
| `vitest.config.ts` + 4 `*.test.ts` | test/config | — | no test framework in workspace | RESEARCH §H + Validation Architecture |

## Metadata

**Analog search scope:** `../lqwdclaw/` (src/lib/db, src/lib, root config), `../lqwdLogs/` (canada sanity-checks, AFM doc).
**Files scanned:** 11 (lqwdclaw: index.ts, schema.ts, queries.ts, utils.ts, drizzle.config.ts, tsconfig.json, eslint.config.mjs, .prettierrc, .env.example, .gitignore, package.json) + canada `00-sanity-checks.sql`.
**Ground-truth column confirmation:** `local_pubkey`, `pubkey`, `chan_id`, `timestamp`, `active_channels` verified in `../lqwdLogs/canada/.../00-sanity-checks.sql` lines 28-52.
**Key gap closed by NodeMonitor (not in lqwdclaw):** `import "server-only"`, fail-loud env, three-client/three-role split, boot health check, AFM-001/002 centralized guards.
**Pattern extraction date:** 2026-06-07
