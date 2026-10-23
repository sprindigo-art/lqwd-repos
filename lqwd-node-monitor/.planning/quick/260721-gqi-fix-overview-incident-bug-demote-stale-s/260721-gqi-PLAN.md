---
phase: quick-260721-gqi
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/overview/incidents.ts
  - src/lib/overview/incidents.test.ts
  - src/components/overview/QueueIsland.tsx
  - src/components/overview/QueueIsland.test.tsx
autonomous: true
requirements: [OVW-01, OVW-04]

must_haves:
  truths:
    - "A stale source node's insight critical does NOT promote its incident to critical — the insight child's severity VALUE becomes `stale` (mirroring gradeNode/severityFromService), worstSeverity filters it, and the parent reads stale, not live critical."
    - "A FRESH stuck-force-close STILL reads critical (no-mask guarantee — demotion keys ONLY on staleNodes membership, never on the severity value, so a fresh node keeps its `critical` value)."
    - "17 per-channel stuck signals on one node collapse into ONE count-summary child, not 17 duplicate rows."
    - "Every rendered NODE child row carries a human-readable reason (via child.why), never a bare node name and never a raw machine signal key — bitcoind/host telemetry rows keep their entityLabel unchanged."
  artifacts:
    - path: "src/lib/overview/incidents.ts"
      provides: "stale-node set + stale-VALUE demotion on insight children (severity ← \"stale\" when source node stale); per-(node,signal) rollup for noisy stuck_*/htlc_* kinds"
      contains: "staleNodes"
    - path: "src/lib/overview/incidents.test.ts"
      provides: "extended locked suite: fresh-vs-stale demotion, mixed node, rollup count-summary"
      contains: "STUCK FORCE-CLOSE"
    - path: "src/components/overview/QueueIsland.tsx"
      provides: "node rollup/leaf rows render the reason (why), humanized via SIGNAL_LABELS; gated to layer === \"nodes\""
    - path: "src/components/overview/QueueIsland.test.tsx"
      provides: "renderToStaticMarkup test proving node child rows show their reason"
  key_links:
    - from: "src/lib/overview/incidents.ts"
      to: "input.nodes (ScorecardView.stale) → insight child severity VALUE + stale flag"
      via: "pubkey !== null && staleNodes.has(pubkey) → severity: \"stale\", stale: true"
      pattern: "staleNodes\\.has\\(pubkey\\)"
    - from: "src/components/overview/QueueIsland.tsx"
      to: "GroupedIncident.why + SIGNAL_LABELS"
      via: "toSeverityChild renders why for layer === \"nodes\" rows only"
      pattern: "child\\.why"
---

<objective>
Fix the overview attention-queue incident bug where a 7-day-stale node (LQWD-Australia) shows CRITICAL with 17 reasonless duplicate "critical" child rows. Three coupled defects, fixed in sequence:

1. Stale-sourced criticals: insight-derived children hardcode `stale: false` AND keep their `critical` severity VALUE, so week-old pending-channel residue drives a live CRITICAL that staleness never demotes. `worstSeverity` (severity-map.ts:98–105) keys on the severity VALUE (`if (s === "stale") continue`), NOT the boolean flag — setting only the flag would add a STALE pill but leave the parent critical (the host rollup at incidents.ts:415 passes `c.severity` to worstSeverity). The fix must set the child's severity VALUE to `"stale"` (the flag⟺value coupling used everywhere else: gradeNode/severityFromService/bitcoind/services/hosts all do `stale: severity === "stale"` where the grader returns the VALUE `"stale"`).
2. No rollup: each per-channel stuck signal becomes its own leaf (17 stuck channels → 17 leaves).
3. Render: `toSeverityChild` shows the node name for non-fee leaves and drops the reason, so 17 distinct signals all render "LQWD-Australia · critical".

Purpose: Fleet/funds-safety correctness. The locked operator decision is to DEMOTE stale-sourced signals via the STALENESS lever (never blanket-hide) — a FRESH stuck-force-close is genuinely funds-at-risk and MUST stay critical.
Output: Corrected `incidents.ts` + extended locked test suite; corrected `QueueIsland` render + a new render test.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- Contracts the executor codes against — no codebase exploration needed. -->

