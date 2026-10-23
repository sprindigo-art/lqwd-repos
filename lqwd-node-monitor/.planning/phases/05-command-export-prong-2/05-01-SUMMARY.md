---
phase: 05-command-export-prong-2
plan: 01
subsystem: command-export
tags: [security, validation, sanitization, pure-module, tdd]
requires:
  - "@/lib/insight/schema (frozen SuggestedActionSchema — Gate 1 re-parse source)"
provides:
  - "src/lib/export/block.ts — ExportBlock/ExportStep serializable type contract"
  - "src/lib/export/sanitize.ts — sanitizeCommentText() comment-line sanitizer"
  - "src/lib/export/validate.ts — validateActionForExport() + CHANNEL_POINT_RE/TXID_RE/PUBKEY_RE/CHAN_ID_RE + safeSatPerVbyte()"
affects:
  - "plan 05-03 (command builders) — stands on this validation/sanitization floor"
  - "plan 05-02+ (UI mount points) — consume the ExportBlock prop contract"
tech-stack:
  added: []
  patterns:
    - "validate-before-interpolate (deeplink.ts structure), but returns { ok, reason? } instead of throwing"
    - "named-constant format regexes (deeplink.ts style)"
    - "pure module — no server-only/DB/env; vitest runs with zero infrastructure"
key-files:
  created:
    - src/lib/export/block.ts
    - src/lib/export/sanitize.ts
    - src/lib/export/sanitize.test.ts
    - src/lib/export/validate.ts
    - src/lib/export/validate.test.ts
  modified: []
decisions:
  - "chanId / suggestedSatPerVbyte are SOFT fields — never withhold the export; builders degrade them (A2). Only command-bound identifiers (channelPoint, partnerPubkey, outpointTxid, amountSat) get HARD gates."
  - "update_fee + investigate return ok:false structurally — fees are the Phase 6 queue prong (project D3), so a fee export cannot exist."
metrics:
  duration: ~8 min
  completed: 2026-06-13
  tasks: 2
  files: 5
requirements: [EXPORT-01]
---

# Phase 5 Plan 01: Export Validation/Sanitization Foundation Summary

Two-gate command-export param validator (frozen-schema re-parse + per-field format regexes) plus a comment-line sanitizer and the plain-serializable `ExportBlock` contract — the security floor every Phase 5 command builder stands on, built test-first with zero DB/server dependencies.

## What Was Built

**Task 1 — `ExportBlock` contract + comment-line sanitizer**
- `block.ts`: zero-dependency type module exporting `ExportStep` (`label`/`command`/`note`) and `ExportBlock` (`title`/`contextLines`/`safetyLines`/`steps`/`copyAll`). Strings/numbers/null only — crosses the Server-Component → client-leaf boundary as props.
- `sanitize.ts`: `sanitizeCommentText(input, maxLen = 120)` strips all C0/C1 control chars (`\x00-\x1F`, `\x7F` — covers `\n`/`\r`/`\t`) plus the shell-active set `` ` ``/`$`/`\` via one named regex, then truncates. Neutralizes the peer-chosen-alias breakout class (T-05-02 / Pitfall 2, T-04-19 lineage).
- `sanitize.test.ts`: 6 tests — newline/CR collapse, shell-active strip, default + custom cap, normal-alias passthrough, full control-char strip.

**Task 2 — Two-gate param validator**
- `validate.ts`: `validateActionForExport(action)` → `{ ok: true } | { ok: false; reason }`.
  - **Gate 1**: `SuggestedActionSchema.safeParse` (frozen contract re-parse) — short-circuits on any shape/type failure before regexes run.
  - **Gate 2**: HARD per-type format gates on command-bound params — `close_channel.channelPoint` (CHANNEL_POINT_RE), `rebalance.partnerPubkey` (PUBKEY_RE) + `amountSat` (positive safe int), `remediate_pending.outpointTxid` (TXID_RE when present) + `channelPoint` (CHANNEL_POINT_RE when present).
  - `update_fee`/`investigate` → `ok:false` structurally (T-05-03).
  - Exports `CHANNEL_POINT_RE`, `TXID_RE`, `PUBKEY_RE`, `CHAN_ID_RE`, `safeSatPerVbyte` (integer 1..5000 or null), and an internal `isPositiveSafeInt` helper.
- `validate.test.ts`: 20 tests — valid-action acceptance, channelPoint injection suite (`;`, `\n`, `` ` ``, `$(`, `&&`, uppercase-hex, path-traversal), pubkey/amount/txid rejection, soft-field passthrough, schema-gate-first (extra key / wrong type / non-object), `safeSatPerVbyte` range, regex unit checks.

## TDD Gate Compliance

Both `tdd="true"` tasks followed RED → GREEN:
- Task 1: `sanitize.test.ts` written first, failed with "Cannot find package '@/lib/export/sanitize'", then implementation made 6 tests green.
- Task 2: `validate.test.ts` written first, failed (no tests / missing module), then implementation made 20 tests green.

`block.ts` is a pure type module (no runtime behavior) so it carries no separate failing test — its acceptance is structural (`grep -c "import"` → 0, exact field shape).

## Verification Results

- `npx vitest run src/lib/export` → 2 files, 26 tests passed.
- `npx tsc --noEmit` → clean (0 output lines).
- `grep -rn 'import "server-only"' src/lib/export/` → none.
- `grep -rn '@/lib/db' src/lib/export/` → none; `grep -rn 'process.env'` → none.
- `grep -c "import" src/lib/export/block.ts` → 0 (pure type module).
- `validate.ts` contains `from "@/lib/insight/schema"` and `export function validateActionForExport(`; all four regexes + `safeSatPerVbyte` exported.

## Deviations from Plan

None — plan executed exactly as written. The schema nests params under `action.params` (frozen contract); fixtures and the validator access `a.params.*` accordingly, which is the existing contract shape, not a deviation.

## Threat Model Coverage

- **T-05-01** (Tampering, validate.ts) — mitigated: two-gate validate-then-interpolate; injection unit tests for `;`, `\n`, `` ` ``, `$(` all return `ok:false`.
- **T-05-02** (Tampering, sanitize.ts) — mitigated: control-char + `` ` ``/`$`/`\` strip with hostile-alias fixture test.
- **T-05-03** (Elevation, update_fee/investigate) — mitigated: structurally non-exportable (`ok:false`).
- **T-05-SC** (npm installs) — accepted: zero packages installed by this plan.

No new threat surface introduced (pure modules, no I/O).

## Commits

- `b2e9d09` feat(05-01): ExportBlock contract + comment-line sanitizer
- `76f7fdd` feat(05-01): two-gate param validator for command export

## Self-Check: PASSED

- FOUND: src/lib/export/block.ts
- FOUND: src/lib/export/sanitize.ts
- FOUND: src/lib/export/sanitize.test.ts
- FOUND: src/lib/export/validate.ts
- FOUND: src/lib/export/validate.test.ts
- FOUND commit: b2e9d09
- FOUND commit: 76f7fdd
