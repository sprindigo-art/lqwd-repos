---
phase: 04-insight-engine
plan: 12
type: execute
status: complete
completed: "2026-06-12T16:44:38Z"
requirements: [INSIGHT-01, INSIGHT-02, INSIGHT-03, INSIGHT-04, INSIGHT-05, INSIGHT-06, INSIGHT-07, PENDING-02]
---

# 04-12 Summary — Phase Gate (machine verification + operator sign-off)

## Outcome

Phase 4 (Insight Engine) verified end-to-end and signed off by the operator on
live warehouse data.

## Task 1 — Machine verification sweep (all green)

| # | Check | Result |
|---|-------|--------|
| 1 | `npm test` | 494 passed, 20 skipped |
| 2 | `npx tsc --noEmit` | 0 errors |
| 3 | `npx next build` | succeeds; `/inbox` + `/pending` present as dynamic routes |
| 4a | AFM-002 grep (`fee_msat/1000` outside `src/lib/`) | clean (no matches) |
| 4b | AFM-001 — latest-row-via-MAX failure pattern (`WHERE timestamp = MAX(...)`) | clean (0 matches) |
| 5 | Live golden vs `routing_vm` warehouse | 4/4 passed (~16s) |
| 6 | Schema-freeze contract test | 13/13 passed, unchanged |

**AFM-001 note (verification-spec deviation, not a code defect):** the plan's
literal `grep -rn "MAX(timestamp)" src` returns matches, but every one is a
sanctioned per-group `as_of` aggregate (`MAX(timestamp) AS as_of`) with in-code
justification — two of them (`force-close.ts`, `liquidity.ts`) predate Phase 4.
The *actual* documented failure mode (selecting the latest row via
`WHERE timestamp = MAX(timestamp)`, the "480-channels-as-1" collapse) returns
zero matches. The intent of the guard is satisfied; the literal grep is
over-broad. Recorded for the next milestone's validation-spec cleanup.

## Task 2 — Operator visual/functional sign-off

Operator verified `/inbox`, the console Active Signals integration, and LLM
toggle behavior against live data, then approved. Three issues were raised
during the checkpoint and fixed before sign-off:

1. **No global navigation** — the home page had no way to reach `/inbox` or
   `/pending`. Added `MastheadNav` (FLEET / INBOX / PENDING) to the shared
   overview chrome; navy structural underline on the active page, no severity
   color (commit `c8c4745`).
2. **`/pending` and `/inbox` 404 on soft-nav** — the `@modal` slot's only route
   was the dynamic `(.)[pubkey]` interceptor, so client navigation to `/pending`
   matched it with `pubkey="pending"`, failed the regex gate, and threw
   `notFound()` over the whole view. Added static null pages for both segments
   inside the slot to outrank the interceptor; real-pubkey scorecard
   interception unchanged (commit `b5e13f6`).
3. **`/pending` too long** — the fleet board rendered ~28 node groups × 3
   sections (62 empty "No pending…" lines) plus 80 always-visible nested sweep
   lines. Sketched three density options (`sketch 004`); operator chose
   **Variant B — counts + drill-in**. Rebuilt the fleet board: a totals strip
   (opens / coops / forces / sat in limbo) over a per-node summary list (only
   nodes-with-pending render), detail one click away, sweeps folded behind a
   count. Pure tested server shaper (`buildFleetPendingSummary`, 7 tests) +
   thin client board owning only expand/collapse state (commits `066bdea`,
   `9467b51`).

## Requirements delivered this phase

INSIGHT-01 (schema freeze), INSIGHT-02 (detector suite: close-storm/cluster,
HTLC-timeout, fee signals, rebalance, AP-12 advisory), INSIGHT-03 (ranking),
INSIGHT-04 (fee step-down), INSIGHT-05 (close-cluster correlation), INSIGHT-06
(self-guardrails: suppression / hysteresis / rate-limit), INSIGHT-07 (LLM
narrative layer, off by default), PENDING-02 (stuck-pending detector).

## Self-Check: PASSED

- All Task 1 commands green; AFM intent satisfied; live golden green.
- Operator checkpoint approved after three fixes.
- Full suite 494 passed; `tsc` + `next build` clean.

## Notes / follow-ups for next milestone

- **AFM-001 validation grep** is over-broad — narrow it to the latest-row
  selection anti-pattern so sanctioned `MAX(... ) AS as_of` aggregates don't
  trip it.
- **Pending node ordering** is alphabetical (verbatim from `buildPendingView`).
  Operator may prefer most-stuck-first (oldest pending or largest limbo); that
  is a data-layer sort change, deferred.
- **Dynamic-route latency**: `/inbox` and `/pending` run live warehouse queries
  per request (stateless-per-load, D-07). ~7–11s warm in dev. Consider a short
  `revalidate` window if daily-use latency matters.
