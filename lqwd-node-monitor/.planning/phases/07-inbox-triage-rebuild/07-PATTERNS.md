# Phase 7: Inbox Triage Rebuild - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 11 new / 2 modified
**Analogs found:** 13 / 13 (every file has a same-repo analog — this is a presentation + write-path-reuse phase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/insight/triage.ts` *(new)* | utility (pure) | transform | `src/components/insight/InsightCardList.tsx` (severity filter) | role-match (logic extracted to pure module) |
| `src/lib/insight/triage-facets.ts` *(new)* | utility (pure) | transform | `enqueueInputSchema` codec in `src/app/actions/queue.ts` + `PUBKEY_RE` whitelist | role-match (param parse/whitelist) |
| `src/app/(overview)/inbox/page.tsx` *(rewrite)* | route (server page) | request-response (force-dynamic) | itself (current version) + console `[tab]/page.tsx` (series fetch) | exact |
| `src/app/actions/queue.ts` → add `enqueueBatch` *(modify)* | service (server action) | batch / request-response | `enqueueCommand` in the same file | exact (sibling of the function it loops) |
| `src/components/insight/SeveritySpine.tsx` *(new)* | component (server) | transform | `InsightCardList.tsx` + `InsightCardRow.tsx` | exact |
| `src/components/insight/InfoGroups.tsx` *(new)* | component (server) | transform | `InsightCardList.tsx` (section partition) + design-skill `<details class="fold">` | role-match |
| `src/components/insight/SuppressedBlock.tsx` *(new)* | component (server) | transform | `InsightCardRow.tsx` suppression render (lines 137-143, 185-194) | exact |
| `src/components/insight/FacetRail.tsx` *(new)* | component (server) | transform | `InsightCardList.tsx` section heads + design-skill `.syn`/`.facet` CSS | role-match |
| `src/components/insight/InboxTriage.tsx` *(new)* | component (client island) | event-driven (interaction state) | `EnqueuePreview.tsx` / `CommandExport.tsx` (client-leaf shape) | role-match |
| `src/components/insight/DetailDrawer.tsx` *(new)* | component (client overlay) | event-driven (URL-synced) | `src/components/scorecard/ScorecardModal.tsx` | exact |
| `src/components/insight/BatchConfirmDialog.tsx` *(new)* | component (client) | request-response (action call) | `EnqueuePreview.tsx` confirm/submitting flow + `dialog.tsx` | role-match |
| `src/components/ui/sheet.tsx` *(vendor via CLI)* | config (vendored primitive) | — | `src/components/ui/dialog.tsx` | exact (same radix-ui Dialog base) |
| Drawer sparkline wiring *(inside DetailDrawer + page)* | utility | streaming/series | console `[tab]/page.tsx` `seriesFor()` lines 246-251 + `Sparkline.tsx` | exact |

---

## Pattern Assignments

### `src/lib/insight/triage.ts` (pure utility, transform) — NEW

**Analog:** `src/components/insight/InsightCardList.tsx` (the severity-filter partition being extracted into a pure, testable module).

**Partition pattern to extract** (`InsightCardList.tsx` lines 30-33 — the stable, engine-order-preserving filter):
```tsx
{SECTIONS.map(({ severity, head, tint }) => {
  // Stable partition — engine order preserved within the section.
  const section = cards.filter((card) => card.severity === severity);
  if (section.length === 0) return null;
```

**Conventions to replicate:**
- **Engine order is law — apply NO ranking** (`InsightCardList.tsx` header comment lines 7-13). The pure module only *partitions* a pre-ranked array; never re-sorts within a partition.
- **Partition driver is `card.severity`, not signal-type** (D-01/D-06): `critical || warn → spine`, `info && !suppressed.active → groups`, `suppressed.active → suppressed block`. **Never fold a critical** (Pitfall 6).
- **Info grouping nests `card.signal` (DetectorId) → `card.node?.pubkey ?? "fleet"`** (D-02). `card.node` is nullable; fleet-target cards key on `"fleet"` (see `InsightCardRow.tsx` line 104 `card.node !== null` branch and line 114 `card.target.kind === "fleet"`).
- **`facetCounts(cards)` computes over the UNFILTERED set** (Pitfall 2); `applyFacets(cards, state)` narrows only the rendered spine. Two separate functions.
- **No-card-dropped invariant** (INBOX-01): count-in === count-out across `{spine, groups, suppressed}` — the unit test asserts this.
- Named exports, `@/` imports, no default export (CLAUDE.md conventions). Pure — no `server-only`, no DB.

Exact partition skeleton already drafted in RESEARCH.md "Code Examples → Partition (pure, server)" (07-RESEARCH.md lines 310-325).

---

### `src/lib/insight/triage-facets.ts` (pure utility, transform) — NEW

**Analog:** the input-schema + whitelist gate in `src/app/actions/queue.ts` (the `PUBKEY_RE` whitelist-parse discipline) — a search-param ⇄ facet-state codec.

**Whitelist-parse pattern** (`queue.ts` line 24 + 60-65):
```ts
const PUBKEY_RE = /^[0-9a-f]{66}$/;
// ...
pubkey: z.string().regex(PUBKEY_RE, "invalid pubkey (expected 66 lowercase hex characters)"),
```

**Conventions to replicate:**
- **Whitelist-parse every search param before use** (Security V5; Pitfall 3): `?sev=`, `?node=`, `?signal=`, `?action=` parsed against known enums/pubkeys; invalid → ignored facet, never an error (07-RESEARCH.md line 450).
- `?card=ID` is **orthogonal** to facets — a different key, read client-side by the drawer; the codec must round-trip facets without clobbering `?card` (D-09/D-10 reconciliation, 07-RESEARCH.md line 211).
- Reuse the same 66-hex `PUBKEY_RE` for `?node=` validation (consistency with `queue.ts` / console page / `buildDeepLink`).
- Pure module, named exports, no DB. Unit-tested (`triage-facets.test.ts`, INBOX-02).

---

### `src/app/(overview)/inbox/page.tsx` (server route) — REWRITE

**Analog:** itself (current version, read this session) + the console `[tab]/page.tsx` series-fetch block.

**Server-shell conventions to preserve** (current `inbox/page.tsx` lines 9-13, 41-57):
```tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Inbox" };
// ...
let view: InsightView;
try {
  view = await loadInsightView();
} catch (error) {
  console.error("Inbox load failed:", error);
  return ( /* honest read-only error state */ );
}
```

**Conventions to replicate:**
- Keep `force-dynamic` + `revalidate = 0` + the try/catch honest error state verbatim (D-09 URL-params model depends on the live request-time read).
- **One `loadInsightView()` call is the entire data path** (lines 41-44) — consume verbatim, no ranking here.
- Read `searchParams` for facets (D-09) and `?card` (D-10); call `partitionTriage` + `facetCounts` + `applyFacets` from `triage.ts`; build serializable drawer props via `resolveEnqueueAffordance(card)` (server-only gate) per card.
- **Sparkline series: fetch ONLY for the `?card` selected card** (Pitfall 5) — never `Promise.all` across all cards. Mirror the console page's guarded `.catch(() => null)` pattern.
- The honest empty state (lines 91-98) and AP-12 page-copy section (lines 105-114) stay; suppressed cards never become the empty state.
- Render server children (`SeveritySpine`, `InfoGroups`, `SuppressedBlock`, `FacetRail`) + the one `"use client"` `InboxTriage` island.

**Series-fetch precedent** (console `[tab]/page.tsx` lines 229-244): use `forwardsDailySeries(pubkey, "7d").catch(() => null)` / `closesDailySeries(pubkey, 30).catch(() => null)`; remap `feesSat` into the `n` channel for revenue (line 244). Pass `TrendPoint[] | null` as a plain prop.

---

### `src/app/actions/queue.ts` → add `enqueueBatch` (server action, batch) — MODIFY

**Analog:** `enqueueCommand` in the same file (lines 74-89) — the batch is its row-loop sibling.

**Pattern to extend** (`queue.ts` lines 74-89):
```ts
export async function enqueueCommand(input: EnqueueInput): Promise<EnqueueResult> {
  const parsed = enqueueInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: enqueueErrorCopy(parsed.error.issues[0]?.message ?? "invalid input") };
  }
  try {
    const { enqueue } = await import("@/lib/queue/enqueue"); // lazy server-only import
    const id = await enqueue(parsed.data.pubkey, parsed.data.params);
    return { ok: true, id };
  } catch (error) {
    console.error("enqueueCommand failed");                  // never log the secret (V7)
    return { ok: false, error: enqueueErrorCopy(error instanceof Error ? error.message : String(error)) };
  }
}
```

**Conventions to replicate (each maps to a decision):**
- **Loop the existing `enqueue()` once per row** (D-07; Don't-Hand-Roll). Reuse `enqueueInputSchema.safeParse` + `enqueueErrorCopy` verbatim so the `NO SIGNING SECRET FOR THIS NODE` copy is byte-identical to the single path (`queue.ts` lines 44-49).
- **No outer transaction** — `enqueue()` is already per-row transactional (`enqueue.ts` line 54 `dbNodemon.transaction(...)`). Wrapping the loop in one tx rolls back good writes on one bad row (Pitfall 1).
- **Sign-once-per-row, server-side only** — `enqueue()` generates `command_id` (`randomUUID()`), `expires_at`, the canonical payload, and `signPayload` per row (`enqueue.ts` lines 37-49). The UI sends `{pubkey, params}[]` ONLY — **never** a signature or canonicalPayload (CLAUDE.md §5; Pitfall 4).
- **Best-effort tally shape** (D-07): collect `{ ok:true, id }` | `{ ok:false, error }` per row; return `{ results, queued, skipped }`. Keep the single-card `EnqueueResult` type untouched (separate sibling, not an overload — 07-RESEARCH.md line 61).
- `"use server"` at file top already present; never log the secret (`console.error("enqueueBatch row failed")` with no message bytes — V7).

Exact draft in RESEARCH.md "Code Examples → Batch action (server)" (07-RESEARCH.md lines 329-352) and the type signatures at lines 217-222.

---

### `src/components/insight/SeveritySpine.tsx` (server component) — NEW

**Analog:** `src/components/insight/InsightCardRow.tsx` (the per-card row body, reused verbatim grammar) + `InsightCardList.tsx` section heads.

**Section-head + row pattern** (`InsightCardList.tsx` lines 36-50):
```tsx
<section className="overflow-hidden rounded-lg border border-border bg-card">
  <div className="flex items-center border-b border-border px-4 py-2.5">
    <span className={`font-mono text-xs font-semibold tracking-[0.14em] uppercase ${tint}`}>
      {head} — {section.length}
    </span>
  </div>
  {section.map((card) => <InsightCardRow key={card.id} card={card} />)}
</section>
```

**Conventions to replicate:**
- **Reuse `InsightCardRow`'s identity/evidence-line grammar** (`InsightCardRow.tsx` lines 91-135): severity tint via `SEVERITY_TEXT` (state color only), mono uppercase signal label from `SIGNAL_LABELS`, node alias + `BackendBadge`, deep-link on `ms-auto`, evidence line with AFM-002 `formatValue`.
- Severity color is the **3px left border + label tint only** — design skill `.sectionbar.crit`/`.sectionbar.warn` (inbox-triage-layout.md lines 41-43). No dots/emoji/icons for state.
- The spine row is also the drawer trigger — wire selection to `?card=ID` (the row sets the search param; the client `DetailDrawer` reads it). Carry data on the row for the drawer (design skill HTML structures line 81-82).
- **Critical never folded** (D-04/Pitfall 6); a row-cap tail `<details>` may apply only to a `warn` overflow.

---

### `src/components/insight/InfoGroups.tsx` (server component) — NEW

**Analog:** `InsightCardList.tsx` (section partition) + the binding design-skill `<details class="fold">` grammar.

**Native-details fold pattern** (inbox-triage-layout.md lines 56-58, CSS the planner styles against):
```css
.fold > summary { list-style:none; cursor:pointer; display:grid;
  grid-template-columns:1.4rem minmax(0,1fr) max-content max-content; }
.fold[open] .tw { transform:rotate(90deg); }   /* ▸ → ▾ via rotation */
```

**Conventions to replicate:**
- **Native `<details>` for both fold levels** — signal `▸` then node `▸` (D-02; Don't-Hand-Roll: zero-JS, reload-stable, accessible). All collapsed on load.
- Two-level nest: per-signal (`Fee raise (303) ▸`) → per-node (`Canada ·118 ▸`). Counts rendered mono tabular-nums, right-aligned.
- The per-node group header carries the **`ENQUEUE ALL ▸`** trigger slot (D-05) and the per-row checkbox slot for cross-node multi-select — but the interactive trigger itself lives in the client `InboxTriage` island (server renders the structure, client owns the selection Set).
- Only `info`-severity, non-suppressed cards reach here (Pitfall 6).

---

### `src/components/insight/SuppressedBlock.tsx` (server component) — NEW

**Analog:** `InsightCardRow.tsx` suppression rendering (the exact verbatim-reason grammar).

**Suppression-render pattern to lift** (`InsightCardRow.tsx` lines 137-143 and 185-194):
```tsx
{card.suppressed.active && card.suppressed.reason !== null && (
  <p className="mt-1 font-mono text-xs font-semibold text-status-warn">
    <span className="tracking-[0.06em] uppercase">SUPPRESSED</span> — {card.suppressed.reason}
  </p>
)}
// disabled action area — withheld type only, never params:
<div className="mt-2 rounded-[3px] border border-border bg-muted/40 px-3 py-2 opacity-50">
  <span className="...uppercase">withheld — {withheldAction ?? "action"}</span>
```

**Conventions to replicate:**
- **A distinct always-visible block** — never inside a fold (D-03; the operator must never click to discover a suppressed emergency).
- Reason rendered **verbatim** in the warn tint (D-14 fail-loud); reason is a **text node only**, no HTML sink (V5).
- Suppressed cards carry `suggestedAction === null` ⇒ render the disabled `withheld — {type}` area, **never params** (T-04-29). Structurally non-enqueueable — excluded from any selectable set (AP-11/AP-12 upstream).

---

### `src/components/insight/FacetRail.tsx` (server component) — NEW

**Analog:** `InsightCardList.tsx` section heads (mono count grammar) + design-skill `.syn`/`.facet` CSS.

**Rail-grid pattern** (inbox-triage-layout.md lines 61-63):
```css
.syn { display:grid; grid-template-columns:200px minmax(0,1fr); gap:var(--space-4);
  transition:grid-template-columns 0.15s; }
.syn.railoff { grid-template-columns:0 minmax(0,1fr); }
```

**Conventions to replicate:**
- **Hand-roll the rail as a CSS-grid swap — do NOT vendor shadcn `sidebar`** (Don't-Hand-Roll; 07-RESEARCH.md lines 54-59, 235). `--sidebar-*` palette tokens already in `globals.css` if needed, but no `Sidebar` component.
- `.facetgroup` blocks: `<h4>` + `.facet` buttons each with a right-aligned `.fc` count; `.facet.on` highlights the active filter (design skill HTML structures lines 77-78).
- **Facet counts computed server-side over the unfiltered `view.cards`** (Pitfall 2) and passed in — counts never drift when a facet is active.
- Each facet is a `<Link>` that sets the search param (server re-render, D-09) — navy reserved for the active/focus state only.

---

### `src/components/insight/InboxTriage.tsx` (client island, event-driven) — NEW

**Analog:** `EnqueuePreview.tsx` / `CommandExport.tsx` (the thin `"use client"` leaf shape) — the single interaction island.

**Client-leaf discipline** (`EnqueuePreview.tsx` lines 1-3, 17-19 header):
```tsx
"use client";
import { useState } from "react";
// ...receives SERIALIZABLE props only — never the card (containment T-05-03);
// NEVER imports the signer or the server-only backend resolver (T-06-20/D-12).
```

**Conventions to replicate:**
- **Server computes; this island owns ONLY interaction state** (Phase-5/6 law; 07-RESEARCH.md Pattern 1): rail on/off (`.syn.railoff` class toggle), the multi-select `Set<cardId>`, fold UX niceties, and hosting the drawer + confirm dialog.
- **Never import `@/lib/queue/enqueue` / `sign` / `enqueue-props`** — receives serializable props only (containment T-05-03/T-06-20).
- Single in-flight submit gate on the batch confirm (disable on submit — the `EnqueuePreview` `submitting` phase precedent, lines 67, 136, 245) to prevent double-enqueue (07-RESEARCH.md line 231b).
- Only collect rows where `resolveEnqueueAffordance(card).kind === "lnd"` (server-resolved) into the selectable set — suppressed/LDK/non-fee structurally excluded.

---

### `src/components/insight/DetailDrawer.tsx` (client overlay, URL-synced) — NEW

**Analog:** `src/components/scorecard/ScorecardModal.tsx` (the exact URL-synced overlay precedent for D-10).

**URL-synced overlay pattern** (`ScorecardModal.tsx` lines 19-28):
```tsx
export function ScorecardModal({ title, children }: ScorecardModalProps) {
  const router = useRouter();
  return (
    <Dialog open onOpenChange={(open) => { if (!open) router.back(); }}>
      <DialogContent aria-describedby={undefined} className="...">
```

**Conventions to replicate:**
- Open state = `useSearchParams().get("card") !== null`; `onOpenChange(false)` → `router.back()` or `router.replace` stripping `?card` (07-RESEARCH.md line 236). Deep-linkable, back-button-closable, reload-safe.
- **Use the new `Sheet` (not `Dialog`)** for the slide-in drawer (D-10) — same radix-ui base, side="right". `transform: translateX(100%) → 0` is the design-skill `.drawer` (inbox-triage-layout.md lines 65-69); `tw-animate-css` drives the slide.
- **Hydrate card detail from a server-passed serializable `Map<id, cardViewModel>`** — never import the server-only engine on the client (07-RESEARCH.md line 236).
- **Drawer body switches on action type and embeds the VERBATIM leaves** (D-12): `<EnqueuePreview {...props} />` (fee) / `<CommandExport block={...} blockId={...} />` (close/rebalance) / pending runbook. No new action components — see `InsightCardRow.tsx` lines 168-179 for the exact mount conditions.
- **Drawer is NOT routed through `@modal`** and `?card` is a search param, not a path segment — leave `@modal/inbox/page.tsx`'s `null` guard untouched (D-11; Pitfall 3).

**Sparkline inside the drawer** (D-13) — copy the console `seriesFor()` map (`[tab]/page.tsx` lines 246-251):
```tsx
const seriesFor = (key: DimensionKey): TrendPoint[] | null => {
  if (key === "routing") return forwardsSeries;
  if (key === "revenue") return revenueSeries;   // forwardsSeries remapped to feesSat
  if (key === "forceClose") return closesSeries;
  return null;                                     // latest-state dims → no series
};
```
`Sparkline` returns `null` for `<2` points (`Sparkline.tsx` line 25), so the honest "no trend data" label is the fallback — render the label when `series` is null/empty, never a fabricated line.

---

### `src/components/insight/BatchConfirmDialog.tsx` (client) — NEW

**Analog:** `EnqueuePreview.tsx` confirm/submitting/error flow + `dialog.tsx` primitive.

**Confirm-as-write-act pattern** (`EnqueuePreview.tsx` lines 138-168, 231-259):
```tsx
async function handleConfirm() {
  if (!window.confirm("Sign and queue this fee update? ...")) return;
  setPhase("submitting"); setErrorText(null);
  // params ONLY — the client NEVER supplies a signature; the server signs.
  const result = await enqueueCommand({ pubkey: props.pubkey, params: parsed.data });
  if (result.ok) setPhase("queued"); else { setPhase("error"); setErrorText(result.error); }
}
```

**Conventions to replicate:**
- **Aggregate-scope confirm BEFORE firing** (D-06): "N intents → M nodes, ppm range X–Y, all engine-suggested, expires +24h." **No per-card param editing in bulk** — engine `suggestedPpm`/`baseFeeMsat`/`timeLockDelta` sent verbatim from `card.suggestedAction.params`. No editable `<input>` in the bulk dialog (Pitfall 4).
- **Surface `card.rateLimitGuidance` advisory** in the confirm but still enqueue all (D-08) — the guidance string is already on the card; render as text.
- Call `enqueueBatch(rows)`; render the `{ results, queued, skipped }` tally inline — **each skipped row's `error` verbatim, grouped by node** (D-07). All tally text as text nodes (V5).
- `submitting` phase disables the confirm button (single in-flight submit). Use AFM-002 `formatSats`/`toLocaleString` for every numeric in the scope summary (no inline math).
- Use the vendored `dialog.tsx` (modal confirm) — `DialogContent`/`DialogTitle`/`DialogFooter` (the dialog is fine here; the slide-in drawer is the `Sheet`).

---

### `src/components/ui/sheet.tsx` (vendored primitive) — NEW via CLI

**Analog:** `src/components/ui/dialog.tsx` (same radix-ui Dialog base, unified import style).

**Import-style to verify** (`dialog.tsx` lines 1-7):
```tsx
"use client"
import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"   // UNIFIED package — not @radix-ui/react-dialog
import { XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
```

**Conventions to verify on the generated file:**
- Run `npx shadcn@latest add sheet` (NOT `@canary` — v4+React19 GA; 07-RESEARCH.md line 68). Zero new npm dependency expected (`radix-ui@^1.5.0` already provides `Dialog`, which `Sheet` is built on).
- **Eyeball the generated imports** (07-RESEARCH.md line 81, A1): must import ONLY from `radix-ui`, `lucide-react`, `@/lib/utils` (+ `cva`). If the registry emits `@radix-ui/react-dialog`, that's a trivial one-line install — match the unified-package precedent in `dialog.tsx`/`checkbox.tsx`/`tooltip.tsx`.
- Commit the generated file (Runtime State Inventory line 270).

---

## Shared Patterns

### Server-computes / thin-client-leaf split (the repo law)
**Source:** `src/components/insight/InsightCardRow.tsx` lines 84-89, 146-179; `src/components/queue/EnqueuePreview.tsx` lines 17-19.
**Apply to:** every new component — `SeveritySpine`/`InfoGroups`/`SuppressedBlock`/`FacetRail` are **server**; `InboxTriage`/`DetailDrawer`/`BatchConfirmDialog` are **client** owning only interaction state.
```tsx
const enqueue = resolveEnqueueAffordance(card);   // server-only backend gate
{enqueue.kind === "lnd" && <EnqueuePreview {...enqueue.props} />}  // client leaf, serializable props only
```

### Server-only signing, client never sends a signature
**Source:** `src/lib/queue/enqueue.ts` lines 36-49; `src/app/actions/queue.ts` lines 11-21.
**Apply to:** `enqueueBatch` + `BatchConfirmDialog`. UI sends `{pubkey, params}[]`; server recomputes `command_id`/`expires_at`/canonical payload/signature per row (CLAUDE.md §5). No `signature`/`canonicalPayload` field crosses the action boundary (Pitfall 4 / Security V6).

### AFM-002 numeric formatting (mandatory)
**Source:** `src/lib/format/units.ts` (`formatSats`, `feeMsatToSat`, `formatBtc`).
**Apply to:** every ppm/sat/msat value in groups, drawer, and confirm dialog. No inline `/1e8`, `*1000`, or raw `fee`. See `InsightCardRow.tsx` `formatValue`/`formatParamValue` (lines 52-65) and `EnqueuePreview.tsx` line 227 (`formatSats(feeMsatToSat(baseMsat))`) for the in-component pattern.

### Honest visible states (text nodes only)
**Source:** `InsightCardRow.tsx` lines 137-143 (suppression verbatim); `CommandExport.tsx` lines 31-39 (honest clipboard fail); `Sparkline.tsx` line 25 (null for `<2` points).
**Apply to:** suppressed reasons, batch failure-tally reasons, "no trend data" fallback. Everything renders as a React text node — no `dangerouslySetInnerHTML`, no markdown sink (V5).

### Lazy server-only import inside the action
**Source:** `src/app/actions/queue.ts` lines 80-82; `src/lib/queue/enqueue.ts` line 51; `src/lib/console/trends.ts` lines 99-100.
**Apply to:** `enqueueBatch` (`await import("@/lib/queue/enqueue")` inside the loop) and any series read — keeps the signer/DB pool out of pure callers' import graphs.

### Whitelist-parse search params
**Source:** `src/app/actions/queue.ts` line 24 (`PUBKEY_RE`); reused at the console page / `buildDeepLink`.
**Apply to:** `triage-facets.ts` parsing `?sev`/`?node`/`?signal`/`?action`/`?card` — invalid → ignored, not an error (Security V5; Pitfall 3).

---

## No Analog Found

None. Every new file maps to a same-repo analog. The only genuinely-new surface area is **UI composition** (the spine/rail/drawer shell) and **the batch-tally contract** — both built from existing primitives. The two truly-new client states are the multi-select `Set` and the URL-synced drawer (both have precedents: `EnqueuePreview` state ownership and `ScorecardModal` URL-sync respectively).

---

## Metadata

**Analog search scope:** `src/components/insight/`, `src/components/queue/`, `src/components/export/`, `src/components/scorecard/`, `src/components/console/`, `src/components/ui/`, `src/app/(overview)/inbox/`, `src/app/(overview)/[pubkey]/[tab]/`, `src/app/actions/`, `src/lib/queue/`, `src/lib/console/`, `src/lib/format/`, `src/lib/insight/`, `.claude/skills/sketch-findings-nodemonitor/references/`
**Files read this session:** 14 (CONTEXT, RESEARCH, InsightCardList, InsightCardRow, inbox/page, queue.ts action, enqueue.ts, EnqueuePreview, dialog.tsx, ScorecardModal, trends.ts, Sparkline, console [tab]/page seriesFor block, units.ts, enqueue-props, CommandExport, bounds.ts, inbox-triage-layout.md skill, @modal/inbox guard)
**Pattern extraction date:** 2026-06-16
</content>
</invoke>
