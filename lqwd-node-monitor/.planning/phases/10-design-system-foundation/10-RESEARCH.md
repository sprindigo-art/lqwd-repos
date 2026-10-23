# Phase 10: Design-System Foundation - Research

**Researched:** 2026-06-23
**Domain:** Design tokens + shared React/Tailwind-v4 primitive library + in-app gallery route (Next App Router)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Source-of-truth is the claude.ai/design project **"LQWD Fleet Alert Dashboard"** (`372850ad-bbae-46da-a40f-3eb3d03befa0`). The prototypes have been mirrored to disk at `.planning/phases/10-design-system-foundation/.prototype-snapshot/` — no manual drop-folder workflow.
- **D-02:** Canonical direction is **"Data-Forward"**, specifically **`Ops Center - Data-Forward v2.dc.html`** (canonical token + grammar source) plus the per-screen prototypes and shared `support.js`. `Editorial` and `Triage Board` directions are NOT used.
- **D-03:** Canonical token VALUES are **extracted from the Data-Forward v2 prototype** (read off the file, not hand-picked). The prototype is the tiebreaker resolving the roadmap's drift list. Severity ramp (critical/warning/watch=teal/healthy) stays structurally separate from brand navy; light-only; navy `#1A3C79` anchor; never Bitcoin orange.
- **D-04:** DS-02 ships the primitive gallery as an **in-app Next App Router route** (`/design-system` or similar) rendering every primitive in all states (default/critical/warning/watch/healthy/stale/loading) using the REAL components + tokens. **No Storybook, no new tooling.**
- **D-05:** **Additive now, retire per-screen.** Phase 10 adds new canonical tokens + primitives + gallery ALONGSIDE existing NOC tokens; v1 screens (overview/console/inbox) keep working on NOC until rebuilt (Phases 12–15). The DS-03 grep guard is **scoped to NEW v2 surfaces only**. The NOC token set is DELETED only when the last v1 screen is replaced. Do NOT hard-cut the token layer in Phase 10.
- **D-06:** The bold-rethink direction **reverses the old NOC "no icons-for-state" rule** — modern severity/layer/action icons are now allowed. Supersedes the `sketch-findings-nodemonitor` NOC findings for all v2 work.

### Claude's Discretion
- Exact token file structure (CSS `@theme` variables in `globals.css` vs a dedicated tokens file), naming scheme, and the gallery route's internal layout — follow the extracted prototype + existing Tailwind-v4 `@theme` convention.

### Deferred Ideas (OUT OF SCOPE)
- `node-detail-all-channels-fee-queue` → **Phase 13**. `one-click-enqueue-approve` → **Phase 13**. `ui-polish-fleet-console` → **Phase 12**. `pin-lncli-cron-path-hardening`, `exercise-inbound-fee-a2-lnd8614` → Phase-8 follow-ups. None folded into Phase 10. **Phase 10 builds foundation only: tokens + primitives + gallery. It does NOT build v2 screens (12–15) and does NOT touch the backend.**
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DS-01 | Data-Forward token foundation: all tokens (color, type scale, spacing, radius, shadow), IBM Plex Sans/Mono pairing, canonical severity ramp (critical/warning/watch=teal/healthy) structurally separate from brand navy; light-only. AC: one canonical set resolving the drift (chrome `#13284F` vs brand `#1A3C79`; ok-green `#1E9E63` vs `#1E7A4E`; critical `#E0392B` vs `#D92638`); no severity hue reused as chrome. | §"Standard Stack" token table (all values read off the byte-perfect prototype); §"State of the Art" drift-resolution table; AA-contrast findings in §"Validation Architecture" justify the role-split (`#1E9E63` dot vs `#1E7A4E` text). |
| DS-02 | Shared primitives extracted from prototypes — severity-tinted card/row, inline evidence chart (Recharts), two-axis status pip, freshness chip, runbook/command modal, AI-read panel, nav rail/shell — reused across every v2 screen; proven by a gallery route. | §"Primitive Inventory" maps each primitive → exact prototype markup (file:line) → closest v1 analog → target `src/components/` path → units.ts dependency. §"Architecture Patterns" gives the Server/Client split + the gallery structure. |
| DS-03 | NOC-instrument look retired — prior mono-instrument tokens/components superseded; exactly one theme ships. AC (per D-05): grep/build check asserts no prior mono-instrument token set is referenced by NEW v2 surfaces. | §"NOC Retirement Guard" defines the exact forbidden token list + the grep mechanism wired into `package.json` + the v2-surface scope glob. |
</phase_requirements>

## Summary

Phase 10 lays down a single canonical "Data-Forward" token set, a shared primitive library, and an in-app gallery — all extracted byte-faithfully from the mirrored claude.ai/design prototypes. The work is **additive**: the new tokens live alongside the existing NOC `--color-status-*` / `--color-brand-*` set in `globals.css`, the v1 screens keep rendering on NOC, and a grep guard scoped to new v2 surfaces enforces that nothing v2 reaches back to the NOC mono-instrument tokens. This is a pure front-end, code-and-config phase — no backend, no DB, no external service.

Two findings reshape the plan. **First, Recharts is not yet installed** and the prototype's inline-evidence charts are **hand-rolled inline SVG** (the `chart()`/`staleChart()`/`blastRadius()` methods in `support.js`/the prototype `<script>`), not Recharts. DS-02 explicitly requires Recharts, so the evidence-chart primitive must be **rebuilt on Recharts 3.x** to match the prototype's visual grammar (line + threshold dashed line + peer-median band + area fill + projection + last-dot marker) rather than ported verbatim. **Second, several prototype severity hues pass only WCAG AA-large/UI (3:1), not AA-text (4.5:1)** — and the prototype already solves this with a deliberate **role-split** (`#1E9E63` for dots/sparks/accents vs the darker `#1E7A4E` for green text/labels; `#C8A23A` square dot vs `#A9912F` stale text). The token model must encode that split, and the AA assertions in Validation Architecture must test the *text* roles against 4.5:1 and the *non-text* roles against 3:1.

