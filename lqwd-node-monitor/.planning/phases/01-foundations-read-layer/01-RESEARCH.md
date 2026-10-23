# Phase 1: Foundations + Read Layer - Research

**Researched:** 2026-06-07
**Domain:** Read-only multi-warehouse Drizzle data layer (PostgreSQL 14), Next.js 16 App Router scaffold, analytics-correctness guards (AFM-001/AFM-002), unified LND+LDK node model
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Provision a **dedicated `nodemon_ro`** least-privilege, read-only Postgres role for NodeMonitor (do NOT reuse `grafana_demo_ro`). Independent audit + revocation, clean separation from the Grafana demo. Phase 1 produces the role/grant SQL for the operator to run; SELECT scoped to the tables the read layer needs.
- **D-02:** Read-only is enforced at the **DB role level**, not app convention. `drizzle-kit push`/`migrate` is NEVER pointed at the warehouses — only read-only introspection (`pull`) and live SELECTs.
- **D-03:** **Pooler mode is unknown — probe it in Phase 1.** Detect whether a transaction-mode pooler (PgBouncer) sits in front of `192.243.215.101`; if so set `prepare: false` on that postgres.js client, otherwise leave prepared statements on. Make this a config flag, not a hardcode.
- **D-04:** Validate the read layer against a **reference SET, not a single node**: **Canada** (correctness anchor) + one **Tier M 16 GB** node (**proposed: Sweden**) + one **edge** node (**proposed: India**). Sweden/India are proposed picks — confirm at plan time; any documented Tier M + any edge node is acceptable.
- **D-05:** The read layer reads the **shared warehouse**, not each node's OS, so Canada's different resources are **irrelevant to query/formatter correctness**. The reference set exists for *representativeness*, not because infra differs.
- **D-06:** Assertion method = **live cross-consistency invariant** (not frozen literals): for each reference node assert `DISTINCT ON (chan_id)` latest-state channel count ≈ `lnd_node_info.active_channels`, plus a spot-checked sat→BTC value through the formatter.
- **D-07:** Phase 1 **provisions the `nodemon` Postgres + a least-privilege RW role + wires the third Drizzle client**, but the **queue tables are deferred to Phase 6.** No queue logic in Phase 1.
- **D-08:** `nodemon` runs in a **local Postgres during the build**, with a **config-driven (env) connection URL**. `nodemon` is the ONLY DB `drizzle-kit` ever migrates.
- **D-09:** Build the unified per-node model by **introspecting BOTH warehouses first** — run read-only `drizzle-kit pull` against `routing_vm` AND `ldk-lspd-main`, then hand-curate. Introspection is read-only metadata only: it does not create/alter/drop anything and copies no rows. Generated schema is committed as curated source; throwaway pull artifacts are not.
- **D-10:** **Live `ldk-lspd-main` read access is available now** — design the unified model against both warehouses immediately. Keep a clean per-backend boundary so LND vs LDK column differences are mapped in one place.

### Claude's Discretion
- App scaffolding specifics (Next.js init, npm, `@/` path alias, ESLint/Prettier matching `lqwdclaw`), `.env.local` structure, and `import "server-only"` placement — implement to match sibling `lqwdclaw` conventions.
- The boot-time **read-only verification mechanism** — choose the most reliable approach; requirement is only that it "fails loudly."
- Whether Phase 1 ships a **minimal health/status page** or stays a pure data-layer + test deliverable — left to the planner.

### Deferred Ideas (OUT OF SCOPE)
- **nodemon queue tables + logic** (`commands`/`executions`/`audit`, HMAC, state machine) — Phase 6, by design.
- **Final nodemon hosting location** (warehouse VM vs dedicated) — decided at Phase 6/7; Phase 1 stays local + config-driven.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| READ-01 | Connect both warehouses read-only via env URLs + boot health check that fails loudly if unreachable or not read-only. AC: 3 Drizzle clients on 3 least-privilege roles; read-only at DB role level; `import "server-only"` guards; no `localhost` literals. | §A (three-client pattern), §B (role/grant SQL), §C (boot health check + read-only verify), §I (env contract) |
| READ-02 | All "latest channel state" reads use a single sanctioned `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC` helper — never `MAX(timestamp)`. AC: counts cross-validated vs `lnd_node_info.active_channels`; unit test reproduces Canada channel count. | §D (AFM-001 helper + exact columns), §G (golden invariant test), Validation Architecture |
| READ-03 | All sat/BTC/fee values render through a single unit formatter (`fee_msat/1000.0`, correct sat→BTC). AC: formatter unit-tested against known `lqwdLogs` reference values. | §E (AFM-002 formatter contract + reference values), Validation Architecture |
| READ-04 | LND and LDK node data normalized into one unified per-node model so UI renders both fleets through the same components. | §F (LND vs LDK schema delta + unified model + per-backend boundary) |
</phase_requirements>

## Summary

Phase 1 is a credential-safe read foundation. The stack is already proven in the sibling `lqwdclaw` app and the project research (`.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`) is unusually thorough — this phase research's job is to nail down the **concrete, warehouse-specific facts** the planner needs: exact column names, the role-grant SQL, the pooler-probe procedure, the boot-time read-only verification mechanism, the LND vs LDK schema delta, and the test harness. There is no novel architecture to discover; every structural choice is locked.

Three databases, three Postgres roles, three Drizzle clients: `routing_vm` (LND, RO via new `nodemon_ro`), `ldk-lspd-main` (LDK, RO via `nodemon_ro`), and local `nodemon` (RW, queue tables deferred). The two analytics failure modes are sealed here as a `latestPerChannel` `DISTINCT ON` helper (AFM-001) and a single `feeMsatToSat`/`formatSats`/`formatBtc` formatter module (AFM-002), each unit-tested against real `lqwdLogs` reference values. The warehouse is **PostgreSQL 14** — `DISTINCT ON` is native and well-supported.

