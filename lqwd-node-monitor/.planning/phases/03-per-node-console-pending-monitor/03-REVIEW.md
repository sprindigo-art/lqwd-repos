---
phase: 03-per-node-console-pending-monitor
reviewed: 2026-06-11T17:48:19Z
depth: standard
files_reviewed: 53
files_reviewed_list:
  - src/app/(overview)/[pubkey]/[tab]/export/route.ts
  - src/app/(overview)/[pubkey]/[tab]/page.tsx
  - src/app/(overview)/[pubkey]/page.tsx
  - src/app/(overview)/@modal/(.)[pubkey]/page.tsx
  - src/app/(overview)/layout.tsx
  - src/app/(overview)/page.tsx
  - src/app/(overview)/pending/page.tsx
  - src/app/globals.css
  - src/app/layout.tsx
  - src/components/console/ActiveSignalsPanel.tsx
  - src/components/console/CapBanner.tsx
  - src/components/console/ConsoleRail.tsx
  - src/components/console/ConsoleTabs.tsx
  - src/components/console/EventTable.tsx
  - src/components/console/EvidencePanel.tsx
  - src/components/console/ExportButton.tsx
  - src/components/console/panels/EventTabPanels.tsx
  - src/components/console/panels/StaticTabPanels.tsx
  - src/components/console/PendingBoard.tsx
  - src/components/console/Sparkline.tsx
  - src/components/console/SummaryStrip.tsx
  - src/components/console/WindowPicker.tsx
  - src/components/scorecard/BackendBadge.tsx
  - src/components/scorecard/CriticalChip.tsx
  - src/components/scorecard/DimensionRow.tsx
  - src/components/scorecard/FreshnessStamp.tsx
  - src/components/scorecard/GradeBadge.tsx
  - src/components/scorecard/OutlierMarker.tsx
  - src/components/scorecard/ScorecardPanel.tsx
  - src/components/ui/button.tsx
  - src/components/ui/tabs.tsx
  - src/lib/console/channels.ts
  - src/lib/console/closes.test.ts
  - src/lib/console/closes.ts
  - src/lib/console/config.test.ts
  - src/lib/console/config.ts
  - src/lib/console/fees.ts
  - src/lib/console/forwards.test.ts
  - src/lib/console/forwards.ts
  - src/lib/console/liquidity.ts
  - src/lib/console/peers.test.ts
  - src/lib/console/peers.ts
  - src/lib/console/static-tabs.test.ts
  - src/lib/console/trends.test.ts
  - src/lib/console/trends.ts
  - src/lib/csv/export.test.ts
  - src/lib/csv/export.ts
  - src/lib/csv/serialize.test.ts
  - src/lib/csv/serialize.ts
  - src/lib/db/schema/routing.ts
  - src/lib/read/golden-pending.test.ts
  - src/lib/read/pending.test.ts
  - src/lib/read/pending.ts
findings:
  critical: 1
  warning: 5
  info: 7
  total: 13
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-11T17:48:19Z
**Depth:** standard
**Files Reviewed:** 53
**Status:** issues_found

## Summary