**Primary recommendation:** Add a NEW namespaced token block (`@theme { --color-df-* ... }`, "df" = data-forward) in `globals.css` directly below the existing `@theme` block, leaving NOC tokens untouched; build primitives under `src/components/df/` (and a `src/lib/df/tokens.ts` for the JS-side color constants Recharts needs); ship the gallery at `src/app/(design)/design-system/` in its own route group; and wire a `lint:noc-guard` grep script into `package.json` scoped to `src/components/df/**` + `src/app/(design)/**`. Change `layout.tsx` to load IBM Plex Sans + IBM Plex Mono additively (keep Saira/Inter variables wired until v1 screens are retired).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Design tokens (color/type/spacing/radius/shadow) | CDN/Static (CSS `@theme` in `globals.css`) | — | Tailwind v4 compiles `@theme` to static CSS custom properties at build; no runtime tier. |
| JS-side color constants (for Recharts `stroke`/`fill` props) | Frontend Server (RSC-safe module) | Browser | Recharts needs literal hex in SVG attrs; a `src/lib/df/tokens.ts` mirror of the CSS tokens, importable by client chart wrappers. |
| Type pairing (IBM Plex Sans/Mono via next/font) | Frontend Server (next/font self-host at build) | — | `next/font/google` runs at build time, emits self-hosted woff2 + CSS variables; zero runtime requests. |
| Severity-tinted card/row, two-axis pip, freshness chip, AI-read panel, nav rail | Browser (presentational React; most can be Server Components) | — | Pure markup + tokens; no interactivity except hover. Default to Server Components. |
| Inline evidence chart (Recharts) | Browser (Client Component) | Frontend Server (passes serializable data) | All Recharts components require `'use client'`; fetch/shape data in a Server parent, pass plain props to a thin client wrapper. |
| Runbook/command modal | Browser (Client Component) | — | Open/close state + copy-to-clipboard need client interactivity (Radix Dialog already vendored). |
| Gallery route | Frontend Server (RSC page) hosting Client primitives | Browser | Page is a static RSC; interactive primitives are client islands inside it. |
| NOC retirement guard | Build/CI (grep script in `package.json`) | — | Pure static analysis over new-surface globs; runs in `lint`/CI, not at runtime. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.1.6 (installed) | App Router pages + RSC + the gallery route | Workspace standard; already pinned. `[VERIFIED: package.json]` |
| react / react-dom | 19.2.3 (installed) | UI runtime | Pinned; `react-dom` matches `react` exactly. `[VERIFIED: package.json]` |
| tailwindcss | ^4 (installed) | CSS-first `@theme` tokens (NO `tailwind.config.js`) | The new token block extends `globals.css` `@theme`. `[VERIFIED: package.json + globals.css]` |
| @tailwindcss/postcss | ^4 (installed) | Tailwind v4 PostCSS integration | Required v4 plugin. `[VERIFIED: package.json]` |
| recharts | **3.9.0** (NOT yet installed — must add) | Inline evidence chart primitive (DS-02) | Native React 19 peer support; v3 lists react/react-dom/react-is all permitting `^19.0.0`, so **no `react-is` override needed**. `[VERIFIED: npm view recharts version → 3.9.0; npm view recharts peerDependencies]` `[CITED: github.com/recharts/recharts 3.0 migration guide]` |
| radix-ui | ^1.5.0 (installed) | Dialog primitive backing the runbook/command modal | Already vendored (`src/components/ui/dialog.tsx`, `sheet.tsx`). Reuse, don't re-add. `[VERIFIED: package.json + src/components/ui/dialog.tsx]` |
| lucide-react | ^0.577.0 (installed) | Modern severity/layer/action icons (now ALLOWED per D-06) | shadcn default icon set; matches lqwdclaw. `[VERIFIED: package.json]` |
| tw-animate-css | ^1.4.0 (installed) | Animations under Tailwind v4 (pulse/drop keyframes) | v4-compatible; already imported in `globals.css`. NOTE: the prototype's `v2pulse`/`v2drop`/`v2flow`/`nmpulse` keyframes are bespoke — port them into `globals.css` `@layer components` rather than relying on tw-animate-css presets. `[VERIFIED: globals.css line 2]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| clsx + tailwind-merge | ^2.1.1 / ^3.6.0 (installed) | `cn()` className helper | Always — `@/lib/utils`. `[VERIFIED: package.json]` |
| class-variance-authority | ^0.7.1 (installed) | Severity-variant management for card/row/pip/chip | Use CVA to model severity (`critical`/`warning`/`watch`/`healthy`/`stale`) as a variant on each primitive. `[VERIFIED: package.json]` |
| (built-in) `src/lib/format/units.ts` | n/a | `feeMsatToSat`, `formatBtc`, `formatSats` (AFM-002) | Any primitive rendering a sat/BTC/fee numeric MUST route through this — no inline unit math. `[VERIFIED: src/lib/format/units.ts]` |
| vitest | ^4 (installed) | Test framework (`npm test` → `vitest run`) | The Validation Architecture's automated assertions (AA contrast, token presence, NOC-guard) run under vitest. `[VERIFIED: package.json]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts evidence chart | Port the prototype's hand-rolled inline SVG verbatim | The prototype IS hand-rolled SVG, so porting is lower-risk visually — but DS-02 AC explicitly names Recharts, and Recharts gives reusable axes/tooltips/responsive sizing for the later v2 screens. **Choose Recharts**; treat the prototype SVG as the visual spec to reproduce. |
| New `--color-df-*` `@theme` block in `globals.css` | A separate imported `tokens.css` file | Single file keeps Tailwind v4's `@theme` parsing simple and matches the existing convention (everything already lives in `globals.css`). A separate file adds an `@import` with no benefit. **Choose the single-file additive block.** |
| `src/lib/df/tokens.ts` JS mirror | Read CSS vars at runtime via `getComputedStyle` | Recharts needs literal values in SVG attrs at render; `getComputedStyle` is client-only, async-feeling, and breaks SSR. A typed TS constant module is SSR-safe and unit-testable (enables the AA-contrast test). **Choose the TS mirror**, kept in sync with the CSS by a presence test. |
| Gallery as `/design-system` flat route | `src/app/(design)/design-system/` route group | A route group `(design)` isolates the gallery from the `(overview)` layout (no masthead/modal slots leaking in) and gives it its own minimal layout. **Choose the route group.** |

