# Phase 14: Hosts + Infra Monitoring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-13
**Phase:** 14-hosts-infra-monitoring
**Areas discussed:** Design source for Host screens, Hosts list composition, Host Detail structure, Storage time-to-full display

---

## Design source for Host screens

### Q1 — Where should the visual contract come from (no prototype/brief exists)?

| Option | Description | Selected |
|--------|-------------|----------|
| UI-SPEC from sibling grammar | Run /gsd-ui-phase 14 after this discussion — derive from Node Detail / Ops Center grammar + df primitives | ✓ |
| Sketch/prototype first | claude.ai/design or /gsd-sketch pass before any spec | |
| Derive directly, no spec | Planner composes straight from df primitives | |

### Q2 — How much visual latitude for the UI-SPEC?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict reuse only | Compose exclusively from existing df primitives; zero new components | ✓ |
| New compositions allowed | New host-specific composites from locked tokens | |
| You decide | Spec author judges per element | |

### Q3 — HOST-01 requires meters but no meter primitive exists — resolution?

| Option | Description | Selected |
|--------|-------------|----------|
| One new df meter primitive | Single exception: df ThresholdMeter (severity-ramp fill), gallery-registered, shared by vitals + storage | ✓ |
| Numbers + severity color only | Severity-colored value text, no bar | |
| Repurpose Sparkline/EvidenceChart | Tiny trend chart instead of fill meter | |

### Q4 — Operator sign-off on the 14-UI-SPEC?

| Option | Description | Selected |
|--------|-------------|----------|
| Blocking sign-off | Operator reviews + approves spec before /gsd-plan-phase 14 | ✓ |
| Flow through, review at verify | Spec goes straight to planning | |

**Notes:** An initial "Flow through" selection was interrupted and re-asked at the user's request; the confirmed answer is Blocking sign-off.

---

## Hosts list composition

### Q1 — Show which source drove the worst-of rollup?

| Option | Description | Selected |
|--------|-------------|----------|
| Severity + driver line | Worst-of SeverityCard chrome + one plain-language driver line (e.g. "driven by: bitcoind not functioning") | ✓ |
| Severity + 3 source chips | Mini per-source breakdown (infra/nodes/resources dots) | |
| Severity chrome only | Color + on-card evidence only | |

### Q2 — What does the list enumerate given only the canary reports telemetry?

| Option | Description | Selected |
|--------|-------------|----------|
| All declared hosts, honest no-data | Every `hosts`-dimension host; silent hosts as explicit no-data/stale cards | ✓ |
| Only hosts with telemetry | One card today; hides declared-but-silent hosts | |
| Declared + a seed pass | Option 1 + fold a fleet-hosts seed task into this phase | |

### Q3 — Node-health dots behavior?

| Option | Description | Selected |
|--------|-------------|----------|
| Dots → tooltip → Node Detail | Severity dot per node, hover alias+status, click deep-links to node detail; card body → Host Detail | ✓ |
| Dots are display-only | Tooltip only, no click | |
| Count summary instead of dots | "3 nodes · 1 at-risk" line | |

### Q4 — Filter/sort set?

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror Nodes-list facets | Severity facet + stale toggle, worst-first default, URL-param driven (parseNodeFacets pattern) | ✓ |
| Minimal: stale toggle + worst-first | Just the required filter | |
| Facets + driver-source filter | Adds filter by rollup driver | |

---

## Host Detail structure

### Q1 — Where do the host routes live?

| Option | Description | Selected |
|--------|-------------|----------|
| /hosts + /hosts/[hostId] | Nested under /(overview)/hosts; self-describing, no [pubkey] ambiguity | ✓ |
| Root-level /[hostId] | Mirror node pattern; catch-all must disambiguate | |

### Q2 — Single-scroll section order?

| Option | Description | Selected |
|--------|-------------|----------|
| Incident first | Header → incident banner (when present) → vitals → infra → storage → nodes | ✓ |
| Vitals first, incident last | Mirrors Node Detail order | |
| You decide | Spec author picks + justifies | |

### Q3 — What renders for "root-cause incident + runbook" before Phase 15?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline summary + runbook modal | Grouped incident from assembleIncidents + verify-first runbook via inert CommandModal; Phase 15 adds deep-link | ✓ |
| Summary + link stub to Phase 15 | Placeholder "Incident Detail" affordance | |
| Runbook only, no incident framing | Runbook on failing service rows only | |

### Q4 — On-host nodes section presentation?

| Option | Description | Selected |
|--------|-------------|----------|
| Compact Nodes-list rows | Phase-13 SeverityRow grammar, compact variant; row click → Node Detail | ✓ |
| Mini node cards | Small SeverityCards per node | |
| Dots + names only | Section as a router, not a summary | |

---

## Storage time-to-full display

### Q1 — Severity bands for days-to-full?

| Option | Description | Selected |
|--------|-------------|----------|
| 7 / 30 / 90 days | critical <7d, warning <30d, watch <90d; in read-time bands config | ✓ |
| 14 / 45 / 120 days | More conservative lead time | |
| You decide | Planner picks per telemetry-bands conventions | |

### Q2 — How do the no-projection statuses read?

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct honest copy per status | Stale / gathering-data / not-growing each get their own plain-language line | ✓ |
| One generic line | "No projection available" + tooltip | |
| Hide projection row entirely | Meter + current % only | |

### Q3 — Long horizons + projection value rendering?

| Option | Description | Selected |
|--------|-------------|----------|
| Cap at ">1 year" | ≥365d renders ">1 year"; below, humanized units + %/day rate | ✓ |
| Exact days always | Always print the computed number | |
| Date instead of countdown | Projected calendar date | |

### Q4 — Volume row content?

| Option | Description | Selected |
|--------|-------------|----------|
| Meter + rate + projection | ThresholdMeter + current % + %/day + projection line; sparklines stay on vitals only | ✓ |
| Meter + projection + growth sparkline | Adds per-volume history chart | |
| Numbers only | No meter on volumes | |

---

## Claude's Discretion

- Card grid layout/breakpoints; compact node-row column trim; vitals sparkline window;
  projection humanize rules; empty/all-clear states; hosts nav-rail entry placement.

## Todos reviewed (none folded)

- `ui-polish-fleet-console.md` — Phase 12 surface, kept out.
- `2026-06-23-pin-lncli-cron-path-hardening.md` — node-side tooling, kept out.
- `2026-06-23-exercise-inbound-fee-a2-lnd8614.md` — node-side verification, kept out.
- (Two other keyword matches were already folded and delivered in Phase 13.)

## Deferred Ideas

- Per-volume growth sparkline (trend evidence on storage rows).
- Fleet `hosts`-dimension seed pass (true fleet shape immediately) — rollout/hardening territory.
- Incident deep-link from the Host Detail banner — Phase 15.
