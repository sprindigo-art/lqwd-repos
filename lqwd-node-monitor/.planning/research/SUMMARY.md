# Project Research Summary

**Project:** NodeMonitor
**Domain:** Local-first Lightning Network fleet operator-control dashboard (multi-node LND + LDK/LSPD)
**Researched:** 2026-06-05
**Confidence:** HIGH

## Executive Summary

NodeMonitor is a credential-less, read-then-queue control tool for a live 26-node Lightning routing fleet. Unlike the single-node incumbents (ThunderHub, RTL, LNDg, litd) that hold node macaroons and execute writes directly, NodeMonitor reads from existing production warehouses (`routing_vm` + `ldk-lspd-main`), runs deterministic insight rules, and hands off operator-approved fee changes to nodes via a durable HMAC-signed pull queue — the dashboard never touches a credential. The approved spec architecture is sound; research confirmed every structural choice and produced a set of targeted corrections and feature refinements that must flow into requirements before build starts.

The recommended implementation approach is exactly the approved stack (Next.js App Router, React 19, Drizzle ORM, Tailwind v4, shadcn/ui — the same set already running in production on lqwdclaw) with Recharts 3.8.1 pinned as the chart library. Three physically separate Drizzle clients on three least-privilege Postgres roles enforce the trust boundary in hardware, not convention: two SELECT-only warehouse clients and one read-write queue client. HMAC signing must bind `node_pubkey + command_id + action_type + canonical(params) + expires_at` — not just params — to prevent replay and cross-node application. The atomic claim is a single `SELECT … FOR UPDATE SKIP LOCKED` + `UPDATE` CTE; a two-statement read-then-write is a silent double-apply bug.

The three deepest risks are analytic correctness, write-path atomicity, and self-inflicted fleet damage. The analytics risk is concrete and documented: `WHERE timestamp = MAX(timestamp)` on event-driven channel tables returned 1 row instead of 480 in a real Canada review (AFM-001), and sat/BTC/msat conversions are off by 10× or 1000× when done ad hoc (AFM-002). Both must be sealed into the Phase 1 read layer with a single tested formatter and `lnd_node_info` cross-validation before any scorecard or insight engine is built on top. The write-path and self-inflicted-damage risks are mitigated by the locked architecture itself: atomic claim, TTL, node-side bounds re-enforcement, per-node write rate-limits, fee hysteresis, and self-guardrails that suppress write recommendations to nodes already showing AP-11/AP-12 signatures.

---

## Key Findings

### Recommended Stack

The spec stack is correct and production-proven inside this workspace. Keep every locked choice. The only open item the spec deferred ("e.g. Recharts") is resolved: commit to Recharts 3.8.1. It is the only React 19 native chart library with clean shadcn/ui `chart` block integration. All Recharts components require `"use client"` wrappers; Server Components fetch data and pass plain serializable props into thin client chart wrappers — never import Recharts directly into an RSC.

The Drizzle setup has one critical refinement: run `drizzle-kit pull` once per warehouse to bootstrap types, then hand-curate the output into stable `schema.ts` files and delete all generated migration/meta artifacts. The pull is a one-time convenience, not an ongoing sync. The warehouses are externally managed and event-driven; auto-regen would invite the DISTINCT ON failure mode. Drizzle migrations run only against the new `nodemon` queue DB.

**Core technologies:**
- Next.js 16.1.6 (App Router): UI + API + RSC — matches lqwdclaw exactly; Server Components for warehouse reads, Client Components for charts and interactive controls
- React 19.2.3 + TypeScript 5.x: UI runtime + type safety — mandated by Next 16; strict mode, `@/` alias
- Drizzle ORM 0.45.x + postgres.js 3.4.x: typed SQL access — three separate clients on three roles; `pull`-bootstrapped read-only warehouse schema; migrations only for `nodemon`
- Recharts 3.8.1: time-series charts — native React 19 peer support; wraps cleanly with shadcn `chart` block; `"use client"` required
- Tailwind v4 + shadcn/ui 4.x: styling + components — fully GA on Tailwind v4 + React 19; CSS-first `@theme`; LQWD navy `#1A3C79`
- node:crypto (built-in): HMAC-SHA256 signing — `createHmac('sha256', secret).update(canonical).digest('hex')`; byte-identical to `openssl dgst -hmac` for bash-side verify
- Vercel AI SDK `ai` 6.0.x + `@ai-sdk/anthropic` 3.0.x: optional LLM narrative — `generateText` (not `streamText`); off by default; `getModel()` pattern mirroring lqwdclaw
- zod 3.23.x: param validation — validate `update_fee` params before enqueue; mirror gateway `Limits` bounds
- date-fns 3.x: time-bucketing — consistent day/hour bucketing for time-series panels

