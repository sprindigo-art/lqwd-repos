---
phase: 07-inbox-triage-rebuild
reviewed: 2026-06-17T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/app/(overview)/inbox/page.tsx
  - src/app/actions/queue.batch.test.ts
  - src/app/actions/queue.ts
  - src/app/globals.css
  - src/components/insight/BatchConfirmDialog.tsx
  - src/components/insight/DetailDrawer.tsx
  - src/components/insight/FacetDropdown.tsx
  - src/components/insight/FacetRail.tsx
  - src/components/insight/InboxTriage.tsx
  - src/components/insight/InfoGroups.tsx
  - src/components/insight/SeveritySpine.tsx
  - src/components/insight/SuppressedBlock.tsx
  - src/components/ui/sheet.tsx
  - src/lib/insight/engine.ts
  - src/lib/insight/triage-facets.test.ts
  - src/lib/insight/triage-facets.ts
  - src/lib/insight/triage.test.ts
  - src/lib/insight/triage.ts
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-06-17T00:00:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Phase 7 builds the `/inbox` triage cockpit: a server-computed severity spine + facet
rail + URL-synced detail drawer + bulk-enqueue path through the Phase-6 signed queue,
plus a short-TTL in-process cache on `loadInsightView`.

**Security invariants held up under review.** The action boundary is clean: the UI
sends `{pubkey, params}[]` only and the server (`enqueueBatch`/`enqueue`) signs once
per row server-side — no client-supplied HMAC or canonical payload crosses the
boundary. `enqueueBatch` re-validates every row with `enqueueInputSchema` (authoritative
bounds gate) and uses no outer transaction, so a bad row never rolls back good writes.
Facet/URL params are whitelist-parsed against closed vocabularies (`?node` against the
66-hex regex, `?sev`/`?signal`/`?action` against frozen schema enums), invalid values
silently dropped, and the `?card` id is whitelist-validated against the live card-id set
before reaching the client island. No `dangerouslySetInnerHTML` anywhere; suppressed
reasons and per-row errors render as React text nodes. The client islands import only
serializable view-models — never the server-only engine/signer (lazy `await import`
keeps the signer/DB out of the import graph). No hardcoded secrets; the secret is never
logged. **No BLOCKER findings.**

The defects below are correctness/honesty and quality issues. The most notable is an
**honesty mismatch** (WR-01): the drawer hardcodes a "14-day trend" label over data
that is actually a 7-day or 30-day series — directly at odds with the project's
"honest, fail-loud" core value. The rest are a multi-select visual desync across
soft-navigation, a dead unreachable series branch, and a type-soundness gap on
malformed batch rows.

## Warnings

### WR-01: Drawer hardcodes "14-day trend" label over 7-day / 30-day data

**File:** `src/components/insight/DetailDrawer.tsx:149` (label) vs `src/app/(overview)/inbox/page.tsx:160,163` (data window)
**Issue:** The drawer's trend section always renders the literal label `14-day trend`,
but the series it is given is never 14 days. `seriesForActiveCard` fetches
`closesDailySeries(pubkey, 30)` (30 days) for close signals and
`forwardsDailySeries(pubkey, "7d")` (7 days) for fee/revenue signals. So the operator
sees a "14-day trend" caption above a 7-day or 30-day polyline. The project's stated
core value is that every surface is honest/fail-loud; a fixed, wrong window label on an
operator decision surface is exactly the kind of misleading affordance that should be
caught. (The drawer header comment at lines 36-40 even describes the spark as honest.)
**Fix:** Drive the label from the actual window. Either derive it from `seriesKindFor`
(closes → "30-day trend", fee/revenue → "7-day trend") or pass the window length down
as a prop from the page where it is already known:
```tsx
// page.tsx — return the window with the series
async function seriesForActiveCard(card): Promise<{ points: TrendPoint[]; windowDays: number } | null> { ... }
// DetailDrawer.tsx
<span ...>{windowDays}-day trend</span>
```

