---
phase: 13-nodes-service-health
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 68
files_reviewed_list:
  - drizzle/nodemon/0002_productive_the_order.sql
  - drizzle/nodemon/meta/0002_snapshot.json
  - drizzle/nodemon/meta/_journal.json
  - src/app/(overview)/[pubkey]/[tab]/export/route.ts
  - src/app/(overview)/[pubkey]/[tab]/page.tsx
  - src/app/(overview)/[pubkey]/channels/export/route.ts
  - src/app/(overview)/[pubkey]/channels/page.tsx
  - src/app/(overview)/[pubkey]/forwards/export/route.ts
  - src/app/(overview)/[pubkey]/forwards/page.tsx
  - src/app/(overview)/[pubkey]/page.tsx
  - src/app/(overview)/[pubkey]/peers/page.tsx
  - src/app/(overview)/[pubkey]/service/[service]/page.tsx
  - src/app/(overview)/layout.tsx
  - src/app/(overview)/nodes/page.tsx
  - src/app/(overview)/page.tsx
  - src/app/actions/queue.enqueueAndApprove.test.ts
  - src/app/actions/queue.ts
  - src/components/console/SummaryStrip.tsx
  - src/components/df/TwoAxisPip.test.tsx
  - src/components/node/LightningState.tsx
  - src/components/node/LiquidityGauge.test.tsx
  - src/components/node/LiquidityGauge.tsx
  - src/components/node/NodeActiveSignals.tsx
  - src/components/node/NodeChannelsTable.tsx
  - src/components/node/NodeDetailTabs.test.tsx
  - src/components/node/NodeDetailTabs.tsx
  - src/components/node/NodeFeeEnqueue.test.tsx
  - src/components/node/NodeFeeEnqueue.tsx
  - src/components/node/NodeFilters.tsx
  - src/components/node/NodeForwardsTable.test.tsx
  - src/components/node/NodeForwardsTable.tsx
  - src/components/node/NodeHeader.tsx
  - src/components/node/NodeLogsStream.tsx
  - src/components/node/NodePeersTable.test.tsx
  - src/components/node/NodePeersTable.tsx
  - src/components/node/NodeSummaryStrip.tsx
  - src/components/node/NodesTable.tsx
  - src/components/node/ReadOnlySafetyPosture.tsx
  - src/components/node/ServiceHealthGrid.tsx
  - src/components/node/VmVitals.tsx
  - src/components/node/WithdrawAffordance.tsx
  - src/components/service/Dependents.tsx
  - src/components/service/RestartHistory.tsx
  - src/components/service/ServiceDetailShell.tsx
  - src/components/service/ServiceLogTail.tsx
  - src/components/service/ServiceVitals.tsx
  - src/components/service/VerifyFirstRunbook.tsx
  - src/lib/console/export-handler.ts
  - src/lib/console/forwards.test.ts
  - src/lib/console/forwards.ts
  - src/lib/console/paginate.test.ts
  - src/lib/console/paginate.ts
  - src/lib/console/peers.test.ts
  - src/lib/console/peers.ts
  - src/lib/db/schema/nodemon.ts
  - src/lib/overview/node-filter.test.ts
  - src/lib/overview/node-filter.ts
  - src/lib/queue/channel-enqueue-props.ts
  - src/lib/queue/state.test.ts
  - src/lib/queue/state.ts
  - src/lib/queue/transitions.ts
  - src/lib/queue/withdraw.test.ts
  - src/lib/read/approved-fee-intents.ts
  - src/lib/read/latest.ts
  - src/lib/read/liquidity-split.test.ts
  - src/lib/read/liquidity-split.ts
  - src/lib/read/node-services.test.ts
  - src/lib/read/node-services.ts
findings:
  critical: 2
  warning: 5
  info: 5
  total: 12
  fixed: 12
  skipped: 0
status: issues_found
fix_status: all_fixed
fixed_at: 2026-07-10T18:45:00Z
---

# Phase 13: Code Review Report

