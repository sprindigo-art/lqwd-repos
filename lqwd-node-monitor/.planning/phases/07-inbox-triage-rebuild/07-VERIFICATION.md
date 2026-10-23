---
phase: 07-inbox-triage-rebuild
verified: 2026-06-17T10:02:00Z
status: passed
score: 27/27 must-haves verified
overrides_applied: 0
---

# Phase 7: Inbox Triage Rebuild Verification Report

**Phase Goal:** Rebuild /inbox from one ~531-row scroll into a triage cockpit — severity spine (critical+warn individual rows above the fold) + collapsed per-signal→per-node info-fee groups + always-visible suppressed block + collapsible facet rail (severity/node/signal/action, live counts over the unfiltered set, multi-select, combine to narrow) + in-place URL-synced detail/act drawer (full evidence + 14-day sparkline with honest fallback + verbatim action leaf) + bulk-enqueue (per-node ENQUEUE ALL + cross-node multi-select → aggregate confirm → enqueueBatch through the Phase-6 signed queue, best-effort per-row tally). Sketch-005 winner E. NOC Light design contract.
**Verified:** 2026-06-17T10:02:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Aggregated across the five plans' `must_haves.truths` (deduplicated). All verified against source + tests + the re-run battery.

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1  | partitionTriage puts every critical+warn card in the spine and only info in groups | ✓ VERIFIED | `triage.ts:59-83` — suppressed first, then critical/warn→spine, info→signal→pubkey groups. triage.test.ts green (37 tests in the 3-file run) |
| 2  | No card dropped: count-in === count-out | ✓ VERIFIED | Single-pass partition with `continue`; covered by no-card-dropped test in triage.test.ts |
| 3  | A critical card is never folded/grouped | ✓ VERIFIED | `triage.ts` partition driver is `card.severity`; `SeveritySpine.tsx:135-137` only the warn overflow tail folds, critical rendered flat (lines 149-156) |
| 4  | facetCounts computed over the unfiltered set, independent of active facets | ✓ VERIFIED | `triage.ts:99` takes ONLY `cards[]` (no facet arg); page.tsx:197 calls `facetCounts(view.cards)` before `applyFacets` |
| 5  | applyFacets narrows the spine; combined facets narrow further | ✓ VERIFIED | `triage.ts:137-148` AND-across / OR-within; page.tsx:200 `applyFacets(view.cards, facets)` then re-partition |
| 6  | seriesKindFor returns forwards for fee/revenue, closes for close-evidence, null otherwise | ✓ VERIFIED | `triage.ts:179-184`; fleet-target→null first, FEE_REVENUE→forwards-fees, CLOSE→closes, else null |
| 7  | shadcn Sheet vendored importing only radix-ui/lucide-react/@/lib/utils | ✓ VERIFIED | `sheet.tsx:4` `Dialog as SheetPrimitive from "radix-ui"`; grep: 1 unified radix-ui, 0 @radix-ui/react-dialog |
| 8  | enqueueBatch loops enqueue() once per row, each in its own transaction | ✓ VERIFIED | `queue.ts:113-144` per-row loop, lazy `import("@/lib/queue/enqueue")` inside loop |
| 9  | Missing-secret row yields {ok:false,error} verbatim while siblings return {ok:true,id} | ✓ VERIFIED | `queue.ts:126-140` per-row try/catch + `enqueueErrorCopy`; queue.batch.test.ts green |
| 10 | queued/skipped tally correct; good rows never rolled back by one bad row | ✓ VERIFIED | `queue.ts:142-143` queued=ok count; NO outer tx (grep: 0 dbNodemon.transaction) |
| 11 | Batch accepts {pubkey,params}[] only — no signature/canonical payload crosses | ✓ VERIFIED | `EnqueueInput = {pubkey, params}` (queue.ts:67); grep: 0 signature/canonicalPayload in BatchConfirmDialog |
| 12 | Each row re-validated server-side with enqueueInputSchema before signing | ✓ VERIFIED | `queue.ts:116` `enqueueInputSchema.safeParse(input)` per row |
| 13 | Critical+warn render as individual scannable rows above the fold on load | ✓ VERIFIED | `SeveritySpine.tsx:147-177` separate CRITICAL / WARN sections, individual SpineRow per card |
| 14 | info (fee) cards collapse into per-signal→per-node groups, collapsed on load | ✓ VERIFIED | `InfoGroups.tsx:82,105` two-level native `<details className="fold">`, no `open` attr |
| 15 | Suppressed cards render in distinct always-visible block, reason verbatim | ✓ VERIFIED | `SuppressedBlock.tsx:29-80` distinct section, reason as text node (line 63), no fold |
| 16 | No card dropped — page never renders a flat 531-row list | ✓ VERIFIED | page.tsx imports SeveritySpine/InfoGroups/SuppressedBlock; grep: 0 InsightCardList in page |
| 17 | Collapsible facet rail filters severity/node/signal/action, live counts unfiltered | ✓ VERIFIED | `FacetRail.tsx:106-178` four FacetDropdown groups, counts from `FacetCounts` (unfiltered) |
| 18 | Facets combine to narrow via URL search params (server re-render) | ✓ VERIFIED | `FacetRail.tsx:32-42` toggle+serializeFacets href; force-dynamic page re-renders |
| 19 | A facet change strips ?card from the URL, closing any open drawer | ✓ VERIFIED | `FacetRail.tsx:39-42` href from serializeFacets ONLY; grep: 0 `?card=`/`set("card"` in FacetRail |
| 20 | Selecting a card opens in-page Sheet drawer with full evidence, no navigation | ✓ VERIFIED | `DetailDrawer.tsx:96-178` Sheet side=right, `<dl>` evidence rows (metric/observed/threshold/window/asOf) |
| 21 | Drawer URL-synced via ?card: deep-linkable, back-closable, reload-safe | ✓ VERIFIED | `DetailDrawer.tsx:79-94` useSearchParams open state, router.replace strip on close; page.tsx:226-227 whitelist `?card` |
| 22 | Drawer hosts the FULL action inline (EnqueuePreview/CommandExport/runbook) | ✓ VERIFIED | `DetailDrawer.tsx:162-172` switch: enqueueProps→EnqueuePreview, exportBlock→CommandExport, else runbookNote |
| 23 | 14-day sparkline reuses Phase-3 trend reader with honest "no trend data" fallback | ✓ VERIFIED | `DetailDrawer.tsx:151-157` Sparkline when ≥2 points else "no trend data"; page.tsx:155-169 forwards/closesDailySeries with `.catch(()=>null)` |
| 24 | Per-node ENQUEUE ALL + cross-node multi-select drive one aggregate-confirm dialog | ✓ VERIFIED | `InboxTriage.tsx:116-148` data-enqueue-card-ids + data-select-card; `BatchConfirmDialog.tsx:116-123` scope summary |
| 25 | Confirm fires enqueueBatch; per-row tally inline, each skip's reason verbatim | ✓ VERIFIED | `BatchConfirmDialog.tsx:72-79,141-171` enqueueBatch(payload) then per-node grouped tally `{r.error}` verbatim |
| 26 | The facet rail toggles off for full-width view | ✓ VERIFIED | `InboxTriage.tsx:154,164-171` `.syn.railoff` swap; toggle relocated to main column (gap-closure af056f0) |
| 27 | Suppressed/LDK/non-fee cards structurally excluded from the bulk-selectable set | ✓ VERIFIED | page.tsx:215-221 batchEligibleIds only when `affordance.kind==="lnd"` && update_fee; InboxTriage.tsx:98,125,132 gated by `eligible.has(id)` |

