---
phase: 05-command-export-prong-2
verified: 2026-06-15T14:10:00Z
status: passed
score: 3/3 roadmap success criteria verified (16/16 plan must-have truths verified)
overrides_applied: 0
re_verification: # none — initial verification
human_verification: [] # the one manual-only check (expand+copy interaction polish, NOC grammar) was operator-gated and APPROVED verbatim "approved looks good" on 2026-06-15 (05-VALIDATION.md Task 2)
---

# Phase 5: Command Export (Prong 2) Verification Report

**Phase Goal:** Operators can export client-side close/rebalance commands and pending-remediation runbooks as copy-able text, with ZERO write-path risk (no DB, no fetch, no server actions, no credentials in the export layer). Surfaces: the triage inbox insight cards AND the per-node console "Active Signals" panel.

**Verified:** 2026-06-15T14:10:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + merged PLAN must-haves)

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| SC1 | Closures & rebalances → ready-to-run fully-parameterized lncli/lncmd with context + safety notes, pure client-side, no DB/write path | ✓ VERIFIED | `commands.ts` `buildCloseExport` emits `lncli closechannel --funding_txid <txid> --output_index <idx>[ --force]` with verify-step-first anatomy; context echo (node, peer, capacity, chan_id, channel_point) + COOP/FORCE + timelock-honesty safety lines; rebalance honest placeholder. Zero-write-path greps 1-5 all reproduce clean. |
| SC2 | Each stuck-pending case → exported remediation runbook (bumpfee/CPFP w/ outpoint + sat/vB; FC-past-maturity → safe coordinated-restart procedure, NOT auto-restart) | ✓ VERIFIED | `bumpFeeExport` → `lncli wallet bumpfee --sat_per_vbyte <rate> <outpoint>` (positional); `restartProcedureExport` → key steps + `01-safe-lnd-restart.sh` pointer, NO runnable restart (test asserts no `step.command` contains "restart"); `agedFundingExport` with abandonchannel DANGER note. |
| SC3 | Every exported command echoes full context (chan point, peer, limbo, age, attempts) + safety notes, with params strict type/range validated before render (no injection) | ✓ VERIFIED | `validate.ts` two-gate: schema re-parse + HARD format regexes (CHANNEL_POINT_RE/TXID_RE/PUBKEY_RE/CHAN_ID_RE); `sanitize.ts` strips `[\x00-\x1F\x7F` + backtick/`$`/`\`] before any `#` comment; injection suite asserts `;`/newline/backtick/`$(` all `ok:false`; failure → locked WITHHELD block (no param echo, no partial command). |
| T-01a | Hostile param (`;`, newline, backtick, `$(`) can never pass the validation gate | ✓ VERIFIED | `validate.test.ts` lines 54-130: channelPoint/partnerPubkey/amountSat/outpointTxid injection fixtures all `ok:false`; 66 export tests pass. |
| T-01b | Peer-chosen alias with a newline cannot break out of a `#` comment line | ✓ VERIFIED | `COMMENT_UNSAFE_RE` strips CR/LF + shell-active set; `comment()`/`ctx()`/`truncPubkey()` all route card-sourced strings through `sanitizeCommentText`. |
| T-01c | ExportBlock type is plain-serializable, crosses RSC boundary as props | ✓ VERIFIED | `block.ts`: strings/numbers/null only, no Date/functions/classes; passed as props from Server Components to the single client leaf. |
| T-03a | D-06 close-candidate → verify-step-first lncli (read-only getchaninfo/listchannels step 1, closechannel step 2 coop or `--force`) | ✓ VERIFIED | `buildVerifyStep` + `buildCloseExport`; tested. |
| T-03b | Rebalance → honest placeholder, full params echoed, NO runnable rebalance command (D-07) | ✓ VERIFIED | `buildRebalanceExport` step 2 `command:null` note `REBALANCE_PLACEHOLDER`; `commands.test.ts:244`. |
| T-03c | LDK-backend card → "not supported on LDK — manual procedure", params still echoed | ✓ VERIFIED | `buildLdkFallback`; `commands.test.ts:294-303`. |
| T-03d | Each stuck-pending case yields its runbook (bump_fee / restart key-steps + script pointer no-run / aged_funding abandonchannel danger) | ✓ VERIFIED | `buildRemediateExport` sub-dispatch; tests `commands.test.ts:460,530,544,551,554,577`. |
| T-03e | Suppressed / update_fee / investigate / fleet cards yield NO block | ✓ VERIFIED | `buildExportBlock` structural gate + `validateActionForExport` rejects update_fee/investigate; `commands.test.ts:59,64`. |
| T-03f | No bare command string contains a comma, a formatted number, or unvalidated interpolation | ✓ VERIFIED | AFM-002 boundary: `formatSats` confined to comment/UI lines; bare commands interpolate RAW integers; test `bumpfee.*:\d` guard line 526. |
| T-04a | /inbox exportable cards carry EXPORT COMMANDS toggle expanding inline; per-step COPY + footer COPY ALL | ✓ VERIFIED | `InsightCardRow.tsx:161` mounts `CommandExport`; leaf has toggle, per-step `CopyButton`, footer COPY ALL. |
| T-04b | Clipboard failure shows "copy failed — select the text manually" — never silent | ✓ VERIFIED | `CommandExport.tsx:31-39,77-81` feature-detect + honest failure copy + `aria-live`. |
| T-05a | Console Active Signals panel shows SAME export expand as /inbox (one component, both surfaces) | ✓ VERIFIED | `ActiveSignalsPanel.tsx:91` mounts the same `CommandExport`; page `buildInsightSignals` threads `buildExportBlock(card)` into `SignalRow.exportBlock`. |
| T-05b | ActiveSignalsPanel + InsightCardRow remain Server Components; only CommandExport is client | ✓ VERIFIED | grep 5: no `"use client"` in either host; grep 4: exactly `CommandExport.tsx`. |

