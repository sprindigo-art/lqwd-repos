# Roadmap: NodeMonitor

## Overview

NodeMonitor is built in dependency order as nine horizontal layers, each delivering standalone operator value before the next is stacked on top. The journey starts by sealing the analytics foundation — three least-privilege Drizzle clients, the AFM-001 `DISTINCT ON` helper, and the AFM-002 unit formatter — so every read above it is correct by construction. From there it builds the fleet overview and per-node console (pure read-only value), then the deterministic insight engine whose recommendation-card schema becomes the hard contract both write prongs consume. The zero-risk command-export prong ships before the higher-complexity signed queue, which is proven end-to-end against a stub executor before any real node credential exists. A focused inbox-triage rebuild then makes the ~500-card recommendation surface scannable and bulk-actionable (severity spine + facet rail + in-place detail drawer). Only then do node-side scripts and the cron heartbeat touch a live pilot node. The final phase makes it production-grade: a Grade-A security scan and an env-only local-to-VM flip. The credential-less, operator-approved, signed-intent architecture means every recommended write is safe and accountable — and the fleet is never silently mutated.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundations + Read Layer** - Next.js scaffold, three least-privilege Drizzle clients, AFM-001/AFM-002 guards, unified LND+LDK model, boot-time health check (completed 2026-06-09)
- [x] **Phase 2: Fleet Overview + Health Scorecard** - Fleet overview, 10-dimension scorecard, cross-node comparison vs fleet-median bands (completed 2026-06-10)
- [x] **Phase 3: Per-Node Console + Pending Monitor** - Per-node channels/fees/liquidity/forwards/closes/peers, CSV export, pending-channel monitor (plans 16/16 executed 2026-06-11; gap-closure gate PASSED — operator approved at 03-16, all 4 gaps closed, live golden confirmed; completed 2026-06-11)
- [x] **Phase 4: Insight Engine** - Frozen card-schema contract, deterministic AP-11/AP-12/force-close/fee/rebalance detectors, triage inbox, self-guardrails, optional LLM narrative (completed 2026-06-12)
- [x] **Phase 5: Command Export (Prong 2)** - Client-side close/rebalance command export + pending remediation runbooks, zero write-path risk (plans 6/6 executed 2026-06-15; phase gate PASSED — operator approved "approved looks good"; completed 2026-06-15)
- [x] **Phase 6: Command Queue + Approval UI (Prong 1)** - nodemon DB, HMAC envelope, operator approval gate, append-only audit, state machine proven against a stub executor (completed 2026-06-16)
- [x] **Phase 7: Inbox Triage Rebuild** - Rebuild /inbox from one ~531-row scroll into a triage cockpit: severity spine + collapsible facet rail + in-place detail/act drawer + bulk-enqueue through the signed queue (sketch 005 winner E) [INSERTED 2026-06-16] (completed 2026-06-17)
- [ ] **Phase 8: Node Scripts + Heartbeat** - Scripts folder + bash downloader mirroring the existing fleet cron pattern, node-side HMAC verify + bounds re-enforcement, pilot-node end-to-end
- [x] **Phase 9: Hardening + VM Deploy** — FOLDED INTO PHASE 16 (never built; one combined v1+v2 hardening pass) (completed 2026-07-16)

## Phase Details

### Phase 1: Foundations + Read Layer

**Goal**: A correct, credential-safe read foundation that every later phase inherits — both warehouses connected read-only, analytics failure modes sealed, LND and LDK unified into one model.
**Depends on**: Nothing (first phase)
**Requirements**: READ-01, READ-02, READ-03, READ-04
**Success Criteria** (what must be TRUE):

  1. App boots from env-var DB URLs only (no `localhost` literals) and runs a boot-time health check that fails loudly if either warehouse is unreachable or not read-only.
  2. Three Drizzle clients exist on three least-privilege roles (2 RO warehouses + 1 RW `nodemon`); `import "server-only"` guards every DB/credential module and no connection string reaches a client bundle.
  3. The only sanctioned latest-state query is a `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC` helper; a unit test reproduces the Canada reference channel count and cross-validates against `lnd_node_info.active_channels`.
  4. Every sat/BTC/fee value renders through a single unit formatter (`fee_msat/1000.0`, correct sat→BTC), unit-tested against known `lqwdLogs` reference values, with no ad-hoc conversions anywhere.
  5. LND and LDK node data normalize into one unified per-node model so UI components render both fleets identically.

**Plans**: 4 plans in 4 waves

- [x] 01-01-PLAN.md — Scaffold + Vitest + AFM-002 formatter (READ-03)
- [x] 01-02-PLAN.md — Three Drizzle clients on three roles + boot health check + role-grants.sql (READ-01)
- [x] 01-03-PLAN.md — LDK introspection + curated warehouse schemas + AFM-001 DISTINCT ON helper + golden invariant (READ-02)
- [x] 01-04-PLAN.md — Unified LND+LDK model + thin status page (READ-04)

**UI hint**: yes

### Phase 2: Fleet Overview + Health Scorecard

**Goal**: The operator's "where do I look first" entry point — every node ranked at a glance, scored on 10 curated dimensions, compared against the rest of the fleet.
**Depends on**: Phase 1
**Requirements**: FLEET-01, FLEET-02, FLEET-03
**Success Criteria** (what must be TRUE):

  1. Operator sees a fleet overview listing all nodes with at-a-glance health, curated to operator-relevant signals (not a Grafana firehose), each with a freshness stamp.
  2. Operator sees a per-node 10-dimension health scorecard (stability, PG health, restart, peer, routing, force-close prevention, channel health, revenue, liquidity, visibility) computed from the warehouse.
  3. Operator can compare each node against fleet-median bands, surfacing outliers relative to peers rather than absolute thresholds alone.
  4. Scorecard numbers validate against known `lqwdLogs` reference values for at least one known node before any downstream phase acts on them.

**Plans**: 7 plans in 4 waves

- [x] 02-01-PLAN.md — Type 5 routing_vm tables + latestNodeInfo DISTINCT ON helpers (the append-only landmine fix)
- [x] 02-02-PLAN.md — Scorecard contracts + D-02 tunable config + backend map + grade/MAD/freshness pure layer
- [x] 02-03-PLAN.md — Dimensions: routing, revenue, liquidity, channel health (AFM-001/002 discipline)
- [x] 02-04-PLAN.md — Dimensions: force-close (AP-11 metric), restart recency, peer (partial)
- [x] 02-05-PLAN.md — shadcn init + status token palette + 6 presentational scorecard components
- [x] 02-06-PLAN.md — loadFleetView assembly (D-09 sort, cohorts, freshness) + D-14 Canada golden gate
- [x] 02-07-PLAN.md — Fleet overview + per-node scorecard pages + visual verification checkpoint

**UI hint**: yes

### Phase 3: Per-Node Console + Pending Monitor

**Goal**: Drill into one node's full operational detail and see every pending channel across the fleet — the read detail the fleet overview points at.
**Depends on**: Phase 2
**Requirements**: NODE-01, NODE-02, PENDING-01
**Success Criteria** (what must be TRUE):

  1. Operator can drill into one node and view its channels, fee report, liquidity balance, forwards, closes, and peers — LND and LDK through the same components.
  2. Operator can export any per-node table (channels, forwards, closes, fees) to CSV for accounting/audit.
  3. Operator sees all pending channels — pending opens, coop-closes, and force-closes — per node and fleet-wide, with state, age, limbo/time-locked balance, and (for sweeps) `broadcast_attempts`, built from `lnd_node_pending_channels` + `lnd_node_pending_sweeps`.
  4. Every console and pending view carries a data-freshness indicator.

