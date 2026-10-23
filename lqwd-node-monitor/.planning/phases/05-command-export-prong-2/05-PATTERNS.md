# Phase 5: Command Export (Prong 2) - Pattern Map

**Mapped:** 2026-06-12
**Files analyzed:** 11 new/modified files
**Analogs found:** 10 / 11 (sanitize.ts has only a partial analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/export/validate.ts` (new) | utility (validation gate) | transform | `src/lib/insight/deeplink.ts` | exact |
| `src/lib/export/sanitize.ts` (new) | utility (string sanitizer) | transform | `src/lib/insight/deeplink.ts` (regex gate) + `NarrateButton.tsx` (plain-text discipline) | partial |
| `src/lib/export/block.ts` (new) | type/contract module | transform | `src/lib/insight/types.ts` | role-match |
| `src/lib/export/commands.ts` (new) | utility (pure builders) | transform | `src/lib/insight/detectors/stuck-pending.ts` (card builders) + `fee-signals.ts` `buildCard()` | exact |
| `src/lib/export/validate.test.ts` (new) | test | — | `src/lib/insight/deeplink.test.ts` (injection-rejection suite) | exact |
| `src/lib/export/commands.test.ts` (new) | test | — | `src/lib/insight/detectors/stuck-pending.test.ts` (fixture builders, fixed NOW) | exact |
| `src/components/export/CommandExport.tsx` (new) | client component (leaf) | event-driven (expand/copy) | `NarrateButton.tsx` (state leaf) + `FleetPendingBoard.tsx` (expand grammar) + `ExportButton.tsx` (button voice) | exact (composite) |
| `src/components/insight/InsightCardRow.tsx` (modify) | server component | request-response | itself — suggested-action block (lines 136–148) | exact |
| `src/components/console/ActiveSignalsPanel.tsx` (modify) | server component | request-response | itself — `SignalRow` interface (lines 15–28) | exact |
| `src/app/(overview)/[pubkey]/[tab]/page.tsx` (modify) | route/page | request-response | itself — `buildInsightSignals()` (lines 133–159) | exact |
| `src/lib/insight/detectors/fee-signals.ts` + `rebalance.ts` (modify: detail enrichment) | service (detector) | transform | `fee-signals.ts` detail assembly (lines 165–169) + `guardrails.ts` `withDetail()` (lines 49–57) | exact |

Read-only contract inputs (NOT modified, but every new file codes against them): `src/lib/insight/schema.ts` (frozen — zero changes allowed; `evidence.detail` keys are an open record so enrichment is contract-safe), `src/lib/insight/types.ts`, `src/lib/format/units.ts`.

## Pattern Assignments

### `src/lib/export/validate.ts` (utility/validation, transform)

**Analog:** `src/lib/insight/deeplink.ts` — the repo's canonical "validate everything BEFORE interpolation, fail loud" pure module.

**Module header + pure-module discipline** (deeplink.ts lines 3–15):
```typescript
// =====================================================
// D-04 — the SINGLE validated deep-link builder (Phase 4)
// =====================================================
// Pure module: no server runtime imports — test-imported and safe anywhere.
//
// Every card deepLink flows through here (T-04-04 open-redirect / href
// injection): only RELATIVE console-tab paths are produced, built exclusively
// from a validated pubkey + whitelisted tab/window keys. No absolute URLs, no
// protocol, no reflected input. Violations THROW — a detector passing garbage
// is a bug, not user input; fail loud, never sanitize-and-continue.

/** Same pubkey gate as the console page (src/app/(overview)/[pubkey]/[tab]/page.tsx). */
const PUBKEY_RE = /^[0-9a-f]{66}$/;
```
NOTE for this phase: deeplink THROWS on bad input (detector bug = crash). Export validation instead returns a withheld/error result per RESEARCH Pattern 1 ("honest withheld state, never a partial command") — keep deeplink's named-regex + check-before-interpolate structure, but return a result object instead of throwing, matching the project's `{ success, reason? }` return convention.

**Validate-before-interpolate structure** (deeplink.ts lines 24–44):
```typescript
export function buildDeepLink(pubkey: string, tab: TabKey, window?: WindowKey): string {
  if (!PUBKEY_RE.test(pubkey)) {
    throw new Error(
      `buildDeepLink: invalid pubkey (expected 66 lowercase hex chars, got ${JSON.stringify(
        String(pubkey).slice(0, 80),
      )})`,
    );
  }
  if (!(TAB_KEYS as readonly string[]).includes(tab)) { /* ... */ }
  if (window === undefined) return `/${pubkey}/${tab}`;
  // every branch validates BEFORE any template literal touches the value
```

**Zod re-parse gate** — import the frozen schema exactly as `guardrails.ts`/`types.ts` do; the schema header (schema.ts lines 6–13) explicitly authorizes this import:
```typescript
// THE frozen contract artifact. Phase 5 (export) and Phase 6 (signed queue)
// import this exact schema; ...
// Pure module: NO server-side-only imports, no DB imports — test-imported and
// safe anywhere (Phase 5 client-side export generation imports it).
import { SuggestedActionSchema } from "@/lib/insight/schema";
```

**Param format regexes** — mirror the existing precedents: `PUBKEY_RE = /^[0-9a-f]{66}$/` appears verbatim in `deeplink.ts:15`, `stuck-pending.ts:43`, and `page.tsx`. Extend with the RESEARCH-specified set (`CHANNEL_POINT_RE`, `TXID_RE`, `CHAN_ID_RE`, `safeSatPerVbyte` bounds).

---

### `src/lib/export/sanitize.ts` (utility, transform) — PARTIAL ANALOG

No existing comment-line sanitizer exists in the codebase. Closest patterns to copy:
- **Named-regex whitelist style** from `deeplink.ts` (above) — define the allowed character class as a named constant, not inline.
- **Alias-as-data discipline** from `NarrateButton.tsx` lines 15–18 (T-04-19 lineage — the comment convention to repeat):
```typescript
// Injection containment (T-04-19/T-04-23): the LLM's text renders as PLAIN
// TEXT in a whitespace-pre-wrap paragraph — no raw-HTML injection, no
// markdown rendering — under a header that marks it as LLM output.
```
Build: strip control chars/newlines and `` ` ``, `$`, `\` from any card-sourced string entering a `#` comment line; cap length (RESEARCH Pitfall 2). Follow the lqwdclaw convention: named export, function < 30 lines, descriptive name (`sanitizeCommentText()`).

---

### `src/lib/export/block.ts` (type module, transform)

**Analog:** `src/lib/insight/types.ts` — pure type-surface module with invariants documented in the header.

**Header + derivation pattern** (types.ts lines 12–24):
```typescript
// =====================================================
// InsightCard type contracts (Phase 4 — INSIGHT-01)
// =====================================================
// Pure module: NO server-side-only imports, no DB imports — test-imported and
// safe anywhere. All types derive from the zod validator via z.infer so the type
// surface and the runtime contract CANNOT drift (D-02). ...
//  - raw values stay RAW (sats, ratios, counts, PPM) — the AFM-002 formatter
//    (src/lib/format/units.ts) applies at render only; nothing in this layer
//    converts units.
```
`ExportBlock` must be plain-serializable (strings/numbers/null only) because it crosses the Server-Component → client-leaf boundary as props — same constraint the `SignalRow` interface already satisfies (ActiveSignalsPanel.tsx lines 15–28). Use interfaces, named exports, no classes.

---

### `src/lib/export/commands.ts` (pure builders, transform)

**Analog:** `src/lib/insight/detectors/stuck-pending.ts` (per-case builder functions returning a typed structure or null) + `fee-signals.ts` `buildCard()`.

**Imports pattern** (stuck-pending.ts lines 1–10 — `@/` aliases only, types from the frozen contract):
```typescript
import { buildDeepLink, FLEET_PENDING_LINK } from "@/lib/insight/deeplink";
import type { InsightKnobs } from "@/lib/insight/config";
import { CARD_SCHEMA_VERSION, type InsightCard, type Severity } from "@/lib/insight/types";
```

**Dispatcher + per-case builders shape** (stuck-pending.ts lines 88–130): one exported pure entry (`detectStuckPending(view, config, nowMs)`) loops and delegates to small private builders (`fcPastMaturityCard`, `stuckSweepCard`, `stuckOpenCard`), each returning `InsightCard | null`. Copy this exact shape: `buildExportBlock(card): ExportBlock | null` dispatching on `card.suggestedAction.type` to `buildCloseExport` / `buildRebalanceExport` / `buildRemediateExport` (and `case` sub-dispatch inside remediate, mirroring how stuck-pending dispatches per section).

**Skip-rather-than-emit-unactionable guard** (fee-signals.ts lines 161–163) — the gate pattern for missing identifiers:
```typescript
  // The signing surface needs concrete identifiers — without both there is no
  // executable param set; skip rather than emit an unactionable write card.
  if (facts.chanId === null || facts.channelPoint === null) return null;
```

**Single numeric-coercion-point convention** (stuck-pending.ts lines 45–54) — if any coercion is needed, do it in ONE named helper with a doc comment:
```typescript
/**
 * THE single numeric coercion point for the D-06 rank key (Pitfall 3):
 * limbo_balance (string) for channels, amount_sat for sweeps. Missing /
 * non-numeric → 0 — every emitted card MUST carry a numeric limboSat.
 */
function toLimboSat(raw: string | number | null): number {
```

**Formatting rule:** `formatSats` (units.ts lines 17–20: `Number(sats).toLocaleString("en-US")`) ONLY in `#` comment lines and UI text; bare `command` strings interpolate raw integers (RESEARCH Pitfall 8 — one test asserts no `,` in any command).

---

### `src/lib/export/validate.test.ts` + `commands.test.ts` (tests)

**Analog 1 (injection rejection):** `src/lib/insight/deeplink.test.ts` lines 38–49 — copy this exact suite shape with hostile fixtures:
```typescript
  it("throws on injection strings before any path is built", () => {
    const injections = [
      "javascript:alert(1)",
      "../../../etc/passwd",
      `${"a".repeat(66)}/../admin`,
      "%6a%61%76%61%73%63%72%69%70%74:alert(1)",
      `https://evil.example/${"a".repeat(40)}`,
    ];
    for (const bad of injections) {
      expect(() => buildDeepLink(bad, "closes")).toThrow(/invalid pubkey/);
    }
  });
