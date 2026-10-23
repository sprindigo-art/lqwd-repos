---
phase: 17-incident-lifecycle-ai-explanation
plan: 07
subsystem: components/incident (net-new UI)
tags: [incident-ui, INC-02, AIX-01, AIX-02, tracking-controls, verdict-badge, snoozed-banner, tdd, df-grammar]

# Dependency graph
requires:
  - "ackIncident/assignIncident/snoozeIncident/unsnoozeIncident (Plan 05, src/app/actions/incident-tracking.ts)"
  - "narrateIncident(key) (Plan 06, src/app/actions/narrate-incident.ts)"
  - "AiReadPanel + AiReadLine (src/components/df/AiReadPanel.tsx) — frozen safety copy, inert render"
  - "severityAccent / severityVariants / Severity (src/components/df/Severity.ts) — the only sanctioned sev→class mappers"
  - "NarrateButton trigger grammar + AiBandClient session-dismiss precedent"
provides:
  - "IncidentTrackingControls (client) — ack/assign/snooze cluster wired to Plan-05 actions"
  - "IncidentReadClient + VerdictBadge + VERDICT_LABEL (client) — on-demand AI read + worstSeverity verdict + session dismiss"
  - "SnoozedCriticalBanner (server) — non-dismissible critical-ramp honesty banner"
