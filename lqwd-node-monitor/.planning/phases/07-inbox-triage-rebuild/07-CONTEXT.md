# Phase 7: Inbox Triage Rebuild - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Rebuild the `/inbox` recommendation surface from one flat ~531-row scroll into a **triage cockpit** implementing **sketch 005 winner E** (severity spine + collapsible facet rail + slide-in detail/act drawer). On load with the live fleet dataset: critical + warn cards render as individual scannable rows above the fold; routine/`info` (fee) cards collapse into expandable per-signal → per-node count groups; **no card is dropped** and suppressed cards stay visible with their reason verbatim. A collapsible facet rail filters by severity / node / signal / suggested-action with live counts (facets combine to narrow the spine; rail toggles off for full-width). Selecting a card opens an in-page detail drawer with full evidence (metric, observed vs threshold, window, freshness/trend) and the card's action affordance — **without navigating away**. Fee-update groups expose **bulk-enqueue** (per-node "ENQUEUE ALL" and cross-node multi-select) that writes many `update_fee` intents in one gesture through the **existing Phase-6 signed queue**, each re-validated and re-signed **server-side** (the UI never sends a signature), honoring AP-11/AP-12 suppression and per-node rate-limit guidance. The rebuild stays inside the validated NOC Light design language. Requirements: INBOX-01, INBOX-02, INBOX-03, INBOX-04.

**Explicitly NOT this phase:** any new detector or change to the frozen Phase-4 card schema / `loadInsightView` contract (consume verbatim); any new queue action type (`update_fee` only — closes/rebalances stay export-only per Prong 2); the `/queue` approval page itself (already built in Phase 6 — bulk-enqueue lands rows there, it does not re-build it); any node-side execution, HMAC delivery, or real `lncli`/`lncmd` call (Phase 8); the security scan / VM flip (Phase 9). This phase mutates only the existing `nodemon` queue via the existing `enqueueCommand` server action — it holds **zero node credentials** and triggers **zero node mutations**.

</domain>

<decisions>
## Implementation Decisions

### Triage partition rule (INBOX-01)
- **D-01: Severity wins, no exceptions.** Any **critical OR warn** card renders as an individual scannable row above the fold — including a warn-severity fee card (e.g. a "close-candidate"). **Only `info`-severity** cards fold into count groups. This is the clean "no emergency ever hides" rule; warn-severity fee cards are rare enough not to flood the spine. (Supersedes the looser "routine/info (fee)" phrasing in INBOX-01 — the partition driver is **severity**, not signal-type.)
- **D-02: Info bulk nests signal → node, all collapsed on load.** Two levels: per-signal (`Fee raise (303) ▸`) → per-node (`Canada ·118 ▸`). Non-fee `info` signals (e.g. rebalance-success) get their own signal groups the same way. Node-first grouping was rejected (sketch variant C — weak at "show me all X fleet-wide").
- **D-03: Suppressed cards pin to a distinct always-visible block.** A "SUPPRESSED — {reason}" block, never hidden inside a fold, with the reason verbatim (INBOX-01 honesty rule, Phase-4 D-14 fail-loud). Suppressed cards carry null actions → no enqueue affordance.
- **D-04: Row cap is Claude's discretion at build.** Whether to render all ~89 critical+warn as rows or cap a section with a "N more ▸" tail fold is decided by the planner from the live card-count distribution. Constraint: **a critical is never folded.** The facet rail is the primary tool for narrowing a large emergency set.