### Expected Features

The spec's feature scope is correctly tiered. No scope creep was found; every spec choice maps to a defensible architectural reason. The anti-feature list (no autopilot, no in-app close execution, no Loop/Pool, no on-node daemon) must be locked explicitly in requirements — three of the five reference incumbents (LNDg, litd, Torq) lead with automation, making the pressure to add an "auto-apply low-risk suggestions" toggle real and predictable.

**Must have (table stakes):**
- Channel list with local/remote balance, active/inactive/pending state — the primary operator mental model
- Per-channel fee report (current base + ppm) — prerequisite for any fee decision
- Forwarding history + routing-fee earnings per channel + per node — the core "is this earning?" question
- Liquidity balance summary — drives every rebalance/fee decision
- Closed-channel list with close type and initiator — required for force-close diagnosis
- Peer list with connection state + flap signal — peer hygiene baseline
- Fee/policy editing (via Prong 1 queue) — the most-used write action in all tools
- Command export for closes + rebalances (Prong 2) — makes close/rebalance present, even if not in-app executed
- Node liveness and health at a glance — "is my node up and well?"

**Should have (differentiators):**
- Fleet-wide single pane across 26 LND + LDK nodes — no incumbent except Torq covers multi-node; none unify both implementations
- 10-dimension per-node health scorecard — at-a-glance "which node needs me" ranking
- Deterministic AP-11/AP-12/force-close/fee/rebalance recommendation cards — encodes hard-won fleet incident knowledge
- Credential-less pull-based architecture — no macaroons on the dashboard host; strongest security posture of any tool in the space
- HMAC-signed instruction queue + explicit operator approval gate — stronger accountability than any incumbent's fire-and-forget RPC
- Cross-node comparison vs fleet-median bands — identify outliers relative to peers, not just absolute thresholds; currently under-specified, high value
- Fleet-wide temporal anti-pattern correlation (same-hour AP-11 cascade across nodes) — the 2024-09-09 France/India/Sweden event proves this matters; per-node detectors alone miss it
- Severity-ranked fleet triage inbox — at 26 nodes, per-node tabs do not scale for morning triage
- Explicit fee-crash / earnings-step-down detector — the France $1,150 PPM-crash lesson; needs its own named card with threshold
- CSV export of fleet/forwarding/closes — every incumbent has it; operators expect it for accounting

**Defer (v2+):**
- Queue actions beyond `update_fee` — closes/rebalances stay export-only until Phase 8 stricter gates
- Dashboard RBAC / multi-operator — Phase 8
- Version-lag and config-drift tracking — Tier-4 monitoring want; defer behind action features
- LLM streaming narrative — `generateText` is sufficient for v1; `streamText` upgrade only if UX demands it

**Never build:**
- Autopilot / unattended fee or rebalance automation — the human-approval gate IS the product's safety story
- In-app channel open or in-app force-close execution (v1) — highest-risk writes; stay export-only
- Loop / Pool / submarine-swap integration — third-party custodial-adjacent; not the fleet model
- On-node persistent daemon or AI agent — violates outbound-only posture
- Grafana panel parity — curation is the thesis; firehose detail buries signal

### Architecture Approach

The architecture is a pull-based, queue-as-handoff system: the dashboard reads warehouses, computes deterministic insight, and writes durable signed intents to a queue DB; nodes poll for their own approved jobs outbound-only and apply with local credentials. This is the correct shape for "dashboard must never hold node creds and never reach a node." Five corrections tighten correctness without changing the shape: atomic CTE claim (not read-then-write), HMAC binding all security-relevant fields, fail-closed expiry enforcement node-side, physically separate Drizzle clients per role, and a stale-claim reaper for rows stuck mid-tick.