**Primary recommendation:** Scaffold Next.js 16.1.6 matching `lqwdclaw` versions exactly; create `src/lib/db/{warehouse-routing,warehouse-ldk,nodemon}.ts` server-only Drizzle singletons each from its own `postgres()` client reading an env URL; bootstrap schema via one-time `drizzle-kit pull` then hand-curate into read-only schema files with AFM table annotations; centralize the `DISTINCT ON (chan_id)` helper and the unit formatter as the only sanctioned paths; add a boot-time health module (called from `instrumentation.ts`) that pings all three DBs and verifies warehouse read-only by attempting a trivial write inside an aborted transaction and asserting rejection; use **Vitest 4.x** for the AFM/formatter unit tests. Produce `nodemon_ro` role/grant SQL as an operator-run artifact (Phase 1 does not have privileges to run it).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Warehouse SELECT reads | API / Backend (RSC + server-only modules) | Database (role enforces RO) | Connection strings + DB access must never reach the client bundle; RSC runs server-side only. |
| Read-only enforcement | Database (role grants) | API (server-only guard) | D-02 locks this at the DB **role**; app code is belt-and-suspenders, not the boundary. |
| Latest-channel-state query (AFM-001) | API / Backend (one Drizzle helper) | Database (`DISTINCT ON`) | Centralized so no `MAX(timestamp)` can slip in; SQL idiom runs in PG 14. |
| Unit formatting (AFM-002) | API / Backend (shared TS module) | — | Pure function, runs anywhere, but imported by server reads; UI calls it on already-serializable values. |
| Unified LND+LDK model | API / Backend (normalizer module) | — | Per-backend mapping lives in one place; UI consumes one shape. |
| Boot-time health check | Frontend Server (instrumentation hook) | Database (reachability + RO probe) | Next.js `instrumentation.ts` runs once at server startup — the correct fail-loud placement. |
| Env/config contract | API / Backend (config loader, server-only) | — | All host-specific values env-injected; no `localhost` literals — sets the local→VM contract. |
| nodemon RW client (wired only) | API / Backend | Database (RW role, no tables yet) | D-07: client exists + health-checked; tables land Phase 6. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.1.6 | App Router UI + RSC + API | Matches `lqwdclaw` exactly [VERIFIED: lqwdclaw/package.json + `npm view next@16.1.6` = 16.1.6]. Long-running `next start` on a VM (not serverless) holds stable pools. |
| react / react-dom | 19.2.3 | UI runtime | Mandated by Next 16; `react-dom` MUST equal `react` [VERIFIED: lqwdclaw/package.json]. |
| typescript | ^5 | Types, strict mode, `@/` alias | Workspace convention [VERIFIED: lqwdclaw/package.json]. |
| drizzle-orm | ^0.45.1 | Typed SQL over existing tables | Workspace standard; used as a typed query builder, NOT a schema owner for warehouses [VERIFIED: lqwdclaw/package.json; `npm view drizzle-orm` latest = 0.45.2]. |
| drizzle-kit | ^0.31.9 | `pull` introspection + `nodemon` migrations only | `pull` once per warehouse (read-only metadata); `generate`/`migrate` ONLY for `nodemon` [VERIFIED: lqwdclaw/package.json; `npm view drizzle-kit` latest = 0.31.10]. |
| postgres (postgres.js) | ^3.4.8 | Postgres driver | The driver `lqwdclaw` pairs with Drizzle; built-in pool [VERIFIED: lqwdclaw/package.json; `npm view postgres` latest = 3.4.9]. |
| server-only | 0.0.1 | Build-time client-import guard for DB/secret modules | Importing a `server-only` module from a client component fails the build [VERIFIED: `npm view server-only` = 0.0.1]. Not currently in lqwdclaw deps — add it. |
| tailwindcss + @tailwindcss/postcss | ^4 | Styling, CSS-first `@theme` | Workspace default; navy `#1A3C79` brand token [VERIFIED: lqwdclaw/package.json]. |
| shadcn (CLI) | ^4.0.2 | Component primitives | Full Tailwind v4 + React 19 support; `npx shadcn@latest` (NOT `@canary`) [VERIFIED: lqwdclaw/package.json]. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^4.1.8 | Unit-test runner for AFM helper + formatter | No test framework exists in workspace (CLAUDE.md: "Not detected"). Vitest is the recommended runner — see §H [VERIFIED: `npm view vitest` = 4.1.8]. |
| dotenv | ^17.3.1 | Local env loading | Config-driven DB URLs; local→VM flip is env-only [VERIFIED: lqwdclaw devDeps]. |
| clsx + tailwind-merge | ^2.1.1 / ^3.5.0 | `cn()` helper | Workspace `@/lib/utils` convention [VERIFIED: lqwdclaw/package.json]. |
| lucide-react | ^0.577.0 | Icons (if a status page ships) | shadcn default icon set [VERIFIED: lqwdclaw/package.json]. |
| tw-animate-css | ^1.4.0 | Animations under Tailwind v4 | v4-compatible; NOT `tailwindcss-animate` [VERIFIED: lqwdclaw/package.json]. |
| recharts | 3.8.1 | Time-series charts (later phases; install now if convenient) | Native React 19 peer support; not strictly required for Phase 1 unless a status page charts something [VERIFIED: `npm view recharts` = 3.8.1; STACK.md §2]. |

> **date-fns / zod / ai / @ai-sdk/anthropic** are project-stack libraries (STACK.md) but **not needed in Phase 1** — they belong to later phases (time-bucketing, queue param validation, LLM narrative). Do not install in Phase 1 unless a concrete Phase 1 use appears.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest | `node:test` (built-in) | No dep, but no Vite/TS-ESM transform out of the box, weaker watch/UI, and the team will want a real runner for later UI-component tests. Vitest is the workspace-forward choice. |
| postgres.js | node-postgres (`pg`) | `pg`-ecosystem tooling, but two driver mental models; `lqwdclaw` already standardizes on postgres.js. |
| `instrumentation.ts` boot hook | Lazy first-request check | A first-request check doesn't "fail loudly at boot"; instrumentation runs once at startup (the success-criteria intent). |

**Installation:**
```bash
# Scaffold (match lqwdclaw versions)
npm install next@16.1.6 react@19.2.3 react-dom@19.2.3 \
  drizzle-orm postgres server-only \
  clsx tailwind-merge lucide-react tw-animate-css

npm install -D typescript@^5 @types/node@^20 @types/react@^19 @types/react-dom@^19 \
  drizzle-kit dotenv eslint@^9 eslint-config-next@16.1.6 prettier \
  tailwindcss@^4 @tailwindcss/postcss@^4 \
  vitest@^4

# shadcn (Tailwind v4 + React 19 — canary NOT required)
npx shadcn@latest init
npx shadcn@latest add card table badge button   # chart only if a status page graphs
```

**Version verification:** All versions above confirmed via `npm view <pkg> version`/`latest` on 2026-06-07 against the npm registry, and cross-checked against `../lqwdclaw/package.json` (the authoritative local truth). Pin to the `lqwdclaw` ranges to keep the workspace consistent; the registry `latest` (e.g., drizzle-orm 0.45.2) is compatible within range.

## Package Legitimacy Audit

> All packages are already in production use in the sibling `lqwdclaw` app within this same workspace (`../lqwdclaw/package.json`), which is the strongest possible provenance — they are not discovered from search. `server-only` and `vitest` are the only additions not already in lqwdclaw; both are first-party/well-known. slopcheck was not run (offline tooling); provenance is the in-workspace production lockfile instead.

| Package | Registry | Provenance | Source Repo | Disposition |
|---------|----------|-----------|-------------|-------------|
| next | npm | lqwdclaw prod | github.com/vercel/next.js | Approved |
| react / react-dom | npm | lqwdclaw prod | github.com/facebook/react | Approved |
| drizzle-orm / drizzle-kit | npm | lqwdclaw prod | github.com/drizzle-team/drizzle-orm | Approved |
| postgres | npm | lqwdclaw prod | github.com/porsager/postgres | Approved |
| tailwindcss / @tailwindcss/postcss | npm | lqwdclaw prod | github.com/tailwindlabs/tailwindcss | Approved |
| shadcn | npm | lqwdclaw prod | github.com/shadcn-ui/ui | Approved |
| clsx / tailwind-merge / lucide-react / tw-animate-css | npm | lqwdclaw prod | (respective official repos) | Approved |
| server-only | npm | React/Next first-party (published by Vercel/React) | part of react ecosystem | Approved — verify `npm view server-only` before install |
| vitest | npm | de-facto Vite test runner | github.com/vitest-dev/vitest | Approved — verify `npm view vitest` before install |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time; however every package is gated by the in-workspace `lqwdclaw` production lockfile, which is a stronger guarantee than a registry-existence check. The planner may still add a `checkpoint:human-verify` before `npm install` if desired, but it is low-value here.*

## Architecture Patterns

### System Architecture Diagram

