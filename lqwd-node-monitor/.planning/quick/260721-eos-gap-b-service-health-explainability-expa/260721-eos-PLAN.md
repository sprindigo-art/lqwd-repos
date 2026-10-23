---
phase: quick-260721-eos
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/read/service-health.ts
  - src/lib/read/service-health.test.ts
  - src/components/df/ServiceWhyAccordion.tsx
  - src/components/df/ServiceWhyAccordion.test.tsx
  - src/components/node/ServiceHealthGrid.tsx
  - src/components/node/NodeSupportingServices.tsx
  - src/components/host/HostCard.tsx
  - src/components/host/OnHostNodes.tsx
  - src/app/(overview)/hosts/page.tsx
  - src/app/(overview)/hosts/[hostId]/page.tsx
autonomous: true
requirements: [GAP-B]
must_haves:
  truths:
    - "A not-green service row can be expanded to show WHY it is not-functioning/critical instead of a bare X"
    - "When the probe supplies a detail string, the expanded panel shows that reason verbatim"
    - "When detail is NULL (the live LND fleet state), the panel renders an honest fallback plus error_count and last-success age — never a fabricated reason"
    - "last_success_at NULL renders as 'never', not a fake timestamp"
    - "Green/healthy rows are visually unchanged (no accordion affordance)"
  artifacts:
    - path: "src/lib/read/service-health.ts"
      provides: "ServiceHealthState carries detail + detectionMethod, populated in BOTH derivation branches"
      contains: "detail"
    - path: "src/components/df/ServiceWhyAccordion.tsx"
      provides: "Client expandable accordion rendering the honest why-panel for a not-green service row"
      contains: "use client"
    - path: "src/components/df/ServiceWhyAccordion.test.tsx"
      provides: "Render-test proving detail-present, detail-null-fallback, and never-last-success paths"
  key_links:
    - from: "src/components/node/ServiceHealthGrid.tsx"
      to: "ServiceWhyAccordion"
      via: "wraps each not-green TwoAxisPip tile"
      pattern: "ServiceWhyAccordion"
    - from: "src/lib/read/service-health.ts deriveServiceHealth"
      to: "ServiceHealthState.detail"
      via: "row.detail flows through both return branches"
      pattern: "detail: row.detail"
---

<objective>
Close Gap B — service-health explainability. Today a not-functioning/critical service
renders a bare X with no reason because `deriveServiceHealth` OMITS the `detail` and
`detection_method` columns it already SELECTs. Fix the read layer to carry those fields,
build an EXPANDABLE ACCORDION (locked operator decision — not a tooltip, not an
always-visible inline line) that reveals WHY a service is down, and wire it into the
per-service chip surfaces.

The live LND fleet reports running=true / functioning=false with `detail=NULL` and
`last_success_at=NULL`, so the "why" panel MUST render HONESTLY when detail is null —
an honest fallback plus the real error_count and last-success age, never a fabricated reason.

Purpose: an operator can see WHY a service is critical without leaving the fleet/host view.
Output: read-layer fields + a reusable `ServiceWhyAccordion` client component, wired additively.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/read/service-health.ts
@src/lib/read/service-health.test.ts
@src/components/df/TwoAxisPip.tsx
@src/components/df/TwoAxisPip.test.tsx
@src/components/node/ServiceHealthGrid.tsx
@src/components/node/NodeSupportingServices.tsx
@src/components/host/HostCard.tsx
@src/components/host/OnHostNodes.tsx

<interfaces>
<!-- Executor uses these directly — no codebase exploration needed. -->

ServiceHealthRow (src/lib/read/service-health.ts) ALREADY SELECTs and carries:
  detection_method: string | null   // service_inventory side — ALWAYS present
  detail: string | null             // service_health side — NULL for the live LND fleet
  error_count: number | null
  last_success_at: Date | string | null

ServiceHealthState (src/lib/read/service-health.ts) — the gap: it carries
  running, functioning, green, stale, collectorStale, noData,
  lastSuccessAt, lastArtifactMtime, collectedAt, errorCount, expectedIntervalSeconds
  …but OMITS `detail` and `detectionMethod`. Add both.

