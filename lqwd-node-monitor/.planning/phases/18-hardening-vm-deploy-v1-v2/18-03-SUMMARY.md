---
phase: 18-hardening-vm-deploy-v1-v2
plan: 03
subsystem: read-model-honesty
tags: [harden-01, harden-03, honest-stale, fee-signals, ap12, service-health, incidents, tdd]
requires:
  - "18-01 (CI harness + DB-required test tagging — all new tests are pure/no-DB and run under the CI floor)"
provides:
  - "detectFeeSignals(volumeRows: ChannelVolumeRow[] | null) — a FAILED 90d volume read degrades to null (UNKNOWN), never []; unknown volume is raise-only (zero close/lower cards, no fabricated forwards90d evidence)"
  - "ap12AdvisoryCards stamps evidence.asOf from each view's collectedAt (epoch sentinel when null) and badges stale/undated samples detail.stale='true' — never a fabricated now()"
  - "deriveServiceHealth attribution = node_pubkey ?? inventory_node_pubkey in BOTH branches — declared-but-silent node-scoped services land on their node, not host infra"
  - "loadIncidents() applies the LOCKED 30-day freshness cutoff + surviving-pubkey card filter internally — AI narration + mute baseline operate on the SAME incident set the operator sees"
  - "incidents.ts fee-summary emission branch applies the same staleNodes demotion as the generic + rollup branches"
affects:
  - "narrate-incident / incident-tracking server actions (now consume the operator-visible set)"
  - "18-xx verification plans re-affirming HARDEN-03 on the read model"
tech-stack:
  added: []
  patterns:
    - "Honest-degrade: a failed read carries null (UNKNOWN) through the seam, never an empty-collection value that reads as 'confirmed zero'"
    - "Evidence timestamps come from the sample's own collectedAt, with new Date(0) as the visibly-ancient sentinel for undated samples"
key-files:
  created: []
  modified:
    - src/lib/insight/detectors/fee-signals.ts
    - src/lib/insight/detectors/fee-signals.test.ts
    - src/lib/insight/detectors/ap12-advisory.ts
    - src/lib/insight/detectors/ap12-advisory.test.ts
    - src/lib/insight/engine.ts
    - src/lib/insight/engine.test.ts
    - src/lib/read/service-health.ts
    - src/lib/read/service-health.test.ts
    - src/lib/overview/load-incidents.ts
    - src/lib/overview/load-incidents.test.ts
    - src/lib/overview/incidents.ts
    - src/lib/overview/incidents.test.ts
decisions:
  - "Raise-only under unknown volume means fee_raise MAY still emit on the policy read alone (currentPpm < feeFloorPpm) with NO forwards90d evidence claim — raising is the safe direction; close/lower (which rest on a low/zero-volume premise) are fully suppressed"
  - "A REAL (possibly empty) volume array keeps aggregate semantics: a chan_id absent from a successful aggregate genuinely routed 0 forwards — only the null (failed-read) case is UNKNOWN"
  - "Stale ap12 views are BADGED (detail.stale='true' + honest asOf), not skipped — matches the fleet-wide demote-don't-hide posture"
  - "page.tsx was NOT edited (belongs to another in-flight plan): it already applies the identical cutoff+filter, so the two pipelines now converge on the same set; folding page.tsx onto loadIncidents() is a follow-up for its owning plan"
metrics:
  duration: "~11 min"
  completed: "2026-07-23"
---

# Phase 18 Plan 03: Read-Model Honest-Stale Hardening (I-fee, I-pg, D-svc, O-load, O-fee) Summary

Absent/stale read-model signals now degrade honestly everywhere the review flagged: a failed 90d volume read can never fabricate a confident channel-close recommendation (nullable volume → raise-only), pg advisories carry their sample's real timestamp with a stale badge, silent node-scoped services attribute via the inventory declaration, and AI narration/mute baselines consume the exact incident set the operator sees.

## Tasks Completed

| Task | Name | Commits | Files |
|------|------|---------|-------|
| 1 | Nullable volume → raise-only (I-fee) + collectedAt-stamped pg advisory (I-pg) | 0148472 (RED), d11e2e3 (GREEN) | fee-signals.ts/.test.ts, ap12-advisory.ts/.test.ts, engine.ts/.test.ts |
| 2 | Node-attribution fallback (D-svc) + unified incident pipeline (O-load) + fee-summary stale demotion (O-fee) | bd88682 (RED), 4756e8b (GREEN) | service-health.ts/.test.ts, load-incidents.ts/.test.ts, incidents.ts/.test.ts |

## What Was Built