```
                          NodeMonitor (Next.js 16, local host, `next start`)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  instrumentation.ts (boot)                                                      │
  │      └─► healthCheck(): ping 3 DBs + verify warehouse read-only ─── FAIL LOUD   │
  │                                                                                  │
  │  RSC pages / route handlers (server-only)                                        │
  │      │  import normalized read functions                                         │
  │      ▼                                                                            │
  │  src/lib/db/                                                                      │
  │   ┌─────────────────────────┐  ┌──────────────────────┐  ┌────────────────────┐ │
  │   │ warehouse-routing.ts    │  │ warehouse-ldk.ts     │  │ nodemon.ts          │ │
  │   │ dbRouting (RO)          │  │ dbLdk (RO)           │  │ dbNodemon (RW)      │ │
  │   └───────────┬─────────────┘  └──────────┬───────────┘  └─────────┬──────────┘ │
  │   src/lib/read/                            │                        │            │
  │     latestPerChannel() ◄── AFM-001 helper  │            (no tables yet — Phase 6)│
  │     normalizeNode()    ◄── unified model ──┘                        │            │
  │   src/lib/format/units.ts ◄── AFM-002 formatter (feeMsatToSat/formatSats/Btc)    │
  └───────────┬──────────────────────────┬───────────────────────────┬─────────────┘
   role:      │ SELECT (nodemon_ro)      │ SELECT (nodemon_ro)        │ RW (nodemon_rw)
              ▼                          ▼                            ▼
   ┌──────────────────────┐   ┌──────────────────────┐    ┌────────────────────────┐
   │ routing_vm (LND)     │   │ ldk-lspd-main (LDK)  │    │ nodemon (local PG)     │
   │ 192.243.215.101 PG14 │   │ 192.243.215.101 PG14 │    │ env URL, RW role       │
   │ lnd_node_info, …     │   │ lightning_channels,… │    │ (empty in Phase 1)     │
   └──────────────────────┘   └──────────────────────┘    └────────────────────────┘
```

Primary use case trace: an RSC page calls `normalizeNode(pubkey)` → which calls `latestPerChannel()` (AFM-001 `DISTINCT ON`) against `dbRouting`/`dbLdk` → maps raw rows through the per-backend boundary → every sat/fee field rendered via `units.ts` (AFM-002) → returns a serializable unified node object to the component.

### Recommended Project Structure (match lqwdclaw `@/` → `./src/*`)
```
src/
├── instrumentation.ts          # Next.js boot hook → calls healthCheck()
├── lib/
│   ├── db/
│   │   ├── env.ts              # server-only: parse + assert required DB URLs, no localhost literals
│   │   ├── warehouse-routing.ts # server-only: dbRouting singleton (RO), prepare flag from config
│   │   ├── warehouse-ldk.ts    # server-only: dbLdk singleton (RO)
│   │   ├── nodemon.ts          # server-only: dbNodemon singleton (RW); no tables yet
│   │   ├── health.ts           # server-only: ping 3 DBs + read-only verify
│   │   └── schema/
│   │       ├── routing.ts      # hand-curated from drizzle-kit pull; AFM annotations
│   │       ├── ldk.ts          # hand-curated from drizzle-kit pull
│   │       └── nodemon.ts      # owned by drizzle-kit migrate (empty/placeholder in Phase 1)
│   ├── read/
│   │   ├── latest.ts           # latestPerChannel() — the ONLY sanctioned DISTINCT ON helper
│   │   └── nodes.ts            # normalizeNode() unified LND+LDK model + per-backend mapping
│   └── format/
│       └── units.ts            # feeMsatToSat / formatSats / formatBtc — AFM-002 single source
├── lib/utils.ts                # cn() helper (lqwdclaw convention)
└── app/
    └── (status)/page.tsx       # OPTIONAL thin health/status page (Claude's discretion)
drizzle.routing.config.ts        # pull-only; points at routing_vm RO  (NEVER push/migrate)
drizzle.ldk.config.ts            # pull-only; points at ldk-lspd-main RO (NEVER push/migrate)
drizzle.nodemon.config.ts        # the ONLY config with generate/migrate
db/role-grants.sql               # operator-run: CREATE ROLE nodemon_ro + GRANTs (§B)
vitest.config.ts
```

### Pattern 1: Three separate Drizzle clients, three roles, three env URLs
**What:** One `postgres()` client + one `drizzle()` instance per database, each in its own server-only module. No module imports both a warehouse handle and a write handle.
**When to use:** Always here — D-07/D-09 + ARCHITECTURE.md §3.
**Example:**
```ts
// src/lib/db/warehouse-routing.ts
import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/routing";
import { requireEnv, warehousePrepareFlag } from "./env";

// Module-level singleton; dev hot-reload guard prevents pool leaks (drizzle-orm#1988).
const globalForDb = globalThis as unknown as { _routingSql?: postgres.Sql };
const sql =
  globalForDb._routingSql ??
  postgres(requireEnv("ROUTING_VM_DATABASE_URL"), {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: warehousePrepareFlag(), // false if PgBouncer txn-mode pooler detected (D-03)
    // ssl: "prefer"  // server has no SSL configured; plaintext fallback (per grafana-demo-vm.txt)
  });
if (process.env.NODE_ENV !== "production") globalForDb._routingSql = sql;

export const dbRouting = drizzle(sql, { schema });
```
**Note:** The warehouse host has **no SSL** (`grafana-demo-vm.txt`: "server has no SSL configured; plaintext fallback"; memory: use `sslmode=prefer`). Put `?sslmode=prefer` in the URL or `ssl: "prefer"` in options; do not force SSL.

### Pattern 2: AFM-001 latest-per-channel helper (the only sanctioned latest-state query)
**What:** A single `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC` helper. PostgreSQL 14 supports `DISTINCT ON` natively. See §D for exact columns.
**When to use:** Every read of an event-driven table (`lnd_node_channel_info`, `lnd_node_peer_info`, `lnd_node_pending_channels`, `lnd_node_pending_sweeps`).
**Example (raw SQL via Drizzle `sql` tag — clearest for `DISTINCT ON`):**
```ts
// src/lib/read/latest.ts  (server-only via its importers)
import { sql } from "drizzle-orm";
import { dbRouting } from "@/lib/db/warehouse-routing";

// AFM-001: NEVER `WHERE timestamp = (SELECT MAX(timestamp) …)`. That returns ~1 row.
export async function latestChannelsForNode(localPubkey: string) {
  return dbRouting.execute(sql`
    SELECT DISTINCT ON (chan_id) *
    FROM lnd_node_channel_info
    WHERE local_pubkey = ${localPubkey}
    ORDER BY chan_id, timestamp DESC
  `);
}
```

### Pattern 3: AFM-002 single unit formatter
**What:** One module owns sat→BTC (`/1e8`) and msat→sat (`/1000`). No ad-hoc conversion anywhere. See §E.
**When to use:** Every displayed sat/BTC/fee value.

### Pattern 4: Boot-time fail-loud health + read-only verification
**What:** `instrumentation.ts` calls a health module at server startup that (a) pings all three DBs and (b) verifies each warehouse client is read-only by attempting a write inside a rolled-back transaction and asserting Postgres rejects it. See §C.

### Anti-Patterns to Avoid
- **`WHERE timestamp = MAX(timestamp)` on event-driven tables** (AFM-001) — returned 1 channel instead of 480 in the real Canada review. Use the helper.
- **Inline sat→BTC or raw `fee`** (AFM-002) — 10×/1000× errors. Use the formatter; `fee_msat/1000.0`, never `fee`.
- **One Drizzle client "be careful not to write"** — separate clients + RO role; a stray write must error at Postgres.
- **`drizzle-kit push`/`migrate` against a warehouse** — only `pull` (read-only) touches them; migrate only `nodemon`.
- **Reading a DB URL/secret in a `"use client"` file or passing it as a prop** — `import "server-only"` on every DB/env module.
- **Defaulting a missing env var to a dev DB** — fail loud on missing required env; no `localhost` literals.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest-state-per-entity selection | A bespoke `MAX(timestamp)` subquery per query | The one `DISTINCT ON (chan_id)` helper | AFM-001: hand-rolled `MAX` is the exact documented failure (1 row vs 480). |
| Unit conversion | Inline `/1e8` or `* 1000` scattered in components | `units.ts` formatter, unit-tested | AFM-002: scattered math drifts 10×/1000× per view. |
| Read-only safety | App-code "don't write" discipline | A SELECT-only Postgres role (`nodemon_ro`) | D-02: a code bug then errors at the DB, not in production data. |
| Client/server secret boundary | Manual "remember not to import" | `import "server-only"` | Build fails if a DB/secret module is imported client-side. |
| Warehouse type definitions | Hand-typing 13 tables from memory | `drizzle-kit pull` once, then hand-curate | Gets real column names/types right; curate to add AFM annotations + drop noise. |
| DB pool management | Custom connection pooling | postgres.js built-in pool (`max: 5`) | Long-running `next start`; serverless pool horror stories don't apply. |
| Test runner | A custom assert script | Vitest | Real watch/TS-ESM/coverage; team will reuse it for component tests. |