Client-component test convention (LOCKED, see NodeFeeEnqueue.test.tsx + TwoAxisPip.test.tsx):
  - DEP-FREE: `renderToStaticMarkup` from "react-dom/server" under vitest environment:"node".
  - NO jsdom / @testing-library.
  - Client components expose a `defaultOpen` prop so the expanded panel renders in
    static markup for assertions. FOLLOW THIS — do not add a testing-library dependency.

Design tokens (df/ NOC light theme — from TwoAxisPip/HostCard, LQWD navy, NO dark mode):
  text: text-df-ink / text-df-muted / text-df-faint
  critical: text-df-critical, bg-df-critical-tint, border-df-critical-border
  neutral inset: bg-df-surface-sub, border-df-border-soft
  brand link: text-df-brand
  mono: font-df-mono ; pills: rounded-df-pill ; cards: rounded-df-card / rounded-[13px]
  Do NOT use Bitcoin orange. Do NOT use icons/dots for STATE (chevron for affordance is fine).

TwoAxisPip is LOCKED (see its header + test suite "TwoAxisPip source is LOCKED").
Do NOT modify TwoAxisPip.tsx — wrap it at the ServiceHealthGrid level instead.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Carry detail + detectionMethod through the read layer (both branches)</name>
  <files>src/lib/read/service-health.ts, src/lib/read/service-health.test.ts</files>
  <behavior>
    - deriveServiceHealth main branch: state.detail === row.detail, state.detectionMethod === row.detection_method.
    - deriveServiceHealth no-data branch (collected_at null): state.detail === row.detail (still surfaced),
      state.detectionMethod === row.detection_method.
    - A row with detail="probe: rpc timeout" + detection_method="systemd" flows both fields through.
    - A row with detail=null (the live LND fleet shape) yields state.detail === null, and existing
      errorCount / lastSuccessAt behavior is UNCHANGED (regression guard).
  </behavior>
  <action>
    In `ServiceHealthState` (src/lib/read/service-health.ts) add two fields:
    `detail: string | null` (probe-supplied reason; NULL for the live LND fleet) and
    `detectionMethod: string | null` (inventory-side detection_method — always present).
    Document both with the existing `/** */` one-line style; note that detail is honestly
    NULL-able and consumers must render an honest fallback (do NOT fabricate a reason).
    Populate BOTH return objects in `deriveServiceHealth`: the no-data branch (collected_at == null)
    AND the main branch. Set `detail: row.detail` and `detectionMethod: row.detection_method` in each —
    no coercion, pass the raw values through (parseDbTimestampUtc etc. do NOT apply to these strings).
    Leave every other field (errorCount, lastSuccessAt, stale, collectorStale, noData…) exactly as-is.
    Extend service-health.test.ts: add cases in the existing
    "deriveServiceHealth two-axis + per-service freshness (no DB)" describe proving both fields
    flow through the main branch (detail present) and the no-data branch (detail present + detection_method present).
    Reuse the existing `row()` factory (it already defaults detail:null, detection_method:null).
  </action>
  <verify>
    <automated>cd /Users/joshuajackson/LQWD/ClaudeCode/lqwd-node-monitor && npx vitest run src/lib/read/service-health.test.ts</automated>
  </verify>
  <done>ServiceHealthState exports detail + detectionMethod; both derivation branches set them; new tests prove both branches carry both fields; existing service-health tests still pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build the ServiceWhyAccordion client component + render-test</name>
  <files>src/components/df/ServiceWhyAccordion.tsx, src/components/df/ServiceWhyAccordion.test.tsx</files>
  <behavior>
    - Props: detail:string|null, detectionMethod:string|null, errorCount:number,
      lastSuccessAt:Date|null, functioningStale:boolean, collectorStale:boolean,
      nowMs:number, children:ReactNode (the trigger row), defaultOpen?:boolean.
    - defaultOpen=true → the why-panel content renders in static markup (test hook, mirrors NodeFeeEnqueue).
    - detail="probe: rpc timeout to lnd" → panel shows that reason verbatim.
    - detail=null → panel shows the honest fallback "Probe reported no reason"
      (NOT a fabricated reason), plus error_count and last-success age.
    - lastSuccessAt=null → last-success age reads "never" (not a fake timestamp / not "0s ago").
    - lastSuccessAt a real Date → humanized "…ago" age string.
    - functioningStale=true → a "functioning-stale" indicator renders; collectorStale=true → a
      "collector-stale" indicator renders; both false → neither.
    - The children (trigger) always render; green/no-data gating is the CALLER's job (Task 3).
  </behavior>
  <action>
    Create `src/components/df/ServiceWhyAccordion.tsx` as a client component — first line `"use client";`.
    Use React `useState(defaultOpen ?? false)` for open state (mirror NodeFeeEnqueue's defaultOpen pattern
    so the render-test can assert expanded markup). Structure: a full-width `<button type="button">`
    trigger that wraps `{children}` and carries an aria-expanded + a lucide `ChevronDown`/`ChevronRight`
    affordance (chevron is an AFFORDANCE, not a STATE icon — allowed); below it a collapsible details panel.
    Render the panel content in the DOM whenever open (conditional on state) — since the test drives
    `defaultOpen`, the expanded content is present in static markup.
    Panel content (df NOC light tokens, LQWD navy, NO dark mode):
      • Reason row: `detail` when non-null/non-empty, else the honest fallback string
        "Probe reported no reason" (define as a const; do NOT invent a cause).
      • detection_method chip when detectionMethod present (mono pill).
      • error_count row (reuse the >5 critical / >0 warning / 0 faint color grammar from TwoAxisPip's footer).
      • last-success row: humanize lastSuccessAt into "…ago"; when null render "never".
        Add a small local `relativeAge(date, nowMs)` helper OR mirror ServiceHealthGrid's `relativeAge`
        (keep it self-contained — do NOT import from a page/server module).
      • functioning-stale and collector-stale indicators, each rendered only when its flag is true.
    Named export `ServiceWhyAccordion` and export a `ServiceWhyAccordionProps` interface (convention:
    named exports, interface with props). Export the fallback const too so the test can reference it.
    Keep the panel styling as a bordered inset (border-df-border-soft / bg-df-surface-sub) beneath the trigger.
    Create `src/components/df/ServiceWhyAccordion.test.tsx` following the TwoAxisPip/NodeFeeEnqueue
    convention EXACTLY: `renderToStaticMarkup(createElement(ServiceWhyAccordion, { ...props, defaultOpen: true }, <trigger>))`.
    Cases: (a) detail present → markup contains the detail string; (b) detail null → markup contains
    the honest fallback + the error_count + a last-success value; (c) lastSuccessAt null → markup contains
    "never"; (d) functioningStale/collectorStale true → their indicators appear.
  </action>
  <verify>
    <automated>cd /Users/joshuajackson/LQWD/ClaudeCode/lqwd-node-monitor && npx vitest run src/components/df/ServiceWhyAccordion.test.tsx</automated>
  </verify>
  <done>Client accordion renders a not-green row's why-panel: real detail when present, honest fallback + error_count + last-success age when detail null, "never" for null last-success, stale indicators gated by flags; render-test passes without jsdom/testing-library.</done>
</task>

<task type="auto">
  <name>Task 3: Wire the accordion into the not-green service-health chip surfaces (additive)</name>
  <files>src/components/node/ServiceHealthGrid.tsx, src/components/node/NodeSupportingServices.tsx, src/components/host/HostCard.tsx, src/components/host/OnHostNodes.tsx, src/app/(overview)/hosts/page.tsx, src/app/(overview)/hosts/[hostId]/page.tsx</files>
  <action>
    Wire `ServiceWhyAccordion` into each surface so ONLY not-green (and non-no-data) rows gain the
    expand affordance; green/healthy and no-data rows render EXACTLY as today (additive diffs only).
    A "not-green" service = `!svc.green && !svc.noData` (running-but-not-functioning OR down).

    ServiceHealthGrid.tsx (consumes ServiceHealthState[] directly — full state available):
      For each service, if `!svc.green && !svc.noData`, wrap the `<TwoAxisPip .../>` tile as the accordion's
      `children` (trigger), passing svc.detail, svc.detectionMethod, svc.errorCount, svc.lastSuccessAt,
      svc.stale (→ functioningStale), svc.collectorStale, and the section `nowMs`. Green/no-data tiles render
      the bare `<TwoAxisPip/>` as now. Do NOT modify TwoAxisPip.tsx (LOCKED).

    NodeSupportingServices.tsx (consumes ServiceHealthState[] directly):
      In the rows map, for a not-green non-no-data `ServiceLine`, wrap it in the accordion (trigger = the
      existing line markup), passing the same fields; pass a `nowMs = Date.now()` (or thread one in — keep
      it minimal). Leave the no-data and healthy lines unchanged.

    HostCard.tsx (consumes the page-built `HostServiceTile` — NOT ServiceHealthState):
      Extend `HostServiceTile` with additive OPTIONAL fields: `detail?: string | null`,
      `detectionMethod?: string | null`, `lastSuccessAt?: Date | null`, `functioningStale?: boolean`,
      `collectorStale?: boolean`. In `ServiceRow`, when the tile is known and not-green
      (`tile.known && !(tile.running && tile.functioning)`), wrap the row in the accordion using those
      fields (default the optionals safely). Healthy + no-data rows unchanged. Thread a `now`/nowMs value
      (HostCard already accepts a `now?: Date` prop) into the accordion.

    OnHostNodes.tsx (consumes the page-built `OnHostNodeScript`):
      Extend `OnHostNodeScript` with the same additive optional fields. In `ScriptRow`, wrap not-green
      scripts (`!(script.running && script.functioning)`) in the accordion. Healthy scripts unchanged.

    src/app/(overview)/hosts/page.tsx — `toServiceTile(svc: ServiceHealthState)`:
      Populate the new tile fields from the state: detail: svc.detail, detectionMethod: svc.detectionMethod,
      lastSuccessAt: svc.lastSuccessAt, functioningStale: svc.stale, collectorStale: svc.collectorStale.

    src/app/(overview)/hosts/[hostId]/page.tsx — the on-host node `scripts` mapper (~line 393):
      Populate the same new fields on each script from its ServiceHealthState (detail, detectionMethod,
      lastSuccessAt, functioningStale: s.stale, collectorStale: s.collectorStale).

    All diffs additive: no removals, no behavior change for green/no-data rows, TwoAxisPip untouched.
  </action>
  <verify>
    <automated>cd /Users/joshuajackson/LQWD/ClaudeCode/lqwd-node-monitor && npx vitest run src/components src/lib/read/service-health.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>Not-green rows across ServiceHealthGrid, NodeSupportingServices, HostCard, and OnHostNodes are expandable into the honest why-panel; green/no-data rows are byte-for-byte unchanged; page mappers feed detail/detectionMethod/lastSuccessAt/stale flags; TwoAxisPip unmodified; typecheck + component/read tests pass.</done>
</task>

</tasks>

<verification>
- `npx vitest run src/lib/read/service-health.test.ts src/components` — read-layer + component + wiring tests pass.
- `npx tsc --noEmit` — no type regressions from the additive tile fields.
- Manual honesty check: with detail=null (live LND fleet), the expanded panel shows the fallback
  "Probe reported no reason" + error_count + "never" last-success — never a fabricated cause.
</verification>

<success_criteria>
- A not-green service row (running-but-not-functioning or down) is clickable and expands an inline
  details panel (accordion — not a tooltip, not always-visible).
- Panel shows the probe `detail` verbatim when present; an honest fallback + error_count + last-success
  age when detail is NULL; "never" when last_success_at is NULL.
- Green/healthy and no-data rows are unchanged; TwoAxisPip.tsx is unmodified.
- Read layer's ServiceHealthState carries detail + detectionMethod in BOTH derivation branches.
- OUT OF SCOPE untouched: Gap A (node-side probe writes), Phase-17 WR-02/WR-03/IN-01/IN-02/IN-03.
</success_criteria>

<output>
Create `.planning/quick/260721-eos-gap-b-service-health-explainability-expa/260721-eos-SUMMARY.md` when done.
</output>