**Major components:**
1. Read layer (Server Components + Drizzle, `grafana_demo_ro`) — SELECT warehouse data, normalize LND+LDK to one node/channel model; never writes; `DISTINCT ON` helper baked in
2. Insight engine (pure TS functions) — warehouse rows to recommendation cards using `lqwdLogs/_library` thresholds; no side effects; optional LLM narrate-only layer over already-computed cards
3. Command export, Prong 2 (client component) — renders fully-parameterized `lncli`/`lncmd` strings with safety notes; zero DB dependency; ships standalone before the queue
4. Approval UI + signer, Prong 1 (server action) — operator confirms, server computes HMAC, INSERT `approved` row; never executes; never holds node creds
5. `nodemon` queue DB (Postgres) — durable handoff: `commands` / `executions` / `audit` (append-only audit); only DB the app writes
6. Node heartbeat (bash crontab) — claims own approved jobs, verifies HMAC, re-enforces bounds, applies via `lncli`/`lncmd` argv (never shell string), writes results back; outbound-only; no daemon

**Key architectural mandates:**
- Phase 6 must prove the queue state machine (`draft` to `succeeded/failed/expired`) against a STUB executor before Phase 7 adds real lncli/creds
- Phase 4 recommendation card schema (`{severity, node, target, signal, evidence, suggested_action, params}`) must be frozen as a hard contract — both Prong 2 and Prong 1 consume it; churn breaks both
- HMAC secret designed Phase 6, physically delivered to nodes by the Phase 7 downloader — resolve format/location in Phase 6 to avoid a "signed with a key the node doesn't have" surprise at Phase 7
- `import "server-only"` on all DB/secret modules; no `NEXT_PUBLIC_` secrets; no conn strings in client bundles

### Critical Pitfalls

1. **AFM-001: `WHERE timestamp = MAX(timestamp)` on event-driven warehouse tables** — `lnd_node_channel_info`, `lnd_node_peer_info`, `lnd_node_pending_channels`, `lnd_node_pending_sweeps` are append-only event logs, not snapshots. This query returned 1 channel instead of 480 in a real Canada review. Prevention: centralize a `DISTINCT ON (entity_id) … ORDER BY entity_id, timestamp DESC` helper as the only sanctioned latest-state query; cross-validate all channel counts against `lnd_node_info.active_channels` (true snapshot); annotate the schema distinction as code comments. Build this in Phase 1 before any scorecard ships.

2. **AFM-002: sat/BTC/msat unit errors** — sat to BTC eyeballed (10x off; 3.36 BTC reported vs 33.6 BTC actual), and `fee` used instead of `fee_msat/1000.0` (1000x off). Prevention: single shared `formatSats`/`formatBtc`/`feeMsatToSat` utility, unit-tested against known reference values; all fee math in SQL or the formatter — never inline in component code. Phase 1 deliverable, re-verified at Phase 2 and Phase 4.

3. **Double-apply across overlapping cron ticks** — a two-statement SELECT-then-UPDATE leaves a window where two heartbeat ticks claim the same row. Prevention: single-statement CTE with `SELECT … FOR UPDATE SKIP LOCKED` then `UPDATE … RETURNING *`; per-command idempotency key on the node; stale-claim reaper for rows stuck past `N × heartbeat_interval`. Enforce in Phase 6; pilot-node overlapping-tick test in Phase 7.

4. **HMAC signing a subset of fields** — signing only `params` allows an attacker who can write to the queue DB to flip `node_pubkey` or `action_type` without breaking the signature. Prevention: sign a canonical serialization of ALL security-relevant fields — `node_pubkey + command_id + action_type + canonical(params) + expires_at`; lowercase hex digest; constant-time compare server-side; per-node distinct secrets.

5. **The tool triggering the anti-patterns it detects** — every fee update is a graph `UpdateEdgePolicy` write; Japan ran 614K serialization errors (AP-12b) from 194 channels under write pressure. Fee oscillation drives routing flight. Prevention: per-node write rate-limit cap (bounded apply batch per heartbeat), fee hysteresis / minimum interval between changes to the same channel, and a self-guardrail in the insight engine that suppresses write recommendations to any node currently flagged AP-11 or AP-12.

---

## Implications for Roadmap

The 8-phase order in the approved spec is correct and well-sequenced. Research validates it and adds specific sharpening per phase. Suggested structure below reflects both the spec and the research refinements.