**Key insight:** The two highest-value deliverables of this phase are *guardrails against known, operator-documented failures*, not features. The `DISTINCT ON` helper and the formatter must be the **only** code path — centralization is the prevention, not the convenience.

## Runtime State Inventory

> Greenfield app build — but it consumes externally-managed live warehouses, so the "what state already exists" question still applies to the data sources and the role provisioning.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data (warehouses) | `routing_vm` + `ldk-lspd-main` on `192.243.215.101` (PG 14), externally-managed and event-driven. NodeMonitor reads only — **introspects metadata, copies no rows** (D-09). | Read-only `drizzle-kit pull` for types; never write/migrate. |
| Live service config | The warehouse is the same one the demo Grafana mirror (`64.23.131.62`) reads. **IP whitelist on the warehouse:** only the operator laptop IP + demo droplet are allowed by `pg_hba.conf` + firewall (memory: "New client IPs need operator-side firewall + pg_hba.conf grant"). | **Operator action required:** if NodeMonitor runs from a new host/VM, the operator must whitelist that IP and grant `nodemon_ro` in `pg_hba.conf`. Flag as a plan dependency. |
| OS-registered state | None — greenfield Next.js app, no cron/systemd/scheduler in Phase 1 (heartbeat is Phase 7). | None. |
| Secrets/env vars | New env vars only: `ROUTING_VM_DATABASE_URL`, `LDK_LSPD_DATABASE_URL`, `NODEMON_QUEUE_URL`, plus a pooler-mode flag (§A/§I). `nodemon_ro` password is operator-generated. No existing secret reused (D-01: NOT reusing `grafana_demo_ro`). | Operator creates `nodemon_ro` + password; place URLs in git-ignored `.env.local`. |
| Build artifacts | `drizzle-kit pull` will emit throwaway schema/meta/migration files. | Curate the table defs into `schema/*.ts`; **delete the generated migration/meta artifacts** so they never imply the warehouses are Drizzle-owned (STACK.md §1). |

**Nothing found in OS-registered state:** None — verified; Phase 1 adds no scheduled jobs.

## Common Pitfalls

### Pitfall 1: AFM-001 — `MAX(timestamp)` on event-driven warehouse tables
**What goes wrong:** A 480-channel node renders as a 1-channel node; every downstream count is wrong.
**Why it happens:** The table *looks* like a snapshot (has a `timestamp`, one row per channel) but is an append-only event log — different channels update at different moments.
**How to avoid:** The `latestPerChannel` `DISTINCT ON (chan_id)` helper is the only sanctioned path; cross-validate against `lnd_node_info.active_channels` (a TRUE snapshot). Annotate affected vs not-affected tables in `schema/routing.ts` as comments.
**Warning signs:** A query returns single digits where domain knowledge says hundreds; channel count disagrees with `lnd_node_info.active_channels`.
**Affected tables:** `lnd_node_channel_info`, `lnd_node_peer_info`, `lnd_node_pending_channels`, `lnd_node_pending_sweeps`.
**NOT affected (`MAX`/per-row fine):** `lnd_node_info` (true snapshot), `lnd_node_closed_channels` (one row per close event). [CITED: lqwdLogs/_library/analytical-failure-modes.md]

### Pitfall 2: AFM-002 — sat→BTC and msat→sat conversion errors
**What goes wrong:** sat→BTC eyeballed → 10× off (3.36 BTC reported vs 33.6 BTC actual); using `fee` instead of `fee_msat/1000.0` → 1000× off.
**How to avoid:** One formatter module, unit-tested against the documented reference values (§E). Forbid raw `fee` and inline sat→BTC anywhere. Back-conversion assertion: displayed BTC × 100,000,000 must equal source sat within ±1%.
**Warning signs:** A headline figure feels an order of magnitude off; two views disagree by 10×/1000×. [CITED: lqwdLogs/_library/analytical-failure-modes.md]

### Pitfall 3: Accidental warehouse write / DB cred leak to the client
**What goes wrong:** A query function issues a write against a production analytics DB; or a connection string lands in a client bundle.
**How to avoid:** Read-only at the `nodemon_ro` role (a stray write errors at Postgres); no migration config points at a warehouse; `import "server-only"` on every DB/env module; no `NEXT_PUBLIC_` secrets. [CITED: .planning/research/PITFALLS.md Pitfall 12]
**Warning signs:** Any `INSERT/UPDATE/DELETE` in a warehouse query function; a migration config referencing `routing_vm`/`ldk-lspd-main`; `process.env` DB access in a `"use client"` module.