**Installation:**
```bash
npm install recharts@3.9.0
```
(Everything else is already in `package.json`. Do NOT add Storybook or any gallery tooling — D-04.)

**Version verification (run during planning):**
```bash
npm view recharts version          # → 3.9.0 (verified 2026-06-23)
npm view recharts peerDependencies # → react/react-dom/react-is all allow ^19.0.0
```

## Package Legitimacy Audit

> One new package this phase: `recharts`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| recharts | npm | ~10 yrs (since 2015) | ~10M+/wk | github.com/recharts/recharts | not run (offline sandbox) | Approved — `[ASSUMED]` pending slopcheck |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck could not be run in this session. `recharts` is a long-established, high-download library with a real source repo, verified present on npm at 3.9.0 via `npm view`, and is the library shadcn's own `chart` block wraps — but per the package-name provenance rule it is tagged `[ASSUMED]` until the planner gates the install behind a `checkpoint:human-verify` task (or runs slopcheck). It is the only external add this phase.*

## Architecture Patterns

### System Architecture Diagram

```
                         BUILD TIME
  globals.css  ──(Tailwind v4 @theme compile)──► static CSS custom props
  layout.tsx  ──(next/font/google)──► self-hosted IBM Plex woff2 + --font vars
  src/lib/df/tokens.ts  ──(typed hex constants, SSR-safe)──┐
                                                            │
                         RUNTIME (single next start)        │
                                                            ▼
  RSC page  src/app/(design)/design-system/page.tsx
     │  (renders sample/fixture data — no DB, no backend)
     ├──► <SeverityCard sev="critical" .../>      (Server Component, tokens only)
     ├──► <TwoAxisPip running func .../>           (Server Component)
     ├──► <FreshnessChip stale asOf .../>          (Server Component)
     ├──► <AiReadPanel .../>                        (Server Component, navy chrome)
     ├──► <NavRailShell>                            (Server Component, chrome navy)
     ├──► <EvidenceChart data={...}/>   ──'use client'──► Recharts SVG (reads df/tokens.ts)
     └──► <CommandModal>                ──'use client'──► Radix Dialog + clipboard
                                                            │
                         BUILD/CI                           │
  npm run lint:noc-guard  ──grep over (design)/** + components/df/**──► fails if NOC token referenced
```

Data flow for the gallery: every primitive is fed **static fixture props** defined in the gallery (one fixture per state). No fetch, no warehouse, no `nodemon` DB. The chart primitive receives a plain serializable `series`/`threshold`/`band` object from its Server parent and renders client-side.

### Recommended Project Structure
```
src/
├── app/
│   └── (design)/                 # route group — isolates gallery from (overview) layout
│       ├── layout.tsx            # minimal shell (no masthead/@modal slot)
│       └── design-system/
│           ├── page.tsx          # RSC: imports every primitive, renders all states
│           └── sections/         # optional: one file per primitive's gallery section
├── components/
│   └── df/                       # "data-forward" v2 primitives (net-new namespace)
│       ├── SeverityCard.tsx      # severity-tinted card (accent bar + tint + border)
│       ├── SeverityRow.tsx       # the attention-queue row variant
│       ├── EvidenceChart.tsx     # 'use client' Recharts wrapper
│       ├── StaleChart.tsx        # 'use client' the hatched "NO FRESH DATA" placeholder
│       ├── TwoAxisPip.tsx        # running × functioning status pip/tiles
│       ├── FreshnessChip.tsx     # fresh / stale (square dot + dashed) chip
│       ├── CommandModal.tsx      # 'use client' runbook + exported command (Radix Dialog)
│       ├── AiReadPanel.tsx       # navy #13284F "AI read" advisory panel
│       ├── NavRailShell.tsx      # 60px navy left rail + top bar shell
│       ├── ImplTag.tsx           # LND #33559B / LDK #7A4FA3 layer tag
│       └── Severity.ts           # CVA variant defs + severity→token map
└── lib/
    └── df/
        └── tokens.ts             # SSR-safe TS mirror of the @theme df-* hex values
```

