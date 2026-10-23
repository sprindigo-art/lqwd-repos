---
phase: 17-incident-lifecycle-ai-explanation
verified: 2026-07-21T15:23:00Z
status: human_needed
score: 4/4 must-haves verified (code); 1 operator visual gate pending
overrides_applied: 0
human_verification:
  - test: "Open an incident from the overview queue (card → incidents/[key]) and confirm the D-10 region order renders correctly: status header → AI read → why-chain → blast-radius → grouped child alerts."
    expected: "Five regions render top-to-bottom in D-10 order; severity chips wear the ramp (never navy); blast-radius containment tree and why-chain spine render as SVG/CSS."
    why_human: "Visual layout order and rendered appearance of df primitives cannot be confirmed by grep; requires a running app and human eyes."
  - test: "Acknowledge an incident, then snooze a non-critical, then snooze a critical."
    expected: "Ack keeps the incident visible but sorts it lower (never hides); snoozing a non-critical removes it from the queue; snoozing a critical removes it from the queue BUT the persistent 'N snoozed critical' banner appears on BOTH overview and incident detail."
    why_human: "Live queue re-ordering, drop behavior, and the fleet-wide banner require an interactive session against real/seeded tracking state and the live nodemon DB."
  - test: "With INSIGHT_LLM_ENABLED=true and ANTHROPIC_API_KEY set, press EXPLAIN — LLM on an incident, then dismiss the read with ✕ and reload."
    expected: "A verdict badge (Act now / Monitor / Informational) leads advisory prose; NO runnable command/lncli/systemctl/code fence appears; dismiss hides the read for the session; a reload re-derives (returns) it."
    why_human: "Live LLM output quality, the verdict-vs-severity pairing, and session-only dismiss behavior require a real model call and browser session."
  - test: "After exercising ack/assign/snooze, confirm nothing on any Lightning node changed."
    expected: "Zero fleet mutation — tracking writes land only in nodemon.incident_tracking; no node credentials touched, no fee/channel/rebalance side effects."
    why_human: "The zero-write-path invariant against the live fleet is an operational assertion; code shows nodemon-only imports, but end-to-end confirmation is an operator gate (Plan 09 Task 3, gate=blocking)."
---

# Phase 17: Incident Lifecycle + AI Explanation — Verification Report

**Phase Goal:** Close the loop on attention — Incident Detail with the root-cause why-chain and blast-radius, tracking-only acknowledge/assign/snooze, and the AI explanation layer that produces the cross-layer root-cause grouping rationale shown on the overview and incident detail. Provider layer swappable (D17).
**Verified:** 2026-07-21T15:23:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

The four ROADMAP Success Criteria are the contract; each is backed by verified code and green in-scope tests. An operator visual gate (Plan 09 Task 3, gate=blocking) is deliberately deferred for the visual + live-LLM behaviors — see Human Verification Required.

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | INC-01: Incident Detail shows root-cause why-chain / detection timeline, blast-radius (one host → affected nodes), grouped child alerts, and cross-links | VERIFIED | `incidents/[incidentKey]/page.tsx` composes `WhyChain`(buildWhyChain), `BlastRadius`(buildBlastTargets/buildBlastRoot), collapsible `<details>` groups of `SeverityRow` each with a real `href` (childHref), in exact D-10 order (page.tsx:235-332). `buildWhyChain` preserves engine order + "—" for null asOf; `buildBlastTargets` excludes fee children (incident-detail.ts:35-53). 132 in-scope tests green. |
| 2 | INC-02: operator can ack/assign/snooze, tracking-only (never touch fleet); status+owner reflect; a critical cannot be silently muted | VERIFIED | `reconcileTracking` state machine implements D-04..D-07 with breakthrough-before-snooze ordering, no `.sort`, partitioned engine order (incident-tracking.ts:103-168). Server actions `ackIncident/assignIncident/snoozeIncident/unsnoozeIncident` import ONLY dbNodemon + incidentTracking + loadIncidents — no fleet/warehouse client (incident-tracking.ts action file). `SnoozedCriticalBanner` non-dismissible, shown when count>0 on overview (page.tsx:522-524) AND host/detail. Partial-unique `(incident_key) WHERE cleared_at IS NULL` in schema + migration 0004. |
| 3 | AIX-01: AI log/error read in plain language, needs-attention verdict, dependency/impact path; labeled AI, dismissible, never emits a runnable command | VERIFIED | `narrateIncident` is server-gated (isLlmEnabled re-check before any import), server-recomputes via loadIncidents().find(.key), passes output through `assertAdvisoryOnly`, degrades to {ok:false} on any throw (narrate-incident.ts:36-93). `assertAdvisoryOnly` blocks lncli/lncmd/systemctl/shell-fence/$-prompt/numbered-steps/.conf (guardrails.ts:180-219). `IncidentReadClient` renders verdict badge (severity ramp, never navy) + inert AiReadPanel + session-only useState dismiss (IncidentReadClient.tsx). Prompt wraps payload in BEGIN/END_UNTRUSTED delimiters (incident-prompt.ts:21-93). |
| 4 | AIX-02: AI cross-layer correlation → root-cause grouping rationale shown on overview AND incident detail | VERIFIED | Deterministic grouping stays source of truth (`assembleIncidents`); AI narrates it. `buildBandLines` drives the overview AI band (`(overview)/page.tsx:247,546` via AiBandClient) AND the detail-page rationaleLine (`incidents/[incidentKey]/page.tsx:216,270`). `AiReadLine` carries no action/param/command key by construction (D-14). |