### Pitfall 4: Dev hot-reload pool leak ("too many connections")
**What goes wrong:** Next.js dev re-runs module init on hot reload, opening new pools each time.
**How to avoid:** Module-level singleton cached on `globalThis` in dev (Pattern 1); small `max: 5`. [CITED: drizzle-orm#1988]
**Note:** The warehouse already restricts connections by IP whitelist — a leak could exhaust the operator's allowed slots.

### Pitfall 5: PgBouncer transaction-mode pooler breaks prepared statements
**What goes wrong:** If `192.243.215.101` is fronted by a txn-mode pooler, postgres.js prepared statements fail with protocol/`prepared statement does not exist` errors.
**How to avoid:** Probe the connection mode (§A); set `prepare: false` via the config flag if a txn-mode pooler is present (D-03). Default (prepared on) for a direct connection. [CITED: STACK.md §1 / Stack Patterns by Variant]

### Pitfall 6: Wrong pubkey column per table
**What goes wrong:** Forwards use `lnd_pubkey`; channel/closed/pending tables use `local_pubkey`; node-info uses `pubkey`. Using the wrong one silently returns zero rows.
**How to avoid:** Lock the per-table identity columns in the curated schema (§D); the `00-sanity-checks.sql` and the memory file are the ground truth. [CITED: lqwdLogs/canada/.../00-sanity-checks.sql; reference_lqwd_databases memory]

## Code Examples

### AFM-002 formatter contract (the single source)
```ts
// src/lib/format/units.ts
const SATS_PER_BTC = 100_000_000;     // 1e8
const MSAT_PER_SAT = 1_000;

/** millisatoshis → satoshis. Always use for any `*_msat` column (never raw `fee`). */
export function feeMsatToSat(msat: bigint | number): number {
  return Number(msat) / MSAT_PER_SAT;
}

/** satoshis → BTC, fixed precision. Source: AFM-002 reference values. */
export function formatBtc(sats: bigint | number, dp = 4): string {
  return (Number(sats) / SATS_PER_BTC).toFixed(dp);
}

/** satoshis display with thousands separators. */
export function formatSats(sats: bigint | number): string {
  return Number(sats).toLocaleString("en-US");
}
```
> postgres.js returns large integers as JS `number` for `int8`/`bigint` unless configured; for 9–12 digit sat values within `Number.MAX_SAFE_INTEGER` (~9e15) this is safe, but accept `bigint | number` to be future-proof. Verify the driver's bigint handling during implementation.

### Boot-time read-only verification (fail-loud probe)
```ts
// src/lib/db/health.ts  (server-only)
import "server-only";
import { sql } from "drizzle-orm";
import { dbRouting } from "./warehouse-routing";
import { dbLdk } from "./warehouse-ldk";
import { dbNodemon } from "./nodemon";

async function assertReadOnly(db: typeof dbRouting, name: string) {
  // Attempt a write inside a transaction we always roll back.
  // A SELECT-only role rejects this with a privilege error → that's the PASS.
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE _ro_probe (x int)`); // needs no table grants
      throw new Error("__rollback__");
    });
    throw new Error(`${name}: write was NOT rejected — role is not read-only`);
  } catch (e) {
    const msg = String((e as Error).message);
    if (msg.includes("__rollback__")) {
      // TEMP table creation succeeded → role can write → FAIL LOUD
      throw new Error(`${name}: warehouse role permits writes (read-only NOT enforced)`);
    }
    // privilege/permission error → read-only confirmed → swallow, this is success
  }
}
```
> **Mechanism recommendation (resolves Claude's-discretion item):** prefer the **attempt-a-write-and-assert-rejection** probe over inspecting `pg_roles`/grants — it tests the *effective* permission the client actually has (catches a wrong-role connection string), is independent of which tables are granted, and fails closed. Run it for both warehouse clients at boot. For `nodemon` (RW), assert the opposite (a write *succeeds* in a rolled-back txn). NOTE: with `default_transaction_read_only` set on the role (§B), even `CREATE TEMP TABLE` is blocked — that is the cleanest signal; validate the exact error string during implementation and key the PASS on the read-only error, not on table-grant errors.

### Next.js boot hook
```ts
// src/instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartupHealthCheck } = await import("@/lib/db/health");
    await runStartupHealthCheck(); // throws → server fails to start (fail loud)
  }
}
```
> `instrumentation.ts` runs once when the server process starts (Next.js stable since 15). Throwing here is the "fails loudly" mechanism the success criteria require. [CITED: Next.js instrumentation docs]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `npx shadcn@canary` for Tailwind v4 | `npx shadcn@latest` | Feb 2025 | Canary no longer needed; GA on v4 + React 19. |
| `tailwindcss-animate` | `tw-animate-css` | Tailwind v4 | Old plugin incompatible with v4 engine. |
| `react-is` override for Recharts on React 19 | Recharts 3.x (native peer) | Recharts 3.0 | No override needed (only relevant if charts ship). |
| `LanguageModelV1` / `toDataStreamResponse` | `LanguageModel` / `generateText` | AI SDK v6 | Not used in Phase 1, but noted for consistency. |
| Drizzle owning warehouse schema via `push` | `pull`-bootstrap + hand-curated read-only schema | project decision | Prevents re-introducing AFM-001 via auto-regen. |

**Deprecated/outdated:** `tailwind.config.js` (Tailwind v4 is CSS-first `@theme` in `globals.css`); do not create one.

## Open Questions (RESOLVED)

1. **Pooler mode at `192.243.215.101` (D-03)**
   - What we know: warehouse is PG 14, no SSL, IP-whitelisted; demo Grafana connects directly with `sslmode=prefer`. The grafana datasource config shows a direct host:port (`192.243.215.101:5432`), no `:6432`/pooler port.
   - What's unclear: whether a transaction-mode PgBouncer is actually in front. **Probe procedure in §A.** The fact that Grafana connects on `:5432` directly is weak evidence of a direct connection, but not conclusive.
   - Recommendation: implement `prepare` as a config flag defaulting to `true`; run the §A probe at plan/implementation time; flip to `false` only if the probe shows txn-mode pooling. Document the result in the plan.

2. **Exact `nodemon_ro` table grant scope (D-01)**
   - What we know: memory enumerates 9 routing_vm + 4 ldk tables granted to `grafana_demo_ro`; the demo Grafana *datasource* line only lists 3 (`lnd_node_forwards`, `lnd_node_info`, `price_usd_cad`) because that's all that dashboard uses.
   - What's unclear: precisely which tables the Phase 1 read layer needs vs the full fleet feature set. Phase 1 needs `lnd_node_info`, `lnd_node_channel_info` (the two for the golden invariant). The full READ layer + later phases need the broader set.
   - Recommendation: §B grants the **read-layer set** (the 9+4 the project will use), since `nodemon_ro` is a one-time operator artifact and broadening it later is friction. Scope to those tables explicitly (no blanket `GRANT SELECT ON ALL`).

3. **LDK warehouse identity/timestamp columns (D-09/D-10)**
   - What we know: `ldk-lspd-main` granted tables are `lsps1_orders`, `lightning_channels`, `payments`, `transactions`. No `lqwdLogs` query files exercise these (none found in the repo).
   - What's unclear: exact column names of `lightning_channels` (channel id, local/remote balance, peer pubkey, state) — must come from `drizzle-kit pull` / `information_schema` introspection, NOT assumed.
   - Recommendation: the FIRST implementation task must run the §F introspection query against `lightning_channels` (and `lsps1_orders`) to ground the unified-model mapping. Do not hardcode LDK columns from training data. [ASSUMED] for any LDK column shape until introspected.

4. **Reference node pubkeys for Sweden + India (D-04)**
   - What we know: Canada pubkey is `0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1` (from `00-sanity-checks.sql`). Sweden/India are *proposed* picks.
   - What's unclear: their exact pubkeys. The golden-invariant test is parameterized (D-06 live cross-consistency), so it works for any node — but the test needs the actual pubkeys.
   - Recommendation: at plan time, run `SELECT DISTINCT alias, pubkey FROM lnd_node_info WHERE alias ILIKE '%sweden%'/'%india%'` to resolve pubkeys; confirm picks with operator. The test asserts the *invariant* (count ≈ active_channels), not a frozen number, so it tolerates live drift and offline/zero-activity edge nodes.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Next.js 16 / Drizzle | Expected (workspace runs lqwdclaw) | 20+ | none — blocking |
| npm | install | Expected | — | none |
| PostgreSQL 14 warehouses (`routing_vm`, `ldk-lspd-main`) @ 192.243.215.101 | All warehouse reads | Reachable ONLY from whitelisted IPs | PG 14 | none — operator must whitelist the run host's IP + grant `nodemon_ro` (see Runtime State Inventory) |
| Local PostgreSQL for `nodemon` | D-07 third client + health check | Operator must provide | — | Docker `postgres` container; env URL points at it (D-08) |
| `psql` (for probe + role-grant SQL) | §A pooler probe, §B operator-run grants | Likely (operator uses it for `00-sanity-checks.sql`) | — | any PG client |

**Missing dependencies with no fallback:**
- Network access to `192.243.215.101` from the NodeMonitor host. If running from a new host/VM, the operator MUST add it to the warehouse firewall + `pg_hba.conf` before the boot health check can pass. **This is a hard plan dependency.**

**Missing dependencies with fallback:**
- Local `nodemon` Postgres — if not installed locally, run a `postgres:16` Docker container; the env URL makes this transparent (D-08).

## Validation Architecture

> nyquist_validation is enabled (`.planning/config.json` workflow.nyquist_validation = true). This section drives the phase VALIDATION.md.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (new — no test framework currently in workspace) |
| Config file | `vitest.config.ts` — Wave 0 creates it |
| Quick run command | `npx vitest run src/lib/format` (formatter only, < 5s, no DB) |
| Full suite command | `npx vitest run` (formatter + AFM helper + golden invariant; the invariant tests hit the live warehouse) |

### Critical Correctness Signals (this phase) → Test Map
| Signal | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AFM-002 formatter | `feeMsatToSat`, `formatBtc`, `formatSats` correct vs documented reference values | unit (no DB) | `npx vitest run src/lib/format/units.test.ts` | ❌ Wave 0 |
| AFM-001 helper shape | `latestPerChannel` emits `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC`, never `MAX` | unit (SQL-string / query-builder assertion) | `npx vitest run src/lib/read/latest.test.ts` | ❌ Wave 0 |
| Golden invariant (READ-02 AC) | For each reference node: `DISTINCT ON` channel count ≈ `lnd_node_info.active_channels` | integration (live warehouse) | `npx vitest run src/lib/read/golden.test.ts` | ❌ Wave 0 |
| Read-only enforcement | warehouse write attempt is rejected; `nodemon` write succeeds | integration (live DBs) | `npx vitest run src/lib/db/health.test.ts` | ❌ Wave 0 |
| Boot health check | missing env / unreachable DB / writable warehouse → throws at boot | integration | covered by `health.test.ts` | ❌ Wave 0 |

### Reference values for the AFM-002 formatter unit test (from analytical-failure-modes.md)
| Source sats | Expected BTC | Note |
|---|---|---|
| 3,359,047,565 | 33.5905 (≈33.6) | Canada capacity |
| 2,398,147,951 | 23.9815 (≈24) | Canada local balance |
| 30,041,489,086 | 300.4149 (≈300) | Canada routing volume |
| 47,271,912,611 | 472.7191 (≈470) | rebalance attempted |
| 32,112,853,476 | 321.1285 (≈321) | moved through SouthAfrica |

For `feeMsatToSat`: assert `feeMsatToSat(1000) === 1` and that fee totals use `fee_msat/1000.0` (a known forwards `fee_msat` sum vs its `/1000` sat value).

### Golden invariant expression (parameterized — same test across all reference nodes, D-06)
```ts
// pseudocode — runs for [Canada, Sweden, India] pubkeys
for (const node of REFERENCE_NODES) {
  const distinctCount = (await latestActiveChannels(node.pubkey)).length;
  const snapshot = await latestNodeInfo(node.pubkey); // lnd_node_info active_channels
  // tolerance handles live drift + a channel mid-state-change; offline/zero nodes pass at 0≈0
  expect(Math.abs(distinctCount - snapshot.active_channels))
    .toBeLessThanOrEqual(Math.max(2, Math.ceil(snapshot.active_channels * 0.02)));
}
```
> The assertion is the **invariant** (D-06), not a frozen literal, so it survives live data drift and naturally exercises the edge node (an offline India with 0 active channels passes `0 ≈ 0`; a churning node passes within tolerance). Tune tolerance during implementation against observed drift.

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/format` (fast, no DB) + the AFM helper unit test.
- **Per wave merge:** `npx vitest run` (full, includes live-warehouse invariant + read-only checks — requires network to the warehouse).
- **Phase gate:** full suite green + boot health check passes against the real warehouses before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `vitest.config.ts` + Vitest install (no framework currently exists)
- [ ] `src/lib/format/units.test.ts` — AFM-002 reference values (READ-03)
- [ ] `src/lib/read/latest.test.ts` — AFM-001 helper shape (READ-02)
- [ ] `src/lib/read/golden.test.ts` — live cross-consistency invariant across reference nodes (READ-02 AC)
- [ ] `src/lib/db/health.test.ts` — read-only rejection + reachability (READ-01)
- [ ] Test env wiring: the live-warehouse tests need the `nodemon_ro` URL in the test env; gate them behind an env guard so they skip cleanly if the warehouse is unreachable (CI without network).

