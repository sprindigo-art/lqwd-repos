# Phase 13: Nodes + Service Health - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 14 (4 routes · 3 composed components · 4 queue-lib code surfaces · 1 schema · 1 migration · 1 forked leaf)
**Analogs found:** 14 / 14 (every surface has a same-repo, same-convention analog; this is a compose+verify phase, not greenfield)

> Sourcing note: CONTEXT §code_context "Integration Points" + RESEARCH §"Reuse-only inventory" enumerate the file set. This map pins the CLOSEST existing analog per file with line-anchored excerpts to copy. Honor RESEARCH's three drift findings — they are called out inline where they change the analog verdict (EnqueuePreview = FORK not reuse; `withdrawn` = enum migration not just code; SVC-01 grid = `pubkey→hostId` resolve step).
>
> Design system is LOCKED (Phase 10). Do NOT propose new `df/*` primitives or `tokens.ts` entries. Every UI excerpt below composes existing primitives.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(overview)/nodes/page.tsx` (NEW) | route (RSC page) | request-response (read) | `src/app/(overview)/page.tsx` (Ops overview) | role-match (list RSC + NavRailShell) |
| `src/app/(overview)/[pubkey]/page.tsx` (REPLACE) | route (RSC page) | request-response (read) | `src/app/(overview)/[pubkey]/[tab]/page.tsx` (v1 console) + overview `page.tsx` | exact (same pubkey-gated node RSC) |
| `src/app/(overview)/[pubkey]/[tab]/page.tsx` (RETIRE/redirect) | route (redirect shim) | request-response | `src/app/(overview)/[pubkey]/page.tsx` (current redirect) | exact |
| `src/app/(overview)/[pubkey]/service/[service]/page.tsx` (NEW) | route (RSC page) | request-response (read) | `src/app/(overview)/[pubkey]/[tab]/page.tsx` (dynamic-segment validate + dispatch) | role-match |
| `ServiceHealthGrid` component (SVC-01, NEW) | component (Server) | transform (derive→render) | `VitalsCard` in overview `page.tsx` + `TwoAxisPip` (compose) | exact primitive, new composition |
| `NodeChannelsTable` component (B8, NEW) | component (Server + client leaf) | CRUD (read baseline → enqueue write) | `queue/page.tsx` (per-row live-policy diff) + `ui/table` | role-match |
| Forked `EnqueuePreview` leaf (B8, FORK) | component (client leaf) | request-response (params-only write) | `src/components/queue/EnqueuePreview.tsx` (fork, NOT reuse — Drift 1) | fork-of-analog |
| Withdraw affordance leaf (B8 `enqueued+approved` row, NEW) | component (client leaf) | request-response (write) | `src/components/queue/ApprovePanel.tsx` | role-match |
| `src/lib/queue/state.ts` (MODIFY) | utility (pure state machine) | event-driven (transition table) | itself — `LEGAL` / `approved` edge (lines 14-24) | exact |
| `src/lib/queue/transitions.ts` (MODIFY: add `withdraw`) | service (server-only txn) | event-driven (guarded flip) | `approve()` / `reject()` same file (lines 34-91) | exact |
| `src/app/actions/queue.ts` (MODIFY: `enqueueAndApprove` + `withdrawCommand`) | controller (server action) | request-response | `enqueueCommand` + `approveCommand` same file | exact |
| `src/lib/db/schema/nodemon.ts` (MODIFY: enum add) | model (Drizzle schema) | — | `commandState` pgEnum (lines 37-48) | exact |
| `drizzle/nodemon/0002_*.sql` (GENERATED migration) | migration | — | `drizzle/nodemon/0001_telemetry_tables.sql` + `meta/_journal.json` | role-match (enum ALTER, not CREATE) |
| Tests: `state.test.ts` (MODIFY), `withdraw.test.ts` (NEW), `TwoAxisPip.test.ts` (NEW), queue-action test (extend), nodes-filter-util test (NEW) | test | — | `src/lib/queue/state.test.ts` | exact |

## Pattern Assignments

### `src/app/(overview)/nodes/page.tsx` — NODE-03 Nodes list (NEW route, RSC)

**Analog:** `src/app/(overview)/page.tsx` (Ops overview — RSC read pipeline + `NavRailShell` chrome + honest error/empty fallback), with the per-row list grammar from the `VitalsCard`/`SafetyFooter` leaves in the same file.

**RSC discipline** (overview `page.tsx:37-43`) — force-dynamic, server-only reads, no `"use client"`:
```typescript
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Ops Center Overview" };
```

**NavRailShell composition + honest read-only error fallback** (overview `page.tsx:441-483`): wrap in `<NavRailShell active=… title=… counts={fleetCounts} pollSinceMs={fetchedAt.getTime()} opsNav={[…]}>`; wrap the load in `try/catch` returning the verbatim "Couldn't load…" read-only message on failure. Add a `{ key: "nodes", label: "Nodes", href: "/nodes" }` entry to the `opsNav` array (mirrors the existing ops/inbox/pending/queue entries).

**List-filter facet util** — do NOT hand-roll. Analog: `src/lib/overview/filter.ts` (`parseOverviewFacets`) already parses whitelist-guarded facet params. The Nodes-list type/status/stale filter (UI-SPEC A2) should add a sibling pure util in `src/lib/overview/` (e.g. `parseNodeFacets` + a pure `applyNodeFilters`) following `filter.ts`'s whitelist-widen-on-invalid contract, with a colocated `*.test.ts` (RESEARCH Wave-0 gap: "new Nodes-list filter/sort util + test").

**Node read source:** `loadFleetView()` (already used by overview `page.tsx:195` + `[tab]/page.tsx:222`) supplies the `ScorecardView[]` with alias/dot/stale/asOf; the unified per-node shape lives in `src/lib/read/nodes.ts` (`UnifiedNode` — channels + liquidity sats). Wire these, do not re-query.

**Severity-to-class discipline (DS-01, locked):** map severity ONLY through `severityAccent` / `severityVariants` / `severityLabel` from `src/components/df/Severity.ts` — never an `if (sev === …)` chain in JSX (overview `page.tsx:64-66` states the rule; `VitalsCard` lines 322-366 demonstrate it).

---

### `src/app/(overview)/[pubkey]/page.tsx` — NODE-04 single-scroll Node Detail (REPLACE)

**Analog:** `src/app/(overview)/[pubkey]/[tab]/page.tsx` (the v1 console — the closest pubkey-gated node RSC: identical validation gauntlet, `cache()` dedupe, fail-soft supplementary reads) + overview `page.tsx` for the `NavRailShell` + `SafetyFooter` chrome.

**Pubkey validation gauntlet BEFORE any read** (`[tab]/page.tsx:73` + `202-229`) — copy exactly:
```typescript
const PUBKEY_RE = /^[0-9a-f]{66}$/;
// …
if (!PUBKEY_RE.test(pubkey)) notFound();      // ASVS V5 — validate before data access
const fleet = await getFleet();
const node = fleet.nodes.find((n) => n.pubkey === pubkey)
  ?? (await latestNodeInfoFallback(pubkey));  // PERF-01 no-404 fallback for >30d-stale nodes