**Plans**: 16 plans (9 executed + 7 gap-closure in 5 waves)

- [x] 03-01-PLAN.md — Pending data foundation: typed pending tables, console config, sanctioned recency reader + golden invariant (PENDING-01)
- [x] 03-02-PLAN.md — Hand-rolled RFC-4180 CSV serializer + provenance/filename safety (NODE-02)
- [x] 03-03-PLAN.md — D-14 density pass: dot+letter grade unit, tile re-layout, one micro size (folded Phase-2 polish)
- [x] 03-04-PLAN.md — Console read layer: windowed forwards/closes + static-tab shapers + counterparty peers (NODE-01)
- [x] 03-05-PLAN.md — Vendored tabs/button + console component kit (ConsoleTabs, WindowPicker, SummaryStrip, CapBanner, EventTable, PendingBoard, ExportButton)
- [x] 03-06-PLAN.md — Tabbed console pages: /{pubkey} redirect, validated [tab] route, all 8 panels, tile deep links, modal console link (NODE-01)
- [x] 03-07-PLAN.md — CSV export route handler: full-window, provenance-stamped, injection-safe (NODE-02)
- [x] 03-08-PLAN.md — Fleet /pending board + overview PENDING triage block (PENDING-01)
- [x] 03-09-PLAN.md — Phase gate: full suite + live golden + security greps + operator visual checkpoint
- [x] 03-10-PLAN.md — Gap closure: NOC Light theme foundation + sketch fonts + light masthead chrome (gap 4 foundation)
- [x] 03-11-PLAN.md — Gap closure: daily trend-series read layer for evidence-panel sparklines
- [x] 03-12-PLAN.md — Gap closure: severity-tinted grade chip + plain-text breach/stale/outlier signals (gaps 1+2)
- [x] 03-13-PLAN.md — Gap closure: fleet Attention Queue + dot-free pending surfaces (gaps 3+4, fleet)
- [x] 03-14-PLAN.md — Gap closure: console panel components — Active Signals, rail, evidence panels, sparkline
- [x] 03-15-PLAN.md — Gap closure: console wiring — 3-slot header, tab pending count, modal signal severance (gaps 3+4, console)
- [x] 03-16-PLAN.md — Gap closure: re-run gate battery + operator visual re-verification checkpoint

**UI hint**: yes

### Phase 4: Insight Engine

**Goal**: Turn warehouse rows into deterministic, severity-ranked recommendation cards whose schema is a frozen hard contract — and which never recommend an action that reproduces a pattern it detects.
**Depends on**: Phase 3
**Requirements**: INSIGHT-01, INSIGHT-02, INSIGHT-03, INSIGHT-04, INSIGHT-05, INSIGHT-06, INSIGHT-07, PENDING-02
**Success Criteria** (what must be TRUE):

  1. The engine emits structured cards `{severity, node, target, signal, evidence, suggested_action, params}` from `lqwdLogs/_library` thresholds, and that schema is frozen as a hard contract before Phase 5 or Phase 6 consumes it.
  2. Deterministic detectors fire with correct severity + evidence for AP-11 close-storm (≥50 self-closes/hr), AP-12a connection-exhaustion, AP-12b serialization-storm, force-close HTLC-timeout signature, fee signals (raise/lower/close-candidate), and rebalance-success signals.
  3. A fee-crash / earnings-step-down detector flags sudden per-node fee-revenue collapse, and a fleet-wide temporal correlation detector flags same-hour multi-node close clusters (the AP-11 cascade signature).
  4. The stuck-pending detector flags force-close-past-maturity, stuck-sweep, and stuck-open cases with evidence and severity; these cards surface in one fleet-wide severity-ranked triage inbox ranked by limbo balance at risk.
  5. The engine suppresses write recommendations to any node currently flagged AP-11/AP-12 and applies fee hysteresis + per-node write rate-limit guidance; the optional LLM narrative is off by default, narrates only, and never produces or alters numeric params.

**Plans**: 12 plans in 6 waves

- [x] 04-01-PLAN.md — Frozen card schema: versioned types + zod validators + fixture contract test (INSIGHT-01, D-01..D-04)
- [x] 04-02-PLAN.md — INSIGHT_CONFIG (reads SCORECARD_CONFIG, D-13) + D-06 deterministic rank + validated deep-link builder
- [x] 04-03-PLAN.md — AP-11 close-storm detector (fleet reuse) + fleet-wide same-hour close-cluster detector (D-10)
- [x] 04-04-PLAN.md — Force-close HTLC-timeout signature detector
- [x] 04-05-PLAN.md — Fee signals (raise/lower/close-candidate) + D-09 fee step-down detector with France golden fixture
- [x] 04-06-PLAN.md — Rebalance-success detectors + stuck-pending detector ranked by limbo at risk (PENDING-02)
- [x] 04-07-PLAN.md — Fee-history reader + guardrails: AP-11 suppression (D-14), hysteresis (D-15), rate-limit guidance (D-16)
- [x] 04-08-PLAN.md — LLM narration layer: provider, narrateCards, AP-12 advisory cards + placeholder, NarrateButton (D-11/D-12/D-17)
- [x] 04-09-PLAN.md — Engine assembly: loadInsightView + schema parse gate + live golden test + narrate wiring (D-07/D-08)
- [x] 04-10-PLAN.md — /inbox triage page + insight card components (D-05, INSIGHT-03)
- [x] 04-11-PLAN.md — Console integration: insight rows in Active Signals + per-node narrate (D-08, D-17)
- [x] 04-12-PLAN.md — Phase gate: full suite + AFM re-verification + live golden + operator visual checkpoint

**UI hint**: yes

### Phase 5: Command Export (Prong 2)

**Goal**: Give the operator ready-to-run, fully-parameterized close/rebalance commands and pending-remediation runbooks — with zero write path — so destructive actions are actionable before the queue exists.
**Depends on**: Phase 4
**Requirements**: EXPORT-01, PENDING-03
**Success Criteria** (what must be TRUE):

  1. For closures and rebalances, operator gets a ready-to-run, fully-parameterized `lncli` (LND) / `lncmd` (LDK) command with context + safety notes (peer alias, capacity, current timelock, chan_id echo-back), generated purely client-side with no DB or write path.
  2. For each stuck-pending case, operator gets an exported remediation command/runbook — stuck sweep → `lncli wallet bumpfee`/CPFP with outpoint + suggested sat/vB; force-close-past-maturity → the safe coordinated-restart procedure (drain-wrapper reference), explicitly NOT an auto-restart.
  3. Every exported command echoes its full context (chan point, peer, limbo amount, age, attempts) and safety notes, with params validated against strict type/range before rendering (no injection).

**Plans**: 6 plans in 5 waves

