# Phase 1: Foundations + Read Layer - Context

**Gathered:** 2026-06-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a correct, credential-safe **read foundation** that every later phase inherits: a Next.js app scaffold; both warehouses (`routing_vm` LND, `ldk-lspd-main` LDK) wired **read-only**; the AFM-001/AFM-002 analytics failure-modes sealed into a sanctioned query helper + unit formatter; LND and LDK normalized into one unified per-node model; and a boot-time health check. It also wires (but does not populate) the third Drizzle client for the `nodemon` write DB.

**In scope:** READ-01, READ-02, READ-03, READ-04 — app scaffold, three Drizzle clients on three least-privilege roles, read-only enforcement, AFM guards, unified LND+LDK model, boot health check.
**Not in scope:** Any UI feature (fleet overview, scorecard, console — Phases 2+); the `nodemon` queue *tables*/logic (Phase 6); any write path.
</domain>

<decisions>
## Implementation Decisions

### Warehouse access
- **D-01:** Provision a **dedicated `nodemon_ro`** least-privilege, read-only Postgres role for NodeMonitor (do NOT reuse `grafana_demo_ro`). Independent audit + revocation, clean separation from the Grafana demo. Phase 1 produces the role/grant SQL for the operator to run; SELECT scoped to the tables the read layer needs.
- **D-02:** Read-only is enforced at the **DB role level**, not app convention. `drizzle-kit push`/`migrate` is NEVER pointed at the warehouses — only read-only introspection (`pull`) and live SELECTs.
- **D-03:** **Pooler mode is unknown — probe it in Phase 1.** Detect whether a transaction-mode pooler (PgBouncer) sits in front of `192.243.215.101`; if so set `prepare: false` on that postgres.js client, otherwise leave prepared statements on. Make this a config flag, not a hardcode.

