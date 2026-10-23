---
phase: 17-incident-lifecycle-ai-explanation
plan: 01
subsystem: overview / insight (incident lifecycle + AI explanation)
tags: [incident-detail, ai-read, guardrails, pure-module, tdd]
requires:
  - "GroupedIncident (src/lib/overview/incidents.ts) — the incident tree input to every builder"
  - "WhyChainEvent (src/components/df/WhyChain.tsx), BlastTarget (src/components/df/BlastRadius.tsx) — view prop shapes"
  - "narrative.ts untrusted-data delimiter precedent"
provides:
  - "buildWhyChain + buildBlastTargets + selectDriver + buildBlastRoot (incident-detail.ts) — Incident Detail view builders"
  - "buildIncidentPrompt + INCIDENT_READ_SYSTEM_PROMPT + INCIDENT_CHILD_CAP (incident-prompt.ts) — AIX-01 prompt builder"
  - "assertAdvisoryOnly (guardrails.ts) — text-level command-free guardrail"
affects:
  - "src/app/(overview)/incidents/[incidentKey]/page.tsx (future — INC-01 detail page)"
  - "src/app/actions/narrate-incident.ts (future — AIX-01 read action)"
tech-stack:
  added: []
  patterns:
    - "Pure GroupedIncident[] → view-shape .map (ai-band.ts discipline), no DB, no server-only, no input mutation"
    - "Untrusted-data BEGIN/END delimiters around JSON payload (narrative.ts precedent), renamed INCIDENT variant"
    - "Deterministic top-N-by-severity pre-truncation with engine-order-preserved emitted subset"
key-files:
  created:
    - src/lib/overview/incident-detail.ts
    - src/lib/overview/incident-detail.test.ts
    - src/lib/overview/incident-prompt.ts
    - src/lib/overview/incident-prompt.test.ts
  modified:
    - src/lib/insight/guardrails.ts
    - src/lib/insight/guardrails.test.ts
decisions:
  - "shortTime formats asOf as UTC HH:MM (toISOString slice) — deterministic across timezones for a monitoring surface; callers render '—' for null asOf before calling"
  - "INCIDENT_CHILD_CAP=12; overflow selects worst-severity children (rank desc, stable) then restores engine order in the serialized subset (AI-SPEC §4b)"
  - "assertAdvisoryOnly is a pure text gate — command signatures + shell fence + $ prompt + 2+ numbered step-list + .conf/--config; single incidental '1.' does not trip it"
metrics:
  duration: ~6m
  completed: 2026-07-20
---

# Phase 17 Plan 01: Incident Detail + AI Read Pure Modules Summary

Three fixture-testable, no-DB, no-network modules that every downstream Incident Detail (INC-01) and AI read (AIX-01) consumer composes against: the why-chain / blast-radius derivation builders, the untrusted-delimiter incident prompt builder, and the NEW text-level `assertAdvisoryOnly` command-free guardrail. All contracts land first, all `.test.ts` siblings green.

## What Was Built

- **`incident-detail.ts` (INC-01)** — `buildWhyChain` maps `incident.children` (engine order, never reordered) to `WhyChainEvent[]` with `time` = mono "HH:MM" or "—" for a null `asOf`; `buildBlastTargets` filters fee-summary children (`feeKind` set) out of the blast tree and yields 1..N `BlastTarget`s; `selectDriver` / `buildBlastRoot` mirror the `incidentRunbook` driver-selection precedent for the blast root-cause line.
- **`assertAdvisoryOnly` in `guardrails.ts` (AIX-01)** — pure text gate returning `{ ok, reason? }`. Blocks (case-insensitive) `lncli`/`lncmd`/`systemctl`/`bitcoin-cli`/`bitcoind`/`docker`/`sudo`/`pg_ctl`/`psql`, triple-backtick fences, leading `$ ` prompts, 2+ item numbered step-lists, and `.conf`/`--config` config-edit patterns. Advisory prose passes. Pins the adversarial-injection subset (lncli-in-log blocked; non-command "reveal your system prompt" / fake-pubkey prose passes — faithfulness is a separate check).
- **`incident-prompt.ts` (AIX-01)** — `buildIncidentPrompt` wraps `JSON.stringify(incident)` in `<<<BEGIN_UNTRUSTED_INCIDENT_DATA>>>`/`<<<END_UNTRUSTED_INCIDENT_DATA>>>` with an identity line referencing `incident.key`; `INCIDENT_READ_SYSTEM_PROMPT` is the verdict-first, data-not-instructions, command-free, no-invent, plain-prose contract (AI-SPEC §4). Overflowing child sets pre-truncate deterministically to `INCIDENT_CHILD_CAP=12` worst-severity children.

## Must-Haves Verified

- buildWhyChain preserves engine order and renders "—" for null asOf — the why-chain IS the detection timeline (D-09). ✓
- buildBlastTargets excludes fee summaries and yields 1..N targets, no new viz lib (D-08). ✓
- assertAdvisoryOnly blocks lncli/systemctl/shell-fence/step-list strings — advisory only (D-13). ✓
- buildIncidentPrompt wraps the payload in BEGIN/END_UNTRUSTED delimiters (T-17-01). ✓

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | buildWhyChain + buildBlastTargets (INC-01) | 59213c2 | incident-detail.ts (+test) |
| 2 | assertAdvisoryOnly text guardrail (AIX-01) | 7a3af74 | guardrails.ts (+test) |
| 3 | buildIncidentPrompt + INCIDENT_READ_SYSTEM_PROMPT (AIX-01) | 1979023 | incident-prompt.ts (+test) |

## Verification

- `npx vitest run src/lib/overview src/lib/insight` → 452 passed, 4 skipped (34 files).
- Per-task: incident-detail 11/11, guardrails 42/42, incident-prompt 13/13.
- Source assertions: no `.sort(` in `incident-detail.ts`; no `export/commands` in `guardrails.ts`; no `.hostId` in `incident-prompt.ts` (grep-guarded in-test and confirmed via CLI grep).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Explanatory comments tripped the in-test source-grep guards**
- **Found during:** Tasks 2 and 3
- **Issue:** A comment in `guardrails.ts` referenced the path `src/lib/export/commands.ts` and a comment in `incident-prompt.ts` wrote `.hostId`; both matched the grep-guard tests that assert those tokens are absent from the source.
- **Fix:** Reworded both comments to convey the same intent without the forbidden literal tokens (`export/commands`, `.hostId`).
- **Files modified:** src/lib/insight/guardrails.ts, src/lib/overview/incident-prompt.ts
- **Commit:** 7a3af74, 1979023

## Threat Flags

None — this plan adds only pure, no-network, no-DB modules. `assertAdvisoryOnly` (T-17-02) and the untrusted-data delimiters (T-17-01) are the two mitigations the threat register assigned; both are implemented and pinned by tests. Zero new packages (T-17-SC N/A).

## Known Stubs

None.

## Self-Check: PASSED

- All 6 created/modified files present on disk.
- All 3 task commits (59213c2, 7a3af74, 1979023) present in git log.
