# Phase 10: Design-System Foundation - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 18 new/modified
**Analogs found:** 16 / 18 (2 net-new: EvidenceChart/StaleChart on Recharts — no in-repo chart-lib analog)

> Built on `10-RESEARCH.md` §"Primitive Inventory" (which already maps each primitive → prototype file:line → target path → units.ts dep). This doc supplies the **concrete in-repo code excerpts** the executor copies from. Where research named an analog, the exact excerpt is below.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/globals.css` (append `@theme` df-block + keyframes) | config (tokens) | transform (build-time CSS) | existing `@theme` block in same file (lines 6-40) | exact |
| `src/app/layout.tsx` (add IBM Plex Sans/Mono) | config (font wiring) | request-response (RSC root) | same file, current next/font wiring (lines 1-23, 42) | exact |
| `src/lib/df/tokens.ts` | utility (TS hex mirror) | transform | `src/lib/format/units.ts` (named-export const module) | role-match |
| `src/components/df/Severity.ts` | utility (CVA variant map) | transform | `src/components/ui/badge.tsx` cva config (lines 7-28) | role-match |
| `src/components/df/SeverityCard.tsx` | component | request-response (Server, presentational) | `src/components/scorecard/DimensionRow.tsx` (tile + severity tint) | role-match |
| `src/components/df/SeverityRow.tsx` | component | request-response (Server) | `src/components/insight/SeveritySpine.tsx` (SpineRow) | exact |
| `src/components/df/TwoAxisPip.tsx` | component | request-response (Server) | `src/components/scorecard/DimensionRow.tsx` + `CriticalChip.tsx` | role-match |
| `src/components/df/FreshnessChip.tsx` | component | request-response (Server) | `src/components/scorecard/FreshnessStamp.tsx` | exact |
| `src/components/df/ImplTag.tsx` | component | request-response (Server) | `src/components/scorecard/BackendBadge.tsx` | exact |
| `src/components/df/AiReadPanel.tsx` | component | request-response (Server, advisory) | `src/components/insight/NarrateButton.tsx` (LLM-output panel) | role-match |
| `src/components/df/NavRailShell.tsx` | component | request-response (Server shell) | `src/components/chrome/MastheadNav.tsx` + `(overview)/layout.tsx` | role-match |
| `src/components/df/EvidenceChart.tsx` | component | streaming/transform (client, Recharts SVG) | `src/components/console/Sparkline.tsx` (bespoke SVG — grammar only) | partial (no Recharts analog) |
| `src/components/df/StaleChart.tsx` | component | request-response (client/server SVG placeholder) | `src/components/console/Sparkline.tsx` (early-return null pattern) | partial |
| `src/components/df/CommandModal.tsx` | component | event-driven (client, open/close + clipboard) | `src/components/queue/EnqueuePreview.tsx` + `src/components/ui/dialog.tsx` | role-match |
| `src/app/(design)/layout.tsx` | route (RSC shell) | request-response | `src/app/(overview)/layout.tsx` | role-match |
| `src/app/(design)/design-system/page.tsx` | route (RSC gallery) | request-response (static fixtures) | `src/app/(overview)/page.tsx` (RSC) | role-match |
| `package.json` (`lint:noc-guard` script) | config (CI guard) | batch (static analysis) | existing `scripts` block | exact |
| `src/lib/df/*.test.ts`, `src/components/df/*.test.tsx` | test | batch | `src/components/insight/insight-cards.test.ts` + `vitest.config.ts` | role-match |

---

## Pattern Assignments

### `src/app/globals.css` — append df-token `@theme` block (config, transform)

**Analog:** the existing `@theme` block in the SAME file (lines 6-40). The df-block lands **additively below it**; do NOT edit the NOC block (D-05).

**Existing convention to mirror** (`globals.css` lines 6-40) — CSS-first `@theme`, `--color-*` / `--font-*` custom props, `var(--font-...)` indirection for fonts:
```css
@theme {
  --color-brand: #1A3C79;
  --color-status-ok: #0B8A51;
  --color-status-ok-dim: rgba(11, 138, 81, 0.08);
  /* ...severity ramp... */
  --font-sans: var(--font-inter), system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, monospace;
  --font-display: var(--font-saira), var(--font-inter), sans-serif;
}
```
**Action:** append a second `@theme { --color-df-* ... }` block exactly as spec'd in RESEARCH Pattern 1 (lines 170-219). Note the file ALREADY imports `tw-animate-css` (line 2) and already uses `@layer components` (lines 254-376, the inbox `.sectionbar`/`.act`/`.facet` grammar) — the prototype's bespoke `v2pulse`/`v2drop` keyframes go in a NEW `@layer components` block following that exact precedent, NOT inline. Radius precedent: current NOC uses tight 3/6/10px (lines 196-203, comment "instruments, not bubbles"); df overrides to 6/9/14/18 in its own `--radius-df-*` namespace.

**Forbidden:** touching `:root` (lines 206-242) or the NOC `@theme` (lines 6-40).

---

### `src/app/layout.tsx` — add IBM Plex Sans/Mono (config, RSC root)

**Analog:** the SAME file. IBM Plex Mono is **already wired** (lines 14-18) — copy that exact shape for IBM Plex Sans, and add `weight` to the mono call.

**Current wiring** (lines 1-23):
```tsx
import { IBM_Plex_Mono, Inter, Saira_Semi_Condensed } from "next/font/google";

