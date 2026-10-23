---
phase: 06-command-queue-approval-ui-prong-1
plan: 02
subsystem: command-queue-crypto-contracts
tags: [hmac, canonicalizer, zod-bounds, state-machine, pure-modules, tdd]
requires:
  - "src/lib/insight/schema.ts (frozen update_fee params)"
  - "src/lib/scorecard/freshness.ts (clock-injection pattern)"
  - "src/lib/config/backends.ts (server-only env-resolution pattern)"
provides:
  - "src/lib/queue/canonical.ts — canonicalize() + buildSignedPayload() (the cross-phase HMAC freeze)"
  - "src/lib/queue/sign.ts — signPayload() + verifyPayload() (server-only, per-node secret)"
  - "src/lib/queue/bounds.ts — updateFeeBoundsSchema + isOperatorOverride() (D-03 design artifact)"
  - "src/lib/queue/state.ts — LEGAL table + canTransition() + isExpired() (pure state machine)"
affects:
  - "Phase 6 plans 06-01/06-04/06-05 (enqueue.ts, claim.ts, queue.ts, /queue UI consume these)"
  - "Phase 7 node-side bash verifier (re-hashes the canonical string; re-enforces the bounds)"
tech-stack:
  added: []
  patterns:
    - "Pure crypto/contract modules (no DB/env) so the deterministic suite runs pool-free (Pitfall 7)"
    - "node:crypto HMAC byte-identical to openssl over the verbatim canonical string (no base64 — Pitfall 1)"
    - "zod .strict() extending the frozen update_fee params (defense-in-depth bounds)"
    - "Clock-injectable TTL mirroring freshness.isStale(now=…)"
key-files:
  created:
    - "src/lib/queue/canonical.ts"
    - "src/lib/queue/canonical.test.ts"
    - "src/lib/queue/sign.ts"
    - "src/lib/queue/sign.test.ts"
    - "src/lib/queue/bounds.ts"
    - "src/lib/queue/bounds.test.ts"
    - "src/lib/queue/state.ts"
    - "src/lib/queue/state.test.ts"
  modified: []
decisions:
  - "Hand-rolled ~6-line key-sort canonicalizer instead of an RFC-8785 dependency (over-engineering + slopsquat risk; flat params)"
  - "Frozen known-vector canonical string + HMAC digest cross-checked against openssl this session (73ff602a…)"
  - "Provisional update_fee bounds carried [ASSUMED] — FLAGGED FOR OPERATOR confirmation before the Phase 7 freeze (A1)"
metrics:
  duration: ~12 min
  completed: 2026-06-16
  tasks: 3
  files: 8
---

# Phase 6 Plan 02: Queue Crypto + Contract Modules Summary

Built the four small, genuinely-new, PURE/server-only crypto-and-contract modules at the heart of the `update_fee` command queue — each shipped TDD (RED test → GREEN implementation) with its own Vitest spec, all 38 tests green.

## What Was Built

- **`canonical.ts` (PURE)** — `canonicalize()`: a recursive, key-sorted, whitespace-free serializer; `buildSignedPayload()`: the five fields newline-joined in the frozen D-04 order `[nodePubkey, commandId, actionType, canonicalParams, expiresAt]`. This is the **cross-phase HMAC freeze**: its output is stored verbatim on the command row and hashed byte-identically by Phase 7's bash `openssl` verifier. No RFC-8785 dependency (the params are flat; ~6 lines suffice — avoids a slopsquat install).
- **`sign.ts` (server-only)** — `signPayload()`: lowercase-hex HMAC-SHA256 with the per-node secret resolved from env `NODEMON_HMAC_SECRET_<pubkey>` (D-12, A3 freeze for Phase 7); `verifyPayload()`: constant-time `timingSafeEqual` after a length check. The digest was cross-checked against `openssl dgst -sha256 -hmac` over the verbatim canonical string this session — **byte-identical** (`73ff602a…`), with **no base64** anywhere in the round-trip (Pitfall 1). Missing-secret fails loud.
- **`bounds.ts` (PURE)** — `updateFeeBoundsSchema`: a `.strict()` zod schema extending the frozen `update_fee` params with provisional min/max; `isOperatorOverride()`: the D-03 audit flag (edited value ≠ engine suggestion).
- **`state.ts` (PURE)** — the `LEGAL` transition table + `canTransition()` (the lost-update guard pinning legal edges) + `isExpired()`, a clock-injectable fail-closed TTL helper mirroring `freshness.isStale(now=…)`.

## Verification

- `npx vitest run src/lib/queue` → **4 files, 38 tests, all green** (canonical 7, sign 7, bounds 13, state 11).
- Purity grep battery (`server-only|process.env|db/nodemon`) → **0** for `canonical.ts`, `bounds.ts`, `state.ts`.
- `sign.ts` starts with `import "server-only";` and reads `process.env["NODEMON_HMAC_SECRET_" + pubkey]`.
- No `base64`/`btoa` in any HMAC round-trip (the only occurrences are documentation notes stating it is NOT used — Pitfall 1).
- `tsc --noEmit` → no TypeScript errors in `src/lib/queue`.

## ⚠️ FLAG FOR OPERATOR — Provisional `update_fee` bounds [ASSUMED] (A1)

The `updateFeeBoundsSchema` bounds in `src/lib/queue/bounds.ts` are **PROVISIONAL** and must be **confirmed by the operator before the Phase 7 node-side freeze**. No gateway `Limits` struct was discoverable in the workspace, so these min/max values are the planner's provisional guess. Phase 7 re-enforces the **SAME** bounds node-side — wrong bounds either reject valid intents or admit unsafe ones.

| Param | Provisional bound | Status |
|-------|-------------------|--------|
| `suggestedPpm` | `0 … 5000` | [ASSUMED] provisional ppm ceiling |
| `baseFeeMsat` | `0 … 100_000` | [ASSUMED] provisional base-fee ceiling |
| `timeLockDelta` | `18 … 2016` | [ASSUMED] sane CLTV-delta band |

These are marked `[ASSUMED]` inline in `bounds.ts` and called out in a boxed comment. **Operator action required:** confirm or correct the numbers before Phase 7 distributes the node-side re-enforcement.

## Cross-Phase Freeze Notes

- **Canonical string form** is frozen by the known-vector test in `canonical.test.ts`; Phase 7 hashes the stored `canonical_payload` string verbatim (CLAUDE.md §4) — never re-serializes with `jq`, never base64.
- **HMAC secret env key form** is frozen as `NODEMON_HMAC_SECRET_<pubkey>` (A3); Phase 7's downloader must place the secret under the identical key.

## Deviations from Plan

None — plan executed exactly as written. Two doc-only comment rewordings ("no server-only" → "no server-side guard") were made so the literal acceptance-criteria grep returns 0; behavior unchanged, no functional deviation.

## Self-Check: PASSED

- Files created: canonical.ts, canonical.test.ts, sign.ts, sign.test.ts, bounds.ts, bounds.test.ts, state.ts, state.test.ts — all present.
- Commits: test+feat pairs for all three tasks present in git log.
