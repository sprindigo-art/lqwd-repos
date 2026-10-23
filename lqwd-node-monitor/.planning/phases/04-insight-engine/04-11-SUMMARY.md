---
phase: 04-insight-engine
plan: 11
subsystem: console-ui
tags: [insight, console, active-signals, narrate, d-08, d-17]
requires:
  - 04-09 (loadInsightView engine + InsightView contract)
  - 04-02 (SIGNAL_LABELS vocabulary in @/lib/insight/labels)
  - 03-15 (ActiveSignalsPanel + buildSignals caller contract)
provides:
  - "Per-node insight view (D-08): console filters the SAME engine computation by pubkey into SignalRows"
  - "ActiveSignalsPanel insight row kind with severity-mapped label + stateLine suppression surface"
  - "Per-node NarrateButton mount gated on view.llmEnabled (D-17/INSIGHT-07)"
affects:
  - "Phase 5 export / Phase 6 queue consume cards from the inbox, not this surface — no contract change here"
tech-stack:
  added: []
  patterns:
    - "Insight read rides the existing post-gauntlet .catch-degraded Promise.all (T-03-27/28 precedent)"
    - "Caller-builds-rows: buildInsightSignals lives in the page; panel renders verbatim (T-02-07)"
key-files:
  created: []
  modified:
    - src/components/console/ActiveSignalsPanel.tsx
    - src/app/(overview)/[pubkey]/[tab]/page.tsx
decisions:
  - "Insight read is tab-gated (tab === 'scorecard' ? ... : Promise.resolve(null)) matching the trend-read precedent — the signals panel only renders on the scorecard tab, so other tabs skip the engine's query fan entirely"
  - "stateLine prefers suppression reason over hysteresis hold; hysteresis holds are prefixed 'hysteresis ' so the operator sees the source guardrail"
  - "NarrateButton mounts directly under the Active Signals panel in the scorecard flex column"
metrics:
  duration: ~4 min
  completed: 2026-06-12
  tasks: 2
  files: 2
---

# Phase 4 Plan 11: Console Insight Integration Summary

Per-node insight cards now render inside the console's Active Signals panel — the same `loadInsightView()` computation the inbox renders, filtered by exact pubkey (D-08: one engine, two views) — composed after the Phase-3 breach/outlier rows, with a per-node LLM narrate trigger that appears only when `INSIGHT_LLM_ENABLED` is on.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Extend ActiveSignalsPanel with the insight row kind | c53067c | src/components/console/ActiveSignalsPanel.tsx |
| 2 | Console page wiring — per-node cards + narrate button | ec5383a | src/app/(overview)/[pubkey]/[tab]/page.tsx |

## What Was Built

### Task 1 — ActiveSignalsPanel `insight` row kind

- `SignalRow.kind` extended to `"breach" | "outlier" | "insight"` with two new optional fields: `severity?: "critical" | "warn" | "info"` and `stateLine?: string`.
- Insight rendering branch: label in the severity-mapped text class via an `INSIGHT_LABEL_CLASS` record (`text-status-critical` / `text-status-warn` / `text-foreground/70` for info — existing tokens only, no new colors), the same mono detail why-line and `open {tab} →` href slot as the Phase-3 rows, plus an optional second line rendering `stateLine` in muted warn tint (`text-status-warn/70`) — the console's visible suppression/hysteresis surface (D-14/D-15).
- Contract preserved verbatim: rows built by the caller, rendered verbatim, `signals.length === 0 → null`, breach/outlier branches byte-identical in behavior. No health/ranking logic in the component.

### Task 2 — Console page wiring

- `loadInsightView()` joined the existing `.catch`-degraded `Promise.all`, tab-gated to `scorecard` (the only tab that renders the panel) and positioned strictly after the PUBKEY_RE / TAB_KEYS / WINDOW_PRESETS validation gauntlet (T-04-30). Failure degrades to `null` — the console renders without insight rows (T-04-31).
- `buildInsightSignals(cards, pubkey)` page-level helper: filters `c.node?.pubkey === pubkey` (fleet-scope cards are fleet-by-definition and never appear per-node), maps each card to an insight SignalRow — `SIGNAL_LABELS[card.signal]` from `@/lib/insight/labels` (04-02 vocabulary, no 04-10 component import), detail `"{metric} {observed} {unit} vs {threshold} — {window}"` with raw values (AFM-002 already applied upstream), href = `card.evidence.deepLink`, tabLabel parsed from the deep link's tab segment, stateLine = suppression reason ?? hysteresis hold ?? undefined.
- Insight rows concat AFTER `buildSignals(node)` rows in the same panel — grades-vs-recommendations reading order, composing with (never replacing) the Phase-3 signals (Pitfall 9).
- `NarrateButton` mounts with `scope={{ level: "node", pubkey }}` directly under the panel, ONLY when the view loaded and `view.llmEnabled` — renders nothing otherwise (INSIGHT-07 off-by-default invisibility; the server action re-checks the env gate regardless).

## Verification

- `npx tsc --noEmit` — clean (both tasks)
- `npx vitest run` — 476 passed, 20 skipped (45 files passed, 4 skipped)
- `npx next build` — compiled successfully; `/[pubkey]/[tab]` stays dynamic
- grep guard: `insightView !== null && insightView.llmEnabled` present at the NarrateButton mount

## Deviations from Plan

None - plan executed exactly as written. (Tab-gating the insight read to `scorecard` follows the plan's cited T-03-28 trend-read precedent in the same Promise.all rather than deviating from it.)

## Known Stubs

None — both surfaces are wired to live engine data; no placeholder values introduced.

## Self-Check: PASSED

- FOUND: src/components/console/ActiveSignalsPanel.tsx (contains "insight")
- FOUND: src/app/(overview)/[pubkey]/[tab]/page.tsx (contains "loadInsightView")
- FOUND: commit c53067c
- FOUND: commit ec5383a