**Score:** 27/27 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/insight/triage.ts` | partitionTriage/facetCounts/applyFacets/seriesKindFor pure | ✓ VERIFIED | 185 lines, pure (no server-only/DB/React), all 4 named exports |
| `src/lib/insight/triage.test.ts` | no-dropped/critical-never-folded/series tests | ✓ VERIFIED | green in 3-file run |
| `src/lib/insight/triage-facets.ts` | parseFacets/serializeFacets whitelist codec | ✓ VERIFIED | 109 lines; PUBKEY_RE + schema-enum whitelist; ?card orthogonal |
| `src/lib/insight/triage-facets.test.ts` | codec correctness tests | ✓ VERIFIED | green |
| `src/components/ui/sheet.tsx` | vendored shadcn Sheet | ✓ VERIFIED | unified radix-ui import, no new npm dep |
| `src/app/actions/queue.ts` | enqueueBatch + Batch types | ✓ VERIFIED | `export async function enqueueBatch` (line 113), BatchRowResult/EnqueueBatchResult exported |
| `src/app/actions/queue.batch.test.ts` | best-effort tally + no-rollback | ✓ VERIFIED | collected + green (co-located under src/app/actions, glob-covered) |
| `src/components/insight/SeveritySpine.tsx` | critical/warn rows, ?card triggers | ✓ VERIFIED | server component, no "use client" |
| `src/components/insight/InfoGroups.tsx` | native details signal→node + ENQUEUE ALL/checkbox slots | ✓ VERIFIED | server, two-level `<details>` |
| `src/components/insight/SuppressedBlock.tsx` | always-visible suppressed, verbatim reason | ✓ VERIFIED | server, no enqueue affordance, no params |
| `src/components/insight/FacetRail.tsx` | collapsible rail, live counts as Link filters, strip ?card | ✓ VERIFIED | server, FacetDropdown-based (gap-closure 4630f82) |
| `src/app/(overview)/inbox/page.tsx` | force-dynamic shell: partition+facets+counts+island | ✓ VERIFIED | force-dynamic preserved, single loadInsightView, no InsightCardList |
| `src/components/insight/InboxTriage.tsx` | single client island: rail toggle, multi-select, drawer/dialog host | ✓ VERIFIED | "use client", no signer/engine import |
| `src/components/insight/DetailDrawer.tsx` | URL-synced Sheet + action leaves + sparkline | ✓ VERIFIED | "use client", useSearchParams, no signer/engine import |
| `src/components/insight/BatchConfirmDialog.tsx` | aggregate confirm + enqueueBatch + tally | ✓ VERIFIED | "use client", no `<input>`, no signature |
| `.planning/.../07-05-SUMMARY.md` | gate result + operator verdict verbatim | ✓ VERIFIED | "approved" recorded at line 82 |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| triage.ts | types.ts | import type | ✓ WIRED | line 1 `from "@/lib/insight/types"` |
| triage-facets.ts | PUBKEY_RE | 66-hex regex | ✓ WIRED | line 28 `/^[0-9a-f]{66}$/` |
| enqueueBatch | enqueue.ts | lazy import in loop | ✓ WIRED | queue.ts:128 `await import("@/lib/queue/enqueue")` |
| enqueueBatch | enqueueInputSchema+errorCopy | reuse verbatim | ✓ WIRED | queue.ts:116,122,138 |
| inbox/page.tsx | triage.ts + triage-facets.ts | partition/counts/facets/parse | ✓ WIRED | page.tsx:4-6,193-201 |
| inbox/page.tsx | loadInsightView | single force-dynamic data path | ✓ WIRED | page.tsx:174 |
| FacetRail | URL search params | Link sets facets, strips ?card | ✓ WIRED | grep: 0 `?card`/`set("card"` |
| DetailDrawer | EnqueuePreview/CommandExport | switch on action type | ✓ WIRED | lines 164,166 |
| DetailDrawer | ?card search param | useSearchParams drives open | ✓ WIRED | line 81 |
| BatchConfirmDialog | enqueueBatch | confirm fires batch, renders tally | ✓ WIRED | lines 5,77 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| inbox/page.tsx | `view.cards` | `loadInsightView()` (server-only engine) | Yes — live warehouse read at request time, force-dynamic | ✓ FLOWING |
| SeveritySpine/InfoGroups/SuppressedBlock | spine/groups/suppressed | `partitionTriage(applyFacets(view.cards, facets))` | Yes — derived from real card array | ✓ FLOWING |
| FacetRail | counts | `facetCounts(view.cards)` over unfiltered set | Yes | ✓ FLOWING |
| DetailDrawer | series | `forwardsDailySeries`/`closesDailySeries` for opened card, `.catch(()=>null)` | Yes — real Phase-3 reader; honest null fallback by design | ✓ FLOWING |
| InboxTriage | batchRows/batchEligibleIds | `resolveEnqueueAffordance` + `batchRowFor` from real cards | Yes — server-resolved, props passed serializable | ✓ FLOWING |

No HOLLOW_PROP / DISCONNECTED found. The opened-card series fetch is correctly per-card (no Promise.all fan-out), with an honest `null` fallback rendered as "no trend data" — that is the contracted behavior, not a stub.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase-7 unit core green | `vitest run triage.test.ts triage-facets.test.ts queue.batch.test.ts` | 37 passed | ✓ PASS |
| Full suite green | `npm test` | 668 passed / 20 skipped | ✓ PASS |
| Frozen-schema golden | `vitest run schema.contract.test.ts` | 13 passed | ✓ PASS |
| Production build + /inbox dynamic | `npm run build` | Compiled ✓, TS clean, `/inbox` = ƒ (dynamic) | ✓ PASS |
| Inbox-surface typecheck | `tsc --noEmit` filtered to insight/inbox/queue/sheet | 0 errors | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` and this phase is a UI rebuild; verification is the test/build battery above plus the operator visual checkpoint (Step 8).

### Security Grep Battery (plan-05 contract)

| Check | Result | Status |
| ----- | ------ | ------ |
| client signature/canonicalPayload in insight+queue components | only assertion comments (ApprovePanel/EnqueuePreview) | ✓ CLEAN |
| dangerouslySetInnerHTML in inbox surface | only a comment in SuppressedBlock.tsx:15 | ✓ CLEAN |
| dbNodemon.transaction in queue.ts | none (no outer batch tx) | ✓ CLEAN |
| islands importing @/lib/queue/sign|enqueue|insight/engine | none | ✓ CLEAN |
| Promise.all in inbox/page.tsx | none (no series fan-out) | ✓ CLEAN |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| INBOX-01 | 07-01,07-03,07-05 | Spine + collapsed groups + visible suppressed, never flat, no card dropped | ✓ SATISFIED | Truths 1-3,13-16; SeveritySpine/InfoGroups/SuppressedBlock |
| INBOX-02 | 07-01,07-03,07-05 | Collapsible facet rail, live counts, combine to narrow, toggle off | ✓ SATISFIED | Truths 4-5,17-19,26; FacetRail + InboxTriage rail toggle |
| INBOX-03 | 07-01,07-04,07-05 | In-page detail/act drawer with full evidence + affordance, no nav-away | ✓ SATISFIED | Truths 6-7,20-23; DetailDrawer URL-synced Sheet + sparkline + leaves |
| INBOX-04 | 07-02,07-04,07-05 | Bulk-enqueue many update_fee through Phase-6 signed queue, re-validated/re-signed server-side | ✓ SATISFIED | Truths 8-12,24-25,27; enqueueBatch + BatchConfirmDialog + structural exclusion |

All four requirement IDs from PLAN frontmatter are declared in REQUIREMENTS.md mapped to Phase 7 (lines 126-129), marked Complete. No orphaned requirements — REQUIREMENTS.md maps exactly INBOX-01..04 to Phase 7 and all four are claimed across the plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | none | — | The only `dangerouslySetInnerHTML` and `signature` grep hits in the inbox surface are explanatory comments, not code. No TBD/FIXME/XXX debt markers in the phase files. `seriesKindFor` declares a `"forwards-count"` member never returned by any path, but the must-have only contracts forwards/closes/null and the page handles all three kinds — not a stub, a deliberately wider type. |

### Human Verification Required

None outstanding. The phase's single human checkpoint (07-05 Task 2, `checkpoint:human-verify`, blocking) was completed live this session: the operator typed **"approved"** (recorded verbatim in 07-05-SUMMARY.md line 82), confirming INBOX-01..04 on the live fleet dataset against sketch-005 winner E, including the three operator-found gaps that were closed inline (commits 4630f82, af056f0, 0751f4b — all reachable on main) and re-verified by the battery. The PLAN files contain no deferred `<verify><human-check>` blocks beyond this resolved checkpoint.

### Gaps Summary

No gaps. Every must-have across all five plans is verified against the actual codebase — pure core (partition/facets/series), the enqueueBatch best-effort action, the four server presentation components, the three client interaction islands, and the rewritten force-dynamic page. The recorded battery was independently re-run and reproduced exactly (668 pass / 20 skip; schema golden 13/13; build green with /inbox dynamic; security greps clean). The data flow is real (live warehouse via loadInsightView, per-opened-card series with honest fallback), the signed-queue boundary is intact (params-only, server signs once per row, no outer transaction, no client signature), and the blocking operator visual checkpoint was approved verbatim. Phase goal achieved.

---

_Verified: 2026-06-17T10:02:00Z_
_Verifier: Claude (gsd-verifier)_
