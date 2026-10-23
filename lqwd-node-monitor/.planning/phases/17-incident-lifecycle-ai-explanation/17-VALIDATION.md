---
phase: 17
slug: incident-lifecycle-ai-explanation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-20
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `17-RESEARCH.md` § Validation Architecture (runner: **Vitest**).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (installed; `"test": "vitest run"`) |
| **Config file** | `vitest.config.ts` (node env, `@/`→`src`, `server-only` stubbed) |
| **Quick run command** | `npx vitest run src/lib/overview src/lib/insight` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Component render tests** | `renderToStaticMarkup` (no jsdom) — `.test.tsx` under node |
| **Estimated runtime** | ~sub-second for pure modules; full suite seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/overview src/lib/insight` (fast pure modules — sub-second, no API key)
- **After every plan wave:** Run `npm test` (full suite green)
- **Before `/gsd:verify-work`:** Full suite green + AI eval golden-set (AI-SPEC §5, `promptfoo`, needs `ANTHROPIC_API_KEY`, nightly/pre-deploy)
- **Max feedback latency:** < 5 seconds for the quick command

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| INC-01 | shared loader `assembleIncidents(...).find(i=>i.key===k)` selects one incident | unit | `npx vitest run src/lib/overview/load-incidents.test.ts` | ❌ W0 |
| INC-01 | `buildWhyChain` preserves engine order, honest `—` for null asOf | unit | `npx vitest run src/lib/overview/incident-detail.test.ts` | ❌ W0 |
| INC-01 | `buildBlastTargets` excludes fee summaries; 1..N targets | unit | `npx vitest run src/lib/overview/incident-detail.test.ts` | ❌ W0 |
| INC-01 | Incident Detail SSR renders header→AI→why-chain→blast→children (D-10) | render (tsx) | component render test | ❌ W0 |
| INC-02 | reconcile: snooze drops from queue; snoozed-critical collected (D-04) | unit | `npx vitest run src/lib/overview/incident-tracking.test.ts` | ❌ W0 |
| INC-02 | reconcile: ack stable-partitions lower, never hides (D-05) | unit | `npx vitest run src/lib/overview/incident-tracking.test.ts` | ❌ W0 |
| INC-02 | reconcile: escalation breakthrough clears mute + resurfaces (D-06) | unit | `npx vitest run src/lib/overview/incident-tracking.test.ts` | ❌ W0 |
| INC-02 | reconcile: resolution sets `cleared_at`; recurrence = fresh row (D-07) | unit | `npx vitest run src/lib/overview/incident-tracking.test.ts` | ❌ W0 |
| INC-02 | tracking writes hit nodemon ONLY, never a fleet write (invariant) | unit | assert action imports only `dbNodemon`/`incidentTracking` | ❌ W0 |
| AIX-01 | `assertAdvisoryOnly` blocks lncli/systemctl/fences/step-lists | unit | `npx vitest run src/lib/insight/guardrails.test.ts` | ⚠️ extend |
| AIX-01 | `buildIncidentPrompt` wraps payload in untrusted delimiters | unit | `npx vitest run src/lib/overview/incident-prompt.test.ts` | ❌ W0 |
| AIX-01 | `narrateIncident` flag-off/error → `{ok:false}`, UI intact (FM-5) | integration | mocked/disabled provider vitest | ❌ W0 |
| AIX-02 | rationale reuses `AiReadLine` shape, no `action` key (`Object.keys`) | unit | `npx vitest run src/lib/overview/ai-band.test.ts` | ⚠️ extend |
| AIX-01/02 | verdict badge derives from `worstSeverity`, never navy | render | component test | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/overview/incident-tracking.test.ts` — D-04..D-07 state machine (highest-risk logic)
- [ ] `src/lib/overview/incident-detail.test.ts` — `buildWhyChain` / `buildBlastTargets`
- [ ] `src/lib/overview/load-incidents.test.ts` — shared loader / `.find(i=>i.key===k)`
- [ ] `src/lib/overview/incident-prompt.test.ts` — untrusted-delimiter wrapping
- [ ] `src/lib/insight/guardrails.test.ts` — EXTEND with `assertAdvisoryOnly` (incl. adversarial injection strings)
- [ ] Incident Detail + IncidentTrackingControls + SnoozedCriticalBanner render tests (`renderToStaticMarkup`)
- [ ] AI eval scaffold under `evals/incident-read/` (AI-SPEC §5) — golden payloads + rubric (grow to 15)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| AI read quality / faithfulness at scale | AIX-01/AIX-02 | LLM output non-deterministic; golden-set eval is nightly/pre-deploy, not per-commit | Run `promptfoo` eval golden-set with `ANTHROPIC_API_KEY` set; review rubric scores per AI-SPEC §5 |
| Live nodemon migration applies cleanly | INC-02 | Real DB push (`drizzle-kit push`) can't run in unit tests | Run the [BLOCKING] schema-push task against the nodemon DB; confirm tracking table + partial-unique index exist |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
