---
phase: 12-ops-center-overview
plan: 07
subsystem: ui
tags: [next-app-router, server-component, recharts, overview, attention-queue, fleet-vitals, ai-band]

# Dependency graph
requires:
  - phase: 12-01..12-06
    provides: "pure overview layer — severity-map, ownership, incidents, vitals, ai-band, filter + QueueFilters/AiBandClient client islands"
  - phase: 11
    provides: "telemetry read model — host-metrics, chain-telemetry, service-health, service_inventory"
  - phase: 10
    provides: "Data-Forward df primitives — SeverityHeroCard, SeverityCard, AiReadPanel, FleetVitals, NavRailShell, StaleChart, EvidenceChart, inert CommandModal"
provides:
  - "Full-stack Ops Center Overview page at / — server reads → pure overview layer → df composition (OVW-01..05)"
  - "Live operator-verified attention queue spanning nodes/hosts/services/bitcoind/storage, root-cause grouped"
  - "Advisory-only AI band + proportional fleet-vitals + honest all-clear/stale states + layer/severity filters"
affects: [13-nodes-service-health, 14-hosts-infra, 15-incident-lifecycle, 16-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server Component composition: ONE fail-soft Promise.all of five reads → rankCards → assembleIncidents → df primitives; force-dynamic + revalidate=0 preserved; zero write path"
    - "bitcoind-layer denominator derived from service_inventory declared-bitcoind hosts (OQ2/D-07) — non-bitcoind hosts excluded from the bitcoind rollup"

key-files:
  created:
    - .planning/phases/12-ops-center-overview/12-07-SUMMARY.md
    - .planning/phases/12-ops-center-overview/12-REFINEMENT-BACKLOG.md
  modified:
    - src/app/(overview)/page.tsx

key-decisions:
  - "12-07 page assembly verified LIVE by the operator against real fleet data (http://localhost:3001/) after one-time warehouse read-grants — rollups populate, advisory-only band + 'never runs commands' pill render, honest stale/empty states hold; ui_safety_gate PASS"
  - "9-item operator refinement backlog captured (12-REFINEMENT-BACKLOG.md) — NOT in 12-07 scope; routed to /gsd-plan-phase 12 --gaps"

patterns-established:
  - "Overview page = pure-layer assembly only: all incident/vitals/band/filter logic lives in tested src/lib/overview/*; the page wires reads to that layer and composes df primitives (no business logic in the page)"

requirements-completed: [OVW-01, OVW-02, OVW-03, OVW-04, OVW-05]

# Metrics
duration: ~25min
completed: 2026-06-30
---

# Phase 12 Plan 07: Ops Center Overview Page Assembly Summary

**Reworked `(overview)/page.tsx` into the v2 full-stack Ops Center Overview — a fail-soft server composition feeding the tested pure overview layer (incidents/vitals/ai-band/filter) into the Data-Forward df primitives — operator-verified live against the real fleet.**

## Performance

- **Duration:** ~25 min (Task 1 implementation + checkpoint resolution + finalization)
- **Completed:** 2026-06-30
- **Tasks:** 2 (1 implementation + 1 operator visual safety-gate)
- **Files modified:** 1 (`src/app/(overview)/page.tsx`)

## Accomplishments
- Reworked the overview page from the v1 node-only fleet queue into the v2 full-stack Ops Center: server reads → pure overview layer → df composition (OVW-01..05).
- Composed the UI-SPEC OverviewShell order: AI band → top-priority/all-clear hero → filters + attention queue → proportional fleet-vitals → healthy collapse → safety footer.
- bitcoind vitals denominator wired to declared-bitcoind hosts from `service_inventory` (OQ2/D-07) — a non-bitcoind host never enters the bitcoind layer total.
- Preserved `force-dynamic` + `revalidate=0` + per-read fail-soft `.catch` degrade and the page-level honest-error fallback; Server-Component-only, zero write path, zero command emission.
- Operator verified the LIVE page against real fleet data: ROOT CAUSE rollups populate, the advisory AI band + "AI · explains & ranks, never runs commands" pill render, honest stale/empty states hold — `ui_safety_gate` PASS.

## Task Commits

1. **Task 1: Rework the overview page — server reads → pure layer → df composition** - `711d913` (feat) — 442 insertions / 298 deletions over `src/app/(overview)/page.tsx`
2. **Task 2: Operator visual safety-gate verification** - no code (verification-only checkpoint); operator response **APPROVED**

**Plan metadata:** this `docs(12-07)` commit (SUMMARY + STATE + ROADMAP + REQUIREMENTS + refinement backlog)

## Files Created/Modified
- `src/app/(overview)/page.tsx` - v2 full-stack overview: fail-soft Promise.all of five reads → `rankCards` → `assembleIncidents` → `rollupLayer` (5 layers, bitcoind = declared-bitcoind hosts) → `buildBandLines`/`buildCalmState` → `applyFilter` → df primitives + client islands in the OverviewShell layout.
- `.planning/phases/12-ops-center-overview/12-REFINEMENT-BACKLOG.md` - 9-item operator refinement backlog from live review (follow-up, not 12-07 scope).

## Decisions Made
- Page assembly verified LIVE by the operator (not just automated) — the safety-gate invariants (advisory-only, honest-stale, no command execution) PASS against real fleet data.
- The 9 operator refinement items are explicitly OUT of 12-07 scope and routed to gap-closure planning (`/gsd-plan-phase 12 --gaps`) rather than fixed inline.

## Deviations from Plan

None - plan executed exactly as written. Task 1 composed the page from the tested pure layer per the plan; Task 2 was a verification-only checkpoint, approved by the operator.

## Issues Encountered

Live verification surfaced infra (not code) blockers, resolved out-of-band with one-time grants — see the Environment note below. No code deviations resulted.

## Deferred / Follow-up

The operator reviewed the LIVE page and raised **9 refinement items** — captured in
[`.planning/phases/12-ops-center-overview/12-REFINEMENT-BACKLOG.md`](./12-REFINEMENT-BACKLOG.md).
None are safety violations (advisory-only / honest-stale / no-command-execution invariants
hold); they are UX refinements, two defects, and three new behavior rules. **They are NOT
part of 12-07 scope** — to be planned via `/gsd-plan-phase 12 --gaps`. Summary:

1. **Filter performance** — every filter chip re-fetches all 5 warehouse reads (~8s); move `applyFilter` client-side + cache the data layer (filter is pure/isomorphic).
2. **Masthead double-chrome** — `(overview)/layout.tsx` `MastheadNav` stacks above the page's `NavRailShell`; reconcile to one chrome (shared with `/pending`, `/[pubkey]`, `@modal`).
3. **Collapsible incident cards** (LOCKED) — default collapsed; critical children never capped; non-critical capped at top 5 + "show N more".
4. **Fee-alert grouping** (LOCKED) — per node collapse to two summary lines (raise/lower) with counts, routing to the node's fee-adjustment queue; fees never critical.
5. **"Preview" view toggle** — `NavRailShell viewLabel="Preview"` is a mislabeled prototype carry-over; relabel or remove.
6. **"Live · polled Ns ago" pill** (defect) — fake live: static `pollAgeSeconds`, no client tick; implement real polling or relabel honestly + drop the green dot.
7. **`routing_vm` masthead literal** (info leak) — warehouse DB name printed top-right in `(overview)/layout.tsx`; remove (CLAUDE.md forbids exposing connection details).
8. **30-day staleness cutoff** (LOCKED) — nodes with no data in 30 days are treated as gone, dropped from queue + vitals (explains the 1000+ STALE flood).
9. **Service display-name map** (LOCKED) — relabel raw service keys (e.g. `addressBalances → "Address List Sync"`), keep interval-based health logic.

## Environment note (infra, not code)

Live operator verification required these **one-time grants** on `192.243.215.101`
(logged for ops; see the backlog doc's Environment note for the exact statements):
1. `ALTER ROLE grafana_demo_ro SET default_transaction_read_only = on;` (unblocked the boot health check).
2. `GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_demo_ro;` on `routing_vm` + `ldk-lspd-main` (as superuser `postgres`).
3. `GRANT SELECT ON ALL TABLES IN SCHEMA public TO nodemon_rw;` on `nodemon`.
Also cleared a wedged `.next` Turbopack cache (stuck compile after hard-killed dev servers).

## Next Phase Readiness
- Phase 12 plans 7/7 complete — the Ops Center Overview ships with OVW-01..05 delivered, operator-verified live, and zero write path.
- Phase 13 (Nodes + Service Health) can proceed: overview rows already link into the per-node screens it builds.
- Carry-forward: the 9-item refinement backlog should be planned (`/gsd-plan-phase 12 --gaps`) before or alongside Phase 13 — items 1 (filter perf), 4 (fee grouping), and 8 (30-day cutoff) materially affect the live experience.

## Self-Check: PASSED

---
*Phase: 12-ops-center-overview*
*Completed: 2026-06-30*