if (!node) notFound();
```

**Per-request read dedupe** (`[tab]/page.tsx:75-76`): `const getFleet = cache(loadFleetView);` so `generateMetadata` + the page share ONE warehouse read.

**Fail-soft supplementary reads AFTER the gate** (`[tab]/page.tsx:238-247`): `Promise.all` each `.catch(() => null)` — the single-scroll sections (VM vitals, Lightning, channels, signals) are garnish; one broken read degrades that section, never the page. The prototype-locked section order (D-08: header → VM vitals → service grid → Lightning → channels → active signals → safety posture) is a vertical stack of the composed leaves below.

**Node-Detail section read sources** (all present per RESEARCH §"Node-Detail data reads available" — wire, do not re-query): `src/lib/read/node-info.ts` + `nodes.ts` + `src/lib/overview/vitals.ts` (header/vitals); `src/lib/console/{channels,fees,forwards,peers,liquidity}.ts` (Lightning B5); `latestChannelsForNode` (channels B8).

**CSV export contract must stay stable** (Drift/Pitfall 5): wire the new detail's CSV buttons to the existing export URL grammar `/{pubkey}/{tab}/export?window=` — do NOT delete `[tab]/export/route.ts`.

**Safety-posture strip (B7)** — reuse the navy-washed `SafetyFooter` grammar from overview `page.tsx:376-388` (`bg-[#EAEEF6]`, "Zero node credentials stored."), extended with the D-08 reconciled write-path copy (UI-SPEC Copywriting "Node Detail safety posture").

---

### `src/app/(overview)/[pubkey]/[tab]/page.tsx` — RETIRE via redirect shim

**Analog:** the CURRENT `src/app/(overview)/[pubkey]/page.tsx` (lines 17-29) — the exact validate-then-`redirect` shim pattern:
```typescript
const PUBKEY_RE = /^[0-9a-f]{66}$/;
export default async function NodeConsoleRedirect({ params }: PageProps) {
  const { pubkey } = await params;
  if (!PUBKEY_RE.test(pubkey)) notFound();   // validate BEFORE redirect
  redirect(`/${pubkey}`);                     // v1 tab → single-scroll detail
}
```
**Load-bearing:** the sibling `[tab]/export/route.ts` is a live NODE-02 read path — the retirement replaces `[tab]/page.tsx` only; the `export/route.ts` segment stays reachable (Pitfall 5). Planner's call whether hard-remove or redirect (CONTEXT Claude's-Discretion).