## Security Domain

> `security_enforcement` is not explicitly disabled in config → treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth in Phase 1 (single-operator local tool). |
| V3 Session Management | no | No sessions in Phase 1. |
| V4 Access Control | yes | DB-role least privilege: `nodemon_ro` SELECT-only (D-01/D-02); `nodemon_rw` scoped to the `nodemon` DB only. |
| V5 Input Validation | partial | Phase 1 reads are parameterized via Drizzle (`sql` tag bindings) — no user-supplied input to validate yet; pubkeys are constants/config. zod arrives with queue params in Phase 6. |
| V6 Cryptography | no | HMAC signing is Phase 6; none in Phase 1. |
| V7 Error Handling / Logging | yes | Boot health check fails loud; never log connection strings or the `nodemon_ro` password (CLAUDE.md: never log secrets). |
| V14 Configuration | yes | Secrets only via env/`.env.local` (git-ignored); `import "server-only"`; no `NEXT_PUBLIC_` secret; no `localhost` literals (HARDEN-02 contract starts here). |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection | Tampering | Drizzle `sql` tag parameter binding / query builder — never string-concatenate identifiers or values. |
| Accidental warehouse write | Tampering | `nodemon_ro` SELECT-only role + boot read-only verification (Pitfall 3, §C). |
| Conn-string/secret leak to client bundle | Information Disclosure | `import "server-only"` on every DB/env module; no secret in a `"use client"` file or prop; grep build output for the host string. |
| Privilege creep on the warehouse | Elevation | Scope `nodemon_ro` GRANTs to named tables only; `default_transaction_read_only` belt-and-suspenders (§B). |
| Plaintext DB traffic over public internet | Information Disclosure | Documented accepted risk for this RO role (no SSL on server; `sslmode=prefer`); the `nodemon_ro` password is low-value (SELECT-only). Note for HARDEN phase: consider an SSH tunnel/VPN when moving to VM. |

---

## §A — Pooler probe procedure (resolves D-03)

**Goal:** Determine whether a transaction-mode pooler (PgBouncer) fronts `192.243.215.101:5432` without write access.

**Probe 1 — server_version_num / pooler fingerprint (read-only):**
```bash
PGPASSWORD=<nodemon_ro_pw> psql "host=192.243.215.101 port=5432 dbname=routing_vm user=nodemon_ro sslmode=prefer" \
  -c "SHOW server_version;" -c "SELECT current_setting('server_version_num');"
```
- A direct Postgres connection answers `SHOW` normally. PgBouncer in **transaction mode** intercepts and may error on `SHOW`/session-level GUCs, or `SHOW pool_mode` may be answerable only on the special `pgbouncer` admin DB. If `SHOW` works for arbitrary GUCs, you're likely direct.

**Probe 2 — prepared-statement behaviour (the decisive test):**
```bash
# Issue a named prepared statement, then re-execute on a (possibly different) pooled backend.
psql "...user=nodemon_ro..." <<'SQL'
PREPARE probe AS SELECT 1;
EXECUTE probe;
EXECUTE probe;
SQL
```
- Direct or session-mode pooling: succeeds. **Transaction-mode PgBouncer:** the prepared statement is lost between transactions → `ERROR: prepared statement "probe" does not exist`. That error is the signal to set `prepare: false`.

**Probe 3 — application-level confirmation (postgres.js):** run a tiny script that opens the client with `prepare: true`, runs two parameterized queries, and catches a `prepared statement does not exist` / `26000` error → flip the config flag to `prepare: false`.

**Mapping to config:** expose `WAREHOUSE_PG_TXN_POOLER=true|false` (or per-warehouse). `warehousePrepareFlag()` returns `!txnPooler`. Default `false` for the flag (= prepared statements on) since the demo Grafana connects directly on `:5432`; flip only if a probe shows transaction pooling. [CITED: STACK.md §1; postgres.js PgBouncer guidance]

## §B — `nodemon_ro` role + grant SQL (operator-run artifact; resolves D-01/D-02)