**Reviewed:** 2026-07-10
**Depth:** standard
**Files Reviewed:** 68
**Status:** issues_found

## Summary

Phase 13 delivers the routed Node-Detail redesign (lean overview + channels/peers/forwards sub-routes), the SVC-01/SVC-02 service-health surfaces, the D-01 withdraw path (`approved → withdrawn` with the claim-race guard), and the D-11 one-click enqueue+approve. The security-critical invariants hold well: every write flows through the params-only server actions with strict zod schemas (a smuggled `signatureHex` is rejected and there is a test proving it); all warehouse SQL is parameter-bound with SQLi shape tests; URL params (pubkey, tab, service, window, page, peer, chan, focus) are whitelist/format-validated before any read; the withdraw transition is guarded by `WHERE state='approved'` inside a transaction with an audit insert; the AI/runbook surfaces are copy-only with no queue imports. The queue state machine, migration (`withdrawn` enum value present in SQL, journal, and snapshot), and the pure modules (paginate, node-filter, liquidity-split, node-services) are internally consistent and well-tested.

However, two user-facing features in this phase are functionally broken: server-side pagination on `/{pubkey}/forwards` always serves page 1 regardless of `?page`, and the Channels CSV export button 404s on every click because it emits a `?window=latest` key that the export handler's whitelist rejects. Several fail-soft/honest-empty inconsistencies and a config-robustness crash path round out the warnings.

## Critical Issues

### CR-01: Forwards sub-route pagination always serves page 1 — `preOffset` is unconditionally 0

**File:** `src/lib/console/forwards.ts:244` (consumed by `src/app/(overview)/[pubkey]/forwards/page.tsx:83`)
**Issue:** `forwardsPageData` computes the SQL OFFSET via a "pre-total parse":

```ts
const preOffset = parsePageParam(page, { total: 0, pageSize }).offset;
```

With `total: 0`, `parsePageParam` derives `pageCount = max(1, ceil(0/pageSize)) = 1`, then clamps `page = Math.min(requested, 1) = 1`, so `offset` is **always 0** for every input — this exact behavior is locked by the module's own test (`paginate.test.ts:44-49`, "total 0 → page 1, pageCount 1, offset 0"). The inline comment claims "total 0 here only fixes the lower bound to page 1; the upper clamp is applied post-query" — this is wrong: the upper clamp fires immediately because pageCount is 1.

Net effect: the authoritative `pagination` frame (derived post-query from the true total) reports "Page 3 of 12" and renders working Prev/Next links, but `buildForwardsPageSql` was executed with `OFFSET 0`, so **every page renders the newest-50 rows**. The operator pages through the forwarding log and silently sees the same 50 forwards on every page — a data-integrity failure on an audit-relevant surface.

**Fix:** Derive the pre-total offset without the upper clamp, then let the post-query frame do the honest clamping (and re-query or accept an empty page when over-range):

```ts
// Lower-bound-only parse: never clamp to a fabricated pageCount of 1.
const requested = Number(page);
const preOffset =
  Number.isInteger(requested) && requested >= 1 ? (requested - 1) * pageSize : 0;
```

Alternatively run the summary query first and feed its real `n` into `parsePageParam` before building the page SQL (one extra round-trip, fully consistent frame/rows). Add a regression test asserting `buildForwardsPageSql` receives a non-zero offset for `page="2"`.

**Resolution:** fixed in `83c0852` — two-step read: the summary runs first, `parsePageParam` clamps the raw `?page` against the TRUE total, and that frame's offset is the one bound into the page SQL (frame and rows can never disagree; over-range `?page` serves the real last page). Regression tests pin `?page=3 → OFFSET 100`, the over-range clamp, and invalid-page → offset 0. `parsePageParam` and its locked tests untouched.

### CR-02: Channels CSV export button always 404s — `?window=latest` is not a `WINDOW_PRESETS` key

**File:** `src/app/(overview)/[pubkey]/channels/page.tsx:146` (vs `src/lib/console/export-handler.ts:82-84`, `src/lib/console/config.ts:17`)
**Issue:** The channels sub-route renders:

```tsx
<ExportButton href={`/${pubkey}/channels/export?window=latest`} />
```

`handleCsvExport` validates the `window` query param against `WINDOW_PRESETS` membership **before anything else**:

```ts
const windowParam = new URL(req.url).searchParams.get("window") ?? DEFAULT_WINDOW;
if (!Object.prototype.hasOwnProperty.call(WINDOW_PRESETS, windowParam)) return notFound();
```

`WINDOW_PRESETS` is `{ "24h": 1, "7d": 7, "30d": 30, "90d": 90 }` — there is no `"latest"` key. Every click of the NODE-02 Export CSV button on `/{pubkey}/channels` returns a 404. (The handler's `windowLabel = "latest"` relabeling for latest-state tabs happens *after* this gate and only affects provenance metadata — it never makes `latest` a valid input.)

**Fix:** Either drop the param (the handler defaults to `DEFAULT_WINDOW`, and the window is ignored for latest-state tabs anyway):

```tsx
<ExportButton href={`/${pubkey}/channels/export`} />
```

or explicitly accept `latest` for latest-state tabs in `handleCsvExport` before the presets check. Add a route-level test covering the exact href the page emits.

**Resolution:** fixed in `40dd1fd` — `handleCsvExport` now accepts the literal `latest` for the latest-state tabs (channels/fees) only; event tabs still require a `WINDOW_PRESETS` key, and the whole gauntlet stays before any read. New `export-handler.test.ts` covers the exact page-emitted href (200), fees (200), forwards+latest (404 with zero reads), and non-preset windows (404).

## Warnings

### WR-01: Forwards page converts a warehouse outage into a 404 ("node not found")

**File:** `src/app/(overview)/[pubkey]/forwards/page.tsx:66-67`
**Issue:** `const node = await latestNodeInfo(pubkey).catch(() => null); if (node === null) notFound();` collapses two very different states — "this pubkey has never been seen" and "the warehouse is down" — into the same 404. During an outage every valid node's forwards page claims the node does not exist, violating the honest-empty posture the sibling pages implement (the `/{pubkey}` detail and `/nodes` render explicit "reads didn't respond — this view is read-only" copy on total failure). It also skips the PERF-01 fleet/fallback resolution the channels/peers pages use, so behavior differs across tabs of the same node.
**Fix:** Distinguish the reject from the null result: let the read failure surface to a page-level try/catch that renders the honest read-only error copy (mirroring `/{pubkey}/page.tsx`), and reserve `notFound()` for a resolved-but-absent pubkey.

**Resolution:** fixed in `41572c9` — the node resolution is try/catch-guarded; a rejected read renders the `/{pubkey}` overview's honest read-only degrade copy, and `notFound()` (outside the try) is reserved for a resolved-but-absent pubkey.

### WR-02: Channels and Peers pages have unguarded Gate-2 reads — outage yields a raw 500

**File:** `src/app/(overview)/[pubkey]/channels/page.tsx:81-83`, `src/app/(overview)/[pubkey]/peers/page.tsx:71-73`
**Issue:** Both pages document "reads … each fail-soft", but `getFleet()` (loadFleetView) and `latestNodeInfoFallback(pubkey)` are awaited with no `.catch` and no surrounding try/catch. A warehouse outage throws out of the Server Component and renders the default Next.js 500 — not the honest "Couldn't load … this view is read-only" copy that `/`, `/nodes`, and `/{pubkey}` all render for the same failure. The supplementary reads below the gates are guarded; the gate reads are not.
**Fix:** Wrap the node-resolution stage in a try/catch that renders the established honest-error fallback (the `/{pubkey}/page.tsx` pattern: catch → `loadFailed` → error copy; `notFound()` stays outside the try).

**Resolution:** fixed in `2019278` — both pages' Gate-2 reads (`getFleet()` + `latestNodeInfoFallback`) are wrapped in try/catch → `loadFailed` → the honest read-only degrade copy; `notFound()` stays outside the try.

### WR-03: Service Detail case-sensitivity split — infra detection and existence gate disagree

**File:** `src/app/(overview)/[pubkey]/service/[service]/page.tsx:128,162` (vs `src/app/(overview)/page.tsx:257`)
**Issue:** The variant branch is case-insensitive (`service.toLowerCase() === "bitcoind"`), the existence gate is case-sensitive (`s.serviceName === service`), and the overview's bitcoind-denominator set is case-insensitive (`s.serviceName.toLowerCase() === "bitcoind"`). If the inventory ever stores a non-lowercase key (e.g. `Bitcoind`), the URL `/service/bitcoind` 404s while `/service/Bitcoind` passes the gate with `isInfra === true`-mismatch potential inverted: `"Bitcoind".toLowerCase() === "bitcoind"` keeps `isInfra` true here, but any *other* casing drift between inventory and URL silently flips a host-critical bitcoind onto the **custom** variant — wrong evidence chart, and a `VerifyFirstRunbook` that emits `sudo systemctl restart Bitcoind` as a low-ceremony "command" instead of the coordinated-restart "runbook" with blast-radius framing. For a service whose restart affects every node on the host, mis-tiering the runbook is an operational-safety regression.
**Fix:** Normalize once at the boundary: resolve the routed `service` segment against the inventory case-insensitively, then use the inventory's canonical `serviceName` for both the existence gate and the `isInfra` branch.

**Resolution:** fixed in `56465af` — the existence gate resolves the segment case-insensitively; the inventory's canonical `serviceName` now drives `isInfra`, `serviceDisplay`, the chart `idSuffix`, and the `VerifyFirstRunbook` `serviceKey`.

### WR-04: Unvalidated `NODEMON_TTL_HOURS` crashes the channels table render (`Invalid Date.toISOString()` throws)

**File:** `src/lib/queue/channel-enqueue-props.ts:30-31,57,69`
**Issue:**

```ts
function ttlHours(): number {
  return Number(process.env.NODEMON_TTL_HOURS ?? 24);
}
...
const expiresAt = new Date(Date.now() + ttlHours() * 3600_000);
... expiresAtLabel: expiresAt.toISOString(),
```

If `NODEMON_TTL_HOURS` is set to any non-numeric value (typo, `"24h"`, empty-after-trim edge), `Number(...)` yields `NaN`, `new Date(NaN)` is an Invalid Date, and `.toISOString()` **throws a RangeError** — inside `resolveChannelEnqueueProps`, which runs per LND row during the Server Component render of `/{pubkey}/channels` and the reused table. One bad env var takes down the whole channels surface with a 500 for every LND node.
**Fix:** Validate with a fallback: `const parsed = Number(process.env.NODEMON_TTL_HOURS); return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;` (and apply the same guard wherever `enqueue.ts` reads this env var, so the enqueue-time TTL and the preview label can't diverge on bad config).

**Resolution:** fixed in `628631c` — new shared `src/lib/queue/ttl.ts` (validated, call-time env read, fallback 24) replaces the three duplicate `ttlHours()` readers in `enqueue.ts`, `enqueue-props.ts`, and `channel-enqueue-props.ts`; `ttl.test.ts` pins the fallback matrix.

### WR-05: Duplicate `latestChannelsForNode` warehouse read on the peers page and node detail — two snapshots can disagree

**File:** `src/app/(overview)/[pubkey]/peers/page.tsx:81-90`, `src/app/(overview)/[pubkey]/page.tsx:171-177` (vs `src/lib/console/peers.ts:156`)
**Issue:** `peersTabData(pubkey)` internally calls `latestChannelsForNode(pubkey)`; both pages then call `latestChannelsForNode(pubkey)` again in the same `Promise.all` to derive the liquidity splits. The same DISTINCT-ON query runs twice per request, and — because the two executions are separate snapshots of an event-driven table — the partner rows (from read #1) and the per-peer gauges (from read #2) can be computed from *different* channel states, e.g. a partner row whose gauge shows the honest-empty state because its channel flipped between reads. Low probability but exactly the class of cross-read inconsistency the AFM guardrails exist to prevent.
**Fix:** Read the channel rows once and pass them into the shaper: export/reuse `shapePeersTab` directly on the page (it is already exported for the no-DB test), or extend `peersTabData` to accept pre-read channel rows.

**Resolution:** fixed in `48bbf16` — `peersTabData` accepts optional `preReadChannelRows`; both the peers page and the node-detail overview read `latestChannelsForNode` once and feed the same snapshot to the partner rows and the liquidity gauges.

## Info

### IN-01: Unused `afterEach` import in the enqueueAndApprove action test

**File:** `src/app/actions/queue.enqueueAndApprove.test.ts:1`
**Issue:** `afterEach` is imported from vitest but never used (the suite only uses `beforeEach`).
**Fix:** Drop it from the import list (ESLint flat config will flag it).

**Resolution:** fixed in `0551a0a` — unused `afterEach` dropped from the import.

### IN-02: Forwards page hardcodes the fallback pageSize `50`

**File:** `src/app/(overview)/[pubkey]/forwards/page.tsx:92`
**Issue:** The fail-soft fallback frame uses a literal `pageSize: 50` while the real value comes from `DEFAULT_PAGE_SIZE` in `paginate.ts` — a retune of the constant silently desynchronizes the degraded-path pager.
**Fix:** Import and use `DEFAULT_PAGE_SIZE`.

**Resolution:** fixed in `6c0d53c` — the degraded-path fallback frame now uses `DEFAULT_PAGE_SIZE` from `paginate.ts`.

### IN-03: `LightningState.tsx` is dead code after the lean-overview redesign

**File:** `src/components/node/LightningState.tsx`
**Issue:** No file in `src/` imports `LightningState` any more (the routed sub-routes replaced the single-scroll layer). It still carries five warehouse-read call sites; leaving it in the tree invites accidental re-mounting of the retired firehose.
**Fix:** Delete it (and its export button wiring), or annotate it as intentionally retained with a pointer to the retirement decision.

**Resolution:** fixed in `06d9e3c` — `LightningState.tsx` deleted (confirmed zero importers in `src/`; tsc clean after removal).

### IN-04: Peers page `searchParams` type omits the `string[]` repeated-param case

**File:** `src/app/(overview)/[pubkey]/peers/page.tsx:51,76-78`
**Issue:** `searchParams` is typed `Promise<{ page?: string; focus?: string }>`, but Next delivers repeated params (`?page=1&page=2`) as `string[]`. Runtime behavior degrades safely (`Number(array)` → NaN → page 1; `PUBKEY_RE.test(array)` → false), but the type lie bypasses the `firstParam` discipline the sibling channels/forwards pages apply.
**Fix:** Type as `string | string[] | undefined` and route through the shared `firstParam` helper.

**Resolution:** fixed in `24d9fe8` — `searchParams` typed `string | string[]` and both `page`/`focus` routed through `firstParam` (matching the channels/forwards sibling discipline).

### IN-05: `expiresAtLabel` renders a raw ISO-8601 string in the fee-queue preview

**File:** `src/lib/queue/channel-enqueue-props.ts:69`, `src/components/node/NodeFeeEnqueue.tsx:279`
**Issue:** The "expires" preview row shows `2026-07-11T03:14:07.000Z` verbatim while every other timestamp on the surface is humanized — cosmetic inconsistency in an operator-decision panel.
**Fix:** Format server-side (e.g. locale string or relative "in 24h") before serializing the label.

**Resolution:** fixed in `9ffb67b` — shared `expiryLabel()` in `ttl.ts` renders `in 24h (2026-07-11 03:14 UTC)` server-side; applied to both preview-props builders (`channel-enqueue-props.ts` and `enqueue-props.ts`) so the two "expires" rows stay consistent. Pinned in `ttl.test.ts`.

---

_Reviewed: 2026-07-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
