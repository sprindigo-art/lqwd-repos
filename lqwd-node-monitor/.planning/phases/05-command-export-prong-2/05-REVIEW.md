---
phase: 05-command-export-prong-2
reviewed: 2026-06-15T00:00:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - src/components/export/CommandExport.tsx
  - src/lib/export/block.ts
  - src/lib/export/commands.ts
  - src/lib/export/sanitize.ts
  - src/lib/export/validate.ts
  - src/components/console/ActiveSignalsPanel.tsx
  - src/components/insight/InsightCardRow.tsx
  - src/lib/insight/engine.ts
  - src/lib/insight/detectors/fee-signals.ts
  - src/lib/insight/detectors/rebalance.ts
  - src/app/(overview)/[pubkey]/[tab]/page.tsx
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 5: Command Export (Prong 2) — Code Review Report

**Reviewed:** 2026-06-15
**Depth:** deep (cross-file: builder → validation → schema → detector → component boundary)
**Files Reviewed:** 11 source files (+ 3 test files cross-checked)
**Status:** issues_found

## Summary

Adversarial review of the client-side command-export layer. The phase's two load-bearing invariants both hold under scrutiny:

1. **Zero-write-path** — CONFIRMED. Grep across `src/lib/export/` and `src/components/export/` finds no `@/lib/db`, no `fetch(`, no `"use server"`, no `server-only`, no `dbRouting`/`.execute`, no `drizzle`. The only side effect is `navigator.clipboard.writeText` in the client leaf. The export libs are pure modules; the components are Server Components except the single `"use client"` leaf, which receives plain serializable `ExportBlock` props (no card crosses the boundary).
2. **Command-injection safety** — STRONG. The validate-then-interpolate discipline (Pattern 1) is implemented faithfully: every value reaching a *bare command* is gated by a hard format regex (`CHANNEL_POINT_RE`, `PUBKEY_RE`, `CHAN_ID_RE`, `TXID_RE`, `safeSatPerVbyte`) at the interpolation site, and every card-sourced string reaching a `#` comment passes `sanitizeCommentText` (strips `\x00-\x1F`, `\x7F`, backtick, `$`, `\`). I traced each builder; I could not construct an input that breaks a metacharacter out of a command or comment. Injection unit tests cover `;`, newline, `$(`, backtick, uppercase-hex, and path-traversal fixtures.

No BLOCKER-class defects found. The findings below are robustness gaps and quality issues — none compromise correctness or safety of the shipped behavior, but four warrant fixing before this layer is extended in Phase 6.

The most material gaps: (1) `sanitizeCommentText` does not strip the bidi/RTL-override Unicode control set, so a hostile alias can still visually reorder a `#` comment line in a terminal/editor (a Trojan-Source-class spoof, not an injection); (2) the `bumpforceclosefee` alternative is appended to `copyAll` but exists in no `ExportStep`, so per-step COPY cannot grab it and the COPY-ALL/per-step contract silently diverges; (3) several runtime `as` casts in `commands.ts` bypass the discriminated union and would mask a future schema drift; (4) `validateActionForExport` relies on TypeScript exhaustiveness with no runtime default, returning `undefined` if a new action type is ever added to the schema without a matching case.

> Note: the WR-01 fix snippet below references the dangerous Unicode codepoints by `\u` escape ONLY — never embed the literal characters in source or in this artifact (doing so re-introduces the very spoofing vector being fixed).

## Warnings

### WR-01: `sanitizeCommentText` does not neutralize Unicode bidi/RTL-override controls (comment-line spoofing)

**File:** `src/lib/export/sanitize.ts:19,26-28`
**Issue:** `COMMENT_UNSAFE_RE` strips C0/C1 controls and the shell-active ASCII set, but NOT the Unicode bidirectional-override characters (the RLO/LRO/PDF/isolate set in the ranges `U+202A`–`U+202E` and `U+2066`–`U+2069`) or zero-width format controls (e.g. `U+200B`–`U+200F`). A peer-chosen alias is remote-controlled data (the threat the file's own header cites, T-04-19). An alias containing an embedded right-to-left override, rendered into a `#` comment that an operator pastes into a terminal or ops ticket, can be made to *display* in a misleading order (Trojan-Source-class visual spoofing) — the displayed context line differs from its byte content. This is not shell injection (the line stays a comment), but it defeats the "self-documenting, trustworthy context echo" purpose of D-04/D-05: the operator cannot trust what the comment block displays. The hostile-alias test only asserts absence of backtick/`$`/`\n`; it does not cover bidi.
**Fix:** Extend the strip set to include the bidi/zero-width format-control ranges, expressed as `\u` escapes so no literal invisible character ever appears in source:
```typescript
// Add Unicode bidi / zero-width format overrides to the strip set
// (Trojan-Source visual spoofing). Escapes only — never paste the literals.
const COMMENT_UNSAFE_RE =
  /[\x00-\x1F\x7F`$\\\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
```
Add a hostile-alias bidi fixture (built from `String.fromCharCode(0x202e)`, not a pasted literal) to `sanitize.test.ts`.

### WR-02: `bumpforceclosefee` alternative lives only in `copyAll`, breaking the per-step / copy-all parity contract

**File:** `src/lib/export/commands.ts:346-351`
**Issue:** In `bumpFeeExport`, the anchor-channel alternative is string-appended to `copyAll` *after* `assembleCopyAll` runs:
```typescript
copyAll += `\n# alternative (anchor channels): lncli wallet bumpforceclosefee ${params.channelPoint}`;
```
This command appears in COPY-ALL but in no `ExportStep`, so (a) the UI never renders a per-step COPY for it (D-02 says "every runnable command/step gets its own COPY button"), and (b) the line is a `# comment` carrying a real runnable command — an operator who copies-all gets a commented-out command they must hand-edit, while a per-step copier never sees it at all. The two copy modes silently diverge in content, which is exactly the D-02/D-04 contract this phase is meant to keep honest. It is also the only command-bearing line in the module that bypasses the structured `steps[]` representation, so any future consumer iterating `block.steps` (e.g. Phase 6) will miss it.
**Fix:** Represent the alternative as a real `ExportStep` (note or command) so it flows through `assembleCopyAll` and the per-step renderer uniformly, rather than post-appending a raw string to `copyAll`. If it must stay a non-runnable hint, make it a `note`-only step so both copy modes agree.

### WR-03: `validateActionForExport` has no runtime fallback — returns `undefined` if the schema gains a new action type

**File:** `src/lib/export/validate.ts:52-97`
**Issue:** The function's `switch (a.type)` covers all five current union members and relies solely on TypeScript exhaustiveness; there is no `default` branch and no trailing `return`. The declared return type is `ValidateResult`, but at runtime, if `SuggestedActionSchema` is ever extended with a sixth action type (the schema is explicitly designed to be extended in Phase 6 per its header), `safeParse` will succeed, no `case` will match, and the function returns `undefined`. The caller `buildExportBlock` does `if (!result.ok)` — `undefined.ok` throws a TypeError at that point, crashing the Server Component render (and `loadInsightView`'s degrade wrapper does NOT wrap the synchronous `buildExportBlock` call in the page/row). A validation gate that throws on an unrecognized-but-schema-valid action is a fail-open-then-crash hazard for a security boundary.
**Fix:** Add an explicit fail-closed default with a compile-time exhaustiveness guard:
```typescript
    case "update_fee":
    case "investigate":
      return { ok: false, reason: "action type not exportable" };
    default: {
      const _exhaustive: never = a;
      return { ok: false, reason: "unknown action type" };
    }
```

### WR-04: Unchecked runtime `as` casts in `commands.ts` bypass the discriminated union (defeats schema drift detection)

**File:** `src/lib/export/commands.ts:154,178,214-218,424,477`
**Issue:** Multiple builders re-shape `card.suggestedAction` with a bare `as` cast instead of narrowing on `.type`, e.g.:
```typescript
const params = (card.suggestedAction as { params: { chanId: string; channelPoint: string } }).params;
```
and `buildRemediateExport` casts to `{ params: RemediateParams }`, and `ldkContextLines` does `card.suggestedAction!`. These run *after* `validateActionForExport` succeeded, so they are sound *today*, but the cast asserts a shape the compiler no longer verifies. If the frozen schema's param shape ever drifts (Phase 6 signing-surface edits are anticipated), these casts will silently read `undefined` fields and interpolate `"undefined"` into commands rather than failing the type check. The codebase's own convention (deeplink.ts, stuck-pending.ts) narrows by discriminant; these casts break that convention precisely in the security-sensitive module. CLAUDE.md flags loose casts as a quality violation.
**Fix:** Narrow on the discriminant instead of casting. The dispatcher already switches on `action.type`; pass the narrowed `action` (whose `.params` is correctly typed) into each builder rather than re-casting `card.suggestedAction` inside the builder.

## Info

### IN-01: `aria-live="polite"` placed on the `<button>` rather than a dedicated status region

**File:** `src/components/export/CommandExport.tsx:65-75`
**Issue:** `aria-live="polite"` is set on the COPY `<button>` whose text content swaps between `COPY`/`COPIED`/`COPY FAILED`. Live regions on interactive controls are inconsistently announced across screen readers; the conventional pattern is a separate visually-hidden `role="status"` region that receives the state text. The UI-SPEC (line 120) specifies "announced via `aria-live="polite"`" but does not require it be on the button itself.
**Fix:** Move the live announcement into a sibling visually-hidden `<span role="status" aria-live="polite">` and keep the button label purely visual.

### IN-02: COPY-state revert timer is not cleared on unmount (stale-closure setState)

**File:** `src/components/export/CommandExport.tsx:53-58`
**Issue:** `handleCopy` schedules `window.setTimeout(() => setState("idle"), 1500)` with no cleanup. If the user collapses the block (the parent conditionally unmounts the expanded `<div>`, which unmounts `CopyButton`) within 1.5s of a copy, the timer fires `setState` on an unmounted component. In React 19 this is a no-op rather than the old warning, so impact is cosmetic, but it is a latent leak and an anti-pattern. Not a correctness bug.
**Fix:** Track the timeout id in a ref and clear it in a `useEffect` cleanup, or guard with an `isMounted`/`AbortController` pattern.

### IN-03: Inline `#` comment baked into the bare `pendingsweeps` command

**File:** `src/lib/export/commands.ts:321-328`
**Issue:** `bumpFeeExport` builds `step1.command = "lncli wallet pendingsweeps   # find <outpoint>, check broadcast_attempts"`. Per-step COPY grabs the bare command *including* this trailing inline comment. It is valid shell (an inline comment is inert), and the outpoint is sanitized, so this is safe — but it slightly contradicts the D-02 hard rule that "per-step COPY copies the bare command only" (RESEARCH/UI-SPEC line 124). The restart/aged-funding builders do the same with `# <jq filter>`. Acceptable, but the "bare command only" wording is technically violated.
**Fix:** Either move the hint into the step `note`/`label` so the copied command is truly bare, or accept and document that verify-step commands intentionally carry an inline jq-filter hint.

### IN-04: `blockId` collision risk if a card id is non-unique within a list

**File:** `src/components/insight/InsightCardRow.tsx:162` and `src/components/console/ActiveSignalsPanel.tsx:92`
**Issue:** Two different `blockId` schemes: the inbox uses `export-${card.id}` (id is the D-08 dedupe key, stable and intended-unique) and the console uses index-based `export-signal-${i}`. `aria-controls` requires the referenced id to exist and be unique in the document. The card-id scheme is correct; the index scheme is also fine within one panel. No live collision exists today, but the divergence is a footgun and the index scheme would break if `ActiveSignalsPanel` ever rendered alongside another panel reusing the same index space.
**Fix:** Use a single stable scheme (prefer the card id) on both surfaces. The page already has the card in `buildInsightSignals`; thread the id through `SignalRow` rather than relying on map index.

### IN-05: `safety:` warn-tint prefix applied uniformly to non-safety guidance lines

**File:** `src/components/export/CommandExport.tsx:124-128` + `src/lib/export/commands.ts:234-236,302,403`
**Issue:** The leaf renders every `safetyLines[]` entry with a `safety:` warn-tinted prefix. For the rebalance builder the "safety" line is actually operational guidance ("rebalancing runs through the fleet's custom circular-rebalance script ... verify liquidity first"), and for `bump_fee` it is a sanity-check reminder — neither is a danger note, yet both render in the same warn tint as the genuine `ABANDON_DANGER` / AP-11 freeze notes. The visual grammar (UI-SPEC Color table) reserves warn tint for state; applying it to routine guidance dilutes the signal so the real DANGER lines do not stand out. Cosmetic / honest-state quality, not a bug.
**Fix:** Either split `safetyLines` into `safety` vs `note` tiers, or reserve the warn `safety:` prefix for the genuinely destructive notes and render guidance in neutral muted text.

---

## Cross-cutting verifications (passed — no finding)

- **Raw-integer-in-command (Pitfall 8):** Confirmed. The only numeric entering a bare command is `rate` (gated 1–5000 by `safeSatPerVbyte`) and the `txid`/`idx` split from a `CHANNEL_POINT_RE`-validated point. `formatSats` appears only in `ctx()`/comment lines. The suite asserts no comma in any bare command.
- **Withheld state (T-05-01):** Confirmed. `withheldBlock` emits no param echo, no partial command, `copyAll: null` — verified by test with a `; rm -rf` channelPoint fixture.
- **LDK fallback gate ordering:** Confirmed. `buildExportBlock` runs the validate gate (step 2) BEFORE the LDK branch (step 3), so a malformed action on an LDK node still withholds rather than echoing bad params. LDK branch emits no runnable command.
- **Suppression gate (Pitfall 5):** Confirmed. `update_fee`/`investigate` rejected by `validateActionForExport`; suppressed cards arrive with `suggestedAction: null` and short-circuit at `buildExportBlock` line 448; fleet cards (`node === null`) short-circuit at line 450. Tests cover all four.
- **`?window=` prototype-pollution guard (page.tsx):** Confirmed. Uses `Object.prototype.hasOwnProperty.call(WINDOW_PRESETS, rawWindow)` (own-property only), not the `in` operator — correctly rejects `?window=constructor`/`toString`.
- **Detector detail enrichment is contract-safe:** Confirmed. `fee-signals.ts` and `rebalance.ts` conditional-add only `string|number` keys to the open `evidence.detail` record (schema.ts:91); no `.strict()` violation, no schema change. The final `InsightCardArraySchema.parse` in engine.ts:347 still gates every card.
- **No invented timelock (Pitfall 3):** Confirmed. No literal `80` reaches export output; the timelock-honesty comment routes csv_delay to the verify step.

---

_Reviewed: 2026-06-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
