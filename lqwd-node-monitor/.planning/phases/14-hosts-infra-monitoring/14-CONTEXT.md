# Phase 14: Hosts + Infra Monitoring - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning

<domain>
## Phase Boundary

The infrastructure layer made operable — two new screens on the LOCKED Phase-10 Data-Forward
design system:

- **HOST-01 — Hosts list** at `/(overview)/hosts`: per-host cards with a worst-of severity
  rollup (infra + nodes + resources), CPU/mem/disk meters with threshold coloring, the infra
  trio (bitcoind/esplora/postgres) two-axis, node-health dots, and filters/sort incl. stale.
- **HOST-02 — Host Detail** at `/(overview)/hosts/[hostId]`: VM vitals (CPU/mem/disk with
  sparklines), infra services two-axis, storage volumes with %/day growth + projected
  time-to-full, the on-host nodes, and the root-cause incident + runbook.

Phase 14 is almost purely a **UI composition phase**: the entire read model already shipped in
Phase 11 (`host-metrics`, `storage-growth`, `chain-telemetry`, `service-health`,
`telemetry-bands`) and the grouping/severity machinery shipped in Phase 12
(`ownership`, `incidents`, `severity-map`). No new telemetry, no new collector work, no schema
changes. One deliberate design-system exception is scoped (a `ThresholdMeter` primitive, D-03).

**Not in scope:** Incident Detail / lifecycle / AI explanation (Phase 15); fleet-wide telemetry
rollout beyond the canary (hardening territory); alerting channels; any write path.
</domain>

<decisions>
## Implementation Decisions

### Design source & visual contract (no prototype exists for these screens)
- **D-01:** The visual contract is a **14-UI-SPEC produced by `/gsd-ui-phase 14`**, derived from
  the sibling grammar (Node Detail single-scroll structure, Ops Center card patterns, Phase-13
  list/detail conventions). No new prototype pass — unlike Phases 12/13 there is no locked
  `.dc.html` snapshot for hosts, so **the spec IS the visual source of truth**.
- **D-02:** **Strict reuse only**: the spec composes exclusively from existing df primitives
  (`SeverityCard`, `SeverityRow`, `TwoAxisPip`, `EvidenceChart`, `StaleChart`, `FreshnessChip`,
  `CommandModal`, `Sparkline`, …). No new tokens, no new base primitives — with exactly one
  scoped exception (D-03). Anything else missing gets composed from what exists or flagged back
  to the operator.
- **D-03:** **One new df primitive: `ThresholdMeter`** — a severity-ramp-colored fill meter
  (HOST-01's "CPU/mem/disk meters with threshold coloring" is unbuildable without it; no
  meter/progress primitive exists in `src/components/df/` or `src/components/ui/`). It must be
  registered in the `/design-system` gallery like every other primitive and is shared by the
  vitals meters AND the storage volume rows. This is the ONLY design-system addition.
- **D-04:** **Blocking operator sign-off on the 14-UI-SPEC before planning** — consistent with
  the Phase-10 gallery gate and the approved 13-UI-SPEC. `/gsd-plan-phase 14` must not run until
  the operator approves the spec.

### Hosts list composition (HOST-01)
- **D-05:** **Worst-of rollup shows its driver**: card chrome takes the worst-of severity
  (SeverityCard) plus ONE plain-language driver line naming the worst contributor — e.g.
  "driven by: bitcoind not functioning" — matching the overview's root-cause framing. No
  per-source chip breakdown.
- **D-06:** **The list enumerates ALL declared hosts** from the `hosts` dimension table.
  Hosts with no telemetry (everything except the canary today, per P11 D-12) render as explicit
  no-data/stale cards — never green, never hidden. The list is fleet-shaped from day one;
  rollout just lights cards up.
- **D-07:** **Node-health dots are interactive**: one severity-colored dot per on-host node
  (via `buildOwnershipMap`), hover tooltip shows alias + status, click deep-links to that node's
  `/(overview)/[pubkey]` detail. The card body click navigates to Host Detail.
- **D-08:** **Filters/sort mirror the Nodes-list facet grammar**: severity/status facet
  (all/critical/warning/watch/healthy) + stale toggle, default sort worst-first, URL-param
  driven following the `parseNodeFacets` pattern (`src/lib/overview/node-filter.ts`).

### Host Detail structure (HOST-02)
- **D-09:** **Routes**: Hosts list at `/(overview)/hosts`, Host Detail nested at
  `/(overview)/hosts/[hostId]`. Self-describing URLs; no ambiguity with the root-level
  `[pubkey]` node route.
- **D-10:** **Single-scroll, incident-first section order**: header → root-cause incident
  banner (only when an incident exists; absent when healthy) → VM vitals with sparklines →
  infra services two-axis → storage volumes → on-host nodes. "What's wrong" leads; evidence
  follows.
- **D-11:** **Incident + runbook render NOW, without Phase 15**: the banner shows the grouped
  incident from the existing `assembleIncidents` helper (severity, driver, affected children)
  plus the verify-first runbook via the inert `CommandModal`. Phase 15 later adds the
  "open incident" deep-link to Incident Detail — Phase 14 does not build any incident
  lifecycle or detail surface.
