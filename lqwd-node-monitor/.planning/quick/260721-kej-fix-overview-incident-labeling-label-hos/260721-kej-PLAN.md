---
phase: quick-260721-kej
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - src/lib/overview/incidents.ts
  - src/lib/overview/incidents.test.ts
autonomous: true
requirements: [OVW-01]
must_haves:
  truths:
    - "A host incident whose first-placed child is a SERVICE is titled by the host's owned-node alias (or the hostId), never the service name."
    - "A host that owns NO aliased node is titled by its hostId (e.g. 'ip-10-0-5-202'), never the service name."
    - "A host whose child is a node insight card keeps its node-alias label unchanged (no regression)."
    - "The Unattributed bucket is suppressed when its rolled-up severity is 'healthy' (all children stale/healthy)."
    - "The Unattributed bucket still surfaces when it holds a live critical/warning/watch orphan (no-mask)."
  artifacts:
    - path: "src/lib/overview/incidents.ts"
      provides: "Host-label resolver applied at the final host rollup loop + healthy-bucket suppression gate"
      contains: "aliasByPubkey"
    - path: "src/lib/overview/incidents.test.ts"
      provides: "5 new locked assertions (2 relabel, 1 regression guard, 1 suppress, 1 no-mask)"
  key_links:
    - from: "src/lib/overview/incidents.ts final host rollup loop (~:500-510)"
      to: "aliasByPubkey + nodePubkeysByHost"
      via: "resolve incident.entityLabel BEFORE incident.why is computed"
      pattern: "entityLabel = .*alias"
    - from: "src/lib/overview/incidents.ts unattributed append (~:526)"
      to: "bucket.severity"
      via: "gate topLevel.push on non-healthy severity"
      pattern: "bucket.severity !== \"healthy\""
---

<objective>
Fix two overview incident-labeling bugs in the pure `incidents.ts` assembler, TDD-first, extending the LOCKED `incidents.test.ts` suite (weaken nothing).

**FIX 1 (mislabel):** Host incident cards inherit `entityLabel` from whichever child is placed FIRST (`place()` passes `child.entityLabel` to `ensureHostIncident`, incidents.ts:254). Hosts whose first alert is a SERVICE (e.g. ip-10-0-5-202's "Channel Acceptor", or a host whose only issue is the "Lnd" service functioning=false) get a SERVICE name as the card title with no host identity. Relabel every host incident by its owned-node alias (else the hostId) at the final rollup loop.

**FIX 2 (unattributed noise):** The D-R3 "Unattributed" bucket is appended to `topLevel` whenever it has children (incidents.ts:526), even when its rolled-up severity is `healthy` (all children stale/healthy — live: 2 STALE 16d orphans). Gate the append so a healthy bucket is suppressed; a live orphan still surfaces.

Purpose: The attention queue must title host incidents by host/node identity and must not show a context-free "Unattributed" group that carries no active severity.
Output: `incidents.ts` label resolver + suppression gate; 5 new locked test assertions.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@src/lib/overview/incidents.ts
@src/lib/overview/incidents.test.ts
@src/lib/overview/ownership.ts

<interfaces>
From src/lib/scorecard/types.ts — ScorecardView carries `pubkey: string` and `alias: string | null` (plus `stale`, `dot`, `reason`, `asOf`).

From src/lib/insight/types.ts — InsightCard.node is `{ pubkey, alias, backend } | null`.

incidents.ts internals the resolver consumes (already in scope inside assembleIncidents):
- `nodePubkeysByHost: Map<string, Set<string>>` — host_id → owned node pubkeys (built :168-175 from service (hostId,nodePubkey) pairs).
- `nodes: ScorecardView[]` and `rankedCards: InsightCard[]` — the two alias sources.
- `hostIncidentByKey: Map<string, GroupedIncident>` — final host rollup loop iterates its values (:500-510); `incident.key === hostId`.
- The unattributed bucket is `unattributedHolder[0]`, rolled up + appended at :515-527.
</interfaces>
</context>

<tasks>

<task type="tdd" tdd="true">
  <name>Task 1: Relabel host incident cards by host/node name (FIX 1)</name>
  <files>src/lib/overview/incidents.test.ts, src/lib/overview/incidents.ts</files>
  <behavior>
    RED — add three assertions to incidents.test.ts (extend the suite; weaken nothing):
    - Host with ONLY a service child, where that host owns a node with a known alias
      (service carries hostId + nodePubkey; that pubkey has an alias via a ScorecardView
      node OR a ranked insight card): the host incident's `entityLabel` equals the node
      alias, NOT the service's display label. Assert `why` reads "N alert(s) on {alias}".
    - Host with ONLY a service child whose host owns NO aliased node (no ScorecardView,
      no insight card for any owned pubkey): the host incident's `entityLabel` equals the
      hostId (e.g. "ip-10-0-5-202"), NOT the service label.
    - REGRESSION GUARD: host with a node insight-card child (the existing pattern, often
      nodes:[] passing the alias via card.node.alias): `entityLabel` is UNCHANGED — still
      the node alias, identical to today.
  </behavior>
  <action>
    Inside assembleIncidents, build a host-label resolver and apply it in the final host
    rollup loop (incidents.ts:500-510), the least-invasive point.

    Build `aliasByPubkey: Map<string, string>` from BOTH sources (this dual source is
    REQUIRED so existing LOCKED tests that pass node aliases via insight cards — often
    with nodes:[] — still resolve to the SAME alias, preventing regression): iterate
    `nodes` mapping `n.pubkey → n.alias` when alias is non-null, AND iterate `rankedCards`
    mapping `card.node.pubkey → card.node.alias` when both are non-null. Do not overwrite
    an already-set non-null alias (first-seen wins is fine; either source yields the same
    alias in practice).

    In the final host rollup loop, for each host incident resolve the label BEFORE
    `incident.why` is computed: `resolvedHostLabel` = the first non-null alias found by
    looking up each pubkey in `nodePubkeysByHost.get(incident.key)` against aliasByPubkey;
    if none resolve, fall back to `incident.key` (the hostId). Assign
    `incident.entityLabel = resolvedHostLabel` before the existing
    `incident.why = "N alerts on {entityLabel}"` line so the phrase updates too.

    CRITICAL no-regression rule: for any host that owns a node with a known alias, the
    resolved label MUST equal that node alias (identical to today's first-child behavior
    for node-sourced hosts) — only service-labeled / aliasless hosts change (to hostId).
    Do NOT touch the `unattributed` bucket's own label here (its key is "unattributed",
    not a real hostId, and it has no owned nodes — it falls through to its own label
    untouched because it is rolled up in the separate :515-527 block, not this loop).
    No `.sort`, no input mutation.
  </action>
  <verify>
    <automated>npx vitest run src/lib/overview/incidents.test.ts</automated>
  </verify>
  <done>New relabel + regression-guard assertions pass; a service-first host reads its node alias, an aliasless host reads its hostId, a node-child host label is unchanged; full incidents suite green.</done>
