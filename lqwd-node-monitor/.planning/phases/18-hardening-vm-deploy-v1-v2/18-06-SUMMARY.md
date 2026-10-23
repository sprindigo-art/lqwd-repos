---
phase: 18-hardening-vm-deploy-v1-v2
plan: 06
subsystem: testing
tags: [export, allowlist, hmac-free, insight-detectors, deeplink, hardening, vitest]

# Dependency graph
requires:
  - phase: 18-hardening-vm-deploy-v1-v2 (plan 01)
    provides: validateActionForExport gate + CHANNEL_POINT_RE/PUBKEY_RE/CHAN_ID_RE allowlists
provides:
  - safeToken(value, regex) — the single gate-then-interpolate helper for every exported identifier
  - verbatim (uncapped) rendering of trusted static safety/runbook constants in copyAll
  - per-detector PUBKEY_RE guards so one malformed warehouse pubkey degrades one detector, not the whole insight view
affects: [command-export, insight-engine, inbox, per-node-console]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "gate-then-interpolate: one exported safeToken() is the sole allowlist site for every shell-string identifier; withhold (null) on anchored-regex mismatch"
    - "trusted-vs-card-sourced comment split: card content is control-stripped AND length-capped; author-written static constants are control-stripped but uncapped"
    - "detector fail-soft: pre-check pubkey against PUBKEY_RE before buildDeepLink (which throws), skip the offending node — assembleCards is not degrade()-wrapped"

key-files:
  created: []
  modified:
    - src/lib/export/commands.ts
    - src/lib/export/commands.test.ts
    - src/lib/insight/detectors/htlc-timeout.ts
    - src/lib/insight/detectors/close-storm.ts
    - src/lib/insight/detectors/rebalance.ts
    - src/lib/insight/detectors/fee-stepdown.ts
    - src/lib/insight/detectors/htlc-timeout.test.ts
    - src/lib/insight/detectors/close-storm.test.ts
    - src/lib/insight/detectors/rebalance.test.ts
    - src/lib/insight/detectors/fee-stepdown.test.ts

key-decisions:
  - "safeToken exported (not module-private) so it is directly unit-tested and reusable as the single allowlist contract"
  - "Detector fail-soft skips the offending node's card (continue) rather than emitting a fallback link — a card whose deep link cannot target its real node console is not actionable"
  - "buildDeepLink's throw-on-bad-pubkey contract is preserved (intentional 'detector passing garbage is a bug'); the guard lives at each call site, mirroring stuck-pending"

patterns-established:
  - "Every interpolated identifier in an exported command routes through safeToken(value, regex)"
  - "assembleCopyAll emits contextLines capped (card-sourced) but safety lines + step notes verbatim (trusted static)"

requirements-completed: [HARDEN-03]

# Metrics
duration: 20min
completed: 2026-07-27
---

# Phase 18 Plan 06: Export Zero-Write Re-Affirmation + Detector Fail-Soft Summary

**Unified the command-export allowlist behind one exported `safeToken()` gate-then-interpolate helper, stopped the 120-char cap from truncating trusted safety/runbook guidance in copyAll, and guarded every detector's `buildDeepLink` so a single malformed warehouse pubkey degrades one detector instead of rejecting the whole insight view.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-27T09:40:00Z
- **Completed:** 2026-07-27T09:48:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 10

## Accomplishments
- **E1/E2/E3 (interpolation gap):** Added exported `safeToken(value, regex)` — the sole allowlist site. Routed `buildCloseExport` channelPoint (E1), `buildVerifyStep` chanId/channelPoint/remotePubkey, `buildRebalanceExport` partnerPubkey, and `bumpFeeExport` outpoint + `bumpforceclosefee` channelPoint through it. Fixed E3: the pendingsweeps jq-filter comment now gates on the validated outpoint token, not `!== null`.
- **E-copy (safety truncation):** `commentTrusted()` renders static safety/runbook constants uncapped, so copyAll now shows `RESTART_KEY_STEPS`, `AGED_FUNDING_GUIDANCE`, and `COOP_SAFETY` verbatim (previously silently cut at 120 chars).
- **I2 (detector DoS):** `htlc-timeout`, `close-storm`, `rebalance`, and `fee-stepdown` each pre-check the pubkey against `^[0-9a-f]{66}$` before `buildDeepLink` and skip the offending node — one bad pubkey no longer throws out of `assembleCards` and rejects both `/inbox` and every per-node console.
- **E4/E5 coverage:** Added hostile-`remotePubkey` (no `--peer` line) and malformed/oversized-outpoint (null bump command + `NO_OUTPOINT_NOTE`) tests.
- Export zero-write posture re-affirmed: no write path exists; a malformed identifier withholds one command line, never corrupts a shell string.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: safeToken + verbatim safety constants (E1/E2/E3/E-copy/E4/E5)**
   - `055c69b` (test — RED)
   - `6be3aa0` (feat — GREEN)
2. **Task 2: Guard buildDeepLink in four detectors (I2)**
   - `b0827d2` (test — RED)
   - `1370f34` (fix — GREEN)

## Files Created/Modified
- `src/lib/export/commands.ts` - Added exported `safeToken()` and `commentTrusted()`; routed all interpolated identifiers through the gate; verbatim safety/runbook rendering in copyAll.
- `src/lib/export/commands.test.ts` - safeToken unit tests, verbatim-constant copyAll assertions, E4/E5 hostile-input coverage.
- `src/lib/insight/detectors/{htlc-timeout,close-storm,rebalance,fee-stepdown}.ts` - Per-detector PUBKEY_RE guard before buildDeepLink.
- `src/lib/insight/detectors/{htlc-timeout,close-storm,rebalance,fee-stepdown}.test.ts` - Malformed-pubkey fail-soft tests.

## Decisions Made
- `safeToken` exported so the allowlist contract is directly unit-tested and reused, not re-derived per call site.
- Detectors skip the offending node's card (fail-soft to fewer cards) rather than emit a non-actionable fallback deep link.
- `buildDeepLink`'s intentional throw-on-bad-pubkey contract is left intact; the guard lives at each call site, mirroring the existing `stuck-pending` pattern.

## Deviations from Plan

None - plan executed exactly as written. The E5 test surfaced the E3 comment-echo gap (malformed outpoint riding a `#`-commented line), which was already in-scope for Task 1 and fixed by gating `verifyComment` on the validated token.

## Issues Encountered
- Two nullable-`node` typecheck errors in the new detector tests (`cards[0].node.pubkey`) — resolved with optional chaining (`node?.pubkey`), matching the existing close-storm test style.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Export allowlist discipline is now uniform and single-sourced; any new exported identifier must route through `safeToken`.
- Insight view is resilient to malformed warehouse pubkeys across all deep-link-building detectors.
- Full suite green: 1502 passed / 57 skipped.

---
*Phase: 18-hardening-vm-deploy-v1-v2*
*Completed: 2026-07-27*