### Pattern 1: Additive namespaced token block
**What:** Add a second `@theme` block in `globals.css` with `--color-df-*`, `--text-df-*`, `--radius-df-*`, `--shadow-df-*` tokens. Do not edit the NOC block.
**When to use:** All Phase 10 token work.
**Example:**
```css
/* globals.css — appended below the existing NOC @theme block. Source: byte-perfect
   Ops Center - Data-Forward v2.dc.html (verified 2026-06-23). */
@theme {
  /* ── surfaces ── */
  --color-df-bg: #EEF1F5;            /* page ground (prototype body bg) */
  --color-df-surface: #FFFFFF;       /* cards */
  --color-df-surface-sub: #FAFBFD;   /* evidence panel insets */
  --color-df-border: #E4E7EE;        /* card border */
  --color-df-border-soft: #ECEFF4;   /* inset border */
  /* ── ink ── */
  --color-df-ink: #10131A;
  --color-df-muted: #6F7787;         /* AA-large/UI (3.97:1 on bg) — labels, not body text */
  --color-df-faint: #9AA3B4;         /* DECORATIVE ONLY — fails 4.5:1 AND 3:1 as text */
  /* ── chrome (structure, never a health color) ── */
  --color-df-chrome: #13284F;        /* left rail / dark navy surfaces / command code bg */
  --color-df-brand: #1A3C79;         /* brand accent/affordance only (selection/focus) */
  /* ── severity ramp (structurally separate from chrome/brand) ── */
  --color-df-critical: #E0392B;      /* accent/dot/icon (prototype wins over #D92638) */
  --color-df-critical-tint: #FCEBEA; /* wash bg */
  --color-df-critical-border: #F3D3D0;
  --color-df-warning: #C8770A;
  --color-df-warning-tint: #FBF0DD;
  --color-df-warning-border: #EFE0C5;
  --color-df-watch: #0E8C84;         /* teal */
  --color-df-watch-tint: #E2F2EF;
  --color-df-watch-border: #C2E3DD;
  --color-df-ok: #1E9E63;            /* dots / sparks / accents (3.43:1 — NON-TEXT role) */
  --color-df-ok-text: #1E7A4E;       /* green TEXT/labels (5.32:1 — AA-text role) */
  --color-df-ok-tint: #E7F4EC;
  /* ── stale / no-data — SHAPE-distinct, not just hue (DS-01 honest stale primitive) ── */
  --color-df-stale-dot: #C8A23A;     /* square dot (radius 2px) */
  --color-df-stale-text: #A9912F;    /* stale label text */
  --color-df-stale-tint: #F7F0DC;
  --color-df-stale-border: #E9DCB6;
  /* ── impl tags ── */
  --color-df-lnd: #33559B;  --color-df-lnd-bg: #EAEFF8;   /* AA-text 6.25:1 */
  --color-df-ldk: #7A4FA3;  --color-df-ldk-bg: #F1EAF8;   /* AA-text 5.14:1 */
  /* ── type ── */
  --font-df-sans: var(--font-plex-sans), system-ui, sans-serif;
  --font-df-mono: var(--font-plex-mono), ui-monospace, monospace;
  /* ── radius (prototype: pills 5–6 / buttons 8–11 / cards 13–16) ── */
  --radius-df-pill: 6px;
  --radius-df-btn: 9px;
  --radius-df-card: 14px;
  --radius-df-card-lg: 18px;        /* hero card */
  /* ── shadow (rest → hover) ── */
  --shadow-df-rest: 0 1px 3px rgba(16,19,26,.05);
  --shadow-df-hover: 0 10px 30px rgba(16,19,26,.10);
}
```

### Pattern 2: Server-fetch / client-chart split (Recharts)
**What:** Server Component owns data + non-chart markup; a thin `'use client'` wrapper renders Recharts.
**When to use:** Every EvidenceChart usage.
**Example:**
```tsx
// EvidenceChart.tsx  (Source: visual spec = prototype chart() in Ops Center v2 <script>, lines 472–517)
"use client";
import { Area, ComposedChart, Line, ReferenceLine, ReferenceArea, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { DF } from "@/lib/df/tokens"; // SSR-safe hex constants

export function EvidenceChart({ data, accent, threshold, band, projection }: EvidenceChartProps) {
  return (
    <div className="h-[104px] w-full">         {/* fixed height — avoids ResponsiveContainer zero-size flash */}
      <ResponsiveContainer>
        <ComposedChart data={data}>
          {band && <ReferenceArea y1={band.lo} y2={band.hi} fill={`${DF.slate}1c`} />}
          {threshold && <ReferenceLine y={threshold.v} stroke={DF.slate} strokeDasharray="3 3" />}
          <Area dataKey="v" stroke="none" fill={`${accent}1f`} />
          <Line dataKey="v" stroke={accent} strokeWidth={2} dot={false} />
          {/* projection rendered as a second dashed Line over the proj slice */}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```
Visual spec to reproduce (from prototype `chart()`): peer-median band rect, neutral dashed threshold line + right-aligned label, accent area fill (`accent+'1f'` = ~12% alpha), 2px accent line, optional dashed projection at 0.65 opacity, a last-point dot, and small axis labels in `#9AA3B4`.

### Pattern 3: Severity as a CVA variant
**What:** One `Severity.ts` exporting a CVA config mapping `critical|warning|watch|healthy|stale` → `{accent, tint, border, label}` token classes, consumed by Card/Row/Pip/Chip.
**When to use:** Every severity-bearing primitive — guarantees one source of truth for the ramp.

### Anti-Patterns to Avoid
- **Importing Recharts into a Server Component** — all Recharts components are client-only; it will throw. Always wrap in `'use client'`.
- **Reusing a severity hue as chrome** (DS-01 AC violation) — navy `#13284F`/`#1A3C79` are chrome/brand; never paint a card accent or status dot with them, and never paint chrome with `#E0392B`/`#C8770A`/`#0E8C84`/`#1E9E63`.
- **Faking freshness** — a stale value must render the SHAPE-distinct stale treatment (square dot radius 2px + dashed border + `#A9912F` text), not a green dot. The `StaleChart` hatched "NO FRESH DATA" placeholder replaces the line chart when data is stale (prototype `staleChart()`, lines 519–531).
- **Inline unit math** — never compute sat/BTC/fee in a primitive; call `formatSats`/`formatBtc`/`feeMsatToSat` (AFM-002).
- **Editing the NOC `@theme` block or `:root`** — Phase 10 is additive (D-05). Touching NOC tokens risks breaking v1 overview/console/inbox.
- **`getComputedStyle` for chart colors** — breaks SSR; use the `src/lib/df/tokens.ts` mirror.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal/dialog (runbook/command) | Custom overlay + focus trap + ESC handling | Vendored `src/components/ui/dialog.tsx` (Radix) | Focus management, scroll-lock, a11y already solved. |
| Charts (evidence/sparkline) | Continue with bespoke inline SVG | Recharts 3.9.0 | DS-02 mandates Recharts; gives reusable axes/responsive sizing for Phases 12–15. |
| Icons | Inline SVG path soup | lucide-react | D-06 allows icons; lucide is already installed and is the shadcn default. |
| className variants per severity | `if (sev === 'critical') ...` chains | class-variance-authority | One CVA config = one source of truth for the ramp; prevents drift. |
| Sat/BTC/fee formatting | New conversion in the primitive | `@/lib/format/units` | AFM-002 — single sanctioned formatter, unit-tested. |
| Font loading | `<link>` to Google Fonts | `next/font/google` | Self-hosts woff2 at build, zero runtime requests, no layout shift. |

