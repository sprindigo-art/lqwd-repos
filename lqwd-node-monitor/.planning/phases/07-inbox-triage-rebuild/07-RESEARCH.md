# Phase 7: Inbox Triage Rebuild - Research

**Researched:** 2026-06-16
**Domain:** Next.js 16 App Router presentation rebuild + write-path reuse (React 19 client islands, shadcn/Tailwind v4, server-action batch enqueue over an existing signed queue)
**Confidence:** HIGH (every finding is grounded in read source files in this repo; the only external claim — shadcn `sheet` install shape — is MEDIUM and verified against the installed `radix-ui` precedent)

## Summary

Phase 7 is a **presentation + write-path-reuse rebuild**, not a new-detector or new-contract phase. Every data input is already produced verbatim by `loadInsightView()` (`src/lib/insight/engine.ts`), already ranked, suppressed, hysteresis-stamped, and rate-limit-guided. The frozen `InsightCard` contract (`src/lib/insight/schema.ts`, `.strict()` at every level, `CARD_SCHEMA_VERSION = 1`) is consumed as-is. The whole job is to re-shape the existing flat `InsightCardList` into a **severity spine + collapsed info groups + suppressed block + collapsible facet rail + URL-synced detail/act drawer**, and to add a **batch bulk-enqueue** that loops the existing single-card server-side enqueue path.

The five open questions resolve cleanly against the codebase:
- **D-09 (filter state):** the card payload is small (~531 cards × a flat object ≈ tens of KB; well within a serializable RSC prop budget), and the page is already `force-dynamic`. Recommendation: **URL search params own the facet filter** (server re-renders the narrowed spine, shareable, back-button, no client re-fetch of the heavy set), with **live facet counts computed server-side over the unfiltered set** so counts never drift. This reconciles with D-10 because `?card=ID` is an *additional, orthogonal* search param read client-side by the drawer.
- **Batch enqueue (D-05..D-08):** add a **new sibling server action `enqueueBatch`** in `src/app/actions/queue.ts` that loops the existing `enqueue()` (`src/lib/queue/enqueue.ts`) **once per row, each in its own transaction**, collecting a per-row `{ ok | error }` tally. Do **not** wrap the batch in one transaction — sign-once-per-row + best-effort + no-rollback (D-07) demand independent commits.
- **shadcn Sheet:** `npx shadcn@latest add sheet` vendors cleanly (the repo already uses the unified `radix-ui` package the current shadcn registry emits). **Skip the full shadcn `sidebar`** — it drags in Sheet+`useIsMobile`+input+separator+skeleton+tooltip and a context provider; the design skill's own `.syn`/`.syn.railoff` CSS-grid rail (`grid-template-columns: 200px 1fr` → `0 1fr`) is lighter and exactly matches winner E.
- **Sparkline (D-13):** reuse `forwardsDailySeries`/`closesDailySeries` (`src/lib/console/trends.ts`) + `Sparkline` exactly as the console `[tab]/page.tsx` already does (lines 229–251). Map per *metric family*; everything else renders the honest "no trend data" fallback (`Sparkline` already returns `null` for <2 points).
- **Server/client split:** the Phase-5/6 pattern holds verbatim — server computes/partitions/builds props; thin `"use client"` leaves own only interaction state. The spine, groups, suppressed block, and facet *counts* are server; the drawer, multi-select set, collapse toggles, rail on/off, and the batch-confirm dialog are client.

**Primary recommendation:** Build a server `InboxTriage` shell that partitions `view.cards` by severity (D-01) and reads `searchParams` for facets (D-09) + `?card` (D-10); render the existing `EnqueuePreview`/`CommandExport` leaves inside a client `Sheet` drawer (D-12); add `enqueueBatch` as a loop-the-existing-path sibling action (D-07). No new queries, no new card contract, no detector changes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Card computation / ranking / suppression | Frontend Server (RSC) | — | `loadInsightView()` is `server-only`, runs on every `force-dynamic` request; FROZEN, consumed verbatim |
| Severity partition + info grouping | Frontend Server (RSC) | — | Pure transform of the pre-ranked array; no interaction state — belongs server-side like the existing `InsightCardList` |
| Facet filter application + live counts | Frontend Server (RSC) | Browser (URL) | Counts must be correct over the full set; URL search params drive the server re-render (D-09 recommendation) |
| Facet rail toggle (on/off, expand groups) | Browser / Client | — | Pure UI state; `.syn.railoff` grid swap; no data dependency |
| Detail/act drawer open + selected card | Browser / Client | Browser (URL `?card=ID`) | shadcn `Sheet` client island; URL-synced for deep-link/back/reload (D-10) |
| Multi-select set + batch-confirm dialog | Browser / Client | — | Ephemeral selection state; confirm is the deliberate write gesture (D-06) |
| Single enqueue (re-validate + sign) | API / Backend (server action) | — | `enqueueCommand` → `enqueue()`; server-only signer, UI never sends a signature (CLAUDE.md §5) |
| **Batch enqueue (N intents)** | **API / Backend (server action)** | — | New `enqueueBatch` loops `enqueue()` server-side, one tx per row (D-07) |
| Drawer sparkline series | Frontend Server (RSC) | Database (RO warehouse) | `forwardsDailySeries`/`closesDailySeries` are `server-only` lazy-DB reads; series passed as plain props to the client drawer |
| `update_fee` bounds re-enforcement | API / Backend | — | `updateFeeBoundsSchema` is the authoritative gate inside the action (UI clamp is UX only) |

## Standard Stack

This phase adds **one** vendored primitive and **zero** new npm dependencies. Everything else is already installed and version-locked in `package.json` (verified by reading the file this session).

