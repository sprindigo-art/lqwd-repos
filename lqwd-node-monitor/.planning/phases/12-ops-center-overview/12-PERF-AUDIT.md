# 12-PERF-AUDIT — NodeMonitor performance audit (read-only)

**Date:** 2026-07-03 · **Auditor:** Claude (read-only; no code changed)
**Environment:** macOS dev machine (darwin 25.4.0), Next.js 16.1.6, production `next start` on port 3100 against the live warehouses at the remote DB host (all three DBs — routing_vm, ldk-lspd-main, **and nodemon** — live on the same remote host; nodemon is *not* local). Ping RTT to the DB host: 7–59 ms, avg ~28 ms.

**Caveats on the numbers:** the operator's own `next dev` server was running on :3000 throughout (same repo), so timings carry mild background contention. Two early measurements were **sandbox artifacts and must be discarded**: a 20.4-min `next build` (sandboxed network blocked `next/font/google` fetches) and a 23.8 s `next start` boot (corrupted `.next` from a build/dev-server collision). Clean unsandboxed reruns are the baseline below.

---

## Baseline

### Build / startup axis (A)

| Metric | Measured | How |
|---|---|---|
| `next build`, clean (`rm -rf .next`) | **7.3–7.6 s total** (Turbopack compile 2.1 s; rest is TypeScript + page-data) | `/usr/bin/time -p npx next build`, 2 runs |
| `tsc --noEmit` standalone | 8.8 s | `/usr/bin/time -p npx tsc --noEmit` |
| `next start` boot to Ready | **270 ms** | server log `✓ Ready in 270ms` |
| `next dev` boot to Ready | **281 s measured, but contaminated** — a second dev instance sharing `.next/dev` with the operator's live dev server (lock contention). An uncontended cold measurement could not be completed (bulk file-I/O throttling killed the repo-clone approach). | dev server log |
| Bundler | **Turbopack is already the default** in Next 16 for both dev and build (build header: `Next.js 16.1.6 (Turbopack)`). The `--turbopack` flag suspicion is moot. | build/dev logs |
| HMR | Not measured (read-only audit — no file edits allowed). | — |

### Render axis (B) — production `next start`, live warehouses

| Route | Cold (all memos empty) | Warm (within memo TTL) | After 20 s (overview memo miss, insight memo hit) | Queries cold |
|---|---|---|---|---|
| `/` (overview) | **7.88 s** | **13–16 ms** | **6.81 s** | ~65 (46 routing + 19 nodemon) |
| `/inbox` | ~7.3 s (shares insight memo; measured warm 63–103 ms, **1.80 MB HTML**) | 63–103 ms | — | ~40 |
| `/[pubkey]/scorecard` | **7.1–7.5 s on EVERY load** (no cross-request memo) | n/a — same every time | — | 6 fleet + 3–4 garnish |
| `/(.)[pubkey]` modal | same shape as above (calls `loadFleetView()` per open) | n/a | — | 6 |
| `/pending` | 31 ms | — | — | 2 |
| `/queue` | **HTTP 500 — pre-existing runtime bug, see Bug notes** | — | — | 2 + 1/command |
| `/design-system` | 9 ms (static) | — | — | 0 |

How measured: `curl -s -o /dev/null -w "%{time_total}"` sequence timed across the TTL phases from one script; query counts by static trace of every `dbRouting/dbNodemon.execute` call site on each route's path (all call sites read in full during the audit).

### The single slowest call (measured directly, read-only script via the app's own `postgres` driver)

