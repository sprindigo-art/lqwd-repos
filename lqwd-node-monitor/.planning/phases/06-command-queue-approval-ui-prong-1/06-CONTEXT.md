# Phase 6: Command Queue + Approval UI (Prong 1) - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

A durable, signed, operator-gated **`update_fee` queue** in the `nodemon` DB, proven end-to-end against a **stub executor** before any real node credential exists. The operator enqueues a fee-update intent from an `update_fee` recommendation card → the row is created `pending_approval` and does nothing until explicitly approved → the operator approves/rejects on a dedicated `/queue` page that shows live current policy, the proposed change, and data freshness → only `approved` rows are execution-eligible → every state transition lands in an append-only audit table surfaced as a per-command timeline. The full state machine (`draft→pending_approval→approved→claimed→executing→succeeded|failed|rejected|expired`) is proven against a stub executor with atomic `SELECT … FOR UPDATE SKIP LOCKED` claim, fail-closed TTL→`expired` expiry, a stale-claim reaper, and an overlapping-tick no-double-apply test. The **HMAC envelope is designed and frozen here** (per-node secret format + location, canonical signing form); the secret itself is physically delivered to nodes by Phase 7. Requirements: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04.

**Explicitly NOT this phase:** any node-side execution or real `lncli`/`lncmd` call (Phase 7 — this phase only ever runs the stub executor); the bash downloader / cron heartbeat that delivers the secret and reads the queue node-side (Phase 7); any queued action type other than `update_fee` (closes/rebalances stay export-only per Prong 2; rebalance-request table is deferred); the security scan / VM flip (Phase 8). This is the first **DB-write** UI in the project, but it holds **zero node credentials** and triggers **zero node mutations**.

</domain>

<decisions>
## Implementation Decisions

