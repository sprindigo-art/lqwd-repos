---
phase: 05-command-export-prong-2
plan: 03
subsystem: command-export
tags: [export, lncli, runbooks, pure-module, tdd, security]
requires:
  - "src/lib/export/block.ts (ExportBlock/ExportStep contract — plan 05-01)"
  - "src/lib/export/validate.ts (validateActionForExport + regexes + safeSatPerVbyte — plan 05-01)"
  - "src/lib/export/sanitize.ts (sanitizeCommentText — plan 05-01)"
  - "src/lib/insight/schema.ts (frozen InsightCard/SuggestedAction contract)"
  - "evidence.detail.capacitySat/peerAlias/partnerAlias enrichment (plan 05-02)"
provides:
  - "src/lib/export/commands.ts — buildExportBlock(card) dispatcher + close/rebalance/remediate pure builders"
affects:
  - "plan 05-04+ (UI mount points) — consume the ExportBlock produced by buildExportBlock"
tech-stack:
  added: []
  patterns:
    - "dispatcher + per-type/per-case private builders (stuck-pending.ts shape)"
    - "validate-before-interpolate gate → withheld block on failure (never a partial command)"
    - "shared assembleCopyAll helper enforcing the D-04 comment anatomy order"
    - "conditional context echo (unknown ≠ invented); formatSats in comments/UI only, raw ints in commands"
key-files:
  created:
    - src/lib/export/commands.ts
    - src/lib/export/commands.test.ts
  modified: []
decisions:
  - "Single coercion of the sweep output index comes ONLY from target.kind === 'sweep' (params carries txid only) — no invented index; non-sweep target routes to an honest take-from-step-1 note."
  - "bumpforceclosefee renders ONLY as a commented anchor-channel alternative gated on params.channelPoint (Pitfall 4); the primary bump is always wallet bumpfee on the sweep outpoint."
  - "LDK fallback ships and is unit-tested even though currently unreachable (DEFAULT_BACKENDS empty); NODE_BACKENDS can flip a node with zero code change."
metrics:
  duration: ~12 min
  completed: 2026-06-12
  tasks: 2
  files: 2
requirements: [EXPORT-01, PENDING-03]
---

# Phase 5 Plan 03: Command-Builder Module Summary

The pure `buildExportBlock(card)` command surface for the whole phase: a structural+validation-gated dispatcher assembling verify-step-first `ExportBlock`s with D-04 commented context, D-05 twice-rendered safety notes, the D-07 honest rebalance placeholder, the D-09/D-10 PENDING-03 runbooks, and the locked LDK honest fallback — every lncli flag verbatim from RESEARCH §4 (LND v0.20.1-beta), built test-first with zero DB.

## What Was Built

**Task 1 — dispatcher + close/rebalance/LDK/withheld (commits f4dcc81 RED, a59354a GREEN)**
- `buildExportBlock(card): ExportBlock | null` — three-stage gate then dispatch:
  1. structural: `suggestedAction === null` / non-exportable type / `node === null` → `null` (never inspects `evidence.detail.withheldAction`, T-05-03/T-04-16).
  2. `validateActionForExport` → on `ok:false` the locked WITHHELD block (`steps:[{command:null, note:"params failed validation — export withheld"}]`, `copyAll:null`, no param echo, T-05-01).
  3. `node.backend === "ldk"` → the locked honest fallback (full sanitized context echo, no runnable command, notes `not supported on LDK — manual procedure` + `coordinate with the LSPD operator`).
