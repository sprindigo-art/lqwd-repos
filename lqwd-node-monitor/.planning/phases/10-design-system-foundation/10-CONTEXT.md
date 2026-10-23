# Phase 10: Design-System Foundation - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Lay down ONE canonical "Data-Forward" design-system foundation — a single token
set (color, type scale, spacing, radius, shadow) plus a shared primitive library
— **extracted from the locked claude.ai/design prototypes**, rendered against by
every v2 screen, with the old NOC-instrument look retired so exactly one theme
ships (DS-01, DS-02, DS-03).

This phase builds the **foundation only**: tokens + primitives + a gallery that
proves them. It does NOT build the actual v2 screens (Ops Center, Nodes, Hosts,
Incident — those are Phases 12–15) and does NOT change the backend.
</domain>

<decisions>
## Implementation Decisions

### Prototype source & token authority (Areas 1 + 2)
- **D-01:** Source-of-truth is the claude.ai/design project **"LQWD Fleet Alert
  Dashboard"** (`372850ad-bbae-46da-a40f-3eb3d03befa0`), accessed **directly by
  Claude via the claude.ai/design integration** — NO manual file drop into
  `.planning/design-explorations/` is needed (the drop-folder workflow is
  superseded for this project).
- **D-02:** Canonical direction is **"Data-Forward"**, specifically
  **`Ops Center - Data-Forward v2.dc.html`** (latest/most-refined, 64 KB) plus the
  per-screen prototypes (`Nodes`, `Node Detail`, `Hosts`, `Host Detail`,
  `Service Detail`, `Incident Detail`) and shared **`support.js`**. The `Editorial`
  and `Triage Board` directions are NOT used.
- **D-03:** The canonical token VALUES are **extracted from the Data-Forward v2
  prototype CSS + `support.js`** during planning/research — the prototype is the
  tiebreaker that resolves the roadmap's drift list (chrome `#13284F` vs `#1A3C79`,
  ok-green `#1E9E63` vs `#1E7A4E`, critical `#E0392B` vs `#D92638`). Do NOT pick
  drift values by hand; read them off the prototype. Constraint preserved: severity
  ramp (critical/warning/watch=teal/healthy) stays structurally separate from brand
  navy; light-only; navy `#1A3C79` anchor; never Bitcoin orange.

### Primitive gallery delivery (Area 3)
- **D-04:** DS-02 ships the primitive gallery as an **in-app Next App Router route
  (`/design-system` or similar)** that renders every shared primitive in all its
  states (default / critical / warning / watch / healthy / stale / loading). **No
  Storybook, no new tooling** — it uses the real components + tokens so it can't
  drift from the app. Matches the project's lean-deps + shadcn/Next convention.

