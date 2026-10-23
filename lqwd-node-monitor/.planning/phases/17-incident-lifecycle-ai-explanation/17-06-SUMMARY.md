---
phase: 17-incident-lifecycle-ai-explanation
plan: 06
subsystem: overview / insight (AI advisory read)
tags: [ai-read, server-action, guardrails, command-free, tdd, aix-01, aix-02]

# Dependency graph
requires:
  - "Plan 01 (17-01): buildIncidentPrompt + INCIDENT_READ_SYSTEM_PROMPT + assertAdvisoryOnly"
  - "Plan 04 (17-04): loadIncidents() — the shared server-only incident loader (.key selection)"
  - "src/lib/insight/narrative.ts: isLlmEnabled() + lazy-import discipline"
  - "src/lib/ai/provider.ts: getModel() (ai v6 LanguageModel, AI_MODEL-swappable)"
provides:
  - "narrateIncident(key) (src/app/actions/narrate-incident.ts) — AIX-01 per-incident advisory read server action"
  - "AIX-02 command-free structural guarantee for the reused incident-detail rationale, pinned by ai-band.test.ts"
affects:
  - "incident-detail page (future) — the AIX-01 on-demand read + the AIX-02 rationale line"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "server action: isLlmEnabled() gate BEFORE any dynamic import → flag-off runs zero SDK code, API key never touched"
    - "client sends only the KEY; server-recomputes the incident via loadIncidents().find(.key) — never a client card"
    - "assertAdvisoryOnly post-check on generateText output before it reaches the operator (command-shaped → withheld)"
    - "ai v6 generateText bounded with maxOutputTokens (400) + temperature 0.3 (the legacy key is silently ignored in v6)"

key-files:
  created:
    - src/app/actions/narrate-incident.ts
    - src/app/actions/narrate-incident.test.ts
  modified:
    - src/lib/overview/ai-band.test.ts

key-decisions:
  - "narrateIncident is a near-verbatim clone of narrate.ts's defense-in-depth shell, substituting the incident loader + incident prompt builder + assertAdvisoryOnly post-check"
  - "isLlmEnabled is imported at top level (from narrative.ts, matching narrate.ts) — it only reads env; all SDK/provider/loader code is lazy-imported inside the try after the gate"
  - "ai-band.ts is NOT modified — it already ships the command-free contract; the AIX-02 block only pins that guarantee for the incident-detail reuse"

requirements-completed: [AIX-01, AIX-02]

# Metrics
duration: ~10min
completed: 2026-07-20
---

# Phase 17 Plan 06: narrateIncident Advisory Read + AIX-02 Command-Free Pin Summary

**`narrateIncident(key)` is the AIX-01 opt-in, deterministic-first per-incident AI read: it server-gates on `isLlmEnabled()` before touching any SDK, server-recomputes ONE incident from the shared loader by `.key`, bounds `generateText` with `maxOutputTokens`, runs the `assertAdvisoryOnly` post-check, and degrades to `{ok:false}` on any failure — and the AIX-02 rationale's structural command-free guarantee (no action/param/command key) is pinned for the incident-detail reuse.**

## What Was Built

- **`narrate-incident.ts` (AIX-01)** — a near-verbatim clone of `narrate.ts`'s defense-in-depth shell. Flow: `isLlmEnabled()` gate (before any dynamic import) → `KEY_RE`-validate the only client input → lazy-import loader/prompt/guardrail/provider/`ai` inside the try → server-recompute `loadIncidents().find(i => i.key === key)` → `generateText({ model, system: INCIDENT_READ_SYSTEM_PROMPT, prompt: buildIncidentPrompt(incident), maxOutputTokens: 400, temperature: 0.3 })` → `assertAdvisoryOnly(result.text)` post-check → `{ok:true, text}` verbatim or `{ok:false, error}`. Any throw is caught → `{ok:false}` (FM-5).
- **`narrate-incident.test.ts`** — 6 Vitest cases (SDK/provider/loader hoisted-mocked; prompt builder + guardrail real): flag-off → `{ok:false}` with generateText/getModel/loadIncidents never called; invalid key → `{ok:false, "invalid incident id"}` before the recompute; unknown key → `{ok:false, "incident not found"}`; a mocked `lncli`-containing generation → withheld by the guardrail; provider throw → `{ok:false}`; success → `{ok:true, text}` with `generateText` asserted to receive the bounded incident-read config.
- **`ai-band.test.ts` AIX-02 block** — pins that `buildBandLines([incident])` yields ONE rationale line whose `Object.keys` is a subset of `{sev, head, body}` (no `action`/`param`/`command`), and that the line's `sev` equals the incident's own severity (no re-grading). `ai-band.ts` is unchanged — the contract already ships; this locks it for the incident-detail reuse.