- `buildCloseExport`: title coop/force; context echo (node, peer via `detail.peerAlias` else truncated remotePubkey + "alias unknown", capacity via `formatSats`, chan_id echo-back, channel_point); verify step (`getchaninfo --chan_id` when `CHAN_ID_RE` passes else `--chan_point` fallback, plus `listchannels --peer` when `PUBKEY_RE` passes); close step splits the validated channelPoint into `--funding_txid/--output_index` (+`--force`); safety = coop HTLC-wait OR force CSV-lock note **plus** the timelock-honesty comment (Pitfall 3 — warehouse carries no CSV).
- `buildRebalanceExport` (D-07): context (node, partner, amount via `formatSats`, plain-words direction); step 1 read-only `listchannels --peer <partnerPubkey>`; step 2 command `null` with the locked placeholder note — no `bos`/`rebalance-lnd` anywhere.
- Shared helpers: `comment()` (sanitize + `# ` prefix), `truncPubkey()`, `ctx()` (sanitized key/value), `assembleCopyAll()` enforcing the D-04 order (context `#` → safety `#` → `# step N` header → bare command / note-as-comment).

**Task 2 — buildRemediateExport runbooks (commits 0a1ed26 RED, f57cd80 GREEN)**
- Sub-dispatch on `params.case` to three private builders, shared `remediateContextLines` (conditional-add from `evidence.detail`: channel_point/outpoint sanitized, limbo via `formatSats`, age `Math.round(ageHours)+"h"`, attempts).
- `bumpFeeExport` (D-10): step 1 `wallet pendingsweeps` (+ jq outpoint hint in copyAll); step 2 `wallet bumpfee --sat_per_vbyte <rate> <txid>:<idx>` with the outpoint POSITIONAL and the index sourced ONLY from `target.kind === "sweep"`. Honest states: `safeSatPerVbyte` null → no-rate note; non-sweep target → take-from-step-1 note (never invents an index). `bumpforceclosefee <channel_point>` appended as a commented anchor alternative ONLY when `params.channelPoint` is non-null (Pitfall 4). D-10 mempool sanity-check safety line.
- `restartProcedureExport` (D-09): step 1 `pendingchannels` (channelPoint jq filter); step 2 command `null` with 4 numbered key steps citing `05-fleet-coordination.sh`/`01-safe-lnd-restart.sh`, `lncli getinfo` synced_to_chain verify, pendingchannels re-check; AP-11 freeze-first safety; **no runnable restart command** (T-04-14). Blocks-past-maturity echoed from `evidence.observed`.
- `agedFundingExport` (RESEARCH §3): step 1 `pendingchannels` filter; step 2 guidance with `bitcoin-cli getmempoolentry`, CPFP `<change_index from lncli listunspent --min_confs=0>` operator-filled placeholder, 2016-block peer-initiated auto-forget note; abandonchannel DANGER as a safety line only — never a runnable step.

## TDD Gate Compliance

Both `tdd="true"` tasks followed RED → GREEN with separate commits:
- Task 1: `commands.test.ts` written first, failed `Cannot find package '@/lib/export/commands'`; implementation made 24 tests green (one over-strict test assertion corrected during GREEN — see Deviations).
- Task 2: 15 remediate tests appended, failed against the stub builder; implementation made all 66 export tests green (two over-strict fixture/assertion bugs corrected during GREEN — see Deviations).

Gate sequence in git log: `test(05-03)` → `feat(05-03)` for each task (f4dcc81→a59354a, 0a1ed26→f57cd80). No REFACTOR commit needed (functions clean, single coercion points).

## Verification Results

- `npx vitest run src/lib/export` → 3 files, 66 tests passed.
- `npx vitest run src/lib/export src/lib/insight` → 279 passed, 4 skipped (no regressions in the insight suite).
- `npx tsc --noEmit` → clean.
- `grep 'import "server-only"\|from "@/lib/db'` under `src/lib/export/` → none (pure module).
- `grep "sat_per_byte\|bumpclosefee"` in commands.ts → none (no deprecated flags).
- `bumpforceclosefee`/`abandonchannel` appear ONLY inside comment/note string content; `lncli wallet bumpfee --sat_per_vbyte` is the only runnable step-2 fee command.
- Suite-wide hygiene test: no `,` and no `formatSats`-grouped integer in any `step.command`; hostile alias renders single-line inert inside its `#` comment.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Over-strict hostile-alias copyAll assertion**
- **Found during:** Task 1 GREEN.
- **Issue:** the test asserted `copyAll` must not contain `rm -rf ~)`, but `sanitizeCommentText` (correctly, per plan 05-01) strips control chars + `` ` ``/`$`/`\` and NOT parentheses — so the inert string `evil(rm -rf ~)` legitimately survives inside a `#` comment line. The real security invariant is no newline breakout, not the absence of those characters.
- **Fix:** changed the assertion to verify the sanitized alias stays on a single `#`-prefixed comment line (the actual T-05-02 containment guarantee). Implementation unchanged.
- **Files modified:** src/lib/export/commands.test.ts. **Commit:** a59354a.

