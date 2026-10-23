---
phase: 14
slug: hosts-infra-monitoring
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-13
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (`vitest.config.ts` — carries the `@/` alias; plain node/ESM, no Next plugin) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <touched test file>` |
| **Full suite command** | `npm test` (vitest run) |
| **Estimated runtime** | full suite ~60–120s; single module <10s |

Known caveat: 4 pre-existing `src/lib/queue/*` live-DB integration tests time out without a
nodemon connection — documented unrelated (12-CLOSE). `next build` is operator-out-of-band
(sandbox TS-phase hang, STATE.md deferred item); `npx tsc --noEmit` is the in-sandbox type gate.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched module test>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite + `npm run lint` (noc-guard) green
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | HOST-01/02 | T-14-01/02 | stale meter = no fill; sev never derived from pct | unit | `npx vitest run src/components/df/ThresholdMeter.test.tsx` | ❌ W0 (task creates) | ⬜ pending |
| 14-01-02 | 01 | 1 | HOST-01/02 | — | gallery static fixtures only, df tokens only | lint | `npm run lint` | ✅ gate | ⬜ pending |
| 14-02-01 | 02 | 1 | HOST-02 | T-14-03/05 | param-bound bounded scans; injection pinned | unit (no-DB) | `npx vitest run src/lib/read/host-history.test.ts` | ❌ W0 (task creates) | ⬜ pending |
| 14-02-02 | 02 | 1 | HOST-02 | — | D-14/D-15 honest copy pinned verbatim | unit | `npx vitest run src/lib/read/storage-projection.test.ts` | ❌ W0 (task creates) | ⬜ pending |
| 14-03-01 | 03 | 2 | HOST-02 | T-14-07 | 4-level boundaries pinned; read-time config only | unit | `npx vitest run src/lib/read/telemetry-bands.test.ts` | ✅ extend | ⬜ pending |
| 14-03-02 | 03 | 2 | HOST-01 | T-14-06/08 | stale never promotes; locked P12 modules untouched | unit | `npx vitest run src/lib/overview/host-rollup.test.ts` | ❌ W0 (task creates) | ⬜ pending |
| 14-04-01 | 04 | 1 | HOST-01 | T-14-09 | closed-vocab whitelist, invalid widens; one .sort | unit | `npx vitest run src/lib/overview/host-filter.test.ts` | ❌ W0 (task creates) | ⬜ pending |
| 14-04-02 | 04 | 1 | HOST-02 | T-14-10/11 | verify-first ordering; zero credentials/DB names | unit | `npx vitest run src/lib/overview/host-runbook.test.ts` | ❌ W0 (task creates) | ⬜ pending |
| 14-05-01 | 05 | 3 | HOST-01 | T-14-12 | navy chips, no severity hue | type+grep | `npx tsc --noEmit` + acceptance greps | ✅ | ⬜ pending |
| 14-05-02 | 05 | 3 | HOST-01 | T-14-13/15 | no health computed in component; honest no-telemetry copy | type+grep | `npx tsc --noEmit` + acceptance greps | ✅ | ⬜ pending |
| 14-05-03 | 05 | 3 | HOST-01 | T-14-12/14/15 | whitelist params; unfiltered enumeration (D-06) | unit+type | `npx vitest run src/lib/overview && npx tsc --noEmit` | ✅ | ⬜ pending |
| 14-06-01 | 06 | 3 | HOST-02 | T-14-18 | inert runbook; no "Open incident"; no .sort | type+grep | `npx tsc --noEmit` + acceptance greps | ✅ | ⬜ pending |
| 14-06-02 | 06 | 3 | HOST-02 | T-14-19 | projection branch on status; no deprecated props | type+grep | `npx tsc --noEmit` + acceptance greps | ✅ | ⬜ pending |
| 14-06-03 | 06 | 3 | HOST-02 | T-14-16/17 | membership gate before echo; notFound outside try | unit+type | `npx vitest run src/lib/overview src/lib/read && npx tsc --noEmit` | ✅ | ⬜ pending |
| 14-07-01 | 07 | 4 | HOST-01/02 | — | fail-soft backfill; honest empty on no-host | full | `npx vitest run && npx tsc --noEmit` | ✅ | ⬜ pending |
| 14-07-02 | 07 | 4 | both | T-14-21..23 | grep battery: XSS/exec/routing_vm all zero | suite+lint+grep | `npm test && npm run lint && npx tsc --noEmit` | ✅ | ⬜ pending |
| 14-07-03 | 07 | 4 | both | T-14-24 | live honesty + visual bar | manual (checkpoint) | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

TDD tasks create their own tests RED-first within their plans (all wave-1/2 pure-module tasks
carry `tdd="true"`); no separate Wave-0 scaffold plan is needed:

- [ ] `src/components/df/ThresholdMeter.test.tsx` — created RED-first in 14-01-01
- [ ] `src/lib/read/host-history.test.ts` — created RED-first in 14-02-01
- [ ] `src/lib/read/storage-projection.test.ts` — created RED-first in 14-02-02
- [ ] `src/lib/read/telemetry-bands.test.ts` — extended RED-first in 14-03-01 (exists)
- [ ] `src/lib/overview/host-rollup.test.ts` — created RED-first in 14-03-02
- [ ] `src/lib/overview/host-filter.test.ts` — created RED-first in 14-04-01
- [ ] `src/lib/overview/host-runbook.test.ts` — created RED-first in 14-04-02

Existing infrastructure (vitest 4 + config + noc-guard lint) covers all phase requirements —
no framework install.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live visual gate: card grammar, no-telemetry cards, detail section order, honest projections, nav reachability, 404 on bogus hostId | HOST-01, HOST-02 | Visual quality bar per D-01/DESIGN-BRIEF-02 (no prototype — the approved 14-UI-SPEC is the bar); matches Phase 12/13 operator gates | 14-07 Task 3 checkpoint steps 1–9 |
| `next build` exit 0 | both | Sandbox TS-phase hang (STATE.md deferred item) | Operator runs `CI=true npx next build` out-of-band |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (TDD tasks create their tests RED-first)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (in-plan RED-first creation)
- [x] No watch-mode flags (`vitest run` everywhere)
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready for execution