```
(For export validation the assertion flips from `.toThrow` to "returns withheld state, command absent" — add `;`, newline, backtick, `$(` fixtures plus a hostile-alias fixture per RESEARCH Pitfall 2.)

**Analog 2 (fixture builders + fixed clock):** `stuck-pending.test.ts` lines 13–60 — copy the override-able fixture-factory pattern:
```typescript
const NOW = Date.parse("2026-06-12T00:00:00.000Z");
const NODE_A = "02" + "a".repeat(64);
const CONFIG: InsightKnobs = INSIGHT_CONFIG.lnd;

function chanRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel_state: "FORCE_CLOSE",
    channel_point: "f".repeat(64) + ":0",
    /* ... */
    ...over,
  };
}
```
For Phase 5, fixtures are `InsightCard` objects (build a `cardFixture(over)` factory; validate fixtures through `InsightCardSchema.parse` the way stuck-pending tests import the schema, line 5). Cover: coop close, force close, LDK branch (`backend: "ldk"`), rebalance placeholder, all three remediate cases, suppressed card (action null → no block), formatted-comma absence in commands.

---

### `src/components/export/CommandExport.tsx` (client leaf, event-driven)

**Analog A — client-leaf state + header discipline:** `NarrateButton.tsx` (entire file, 69 lines). Copy:

Imports + directive (lines 1–3):
```typescript
"use client";