From src/lib/overview/incidents.ts (LOCKED — extend behavior, do not weaken):
```typescript
export interface AssembleIncidentsInput {
  rankedCards: InsightCard[];
  hosts: HostMetricsView[];
  chain: ChainTelemetryView[];
  services: ServiceHealthState[];
  nodes: ScorecardView[]; // each ScorecardView carries `pubkey` and `stale: boolean`
}
// Insight leaf built ~lines 260–275: currently `severity` (from severityFromInsight),
//   `stale: false`, `why: card.signal`, entityLabel: card.node?.alias ?? pubkey ?? "fleet".
//   The existing `pubkey` const (line 262) is already in scope at the leaf.
// Flag⟺value coupling to MIRROR (bitcoind :327, services :354, hosts :388, gradeNode/
//   severityFromService return the VALUE "stale"): `stale: severity === "stale"`.
// Host rollup (line 415) reduces `c.severity` via worstSeverity — the VALUE, not the flag.
// Fee accumulator (the rollup pattern to mirror): lines 231–317 — a Map keyed by
//   node, collapsing to a single counted summary child with a `why` count phrase.
```

From src/lib/overview/severity-map.ts (the reason the VALUE must change, not just the flag):
```typescript
// worstSeverity(): `if (s === "stale") continue;` — it filters on the severity VALUE
//   BEFORE reducing. A child whose severity VALUE is still "critical" WILL promote the
//   parent even if its boolean `stale` flag is true. Setting only the flag does NOT fix
//   the bug. severityFromInsight("critical") → "critical".
```

From src/lib/scorecard/types.ts:
```typescript
export interface ScorecardView { pubkey: string; alias: string | null; stale: boolean; /* ... */ }
```

From src/lib/insight/labels.ts:
```typescript
export const SIGNAL_LABELS: Record<DetectorId, string>;
// stuck_fc_past_maturity → "STUCK FORCE-CLOSE", stuck_sweep → "STUCK SWEEP",
// htlc_timeout_fc → "HTLC-TIMEOUT FC", stuck_open → "STUCK OPEN", ...
```

From src/components/overview/QueueIsland.tsx (toSeverityChild ~40–64):
```typescript
// isFee → renders child.why; layer==="services" → serviceDisplay(...).label;
// ELSE → child.entityLabel  ← the bug: node rows drop child.why. NOTE: the else-branch
//   ALSO covers bitcoind (why="bitcoind") and host (why="host-metrics") rows — the
//   why-render must be GATED to layer === "nodes" so only node rows change.
```