| Query | Time | Rows |
|---|---|---|
| `latestNodeInfoAll()` — `SELECT DISTINCT ON (pubkey) … FROM lnd_node_info` (8.14 M rows, **only index = pkey(id)**) | **6.1–6.5 s** | 26 |
| same, bounded `AND timestamp > now()-30d` | **0.80 s** | 18 |
| `EXPLAIN (ANALYZE, BUFFERS)` of the unbounded form | full **parallel seq-scan of 8.17 M rows + external merge sort spilling ~215 MB/worker to disk** | — |
| `channelVolumeForFleet()` 90d UNION-ALL aggregate (2.8 M-row forwards) | 728 ms | 1 747 |
| `stepdownForFleet()` 35d aggregate | 383 ms | 17 |
| fee-signal per-node fan (26 × `latestChannelsForNode`, pool max 5) | **224 ms total** (~10 ms each — table is only 6 108 rows) | — |
| service-health per-host fan (16 × 1 query, nodemon) | **130 ms total** | — |
| htlc / cluster / fee-history / pending reads | ≤ 10 ms each | — |
| `SELECT 1` warm / with fresh connection | 5–8 ms / 60–75 ms | — |

**Conclusion of the baseline:** the entire ~8 s cold-page story is ONE query — the unindexed `DISTINCT ON (pubkey)` over 8.1 M-row `lnd_node_info` — executed on the critical path of every cold overview, every inbox cold load, every node-detail page, and (duplicated) once more per cold overview. The suspected N+1s are real but measured **harmless at current scale** (224 ms and 130 ms totals). The build axis is healthy.

---

## Findings

Ordered by Impact × Confidence.