- **D-12:** **On-host nodes section = compact Nodes-list rows**: reuse the Phase-13
  `SeverityRow` row grammar trimmed to a compact variant (alias, type, severity, key
  liquidity/forwarding figures, freshness); row click → Node Detail.

### Storage time-to-full display (HOST-02, SC#3)
- **D-13:** **Severity bands for days-to-full: critical < 7d, warning < 30d, watch < 90d,
  healthy beyond.** Bands live in the read-time threshold config (per P11 D-14 — applied at
  read time, re-tunable without re-ingesting), following `telemetry-bands` conventions.
- **D-14:** **Distinct honest copy per no-projection status** (the `StorageProjectionStatus`
  from `computeStorageGrowth`): stale → "projection unavailable — data stale (2h old)";
  insufficient-samples / insufficient-window → "gathering data — projection in ~Nh";
  flat-or-negative → "not growing". The operator always knows WHY there's no number. Never
  hide the projection row silently.
- **D-15:** **Projection rendering**: `daysToFull ≥ 365` renders as ">1 year" (healthy, calm);
  below that, humanized units ("~45 days", "~3 weeks", "~5 days") alongside the "+0.4%/day"
  rate. No absurd long-horizon precision, no calendar-date rendering.
- **D-16:** **Volume row = ThresholdMeter (used-% severity fill) + current % + %/day rate +
  projection line.** One dense glanceable row per volume. Sparklines stay on the CPU/mem/disk
  vitals only — no per-volume history chart in this phase.

### Claude's Discretion
- Exact card grid layout/breakpoints, compact-node-row column trim, sparkline window for the
  vitals (follow the sibling Node Detail treatment), the humanize rules for projection copy,
  empty/all-clear states (reuse Phase-10/12 empty-state primitives), and hosts nav-rail entry
  placement — all within D-01…D-16 and the locked design system.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — HOST-01, HOST-02 (lines ~108–109).