### Phase 1: Foundations + Read Layer
**Rationale:** Everything else is built on top of warehouse reads. AFM-001 and AFM-002 must be sealed here, before any consumer exists. Config-driven DB URLs here sets the local-to-VM contract the entire project inherits.
**Delivers:** Three Drizzle clients (two RO warehouses, one RW queue), hand-curated schema from one-time `drizzle-kit pull`, `DISTINCT ON` helper, `feeMsatToSat`/`formatBtc` unit-tested formatters, `lnd_node_info` cross-validation, `import "server-only"` guards on all DB modules, boot-time config validator. Recharts in `"use client"` wrappers wired to shadcn `ChartContainer`.
**Avoids:** AFM-001 (DISTINCT ON baked in), AFM-002 (formatters tested), accidental warehouse write (grafana_demo_ro SELECT-only role), client cred leak (server-only)
**Research flag:** Standard patterns — skip additional research.

### Phase 2: Fleet Overview + Health Scorecard
**Rationale:** Fleet overview is the "where do I look first" entry point. Validates the Phase 1 read layer against known `lqwdLogs` numbers before anything is acted on.
**Delivers:** Fleet overview table with all nodes ranked by scorecard; per-node 10-dimension health dimensions; cross-node comparison vs fleet-median bands (add here — depends only on per-node scorecard outputs); freshness stamps on every card.
**Research flag:** Cross-node fleet-median band thresholds need validation against `healthy-range-bands.md` — pull exact threshold values during planning. Otherwise standard.

### Phase 3: Per-Node Console
**Rationale:** Drills into the detail the fleet overview points at. Shares the normalized LND+LDK model from Phase 2. Ships standalone value (read-only) before any write path exists.
**Delivers:** Channels view, fee report, liquidity balance, forwards view, closes view, peer view — LND and LDK nodes through one model. CSV export (add here). Data-freshness indicator on every view.
**Avoids:** Scope creep toward Grafana parity — curate to action-relevant columns only.
**Research flag:** Standard patterns.

### Phase 4: Insight Engine + Recommendation Cards
**Rationale:** Cards are the fork point: Prong 2 (Phase 5) and Prong 1 (Phase 6) both consume them. The card schema must be frozen as a hard contract before either prong is built. Self-guardrails and hysteresis go here.
**Delivers:** Deterministic AP-11 detector, AP-12a/b detector, force-close HTLC-timeout risk detector, fee-crash/earnings-step-down detector (named card, explicit threshold — the France $1,150 lesson), rebalance signal; fleet-wide temporal anti-pattern correlation pass (same-hour cascade detector); fleet triage inbox (severity-ranked cross-node card list); optional LLM narrative constrained to structured card fields only, numeric-token guard, off by default; self-guardrail suppressing write recommendations to AP-11/AP-12 flagged nodes; fee hysteresis rules.
**Avoids:** Tool-triggered AP-11/AP-12/routing-flight (hysteresis + self-guardrails); LLM hallucinated numbers (constrained to card fields, off by default).
**Research flag:** Needs deep planning research. AP-11/AP-12/force-close thresholds must be pulled from `lqwdLogs/_library` and validated against historical events. The fee-crash/earnings-step-down detector threshold is not yet defined — derive it from the France PPM-crash data during Phase 4 planning.

### Phase 5: Command Export (Prong 2)
**Rationale:** Zero queue dependency — pure client-side string generation off Phase 4 cards. Ships actionable close/rebalance capability before the risky write path exists. Correctly placed before Phase 6.
**Delivers:** Fully-parameterized `lncli`/`lncmd` copy-paste strings for closes and rebalances; richer safety notes (echo peer alias + capacity + current timelock for force-close; chan_id echo-back confirmation); param validation against strict type/range before rendering.
**Avoids:** Incumbents' weak warning UX on destructive actions; param injection in exported strings.
**Research flag:** Standard patterns for string generation. LND/LDK-specific `lncli`/`lncmd` flag shapes need exact values during planning.

### Phase 6: Command Queue + Approval UI (Prong 1)
**Rationale:** Introduces `nodemon` DB, HMAC signing, state machine, and approval gate. Must prove queue end-to-end with a stub executor before Phase 7 adds real node creds. Card schema is frozen from Phase 4; this phase consumes it.
**Delivers:** `nodemon` Postgres DB with `commands` / `executions` / `audit` (append-only); state machine `draft to pending_approval to approved to claimed to executing to succeeded/failed/rejected/expired`; stale-claim reaper; approval UI showing live current policy + proposed change + data freshness, blocking approval on stale data; HMAC signing over `node_pubkey + command_id + action_type + canonical(params) + expires_at` (lowercase hex); per-node secret design (format + location decided here, delivered Phase 7); TTL to `expired` transition; single-statement CTE atomic claim verified against stub overlapping-tick test.
**Avoids:** Double-apply (atomic CTE), replay/cross-apply (full-field HMAC), stale intents (TTL), approving against stale data (freshness block in approval UI).
**Research flag:** Needs planning research for `nodemon` DB schema exact shape and state machine edge cases (stale-claim timeout values, TTL duration for fee changes).