---

### `src/app/(overview)/[pubkey]/service/[service]/page.tsx` — SVC-02 Service Detail (NEW route)

**Analog:** `[tab]/page.tsx` for the dynamic-segment validation + variant dispatch shape (its `switch (tab)` panel dispatch at lines 264-335 is the model for the infra-vs-custom variant split).

**Two-variant, ONE tree** (D-09): validate `pubkey` (66-hex) AND `service` (against the declared inventory / `SERVICE_DISPLAY` keys), then branch data source only:
- **infra variant** (`bitcoind`): `src/lib/read/chain-telemetry.ts` — `buildChainEvidence()` / `getChainTelemetry()` / `deriveBlocksBehind()` (blocks-behind bands for `ServiceVitals` C2).
- **custom variant** (`addressBalances`): `getServiceHealth(hostId)` → the service's `ServiceHealthState` (run-success/error-count series).

**Never render the raw machine key** — relabel via `serviceDisplay().label` from `src/lib/overview/service-display.ts` (UI-SPEC C1 heading copy).

**Section leaves compose existing primitives** (UI-SPEC C1-C6, all `df/*`/`console/*`): full-size `TwoAxisPip` (C1), `EvidenceChart`/`StaleChart` (C2), `EventTable`+`AiReadPanel` (C3 log tail), `EventTable`/`WhyChain` (C4 restart history), `BlastRadius` (C5 dependents), `CommandModal`/`CommandPanel` (C6 verify-first runbook — inert, never executes).

---

### `ServiceHealthGrid` (SVC-01, CENTERPIECE — NEW Server component)

**Analog for the grid-of-cards shell:** the `VitalsCard` grid in overview `page.tsx:490-496` (`grid grid-cols-2 … lg:grid-cols-5`, `gap-3`). **Analog for each tile:** `src/components/df/TwoAxisPip.tsx` — compose N, do NOT re-derive the color law.

**⚠ Drift 3 — `pubkey → hostId` resolution is a REQUIRED step.** `getServiceHealth(hostId)` is HOST-keyed; the route is pubkey-keyed. The canonical inversion already exists:

**Analog:** `src/lib/overview/ownership.ts` — `buildOwnershipMap({ hosts, services })` returns `hostByNode: Map<pubkey, hostId>` AND `servicesByNode: Map<pubkey, ServiceHealthState[]>` (node-scoped subset). Lines 44-76:
```typescript
// hosts.node_pubkeys is the ONLY host→node edge; invert it:
for (const pubkey of pubkeys) hostByNode.set(pubkey, host.hostId);
// node-scoped services (non-null nodePubkey) ALSO index under their node:
if (service.nodePubkey !== null) { /* servicesByNode.get(nodePubkey).push(service) */ }
```
Feed the grid `servicesByNode.get(pubkey)` for LQWD-SERVICES (node-scoped) + the host's `servicesByHost` for INFRASTRUCTURE (bitcoind/esplora/postgres). `hosts` rows come from the same read the overview uses (`getLatestHostMetrics` / the `hosts` dimension carrying `nodePubkeys`). An unattached node returns `undefined` from `hostByNode` → render honest empty, never throw (ownership.ts invariant).

**Two-axis precedence is LOCKED — do NOT re-derive or soften** (`TwoAxisPip.tsx:49-57`, verbatim, and RESEARCH anti-pattern):
```typescript
function combinedState(running, functioning) {
  if (running && functioning) return { label: "HEALTHY", ok: true };
  if (running && !functioning) return { label: "UP · NOT HEALTHY", ok: false };
  return { label: "DOWN", ok: false };
}
```
**D-06 supersedes the UI-SPEC B3 "paused = watch" hedge:** render every service by its true two-axis `ServiceHealthState` from `deriveServiceHealth()`. No synthetic paused softener (the read model has no `paused` field — schema `nodemon.ts:127-144` confirms `is_expected` only). Feed each tile `{ running, functioning, name: serviceDisplay(key).label, heartbeat, lastRun, errorCount }`.

**Two kicker-grouped sections** (`INFRASTRUCTURE` / `LQWD SERVICES`): reuse the `SectionKicker` grammar (overview `page.tsx:413-418`, `font-df-mono text-[10.5px] font-bold tracking-[0.09em] uppercase`).

---

### `NodeChannelsTable` (B8, NEW) + forked `EnqueuePreview` leaf

**Analog for the table + live per-row policy read:** `src/app/(overview)/queue/page.tsx` — it already re-queries the LIVE current fee policy per row via `latestChannelsForNode` (DISTINCT ON chan_id) and renders a current→proposed diff against the live policy, never a snapshot. Reuse its `latestChannelsForNode` wiring + `feeMsatToSat`/`formatSats` (AFM-002) formatting and `FreshnessStamp`/`FreshnessChip` freshness.

**⚠ Drift 4 — freshness column is `timestamp`, NOT `collected_at`.** `latestChannelsForNode` orders `lnd_node_channel_info` by `timestamp` (`latest.ts:33-34`). Derive per-channel baseline staleness from the row's **`timestamp`** column (UI-SPEC B8 says `collected_at` — that is wrong for channels; `collected_at` is for service-health/telemetry rows only). The read returns untyped `Record<string,unknown>[]` — add a narrow typed projection at the read boundary.

**⚠ Drift 1 — FORK `EnqueuePreview`, do NOT reuse verbatim.** Analog: `src/components/queue/EnqueuePreview.tsx`. The shipped leaf must be modified/forked because it:
1. calls `enqueueCommand` → lands `pending_approval` (line 5, 161) — B8 needs `enqueueAndApprove` → `approved`;
2. **contains a `window.confirm` at line 140** — D-11 drops it (the navy CONFIRM button IS the deliberate act);
3. renders success `QUEUED — PENDING APPROVAL` (line 252) — D-11 copy is `Queued + approved · fee intent for <chan_id short> awaits this node's next verified tick.`;
4. has **no** D-05 stale-baseline warning gate and **no** D-01 withdraw affordance.

Keep verbatim from the analog: the params-only / server-signs invariant (line 160-161 — client NEVER produces an HMAC), the `updateFeeBoundsSchema` client clamp (lines 34-48, 154), the `CONTROL_CHROME` mono-uppercase button voice (lines 38-42), the `EditRow`/`PreviewRow` grammar (lines 70-124), and AFM-002 formatting (line 227). For B8 (no-AI), seed `suggestedPpm = currentPpm` (no rec card) and pre-target a specific `chanId`.

