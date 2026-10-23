---
status: open
phase: 12-ops-center-overview
source: operator live-verification of 12-07 (http://localhost:3001/)
created: 2026-06-30
intent: gap-closure / refinement pass after 12-07 page assembly
note: All items below are operator feedback from reviewing the LIVE page. None are
  safety violations — the advisory-only / honest-stale / no-command-execution
  invariants hold. These are UX refinements, two defects (DB-name leak, fake live
  pill), and three new behavior rules (collapse, fee grouping, 30-day staleness).
---

## Refinement Backlog — Phase 12 follow-up

Operator reviewed the live Ops Center Overview and raised the following. Decisions
captured inline are LOCKED by the operator and must be honored by the gap plan.

### 1. Filter performance — re-fetch on every click (perf defect)
- **Problem:** Each filter chip is a `<Link>` that changes the URL; the page is
  `dynamic="force-dynamic"` + `revalidate=0`, so every toggle re-renders the Server
  Component and re-runs all 5 warehouse reads (~8s). The filter (`applyFilter`) is a
  pure, isomorphic view that does NOT depend on the DB.
- **Fix (both):**
  - (A) Move `applyFilter` to the **client** — fetch + assemble once server-side, pass
    full `GroupedIncident[]` to a client island, filter in-browser (instant). Keep URL
    sync via shallow routing (no re-fetch). `filter.ts` is already pure/isomorphic.
  - (B) **Cache the data layer** — wrap the 5 reads + assembly in `unstable_cache`/React
    `cache`, keyed independent of `searchParams`, short revalidate (~15–30s). Fixes the
    slow cold/warm loads too.
- **Files:** `src/app/(overview)/page.tsx`, `src/components/overview/QueueFilters.tsx`,
  a new client queue island, data-layer read helpers.

### 2. Masthead double-chrome
- **Problem:** `(overview)/layout.tsx` renders `MastheadNav` above the page, while
  `page.tsx` renders `NavRailShell` (the UI-SPEC OverviewShell) — two stacked chromes.
- **Fix:** Reconcile to one chrome. `layout.tsx` is shared with `/pending`, `/[pubkey]`,
  and the `@modal` route — change carefully.
- **Files:** `src/app/(overview)/layout.tsx` (+ shell).

### 3. Collapsible incident cards  — LOCKED decisions
- **Default:** collapsed (one-line summary; expand to see children).
- **Critical:** critical children are **always shown — never capped**.
- **Non-critical:** cap at **top 5 + "show N more"**.
- **Files:** incident card primitive(s), `page.tsx`/queue island.

### 4. Fee-alert grouping  — LOCKED decisions
- Fee alerts must **not** appear as individual rows.
- Per node, collapse to **two summary lines: one "fee raise", one "fee lower"**, each with
  a count (N).
- Clicking a fee line **routes to that node's channels / fee-adjustment queue**
  (the existing per-node channels area).
- Fees are **never critical**.
- **Touches:** incident assembly/grouping (`src/lib/overview/incidents.ts` or a new
  fee-grouping step), severity-map (fees never critical), card rendering, routing.

### 5. "Preview" view toggle — relabel/remove
- **What it is:** `NavRailShell` `viewLabel="Preview"` segmented toggle (prototype
  carry-over) driving `activeView`. Not previewing mock data — mislabeled.
- **Fix:** relabel to its real meaning or remove if it has no function here.
- **Files:** `src/components/df/NavRailShell.tsx`, `page.tsx` (activeView usage).

### 6. "Live · polled Ns ago" pill — defect (fake live)
- **What it is:** `LivePollPill` shows hardcoded "Live" + green dot; `pollAgeSeconds` is
  computed once at server render (`page.tsx:415`) and passed static. No client polling,
  no tick → counter never moves; "Live" is misleading (violates honesty principle).
- **Fix:** either implement real client polling + a ticking counter, or relabel honestly
  (e.g. "data as of …") and drop the "Live" claim + green dot until polling exists.
- **Files:** `NavRailShell.tsx` (LivePollPill), `page.tsx`.

### 7. Remove `routing_vm` from masthead — info leak
- **What it is:** hardcoded literal `routing_vm` in `(overview)/layout.tsx:34` — the
  warehouse DB name printed in the top-right. CLAUDE.md forbids exposing connection details.
- **Fix:** remove it.
- **Files:** `src/app/(overview)/layout.tsx`.

### 8. 30-day staleness cutoff — drop dead nodes  — LOCKED rule
- **Rule:** any node with **no data present in the last 30 days** is treated as gone
  (unlikely to return) and **eliminated from monitoring** — not shown in the queue, not
  counted in vitals.
- **Why:** explains the current 1000+ STALE flood from long-dead nodes.
- **Touches:** ownership / severity / incidents data layer (apply a 30-day freshness
  cutoff before assembly), vitals denominators.

### 9. Service display-name map — relabel raw service keys  — LOCKED intent
- **Problem:** services render by raw machine key (`addressBalances`, `aiLiquidityManager`,
  `channelAcceptor`, `internalRebalancer`, `nodeAuditor`, `esplora`, …).
- **`addressBalances` clarified by operator:** a background **cron** that rebuilds the
  node's **used-address list/index** on a schedule; healthy as long as it refreshes within
  its expected interval (`service_inventory.expected_interval_seconds = 21600` / 6h,
  success = "Successfully completed database update"). It is correctly modeled — only the
  **display label** is wrong. **Relabel, do NOT remove.**
- **Fix:** a `service_name → { label, description }` display map. Seed:
  `addressBalances → "Address List Sync"` (operator may refine wording). Health logic stays
  interval-based (stale past expected interval = problem).
- **Files:** a service display-name map + service card rendering.

## Status of 12-07
- 12-07 (page assembly) original scope OVW-01…05 is built, safe, and **verified live**
  by the operator (rollups, advisory-only band, honest stale/empty all confirmed against
  real fleet data after warehouse read grants were fixed).
- These 9 items are the refinement pass — to be planned via `/gsd-plan-phase 12 --gaps`.

## Environment note (infra, not code)
Live verification required these one-time grants on `192.243.215.101` (logged for ops):
1. `ALTER ROLE grafana_demo_ro SET default_transaction_read_only = on;` (unblocked boot health check)
2. `GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_demo_ro;` on `routing_vm` + `ldk-lspd-main` (run as superuser `postgres`)
3. `GRANT SELECT ON ALL TABLES IN SCHEMA public TO nodemon_rw;` on `nodemon`
Also wiped a wedged `.next` Turbopack cache (stuck compile after multiple hard-killed dev servers).