**2. [Rule 1 - Bug] Fixture `??` defeated an explicit-null test input**
- **Found during:** Task 2 GREEN.
- **Issue:** the `bumpFeeCard` fixture used `over.suggestedSatPerVbyte ?? 25`, so passing `null` (the null-rate test case) coalesced to `25` and the assertion `step2.command === null` failed against a correctly-rendered command.
- **Fix:** fixture now uses `"suggestedSatPerVbyte" in over` presence-checks to distinguish "not provided" (default 25) from "explicitly null". Implementation unchanged.
- **Files modified:** src/lib/export/commands.test.ts. **Commit:** f57cd80.

**3. [Rule 1 - Bug] `/50\b/` word-boundary regex mismatch**
- **Found during:** Task 2 GREEN.
- **Issue:** asserting `/50\b/` against `age=50h` fails — there is no word boundary between `0` and `h` (both word chars). The implementation correctly renders `50h` (49.5 rounded).
- **Fix:** assertion changed to `toContain("50h")`. Implementation unchanged.
- **Files modified:** src/lib/export/commands.test.ts. **Commit:** f57cd80.

All three were test-side bugs in newly-written tests, corrected within the same task's GREEN step; no production behavior changed.

## Threat Model Coverage

- **T-05-01** (Tampering, command interpolation) — mitigated: `validateActionForExport` gate before dispatch; `CHAN_ID_RE`/`CHANNEL_POINT_RE`/`PUBKEY_RE` re-checked at each interpolation site (verify-step, close split, bump outpoint); withheld block with no partial command on failure. Tested via the hostile-channelPoint withheld test.
- **T-05-02** (Tampering, comment lines) — mitigated: every card-sourced string routes through `comment()`/`ctx()` → `sanitizeCommentText` before entering `#` lines; hostile-alias hygiene test asserts single-line inert containment.
- **T-05-03** (Info disclosure / EoP, suppressed cards) — mitigated: structural null/non-exportable/fleet gate returns null; `withheldAction` never read. Suppressed/update_fee/investigate/fleet fixtures all assert null.
- **T-05-04** (EoP, restart/abandonchannel) — mitigated: restart key-steps and abandonchannel danger live in notes/safety lines only; tests assert no `step.command` contains `restart` or `abandonchannel`.
- **T-05-05** (Repudiation, invented safety data) — mitigated: timelock honesty comment defers CSV to the verify step; absent `evidence.detail` keys render no context line; null/out-of-bounds rate → honest no-rate state (no invented value).

No new threat surface introduced — pure module, no I/O, no new endpoints, no schema change.

## Known Stubs

None. The earlier per-task stub for `buildRemediateExport` was fully replaced in Task 2; the final module has no placeholder data paths. Honest-state notes (LDK manual procedure, rebalance placeholder, no-rate/no-outpoint, restart key-steps) are intentional locked-copy states from UI-SPEC/RESEARCH, not stubs.

## Self-Check: PASSED

- FOUND: src/lib/export/commands.ts (contains `export function buildExportBlock(` + `validateActionForExport` before interpolation)
- FOUND: src/lib/export/commands.test.ts (66 tests across both tasks)
- FOUND commit: f4dcc81 (Task 1 RED)
- FOUND commit: a59354a (Task 1 GREEN)
- FOUND commit: 0a1ed26 (Task 2 RED)
- FOUND commit: f57cd80 (Task 2 GREEN)
