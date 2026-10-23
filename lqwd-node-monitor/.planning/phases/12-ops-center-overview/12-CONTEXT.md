# Phase 12: Ops Center Overview - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Phase Boundary

The full-stack **home screen** of the Ops Center: a root-cause-grouped attention
queue spanning all five layers (nodes / hosts / services / bitcoind / storage),
an advisory "what needs you now" AI band, a proportional fleet-vitals rollup, and
honest all-clear / stale states — built on the locked Phase-10 "Data-Forward v2"
design system, fed by the Phase-4 insight engine + Phase-11 telemetry read helpers.

Delivers OVW-01…OVW-05. This phase **composes existing data + ranking machinery
into one overview screen**; it does NOT build the deep per-entity screens (Nodes /
Node Detail / Service Detail = Phase 13; Hosts/Infra = Phase 14; incident
lifecycle + AI explanation = Phase 15). No new monitoring capability, no alerting
channels, no command execution.
</domain>

<decisions>
## Implementation Decisions

### Root-cause incident grouping (OVW-01)
- **D-01:** **Topology roll-up.** Grouping is containment-driven along
  host → service → node → channel. A parent failure (e.g. a host down/unreachable)
  collapses its child alerts (its services, the nodes running on it, those nodes'
  channels) into **one incident keyed by the parent**; children nest under it and
  drop out of the top-level queue.
- **D-02:** **Incident severity = worst child** (max across the grouped children),
  on the canonical ramp (see D-06).
- **D-03:** The host→service→node→channel **ownership map is derivable from
  existing data** — `hosts.node_pubkeys`, `service_inventory.host_id` +
  `node_pubkey`, and node→channel from the nodes read layer. No new schema; the
  planner should build a read-time ownership/grouping helper, not a stored graph.

### AI "what needs you now" band (OVW-02)
- **D-04:** **Deterministic selection + ranking is the source of truth; the LLM
  only narrates phrasing.** Which incidents appear and their order come from the
  insight `rank` + cross-layer severity (D-06). The LLM rephrases those same lines
  more naturally, is **off by default behind an env flag** (workspace LLM-optional
  principle), and `src/lib/insight/guardrails.ts` MUST forbid any command/param
  emission — the band is provably **advisory-only**, never emits an action.