### Phase 7: Node Scripts + Heartbeat
**Rationale:** The only phase touching real nodes and credentials. Build on the proven queue from Phase 6. Mirror the existing fleet downloader/cron pattern exactly. Pilot on one node before fleet rollout.
**Delivers:** `check-queue` bash script (identity-scoped atomic claim; HMAC verify over identical canonical form; fail-closed expiry; bounds re-enforcement mirroring gateway `Limits`; lncli/lncmd via argv not shell string; result + audit write-back); `apply-fee` action handler; runtime pubkey self-check at startup; remote fileserver + bash downloader delivering scripts + crontab + per-node HMAC secret; per-node write rate-limit; stale-claim recovery.
**Avoids:** Wrong-pubkey execution, param injection, bounds bypass, tool-triggered AP-12b.
**Research flag:** Needs planning research — specifically: exact form of the existing fleet downloader/cron (operator-provided), exact `lncmd`/`lncli` flag shapes for `updatechanpolicy` on LND and LDK equivalent.

### Phase 8: Hardening + VM Deploy
**Rationale:** Everything upstream delivers value locally; this phase makes it production-grade and VM-accessible.
**Delivers:** Grade-A security scan (no CRITICAL/HIGH before deploy); VM flip (env-only, no code changes); scheduled recommendation refresh; server-side caching; optional RBAC/multi-operator; tuned heartbeat interval; secret rotation automation; monitoring for stale-claim rate + write-batch size.
**Research flag:** Security scan tooling choice needs planning research. Otherwise standard hardening work.

### Phase Ordering Rationale

- Phases 1 through 3 are read-only and deliver standalone value; they also validate the analytics foundation that every subsequent phase depends on. DISTINCT ON / formatter correctness must be proven before the insight engine computes thresholds on top of it.
- Phase 4 is the architectural fork point: its card schema contract must be frozen before either Prong 2 (Phase 5) or Prong 1 (Phase 6) is built. Self-guardrails belong here, not in the write path.
- Phase 5 before Phase 6 is correct: Prong 2 delivers actionable close/rebalance capability with zero write-path risk while the higher-complexity queue is still being built.
- Phase 6 proves the queue with a stub before Phase 7 adds real creds. The state machine, HMAC, TTL, and atomic claim must all be verified in isolation before a live node is in the loop.
- Phase 7 pilots on one node before fleet rollout. The existing downloader/cron pattern is the primary risk-reducer for this phase.

### Research Flags

Phases needing deeper research during planning:
- **Phase 4:** AP-11/AP-12/force-close threshold values from `lqwdLogs/_library`; fee-crash/earnings-step-down threshold derivation from France PPM-crash data; fleet-temporal-correlation algorithm design
- **Phase 6:** `nodemon` DB schema exact shape; state machine edge cases and TTL duration; HMAC canonical payload field set frozen as a spec
- **Phase 7:** Existing fleet downloader/cron form (operator-provided); exact `lncmd`/`lncli` flag shapes for `updatechanpolicy` on LND and LDK equivalent

Phases with well-documented standard patterns (skip research-phase):
- **Phase 1:** Drizzle connection setup, DISTINCT ON idiom, postgres.js pool config — all well-documented; verified against lqwdclaw production
- **Phase 2 / Phase 3:** Read-only scorecard and console views — standard Next.js App Router RSC patterns
- **Phase 5:** Client-side string generation — deterministic; no external dependencies
- **Phase 8:** VM deploy is env-only flip by design; security scan tooling is the only open question

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Every choice verified against lqwdclaw production `package.json` + npm registry. Recharts 3.8.1 React 19 peer deps confirmed. HMAC interop verified against Node.js crypto docs. |
| Features | HIGH (single-node) MEDIUM (fleet-native) | Single-node feature set verified against ThunderHub/RTL/LNDg/litd/Torq official docs. Fleet-native features (cross-node comparison, temporal correlation) are derived from first principles and operator incident history — no external reference tool implements them. |
| Architecture | HIGH | Queue-as-handoff, SKIP LOCKED atomic claim, HMAC full-field binding, and read-replica role isolation all verified against Postgres queue literature and HMAC replay-attack literature. |
| Pitfalls | HIGH | AFM-001 and AFM-002 are operator-documented real failures. AP-11/AP-12 are operator-documented fleet incidents with timestamps. All other pitfalls verified against Postgres queue idioms, OWASP injection guidance, and Next.js App Router docs. |