### Core (already installed — no install needed)
| Library | Version (package.json) | Purpose | Why Standard |
|---------|------------------------|---------|--------------|
| next | 16.1.6 | App Router RSC + server actions | Workspace standard; page already `force-dynamic` |
| react / react-dom | 19.2.3 | Client islands | Mandated by Next 16 |
| radix-ui (unified) | ^1.5.0 | Sheet/Dialog/Checkbox/Tooltip primitives | Already the import source for vendored `dialog`/`checkbox`/`tooltip` (`import { Dialog as DialogPrimitive } from "radix-ui"`) |
| zod | ^3.25.76 | Param re-validation | `updateFeeBoundsSchema` already gates the single enqueue |
| tailwindcss + @tailwindcss/postcss | ^4 | Styling, CSS-first `@theme` | NOC Light tokens already in `globals.css` (incl. `--sidebar-*`) |
| tw-animate-css | ^1.4.0 | Drawer slide-in animation | Already present; v4-compatible (do NOT use `tailwindcss-animate`) |

### Supporting (vendor via shadcn CLI — one new file)
| Component | How to add | Purpose | When to Use |
|-----------|-----------|---------|-------------|
| `sheet` | `npx shadcn@latest add sheet` | The slide-in detail/act drawer (D-10) | The drawer shell; wraps the existing action leaves |

**Do NOT add the shadcn `sidebar` component.** See "Don't Hand-Roll" / "Alternatives Considered" — it is far heavier than this phase needs and the design skill already specifies a 2-line CSS-grid rail.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `.syn` CSS-grid rail | shadcn `sidebar` component | `sidebar` pulls in Sheet + `useIsMobile` hook + input/separator/skeleton/tooltip + a `SidebarProvider` context and cookie-persisted state — a NOC desktop tool with a simple "toggle filters" doesn't need any of that. The design skill (`inbox-triage-layout.md` §CSS) gives the exact `grid-template-columns:200px 1fr` → `0 1fr` swap. **Choose the custom rail.** |
| URL search params for facets (D-09) | Ephemeral `useState` + client-side `.filter()` over all 531 cards | Client filtering needs the full card array serialized into a client component (defeats the RSC `force-dynamic` model and re-ships ~tens of KB to the browser per load). URL params keep the heavy set server-side and make filtered views shareable/back-button-friendly. **Choose URL params** (and see D-09 detail). |
| One `enqueueBatch` action looping `enqueue()` | Extend `enqueueCommand` with an array overload | A separate sibling action keeps the single-card contract (`EnqueueResult`) untouched and gives the batch its own `{ results: [...] }` tally shape (D-07) without conditionals in the hot single-card path. **Choose the sibling action.** |
| Native `<details>` for info-group folds | JS-controlled collapse state | The design skill explicitly specifies `<details class="fold">` (zero-JS, reload-stable, accessible). **Use native `<details>`** for the per-signal→per-node folds; reserve client JS for multi-select + drawer. |

**Installation:**
```bash
npx shadcn@latest add sheet
```
No `npm install` step. (`npx shadcn@latest`, NOT `@canary` — v4+React-19 are GA, per the NodeMonitor CLAUDE.md §3.)

## Package Legitimacy Audit

No new npm packages are installed this phase. The single addition is a **vendored source file** generated by the already-trusted `shadcn` CLI into `src/components/ui/sheet.tsx`, importing from the already-installed `radix-ui` package.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| radix-ui (already in `package.json` ^1.5.0) | npm | mature | very high | github.com/radix-ui/primitives | n/a (pre-installed, operator-vetted in Phase 2/3/6) | Already approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was not run because this phase installs zero new registry packages. The one vendored file comes from the shadcn CLI the project already used to add `dialog`/`checkbox`/`tooltip`/`table`/`badge`/`button`/`card`. The planner should still eyeball the generated `sheet.tsx` for an unexpected `import` (it should import only from `radix-ui`, `lucide-react`, and `@/lib/utils`).*

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────── REQUEST (force-dynamic) ──────────────────────────┐
 GET /inbox?sev=critical&node=<pk>&signal=fee_raise&card=<id>                                          │
        │                                                                                              │
        ▼                                                                                              │
 [RSC] InboxPage (server)                                                                              │
   │  loadInsightView()  ── server-only ──►  warehouses (RO)  ──►  cards[] (FROZEN, pre-ranked)        │
   │       │                                                                                           │
   │       ├─ partitionBySeverity(cards)         → spineCritical[], spineWarn[], infoGroups{}, suppressed[]
   │       ├─ computeFacetCounts(cards)          → {severity{}, node{}, signal{}, action{}}  (over UNFILTERED set)
   │       ├─ applyFacets(cards, searchParams)   → visibleCards[]   (server-side narrow; D-09)
   │       └─ resolveEnqueueAffordance(card)     → per-card serializable EnqueuePreviewProps (server-only backend gate)
   │
   ├──► [server] SpinePanel(critical) / SpinePanel(warn)        — individual rows, never folded if critical (D-04)
   ├──► [server] InfoGroups  → <details> signal ▸ <details> node — collapsed on load (D-02), per-node ENQUEUE ALL slot
   ├──► [server] SuppressedBlock                                 — always visible, reason verbatim (D-03), null action
   ├──► [server] FacetRail(counts, activeFromSearchParams)       — links that set search params; .syn grid
   │
   └──► [client] TriageInteractive (one "use client" island)
            │  reads useSearchParams() → ?card=ID  ──►  opens <Sheet> drawer for that card
            │  owns: rail on/off, multi-select Set<cardId>, fold UX niceties
            │  drawer body switches on action type → <EnqueuePreview>|<CommandExport>|<PendingRunbook>  (D-12)
            │  multi-select / per-node ENQUEUE ALL → confirm dialog → enqueueBatch(rows)  (D-05..D-08)
                                                                          │
                                                                          ▼
                                                  [server action] enqueueBatch(EnqueueInput[])
                                                        for each row:  enqueue(pubkey, params)   ← sign-once, own tx
                                                        collect { ok:true,id } | { ok:false,error } verbatim
                                                        return { results: [...], queued, skipped }   (no rollback)
                                                                          │
                                                                          ▼
                                                       nodemon DB  →  pending_approval rows  →  /queue (Phase 6)