import { useState, useTransition } from "react";
```
(CommandExport needs only `useState` — no server action, so no `useTransition`.)

Mono-uppercase button voice (lines 44–52):
```tsx
<button
  type="button"
  onClick={handleClick}
  disabled={isPending}
  className="rounded-[3px] border border-border bg-card px-3 py-1.5 font-mono text-xs font-semibold tracking-[0.14em] text-brand uppercase transition-colors hover:border-brand-light hover:text-brand-glow disabled:cursor-default disabled:opacity-60"
>
```

Plain-text containment for the rendered block (lines 61–63 — the snippet renders the same way):
```tsx
{/* Plain text only — no raw-HTML injection, no markdown rendering. */}
<p className="px-4 py-3 font-mono text-xs whitespace-pre-wrap text-foreground/80">
```

**Analog B — expand/collapse grammar:** `FleetPendingBoard.tsx` lines 115–147 (`NodeRow`) and 82–110 (nested `sweepOpen` toggle). The exact toggle idiom:
```tsx
const [open, setOpen] = useState(false);
/* ... */
<button
  type="button"
  onClick={() => setOpen((v) => !v)}
  aria-expanded={open}
  className="... text-left transition-colors hover:bg-card"
>
/* ... */
{open && (
  <div className="border-t border-border bg-card/40 px-4 py-2">
```
Note FleetPendingBoard's header comment (lines 14–20): "presentational only ... owns nothing but expand/collapse UI state" — CommandExport carries the same constraint comment: all strings pre-built server-side; the leaf owns only `open` + per-button copied/failed state.

**Analog C — EXPORT control voice:** `ExportButton.tsx` lines 21–36 — the mono-uppercase-over-outline-button styling:
```tsx
className={cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  // Console-label voice over the outline-button chrome.
  "font-mono text-xs font-semibold tracking-[0.14em] uppercase"
)}
```
(No icon for the new control — sketch rules say no icons-for-state; ExportButton's `Download` icon is a download affordance, not state. EXPORT/COPY labels are text-only uppercase mono.)

**Copy handler** — no codebase analog; use the RESEARCH-supplied snippet verbatim (feature-detect `navigator.clipboard`, locked honest failure copy "copy failed — select the text manually", never silent).

---

### `src/components/insight/InsightCardRow.tsx` (modify — mount point 1)

**Analog:** itself. The export expand attaches directly below the suggested-action block (lines 136–148):
```tsx
{/* Suggested-action block: type + flat params as mono key/value rows. */}
{card.suggestedAction !== null && (
  <div className="mt-2 rounded-[3px] border border-border bg-muted/40 px-3 py-2">
    <span className="font-mono text-xs font-semibold tracking-[0.14em] text-foreground/60 uppercase">
      suggested — {card.suggestedAction.type}
    </span>
```
**Gate to add** (RESEARCH Pitfall 5): render `<CommandExport block={...} />` only when `card.suggestedAction !== null && type ∈ {close_channel, rebalance, remediate_pending}` — `update_fee` and `investigate` never export; suppressed cards already arrive with null actions (the file's own header, lines 22–26, documents this: "suggestedAction is structurally null on suppressed cards (guardrails.ts) — only the withheldAction type string ... reaches the DOM, never params (T-04-29)").

The row stays a Server Component (no `"use client"` at top — current file has none); it computes `buildExportBlock(card)` and passes plain strings.

---

### `src/components/console/ActiveSignalsPanel.tsx` (modify — mount point 2)

**Analog:** itself. Extend the `SignalRow` interface (lines 15–28) with one optional serializable field, following the exact existing optional-field style:
```typescript
export interface SignalRow {
  kind: "breach" | "outlier" | "insight";
  label: string;
  detail: string;
  href?: string;
  tabLabel?: string;
  /** Insight rows only — pre-computed by the caller (D-01 taxonomy). */
  severity?: "critical" | "warn" | "info";
  /** Insight rows only — suppression reason / hysteresis hold (D-14/D-15 visibility). */
  stateLine?: string;
  // ADD: /** Insight rows only — pre-built export block (Phase 5); strings only. */
  // exportBlock?: ExportBlock;
}
```
Mount the leaf inside the existing insight-row branch (lines 58–83), after the `stateLine` paragraph (line 80–82). Thread the **pre-built `ExportBlock`**, not the card (RESEARCH Pitfall 7 — keeps the console DOM surface minimal). Panel stays a Server Component; the file header (lines 9–12) documents the contract to preserve: "The SignalRow[] is BUILT BY THE CALLER ... this component renders it VERBATIM, no health logic (T-02-07)."

---

### `src/app/(overview)/[pubkey]/[tab]/page.tsx` (modify — SignalRow threading)

**Analog:** itself — `buildInsightSignals()` (lines 133–159) is the exact function to extend:
```typescript
function buildInsightSignals(cards: InsightCard[], pubkey: string): SignalRow[] {
  return cards
    .filter((card) => card.node?.pubkey === pubkey)
    .map((card) => {
      /* ... */
      return {
        kind: "insight" as const,
        severity: card.severity,
        label: SIGNAL_LABELS[card.signal],
        detail: `${e.metric} ${fmtRaw(e.observed)} ${e.unit} vs ${fmtRaw(e.threshold)} — ${e.window}`,
        href: e.deepLink,
        tabLabel: tabSegment,
        stateLine,
      };
    });
}
```
Add `exportBlock: buildExportBlock(card) ?? undefined` (or equivalent) inside the map. The insight view is already loaded with `.catch(() => null)` degradation (line 228) — no new reads, no new error handling needed.

---

### `src/lib/insight/detectors/fee-signals.ts` (+ `rebalance.ts`) (modify — detail enrichment)

**Analog:** fee-signals.ts' own detail assembly (lines 165–169) — extend in place with `capacitySat` (from the channel row already in hand) and `peerAlias` (from the engine's `nodeMetaFromFleet` map, engine.ts line 211):
```typescript
const detail: Record<string, string | number> = { forwards90d: facts.forwards90d };
if (facts.currentPpm !== null) detail.currentPpm = facts.currentPpm;
if (facts.ageDays !== null && signal === "channel_close_candidate") {
  detail.ageDays = facts.ageDays;
}
```
Conditional-add style is the convention: only add the key when the value exists (stuck-pending.ts lines 148–150 does the same: `if (row.channelPoint != null) detail.channelPoint = row.channelPoint;`). This is contract-safe — `CardEvidenceSchema.detail` is `z.record(z.string(), z.union([z.string(), z.number()])).optional()` (schema.ts line 91); NO schema change, values must be string|number only.

If a non-mutating post-pass is preferred over in-detector enrichment, copy `withDetail()` from guardrails.ts (lines 48–57):
```typescript
/** New card with one evidence.detail entry added (never mutates the input card). */
function withDetail(card: InsightCard, key: string, value: string | number): InsightCard {
  return {
    ...card,
    evidence: {
      ...card.evidence,
      detail: { ...(card.evidence.detail ?? {}), [key]: value },
    },
  };
}
```
Detector test extension follows the existing `fee-signals.test.ts` / `stuck-pending.test.ts` fixture style (see test analog above). The contract test (`schema.contract.test.ts`) must stay green untouched.

## Shared Patterns

### Module header convention
**Source:** every analog (deeplink.ts:3–13, guardrails.ts:5–26, stuck-pending.ts:12–38, InsightCardRow.tsx:9–26)
**Apply to:** all new files
```typescript
// =====================================================
// <Module name> — <requirement/decision IDs> (Phase 5 — EXPORT-01 / PENDING-03)
// =====================================================
// Pure module: no server-only imports, no DB — <what it does, which decisions
// it implements (D-01..D-10), which threats it addresses (T-04-16 etc.)>.
```
Decision/threat IDs in comments are how this codebase makes review traceable — every nontrivial block cites one.

### Pure-module + injectable-clock discipline
**Source:** `stuck-pending.ts:88–92` (`nowMs` injected), `fee-signals.ts:241–246` (`now: Date = new Date()`), schema.ts/types.ts headers
**Apply to:** `validate.ts`, `commands.ts`, `block.ts`, `sanitize.ts`
No `server-only` import, no DB import, no env read — builders take everything as arguments so vitest runs them with zero infrastructure (`npx vitest run src/lib/export`).

### Suppression / action gate
**Source:** `guardrails.ts:115–130` (`applySuppression` nulls actions structurally), `InsightCardRow.tsx:150–161` (withheld rendering)
**Apply to:** `commands.ts` (entry gate), both mount points
```typescript
const action = card.suggestedAction;
if (action === null || !WRITE_ACTION_TYPES.has(action.type)) return { ...card };
```
Export gate = `suggestedAction !== null && type ∈ {close_channel, rebalance, remediate_pending}`. Never inspect `evidence.detail.withheldAction` for export purposes.

### AFM-002 formatting boundary
**Source:** `src/lib/format/units.ts` (whole file, 20 lines), `InsightCardRow.tsx:40–53` (`formatValue`/`formatParamValue` route sat-keyed values through `formatSats`)
**Apply to:** `commands.ts` (comment lines), `CommandExport.tsx` (UI text)
`formatSats` in comments/UI only; raw integers in bare command strings. The repo has a grep guard against ad-hoc `/1e8` conversions.

### NOC Light design grammar (binding — sketch-findings-nodemonitor)
**Source:** skill `SKILL.md` + every component analog
**Apply to:** `CommandExport.tsx`, both mount-point edits
- Labels: `font-mono text-xs font-semibold tracking-[0.14em] uppercase` (panel heads/buttons) or `tracking-[0.06em]` (signal labels)
- Boxes: `rounded-[3px] border border-border bg-muted/40 px-3 py-2` (action-block style, InsightCardRow:137) or `rounded-md border border-border bg-card` (section style, NarrateButton:55)
- Interactive accent: navy via `text-brand` / `hover:text-brand-glow`; severity color does state only; no emoji, no icons-for-state
- Mono data: `font-mono text-xs`/`text-sm tabular-nums`; faint tiers `text-foreground/60` → `/45` → `/40`
- `cn()` from `@/lib/utils` for class merging

### Honest unsupported/degraded states (Phase 2 D-01 lineage)
**Source:** `ActiveSignalsPanel.tsx:42–43` ("absence IS the signal"), `InsightCardRow.tsx:152–161` (withheld block), NarrateButton error path
**Apply to:** LDK "not supported on LDK — manual procedure" branch, rebalance placeholder, validation-withheld state, clipboard failure copy
Render the honest state visibly in the same mono voice; never hide, never fake a command.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/lib/export/sanitize.ts` (comment-line sanitizer core) | utility | transform | No existing shell-comment/string sanitizer in the repo — only validation-and-throw (deeplink) and plain-text-render containment (NarrateButton). Build from RESEARCH Pitfall 2 prescription: strip control chars/newlines + `` ` ``/`$`/`\`, cap length; style it after deeplink's named-constant regex form. |
| Clipboard interaction (within `CommandExport.tsx`) | component logic | event-driven | First clipboard use in the repo; RESEARCH §Code Examples provides the verbatim handler (feature-detect, locked failure copy). |

## Metadata

**Analog search scope:** `src/lib/insight/**` (schema, types, guardrails, deeplink, detectors + tests), `src/components/insight/**`, `src/components/console/**`, `src/app/(overview)/[pubkey]/[tab]/page.tsx`, `src/app/(overview)/inbox/page.tsx`, `src/lib/format/**`, `.claude/skills/sketch-findings-nodemonitor/SKILL.md`
**Files scanned:** 16 read in full or targeted range; 40+ listed/grepped
**Pattern extraction date:** 2026-06-12
