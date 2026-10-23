---
phase: 1
slug: foundations-read-layer
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (new — no test framework existed in the workspace; installed in Plan 01) |
| **Config file** | `vitest.config.ts` — created in Plan 01 Task 2 (plain node/ESM, NO Next.js Vitest plugin) |
| **Quick run command** | `npx vitest run src/lib/format` (formatter only, < 5s, no DB) |
| **Full suite command** | `npx vitest run` (formatter + AFM-001 helper shape + golden invariant + health; live tests skip without `ROUTING_VM_DATABASE_URL`) |
| **Estimated runtime** | ~5s quick / ~15–30s full (live-warehouse tests add network latency when env present) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/format` (fast, no DB) plus the task's own `<automated>` verify command
- **After every plan wave:** Run `npx vitest run` (full — includes live-warehouse invariant + read-only checks when network/env available; skips cleanly otherwise)
- **Before `/gsd:verify-work`:** Full suite green AND the boot health check passes against the real warehouses (`npm run dev` boots)
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | READ-03 | T-01-02 | Scaffold ships no secret/DB string; `.env.example` names only; navy not orange | build | `npm run build` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | READ-03 | T-01-03 | Vitest config has no Next plugin; runs clean | smoke | `npx vitest run --reporter=basic` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | READ-03 | T-01-01 | AFM-002 formatter is single conversion source; ±1% back-conversion | unit (no DB) | `npx vitest run src/lib/format/units.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 2 | READ-01 | T-02-02 / T-02-04 | Three server-only fail-loud clients; no localhost literal | typecheck + grep | `npx tsc --noEmit && grep -rn localhost src` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 2 | READ-01 | T-02-01 / T-02-02 | Boot check rejects warehouse write (25006/42501); env-missing throws | integration (guarded) | `npx vitest run src/lib/db/health.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 2 | READ-01 | T-02-03 | role-grants.sql SELECT-only + read-only-forced + scoped; IP-whitelist doc | grep gate | `grep -q default_transaction_read_only db/role-grants.sql` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 2 | READ-01 | T-02-01 | Live boot health check passes against real warehouses + local nodemon | manual (operator) | `npm run dev` boots without throw | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 3 | READ-02 | T-03-03 / T-03-04 | LDK columns introspected live before mapping; warehouse pull artifacts deleted | typecheck + grep | `npx tsc --noEmit && grep -qi "DISTINCT ON" src/lib/db/schema/routing.ts` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 3 | READ-02 | T-03-01 / T-03-02 | AFM-001 helper emits DISTINCT ON, never MAX; param-bound | unit (no DB) | `npx vitest run src/lib/read/latest.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 3 | READ-02 | T-03-01 | Golden invariant: DISTINCT ON count ≈ active_channels across reference set | integration (live) | `npx vitest run src/lib/read/golden.test.ts` | ❌ W0 | ⬜ pending |
| 01-04-01 | 04 | 4 | READ-04 | T-04-01 / T-04-03 | mapLndNode/mapLdkNode → identical UnifiedNode; no any-leak; raw sat | unit (no DB) | `npx vitest run src/lib/read/nodes.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 01-04-02 | 04 | 4 | READ-04 | T-04-02 / T-04-03 | Status page Server Component; server-only boundary holds; formatter-only conversion | build | `npm run build` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All test infrastructure is greenfield (no framework existed). Wave 0 (Plan 01) installs Vitest + the config, then each plan scaffolds its own tests before/with implementation:

- [ ] `vitest.config.ts` + Vitest install (Plan 01 Task 2) — no framework currently exists
- [ ] `src/lib/format/units.test.ts` — AFM-002 reference values (Plan 01, READ-03)
- [ ] `src/lib/db/health.test.ts` — env-missing throw + read-only/reachability (guarded live) (Plan 02, READ-01)
- [ ] `src/lib/read/latest.test.ts` — AFM-001 helper shape: DISTINCT ON present, MAX absent (Plan 03, READ-02)
- [ ] `src/lib/read/golden.test.ts` — live cross-consistency invariant across reference nodes (Plan 03, READ-02 AC)
- [ ] `src/lib/read/nodes.test.ts` — both backends → identical UnifiedNode (Plan 04, READ-04)
- [ ] Live tests guarded by `describe.skipIf(!process.env.ROUTING_VM_DATABASE_URL)` so they skip cleanly without warehouse network/IP-whitelist

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Boot health check passes against the REAL warehouses + local nodemon | READ-01 | Requires operator to run role-grants.sql, whitelist the run-host IP in warehouse `pg_hba.conf`/firewall, and stand up the local nodemon DB — the app cannot self-satisfy these (Plan 02 checkpoint) | Provision per `docs/SETUP-PREREQUISITES.md`, populate `.env.local`, run `npm run dev`; the server must boot with no throw |
| Golden invariant passes live across Canada + Tier-M + edge nodes | READ-02 | Needs live warehouse access (IP-whitelisted) + Sweden/India pubkey resolution at execute time (Plan 03 checkpoint) | After Plan 02 prerequisites, `npx vitest run src/lib/read/golden.test.ts`; confirm Canada count ≈ active_channels and edge node passes (0 ≈ 0 if offline) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (checkpoint tasks carry a `<how-to-verify>` manual procedure)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Vitest + 5 test files scaffolded across the plans)
- [x] No watch-mode flags (`vitest run`, never `vitest --watch`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-07