Reviewed the Phase 3 per-node console, pending monitor, and CSV export surface: route handlers, panel components, read-layer SQL builders, the CSV serialization boundary, and their tests. Cross-checked called modules outside the file list where correctness depended on them (`warehouse-routing.ts` confirms Drizzle's postgres-js adapter surfaces timestamps as strings; `db-timestamp.ts` confirms the UTC parse; `latest.ts` confirms `DISTINCT ON (chan_id) ORDER BY chan_id` ordering).

The SQL layer is strong: every builder parameter-binds the pubkey and window integer, every event query carries a mandatory window predicate, and the shape tests pin the SQLi and AFM landmines. No `dangerouslySetInnerHTML`, no client directives in the console/scorecard components, no raw `fee` column usage.

However, the CSV security boundary has a real hole: the provenance comment block is not comma-safe, so a formula payload in an alias survives into a spreadsheet-evaluated cell — the exact threat the module documents itself as defending against. Separately, the console page's `?window=` whitelist check uses the `in` operator, which accepts prototype-chain keys (`constructor`, `toString`, ...) and lets an unvalidated string travel into the SQL bind path, violating the stated D-06 invariant. Both are fixable in a few lines.

## Critical Issues

### CR-01: CSV formula injection through the provenance block — commas in an alias defeat the escaping

**File:** `src/lib/csv/serialize.ts:55-81` (consumed by `src/lib/csv/export.ts:154-162`, `src/app/(overview)/[pubkey]/[tab]/export/route.ts:69-73`)
**Issue:** `buildProvenance` emits `# node: {alias} ({pubkey})` as a raw line, bypassing `csvCell`. The only sanitization is `provenanceValue`, which collapses vertical whitespace (CR/LF and U+2028/U+2029). It does **not** neutralize commas, quotes, or formula triggers. A CSV file has no comment syntax — Excel/Sheets import the `#` line as a data row and split it on commas. An alias such as:

```
x,=HYPERLINK("http://evil","open")
```

produces the provenance line `# node: x,=HYPERLINK("http://evil","open") (02ab...)`. On import, the cell after the comma begins with `=` and is evaluated as a formula. The module's own threat model (lines 7-10) declares aliases "arbitrary attacker-controlled strings" and names this file "the boundary between the warehouse and the operator's spreadsheet (T-03-04)" — and `serialize.test.ts:145-159` tests only the CR/LF breakout, not the comma vector. (Exploitability note: the export route's alias comes from `lnd_node_info.alias` — the operator's own node alias — so the current attacker surface is narrow; but the module is the sanctioned boundary for arbitrary aliases and `lnd_alias` columns flow from the same writer.)
**Fix:** Make provenance values comma/quote/trigger-safe — simplest is to reuse the cell serializer so each `# ` line is one quoted, formula-escaped cell (regex written with escaped code points; do not paste literal invisible characters):

```ts
const VERTICAL_WS = /[\r\n\u2028\u2029]+/g;
function provenanceLine(label: string, value: string): string {
  return csvCell(`# ${label}: ${value.replace(VERTICAL_WS, " ")}`, { escapeFormula: true });
}
// or, minimally: also strip commas and double quotes in provenanceValue:
function provenanceValue(s: string): string {
  return s.replace(VERTICAL_WS, " ").replace(/[",]/g, " ");
}
```

Add a test: alias `x,=HYPERLINK(1)` must not yield any comma-delimited cell beginning with `=`, `+`, `-`, `@`, tab, or CR in the emitted document.

## Warnings

### WR-01: `?window=` validation uses the `in` operator — prototype keys bypass the whitelist

**File:** `src/app/(overview)/[pubkey]/[tab]/page.tsx:164-168`
**Issue:** `rawWindow in WINDOW_PRESETS` returns `true` for inherited keys: `?window=constructor`, `?window=toString`, `?window=hasOwnProperty`, etc. The page then treats e.g. `"constructor"` as a valid `WindowKey`; `WINDOW_PRESETS["constructor"]` resolves to `Object`'s constructor **function**, which is passed as `days` into `forwardsTabData`/`closesTabData` and bound as a SQL parameter (driver serialization error — the tab degrades to `TabError` instead of silently falling back to 7d). This directly violates the comment two lines above ("an unvalidated string NEVER travels down", D-06) and the T-03-13 invariant. No injection results (the value is still parameter-bound), but the validation gate is genuinely bypassed. The export route does this correctly with `Object.prototype.hasOwnProperty.call` (route.ts:64) — the page does not.
**Fix:**

```ts
const windowKey: WindowKey =
  rawWindow !== undefined && Object.prototype.hasOwnProperty.call(WINDOW_PRESETS, rawWindow)
    ? (rawWindow as WindowKey)
    : DEFAULT_WINDOW;
```

(or `Object.hasOwn(WINDOW_PRESETS, rawWindow)`).

### WR-02: WindowPicker selected segment renders dark text on navy — illegible in the light-only theme

**File:** `src/components/console/WindowPicker.tsx:38-39`
**Issue:** The selected segment uses `bg-brand text-foreground`. In the NOC Light theme `--foreground` is `#0D1626` (near-black) and `--color-brand` is `#1A3C79` (dark navy) — roughly 1.4:1 contrast. The selected window key (the one piece of state the picker exists to show) is effectively unreadable. This looks like residue from the superseded dark theme; `BackendBadge` (same navy fill) correctly uses `text-white`.
**Fix:** `isSelected ? "bg-brand text-white" : ...` (or `text-primary-foreground`).

### WR-03: "Showing newest X of Y" cap banner is false on latest-state tabs — the truncation is arbitrary, and the peers headline overstates what's rendered

**File:** `src/components/console/panels/StaticTabPanels.tsx:91, 158, 230, 296, 313`; `src/components/console/CapBanner.tsx:24-27`; `src/lib/console/peers.ts:115, 130`
**Issue:** Channels/Fees/Liquidity rows come from `latestChannelsForNode`, which orders by `chan_id` (DISTINCT ON key), not by time; Peers rows come out in `Map` insertion order. `slice(0, ROW_CAP)` therefore drops an **arbitrary** tail, yet `CapBanner` tells the operator "Showing newest {shown} of {total}" — a factual misstatement on four tabs whenever a node exceeds 500 channels/partners. Additionally, `PeersPanel`'s headline renders `data.headline.shownPartners` (total partner count from the shaper) as "showing N channel partners" even though only `shown.length` rows are actually rendered after the cap — the two disagree exactly when the cap bites.
**Fix:** Either sort latest-state rows deterministically by a meaningful key before capping (e.g. capacity descending) and reword the banner for latest-state tabs ("Showing {shown} of {total} — Export CSV for all rows"), or thread a copy-variant prop through `CapBanner`. For peers, compute the headline's shown count from the capped slice, not the shaper total.

### WR-04: Closes/trends window predicates compare `timestamp` (no tz) against `now()` (timestamptz) — correctness silently depends on the warehouse session timezone being UTC

**File:** `src/lib/console/closes.ts:103, 112, 126`; `src/lib/console/trends.ts:80`
**Issue:** `lnd_node_closed_channels.timestamp` is `timestamp WITHOUT time zone` storing UTC wall time (per WR-01 docs). `timestamp > now() - make_interval(days => $1)` forces an implicit cast of the column to `timestamptz` using the **session** `TimeZone` setting. If the session/server timezone is anything other than UTC, every window boundary shifts by the offset (up to +/-14h on a 24h window — the "24h" preset is the most exposed). `warehouse-routing.ts` does not pin `TimeZone` in its connection options, so this rests entirely on the warehouse server default — an unstated, unverified deployment assumption for a VM-ready ("boots from env-var DB URLs only") design. The application-side parse was hardened against exactly this class of bug (`parseDbTimestampUtc`); the SQL side was not.
**Fix:** Make the comparison timezone-independent, e.g. `timestamp > (now() AT TIME ZONE 'UTC') - make_interval(days => ${days})`, or pin the session: `connection: { TimeZone: "UTC", default_transaction_read_only: true }` in `warehouse-routing.ts`. Add a shape test pinning whichever form is chosen.

### WR-05: Export route's `loadRows` falls through to the closes query for any non-channels/fees/forwards tab

**File:** `src/app/(overview)/[pubkey]/[tab]/export/route.ts:50-52`
**Issue:** The final branch of `loadRows` runs `buildClosesFullSql` unconditionally — it is reached for any tab that passes the `EXPORTABLE_TABS` gate but isn't `channels`/`fees`/`forwards`. Correct today (only `closes` remains), but the coupling is implicit: if a fifth tab is added to `EXPORTABLE_TABS` and `EXPORT_SPECS` without touching `loadRows`, the route silently queries **closes** rows and serializes them through the new tab's column spec — a mislabeled export with empty/garbage cells rather than a loud failure. In an audit-grade export path, mislabeling is worse than erroring.
**Fix:** Make the dispatch exhaustive and fail loud:

```ts
if (tab === "closes") {
  const result = await dbRouting.execute(buildClosesFullSql(pubkey, days));
  // ...
}
throw new Error(`loadRows: unhandled exportable tab "${tab}"`);
```

## Info

### IN-01: `pendingSummary` is dead code

**File:** `src/lib/read/pending.ts:270-280`
**Issue:** No consumer anywhere in `src/` — the overview page computes the strip total and per-node counts inline from `currentPendingChannels` (page.tsx:261-270). Dead exports on the "ONLY sanctioned read" module invite a second, divergent counting path.
**Fix:** Delete it, or migrate the overview's inline counting to it.

### IN-02: `src/components/ui/tabs.tsx` is vendored but never imported

**File:** `src/components/ui/tabs.tsx:1-91`
**Issue:** `ConsoleTabs` deliberately re-implements the visual grammar on plain anchors (its comment says so); no file imports from `@/components/ui/tabs`. A 91-line `"use client"` Radix module shipped unused. Similarly, `ui/button.tsx`'s `Button` component is unused (only `buttonVariants` is consumed, by `ExportButton`).
**Fix:** Remove `tabs.tsx` (re-vendor when actually needed), or document why it's retained.

### IN-03: `DIMENSION_NAMES` duplicated in ConsoleRail with a stale justification; `SignalRow` interface duplicated in the page

**File:** `src/components/console/ConsoleRail.tsx:19-33`; `src/app/(overview)/[pubkey]/[tab]/page.tsx:75-82`
**Issue:** ConsoleRail's comment claims the canonical map is "not exported from here" — but `ScorecardPanel.tsx:51` **does** export `DIMENSION_NAMES` as "the source of truth the console surfaces consume" (and the page imports it). The rail's local copy will drift silently if a dimension is renamed. Likewise the page redeclares `SignalRow` to "mirror" `ActiveSignalsPanel`'s un-exported props interface — a structural-typing duplicate that drifts the same way.
**Fix:** Import `DIMENSION_NAMES` from `ScorecardPanel` in ConsoleRail; export `SignalRow` from `ActiveSignalsPanel` and import it in the page.

### IN-04: Fees export spec emits two identical columns

**File:** `src/lib/csv/export.ts:119-120`
**Issue:** `fee_rate_ppm` and `fee_rate_ppm_raw` both source `r.outgoingFeeRatePpm` verbatim — the "formatted" column is byte-identical to the raw one, breaking the D-08 formatted/raw pairing intent for that field.
**Fix:** Drop one column, or make `fee_rate_ppm` an actual display value if a distinct formatting is intended.

### IN-05: Export provenance and filename claim a window for latest-state tables where the window is ignored

**File:** `src/app/(overview)/[pubkey]/[tab]/export/route.ts:32-40, 71-78`; `src/lib/csv/serialize.ts:73-81`
**Issue:** A channels/fees export with `?window=90d` writes `# window: 90d` into the provenance block and `_90d_` into the filename, but the data is the full latest-state snapshot — the window had no effect. For an audit artifact whose whole point is accurate provenance (D-10), this overstates what the metadata can be trusted to mean.
**Fix:** For `channels`/`fees`, emit `window: latest` (or `n/a`) in both the provenance line and the filename.

### IN-06: OutlierMarker tooltip ships a literal "N" placeholder; `deltaFromMedian` prop is never used

**File:** `src/components/scorecard/OutlierMarker.tsx:11, 29-32`
**Issue:** The operator-facing tooltip reads "More than N MADs from the {backend} cohort median" — "N" is an unsubstituted placeholder. The `deltaFromMedian?` prop exists presumably to fill it but is never read.
**Fix:** Interpolate the real MAD threshold from scorecard config (and the delta when provided), or simplify the copy to avoid the placeholder; remove the dead prop if it stays unused.

### IN-07: Golden pending test fails on a genuinely quiet fleet

**File:** `src/lib/read/golden-pending.test.ts:116`
**Issue:** `expect(measured.length).toBeGreaterThan(0)` asserts the fleet has *some* pending state at run time. On a day with zero pending channels fleet-wide (a legitimate, healthy condition), the live suite fails even though the invariant it guards (filter matches snapshot) holds vacuously — a flakiness source for CI/pre-deploy gates that run with `ROUTING_VM_DATABASE_URL` set.
**Fix:** Replace the hard assertion with a skip-and-warn when `measured.length === 0` (e.g. `ctx.skip()` with a logged notice), keeping the per-node invariants as the real assertions.

---

_Reviewed: 2026-06-11T17:48:19Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Fixes Applied

Scope: CR-01 + WR-01..WR-05 (Info findings IN-01..IN-07 intentionally out of scope). All fixes verified with `npx tsc --noEmit` and the non-DB vitest suite (268 passed, 16 skipped — live-warehouse suites skip without env).

- **CR-01** — `ac08ae2` — `provenanceValue` in `src/lib/csv/serialize.ts` now strips commas and double quotes (in addition to vertical whitespace), so every `# ` provenance line imports as a single cell beginning with `#` — a comma-smuggled formula trigger (`x,=HYPERLINK(...)`) can no longer land in an evaluated cell. Added formula-injection and delimiter-stripping tests to `serialize.test.ts`.
- **WR-01** — `9bded23` — `[tab]/page.tsx` window validation switched from the `in` operator to `Object.prototype.hasOwnProperty.call(WINDOW_PRESETS, rawWindow)`, closing the prototype-chain bypass (`?window=constructor` etc.) and matching the export route's existing check.
- **WR-02** — `bd3ba7e` — `WindowPicker` selected segment now renders `bg-brand text-white` (was `text-foreground`, near-black on navy at ~1.4:1 in the light-only NOC theme).
- **WR-03** — `877a5e4` — Latest-state tabs (channels/fees/liquidity/peers) sort rows capacity-descending (chan id / pubkey tiebreaker) before the `ROW_CAP` slice; `CapBanner` gained a `variant` prop (`"largest"` for latest-state tabs, `"newest"` reserved for time-ordered event tabs) with export-aware copy; the peers headline counts the capped slice actually rendered, not the shaper total.
- **WR-04** — `e3e5691` — The three closes builders and `buildClosesDailySql` compare `timestamp` against `(now() AT TIME ZONE 'UTC')` instead of bare `now()`, removing the implicit session-TimeZone cast; shape tests pin the form; `warehouse-routing.ts` additionally pins `TimeZone: "UTC"` in the connection options as belt-and-suspenders.
- **WR-05** — `0f7c4cb` — The export route's `loadRows` gates the closes query on `tab === "closes"` and throws `loadRows: unhandled exportable tab` for anything else — a future `EXPORTABLE_TABS` addition without a branch now fails loud instead of exporting mislabeled closes rows.

Second pass (`--all`): IN-01..IN-07. All fixes verified with `npx tsc --noEmit` and the non-DB vitest suite (268 passed, 16 skipped — live-warehouse suites skip without env) before each commit.

- **IN-01** — `b0e6c37` — Deleted the dead `pendingSummary` export from `src/lib/read/pending.ts`. Migration was rejected: the overview page needs per-node counts from the same single `currentPendingChannels` read, which `pendingSummary` (totals only) cannot supply without a second query — the very thing its own Pitfall-11 comment forbids.
- **IN-02** — `8c52323` — Removed the never-imported vendored `src/components/ui/tabs.tsx` (91-line `"use client"` Radix module; `ConsoleTabs` deliberately uses plain anchors). `ui/button.tsx` is retained whole: `buttonVariants` is actively consumed by `ExportButton`, and splitting the vendored shadcn module to shed the unused `Button` export isn't worth the drift.
- **IN-03** — `c2e4c7a` — `ConsoleRail` now imports `DIMENSION_NAMES` from `ScorecardPanel` (local duplicate + stale "not exported from here" comment deleted); `ActiveSignalsPanel` exports its `SignalRow` interface and `[tab]/page.tsx` imports it instead of redeclaring a mirror.
- **IN-04** — `dbd4204` — Dropped the duplicate `fee_rate_ppm` column from `FEES_SPEC` in `src/lib/csv/export.ts`, keeping `fee_rate_ppm_raw`. PPM is already in display units — no genuine formatted twin exists (fees.ts's display form is byte-identical to raw), so a duplicate column would fake the D-08 pairing.
- **IN-05** — `987854a` — The export route labels `channels`/`fees` exports `window: latest` in the provenance block and `_latest_` in the filename (event tabs keep the validated window key) — the audit metadata no longer claims a window that had no effect on latest-state data. No test pinned the old behavior.
- **IN-06** — `00dd4e0` — `OutlierMarker`'s tooltip interpolates the live `COMPARE_CONFIG.madN` threshold from `src/lib/scorecard/config.ts` (pure module, the single D-02 tuning surface) instead of the literal "N" placeholder; the never-read `deltaFromMedian` prop was removed.
- **IN-07** — `1160c44` — `golden-pending.test.ts` replaces the hard `expect(measured.length).toBeGreaterThan(0)` with a shared `skipIfQuietFleet(ctx)` guard (`ctx.skip()` + `console.warn` notice) applied to both live invariant tests — a fleet-wide zero-pending day is a legitimate healthy condition and no longer fails the live gate; the per-node invariants remain the real assertions.

_Fixed: 2026-06-11_
_Fixer: Claude (gsd-code-fixer)_
