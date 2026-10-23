---
phase: 04-insight-engine
plan: 02
subsystem: insight
tags: [config, ranking, deeplink, labels, pure-modules, d-13, d-06, d-04]
requires:
  - phase: 04-insight-engine
    plan: 01
    provides: "InsightCard schema/types (DetectorId, InsightCardSchema)"
provides:
  - "INSIGHT_CONFIG: Record<\"lnd\"|\"ldk\", InsightKnobs> — single detector tuning surface (D-13)"
  - "rankCards — deterministic D-06 sort (severity → limbo-at-risk/magnitude → id)"
  - "buildDeepLink + FLEET_PENDING_LINK — validated relative console-tab hrefs (D-04/T-04-04)"
  - "SIGNAL_LABELS: Record<DetectorId, string> — shared uppercase card-label vocabulary"
affects:
  - "Wave 3 detectors (knob imports)"
  - "Wave 4 engine (rank import)"
  - "Wave 5 UI plans 04-10/04-11 (SIGNAL_LABELS import)"
tech-stack:
  added: []
  patterns:
    - "Per-backend two-literal config (SCORECARD_CONFIG analog)"
    - "Pure non-mutating sort with total deterministic order (sortFleet analog)"
    - "Whitelist-validated URL builder, fail-loud throws"
key-files:
  created:
    - src/lib/insight/config.ts
    - src/lib/insight/config.test.ts
    - src/lib/insight/rank.ts
    - src/lib/insight/rank.test.ts
    - src/lib/insight/deeplink.ts
    - src/lib/insight/deeplink.test.ts
    - src/lib/insight/labels.ts
    - src/lib/insight/labels.test.ts
  modified: []
decisions:
  - "D-06 reading documented in rank.ts: within a severity band, stuck-pending cards (limboSat desc) sort BEFORE non-stuck cards (normalized magnitude desc) — the two keys are not on a comparable scale, so interleaving is rejected"
  - "config.ts purity banner reworded to \"no server runtime imports\" so the grep -q \"server-only\" acceptance gate fails as required"
  - "tier1-fork test asserts no /tier1\\s*:/ KEY DECLARATION in config.ts source — read-path mentions of SCORECARD_CONFIG[...].tier1.value in the banner are allowed and expected"
metrics:
  duration: "~5 min"
  completed: "2026-06-12"
  tasks: 3
  files: 8
---

# Phase 4 Plan 02: Insight Shared Pure Modules Summary

Four pure shared modules (D-13 knob config, D-06 ranker, D-04 deep-link builder, SIGNAL_LABELS vocabulary) with 29 new unit tests — the foundation every detector, the engine, and both Wave-5 UI surfaces import.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | INSIGHT_CONFIG per-backend detector knobs (D-13) | f7084ba | src/lib/insight/config.ts, config.test.ts |
| 2 | rankCards deterministic D-06 sort | 62b4c9a | src/lib/insight/rank.ts, rank.test.ts |
| 3 | buildDeepLink (D-04) + SIGNAL_LABELS vocabulary | 926f89e | src/lib/insight/deeplink.ts, deeplink.test.ts, labels.ts, labels.test.ts |

## What Was Built

### config.ts — D-13 single detector tuning surface
- `INSIGHT_CONFIG: Record<"lnd" | "ldk", InsightKnobs>` — ldk its own object literal (per-backend retuning from day one), all 31 knobs with RESEARCH values verbatim and per-knob confidence/citation comments; judgment-only knobs tagged `[ASSUMED A1–A7]`.
- Banner documents the D-13 no-fork rule: AP-11 close-storm (≥50/hr) and PPM-LOW (<10) are READ from `SCORECARD_CONFIG[backend].forceClose.tier1.value` / `.revenue.tier1.value` at use-sites — never restated here.
- config.test.ts enforces: distinct backend literals with identical key sets, all knobs positive finite, no knob key matching /closeStorm|ap11|ppmLow/i, no `tier1:` key declaration in source (fs read), SCORECARD_CONFIG documented, no "server-only" string.

### rank.ts — D-06 deterministic ranking
- `rankCards` — pure, non-mutating, no tuning knob. Order: severity band (critical/warn/info) → within band, stuck-pending signals (`stuck_fc_past_maturity`, `stuck_sweep`, `stuck_open`) by `evidence.detail.limboSat` descending (single numeric-coercion point; missing/non-numeric sorts last among stuck) → other cards by normalized breach magnitude `|observed − threshold| / max(|threshold|, 1)` descending → id lexicographic tiebreak for a total order.
- The stuck-before-non-stuck-within-band choice is documented in the module doc comment as the D-06 reading (limboSat sats and normalized ratios are not comparable scales).

### deeplink.ts — D-04 validated href builder (T-04-04)
- `buildDeepLink(pubkey, tab, window?)` — relative paths only (`/${pubkey}/${tab}` + optional `?window=`). Pubkey gated by the console page's `/^[0-9a-f]{66}$/`, tab by `TAB_KEYS`, window by `WINDOW_PRESETS` `hasOwnProperty` (prototype-safe). Throws descriptive errors before any interpolation; injection fixtures (`javascript:`, `../`, url-encoded, absolute URL) all throw in tests.
- `FLEET_PENDING_LINK = "/pending"` exported for fleet-scope cards.

### labels.ts — shared card-label vocabulary
- `SIGNAL_LABELS: Record<DetectorId, string>` — all 14 detector ids mapped to uppercase plain-text labels (no emoji/icons per sketch findings). labels.test.ts derives the member list from `DetectorIdSchema.options` and asserts full coverage plus `/^[A-Z0-9 —-]+$/` on every label.
- Lives in the pure lib tier so 04-10 and 04-11 both import `@/lib/insight/labels` with zero cross-plan component imports.

## Verification

- `npx vitest run src/lib/insight` — 5 files, 42 tests, all green (29 new in this plan + 13 pre-existing schema/contract tests from 04-01).
- `npx tsc --noEmit` clean; `npx eslint src/lib/insight --max-warnings 0` clean.
- `grep -q "server-only"` fails on all four modules (pure-module gate).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Purity banner tripped its own grep gate**
- **Found during:** Task 1
- **Issue:** The initial config.ts banner copied the scorecard wording "NO server-only import", which made the acceptance criterion `grep -q "server-only" src/lib/insight/config.ts` succeed (it must fail) and failed config.test.ts.
- **Fix:** Reworded to "no server runtime imports" (the console/config.ts phrasing); same wording used in rank.ts/deeplink.ts/labels.ts banners.
- **Files modified:** src/lib/insight/config.ts
- **Commit:** f7084ba (fixed before commit)

No other deviations — plan executed as written.

## Known Stubs

None — all four modules are complete, wired, and tested; no placeholders or hardcoded empty values.

## Threat Flags

None — no new surface beyond the plan's threat model. T-04-04 (href injection) and T-04-05 (threshold-fork drift) mitigations are implemented and test-enforced as specified.

## Self-Check: PASSED

- All 8 created files exist on disk.
- Commits f7084ba, 62b4c9a, 926f89e present in git log.
- 42/42 tests green on the final run.