> Phase 1 **produces** this SQL; the operator runs it (the app's `nodemon_ro` cannot create roles). Mirror the `grafana_demo_ro` model (SELECT-only) but as an independent role. Run once per warehouse DB (`routing_vm`, then `ldk-lspd-main`).

```sql
-- ===== Run as a superuser/owner on routing_vm =====
CREATE ROLE nodemon_ro WITH LOGIN PASSWORD '<generated-strong-password>';

-- Belt-and-suspenders: force every transaction on this role to be read-only.
ALTER ROLE nodemon_ro SET default_transaction_read_only = on;

-- Least privilege: connect + usage, then SELECT on ONLY the read-layer tables.
GRANT CONNECT ON DATABASE routing_vm TO nodemon_ro;
GRANT USAGE ON SCHEMA public TO nodemon_ro;

GRANT SELECT ON
  public.lnd_node_info,
  public.lnd_node_forwards,
  public.lnd_node_channel_info,
  public.lnd_node_closed_channels,
  public.lnd_node_transaction_info,
  public.price_usd_cad
TO nodemon_ro;
-- If present in routing_vm and needed by later read phases, also grant:
--   public.lnd_node_peer_info, public.lnd_node_pending_channels,
--   public.lnd_node_pending_sweeps, public.internal_rebalance_invoices, public.lnd_restart
-- (these are referenced by the spec/sanity-checks but were not in the grafana_demo_ro
--  enumerated grant list — confirm existence via information_schema before granting).

-- Explicitly do NOT grant INSERT/UPDATE/DELETE/TRUNCATE anywhere.

-- ===== Run as a superuser/owner on ldk-lspd-main =====
-- (same role name; grant DB-level CONNECT there too, OR create a parallel grant)
GRANT CONNECT ON DATABASE "ldk-lspd-main" TO nodemon_ro;
GRANT USAGE ON SCHEMA public TO nodemon_ro;
GRANT SELECT ON
  public.lsps1_orders,
  public.lightning_channels,
  public.payments,
  public.transactions
TO nodemon_ro;
```

**Verification (operator runs after granting):**
```sql
-- Confirm SELECT-only: should return rows for SELECT, nothing for write privs.
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'nodemon_ro' ORDER BY table_name, privilege_type;
-- A write privilege appearing here is a misconfiguration.
```

**Notes:**
- `default_transaction_read_only = on` makes even an accidental write impossible at the session level — the strongest enforcement and exactly what the boot probe (§C) tests for.
- The exact table set: confirmed-granted-to-grafana_demo_ro tables are authoritative (memory file). Tables the spec references but that weren't in that grant list (`lnd_node_peer_info`, `lnd_node_pending_channels`, `lnd_node_pending_sweeps`, `internal_rebalance_invoices`, `lnd_restart`) must be confirmed to **exist** in `routing_vm` via `information_schema.tables` before granting — flag this for the operator. [ASSUMED] that these exist in `routing_vm` (spec lists them; not confirmed against the granted set).
- IP whitelist: the operator must also add the run-host IP to `pg_hba.conf` + firewall (Runtime State Inventory).

## §C — Boot-time health check + read-only verification (resolves Claude's-discretion item)

**Recommendation: attempt-a-write-and-assert-rejection, not grant inspection.** Tests the *effective* permission of the actual connection (catches a wrong role in the URL), independent of table grants, fails closed. With `default_transaction_read_only = on` (§B), the cleanest probe is a write that the read-only transaction rejects:

```ts
// inside health.ts — read-only assertion keyed on the read-only-transaction error
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('x', '1', true)`); // harmless; proves connectivity
  // A write under default_transaction_read_only raises 25006 read_only_sql_transaction.
  await tx.execute(sql`CREATE TEMP TABLE _ro_probe(x int)`);
});
// If we reach here, the write SUCCEEDED → role is NOT read-only → throw (fail loud).
```
Key the PASS on SQLSTATE `25006` (`read_only_sql_transaction`) or `42501` (`insufficient_privilege`). For `nodemon` (RW), the inverse: a rolled-back write must succeed. The full health check, run from `instrumentation.ts`, must also:
- assert all required env vars present (no `localhost` literals) — throw with the missing var name;
- `SELECT 1` against all three DBs (reachability) — throw on connection failure with the DB name;
- verify both warehouses read-only and `nodemon` writable.

Throwing in `instrumentation.register()` prevents the server from starting → "fails loudly." Validate the exact SQLSTATE during implementation (PG 14). [CITED: PostgreSQL error codes 25006/42501; Next.js instrumentation]

## §D — AFM-001 helper: exact warehouse columns (resolves question 5)

Ground-truth column names (from `00-sanity-checks.sql`, `02-schema-discovery.sql`, and the databases memory file — HIGH confidence for LND):

| Table | Identity column | Latest-state key | Time column | Snapshot? |
|-------|-----------------|------------------|-------------|-----------|
| `lnd_node_channel_info` | `local_pubkey` | `chan_id` | `timestamp` | **NO — event-driven** (use `DISTINCT ON (chan_id)`) |
| `lnd_node_peer_info` | `local_pubkey` | peer pubkey (introspect exact name) | `timestamp` | **NO — event-driven** |
| `lnd_node_pending_channels` | `local_pubkey` | channel point (introspect) | `timestamp` | **NO — event-driven** |
| `lnd_node_pending_sweeps` | `local_pubkey` | sweep id (introspect) | `timestamp` | **NO — event-driven** |
| `lnd_node_info` | `pubkey` | — (snapshot) | `timestamp` | **YES — true snapshot**; `active_channels`, `inactive_channels`, `pending_channels`, `local_channel_balance`, `remote_channel_balance` |
| `lnd_node_closed_channels` | `local_pubkey` | — (one row per close) | `timestamp` | event-record; `MAX` N/A; has `close_type` |
| `lnd_node_forwards` | `lnd_pubkey` | — | `timestamp_ns` (nanoseconds; convert `TO_TIMESTAMP(timestamp_ns::decimal/1000000000)`) | event log; `fee_msat` (use `/1000.0`, never `fee`) |

The sanctioned helper (READ-02): `SELECT DISTINCT ON (chan_id) * FROM lnd_node_channel_info WHERE local_pubkey = $1 ORDER BY chan_id, timestamp DESC`. Cross-validate `COUNT(*) FILTER (WHERE active AND NOT closed)` from that result against `lnd_node_info.active_channels` (the canonical AFM-001 check, verbatim in analytical-failure-modes.md). The combined cross-validation query already exists in that file — port it directly. [CITED: lqwdLogs/_library/analytical-failure-modes.md; lqwdLogs/canada/.../00-sanity-checks.sql; reference_lqwd_databases memory]

> Column names marked "introspect exact name" for peer/pending tables: resolve via `02-schema-discovery.sql`'s `information_schema.columns` pattern during implementation — Phase 1's required golden invariant only needs `lnd_node_channel_info` + `lnd_node_info`, so the other event tables can be annotated now and fully typed when their phase consumes them.

## §E — AFM-002 formatter contract + reference values (resolves question 6)

Contract: one module (`units.ts`) owns `feeMsatToSat = msat/1000`, `formatBtc = sats/100_000_000`, `formatSats = thousands-separated`. Reference values for the unit test are in the Validation Architecture section above (the documented Canada/SouthAfrica figures from analytical-failure-modes.md). The `fee_msat/1000.0` convention is reinforced by the databases memory file ("use `fee_msat/1000.0` for fee totals, NOT `fee` which truncates sub-sat"). Verification rule (port into the test): every BTC value × 100,000,000 must equal source sats within ±1%. [CITED: lqwdLogs/_library/analytical-failure-modes.md AFM-002; reference_lqwd_databases memory]

## §F — LND vs LDK schema delta + unified model (resolves question 7, READ-04)

**LND (`routing_vm`) — known (HIGH):** per-node identity `pubkey`/`local_pubkey`/`lnd_pubkey` (table-dependent, §D); rich channel/forward/close/peer event tables; `lnd_node_info` snapshot with `active_channels` etc.

**LDK (`ldk-lspd-main`) — granted tables `lsps1_orders`, `lightning_channels`, `payments`, `transactions`. Column shapes are [ASSUMED] until introspected** — no `lqwdLogs` query exercises them and they are not LND-shaped. The first implementation task MUST introspect:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('lightning_channels','lsps1_orders','payments','transactions')
ORDER BY table_name, ordinal_position;
```
(run via the `nodemon_ro` connection, read-only, mirroring `02-schema-discovery.sql`).

