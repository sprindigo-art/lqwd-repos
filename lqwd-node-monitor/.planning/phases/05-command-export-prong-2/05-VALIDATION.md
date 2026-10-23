---
phase: 5
slug: command-export-prong-2
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-12
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (config `vitest.config.ts`, carries the `@/` alias) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/lib/export` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | ~20 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/export` (plans 05-01/05-03) or `npx vitest run src/lib/insight` (plan 05-02) or `npx tsc --noEmit && npm test` (UI plans 05-04/05-05)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite green + 05-06 grep battery
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | EXPORT-01 | T-05-02 | hostile alias cannot break out of `#` comments | unit | `npx vitest run src/lib/export/sanitize.test.ts` | ❌ created in-task (TDD: test-first) | ⬜ pending |
| 05-01-02 | 01 | 1 | EXPORT-01 | T-05-01 | injection params (`;`, `\n`, `` ` ``, `$(`) rejected ok:false | unit | `npx vitest run src/lib/export/validate.test.ts` | ❌ created in-task (TDD: test-first) | ⬜ pending |
| 05-02-01 | 02 | 1 | EXPORT-01 | T-05-08 | conditional detail add — no invented values | unit | `npx vitest run src/lib/insight/detectors/fee-signals.test.ts src/lib/insight/detectors/rebalance.test.ts` | ✅ extend existing | ⬜ pending |
| 05-02-02 | 02 | 1 | EXPORT-01 | T-05-07 | frozen schema untouched; contract test green | unit | `npx vitest run src/lib/insight` | ✅ extend existing | ⬜ pending |
| 05-03-01 | 03 | 2 | EXPORT-01 | T-05-01/02/03 | withheld block on bad params; suppressed/update_fee → null; LDK honest state | unit | `npx vitest run src/lib/export/commands.test.ts` | ❌ created in-task (TDD: test-first) | ⬜ pending |
| 05-03-02 | 03 | 2 | PENDING-03 | T-05-04/05 | no runnable restart/abandonchannel; bumpfee outpoint-positional | unit | `npx vitest run src/lib/export` | ❌ created in-task (TDD: test-first) | ⬜ pending |
| 05-04-01 | 04 | 3 | EXPORT-01 | T-05-09/11 | plain-text render; honest clipboard failure | type+suite | `npx tsc --noEmit && npm test` | ✅ | ⬜ pending |
| 05-04-02 | 04 | 3 | EXPORT-01, PENDING-03 | T-05-03 | row stays Server Component; gate via buildExportBlock | type+suite | `npx tsc --noEmit && npm test` | ✅ | ⬜ pending |
| 05-05-01 | 05 | 4 | EXPORT-01, PENDING-03 | T-05-03 | panel never computes; strings-only DOM | type+suite | `npx tsc --noEmit && npm test` | ✅ | ⬜ pending |
| 05-05-02 | 05 | 4 | EXPORT-01, PENDING-03 | T-05-10 | one mapped field; no new reads | type+suite | `npx tsc --noEmit && npm test` | ✅ | ⬜ pending |
| 05-06-01 | 06 | 5 | EXPORT-01, PENDING-03 | T-05-04/SC | zero-write-path grep battery + dependency freeze | gate | `npm test && npx tsc --noEmit` | ✅ | ✅ green |
| 05-06-02 | 06 | 5 | EXPORT-01, PENDING-03 | T-05-12 | operator visual gate (ui_safety_gate) | manual checkpoint | — | — | ✅ PASSED (operator approved 2026-06-15) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files are created test-first INSIDE their owning tasks (plans 05-01 and 05-03 are `tdd="true"` — RED before GREEN), so no separate Wave 0 plan exists:

- [x] `src/lib/export/sanitize.test.ts` — hostile-alias fixtures (Pitfall 2) — owned by 05-01 Task 1
- [x] `src/lib/export/validate.test.ts` — injection-rejection + format-regex coverage (EXPORT-01 AC3) — owned by 05-01 Task 2
- [x] `src/lib/export/commands.test.ts` — per-action block coverage incl. LDK/placeholder/suppressed branches — owned by 05-03

Framework install: none needed (vitest present).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Expand + copy interaction on both surfaces (D-01/D-02), NOC Light grammar | EXPORT-01, PENDING-03 | Interaction polish is operator-gated per project precedent (Phase 3/4 visual gates; `ui_safety_gate` enabled) | 05-06 Task 2 checkpoint — 8 numbered steps on /inbox and a console node |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (TDD tasks create their tests first)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (folded into TDD tasks)
- [x] No watch-mode flags (`vitest run` everywhere)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-06-12

---

## Gate Evidence — 05-06 Task 1 (automated battery)

> Executed 2026-06-15 on `main` against the running dev server (port 3777 untouched). All five sub-checks pass; recorded verbatim per the plan's `<action>`.

### 1. Full vitest suite — `npm test` (exit 0)

```
 RUN  v4.1.8 /Users/joshuajackson/Desktop/LQwD/ClaudeCode/NodeMonitorDashboard
 Test Files  50 passed | 4 skipped (54)
      Tests  572 passed | 20 skipped (592)
   Duration  138.42s
```

### 2. Type check — `npx tsc --noEmit` (exit 0)

Clean — no diagnostics.

### 3. Zero-write-path grep battery (the EXPORT-01 phase boundary)

| # | Command | Expected | Actual | Result |
|---|---------|----------|--------|--------|
| 1 | `grep -rn 'import "server-only"' src/lib/export/` | no output | no output (exit 1) | ✅ |
| 2 | `grep -rn 'from "@/lib/db' src/lib/export/ src/components/export/` | no output | no output (exit 1) | ✅ |
| 3 | `grep -rn 'fetch(\|"use server"' src/components/export/` | no output | no output (exit 1) | ✅ |
| 4 | `grep -rln '"use client"' src/components/export/` | exactly `src/components/export/CommandExport.tsx` | `src/components/export/CommandExport.tsx` | ✅ |
| 5 | `grep -rn '"use client"' src/components/console/ActiveSignalsPanel.tsx src/components/insight/InsightCardRow.tsx` | no output | no output (exit 1) | ✅ |

The export layer provably has **no write path**: no `server-only` import, no DB import, no `fetch`/server action in the export components, exactly one `"use client"` leaf (`CommandExport.tsx`), and the two host surfaces (console panel + inbox card row) stay Server Components.

### 4. Dependency freeze (RESEARCH Package Legitimacy Audit — zero installs this phase)

- `git diff <phase-05-start-parent ba0ac74> HEAD -- package.json` → **empty** (no dependency additions across Phase 05).
- package-lock.json dependency-block diff over the Phase 05 span shows no `ai-sdk`/`ai`/`zod`/`copy-to-clipboard`/`clipboardy`/`recharts`/`date-fns` changes.
- `grep -c "copy-to-clipboard\|clipboardy" package.json` → **0** (clipboard implemented via the built-in `navigator.clipboard`, no package).

> Note on the plan's literal command: `git merge-base HEAD main` resolves to HEAD because the phase work is already merged into `main` (empty diff — proves no uncommitted dep changes). The dependency-freeze intent ("zero installs this phase") was verified by scoping the diff to the actual Phase 05 commit span (`ba0ac74..HEAD`), which is empty. The `ai`/`@ai-sdk/anthropic`/`zod`-as-runtime entries visible in a wider diff predate Phase 05 (LLM-narrative foundations) and are out of scope for this gate.

### 5. AFM re-verification — `npx vitest run src/lib/format src/lib/read` (exit 0)

```
 Test Files  6 passed | 2 skipped (8)
      Tests  55 passed | 5 skipped (60)
```

AFM-001/002 untouched — the single sanctioned sat/BTC/msat formatter and the read layer remain green.

**Task 1 verdict:** automated battery GREEN; zero-write-path evidence on record (T-05-04, T-05-SC mitigated). Proceed to the operator visual gate (Task 2).

### Gate Evidence — 05-06 Task 2 (operator visual gate)

✅ **APPROVED** — operator completed the visual walkthrough on BOTH surfaces (`/inbox` and a per-node console Active Signals panel) per the 8-step `<how-to-verify>` and approved. Checkpoint was returned per `ui_safety_gate` (Phase 3/4 precedent); not auto-approved (`auto_advance: false`).

**Operator verdict (verbatim, 2026-06-15):**

> "approved looks good"

No issues reported. Both surfaces verified — expand + copy + honest states confirmed. The `ui_safety_gate` PASSES. T-05-12 (repudiation of unverified operator-facing claims) is mitigated: the operator has confirmed context echo + safety notes + honest states on record.

**Gate result: APPROVED.** Both automated battery (Task 1) and operator visual gate (Task 2) PASS. EXPORT-01 and PENDING-03 success criteria proven end-to-end.
