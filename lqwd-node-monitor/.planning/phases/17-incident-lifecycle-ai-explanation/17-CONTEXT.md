# Phase 17: Incident Lifecycle + AI Explanation - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the **Incident Detail view** (INC-01), **incident tracking lifecycle** — acknowledge / assign / snooze, tracking-only, never touching the fleet (INC-02) — and the **AI explanation layer**: a plain-language log/error read (AIX-01) and cross-layer correlation narration (AIX-02).

Builds directly on Phase 12's deterministic incident spine (`src/lib/overview/incidents.ts` `assembleIncidents`, host-keyed root-cause tree) and Phase 16's enriched log/error data. **Not in scope:** changing the deterministic grouping engine, any fleet write path, node/fee-queue UI (that's Phase 13 / backlog).
</domain>

<decisions>
## Implementation Decisions

### Incident tracking (INC-02)
- **D-01:** Incidents are keyed **one-per-host** (inherited from Phase 12 D-01 — `assembleIncidents` already nests every host-attached failure under that host's single incident). Tracking state (ack / owner / snooze) attaches to a **new `nodemon` table** keyed by that stable incident identity. This is the ONLY new write surface and it is tracking-only — it NEVER touches the fleet (INC-02 zero-write-path invariant).
- **D-02:** Assignee model = **solo "assign to me" / unassign** toggle (single operator id). No named list, no free-text. (Data model may leave room to grow, but the UI is a single-operator toggle.)
- **D-03:** Snooze durations = **fixed presets 1h / 4h / 24h**. No custom time picker.
- **D-04:** "A critical incident cannot be silently muted" = snoozing a critical **removes it from the main queue BUT a persistent, always-visible "N snoozed critical" banner shows fleet-wide**. Snooze declutters; it never fully hides a critical.
- **D-05:** **Acknowledge ≠ snooze.** Ack tags the incident (✓ + owner + time) and **sorts it lower but keeps it visible** in the queue. Ack never hides.
- **D-06:** **Escalation breaks through mute.** If an already acked or snoozed incident gains a NEW critical child (severity escalates while muted), the mute (snooze AND ack) **clears and the incident re-surfaces at the top as critical**. Strongest reading of the "never silently muted" rule.
- **D-07:** **Recurrence = new incident.** When an acked/snoozed host incident fully resolves and that host later fails again, it is a **brand-new incident with fresh state** (ack / owner / snooze reset) — not a re-open.

### Incident Detail layout (INC-01)
- **D-08:** Blast-radius (one host → affected nodes/channels) renders as a **simple containment tree / diagram** — host at the root, lines down to affected nodes → channels/HTLCs. SVG/CSS only; **no new graph/network viz lib** (stays within the Recharts-only stack).
- **D-09:** Root-cause why-chain and detection timeline are **ONE element**: a single vertical **timestamped causal chain** (root cause → downstream effect → impact, each step carrying its detection time). The chain is the timeline.
- **D-10:** Page order (above the fold first): **status header (severity / host / status / owner + ack/snooze actions) → AI read → why-chain → blast-radius diagram → grouped child alerts.** Action + explanation lead.
- **D-11:** Child alerts are **grouped by layer/service, collapsible**, each row **deep-linked to its source** (node / service / log event) — mirrors the host→service containment tree.

### AI explanation layer (AIX-01 / AIX-02)
- **D-12:** AI log/error read surfaces **on-demand via a button** (extends the existing `NarrateButton` / `narrate.ts` pattern). Deterministic cards stand alone; the AI is opt-in per incident. Preserves the Phase-12 cost-controlled, deterministic-first posture.
- **D-13:** Tone = **urgency verdict + explanation** — leads with an advisory verdict (**Act now / Monitor / Informational**), then explains what the pattern means and the dependency/impact path. Advisory only; **never emits a runnable command** (guardrail).
- **D-14:** AIX-02 cross-layer correlation = **AI narrates the deterministic grouping**. `assembleIncidents` already derives host→node→channel/HTLC grouping; the AI explains WHY in plain language. The AI **never derives the correlation itself** — the deterministic layer stays the source of truth (Phase-12 `guardrails.ts` boundary). Same rationale is shown on the overview AND incident detail.
- **D-15:** The AI read is **dismissible session-only** (hides for the visit, returns on next load) — matches Phase-12's session-scoped `AiBandClient` dismiss; no persisted dismiss state.

### Claude's Discretion
- Route naming/placement for the Incident Detail page (under the `(overview)` group), the new tracking table's exact schema/columns, and the exact AI prompt wording are left to research + planning.
- The precise urgency-verdict label set (Act now / Monitor / Informational vs a refinement) may be adjusted at implementation as long as it stays advisory and command-free.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — INC-01, INC-02, AIX-01, AIX-02 (full requirement text + acceptance)
- `.planning/ROADMAP.md` — Phase 17 goal, dependencies (fed by Phase 15/16 data), sequencing

### Deterministic incident spine (Phase 12 — the source of truth AI narrates)
- `src/lib/overview/incidents.ts` — `assembleIncidents`: host-keyed root-cause tree, `worstSeverity`, engine-order-is-law, stale-flag handling (D-01/D-02/D-08). Incident identity + grouping originate here.
- `src/lib/overview/ai-band.ts` — `buildBandLines` / `buildCalmState`: deterministic advisory `AiReadLine[]` (no `action` field by construction), the existing overview AI-band precedent for AIX-02 rationale.
- `src/lib/insight/guardrails.ts` (+ `guardrails.test.ts`) — the AI-never-emits-commands boundary; the band/read must pass this. NON-NEGOTIABLE for AIX-01/02.
- `src/lib/overview/severity-map.ts` — df severity boundary (insight→df, worstSeverity, stale bucket) used for incident severity + escalation logic (D-06).

### Existing AI narrate path (extend for AIX-01)
- `src/app/actions/narrate.ts` — server action, `getModel()` → `generateText`, server-recomputes (AI never produces params). The on-demand read (D-12) extends this.
- `src/components/insight/NarrateButton.tsx` — the on-demand trigger UI precedent.
- `src/lib/ai/provider.ts` (+ `provider.test.ts`) — `getModel()` / `AI_MODEL` override.
- `src/components/**/AiBandClient*` (Phase 12) — session-scoped dismiss precedent for D-15.

### Enriched signal source (Phase 16 — what AIX-01 reads)
- `.planning/phases/16-collector-enrichment-robust-log-capture/16-SUMMARY.md` files + `src/lib/read/service-log-events.ts` — the log/error events, `category` taxonomy, and `log_patterns` aggregate the AI read explains.
- `src/lib/db/schema/nodemon.ts` — `service_log_events`, `log_patterns`, `log_patterns_config`, `service_inventory` (the read-model the incident tree + AI read consume; new tracking table lands here too).

### Design system
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — validated df patterns, CSS, visual direction. Load before any UI implementation (Incident Detail, blast-radius diagram, banner).
- Data-Forward df primitives, light-only, navy `#1A3C79` brand (locked, Phase 10/12).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `assembleIncidents` (`src/lib/overview/incidents.ts`): already produces the host-keyed incident tree with child grouping — Incident Detail (INC-01) reads a single incident out of this; do NOT rebuild grouping.
- `narrate.ts` + `NarrateButton.tsx`: the on-demand AI action + trigger — extend for the AIX-01 read (server-recompute, advisory-only).
- `ai-band.ts` + `guardrails.ts`: the advisory-line shape + safety boundary — the AIX-02 rationale reuses this contract (no `action` field).
- df primitives (severity-tinted card/row, freshness chip, AI-read panel, nav shell) from Phase 10/12 — the Incident Detail composes these.

### Established Patterns
- **Deterministic-first / AI-narrates-only** (Phase 12 guardrail): the LLM never derives grouping or emits commands. D-14 and D-13 are bound by this.
- **One-incident-per-host** (Phase 12 D-01): fixes incident identity (D-01) → tracking state keys off host.
- **Session-scoped dismiss** (AiBandClient): D-15 mirrors it.
- **Zero-write-path to the fleet** (project invariant): INC-02 tracking table is the only new write, and it writes ONLY incident metadata.

### Integration Points
- New Incident Detail route under `src/app/(overview)/` (sibling to nodes/hosts/`[pubkey]`).
- New `nodemon` tracking table (ack/owner/snooze) + Drizzle schema in `src/lib/db/schema/nodemon.ts` (migrate ONLY the nodemon DB, never warehouses).
- Overview (Phase 12 `(overview)/page.tsx`) gains ack/snooze-aware queue behavior (D-04/D-05/D-06 banner + sort) — extend, do not rebuild.
</code_context>

<specifics>
## Specific Ideas

- Urgency verdict vocabulary the operator liked: **Act now / Monitor / Informational** (advisory labels, D-13).
- Persistent **"N snoozed critical" banner** as the honesty mechanism for muted criticals (D-04).
- Blast-radius as a **containment tree** ("what this host takes down"), not a force-directed graph (D-08).
</specifics>

<deferred>
## Deferred Ideas

None raised during discussion — scope stayed within incident lifecycle + AI explanation.

### Reviewed Todos (not folded)
The `todo.match-phase 17` keyword matches were all **fee-queue / node-detail** scope, not incident lifecycle — reviewed and left in the backlog:
- `2026-06-23-node-detail-all-channels-fee-queue.md` — Node Detail all-channels + per-channel fee queue → Phase 13 / node-detail domain.
- `2026-06-23-one-click-enqueue-approve.md` — fee-queue prompt friction → fee-queue domain.
- `ui-polish-fleet-console.md` — general console UI polish → not incident-specific.
- `2026-06-23-exercise-inbound-fee-a2-lnd8614.md` — inbound-fee tooling verification → Phase-8 fee tooling.
</deferred>

---

*Phase: 17-incident-lifecycle-ai-explanation*
*Context gathered: 2026-07-19*