| ID | Title | Axis | Impact | Confidence |
|---|---|---|---|---|
| PERF-01 | `latestNodeInfoAll` seq-scans 8.1 M rows → 6.5 s | render | **High (−5.7 s/cold load)** | High |
| PERF-02 | `loadFleetView()` has no TTL memo → 6-query re-read on every `/[pubkey]` load + duplicated on cold `/` | render | **High (−7 s/detail nav)** | High |
| PERF-03 | Serial waterfalls: fleet→detectors and nodeinfo→dimensions | render | Med (−0.5–1 s post-01) | High |
| PERF-04 | Overview memo miss recomputes in the foreground (7 s tail every 20 s) + 20 s/45 s TTL misalignment | render | Med | High |
| PERF-05 | `/inbox` ships 1.80 MB of HTML (all cards' view-models + export blocks serialized) | render | Med-Low | High |
| PERF-06 | Per-host / per-node query fans (16 + 26 queries) | render | Low (measured 130/224 ms) | High |
| PERF-07 | Boot health check = 6 sequential remote probes | build/startup | Low (~250 ms; more on high-RTT VM) | High |
| PERF-08 | Build/dev suspicions refuted; offline builds stall on Google-Fonts fetch | build | Info | High |

---

### PERF-01 — `latestNodeInfoAll` full-table DISTINCT ON costs 6.5 s
- **Axis:** render · **Impact:** High — saves ~5.7 s on every cold `/`, `/inbox`, `/[pubkey]/*` · **Confidence:** High (EXPLAIN + timed variants)
- **Root cause:** [src/lib/read/node-info.ts:44-56](src/lib/read/node-info.ts#L44-L56) — `buildLatestNodeInfoAllSql()`:
  ```sql
  SELECT DISTINCT ON (pubkey) … FROM lnd_node_info
  WHERE pubkey IS NOT NULL
  ORDER BY pubkey, timestamp DESC
  ```
  `lnd_node_info` has 8 142 408 live rows and **its only index is the primary key on `id`** (verified via `pg_indexes`). The plan is a parallel seq-scan of all 8.17 M rows plus an external merge sort spilling ~215 MB per worker: **6 557 ms** measured. This query sits on the critical path of `loadFleetView()` → both `loadInsightView()` and the overview/detail/modal pages.
- **Fix (in-app; the warehouse role cannot CREATE INDEX):** in `buildLatestNodeInfoAllSql()` add a recency bound aligned with the LOCKED 30-day staleness eliminator:
  ```sql
  WHERE pubkey IS NOT NULL
    AND timestamp > (now() AT TIME ZONE 'UTC') - make_interval(days => 30)
  ```
  Use a named constant (e.g. `const NODE_INFO_WINDOW_DAYS = 30`) with a comment tying it to `STALENESS_CUTOFF_DAYS` in [src/lib/overview/freshness-cutoff.ts:29](src/lib/overview/freshness-cutoff.ts#L29) (importing the constant from that pure module is also fine). Keep the `AT TIME ZONE 'UTC'` idiom — it matches `buildFeeHistorySql` ([src/lib/insight/fee-history.ts:60](src/lib/insight/fee-history.ts#L60)) and the WR-04 timezone posture. Measured result: **0.80 s, returns 18 rows** — exactly the 18 nodes with any data in 30 days (26 all-time).
- **Semantics change to call out (intentional):** nodes with ZERO rows in 30 days disappear from `FleetView`. The overview is unaffected — `applyFreshnessCutoff` already eliminates them ([src/app/(overview)/page.tsx:226](src/app/(overview)/page.tsx#L226)). But `/[pubkey]` and the modal for such a node will now `notFound()` instead of rendering an all-stale scorecard, and `/inbox` cards for them vanish (they were already filtered off the overview). If that 404 is unacceptable, use `latestNodeInfo(pubkey)` (single-node `LIMIT 1` form, [node-info.ts:63-77](src/lib/read/node-info.ts#L63-L77)) as a fallback in the detail page — but decide deliberately.
- **Also recommend (out of app scope):** ask the warehouse owner for `CREATE INDEX ON lnd_node_info (pubkey, timestamp DESC)` — that turns this into a ~10 ms index-only skip-scan-style read and removes the window trade-off entirely. The app cannot do this (read-only role, hard constraint).
- **Risk & verification:** risk = the >30d-stale-node 404 above; nothing else consumes `latestNodeInfoAll`. Verify: `curl -w %{time_total}` on `/` cold drops from ~7.9 s to ≤ 2.5 s; the fleet still shows 18 nodes; a pubkey with no 30d data 404s (expected).
- **Safe-to-apply-blindly?** **No** — the 404 semantics need the one-line decision above. With the `latestNodeInfo` fallback added, yes.

### PERF-02 — `loadFleetView()` has no cross-request memo
- **Axis:** render · **Impact:** High — `/[pubkey]/[tab]` and the scorecard modal pay the full fleet read (6 queries, 6.5 s today / ~1 s post-01) on EVERY navigation; cold `/` runs the whole fleet read TWICE · **Confidence:** High (measured 7.1–7.5 s per detail load, twice in a row)
- **Root cause:** [src/lib/scorecard/fleet.ts:188-241](src/lib/scorecard/fleet.ts#L188-L241) — `loadFleetView()` is bare. Contrast [src/lib/insight/engine.ts:365-406](src/lib/insight/engine.ts#L365-L406) (`_insightViewCache`, 45 s promise memo) and [src/app/(overview)/page.tsx:146-176](src/app/(overview)/page.tsx#L146-L176) (`_overviewDataCache`, 20 s). Call sites that each trigger a fresh run: `buildOverviewData` ([page.tsx:195](src/app/(overview)/page.tsx#L195)) **and** `computeInsightView` ([engine.ts:418](src/lib/insight/engine.ts#L418)) concurrently on cold `/`; `getFleet = cache(loadFleetView)` in [src/app/(overview)/[pubkey]/[tab]/page.tsx:76](src/app/(overview)/[pubkey]/[tab]/page.tsx#L76) (React `cache()` dedupes only within one request); the modal at `src/app/(overview)/@modal/(.)[pubkey]/page.tsx:35`.
- **Fix:** replicate the engine.ts memo pattern verbatim in `fleet.ts`: add `export const FLEET_TTL_MS = 45_000;` (same value as `INSIGHT_TTL_MS` so one fleet read serves both views), a `globalThis`-cached `{ at, promise }` entry named `_fleetViewCache`, promise-collapse + evict-on-reject exactly as [engine.ts:388-406](src/lib/insight/engine.ts#L388-L406), wrapping the existing body (rename it `computeFleetView`). Leave every caller untouched — including the `cache(loadFleetView)` wrapper in `[tab]/page.tsx` (it now hits the memo). `fetchedAt` stays the real compute stamp, so `FreshnessStamp`/`PollAge` honesty holds (staleness display windows are hours; 45 s is far under — same argument already accepted for `_insightViewCache`, operator-approved 2026-06-16).
- **Risk & verification:** none beyond data being ≤ 45 s old on detail pages (already true of the inbox). Verify: second load of `/[pubkey]/scorecard` within 45 s returns in < 300 ms; cold `/` issues the nodeinfo query once, not twice (watch `pg_stat_activity` or add temporary timing logs).
- **Safe-to-apply-blindly?** **Yes.**

### PERF-03 — serial waterfalls ahead of independent reads
- **Axis:** render · **Impact:** Med — ~0.5–1 s of the post-PERF-01 cold path · **Confidence:** High (code order; component timings measured)
- **Root cause A:** [src/lib/insight/engine.ts:418](src/lib/insight/engine.ts#L418) — `const fleet = await loadFleetView();` completes BEFORE the 8-way detector `Promise.all` ([engine.ts:424-464](src/lib/insight/engine.ts#L424-L464)) starts. Only ONE of the eight reads (`feeSignalChannelsForNode` fan) needs `fleet`; htlc/volume/stepdown/cluster/rebalance/fee-history/pending are independent. Cold path = 6.5 s (fleet) **then** ~0.8 s (volume aggregate) sequentially.
- **Root cause B:** [src/lib/scorecard/fleet.ts:191-202](src/lib/scorecard/fleet.ts#L191-L202) — `await latestNodeInfoAll()` completes before the five fleet-wide dimension aggregates start; they don't consume the node rows.
- **Fix:**
  - In `computeInsightView`: start `const fleetPromise = loadFleetView();` without awaiting; move the seven fleet-independent `degrade(...)` reads into a `Promise.all` started immediately; `const fleet = await fleetPromise;` then run the `feeSignalChannelsForNode` fan (keep its own `Promise.all` + degrade). Assembly code below is unchanged.
  - In `loadFleetView` (post-rename `computeFleetView`): `const [rows, [routingMap, revenueMap, liquidityMap, forceCloseMap, restartMap]] = await Promise.all([latestNodeInfoAll(), Promise.all([routingForFleet(), revenueForFleet(), liquidityForFleet(), forceCloseForFleet(), restartForFleet()])]);` then proceed.
- **Risk & verification:** none functional — same reads, same inputs to `assembleCards` (fail-soft `degrade` wrappers preserved). Verify: cold `/` ≈ max(0.8 s nodeinfo, 0.73 s volume) + 0.22 s fan ≈ **1.3–1.8 s** instead of ~2.4 s.
- **Safe-to-apply-blindly?** **Yes** (keep the degrade wrappers exactly as they are).

### PERF-04 — foreground memo refresh + 20 s/45 s TTL misalignment
- **Axis:** render · **Impact:** Med — today a 6.8 s stall for whoever loads `/` between 20 s and 45 s (measured); post-01/02/03 still a ~1.5 s stall every 20 s · **Confidence:** High
- **Root cause:** [src/app/(overview)/page.tsx:146](src/app/(overview)/page.tsx#L146) `OVERVIEW_TTL_MS = 20_000` vs [engine.ts:365](src/lib/insight/engine.ts#L365) `INSIGHT_TTL_MS = 45_000`; and `loadOverviewData()` ([page.tsx:158-176](src/app/(overview)/page.tsx#L158-L176)) computes the fresh assembly **in the request's foreground** on memo miss — the operator eats the recompute latency as page latency.
- **Fix (two independent steps):**
  1. Align TTLs: set `OVERVIEW_TTL_MS` to `45_000` (or import/share one constant). Removes the 20–45 s window where `/` re-reads fleet+hosts+chain+services while insight is still memo-hit.
  2. Stale-while-revalidate in `loadOverviewData()` (and optionally `loadInsightView()`): on TTL expiry, if a previous resolved entry exists, RETURN the old promise and kick `buildOverviewData()` in the background, swapping `_overviewDataCache` when it resolves (keep the existing evict-on-reject). `fetchedAt` keeps the honest OLD stamp until the swap — `PollAge` ticks truthfully, nothing fakes freshness (the pill simply shows e.g. "50s ago" until the background refresh lands).
- **Risk & verification:** step 2 means the operator can see data up to ~TTL+compute old, honestly stamped — consistent with the honest-stale posture; confirm with product owner if "never older than 20 s" was load-bearing (nothing in the code says so; the display windows are hours). Verify: no request to `/` after warm-up ever exceeds ~100 ms; `PollAge` still advances monotonically from the real epoch.
- **Safe-to-apply-blindly?** Step 1 **yes**; step 2 **yes** technically, flag the freshness-window change in the PR description.

### PERF-05 — `/inbox` ships 1.80 MB of HTML
- **Axis:** render · **Impact:** Med-Low (LAN transfer + client parse/hydrate; grows linearly with card count) · **Confidence:** High (measured `size_download` 1 804 582 B)
- **Root cause:** [src/app/(overview)/inbox/page.tsx:224-240](src/app/(overview)/inbox/page.tsx#L224-L240) — the loop builds `cardViewModels`, `batchRows`, and `enqueueById` for **every card in `view.cards`**, and each view-model carries a pre-built `buildExportBlock(card)` string; all of it serializes into the `InboxTriage` island props regardless of the active facet. The facet-narrowed `visible` set ([inbox/page.tsx:214](src/app/(overview)/inbox/page.tsx#L214)) is what actually renders.
- **Fix:** build `cardViewModels`/`batchRows` only for the cards that can render in this response: iterate `visible` (plus `suppressed` if the SuppressedBlock renders expandable rows) instead of `view.cards`. Keep `facetCounts(view.cards)` as-is (Pitfall 2 — counts stay fleet-wide). If deep-link `?card=` can reference a card outside `visible`, resolve THAT one card additionally before the `activeCardId` whitelist check at [inbox/page.tsx:243](src/app/(overview)/inbox/page.tsx#L243).
- **Risk & verification:** the `?card` whitelist must keep working for faceted-out ids (test: open a card link, then add an excluding facet — drawer should still degrade gracefully). Verify: `curl -w %{size_download}` on `/inbox` drops several-fold with default facets.
- **Safe-to-apply-blindly?** **No** — the `?card` edge case needs the explicit handling above.

### PERF-06 — per-host / per-node query fans (the suspected N+1s)
- **Axis:** render · **Impact:** Low at current scale — **measured 130 ms** for the 16-host service fan ([src/app/(overview)/page.tsx:211-218](src/app/(overview)/page.tsx#L211-L218) → [src/lib/read/service-health.ts:60-99](src/lib/read/service-health.ts#L60-L99)) and **224 ms** for the 26-node fee-signal fan ([engine.ts:436-440](src/lib/insight/engine.ts#L436-L440) → [src/lib/read/latest.ts](src/lib/read/latest.ts)) · **Confidence:** High
- **Verdict on the suspicion:** REAL as a pattern, REFUTED as the 8 s cause. The pool (`max: 5`) pipelines them; each unit query is ~10 ms because `lnd_node_channel_info` is only 6 108 rows and the nodemon tables are small.
- **Fix (optional, do after the High items):** single fleet-wide variants measured: service-health 1-query form 225 ms (no faster wall-clock, but 1 connection slot instead of 16 — batch by dropping `WHERE host_id = $1`, keeping `host_id IS NOT NULL`, then group rows by `host_id` in `getServiceHealth`'s caller); latest-channels fleet-wide `DISTINCT ON (local_pubkey, chan_id)` measured **106 ms for all 6 108 rows** vs 224 ms fanned — worth doing only as part of a tidy-up; it also removes 26 queries/cold-load of warehouse chatter. Also note the second-stage waterfall: `serviceArrays` awaits AFTER the first `Promise.all` completes ([page.tsx:211](src/app/(overview)/page.tsx#L211)) because it needs `hosts0` — with a fleet-wide service query it could join the first `Promise.all` outright.
- **Risk & verification:** preserve the AFM-001 shape (DISTINCT ON with NOT-NULL key guards, inventory-driven LEFT JOIN — see the module comments; the MAX-timestamp form is the documented catastrophic failure). Add the fleet-wide SQL builders alongside the per-key ones so the no-DB shape tests keep passing, and add a shape test for each new builder.
- **Safe-to-apply-blindly?** **Yes** for the service-health batch; **yes** for the channel batch if the shape tests are extended.

### PERF-07 — boot health check is 6 sequential remote probes
- **Axis:** startup · **Impact:** Low here (~250 ms measured with fresh connections); scales with RTT on the VM · **Confidence:** High
- **Root cause:** [src/lib/db/health.ts:99-115](src/lib/db/health.ts#L99-L115) — `runStartupHealthCheck()` awaits reachability ×3, read-only probes ×2, writable probe ×1 strictly in series; runs at every server boot via [src/instrumentation.ts](src/instrumentation.ts).
- **Fix:** group per-database and parallelize across databases: `await Promise.all([ (async () => { await assertReachable(dbRouting,…); await assertReadOnly(dbRouting,…); })(), (async () => { await assertReachable(dbLdk,…); await assertReadOnly(dbLdk,…); })(), (async () => { await assertReachable(dbNodemon,…); await assertWritable(dbNodemon,…); })() ]);` — keep reachable-before-probe ordering *within* each DB. Fail-loud posture unchanged (any rejection still aborts boot).
- **Risk & verification:** none — same assertions. Verify boot log ordering unaffected; `next start` Ready stays < 1 s.
- **Safe-to-apply-blindly?** **Yes.**

### PERF-08 — build/dev axis: suspicions refuted + one offline hazard
- **Axis:** build · **Impact:** Info · **Confidence:** High
- **Findings:**
  - `next dev` **already runs Turbopack** (Next 16 default); adding `--turbopack` to the dev script changes nothing. The empty [next.config.ts](next.config.ts) is not costing build/render time.
  - Clean `next build` = 7.3–7.6 s; Turbopack compile 2.1 s; `tsc` dominates. No action worth taking; `typescript.ignoreBuildErrors` is NOT recommended (strict-mode project).
  - The observed "slow dev startup" could not be reproduced uncontended, but 281 s was measured when **two dev instances shared `.next/dev`** — never run a second `next dev`/`next build` against a repo with a live dev server (my own audit corrupted `.next` this way; a clean rebuild fixed it).
  - **Offline/network-restricted builds stall for ~20 minutes** on `next/font/google` fetch retries (observed under a network sandbox): [src/app/layout.tsx:2-31](src/app/layout.tsx#L2-L31) loads 4 Google font families at build time. For the VM deploy, either guarantee outbound network at build time, build locally and ship `.next`, or (zero-dependency fix) vendor the woff2 files and switch to `next/font/local`.
- **Safe-to-apply-blindly?** n/a (informational).

---

## Quick wins (do these first, in order)

1. **PERF-02** — add the 45 s TTL memo to `loadFleetView` (pure copy of the existing `engine.ts` pattern; zero semantic questions). Instantly fixes the 7 s-per-navigation node-detail pages and halves cold-`/` warehouse load.
2. **PERF-01** — add the 30-day bound to `buildLatestNodeInfoAllSql` (+ the `latestNodeInfo` fallback decision for `/[pubkey]`). 6.5 s → 0.8 s on the one query that dominates everything.
3. **PERF-03** — un-serialize the two waterfalls (mechanical `Promise.all` reshuffles).

Projected cold `/` after 1–3: **~1.3–1.8 s** (from 7.9 s); node-detail warm navigations: **< 300 ms** (from 7.3 s). Then PERF-04 makes every post-warm-up load ~15 ms.

## Do NOT touch

- **The `DISTINCT ON` + NOT-NULL-key query shape** (AFM-001) in `latest.ts` / `node-info.ts` / `service-health.ts` / `host-metrics.ts` / `chain-telemetry.ts` — the "cheaper-looking" `WHERE timestamp = MAX(...)` form is the documented N-read-as-1 production failure. Optimize *around* it (windows, batching), never away from it.
- **`export const dynamic = "force-dynamic"` / `revalidate = 0`** on every live page — intentional (honest live reads; `unstable_cache` was explicitly rejected because it JSON-serializes the `Date` stamps). The TTL memos are the sanctioned caching layer; improve them, don't replace them with ISR.
- **The `degrade()` fail-soft wrappers and per-read `.catch`es** — fail-loud-in-logs/fail-soft-in-render posture; folding reads together in a way that loses per-read degradation is a regression.
- **`prepare: warehousePrepareFlag()` and pool `max: 5`** in the DB clients — correct for a long-running single process on direct connections; no serverless-style tuning.
- **`QueueIsland` client-side filtering and the `PollAge` honest ticking pill** — just-shipped 12-13/14/15 design; the island exists precisely so filter clicks don't re-run reads.
- **Recharts** — already confined to `/design-system`'s bundle (`EvidenceChart` is its only importer); no route-level bloat to fix.
- **The nodemon reads going through the RW client** — by design (telemetry lives in nodemon); the RW client is not a perf concern.

## Bug notes (found while measuring — not perf, report only)

- **`/queue` returns HTTP 500** in production: `TypeError: Cannot read properties of undefined (reading 'toLocaleString')` rendering queue rows — [src/app/(overview)/queue/page.tsx:306](src/app/(overview)/queue/page.tsx#L306) `row.params.timeLockDelta.toLocaleString("en-US")` (and the `proposed` value at line 197) assume every queued command's `params` carries `update_fee` fields; a row whose params lack `timeLockDelta` crashes the whole page. Needs a null guard / params-shape gate.
- During the audit I twice ran `rm -rf .next` while the operator's dev server (PID 38539, port 3000) was live, which deleted its Turbopack cache out from under it. The server still responds (200 in 0.29 s) and will transparently recompile routes on demand, but the next few dev navigations will be cold. A valid production build now sits in `.next`.

## Measurement method (reproducibility)

- **Query timings:** read-only Node scripts in the session scratchpad (`perf-queries*.mjs`) using the repo's own `postgres` driver against the `.env.local` URLs; warehouses additionally guarded with `default_transaction_read_only`. Only `SELECT`/`EXPLAIN` issued. Each timing above lists individual runs.
- **Page timings:** `next build` (clean) + `PORT=3100 next start`, `curl -w %{time_total}` sequenced across the 20 s/45 s TTL boundaries with in-script waits.
- **Build timings:** `/usr/bin/time -p` on clean `npx next build` (unsandboxed), twice; `tsc --noEmit` separately.
- **Query counts:** static trace of every `.execute()`/`select()` call site reachable from each route (all listed files read in full); cross-checked against the engine's own "~35 warehouse queries" comment ([engine.ts:355](src/lib/insight/engine.ts#L355)).
- **Not measured:** HMR (would require editing files — read-only audit); uncontended cold `next dev` (see PERF-08); per-page numbers on the target VM (different RTT — re-run the curl sequence there after deploy).