**Unified per-node model + per-backend boundary (D-09/D-10):** define one TS type the UI consumes, and a per-backend mapper that is the single place LND vs LDK differences live:
```ts
// src/lib/read/nodes.ts
export type Backend = "lnd" | "ldk";
export interface UnifiedNode {
  backend: Backend;
  pubkey: string;
  alias: string | null;
  activeChannels: number;
  inactiveChannels: number;
  pendingChannels: number;
  localBalanceSats: number;   // already sat (formatter applied at render)
  remoteBalanceSats: number;
  // …only fields BOTH backends can populate; backend-specific extras hang off a discriminated union
}
// mapLndNode(row): UnifiedNode  — from lnd_node_info (+ DISTINCT ON channel count cross-check)
// mapLdkNode(row): UnifiedNode  — from lightning_channels/lsps1_orders (columns TBD by introspection)
```
Keep `mapLndNode`/`mapLdkNode` as the **only** translation surface; the rest of the app sees `UnifiedNode`. Fields that only one backend has go in a `discriminatedUnion`/optional sub-object, never leaked as `any`. This satisfies "clean per-backend boundary" while UI renders both identically. The LDK mapper is a thin Phase-1 deliverable (model shape + channel-count/balance fields); deeper LDK detail lands when later phases consume it. [CITED: vast-popping-starlight.md Component 1; reference_lqwd_databases memory]

## §G — Golden invariant test design (resolves question 8)

Already specified in Validation Architecture (parameterized loop, invariant not literal, ±2% / min-2 tolerance). Confirms across Canada (anchor) + Tier-M + edge node with one test body. Resolve Sweden/India pubkeys via `lnd_node_info` lookup at plan time (Open Question 4). The edge-node (offline / zero-activity) case is handled because `0 active ≈ 0 distinct` passes. Exclude special-purpose aliases (`LQWD-Breez`, `LQwD-Lspd-ldk`, etc. from the memory file) when picking reference nodes.

## §H — Test harness (resolves question 10)

**Recommendation: Vitest 4.1.8.** Rationale:
- Native ESM + TypeScript transform via Vite — no babel/ts-jest config; matches a modern Next 16 / React 19 setup.
- Fast watch mode + `vitest run` for CI; coverage built-in; will be reused for later component tests.
- `node:test` is the zero-dep alternative but needs manual TS/ESM handling and has weaker DX; not worth it given the team will want a real runner by Phase 2.
- Fit with Next 16: Vitest runs the pure-function tests (formatter, helper-shape) with no Next runtime; the live-warehouse integration tests just import the server-only DB modules and need the `nodemon_ro` URL in the test env (guard with `describe.skipIf(!process.env.ROUTING_VM_DATABASE_URL)` so they skip cleanly without network). Do NOT use the Next.js Vitest plugin for these (no component rendering needed in Phase 1). [VERIFIED: `npm view vitest` = 4.1.8]

## §I — Env contract (resolves READ-01 "no localhost literals", HARDEN-02 seed)

| Env var | Purpose | Local | VM |
|---------|---------|-------|----|
| `ROUTING_VM_DATABASE_URL` | LND warehouse (RO, `nodemon_ro`) | `postgres://nodemon_ro:***@192.243.215.101:5432/routing_vm?sslmode=prefer` | same/internal |
| `LDK_LSPD_DATABASE_URL` | LDK warehouse (RO, `nodemon_ro`) | `postgres://nodemon_ro:***@192.243.215.101:5432/ldk-lspd-main?sslmode=prefer` | same |
| `NODEMON_QUEUE_URL` | local `nodemon` (RW) | `postgres://nodemon_rw:***@localhost:5432/nodemon` ← only place `localhost` is acceptable, and ONLY via env (never a code literal) | warehouse VM / dedicated |
| `WAREHOUSE_PG_TXN_POOLER` | pooler flag (D-03) | `false` (default) | per-probe |

**Rules:** every DB module reads its URL from env at boot and throws if missing (no dev-DB default); secrets only in git-ignored `.env.local`; no `localhost` string anywhere in source (the local `nodemon` URL lives in env, not code). A boot-time env validator (part of §C) makes the VM flip a config diff. [CITED: .planning/research/ARCHITECTURE.md §5]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `lnd_node_peer_info`, `lnd_node_pending_channels`, `lnd_node_pending_sweeps`, `internal_rebalance_invoices`, `lnd_restart` exist in `routing_vm` and are grantable to `nodemon_ro` | §B, §D | Grant SQL fails on a non-existent table; resolve by `information_schema.tables` check before granting. Phase 1 golden invariant doesn't need them. |
| A2 | LDK `lightning_channels`/`lsps1_orders` column shapes | §F | Unified LDK mapper wrong; MITIGATED — flagged as mandatory introspection-first task, marked [ASSUMED] until `information_schema` confirms. |
| A3 | Warehouse is a direct connection (no txn-mode pooler) → `prepare` flag default `false` | §A, Pattern 1 | Prepared-statement errors at runtime; MITIGATED — config flag + §A probe before relying on it. |
| A4 | Sweden + India are valid reference-node picks with resolvable pubkeys | §G, Open Q4 | Wrong nodes; MITIGATED — D-04 says confirm at plan time; any Tier-M + any edge node works; test is invariant-based. |
| A5 | postgres.js returns `int8`/sat values as JS `number` safely (< 2^53) | §E formatter | Precision loss for >9e15 sats (impossible at fleet scale); formatter accepts `bigint|number` to be safe. |
| A6 | The exact read-only rejection SQLSTATE is `25006`/`42501` on PG 14 | §C | Boot probe keys on wrong error; MITIGATED — validate the exact error during implementation; both codes handled. |

## Sources

### Primary (HIGH confidence)
- `../lqwdclaw/package.json` — authoritative in-workspace production version set (Next 16.1.6, React 19.2.3, Drizzle 0.45.1, postgres 3.4.8, shadcn 4.0.2, Tailwind v4).
- `../lqwdLogs/_library/analytical-failure-modes.md` — AFM-001 + AFM-002 reproductions, reference values, cross-validation SQL.
- `../lqwdLogs/canada/lqwd-canada-node-analytics/queries/00-sanity-checks.sql` — column names, Canada pubkey, golden-invariant pattern.
- `../lqwdLogs/france/lqwd-france-node-analytics/queries/02-schema-discovery.sql` — `information_schema` introspection pattern.
- `../.demo-keys/grafana-demo-vm.txt` — warehouse host (`192.243.215.101`), `grafana_demo_ro` grant model, no-SSL / `sslmode=prefer`, datasource table list.
- `reference_lqwd_databases` (workspace memory) — full table grants (9 routing + 4 ldk), `fee_msat/1000.0`, `DISTINCT ON` conventions, IP whitelist, excluded aliases.
- `~/.claude/plans/vast-popping-starlight.md` — approved spec, Component 1 (read layer), table list.
- `.planning/research/{STACK,ARCHITECTURE,PITFALLS,SUMMARY}.md` — synthesized project research (HIGH).
- npm registry (`npm view`, 2026-06-07) — next 16.1.6, vitest 4.1.8, drizzle-kit 0.31.10, postgres 3.4.9, recharts 3.8.1, server-only 0.0.1.

### Secondary (MEDIUM confidence)
- PostgreSQL 14 `DISTINCT ON` + error codes (25006 read_only_sql_transaction, 42501 insufficient_privilege) — standard PG docs.
- postgres.js PgBouncer / `prepare: false` guidance — STACK.md §1, postgres.js README.
- Next.js `instrumentation.ts` boot hook — Next.js docs (stable since 15).
- drizzle-orm#1988 (dev pool leak) — referenced in ARCHITECTURE.md.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against in-workspace production lockfile + npm registry.
- Architecture (3-client/3-role, helpers, boot check): HIGH — locked in CONTEXT.md + project research; LND columns confirmed from real SQL.
- LDK schema specifics: MEDIUM/LOW — column shapes [ASSUMED] until `information_schema` introspection (flagged as first task).
- Pooler mode: MEDIUM — probe procedure defined; actual mode unconfirmed (config-flagged).
- Pitfalls: HIGH — operator-documented (AFM-001/002) + project PITFALLS.md.

**Research date:** 2026-06-07
**Valid until:** 2026-07-07 (stable stack; warehouse schema is the only volatile input — re-introspect if the warehouse changes).
</content>
</invoke>