**Score:** 3/3 roadmap success criteria + 16/16 plan must-have truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/export/block.ts` | ExportBlock/ExportStep serializable contract | ✓ VERIFIED | 32 lines, strings/numbers/null only |
| `src/lib/export/sanitize.ts` | comment-line sanitizer | ✓ VERIFIED | `sanitizeCommentText` strips control + shell-active chars |
| `src/lib/export/validate.ts` | two-gate param validator + format regexes | ✓ VERIFIED | schema re-parse + 4 HARD regexes + `safeSatPerVbyte`; imports frozen `SuggestedActionSchema` |
| `src/lib/export/validate.test.ts` | injection-rejection suite | ✓ VERIFIED | 190 lines, fixtures assert `ok:false` |
| `src/lib/export/commands.ts` | builders (close/rebalance/remediate/LDK/withheld) | ✓ VERIFIED | 497 lines, all branches present, no invented values |
| `src/lib/export/commands.test.ts` | per-action branch coverage | ✓ VERIFIED | 595 lines |
| `src/components/export/CommandExport.tsx` | the ONE client leaf | ✓ VERIFIED | 171 lines, expand + copy state only, no fetch/server action |
| `src/components/insight/InsightCardRow.tsx` | inbox mount, server-computed block | ✓ VERIFIED | calls `buildExportBlock`, mounts leaf, stays Server Component |
| `src/components/console/ActiveSignalsPanel.tsx` | console mount on insight rows | ✓ VERIFIED | `exportBlock` field + `CommandExport` mount |
| `src/app/(overview)/[pubkey]/[tab]/page.tsx` | threads buildExportBlock into SignalRow | ✓ VERIFIED | line 160 in `buildInsightSignals`; panel rendered line 259 |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| validate.ts | insight/schema.ts | `SuggestedActionSchema` import (frozen re-parse) | ✓ WIRED |
| commands.ts | validate.ts | `validateActionForExport` gate before interpolation | ✓ WIRED |
| commands.ts | sanitize.ts | `sanitizeCommentText` on every `#`-comment string | ✓ WIRED |
| commands.ts | format/units.ts | `formatSats` in comment/UI lines only | ✓ WIRED |
| InsightCardRow.tsx | commands.ts | `buildExportBlock` server-side | ✓ WIRED |
| CommandExport.tsx | navigator.clipboard | feature-detected writeText, honest failure | ✓ WIRED |
| console page.tsx | commands.ts | `buildExportBlock(card)` in `buildInsightSignals` | ✓ WIRED |
| ActiveSignalsPanel.tsx | CommandExport.tsx | leaf mounted on insight rows w/ exportBlock | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Export module test suite | `npx vitest run src/lib/export` | 3 files / 66 tests passed (213ms) | ✓ PASS |
| Zero-write-path grep #1 (server-only) | `grep -rn 'import "server-only"' src/lib/export/` | no output (exit 1) | ✓ PASS |
| Zero-write-path grep #2 (db import) | `grep -rn 'from "@/lib/db' src/lib/export/ src/components/export/` | no output (exit 1) | ✓ PASS |
| Zero-write-path grep #3 (fetch/use server) | `grep -rn 'fetch(\|"use server"' src/components/export/` | no output (exit 1) | ✓ PASS |
| Zero-write-path grep #4 (one client leaf) | `grep -rln '"use client"' src/components/export/` | exactly `CommandExport.tsx` | ✓ PASS |
| Zero-write-path grep #5 (host surfaces server) | `grep -rn '"use client"' ActiveSignalsPanel.tsx InsightCardRow.tsx` | no output (exit 1) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| EXPORT-01 | 05-01, 05-03, 05-04, 05-05 | Closures/rebalances → ready-to-run parameterized lncli/lncmd, context + safety, pure client-side, no write path | ✓ SATISFIED | SC1/SC3 + all T-0x truths verified; zero-write-path battery reproduced |
| PENDING-03 | 05-03, 05-04, 05-05 | Per stuck case → exported remediation runbook (bumpfee, safe-restart no-auto, aged-funding abandonchannel danger) | ✓ SATISFIED | SC2 + T-03d verified; restart-no-run + abandonchannel-danger asserted in tests |

