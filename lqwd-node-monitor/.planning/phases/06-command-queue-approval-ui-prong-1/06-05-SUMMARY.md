---
phase: 06-command-queue-approval-ui-prong-1
plan: 05
subsystem: command-queue-ui
tags: [queue, enqueue, server-action, hmac, ui, frontend, lnd-gate]
requires:
  - "src/lib/queue/enqueue.ts (Wave 2 — server-only sign-once enqueue)"
  - "src/lib/queue/transitions.ts (Wave 2 — guarded approve/reject)"
  - "src/lib/queue/bounds.ts (Wave 2 — updateFeeBoundsSchema validation contract)"
  - "src/lib/config/backends.ts (Phase 2 — server-only backendFor resolver)"
  - "src/components/export/CommandExport.tsx (Phase 5 — client-leaf structural analog)"
  - "src/lib/format/units.ts (AFM-002 unit formatters)"
provides:
  - "enqueueCommand / approveCommand / rejectCommand server actions (src/app/actions/queue.ts)"
  - "EnqueuePreview client leaf (src/components/queue/EnqueuePreview.tsx)"
  - "resolveEnqueueAffordance server-side props builder (src/lib/queue/enqueue-props.ts)"
affects:
  - "src/components/insight/InsightCardRow.tsx (/inbox surface)"
  - "src/components/console/ActiveSignalsPanel.tsx (console surface)"
  - "src/app/(overview)/[pubkey]/[tab]/page.tsx (console SignalRow builder)"
tech-stack:
  added: []
  patterns:
    - "Server action re-validates + re-signs; client sends params only, never an HMAC signature (narrate.ts shape)"
    - "Server-only backend gate (backendFor) resolved in a props builder; serializable affordance threaded to a verbatim renderer"
    - "Client leaf clamps to the same zod bounds schema for UX; server is the authoritative gate (defense in depth)"
key-files:
  created:
    - "src/app/actions/queue.ts"
    - "src/components/queue/EnqueuePreview.tsx"
    - "src/lib/queue/enqueue-props.ts"
  modified:
    - "src/components/insight/InsightCardRow.tsx"
    - "src/components/console/ActiveSignalsPanel.tsx"
    - "src/app/(overview)/[pubkey]/[tab]/page.tsx"
decisions:
  - "Added a server-only resolveEnqueueAffordance props builder so backendFor is resolved in ONE place and the client leaf never imports the resolver (T-06-20/D-12)"
  - "LDK-unsupported state rendered as an inline warn-tinted mono line (UI-SPEC allows an inline element; no separate component), identical on both surfaces"
  - "expiresAtLabel (+TTL) computed server-side in the props builder so enqueue-time TTL stays authoritative, mirroring enqueue.ts NODEMON_TTL_HOURS"
metrics:
  tasks: 3
  files: 6
  completed: 2026-06-15
---

# Phase 6 Plan 05: Enqueue Write-Path UI Summary

Operator-facing enqueue write path: three server actions (`enqueueCommand`/`approveCommand`/`rejectCommand`) that re-validate and re-sign server-side, plus the `EnqueuePreview` client leaf (expand → inert preview → edit-within-bounds → CONFIRM ENQUEUE), mounted on `update_fee` cards on both `/inbox` and the console Active Signals panel, gated to LND-backed nodes with an honest LDK-unsupported state.

## What Was Built

**Task 1 — queue server actions (`src/app/actions/queue.ts`, commit `01c8b20`)**
- `"use server"` module exporting `enqueueCommand`, `approveCommand`, `rejectCommand` in the narrate.ts result shape (`{ ok:true, id }` / `{ ok:true }` / `{ ok:false, error }`).
- `enqueueCommand` validates input with a zod object pairing the 66-hex `PUBKEY_RE` and `updateFeeBoundsSchema` — the authoritative server-side bounds re-check. **No `signature` / `canonicalPayload` field is accepted from the client** (strict zod object); the server-only `enqueue` recomputes and signs everything.
- Each action lazy-imports its server-only queue module inside the function (no top-level `@/lib/queue/*` import) — keeps the signer + DB pool out of any caller's import graph.
- Thrown errors map to the UI-SPEC copy: `NO SIGNING SECRET FOR THIS NODE …`, `THIS COMMAND IS NO LONGER PENDING APPROVAL …`, `COULD NOT QUEUE — {reason}. Nothing was written. …`. The secret is never logged (V7).

