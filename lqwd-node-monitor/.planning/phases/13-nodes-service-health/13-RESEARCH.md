# Phase 13: Nodes + Service Health - Research

**Researched:** 2026-07-08
**Domain:** Next.js App Router UI composition over an already-shipped read model + a one guarded write-path extension to the Phase-6 command queue
**Confidence:** HIGH (every canonical surface was read and verified against source; the drifts below are the load-bearing findings)

## Summary

This is a **composition + verification** phase, not a greenfield one. The design system is LOCKED
(Phase 10), the read model is SHIPPED (Phase 11: `service-health.ts`, `latest.ts`,
`chain-telemetry.ts`), and the write path exists (Phase 6: `queue/*`, `actions/queue.ts`). The
CONTEXT.md decision set (D-01→D-11) is the plan-of-record and the UI-SPEC is the approved visual
contract. My job was to confirm the named surfaces exist and expose the signatures CONTEXT claims —
they overwhelmingly do — and to surface the places where "reuse verbatim" is **not literally
possible** so the planner sizes those tasks correctly.

**Three findings are load-bearing and change task sizing:**

1. **`EnqueuePreview` cannot be reused verbatim** (contradicts CONTEXT/UI-SPEC wording). The shipped
   component (a) calls `enqueueCommand` → lands `pending_approval`, NOT `enqueueAndApprove` → `approved`;
   (b) **still contains a `window.confirm`** at line 140 that D-11 says to drop; (c) shows success as
   `QUEUED — PENDING APPROVAL`, not the D-11 `Queued + approved` copy; (d) has **no** stale-baseline
   warning (D-05) and **no** withdraw affordance (D-01). It must be **modified or forked**, not reused as-is.

2. **The `withdrawn` state requires a Postgres enum migration.** `command_state` is a `pgEnum` with
   **exactly 9 values, none of them `withdrawn`** (`src/lib/db/schema/nodemon.ts:38`). D-01 is framed as a
   `LEGAL` + `transitions.ts` code change, but it also needs a drizzle-kit migration on the `nodemon` DB
   (`ALTER TYPE command_state ADD VALUE 'withdrawn'`) **and** an update to `src/lib/queue/state.test.ts`,
   which explicitly asserts the legal-edge table.

3. **Service health is keyed by `hostId`, not `pubkey`.** `getServiceHealth(hostId)` /
   `deriveServiceHealth()` take a host id; Node Detail is routed by `pubkey`. The grid (SVC-01) needs a
   `pubkey → hostId` resolution step, and the rows carry `node_pubkey` / `inventory_node_pubkey` for the
   per-node subset. This mapping is not spelled out in CONTEXT and must be an explicit plan task.

**Primary recommendation:** Plan Phase 13 as four UI compositions over existing reads + **one queue
extension epic** (`withdrawn` enum migration → `LEGAL`/`state.test.ts` → `withdraw()` transition →
`withdrawCommand` + `enqueueAndApprove` actions → a **forked/modified** enqueue leaf with the stale
guard). Treat the queue extension as the highest-risk, TDD-first work; the UI is lower-risk assembly.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Nodes list / Node Detail / Service Detail render (NODE-03/04, SVC-02) | Frontend Server (RSC) | Client (interactive leaves) | Server Components fetch the read model; Client Components only for filter/sort/expand/enqueue interactivity |
| Two-axis service grid (SVC-01) | Frontend Server | — | `TwoAxisPip` is a Server component fed derived `ServiceHealthState`; no client JS needed for the tile itself |
| Service-health derivation (running×functioning, staleness) | API/Read model (Phase 11, shipped) | — | `deriveServiceHealth()` owns the precedence; UI never re-derives or softens it |
| Per-channel fee baseline + freshness (D-04) | Database/Read (warehouse, shipped) | Frontend Server | `latestChannelsForNode()` (routing warehouse) is the sole baseline; staleness derived from the row `timestamp` |
| Enqueue + approve / withdraw write (D-01/D-11) | API/Backend (server actions + `nodemon` queue DB) | Client (params-only leaf) | HMAC signed server-side; client sends params only; node re-verifies + atomic claim. Zero node creds in dashboard |
| Fee/sat/ppm formatting | Shared lib (`format/units.ts`, AFM-002) | — | Sole unit path; no inline math anywhere |

