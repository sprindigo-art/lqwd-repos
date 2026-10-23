---
phase: 13-nodes-service-health
plan: 11
subsystem: console-read-plumbing
tags: [pagination, csv-export, forwards, node-detail-redesign, gap-closure]
requires:
  - "src/lib/console/config.ts (WINDOW_PRESETS, EXPORTABLE_TABS, ROW_CAP)"
  - "src/lib/overview/filter.ts (whitelist-widen-on-invalid contract)"
  - "src/lib/console/forwards.ts existing window/AFM-002 builders"
  - "src/lib/csv/export.ts + serialize.ts (CSV assembly, unchanged)"
provides:
  - "parsePageParam + slicePage + DEFAULT_PAGE_SIZE (pure ?page util, G1 foundation)"
  - "handleCsvExport(req, { pubkey, tab }) shared NODE-02 export handler"
  - "buildForwardsPageSql + forwardsPageData + ForwardsPageView (OFFSET pagination)"
affects:
  - "wave-2 static sub-routes /[pubkey]/channels + /[pubkey]/forwards (page tables + reuse export)"
tech-stack:
  added: []
  patterns:
    - "URL ?page whitelist-clamp mirrors filter.ts (invalid silently widens to page 1, never throws)"
    - "OFFSET/LIMIT both ::int-cast bound params (42725 unknown-param guard)"
    - "shared route handler extraction so static sub-route folders keep a dynamic path reachable (Pitfall 5)"
key-files:
  created:
    - "src/lib/console/paginate.ts"
    - "src/lib/console/paginate.test.ts"
    - "src/lib/console/export-handler.ts"
  modified:
    - "src/app/(overview)/[pubkey]/[tab]/export/route.ts"
    - "src/lib/console/forwards.ts"
    - "src/lib/console/forwards.test.ts"
decisions:
  - "forwardsPageData keeps one Promise.all (summary + page rows); OFFSET uses a pre-total parse, the returned pagination frame is re-derived from the true total so an over-range ?page reports the real last page"
  - "the paginated reader leaves busiest=null — busiest is a summary-strip concern owned by forwardsTabData, not the lean sub-route reader"
metrics:
  duration: ~4m
  completed: 2026-07-10
  tasks: 3
  files: 6
---

# Phase 13 Plan 11: Node-Detail Route Plumbing (pagination + shared export + paginated forwards) Summary

Built the three route-plumbing utilities the wave-2 Node-Detail sub-routes need: a pure whitelist-clamped `?page` pagination helper (G1), a shared `handleCsvExport` handler extracted so the new static `channels/`/`forwards/` folders keep the NODE-02 CSV path reachable (Pitfall 5), and an OFFSET-paginated `forwardsPageData` reader that pages a large forwards event log server-side while preserving the AFM-002 fee math and nanosecond window.

## What Was Built

- **Task 1 (TDD) — `paginate.ts`:** `parsePageParam(raw, { total, pageSize })` returns a clamped `{ page, offset, pageCount, pageSize }` frame; any invalid/hostile/over-range `?page` clamps to a valid page and never throws (mirrors `filter.ts`). `slicePage` is a pure, non-mutating array slice. `DEFAULT_PAGE_SIZE = 50`. No `@/lib/db` import, no `throw` statement. RED test committed first, then GREEN.
- **Task 2 — `export-handler.ts`:** The full export GET body (PUBKEY_RE → EXPORTABLE_TABS → WINDOW_PRESETS gauntlet, exhaustive `loadRows` dispatch, `assembleCsv`, `buildExportFilename`) moved verbatim into `handleCsvExport(req, { pubkey, tab })`. `[tab]/export/route.ts` reduced to a thin `force-dynamic` GET delegator — `/{pubkey}/{tab}/export?window=` behavior is byte-identical.
- **Task 3 — paginated forwards:** `buildForwardsPageSql(pubkey, days, limit, offset)` adds a bound `OFFSET ${offset}::int` after `LIMIT ${limit}::int`, keeping the `* 1e9` window predicate and newest-first order. `forwardsPageData(pubkey, windowKey, page, pageSize?)` runs summary + page rows in one `Promise.all`, returns `ForwardsPageView` (extends `ForwardsTabView` + `pagination`). AFM-002 `SUM(fee_msat)/1000.0` preserved.

## Verification

- `npx vitest run src/lib/console/paginate src/lib/console/forwards` → **33 passed** (13 paginate + 20 forwards).
- `npx tsc --noEmit -p tsconfig.json` → clean.
- Source assertions: paginate has no db import / no throw; `[tab]/export/route.ts` delegates to `handleCsvExport` with no inline logic; `handleCsvExport` runs all three gates before any query; `buildForwardsPageSql` emits `::int`-cast LIMIT+OFFSET and keeps `* 1e9`; fee math stays `SUM(fee_msat)/1000.0`.

## Deviations from Plan

None — plan executed as written. One in-plan judgment call recorded under `decisions`: to honor the "one Promise.all" directive while keeping the `pagination` frame authoritative, the SQL OFFSET uses a pre-total parse and the returned frame is re-derived from the true summary total (so an over-range `?page` reports the real last page rather than a stale value).

## TDD Gate Compliance

Task 1 followed RED (`test(13-11)` commit `aff4191`, failing on missing module) → GREEN (`feat(13-11)` commit `2638e00`). No refactor pass needed. Tasks 2–3 are extraction/additive builder work with test extension, not new-feature TDD.

## Threat Coverage

- T-13-11-01 (?page tampering): `parsePageParam` clamps any input; `offset` bound as `::int`, never interpolated.
- T-13-11-02 (export handler): `handleCsvExport` keeps PUBKEY_RE + EXPORTABLE_TABS + WINDOW_PRESETS gates before any query.
- T-13-11-03 (fee disclosure): `SUM(fee_msat)/1000.0` preserved; raw `fee` column never used for math.
- T-13-11-SC: zero new package installs.

## Commits

- `aff4191` test(13-11): add failing test for pure pagination util
- `2638e00` feat(13-11): pure ?page pagination util (G1 foundation)
- `2280969` refactor(13-11): extract shared CSV export handler (NODE-02)
- `edfd218` feat(13-11): OFFSET-paginated forwards reader (G1)

## Self-Check: PASSED

All 6 files present; all 5 commits (aff4191, 2638e00, 2280969, edfd218, 7296c58) in git log.