**Key insight:** Nearly every "primitive" here is presentational composition over tokens + already-vendored infra (Radix, lucide, CVA, units.ts). The only genuinely new dependency is Recharts. Resist re-solving modal/icon/variant problems.

## Primitive Inventory

> DS-02 must-have primitives → prototype source (file:line in `.prototype-snapshot/`) → closest v1 analog → target path → units.ts.

| Primitive | Prototype source | Closest v1 analog (learn, then supersede) | Target path | Renders numerics? |
|-----------|------------------|--------------------------------------------|-------------|-------------------|
| **Severity-tinted card** | Ops Center v2 hero (lines 133–227) + queue card (280–358): `width:6–7px` accent bar, `border:1px solid {tint-border}`, `box-shadow` per severity | `src/components/insight/InsightCardRow.tsx`, `SeveritySpine.tsx` (v1 uses 3px border, NO accent bar/icon — D-06 changes this) | `components/df/SeverityCard.tsx` | via children |
| **Severity-tinted row** | Ops Center v2 queue rows (280–358) | `InsightCardList.tsx` / `InsightCardRow.tsx` | `components/df/SeverityRow.tsx` | via children |
| **Inline evidence chart** | Ops Center v2 `chart()` (472–517); chartSpec examples (576, 600, 617, 634, 651) | `src/components/console/Sparkline.tsx` (bespoke SVG) | `components/df/EvidenceChart.tsx` (`'use client'`, Recharts) | **YES** — axis/value labels (route any sat/fee through units.ts) |
| **Stale / no-data chart placeholder** | Ops Center v2 `staleChart()` (519–531): hatched `#F7F2E4` bg, "NO FRESH DATA" | none (v1 hides stale charts) | `components/df/StaleChart.tsx` | last-good timestamp only |
| **Two-axis status pip / tiles** | Node Detail service tiles (155–187): Running tile + Functioning tile, `runGlyph`/`funcGlyph` check/cross, `green only when both` (logic lines 556–573) | `src/components/scorecard/DimensionRow.tsx`, `CriticalChip.tsx` | `components/df/TwoAxisPip.tsx` | error counts, heartbeat ages |
| **Freshness chip** | Ops Center v2 STALE chip (291–293) + fresh dot (143, 248, 298); Node Detail freshness (181–184) | `src/components/scorecard/FreshnessStamp.tsx` (mono text, no glyph — D-06 now allows icon + square dot) | `components/df/FreshnessChip.tsx` | relative-age text |
| **Runbook / command modal** | Ops Center v2 modal (419–463): runbook steps + navy code block + copy; cmd payloads (590, 607, 624, 641, 658, 675) | `src/components/queue/EnqueuePreview.tsx`, `src/components/ui/dialog.tsx` | `components/df/CommandModal.tsx` (`'use client'`) | command strings (verbatim) |
| **AI-read panel** | Ops Center v2 "What needs you now" navy band (94–124) + inline "AI read"/"AI grouping" (205–208, 335–338) | `src/components/insight/NarrateButton.tsx` (INSIGHT-07) | `components/df/AiReadPanel.tsx` | none (advisory text) |
| **Nav rail / shell** | Ops Center v2 left rail (39–58) + sticky top bar (63–88) | `src/components/chrome/MastheadNav.tsx` | `components/df/NavRailShell.tsx` | poll-age in top bar |
| **Impl tag (LND/LDK)** | Node Detail (88): `#33559B` on `#EAEFF8`; brief gives LDK `#7A4FA3`/`#F1EAF8` | `src/components/scorecard/BackendBadge.tsx` | `components/df/ImplTag.tsx` | none |
| **Blast-radius diagram** (hero only) | Ops Center v2 `blastRadius()` (533–558) | none | (defer to Phase 12/15 — NOT a must-have foundation primitive; note it exists) | none |

**Net-new vs analog:** Severity card/row, freshness chip, two-axis pip, AI-read panel, nav rail all have a v1 analog to learn from but must be rebuilt to the new grammar (icons allowed, accent bars, tints). Stale-chart placeholder and the Recharts evidence chart are effectively net-new. Blast-radius is hero-specific — implement it when Phase 12 needs it, not in the foundation.

## Runtime State Inventory

> Phase 10 is greenfield front-end (additive tokens + new components + new route). It is NOT a rename/refactor/migration of stored data. The only "supersession" is token-layer, not runtime state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no DB writes; gallery uses static fixtures. | None — verified by phase boundary (no backend touch, D-05). |
| Live service config | None. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None — gallery has no DB/credential dependency. | None. |
| Build artifacts | `next/font` will emit new self-hosted IBM Plex Sans woff2; Saira/Inter artifacts remain until v1 retired. | Reinstall not needed; `next build` regenerates font assets. |

**The one supersession to track:** the NOC `--color-status-*` / `--color-brand-*` tokens + `sketch-findings-nodemonitor` grammar are *superseded for v2* but NOT deleted (D-05). They stay live for v1 overview/console/inbox until Phases 12–15 rebuild each screen. Deletion is a future-phase task, explicitly out of Phase 10 scope.

## Common Pitfalls