**Score:** 4/4 truths verified in code. Operator visual/live-LLM confirmation pending (human_needed).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/lib/overview/incident-detail.ts` | buildWhyChain + buildBlastTargets pure builders | VERIFIED | 86 lines; pure, engine-order preserved, fee children excluded; exports present |
| `src/lib/overview/incident-prompt.ts` | buildIncidentPrompt + INCIDENT_READ_SYSTEM_PROMPT | VERIFIED | 94 lines; untrusted delimiters, deterministic top-N truncation, no re-derive |
| `src/lib/insight/guardrails.ts` | assertAdvisoryOnly text guardrail | VERIFIED | 219 lines; word-bounded command signatures + fence/prompt/step/config checks |
| `src/lib/overview/incident-tracking.ts` | reconcileTracking pure state machine | VERIFIED | 168 lines; D-04..D-07, breakthrough-first ordering, no `.sort`, inputs unmutated |
| `src/lib/db/schema/nodemon.ts` | incidentTracking pgTable + partial-unique | VERIFIED | 554 lines; `incident_tracking_active_key_uniq` WHERE cleared_at IS NULL + key idx |
| `drizzle/nodemon/0004_strong_vapor.sql` | migration adding incident_tracking | VERIFIED | CREATE TABLE + partial-unique index; manual apply variant present |
| `src/lib/overview/load-incidents.ts` | shared loadIncidents loader | VERIFIED | 69 lines; consumed by overview, host detail, detail page, and narrate action |
| `src/lib/db/read/incident-tracking.ts` | loadActiveTracking + applyTrackingWrites + reconcileAndGetView | VERIFIED | 113 lines; transactional guarded UPDATEs `WHERE id=? AND cleared_at IS NULL` |
| `src/app/actions/incident-tracking.ts` | ack/assign/snooze/unsnooze server actions | VERIFIED | 186 lines; KEY_RE-gated, transactional upsert, D-06 mute baseline, nodemon-only |
| `src/app/actions/narrate-incident.ts` | narrateIncident advisory read action | VERIFIED | 93 lines; flag re-check, server-recompute, guardrail post-check, degrade |
| `src/components/incident/IncidentTrackingControls.tsx` | ack/assign/snooze cluster | VERIFIED | 194 lines; useTransition optimistic, 1h/4h/24h presets, aria-pressed |
| `src/components/incident/IncidentReadClient.tsx` | on-demand read + verdict badge + session dismiss | VERIFIED | 137 lines; verdict from worstSeverity (never navy), inert panel, useState dismiss |
| `src/components/incident/SnoozedCriticalBanner.tsx` | non-dismissible honesty banner | VERIFIED | 46 lines; critical ramp, no dismiss, null when count<=0 |
| `src/app/(overview)/incidents/[incidentKey]/page.tsx` | Incident Detail RSC in D-10 order | VERIFIED | 345 lines; loadIncidents().find(.key), notFound() outside try, D-10 regions |
| `src/app/(overview)/page.tsx` | tracking-aware overview + banner | VERIFIED | reconcileAndGetView OUTSIDE the data memo (line 474-491), banner + card links |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| incident-prompt.ts | GroupedIncident | type import | WIRED |
| incident-tracking.ts | GroupedIncident | type import | WIRED |
| schema/nodemon.ts | nodemon DB | drizzle generate → migrate 0004 | WIRED (migration in-repo; live table operator-applied, confirmed) |
| hosts/[hostId]/page.tsx | load-incidents.ts | loadIncidents().find(.key === hostId) | WIRED (page.tsx:284-285) |
| narrate-incident.ts | load-incidents.ts | server-recompute find(.key) | WIRED (narrate-incident.ts:65) |
| narrate-incident.ts | assertAdvisoryOnly | post-generation guardrail | WIRED (narrate-incident.ts:83) |
| incident-tracking action | nodemon.incident_tracking | dbNodemon.transaction guarded upsert | WIRED |
| IncidentTrackingControls | incident-tracking action | useTransition ack/snooze/assign | WIRED |
| IncidentReadClient | narrate-incident action | useTransition narrateIncident | WIRED |
| incidents/[incidentKey]/page.tsx | load-incidents.ts | loadIncidents().find(.key === incidentKey) | WIRED (page.tsx:143-144) |
| incidents/[incidentKey]/page.tsx | incident-detail.ts | buildWhyChain/buildBlastTargets | WIRED (page.tsx:213-214) |
| overview/page.tsx | read/incident-tracking.ts | reconcileAndGetView outside memo | WIRED (page.tsx:487) |
| overview/page.tsx | incidents/[incidentKey] | queue card links to incidents/[key] | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| In-scope phase-17 suites | `npx vitest run` (13 files) | 13 files / 132 tests passed | PASS |
| Typecheck | `npx tsc --noEmit` | clean (exit 0) | PASS |
| NOC token guard | `npm run lint:noc-guard` | v2 surfaces clean | PASS |
| D17 provider swappability | inspect provider.ts registry | anthropic/openai/google registered; AI_MODEL override | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| INC-01 | 17-01, 17-04, 17-08 | Incident Detail: why-chain/timeline, blast-radius, grouped child alerts, cross-links | SATISFIED | Detail page composes all four in D-10 order (Truth 1) |
| INC-02 | 17-02, 17-03, 17-05, 17-07, 17-09 | Ack/assign/snooze tracking-only; status+owner reflect; critical never silently muted | SATISFIED | reconcileTracking + nodemon-only actions + banner + partial-unique (Truth 2) |
| AIX-01 | 17-01, 17-06, 17-07 | AI log/error read: plain language, needs-attention, impact path; labeled, dismissible, command-free | SATISFIED | narrateIncident + assertAdvisoryOnly + verdict badge + session dismiss (Truth 3) |
| AIX-02 | 17-06, 17-07, 17-08 | AI cross-layer correlation → grouping rationale on overview AND incident detail | SATISFIED | buildBandLines on both surfaces; AiReadLine no-action pin (Truth 4) |

All four requirement IDs declared across the 9 plans (INC-01, INC-02, AIX-01, AIX-02) map 1:1 to REQUIREMENTS.md lines 113-119 and the ROADMAP Phase-17 requirement list. No orphaned requirements; no unclaimed IDs.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER in any phase-17 in-scope file | — | None |

No debt markers, no stub returns feeding user-visible output, no hardcoded-empty props at call sites. The `return null` in SnoozedCriticalBanner (count<=0) is a correct empty-state, not a stub.

### Human Verification Required

Phase 17 is UI-heavy and includes an explicit **blocking operator visual gate** (Plan 09 Task 3). The deterministic logic, wiring, guardrails, and tests are all verified in code; the following require a running app / live LLM / operator eyes and are surfaced to HUMAN-UAT:

1. **D-10 region order + df rendering** — open an incident, confirm status header → AI read → why-chain → blast-radius → grouped children render correctly with severity-ramp chips (never navy) and SVG containment tree.
2. **Lifecycle behaviors live** — ack lowers-but-keeps; non-critical snooze drops; critical snooze drops BUT the "N snoozed critical" banner shows on overview AND detail.
3. **AI read (flag on + API key)** — EXPLAIN produces a verdict badge + advisory prose, no runnable command, session-only dismiss (returns on reload).
4. **Zero fleet mutation** — confirm ack/assign/snooze changed nothing on any node (tracking-only invariant).

### Gaps Summary

No code gaps. Every must-have across all 9 plans is implemented, substantive, wired, and covered by green in-scope tests (132 passing). `tsc` clean, noc-guard clean, no debt markers. The zero-write-path invariant is upheld in code (tracking actions import only dbNodemon + incidentTracking + loadIncidents; no fleet/warehouse client). D17 provider swappability is present (anthropic/openai/google registry + AI_MODEL). The 17-03 nodemon migration and 17-09 overview wiring were the two `autonomous:false` plans; the migration artifacts are in-repo and the live table was operator-applied (owner role) and confirmed — not a phase-17 gap.

Status is `human_needed` (not `passed`) solely because Plan 09 deliberately deferred a blocking operator visual gate covering visual layout, live lifecycle interaction, and live-LLM output — none of which can be verified programmatically.

Note (informational, not a phase-17 gap): 17-09-SUMMARY flags a follow-up outside phase scope — service-health chips drop `service_health.detail` (the "why" tooltip), tracked as a later slice. This does not affect any Phase-17 success criterion.

---

_Verified: 2026-07-21T15:23:00Z_
_Verifier: Claude (gsd-verifier)_