### WR-02: Multi-select checkboxes visually reset on every facet soft-navigation

**File:** `src/components/insight/InboxTriage.tsx:130-145` and `src/components/insight/InfoGroups.tsx:140-145`
**Issue:** Selection state lives in the island's React `Set<cardId>` (`selected`), but the
visual checked state is written imperatively onto the *server-rendered* DOM nodes
(`selectSlot.setAttribute("data-state"/"aria-checked")`). A facet `<Link>` click is a
soft navigation that re-renders the server children, producing fresh `data-select-card`
spans with NO `data-state`/`aria-checked`. The persisted `selected` Set is not cleared,
so after a facet change the action bar still says "N selected" and `enqueue selected`
still targets those ids, but every checkbox renders visually unchecked — the operator
can no longer see what is selected. Worse, a still-selected card that is filtered out by
the new facet is no longer in `batchRows` for display but remains in `selected`; it is
silently dropped by `rowsFor` at confirm time (the `.filter(row !== undefined)`), so the
"N selected" count and the actual enqueued count diverge with no feedback.
**Fix:** Make the checked state declarative from React (don't mutate server DOM), or clear
the selection on navigation. Simplest: clear `selected` whenever the facet/route changes
(e.g. derive a route key from `useSearchParams()` and reset the Set in an effect), and
render the check mark from `selected.has(id)` rather than `setAttribute`. At minimum,
intersect `selected` with the currently-eligible/visible ids before showing the count and
before enqueue so the count never lies.

### WR-03: Malformed batch row can place `undefined` into a `chanId: string` field

**File:** `src/app/actions/queue.ts:121,137` (`enqueueBatch`)
**Issue:** `BatchRowResult` declares the failure variant as `{ ok: false; pubkey: string;
chanId: string; error: string }`, but on a validation failure the code assigns
`chanId: input.params?.chanId`. With the optional chain, that expression is
`string | undefined` (a row whose `params` is absent or whose `chanId` is missing/empty
yields `undefined`). The declared type promises `string`, so a malformed/adversarial
batch row violates the contract and surfaces `undefined` as the chan id in the
`BatchConfirmDialog` tally (`{r.chanId}` at `BatchConfirmDialog.tsx:160`), rendering a
literal empty/garbled identifier instead of an honest marker. (The validation gate
correctly rejects the row — this is purely the error-payload shape.)
**Fix:** Coalesce to a safe sentinel and keep the type honest:
```ts
chanId: input.params?.chanId ?? "(unknown channel)",
```
Apply at both the parse-failure push (line 121) and the catch push (line 137).

### WR-04: Cache TTL can serve data the page unconditionally renders as fresh

**File:** `src/lib/insight/engine.ts:365-397` and `src/app/(overview)/inbox/page.tsx:259`
**Issue:** `loadInsightView` now returns a cached `InsightView` for up to
`INSIGHT_TTL_MS` (45s). The cached `fetchedAt` is the *original* compute time, which is
correct — but the page renders `<FreshnessStamp asOf={view.fetchedAt} stale={false} />`
with `stale` hardcoded to `false`. Combined with the cache, the freshness stamp can show
a `data as of` timestamp up to ~45s old while asserting it is not stale, and there is no
path by which this surface ever reports stale. For a control tool whose core value is
"every recommended action must be safe and accountable," a freshness indicator that is
structurally incapable of going stale is a latent honesty gap — an operator could act on
a fee/close recommendation computed against warehouse state nearly a minute old believing
it is live. The cache itself is sound (promise-collapse, evict-on-reject); the issue is
the always-fresh stamp.
**Fix:** Derive `stale` from `view.fetchedAt` age against a threshold (the FreshnessStamp
already supports a `stale` flag), e.g. `stale={Date.now() - view.fetchedAt.getTime() >
INSIGHT_TTL_MS}` or a dedicated staleness budget, so the stamp reflects reality once the
cached compute ages out.

## Info

### IN-01: Dead, unreachable `forwards-count` branch in series resolution

**File:** `src/app/(overview)/inbox/page.tsx:168` and `src/lib/insight/triage.ts:179-184`
**Issue:** `seriesForActiveCard`'s final `return forwards;` is documented as the
"forwards-count → n is already the count" branch, but `seriesKindFor` can only ever
return `"forwards-fees"`, `"closes"`, or `null` — it never returns `"forwards-count"`
(the function maps fee/revenue signals to `forwards-fees`, close signals to `closes`,
and everything else to `null`). The `SeriesKind` union still lists `"forwards-count"` but
no code produces it, so the fall-through `return forwards` is unreachable. It is harmless
today but is latent dead code that misleads the next reader into thinking a count series
is wired.
**Fix:** Either drop `"forwards-count"` from the `SeriesKind` union and the dead branch,
or — if a volume series is intended — actually classify routing-volume signals to
`"forwards-count"` in `seriesKindFor` so the branch becomes live.

### IN-02: Selection checkbox slot is `aria-hidden`, making multi-select inaccessible

**File:** `src/components/insight/InfoGroups.tsx:143`
**Issue:** The selectable checkbox `<span>` carries `aria-hidden="true"` while the island
makes it an interactive multi-select control (`data-select-card`, toggled via click
delegation). Screen-reader users cannot perceive or operate the selection, and the
`role="checkbox"`/`aria-checked` set imperatively by the island lands on an
`aria-hidden` element so it is ignored by assistive tech. Keyboard operation is also
absent (click-delegated on a non-focusable span).
**Fix:** Make the selectable slot a real focusable control (e.g. `role="checkbox"`
`tabIndex={0}` with keyboard handling, no `aria-hidden`) when `selectable`, leaving the
purely decorative state for non-selectable rows.

### IN-03: `EvidenceRow`/InfoGroups render `evidence.metric` redundantly

**File:** `src/components/insight/InfoGroups.tsx:151-157`
**Issue:** For a non-`update_fee` info card, `channelLabel(card)` returns
`card.evidence.metric` (line 48), and the same row also renders `card.evidence.metric`
again at line 153 as the value prefix — so the metric name appears twice on one line.
Cosmetic, not incorrect, but reads oddly for any info signal that is not an `update_fee`
(e.g. a routing/liquidity info card lands in groups with a duplicated metric token).
**Fix:** When `channelLabel` already falls back to the metric, suppress the second
metric token, or give non-fee info rows a distinct value field.

### IN-04: `BatchConfirmDialog` groups tally by `pubkey` but `chanId` is the row identity

**File:** `src/components/insight/BatchConfirmDialog.tsx:91-97,158-160`
**Issue:** The per-row tally is grouped by `r.pubkey` and within a group each line is
keyed by array index (`key={i}`) and labeled by `r.chanId`. This is correct as long as
chan ids are unique per node, which they are. Worth noting only because the failure-path
`chanId` can be `undefined` (see WR-03), in which case the line renders an empty cell and
the index key is the only thing distinguishing two failed rows on the same node.
**Fix:** Once WR-03 supplies a non-empty `chanId` sentinel this is moot; otherwise key on
`chanId` and guard the empty render.

### IN-05: `advisoryText` non-null assertion relies on a same-line filter invariant

**File:** `src/components/insight/BatchConfirmDialog.tsx:67,70`
**Issue:** `advisoryText` does `Array.from(new Set(advisories.map((r) => r.rateLimitGuidance!)))`
— the `!` is justified only because `advisories` was filtered to
`rateLimitGuidance !== null` two lines up. The assertion is currently safe but is the
kind of coupling that silently breaks if the filter predicate is ever edited. Minor
maintainability nit, not a bug.
**Fix:** Narrow without the assertion, e.g.
`rows.flatMap((r) => (r.rateLimitGuidance !== null ? [r.rateLimitGuidance] : []))` then
de-dupe, so the type narrows structurally.

---

_Reviewed: 2026-06-17T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