**B8 props builder analog:** `src/lib/queue/enqueue-props.ts` (`resolveEnqueueAffordance`) — the server-only builder that resolves `backendFor(pubkey)` and emits serializable `EnqueuePreviewProps` (computes `expiresAtLabel` server-side +TTL, lines 42-68). B8 needs a sibling builder that maps a channel row (not an insight card) → the same props shape, gated to LND-backed rows only (LDK rows render policy read-only).

**Stale-baseline gate (D-05)** — reuse the existing `staleAcknowledged` field, do NOT add a new one. The gate grammar analog is `ApprovePanel.tsx:65-66` (blocked-by-default until ack):
```typescript
const approveBlocked = isStale && !staleAck;   // deliberate gate the operator CAN clear
```
Wire the acknowledged boolean through `enqueueAndApprove` → `approve(id, staleAck)` → the audit row (see schema `command_audit.staleAcknowledged`, `nodemon.ts:94`).

---

### Withdraw affordance client leaf (B8 `enqueued+approved` row, NEW)

**Analog:** `src/components/queue/ApprovePanel.tsx` — the client transition leaf that receives serializable props only (`commandId`, server-computed flags), owns local submit state, sends `{ id, … }` to a server action (never a signature), and re-validates server-side (lines 45-70). The withdraw leaf calls the new `withdrawCommand(id)` action, shows the D-01 confirm copy ("Pull this approved fee intent before the node claims it? The audit trail is preserved."), and surfaces the clean-race copy on a lost race ("too late, already claimed").

---

### `src/lib/queue/state.ts` (MODIFY — D-01 legal edge)

**Analog:** itself — the `LEGAL` table (lines 14-24). Add the terminal `withdrawn` edge from `approved`:
```typescript
approved: ["claimed", "expired", "withdrawn"],   // + D-01 operator undo
// …
withdrawn: [],   // terminal (mirror rejected/expired at lines 22-23)
```
`canTransition` (lines 27-29) needs no change — it reads `LEGAL`. Update the module doc-comment state-machine diagram (lines 8-12).

---

### `src/lib/queue/transitions.ts` (MODIFY — add `withdraw()`)

**Analog:** `approve()` (lines 34-59) / `reject()` (lines 67-91) in the SAME file — the guarded-flip + audit transaction shape. Copy exactly, departing from `"approved"` NOT the shared `FROM_STATE` const:
```typescript
// ⚠ withdraw CANNOT reuse the module FROM_STATE="pending_approval" (line 22) — it departs from "approved".
export async function withdraw(id: string): Promise<void> {
  if (!canTransition("approved", "withdrawn")) throw new Error("illegal transition: approved → withdrawn");
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");
  await dbNodemon.transaction(async (tx) => {
    const updated = await tx.update(commands)
      .set({ state: "withdrawn" })
      .where(and(eq(commands.id, id), eq(commands.state, "approved")))  // claim-race safety (D-02)
      .returning({ id: commands.id });
    if (updated.length === 0) throw new Error(LOST_RACE_ERROR);          // 0 rows ⇒ "too late, already claimed"
    await tx.insert(commandAudit).values({
      commandId: id, fromState: "approved", toState: "withdrawn", actor: "operator",
    });
  });
}
```
The `WHERE state='approved'` predicate IS the claim-race safety (D-02) — if the node already claimed (`approved → claimed`), 0 rows match and withdraw fails cleanly.

---

### `src/app/actions/queue.ts` (MODIFY — `enqueueAndApprove` + `withdrawCommand`)

**Analog:** `enqueueCommand` (lines 74-89) + `approveCommand` (lines 159-172) in the SAME file. Reuse `enqueueInputSchema` (lines 60-65), `enqueueErrorCopy` (lines 44-49), `transitionErrorCopy` (lines 52-55), and the lazy server-only import discipline verbatim.

**`enqueueAndApprove` composition** (D-11 — signs ONCE, lands `approved`, full audit trail; RESEARCH §Pattern 2):
```typescript
const parsed = enqueueInputSchema.safeParse(input);   // reuse — authoritative bounds gate
// … + a staleAck boolean on the input (mirror approveInputSchema line 148)
const { enqueue } = await import("@/lib/queue/enqueue");
const { approve } = await import("@/lib/queue/transitions");
const id = await enqueue(parsed.data.pubkey, parsed.data.params);  // pending_approval, signs once
await approve(id, parsed.data.staleAck);                            // → approved, actor operator, staleAck audited
// audit trail preserved: ∅ → pending_approval → approved
```
Client sends `{ pubkey, params, staleAck }` ONLY — never an HMAC. Explicitly NOT auto-approve-on-enqueue and NOT queue-bypass.

