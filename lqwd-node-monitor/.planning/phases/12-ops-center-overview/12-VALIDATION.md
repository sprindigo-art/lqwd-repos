---
phase: 12
slug: ops-center-overview
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-30
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from the Validation Architecture section of `12-RESEARCH.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/lib/overview` |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | ~10–20 seconds (pure fixture-driven units) |

The new `src/lib/overview/*` namespace is pure + fixture-testable, mirroring the
existing `src/lib/insight/rank.test.ts` / `telemetry-bands` / `service-health`
test analogs. No DB or network needed for the unit layer — feed read-helper
return shapes as fixtures.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/overview`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

> Filled/refined by the planner against the five hard parts. Each maps to a
> specific vitest file per the RESEARCH Validation Architecture section.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-T2 | 01 | 1 | OVW-01/03/05 (severity-map) | T-12-MAP-01 | severity vocab routes only through `severity-map.ts` | unit (tdd) | `npx vitest run src/lib/overview/severity-map` | created W1 | ⬜ pending |
| 12-02-T2 | 02 | 1 | OVW-01 (ownership) | T-12-OWN-01 | host→service→node→channel derived read-time, no stored graph | unit (tdd) | `npx vitest run src/lib/overview/ownership` | created W1 | ⬜ pending |
| 12-03-T2 | 03 | 2 | OVW-01/04 (incidents) | T-12-INC-01 | parent failure collapses children into one incident, severity = worst child; stale honest | unit (tdd) | `npx vitest run src/lib/overview/incidents` | created W2 | ⬜ pending |
| 12-04-T2 | 04 | 2 | OVW-03 (vitals) | T-12-VIT-01 | strictly proportional counts per state per layer | unit (tdd) | `npx vitest run src/lib/overview/vitals` | created W2 | ⬜ pending |
| 12-05-T2 | 05 | 3 | OVW-02 (ai-band) | T-12-01 | band never emits a command/param (advisory-only) | unit (tdd) | `npx vitest run src/lib/overview/ai-band src/lib/insight/guardrails` | created W3 | ⬜ pending |
| 12-06-T1 | 06 | 3 | OVW-05 (filter) | T-12-02 | layer+severity filter is a pure whitelisted view; honest empty state | unit (tdd) | `npx vitest run src/lib/overview/filter` | created W3 | ⬜ pending |
| 12-06-T2 | 06 | 3 | OVW-02/05 (islands) | T-12-DIS-01 | session-scoped dismiss; navy-structural filter chips | component | `npx vitest run src/components/overview/QueueFilters` | created W3 | ⬜ pending |
| 12-07-T1 | 07 | 4 | OVW-01..05 (page) | T-12-03 | zero write path; force-dynamic fail-soft composition | suite+typecheck | `npm test` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/overview/severity-map.test.ts` — every source vocab → canonical df ramp (the #1 landmine)
- [ ] `src/lib/overview/ownership.test.ts` — derivation from `hosts.node_pubkeys` / `service_inventory` / `latestChannelsForNode`
- [ ] `src/lib/overview/incidents.test.ts` — containment roll-up + worst-child severity (D-01/D-02)
- [ ] `src/lib/overview/vitals.test.ts` — proportional-by-count math (D-07)
- [ ] `src/lib/overview/ai-band.test.ts` — advisory-only guardrail reaffirmed at the band boundary
- [ ] Shared fixtures for read-helper return shapes (reuse insight/read fixture patterns)

*Existing vitest infrastructure covers framework needs — Wave 0 adds test files + fixtures only, no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual all-clear calm-hero / honest stale rendering | OVW-04 | Visual fidelity vs locked prototype | Load overview against fixtures with (a) nothing wrong, (b) stale data; confirm calm hero + honest stale, never faked-fresh / green-by-default |
| Layer + severity filter interaction + empty states | OVW-05 | Interaction/visual | Toggle each layer/severity filter; confirm honest empty states from Phase-10 primitives |
| LLM-on narration upgrades phrasing only | OVW-02 | Requires `INSIGHT_LLM_ENABLED` + provider | With flag on, confirm band lines rephrase the same deterministic lines; order + selection unchanged |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (test files created test-first in each module's earliest wave)
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-approved 2026-06-30