- **D-05:** **The band is always present** — when the LLM flag is off it shows
  deterministic templated lines (so OVW-02 ships with zero LLM dependency); when
  on, the LLM upgrades the phrasing of those same lines. 1–4 lines, per-line
  severity. **Dismissal is session-scoped** (hides until reload; the band
  re-derives from live state each load — a real problem won't stay hidden). No new
  persistence infra.

### Cross-layer severity model (OVW-01 / OVW-03 / OVW-05)
- **D-06:** **One canonical 4-level ramp** — `critical / warning / watch / healthy`
  (+ `stale` as its own state) — reusing the Phase-10 design-system severity ramp
  verbatim. Every source maps onto it via a **documented per-source mapping**:
  insight-engine ranking (Lightning signals), `telemetry-bands` (host/chain
  thresholds), and `service-health` two-axis (RUNNING ∧ FUNCTIONING). This single
  scale drives queue ordering, incident roll-up severity (D-02), and the vitals bar.

### Fleet-vitals rollup (OVW-03)
- **D-07:** **Strictly proportional by entity count per state.** The health bar's
  segments are sized by the **number of entities** in each state
  (critical/warn/watch/ok/stale) within a layer — literal proportionality, no
  severity weighting. Per-layer counts are shown alongside the bar. Denominator =
  all entities in that layer (nodes / hosts / services / bitcoind / storage).

### Honest stale / all-clear (OVW-04) — carried forward
- **D-08:** Reuse Phase-11 **read-time staleness** (`deriveStale` / per-entity
  `collected_at`); `stale` is its own state, **never rendered as critical** and
  never faked-fresh. All-clear = the prototype's **calm-hero** state when nothing
  is wrong. No-data reads honestly everywhere (e.g. not-expected services, missing
  telemetry) — never green-by-default.

### Layer filters + empty states (OVW-05) — carried forward
- **D-09:** Queue filters by **layer** (Hosts/Services/bitcoind/Nodes/Storage) and
  **severity**, with honest empty states drawn from Phase-10 empty-state
  primitives. Filtering is a view concern over the same grouped incident set.

### Claude's Discretion
- The exact templated phrasing of deterministic AI-band lines, the read-time
  helper structure for grouping/ownership, and the precise per-source→ramp
  threshold mapping are implementation details for research/planning — within the
  D-01…D-09 frame.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked design system + overview prototype (Phase 10)
- `.planning/phases/10-design-system-foundation/.prototype-snapshot/Ops Center - Data-Forward v2.dc.html` — the **locked overview prototype** (reference, not dropped in verbatim).
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — validated design decisions, CSS patterns, visual direction (load before any UI implementation).
- `.planning/phases/10-design-system-foundation/10-CONTEXT.md` — token authority (D-03: Data-Forward v2 values; severity ramp separate from brand).
- `src/lib/df/tokens.ts` — the design tokens (severity ramp + navy brand).

### Design briefs (intent + visual quality bar)
- `.planning/DESIGN-BRIEF-ops-center.md` — the Ops Center evolution brief (full-stack layering, pivot model).
- `.planning/DESIGN-BRIEF-02-ops-center-bold-rethink.md` — the premium visual rethink brief for the Overview screen (quality bar: Linear/Vercel/Stripe).

### Data sources (existing read + ranking machinery)
- `src/lib/insight/` — `rank.ts`, `triage.ts`, `triage-facets.ts`, `narrative.ts`, `guardrails.ts` (Phase-4 insight engine: ranking, narrative, advisory guardrails).
- `src/lib/read/` — `service-health.ts`, `host-metrics.ts`, `storage-growth.ts`, `chain-telemetry.ts`, `telemetry-bands.ts`, `nodes.ts`, `pending.ts`, `latest.ts` (Phase-11 + earlier read helpers — the per-layer data).

### Requirements
- `.planning/REQUIREMENTS.md` — OVW-01…OVW-05 (lines 93–97).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Insight engine (`src/lib/insight/rank.ts`, `triage.ts`):** existing
  ranking/triage of Lightning signals — the spine for OVW-01's queue ordering;
  extend with cross-layer entries rather than rebuild.
- **`src/lib/insight/narrative.ts` + `guardrails.ts`:** existing LLM-narrative
  layer with advisory guardrails — the AI band's narration path (D-04) plugs in here.
- **`src/lib/read/*` (Phase-11 telemetry helpers):** per-layer state +
  read-time staleness already implemented; the overview reads from these, never
  re-queries raw tables.
- **`src/lib/df/tokens.ts` severity ramp:** the canonical 4-level scale (D-06)
  already exists as tokens — no new color/severity system.

### Established Patterns
- **Read-time staleness (D-13 from Phase 11):** `deriveStale` / per-entity
  `collected_at` — reuse for OVW-04, do not invent a freshness scheme.
- **Advisory-only / never-execute:** locked project principle (command export;
  dashboard never mutates) — OVW-02's "advisory only" inherits + `guardrails.ts`
  enforces it.
- **Light-mode-only Data-Forward v2** design system (Phase 10) — all overview UI
  builds on its primitives + tokens.

### Integration Points
- New read-time **grouping/ownership helper** (host→service→node→channel) built
  over existing read helpers (D-03).
- New **cross-layer severity mapping** that normalizes insight-rank +
  telemetry-bands + service-health two-axis onto the canonical ramp (D-06).
- The overview page (App Router) composes these into the queue + AI band + vitals
  rollup, wired to live data, on Phase-10 primitives.

</code_context>

<specifics>
## Specific Ideas

- Visual quality bar: Linear / Vercel / Stripe / Raycast — calm, confident,
  information-dense but not a spreadsheet (per DESIGN-BRIEF-02). The overview must
  answer "what needs my attention right now, across the whole stack?" instantly.
- "One host outage rolls its child node alerts into a single incident" (OVW-01) is
  the canonical grouping example — D-01 implements it literally.
</specifics>

<deferred>
## Deferred Ideas

- **Pivot navigation fleet→host→service→node→channel** and the deep per-entity
  screens — Phase 13 (Nodes + Service Health) and Phase 14 (Hosts + Infra).
  Overview rows LINK into these; the screens themselves are not built here.
- **Incident lifecycle (ack/assign/resolve over time) + AI explanation of an
  incident** — Phase 15. This phase surfaces incidents; it does not manage their
  lifecycle.
- **Alerting / notification channels** (push, email, Telegram) — out of scope for
  the overview; a later capability.
- **Durable / snooze dismissal** for the AI band — deferred (session-scoped chosen,
  D-05); revisit if operators report nag fatigue.

</deferred>

---

*Phase: 12-ops-center-overview*
*Context gathered: 2026-06-30*