### Pitfall 1: ResponsiveContainer zero-size flash on SSR
**What goes wrong:** Recharts `ResponsiveContainer` measures its parent; on first SSR paint the parent can be 0×0, so the chart flashes empty or warns.
**Why it happens:** Container has no intrinsic height until JS measures it.
**How to avoid:** Give the chart wrapper a fixed height (`h-[104px]` for hero, `h-[58px]` for inline — matching prototype `chartSpec` `h` values), and/or render under `<Suspense>`.
**Warning signs:** Empty chart box on initial load; console "width(0) and height(0)" warning.

### Pitfall 2: Severity hue used as text fails AA-text
**What goes wrong:** Painting body/label text in `#1E9E63` (ok), `#E0392B` (crit), `#C8770A` (warn), `#0E8C84` (watch) on white gives 3.4–4.4:1 — below the 4.5:1 AA-text bar.
**Why it happens:** Those hues are tuned as *accents/dots* (3:1 UI-component bar), not text.
**How to avoid:** Use the role-split tokens — `--color-df-ok-text` (#1E7A4E, 5.32:1) for green text; for crit/warn text, render on the dark navy chrome or use the hue only as a dot/accent + black/`#10131A` label. The prototype itself only ever uses the bright hues as dots/bars/icons, never as paragraph text. Encode this as a lint/test rule.
**Warning signs:** Colored small text on white in any primitive.

### Pitfall 3: NOC token leak into v2 surfaces
**What goes wrong:** A copy-pasted v1 component drags `text-status-warn` / `bg-brand` into a `df/` primitive or the gallery; DS-03 guard should catch it.
**Why it happens:** v1 and v2 tokens coexist (D-05); muscle memory.
**How to avoid:** The `lint:noc-guard` grep (below) over `src/components/df/**` + `src/app/(design)/**`.
**Warning signs:** Guard grep returns matches.

### Pitfall 4: next/font variable name collision / removal
**What goes wrong:** Replacing Saira/Inter wiring outright breaks v1 screens that reference `--font-saira` / `--font-inter` / `--font-display`.
**Why it happens:** v1 `globals.css` `@theme` still maps `--font-sans`→Inter, `--font-display`→Saira.
**How to avoid:** ADD `IBM_Plex_Sans` (new `--font-plex-sans` variable) alongside the existing fonts in `layout.tsx`; keep `--font-plex-mono` (already wired). Do NOT remove Saira/Inter until v1 is retired. The new `--font-df-sans` token points at `--font-plex-sans`; the old `--font-sans` stays on Inter.
**Warning signs:** v1 headers lose their font; hydration font-mismatch.

## Code Examples

### Additive font wiring (layout.tsx)
```tsx
// Source: existing layout.tsx pattern + next/font/google docs.
import { IBM_Plex_Sans, IBM_Plex_Mono, Inter, Saira_Semi_Condensed } from "next/font/google";

const plexSans = IBM_Plex_Sans({ weight: ["400","500","600","700"], variable: "--font-plex-sans", subsets: ["latin"] });
const plexMono = IBM_Plex_Mono({ weight: ["400","500","600"], variable: "--font-plex-mono", subsets: ["latin"] });
// keep saira + inter for v1 until retired
// <html className={`${plexSans.variable} ${plexMono.variable} ${saira.variable} ${inter.variable}`}>
```

### NOC retirement guard (package.json script)
```jsonc
// package.json "scripts" — DS-03. Scoped to NEW v2 surfaces only (D-05).
"lint:noc-guard": "! grep -rnE '(--color-status-|--color-brand[a-z-]*|text-status-|bg-status-|border-status-|ring-status-|text-brand|bg-brand|border-brand|font-display|--font-saira|--font-inter)' src/components/df src/app/\\(design\\) --include='*.tsx' --include='*.ts' --include='*.css'"
```
The leading `!` makes the script EXIT 0 when grep finds NOTHING (the desired state) and FAIL when a NOC token leaks in. Wire it into `lint` (e.g. `"lint": "eslint && npm run lint:noc-guard"`) and/or a CI step.

**Forbidden "NOC mono-instrument token set"** (the exact names DS-03 forbids on v2 surfaces):
`--color-status-ok`, `--color-status-ok-dim`, `--color-status-warn`, `--color-status-warn-dim`, `--color-status-critical`, `--color-status-critical-dim`, `--color-status-stale`, `--color-status-stale-dim`, `--color-status-nodata`, `--color-status-nodata-dim`, `--color-status-outlier`, `--color-brand`, `--color-brand-light`, `--color-brand-glow`, `--font-display`, `--font-saira`, `--font-inter`, and their Tailwind utility forms (`text-status-*`, `bg-status-*`, `border-status-*`, `ring-status-*`, `text-brand*`, `bg-brand*`, `border-brand*`). v2 surfaces use the `df-*` namespace exclusively.

## State of the Art

| Old (NOC, v1) | New (Data-Forward, v2) | When Changed | Impact |
|---------------|------------------------|--------------|--------|
| `--color-status-critical: #D92638` | `--color-df-critical: #E0392B` | Phase 10 (prototype tiebreaker, D-03) | Drift resolved — prototype wins; `#D92638` unused in v2. |
| `--color-status-ok: #0B8A51` (single green) | `--color-df-ok: #1E9E63` (dot) + `--color-df-ok-text: #1E7A4E` (text) | Phase 10 | Role-split: bright green for dots/sparks, darker for AA-text. |
| `--color-status-warn: #8F5D00` | `--color-df-warning: #C8770A` | Phase 10 | Prototype value. |
| No "watch" tier | `--color-df-watch: #0E8C84` (teal) | Phase 10 | New 4th severity tier. |
| `--color-brand: #1A3C79` doubles as chrome | `--color-df-chrome: #13284F` (rail/dark surfaces) + `--color-df-brand: #1A3C79` (accent only) | Phase 10 | TWO distinct navy roles; chrome navy is darker. |
| Stale = mono text, no glyph (no-icons rule) | Stale = square dot (r2px) + dashed border + `#A9912F` text + icon | Phase 10 (D-06 reverses no-icons) | Shape-distinct honest stale primitive. |
| Saira/Inter type | IBM Plex Sans/Mono | Phase 10 | Font change (additive). |
| Tight radii 3/6/10px | 6/9/14/18px (pills/btn/card/hero) | Phase 10 | Softer, premium (Linear/Stripe bar). |
| No icons for state | Icons allowed (severity/layer/action) | Phase 10 (D-06) | Supersedes `sketch-findings-nodemonitor`. |

**Deprecated/outdated (for v2; still live for v1 per D-05):**
- The entire NOC `--color-status-*` / `--color-brand-*` palette and the `sketch-findings-nodemonitor` "no-icons / mono-everything" grammar — superseded, not deleted.
- The `react-is` override hack for Recharts — **obsolete on Recharts 3.x** (was a 2.x-on-React-19 workaround). Do NOT add it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `recharts@3.9.0` is the correct, legitimate package (slopcheck not run this session) | Package Legitimacy Audit | Low — long-established, `npm view` confirmed, shadcn's own chart dep; planner gates with `checkpoint:human-verify`. |
| A2 | LDK impl-tag colors are `#7A4FA3` on `#F1EAF8` | Standard Stack / Primitive Inventory | Low — sourced from the task brief's verified inventory; the byte-perfect Node Detail snapshot only contains LND demo nodes so the LDK hex couldn't be re-read off disk. Verify against a per-screen file if any LDK tag renders wrong. |
| A3 | Spacing scale = Tailwind v4 default 4px step (prototype uses ad-hoc px in inline styles; no explicit spacing token system found) | Standard Stack (no spacing token block proposed) | Low — prototype hard-codes px (`padding:14px/16px/22px`); recommend using Tailwind's default spacing utilities + the proposed radius/shadow tokens, NOT inventing a spacing token scale. Confirm with planner. |
| A4 | The blast-radius diagram is NOT a Phase-10 foundation primitive (deferred to the screen that needs it) | Primitive Inventory | Low — it is hero/incident-specific (Phase 12/15); DS-02's named list does not include it. |

## Open Questions

1. **Spacing tokens — adopt a scale or use Tailwind defaults?**
   - What we know: the prototype hard-codes pixel padding/gaps in inline styles; there is no `--spacing-*` token system in it.
   - What's unclear: whether DS-01's "spacing" deliverable wants a named token scale or just sanctioned Tailwind utilities.
   - Recommendation: use Tailwind v4's default 4px spacing scale (no custom spacing tokens); reserve `df-*` tokens for color/type/radius/shadow only. Surface to planner for a quick confirm.

2. **EvidenceChart fidelity bar — pixel-match the SVG or "close enough on Recharts"?**
   - What we know: prototype chart is hand-rolled SVG with specific features (band/threshold/area/projection/marker/last-dot).
   - What's unclear: how exactly Recharts output must match (the projection-as-dashed-continuation and the right-aligned threshold label need custom Recharts composition).
   - Recommendation: reproduce the *grammar* (all 6 features present, correct colors) rather than pixel-identical geometry; validate visually in the gallery against the prototype `shots/`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node + npm | build/install | ✓ | (workspace) | — |
| recharts | EvidenceChart (DS-02) | ✗ (must install) | 3.9.0 target | none — DS-02 mandates it; `npm install recharts@3.9.0` |
| next/font (IBM Plex) | type pairing (DS-01) | ✓ (next/font/google built-in) | n/a | — |
| vitest | Validation Architecture tests | ✓ | ^4 | — |
| grep | NOC-guard (DS-03) | ✓ (POSIX) | n/a | ripgrep `rg` if preferred |

**Missing dependencies with no fallback:** `recharts` — but trivially installable; not a blocker, just an install step the plan must include (gated by `checkpoint:human-verify` per A1).
**Missing dependencies with fallback:** none.

## Validation Architecture

> nyquist_validation is enabled (config: `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4 |
| Config file | none detected at root — tests run via `vitest run` (Wave 0: add `vitest.config.ts` if jsdom/RTL needed for component render tests) |
| Quick run command | `npm test -- src/components/df` (or a `df`-scoped path once tests exist) |
| Full suite command | `npm test` (→ `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DS-01 | Every `df-*` color/radius/shadow token present in `globals.css` AND mirrored in `src/lib/df/tokens.ts` (parity) | unit | `npm test -- src/lib/df/tokens.test.ts` | ❌ Wave 0 |
| DS-01 | Severity ramp AA: TEXT roles ≥4.5:1, NON-TEXT (dot/accent) roles ≥3:1 on their stated bg | unit | `npm test -- src/lib/df/contrast.test.ts` | ❌ Wave 0 |
| DS-01 | No severity hue equals a chrome/brand hue (set-disjointness assertion) | unit | `npm test -- src/lib/df/tokens.test.ts` | ❌ Wave 0 |
| DS-01 | Stale token set renders shape-distinct (square dot r2px + dashed border), asserted on `FreshnessChip`/`StaleChart` output | unit (render) | `npm test -- src/components/df/FreshnessChip.test.tsx` | ❌ Wave 0 |
| DS-02 | Each primitive renders in all 7 states without throwing (smoke render the gallery sections) | unit (render) | `npm test -- src/components/df` | ❌ Wave 0 |
| DS-02 | EvidenceChart renders an SVG (Recharts) with line+threshold+band when fed a fixture; falls back to StaleChart when `stale` | unit (render) | `npm test -- src/components/df/EvidenceChart.test.tsx` | ❌ Wave 0 |
| DS-02 | Numeric-bearing primitives call units.ts (no inline sat/BTC math) — assert formatted output matches `formatSats`/`formatBtc` | unit | `npm test -- src/components/df` | ❌ Wave 0 |
| DS-02 | Gallery route builds (RSC + client islands) — `next build` succeeds | build | `npm run build` | n/a (build gate) |
| DS-03 | NOC-guard grep returns ZERO matches on `src/components/df/**` + `src/app/(design)/**` | static/build | `npm run lint:noc-guard` | ❌ Wave 0 (add script) |

**Observable success criteria (map to ROADMAP's 4):**
1. *(Canonical token set)* — `tokens.test.ts` (parity + ramp-vs-chrome disjointness) + `contrast.test.ts` (AA) pass.
2. *(Primitive library + gallery)* — gallery `next build` succeeds; smoke-render tests pass for every primitive × every state.
3. *(NOC retired on v2 surfaces)* — `npm run lint:noc-guard` exits 0.
4. *(Honest stale/no-data first-class)* — `FreshnessChip`/`StaleChart` render tests assert the shape-distinct stale treatment.

### Sampling Rate
- **Per task commit:** `npm test -- <changed df path>` + `npm run lint:noc-guard`
- **Per wave merge:** `npm test` (full vitest) + `npm run build`
- **Phase gate:** full suite green + `lint:noc-guard` exit 0 + `next build` green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `vitest.config.ts` — add jsdom environment + (optionally) `@testing-library/react` for component render tests. NOTE: RTL is not currently a devDep; if the planner wants render tests, add `@testing-library/react` + `jsdom` (flag as new packages for slopcheck). Lower-tooling alternative: assert on `renderToStaticMarkup` from `react-dom/server` (no new deps) for smoke + shape assertions.
- [ ] `src/lib/df/tokens.ts` + `tokens.test.ts` (token parity + ramp/chrome disjointness)
- [ ] `src/lib/df/contrast.test.ts` (pure-function AA ratios over the token hexes)
- [ ] `src/components/df/*.test.tsx` (per-primitive render-all-states + units.ts usage + stale shape)
- [ ] `package.json` `lint:noc-guard` script (DS-03)
- [ ] `EvidenceChart.test.tsx` (Recharts renders / stale fallback)

## Security Domain

> `security_enforcement` not set false in config; HARDEN-03 (Grade-A scan of v2 surfaces) is a Phase-16 gate, but the foundation must not introduce risk.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local single-operator tool; no auth in scope this phase. |
| V3 Session Management | no | No sessions. |
| V4 Access Control | no | Gallery is static fixtures; no data access. |
| V5 Input Validation | minimal | Gallery takes no user input; primitives render trusted fixture props. (Real input validation lives in QUEUE phases via zod.) |
| V6 Cryptography | no | No signing/crypto in Phase 10 (HMAC lives in QUEUE/EXEC phases). |
| V14 Configuration | yes | The command-modal must render command strings as **inert text** (`<code>`/`white-space:pre`), never execute or `dangerouslySetInnerHTML`. Re-affirms zero-write-path (the modal copies, never runs). |

### Known Threat Patterns for {Next.js RSC + presentational primitives}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via command string rendered as HTML | Tampering / Elevation | Render command/runbook text as plain text in a `<code>` element (React escapes by default); never `dangerouslySetInnerHTML`. The prototype uses a `<code>` block with `white-space:pre` — match it. |
| AI-read panel implying executability | Spoofing | Keep the prototype's verbatim "AI · explains & ranks, never runs commands" / "NodeMonitor runs nothing for you" copy as a built-in label on `AiReadPanel`/`CommandModal` (zero-credential safety cue, brief guard rail). |
| Recharts supply-chain (new dep) | Tampering | slopcheck/`checkpoint:human-verify` gate on install (A1). |

## Sources

### Primary (HIGH confidence)
- `.prototype-snapshot/Ops Center - Data-Forward v2.dc.html` (byte-perfect) — token values, severity meta (`sevMeta` 680–684), chart grammar (`chart()` 472–517, `staleChart()` 519–531, `blastRadius()` 533–558), modal (419–463), AI band (94–124), nav rail (39–58). **Authoritative token source (D-03).**
- `.prototype-snapshot/Node Detail.dc.html` (byte-perfect) — two-axis service tiles (155–187 + logic 556–573), impl tag (88), freshness rows (181–184), fonts/keyframes (16–32).
- `src/app/globals.css`, `src/app/layout.tsx`, `src/lib/format/units.ts`, `package.json`, `src/components/scorecard/FreshnessStamp.tsx` (this workspace) — existing conventions + installed versions.
- `npm view recharts version` → 3.9.0; `npm view recharts peerDependencies` → react/react-dom/react-is all `^19.0.0` permitted. **HIGH.**
- AA contrast ratios computed this session (WCAG relative-luminance formula) over the prototype hexes. **HIGH** (deterministic math).
- `.planning/ROADMAP.md` §Phase 10 (233–243), `.planning/REQUIREMENTS.md` DS-01/02/03, `.planning/config.json`.

### Secondary (MEDIUM confidence)
- `.planning/DESIGN-BRIEF-02-ops-center-bold-rethink.md` — quality bar (Linear/Vercel/Stripe/Raycast), AA-minimum, icons-allowed, zero-credential cue.
- Recharts 3.0 migration guidance (training + the verified peer-dep range) — `react-is` override obsolete on v3.

### Tertiary (LOW confidence)
- LDK impl-tag hex `#7A4FA3`/`#F1EAF8` (A2) — from the task brief's verified inventory; not re-readable off the LND-only byte-perfect snapshots.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions read off `package.json` + `npm view`; Recharts the only add.
- Token values: HIGH — read off the byte-perfect canonical prototype (D-03 authority).
- Architecture/primitives: HIGH — every primitive mapped to exact prototype file:line + v1 analog + target path.
- Pitfalls/AA: HIGH — contrast ratios computed; Recharts SSR + react-is settled.
- Spacing-token scope (A3): MEDIUM — prototype hard-codes px; recommend Tailwind defaults, planner to confirm.

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable stack; Recharts/Next versions move slowly)