### NOC retirement + transition (Area 4)
- **D-05:** **Additive now, retire per-screen.** Phase 10 adds the new canonical
  tokens + primitives + gallery ALONGSIDE the existing NOC tokens; the v1 screens
  (overview / console / inbox) keep working on NOC until each is replaced by its v2
  rebuild (Phases 12–15). The DS-03 "no mono-instrument tokens" grep/build guard is
  **scoped to NEW v2 surfaces** (the gallery + later v2 screens), per the DS-03 AC
  wording ("no prior mono-instrument token set is still referenced by NEW v2
  surfaces"). The NOC token set is fully DELETED only when the last v1 screen is
  replaced. Do NOT hard-cut the token layer in Phase 10 (would break working v1
  screens before their rebuilds exist).
- **D-06:** The bold-rethink direction **reverses the old NOC "no icons-for-state"
  rule** — modern severity/layer/action icons are now allowed. This supersedes the
  `sketch-findings-nodemonitor` NOC-instrument findings for all v2 work (consistent
  with the v2.0 roadmap decision and the operator's "bold rethink" direction).

### Claude's Discretion
- Exact token file structure (CSS `@theme` variables in `globals.css` vs a
  dedicated tokens file), naming scheme, and the gallery route's internal layout —
  planner/researcher decide, following the extracted prototype + existing
  Tailwind-v4 `@theme` convention.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source-of-truth (claude.ai/design — read via the integration)
- claude.ai/design project `372850ad-bbae-46da-a40f-3eb3d03befa0` ("LQWD Fleet
  Alert Dashboard") — the locked prototypes. Read these files directly:
  - `Ops Center - Data-Forward v2.dc.html` — **canonical** token + grammar source
  - `support.js` — shared tokens/helpers
  - `Nodes.dc.html`, `Node Detail.dc.html`, `Hosts.dc.html`, `Host Detail.dc.html`,
    `Service Detail.dc.html`, `Incident Detail.dc.html` — primitive usage in context
  - `shots/` — screenshots for visual verification

### Roadmap / requirements
- `.planning/ROADMAP.md` §"Phase 10: Design-System Foundation" — goal + 4 success
  criteria (canonical token set, primitive library + gallery, NOC retirement grep,
  honest stale/no-data primitive)
- `.planning/REQUIREMENTS.md` DS-01 / DS-02 / DS-03 — the locked requirements + ACs

### Design briefs (intent / why — local)
- `.planning/DESIGN-BRIEF-02-ops-center-bold-rethink.md` — the bold-rethink prompt
  + guard rails (Linear/Vercel/Stripe quality bar, navy anchor, light-only, AA,
  icons allowed, zero-credential safety cues)
- `.planning/DESIGN-BRIEF-03-node-detail.md`, `.planning/DESIGN-BRIEF-ops-center.md`
- `.planning/design-explorations/README.md` — drop-folder workflow (NOTE: superseded
  by D-01 — direct claude.ai/design access used instead)

### To be superseded (DS-03)
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — NOC-instrument findings;
  explicitly superseded for v2 (D-06). Auto-loads on UI work — planner must treat
  its NOC grammar as retired, not binding.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/globals.css` — current Tailwind v4 `@theme` token block (NOC Light
  theme). The new canonical token set lands here (additive) following the same
  CSS-first `@theme` convention.
- `src/app/layout.tsx` — current font wiring (Saira / IBM Plex Mono / Inter). v2
  pairing is **IBM Plex Sans/Mono** — a font change to make here.
- Existing v1 primitives to learn from (and eventually supersede): `src/components/
  scorecard/*` (GradeBadge, BackendBadge, FreshnessStamp, etc.), `src/components/
  queue/*` (EnqueuePreview), `src/components/insight/*`, `src/components/chrome/*`
  (MastheadNav), `src/components/ui/*` (shadcn).
- `src/lib/format/units.ts` — AFM-002 formatter; primitives must render numerics
  through it (no inline unit math).

### Established Patterns
- Tailwind v4 CSS-first `@theme` (no `tailwind.config.js`); shadcn/ui on React 19;
  Recharts 3.x for the inline evidence chart primitive (DS-02).
- Light-only (`class="dark"` NOT used); navy `#1A3C79` is structural chrome only.

### Integration Points
- New `/design-system` gallery route under `src/app/`.
- The grep/build guard (DS-03) runs against new v2 surfaces to assert no NOC
  mono-instrument tokens leak in.
</code_context>

<specifics>
## Specific Ideas

- Quality bar (from the brief): Linear, Vercel dashboard, Stripe dashboard, Raycast
  — calm, confident, premium, still operator-grade dense. NOT a dense monospace
  instrument panel, NOT a toy/consumer app.
- DS-02 primitive list (from REQUIREMENTS): severity-tinted card/row, inline
  evidence chart (Recharts), two-axis status pip, freshness chip, runbook/command
  modal, AI-read panel, nav rail/shell — all must-have; honest stale/no-data is a
  first-class primitive (DS-01 / never fake freshness).
</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
The phase-10 todo matcher surfaced these on keyword overlap, but they belong to
other phases and were NOT folded into Phase 10:
- `node-detail-all-channels-fee-queue` — **Phase 13** (`resolves_phase: 13`). Node
  Detail will *consume* the Phase-10 primitives, but the feature itself is Phase 13.
- `one-click-enqueue-approve` — **Phase 13** (`resolves_phase: 13`). Queue-flow UX
  change, not design-system foundation.
- `ui-polish-fleet-console` — **Phase 12** (`resolves_phase: 12`).
- `pin-lncli-cron-path-hardening`, `exercise-inbound-fee-a2-lnd8614` — Phase-8
  node-script follow-ups (tooling), unrelated to the design system.

</deferred>

---

*Phase: 10-Design-System Foundation*
*Context gathered: 2026-06-23*