</task>

<task type="tdd" tdd="true">
  <name>Task 2: Suppress the healthy Unattributed bucket (FIX 2)</name>
  <files>src/lib/overview/incidents.test.ts, src/lib/overview/incidents.ts</files>
  <behavior>
    RED — add two assertions to incidents.test.ts:
    - Unattributed bucket with ONLY stale/healthy children (an orphan whose severity rolls
      up to "healthy" — e.g. a stale-sourced node insight with no owning host): the output
      contains NO incident with key "unattributed" (bucket suppressed).
    - Unattributed bucket with a live CRITICAL orphan child (no owning host, fresh critical):
      the output STILL contains the "unattributed" incident with severity "critical" (no-mask).
  </behavior>
  <action>
    At the unattributed append (incidents.ts:526), gate the push: after the existing
    rollup that sets `bucket.severity = worstSeverity(bucket.children.map(...))`, only
    `topLevel.push(bucket)` when `bucket.severity !== "healthy"`. Keep the rollup of
    severity/stale/asOf/why intact (compute first, then conditionally append). Leave the
    lazy creation and the `unattributedHolder` mechanism untouched. `worstSeverity` already
    filters `stale`, so an all-stale bucket rolls up to "healthy" and is suppressed; a live
    critical/warning/watch orphan yields a non-healthy severity and still surfaces.
    No `.sort`, no input mutation.
  </action>
  <verify>
    <automated>npx vitest run src/lib/overview/incidents.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>Stale-only bucket is absent from output; live-critical orphan bucket still present with its critical severity; full incidents suite green; tsc --noEmit clean.</done>
</task>

</tasks>

<verification>
- `npx vitest run src/lib/overview/incidents.test.ts` — full suite green, all pre-existing assertions intact (LOCKED suite: weakened nothing).
- `npx tsc --noEmit` — clean.
- Manual reasoning check against the two no-regression guards: (a) node-child host label unchanged; (b) live orphan still surfaces.
</verification>

<success_criteria>
- Service-first host incidents titled by owned-node alias, else hostId — never a service name.
- Node-child host incident labels byte-identical to prior behavior (regression guard passes).
- Healthy (all-stale) Unattributed bucket suppressed; live critical/warning/watch orphan still surfaces.
- Zero changes to `parseOverviewFacets`, ownership, severity-map, or any input; no `.sort`; incidents.ts stays a pure module.
</success_criteria>

<output>
Create `.planning/quick/260721-kej-fix-overview-incident-labeling-label-hos/260721-kej-SUMMARY.md` when done.
</output>
