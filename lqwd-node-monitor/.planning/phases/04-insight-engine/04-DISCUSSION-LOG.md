# Phase 4: Insight Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 4-insight-engine
**Areas discussed:** Card schema & freeze mechanics, Triage inbox surface & ranking, Detector definitions & data gaps, Guardrails & LLM narrative behavior

---

## Pre-discussion: Todo match

| Option | Description | Selected |
|--------|-------------|----------|
| Skip — already owned by Phase 3 | ui-polish-fleet-console.md is owned by Phase 3 gap-closure plans 03-10…03-16 | ✓ |
| Fold into Phase 4 | Treat remaining polish as Phase 4 scope | |

**User's choice:** Skip — already owned by Phase 3

---

## Card schema & freeze mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse scorecard taxonomy (critical/warn/info) | Same Tier-1/Tier-2-3 line as SCORECARD_CONFIG tier1; reuses severity-tinted chips | ✓ |
| Separate 4+ level scale | P1–P4 with its own mapping | |
| Versioned type + zod + contract test | schemaVersion field + zod validator + contract test; Phases 5/6 import the zod schema | ✓ |
| TS type + docs only | Lighter, compile-time only | |
| Discriminated union per action type | Typed per-action params (Phase 6 signs canonical(params)) | ✓ |
| Freeform params object | Record<string, unknown> | |
| Structured evidence + console deep-link | Metric, observed value, threshold, window + deep-link URL (Phase 3 D-03 URLs) | ✓ |
| Free-text evidence | Human-readable string only | |

**User's choice:** All recommended options selected.

---

## Triage inbox surface & ranking

| Option | Description | Selected |
|--------|-------------|----------|
| New dedicated inbox page | Attention Queue stays a scorecard feed; new page is the card inbox | ✓ |
| Upgrade Attention Queue into the inbox | One surface, mixed concerns | |
| Both: page + fleet-page entry | Dedicated page + compact fleet-page strip | |
| Severity first, limbo-at-risk within band | critical→warn→info; stuck-pending by limbo balance within band | ✓ |
| Composite risk score | Blended severity + sats + age formula | |
| Stateless recompute | Pure functions of warehouse state; no nodemon writes this phase | ✓ |
| Persisted ack/dismiss | Pulls nodemon schema forward from Phase 6 | |
| Cards surface in node console too | Active Signals panel shows that node's cards | ✓ |
| Inbox only | Cards only in the fleet inbox | |

**User's choice:** Dedicated page (no fleet-page strip), severity-first ranking, stateless, console tie-in.

---

## Detector definitions & data gaps

| Option | Description | Selected |
|--------|-------------|----------|
| Researcher derives from France data | Fee-crash step-down derived from France PPM-crash reference; tunable starting values | ✓ |
| I'll define the rule here | Operator specifies the rule now | |
| Derive from the 2024-09-09 cascade | Cluster rule (≥N nodes same-hour self-closes) reconstructed from warehouse data | ✓ |
| I'll define the rule here | Operator specifies cluster rule now | |
| Honest no-data placeholders | AP-12 ships as "no data — needs log ingestion" | |
| Proxy detectors from warehouse signals | Approximate via restart/peer signals | |
| Research decides per detector | Mixed strategy | |
| Extend the central tunable config | Detector knobs inside SCORECARD_CONFIG file | |
| Separate detector config file | Own insight-engine config module | ✓ |

**User's choice (AP-12, free text):** "if no data available lean on llm to make most educated assumption but with note that no clear data present and it is llm suggestion"
**Notes:** Follow-up questions bounded the LLM fallback: advisory-only (info severity, NO params, labeled "LLM inference — no warehouse data", never triggers guardrail suppression, never feeds Phases 5/6) ✓; gated behind the same off-by-default LLM toggle as the narrative ✓ (when off → honest no-data placeholder). Config-home note: detector file holds detector-ONLY knobs and reads SCORECARD_CONFIG bands where overlapping — no forked threshold table.

---

## Guardrails & LLM narrative behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Show card with suppressed flag + reason | SUPPRESSED state + "node flagged AP-11 — write recommendations withheld" | ✓ |
| Hide suppressed cards entirely | Cleaner but indistinguishable from no-signal | |
| Min-delta + min-interval in config | Fee card fires only past delta AND interval thresholds | ✓ |
| Guidance text only | Detector fires freely | |
| Guidance on cards, enforcement later | Rate-limit counter as text; hard enforcement Phase 6/7 | ✓ |
| Engine caps cards per node | Stricter, hides signals | |
| Inbox-level: narrate the flagged set | One fleet-level narrative button | |
| Per-node narration | Per-card/node buttons | |
| Both levels | Inbox summary + per-node detail | ✓ |

**User's choice:** Visible suppression, config-knob hysteresis, guidance-only rate limit, narrative at both levels.

---

## Claude's Discretion

- Action-type enum membership + per-action param field names
- Card identity/dedupe key design
- Inbox route name, layout, grouping, empty state, freshness placement (design skills binding)
- Engine module layout (detector-per-module mirroring dimension modules)
- Stuck-pending thresholds; HTLC-timeout + rebalance-success signal mechanics (researcher-proposed)

## Deferred Ideas

- Fleet-page inbox entry strip / top-N preview
- Persisted ack/snooze/dismiss (post-Phase 6)
- Hard write rate-limit enforcement (Phases 6/7)
- Real AP-12 detectors via log ingestion (retires the LLM fallback)
- Scheduled card refresh (v2)