- [x] 05-01-PLAN.md — Export foundation: ExportBlock contract + comment sanitizer + two-gate param validator (injection suite)
- [x] 05-02-PLAN.md — Detector detail enrichment: capacitySat / peerAlias / partnerAlias, zero new queries, frozen schema untouched
- [x] 05-03-PLAN.md — Pure command builders: lncli close blocks, rebalance honest placeholder, LDK fallback, 3 PENDING-03 runbooks
- [x] 05-04-PLAN.md — CommandExport client leaf (expand + copy per UI-SPEC) + /inbox card-row mount
- [x] 05-05-PLAN.md — Console surface: SignalRow.exportBlock threading + Active Signals mount (one component, both surfaces)
- [x] 05-06-PLAN.md — Phase gate: full suite + zero-write-path grep battery + operator visual checkpoint

**UI hint**: yes

### Phase 6: Command Queue + Approval UI (Prong 1)

**Goal**: A durable, signed, operator-gated `update_fee` queue whose full state machine is proven correct against a stub executor before any real node credential exists.
**Depends on**: Phase 5
**Requirements**: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04
**Success Criteria** (what must be TRUE):

  1. Operator can enqueue an `update_fee` intent from a recommendation card into the `nodemon` DB; it is created `pending_approval` and does nothing until explicitly approved.
  2. Each queued command is HMAC-signed (SHA-256, lowercase hex, key-sorted canonical JSON) over `node_pubkey + command_id + action_type + canonical(params) + expires_at` with a per-node secret whose format/location is designed here (delivered by Phase 7).
  3. Operator approves/rejects in the UI (which shows live current policy, proposed change, and data freshness, blocking approval on stale data); only `approved` commands are execution-eligible; every transition is recorded in an append-only audit table.
  4. The full state machine (`draft→pending_approval→approved→claimed→executing→succeeded|failed|rejected|expired`) is proven against a stub executor with atomic `SELECT … FOR UPDATE SKIP LOCKED` claim, fail-closed TTL→`expired` expiry, and a stale-claim reaper — including an overlapping-tick no-double-apply test.

**Plans**: 7 plans in 5 waves

- [x] 06-01-PLAN.md — nodemon schema (commands/executions/audit + state pgEnum) + [BLOCKING] generate/migrate + HMAC env contract freeze (QUEUE-01/03/04)
- [x] 06-02-PLAN.md — Pure crypto/contract core: canonicalizer + server-only HMAC signer/verify + update_fee bounds + state transition table, each tested (QUEUE-02/03)
- [x] 06-03-PLAN.md — Server-only write services: transactional enqueue (sign-once) + approve/reject transitions with audit + live-nodemon fixture (QUEUE-01/03)
- [x] 06-04-PLAN.md — QUEUE-04 heart: atomic FOR UPDATE SKIP LOCKED claim + fail-closed TTL + stale-claim reaper + stub executor, overlapping-tick no-double-apply proof (QUEUE-04)
- [x] 06-05-PLAN.md — Enqueue write path UI: queue server actions + EnqueuePreview leaf + mount on both card surfaces (QUEUE-01/03)
- [x] 06-06-PLAN.md — Approval surface: /queue page (live AFM-001 diff + freshness) + ApprovePanel (stale-ack gate) + QueueTimeline + vendored checkbox (QUEUE-03)
- [x] 06-07-PLAN.md — Phase gate: full suite + QUEUE-04 concurrency/TTL/reaper proof + security greps + build + operator visual checkpoint (QUEUE-01..04)

**UI hint**: yes

### Phase 7: Inbox Triage Rebuild

**Goal**: Rebuild the `/inbox` recommendation surface from one ~531-row scroll into a triage cockpit — emergencies surface on load, the routine fee bulk collapses, and acting (including bulk-enqueue through the signed queue) happens in place.
**Depends on**: Phase 6 (signed queue + insight cards)
**Requirements**: INBOX-01, INBOX-02, INBOX-03, INBOX-04
**Success Criteria** (what must be TRUE):

  1. On load with the live fleet dataset, critical + warn cards render as individual scannable rows above the fold and routine/info (fee) cards are collapsed into expandable per-signal → per-node count groups — the page does NOT render every card as a flat list, and no card is dropped (suppressed cards stay visible with their reason verbatim).
  2. A collapsible facet rail filters the inbox by severity, node, signal, and suggested action with live counts; facets combine to narrow the spine; toggling the rail off yields a full-width view.
  3. Selecting a card opens an in-page detail drawer with its full evidence (metric, observed vs threshold, window, freshness/trend) and its suggested-action affordance, without navigating away from the inbox.
  4. Fee-update groups expose a bulk-enqueue action (per-node and/or multi-select) that enqueues many `update_fee` intents in one gesture through the Phase-6 signed queue — each re-validated and re-signed server-side (no client signature), honoring AP-11/AP-12 write suppression and per-node rate-limit guidance.
  5. The rebuild stays within the validated NOC Light design language (severity color is state-only, navy is structural/act-only, mono data, no icons-for-state) per sketch 005 winner E.

**Plans**: 5 plans in 4 waves

- [x] 07-01-PLAN.md — Pure triage core (partition/facet/series) + facet codec + vendor Sheet (INBOX-01/02/03)
- [x] 07-02-PLAN.md — enqueueBatch sibling action: loop existing path, best-effort tally, no rollback (INBOX-04)
- [x] 07-03-PLAN.md — Server rebuild: spine + info groups + suppressed block + facet rail + page shell (INBOX-01/02)
- [x] 07-04-PLAN.md — Client islands: URL-synced Sheet drawer + multi-select + batch confirm (INBOX-03/04)
- [x] 07-05-PLAN.md — Phase gate: full suite + live golden + security greps + build + operator visual checkpoint

**UI hint**: yes

### Phase 8: Node Scripts + Heartbeat

**Goal**: The only phase touching real nodes — node-side scripts and a cron heartbeat that safely apply approved `update_fee` jobs, validated end-to-end on one pilot node.
**Depends on**: Phase 6 (signed queue)
**Requirements**: EXEC-01, EXEC-02, EXEC-03
**Success Criteria** (what must be TRUE):

  1. A scripts folder (`check-queue` + `apply-fee`) + bash downloader, deployed via the existing fleet remote-fileserver pattern, installs/updates a node's crontab heartbeat with no persistent daemon/agent/AI on the node.
  2. On each tick a node reads only its own pubkey's `approved` jobs, verifies the HMAC over the identical canonical form, re-enforces param bounds node-side, applies via local `lncli`/`lncmd` using argv invocation (never shell-string interpolation), and writes result + execution row + audit back, under a per-node write rate-limit.
  3. End-to-end validated on one pilot node: an approved `update_fee` applies and reports `succeeded` with the new policy visible on-node; and the five failure modes are rejected/handled — tampered HMAC, un-approved row, expired command, overlapping ticks (no double-apply), wrong-pubkey job.

**Plans**: 4 plans in 3 waves

- [x] 08-01-PLAN.md — Foundation: freeze update_fee bounds + nodemon_node role & FORCE-RLS in db/role-grants.sql (EXEC-02)
- [x] 08-02-PLAN.md — Node executor (check-queue + apply-fee) as bash ports of claim.ts/stub-executor.ts/sign.ts + seeded 5-failure-mode proof harness (EXEC-02/03)
- [x] 08-03-PLAN.md — Distribution rail: nodemonDownload.sh + run_check-queue.sh + CRON_JOB_11 */5 crontab snippet (EXEC-01)
- [ ] 08-04-PLAN.md — Live canary apply + revert (operator-gated) + A1/A2 build confirmation (EXEC-03)