- `.planning/ROADMAP.md` § "Phase 14: Hosts + Infra Monitoring" (line ~402) — goal + the three
  success criteria (SC#3 = honest time-to-full).

### Design contract (produced by this phase's flow — read once it exists)
- `.planning/phases/14-hosts-infra-monitoring/14-UI-SPEC.md` — **to be produced by
  `/gsd-ui-phase 14` and operator-approved BEFORE planning (D-01/D-04)**. The visual source of
  truth for both screens; there is no prototype snapshot for hosts.
- `.planning/phases/13-nodes-service-health/13-UI-SPEC.md` — the sibling list/detail grammar
  the 14 spec derives from (list facets, single-scroll detail, section treatments).
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — validated design decisions, CSS
  patterns, visual direction (load before any UI implementation).
- `.planning/phases/10-design-system-foundation/.prototype-snapshot/Node Detail.dc.html` +
  `Ops Center - Data-Forward v2.dc.html` — the locked sibling prototypes (grammar reference
  only; hosts screens are spec-derived, not prototype-locked).

### Design system (LOCKED — one scoped addition, D-03)
- `src/lib/df/tokens.ts` + `src/app/globals.css` — canonical tokens (severity ramp, navy brand).
- `src/components/df/` — reuse: `SeverityCard`, `SeverityRow`, `TwoAxisPip`, `EvidenceChart`,
  `StaleChart`, `FreshnessChip`, `PollAge`, `CommandModal`, `NavRailShell`, `CategoryIcon`.
  ADD: `ThresholdMeter` (D-03) + its `/design-system` gallery entry.
- `src/components/console/Sparkline.tsx` — vitals sparklines.
- `src/app/(design)/design-system/` — the gallery the new primitive registers into.

### Read model (Phase 11, shipped — consume, never re-derive)
- `src/lib/read/host-metrics.ts` — `getLatestHostMetrics`, `HostMetricsView`, `deriveStale`.
- `src/lib/read/storage-growth.ts` — `computeStorageGrowth`, `StorageGrowth`,
  `StorageProjectionStatus` (the D-14 honesty statuses already exist here).
- `src/lib/read/chain-telemetry.ts` — bitcoind blocks-behind + bands (infra trio FUNCTIONING).
- `src/lib/read/service-health.ts` — `ServiceHealthState`, `deriveServiceHealth` (two-axis).
- `src/lib/read/telemetry-bands.ts` — read-time threshold bands; the D-13 days-to-full bands
  extend this pattern.

### Overview machinery (Phase 12, shipped — reuse)
- `src/lib/overview/ownership.ts` — `buildOwnershipMap` (host → services → nodes), drives the
  node dots (D-07) and on-host nodes section (D-12).
- `src/lib/overview/incidents.ts` — `assembleIncidents`, `GroupedIncident`; the Host Detail
  incident banner (D-11) reads the host-keyed incident from here.
- `src/lib/overview/severity-map.ts` — the canonical per-source → 4-level-ramp mapping (P12
  D-06); the worst-of rollup (D-05) composes on it.
- `src/lib/overview/node-filter.ts` — `parseNodeFacets`/`applyNodeFilters`, the facet grammar
  the hosts facets mirror (D-08).
- `src/lib/overview/service-display.ts` — `serviceDisplay()`; never render raw machine keys.

### Prior phase context (decisions carried forward)
- `.planning/phases/13-nodes-service-health/13-CONTEXT.md` — single-scroll detail grammar
  (D-08 there), honest-fallback service rendering.
- `.planning/phases/12-ops-center-overview/12-CONTEXT.md` — worst-child severity (D-02),
  canonical ramp (D-06), topology roll-up (D-01).
- `.planning/phases/11-full-stack-telemetry-ingestion/11-CONTEXT.md` — read-time staleness
  (D-13), read-time thresholds (D-14), canary-only scope (D-12).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The full read API exists** — `host-metrics`, `storage-growth`, `chain-telemetry`,
  `service-health`, `telemetry-bands` (all with tests). Phase 14 wires screens to these
  helpers; it must not write new warehouse/nodemon queries.
- **`computeStorageGrowth` already implements the SC#3 honesty gate** — the
  `StorageProjectionStatus` union (`ok`/`insufficient-samples`/`insufficient-window`/`stale`/
  `flat-or-negative`) means "no projection when stale/insufficient" is a rendering task (D-14),
  not new logic.
- **`assembleIncidents` + `buildOwnershipMap` + `severity-map`** — the incident banner, node
  dots, and worst-of rollup all compose existing Phase-12 helpers.
- **`TwoAxisPip`** — the infra trio two-axis renders with the existing tested primitive; do
  not re-derive the combined-state precedence.

### Established Patterns
- **Honest stale everywhere** — staleness derived at read time from `collected_at`
  (`deriveStale`), never stored, never faked; a silent declared host reads no-data (D-06).
- **AFM-001 latest-per-entity DISTINCT-ON reads** — already inside the read helpers; consume
  them.
- **Facet filtering via URL params** — `parseNodeFacets` pattern (Phase 13) is the template
  for the hosts facets (D-08).
- **Single-scroll detail pages** — Phase-13 Node Detail grammar governs Host Detail (D-10).
- **Design-system gate** — every primitive lives in the `/design-system` gallery;
  `ThresholdMeter` (D-03) must register there and pass the same vitest/noc-guard gates.

### Integration Points
- New routes: `src/app/(overview)/hosts/page.tsx` (list) +
  `src/app/(overview)/hosts/[hostId]/page.tsx` (detail).
- Nav: hosts entry in `NavRailShell`; overview incident rows and Node Detail host references
  should deep-link to `/hosts/[hostId]` where natural.
- Cross-links: host card dots → `/(overview)/[pubkey]` (D-07); on-host node rows → Node
  Detail (D-12); infra service tiles → the Phase-13 Service Detail route
  `/(overview)/[pubkey]/service/[service]` where a node-scoped service page applies.
- One df addition: `src/components/df/ThresholdMeter.tsx` (+ test + gallery registration).

</code_context>

<specifics>
## Specific Ideas

- The driver line on host cards ("driven by: bitcoind not functioning") deliberately echoes
  the overview's root-cause framing — a host card is a mini-incident summary, not a metrics
  dump.
- The Hosts list should be **fleet-shaped from day one**: ~all declared hosts visible with
  honest no-data cards, so telemetry rollout is purely additive (cards light up as hosts
  onboard) — no UI change needed at rollout time.
- Since there is no prototype for these screens, the 14-UI-SPEC carries the full visual
  quality bar (Linear/Vercel/Stripe calm density per DESIGN-BRIEF-02) and gets a blocking
  operator review — the operator judges the spec the way they judged the prototypes.

</specifics>

<deferred>
## Deferred Ideas

- **Per-volume growth sparkline** — a used-% history chart per storage volume (rejected for
  this phase in D-16; vitals keep sparklines, volumes stay dense rows). Revisit if operators
  want trend evidence on volumes.
- **Fleet hosts dimension seeding** — a seed pass adding the remaining fleet hosts to the
  `hosts` dimension so the list shows the true fleet shape immediately (option considered at
  D-06; not folded). Belongs with fleet rollout / Phase-16 hardening territory.
- **Incident deep-link from the Host Detail banner** — Phase 15 activates it when Incident
  Detail exists (D-11).

### Reviewed Todos (not folded)
- **`ui-polish-fleet-console.md`** — Phase 12 overview surface polish, not a hosts screen.
- **`2026-06-23-pin-lncli-cron-path-hardening.md`** — node-side cron/tooling hardening; not a
  dashboard surface (Phase-16 territory).
- **`2026-06-23-exercise-inbound-fee-a2-lnd8614.md`** — node-side execution verification; not
  Phase 14 scope.
- (`2026-06-23-node-detail-all-channels-fee-queue.md` and
  `2026-06-23-one-click-enqueue-approve.md` were already folded and delivered in Phase 13.)

</deferred>

---

*Phase: 14-hosts-infra-monitoring*
*Context gathered: 2026-07-13*