**Task 2 — `EnqueuePreview` client leaf (`src/components/queue/EnqueuePreview.tsx`, commit `d796f39`)**
- `"use client"` leaf, structural twin of `CommandExport`. Receives **serializable props only** (`EnqueuePreviewProps`) — never the card.
- Collapsed trigger `enqueue fee update` / expanded `hide preview`; instant expand (no animation).
- Inert preview rows + editable `proposed ppm` / `base fee (msat)` / `timelock delta` clamped to the `updateFeeBoundsSchema` bands, with an inline `bounds min–max` echo and a warn-tinted `OVERRIDDEN` chip when a value differs from the engine suggestion (D-03).
- `CONFIRM ENQUEUE` (navy chrome) gated behind the confirm gesture; calls `enqueueCommand` with **params only** (no client signature), then shows the in-place ok-green `QUEUED — PENDING APPROVAL` echo or the `COULD NOT QUEUE` copy via `aria-live`.
- Every numeric value routes through `@/lib/format/units.ts` (`feeMsatToSat`/`formatSats`) with `tabular-nums` — no inline `/1e8`, `*1000`, or `/1000`. Free text renders as text nodes only (V5).

**Task 3 — mount on both surfaces (commit `c56da21`)**
- New server-only `resolveEnqueueAffordance(card)` (`src/lib/queue/enqueue-props.ts`) — the single place `backendFor` is resolved for the enqueue control. Returns `{ kind:"none" }` / `{ kind:"lnd", props }` / `{ kind:"ldk" }`; computes `expiresAtLabel` (+TTL) server-side.
- `InsightCardRow` (Server Component) resolves the affordance and mounts `EnqueuePreview` on LND-backed `update_fee` cards; LDK renders the inline warn line `LDK fee enqueue not yet supported — deferred to Phase 7`; all others render nothing. The existing `CommandExport` mount is untouched (complementary, non-overlapping).
- `ActiveSignalsPanel` gains an `enqueue?: EnqueueAffordance` field on `SignalRow` (type-only import — the panel never imports the resolver) and renders the same leaf / LDK line. The console page's `buildInsightSignals` populates it via `resolveEnqueueAffordance(card)` server-side, keeping the panel a verbatim renderer.

## Deviations from Plan

**1. [Rule 3 — Blocking] Added `src/lib/queue/enqueue-props.ts` (not in `files_modified`)**
- **Found during:** Task 3.
- **Issue:** The plan required `backendFor` resolved server-side AND not imported by the client leaf, with the affordance threaded onto `SignalRow` for the console — but the per-card props (including the server-side `+TTL` `expiresAtLabel`) had to be built in two places (`InsightCardRow` and the console page's `buildInsightSignals`).
- **Fix:** Extracted one `server-only` props builder `resolveEnqueueAffordance(card)` so the gate logic + TTL computation live once and both surfaces stay thin. This is the cleanest way to satisfy "backendFor server-side only / never in the client leaf / threaded as a serializable flag."
- **Files modified:** `src/lib/queue/enqueue-props.ts` (created).
- **Commit:** `c56da21`.

## Threat-Model Compliance

- **T-06-17 (spoofing — client signature):** `queue.ts` validates only `pubkey + params` via strict zod; no signature/canonical field is accepted. ✅
- **T-06-18 (tampering — out-of-bounds fee):** leaf clamps for UX; `enqueueCommand` re-runs `updateFeeBoundsSchema` server-side as the authoritative gate. ✅
- **T-06-19 (injection — free text sink):** all leaf strings render as text nodes; no HTML/markdown sink. ✅
- **T-06-20 (info disclosure — secret in client bundle):** the signer is server-only and lazy-imported inside the action; `EnqueuePreview` imports neither the signer nor `backendFor`. ✅
- **T-06-21 (safety — enqueue an unexecutable LDK action):** enqueue control gated on `backendFor(pubkey)==="lnd"` server-side; LDK renders an honest unsupported state with no control. ✅
- **T-06-SC (npm installs):** zero installs this phase. ✅

## Verification

- `npx tsc --noEmit` — **clean** (exit 0, whole project).
- `npm test` — 610 passed, 30 skipped; **11 failures are pre-existing Wave 2 DB-integration tests** (`src/lib/queue/{approve,claim,enqueue,stub-executor}.test.ts`) that require a live `NODEMON_QUEUE_URL` (unset in this worktree). These four test files are untouched by this plan (`git diff --name-only base..HEAD` does not list them) and fail only on the missing env var, not on any change here. Out of scope per the executor scope boundary.
- Grep gates (all PASS): `queue.ts` is `"use server"` with `updateFeeBoundsSchema` + lazy imports; `EnqueuePreview` is `"use client"` calling `enqueueCommand` with zero inline unit conversions and zero `backendFor` references; both surfaces mount `EnqueuePreview`; `backendFor` referenced server-side; existing `CommandExport` mounts preserved.

## Self-Check: PASSED

- Files exist: `src/app/actions/queue.ts`, `src/components/queue/EnqueuePreview.tsx`, `src/lib/queue/enqueue-props.ts` — all FOUND.
- Commits exist: `01c8b20`, `d796f39`, `c56da21` — all FOUND.