**Overall confidence:** HIGH

### Gaps to Address

- **Fee-crash/earnings-step-down threshold:** The France PPM-crash ($1,150 over 4 months) is documented but the exact signal threshold is not defined. Derive during Phase 4 planning from France node review data.
- **Fleet-temporal-correlation algorithm:** The 2024-09-09 cascade proof-of-concept is established but the exact detection algorithm (time window, node-count threshold) is not specified. Design during Phase 4 planning.
- **`nodemon` DB exact schema:** Command/execution/audit table field sets are logically defined but not yet schema-specified. Freeze as a spec artifact in Phase 6 planning before implementation.
- **Existing fleet downloader/cron form:** Operator will point to the implementation in Phase 7. Do not assume shape; read it before designing the script distribution mechanism.
- **PgBouncer / transaction-pooler on warehouses:** Research recommends `prepare: false` on postgres.js clients if the warehouse sits behind a transaction-mode pooler. Confirm during Phase 1 setup which connection mode the warehouse uses.
- **`lncmd` LDK `updatechanpolicy` equivalent:** LND uses `lncli updatechanpolicy`; the LDK/lncmd equivalent flag shape is not confirmed in the research. Verify during Phase 7 planning against current lncmd docs/source.

---

## Sources

### Primary (HIGH confidence)
- `lqwdclaw/package.json` (this workspace) — production-proven version set: Next 16.1.6, React 19.2.3, Drizzle 0.45.1, postgres 3.4.8, ai 6.0.116, shadcn 4.0.2, Tailwind v4
- `lqwdLogs/_library/analytical-failure-modes.md` — AFM-001 (DISTINCT ON), AFM-002 (sat/BTC), Canada 2026-05-26 review (operator-documented real failures)
- `lqwdLogs/_library/operational-anti-patterns.md` — AP-11 (France/Sweden/India 2024-09-09 cascade), AP-12a/b (SouthAfrica/Japan PG contention)
- `.planning/PROJECT.md` + `~/.claude/plans/vast-popping-starlight.md` — approved spec; locked architecture decisions
- `reference_lqwd_databases.md` (workspace memory) — `grafana_demo_ro` role, 13 tables, `fee_msat/1000.0` convention
- npm registry (`npm view`) — current versions: recharts 3.8.1, next 16.2.7, drizzle-orm 0.45.2, tailwindcss 4.3.0
- https://orm.drizzle.team/docs/get-started/postgresql-existing — `drizzle-kit pull` introspection workflow for existing DBs
- https://nodejs.org/api/crypto.html — `createHmac`, `digest('hex')`, `timingSafeEqual`
- https://github.com/recharts/recharts/wiki/3.0-migration-guide — React 19 native peer support confirmed in v3

### Secondary (MEDIUM confidence)
- https://www.netdata.cloud/academy/update-skip-locked/ + https://www.dbpro.app/blog/postgresql-skip-locked — FOR UPDATE SKIP LOCKED canonical queue idiom
- https://dev.to/daniel_romitelli_44e77dc6/the-queue-was-a-table-... — stale-claim recovery + retry cap patterns
- https://thomasrones.com/technical/system-design/hmac-timestamp-nonce/ — HMAC replay-attack prevention (nonce + expiry binding)
- https://ui.shadcn.com/docs/tailwind-v4 — Tailwind v4 + React 19 GA status confirmed
- ThunderHub/RTL/LNDg/litd/Torq official docs — feature matrix verification
- France/Sweden/Japan/India node reviews (project memory) — AP-11/AP-12 incident data

### Tertiary (LOW confidence)
- Faraday close-recommendation model — relevant for comparison only; NodeMonitor's detector approach is independent
- OWASP Command Injection — confirmed argv-not-shell-string as the prevention; standard reference

---
*Research completed: 2026-06-05*
*Ready for roadmap: yes*
