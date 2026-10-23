---
phase: 13
slug: nodes-service-health
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-08
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Detailed per-requirement test map + acceptance lens live in `13-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (`package.json` → `"test": "vitest run"`, `"vitest": "^4"`) |
| **Config file** | `vitest.config.ts` — `environment: "node"`, `@/` alias, `server-only` stub, discovers `src/**/*.test.ts` AND `src/**/*.test.tsx` |
| **Component-test style** | DEP-FREE: `renderToStaticMarkup` (react-dom/server) under node env + pure predicates — NO jsdom, NO @testing-library (RESEARCH §H, LOCKED). Precedent: `src/components/df/TwoAxisPip.test.tsx`. |
| **Quick run command** | `npx vitest run <path>` (e.g. `npx vitest run src/lib/queue/state`) |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~10–20 seconds (pure, no-DB modules; no pool spin-up) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched module path>` (< 30s; pure modules)
- **After every plan wave:** Run `npm test` (full `vitest run`)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | NODE-04 | T-13-01-01 | `withdrawn` legal edge + terminal in the pure state machine (RED→GREEN) | unit | `npx vitest run src/lib/queue/state` | ✅ extend | ⬜ pending |
| 13-01-02 | 01 | 1 | NODE-04 | — | `withdrawn` present in pgEnum (type-safe) | compile | `npx tsc --noEmit -p tsconfig.json` | ✅ | ⬜ pending |
| 13-01-03 | 01 | 1 | NODE-04 | T-13-01-02 | [BLOCKING] enum migration applied on `nodemon` before transition code runs | migration/inspection | inspect generated SQL + verify applied (gated, no auto verify) | ✅ | ⬜ pending |
| 13-02-01 | 02 | 1 | NODE-03 | — | `parseNodeFacets`/`applyNodeFilters` pure view over loaded set, honest empty (RED→GREEN) | unit | `npx vitest run src/lib/overview/node-filter` | ❌ W0 (new util+test) | ⬜ pending |
| 13-03-01 | 03 | 2 | NODE-04 | T-13-03-01 | `withdraw()` UPDATE … WHERE state='approved'; 0 rows ⇒ throws (lost race) (RED→GREEN) | unit | `npx vitest run src/lib/queue/withdraw` | ❌ W0 (new test) | ⬜ pending |
| 13-03-02 | 03 | 2 | NODE-04 | T-13-03-02 | `enqueueAndApprove` signs once → approved, audit ∅→pending→approved, `staleAck` recorded; `withdrawCommand` guarded (RED→GREEN) | unit | `npx vitest run src/app/actions/queue` | ✅ extend | ⬜ pending |
| 13-04-01 | 04 | 2 | NODE-03 | — | NodesTable + NodeFilters render over the pure filter (no client fetch of secrets) | compile | `npx tsc --noEmit -p tsconfig.json` | ✅ | ⬜ pending |
| 13-04-02 | 04 | 2 | NODE-03 | — | `/nodes` RSC route + opsNav entry wired | compile+grep | `npx tsc --noEmit … && grep '"nodes"' src/app/(overview)/page.tsx` | ✅ | ⬜ pending |
| 13-05-01 | 05 | 1 | SVC-01 | T-13-05-01 | `resolveNodeServices` pubkey→hostId attribution correct (RED→GREEN) | unit | `npx vitest run src/lib/read/node-services` | ❌ W0 (new test) | ⬜ pending |
| 13-05-02 | 05 | 1 | SVC-01 | — | ServiceHealthGrid renders combined two-axis state | compile | `npx tsc --noEmit -p tsconfig.json` | ✅ | ⬜ pending |
| 13-05-03 | 05 | 1 | SVC-01/D-06 | T-13-05-02 | two-axis precedence: green ONLY when both axes; up-but-dead distinct; no synthetic paused | unit | `npx vitest run src/components/df/TwoAxisPip` | ✅ extend (test exists) | ⬜ pending |
| 13-06-01 | 06 | 3 | NODE-04 | T-13-06-02 | channel baseline staleness from row `timestamp` vs pinned `FEE_BASELINE_STALE_MS` (6h); LND-only props, suggestedPpm=currentPpm | compile+grep | `npx tsc --noEmit … && grep FEE_BASELINE_STALE_MS src/lib/read/latest.ts` | ✅ (latest.ts) | ⬜ pending |
| 13-06-02 | 06 | 3 | NODE-04 | T-13-06-01/03 | forked leaf: enqueueAndApprove, no window.confirm, params-only, pure `feeEnqueueConfirmBlocked` gate | compile+grep | `npx tsc --noEmit … && grep -c "window.confirm" …NodeFeeEnqueue.tsx` (==0) | ✅ new | ⬜ pending |
| 13-06-03 | 06 | 3 | NODE-04 | T-13-06-01/04 | B8 table per-channel chanId targeting; WithdrawAffordance calls `withdrawCommand`; LDK read-only | compile | `npx tsc --noEmit -p tsconfig.json` | ✅ new | ⬜ pending |
| 13-06-04 | 06 | 3 | NODE-04/D-05 | T-13-06-02 | D-05 stale-gate: CONFIRM blocked when `baselineStale && !staleAck`; ack enables; `staleAck` flows into `enqueueAndApprove` | unit (dep-free) | `npx vitest run src/components/node/NodeFeeEnqueue` | ❌ W-slice (new test, Plan 06 Task 4) | ⬜ pending |
| 13-07-01..03 | 07 | 1 | NODE-04 | — | B1/B2/B7, B5, B6/B4 read-only detail panels render | compile | `npx tsc --noEmit -p tsconfig.json` | ✅ | ⬜ pending |
| 13-08-01 | 08 | 4 | NODE-04 | — | single-scroll `[pubkey]/page.tsx` composes the detail | compile | `npx tsc --noEmit -p tsconfig.json` | ✅ | ⬜ pending |
| 13-08-02 | 08 | 4 | NODE-04 | T-13-08-01 | `[pubkey]/[tab]` retired to redirect shim; export route PRESERVED | compile+file | `npx tsc --noEmit … && test -f …/[tab]/export/route.ts` | ✅ | ⬜ pending |
| 13-08-03 | 08 | 4 | NODE-04/SVC-01 | — | operator visual gate — Node Detail + write path live | manual | human visual gate (see Manual-Only) | n/a | ⬜ pending |
| 13-09-01..03 | 09 | 2 | SVC-02 | — | C1/C2, C3/C4/C5, C6 verify-first (inert) service-detail panels | compile | `npx tsc --noEmit -p tsconfig.json` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Highest-risk rows per RESEARCH: the `approved → withdrawn` guarded transition (D-01, 13-03-01) and the enum migration (13-01-01/03) must have RED→GREEN unit coverage before UI wiring; the D-05 stale-gate (13-06-04) is the core 08-04 canary mitigation and now carries automated behavioral coverage (was tsc/grep/human-only).*