**`withdrawCommand`** mirrors `approveCommand` (input = `{ id: uuid }`, calls `withdraw(id)`, maps thrown lost-race → `transitionErrorCopy`).

---

### `src/lib/db/schema/nodemon.ts` (MODIFY — enum add) + `drizzle/nodemon/0002_*.sql` (GENERATED migration)

**⚠ Drift 2 — `withdrawn` is a Postgres pgEnum change, not just code.** Analog for the schema edit: `commandState` pgEnum (`nodemon.ts:37-48`). Add `"withdrawn"` to the array and update the "EXACTLY these 9 values" comment (line 37) to 10.

**Migration analog:** `drizzle/nodemon/0001_telemetry_tables.sql` + `drizzle/nodemon/meta/_journal.json` (the ONLY Drizzle-owned migrate config is `drizzle.nodemon.config.ts` — `out: "./drizzle/nodemon"`, `schema: "./src/lib/db/schema/nodemon.ts"`). Generation precedent (Phase 11 PATTERNS.md):
```bash
npm run db:generate   # drizzle-kit generate → drizzle/nodemon/0002_*.sql + meta/_journal.json entry (idx 2)
npm run db:migrate    # apply to nodemon ONLY — NEVER the warehouses
```
**Verify (RESEARCH A2 / Open Q2):** the emitted SQL should be `ALTER TYPE "command_state" ADD VALUE 'withdrawn';`. PG cannot run `ADD VALUE` inside a transaction on older PG — inspect the generated file; may need a hand-adjusted migration step. This is an ALTER-enum, NOT a CREATE-table like 0001 — gate the `withdraw()` transition code behind the applied migration (sequence: enum migration → `LEGAL`/`state.test.ts` → `withdraw()` → `withdrawCommand`).

---

### Tests (RESEARCH §Validation Architecture — Vitest 4, `npx vitest run <path>`)

**Analog:** `src/lib/queue/state.test.ts` (lines 10-56 assert the legal-edge table). Extend + add:
- `state.test.ts` (MODIFY): assert `canTransition("approved","withdrawn") === true` + `LEGAL.withdrawn === []` terminal (mirror lines 44-48).
- `src/lib/queue/withdraw.test.ts` (NEW): guarded `approved→withdrawn`, 0-row throw (pure/DB-free style per RESEARCH).
- `src/components/df/TwoAxisPip.test.ts` — assert `combinedState` precedence + up-but-dead distinctness (Wave-0 gap; a `TwoAxisPip.test.tsx` already exists — extend it).
- queue-action test (extend): `enqueueAndApprove` audit `∅→pending→approved` + params-only + staleAck recorded.
- nodes-filter-util test (NEW): pure view filter, honest empty (colocated with the new `overview/` filter util).

## Shared Patterns

### Pubkey validation (ASVS V5)
**Source:** `[tab]/page.tsx:73`, `[pubkey]/page.tsx:17`, `actions/queue.ts:24` — the identical `const PUBKEY_RE = /^[0-9a-f]{66}$/;`
**Apply to:** every new route segment (`nodes` list rows link out; `[pubkey]` detail; `service/[service]`) AND every server action. Validate the segment BEFORE any warehouse/queue read; invalid → `notFound()` (routes) or the invalid-input error copy (actions). Never let an unvalidated pubkey reach the read layer.

### Params-only / server-signs write boundary (V6, HARDEN-03)
**Source:** `EnqueuePreview.tsx:160-161` (client sends params only) + `actions/queue.ts:10-22` (server re-validates + `enqueue.ts` signs once) + `enqueue-props.ts` (server-only backend resolve).
**Apply to:** the forked B8 enqueue leaf + `enqueueAndApprove`. The client NEVER produces or sends an HMAC; the server recomputes everything; the node re-verifies. The AI never produces the signed `params` — they come only from the operator's bounds-clamped channel edit.

