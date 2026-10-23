---
phase: 02
slug: fleet-overview-health-scorecard
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-09
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4 (in-repo, Phase 1) |
| **Config file** | `vitest.config.ts` (node env, `@/` alias, `server-only` stubbed, include `src/**/*.test.ts`) |
| **Quick run command** | `npx vitest run src/lib/scorecard` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~5–10 s pure suites; +~20 s when `ROUTING_VM_DATABASE_URL` is set (live goldens) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/scorecard` (plus the task's own targeted command)
- **After every plan wave:** Run `npm test` (full suite); from Wave 3 onward also run the live golden with `ROUTING_VM_DATABASE_URL` sourced from `.env.local`
- **Before `/gsd:verify-work`:** Full suite green AND Canada golden green live (D-14 phase gate)
- **Max feedback latency:** 30 seconds (pure suites well under)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | FLEET-02 | T-02-03 | No push/migrate against routing_vm; typing matched to live information_schema | typecheck+grep | `npx tsc --noEmit && grep -q "APPEND-ONLY" src/lib/db/schema/routing.ts` | ✅ (modifies existing file) | ⬜ pending |
| 02-01-02 | 01 | 1 | FLEET-02 | T-02-01 / T-02-05 | DISTINCT ON (pubkey) only; injection lands in params | unit (no DB) | `npx vitest run src/lib/read/node-info.test.ts` | ❌ created in-task | ⬜ pending |
| 02-02-01 | 02 | 1 | FLEET-02, FLEET-03 | T-02-02 / T-02-06 | server-only on backends.ts; malformed NODE_BACKENDS throws | unit | `npx vitest run src/lib/config/backends.test.ts` | ❌ created in-task | ⬜ pending |
| 02-02-02 | 02 | 1 | FLEET-02 | T-02-07 | Non-critical input can never yield "critical" (D-07) | unit | `npx vitest run src/lib/scorecard/grade.test.ts` | ❌ created in-task | ⬜ pending |
| 02-02-03 | 02 | 1 | FLEET-03 | T-02-07 | Outlier never alters grade; cohort<3 suppressed | unit | `npx vitest run src/lib/scorecard/compare.test.ts src/lib/scorecard/freshness.test.ts` | ❌ created in-task | ⬜ pending |
| 02-03-01 | 03 | 2 | FLEET-02 | T-02-01 / T-02-05 | Bound ns-window params; fee_msat never raw fee | unit (SQL shape) | `npx vitest run src/lib/scorecard/dimensions/routing.test.ts src/lib/scorecard/dimensions/revenue.test.ts` | ❌ created in-task | ⬜ pending |
| 02-03-02 | 03 | 2 | FLEET-02 | T-02-01 / T-02-05 | DISTINCT ON latest-state subquery; no event-table dumps | unit (SQL shape + pure) | `npx vitest run src/lib/scorecard/dimensions/liquidity.test.ts src/lib/scorecard/dimensions/channel-health.test.ts` | ❌ created in-task | ⬜ pending |
| 02-04-01 | 04 | 2 | FLEET-02 | T-02-01 / T-02-07 | AP-11 metric key matches config tier1 metric string | unit (SQL shape) | `npx vitest run src/lib/scorecard/dimensions/force-close.test.ts` | ❌ created in-task | ⬜ pending |
| 02-04-02 | 04 | 2 | FLEET-02 | T-02-01 | peer never reads lnd_node_peer_info COUNT(*) | unit | `npx vitest run src/lib/scorecard/dimensions/restart.test.ts src/lib/scorecard/dimensions/peer.test.ts` | ❌ created in-task | ⬜ pending |
| 02-05-01 | 05 | 2 | FLEET-01 | T-02-SC | package.json diff within allowlist; official registry only | CLI+grep | `test -f components.json && grep -q -- "--color-status-critical" src/app/globals.css && npx tsc --noEmit` | ❌ created in-task | ⬜ pending |
| 02-05-02 | 05 | 2 | FLEET-01, FLEET-02 | T-02-07 / T-02-02 | Components render given color, never re-derive; no DB imports | typecheck+grep | `npx tsc --noEmit && ! grep -rn "style={{" src/components/scorecard/` | ❌ created in-task | ⬜ pending |
| 02-05-03 | 05 | 2 | FLEET-01, FLEET-02 | T-02-02 | Honest-gap states labeled (UI-SPEC verbatim copy) | typecheck+grep | `grep -q "No data — needs log ingestion" src/components/scorecard/DimensionRow.tsx` | ❌ created in-task | ⬜ pending |
| 02-06-01 | 06 | 3 | FLEET-01, FLEET-02, FLEET-03 | T-02-05 / T-02-07 | Bounded queries; D-09 sort; restart excluded from freshness floor | unit | `npx vitest run src/lib/scorecard/fleet.test.ts` | ❌ created in-task | ⬜ pending |
| 02-06-02 | 06 | 3 | FLEET-02 (D-14) | T-02-03 | Read-only golden; invariant ranges not literals | live (skipIf no DB) | `npx vitest run src/lib/scorecard/golden-scorecard.test.ts` (env from .env.local for live run) | ❌ created in-task | ⬜ pending |
| 02-07-01 | 07 | 4 | FLEET-01 | T-02-02 / T-02-05 | (status) bare-select page removed; one bounded fleet read | build+grep | `test ! -f "src/app/(status)/page.tsx" && npm run build` | ❌ created in-task | ⬜ pending |
| 02-07-02 | 07 | 4 | FLEET-02, FLEET-03 | T-02-04 | pubkey regex → notFound before any data access | build+grep | `grep -q "0-9a-f]{66}" "src/app/(overview)/[pubkey]/page.tsx" && npm run build` | ❌ created in-task | ⬜ pending |
| 02-07-03 | 07 | 4 | FLEET-01/02/03 | T-02-07 | Red only with a visible critical chip (D-07) | manual checkpoint | — (human-verify, see below) | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test infrastructure needs **zero changes** (vitest config already aliases `@/`, stubs `server-only`, includes `src/**/*.test.ts`). Every module task creates its co-located test file in the same task (test + implementation land together), so there are no standalone Wave 0 scaffold tasks. The RESEARCH "Wave 0 Gaps" list maps 1:1 onto Wave 1–3 plan tasks:

- [x] `src/lib/read/node-info.ts` + test — plan 02-01 task 2
- [x] `src/lib/scorecard/config.ts` — plan 02-02 task 1
- [x] dimensions + tests — plans 02-03 / 02-04
- [x] `grade.ts` / `compare.ts` / `freshness.ts` + tests — plan 02-02
- [x] `backends.ts` + test — plan 02-02 task 1
- [x] `golden-scorecard.test.ts` — plan 02-06 task 2
- [x] shadcn primitives — plan 02-05 task 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Overview/scorecard visual contract (colors as two distinct systems, D-09 order legible, stale markers, LDK no-baseline) | FLEET-01/02/03 | Visual rendering + perceptual color distinction can't be asserted in node-env vitest (no component renderer in repo) | Plan 02-07 Task 3 checkpoint: `npm run dev`, walk / and /{pubkey} per the 7-step script |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (only 02-07-03 is manual, and it is final)
- [x] Wave 0 covers all MISSING references (co-created in-task; infra pre-exists)
- [x] No watch-mode flags (all commands use `vitest run`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-06-09 (sign-off at execution)
