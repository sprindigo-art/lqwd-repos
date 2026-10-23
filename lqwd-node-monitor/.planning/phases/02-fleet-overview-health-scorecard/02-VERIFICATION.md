---
phase: 02-fleet-overview-health-scorecard
verified: 2026-06-10T04:30:00Z
status: passed
score: 32/32 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 28/32
  gaps_closed:
    - "Liquidity computes over AFM-001 latest channel state (per-node) — DISTINCT ON (local_pubkey, chan_id) partitioned key (CR-01, fixed in 70b0011)"
    - "Freshness = oldest of the latest depended-on timestamps; past tunable threshold → stale flag (D-13) — parseDbTimestampUtc UTC boundary at all 4 raw-execute coercion sites (WR-01, fixed in 441d02a)"
  gaps_remaining: []
  regressions: []
human_verification_completed:
  - "02-07 visual checkpoint resolved 'approved with notes' by operator; visual polish debt tracked in .planning/todos/pending/ui-polish-fleet-console.md (operator-accepted — NOT counted as gaps)"
  - "D-13 restart-exclusion deviation ratified by operator at the 02-07 checkpoint"
---

# Phase 2: Fleet Overview + Health Scorecard — Verification Report

**Phase Goal:** The operator's "where do I look first" entry point — every node ranked at a glance, scored on 10 curated dimensions, compared against the rest of the fleet.
**Verified:** 2026-06-10T04:30:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (initial verification 2026-06-10T04:25:00Z, gaps_found 28/32)

## Re-verification (Gap Closure)

Scope per re-verification protocol: full 3-level + live verification of the 2 failed items; quick regression check on the 28 previously-passed items (full suite + build + live golden re-run). The 28 previously-verified must-haves and the operator-ratified deviations (D-13 restart exclusion, UI polish debt) were NOT re-litigated.

### Gap 1 — CR-01: liquidity cross-partition collapse — ✓ CLOSED

**Fix commit:** `70b0011` — fix(02): CR-01 — partition fleet-wide DISTINCT ON by (local_pubkey, chan_id)

Independently verified in source (not from SUMMARY/commit message):

- `src/lib/scorecard/dimensions/liquidity.ts:67-71` — subquery is now `SELECT DISTINCT ON (local_pubkey, chan_id) * ... ORDER BY local_pubkey, chan_id, timestamp DESC` (ORDER BY leading columns match the DISTINCT key, the sanctioned AFM-001 idiom per-node-partitioned).
- Both NULL-key guards (`chan_id IS NOT NULL AND local_pubkey IS NOT NULL`) moved INTO the subquery (lines 69-70), exactly as the gap's `missing` list required.
- `src/lib/scorecard/dimensions/liquidity.test.ts:30-43` — shape test now asserts `distinct on (local_pubkey, chan_id)` + matching ORDER BY, carries an explicit **regression pin** `expect(sql).not.toContain("distinct on (chan_id)")`, and asserts both NULL guards inside the subquery. The suite that previously enforced the bug now forbids it.
- **Live probe (read-only, this re-verification):** the partitioned latest-state subquery returns 6,040 rows; the old un-partitioned key also returns 6,040 — zero chan_ids currently span two `local_pubkey` partitions in `lnd_node_channel_info`, so the defect is **latent in today's snapshot** (no LND↔LND intra-fleet pairs both reporting at present). Fix verified at SQL-shape level + regression-pinned; no behavioral regression on live data (identical sums today, corruption prevented the moment an intra-fleet LND pair appears).

### Gap 2 — WR-01: freshness epoch skew — ✓ CLOSED

**Fix commit:** `441d02a` — fix(02): WR-01 — parse offset-less warehouse timestamps as UTC at all read boundaries

Independently verified in source:

- New helper `src/lib/read/db-timestamp.ts` — `parseDbTimestampUtc`: Date passthrough; explicit-offset strings parsed as-is (offset detection via `/[Zz+-]/` on `slice(10)`, correctly skipping the date's own hyphens); offset-less strings normalized (space→`T`) + `Z` appended → pinned UTC; null/unparseable → null (never Invalid Date).
- All 4 raw-execute string-timestamp coercion sites from the gap are wired to the helper (grep-verified):
  - `src/lib/read/node-info.ts:84` (coerceTimestamp path — the lnd_node_info boundary)
  - `src/lib/scorecard/dimensions/liquidity.ts:137` (as_of)
  - `src/lib/scorecard/dimensions/force-close.ts:128` (as_of)
  - `src/lib/scorecard/dimensions/restart.ts:47` (last_restart)
- **No bare string-timestamp coercions remain:** the only other `new Date(` sites in `src/lib` are numeric nanosecond-epoch conversions (`revenue.ts:77`, `routing.ts:69` — TZ-unambiguous), `isStale`'s now-default, and `fleet.ts:240` fetchedAt — none are driver-boundary string parses.
- Tests: `db-timestamp.test.ts` — 9 tests covering offset-less UTC pinning, explicit-offset passthrough (`Z`, `+00`, `-07:00`), Date passthrough, null, unparseable. `restart.test.ts:64-71` — the previously-masking `'+00'`-suffixed fixture replaced with an **offset-less fixture** asserting `toRestartDate("2025-03-13 04:05:06").getTime() === Date.UTC(...)` — fails on any non-UTC host if the coercion regresses.
- **Live probe (read-only, this re-verification, America/Vancouver host):** raw offset-less `MAX(timestamp)` string `2026-06-10 04:26:12` → `parseDbTimestampUtc` → `2026-06-10T04:26:12.000Z`; warehouse now-UTC `04:27:17Z`; computed age **1.1 minutes** (previously this exact probe showed a **+7h** skew that pushed the 6h D-13 stale flag to ~13h). The "fail loud on stale data" contract now holds on non-UTC hosts.

### Regression Checks (previously-passed items)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `npm test` | **141 passed / 14 skipped** (was 131/14 — +9 db-timestamp tests, +1 restart offset-less regression test) | ✓ PASS |
| D-14 Canada golden LIVE | `source .env.local; npx vitest run src/lib/scorecard/golden-scorecard.test.ts` | **10/10 passed, 16.7s** — re-run live in this re-verification | ✓ PASS |
| Production build | `npm run build` | Green; route table unchanged: ƒ /, ƒ /[pubkey], ƒ /(.)[pubkey]; no (status) | ✓ PASS |
| WR-01 live TZ probe | raw string → helper vs db now-UTC | age 1.1 min (was +7h skew) | ✓ PASS |
| CR-01 live shape probe | partitioned vs un-partitioned latest-state row counts | 6,040 = 6,040; 0 cross-partition chan_ids today (defect latent, fix correct + regression-pinned) | ✓ PASS |

No regressions detected. No new gaps introduced by the fixes.

### Updated Truth Roll-up

- SC1 (fleet overview + freshness stamp): PARTIAL → **✓ VERIFIED** (stale flag now fires at the configured 6h on any host TZ)
- SC2 (per-node 10-dimension scorecard): PARTIAL → **✓ VERIFIED** (10/10 dimensions correct; liquidity partition key fixed)
- Plan truth 9 (D-13 freshness/stale): FAILED → **✓ VERIFIED**
- Plan truth 11 (liquidity over AFM-001 latest state per-node): FAILED → **✓ VERIFIED**
- FLEET-02 requirement: PARTIAL → **✓ SATISFIED**
- Artifact `src/lib/scorecard/dimensions/liquidity.ts`: HOLLOW → **✓ VERIFIED**; new artifact `src/lib/read/db-timestamp.ts` (40 lines + 63-line test): **✓ VERIFIED, WIRED** (4 importers)

**Score:** 32/32 truths verified

---

## Original Verification Findings (2026-06-10T04:25:00Z) — preserved as history

> Status at initial verification: **gaps_found**, 28/32. The two gaps below were closed by commits `70b0011` (CR-01) and `441d02a` (WR-01) and verified closed above. Everything else in this section was verified in the initial pass and regression-checked (suite/build/golden) in the re-verification.

### Original Gaps (now closed)

```yaml
gaps:  # HISTORICAL — closed by 70b0011 and 441d02a, verified above
  - truth: "Liquidity computes over AFM-001 latest channel state (per-node) — the sanctioned DISTINCT ON latest-state idiom"
    status: failed
    reason: "buildLiquidityAllSql runs DISTINCT ON (chan_id) across ALL node partitions at once. lnd_node_channel_info is partitioned per node by local_pubkey; an intra-fleet channel (A↔B) produces rows with the SAME chan_id under both partitions, so only one side survives the fleet-wide collapse — the other node's local_balance/capacity silently vanish from its sums, corrupting its outbound ratio, its liquidity grade, and the MAD cohort it feeds (02-REVIEW CR-01, Critical; confirmed in source). The Phase 1 sanctioned idiom (src/lib/read/latest.ts) applies DISTINCT ON (chan_id) only AFTER filtering WHERE local_pubkey = $x. The D-14 golden cannot catch this (ratio stays in [0,1]; capacity stays > 1e9)."
    artifacts:
      - path: "src/lib/scorecard/dimensions/liquidity.ts"
        issue: "Lines 59-62: SELECT DISTINCT ON (chan_id) ... ORDER BY chan_id, timestamp DESC with no local_pubkey in the DISTINCT key; local_pubkey IS NOT NULL guard sits in the OUTER query"
      - path: "src/lib/scorecard/dimensions/liquidity.test.ts"
        issue: "Shape test pins the wrong (un-partitioned) SQL form, so the suite enforces the bug"
    missing:
      - "DISTINCT ON (local_pubkey, chan_id) ... ORDER BY local_pubkey, chan_id, timestamp DESC, with local_pubkey IS NOT NULL moved into the subquery"
      - "Updated liquidity.test.ts asserting the partitioned latest-state key"
  - truth: "Freshness = oldest of the latest depended-on timestamps; past tunable threshold → stale flag (D-13)"
    status: failed
    reason: "Verified live: every consumed warehouse timestamp column (lnd_node_info.timestamp, lnd_node_channel_info.timestamp, lnd_node_closed_channels.timestamp, lnd_restart.last_restart) is `timestamp WITHOUT time zone` and the writer stores UTC wall time (max(timestamp) 2026-06-10 04:10 vs db now-UTC 04:13). postgres.js surfaces these as offset-less strings; new Date(offset-less) parses HOST-LOCAL. On the current America/Vancouver host the parse lands +7h in the future (probe: '2026-06-10 04:10:26' → 2026-06-10T11:10:26Z), so node age is understated by 7h fleet-wide and the 6h stale flag cannot fire until data is ~13h old. The D-13 'fail loud on stale data' contract (roadmap SC-1 freshness stamp) is broken on any non-UTC host. (02-REVIEW WR-01, elevated from warning to failure by live evidence.)"
    artifacts:
      - path: "src/lib/read/node-info.ts"
        issue: "coerceTimestamp (lines 77-82): new Date(offset-less string) → host-local interpretation"
      - path: "src/lib/scorecard/dimensions/liquidity.ts"
        issue: "Line 125: new Date(row.as_of) — same ambiguous boundary parse"
      - path: "src/lib/scorecard/dimensions/force-close.ts"
        issue: "as_of coercion — same ambiguous boundary parse"
      - path: "src/lib/scorecard/dimensions/restart.ts"
        issue: "last_restart coercion — same parse; test fixture uses a '+00'-suffixed string that masks the bug"
    missing:
      - "UTC-explicit driver boundary: select EXTRACT(EPOCH FROM ...) * 1000 AS as_of_ms, or MAX(timestamp) AT TIME ZONE 'UTC', or treat offset-less strings as UTC in the coercion helpers"
      - "Regression test using an OFFSET-LESS timestamp fixture asserting UTC interpretation"
```

## Goal Achievement

### Observable Truths — Roadmap Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Fleet overview listing all nodes with at-a-glance health, curated, each with a freshness stamp | ✓ VERIFIED | `src/app/(overview)/page.tsx` renders loadFleetView verbatim (dot + backend + alias + grade + reason + chips + FreshnessStamp, D-09 sorted); build green, `/` dynamic. ~~Stale flag skewed +7h~~ → **closed by 441d02a**: live probe shows age 1.1 min, stale flag fires at the configured 6h |
| SC2 | Per-node 10-dimension scorecard computed from the warehouse | ✓ VERIFIED | `/{pubkey}` renders 10 dimensions via ScorecardPanel (7 graded, peer partial, 3 greyed); golden pipeline live-verified 10 dims. ~~Liquidity misattribution~~ → **closed by 70b0011**: partitioned DISTINCT key, regression-pinned — 10/10 dimensions correct |
| SC3 | Compare each node against fleet-median bands, surfacing outliers vs peers | ✓ VERIFIED | `attachPeerRelative` (fleet.ts): per-backend, per-dimension MAD cohorts via `outlierFor`; D-11 cohort<3 suppression; D-12 violet marker never alters grade. Liquidity cohort inputs now clean (Gap 1 closed) |
| SC4 | Scorecard numbers validate against known lqwdLogs reference values for ≥1 node before downstream acts | ✓ VERIFIED | D-14 golden suite re-run LIVE in this re-verification: 10/10 passed, 16.7s (initially 10/10, 17.5s) |

### Observable Truths — Plan Must-Haves (merged, deduplicated)

| # | Truth (plan) | Status | Evidence |
|---|--------------|--------|----------|
| 1 | All lnd_node_info reads via latestNodeInfo/latestNodeInfoAll DISTINCT ON (pubkey) (02-01) | ✓ VERIFIED | node-info.ts DISTINCT ON (pubkey) + WR-01 NULL guard; fleet.ts is the only consumer entry; golden proves 26 rows from 8.05M |
| 2 | 5 routing_vm tables typed, no push/migrate (02-01) | ✓ VERIFIED | 7 `pgTable(` exports in schema/routing.ts; live information_schema probe matched declared types |
| 3 | "TRUE SNAPSHOT" comment corrected to APPEND-ONLY (02-01) | ✓ VERIFIED | grep: 0 hits "TRUE SNAPSHOT", APPEND-ONLY annotation at routing.ts:64 |
| 4 | Single editable config: thresholds/Tier-1/MAD-N/staleness per-dimension AND per-backend (02-02, D-02) | ✓ VERIFIED | config.ts: SCORECARD_CONFIG, COMPARE_CONFIG, STALENESS; grade.ts takes DimConfig |
| 5 | Red ONLY via Tier-1 breach; warns cap at yellow (02-02, D-07) | ✓ VERIFIED | nodeDot/criticalChips in grade.ts; components receive color as prop, never re-derive |
| 6 | Composite = unweighted mean of available dims; no-data excluded (02-02, D-06) | ✓ VERIFIED | compositeOf (grade.ts); fleet.test.ts assembly test |
| 7 | MAD outlier separate signal; cohort<3 suppressed (02-02, D-10/11/12) | ✓ VERIFIED | compare.ts outlierCheck/outlierFor; "cohort of 2 → suppressed" test |
| 8 | Backend from operator config map, env-overridable, never warehouse-derived (02-02, D-03/D-04) | ✓ VERIFIED | backends.ts: backendFor with NODE_BACKENDS fail-loud parse |
| 9 | Freshness: oldest depended-on timestamp; past threshold → stale flag (02-02, D-13) | ✓ VERIFIED | **Re-verified after 441d02a**: parseDbTimestampUtc at all 4 raw-execute boundaries; live probe age 1.1 min on Vancouver host (was +7h skew); 9 helper tests + offset-less restart fixture |
| 10 | Routing/revenue: nanosecond windows (×1e9) + fee_msat/1000.0, never raw fee (02-03, AFM-002) | ✓ VERIFIED | `*1e9` in SQL text; zero raw-`fee` references; golden AFM-002 ±1% passed live |
| 11 | Liquidity over AFM-001 latest channel state (02-03) | ✓ VERIFIED | **Re-verified after 70b0011**: DISTINCT ON (local_pubkey, chan_id) + matching ORDER BY, NULL guards in subquery (liquidity.ts:67-71); shape test pins partitioned key + forbids the bare chan_id key; live probe confirms no regression |
| 12 | Channel health from latestNodeInfo rows, not bare selects (02-03) | ✓ VERIFIED | channelHealthFromNodeInfo is a pure transform over LatestNodeInfoRow[] |
| 13 | Dimensions return { raw, asOf, extras } only — no grades/thresholds (02-03, D-02) | ✓ VERIFIED | All 7 dimension modules return Map<pubkey, DimensionResult>; grading only in grade.ts |
| 14 | Force-close carries AP-11 extras.maxHourlySelfCloses Tier-1 input (02-04) | ✓ VERIFIED | buildSelfCloseStormSql + merge; config.ts tier1 >= 50; key-string match asserted |
| 15 | Restart is recency-only (no restart-loop promise) (02-04) | ✓ VERIFIED | restart.ts banner + hoursSince; lnd_restart latest-only (4 columns, live-verified) |
| 16 | Peer uses num_peers from latestNodeInfo, NEVER lnd_node_peer_info COUNT(*), marked partial (02-04) | ✓ VERIFIED | peer.ts: type-only import, zero DB imports, partial note |
| 17 | shadcn/ui initialized (components.json + card/table/badge/tooltip) (02-05) | ✓ VERIFIED | components.json; 5 primitives in src/components/ui/ |
| 18 | 6 health-status tokens in @theme; navy never a health color (02-05) | ✓ VERIFIED | globals.css:19-24; 0 hits `#F7931A` under src/ |
| 19 | Red bound exclusively to Tier-1; outlier renders neutral violet (02-05, D-07/D-12) | ✓ VERIFIED | CriticalChip vs OutlierMarker (#8b5cf6); colors arrive as props |
| 20 | Status copy matches UI-SPEC contract (02-05) | ✓ VERIFIED | "No data — needs log ingestion", "No peer baseline yet"; operator approved at 02-07 checkpoint |
| 21 | loadFleetView assembles all nodes → dims → grades → MAD → freshness → D-09 sort (02-06) | ✓ VERIFIED | fleet.ts full pipeline; 11 no-DB tests + live golden pipeline pass |
| 22 | Backend label from backendFor(pubkey), not mapper provenance (02-06, D-03) | ✓ VERIFIED | fleet.ts — backendFor after mapLndNode |
| 23 | Restart + no-data dims excluded from freshness floor; LDK cohort suppressed (02-06, D-13 deviation) | ✓ VERIFIED | Deviation ratified by operator at 02-07 checkpoint; restart timestamp still surfaced |
| 24 | Canada golden validates live BEFORE downstream (02-06, D-14) | ✓ VERIFIED | Re-run live in this re-verification: 10/10 passed |
| 25 | Fleet overview at / with full row anatomy, criticals-first sort (02-07, FLEET-01) | ✓ VERIFIED | page.tsx: force-dynamic, pre-sorted FleetView verbatim; build emits `ƒ /` |
| 26 | /{pubkey}: 10 dims, peer partial, 3 greyed, peer-relative + LDK no-peer-baseline (02-07, FLEET-02/03) | ✓ VERIFIED | [pubkey]/page.tsx + ScorecardPanel + DimensionRow state machine; golden asserts 10 dims / 3 nodata live |
| 27 | pubkey regex-validated before any query (02-07, ASVS V5) | ✓ VERIFIED | `/^[0-9a-f]{66}$/` before getFleet(); same in modal route |
| 28 | Phase-1 (status) page removed — bare select not routable (02-07) | ✓ VERIFIED | src/app/(status)/ gone; build route table re-confirmed in re-verification: only /, /[pubkey], /(.)[pubkey] |

**Score:** 32/32 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/db/schema/routing.ts` | 5 new typed tables + corrected comment | ✓ VERIFIED | 7 pgTable exports, APPEND-ONLY annotation |
| `src/lib/read/node-info.ts` | Sanctioned latest-per-node readers | ✓ VERIFIED | All 4 exports; timestamp boundary now via parseDbTimestampUtc (line 84) |
| `src/lib/read/db-timestamp.ts` | WR-01 UTC-explicit boundary helper (new in gap closure) | ✓ VERIFIED | 40 lines, substantive; wired into 4 consumers; 9 tests |
| `src/lib/scorecard/types.ts` / `config.ts` / `grade.ts` / `compare.ts` / `freshness.ts` | Pure contracts + tuning + math | ✓ VERIFIED | All declared exports confirmed; pure tests pass |
| `src/lib/config/backends.ts` | backendFor with env override | ✓ VERIFIED | server-only, fail-loud NODE_BACKENDS parse |
| `src/lib/scorecard/dimensions/*` (7 modules) | builder + executor per dimension | ✓ VERIFIED | All 7 verified; liquidity.ts HOLLOW → VERIFIED after 70b0011 (partitioned latest-state key) |
| `src/lib/scorecard/fleet.ts` | loadFleetView/sortFleet/assembleScorecard | ✓ VERIFIED | All 3 exports; consumed by all 3 page surfaces |
| `src/lib/scorecard/golden-scorecard.test.ts` | D-14 live gate (describe.skipIf) | ✓ VERIFIED | Passed live 10/10 in both verification passes |
| `components.json` + `src/components/ui/*` | shadcn init | ✓ VERIFIED | card/table/badge/tooltip/dialog vendored |
| `src/app/globals.css` | 6 status tokens | ✓ VERIFIED | --color-status-* at lines 19-24 |
| `src/components/scorecard/*` (8 components) | presentational, no DB imports | ✓ VERIFIED | Zero `@/lib/db` imports under src/components |
| `src/app/(overview)/page.tsx` | FLEET-01 overview, force-dynamic | ✓ VERIFIED | force-dynamic; renders loadFleetView |
| `src/app/(overview)/[pubkey]/page.tsx` | FLEET-02 scorecard, notFound | ✓ VERIFIED | notFound; regex-gated |
| `src/app/(status)/page.tsx` | REMOVED | ✓ VERIFIED | Directory gone; not in build route table |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| node-info.ts | warehouse-routing.ts | lazy `await import` | ✓ WIRED | |
| node-info.ts | lnd_node_info | DISTINCT ON (pubkey) ORDER BY pubkey, timestamp DESC | ✓ WIRED | |
| node-info.ts / liquidity.ts / force-close.ts / restart.ts | db-timestamp.ts | parseDbTimestampUtc at every raw-execute string boundary | ✓ WIRED | New link from 441d02a; grep-verified 4 importers, no bare string `new Date(` boundary remains |
| grade.ts | config.ts | DimConfig lookup | ✓ WIRED | |
| backends.ts | nodes.ts | Backend type reuse | ✓ WIRED | |
| liquidity.ts | lnd_node_channel_info | DISTINCT ON (local_pubkey, chan_id) subquery, NULL guards inside | ✓ WIRED | Was WIRED-BUT-WRONG; fixed by 70b0011, regression-pinned in shape test |
| revenue.ts | lnd_node_forwards | SUM(fee_msat)/1000.0 + amt_in_msat denominator | ✓ WIRED | |
| force-close.ts | lnd_node_closed_channels | COUNT FILTER close_type + hourly buckets | ✓ WIRED | |
| peer.ts | node-info.ts | LatestNodeInfoRow type-only | ✓ WIRED | |
| components/scorecard | scorecard/types.ts | typed props, no DB | ✓ WIRED | |
| fleet.ts | node-info.ts / backends.ts / config.ts | latestNodeInfoAll / backendFor / SCORECARD_CONFIG | ✓ WIRED | |
| (overview)/page.tsx | fleet.ts | loadFleetView in RSC | ✓ WIRED | |
| [pubkey]/page.tsx | pubkey validation | /^[0-9a-f]{66}$/ before data access | ✓ WIRED | |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| (overview)/page.tsx | fleet.nodes | loadFleetView → warehouse | Yes — golden live runs returned >20 nodes, graded | ✓ FLOWING |
| [pubkey]/page.tsx | node (10 dims) | cached loadFleetView | Yes — golden asserts 10 dims / 3 nodata for Canada live | ✓ FLOWING |
| Liquidity dimension | raw outbound_ratio | buildLiquidityAllSql (partitioned) | Yes — was FLOWING-CORRUPT; partition key fixed, live probe shows clean latest state | ✓ FLOWING |
| FreshnessStamp | asOf / stale | parseDbTimestampUtc boundary | Yes — was FLOWING-SKEWED; live probe age 1.1 min on Vancouver host | ✓ FLOWING |

### Behavioral Spot-Checks (re-verification run)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `npm test` | 141 passed / 14 skipped | ✓ PASS |
| D-14 Canada golden LIVE | `source .env.local; npx vitest run src/lib/scorecard/golden-scorecard.test.ts` | 10/10 passed, 16.7s | ✓ PASS |
| Production build | `npm run build` | Green; routes ƒ /, ƒ /[pubkey], ƒ /(.)[pubkey] | ✓ PASS |
| WR-01 live TZ probe | offset-less MAX(timestamp) → helper vs db now-UTC | age 1.1 min (was +7h) | ✓ PASS |
| CR-01 live shape probe | partitioned vs un-partitioned row counts on live warehouse | 6,040 = 6,040; 0 cross-partition chan_ids today | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes exist in this repo and none are declared by the phase plans — probe step SKIPPED (the D-14 golden suite is the phase's runnable gate, executed live above).

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| FLEET-01 | 02-05, 02-06, 02-07 | Fleet overview, all nodes, at-a-glance health | ✓ SATISFIED | Overview live, build green, D-09 sorted; freshness stamp now TZ-correct (441d02a) |
| FLEET-02 | 02-01..02-04, 02-06, 02-07 | Per-node 10-dimension scorecard from warehouse | ✓ SATISFIED | 10/10 dimensions correct after 70b0011; golden live 10/10 |
| FLEET-03 | 02-02, 02-06, 02-07 | Cross-node comparison vs fleet-median bands | ✓ SATISFIED | MAD bands per-backend with D-11 suppression; liquidity cohort inputs now clean |

No orphaned requirements: REQUIREMENTS.md maps exactly FLEET-01/02/03 to Phase 2 and every plan's `requirements` field claims a subset of those three.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/TODO/HACK/placeholder markers in any phase-modified or gap-closure src file (re-checked: db-timestamp.ts, liquidity.ts, node-info.ts, force-close.ts, restart.ts + tests) | — | Clean |

### Human Verification

The 02-07 `checkpoint:human-verify` was resolved by the operator ("approved with notes") during the phase. Visual polish debt is operator-accepted and tracked in `.planning/todos/pending/ui-polish-fleet-console.md` — NOT counted against this phase. The gap-closure fixes are warehouse-read-boundary changes with no UI surface change; no new human verification items raised.

### Operator-Ratified Deviations (not gaps)

- **D-13 restart exclusion** from the freshness floor — ratified at the 02-07 checkpoint; restart timestamp remains visible in the per-node breakdown.
- **Visual polish** (02-REVIEW WR-03/WR-04/WR-05/WR-06, IN-01/02/04/05) — operator-accepted debt in the ui-polish todo.

### Summary

Phase 2 goal achieved. The initial verification found the phase fully built and wired with two data-correctness defects at the warehouse read boundary. Both are now closed and independently verified:

1. **CR-01** (`70b0011`): the fleet-wide liquidity latest-state subquery is partitioned by `(local_pubkey, chan_id)` with matching ORDER BY and both NULL guards inside the subquery; the shape test carries a regression pin forbidding the bare `chan_id` key. Live probe shows the defect was latent in today's snapshot (zero cross-partition chan_ids), confirming no behavioral regression while preventing corruption when intra-fleet LND pairs appear.

2. **WR-01** (`441d02a`): a single UTC-explicit boundary helper (`parseDbTimestampUtc`) now coerces every raw-execute string timestamp; live probe on this Vancouver host shows node age computed at 1.1 minutes where the old code skewed +7h. The D-13 6-hour stale flag fires correctly on any host timezone.

Full suite 141/141 green, production build green, D-14 Canada golden re-run live 10/10. No regressions in the 28 previously-verified must-haves.

---

_Initially verified: 2026-06-10T04:25:00Z (gaps_found 28/32)_
_Re-verified: 2026-06-10T04:30:00Z (passed 32/32)_
_Verifier: Claude (gsd-verifier)_