No orphaned requirements: REQUIREMENTS.md maps only EXPORT-01 and PENDING-03 to Phase 5, both declared in plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | none | — | No debt markers (TBD/FIXME/XXX) in any phase-modified file; no TODO/HACK; no silent empty returns (null returns are the intentional honest non-exportable signal, gated and tested) |

### Human Verification Required

None outstanding. The single manual-only verification (expand + copy interaction polish on both surfaces, NOC Light grammar — `ui_safety_gate`, Phase 3/4 precedent) was executed and operator-approved on 2026-06-15 per the 8-step walkthrough on `/inbox` and a per-node console panel. Operator verdict verbatim: "approved looks good". No issues reported.

### Gaps Summary

No gaps. The phase goal is observably achieved in the codebase. Both surfaces (triage inbox `InsightCardRow` and per-node console `ActiveSignalsPanel`) mount the single shared `CommandExport` client leaf, fed by server-side `buildExportBlock`. EXPORT-01 close/rebalance command generation and PENDING-03 remediation runbooks are present, substantive, and wired. The zero-write-path invariant is provable in code — all five security greps from 05-VALIDATION.md reproduce exactly. Honest states (rebalance placeholder with no fake command, LDK manual fallback, validation-withheld block, honest clipboard failure) are implemented and unit-tested. Injection safety is enforced by a two-gate validator plus comment sanitizer, with an injection-rejection suite. The automated battery (66 export tests green; full-suite 572 passed per 05-VALIDATION) and the operator visual gate both pass.

---

_Verified: 2026-06-15T14:10:00Z_
_Verifier: Claude (gsd-verifier)_
