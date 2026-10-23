# Phase 4: Insight Engine - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn warehouse rows into **deterministic, severity-ranked recommendation cards** `{severity, node, target, signal, evidence, suggested_action, params}` whose schema is **frozen as a hard contract** before Phase 5 (export) or Phase 6 (signed queue) consume it. Detectors: AP-11 close-storm (≥50 self-closes/hr), AP-12a connection-exhaustion, AP-12b serialization-storm, force-close HTLC-timeout signature, fee signals (raise/lower/close-candidate), rebalance-success, fee-crash/earnings-step-down, fleet-wide temporal close-cluster correlation, and the stuck-pending detector (PENDING-02: force-close-past-maturity, stuck-sweep, stuck-open). Cards surface in one fleet-wide severity-ranked triage inbox. The engine self-guards: write recommendations suppressed for AP-11/AP-12-flagged nodes, fee hysteresis, per-node write rate-limit guidance. Optional LLM narrative is off by default, narrates only, never produces or alters numeric params. Requirements: INSIGHT-01..07, PENDING-02.

**Explicitly NOT this phase:** exported commands/runbooks (EXPORT-01, PENDING-03 — Phase 5), any queue/write path (Phase 6+), scheduled/cron card refresh (v2 deferred — compute is on-demand at load), log ingestion for the missing AP-12 data sources.

**Sequencing note:** Phase 3 was incomplete at discussion time (03-15/03-16 unexecuted, operator visual gate unresolved). Phase 4 planning may proceed; execution should wait for Phase 3 closure since the console Active Signals panel (03-14/03-15) is an integration surface here.

</domain>

<decisions>
## Implementation Decisions

