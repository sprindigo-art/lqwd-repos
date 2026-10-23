# NodeMonitor

## What This Is

NodeMonitor is a local-first **node-operator control tool** for the LQWD ~26-node Lightning fleet (mixed LND routing nodes and LDK/LSPD nodes). It combines the active controls of Lightning Terminal / ThunderHub (fee/policy updates, channel closes, rebalances) with curated, action-relevant analytics drawn from the fleet's existing warehouses — surfacing which nodes and channels need attention and why, then letting the operator act safely. It is explicitly **not** a Grafana replacement: it carries just enough analytics to justify and target actions, and hides the firehose detail that doesn't drive a decision.

## Core Value

Every recommended action must be **safe and accountable** — fee changes apply only via signed, operator-approved intents executed with on-node credentials; higher-risk closures/rebalances are exported as commands a human runs. The dashboard never holds node credentials and never silently mutates the fleet.

## Current Milestone: v2.0 Operations Center

**Goal:** Evolve NodeMonitor from a Lightning-node tool into a full-stack **Fleet Operations Center** — rebuilt on a new premium "Data-Forward" design system (retiring the NOC-instrument look), watching hosts/services/bitcoind/storage alongside the nodes, with an AI explanation layer. Reuses the v1 backend; replaces the v1 UI.

**Target features:**
- Design-system foundation — Data-Forward tokens/components; retire the NOC-instrument look
- Ops Center overview — full-stack attention queue + AI "what needs you now" summary
- Nodes list + Node Detail (rebuilt) — Node Detail adds the per-node control-plane service-health grid (two-axis: running + functioning)
- Hosts list + Host Detail — VM/infra monitoring (CPU/mem/disk, storage time-to-full, infra services)
- Service Detail — per-service two-axis health, log tail, restart history, AI read
- Incident Detail + alert lifecycle — blast-radius/why-chain, root-cause grouping, acknowledge/assign/snooze
- AI explanation layer — advisory log/error analysis + prioritization (never emits commands)
- Full-stack telemetry ingestion — host/service/bitcoind/storage signals (builds on Phase 8 heartbeat)

**Reuses (v1 backend, do not rebuild):** P1 read-data layer, P4 insight engine, P5 command export, P6 command queue, P8 node-scripts/heartbeat. **Replaces (v1 UI):** overview (P2), per-node console (P3), inbox (P7) — rebuilt on the new system.

**Design source of truth:** locked claude.ai/design project "LQWD Fleet Alert Dashboard" (`372850ad-bbae-46da-a40f-3eb3d03befa0`) — 7 verified screens, Data-Forward direction. See `.planning/DESIGN-BRIEF-*.md` and memory `design-direction-bold-rethink` / `node-architecture-and-services`.

## Requirements

### Validated

- [x] Read-only fleet data from `routing_vm` (LND) + `ldk-lspd-main` (LDK) warehouses via Drizzle, honoring `fee_msat/1000.0` and latest-per-`chan_id` conventions — Validated in Phase 1 (foundations) and Phase 2 (live D-14 golden gate)
- [x] Fleet overview + per-node 10-dimension health scorecard, curated to operator-relevant signals — Validated in Phase 2: Fleet Overview + Health Scorecard (verification passed 32/32; UI polish debt tracked in todos)
- [x] Per-node console: channels, fee report, liquidity balance, forwards, closes, peers (LND + LDK through one model), CSV export, fleet-wide pending-channel monitor — Validated in Phase 3: Per-Node Console + Pending Monitor (verification 4/4; gap-closure gate operator-approved at 03-16; live golden 2/2 across all 10 nodes; NODE-01/NODE-02/PENDING-01 closed)

### Active


- [ ] Deterministic insight engine: AP-11 / AP-12 / force-close / fee / rebalance recommendation cards from `lqwdLogs/_library` thresholds
- [ ] Optional LLM narrative layer over flagged recommendation cards (off by default)
- [ ] Command export (Prong 2): copy-paste `lncli`/`lncmd` for closures + rebalances with context + safety notes
- [ ] Command queue (Prong 1): signed `nodemon` DB intents + operator-approval UI for `update_fee`
- [ ] Node-side execution: scripts folder + bash downloader + crontab heartbeat that applies approved `update_fee` jobs and writes results back
- [ ] Local now, VM-ready by design (config-driven DB URLs, no localhost assumptions)

### Out of Scope