---

## Wave 0 Requirements

Existing infrastructure covers nearly all phase requirements: `vitest.config.ts` already discovers
`.test.tsx`, resolves `@/`, stubs `server-only`, and supports dep-free component rendering
(`TwoAxisPip.test.tsx` proves the `renderToStaticMarkup` path). No framework install, no jsdom, no
config change is required. The remaining scaffolds are all in-phase test EXTENSIONS/additions, not
infrastructure:

- [x] `vitest.config.ts` + `.test.tsx` discovery + `@/` alias + component-render path — **already exists** (no Wave 0 install).
- [ ] Extend `src/lib/queue/state.test.ts` — `withdrawn` legal edge + terminal (Plan 01 Task 1, RED→GREEN).
- [ ] New `src/lib/queue/withdraw.test.ts` — guarded `approved→withdrawn`, 0-row lost-race throw + audit-row (Plan 03 Task 1).
- [ ] Extend `src/app/actions/queue` tests — `enqueueAndApprove` audit trail + params-only + `staleAck` recorded (Plan 03 Task 2).
- [ ] New `src/lib/overview/node-filter` util + test — pure view filter, honest empty (Plan 02 Task 1).
- [ ] New `src/lib/read/node-services` test — pubkey→hostId attribution (Plan 05 Task 1).
- [ ] New `src/components/node/NodeFeeEnqueue.test.tsx` — D-05 stale-gate behavioral coverage, dep-free (Plan 06 Task 4).

*These are ordinary RED→GREEN task work inside their owning plans, not a separate Wave 0 setup pass —
the phase's test infrastructure is already in place.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Node Detail single-scroll + write path visually correct end-to-end | NODE-04 | Full-page composition + navy CONFIRM affordance + stale/withdraw treatments are visual/interaction fidelity that automated compile+unit cannot fully certify | Plan 08 Task 3 operator visual gate — load a node, exercise a per-channel fee queue (raise + lower), confirm the stale-baseline warning + staleAck gate, and a withdraw on an approved-unclaimed row |

*All other phase behaviors have automated verification. The D-05 stale-gate LOGIC is now automated
(Plan 06 Task 4); the manual gate covers only end-to-end visual/interaction fidelity.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (only the two operator/BLOCKING gates are non-automated by nature: 13-01-03 migration inspection, 13-08-03 visual gate)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all resolved to in-phase test extensions; no infra install needed)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-08
</content>
