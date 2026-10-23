# Phase 12: Ops Center Overview - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-30
**Phase:** 12-ops-center-overview
**Areas discussed:** Root-cause incident grouping, AI "what needs you now" band, Cross-layer severity model, Fleet-vitals proportionality

---

## Root-cause incident grouping (OVW-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Topology roll-up | Containment-driven host→service→node→channel; parent failure collapses children into one incident keyed by parent; severity = worst child | ✓ |
| Heuristic correlation | Group by time + entity proximity, not strict topology | |
| Flat + related links | No hard grouping; cross-links only | |

**User's choice:** Topology roll-up.
**Notes:** Ownership map derivable from existing data (hosts.node_pubkeys, service_inventory.host_id/node_pubkey, node→channel) — no new schema.

---

## AI "what needs you now" band (OVW-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic select + LLM narrates | Ranking/selection deterministic (source of truth); LLM phrases only, off-by-default env flag; guardrails forbid command emission | ✓ |
| Fully LLM-generated | LLM selects AND phrases | |
| Fully deterministic templated | No LLM at all | |

**User's choice:** Deterministic select + LLM narrates.

**Follow-up — Band visibility vs LLM:**
| Option | Selected |
|--------|----------|
| Band always shows; LLM upgrades phrasing | ✓ |
| Band hidden unless LLM enabled | |
| Band always shows, LLM always on | |

**Follow-up — Dismissal scope:**
| Option | Selected |
|--------|----------|
| Session-scoped | ✓ |
| Durable per-incident | |
| Snooze with timer | |

**Notes:** Band always present (deterministic lines satisfy OVW-02 with zero LLM dependency); LLM rephrases when flag on. Session-scoped dismissal — re-derives each load, no new persistence.

---

## Cross-layer severity model (OVW-01/03/05)

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical 4-level ramp | Map every source onto Phase-10 ramp (critical/warning/watch/healthy) + stale; incident = max(children) | ✓ |
| Numeric score, bucketed | 0–100 per layer, bucketed | |
| Per-layer scales, normalize for sort only | Keep native states, normalize only for ordering | |

**User's choice:** Canonical 4-level ramp.
**Notes:** Reuses the existing design-system severity ramp; documented per-source mapping (insight rank, telemetry-bands, service-health two-axis).

---

## Fleet-vitals proportionality (OVW-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Entity count per state | Segments sized by # entities in each state per layer; per-layer counts shown | ✓ |
| Severity-weighted segments | Critical takes more width | |
| Healthy-fraction fill | Single ratio per layer | |

**User's choice:** Entity count per state (strictly proportional, no weighting).

---

## Claude's Discretion

- Deterministic AI-band line phrasing, the read-time grouping/ownership helper structure, and the precise per-source→ramp threshold mapping (within D-01…D-09).

## Deferred Ideas

- Pivot navigation + deep per-entity screens → Phase 13/14.
- Incident lifecycle (ack/assign/resolve) + AI explanation → Phase 15.
- Alerting / notification channels → later capability.
- Durable / snooze AI-band dismissal → revisit if nag fatigue reported.
- OVW-04 (honest stale/all-clear) + OVW-05 (filters/empty states) carried forward from existing Phase-10/11 patterns (not separately deep-dived).