const saira = Saira_Semi_Condensed({ weight: ["600", "700"], variable: "--font-saira", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ weight: ["400", "600"], variable: "--font-plex-mono", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
```
**Current html application** (line 42):
```tsx
<html lang="en" className={`${saira.variable} ${plexMono.variable} ${inter.variable}`}>
```
**Action (additive — Pitfall 4):** add `IBM_Plex_Sans` import + a `plexSans` instance with `variable: "--font-plex-sans"`; append `${plexSans.variable}` to the html className. KEEP saira/inter/plexMono (v1 screens still reference `--font-saira`/`--font-inter`/`--font-display`). The new `--font-df-sans` token (in globals.css) points at `--font-plex-sans`; `--font-sans` STAYS on Inter.

---

### `src/lib/df/tokens.ts` — SSR-safe hex mirror (utility, transform)

**Analog:** `src/lib/format/units.ts` (lines 1-20) — the established named-export const-module shape with a top-of-file "single source of truth" doc-comment.

**Excerpt to mirror** (`units.ts` lines 1-10):
```ts
// AFM-002 single source of truth for all sat / BTC / msat math.
const SATS_PER_BTC = 100_000_000;
const MSAT_PER_SAT = 1_000;

export function feeMsatToSat(msat: bigint | number): number {
  return Number(msat) / MSAT_PER_SAT;
}
```
**Action:** export typed hex constants (e.g. `export const DF = { critical: "#E0392B", ok: "#1E9E63", okText: "#1E7A4E", slate: "#9AA3B4", ... } as const;`) mirroring every `--color-df-*` value in globals.css. RESEARCH §Validation requires a **parity test** (`tokens.test.ts`) asserting CSS↔TS match — keep the keys 1:1 with the CSS var names. Recharts consumers (`EvidenceChart`) import literal hex from here (CSS vars don't reach SVG attrs SSR-safely — RESEARCH Pitfall, anti-pattern "getComputedStyle").

---

### `src/components/df/Severity.ts` — CVA variant map (utility, transform)

**Analog:** `src/components/ui/badge.tsx` (lines 7-28) — the vendored CVA config pattern (the only in-repo CVA examples are `button.tsx`, `badge.tsx`, `checkbox.tsx`).

**Excerpt to mirror** (`badge.tsx` lines 7-28):
```tsx
import { cva, type VariantProps } from "class-variance-authority"

const badgeVariants = cva(
  "group/badge inline-flex ... border ...",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground ...",
        destructive: "bg-destructive/10 text-destructive ...",
        outline: "border-border text-foreground ...",
      },
    },
    defaultVariants: { variant: "default" },
  }
)
export { Badge, badgeVariants }
```
**Action:** one `severityVariants = cva(base, { variants: { sev: { critical, warning, watch, healthy, stale } } })` keyed to df tokens (`bg-df-critical-tint border-df-critical-border` etc.). This is the SINGLE source for the ramp consumed by Card/Row/Pip/Chip (RESEARCH Pattern 3, anti-pattern "if (sev===...) chains"). Export `type Severity = VariantProps<...>` for the primitives' prop interfaces.

---

### `src/components/df/SeverityCard.tsx` + `SeverityRow.tsx` (component, Server)

**Analog (card):** `src/components/scorecard/DimensionRow.tsx` (lines 86-144) — the tile shape, `cn()` merge, severity-tinted slots, "renders numerics via children/pre-formatted props (NO unit math)".
**Analog (row):** `src/components/insight/SeveritySpine.tsx` `SpineRow` (lines 62-119) — the exact row grammar (severity label + identity + evidence line + `open →` affordance) the prototype queue rows reproduce.

**Card tile excerpt to mirror** (`DimensionRow.tsx` lines 87-94):
```tsx
const tile = (
  <div className={cn(
    "flex min-h-[5.5rem] flex-col justify-between gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-foreground/20",
    linked && "group-hover:border-brand-light/60 ...",
  )}>
```
**Row excerpt to mirror** (`SeveritySpine.tsx` lines 78-116): the two-line layout — severity-tinted mono label (`SEVERITY_TEXT[card.severity]`), node identity with `<BackendBadge>`, `ms-auto ... open →`, then an evidence `<p>` running values through `formatValue` (which calls `formatSats`). The v2 versions ADD an accent bar + icon (D-06) and use `severityVariants` from `Severity.ts` instead of the v1 `SEVERITY_TEXT` map.

**Notes:** v1 uses 3px border / no accent-bar / no icon; v2 grammar (RESEARCH Primitive Inventory) is `width:6-7px` accent bar + tint + `box-shadow` per severity + icon. Severity color is STATE-only; navy is never a card accent (anti-pattern).

---

### `src/components/df/TwoAxisPip.tsx` (component, Server)

**Analog:** `src/components/scorecard/DimensionRow.tsx` STATE-machine pattern (lines 58-81, strict precedence + early-return for nodata) and `CriticalChip.tsx` (whole file — mono uppercase state word).

**Excerpt — early-return state grammar** (`DimensionRow.tsx` lines 69-81):
```tsx
if (dimension.color === "nodata") {
  return (
    <div className="flex min-h-[5.5rem] flex-col ... border-dashed border-border bg-card/40 p-3.5">
      <span className="font-mono text-xs font-semibold tracking-[0.14em] text-foreground/35 uppercase">{name}</span>
      ...
```
**Notes:** prototype logic = "green ONLY when BOTH running AND functioning" (Node Detail lines 556-573). Model running × functioning as two glyphs (check/cross via lucide — D-06 allows icons); compute the combined color with the same strict-precedence early-return style as DimensionRow. Renders error counts / heartbeat ages → any numeric through units.ts if sat/fee-valued (here mostly counts/ages, plain `toLocaleString`).

---

### `src/components/df/FreshnessChip.tsx` (component, Server)

**Analog:** `src/components/scorecard/FreshnessStamp.tsx` (whole file, lines 1-77) — fresh vs stale branching, `Intl.DateTimeFormat` (dates only, NO sat math), tooltip-wrapped breakdown.

**Excerpt to mirror** (`FreshnessStamp.tsx` lines 35-48):
```tsx
export function FreshnessStamp({ asOf, stale, breakdown }: FreshnessStampProps) {
  if (asOf === null) {
    return <span className="font-mono text-xs text-foreground/40">no data yet</span>;
  }
  const stamp = stale ? (
    <span className="font-mono text-xs font-semibold tabular-nums text-status-stale">
      STALE — data as of {formatDate(asOf)}
    </span>
  ) : (
    <span className="font-mono text-xs tabular-nums text-foreground/55">data as of {formatDate(asOf)}</span>
  );
```
**Notes (DS-01 honest-stale, RESEARCH Pitfall 3 + anti-pattern):** v1 is mono text with NO glyph (old no-icons rule). v2 stale MUST be SHAPE-distinct: square dot (radius 2px) + dashed border + `--color-df-stale-text` (#A9912F) + icon (D-06). Never a green dot for stale. The `asOf === null` → "no data yet" early-return is the honest no-data precedent — keep it. Tooltip provider reuse: `@/components/ui/tooltip` (lines 1-6 imports).

---

### `src/components/df/ImplTag.tsx` (component, Server)

**Analog:** `src/components/scorecard/BackendBadge.tsx` (whole file, lines 1-23) — near-identical primitive.

**Excerpt to mirror** (`BackendBadge.tsx` lines 12-23):
```tsx
export function BackendBadge({ backend }: BackendBadgeProps) {
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 font-mono text-xs leading-none font-semibold tracking-[0.14em] text-white uppercase",
      backend === "lnd" ? "bg-brand" : "bg-brand-light"
    )}>
      {backend === "lnd" ? "LND" : "LDK"}
    </span>
  );
}
```
**Notes:** v1 paints the tag in BRAND navy (`bg-brand`/`bg-brand-light`) — v2 must NOT (severity/chrome split). Use df impl-tag tokens: LND `#33559B` on `#EAEFF8`, LDK `#7A4FA3` on `#F1EAF8` (RESEARCH Standard Stack; LDK hex is `[ASSUMED]` A2 — flag for verify). Otherwise structure is identical.

---

### `src/components/df/AiReadPanel.tsx` (component, Server)

**Analog:** `src/components/insight/NarrateButton.tsx` (lines 54-66) — the LLM-output panel with the explicit "narrative only, not a recommendation source" guard label.

**Excerpt to mirror** (`NarrateButton.tsx` lines 55-66):
```tsx
<section className="mt-3 rounded-md border border-border bg-card">
  <div className="border-b border-border px-4 py-2.5">
    <span className="font-mono text-xs font-semibold tracking-[0.14em] text-foreground/60 uppercase">
      LLM OUTPUT — narrative only, not a recommendation source
    </span>
  </div>
  <p className="px-4 py-3 font-mono text-xs whitespace-pre-wrap text-foreground/80">{error ?? text}</p>
</section>
```
**Notes (RESEARCH Security — Spoofing mitigation):** keep the prototype's verbatim "AI · explains & ranks, never runs commands" / "NodeMonitor runs nothing for you" zero-credential safety label baked in. v2 panel sits on navy `--color-df-chrome` (#13284F) per prototype (94-124). Advisory text is PLAIN TEXT only — `whitespace-pre-wrap`, never `dangerouslySetInnerHTML`. AiReadPanel is presentational (Server) — unlike NarrateButton it does NOT call the action; it just renders the navy band.

---

### `src/components/df/NavRailShell.tsx` (component, Server shell)

**Analog:** `src/components/chrome/MastheadNav.tsx` (lines 26-50) for the active-link grammar, and `src/app/(overview)/layout.tsx` (lines 21-43) for the chrome-header + max-w container shell.

**Active-nav excerpt to mirror** (`MastheadNav.tsx` lines 38-44):
```tsx
className={cn(
  "-mb-px border-b-2 pb-1 font-mono text-xs font-semibold tracking-[0.16em] uppercase transition-colors",
  active ? "border-brand text-foreground" : "border-transparent text-foreground/45 hover:text-foreground",
)}
```
**Shell excerpt to mirror** (`(overview)/layout.tsx` lines 22-36): `border-b border-border bg-card` header, LQWD wordmark chip (`bg-brand px-2 py-1 font-mono ... tracking-[0.18em]`), `mx-auto max-w-6xl px-6` container, `ms-auto ... routing_vm` poll-context slot.
**Notes:** prototype is a 60px navy LEFT rail (`--color-df-chrome`) + sticky top bar (39-88), not a top masthead — adapt the active-link `cn()` grammar to a vertical rail. `usePathname` makes MastheadNav a `"use client"` leaf (line 1); NavRailShell can stay Server if it takes the active key as a prop, or be a thin client leaf for `usePathname` like MastheadNav.

---

### `src/components/df/EvidenceChart.tsx` + `StaleChart.tsx` (component, client/Recharts) — NET-NEW

**Closest analog:** `src/components/console/Sparkline.tsx` — bespoke inline SVG. Use for the **min/max normalize + flat-series midline + `<2 points` early-return** logic and the "numeric props through React escaping" discipline; the actual rendering is Recharts (no Recharts analog in repo — it is NOT installed; `npm install recharts@3.9.0`, gated by `checkpoint:human-verify` per A1).

**Excerpt — normalize + guard to reuse** (`Sparkline.tsx` lines 23-44):
```tsx
export function Sparkline({ points, width = 160, height = 40 }: SparklineProps) {
  if (points.length < 2) return null;          // <- guard pattern
  const values = points.map((p) => p.n);
  const min = Math.min(...values); const max = Math.max(...values); const span = max - min;
  // ... y = span === 0 ? height/2 : INSET_Y + innerHeight - ((point.n - min)/span)*innerHeight
```
**Build per RESEARCH Pattern 2** (lines 226-248): `"use client"`, import Recharts + `DF` from `@/lib/df/tokens`, fixed wrapper height (`h-[104px]` hero / `h-[58px]` inline — Pitfall 1 SSR zero-size), grammar = peer-median `ReferenceArea` band + dashed `ReferenceLine` threshold + `Area` fill (`accent+'1f'`) + 2px `Line` + dashed projection + last-dot. `StaleChart` = hatched `#F7F2E4` "NO FRESH DATA" placeholder (prototype `staleChart()` 519-531) — EvidenceChart falls back to it when `stale` (DS-01). Any sat/fee axis label → units.ts.

---

### `src/components/df/CommandModal.tsx` (component, client) — event-driven

**Analog:** `src/components/queue/EnqueuePreview.tsx` (whole file) for the `"use client"` + `useState` open/phase grammar and the inert mono `PreviewRow` key/value layout; `src/components/ui/dialog.tsx` for the Radix Dialog wrapper to reuse (RESEARCH "Don't Hand-Roll" — do NOT build a custom overlay).

**Excerpt — client state + inert preview row** (`EnqueuePreview.tsx` lines 70-77, 126-129):
```tsx
function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 font-mono text-xs">
      <span className="text-foreground/45">{label}</span>
      <span className="tabular-nums text-foreground/60">{children}</span>
    </div>
  );
}
// ...
const [open, setOpen] = useState(false);
```
**Dialog reuse** (`dialog.tsx` exports, lines 127-138): `Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose`. `DialogContent` already does focus-trap/scroll-lock/ESC (lines 47-79).
**Notes (RESEARCH Security V14):** command strings render as INERT text — `<code>` / `white-space:pre`, React-escaped, NEVER `dangerouslySetInnerHTML`, never executed (the modal COPIES, never runs — clipboard via `navigator.clipboard.writeText`). Navy code block (`--color-df-chrome`) per prototype modal (419-463). Command strings are verbatim (no units.ts transform).

---

### `src/app/(design)/layout.tsx` + `design-system/page.tsx` (route, RSC)

**Analog:** `src/app/(overview)/layout.tsx` (lines 14-43) for the route-group layout shape; `src/app/(overview)/page.tsx` is the RSC-page precedent.

**Layout excerpt to mirror** (`(overview)/layout.tsx` lines 14-22):
```tsx
export default function OverviewLayout({ children, modal }: Readonly<{ children: ReactNode; modal: ReactNode }>) {
  return (
    <div className="relative min-h-screen">
```
**Notes (RESEARCH "Recommended Project Structure" + Alternatives):** use a `(design)` route group so the gallery does NOT inherit `(overview)`'s masthead + `@modal` parallel-route slot. The `(design)` layout is MINIMAL (no `modal` prop). `page.tsx` is a pure RSC rendering every primitive × every state (default/critical/warning/watch/healthy/stale/loading) from STATIC fixtures — no DB, no fetch (RESEARCH data-flow). Client primitives (EvidenceChart/CommandModal) are client islands inside the RSC page.

---

### `package.json` — `lint:noc-guard` script (config, CI)

**Analog:** existing `scripts` block (current `"lint": "eslint"`, `"test": "vitest run"`, `"test:format": "vitest run src/lib/format"`).

**Action (RESEARCH Code Examples + DS-03):** add the `lint:noc-guard` grep script scoped to `src/components/df` + `src/app/(design)` (verbatim from RESEARCH lines 350-353), leading `!` so it EXITS 0 when grep finds nothing. Optionally chain into `lint` (`"lint": "eslint && npm run lint:noc-guard"`) following the `test:format` sub-script precedent. The forbidden token list is in RESEARCH line 356.

---

### `src/lib/df/*.test.ts` + `src/components/df/*.test.tsx` (test)

**Analog:** `src/components/insight/insight-cards.test.ts` (existing test) + `vitest.config.ts` (lines 7-22).

**Notes:** `vitest.config.ts` currently sets `environment: "node"` and `include: ["src/**/*.test.ts"]` (NOT `.tsx`) with the comment "Phase 1 has no component rendering". RESEARCH §"Wave 0 Gaps" — to add component render tests the executor must EITHER add jsdom + `@testing-library/react` (new devDeps → slopcheck) OR use `renderToStaticMarkup` from `react-dom/server` (no new deps, lower-tooling — RESEARCH's recommended path). The `@/` + `server-only` aliases (lines 10-16) carry over. Pure-function tests (`tokens.ts` parity, contrast ratios) stay `node`-env like `units.test.ts`.

---

## Shared Patterns

### `cn()` className merge
**Source:** `src/lib/utils.ts` (lines 5-7)
**Apply to:** every df primitive (all merge `severityVariants(...)` + caller `className`).
```ts
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

### Named exports + doc-commented prop interface
**Source:** every analog (e.g. `FreshnessStamp.tsx` lines 9-14, `BackendBadge.tsx` lines 3-5)
**Apply to:** all df components — `export function Name(props)`, NO default export (workspace convention), `interface NameProps` with per-field doc comments. Components default to Server (no `"use client"`) unless they need state/clipboard/`usePathname` (EvidenceChart, CommandModal, possibly NavRailShell).
```tsx
interface FreshnessStampProps {
  /** Worst-case oldest timestamp across the node's source tables (D-13). */
  asOf: Date | null;
  stale: boolean;
}
export function FreshnessStamp({ asOf, stale }: FreshnessStampProps) { ... }
```

### Numeric formatting — AFM-002 only
**Source:** `src/lib/format/units.ts` (`feeMsatToSat`, `formatBtc`, `formatSats`)
**Apply to:** every numeric-bearing primitive (EvidenceChart axis labels, any sat/fee in SeverityCard/Row children). NO inline `/1e8` / `*1000`. Render usage precedent — `EnqueuePreview.tsx` line 227: `{formatSats(feeMsatToSat(baseMsat))}`; `SeveritySpine.tsx` lines 33-38 `formatValue` wrapping `formatSats`. Always pair with `tabular-nums`.

### Severity color = STATE only; navy = chrome/brand only (DS-01 AC)
**Source:** repeated invariant — `BackendBadge.tsx` line 7-11 comment, `MastheadNav.tsx` lines 8-13, `Sparkline.tsx` lines 8-10, `globals.css` lines 7-9.
**Apply to:** all df primitives. Never paint a card accent/dot with `--color-df-chrome`/`--color-df-brand`; never paint chrome with a severity hue. Text roles use `-text` variants (`--color-df-ok-text`) for AA 4.5:1; dots/accents use the bright hue (3:1) — RESEARCH Pitfall 2.

### Inert LLM/command text — no HTML sink
**Source:** `NarrateButton.tsx` line 62 (`whitespace-pre-wrap`, plain text); `dialog.tsx` (Radix focus/scroll/ESC already solved)
**Apply to:** AiReadPanel + CommandModal — `<code>`/`whitespace-pre`, React-escaped, never `dangerouslySetInnerHTML`, never execute. Reuse `@/components/ui/dialog` — do not hand-roll an overlay.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/components/df/EvidenceChart.tsx` | component | streaming/transform (Recharts) | No chart library in repo — `Sparkline.tsx` is bespoke SVG and intentionally avoided Recharts (T-03-SC). Recharts (3.9.0) must be installed; use RESEARCH Pattern 2 as the build spec, prototype `chart()` 472-517 as the visual spec. |
| `src/components/df/StaleChart.tsx` | component | request-response (SVG placeholder) | Net-new — v1 hides stale charts entirely. Only the `Sparkline` `<2 points → null` guard discipline transfers; the hatched "NO FRESH DATA" treatment is from prototype `staleChart()` 519-531. |

> Blast-radius diagram (prototype `blastRadius()` 533-558) is explicitly DEFERRED to Phase 12/15 — NOT a Phase-10 foundation primitive (RESEARCH A4). No file this phase.

---

## Metadata

**Analog search scope:** `src/components/{scorecard,insight,queue,console,chrome,ui}`, `src/app/(overview)`, `src/lib/{format,utils,df}`, `src/app/{globals.css,layout.tsx}`, `package.json`, `vitest.config.ts`
**Files scanned:** 18 analog files read in full
**Key confirmations:** Recharts NOT in `package.json` (must install); CVA examples only in vendored `ui/{button,badge,checkbox}`; route-group `(overview)` is the only group precedent; `vitest.config.ts` is `node`-env, `.test.ts`-only (component tests need a config change).
**Pattern extraction date:** 2026-06-23