**Task 1 — I-fee + I-pg:**
- `engine.ts` degrades a failed `channelVolumeForFleet()` read to `null` (was `[]`); `AssembleInputs.volumeRows` is now `ChannelVolumeRow[] | null`.
- `detectFeeSignals` treats null volume as UNKNOWN per channel (`forwards90d: number | null`): `channel_close_candidate` and `fee_lower` are suppressed (both rest on a low/zero-volume premise a missing read cannot support); `fee_raise` may still emit on the policy read alone, with the `forwards90d` evidence claim omitted (never a fabricated 0). A real empty array keeps the pre-existing "absent entry = genuinely 0" aggregate semantics — regression-pinned.
- `ap12AdvisoryCards` stamps `evidence.asOf` from each `PgHealthView.collectedAt` (epoch sentinel `new Date(0)` when null) and passes a stale flag into `buildAp12Card`, which badges `detail.stale: "true"` on stale/undated samples. The module-level `new Date().toISOString()` stamp is gone.

**Task 2 — D-svc + O-load + O-fee:**
- `deriveServiceHealth` computes `nodePubkey = row.node_pubkey ?? row.inventory_node_pubkey` once and uses it in BOTH the no-data and observed branches (the SQL always selected the inventory column; the derivation never read it).
- `loadIncidents()` now applies `applyFreshnessCutoff` per layer (nodes/hosts/chain/services, each by its own stamp accessor) plus the surviving-pubkey filter over `rankCards(...)` BEFORE `assembleIncidents` — mirroring `page.tsx` exactly, so `narrateIncident()` and the mute baseline operate on the operator-visible set.
- `incidents.ts` fee-summary branch applies the same `staleNodes` demotion as the generic-leaf and rollup branches (severity VALUE → "stale", stale flag → true; keys only on staleNodes membership, no-mask for fresh nodes).

## Verification Evidence

- Plan's automated checks: `npx vitest run src/lib/insight/detectors/fee-signals src/lib/insight/detectors/ap12-advisory` and `... src/lib/read/service-health src/lib/overview/load-incidents src/lib/overview/incidents` — all green.
- TDD gate: RED runs confirmed 7 (Task 1) + 5 (Task 2) failing behavior tests before each GREEN commit.
- Affected suites: insight 282 pass, read+overview+insight combined 521 pass; `tsc --noEmit` exit 0; eslint clean on all 12 modified files.
- Full suite (DB-less): 1481 pass / 57 skip / 4 fail — the 4 failures are the pre-existing `NavRailShell.test.tsx` view-toggle tests (components, another plan's surface; logged in deferred-items.md, fail identically without these changes).
- "No channel_close_candidate from absent volume" proven at BOTH seams: pure detector (`detectFeeSignals(..., null)`) and full engine assembly (`assembleCards({ volumeRows: null })`).

## Deviations from Plan

### Auto-fixed / clarifications

**1. [Rule 3 - Interpretation] Raise-only semantics under unknown volume made concrete**
- **Found during:** Task 1
- **Issue:** `fee_raise` normally requires forwards90d ≥ feeHighVolumeForwards — unverifiable when volume is unknown — yet the must-have truth says absent volume "yields raise-only signals".
- **Fix:** With unknown volume, raise emits on the policy criterion alone (currentPpm < floor, the safe direction) and its evidence omits any volume claim; close/lower are fully suppressed. Pinned by test.
- **Commit:** d11e2e3

**2. [Rule 3 - Scope] page.tsx deliberately NOT folded onto loadIncidents()**
- **Found during:** Task 2
- **Issue:** The plan's "ideally page.tsx calls the one shared pipeline" would touch `src/app/(overview)/page.tsx`, which carries uncommitted work owned by another in-flight plan (orchestrator constraint: leave dirty, do not commit).
- **Fix:** The cutoff + filter were implemented inside `loadIncidents()` mirroring page.tsx's logic exactly, so both pipelines produce the same set; the page.tsx consolidation is deferred to its owning plan.

**3. [Absorbed] fee-signals.ts in-progress comment edits committed**
- **Found during:** Task 1
- **Issue:** `fee-signals.ts` was dirty with comment-only clarifications (display-only timeLockDelta placeholder — the 18-02 companion note) per the orchestrator's "build on it" instruction.
- **Fix:** Absorbed verbatim into the Task 1 GREEN commit (d11e2e3); no behavior change.

### Out-of-scope discovery (logged, not fixed)

- Pre-existing `NavRailShell.test.tsx` view-toggle failures (4) — components surface, unrelated to this plan; appended to `deferred-items.md`.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. All changes remove fabricated-confidence states from the read model (HARDEN-03 posture strengthened).

## Self-Check: PASSED

- All 12 modified files present; must-have artifacts confirmed (nullable volumeRows in fee-signals, applyFreshnessCutoff inside loadIncidents, inventory_node_pubkey link in service-health).
- Commits 0148472, d11e2e3, bd88682, 4756e8b — all FOUND.