```

### Recommended Project Structure
```
src/
├── app/(overview)/inbox/page.tsx          # REWRITE: server shell — partition + facets + counts + drawer-prop build
├── app/actions/queue.ts                   # ADD enqueueBatch sibling action (loops enqueue(); D-07 tally)
├── components/insight/
│   ├── InboxTriage.tsx          (client)  # the single interaction island: rail toggle, multi-select, drawer host
│   ├── SeveritySpine.tsx        (server)  # critical/warn individual rows (reuses InsightCardRow body grammar)
│   ├── InfoGroups.tsx           (server)  # <details> signal ▸ node folds + per-node ENQUEUE ALL trigger
│   ├── SuppressedBlock.tsx      (server)  # D-03 always-visible block
│   ├── FacetRail.tsx            (server)  # facet counts + active-state links (.syn grid)
│   ├── DetailDrawer.tsx         (client)  # <Sheet> wrapper, switches action leaf by type (D-12)
│   └── BatchConfirmDialog.tsx   (client)  # aggregate scope confirm + per-row tally (D-06/D-07)
├── lib/insight/
│   ├── triage.ts               (pure)     # partitionBySeverity, groupInfoBySignalThenNode, facetCounts, applyFacets
│   └── triage-facets.ts        (pure)     # search-param ⇄ facet-state codec (parse/serialize, whitelist)
└── components/ui/sheet.tsx                 # vendored via shadcn CLI
```

### Pattern 1: Server partition, thin client leaves (Phase-5/6 verbatim)
**What:** The server component does ALL computation and partitioning; client components own only interaction state and receive serializable props.
**When to use:** Always, here — it's the established repo law.
**Example (the precedent this phase mirrors):**
```tsx
// Source: src/components/insight/InsightCardRow.tsx (current) — server component,
// the gate resolved server-side, the client leaf receives serializable props only.
const enqueue = resolveEnqueueAffordance(card);     // server-only backend gate
// ...
{enqueue.kind === "lnd" && <EnqueuePreview {...enqueue.props} />}   // client leaf, props only
```
The drawer follows the same law: the server resolves `resolveEnqueueAffordance(card)` and `buildExportBlock(card)` per card and passes the resulting **serializable** props into the client `DetailDrawer`, which never imports the signer or the server-only resolver.

### Pattern 2: URL-synced client overlay (the existing modal precedent)
**What:** A client overlay whose open/closed state is derived from the router, so back-button and reload behave.
**When to use:** The detail drawer (D-10), `?card=ID`.
**Example:**
```tsx
// Source: src/components/scorecard/ScorecardModal.tsx — close walks the router back.
// The Phase-7 drawer adapts this: open = searchParams.has("card"); onOpenChange(false) → router.back()
// or router.replace(pathname + strippedQuery). Reading ?card on the client lets the
// drawer hydrate the selected card from a server-passed lookup map keyed by card.id.
const router = useRouter();
<Dialog open onOpenChange={(open) => { if (!open) router.back(); }}>
```
**Landmine (D-11):** the `@modal/inbox/page.tsx` no-op guard returns `null` ONLY to stop the `(.)[pubkey]` interceptor from catching the literal `inbox` segment. `?card=ID` is a **search param, not a path segment** — the interceptor matches on path, so the two never collide. Keep the guard as-is. Do **not** route the drawer through the `@modal` parallel slot; it is an in-page `Sheet`, not an intercepted route.

### Pattern 3: Per-metric sparkline series mapping (D-13)
**What:** Map a card's evidence metric to one of the three sanctioned daily series, else honest fallback.
**Example (the exact precedent to copy):**
```tsx
// Source: src/app/(overview)/[pubkey]/[tab]/page.tsx lines 240–251
const revenueSeries = forwardsSeries?.map((p) => ({ day: p.day, n: p.feesSat ?? 0 })) ?? null;
const seriesFor = (key) => {
  if (key === "routing") return forwardsSeries;      // daily forward COUNT
  if (key === "revenue") return revenueSeries;       // daily forward FEES (sats)
  if (key === "forceClose") return closesSeries;     // daily close COUNT
  return null;                                        // latest-state dims → no series
};
```
`Sparkline` already renders nothing for `<2` points (`if (points.length < 2) return null;`), so the "no trend data" fallback is **automatic** — the drawer just needs to render an honest "no trend data" label when `series` is null/empty rather than a blank gap.

### Anti-Patterns to Avoid (from the binding design skill "What to Avoid")
- **A flat 531-row list** — the whole problem; emergencies drown.
- **Severity gated behind a filter click** — triage must be visible on load; facets are *additive*, never a precondition.
- **An always-on 3-column layout** — the drawer is on-demand (`Sheet`), default is the 2-col `.syn`.
- **Grouping only by node** — info bulk nests signal→node (D-02); node-only grouping was rejected (variant C).
- **Action-first as the default** — buries emergencies below the fee bulk (variant D rejected).
- **Dots/emoji/icons for state; severity color on non-state; navy on non-chrome.** Severity color is a 3px left border + label tint only (`.sectionbar.crit`); navy is reserved for the act (`.act`) + links + focus.
- **Re-fabricating a sparkline line where no series exists** — render honest "no trend data" (D-13).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC signing of batch rows | A batch signer / canonical re-serializer | Loop the existing `enqueue()` (`src/lib/queue/enqueue.ts`) which already signs once per row over `buildSignedPayload`+`signPayload` and stores the verbatim canonical string | sign-once-per-row is the cross-phase freeze; a batch-level signer would diverge from the Phase-8 bash verifier |
| Param bounds for bulk | A new batch validator | `updateFeeBoundsSchema` (`src/lib/queue/bounds.ts`) per row inside `enqueueBatch` | One authoritative gate; node re-enforces a third time |
| The drawer's action UI | New enqueue/export/runbook components | The verbatim `EnqueuePreview` / `CommandExport` leaves (D-12) | "One component, both surfaces" (Phase-4 D-08 / Phase-5 D-01); a fork would drift |
| Sparkline rendering | A chart lib / new SVG | `Sparkline` + `forwardsDailySeries`/`closesDailySeries` | Recharts deliberately NOT added for a 160×40 polyline (`Sparkline.tsx` header note); honest fallback is built in |
| Collapsible rail | shadcn `sidebar` | The `.syn`/`.syn.railoff` CSS-grid swap from the design skill | `sidebar` drags a provider, `useIsMobile`, and 5 extra components; the grid swap is 2 CSS rules |
| Info-group collapse | A JS expand/collapse store | Native `<details class="fold">` (design skill) | Zero-JS, reload-stable, accessible; matches the sketch grammar |
| Suppression gating | New suppression logic | `card.suppressed.active` / `card.suggestedAction === null` already on the card (`guardrails.ts`) | Suppressed cards arrive with null actions ⇒ structurally non-enqueueable (AP-11/AP-12 handled upstream) |

**Key insight:** Phase 7 writes **presentation + one server action that loops an existing one**. Every safety-critical primitive (sign, bound, suppress, format) already exists and is tested. The risk surface is almost entirely UI composition + the batch tally contract — not crypto, not queries.

## Open Questions — RESOLVED (the five the planner asked)

### OQ-1 (D-09): Filter-state location → **URL search params** (HIGH)
**Measured cost.** `loadInsightView()` returns `InsightCard[]` (`engine.ts` line 103). Each card is a flat object: `severity`, `node{pubkey,alias,backend}`, `target`, `evidence{metric,observed,threshold,unit,window,asOf,deepLink,detail?}`, `suggestedAction{type,params}`, `suppressed`, `provenance`, `rateLimitGuidance`. Conservatively ~400–700 bytes JSON/card → ~531 cards ≈ **0.2–0.4 MB serialized**. That is already produced server-side every request (the page is `export const dynamic = "force-dynamic"`, `revalidate = 0`).
**Recommendation:** facets live in the **URL** (`?sev=`, `?node=`, `?signal=`, `?action=`, repeatable/CSV). The server reads `searchParams`, narrows the spine, and renders only the visible set — **the heavy card array never crosses to the client.** This matches the existing `force-dynamic` model, makes filtered views shareable/back-button-friendly (a Deferred "saved presets" nicety falls out for free), and avoids hydrating 531 cards into a client filter.
**Live counts stay correct (the one hazard):** compute facet counts **server-side over the UNFILTERED `view.cards`** (a pure `facetCounts(cards)` in `lib/insight/triage.ts`), independent of which facets are active. Counts reflect the full fleet; the spine reflects the active narrow. Do not derive counts from the post-filter set.
**Reconciliation with D-10:** `?card=ID` is an orthogonal search param. The server still renders the full shell; the **client** `DetailDrawer` reads `useSearchParams().get("card")` and opens. Changing facets (server nav) and opening the drawer (client) both mutate the query string but never the same key. To keep the drawer open across a facet change, append `?card` to facet links (or strip it — planner's UX call); both are reload-safe.
**Discretion note:** D-09 is explicitly Claude's discretion. If the planner finds the card set is materially smaller live (e.g. the engine dedupes hard), ephemeral client state is still defensible — but the URL-param recommendation is the lower-risk default and the one the design skill ("shareable URL filters") leans toward.

### OQ-2 (D-05..D-08): Batch bulk-enqueue → **new `enqueueBatch` sibling action, loop the existing path** (HIGH)
**Cleanest shape.** Add to `src/app/actions/queue.ts`:
```ts
export type BatchRowResult =
  | { ok: true; id: string; pubkey: string; chanId: string }
  | { ok: false; pubkey: string; chanId: string; error: string };   // error = enqueueErrorCopy(...) verbatim