### Phase 9: Hardening + VM Deploy — FOLDED INTO PHASE 16

**Status**: Never built. Folded into **Phase 18 (Hardening + VM Deploy, v1 + v2)** — running one comprehensive hardening pass over both v1 and v2 surfaces instead of two. HARDEN-01/HARDEN-02 now map to Phase 18.
**Requirements**: HARDEN-01, HARDEN-02 → see Phase 18

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations + Read Layer | 4/4 | Complete   | 2026-06-09 |
| 2. Fleet Overview + Health Scorecard | 7/7 | Complete   | 2026-06-10 |
| 3. Per-Node Console + Pending Monitor | 16/16 | Complete   | 2026-06-11 |
| 4. Insight Engine | 12/12 | Complete   | 2026-06-12 |
| 5. Command Export (Prong 2) | 6/6 | Complete   | 2026-06-15 |
| 6. Command Queue + Approval UI (Prong 1) | 7/7 | Complete   | 2026-06-16 |
| 7. Inbox Triage Rebuild | 5/5 | Complete   | 2026-06-17 |
| 8. Node Scripts + Heartbeat | 3/4 | In Progress|  |
| 9. Hardening + VM Deploy | 0/TBD | Not started | - |

## Coupling Notes

- **HMAC secret cross-phase dependency:** The per-node HMAC secret format and location are DESIGNED in Phase 6 (signer + canonical payload) but the secret is physically DELIVERED to each node by the Phase 7 bash downloader. Phase 6 must therefore freeze the secret's format/location and prove the full queue against a STUB executor BEFORE Phase 7 introduces real credentials — otherwise Phase 7 hits a "signed with a key the node doesn't have" surprise.
- **Card schema as fork-point contract:** Phase 4's recommendation-card schema is consumed by both Phase 5 (export) and Phase 6 (queue). It must be frozen as a hard contract at the end of Phase 4; later churn breaks both prongs.
- **Analytics foundation gates everything:** AFM-001 (`DISTINCT ON`) and AFM-002 (single tested formatter) must be sealed in Phase 1 and re-verified at Phase 2 and Phase 4, since the scorecard and insight thresholds compute on top of them.

---

## Milestone v2.0 — Operations Center

> **Continuation milestone.** Phases 1–9 above are the v1 build and are preserved unchanged. v2.0 numbering CONTINUES at Phase 10. v2.0 is a full-stack redesign on the locked "Data-Forward" design system (claude.ai/design project `372850ad-bbae-46da-a40f-3eb3d03befa0`). It **reuses the v1 backend** (P1 read layer, P4 insight engine, P5 export, P6 queue, P8 heartbeat) and **replaces the v1 UI** (overview/console/inbox) on the new system. The NOC-instrument look is retired in Phase 10 (DS-03).

### v2.0 Overview

v2.0 evolves NodeMonitor from a Lightning-node tool into a full-stack Fleet Operations Center. It opens by laying down a single Data-Forward design-system foundation — one canonical token set and a shared primitive library — that every v2 screen renders against, and which retires the cold NOC-instrument look the operator rejected. With the design surface stable, it widens the read model: a telemetry-ingestion layer extends the Phase-8 heartbeat/collector pattern to carry host/VM vitals, two-axis service health, and bitcoind/chain signals into the warehouse, so the new screens render real signals rather than placeholders. The screens then build out in dependency order against the locked prototypes: the Ops Center overview (full-stack attention queue + AI "what needs you now" + fleet-vitals rollup + honest all-clear/stale states); the rebuilt Nodes list and Node Detail carrying the centerpiece per-node two-axis service-health grid plus Service Detail; the Hosts list and Host Detail with VM vitals, the infra trio, and storage time-to-full; and finally the incident lifecycle (root-cause why-chain, blast-radius, acknowledge/assign/snooze) wired to the AI cross-layer explanation layer that produces the root-cause grouping rationale. A final Grade-A security scan of the new surfaces re-affirms the zero-write-path posture and that the AI layer never emits an executable command.

### v2.0 Phases

- [x] **Phase 10: Design-System Foundation** - One canonical Data-Forward token set + shared primitive library extracted from the locked prototypes; retire the NOC-instrument look (completed 2026-06-25)
- [x] **Phase 11: Full-Stack Telemetry Ingestion** - Extend the Phase-8 heartbeat/collector to ingest host/VM, two-axis service-health, and bitcoind/chain signals into the read model (completed 2026-06-30)
- [x] **Phase 12: Ops Center Overview** - Full-stack root-cause-grouped attention queue + AI "what needs you now" band + fleet-vitals rollup + honest all-clear/stale states + layer/severity filters (16/16 plans; operator visual safety-gate APPROVED 2026-06-30; goal-backward verification GOAL ACHIEVED 5/5 on 2026-07-07; OVW-01..05 delivered) (completed 2026-07-07)
- [x] **Phase 13: Nodes + Service Health** - Rebuilt Nodes list + Node Detail with the centerpiece per-node two-axis service-health grid + Service Detail (completed 2026-07-10)
- [x] **Phase 14: Hosts + Infra Monitoring** - Hosts list + Host Detail: VM vitals, the infra trio two-axis, storage time-to-full, on-host nodes, root-cause incident (completed 2026-07-13)
- [x] **Phase 15: Data Collection Expansion — Logs + Deep VM Metrics** - Extend the `*/5` collector to persist service log/error events + deeper Ubuntu/VM metrics into nodemon, un-stub the log UI. Data-first: sequenced BEFORE the AI phase (COL-01/02/03) (completed 2026-07-14)
- [x] **Phase 16: Collector Enrichment — Robust Log Capture** - Harden the `*/5` collector's log capture before the AI/incident layer consumes it: incremental offset-checkpoint scan (every `[ERR]` in the interval, not just the last 64KB), dual rotation handling, capture-by-pattern, native-service log tailing, classification re-derived from real fleet logs, `LNCLI_BIN` fix (COL-04/05/06) (completed 2026-07-17)
- [x] **Phase 17: Incident Lifecycle + AI Explanation** - Incident Detail (why-chain, blast-radius, grouped child alerts) + acknowledge/assign/snooze + AI log/error read + AI cross-layer correlation (fed by Phase 15/16 data) (completed 2026-07-21)
- [x] **Phase 18: Hardening + VM Deploy (v1 + v2)** - one Grade-A scan across all surfaces (HARDEN-01), config-only local→VM flip (HARDEN-02), zero-write-path + AI-never-emits-commands re-affirmed on new surfaces (HARDEN-03) (completed 2026-07-27)

### v2.0 Phase Details

### Phase 10: Design-System Foundation

**Goal**: A single canonical Data-Forward design system — tokens and shared primitives extracted from the locked prototypes — that every v2 screen renders against, with the old NOC-instrument look retired so exactly one theme ships.
**Depends on**: Nothing new (foundation for all v2 screens; reuses v1 backend untouched)
**Requirements**: DS-01, DS-02, DS-03
**Success Criteria** (what must be TRUE):

  1. One canonical token set defines color, type scale (IBM Plex Sans/Mono pairing), spacing, radius, and shadow, with a severity ramp (critical/warning/watch=teal/healthy) kept structurally separate from brand navy — resolving the prototype drift (chrome `#13284F` vs brand `#1A3C79`, ok-green `#1E9E63` vs `#1E7A4E`, critical `#E0392B` vs `#D92638`) into one set, light-only, with no severity hue reused as chrome.
  2. The shared primitive library (severity-tinted card/row, inline evidence chart on Recharts, two-axis status pip, freshness chip, runbook/command modal, AI-read panel, nav rail/shell) is implemented once and rendered identically by a primitive gallery/storybook page.
  3. The NOC-instrument tokens and components are removed or superseded — exactly one theme remains, and a grep/build check confirms no prior mono-instrument token set is still referenced by new v2 surfaces.
  4. The token set carries an honest stale/no-data treatment as a first-class primitive (never faked freshness), available to every downstream screen.