affects: [17-08, 17-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useTransition optimistic gesture with revert-on-{ok:false} per control (NarrateButton precedent)"
    - "session-only dismiss via useState(false) → return null (AiBandClient / D-15, no persistence)"
    - "verdict derived from deterministic worstSeverity prop (never model text), wears severity ramp never navy (DS-01/FM-3)"
    - "renderToStaticMarkup .test.tsx under node (no jsdom); server-action mocked with vi.mock for the client-read test"

key-files:
  created:
    - src/components/incident/IncidentTrackingControls.tsx
    - src/components/incident/IncidentTrackingControls.test.tsx
    - src/components/incident/IncidentReadClient.tsx
    - src/components/incident/IncidentReadClient.test.tsx
    - src/components/incident/SnoozedCriticalBanner.tsx
    - src/components/incident/SnoozedCriticalBanner.test.tsx
  modified: []

key-decisions:
  - "Acknowledge is one-directional (no un-ack action exists in Plan 05) — the ack'd stamp is the terminal state; aria-pressed reflects it"
  - "Assign optimism uses a placeholder owner ('you') on the client since the operator id lives server-side; owner string from props drives the ack stamp"
  - "Verdict badge placed as the leading child directly above the reused (verbatim) AiReadPanel — AiReadPanel is frozen and has no verdict slot, so the chip leads the read region rather than mutating the panel; prose passed as a single AiReadLine body (inert whitespace-pre-wrap)"
  - "VERDICT_LABEL collapses healthy/stale → 'Informational' (only critical/warning/watch are meaningful incident verdicts)"
  - "Two test-fixture corrections (React escapes the ack-stamp apostrophe to &#x27;; SnoozedCriticalBanner comment reworded to avoid the literal 'use client' token the invariant grep matches) — no behavior change"

requirements-completed: [INC-02, AIX-01, AIX-02]

# Metrics
duration: ~20min
completed: 2026-07-20
---

# Phase 17 Plan 07: Incident UI — Tracking Controls, AI Read + Verdict, Snoozed Banner Summary

**Built the three net-new incident surfaces from locked df grammar: a reversible ack/assign/snooze tracking cluster (navy affordance, optimistic + revert), an on-demand AI read client leading with a worstSeverity-derived verdict badge over the inert `AiReadPanel` with session-only dismiss, and a non-dismissible critical-ramp snoozed-critical honesty banner — all wired to the Plan 05/06 server actions with renderToStaticMarkup render tests.**

## Performance
- **Duration:** ~20 min
- **Completed:** 2026-07-20
- **Tasks:** 3 (all autonomous, TDD)
- **Files created:** 6 (3 source + 3 test)

## Accomplishments
- **`IncidentTrackingControls.tsx` (INC-02)** — `"use client"` cluster taking `{ incidentKey, tracking }`. Acknowledge toggle → `ack'd · {owner} · {age}` terminal stamp; Assign-to-me / Unassign solo toggle; fixed 1h·4h·24h snooze `role="group"` (tabular-nums) + a "snoozed until {time}" chip with an Un-snooze affordance. Each gesture calls its Plan-05 action inside `useTransition` with optimistic state that reverts on `{ok:false}`. Navy affordance only — no severity ramp on any control (grep-verified).
- **`IncidentReadClient.tsx` + `VerdictBadge` (AIX-01/AIX-02)** — `"use client"` taking `{ incidentKey, worstSeverity, rationaleLine? }`. `EXPLAIN — LLM` / `READING…` trigger via `useTransition` calling `narrateIncident`; on success renders the reused `AiReadPanel` (inert prose) LED by a `VerdictBadge` (severity chip from `severityAccent[worstSeverity]`, never navy). On `{ok:false}` renders the fixed `AI read unavailable — the incident details below stand on their own.` copy. Session-only dismiss (`useState(false) → return null`, no persistence, D-15). The AIX-02 rationale line renders alongside.
- **`SnoozedCriticalBanner.tsx` (D-04)** — pure server component `{ count }`; `null` when `count === 0`, else the critical-ramp banner (`severityVariants({sev:"critical"})` + 3px left `.sectionbar` border) with pluralized copy `{N} snoozed critical incident{s} — muted, not resolved`, count in `tabular-nums`. No dismiss control, no client directive.

## Must-Haves Verified
- Tracking cluster offers ack / assign / snooze(1h·4h·24h) with optimistic pending, no confirm dialog. ✓
- AI read triggers `narrateIncident` on demand, inert prose in `AiReadPanel`, session-only dismiss (no persisted dismiss, D-15). ✓
- AI read leads with a verdict badge derived from `worstSeverity`, never navy. ✓
- Snoozed-critical banner is a non-dismissible critical-ramp server component shown when count > 0. ✓

## Task Commits
| Task | Name | Commit(s) | Files |
| ---- | ---- | --------- | ----- |
| 1 | IncidentTrackingControls (INC-02) | a0e4dae (test), a0d4b12 (feat) | IncidentTrackingControls.tsx (+test) |
| 2 | IncidentReadClient + VerdictBadge (AIX-01/02) | 49b8d1d (test), a51e902 (feat) | IncidentReadClient.tsx (+test) |
| 3 | SnoozedCriticalBanner (D-04) | 5f34753 (test), 2b3b7a8 (feat) | SnoozedCriticalBanner.tsx (+test) |

## Verification
- `npx vitest run src/components/incident` → 14 passed (3 files).
- `npx tsc --noEmit` → no type errors in the incident components.
- `grep -nE "df-critical|df-warning|severityAccent" IncidentTrackingControls.tsx` → clean (controls are navy, not state).
- `grep -n "useTransition" IncidentTrackingControls.tsx` → present.
- `grep -nE "text-df-brand|bg-df-chrome|df-brand" IncidentReadClient.tsx` → navy on the trigger button ONLY (line 114), never on the verdict chip.
- `grep -n "dangerouslySetInnerHTML" IncidentReadClient.tsx` → only in a comment, no HTML sink.
- `grep -nE "use client|onClick|onDismiss" SnoozedCriticalBanner.tsx` → clean (non-dismissible server component).

## TDD Gate Compliance
- Task 1 — RED a0e4dae (module absent, no tests ran) → GREEN a0d4b12 (5/5). Test-fixture fix folded into GREEN (see Deviations).
- Task 2 — RED 49b8d1d (module absent) → GREEN a51e902 (5/5).
- Task 3 — RED 5f34753 (module absent) → GREEN 2b3b7a8 (4/4).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ack-stamp test assertion matched an unescaped apostrophe**
- **Found during:** Task 1 (GREEN)
- **Issue:** The test asserted `toContain("ack'd ·")`, but React escapes the apostrophe in text nodes to `&#x27;` in the `renderToStaticMarkup` output, so the literal string never matched. The implementation was correct; the fixture was wrong (mirrors the AiReadPanel test's `&amp;` convention).
- **Fix:** Assert `toContain("ack&#x27;d ·")`.
- **Files modified:** src/components/incident/IncidentTrackingControls.test.tsx
- **Commit:** a0d4b12 (folded into GREEN)

**2. [Rule 3 - Blocking] Banner comment tripped the non-dismissible invariant grep**
- **Found during:** Task 3 (GREEN)
- **Issue:** The acceptance grep `grep -nE "use client|onClick|onDismiss"` must return nothing, but a source comment contained the literal words "use client".
- **Fix:** Reworded the comment to "no client directive" (same pattern Plan 05 used so the grep proves the invariant against real code, not prose). No behavior change.
- **Files modified:** src/components/incident/SnoozedCriticalBanner.tsx
- **Commit:** 2b3b7a8 (folded into GREEN)

## Threat Model Compliance
- **T-17-15 (XSS elevation):** AI prose renders through `AiReadPanel`'s inert `whitespace-pre-wrap`, React-escaped path; no `dangerouslySetInnerHTML`, no markdown-to-HTML. ✓
- **T-17-16 (info hiding):** `SnoozedCriticalBanner` is non-dismissible and shown whenever `count > 0` (D-04); the verdict chip derives from `worstSeverity` and never visually downgrades a critical (FM-3). ✓
- **T-17-17 (tampering):** controls call the KEY-validated Plan-05 server actions only; no fleet write path; optimistic state reverts on `{ok:false}`. ✓
- **T-17-SC (supply chain):** zero new packages installed. ✓

## Threat Flags
None — no new network endpoints, auth paths, file access, or schema surface. The components only trigger existing server actions and render props.

## Known Stubs
None — all three components are fully wired to the Plan 05/06 actions and the frozen df primitives; no placeholder data paths.

## Self-Check: PASSED
- FOUND: src/components/incident/IncidentTrackingControls.tsx (+ .test.tsx)
- FOUND: src/components/incident/IncidentReadClient.tsx (+ .test.tsx)
- FOUND: src/components/incident/SnoozedCriticalBanner.tsx (+ .test.tsx)
- FOUND commits: a0e4dae, a0d4b12, 49b8d1d, a51e902, 5f34753, 2b3b7a8

---
*Phase: 17-incident-lifecycle-ai-explanation*
*Completed: 2026-07-20*