export type EnqueueBatchResult = { results: BatchRowResult[]; queued: number; skipped: number };

export async function enqueueBatch(inputs: EnqueueInput[]): Promise<EnqueueBatchResult> { /* loop */ }
```
**Implementation rules (each maps to a decision):**
- **D-07 best-effort + verbatim tally:** loop the rows; for each, run the SAME `enqueueInputSchema.safeParse` then `enqueue(pubkey, params)` inside its own `try/catch`. Collect `{ok:true,id}` or `{ok:false,error: enqueueErrorCopy(msg)}` — reuse the existing `enqueueErrorCopy` so the `NO SIGNING SECRET FOR THIS NODE` / lost-race copy is byte-identical to the single path.
- **No all-or-nothing rollback (D-07):** each `enqueue()` is already **its own transaction** (`enqueue.ts` line 54 `dbNodemon.transaction(...)`). Do **not** wrap the loop in an outer transaction — a single outer tx would roll back good writes on one bad row and would also fight sign-once-per-row. Independent commits = durable good writes + named failures.
- **Sign-once-per-row / server-only signing (CLAUDE.md §5):** `enqueue()` generates `command_id`, `expires_at`, canonical payload, and `signPayload` **per row, server-side**. The UI sends `{pubkey, params}[]` only — **never** a signature or canonical payload. The batch action re-validates each row's params with `updateFeeBoundsSchema` (authoritative gate) before signing.
- **D-06 aggregate confirm:** the confirm dialog is client-side and states scope ("N intents → M nodes, ppm range X–Y, all engine-suggested, expires +24h") BEFORE calling `enqueueBatch`. No per-card param editing in bulk — engine `suggestedPpm`/`baseFeeMsat`/`timeLockDelta` are sent as-is. (Nudging one value stays the single-card `EnqueuePreview` flow.)
- **D-08 rate-limit advisory, not enforced:** surface each card's `rateLimitGuidance` (already on the card from `applyRateLimitGuidance`) in the confirm dialog, but still enqueue all. The node heartbeat (Phase 8) is the real throttle.
- **Suppression (AP-11/AP-12):** suppressed cards arrive with `suggestedAction === null` (`guardrails.ts applySuppression`). The bulk UI must only collect rows where `resolveEnqueueAffordance(card).kind === "lnd"` — suppressed/LDK/non-fee cards are structurally excluded from the selectable set, so they can never reach `enqueueBatch`.
**Concerns flagged:** (a) **command_id collisions** — each row calls `randomUUID()` independently, no collision risk. (b) **No idempotency key across the batch** — if the operator double-clicks CONFIRM, they'd enqueue duplicates; gate the confirm button to a single in-flight submit (disable on submit, the `EnqueuePreview` `submitting` precedent). (c) **Partial-failure UX** — render the `results[]` tally inline ("N queued, K skipped") with each skipped row's `error` verbatim, grouped by node (D-07).

### OQ-3: shadcn Sheet + rail under Next 16 / React 19 → **`add sheet`, custom-grid rail** (MEDIUM→HIGH)
- **Sheet install:** `npx shadcn@latest add sheet` (NOT `@canary`). The repo's `components.json` is configured (`"rsc": true`, `"style": "radix-nova"`, css `src/app/globals.css`), and existing primitives import from the **unified `radix-ui`** package (`import { Dialog as DialogPrimitive } from "radix-ui"`, confirmed in `dialog.tsx`/`checkbox.tsx`/`tooltip.tsx`). The current shadcn registry emits Sheet against that same unified package, so it vendors cleanly with **no new npm dependency** (`radix-ui@^1.5.0` already provides `Dialog`, which Sheet is built on). Verify the generated file imports only `radix-ui` + `lucide-react` + `@/lib/utils`.
- **Sidebar — skip it.** `npx shadcn add sidebar` pulls Sheet + a `useIsMobile` hook + input/separator/skeleton/tooltip + a `SidebarProvider` cookie-persisted context. Overkill for a desktop NOC "toggle filters." The design skill (`inbox-triage-layout.md` §CSS) specifies the rail as a CSS-grid swap (`.syn { grid-template-columns:200px 1fr }` → `.syn.railoff { 0 1fr }`, `transition:0.15s`). The `--sidebar-*` tokens are already in `globals.css` (lines 165–241) if the planner wants to borrow the palette, but no `Sidebar` component is needed.
- **URL-sync pattern for the Sheet (D-10):** open state = `useSearchParams().get("card") !== null` in a `"use client"` component; `onOpenChange(false)` → `router.back()` (the `ScorecardModal` precedent) or `router.replace` stripping `?card`. Deep-linkable (reload renders the shell, the client opens the drawer), back-button-closable (router pop), reload-safe (server renders the page; client reads the param on hydrate). The drawer hydrates card detail from a server-passed `Map<id, cardViewModel>` (serializable) so it never needs the server-only engine on the client.

### OQ-4 (D-13): Drawer sparkline wiring → **reuse console mapping, metric-family map** (HIGH)
Series readers (`src/lib/console/trends.ts`) cover exactly three event-backed shapes (the module header states this verbatim):
| Card signal / metric family | Series reader | Series channel |
|------------------------------|---------------|----------------|
| `fee_raise` / `fee_lower` / `fee_stepdown` / `channel_close_candidate` (revenue-evidence cards) | `forwardsDailySeries(pubkey, "7d")` remapped to `feesSat` | daily forward **fees** (sats) — the `revenueSeries` remap, page line 244 |
| routing-volume evidence | `forwardsDailySeries(pubkey)` | daily forward **count** |
| `ap11_close_storm` / `fleet_close_cluster` / `htlc_timeout_fc` (close-evidence cards) | `closesDailySeries(pubkey, 30)` | daily close **count** |
| `stuck_*`, `rebalance_*`, liquidity/peer/channel-health-evidence cards | **none** | → honest "no trend data" (latest-state dims have no sanctioned history reader; module header) |
- These readers are `server-only` lazy-DB reads — call them in the **server** `InboxPage` for the *selected* card only (or pre-fetch for visible cards) and pass `TrendPoint[] | null` into the client drawer as a plain prop. **Per-fleet caution:** `pubkey` is required; fleet-target cards (`node === null`) have no single pubkey → no series → fallback. Do NOT fan these reads across all 531 cards on load — fetch the series for the **opened** card (driven by `?card=ID`) to keep the query budget bounded.
- **Fallback (D-13):** `Sparkline` returns `null` for `<2` points, so the drawer renders an explicit "no trend data" label when `series` is null/empty/single-point — never a fabricated line.

### OQ-5: Server/client component split (HIGH)
| Piece | Tier | Reason |
|-------|------|--------|
| `InboxPage` (partition, facet narrow + counts, drawer-prop build, series fetch for selected card) | **Server** | Reuses `loadInsightView`, `resolveEnqueueAffordance`, `buildExportBlock`, `trends.ts` — all `server-only` |
| `SeveritySpine`, `InfoGroups` (`<details>`), `SuppressedBlock`, `FacetRail` | **Server** | Pure render of pre-computed data; counts must be server-correct |
| `InboxTriage` interaction shell (rail on/off, multi-select Set, fold niceties) | **Client** | Owns ephemeral interaction state only |
| `DetailDrawer` (`Sheet`, reads `?card`) | **Client** | Router/URL + overlay state |
| `EnqueuePreview`, `CommandExport`, pending runbook (inside the drawer) | **Client (existing leaves)** | Already `"use client"`; reused verbatim (D-12) |
| `BatchConfirmDialog` + the `enqueueBatch` call | **Client → server action** | Confirm is client UX; the write is the server action |
The rule (from `code_context` / Phase 5/6): **server computes, thin `"use client"` leaves own interaction state.** Multi-select and the drawer are the only genuinely-new client state.

## Runtime State Inventory

This is a presentation + write-path-reuse phase. It mutates only the existing `nodemon` queue via the existing `enqueue()` path; it introduces no rename/refactor/migration of stored state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema change. Bulk-enqueue writes `pending_approval` rows via the unchanged `commands`/`commandAudit` tables (`enqueue.ts`). | none |
| Live service config | None — no external service config touched. | none |
| OS-registered state | None — no cron/scheduler/task changes (Phase 8 owns node-side). | none |
| Secrets/env vars | Reuses `NODEMON_HMAC_SECRET_<pubkey>` (read server-side by `sign.ts`) and `NODEMON_TTL_HOURS` — **no new env var, no rename.** | none |
| Build artifacts | One new vendored file `src/components/ui/sheet.tsx` (CLI-generated). No package install, no lockfile churn beyond that file. | commit the generated file |

**Nothing found requiring migration:** verified by reading `enqueue.ts` (writes only existing tables), `bounds.ts`/`sign.ts` (no new keys), and `package.json` (no dependency add).

## Common Pitfalls

### Pitfall 1: Wrapping the batch in one transaction
**What goes wrong:** one bad row (missing secret, lost race) rolls back every good enqueue.
**Why:** intuition says "batch = one transaction."
**How to avoid:** loop `enqueue()` (already per-row transactional); collect results; never open an outer tx. D-07 mandates no-rollback of good writes.
**Warning sign:** an `enqueueBatch` that opens `dbNodemon.transaction` around the loop.

### Pitfall 2: Filtering facet counts after applying facets
**What goes wrong:** counts drop to the filtered subset, so the rail can't show "303 fee raises" once you've filtered to one node.
**How to avoid:** compute `facetCounts(view.cards)` over the **unfiltered** set; apply facets only to the rendered spine.
**Warning sign:** counts that change when you click a facet (other than the active one's own highlight).

### Pitfall 3: Routing the drawer through `@modal` or treating `?card` as a path
**What goes wrong:** collision with the `(.)[pubkey]` interceptor; the `@modal/inbox` guard exists precisely because `inbox` would otherwise be caught as a pubkey (D-11).
**How to avoid:** the drawer is an in-page `Sheet` keyed off the `?card` **search param**, not a route. Leave the `@modal/inbox/page.tsx` `null` guard untouched.
**Warning sign:** a new file under `@modal/` for the drawer, or a `[card]` segment.

### Pitfall 4: Sending engine params the client mutated, or a client signature
**What goes wrong:** breaks CLAUDE.md §5 (UI never produces signed params) and the suppression guarantee.
**How to avoid:** bulk sends `{pubkey, params}` from the card's `suggestedAction.params` verbatim (no bulk editing, D-06); `enqueueBatch` re-validates with `updateFeeBoundsSchema` and signs server-side.
**Warning sign:** any `signature`/`canonicalPayload` field crossing the action boundary; any editable input in the bulk confirm dialog.

### Pitfall 5: Fanning the series readers across all visible cards
**What goes wrong:** ~531 cards × a per-pubkey DB read = query-budget blowout.
**How to avoid:** fetch `forwardsDailySeries`/`closesDailySeries` only for the **opened** card (`?card=ID`); fleet-target cards get no series (fallback).
**Warning sign:** a `Promise.all(cards.map(c => forwardsDailySeries(...)))` on the inbox load path.

### Pitfall 6: Folding a critical card
**What goes wrong:** violates D-01/D-04 ("a critical is never folded") — the core "no emergency ever hides" rule.
**How to avoid:** partition strictly on `card.severity`: `critical` + `warn` → individual rows; **only `info`** → groups. Row-cap tail folds (D-04) may only apply to a `warn` overflow, never `critical`.
**Warning sign:** a `<details>` whose contents include any `severity === "critical"` card.

## Code Examples

### Partition (pure, server)
```ts
// Source: derived from src/components/insight/InsightCardList.tsx severity filter + D-01/D-02
export function partitionTriage(cards: InsightCard[]) {
  const spine = cards.filter((c) => c.severity === "critical" || c.severity === "warn");
  const info  = cards.filter((c) => c.severity === "info" && !c.suppressed.active);
  const suppressed = cards.filter((c) => c.suppressed.active);   // D-03 — always-visible block
  // D-02: group info by signal → node
  const groups = new Map<DetectorId, Map<string /*pubkey|fleet*/, InsightCard[]>>();
  for (const c of info) {
    const sig = groups.get(c.signal) ?? new Map();
    const key = c.node?.pubkey ?? "fleet";
    sig.set(key, [...(sig.get(key) ?? []), c]);
    groups.set(c.signal, sig);
  }
  return { spine, groups, suppressed };
}
```

### Batch action (server)
```ts
// Source: src/app/actions/queue.ts (enqueueCommand) generalized per D-07
export async function enqueueBatch(inputs: EnqueueInput[]): Promise<EnqueueBatchResult> {
  const results: BatchRowResult[] = [];
  for (const input of inputs) {
    const parsed = enqueueInputSchema.safeParse(input);          // authoritative bounds gate, per row
    if (!parsed.success) {
      results.push({ ok: false, pubkey: input.pubkey, chanId: input.params.chanId,
        error: enqueueErrorCopy(parsed.error.issues[0]?.message ?? "invalid input") });
      continue;
    }
    try {
      const { enqueue } = await import("@/lib/queue/enqueue");    // own tx; signs once
      const id = await enqueue(parsed.data.pubkey, parsed.data.params);
      results.push({ ok: true, id, pubkey: parsed.data.pubkey, chanId: parsed.data.params.chanId });
    } catch (error) {
      console.error("enqueueBatch row failed");                  // never log the secret (V7)
      results.push({ ok: false, pubkey: input.pubkey, chanId: input.params.chanId,
        error: enqueueErrorCopy(error instanceof Error ? error.message : String(error)) });
    }
  }
  const queued = results.filter((r) => r.ok).length;
  return { results, queued, skipped: results.length - queued };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tailwindcss-animate` | `tw-animate-css` (already installed) | Tailwind v4 | Use `tw-animate-css` for the drawer slide-in; v4 engine rejects the old plugin |
| `npx shadcn@canary` for v4 | `npx shadcn@latest` | shadcn GA on v4+React19 (Feb 2025) | `add sheet` works on `@latest` |
| Per-component `@radix-ui/*` imports | Unified `radix-ui` package | radix-ui 1.x | Vendored Sheet imports from `radix-ui` (matches the repo's `dialog`/`checkbox`/`tooltip`) |

**Deprecated/outdated:** none relevant — the stack is current and locked in `package.json`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `npx shadcn@latest add sheet` vendors against the installed unified `radix-ui@^1.5.0` with no new npm dependency | OQ-3 / Stack | Low — if the registry emits `@radix-ui/react-dialog` instead, that's one trivial `npm i`; verify the generated file's imports. The Dialog primitive Sheet needs is already provided by `radix-ui`. |
| A2 | Live card count is in the ~531 range cited in CONTEXT/design skill (drives the D-09 payload estimate) | OQ-1 | Low — the recommendation (URL params) is *more* favorable as the set grows; a smaller set only widens the discretion to use client state. |
| A3 | `updateFeeBoundsSchema` provisional bounds (ppm 0–5000 etc.) are correct for bulk | OQ-2 | Inherited `[ASSUMED]` from Phase 6 (`bounds.ts` flags A1 for operator confirmation). Bulk doesn't change the bounds; it re-uses the same gate. No new risk introduced here. |

## Open Questions (residual)

1. **Keep `?card` open across a facet change, or strip it?**
   - Known: both are reload-safe; facet nav is a server navigation, drawer is client.
   - Unclear: the preferred UX when an operator filters while the drawer is open.
   - Recommendation: strip `?card` on facet change (simpler mental model: "filtering returns me to the spine"); planner/operator may override.
2. **Pre-fetch sparkline series for the selected card only vs. lazy on drawer-open.**
   - Known: per-card reads must not fan across all cards (Pitfall 5).
   - Recommendation: server-fetch the series for the `?card` card in `InboxPage` (request already dynamic) so the drawer opens with data on reload; no client round-trip.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Next.js | the whole page | ✓ | 16.1.6 | — |
| React / react-dom | client islands | ✓ | 19.2.3 | — |
| radix-ui (unified) | Sheet/Dialog | ✓ | ^1.5.0 | — |
| shadcn CLI | vendor `sheet.tsx` | ✓ (used in prior phases) | @latest | hand-author the file from radix `Dialog` (the `dialog.tsx` precedent) |
| `nodemon` DB (RW) | bulk enqueue | ✓ (Phase 6) | — | — |
| `NODEMON_HMAC_SECRET_<pubkey>` env | per-row signing | per-node | — | missing → row returns `NO SIGNING SECRET FOR THIS NODE` verbatim (D-07 tally), batch continues |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** a node lacking its HMAC secret simply produces a named skip in the batch tally (by design, D-07) — not a blocker.

## Validation Architecture

> `.planning/config.json` was not found; per the GSD default (absent = enabled) this section is included. Test framework is Vitest (`package.json` `"test": "vitest run"`, `vitest@^4`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4 (config carries the `@/` alias; plain node/ESM, no Next plugin — Phase-1 decision in STATE.md) |
| Config file | `vitest.config.*` (present per Phase 1; confirm path at Wave 0) |
| Quick run command | `npx vitest run <file> -t <name>` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INBOX-01 | `partitionTriage` puts every critical+warn in the spine, only `info` in groups, suppressed in its own block, **no card dropped** (count in == count out) | unit (pure) | `npx vitest run src/lib/insight/triage.test.ts` | ❌ Wave 0 |
| INBOX-01 | a `critical` card is never placed inside a fold/group | unit | same file | ❌ Wave 0 |
| INBOX-02 | `facetCounts` over the unfiltered set + `applyFacets` over search-param state; combined facets narrow; counts independent of active facets | unit (pure) | `npx vitest run src/lib/insight/triage-facets.test.ts` | ❌ Wave 0 |
| INBOX-03 | drawer series mapping: fee/revenue→forwards, close→closes, else null (honest fallback) | unit (pure mapping fn) | `npx vitest run src/lib/insight/triage.test.ts -t series` | ❌ Wave 0 |
| INBOX-04 | `enqueueBatch` best-effort: a row whose secret is missing yields `{ok:false, error}` verbatim while sibling rows return `{ok:true,id}`; `queued`/`skipped` tally correct; **no rollback** of good rows | integration (live `nodemon` fixture, per Phase-6 `06-03` precedent) OR mocked `enqueue` unit | `npx vitest run src/app/actions/queue.batch.test.ts` | ❌ Wave 0 |
| INBOX-04 | bulk never sends a signature/canonical payload; suppressed/LDK/non-fee cards are excluded from the selectable set | unit (resolveEnqueueAffordance gate over a fixture card set) | `npx vitest run src/lib/queue/enqueue-props.test.ts` | check (Phase-6 may have one) |

### Sampling Rate
- **Per task commit:** the touched pure-module test (`triage`, `triage-facets`, or `queue.batch`).
- **Per wave merge:** `npm test` (full Vitest suite).
- **Phase gate:** full suite green + live golden (`loadInsightView` still parses against the FROZEN schema) + the operator visual checkpoint (every prior UI phase had one; Phase 3/5/6 precedent) + a security grep (no `signature`/`canonicalPayload` crossing the action boundary; no `dangerouslySetInnerHTML`).

### Wave 0 Gaps
- [ ] `src/lib/insight/triage.test.ts` — partition + no-card-dropped invariant + series-mapping (INBOX-01, INBOX-03)
- [ ] `src/lib/insight/triage-facets.test.ts` — facet count/codec correctness (INBOX-02)
- [ ] `src/app/actions/queue.batch.test.ts` — best-effort tally, no-rollback (INBOX-04)
- [ ] confirm `vitest.config` path + the `@/` alias (Phase-1 established it; just verify)
- [ ] `src/components/ui/sheet.tsx` — vendor via `npx shadcn@latest add sheet` (not a test, but a Wave-0 prerequisite)

## Security Domain

> `security_enforcement` config not found; treated as enabled (absent = enabled). The project CLAUDE.md mandates a Grade-A scan before deploy (Phase 9), zero node credentials in the dashboard, and server-only signing.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | `server-only` boundary preserved: `enqueue`/`sign`/`bounds`/`trends`/`enqueue-props` stay server-side; the new `enqueueBatch` is `"use server"`; client leaves never import the signer |
| V5 Input Validation | yes | `updateFeeBoundsSchema` (zod) re-validates **every** batch row server-side; `?card` and facet search params are whitelist-parsed before use (the `(.)[pubkey]` `PUBKEY_RE` precedent) |
| V5 Output Encoding | yes | All card text renders as React text nodes (the `InsightCardRow` rule); no `dangerouslySetInnerHTML`; failure-tally reasons render as TEXT only |
| V6 Cryptography | yes | HMAC sign happens **only** in `sign.ts` (server-only), once per row, via the existing `enqueue()`; the batch never re-implements signing; secret never logged (V7) and never sent to the client |
| V7 Error/Logging | yes | `enqueueBatch` logs `"enqueueBatch row failed"` with no secret bytes; the per-row `error` copy carries no secret (reuses `enqueueErrorCopy`) |
| V4 Access Control | n/a (v1) | single-operator local tool; RBAC explicitly deferred (REQUIREMENTS v2) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client supplies a forged signature / canonical payload in bulk | Spoofing/Tampering | Action accepts `{pubkey, params}[]` only; server recomputes everything (CLAUDE.md §5) |
| Bulk-enqueue on an AP-11/AP-12 suppressed node | Tampering | Suppressed cards arrive with `suggestedAction === null` → excluded from the selectable set; `enqueueBatch` re-validates and would still need valid params |
| Search-param injection via `?node=`/`?card=` | Tampering | Whitelist-parse against known pubkeys/signals before any query or DOM use; invalid → ignored facet, not an error |
| One bad row aborting all writes (availability of good intents) | DoS-ish (lost work) | Per-row independent transactions; best-effort tally (D-07) |
| XSS via failure-reason / suppression-reason text | Tampering | Rendered as text nodes; no HTML sink (existing `InsightCardRow` discipline) |

## Sources

### Primary (HIGH confidence — read this session)
- `src/lib/insight/engine.ts` — `loadInsightView()` data path, `InsightView` shape, query budget, fail-soft posture
- `src/lib/insight/schema.ts` + `types.ts` — FROZEN card contract (`.strict()`, `update_fee` params, severity taxonomy)
- `src/lib/insight/guardrails.ts` — suppression/hysteresis/rate-limit (suppressed ⇒ null action)
- `src/app/actions/queue.ts` — `enqueueCommand`, `enqueueErrorCopy`, the contract `enqueueBatch` extends
- `src/lib/queue/enqueue.ts` / `bounds.ts` / `sign.ts` — per-row transaction, bounds gate, server-only HMAC signer
- `src/components/insight/InsightCardList.tsx` / `InsightCardRow.tsx` — current flat list being replaced; server-compute/client-leaf split
- `src/components/queue/EnqueuePreview.tsx` + `src/lib/queue/enqueue-props.ts` — the drawer's fee leaf + the server-only affordance gate
- `src/lib/console/trends.ts` + `src/components/console/Sparkline.tsx` + `src/components/console/EvidencePanel.tsx` + `[pubkey]/[tab]/page.tsx` (lines 229–251) — the exact sparkline wiring + per-metric mapping to copy
- `src/app/(overview)/inbox/page.tsx` — the `force-dynamic` server page being rebuilt
- `src/app/(overview)/@modal/inbox/page.tsx` + `@modal/(.)[pubkey]/page.tsx` + `layout.tsx` — the interceptor guard (D-11) and modal slot
- `src/components/scorecard/ScorecardModal.tsx` — the URL-synced client overlay precedent for D-10
- `package.json` / `components.json` / `src/components/ui/*` — installed versions, unified `radix-ui` import style, shadcn config
- `src/app/globals.css` — NOC Light + `--sidebar-*` tokens already present
- `.claude/skills/sketch-findings-nodemonitor/references/inbox-triage-layout.md` + `SKILL.md` — binding winner-E spec, `.syn`/`.drawer`/`.fold` CSS, "What to Avoid"
- `.planning/phases/07-inbox-triage-rebuild/07-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — decisions D-01..D-13, INBOX-01..04, success criteria

### Secondary (MEDIUM confidence)
- ui.shadcn.com/docs/components/sidebar (WebFetch) — confirmed `sidebar` depends on Sheet + `useSidebar`/mobile state; basis for the "skip sidebar, use the grid rail" recommendation
- NodeMonitor CLAUDE.md §3 (shadcn v4+React19 GA, `@latest` not `@canary`) — verified against the installed `radix-ui` precedent

### Tertiary (LOW confidence)
- None — every load-bearing claim is grounded in a read repo file.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — read from `package.json`/`components.json`/vendored `ui/*`; one new vendored file, zero new deps.
- Architecture (split, partition, batch action, drawer, sparkline): HIGH — each maps to a read precedent in this repo.
- Pitfalls: HIGH — derived from the actual `enqueue.ts` transaction shape, the `@modal` guard, and the design skill's "What to Avoid."
- shadcn `sheet` install shape: MEDIUM — verified against the unified `radix-ui` import precedent; A1 flags the residual.

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (stable stack; locked versions). Re-verify only if `package.json` Next/React/radix versions change or the FROZEN card schema (`CARD_SCHEMA_VERSION`) is bumped.
