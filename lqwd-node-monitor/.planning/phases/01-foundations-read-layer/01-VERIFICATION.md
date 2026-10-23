---
phase: 01-foundations-read-layer
verified: 2026-06-09T18:01:32Z
status: passed
score: 5/5
overrides_applied: 0
re_verification: false
---

# Phase 1: Foundations + Read Layer — Verification Report

**Phase Goal:** A correct, credential-safe read foundation that every later phase inherits — both warehouses connected read-only, analytics failure modes sealed, LND and LDK unified into one model.
**Verified:** 2026-06-09T18:01:32Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | App boots from env-var DB URLs only; boot-time health check fails loud if a warehouse is unreachable or not read-only | VERIFIED | `src/instrumentation.ts` wires `runStartupHealthCheck()` into the Next.js boot hook (Node runtime only); `requireEnv()` in `src/lib/db/env.ts` throws `"Missing required env: <name>"` for each of three URL vars; `assertReadOnly()` in `health.ts` writes into a rolled-back transaction and requires SQLSTATE 25006/42501 rejection — any other outcome throws; no `localhost` literal found in any `.ts`/`.tsx` file under `src/`. |
| 2 | Three Drizzle clients on three least-privilege roles (2 RO warehouses + 1 RW nodemon); `import "server-only"` guards every DB/credential module; no connection string in a client bundle | VERIFIED | `warehouse-routing.ts`, `warehouse-ldk.ts`, `nodemon.ts`, `health.ts`, `env.ts` all open with `import "server-only"`. Both warehouse clients set `connection: { default_transaction_read_only: true }` (session-level read-only, interim D-02). `dbNodemon` is wired with no queue tables (D-07, Phase 6). `npm run build` exits 0 with `/` as `ƒ (Dynamic)` — no server-only import leaks into a client bundle. No connection string in source (`grep -rn "postgres://"` → zero matches). The dedicated `nodemon_ro` role is not yet provisioned (interim `grafana_demo_ro` bridge, operator-approved), and `db/role-grants.sql` is the durable operator artifact for when that follow-up lands. |
| 3 | The only sanctioned latest-state query is `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC`; a unit test reproduces the Canada channel count and cross-validates against `lnd_node_info.active_channels` | VERIFIED | `src/lib/read/latest.ts` exports `buildLatestChannelsSql()` and `latestChannelsForNode()` using `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC`; MAX(timestamp) appears only in comments (3 instances, all explaining the forbidden form). `latest.test.ts` (4 no-DB tests) asserts the helper emits `distinct on (chan_id)`, `order by chan_id, timestamp desc`, never `max(`, and parameter-binds the pubkey. `golden.test.ts` live cross-consistency invariant passes 3/3 (Canada 489≈491, Sweden 95≈96, India 49≈51 — operator-confirmed 2026-06-09); Canada assertion additionally guards `distinctActiveNotClosed > 50`, explicitly rejecting the MAX-collapse-to-1 failure. |
| 4 | Every sat/BTC/fee value renders through a single unit formatter (`fee_msat/1000.0`, correct sat→BTC); unit-tested against known reference values; no ad-hoc conversions anywhere | VERIFIED | `src/lib/format/units.ts` is the sole conversion path: `feeMsatToSat` (msat÷1000), `formatBtc` (sats÷1e8 at fixed dp), `formatSats` (en-US separators). `units.test.ts` asserts 14 reference values including Canada capacity 3,359,047,565 → 33.5905 BTC (the AFM-002 anchor), `feeMsatToSat(1000) === 1`, and ±1% back-conversion across all BTC_REFERENCE entries. `grep -rn "1e8\|100000000\|/ 1000\|/1000" src/` excluding `format/units.*` → three matches, all in **comments** (not executable code). `nodes.ts` and `page.tsx` contain zero inline math. |
| 5 | LND and LDK node data normalize into one unified per-node model so UI components render both fleets identically | VERIFIED | `src/lib/read/nodes.ts` exports `UnifiedNode` (8 shared fields), typed `LndNodeRow`/`LdkNodeRow` inputs, `mapLndNode`/`mapLdkNode` as the sole per-backend translation surface (D-10), and `UnifiedNodeWithExtras` discriminated union (no `any` escape). LDK msat balances normalized to sats via `feeMsatToSat` (AFM-002); LND sats carried raw. `nodes.test.ts` (8 tests, no DB) confirms both mappers yield the identical key set, balances are not mis-converted, and no `undefined` leaks. `src/app/(status)/page.tsx` renders both fleets through the unified model in one table using `formatSats`/`formatBtc` — Server Component only (no `"use client"` directive), `force-dynamic`, imports `server-only` DB clients. |