### Guarded transition + append-only audit (V4 integrity)
**Source:** `transitions.ts:43-58` (approve) — `UPDATE … WHERE id=? AND state=<expected> RETURNING id` (0 rows ⇒ throw lost-race) + `command_audit` insert, in one `dbNodemon.transaction`.
**Apply to:** the new `withdraw()`. The `WHERE state=<expected>` predicate gives claim-race safety for free (D-02).

### AFM-001 latest-per-key reads (never `WHERE timestamp = MAX(…)`)
**Source:** `latest.ts:24-36` (DISTINCT ON chan_id, ORDER BY chan_id, timestamp DESC) + `service-health.ts:60-85` (DISTINCT ON host_id, service_name).
**Apply to:** the B8 channels baseline (consume `latestChannelsForNode`) + the SVC-01 grid (consume `getServiceHealth`). Consume these centralized reads — never re-query (the "480 channels read as 1" failure).

### AFM-002 sole unit path (no inline sat/ppm math)
**Source:** `src/lib/format/units.ts` (`feeMsatToSat`, `formatSats`) — used at `EnqueuePreview.tsx:227`, `nodes.ts:123`, `queue/page.tsx:7`.
**Apply to:** every sat/ppm/base_msat render in NodesTable, NodeChannelsTable, Lightning cards, Service vitals. Never inline `/1000` or `* 1000`.

### Honest freshness / stale-is-first-class (D-08)
**Source:** derive staleness from raw timestamps at read time — `service-health.ts:116-205` (two clocks: collector vs functioning), `host-metrics.ts` `deriveStale`, `TwoAxisPip.tsx:141-144` (gold on stale).
**Apply to:** every tile/row/card. A service with no heartbeat in `COLLECTOR_WINDOW_MS` reads stale (never green); a stale channel baseline reads stale and warns before enqueue (D-05); use the gold `df-stale-*` treatment + `StaleChart` "NO FRESH DATA", never a faked value.

### Severity → class only via the ramp API (DS-01)
**Source:** `src/components/df/Severity.ts` (`severityAccent`/`severityVariants`/`severityLabel`); rule stated overview `page.tsx:64-66`, demonstrated `VitalsCard` 322-366.
**Apply to:** all four surfaces. Navy is STRUCTURE/action only (nav rail, active filter chip, the CONFIRM act, focus rings, safety-posture chrome) — never a health hue and never an at-risk-row marker. The severity ramp is STATE only and never appears as chrome.

### NavRailShell page chrome + honest read-only error fallback
**Source:** overview `page.tsx:441-483` (NavRailShell wrap, `opsNav`, `pollSinceMs` from the real fetch epoch) + `442-457` (page-level try/catch → "your data is unchanged — this view is read-only").
**Apply to:** the Nodes list, Node Detail, and Service Detail pages. Add a `{ key: "nodes", … href: "/nodes" }` entry to `opsNav`. Never fake a "Live" claim — the poll pill ticks from the real fetch epoch.

## No Analog Found

None. Every file this phase creates or modifies maps to a same-repo, same-convention analog. The two genuinely-new logic surfaces (`withdraw()` transition + `enqueueAndApprove` action) are near-verbatim adaptations of `approve()`/`reject()` and `enqueueCommand`+`approveCommand` respectively; the `pubkey→hostId` resolution reuses `ownership.ts`. The only structural novelty is the enum ALTER migration (0002) — analog present (0001) but the operation differs (ALTER TYPE vs CREATE TABLE); flagged above with the verification step.

## Metadata

**Analog search scope:** `src/app/(overview)/**`, `src/components/{df,queue,console}/**`, `src/lib/{queue,read,overview,console,format,db/schema}/**`, `drizzle/nodemon/**`, `.planning/phases/11-*/11-PATTERNS.md`.
**Files scanned:** ~24 source files read in full or targeted; every RESEARCH §"Reuse-only inventory" surface verified against source.
**Pattern extraction date:** 2026-07-08
</content>
</invoke>