### Enqueue flow
- **D-01:** **Enqueue control mirrors the Phase 5 inline-expand** — an ENQUEUE control on `update_fee` cards, one component working identically on `/inbox` and the console Active Signals panel (the Phase 4 D-08 "one engine, two views" / Phase 5 D-01 pattern). Cards on AP-11/AP-12-suppressed nodes arrive with a null `update_fee` action (INSIGHT-06), so the control is simply absent there.
- **D-02:** **Preview-then-confirm** — expanding the card shows the exact intent (node, chan_id/channel point, current → proposed ppm, base fee msat, timelock delta, and the computed `expires_at`) with a deliberate CONFIRM ENQUEUE action. Nothing is written to `nodemon` until confirm. Expanding is inert; confirming is the deliberate write act (extends Phase 5 D-03's "the deliberate act" grammar).
- **D-03:** **Params editable within validated bounds before enqueue** — the operator may nudge the proposed ppm/base/timelock within strict min/max bounds in the preview. The audit row MUST record the value as **operator-overridden** when it differs from the engine's deterministic suggestion. → The `update_fee` param bounds become a **Phase 6 design artifact** (a zod schema mirroring the gateway `Limits`); these are the **same bounds Phase 7 re-enforces node-side**, so they must be frozen here.
- **D-04:** **HMAC signed once at enqueue** — on CONFIRM, sign over `node_pubkey + command_id + action_type + canonical(params) + expires_at` (SHA-256, lowercase hex, key-sorted canonical JSON). **Store the exact canonical string itself** plus the hex digest on the row (so bash never re-serializes JSON — CLAUDE.md §4). Params + `expires_at` are fixed from creation; the signature is immutable and approval merely flips state.
- **D-01b (revision, RESEARCH Open Q2 RESOLVED):** **Enqueue is LND-only this phase** — the enqueue control is gated on `backendFor(pubkey) === "lnd"` (`src/lib/config/backends.ts`, resolved server-side). LDK-backed `update_fee` cards render an honest unsupported/disabled state (Phase 2 D-01 grammar) and offer NO enqueue control — never enqueue an action no node can execute (project core value). The real LDK fee command is deferred to Phase 7. Implemented in plan 06-05 Task 3.

### Approval & queue UI
- **D-05:** **Dedicated `/queue` page** — a standalone, fleet-wide page listing all `pending_approval` (and in-flight) commands across nodes, with the approval review inline. Parallels the existing `/inbox` and `/pending` surfaces rather than folding into the read-only inbox.
- **D-06:** **Live re-query diff at the approval moment** — each row re-queries the node's current fee policy at render and shows the current → proposed diff (ppm, base, timelock) plus a data-freshness stamp. The diff and the stale-gate both run off this fresh read (satisfies QUEUE-03's "live current policy" literally; do NOT rely on the enqueue-time snapshot for "current").
- **D-07:** **Approve and reject both take a confirm; rejection reason optional** — a short free-text reason on reject is captured into the audit row when provided (not required).
- **D-08:** **Append-only audit surfaced as a per-command transition timeline** — each command exposes its history (state, actor, timestamp, reason) inline on `/queue`. The audit table is read back as a readable timeline, making the stub-driven state machine observable in-phase (honors the project's operator-visibility value).

### Stale-data approval gate
- **D-09:** **Reuse existing freshness bands** (the same data-freshness bands already shown across console/inbox/pending) — no new queue-specific threshold.
- **D-10:** **Blocked-until-acknowledged, via checkbox** — when the node's latest data is past the "stale" band at approval time, APPROVE is **disabled by default** and is unlocked only by a required "I acknowledge data is stale" checkbox; the acknowledgement is recorded in the audit row. → This is the project's explicit interpretation of ROADMAP success-criterion 3's "blocking approval on stale data": **blocked-by-default until an explicit, audited acknowledgement** — NOT an immovable hard block. The phase verifier should expect a checkbox-gated override, not an un-overridable lock.

### Lifetime & secret design (cross-phase freeze)
- **D-11:** **`expires_at` = enqueue + 24h, signed once at enqueue; it is the hard execution deadline.** Generous enough that a late approval still executes, short enough that a stale fee intent can't linger for days. If not claimed+executed by `expires_at`, the row fails closed → `expired`. The 24h default is **config-tunable**.
- **D-12:** **Per-node HMAC secret lives in env, keyed by pubkey** (e.g. `NODEMON_HMAC_SECRET_<pubkey-or-alias>`), loaded `server-only`. **Never in the `nodemon` DB and never in any client bundle** — storing it in the DB would hand the signing key to exactly the tampered-DB-row threat HMAC exists to defend against. Per-node secret, never a dashboard master. This is the **format/location freeze** Phase 7's downloader depends on (it places the identical secret node-side). Matches the env-only config ethos (HARDEN-02).
- **D-13:** **Stub executor exercises post-approval states in tests only; UI renders them read-only.** The stub drives `claimed→executing→succeeded|failed` in the automated suite (proving atomic `SELECT … FOR UPDATE SKIP LOCKED` claim, the overlapping-tick no-double-apply test, TTL→`expired`, and the stale-claim reaper). The `/queue` + audit UI can RENDER those states, but there is **no operator "simulate" control** — real transitions arrive only with Phase 7's node. No throwaway dev-only run button to remove later.
- **D-14:** **Stale-claim reaper window is a config placeholder** (`claimed_timeout = N × assumed_interval`) with a documented provisional default, proven now against a simulated interval; Phase 7 sets the real number once the heartbeat cadence is fixed.

### Claude's Discretion
- Exact `/queue` page layout, diff rendering, timeline visual grammar, and the enqueue preview block styling — driven through the binding design skills (sketch-findings-nodemonitor + frontend-design); reuse the Phase 5 expand visual grammar.
- `command_id` / nonce idempotency-key generation and the canonical-JSON serializer implementation (key-sort, whitespace, UTF-8) — planner/researcher decide, honoring CLAUDE.md §4 (store the canonical string verbatim; constant-time compare on any TS-side verify).
- Drizzle schema specifics for the three `nodemon` tables (commands / executions / audit) and the migration — this is the only Drizzle-migrated DB (Phase 1 D-07/D-08). Researcher confirms the `SELECT … FOR UPDATE SKIP LOCKED` + reaper mechanics.
- Where the live "current policy" read sources from (sanctioned AFM-001 latest-state helper vs an existing fee reader) — planner decides honoring AFM-001/002.
- Provisional values for the 24h TTL and reaper window defaults (within the shapes locked in D-11/D-14).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Paths relative to the project root; `../` points into the parent `ClaudeCode/` workspace.

### Project planning (in-repo)
- `.planning/REQUIREMENTS.md` — QUEUE-01..QUEUE-04 acceptance criteria (verbatim state-machine, HMAC, audit, stub-executor expectations); EXEC-01..03 for the Phase 7 coupling the secret freeze must satisfy
- `.planning/ROADMAP.md` §"Phase 6" — goal + 4 success criteria; §"Coupling Notes" — the HMAC-secret cross-phase dependency (designed Phase 6, delivered Phase 7) and card-schema fork-point
- `.planning/phases/05-command-export-prong-2/05-CONTEXT.md` — Prong-2 sibling: D-01 inline-expand grammar this phase mirrors, the rebalance-request-table deferral (now a Phase 6+ candidate), `update_fee`-not-exported rationale
- `.planning/phases/04-insight-engine/04-CONTEXT.md` — frozen card-schema contract this phase consumes; INSIGHT-06 suppression (null `update_fee` action on flagged nodes)

### Card contract & data (in-repo, binding)
- `src/lib/insight/schema.ts` — the FROZEN `update_fee` action param schema (`chanId, channelPoint, currentPpm, suggestedPpm, baseFeeMsat, timeLockDelta`) — the ONLY param source the enqueue preview seeds from; `CardEvidenceSchema.asOf` is an ISO string deliberately for canonical JSON signing
- `src/lib/insight/types.ts` — inferred card/action types
- `src/lib/insight/engine.ts` — `loadInsightView()` both card surfaces already call; the enqueue control attaches to its `update_fee` cards
- `src/lib/insight/guardrails.ts` — `WRITE_ACTION_TYPES` + AP-11/AP-12 suppression (suppressed cards carry null actions → no enqueue control); hysteresis context
- `src/components/insight/InsightCardRow.tsx` + `src/components/console/ActiveSignalsPanel.tsx` — the two card surfaces the enqueue expand attaches to (one component, both surfaces)
- `src/components/export/CommandExport.tsx` — Phase 5 client-leaf expand/copy pattern the enqueue preview leaf mirrors structurally

### nodemon queue DB (in-repo, binding)
- `src/lib/db/nodemon.ts` — the RW `nodemon_rw` Drizzle client (wired, table-less); Phase 6 adds the tables
- `src/lib/db/schema/nodemon.ts` — currently empty (`export {}`) by design; Phase 6 defines commands/executions/audit here (the ONLY Drizzle generate/migrate schema)
- `src/lib/db/env.ts` — `requireEnv` pattern; per-node HMAC secret env vars (D-12) load through the server-only env discipline
- `db/role-grants.sql` — the three-role least-privilege model; `nodemon_rw` is the only RW role
- `src/lib/db/health.ts` — boot-time health-check pattern (nodemon connectivity already checked)

### Backends / units / config (in-repo, binding)
- `src/lib/config/backends.ts` — `backendFor(pubkey)` → lnd/ldk; relevant because `update_fee` applicability differs by backend (LDK `updatechanpolicy` equivalent unconfirmed — see STATE blockers)
- `src/lib/format/units.ts` — AFM-002 formatter for every ppm/sat/msat value rendered in the diff and preview

### Design / UI (binding)
- `.claude/skills/sketch-findings-nodemonitor/SKILL.md` — NOC Light theme, mono data, no icons-for-state; `/queue`, diff, and timeline must match
- `.claude/skills/frontend-design/SKILL.md` — mandatory design guidance for all UI work

### Crypto / signing reference (CLAUDE.md, binding)
- `../CLAUDE.md` (NodeMonitor section) §4 "HMAC command signing: TS ↔ bash interop" — hex lowercase, key-sorted canonical JSON, **store the canonical string verbatim**, nonce+TTL bound into the signed payload, per-node secret, `crypto.timingSafeEqual` on TS-side verify. §1 (read-only role boundary), §5 (LLM never produces signed params).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`CommandExport` client leaf + Phase 5 inline-expand** — the enqueue preview/confirm leaf reuses this expand+copy interaction grammar (D-01/D-02); enqueue adds a server action to write the row rather than copy text
- **`InsightCardRow` / `ActiveSignalsPanel`** — the two surfaces the enqueue control mounts on, exactly as the Phase 5 export block did (one component, both surfaces)
- **Frozen `update_fee` action schema** (`src/lib/insight/schema.ts`) — seeds the preview and gives free zod validation; the new bounds schema (D-03) extends from these param shapes
- **`dbNodemon` client** (`src/lib/db/nodemon.ts`) — RW client already wired + health-checked; Phase 6 only adds tables/migrations
- **`requireEnv` / server-only env discipline** — the per-node HMAC secret loading (D-12) follows the existing env pattern
- **AFM-002 `units.ts` formatter** — all ppm/sat values in the diff and preview render through it (no ad-hoc conversions)
- **Suppression upstream** — flagged nodes' cards already arrive with null actions; the enqueue control is simply absent (no new guard needed)

### Established Patterns
- Server Components compute; thin `"use client"` leaves own interaction state (expand, confirm, checkbox) — same split as Phase 5
- `nodemon` is the ONLY Drizzle-owned (generate/migrate) DB; warehouses stay read-only (Phase 1 D-07/D-08)
- Pure, no-DB-testable modules for the signer/canonicalizer/state-machine logic (mirrors the Phase 4/5 pure-builder discipline) — the stub-executor proof should be a pure/integration test suite, not UI-driven
- Honest unsupported/no-data states rendered visibly (Phase 2 D-01) — relevant if an LDK node has no `update_fee` equivalent

### Integration Points
- Enqueue control consumes `card.suggestedAction.params` (frozen `update_fee` schema) + node fields; on confirm writes a `pending_approval` row to `nodemon` via a server action and signs it (D-04)
- `/queue` page reads `nodemon` commands + live current-policy reads (AFM-001) + audit timeline (D-05/D-06/D-08)
- HMAC secret freeze (D-12) is the hand-off contract Phase 7's downloader + node-side verify consume — canonical form must be byte-identical across TS sign and bash `openssl dgst` verify
- Card schema is the fork-point contract shared with Phase 5 (frozen at Phase 4) — do not mutate it

</code_context>

<specifics>
## Specific Ideas

- "Block on stale data" is interpreted as **blocked-by-default + audited checkbox acknowledgement** (D-10), not an immovable hard block — captured explicitly so the planner builds the override and the verifier expects it.
- The signed row stores the **exact canonical string** (not just params) so the Phase 7 bash verifier hashes that string verbatim — no `jq` re-serialization (CLAUDE.md §4).
- Operator wants to fine-tune the proposed fee within bounds (D-03) rather than approve only the engine's exact number — but every override is audited.
- The stub-executor proof is the heart of the phase: the overlapping-tick no-double-apply test, fail-closed TTL expiry, and stale-claim reaper must all pass against the stub before Phase 7 introduces a real node.

</specifics>

<deferred>
## Deferred Ideas

- **Rebalance request table** (carried from Phase 5 deferred) — a `nodemon` table the external AI-balancing service polls to initiate rebalances from approved intents. Now that Phase 6 builds the queue + approval + HMAC substrate, the natural home is a future extension adding a `rebalance_request` action type the external service claims. NOT this phase — Phase 6 is `update_fee` only.
- **Queue action types beyond `update_fee`** (queued closes/rebalances behind stricter multi-party gates) — explicit v2/deferred per REQUIREMENTS.md.
- **Operator dev-only "simulate execution" control** — considered (D-13) and rejected as throwaway UI; if a live in-UI lifecycle demo is later wanted, revisit as a clearly dev-gated tool.
- **Scheduled recommendation refresh / background card computation** — v2/deferred; queue stays on-demand.

None of the above are in scope for Phase 6.

</deferred>

---

*Phase: 6-Command Queue + Approval UI (Prong 1)*
*Context gathered: 2026-06-15*
