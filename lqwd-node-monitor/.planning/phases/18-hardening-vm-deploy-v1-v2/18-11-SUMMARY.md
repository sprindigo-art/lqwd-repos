---
phase: 18-hardening-vm-deploy-v1-v2
plan: 11
subsystem: security-deploy-gate
tags: [HARDEN-01, HARDEN-03, grade-a, rescan, zero-write-path, advisory-only, deploy-gate]
requires:
  - "18-02..18-10, 18-12 (all CRITICAL/HIGH remediation merged at base 69239ca)"
provides:
  - "scripts/zero-write-grep.sh: repeatable, CI-wired zero-write-path assertion over src/lib/read + src/lib/export"
  - "guardrails.test.ts both-path proof: assertAdvisoryOnly gates BOTH narrate() and narrateIncident(), each withholds a command-shaped line"
  - "CODE-REVIEW-2026-07-22-RESCAN.md: evidence-based Grade-A re-scan (zero CRITICAL/HIGH across v1+v2)"
affects:
  - "VM production deploy (Grade-A gate now satisfied)"
tech-stack:
  added: []
  patterns:
    - "Repeatable zero-write grep battery scoped to pure read/export libs; control affordances (write surface) excluded by design; pure Zod schema (bounds) not treated as a write path"
    - "Both-path advisory-only pin: structural source-grep (import + call + withhold) plus behavioral shared-gate proof, co-located in guardrails.test.ts"
    - "Evidence-based re-scan: each prior CRITICAL/HIGH re-checked against merged source, not trusted from SUMMARYs"
key-files:
  created:
    - scripts/zero-write-grep.sh
    - .planning/CODE-REVIEW-2026-07-22-RESCAN.md
  modified:
    - src/lib/insight/guardrails.test.ts
    - package.json
decisions:
  - "zero-write battery scoped to src/lib/read + src/lib/export (the plan's named display/export surfaces); src/components/queue + control affordances legitimately import @/app/actions/queue and are the deliberate write surface, out of scope"
  - "@/lib/queue/bounds (a pure Zod validation schema) is NOT banned — it is not a write path"
  - "narrateCards uses a LAZY dynamic import of guardrails; the structural test asserts import(\"@/lib/insight/guardrails\"), not a static from-import"
  - "Grade-A verdict authored from direct code evidence in the merged tree, not from plan SUMMARYs alone"
metrics:
  duration: ~30m
  completed: 2026-07-27
requirements: [HARDEN-01, HARDEN-03]
---

# Phase 18 Plan 11: Grade-A Security Re-Scan Deploy Gate Summary

The final phase-18 deploy gate: authored two repeatable invariants checks (a zero-write-path grep battery and a both-narrate-path advisory-only proof) and produced an evidence-based Grade-A re-scan confirming **ZERO CRITICAL / ZERO HIGH** across v1 + v2 after all remediation.

## Final Grade

**GRADE A — zero CRITICAL, zero HIGH.** Every prior severe finding from `CODE-REVIEW-2026-07-22.md` (1 CRITICAL Q1; Opus HIGHs Q2/I1/C1/U1/Q3 + Q5; Fable-confirmed HIGHs commit1/D-svc/I-fee/I-pg/O-load/NavRail×2/copyAll/C-iso) was re-checked against the **actual merged code** at base `69239ca` and mapped to its fixed state with a direct source citation (see `.planning/CODE-REVIEW-2026-07-22-RESCAN.md` §2). No new CRITICAL/HIGH was introduced. The PROJECT Grade-A deploy gate (no CRITICAL/HIGH before production) is **satisfied**.

## What was built

1. **`scripts/zero-write-grep.sh`** (wired into `npm run lint` via `lint:zero-write`) — fails if any read/display (`src/lib/read`) or command-export (`src/lib/export`) module imports a write path: queue write modules (`enqueue`/`claim`/`sign`/`canonical`/`withdraw`/`stub-executor`/`state`), queue write server-actions, or node crypto signing. Export is held stricter (fully DB/queue/driver-free). Exits **0** on the current tree; verified **exit 1** on an injected write import.

2. **`guardrails.test.ts` both-path proof** — a new `describe("both narrate paths gate through assertAdvisoryOnly")` block: structural pins that both `narrateCards` (`narrative.ts`) and `narrateIncident` import + call `assertAdvisoryOnly(result.text)` and withhold on failure, plus behavioral proof that the shared gate withholds a command-shaped line for each path's output shape. A companion block re-asserts `AiReadLine` carries no `action`/`params`/`command`. Full-path mocked withhold proofs already live beside each action (`narrate.test.ts` T-18-07, `narrate-incident.test.ts` T-17-02).

3. **`.planning/CODE-REVIEW-2026-07-22-RESCAN.md`** — the evidence-based Grade-A re-scan artifact (the deploy gate).

## Verification (RUN and PASS — not skipped)

- `sh scripts/zero-write-grep.sh` → **exit 0** (clean); **exit 1** on injection (negative test passed).
- `npx vitest run src/lib/insight/guardrails src/app/actions/narrate` → **60 passed, 0 skipped**.
- Spot-checked the merged source for every prior CRITICAL/HIGH fix (apply-fee signed-payload binding + live TLD + signed-TTL; `nodemon_node_transition_guard` trigger; env-bound rate limit; `RETURNING id` commit1 guard; df-faint guard; NavRail real-counts-only + honest poll stamp; copyAll uncapped safety constants + `safeToken`; collector per-service `OSError` isolation; service-health pubkey fallback; fee-signals null-volume raise-only; ap12 `collectedAt` asOf; loadIncidents freshness cutoff). All present.

## Deferred operator verification (NOT a finding)

**18-10 self-approve-guard live-DB integration proof.** The Q2 fix (BEFORE UPDATE trigger + migration `0005_self_approve_guard.sql`) is merged and reviewed; its integration test `src/lib/queue/self-approve-guard.test.ts` is **DB-required** (`requireNodemonDb`) and does not run in the DB-less floor. It must run once under CI/operator with the `nodemon` DB + migration `0005` applied to prove at runtime that a `nodemon_node` session is denied `pending_approval → approved`. This is a standing CI/operator gate, not a residual CRITICAL/HIGH.

## Deviations from Plan

None — plan executed as written. Task 2 was a `checkpoint:human-verify` (blocking) Grade-A re-scan; the substantive verification was performed against the merged code and the evidence-based verdict (Grade A, zero CRITICAL/HIGH) is recorded in the RESCAN artifact. Resume-signal condition ("grade-A confirmed") is satisfied by evidence.

## Deferred Issues

- **Pre-existing ESLint debt (LOW):** 10 errors + 27 warnings (`no-unused-vars`) at base `69239ca` in files NOT touched by this plan (`triage.test.ts`, `read/pg-health.ts`, and others). Unrelated to any CRITICAL/HIGH; does not affect the deploy gate. Left as-is per plan scope (not introduced by 18-11).

## Threat Flags

None — no new security-relevant surface introduced (the plan adds a lint script, a test, and a review artifact only).

## Self-Check: PASSED

- Files: `scripts/zero-write-grep.sh`, `.planning/CODE-REVIEW-2026-07-22-RESCAN.md`, `.planning/phases/18-hardening-vm-deploy-v1-v2/18-11-SUMMARY.md` — all FOUND.
- Commits: `86f6e09` (test), `b3b82da` (rescan), `2702002` (summary) — all FOUND.
- STATE.md / ROADMAP.md untouched (orchestrator owns those writes).