From src/components/df/SeverityCard.tsx:
```typescript
export interface SeverityChild { sev: Severity; node: React.ReactNode; icon: ...; status: ...; statusSev?: Severity; href?: string; }
// SeverityCard accepts childAlerts?: SeverityChild[]; expanded rows render `node`.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Stale-VALUE demotion of insight-derived children (funds-safety-critical)</name>
  <files>src/lib/overview/incidents.ts, src/lib/overview/incidents.test.ts</files>
  <behavior>
    - Test A (RED first): a stale-source-node insight `critical` demotes — the insight CHILD's severity VALUE is `"stale"` (NOT `"critical"`) AND `child.stale === true`; the parent host incident's severity is NOT `critical` (worstSeverity filters the stale child) and `incident.stale === true`. Assert BOTH the child severity value and the parent severity.
    - Test B (no-regression guard): a FRESH-source-node insight `critical` keeps its severity VALUE `"critical"`, `child.stale === false`, and STILL makes the parent `critical`. This is the funds-safety no-mask assertion.
    - Test C (mixed): a host with one fresh critical node and one stale-source critical node — the fresh child keeps severity `"critical"`, the stale child's severity is `"stale"` with `stale: true`; parent severity is `critical` (driven by the fresh child), proving demotion keys ONLY on staleNodes membership, never on the severity value.
    - Extend the existing suite; do NOT weaken any existing assertion. Use the existing `makeCard` / `makeNode` factories (makeNode already accepts `stale`). Pass matching `nodes: [makeNode({ pubkey, stale: true|false })]` alongside `rankedCards`.
  </behavior>
  <action>
    In `assembleIncidents`, before the insight-card walk, build a stale-node set from `input.nodes`: collect `n.pubkey` for every `ScorecardView` where `n.stale === true` into a `Set<string>` named `staleNodes`. At the insight-leaf construction (~lines 263–272), the `pubkey` const is already computed on line 262. Add `const nodeStale = pubkey !== null && staleNodes.has(pubkey);` and set BOTH fields to mirror the flag⟺value coupling used everywhere else in this file: `severity: nodeStale ? "stale" : severity,` and `stale: nodeStale,` (replacing the hardcoded `stale: false`). Setting the severity VALUE to `"stale"` is what makes worstSeverity (severity-map.ts:101) filter it so the parent host rollup at line 415 demotes; the flag alone would NOT fix the bug. Do NOT touch the fee-accumulator path, the telemetry layers, or `worstSeverity`/`gradeNode` — the existing D-08 stale-orthogonality (worstSeverity filters the stale VALUE, host rollup ORs the stale flag) then does the demotion automatically. A fresh node keeps its `critical` VALUE → no-mask funds-safety preserved. Add a one-line comment tying the change to the locked operator decision (staleness lever, mirrors the existing flag⟺value coupling). Keep engine order; no `.sort`.
  </action>
  <verify>
    <automated>npx vitest run src/lib/overview/incidents.test.ts</automated>
  </verify>
  <done>New tests A/B/C pass; all pre-existing incidents tests still pass; a stale-source insight critical has child severity VALUE `"stale"` and its parent is not critical, while a fresh one keeps `"critical"` and its parent stays critical.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Roll up noisy per-channel stuck_*/htlc_* insight criticals into one count-summary child</name>
  <files>src/lib/overview/incidents.ts, src/lib/overview/incidents.test.ts</files>
  <behavior>
    - Test D: 17 `stuck_fc_past_maturity` cards on ONE node collapse to a SINGLE summary child whose `why` is "17 channels · STUCK FORCE-CLOSE" (plural), count === 17.
    - Test E: different signals on the same node stay SEPARATE rows (e.g. `stuck_fc_past_maturity` and `stuck_sweep` → two summary children, not one).
    - Test F: single occurrence renders singular — 1 `stuck_sweep` → "1 channel · STUCK SWEEP".
    - Test G (interaction with Task 1): when the source node is stale, the rolled summary child's severity VALUE is `"stale"` (NOT `"critical"`) and `stale: true`, and it does NOT promote the parent to critical. Assert the summary child's severity value AND the parent severity.
    - Do not weaken existing assertions; non-rolled signals (e.g. `channel_close_candidate`) remain untouched.
  </behavior>
  <action>
    Define a rollup set for the noisy per-channel node kinds: `stuck_fc_past_maturity`, `stuck_sweep`, `stuck_open`, `htlc_timeout_fc` (name it e.g. `ROLLUP_SIGNALS`). In the insight-card walk, intercept these signals BEFORE the generic leaf path (mirror the existing `FEE_SIGNALS` intercept): accumulate them into a Map keyed by `(pubkey, signal)` preserving first-seen (engine) order, tracking count, worst non-stale severity via `worstSeverity`, whether the source node is stale (`pubkey !== null && staleNodes.has(pubkey)`, reusing the Task-1 set), pubkey/alias, and owning `hostId`. After the card walk (place these BEFORE the fee summaries or immediately alongside them, preserving engine order relative to other insight children), emit ONE summary child per (node, signal). Apply the SAME flag⟺value coupling as Task 1: `severity` = `nodeStale ? "stale" : accumulatedWorst`, `stale` = `nodeStale`. Other fields: `why` = `${count} channel${count === 1 ? "" : "s"} · ${SIGNAL_LABELS[signal]}` (import SIGNAL_LABELS from `@/lib/insight/labels`), `entityLabel` = alias ?? pubkey ?? "fleet", `key` = `rollup:${signal}:${pubkey ?? "fleet"}`, `count` = count, `layer: "nodes"`, empty children. Do NOT collapse across different signals or different nodes. Leave fee grouping and all other signals exactly as-is. No `.sort`; engine order preserved.
  </action>
  <verify>
    <automated>npx vitest run src/lib/overview/incidents.test.ts</automated>
  </verify>
  <done>17 stuck_fc on one node → one "17 channels · STUCK FORCE-CLOSE" summary child; distinct signals stay separate; single occurrence reads singular; a stale source gives the summary severity VALUE `"stale"` and does not promote the parent; all prior tests pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Render the reason on node rollup/leaf rows in QueueIsland (gated to layer === "nodes")</name>
  <files>src/components/overview/QueueIsland.tsx, src/components/overview/QueueIsland.test.tsx</files>
  <behavior>
    - Test H: a node rollup summary child (feeKind undefined, layer "nodes", why "17 channels · STUCK FORCE-CLOSE") renders its `why` phrase in the expanded card markup — NOT the bare node name alone.
    - Test I: a raw-signal node leaf (layer "nodes", why equal to a DetectorId like "stuck_open" from a non-rolled path) renders the humanized label ("STUCK OPEN"), never the raw machine key.
    - Test J (no-regression guard): a bitcoind child (layer "bitcoind", why "bitcoind") and a host child (layer "hosts", why "host-metrics") render their `entityLabel` (hostname) — NOT the raw `why` phrase. The why-render must NOT leak to telemetry rows.
    - Follow the existing df render-test pattern: `renderToStaticMarkup` + `createElement`, node env (no jsdom). Force the child rows to render by passing `initialFacets` with an active layer filter (auto-expands surviving cards) OR render an incident that is expanded, matching how the queue auto-expands under a layer filter. Assert the reason substring appears (H/I) and does NOT replace the hostname (J).
  </behavior>
  <action>
    In `toSeverityChild`, keep the fee branch and the services branch unchanged. GATE the reason-render strictly to `child.layer === "nodes"` (do NOT use a bare else — the else-branch also covers bitcoind why="bitcoind" and host why="host-metrics", which must keep their `entityLabel`). For `child.layer === "nodes"` rows only, set the displayed `label` to the row's reason instead of the bare `entityLabel`: use `child.why`, but humanize when `why` is a raw DetectorId — map through `SIGNAL_LABELS` (import from `@/lib/insight/labels`) when `child.why` is a known key, else fall back to `child.why` (already a human phrase for rollups and scorecard `reason`), and finally to `entityLabel` if `why` is empty. All other layers (bitcoind, hosts, storage) keep `child.entityLabel`. Keep `statusSev`/`status` behavior unchanged (severity word still right-pinned). Do not alter the card headline (still `incident.entityLabel` via the title Link) — only node child rows gain their reason. Add the new render test file mirroring `src/components/df/SeverityCard.test.tsx` and the `defaultOpen`/layer-active expansion pattern.
  </action>
  <verify>
    <automated>npx vitest run src/components/overview/QueueIsland.test.tsx</automated>
  </verify>
  <done>Every shown NODE child row carries a human-readable reason; rollup summary rows show their count phrase; raw signal keys are humanized via SIGNAL_LABELS; bitcoind/host telemetry rows still show their hostname; the card headline still shows the node name.</done>
</task>

</tasks>

<verification>
Full suite green after all three tasks:
- `npx vitest run src/lib/overview/incidents.test.ts src/components/overview/QueueIsland.test.tsx`
- `npx tsc --noEmit` (no type regressions in the touched modules)
No existing assertion in `incidents.test.ts` was weakened or removed.
</verification>

<success_criteria>
- Stale-source insight signals demote via the severity VALUE `"stale"` (worstSeverity filters it, parent reads stale, not live critical) — LQWD-Australia no longer shows a live CRITICAL from week-old pending residue.
- A FRESH stuck-force-close STILL reads critical (no-mask funds-safety guarantee — demotion keys ONLY on staleNodes membership, proven by Test B).
- 17 per-channel stuck signals collapse to ONE count-summary child.
- Every rendered NODE child row carries a human-readable reason (no bare node name, no raw machine key); bitcoind/host telemetry rows keep their hostname.
- OUT OF SCOPE respected: no recency gate added to pending.ts; no Phase-17 deferred items; Gap A/B untouched.
</success_criteria>

<output>
Create `.planning/quick/260721-gqi-fix-overview-incident-bug-demote-stale-s/260721-gqi-SUMMARY.md` when done.
</output>
</content>
</invoke>
