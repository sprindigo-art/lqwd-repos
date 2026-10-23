---
phase: 04-insight-engine
plan: 07
subsystem: insight-guardrails
tags: [insight, guardrails, hysteresis, suppression, tdd, pure-functions]
requires:
  - 04-01 (InsightCard zod contract — schema.ts/types.ts suppressed/rateLimitGuidance fields)
  - 04-02 (insight config.ts — feeMinDeltaPpm/feeMinIntervalHours/maxWritesPerDay knobs)
provides:
  - applyHysteresis/applySuppression/applyRateLimitGuidance pure post-passes (src/lib/insight/guardrails.ts)
  - WRITE_ACTION_TYPES const (update_fee | close_channel | rebalance)
  - buildFeeHistorySql + lastPolicyChange + feeHistoryByChannel (src/lib/insight/fee-history.ts)
affects:
  - 04-08+ engine assembly (applies the three passes in documented order)
  - Phase 5/6 (suppressed cards reach them with suggestedAction null — params structurally withheld)
tech-stack:
  added: []
  patterns:
    - PgDialect no-DB SQL shape test (trends.ts precedent)
    - lazy-import executor keeps postgres() pool out of test import graph
    - WR-04 UTC boundary ((now() AT TIME ZONE 'UTC') - make_interval)
    - WR-01 NULL-key exclusion on per-channel scans
key-files:
  created:
    - src/lib/insight/fee-history.ts
    - src/lib/insight/fee-history.test.ts
    - src/lib/insight/guardrails.ts
    - src/lib/insight/guardrails.test.ts
  modified: []
decisions:
  - "Guardrail engine order fixed and documented in banner: hysteresis → suppression → rate-limit guidance"
  - "Hysteresis min-interval holds ANY observed change inside the interval regardless of direction (conservative D-15 reading)"
  - "No observed policy change → pass ('clear') — the LDK-sparse cadence degradation lands here by design"
  - "applyHysteresis takes an injectable `now: Date` default-parameter for deterministic tests"
metrics:
  duration: 7m
  tasks: 2
  files: 4
  completed: 2026-06-12
---

# Phase 4 Plan 07: Self-Guardrail Layer (INSIGHT-06) Summary

**One-liner:** D-14/D-15/D-16 guardrails as three pure non-mutating post-passes — typed-Set suppression nulling write params from the contract surface, stateless fee hysteresis reconstructed from windowed `lnd_node_channel_info` snapshots, and guidance-only per-node write counters.

## What Was Built

### Task 1 — `fee-history.ts` (commits 7ecd77a test, 918d294 feat)
- `buildFeeHistorySql(windowHours)`: fleet-wide windowed per-channel series scan over event-driven `lnd_node_channel_info` (`chan_id, local_pubkey, outgoing_fee_rate_milli_msat, timestamp`), bound-param window, `ORDER BY chan_id, timestamp ASC`. Shape test asserts `make_interval`, bound param, ORDER BY, and the ABSENCE of `DISTINCT ON` — this is a history read, never a latest read (Pitfall 1); banner directs current-policy reads to `src/lib/read/latest.ts` (fs-read test enforces).
- `lastPolicyChange(series)`: pure most-recent-value-change scan returning `{changedAt, direction: "up"|"down"} | null`; null on empty/single/no-change series.
- `feeHistoryByChannel(windowHours)`: lazy-import executor returning `Map<chanId, FeeSnapshot[]>` with `Number()` + `parseDbTimestampUtc` coercion; skips null-ppm/unparseable-timestamp rows.
- LDK cadence caveat (RESEARCH Open Question 3) documented in banner: sparse snapshots degrade min-interval to "no observed change → pass"; per-backend knob surface stays in config.

### Task 2 — `guardrails.ts` (commits a18810e test, 3efe602 feat)
- `applyHysteresis(cards, historyByChanId, config, now?)`: holds `update_fee` cards when `|suggestedPpm − currentPpm| < feeMinDeltaPpm` (10) or last observed change younger than `feeMinIntervalHours` (24); held cards keep the card, null the action, and write `evidence.detail.hysteresis` (`"held: delta 4 < 10"` / `"held: last change 9h ago < 24h"`); passing cards get `"clear"` — state on EVERY fee card.
- `applySuppression(cards, flaggedPubkeys)`: write-type cards (`WRITE_ACTION_TYPES`) on flagged nodes → `suppressed {active: true, reason: "node flagged AP-11 — write recommendations withheld"}`, `suggestedAction` nulled (T-04-16 — Phases 5/6 never see params), would-be type echoed in `evidence.detail.withheldAction`. Set-driven only; never inspects provenance (D-12) or display labels (Pitfall 5).
- `applyRateLimitGuidance(cards, config)`: counts unsuppressed write cards per pubkey, stamps `"N write recommendation(s) for this node this load — suggested max 4/day"`; suppressed/non-write cards keep null. Text only, no enforcement (D-16).
- All three return new card objects; pipeline test proves post-pass output still parses via `InsightCardArraySchema` and inputs are deep-equal before/after.

## Verification

- `npx vitest run src/lib/insight` — 7 files, 76 tests passed (34 new in this plan).
- `npx tsc --noEmit` — clean. `npx eslint` on all four files — clean.
- `grep -c "criticalChips" src/lib/insight/guardrails.ts` = 0 (T-04-17).
- Threat register: T-04-16 (action nulled + tested), T-04-17 (typed Set + grep test), T-04-18 (bound window param + shape test) — all mitigated.

## TDD Gate Compliance

RED→GREEN sequence intact for both tasks: `test(04-07)` 7ecd77a → `feat(04-07)` 918d294; `test(04-07)` a18810e → `feat(04-07)` 3efe602. Both RED runs confirmed failing before implementation. No refactor commits needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] UTC-explicit window boundary instead of plan's literal `now() -`**
- **Found during:** Task 1
- **Issue:** Plan's SQL sketch used `WHERE timestamp > now() - make_interval(...)`, but `lnd_node_channel_info.timestamp` is an offset-less UTC wall-time column — a bare `now()` comparison depends on session TimeZone (documented WR-04 landmine; closes.ts precedent even asserts `not.toContain("> now() -")`).
- **Fix:** `(now() AT TIME ZONE 'UTC') - make_interval(hours => $1)`; shape test asserts it.
- **Files modified:** src/lib/insight/fee-history.ts
- **Commit:** 918d294

**2. [Rule 2 - Correctness] Added `chan_id IS NOT NULL` to the history scan**
- **Found during:** Task 1
- **Issue:** Keyless warehouse rows (WR-01) cannot join a per-channel series and would collapse into a phantom `"null"` map key in `feeHistoryByChannel`.
- **Fix:** Excluded NULL chan_id rows in SQL, matching the AFM-001 reader's posture; shape test asserts.
- **Files modified:** src/lib/insight/fee-history.ts
- **Commit:** 918d294

## Known Stubs

None — all exported functions are fully wired and fixture-proven; no placeholder values flow anywhere.

## Threat Flags

None — no new security surface beyond the plan's threat model (no new endpoints, auth paths, or trust-boundary schema changes).

## Self-Check: PASSED

- src/lib/insight/fee-history.ts — FOUND
- src/lib/insight/fee-history.test.ts — FOUND
- src/lib/insight/guardrails.ts — FOUND
- src/lib/insight/guardrails.test.ts — FOUND
- Commits 7ecd77a, 918d294, a18810e, 3efe602 — FOUND in git log