### Card schema & freeze mechanics (INSIGHT-01)
- **D-01:** **Severity reuses the scorecard taxonomy: `critical | warn | info`** — same Tier-1 ("page") vs Tier-2/3 line as `SCORECARD_CONFIG.tier1` (Phase 2 D-07/D-08). No second severity taxonomy. UI reuses the existing severity-tinted chips (sketch findings).
- **D-02:** **Freeze = versioned TS type (`schemaVersion` field) + zod runtime validator + a contract test** that fails on any shape change. Phases 5 and 6 import the SAME zod schema — it is the contract artifact.
- **D-03:** **`suggested_action` + `params` are a discriminated union per action type** (e.g. `update_fee` / `close_channel` / `rebalance` / `remediate_pending` / `investigate` — exact enum at planner's discretion). Each action type carries its own typed params object. Rationale: Phase 6 signs `canonical(params)` — loose typing here would leak into the signing surface.
- **D-04:** **Evidence is structured**: metric name, observed value, threshold breached, window, plus a **deep-link URL into the relevant console tab** (Phase 3 D-03 stable URLs). The inbox sorts/filters on it; the LLM narrates from it.

### Triage inbox (INSIGHT-03)
- **D-05:** **New dedicated inbox page** (e.g. `/inbox` or `/insights` — route name at planner's discretion). The Phase-3 Attention Queue stays a scorecard-breach feed; the inbox is the recommendation-card surface. Clean separation: grades vs recommendations. (Fleet-page entry strip was offered; operator chose the dedicated page only.)
- **D-06:** **Ranking: severity first (critical → warn → info); within a severity band, stuck-pending cards rank by limbo balance at risk** (PENDING-02 AC), others by evidence magnitude. Deterministic, no tuning knob.
- **D-07:** **Cards are stateless** — pure functions of warehouse state, recomputed each load, disappearing when the condition clears. No ack/dismiss persistence, no nodemon writes this phase (queue DB belongs to Phase 6).
- **D-08:** **Cards also surface per-node in the console's Active Signals panel** (03-14): inbox = fleet-wide view, console = per-node view of the same cards.

### Detector definitions & data gaps (INSIGHT-02/04/05, PENDING-02)
- **D-09:** **Fee-crash / earnings-step-down algorithm is researcher-derived from the France PPM-crash reference data in `lqwdLogs`** (drop %, window, baseline definition). Starting values land in the detector config as tunable knobs (resolves the STATE.md blocker).
- **D-10:** **Fleet temporal-correlation (close-cluster) rule is derived from the 2024-09-09 cascade signature** reconstructed from warehouse close data — ≥N nodes with self-closes in the same hour; N + window are config knobs (resolves the STATE.md blocker).
- **D-11:** **AP-12a/b LLM fallback:** if research confirms no warehouse data source for connection-exhaustion / serialization-storm, the engine leans on the **LLM to make the most educated inference — clearly labeled** that no warehouse data is present and this is an LLM suggestion. Constraints (D-12) keep it inside the INSIGHT-02/07 determinism rules.
- **D-12:** **LLM-inferred AP-12 cards are advisory-only:** severity `info`, **NO `suggested_action` params** (investigate-only), labeled "LLM inference — no warehouse data", **never trigger guardrail suppression** and never feed Phases 5/6. Deterministic detectors remain the only param producers. Gated behind the **same off-by-default LLM toggle** as the narrative — when LLM is off, AP-12 shows an honest "no data — needs log ingestion" placeholder (Phase 2 D-01 pattern).
- **D-13:** **Detector thresholds live in a separate insight-engine config module** (NOT folded into `SCORECARD_CONFIG`): step-down %, cluster N/window, stuck-pending windows, hysteresis knobs. Per-backend where relevant, same tunable-starting-values-not-contract philosophy as Phase 2 D-02. NOTE: where a detector grades the same metric the scorecard grades (e.g. AP-11 close-storm Tier-1), it must READ the existing `SCORECARD_CONFIG` band rather than duplicate the number — the separate file holds detector-ONLY knobs, not a fork of scorecard bands (honors the "do not fork a second threshold table" comment in `config.ts`).

### Guardrails & LLM narrative (INSIGHT-06/07)
- **D-14:** **Suppression is visible:** when a node is flagged AP-11/AP-12 (deterministic flags only, per D-12), write-recommendation cards still render with a **SUPPRESSED state + reason** ("node flagged AP-11 — write recommendations withheld"), params withheld/disabled. Operator sees WHY nothing is recommended — fail-loud ethos.
- **D-15:** **Fee hysteresis = min-delta + min-interval, both config knobs:** a fee card fires only when the suggested change exceeds a minimum delta AND a minimum interval has passed since the last direction change. Card evidence shows the hysteresis state.
- **D-16:** **Per-node write rate-limit is guidance text on cards** (suggested-writes-this-window counter); hard enforcement lands in Phase 6 (queue) / Phase 7 (node-side). This phase has no write path to limit.
- **D-17:** **LLM narrative triggers at BOTH levels:** an inbox-level button narrating the flagged card set fleet-wide, AND per-node narration (console/card level). Server-side via the `getModel()` pattern, rendered clearly marked as LLM output, off by default (INSIGHT-07).

### Claude's Discretion
- Exact action-type enum membership and per-action param field names (must cover update_fee, close, rebalance, pending-remediation, investigate semantics needed by Phases 5/6).
- Card identity/dedupe key design (stable enough for the console/inbox to render the same card consistently within a load).
- Inbox route name, layout, grouping presentation, empty state, freshness stamp placement — driven through the design skills (sketch-findings-nodemonitor + frontend-design are binding for all UI).
- Engine module layout (detector-per-module mirroring the dimension-module pattern is the natural shape).
- Stuck-pending thresholds (maturity windows, broadcast_attempts line, aged-open window) — researcher proposes from `_library` guidance; config knobs.
- HTLC-timeout signature and rebalance-success signal mechanics — researcher maps from warehouse columns honoring AFM-001/002.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Paths relative to the project root; `../` points into the parent `ClaudeCode/` workspace.

### Project planning (in-repo)
- `.planning/REQUIREMENTS.md` — INSIGHT-01..07 + PENDING-02 acceptance criteria
- `.planning/ROADMAP.md` §"Phase 4" — goal + success criteria (schema frozen before Phases 5/6 consume)
- `.planning/phases/02-fleet-overview-health-scorecard/02-CONTEXT.md` — severity taxonomy (D-07/D-08), tunable-config philosophy (D-02), backend map (D-03/D-04), MAD comparison
- `.planning/phases/03-per-node-console-pending-monitor/03-CONTEXT.md` — stable tab URLs (D-03) the evidence deep-links target; pending display (D-13) the stuck detector judges; window presets

### Detector thresholds & anti-pattern definitions (parent workspace — starting reference, not contract)
- `../lqwdLogs/_library/operational-anti-patterns.md` — AP-11 close-storm (≥50/hr), AP-12a/AP-12b definitions — the detector signatures
- `../lqwdLogs/_library/cross-node-monitoring-matrix.md` — Tier-1/2/3 severity taxonomy; fee-PPM-crash critical thresholds (D-09 input)
- `../lqwdLogs/_library/healthy-range-bands.md` — per-subsystem bands feeding fee raise/lower/close-candidate signals
- `../lqwdLogs/_library/data-gap-inventory.md` — which AP-12 signals are NOT in the warehouse (D-11/D-12 trigger)
- `../lqwdLogs/_library/analytical-failure-modes.md` — AFM-001/AFM-002; every detector query must honor them
- France PPM-crash reference data in `../lqwdLogs/france/` — D-09 derivation source
- 2024-09-09 cascade (reconstruct from warehouse close data; check `../lqwdLogs/_library/` docs for the incident write-up) — D-10 derivation source

### Design / UI (binding)
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — NOC Light theme, no emoji/dots/icons for state, severity-tinted chips, plain uppercase mono breach text — binding for the inbox + card UI
- `.claude/skills/frontend-design/SKILL.md` — mandatory design guidance for all UI work (Phase 3 D-15 carries forward)

### Data layer & code contracts (in-repo)
- `src/lib/scorecard/config.ts` — `SCORECARD_CONFIG`: the engine READS these same bands where it grades scorecard metrics (D-13); contains the "do not fork a second threshold table" contract comment
- `src/lib/scorecard/types.ts` + `src/lib/scorecard/grade.ts` — Tier-1 evaluation semantics the card severity mapping reuses (D-01)
- `src/lib/read/latest.ts` + `src/lib/read/node-info.ts` — sanctioned AFM-001 latest-state readers
- `src/lib/read/pending.ts` — pending-channel/sweep readers the stuck-pending detector consumes
- `src/lib/console/trends.ts` — daily trend series (03-11) usable for step-down baselines and evidence sparklines
- `src/lib/read/db-timestamp.ts` — `parseDbTimestampUtc` MUST wrap raw-execute timestamp coercion
- `src/lib/format/units.ts` — AFM-002 formatter for every sat/BTC/fee value on cards
- `src/lib/config/backends.ts` — pubkey → backend map (per-backend detector knobs key off it)
- `CLAUDE.md` §Stack — `getModel()` / Vercel AI SDK pattern for the narrative (D-17)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Dimension-module pattern** (`src/lib/scorecard/dimensions/*`): exported SQL builder (no-DB shape tests via PgDialect) + lazy-import executor — detectors should mirror it one-module-per-detector
- **`gradeDimension`/Tier-1 machinery** (`src/lib/scorecard/grade.ts`): the critical/warn line cards map severity from
- **Force-close dimension** already computes `maxHourlySelfCloses` (the AP-11 metric) — the close-storm detector builds on it
- **Pending readers + trend series** (`src/lib/read/pending.ts`, `src/lib/console/trends.ts`): the stuck-pending and step-down detectors' data sources
- **Severity-tinted chip + signal components** (03-12/03-14): GradeBadge severity chips, Active Signals panel — card UI reuses, does not reinvent
- **`loadFleetView()`** (`src/lib/scorecard/fleet.ts`): per-node flag state (AP-11 Tier-1) the suppression guardrail reads

### Established Patterns
- Tunable config over magic numbers; per-backend keys; starting-values-not-contract (Phase 2 D-02)
- Server-only DB modules; Server Components fetch, thin `"use client"` leaves render
- AFM-001 `DISTINCT ON` for event-driven tables; AFM-002 formatter for all units; `parseDbTimestampUtc` for raw timestamps
- Worktree-parallel plan execution with files_modified isolation

### Integration Points
- New inbox page in `src/app/(overview)/` — joins fleet/pending as a sibling surface
- Console Active Signals panel (03-14/03-15) — gains per-node insight cards (D-08); NOTE 03-15 unexecuted at discussion time
- Evidence deep-links target the Phase 3 console tab URLs
- Frozen card schema module + zod contract — the import surface Phases 5/6 build against

</code_context>

<specifics>
## Specific Ideas

- Operator's AP-12 directive (near-verbatim): "if no data available lean on LLM to make most educated assumption but with note that no clear data present and it is LLM suggestion" — bounded by D-12 (advisory-only, no params, behind the LLM toggle).
- Suppressed cards must say WHY ("node flagged AP-11 — write recommendations withheld") — same honesty bar as Phase 2's "no data" states.
- Inbox and console show the SAME cards (one engine, two views) — no separate per-surface computation.

</specifics>

<deferred>
## Deferred Ideas

- **Fleet-page inbox entry strip / top-N card preview** — operator chose the dedicated page only; a fleet-page entry (mirroring the PENDING-count pattern) can be added later if pivoting proves annoying
- **Persisted ack/snooze/dismiss card state** — needs nodemon writes; revisit at/after Phase 6 when the queue DB exists
- **Hard per-node write rate-limit enforcement** — Phase 6 (queue) / Phase 7 (node-side); this phase ships guidance only
- **Real AP-12a/b detectors from log ingestion** — when log/pg_stat ingestion lands, the LLM fallback (D-11/D-12) retires in favor of deterministic detectors
- **Scheduled/cron card refresh** — explicitly v2 (REQUIREMENTS); v1 computes on-demand

### Reviewed Todos (not folded)
- `ui-polish-fleet-console.md` — matched on weak keywords; already folded into Phase 3 (03-CONTEXT D-04/D-14/D-15) and owned by gap-closure plans 03-10…03-16. Not Phase 4 scope.

</deferred>

---

*Phase: 4-Insight Engine*
*Context gathered: 2026-06-11*