**Plans**: 4 plans in 3 waves

- [x] 10-01-PLAN.md — Canonical df-* tokens + IBM Plex Sans + Wave-0 test infra + NOC-guard script (DS-01, DS-03)
- [x] 10-02-PLAN.md — Presentational primitives: severity card/row, two-axis pip, freshness chip, impl tag, AI-read panel, nav rail (DS-01, DS-02)
- [x] 10-03-PLAN.md — Recharts install gate + EvidenceChart/StaleChart + inert command modal (DS-01, DS-02)
- [~] 10-04-PLAN.md — In-app /design-system gallery (every primitive × every state) + phase gate (DS-02, DS-03) — BUILT + committed (baf7d0a); gate green (vitest + noc-guard + targeted tsc; next build deferred to manual-verify); PAUSED at the blocking operator visual sign-off

**UI hint**: yes

### Phase 11: Full-Stack Telemetry Ingestion

**Goal**: Widen the read model beyond Lightning — host/VM vitals, two-axis service-health, and bitcoind/chain telemetry land in the warehouse via the existing Phase-8 heartbeat/collector pattern, so every v2 screen renders real signals against a stable read model.
**Depends on**: Phase 10 (so freshness/stale primitives exist to represent ingested-but-stale signals); reuses Phase-8 heartbeat infrastructure
**Requirements**: TEL-01, TEL-02, TEL-03
**Success Criteria** (what must be TRUE):

  1. Host/VM metrics (CPU/mem/disk/network, storage usage + growth) are ingested into the read model and queryable per host, extending the Phase-8 heartbeat/collector pattern (no new persistent daemon/agent on nodes).
  2. Service-health signals — RUNNING (process alive) and FUNCTIONING NORMALLY (heartbeat freshness, last-successful-run, error counts) — are ingested for the infra trio (bitcoind/esplora/postgres) and the 6 custom LQWD services, keyed per node/host.
  3. bitcoind/chain telemetry (blocks behind tip, verificationprogress, peers, mempool) is ingested with thresholds attached so it can render as evidence.
  4. Every ingested signal carries a freshness/last-seen stamp, and a stale/missing signal is representable as stale — never silently rendered as healthy.

**Plans**: 7 plans in 4 waves

- [x] 11-01-PLAN.md — nodemon schema: 6 telemetry tables (2 dim + 4 fact) + AFM-001 indexes + [BLOCKING] migration (TEL-01/02/03)
- [x] 11-02-PLAN.md — hand-authored nodemon_telemetry role + host-axis FORCE RLS + seed-dimensions.sql (D-17/D-18)
- [x] 11-03-PLAN.md — read substrate: units bytes/percent (AFM-002) + telemetry-bands (D-14) + seeded-fixture helper
- [x] 11-04-PLAN.md — read helpers: host-metrics + storage-growth (honesty gate) + chain-telemetry (blocks-behind + bands)
- [x] 11-05-PLAN.md — service-health two-axis read helper (up-but-dead, no-data, per-service freshness clock)
- [x] 11-06-PLAN.md — node-side collector: collect_telemetry.py + run_collect-telemetry.sh + CRON_JOB_12 (TEL-01/02/03)
- [x] 11-07-PLAN.md — CANARY-RUNBOOK telemetry section + dimension-seed-apply + live canary proof (D-16)

### Phase 12: Ops Center Overview

**Goal**: The full-stack home — one root-cause-grouped attention queue spanning every layer, an advisory AI "what needs you now" band, a proportional fleet-vitals rollup, and honest all-clear/stale states — built on the Phase-10 system against the locked overview prototype.
**Depends on**: Phase 11 (telemetry read model) and Phase 10 (design system)
**Requirements**: OVW-01, OVW-02, OVW-03, OVW-04, OVW-05
**Success Criteria** (what must be TRUE):

  1. Operator sees a full-stack attention queue spanning nodes/hosts/services/bitcoind/storage, root-cause grouped (one host outage rolls its child node alerts into a single incident), each row showing severity + a one-line why + the layer.
  2. An AI "what needs you now" band presents 1–4 prioritized plain-language lines that are advisory-only (never emit a command), dismissible, with per-line severity.
  3. A fleet-vitals rollup shows per-layer counts (nodes/hosts/services/bitcoind/storage) and a strictly proportional health bar.
  4. The overview shows an honest all-clear state (calm hero when nothing is wrong) and honest stale/no-data representation everywhere — never faked freshness.
  5. The attention queue filters by layer (Hosts/Services/bitcoind/Nodes/Storage) and severity, with honest empty states.

**Plans**: 7 base plans (4 waves) + gap-closure/redesign plans — refinement backlog #1-#9 + operator-approved Ops Center Overview redesign (12-REDESIGN-SPEC.md, D-R1..D-R9)