## Standard Stack

No new dependencies. This phase composes the already-installed workspace stack (Next 16 / React 19 /
Tailwind v4 / shadcn / Drizzle+postgres.js / Recharts / zod / node:crypto). See the NodeMonitor
`CLAUDE.md` technology table — it is authoritative and current. **Zero `npm install` expected.**

### Reuse-only inventory (verified present)

| Surface | Path | Verified signature / note |
|---------|------|---------------------------|
| `TwoAxisPip` | `src/components/df/TwoAxisPip.tsx` | `combinedState(running,functioning)` → `HEALTHY` / `UP · NOT HEALTHY` / `DOWN`; strict green-only-when-both; pulsing alarm dot via `v2pulse` (defined `globals.css:440`). Props: `{running, functioning, name?, heartbeat?, lastRun?, errorCount?}`. **CONFIRMED — do not re-derive.** |
| Service-health read | `src/lib/read/service-health.ts` | `ServiceHealthState` = `{running, functioning, green, stale, collectorStale, noData, ...}` — **NO `paused` field (D-06 CONFIRMED)**. `deriveServiceHealth(row, nowMs)`, `getServiceHealth(hostId)`, `COLLECTOR_WINDOW_MS`=15min, `FUNCTIONING_GRACE`=2. **Keyed by `hostId`.** |
| Latest-channels read | `src/lib/read/latest.ts` | `latestChannelsForNode(localPubkey)` → `Record<string,unknown>[]` (untyped), DISTINCT ON (chan_id) from `lnd_node_channel_info` in the **routing warehouse**. Freshness column is **`timestamp`** (not `collected_at` — see drift). |
| Queue state machine | `src/lib/queue/state.ts` | `LEGAL` table + `canTransition`. `approved: ["claimed","expired"]` — **needs `"withdrawn"` added + a terminal `withdrawn: []`.** |
| Guarded transitions | `src/lib/queue/transitions.ts` | `approve(id, staleAck)` writes `staleAcknowledged` (D-05 reuse CONFIRMED); `reject(id, reason?)`. Both hardcode module const `FROM_STATE="pending_approval"` — **`withdraw` needs its own from-state `"approved"`.** |
| Queue server actions | `src/app/actions/queue.ts` | `enqueueCommand`, `enqueueBatch`, `approveCommand`, `rejectCommand`. **No `enqueueAndApprove`, no `withdrawCommand` yet (D-11/D-01 add them).** Params-only contract + `enqueueErrorCopy`/`transitionErrorCopy` established. |
| Enqueue leaf | `src/components/queue/EnqueuePreview.tsx` | Params-only client leaf, `updateFeeBoundsSchema` clamp. **Calls `enqueueCommand` (→pending_approval); contains `window.confirm` (line 140); success = "PENDING APPROVAL". Cannot be reused verbatim — see Pitfall 1.** |
| Bounds schema | `src/lib/queue/bounds.ts` | `updateFeeBoundsSchema` (ppm 0–5000, base 0–100000, timelock 18–2016, frozen D-11) + `isOperatorOverride`. CONFIRMED. |
| Severity ramp | `src/components/df/Severity.ts` | `severityVariants`, `severityAccent`, `severityIcon`, `severityLabel`, `severityText`, type `Severity`. CONFIRMED (superset of CONTEXT's list). |
| Service relabel | `src/lib/overview/service-display.ts` | `SERVICE_DISPLAY`, `serviceDisplay()` — relabel only, never re-grades. CONFIRMED. |
| Chain telemetry (infra variant) | `src/lib/read/chain-telemetry.ts` | `buildChainEvidence()`, `getChainTelemetry()`, `deriveBlocksBehind()`, `ChainTelemetryView`. CONFIRMED for SVC-02 bitcoind variant. |
| CSV export route | `src/app/(overview)/[pubkey]/[tab]/export/route.ts` | Live NODE-02 export (channels/fees/forwards/closes). **Must stay reachable after D-08 retires the `[tab]` page.** |

### Node-Detail data reads available (for NODE-04 / B5 / B8 — all present)

`src/lib/console/`: `channels.ts`, `fees.ts`, `forwards.ts`, `liquidity.ts`, `peers.ts`,
`pending-summary.ts`, `trends.ts`, `closes.ts`. `src/lib/read/`: `node-info.ts`, `nodes.ts`,
`pending.ts`, `host-metrics.ts`, `storage-growth.ts`. `src/lib/overview/`: `vitals.ts`,
`incidents.ts`, `severity-map.ts`. The Lightning layer (B5) and channels table (B8) have ready read
sources; the planner should wire, not re-query.

## Package Legitimacy Audit

Not applicable — **zero external package installs** in this phase. Every surface composes
already-vendored workspace code. If planning later requires a shadcn registry add, the UI-SPEC
Registry Safety gate applies (`components.json → "registries": {}`; none declared).

## Architecture Patterns

### Data flow (primary use case: operator queues a per-channel fee change on Node Detail)

```
Browser (Node Detail /{pubkey})
  │  soft-nav from overview row (deep-link contract stable, Phase 12)
  ▼
RSC: NodeDetailShell  ── fetch ──► read model (server-only, lazy-imported)
  │   ├─ node-info / nodes / vitals            → NodeHeader, VmVitals
  │   ├─ getServiceHealth(hostId)  [pubkey→hostId resolve]  → ServiceHealthGrid (TwoAxisPip × N)
  │   ├─ console/{channels,fees,forwards,peers} → LightningState
  │   └─ latestChannelsForNode(pubkey)          → NodeChannelsTable (+ per-row `timestamp` freshness)
  ▼
Client leaf: <EnqueuePreview*>  (params only — NEVER an HMAC)
  │   expand → inert preview → (stale-baseline warn if row stale, D-05) → navy CONFIRM
  ▼
Server action: enqueueAndApprove(params)     ← NEW (D-11)
  │   zod re-validate (updateFeeBoundsSchema) → enqueue() signs ONCE → approve(id, staleAck)
  │   audit trail: ∅ → pending_approval → approved (actor operator)
  ▼
nodemon queue DB (state='approved')  ──► node claims (FOR UPDATE SKIP LOCKED), re-verifies HMAC,
                                          re-bounds, applies. Dashboard holds zero node creds.
  ▲
  └─ Withdraw affordance (D-01): withdrawCommand → withdraw() UPDATE ... WHERE state='approved'
     (0 rows = "too late, already claimed"). Requires 'withdrawn' enum value + LEGAL edge.
```

### Pattern 1: Guarded transition + audit (the withdraw model)
**What:** Every state flip is `UPDATE commands SET state=<to> WHERE id=? AND state=<expected> RETURNING id`
(0 rows ⇒ throw lost-race) + a `command_audit` insert, inside one `dbNodemon.transaction`.
**When to use:** The new `withdraw()` (D-01) MUST follow this exactly — the `WHERE state='approved'`
predicate **is** the claim-race safety (D-02), for free.
**Note:** `transitions.ts` currently hardcodes a module const `FROM_STATE = "pending_approval"` shared by
`approve`/`reject`. `withdraw` cannot reuse that const — it departs from `"approved"`. Write it with its own
from-state literal; keep the same transaction+guard+audit shape and a `canTransition("approved","withdrawn")`
defense-in-depth check.

### Pattern 2: Params-only server action (the enqueueAndApprove model)
**What:** Client sends `{pubkey, params}`; server re-validates with `updateFeeBoundsSchema`, signs once
(`enqueue.ts`), then flips to `approved`. Client never produces an HMAC.
**When to use:** `enqueueAndApprove` (D-11) = `enqueue()` then `approve(id, staleAck)`. Reuse
`enqueueErrorCopy` / `transitionErrorCopy` verbatim for byte-identical copy. It is **not** auto-approve-on-enqueue
and **not** queue-bypass — it collapses two operator clicks into one gesture with the full audit trail preserved.

### Anti-Patterns to Avoid
- **Re-deriving or softening the two-axis precedence** in the UI. `combinedState()` is the single source; the
  grid renders whatever it returns. Do not add a "paused = watch" softener for paused-by-design (D-06 supersedes
  the UI-SPEC B3 "represent as watch" hedge).
- **Re-querying latest-per-key with `WHERE timestamp = MAX(...)`.** Both `latest.ts` and `service-health.ts` use
  DISTINCT ON; consume them, never re-query (the documented "480 channels read as 1" / AFM-001 failure).
- **Rendering a stale fee value as current.** A stale channel baseline reads stale and warns before enqueue
  (D-05, the 08-04 canary lesson).
- **Reusing `EnqueuePreview` verbatim.** It carries a `window.confirm` and the wrong action/success copy — see Pitfall 1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Two-axis health color law | A new tile + severity mapping | `TwoAxisPip` (`df/`) | Precedence + pulse + AA glyphs already implemented and tested |
| Latest channel/service state | A fresh SQL read | `latestChannelsForNode` / `getServiceHealth` | DISTINCT ON guardrails baked in; re-query invites the N-read-as-1 failure |
| Staleness computation | A new "is it fresh" helper | `deriveServiceHealth` clocks / row `timestamp` | Two distinct clocks (collector vs functioning) already reconciled |
| sat/ppm/msat formatting | Inline unit math | `format/units.ts` (`feeMsatToSat`, `formatSats`) | AFM-002 sole path; inline math is a locked anti-pattern |
| Command state flips | Bespoke UPDATEs | `transitions.ts` guarded pattern | Lost-update/claim-race safety comes free from `WHERE state=<expected>` |
| Server-side signing | Any client-side HMAC | `enqueue.ts` via a server action | Zero node creds in dashboard; client sends params only |
| CSV export | New serializer | existing `ExportButton` + `[tab]/export/route.ts` | Read path already tested; keep it reachable |

**Key insight:** Almost every "build" in this phase is actually a "wire". The only genuinely new logic is the
queue extension (Pattern 1 + 2) and the `pubkey→hostId` resolution for the grid.

## Runtime State Inventory (migration-relevant surfaces)

This phase adds a new terminal queue state — that is a schema/runtime change, so the inventory applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data / DB schema | `command_state` pgEnum has **exactly 9 values, no `withdrawn`** (`nodemon.ts:38`). `commands.state` column defaults `pending_approval`. | **Drizzle migration on the `nodemon` DB**: add `withdrawn` to the enum (`generate`+`migrate`; note PG `ALTER TYPE ... ADD VALUE` cannot run inside a transaction on older PG — verify drizzle-kit emits it correctly). Update the "EXACTLY these 9 values" comment. |
| Live service config | None — no external service config embeds a Phase-13 string. | None. |
| OS-registered state | None — no OS-level registrations touched. | None. |
| Secrets/env vars | Per-node HMAC secret `NODEMON_HMAC_SECRET_<pubkey>` is read by `enqueue.ts` server-side (unchanged). `enqueueAndApprove`/`withdraw` reuse it; **no new secret**. | None (reuse). |
| Build artifacts / tests | `src/lib/queue/state.test.ts` asserts the legal-edge table (e.g. `canTransition("approved","claimed")` true, `("approved","pending_approval")` false). Adding `withdrawn` **breaks/extends this test**. | Add `canTransition("approved","withdrawn") === true` + terminal assertions; regenerate any enum-count assertion. |

**Nothing else stateful changes** — the four UI surfaces are pure reads over shipped telemetry.

## Common Pitfalls

### Pitfall 1: Treating `EnqueuePreview` as reusable verbatim
**What goes wrong:** CONTEXT (§code_context, D-11) and UI-SPEC say "reuse verbatim … `window.confirm` dropped."
The shipped file contradicts this: it calls `enqueueCommand` (lands `pending_approval`), **contains a
`window.confirm` at line 140**, and renders success as `QUEUED — PENDING APPROVAL`.
**Why it happens:** The one-click `enqueueAndApprove` (D-11) is a behavior change the leaf predates.
**How to avoid:** Plan an explicit task to **modify or fork** the leaf: inject/swap the action to
`enqueueAndApprove`, delete the `window.confirm`, change success copy to the D-11 `Queued + approved …`, add the
D-05 stale-baseline warning gate, and (for B8) accept a `chanId`-pretargeted, non-rec baseline (`suggestedPpm =
currentPpm`, since B8 is no-AI). Keep the params-only / server-signs invariant intact.
**Warning signs:** A plan task that says "reuse EnqueuePreview as-is" — it will ship the dropped confirm and the
wrong write path.

### Pitfall 2: Assuming `withdrawn` is just a code change
**What goes wrong:** Withdraw fails at runtime because `command_state` rejects the value.
**Why it happens:** CONTEXT frames D-01 as `LEGAL` + `transitions.ts`; the pgEnum + migration + test aren't mentioned.
**How to avoid:** Sequence the queue-extension epic as: enum migration → `LEGAL`/`state.test.ts` → `withdraw()` →
`withdrawCommand`. The migration must land and run on `nodemon` before the transition code is exercised.
**Warning signs:** `withdraw` transition written before the enum value exists.

### Pitfall 3: Feeding the service grid a `pubkey` where it wants a `hostId`
**What goes wrong:** `getServiceHealth(pubkey)` returns nothing/errors — the grid renders empty on every node.
**Why it happens:** SVC-01 is per-node in the UI but the read is host-keyed; rows carry `node_pubkey` /
`inventory_node_pubkey` for the per-node subset.
**How to avoid:** Add an explicit `pubkey → hostId` resolution (node→host mapping already exists via node/host
reads) and filter/attribute the host's services to this node. Make it a named plan task, not an implicit assumption.
**Warning signs:** A task that passes `params.pubkey` straight into `getServiceHealth`.

### Pitfall 4: Freshness column-name drift (`collected_at` vs `timestamp`)
**What goes wrong:** A per-channel freshness chip reads a non-existent `collected_at` on the channels row.
**Why it happens:** UI-SPEC B8 says "`collected_at`-derived freshness," but `lnd_node_channel_info` is ordered by
**`timestamp`** (`latest.ts`). Service-health rows *do* use `collected_at`; channels do not.
**How to avoid:** Derive channel-baseline staleness from the row's **`timestamp`** column; keep `collected_at` for
the service-health/telemetry surfaces. Return type is untyped `Record<string,unknown>[]` — the planner should add a
narrow typed projection at the read boundary.

### Pitfall 5: Retiring `[pubkey]/[tab]` without preserving the export route
**What goes wrong:** CSV export 404s after D-08 retires the tabbed detail.
**Why it happens:** `page.tsx` (redirect to `/scorecard`) and `[tab]/page.tsx` (the v1 console) are being replaced,
but `[tab]/export/route.ts` is a live NODE-02 read path.
**How to avoid:** Keep `[tab]/export/route.ts` reachable (redirect shim or leave the route segment). Wire the new
single-scroll Node Detail's CSV buttons to the existing export URL grammar `/{pubkey}/{tab}/export?window=`.

## Code Examples

### Two-axis precedence (verbatim from source — do not alter)
```typescript
// Source: src/components/df/TwoAxisPip.tsx:49-57
function combinedState(running: boolean, functioning: boolean): { label: string; ok: boolean } {
  if (running && functioning) return { label: "HEALTHY", ok: true };
  if (running && !functioning) return { label: "UP · NOT HEALTHY", ok: false };
  return { label: "DOWN", ok: false };
}
```

### Guarded transition to copy for `withdraw` (adapt the from-state)
```typescript
// Source: src/lib/queue/transitions.ts:34-59 (approve). withdraw departs from "approved", not "pending_approval".
await dbNodemon.transaction(async (tx) => {
  const updated = await tx.update(commands)
    .set({ state: "withdrawn" })
    .where(and(eq(commands.id, id), eq(commands.state, "approved"))) // claim-race safety (D-02)
    .returning({ id: commands.id });
  if (updated.length === 0) throw new Error(LOST_RACE_ERROR); // "too late, already claimed"
  await tx.insert(commandAudit).values({
    commandId: id, fromState: "approved", toState: "withdrawn", actor: "operator",
  });
});
```

### enqueueAndApprove composition (new action, D-11)
```typescript
// Source pattern: src/app/actions/queue.ts (enqueueCommand + approveCommand). Signs once, lands approved.
const { enqueue } = await import("@/lib/queue/enqueue");
const { approve } = await import("@/lib/queue/transitions");
const id = await enqueue(parsed.data.pubkey, parsed.data.params); // pending_approval, signs once
await approve(id, parsed.data.staleAck);                          // → approved, actor operator, staleAck audited
// audit trail preserved: ∅ → pending_approval → approved
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase-13 "purely read-only, no mutation" | One human-gated enqueue+approve write path folded in | 2026-07-07 UI-SPEC reconciliation | Adds the queue-extension epic; re-review pending on the UI-SPEC |
| Two-step enqueue → separate `/queue` approve | One-click `enqueueAndApprove` (Option A) | D-11 | Removes the reconsider beat; Withdraw (D-01) is its safety counterweight |
| Tabbed node detail (`[pubkey]/[tab]`) | Single-scroll `/(overview)/[pubkey]` | D-08 | Retire tabs; keep export route reachable |

**Deprecated/outdated for this phase:**
- The UI-SPEC B3 "paused-by-design → represent as watch" hedge — **superseded by D-06** (honest true two-axis state,
  no synthetic paused). The "paused" telemetry signal is deferred (D-07).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pubkey → hostId` mapping exists via node/host reads (needed for the grid) | Pitfall 3 | If no clean mapping, SVC-01 grid needs an added read; medium sizing impact |
| A2 | drizzle-kit cleanly emits `ALTER TYPE command_state ADD VALUE 'withdrawn'` and it runs on `nodemon` | Runtime State Inventory | PG enum-add has transaction caveats; may need a hand-written migration step |
| A3 | The channels-baseline "stale" threshold reuses the same freshness convention as elsewhere (no new constant needed) | Pitfall 4 | If a bespoke threshold is required, D-05 needs a defined staleness window |
| A4 | Node/host reads expose enough to attribute a host's services to a single node subset | Pitfall 3 | Grid could show sibling-node services if attribution is coarse |

## Open Questions (RESOLVED)

1. **`pubkey → hostId` resolution for the SVC-01 grid.**
   - What we know: `getServiceHealth` is host-keyed; rows carry `node_pubkey`/`inventory_node_pubkey`.
   - What's unclear: the canonical node→host lookup to call it, and whether to filter host services to this node.
   - Recommendation: make it an explicit first task in the SVC-01 plan; verify against `read/nodes.ts` / host reads.
   - **RESOLVED (Plan 05 Task 1):** `resolveNodeServices` owns the pubkey→hostId attribution as the first SVC-01 task, with `npx vitest run src/lib/read/node-services` covering the mapping.
2. **`withdrawn` enum migration mechanics on `nodemon`.**
   - What we know: enum has 9 fixed values; drizzle owns `nodemon` migrations.
   - What's unclear: whether `drizzle-kit generate` emits a transaction-safe `ADD VALUE`.
   - Recommendation: generate, inspect the SQL, and gate the transition code behind a verified applied migration.
   - **RESOLVED (Plan 01):** Task 2 adds `withdrawn` to the pgEnum; Task 3 is the [BLOCKING] generate→inspect→apply migration on `nodemon`, gating all Plan 03 transition code behind the verified-applied migration.
3. **Channel-baseline staleness threshold (D-05).**
   - What we know: derive from the row `timestamp`; warn+confirm, never hard-block.
   - What's unclear: the exact "how old = stale" window for a channel fee baseline.
   - Recommendation: reuse an existing freshness window if one fits; otherwise operator-confirm the threshold in planning.
   - **RESOLVED (Plan 06 Task 1):** pinned to a new named constant `FEE_BASELINE_STALE_MS = 6h` (`6 * 60 * 60 * 1000`) in `src/lib/read/latest.ts`. Neither existing window fit: `COLLECTOR_WINDOW_MS` (15m) is the collector 'is this fact fresh to show?' tick and would false-warn every collection gap; `STALENESS_CUTOFF_MS` (30d) is the monitoring-liveness eliminator and is far too loose for a fee DECISION (the Jan-14 canary snapshot was days stale). 6h matches the operator-facing warn cadence (`scorecard/config.ts → STALENESS.warnAfterHours = 6`). `baselineStale = (now - row.timestamp) > FEE_BASELINE_STALE_MS`; the D-05 gate has automated behavioral coverage (Plan 06 Task 4).

## Environment Availability

Skipped in part — no new external tools. One infra dependency is load-bearing:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `nodemon` Postgres (queue DB) | D-01 enum migration + all queue writes | assumed (env-var URL) | — | none — migration + write path blocked without it |
| routing warehouse (read-only role) | B8 channels baseline (`latest.ts`) | assumed | — | honest error state ("read model unreachable") |

The local→VM flip is env-only by design; no code-level dependency changes.

## Validation Architecture

Nyquist validation is **enabled** (`config.json → workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`package.json` → `"test": "vitest run"`, `"vitest": "^4"`) |
| Config file | none dedicated found — Vitest picks up defaults / Next transform; confirm at Wave 0 |
| Quick run command | `npx vitest run <path>` |
| Full suite command | `npm test` (`vitest run`) |

Established test style: **pure, no-DB, clock-injectable** unit tests colocated as `*.test.ts`
(e.g. `state.test.ts`, `service-health.test.ts`, `latest.test.ts`, `queue/*.test.ts`, `approve.test.ts`,
`queue.batch.test.ts`). The queue/read modules are deliberately DB-free so tests drive them without a pool.

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|--------------|
| SVC-01 | `combinedState` green ONLY when both axes; up-but-dead distinct | unit | `npx vitest run src/components/df/TwoAxisPip` (add) | ❌ Wave 0 (no component test today) |
| SVC-01 | grid attributes correct services to a node (`pubkey→hostId`) | unit | `npx vitest run src/lib/read/service-health` | ✅ extend existing |
| SVC-01/D-06 | no synthetic "paused" state; paused reads by true axes | unit | `npx vitest run src/lib/read/service-health` | ✅ extend |
| SVC-02 | infra (bitcoind blocks-behind) vs custom variant selection | unit | `npx vitest run src/lib/read/chain-telemetry` | ✅ extend |
| NODE-03 | list filter/sort is pure view over loaded set | unit | `npx vitest run src/lib/read/nodes` (+ new filter util) | ⚠ add filter-util test |
| NODE-04/B8 | channel baseline staleness derived from row `timestamp`; stale→warn | unit | `npx vitest run src/lib/read/latest` | ✅ extend for freshness projection |
| D-01 | `canTransition("approved","withdrawn")` true; terminal `withdrawn` | unit | `npx vitest run src/lib/queue/state` | ✅ extend (asserts legal table) |
| D-01/D-02 | `withdraw()` UPDATE ... WHERE state='approved'; 0 rows ⇒ throws | unit | `npx vitest run src/lib/queue` (new `withdraw.test.ts`) | ❌ Wave 0 |
| D-11 | `enqueueAndApprove` signs once, lands approved, audit `∅→pending→approved`, staleAck recorded | unit | `npx vitest run src/app/actions/queue` | ⚠ add (extend queue action tests) |
| D-11 | client sends params only — never an HMAC | unit/inspection | `npx vitest run` (+ HARDEN-03 grep for client signature) | ✅ pattern exists (`enqueue.test.ts`) |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched module path>` (< 30s; pure modules).
- **Per wave merge:** `npm test` (full `vitest run`).
- **Phase gate:** full suite green + the acceptance lens below satisfied before `/gsd:verify-work`.

### The 08-04 LQWD-Ireland canary acceptance lens (write path)
Every write-path plan task must answer **"could this repeat the canary?"** (rec-card-only enqueue → 3× channel
mis-targeting off a Jan-14 snapshot treated as current). Acceptance checks:
1. **Per-channel targeting:** the enqueue leaf is pre-targeted to a specific `chan_id` from B8, not a rec card —
   verify the `chanId` in the signed params matches the row the operator acted on.
2. **Stale baseline (D-05):** a stale channel `timestamp` forces a visible warning and an explicit `staleAck` before
   CONFIRM; the audit row records `staleAcknowledged=true`. Never render the stale fee as current.
3. **Clean revert (Withdraw, D-01):** an `approved`-but-unclaimed intent can be withdrawn; a raise **or lower** to
   ppm 1 is expressible (bounds allow 0–5000). Withdraw after node claim fails cleanly ("already claimed").
4. **No AI in the write:** the signed `params` come only from the operator's bounds-clamped edit — never the AI layer
   (re-affirmed HARDEN-03).

### Wave 0 Gaps
- [ ] `src/components/df/TwoAxisPip.test.ts` — assert `combinedState` precedence + up-but-dead distinctness (SVC-01).
- [ ] `src/lib/queue/withdraw.test.ts` (or extend `transitions` tests) — guarded `approved→withdrawn`, 0-row throw.
- [ ] Extend `src/lib/queue/state.test.ts` — `withdrawn` legal edge + terminal.
- [ ] Extend `src/app/actions/queue` tests — `enqueueAndApprove` audit trail + params-only + staleAck.
- [ ] New Nodes-list filter/sort util + test (pure view filter, honest empty).
- [ ] Confirm Vitest config resolves `@/` alias + React 19 component rendering (no config file found).

## Security Domain

`security_enforcement` is not disabled in config; the Grade-A scan is a Phase-16 gate, but the **write path is the
security-load-bearing surface of Phase 13** and must be planned to that bar.

### Applicable controls

| ASVS Category | Applies | Standard Control (already in codebase) |
|---------------|---------|----------------------------------------|
| V5 Input Validation | yes | `updateFeeBoundsSchema` (zod, `.strict()`) re-validated **server-side** in the action; pubkey `^[0-9a-f]{66}$` gate; `chanId` bound |
| V6 Cryptography | yes | HMAC-SHA256 signed **server-side** (`enqueue.ts`/`sign.ts`, hex, canonical string stored verbatim); node re-verifies. **Never hand-roll; client never signs.** |
| V4 Access Control / integrity | yes | Guarded transitions (`WHERE state=<expected> RETURNING id`) = lost-update + claim-race safety; append-only `command_audit` |
| V7 Logging | yes | Secret never logged (established `console.error("… failed")` w/o secret bytes); reuse for new actions |

### Threat patterns for this stack

| Pattern | STRIDE | Mitigation (in place / to preserve) |
|---------|--------|-------------------------------------|
| Client forges an HMAC / signed params | Tampering / Spoofing | Client sends params only; server signs; node re-verifies + re-bounds (3rd enforcement) |
| Double-apply / race on approve→claim | Tampering | Atomic `FOR UPDATE SKIP LOCKED` claim node-side; withdraw guarded on `state='approved'` |
| Stale-baseline mis-set fee (the canary) | (business integrity) | D-05 warn+`staleAck`; never render stale as current |
| AI emits an executable param | Elevation | AI advisory-only; params come only from operator edit / deterministic engine (HARDEN-03) |
| SQL injection via pubkey/host | Tampering | All keys parameter-bound in `sql` templates (`latest.ts`, `service-health.ts`); never concatenated |

## Sources

### Primary (HIGH confidence — read this session)
- `src/components/df/TwoAxisPip.tsx`, `src/lib/read/service-health.ts`, `src/lib/read/latest.ts`,
  `src/lib/read/chain-telemetry.ts` — read-model surfaces.
- `src/lib/queue/state.ts`, `src/lib/queue/transitions.ts`, `src/lib/queue/bounds.ts`,
  `src/app/actions/queue.ts`, `src/components/queue/EnqueuePreview.tsx` — write path.
- `src/lib/db/schema/nodemon.ts` — `command_state` pgEnum (9 values), `commands`/`command_audit` shape.
- `src/app/(overview)/[pubkey]/page.tsx` + `[tab]/export/route.ts` — routing + export path.
- `src/components/df/Severity.ts`, `src/lib/overview/service-display.ts`, `src/lib/queue/state.test.ts` — API surfaces + test assertions.
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — locked light-NOC design direction.
- `.planning/phases/13-nodes-service-health/13-CONTEXT.md` + `13-UI-SPEC.md`, `.planning/REQUIREMENTS.md`,
  `.planning/ROADMAP.md`, `.planning/config.json` — plan-of-record.

## Metadata

**Confidence breakdown:**
- Reuse-surface verification: HIGH — every file read; signatures confirmed against source.
- Drift findings (EnqueuePreview / enum / hostId): HIGH — confirmed in source, not inferred.
- `pubkey→hostId` mapping mechanism: MEDIUM — mapping data exists on rows; the exact lookup call is an open task.
- Enum-migration mechanics: MEDIUM — PG `ADD VALUE` has known transaction caveats; verify drizzle-kit output.

**Research date:** 2026-07-08
**Valid until:** ~2026-08-07 (stable — internal surfaces; re-verify if Phase 12/queue code changes underneath).
