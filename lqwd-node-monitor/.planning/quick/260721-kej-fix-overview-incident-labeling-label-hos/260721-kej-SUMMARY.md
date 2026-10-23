---
phase: quick-260721-kej
plan: 01
subsystem: overview/incidents
tags: [overview, incidents, labeling, unattributed, tdd]
requires: []
provides:
  - "Host-label resolver (owned-node alias → hostId) at the incidents final rollup loop"
  - "Healthy Unattributed bucket suppression gate"
affects:
  - src/lib/overview/incidents.ts
tech-stack:
  added: []
  patterns:
    - "aliasByPubkey dual-source (scorecard nodes + ranked insight cards), first-seen-wins"
    - "severity gate on topLevel.push (worstSeverity filters stale → healthy → suppressed)"
key-files:
  created: []
  modified:
    - src/lib/overview/incidents.ts
    - src/lib/overview/incidents.test.ts
decisions:
  - "Resolve entityLabel in the final host rollup loop (least-invasive) BEFORE why is computed"
  - "Iterate owned pubkeys in Set (insertion) order for a deterministic multi-node tie-break"
metrics:
  duration: ~15m
  completed: 2026-07-21
---

# Quick 260721-kej: Overview Incident Labeling + Unattributed Suppression Summary

Relabel host incident cards by their owned-node alias (else the hostId) instead of an arbitrarily-first-placed service name, and suppress the healthy (all-stale) Unattributed bucket while still surfacing live orphan alerts — both fixes landed TDD-first in the pure `incidents.ts` assembler, extending the LOCKED test suite without weakening any assertion.

## What Was Built

**FIX 1 — Host relabel (Task 1).** Added `aliasByPubkey: Map<string,string>` built from BOTH `nodes` (`ScorecardView.pubkey → alias`) AND `rankedCards` (`card.node.pubkey → card.node.alias`), first-seen-non-null wins. In the final host rollup loop (`incidents.ts` ~:520), before `incident.why` is computed, each host incident's `entityLabel` is resolved to the first aliased pubkey among `nodePubkeysByHost.get(incident.key)` (Set/insertion order for a deterministic tie-break), falling back to the hostId when the host owns no aliased node. Service-first hosts (e.g. `ip-10-0-5-202`'s "Channel Acceptor") now title by node/host identity, never a service label. The `unattributed` bucket (rolled up in the separate block) is untouched.

**FIX 2 — Unattributed suppression (Task 2).** Gated the terminal `topLevel.push(bucket)` on `bucket.severity !== "healthy"`. Because `worstSeverity` filters `stale`, an all-stale/healthy orphan group rolls up to `healthy` and is dropped as context-free noise; a live critical/warning/watch orphan yields a non-healthy severity and still surfaces (no-mask).

## Tasks

| Task | Name | RED commit | GREEN commit |
| ---- | ---- | ---------- | ------------ |
| 1 | Relabel host incident cards (FIX 1) | 00f1bf2 | ed44224 |
| 2 | Suppress healthy Unattributed bucket (FIX 2) | 7bf543e | 16c1e6f |

## Tests Added (5 new, LOCKED suite extended — nothing weakened)

- FIX 1: service-only host titles by owned-node alias (`why` = "1 alert on {alias}"); service-only aliasless host titles by hostId; **regression guard** — node-insight-card host label unchanged (`alias-nodeCard`, byte-identical to prior behavior).
- FIX 2: all-stale orphan bucket absent from output; live-critical orphan bucket present with `severity: "critical"`.

## TDD Gate Compliance

Both tasks followed RED → GREEN with distinct `test(...)` then `fix(...)` commits. The two regression/no-mask guards (Task 1 node-child label, Task 2 live-orphan) passed on introduction by design — they lock existing behavior against the new code paths, not new behavior. The behavior-adding assertions (2 relabel + 1 suppress) failed RED as expected before implementation.

## Verification

- `npx vitest run src/lib/overview/incidents.test.ts src/components/overview` → **41 passed (3 files)**.
- `npx tsc --noEmit` → **clean**.
- `npm run lint:noc-guard` → **v2 surfaces clean**.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- src/lib/overview/incidents.ts — FOUND (modified)
- src/lib/overview/incidents.test.ts — FOUND (modified)
- Commits 00f1bf2, ed44224, 7bf543e, 16c1e6f — all present in git log.