- [x] 12-01-PLAN.md — severity-map: normalize 4 source vocabularies onto the df ramp (the #1 landmine, D-06)
- [x] 12-02-PLAN.md — ownership: read-time host→service→node→channel containment map (D-01/D-03)
- [x] 12-03-PLAN.md — incidents: cross-layer root-cause grouping + worst-child rollup (D-01/D-02/D-08)
- [x] 12-04-PLAN.md — vitals: strictly proportional per-layer count rollup (D-07)
- [x] 12-05-PLAN.md — ai-band: deterministic advisory-only line builder + guardrail re-affirm (D-04/D-05)
- [x] 12-06-PLAN.md — filter codec + QueueFilters/AiBandClient client islands (D-09/D-05)
- [x] 12-07-PLAN.md — overview page rework + operator visual safety-gate (OVW-01..05) — operator APPROVED live; 9-item refinement backlog routed to --gaps
- [x] 12-08-PLAN.md — gap #8: pure 30-day staleness cutoff eliminator (drop long-dead nodes) [wave 1]
- [x] 12-09-PLAN.md — gap #4: per-node fee grouping (two counted routed lines, never critical) + severity clamp [wave 1]
- [x] 12-10-PLAN.md — gap #9: service display-name map (addressBalances → 'Address List Sync') [wave 1]
- [x] 12-11-PLAN.md — gaps #2/#7: reconcile masthead double-chrome + remove routing_vm leak [wave 1] — operator APPROVED; nav-link gap surfaced during gate routed to 12-14
- [x] 12-12-PLAN.md — gap #1 (+#8/#9 wiring): client-side filter island + read cache + 30-day cutoff + service relabel [wave 2]
- [x] 12-13-PLAN.md — redesign (D-R3/D-R4): service dedup + Unattributed bucket + tree-aware applyFilter (data, TDD) [wave 1]
- [x] 12-14-PLAN.md — redesign (D-R2/D-R5/D-R6/D-R8): category icons + condensed collapsed cards/rows + caps + fee rows + tree narrowing/auto-expand (UI) [wave 2]
- [x] 12-15-PLAN.md — redesign (D-R1/D-R7): vitals-first order + top-bar operator nav + honest ticking PollAge + remove Preview toggle (UI) [wave 2]
- [x] 12-16-PLAN.md — Fable-5 perf pass (PERF-01/02/03/07 + /queue 500 guard) [post-redesign]

**UI hint**: yes

### Phase 13: Nodes + Service Health

**Goal**: The Lightning depth of the redesign — the rebuilt Nodes list and Node Detail carrying the centerpiece per-node two-axis service-health grid, plus Service Detail where one service's full health, logs, and runbook live.
**Depends on**: Phase 12 (overview rows link into these screens) and Phase 11 (service-health telemetry)
**Requirements**: NODE-03, NODE-04, SVC-01, SVC-02
**Success Criteria** (what must be TRUE):

  1. The Nodes list is rebuilt on the new system: at-risk rows pop (left accent + tint), type/status/stale filters, sortable columns, liquidity/forwarding evidence, and row→detail navigation.
  2. Node Detail is rebuilt — identity, Lightning performance (channels/fees/forwards/peers/history), active diagnostics with evidence charts, adaptive action (Export fix / Open runbook / Investigate), and a visible read-only safety posture.
  3. Node Detail carries the per-node control-plane service-health grid for the 6 LQWD services + infra deps, each shown two-axis (RUNNING and FUNCTIONING NORMALLY), green only when both true, with the "up but dead" state made unmistakable.
  4. Service Detail shows one service's two-axis health, heartbeat / last-successful-run / error count, log tail, restart history, dependents, and a unified verify-first runbook — with infra (bitcoind) and custom-service (addressBalances) variants.

**Plans**: 15 plans (9 original + 6 gap-closure redesign)
Plans:
**Wave 1**

- [x] 13-01-PLAN.md — queue enum migration + state machine: add `withdrawn` (D-01) [BLOCKING migration] [wave 1]
- [x] 13-02-PLAN.md — Nodes-list pure filter/sort view util (NODE-03) [wave 1]
- [x] 13-05-PLAN.md — SVC-01 service grid + pubkey→hostId resolver + TwoAxisPip lock (SVC-01) [wave 1]
- [x] 13-07-PLAN.md — Node Detail read sections B1/B2/B4/B5/B6/B7 (NODE-04) [wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 13-03-PLAN.md — withdraw() transition + enqueueAndApprove/withdrawCommand actions (D-01/D-11, threat model) [wave 2]
- [x] 13-04-PLAN.md — /nodes list route + NodesTable/NodeFilters + opsNav (NODE-03) [wave 2]
- [x] 13-09-PLAN.md — Service Detail route + C1–C6 infra/custom variants (SVC-02) [wave 2]

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 13-06-PLAN.md — B8 write-path UI: forked enqueue leaf + channels table + withdraw + stale gate (NODE-04, threat model) [wave 3]

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 13-08-PLAN.md — Node Detail single-scroll assembly + retire [tab] shim + operator gate (NODE-04/SVC-01) [wave 4] — REJECTED at operator visual gate; single-scroll (D-08) superseded → gap-closure redesign below (13-10..15)

**Gap-closure redesign — routed tabs + lean overview** *(from 13-NODE-DETAIL-GATE-FEEDBACK.md G1–G4; supersedes 13-08 single-scroll)*

Wave 1 (shared leaves)

- [x] 13-10-PLAN.md — G4 liquidity aggregator + LiquidityGauge + shared NodeDetailTabs (NODE-04) [gap] [wave 1]
- [x] 13-11-PLAN.md — pagination util + shared CSV export-handler extraction + paginated forwards reader (NODE-04/NODE-02) [gap] [wave 1]

Wave 2 (routed sub-routes)

- [x] 13-12-PLAN.md — /[pubkey]/channels sub-route (reuse 13-06 fee-queue) + ?peer/?chan interconnection + CSV export (NODE-04/NODE-02) [gap] [wave 2]
- [x] 13-13-PLAN.md — /[pubkey]/peers sub-route + per-peer LiquidityGauge + peer→channels link (NODE-04) [gap] [wave 2]
- [x] 13-14-PLAN.md — /[pubkey]/forwards sub-route (windowed + paginated) + forward→channels link + CSV export (NODE-04/NODE-02) [gap] [wave 2]

Wave 3 (assembly + gate)

- [x] 13-15-PLAN.md — lean /[pubkey] overview (header/counts+tabs/G4 gauge/VM vitals/SVC-01 grid/signals/safety) + operator visual gate (NODE-04/SVC-01) [gap] [wave 3]

**UI hint**: yes

### Phase 14: Hosts + Infra Monitoring

**Goal**: The infrastructure layer made operable — the Hosts list and Host Detail surfacing VM vitals, the infra trio two-axis, storage time-to-full, the nodes on each host, and the root-cause incident.
**Depends on**: Phase 11 (host/storage telemetry) and Phase 13 (host cards roll up node health; host detail links to on-host nodes)
**Requirements**: HOST-01, HOST-02
**Success Criteria** (what must be TRUE):

  1. The Hosts list shows per-host cards with a worst-of severity rollup (infra + nodes + resources), CPU/mem/disk meters with threshold coloring, the infra trio (bitcoind/esplora/postgres) two-axis, node-health dots, and filters/sort including stale.
  2. Host Detail shows VM vitals (CPU/mem/disk with sparklines), infra services two-axis, storage volumes with %/day growth + projected time-to-full, the nodes on the host, and the root-cause incident + runbook.
  3. Storage time-to-full is computed from ingested growth and rendered honestly (no projection shown when data is stale/insufficient).

**Plans**: 7 plans

Wave 1 (pure logic + primitive + read layer)

- [x] 14-01-PLAN.md — ThresholdMeter df primitive (D-03) + /design-system gallery registration (HOST-01/02) [wave 1]
- [x] 14-02-PLAN.md — host-history bounded reads + storage-projection humanizer/status copy (HOST-02) [wave 1]
- [x] 14-04-PLAN.md — host-filter facets/sort (D-08) + host-runbook verify-first builder (D-11) [wave 1]

Wave 2 (bands + rollup)

- [x] 14-03-PLAN.md — 4-level days-to-full bands (D-13) + host worst-of rollup + driver line (D-05) [wave 2]

Wave 3 (screens)

- [x] 14-05-PLAN.md — Hosts list: HostFilters + HostCard + /hosts RSC (HOST-01) [wave 3]
- [x] 14-06-PLAN.md — Host Detail: incident banner + storage volumes + on-host nodes + /hosts/[hostId] RSC (HOST-02) [wave 3]

Wave 4 (wiring + gate)

- [x] 14-07-PLAN.md — opsNav wiring + Node Detail VmVitals backfill + phase gate + operator visual gate [wave 4]

**UI hint**: yes

### Phase 15: Data Collection Expansion — Logs + Deep VM Metrics

**Goal**: Fill the data-collection gap the AI layer depends on. Expand the `*/5` collector (`collect_telemetry.py`) to persist service **log/error events** (the matched lines it currently reads and discards) and **deeper Ubuntu/VM metrics** into new `nodemon` tables, add read-layer functions, and un-stub the log UI (`NodeLogsStream`/`ServiceLogTail`). Sequenced BEFORE the AI phase — without the data the AI cannot be meaningful (operator directive 2026-07-14). Full brief: `.planning/COLLECTOR-EXPANSION-BRIEF.md`. Log-pattern source of truth: the Obsidian `LQWD Node Log Reviews` library.
**Depends on**: Phase 11 (telemetry collector + nodemon read-model), Phase 8 (heartbeat/cron rail)
**Requirements**: COL-01, COL-02, COL-03
**Success Criteria** (what must be TRUE):

  1. Service log/error events (matched error/warn lines: level, message, service, host, node, timestamp, signature) are persisted into a bounded, retention-capped `nodemon` table at `*/5`, and the `NodeLogsStream`/`ServiceLogTail` surfaces render real data instead of the empty stub — signal only, known-benign patterns suppressed (COL-01).
  2. PostgreSQL AP-12 signatures (`FATAL: too many clients`, serialization `40001`) + `pg_stat_*` counters are ingested, making AP-12 detection deterministic and retiring the `ap12-advisory` LLM fallback (COL-02).
  3. Deeper Ubuntu/VM metrics (per-core CPU + steal/iowait, disk I/O per device, network errors/drops/retransmits, memory detail + OOM, fd/limits, systemd failed units, clock skew, core count) are collected RAW into `nodemon` and surfaced on host/VM detail (COL-03).

**Plans**: 9 plans in 4 waves

Wave 1 (DB foundation + pure read substrate)

- [x] 15-01-PLAN.md — nodemon schema (8 tables) + [BLOCKING] generate/migrate + role-grants delta (UPDATE on log_patterns) + seed-log-patterns.sql (COL-01/02/03)
- [x] 15-02-PLAN.md — read-time bands (steal/iowait/40001-rate/conn-sat/OOM…) + Δ≥0 counter-reset clamp (pure, TDD) (COL-02/03)

Wave 2 (readers + collector log capture)

- [x] 15-03-PLAN.md — getServiceLogEvents reader + read-time benign suppression (COL-01)
- [x] 15-04-PLAN.md — host-metrics-ext reader: latest-per-host + per-core/-device/-iface children + rates/bands (COL-03)
- [x] 15-05-PLAN.md — pg-health reader + deterministic AP-12 detector retiring the LLM fallback (COL-02)
- [x] 15-06-PLAN.md — collector log capture: extract_events + normalize/redact/signature + upsert + tiered prune (COL-01)

Wave 3 (collector deep metrics + UI un-stub)

- [x] 15-07-PLAN.md — collector deep VM metrics (/proc + argv) + probe_pg_health + RLS-txn inserts (COL-02/03)
- [x] 15-08-PLAN.md — un-stub NodeLogsStream + ServiceLogTail feeds + deep VmVitals + operator visual gate (COL-01/03)

Wave 4 (canary proof + phase gate)

- [x] 15-09-PLAN.md — canary apply (migrate→grants→seed) + live tick proof + full suite + security greps (COL-01/02/03)

**UI hint**: yes

### Phase 16: Collector Enrichment — Robust Log Capture

**Goal**: Make the `*/5` telemetry collector operationally robust before the AI/incident layer consumes its data. The Phase-15 collector code is proven, but live canary testing (2026-07-15, `lnd-ireland`) showed the log-capture behavior and its seed config are too narrow to be useful — errors scroll past the fixed 64KB tail, native-probed services aren't tailed, and the Obsidian-derived classification patterns don't match real LND log lines. This phase widens and hardens capture so real errors are reliably recorded fleet-wide, feeding a meaningful AI/incident layer.
**Depends on**: Phase 15 (extends its collector + schema; mostly collector behavior + config + seed, no new tables expected)
**Requirements**: COL-04, COL-05, COL-06
**Success Criteria** (what must be TRUE):

  1. Every `[ERR]` written to a monitored log during a tick interval is captured (incremental offset-checkpoint scan replaces the fixed 64KB tail; per-log cursor in a local node state file so the collector stays SELECT-only on the warehouse; bounded per-tick bytes with logged truncation), across both rotation styles (LND stable-name rename-archive; Postgres timestamped-filename glob/newest-match).
  2. Capture is by log-pattern match, not just a single `error_pattern` substring, so `[WRN]`/`[CRT]` and all seeded patterns are captured; native-probed services (postgres/bitcoind) have their logs tailed (log-tailing decoupled from `detection_method`); IP:port is normalized out of signatures so per-peer errors collapse.
  3. `log_patterns_config` classification is re-derived from REAL fleet logs (CMGR noise suppressed, HSWC churn benign, SWPR/UTXN sweep failures flagged, LND "too many clients" → ap12), and per-node log paths are populated owner-side via a discovery script + declarative service→path convention (collector stays SELECT-only).
  4. Operational hardening: the `lncli` wrapper uses an absolute `LNCLI_BIN` (fixes the root/cron `pubkey=none` skip); tunables (`LOG_TAIL_BYTES`/`KEEP_N`) reviewed; minor cleanups (esplora stale-row, documented bitcoind/lnd inventory paths).

**Plans**: 6 plans in 4 waves
Plans:
**Wave 1**

- [x] 16-01-PLAN.md — Wave-0 RED test scaffolding (cursor/rotation/capture/tier/taxonomy + D-04 guards)
- [x] 16-02-PLAN.md — Source-agnostic cursor / read_since + rotation + resolve_artifact (COL-04)
- [x] 16-04-PLAN.md — Taxonomy re-derive (info/warn/critical + category) seed + read reconcile (COL-06)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 16-03-PLAN.md — Capture-by-pattern + tier gating + decouple tailing + IP:port normalize (COL-05)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 16-05-PLAN.md — Owner-side path reconciler + service_inventory daemon-path seed (COL-06, D-07)
- [x] 16-06-PLAN.md — Operational hardening (absolute LNCLI_BIN) + D-08 version-gated rollout (COL-06)

**UI hint**: no (collector/config/seed — data layer)
**Source**: `.planning/todos/pending/2026-07-15-collector-log-capture-enrichment.md`

### Phase 17: Incident Lifecycle + AI Explanation

**Goal**: Close the loop on attention — Incident Detail with the root-cause why-chain and blast-radius, tracking-only acknowledge/assign/snooze, and the AI explanation layer that produces the cross-layer root-cause grouping rationale shown on the overview and incident detail. Now fed by the Phase 15/16 log/metric data; provider layer already swappable (D17).
**Depends on**: Phase 15 (log/error + deep telemetry data), Phase 16 (robust/classified log capture the AI reads), Phase 12 (overview attention queue + grouping), Phase 13/14 (the node/host/service signals incidents are built from)
**Requirements**: INC-01, INC-02, AIX-01, AIX-02
**Success Criteria** (what must be TRUE):

  1. Incident Detail shows the root-cause why-chain / detection timeline, a blast-radius diagram (one host → its affected nodes), the grouped child alerts, and related cross-links.
  2. An operator can acknowledge / assign / snooze an incident; these are tracking-only (update the incident record, never touch the fleet); status + owner reflect the change; and a critical incident cannot be silently muted.
  3. An AI log/error read explains in plain operator language what a service's log pattern means, whether it needs attention now, and the dependency/impact path — clearly labeled AI, dismissible, and never emitting a runnable command.
  4. AI cross-layer correlation ties an infra failure to its downstream node/HTLC impact, producing the root-cause grouping rationale that drives the overview and incident-detail grouping.

**Plans**: 9 plans in 4 waves

Wave 1 (pure modules + schema + shared loader — parallel, disjoint files)

- [x] 17-01-PLAN.md — Pure builders: incident-detail (why-chain/blast) + incident-prompt (untrusted delimiters) + assertAdvisoryOnly guardrail (INC-01, AIX-01)
- [x] 17-02-PLAN.md — reconcileTracking pure state machine: snooze/ack/breakthrough/recurrence (INC-02)
- [x] 17-03-PLAN.md — incidentTracking pgTable + [BLOCKING] nodemon generate/migrate (INC-02)
- [x] 17-04-PLAN.md — Extract shared loadIncidents() loader + rewire host detail (.key not .hostId) (INC-01)

Wave 2 (DB write layer + AI action — blocked on Wave 1)

- [x] 17-05-PLAN.md — Transactional tracking loader/writer + ack/assign/snooze server actions, nodemon-only (INC-02)
- [x] 17-06-PLAN.md — narrateIncident server action (server-recompute + guardrail + degrade) + AIX-02 no-action pin (AIX-01, AIX-02)

Wave 3 (incident components)

- [x] 17-07-PLAN.md — IncidentTrackingControls + IncidentReadClient (verdict badge) + SnoozedCriticalBanner (INC-02, AIX-01, AIX-02)

Wave 4 (pages + wiring + operator gate)

- [x] 17-08-PLAN.md — Incident Detail RSC in D-10 order + membership gate + render test (INC-01, AIX-02)
- [x] 17-09-PLAN.md — Tracking-aware overview queue + banner on both surfaces + operator visual gate (INC-02)

**UI hint**: yes

### Phase 18: Hardening + VM Deploy (v1 + v2)

**Goal**: Make the whole application production-grade in one pass — a Grade-A security scan across both v1 and v2 surfaces, the zero-write-path posture re-affirmed, the AI layer proven to emit no executable params, and a config-only local→VM flip validated. (Absorbs the never-built v1 Phase 9 — HARDEN-01/02 — to avoid a redundant hardening pass.)
**Depends on**: Phases 10–17 (all new v2 surfaces complete) and Phase 8 (execution loop complete)
**Requirements**: HARDEN-01, HARDEN-02, HARDEN-03
**Success Criteria** (what must be TRUE):

  1. A Grade-A security scan passes with no CRITICAL/HIGH findings across both v1 and v2 surfaces before any production deploy (HARDEN-01).
  2. The app boots to a VM from env vars only (DB URLs, fileserver location, secrets) — the local→VM flip is config-only, no code changes (HARDEN-02).
  3. The scan re-affirms the zero-write-path posture on the new UI — the dashboard holds zero node credentials and silently mutates nothing (HARDEN-03).
  4. A check confirms the AI layer (overview band, AI-read panel, cross-layer correlation) never emits an executable/runnable command or alters signed action params (HARDEN-03).

**Plans**: 12 plans in 4 waves

Plans:
- [x] 18-01-PLAN.md — Cluster H: ephemeral Postgres CI harness + DB-required fail-on-skip gate (unblocks 0/A)
- [x] 18-02-PLAN.md — Cluster 0: golden tests (tampered-params, wrong-pubkey, live-TLD, env-rate-limit) + commit Q1/I1/Q3
- [x] 18-03-PLAN.md — Cluster B: honest-stale data layer (I-fee, I-pg, D-svc, O-load, O-fee)
- [x] 18-04-PLAN.md — Cluster C: honest-stale UI (U2/U3/U1 + loading/error + hydration + df-faint guard)
- [x] 18-05-PLAN.md — Cluster D: AI advisory-only backstop on narrate path (AI2/AI1/AI3)
- [x] 18-06-PLAN.md — Cluster E: export gate-then-interpolate safeToken + safety-text verbatim + deeplink guard (E-copy/E1/E2/I2)
- [x] 18-07-PLAN.md — Cluster F: role-level read-only boot probe + bounded window scans + null-not-zero + UTC pin (health.ts/DB1)
- [x] 18-08-PLAN.md — Cluster G: collector per-service isolation + rotation-tail drain + host-key-pinned self-update (C-iso/C1/C2/C4/C5)
- [x] 18-09-PLAN.md — Cluster A: queue executor signed-payload TTL/commandId + double-apply guard + idle sweep (Q5/Q5b/Q4/Q-idle/Q6/Q7)
- [x] 18-10-PLAN.md — Cluster A: Q2 DB-role self-approve prohibition — [BLOCKING] nodemon migration + integration proof
- [x] 18-11-PLAN.md — HARDEN-01/03 closeout: Grade-A re-scan + zero-write grep battery + both-path guardrails
- [x] 18-12-PLAN.md — HARDEN-02 closeout: env-only boot guard + fail-loud env resolution + boot health check

### v2.0 Progress

**Execution Order:**
v2.0 phases execute in numeric order, continuing from v1: 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. Design-System Foundation | 11/4 | Complete    | 2026-06-25 |
| 11. Full-Stack Telemetry Ingestion | 7/7 | Complete   | 2026-06-30 |
| 12. Ops Center Overview | 16/16 | Complete   | 2026-07-07 |
| 13. Nodes + Service Health | 23/23 | Complete    | 2026-07-10 |
| 14. Hosts + Infra Monitoring | 7/7 | Complete   | 2026-07-14 |
| 15. Data Collection Expansion — Logs + Deep VM Metrics | 9/9 | Complete    | 2026-07-15 |
| 16. Collector Enrichment — Robust Log Capture | 6/6 | Complete    | 2026-07-17 |
| 17. Incident Lifecycle + AI Explanation | 9/9 | Complete    | 2026-07-21 |
| 18. Hardening + VM Deploy (v1 + v2) | 12/12 | Complete   | 2026-07-27 |

### v2.0 Coupling Notes

- **Design system gates every v2 screen:** DS-01/02 (one token set + shared primitives) must be sealed in Phase 10 before any v2 screen is built; later token churn would re-skin every screen. DS-03 (retiring the NOC-instrument look) happens here so exactly one theme ships — this supersedes the `sketch-findings-nodemonitor` NOC-instrument findings for all v2 work.
- **Telemetry feeds the service/host/AI screens:** TEL-01/02/03 land the host/service/bitcoind read model before (or alongside) the screens that render it. Screens may be built against the read-model shape first, with Phase 11 delivering the real signals; honest stale/no-data states (DS-01, OVW-04) cover the gap until real telemetry flows.
- **Reuse the v1 backend, do not rebuild:** v2 builds new UI on top of the existing P1 read layer, P4 insight engine, P5 export, P6 queue, and P8 heartbeat. v2 must not re-map or re-implement any v1 requirement.
- **AI correlation is the grouping engine:** AIX-02 (cross-layer correlation) produces the root-cause grouping rationale consumed by OVW-01 (overview) and INC-01 (incident detail). The grouping contract should stabilize in Phase 16 alongside the incident model that renders it.
- **Hardening is last and scoped to new surfaces:** HARDEN-03 re-affirms the zero-write-path posture and AI-never-emits-commands invariant specifically on the v2 surfaces, after all screens exist.