### Golden reference / validation
- **D-04:** Validate the read layer against a **reference SET, not a single node**: **Canada** (correctness anchor — best-documented, where AFM-001/002 were caught) + one **Tier M 16 GB** node (**proposed: Sweden** — infra-healthy, documented) + one **edge** node (**proposed: India** — 8 GB outlier, low/variable activity). Sweden/India are proposed picks — confirm at plan time; any documented Tier M + any edge node is acceptable.
- **D-05:** Rationale captured for downstream: the read layer reads the **shared warehouse**, not each node's OS, so Canada's different Ubuntu/128 GB resources are **irrelevant to query/formatter correctness**. The reference set exists for *representativeness* (don't overfit the unified model to the large outlier), not because infra differs.
- **D-06:** Assertion method = **live cross-consistency invariant** (not frozen literals): for each reference node assert `DISTINCT ON (chan_id)` latest-state channel count ≈ `lnd_node_info.active_channels`, plus a spot-checked sat→BTC value through the formatter. Robust to live data drift; directly exercises AFM-001 and AFM-002.

### nodemon write DB (foundation only)
- **D-07:** Phase 1 **provisions the `nodemon` Postgres + a least-privilege RW role + wires the third Drizzle client** (so READ-01's "three clients exist on three roles + health-checked" AC is met), but the **queue tables (`commands`/`executions`/`audit`) are deferred to Phase 6.** No queue logic in Phase 1.
- **D-08:** `nodemon` runs in a **local Postgres during the build**, with a **config-driven (env) connection URL** so it relocates to a node-reachable host (warehouse VM or dedicated) at Phase 6/7 with no code change. `nodemon` is the ONLY DB `drizzle-kit` ever migrates.

### LND+LDK unification
- **D-09:** Build the unified per-node model by **introspecting BOTH warehouses first** — run read-only `drizzle-kit pull` against `routing_vm` AND `ldk-lspd-main` to generate typed schema code from their existing structure, then hand-curate the unified model from the real columns. Introspection is read-only metadata only: **it does not create/alter/drop anything in the warehouses and copies no rows.** Generated schema is committed as curated source; throwaway pull artifacts are not.
- **D-10:** **Live `ldk-lspd-main` read access is available now** — design the unified model against both warehouses immediately (no LND-first fallback needed). The model still keeps a clean per-backend boundary so LND vs LDK column differences are mapped in one place.

### Claude's Discretion
- App scaffolding specifics (Next.js init, npm, `@/` path alias, ESLint/Prettier matching `lqwdclaw`), `.env.local` structure, and `import "server-only"` placement — implement to match the sibling `lqwdclaw` conventions.
- The boot-time **read-only verification mechanism** (e.g., attempt a trivial write and assert it fails, vs. inspect role grants) — planner/researcher to choose the most reliable approach; requirement is only that it "fails loudly."
- Whether Phase 1 ships a **minimal health/status page** (showing both warehouses connected + the golden-node invariant result) or stays a pure data-layer + test deliverable — left to the planner. A thin status page is the natural way to *see* the health check, but is not required by the phase goal.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Paths are relative to the project root (`/Users/joshuajackson/Desktop/LQwD/ClaudeCode/NodeMonitorDashboard`); `../` points into the parent `ClaudeCode/` workspace.

### Project planning (in-repo)
- `.planning/PROJECT.md` — project context, constraints, locked decisions
- `.planning/REQUIREMENTS.md` — READ-01..04 with acceptance criteria (Phase 1 requirements)
- `.planning/ROADMAP.md` §"Phase 1" — goal + success criteria + coupling notes
- `/Users/joshuajackson/.claude/plans/vast-popping-starlight.md` — full approved design spec (read layer = Component 1)

### Research (in-repo, this project)
- `.planning/research/SUMMARY.md` — synthesized findings; Phase 1 carries the highest-leverage prevention work
- `.planning/research/STACK.md` — Drizzle multi-DB / read-only setup, postgres.js `prepare` flag, three-client pattern, version pins
- `.planning/research/PITFALLS.md` — AFM-001/AFM-002 detail, read-only-at-role, `server-only`, never-point-drizzle-kit-at-warehouses
- `.planning/research/ARCHITECTURE.md` — three-clients/three-roles trust boundary, config-only local→VM

### Analytics correctness + thresholds (parent workspace)
- `../lqwdLogs/_library/analytical-failure-modes.md` — AFM-001 (event-driven `MAX(timestamp)`) + AFM-002 (sat→BTC / `fee_msat`) reproductions; the failures the guards must prevent
- `../lqwdLogs/canada/lqwd-canada-node-analytics/queries/00-sanity-checks.sql` — runnable sanity checks (forward coverage, channel snapshots) — pattern for the golden invariant
- `../lqwdLogs/france/lqwd-france-node-analytics/queries/02-schema-discovery.sql` — column-discovery pattern across warehouse tables
- `../lqwdLogs/_library/healthy-range-bands.md` — referenced later (scorecard); not required for Phase 1 but confirms node tiering (Canada XL vs Tier M vs India edge)

### Stack convention + connectivity (parent workspace)
- `../lqwdclaw/package.json` — exact stack versions to match (Next.js, React 19, Drizzle, Tailwind v4, postgres.js)
- `../.demo-keys/grafana-demo-vm.txt` — warehouse host/credentials pattern (mechanism reference; a dedicated `nodemon_ro` role is provisioned instead of reusing these)
- `../.planning/codebase/INTEGRATIONS.md` — env-var / connection-string conventions
</canonical_refs>

<code_context>
## Existing Code Insights

This project's repo is **greenfield** (only `.planning/`, `.claude/`, `CLAUDE.md`). Reusable assets live in sibling workspace projects.

### Reusable Assets
- `../lqwdclaw/` — production Next.js 16 / React 19 / Drizzle / Tailwind v4 / shadcn app. Copy its config conventions (tsconfig `@/*` alias, ESLint flat config, Prettier, `.env.local` pattern, Drizzle client init). Match versions from its `package.json`.
- `../lqwdLogs/_library/scripts/force-close-analyzer.sql` — battle-tested SQL idioms (latest-per-key, fee math) to port into typed query helpers.

### Established Patterns
- **AFM-001 guard:** the ONLY sanctioned latest-channel-state query is `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC` — never `WHERE timestamp = MAX(timestamp)` on event-driven `lnd_node_channel_info`.
- **AFM-002 guard:** a single unit formatter (`fee_msat/1000.0`, sat→BTC) used everywhere; no ad-hoc conversions. Unit-tested against reference values.
- **Secrets:** `import "server-only"` on every DB/credential module; no connection string reaches a client bundle; config-driven (no `localhost` literals).

### Integration Points
- Reads: two read-only Drizzle clients → `routing_vm` + `ldk-lspd-main` at `192.243.215.101` (live, in place — no replication).
- Writes (wired only): third Drizzle client → local `nodemon` Postgres (tables land in Phase 6).
</code_context>

<specifics>
## Specific Ideas

- The unified model must keep a clean **per-backend boundary** (LND vs LDK column mapping in one place) even though both warehouses are introspected up front.
- Golden invariant should be expressed so it "naturally tests the range" — same assertion runs across Canada + Tier M + edge node, surfacing overfit or edge-case breakage (e.g., zero-activity or offline node).
</specifics>

<deferred>
## Deferred Ideas

- **nodemon queue tables + logic** (`commands`/`executions`/`audit`, HMAC, state machine) — Phase 6, by design.
- **Final nodemon hosting location** (warehouse VM vs dedicated) — decided at Phase 6/7 when node-reachability is required; Phase 1 stays local + config-driven.
- None of the above is scope creep — all surfaced as boundary clarifications and routed to their owning phase.
</deferred>

---

*Phase: 1-Foundations + Read Layer*
*Context gathered: 2026-06-07*