### Bulk-enqueue model (INBOX-04)
- **D-05: Both affordances.** Each per-node fee group exposes **`ENQUEUE ALL ▸`** (the sketch's hero), AND rows carry checkboxes for **cross-node multi-select** → one batch enqueue. Fast path (whole node) + surgical path (cherry-pick a subset). Bulk-enqueue is scoped to fee-update (`update_fee`) cards only.
- **D-06: Aggregate summary confirm — the batch is the deliberate write act.** Before firing N enqueues, one confirm dialog states scope: "N intents → M nodes, ppm range X–Y, all at engine-suggested values, expires_at +24h." **No per-card param editing in bulk** (engine deterministic values only; nudging a single card stays the existing single-card `EnqueuePreview` flow). Extends Phase-6 D-02 ("confirm is the write act") to batch scale.
- **D-07: Best-effort per-row + tally report.** Each intent enqueues independently server-side; the batch returns "N queued, K skipped" with **each failure's reason verbatim** (e.g. `NO SIGNING SECRET FOR THIS NODE`, lost-race) listed per node/card. Successful rows stay queued — **no all-or-nothing rollback** of good writes (a rollback would also fight the sign-once-per-row design). Reuses the existing `enqueueCommand` error-copy contract.
- **D-08: Rate-limit guidance is surfaced, not enforced, at enqueue.** Per-node rate-limit guidance (Phase-4 D-16) is advisory: show it in the aggregate confirm ("Canada: 118 intents exceed suggested N/window — node will pace these") but **still enqueue all**; the node-side heartbeat (Phase 8) is the real throttle. The queue is a durable buffer; nothing is silently dropped. AP-11/AP-12 suppression is already handled upstream (flagged nodes' cards arrive with null actions → not enqueueable).

### Filter & drawer state (INBOX-02, INBOX-03)
- **D-09: Facet-rail filter-state location is Claude's discretion.** Planner chooses URL-search-params (server re-renders the narrowed spine; shareable/back-button; no 531-card client payload; matches the existing `force-dynamic` server page) vs ephemeral client state, based on the measured serialized card-payload size vs round-trip cost. Live facet counts must stay correct under whichever model. (Recommendation on record: URL params, to keep the heavy card set server-side and filtered views shareable — but explicitly left open.)
- **D-10: Card selection opens a URL-synced client Sheet.** The detail/act drawer is a shadcn `Sheet` (the sketch's slide-in drawer) toggled client-side, with the selected card id reflected in the URL (`?card=ID`) so it is deep-linkable, back-button-closable, and reload-safe. This is the in-page drawer winner E calls for ("without navigating away").
- **D-11: The existing `@modal/inbox/page.tsx` is a no-op guard, not a modal inbox.** It returns `null` purely to stop the `(.)[pubkey]` interceptor from catching the literal "inbox" segment. The URL-synced drawer (`?card=ID`) does **not** conflict with it; the planner keeps the guard as-is (or repurposes it) — there is no second "modal inbox" to supersede.

### Drawer action depth (INBOX-03)
- **D-12: The drawer hosts the FULL action inline, reusing existing client leaves.** One drawer template switches on the card's action type and embeds the real component: **`EnqueuePreview`** (fee → Phase-6 queue), **`CommandExport`** (close/rebalance → Phase-5 export), the **pending runbook** (stuck-pending). The operator acts entirely in the drawer without leaving `/inbox` (INBOX-03 intent). No new action components — wire the verbatim leaves.
- **D-13: Sparkline reuses the existing trend reader with an honest fallback.** Wire the drawer's 14-day trend sparkline to the Phase-3 daily trend-series reader (`src/lib/console/trends.ts`) + `Sparkline` component for the card's metric where a series exists; where a metric has no series, render an honest "no trend data" state rather than a fabricated line. No new query infrastructure.

### Claude's Discretion
- **D-04** — row cap (or none) for the crit/warn spine, from live distribution (never fold a critical).
- **D-09** — filter-state location (URL params vs ephemeral client state) and where facet counts are computed; reconcile with D-10's URL-synced drawer.
- Exact server/client component split for the interactive shell (spine + rail + drawer), the collapse/expand and multi-select interaction state, the aggregate-confirm dialog layout, and the per-result tally rendering — driven through the binding design skills, reusing Phase-5/6 expand grammar.
- Whether to extend `enqueueCommand` with a batch server action or loop the existing single action server-side (honor sign-once-per-row, server-only signing, per-row independent failure).
- Per-metric mapping of which evidence series feeds the sparkline (D-13 fallback covers the gaps).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Paths relative to the project root; `../` points into the parent `ClaudeCode/` workspace.

### Project planning (in-repo)
- `.planning/REQUIREMENTS.md` — INBOX-01..INBOX-04 acceptance criteria (verbatim partition, facet, drawer, bulk-enqueue expectations)
- `.planning/ROADMAP.md` §"Phase 7: Inbox Triage Rebuild" — goal + 5 success criteria
- `.planning/phases/06-command-queue-approval-ui-prong-1/06-CONTEXT.md` — the enqueue/sign-once/server-side-recompute decisions this phase's bulk path extends (D-01..D-04, D-12 secret freeze)
- `.planning/phases/04-insight-engine/04-CONTEXT.md` — frozen card-schema contract this phase consumes verbatim; INSIGHT-06 suppression (null action on flagged nodes); D-16 rate-limit guidance

### Design / UI (binding — read before any UI work)
- `.claude/skills/sketch-findings-nodemonitor/references/inbox-triage-layout.md` — **winner E** spec: severity spine + facet rail + drawer, the CSS patterns (`.sectionbar`, `.chip`, `.act`, `.fold`, `.syn`, `.drawer`), HTML structures, and the "What to Avoid" list (flat list, severity-behind-a-click, always-on 3-col, node-only grouping, action-first default)
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — NOC Light theme: severity color is state-only, navy is structure/act-only, mono data, no icons-for-state, tight radii
- `.claude/skills/sketch-findings-nodemonitor/sources/005-inbox-triage.html` — the interactive sketch; the ★ tab is winner E (open in a browser for full reference)
- `.claude/skills/frontend-design/SKILL.md` — mandatory design guidance for all UI work

### Insight cards & current inbox (in-repo, binding — consume, don't mutate)
- `src/lib/insight/engine.ts` — `loadInsightView()`: the entire data path (one engine, two views); returns pre-ranked cards verbatim. The rebuild re-shapes presentation, not ranking
- `src/lib/insight/types.ts` + `src/lib/insight/schema.ts` — frozen card / `update_fee` action types and param schema (the bulk-enqueue source of truth)
- `src/lib/insight/guardrails.ts` — AP-11/AP-12 suppression + `WRITE_ACTION_TYPES`; suppressed cards carry null actions
- `src/app/(overview)/inbox/page.tsx` — the page being rebuilt (currently Server Component → `InsightCardList`)
- `src/components/insight/InsightCardList.tsx` + `InsightCardRow.tsx` — the current severity-sectioned flat list the rebuild replaces with spine + groups + drawer
- `src/app/(overview)/@modal/inbox/page.tsx` — the no-op `null` interceptor guard (D-11) — not a modal inbox

### Queue write path (in-repo, binding)
- `src/app/actions/queue.ts` — `enqueueCommand` server action: re-validates params + signs server-side, client never sends a signature (the contract the batch path reuses/extends, D-07)
- `src/lib/queue/enqueue.ts` + `src/lib/queue/bounds.ts` + `src/lib/queue/sign.ts` — server-only enqueue/bounds/signer the action lazy-imports
- `src/components/queue/EnqueuePreview.tsx` — the single-card preview/confirm leaf embedded in the drawer for fee cards (D-12)

### Reusable action surfaces + evidence (in-repo, binding)
- `src/components/export/CommandExport.tsx` — Phase-5 export leaf embedded in the drawer for close/rebalance cards (D-12)
- `src/lib/console/trends.ts` — Phase-3 daily trend-series reader feeding the drawer sparkline (D-13)
- `src/components/console/Sparkline.tsx` — the existing sparkline component (D-13)
- `src/components/scorecard/FreshnessStamp.tsx` — freshness rendering reused in header/drawer evidence
- `src/lib/format/units.ts` — AFM-002 formatter for every ppm/sat/msat value in groups, drawer, and confirm dialog
- `src/components/ui/` — vendored shadcn primitives present: `badge`, `button`, `card`, `checkbox`, `dialog`, `table`, `tooltip`. **Sheet** (drawer) and collapsible **Sidebar** (facet rail) are NOT yet vendored — add via `npx shadcn@latest`

### Crypto / signing reference (binding)
- `../CLAUDE.md` (NodeMonitor section) §4 "HMAC command signing" + §5 (LLM/UI never produces signed params) — the batch path still signs once per row server-side over the canonical form; the UI never sends a signature

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`loadInsightView()`** — the complete, pre-ranked data path; the rebuild changes presentation only (partition into spine + collapsed groups + suppressed block), never ranking or detection
- **`enqueueCommand` server action** — already does server-side re-validate + sign-once; bulk-enqueue either loops it server-side or adds a sibling batch action honoring the same guarantees (D-07)
- **`EnqueuePreview` / `CommandExport` client leaves** — embedded verbatim inside the drawer per card type (D-12) — no new action components
- **Phase-3 trend reader + `Sparkline`** (`src/lib/console/trends.ts`, `src/components/console/Sparkline.tsx`) — the drawer's 14-day trend, with honest fallback where no series exists (D-13)
- **AFM-002 `units.ts`** — all numeric rendering (no ad-hoc conversions)

### Established Patterns
- Server Component computes; thin `"use client"` leaves own interaction state (expand/confirm/checkbox) — same split as Phase 5/6; the new spine/rail/drawer shell follows it
- One component, both surfaces (Phase-4 D-08 / Phase-5 D-01) — the card action leaves already work on `/inbox` and the console; the drawer reuses them, not forks
- Honest visible states (Phase-2 D-01, Phase-4 D-14): suppressed cards and missing-trend states render the truth, never hidden or faked
- `force-dynamic` live warehouse read at request time — the page already re-reads every load (relevant to the D-09 URL-params option)

### Integration Points
- Spine/groups/drawer all read `loadInsightView()` output; the facet rail filters that set (server- or client-side per D-09)
- Bulk-enqueue writes `pending_approval` rows that surface on the existing `/queue` page (Phase 6) — this phase produces the rows, Phase 6 approves them
- Drawer `?card=ID` URL sync coexists with the `@modal/inbox` no-op interceptor guard (D-11)
- Sheet + collapsible Sidebar shadcn primitives must be added (not yet vendored)

</code_context>

<specifics>
## Specific Ideas

- The partition driver is **severity**, stated explicitly (D-01) to resolve INBOX-01's "routine/info (fee)" conflation — a warn-severity fee card is an above-fold row, not bulk.
- Suppressed cards get a **dedicated always-visible block** (D-03), not an inline fold — the operator must never click to discover a suppressed emergency.
- Bulk-enqueue is **best-effort with a verbatim per-row failure tally** (D-07) — "every sat accounted for" extends to "every skipped intent named with its reason."
- Rate-limit guidance **warns but does not block** at enqueue (D-08) — the queue is a durable buffer; the node paces execution.
- The drawer is the **act surface**, not a read-only detail pane — full `EnqueuePreview`/`CommandExport`/runbook inline (D-12).

</specifics>

<deferred>
## Deferred Ideas

- **Bulk actions for non-fee cards** (e.g. multi-select export of several stuck-pending runbooks) — bulk is scoped to `update_fee` this phase (INBOX-04). A future batch-export lens could extend multi-select to export cards.
- **Saved / named facet filter presets** — shareable URL filters (if D-09 lands on URL params) give most of the value; named presets are a later nicety, not in scope.
- **Per-card param editing within a bulk batch** — explicitly rejected for v1 (D-06); the single-card `EnqueuePreview` covers nudging one value. Revisit only if operators ask to tune a whole node's batch off-engine.

None of the above are in scope for Phase 7.

</deferred>

---

*Phase: 7-Inbox Triage Rebuild*
*Context gathered: 2026-06-16*
