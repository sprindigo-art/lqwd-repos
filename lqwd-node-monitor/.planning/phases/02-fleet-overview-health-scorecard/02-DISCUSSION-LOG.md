# Phase 2: Fleet Overview + Health Scorecard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 2-Fleet Overview + Health Scorecard
**Areas discussed:** Dimension data-sourcing, Scoring & rollup, Fleet-median & outliers (+ LDK scope, freshness)

---

## LDK scope (clarified before area selection)

The user noted upfront that `ldk-lspd-main` is LSP-service-focused and that LDK-node monitoring is being **consolidated into `routing_vm`**.

**User's choice:** Phase 2 reads `routing_vm` only; LDK rows will appear within the existing unchanged `lnd_*` tables. Still illustrate LDK vs LND **separately** in the UI.
**Notes:** "We should still illustrate ldk and lnd separately but data will all come from routing vm db only … the tables will remain unchanged the ldk data will just be within those tables." Separation matters because *"ldk and lnd may require different commands and different recovery and they will have different resources and services running on the node."* → backend treated as a first-class attribute (CONTEXT D-04), no NodeMonitor-side work to enable the consolidation.

---

## Dimension data-sourcing

| Option | Description | Selected |
|--------|-------------|----------|
| Show all 10, mark gaps | Render all 10; no-source dims show "no data — needs log ingestion", excluded from rollup | ✓ |
| Score derivable only | Drop no-source dims entirely for v1 | |
| Redefine to proxies | Fill gaps with warehouse proxies (diverges from _library definitions) | |

**User's choice:** Show all 10, mark gaps.
**Notes:** Keeps the documented 10-dimension contract intact for Phase 4; honest about the log-vs-warehouse gap confirmed by `data-gap-inventory.md`.

### Backend identification (sub-decision)

| Option | Description | Selected |
|--------|-------------|----------|
| Operator config map | env/config `pubkey → lnd\|ldk` | ✓ |
| Infer from alias | derive from alias string | |
| Warehouse column | read a node-type column (none guaranteed; tables unchanged) | |

**User's choice:** Operator config map.

### Formulas & thresholds (sub-decision — reformulated after clarification)

The user rejected the first framing and asked what "formula and threshold" meant. After explanation (formula = how to compute from warehouse; threshold = healthy-vs-attention band):

**User's choice:** Let the planner invent its own reasonable numbers; thresholds are NOT decided.
**Notes:** *"those numbers are not decided and we will likely want to continue to create data to analyze to nail down the perfect numbers at different times to effectively get the best results."* → thresholds must be a central, tunable config (CONTEXT D-02), `_library` as starting reference not contract.

---

## Scoring & rollup

### Dimension display

| Option | Description | Selected |
|--------|-------------|----------|
| Status + raw value | traffic-light status + raw number | (superseded) |
| 0–100 numeric score | normalized per-dimension score | |
| Letter grade | A–F per dimension | |

**User's choice:** initially "Status + raw value" — later upgraded to **color + letter grade + % + raw value** after the user said colors alone are too vague.

### Rollup → at-a-glance health

| Option | Description | Selected |
|--------|-------------|----------|
| Worst-status + counts | node color = worst dim + count badge | (refined) |
| Worst-status only | worst dim, no counts | |
| Weighted composite | per-dimension weights → score | |

**User's response:** *"We need a way to identify critical vs non critical we certainly cant have any issue lead to a red badge making it appear critical."* → led to the per-dimension severity model (red = Tier-1 only).

### Grade ↔ critical relationship

| Option | Description | Selected |
|--------|-------------|----------|
| Grade + separate critical chip | composite grade/% for detail; Tier-1 critical as un-averaged chip | ✓ |
| Grade with critical cap | critical caps the grade at a failing band | |
| Per-dimension grades, no rollup | compact grid, no single composite | |

**User's choice:** Grade + separate critical chip.
**Notes:** User additionally requested a **reason subtext** ("Yellow: low revenue type of thing") → folded into the node row (CONTEXT D-06). Granularity (grade/%) requested explicitly because 3 colors are "too vague given all the dimensions."

---

## Fleet-median & outliers (FLEET-03)

### Comparison axes

| Option | Description | Selected |
|--------|-------------|----------|
| Both (band + median) | absolute grade AND peer-relative read | ✓ |
| Median-relative only | percentile vs fleet only | |
| Absolute only | tunable bands only | |

**User's choice:** Both (band + median).

### Peer cohort

| Option | Description | Selected |
|--------|-------------|----------|
| Per-backend cohort | LND vs LND median, LDK vs LDK; suppress small cohorts | ✓ |
| Backend + size tier | within backend AND XL/M/edge tier | |
| Whole-fleet, normalized | one median, size-normalized metrics | |

**User's choice:** Per-backend cohort.
**Notes:** Respects the LDK/LND separation; LDK (~1 node) shows "no peer baseline yet".

### Outlier definition

| Option | Description | Selected |
|--------|-------------|----------|
| Median-abs-deviation (MAD) | >N MADs from cohort median, tunable N | ✓ |
| Percentile / worst-N | bottom/top quartile or worst-N | |
| % distance from median | >X% from median, per-dimension X | |

**User's choice:** Median-absolute-deviation (MAD).
**Notes:** Robust to small noisy samples; doesn't always flag someone. Surfaces as a separate outlier marker, not folded into the absolute grade.

---

## Freshness (FLEET-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Per-node worst-case + stale flag | "data as of" = oldest of latest input timestamps; stale marker past tunable threshold | ✓ |
| Per-dimension freshness | each dimension shows its own data age | |
| Single page stamp | one "data as of" for whole overview | |

**User's choice:** Per-node worst-case + stale flag.

---

## Claude's Discretion

- shadcn/ui setup + navy theming + any Recharts wiring (per repo `CLAUDE.md` stack + sibling `lqwdclaw` conventions).
- Exact composite-grade math (unweighted-average default; weighting deferred).
- Precise warehouse table+column mapping + time windows per computable dimension (honoring AFM-001/AFM-002).
- Default starting values for all tunable knobs (thresholds, severity Tier lines, MAD N, staleness threshold).
- Reference node(s) + `_library` source doc for success-criterion-4 validation (Canada is the safe anchor).

## Deferred Ideas

- Log-fed dimensions actually computed (PG health, stability, visibility, full restart history) — needs log/`pg_stat` ingestion absent from warehouse.
- Peer flap-rate at full fidelity — needs per-peer disconnect event history.
- Weighted composite grade — later tuning enhancement.
- Recommendation cards / detectors / triage inbox — Phase 4.
- Per-node console + pending monitor — Phase 3.
- Size-tier cohorts (XL/M/edge) — considered; per-backend chosen for now, revisit if too coarse.
