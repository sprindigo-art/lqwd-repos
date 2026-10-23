# Phase 17: Incident Lifecycle + AI Explanation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-19
**Phase:** 17-incident-lifecycle-ai-explanation
**Areas discussed:** Incident tracking (ack/assign/snooze + identity/state), Incident Detail layout, AI read surfacing + tone

---

## Incident Tracking — Assignee model

| Option | Description | Selected |
|--------|-------------|----------|
| Just you (assign to me) | Single-operator toggle; owner stores one operator id | ✓ |
| Named operator list | Configurable list of operator names | |
| Free-text owner | Type any name/handle | |

**User's choice:** Just you (assign to me)

## Incident Tracking — Snooze durations

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed presets (1h/4h/24h) | Three one-tap presets, no picker | ✓ |
| Presets + custom until-time | Presets plus datetime picker | |
| Until next change only | No duration; holds until severity/children change | |

**User's choice:** Fixed presets (1h/4h/24h)

## Incident Tracking — Critical mute behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Snooze hides, banner always shows | Removed from queue but persistent "N snoozed critical" banner | ✓ |
| Critical can't be snoozed | Snooze disabled for critical | |
| Snooze = badge, stays visible | Tagged snoozed, drops priority, stays in list | |

**User's choice:** Snooze hides, banner always shows

## Incident Tracking — Recurrence

| Option | Description | Selected |
|--------|-------------|----------|
| New incident, fresh state | Clean slate each occurrence; ack/owner/snooze reset | ✓ |
| Re-open same incident | Preserve owner + history across recurrences | |

**User's choice:** New incident, fresh state

## Incident Tracking — Ack effect

| Option | Description | Selected |
|--------|-------------|----------|
| Stays visible, 'acked' badge, sorts lower | Tagged (✓+owner+time), drops below un-acked, stays in list | ✓ |
| Moves to 'Acknowledged' section/filter | Leaves main queue into separate group | |
| Dims in place | Greyed, same position | |

**User's choice:** Stays visible, 'acked' badge, sorts lower

## Incident Tracking — Escalation while muted

| Option | Description | Selected |
|--------|-------------|----------|
| Breaks through — clears mute, re-surfaces at top | Fresh critical child clears snooze/ack, pushes to top | ✓ |
| Only snooze breaks through; ack persists | Escalation clears snooze but keeps ack | |
| Stays muted; banner count updates | Banner is the only safety net | |

**User's choice:** Breaks through — clears mute, re-surfaces at top

---

## Incident Detail Layout — Blast-radius rendering

| Option | Description | Selected |
|--------|-------------|----------|
| Simple containment tree/diagram | Host root → affected nodes → channels; SVG/CSS, no graph lib | ✓ |
| Layered list (host→svc→node→channel) | Indented list grouped by layer | |
| Force-directed graph | Auto-laid-out nodes+edges; needs new viz lib | |

**User's choice:** Simple containment tree/diagram

## Incident Detail Layout — Why-chain vs timeline

| Option | Description | Selected |
|--------|-------------|----------|
| One causal chain, timestamped | Single vertical chain, each step carries detection time | ✓ |
| Separate why-chain + event timeline | Two distinct elements side-by-side | |

**User's choice:** One causal chain, timestamped

## Incident Detail Layout — Page order

| Option | Description | Selected |
|--------|-------------|----------|
| Status header → AI read → why-chain → blast-radius → children | Action + explanation first | ✓ |
| Blast-radius diagram leads | Visual-first | |
| Child alerts list leads | Raw detail first | |

**User's choice:** Status header → AI read → why-chain → blast-radius → children

## Incident Detail Layout — Child alerts presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped by layer/service, collapsible, deep-linked | Collapsible groups, rows link to source | ✓ |
| Flat severity-sorted list | Worst-first flat list | |
| Flat chronological list | Newest-first stream | |

**User's choice:** Grouped by layer/service, collapsible, deep-linked

---

## AI Layer — Surfacing

| Option | Description | Selected |
|--------|-------------|----------|
| On-demand button | Operator clicks to generate (extends NarrateButton) | ✓ |
| Auto on load | Generates on Incident Detail open | |
| Auto for critical only | Auto for critical, on-demand otherwise | |

**User's choice:** On-demand button

## AI Layer — Tone / verdict

| Option | Description | Selected |
|--------|-------------|----------|
| Urgency verdict + explanation | Act now / Monitor / Informational, then explanation | ✓ |
| Describe, let you judge | No explicit urgency call | |
| Impact path only, no act-now | Dependency chain, no urgency label | |

**User's choice:** Urgency verdict + explanation

## AI Layer — Correlation source (AIX-02)

| Option | Description | Selected |
|--------|-------------|----------|
| AI narrates the deterministic grouping | assembleIncidents groups; AI explains why | ✓ |
| AI derives the correlation | LLM decides causal links (breaks guardrail) | |

**User's choice:** AI narrates the deterministic grouping

## AI Layer — Dismiss persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Session-only | Hides for the visit, returns next load (matches AiBandClient) | ✓ |
| Persisted per-incident | Dismiss stored on the incident record | |

**User's choice:** Session-only

---

## Claude's Discretion

- Route naming/placement for Incident Detail (under `(overview)`).
- New tracking table schema/columns (ack/owner/snooze).
- Exact AI prompt wording and the final urgency-verdict label set (must stay advisory + command-free).

## Deferred Ideas

None raised — discussion stayed within incident lifecycle + AI explanation. The 4 keyword-matched todos (fee-queue / node-detail) were reviewed and left in the backlog (see CONTEXT.md Reviewed Todos).