- The AI-operated faucet node (`LQWD-AI-Launchpad` / `lnd-gateway`) — AI runs it; not monitored or managed here
- SaturnZap — not on any fleet node
- Queue actions beyond `update_fee` — closures/rebalances stay export-only until stricter gates exist (hardening phase)
- Deposits / withdrawals / custodial flows — faucet-only ethos, no custodial risk
- Persistent daemon/agent/AI on the nodes — execution is cron + pre-downloaded bash only
- Replacing Grafana / exhaustive panel parity — curated operator signals only

## Context

- **Approved design spec:** `~/.claude/plans/vast-popping-starlight.md` — full architecture, component breakdown, and 8-phase build plan. Primary source of truth for this project.
- **Existing data sources (read):** `routing_vm` + `ldk-lspd-main` Postgres at `192.243.215.101`, read-only `grafana_demo_ro` role (13 tables: `lnd_node_info`, `lnd_node_forwards`, `lnd_node_channel_info`, `lnd_node_closed_channels`, `lnd_node_pending_channels`, `lnd_node_pending_sweeps`, `lnd_node_peer_info`, `internal_rebalance_invoices`, `price_usd_cad`, `lnd_restart`, …). Same warehouse the demo Grafana mirror reads.
- **Encoded insight (reuse):** `lqwdLogs/_library/` — `healthy-range-bands.md`, `operational-anti-patterns.md` (AP-11 close-storm ≥50/hr; AP-12a connection-exhaustion; AP-12b serialization-storm), `force-close-prevention.md`, `cross-node-monitoring-matrix.md`, and `scripts/force-close-analyzer.sql`. These are the source of all thresholds and recommendation logic.
- **Execution pattern (reuse):** node-side cron heartbeat + remote-fileserver + bash downloader is the **same mechanism already running on the LND fleet** — mirror it rather than invent new infra. Operator will point to the current downloader/cron implementation during the execution phase.
- **Action semantics (reference only):** `lqwdclawnode/lnd-gateway/internal/handlers/` (fee/close/rebalance semantics, `Limits`, confirm flow) — pattern reference for param bounds; not a runtime dependency.
- **Known analytics failure modes:** never `WHERE timestamp = MAX(timestamp)` on event-driven `lnd_node_channel_info`; never eyeball sat→BTC. See `lqwdLogs/_library/analytical-failure-modes.md`.

## Constraints

- **Tech stack**: Next.js (App Router) + TypeScript + Drizzle (read-only to warehouses; read-write only to the `nodemon` queue DB) + Tailwind v4 + shadcn/ui — matches existing `lqwdclaw` conventions (`@/` imports, named exports, Drizzle-only queries). Per-node scripts in bash; action scripts may shell to `lncli`/`lncmd`.
- **Security**: Grade-A scan required before any production deploy (no CRITICAL/HIGH). Dashboard holds zero node credentials; command rows HMAC-signed; node re-enforces param bounds; approved-only execution; atomic claim to prevent double-apply.
- **Deploy**: Local now, VM-ready by design — boots from env-var DB URLs only.
- **Brand**: LQWD navy `#1A3C79` (not Bitcoin orange `#F7931A`). NOC Light theme (light-first) — operator-approved supersession of the original dark default in Phase 3 gap closure (03-10).
- **Process**: No co-authored-by trailers on commits; branch-per-task; multi-agent / parallel execution to expedite development.
- **Repo**: NodeMonitor is its own git repo nested in the `ClaudeCode/` workspace (like `lqwdclaw`/`lqwdclawnode`), with its own `.planning/`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Instruction-queue (pull) + command-export for writes | No node creds on dashboard; nodes only need outbound access; unifies LND+LDK; durable audit/approval | — Pending |
| Node-side cron heartbeat executes (no daemon/agent/AI on nodes) | Mirrors existing LND-fleet downloader/cron pattern; creds stay on-node; outbound-only | — Pending |
| Tiered actions: fees remote (queue), closures/rebalances exported | Smallest safe write surface for v1; human-in-loop on high-risk ops | — Pending |
| Deterministic rules + optional LLM narrative | Recommendations reproducible/auditable; LLM only narrates | — Pending |
| Both fleets in scope (routing_vm + ldk-lspd-main) | Full fleet coverage; per-node agent abstracts LND vs LDK | — Pending |
| Own git repo + local .planning | Matches workspace submodule convention; clean separation from NodeOps GSD project | ✓ Good |
| Multi-agent / parallel build to expedite | User-requested; speeds delivery while keeping quality gates on | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-22 — started milestone v2.0 Operations Center (full-stack redesign on the Data-Forward design system; continuation milestone, phases 01–08 preserved)*