## Must-Haves Verified

- narrateIncident is server-gated, server-recomputes the incident, returns advisory prose or `{ok:false}` — opt-in, deterministic-first (D-12). ✓
- generateText output passes `assertAdvisoryOnly` before return; command-shaped output withheld (T-17-02). ✓
- Flag-off / invalid-key / provider-error all return `{ok:false}` without throwing (deterministic UI intact, FM-5). ✓
- AIX-02 rationale reuses `AiReadLine` with no action/param/command key (`Object.keys` pinned) — the AI narrates the deterministic grouping (D-14). ✓
- `maxOutputTokens` used, `maxTokens` absent (T-17-14 bound). ✓

## Task Commits

| Task | Name | Commit(s) | Files |
| ---- | ---- | --------- | ----- |
| 1 | narrateIncident server action (AIX-01) | f2b357f (test), c9bb71b (feat) | narrate-incident.ts (+test) |
| 2 | Pin AIX-02 rationale command-free structure | ccaa484 (test) | ai-band.test.ts |

## Verification

- `npx vitest run src/app/actions/narrate-incident.test.ts src/lib/overview/ai-band.test.ts` → 18 passed (2 files).
- Per-file: narrate-incident 6/6; ai-band 12/12 (was 10 — +2 AIX-02 assertions).
- `npx tsc --noEmit` → no type errors in the new/changed files.
- Source assertions: `maxOutputTokens` present (line 77); `grep "maxTokens\b"` returns nothing; `assertAdvisoryOnly` / `loadIncidents` / `isLlmEnabled` all wired.
- `git diff` among ai-band files shows only `ai-band.test.ts` — `ai-band.ts` unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Success-case test fixture prose tripped the guardrail**
- **Found during:** Task 1 (GREEN)
- **Issue:** The success-path fixture prose said "Bitcoind on host h1 is down" — the word `bitcoind` matches `assertAdvisoryOnly`'s `bitcoind` command signature, so the correct implementation withheld the read and the success assertion failed. This was a flaw in the test fixture, not the implementation (the guardrail behaved exactly as designed).
- **Fix:** Reworded the fixture prose to "The Bitcoin backend on host h1 is down …", which is genuine advisory prose that carries no command signature.
- **Files modified:** src/app/actions/narrate-incident.test.ts
- **Commit:** c9bb71b (folded into the GREEN commit)

## TDD Gate Compliance

- Task 1: `test(...)` (f2b357f, RED — import failed, no tests ran) → `feat(...)` (c9bb71b, GREEN — 6/6). Gate sequence satisfied.
- Task 2: `test(...)` (ccaa484). Pins existing shipped behavior in `ai-band.ts` (no source change needed); the assertions passed on first run because the command-free contract already ships — correct for a pinning test, no RED phase applicable.

## Threat Model Compliance

- **T-17-13 (tampering/spoofing input):** action accepts only the `KEY` (`KEY_RE`-validated), server-recomputes the incident via `loadIncidents` — the client card never becomes prompt input. ✓ (test: invalid key + unknown key both rejected pre-model)
- **T-17-02 (elevation via generateText output):** `assertAdvisoryOnly` post-check runs before return; command-shaped output withheld. ✓ (test: mocked `lncli` generation withheld)
- **T-17-01 (prompt injection):** payload wrapped in untrusted delimiters by `buildIncidentPrompt` (Plan 01) + server-recompute + guardrail post-check — defense in depth. ✓
- **T-17-14 (DoS):** `maxOutputTokens` bounded (400); flag-off/error → `{ok:false}` degrade, never blocks the deterministic render. ✓
- **T-17-SC (supply chain):** zero new packages installed. ✓

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema surface introduced. The action only reads via the existing server-only loader and calls the existing provider registry.

## Known Stubs

None.

## Self-Check: PASSED

- Files verified on disk: `src/app/actions/narrate-incident.ts`, `src/app/actions/narrate-incident.test.ts`, `src/lib/overview/ai-band.test.ts`, `17-06-SUMMARY.md`.
- Commits verified in git log: f2b357f (test), c9bb71b (feat), ccaa484 (test).

---
*Phase: 17-incident-lifecycle-ai-explanation*
*Completed: 2026-07-20*