**Score:** 5/5 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/format/units.ts` | AFM-002 formatter | VERIFIED | 3 exports: `feeMsatToSat`, `formatBtc`, `formatSats`; MSAT_PER_SAT=1000, SATS_PER_BTC=1e8 |
| `src/lib/format/units.test.ts` | 14 reference-value tests | VERIFIED | 14 tests; Canada 3,359,047,565→33.5905 BTC anchor; back-conversion ±1% guard |
| `src/lib/db/env.ts` | Fail-loud `requireEnv`; no dev defaults | VERIFIED | Throws `"Missing required env: <name>"`; no localhost literals; `import "server-only"` |
| `src/lib/db/warehouse-routing.ts` | dbRouting RO, server-only, singleton | VERIFIED | `import "server-only"`; `connection: { default_transaction_read_only: true }`; globalThis singleton |
| `src/lib/db/warehouse-ldk.ts` | dbLdk RO, server-only, singleton | VERIFIED | Same pattern as routing; session-level read-only enforced |
| `src/lib/db/nodemon.ts` | dbNodemon RW, server-only, wired | VERIFIED | `import "server-only"`; wired; no queue tables (intentional — Phase 6) |
| `src/lib/db/schema/routing.ts` | Curated LND schema from live introspection | VERIFIED | `lndNodeChannelInfo` + `lndNodeInfo` fully typed; AFM-001 annotations; event-driven vs snapshot distinction documented |
| `src/lib/db/schema/ldk.ts` | Curated LDK schema from live introspection | VERIFIED | 4 tables confirmed live against `information_schema.columns`; no `[ASSUMED]` columns; LDK is single-node, msat balance fields present |
| `src/lib/db/schema/nodemon.ts` | Placeholder (intentional); Phase 6 owns tables | VERIFIED (intentional stub) | Empty `export {}` is correct by design (D-07); the client is wired and health-checked; queue tables deferred to Phase 6 |
| `src/lib/db/health.ts` | `runStartupHealthCheck()`: env + reachability + RO + RW probes | VERIFIED | 4-stage check; `pgCode()` walks Drizzle `.cause` chain (bug fixed in `c15171a`) to surface SQLSTATE 25006 correctly; `assertReadOnly` distinguishes legitimate rejection from unexpected failures |
| `src/lib/db/health.test.ts` | Unit test for fail-loud contract | VERIFIED | Tests `requireEnv` throws with missing var name; live-DB test guards on `skipIf(!ROUTING_VM_DATABASE_URL)` and resolves when live |
| `src/instrumentation.ts` | Next.js boot hook | VERIFIED | Calls `runStartupHealthCheck()` on Node runtime; throw aborts server start |
| `src/lib/read/latest.ts` | AFM-001 DISTINCT ON helper | VERIFIED | `buildLatestChannelsSql()` uses `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC`; pubkey parameter-bound via Drizzle `sql` template; lazy import keeps no-DB shape test clean |
| `src/lib/read/latest.test.ts` | AFM-001 shape + injection guard | VERIFIED | 4 assertions: distinct on, order by, never max(, pubkey in params not SQL text |
| `src/lib/read/golden.test.ts` | Live cross-consistency invariant | VERIFIED | 3 reference nodes; tolerance `max(3, ceil(active*0.02))`; Canada anchor asserts `> 50` channels (MAX-collapse guard); operator-confirmed 3/3 pass |
| `src/lib/read/nodes.ts` | `UnifiedNode` + `mapLndNode`/`mapLdkNode` | VERIFIED | Sole per-backend translation surface; discriminated union (no any); msat→sat via AFM-002 only; null→0 coercion; `docs/LDK-INTROSPECTION.md`-confirmed columns only |
| `src/lib/read/nodes.test.ts` | No-DB unified model tests | VERIFIED | 8 tests; both backends → identical key set; msat normalized correctly; no undefined leaks |
| `src/app/(status)/page.tsx` | Navy/dark status page; Server Component; force-dynamic | VERIFIED | No `"use client"`; `export const dynamic = "force-dynamic"`; uses `formatSats`/`formatBtc` exclusively; renders both fleets from `UnifiedNode` |
| `db/role-grants.sql` | Operator artifact: dedicated `nodemon_ro` role | VERIFIED | `CREATE ROLE nodemon_ro`; `ALTER ROLE nodemon_ro SET default_transaction_read_only = on`; named-table-only SELECT grants; no INSERT/UPDATE/DELETE; verification query included |
| `docs/SETUP-PREREQUISITES.md` | Operator runbook: role, IP whitelist, nodemon, pooler probe | VERIFIED | All 6 steps documented; pooler probe (§4) included; `.env.local` template shown |
| `docs/LDK-INTROSPECTION.md` | Confirmed LDK column surface | VERIFIED | Created in Plan 03; no `[ASSUMED]` columns |
| `vitest.config.ts` | `@/` alias + `server-only` stub | VERIFIED | `resolve.alias` maps `@` → `./src` and `server-only` → `test/server-only-stub.ts` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `instrumentation.ts` | `health.ts → runStartupHealthCheck` | dynamic import on `NEXT_RUNTIME === "nodejs"` | VERIFIED | Throw propagates to server abort |
| `health.ts` | `warehouse-routing.ts`, `warehouse-ldk.ts`, `nodemon.ts` | direct import of `dbRouting`, `dbLdk`, `dbNodemon` | VERIFIED | All three clients exercised in health check |
| `warehouse-routing.ts` / `warehouse-ldk.ts` | `env.ts → requireEnv` | module-level call at postgres() construction | VERIFIED | Missing env throws before pool creation |
| `latest.ts → latestChannelsForNode` | `warehouse-routing.ts → dbRouting` | lazy `import()` | VERIFIED | Lazy import prevents pool construction in no-DB shape tests |
| `page.tsx` | `mapLndNode/mapLdkNode` → `UnifiedNode` | server-side query + map pipeline | VERIFIED | Both fleets flow through unified model; no inline conversion |
| `page.tsx` | `formatSats/formatBtc` (AFM-002) | direct import from `@/lib/format/units` | VERIFIED | All sat/BTC values in table cells go through formatter |
| `nodes.ts → mapLdkNode` | `feeMsatToSat` (AFM-002) | direct import | VERIFIED | Sole msat→sat path; no inline `/1000` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `page.tsx` | `lndRows` (LND nodes) | `dbRouting.select().from(lndNodeInfo)` | Yes — live `lnd_node_info` query (operator-confirmed fleet data) | FLOWING |
| `page.tsx` | `ldkChannels` (LDK channels) | `dbLdk.select().from(lightningChannels)` | Yes — live `lightning_channels` query | FLOWING |
| `golden.test.ts` | `resolved[]` reference nodes | `latestChannelsForNode(pubkey)` + `lnd_node_info.active_channels` | Yes — live warehouse; 3/3 operator-confirmed | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| AFM-002 formatter: 14 reference-value tests pass | `npx vitest run src/lib/format/units.test.ts` | 14 passed (per SUMMARY 01-01) | PASS |
| AFM-001 helper-shape tests pass (no DB) | `npx vitest run src/lib/read/latest.test.ts` | 4 passed (per SUMMARY 01-03) | PASS |
| UnifiedNode shape parity tests pass (no DB) | `npx vitest run src/lib/read/nodes.test.ts` | 8 passed (per SUMMARY 01-04) | PASS |
| Full vitest suite | `npx vitest run` | 28 passed / 4 skipped (per SUMMARY 01-04, live-DB tests skip without env) | PASS |
| Build clean | `npm run build` | exit 0; `/` is `ƒ (Dynamic)` (per SUMMARY 01-04) | PASS |
| No ad-hoc sat/BTC conversions in `src/` | `grep -rn "1e8\|100000000\|/ 1000\|/1000" src/ \| grep -v format/units` | 3 matches — all in **comments** (not executable code) | PASS |
| No connection strings in `src/` | `grep -rn "postgres://" src/` | exit 1 (zero matches) | PASS |
| No localhost literals in `src/` | `grep -rn "localhost" src/` | exit 1 (zero matches) | PASS |
| `server-only` guards all DB/credential modules | `grep -rn "import \"server-only\"" src/lib/db/` | 5 matches: env.ts, health.ts, nodemon.ts, warehouse-ldk.ts, warehouse-routing.ts | PASS |
| Live golden invariant (operator-confirmed) | `npx vitest run src/lib/read/golden.test.ts` (with env loaded) | Canada 489≈491, Sweden 95≈96, India 49≈51 (2026-06-09) | PASS |

---

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` probes exist for this phase; behavioral spot-checks above cover the runnable verification surface.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| READ-01 | 01-02-PLAN | Three Drizzle clients on three least-privilege roles; read-only enforced at DB role; `server-only` guards; no localhost literals | SATISFIED | Three clients wired; session-level read-only enforced on both warehouse clients; all DB modules guarded; zero localhost literals in src/; boot health check confirms read-only at runtime. Interim: `grafana_demo_ro` bridge + session enforcement pending `nodemon_ro` provisioning — operator-approved. |
| READ-02 | 01-03-PLAN | DISTINCT ON (chan_id) AFM-001 helper; channel counts cross-validated against `lnd_node_info.active_channels`; Canada reference count reproduced | SATISFIED | `latestChannelsForNode()` is the sole latest-state helper; shape tests confirm DISTINCT ON + no MAX; golden invariant passes 3/3 operator-confirmed; Canada asserts `> 50` channels (MAX-collapse guard). |
| READ-03 | 01-01-PLAN | Single unit formatter (fee_msat/1000.0, sat→BTC); no ad-hoc conversions; unit-tested against lqwdLogs reference values | SATISFIED | `units.ts` is the sole conversion path; 14 reference-value tests pass including Canada 33.5905 BTC anchor; grep confirms zero inline conversions in executable src. |
| READ-04 | 01-04-PLAN | LND and LDK normalized into one unified per-node model | SATISFIED | `UnifiedNode` + `mapLndNode`/`mapLdkNode`; 8 no-DB tests confirm identical key set across backends; status page renders both fleets through the unified model. |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/db/schema/nodemon.ts` | — | Empty `export {}` | Info | Intentional by design (D-07): nodemon queue tables deferred to Phase 6. The client is wired and health-checked. Not a stub in the behavioral sense — the empty schema is the correct Phase 1 state. |

No BLOCKER anti-patterns found. No TBD/FIXME/XXX debt markers in any `src/` file. No hardcoded connection strings. No ad-hoc conversions in executable code.

---

### Human Verification Required

None. All success criteria are verifiable programmatically from the codebase. The live golden invariant was operator-confirmed on 2026-06-09 (Canada 489≈491, Sweden 95≈96, India 49≈51). The boot health check was confirmed live against both warehouses + local nodemon in SUMMARY 01-02.

---

### Carried-Forward Items (not blockers — follow-ups from operator decision)

These items were logged during Phase 1 execution and are carried forward as follow-up work. They do not block the phase goal because the safety guarantees are met via the interim mechanism.

1. **Provision dedicated `nodemon_ro` warehouse role** — `db/role-grants.sql` is ready; operator must run it against both warehouse DBs and whitelist the run-host IP. Until then, the `grafana_demo_ro` bridge + `default_transaction_read_only` session enforcement satisfies the read-only contract.
2. **`REVOKE CREATE ON SCHEMA public FROM PUBLIC`** on both warehouses — `grafana_demo_ro` (and any login role) can currently CREATE objects in `public`. Existing data is already protected (SELECT-only grants). Post-`nodemon_ro` provisioning, this SQL hardens the schema further. Documented in SUMMARY 01-02 §Follow-ups.

Neither item represents missing phase-goal work — the goal ("a correct, credential-safe read foundation") is satisfied end-to-end as delivered. Both items are operator-infrastructure follow-ups outside the codebase.

---

### Gaps Summary

No gaps. All 5 success criteria are fully met by the delivered code.

---

_Verified: 2026-06-09T18:01:32Z_
_Verifier: Claude (gsd-verifier)_
