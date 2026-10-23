---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: — Operations Center
status: executing
stopped_at: Phase 17 UI-SPEC approved
last_updated: "2026-07-27T18:14:04.193Z"
last_activity: 2026-07-23
progress:
  total_phases: 9
  completed_phases: 8
  total_plans: 93
  completed_plans: 91
  percent: 89
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** Every recommended action is safe and accountable — fees apply only via signed, operator-approved intents executed with on-node credentials; closures/rebalances are exported for a human to run. The dashboard never holds node credentials and never silently mutates the fleet.
**Current focus:** Phase 18 — hardening-vm-deploy-v1-v2

## Current Position

Phase: 18 (hardening-vm-deploy-v1-v2) — EXECUTING
Plan: 4 of 12
Status: Ready to execute
Last activity: 2026-07-23

## v2.0 Roadmap Summary

Continuation milestone — Phases 1–9 (v1) preserved; v2.0 continues at Phase 10. Reuses v1 backend (P1/P4/P5/P6/P8); replaces v1 UI on the locked Data-Forward design system.

| Phase | Goal | Requirements |
|-------|------|--------------|
| 10. Design-System Foundation | One canonical Data-Forward token set + shared primitives; retire NOC look | DS-01, DS-02, DS-03 |
| 11. Full-Stack Telemetry Ingestion | Host/service/bitcoind signals into the read model (extends P8) | TEL-01, TEL-02, TEL-03 |
| 12. Ops Center Overview | Full-stack attention queue + AI band + fleet-vitals + honest states | OVW-01..05 |
| 13. Nodes + Service Health | Rebuilt Nodes list + Node Detail + two-axis service grid + Service Detail | NODE-03/04, SVC-01/02 |
| 14. Hosts + Infra Monitoring | Hosts list + Host Detail (VM vitals, infra trio, storage time-to-full) | HOST-01, HOST-02 |
| 15. Data Collection Expansion — Logs + Deep VM Metrics | Persist service log/error events + deep Ubuntu/VM metrics into nodemon; un-stub the log UI | COL-01/02/03 |
| 16. Collector Enrichment — Robust Log Capture | Interval-complete + rotation-safe log capture; capture-by-pattern; native-service tailing; real-log classification; LNCLI fix | COL-04/05/06 |
| 17. Incident Lifecycle + AI Explanation | Incident Detail + ack/assign/snooze + AI read + cross-layer correlation | INC-01/02, AIX-01/02 |
| 18. Hardening + VM Deploy (v1 + v2) | Grade-A scan across all surfaces; re-affirm zero-write-path + AI-no-commands | HARDEN-01/02/03 |

**Coverage:** 27/27 v2.0 requirements mapped. **Sequencing locked:** DS first (Phase 10), data collection (15) + collector enrichment (16) before the AI/incident layer (17), HARDEN last (Phase 18), telemetry (Phase 11) before the screens that render it.

## Performance Metrics

**Velocity:**

- Total plans completed: 102
- Average duration: ~18 min
- Total execution time: ~1.2 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02 | 7 | - | - |
| 03 | 16 | - | - |
| 05 | 6 | - | - |
| 07 | 5 | - | - |
| 10 | 11 | - | - |
| 13 | 23 | - | - |
| 15 | 9 | - | - |
| 16 | 6 | - | - |
| 17 | 9 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 14m | 3 tasks | 15 files |
| Phase 01 P04 | 22m | 2 tasks | 3 files |
| Phase 03 P09 | 15m | 2 tasks | 2 files |
| Phase 03 P16 | 15 min | 2 tasks | 1 files |
| Phase 07 P01 | 4m | 3 tasks | 5 files |
| Phase 07 P02 | 12m | 2 tasks | 2 files |
| Phase 07 P03 | 20m | 3 tasks | 7 files |
| Phase 07 P04 | 25m | 3 tasks | 4 files |
| Phase 07 P05 | 5min | 2 tasks | 0 files |
| Phase 10 P04 | ~35m | 1 task | 5 files |
| Phase 12 P01 | ~10m | 2 tasks | 2 files |
| Phase 12 P02 | 7m | 2 tasks | 2 files |
| Phase 12 P03 | 14m | 2 tasks | 2 files |
| Phase 12 P04 | 6min | 2 tasks | 2 files |
| Phase 12 P05 | ~4min | 2 tasks | 3 files |
| Phase 12 P06 | ~10min | 2 tasks | 5 files |
| Phase 12 P07 | ~25min | 2 tasks | 1 files |
| Phase 12 P08 | ~8m | 1 tasks | 2 files |
| Phase 12 P09 | 10m | 2 tasks | 4 files |
| Phase 12 P10 | 1m | 1 tasks | 2 files |
| Phase 12 P11 | 6min | 3 tasks | 6 files |
| Phase 12 P12 | ~2min | 3 tasks | 4 files |
| Phase 12 P13 | 6m | 2 tasks | 4 files |
| Phase 12 P16 | 32min | 5 tasks | 9 files |
| Phase 18 P01 | 9m | 2 tasks | 9 files |
| Phase 18 P02 | ~12m | 2 tasks | 6 files |
| Phase 18 P03 | ~11m | 2 tasks | 12 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.0 Roadmap]: Continuation milestone — Phases 1–9 preserved; v2.0 numbering continues at Phase 10. 7 phases at standard granularity; reuses the v1 backend (P1/P4/P5/P6/P8), replaces the v1 UI on the locked Data-Forward design system.
- [v2.0 Roadmap]: DS-01/02/03 sequenced FIRST (Phase 10) — one canonical token set + shared primitives gate every v2 screen; DS-03 retires the NOC-instrument look so exactly one theme ships, superseding the sketch-findings-nodemonitor NOC-instrument findings for all v2 work.
- [v2.0 Roadmap]: Telemetry ingestion (Phase 11, TEL-01..03) sequenced before the service/host/AI screens; screens may build against the read-model shape first, with Phase 11 delivering real signals and honest stale/no-data states covering the gap.
- [v2.0 Roadmap]: HARDEN-03 (Grade-A scan of new v2 surfaces) sequenced LAST (Phase 18), after all redesigned screens exist.
- [Roadmap]: Horizontal-layer build in dependency order; 8 phases at standard granularity matching the research-validated spec ordering.
- [Phase 1]: Three Drizzle clients on three least-privilege roles; AFM-001 `DISTINCT ON` helper + AFM-002 single tested formatter sealed before any consumer.
- [Phase 4]: Recommendation-card schema frozen as a hard contract before Prong 2 (Phase 5) and Prong 1 (Phase 6) consume it.
- [Phase 1]: AFM-002 formatter (src/lib/format/units.ts) is the single sanctioned sat/BTC/msat conversion path; grep guard blocks ad-hoc /1e8 or *1000 in src.
- [Phase 1]: One UnifiedNode model; mapLndNode/mapLdkNode are the sole per-backend translation surface (D-10) — app never branches on backend, no any-leak.
- [Phase 1]: LDK is single-node (the LSP); the status page aggregates lightning_channels into one UnifiedNode (no LSP-self-pubkey column; identified by alias).
- [Phase 1]: Vitest config carries the @/ alias (vitest ignores tsconfig paths); plain node/ESM, no Next.js plugin.
- [Phase 3]: Operator visual gate FAILED at 03-09 — verdict recorded verbatim; 4 UI gaps (emoji removal, colored grade letter, timestamp/button collision, panel-based UI overhaul) routed to gap-closure planning, not fixed inline
- [Phase 03]: Phase 3 operator visual gate PASSED at 03-16 re-verification — verdict "approved" verbatim; all 4 gaps from 03-09 closed; live golden run confirmed 2/2 across 10 nodes
- [Phase 05]: Phase 5 operator visual gate PASSED at 05-06 on first attempt — verdict "approved looks good" verbatim; both surfaces (/inbox + console Active Signals) verified; zero-write-path grep battery green; zero dependency installs; EXPORT-01 + PENDING-03 satisfied
- [Phase ?]: [Phase 07-01]: Pure triage core locked by unit test before any UI — no-card-dropped, critical-never-folded, suppression-precedence, engine-order-preserved; facetCounts is single-arg so counts cannot derive from a post-filter subset
- [Phase ?]: [Phase 07-01]: Facet codec whitelist-parses ?sev/?node/?signal/?action against FROZEN schema enums + 66-hex PUBKEY_RE, drops invalid silently, leaves ?card orthogonal; shadcn Sheet vendored with zero new npm dependency
- [Phase ?]: [Phase 07-02]: enqueueBatch loops the existing per-row enqueue() with NO outer transaction (D-07); reuses enqueueInputSchema + enqueueErrorCopy verbatim; UI sends {pubkey,params}[] only, server signs once per row.
- [Phase ?]: [Phase 07-03]: /inbox rebuilt to sketch-005 winner-E triage spine — 4 server presentation components (SeveritySpine/InfoGroups/SuppressedBlock/FacetRail) + 1 InboxTriage client island; facet links strip ?card by construction (OQ-1 settled); counts over the unfiltered set; severity=state-only, navy=structure/act-only.
- [Phase ?]: [Phase 07-04]: Inbox drawer is URL-synced off ?card (Sheet, reload/back-safe) and acts in place via the verbatim EnqueuePreview/CommandExport/runbook leaves; bulk ENQUEUE ALL + cross-node multi-select drive one aggregate-scope BatchConfirmDialog -> enqueueBatch -> verbatim per-row tally; opened-card-only sparkline fetch (no Promise.all).
- [Phase ?]: [Phase 07]: Phase 7 operator visual gate PASSED at 07-05 — verdict 'approved' verbatim; INBOX-01..04 verified live against sketch-005 winner E; full suite 668 pass/20 skip, frozen-schema golden 13/13, security-grep battery clean, production build green
- [Phase ?]: [Phase 07]: 3 operator-found gaps (4630f82 collapsible facet dropdowns, af056f0 keep filter-rail toggle visible, 0751f4b loadInsightView short-TTL cache) closed inline during the 07-05 gate window and re-verified green, not routed to a separate --gaps cycle
- [Phase 10]: [10-04]: DS-02 gallery shipped as an in-app /design-system route under an isolated (design) route group (no Storybook, no new tooling — D-04); minimal layout omits the (overview) masthead + @modal slot; renders the REAL df primitives × all 7 states from static fixtures (no DB/fetch — T-10-10).
- [Phase 10]: [10-04]: Added canonical df-slate (#64748B) token to globals.css + tokens.ts — fixes a latent EvidenceChart DF.slate type bug (Plan 03) the SSR tests missed; CSS↔TS parity test stays green (both sides gain the key); slate is neutral, set-disjoint from the severity ramp + chrome/brand.
- [Phase 12]: [12-01]: severity-map.ts is the SINGLE documented severity boundary (D-06) — insight `info`→df `watch` (surfaced advisory, not hidden); noData AND functioning-stale both collapse to one `stale` bucket (no 6th segment); `worstSeverity` filters `stale` out before the worst-child reduction so a no-data child never promotes a healthy parent to critical (D-08/D-02). Pure module (no DB/server imports), locked by 23-assertion vitest including a df-union membership guard before any Wave-2 consumer.
- [Phase 12]: [12-02]: ownership.ts derives host→service→node containment at read time from hosts.node_pubkeys + service-health rows (no stored graph, D-03), so the map cannot drift from source. hostByNode inverts node_pubkeys; an unattached node returns undefined (honest, Pitfall 6). Host-level (NULL-pubkey) services roll up to host only; node-scoped services index under both host and node. Single-pass, no sort, pure module (no DB/server imports), locked by a 7-case vitest before Wave-2 incidents.ts consumes it. Channels deliberately NOT attached here — they attach lazily per node only when an incident needs blast-radius.
- [Phase ?]: [12-03]: incidents.ts assembleIncidents folds engine-ranked insight cards + per-layer telemetry into a host-keyed root-cause tree (D-01) — every host-attached failure nests under its host's ONE incident; only no-host nodes/fleet cards float top-level (Pitfall 6). Incident severity = worstSeverity(children) (D-02); stale on a separate flag so a no-data child never promotes the parent (D-08). host->node ownership derived from service (hostId,nodePubkey) pairs. Zero .sort — engine order is LAW. Pure module, 6-case vitest; all-clear returns [] (OVW-04).
- [Phase ?]: [12-04]: vitals.ts rollupLayer is the proportional fleet-vitals math (OVW-03/D-07) — bar segment width = count/total literally, no severity weighting (test pins 1-of-4 critical = 0.25). Denominator = ALL entities (healthy included); stale its own segment, never folded into healthy (D-08). Single-count contract (Pitfall 4): caller reduces a multi-signal entity to one rung via worstSeverity BEFORE counting. Pure module, reuses Plan 01 worstSeverity; 7-assertion vitest, overview suite 43/43.
- [Phase ?]: [12-05]: ai-band.ts buildBandLines emits <=4 deterministic AiReadLines off the ranked GroupedIncident[] — per-line sev, order=ranked (no .sort, D-04), advisory-only BY CONSTRUCTION (AiReadLine has no action field; Object.keys test pins it in both ai-band.test.ts and the guardrails.ts band boundary, T-12-01). Zero LLM dependency (D-05): optional rephrase stays in the existing server-recomputing narrate() action. buildCalmState supplies the all-clear continuation copy (OVW-04/D-08). Pure module, 11-case vitest, overview suite 53/53.
- [Phase 12]: [12-07]: (overview)/page.tsx reworked into the v2 full-stack Ops Center — ONE fail-soft Promise.all of five reads → rankCards → assembleIncidents → rollupLayer (5 layers; bitcoind denominator = declared-bitcoind hosts from service_inventory, OQ2/D-07) → buildBandLines/buildCalmState → applyFilter → df primitives in the UI-SPEC OverviewShell order. force-dynamic + revalidate=0 + per-read .catch degrade preserved; Server-Component-only, zero write path, zero command emission. Operator verified LIVE against real fleet data (http://localhost:3001/) — rollups populate, advisory-only band + "never runs commands" pill render, honest stale/empty hold; ui_safety_gate PASS. Phase 12 complete 7/7. A 9-item operator refinement backlog (12-REFINEMENT-BACKLOG.md) captured for /gsd-plan-phase 12 --gaps — NOT 12-07 scope.
- [Phase ?]: [12-06]: filter.ts is the pure overview view layer (D-09/OVW-05) — parseOverviewFacets whitelists a CLOSED layer enum + df-severity SUBSET (critical|warning|watch; healthy/stale are honest states, not chips), invalid silently widens the view (V5/T-12-02); applyFilter only .filter (zero .sort, no mutation), so engine order is preserved and a non-empty queue filtered to zero yields [] (honest empty state). QueueFilters: navy-structural URL-synced toggle chips (DS-01, never a severity hue), labels via severityLabel. AiBandClient: session-scoped useState dismiss around AiReadPanel, no persistence (D-05), frozen AI_SAFETY_LABEL intact. 20 tests; page.tsx wiring deferred to 12-07.
- [Phase ?]: [12-08]: freshness-cutoff.ts is the single pure 30-day staleness ELIMINATOR (LOCKED backlog #8) — null stamp OR >30d = gone, DROPPED before assembly/rollup (fixes the 1000+ STALE flood). Inclusive boundary; two clocks kept distinct (15min collector deriveStale vs 30-day monitor-liveness). Pure module (no DB/.sort/mutation), 11-case vitest, wired across all layers in 12-12.
- [Phase ?]: [12-09]: Fee alerts group per node into <=2 counted, /{pubkey}/fees-routed summary children (LOCKED #4); fee_raise/fee_lower intercepted before the leaf path (channel_close_candidate NOT grouped), collected in a first-seen Map (no .sort). clampBelowCritical on the single severity boundary clamps every fee summary to <=warning (never pages red); the owning host can still go critical from non-fee children. href built ONLY via buildDeepLink; non-routable pubkey omits href. Optional count/href/feeKind added back-compat; overview suite 85/85.
- [Phase ?]: [12-10]: service-display.ts is a PURE presentation-only relabel map (LOCKED backlog #9) — SERVICE_DISPLAY seeds addressBalances to 'Address List Sync' plus 6 known keys; serviceDisplay(name) humanizes unknown camelCase keys to Title Case and never throws. Carries ONLY { label, description }, imports no health value and computes none, so a label can never re-grade or recolor a service (T-12-10-01); health stays interval-based via ServiceHealthState. Grep-guarded (health-terms 0, impure 0), 8-case vitest RED to GREEN; consumed at render in 12-12/12-13.
- [Phase 12]: [12-12]: Overview filtering moved from URL `<Link>` navigation (re-ran all 5 warehouse reads ~8s/toggle) to an in-browser `QueueIsland` client island over the isomorphic `applyFilter`; URL sync via `history.replaceState` only (no `router.push/refresh`, no server round-trip). Reads+assembly wrapped in a CONSTANT-keyed globalThis TTL memo (~20s, NOT `unstable_cache` — preserves the Date stamps cards/views carry), mirroring `engine.ts` `_insightViewCache`. 30-day `applyFreshnessCutoff` wired across nodes/hosts/chain/services + rankedCards filtered to surviving pubkeys BEFORE assembly+rollup, so dead entities leave the queue AND the vitals denominators (fixes the 1000+ STALE flood). Service key-echo killed (`entityLabel` via `serviceDisplay().label`, `why`=health reason, raw key nowhere on screen). Operator ACCEPTED this scope at the Task-3 human-verify gate (build green; `tsc`/`next build`/vitest + security greps passed). The layer-filter taxonomy bug ("filtering services/hosts shows nothing"; applyFilter matches only the top-level layer) + service dedup + card/layout/chrome are a SEPARATE APPROVED redesign (`12-REDESIGN-SPEC.md`, plans 12-13/12-14/12-15) — NOT a 12-12 defect. OVW-01/03/05 delivered.
- [Phase 12]: [12-11]: masthead extracted to ConsoleMasthead (Server Component, no routing_vm literal); shared (overview)/layout.tsx reduced to container + @modal slot so `/` renders ONE chrome (NavRailShell only); v1 siblings (inbox/pending/queue/[pubkey]/[tab]) self-mount ConsoleMasthead. (overview)/[pubkey]/page.tsx skipped — pure redirect (no shell), sanctioned per plan. routing_vm DB-name info-leak DELETED everywhere (T-12-11-01 / CLAUDE.md; grep=0). Operator visual gate APPROVED (one chrome on /, siblings intact, modal opens, zero routing_vm). Operator follow-up — NavRailShell has no nav links to /inbox,/pending,/queue — routed to 12-14 (edits NavRailShell); NOT a 12-11 defect.
- [Phase 12-13]: Two live-verify taxonomy bugs fixed in the pure data layer — (1) services dedup by (owner-host, serviceName) keeping the strictly-worse row via worstSeverity (kills repeated 'Address List Sync'); every orphan nests under ONE 'Unattributed' bucket appended last, never a bare top-level row; (2) applyFilter is now TREE-AWARE (owner-or-descendant layer/sev match + layer-scoped child narrowing on a fresh card), fixing 'filtering nodes/services shows nothing'. parseOverviewFacets vocab UNCHANGED; engine reused (no severity re-derivation); zero .sort, no input mutation; RED-first TDD, 31 tests green.
- [Phase 12]: [12-CLOSE]: Phase 12 verified + closed 2026-07-07 — automated goal-backward verification (gsd-verifier) returned GOAL ACHIEVED 5/5 (OVW-01..05 all PASS with file:line evidence in 12-VERIFICATION.md); zero-write-path + AI-never-emits-commands invariants re-affirmed on the overview surface. Missing 12-14/12-15 SUMMARY.md files backfilled from committed code (marked `backfilled:`). Overview unit suite 103/103; full suite 993 pass / 47 skip — the only 4 failures are pre-existing `src/lib/queue/*` live-DB integration tests timing out on beforeEach/afterAll hooks with no nodemon DB connected (unrelated to Phase 12). DEFERRED (operator, out-of-band): `next build` exit-0 confirmation (sandbox TS-phase hang). Phase 13 (Nodes + Service Health, UI hint: yes) is next — 4 pending todos resolve there.
- [Phase ?]: [12-16]: Fable-5 perf fixes shipped — loadFleetView 45s TTL memo (FLEET_TTL_MS, PERF-02); 30-day bound on latestNodeInfoAll (NODE_INFO_WINDOW_DAYS, PERF-01) with latestNodeInfoFallback single-node path so >30d-stale nodes still render (no 404); un-serialized insight+fleet read waterfalls (PERF-03); per-DB parallel boot health check (PERF-07); /queue 500 null-guarded on non-update_fee params. LOCKED query shapes / force-dynamic / degrade wrappers / 12-13-15 redesign untouched; PERF-04/05/06 deferred. tsc+next build BLOCKED by sandbox TS-phase hang — operator confirms out-of-band.
- [Phase ?]: [18-01]: requireNodemonDb() guard is the single DB-required test tagging convention; CI fail-on-skip gate grep-discovers tagged files so downstream DB tests enroll automatically
- [Phase 18]: [18-02]: Q1/I1/Q3 landed with golden tests — apply-fee applies ONLY signed canonical_payload field-4 values (tampered `params` column ignored); pubkey_mismatch blocks cross-node replay; live time_lock_delta via getchaninfo fail-closed (never the placeholder 80); check-queue claim ceiling bound to NODEMON_RATE_LIMIT_MAX via :'rlmax'. Node-script suites enrolled in ci.yml; check-queue.test.sh is DB-required (fail-loud under CI, visible skip locally). tests/node companion updates (pg-harness mock lncli, static gate) left dirty for their owning plan — see phase deferred-items.md.
- [Phase 18]: [18-03]: Failed 90d volume read degrades to null (UNKNOWN) — fee detector goes raise-only (zero close/lower cards, no fabricated forwards90d); real empty aggregate keeps absent-entry=0 semantics
- [Phase 18]: [18-03]: loadIncidents() owns the 30-day cutoff + surviving-pubkey filter so AI narration + mute baselines consume the operator-visible incident set; page.tsx consolidation deferred to its owning plan

### Pending Todos

- [Node Detail — all-channels view + per-channel fee queue (no AI rec)](todos/pending/2026-06-23-node-detail-all-channels-fee-queue.md) — resolves_phase 13; from the 08-04 canary (rec-card-only enqueue caused 3× channel mis-targeting)
- [One-click enqueue+approve](todos/pending/2026-06-23-one-click-enqueue-approve.md) — resolves_phase 13; operator decision 2026-06-23 (Option A; keep HMAC + node-side verify)
- [Harden check-queue lncli for cron PATH (+ per-node LNCLI pin)](todos/pending/2026-06-23-pin-lncli-cron-path-hardening.md) — 08-04 A1.b; unattended */5 cron fails until each node pins LNCLI=/usr/local/bin/lncli
- [Close A2 — exercise inbound-fee (lnd#8614)](todos/pending/2026-06-23-exercise-inbound-fee-a2-lnd8614.md) — 08-04 A2; verify on an inbound-fee channel or add inbound-fee passthrough to apply-fee

### Blockers/Concerns

- [Phase 8 (v1)]: COMPLETE (4/4) — 08-04 live canary EXEC-03 proof passed on LQWD-Ireland 2026-06-23 (apply+revert+self-update; A1 confirmed + cron-PATH/LNCLI fix; A2 inbound-reset not exercisable). v2.0 reuses this heartbeat in Phase 11 telemetry ingestion. Deploy note: each node needs `LNCLI=/usr/local/bin/lncli` in its root-only `.nodemon.env` (cron PATH lacks /usr/local/bin).
- [v2.0 Phase 11]: TEL collector form for host/service/bitcoind signals extends the Phase-8 pattern — read the existing collector before designing Phase 11 ingestion; service-health "functioning" signal (heartbeat/last-run/error-count) source per custom service to be confirmed.
- [v2.0 Phase 10]: Resolve the prototype token drift into ONE canonical set (chrome #13284F vs brand #1A3C79, ok-green #1E9E63 vs #1E7A4E, critical #E0392B vs #D92638) before any v2 screen consumes tokens.
- [Phase 4]: Fee-crash/earnings-step-down threshold and fleet-temporal-correlation algorithm not yet defined — derive from France PPM-crash data and 2024-09-09 cascade during Phase 4 planning.
- [Phase 1]: Confirm warehouse connection mode (PgBouncer/transaction-pooler → `prepare: false` on postgres.js) during setup.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260721-eos | Gap B — service-health explainability: expandable accordion showing WHY a service is not-functioning | 2026-07-21 | 465c0b8 | [260721-eos-gap-b-service-health-explainability-expa](./quick/260721-eos-gap-b-service-health-explainability-expa/) |
| 260721-fou | Gap A — fix LND functioning probe (collect_telemetry.py): running+fresh semantics, [ERR] capture, honest detail — plan-checked, 57/57 tests | 2026-07-21 | e1ccdb4 | [260721-fou-gap-a-fix-lnd-functioning-probe-running-](./quick/260721-fou-gap-a-fix-lnd-functioning-probe-running-/) |
| 260721-gqi | Overview incident fix: demote stale-sourced criticals to STALE + roll up per-channel stuck/htlc signals + render the reason — plan-checked (1 blocker caught+fixed), verified live | 2026-07-21 | 3252e9b | [260721-gqi-fix-overview-incident-bug-demote-stale-s](./quick/260721-gqi-fix-overview-incident-bug-demote-stale-s/) |
| 260721-kej | Overview labeling fix: relabel host cards by owned-node alias/hostId (not service name) + suppress healthy Unattributed bucket — plan-checked, verified live | 2026-07-21 | ed44224 | [260721-kej-fix-overview-incident-labeling-label-hos](./quick/260721-kej-fix-overview-incident-labeling-label-hos/) |
| 260721-lgm | Top-bar Refresh button (all pages) + auto-refresh 60s toggle: single-owner overview cache + refreshData server action (revalidatePath), honest 'reads warehouse, does not force collection' — plan-checked, verified live | 2026-07-21 | fa528f5 | [260721-lgm-add-top-bar-refresh-button-all-pages-wit](./quick/260721-lgm-add-top-bar-refresh-button-all-pages-wit/) |
| 260721-noc | Correct all ~45 UI-audit findings (`.planning/UI-AUDIT-2026-07-21.md`) + LND capitalization + VM/service/node type tag: incident-page two-column rebuild & severity-accurate BlastRadius (priority, browser-verified), all-layer fleet ramp, top-bar breadcrumb, df-faint contrast sweep, shared in-shell error/empty primitives, keyboard-accessible batch enqueue. 4 audit agents → 3 parallel worktree cluster agents. Build ✓, 0 new test regressions | 2026-07-22 | 08eee53 | [260721-noc-correct-ui-audit-findings-2026-07-21](./quick/260721-noc-correct-ui-audit-findings-2026-07-21/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Build gate | `next build` exit-0 for 10-04 — sandbox TS-phase hang (compile green in 11.9s; targeted `tsc --noEmit` over gallery + EvidenceChart exit 0). Operator: run `CI=true npx next build`, confirm exit 0. | Open — manual-verify | 2026-06-24 (10-04) |

## Session Continuity

Last session: 2026-07-23T00:31:13.520Z
Stopped at: Phase 17 UI-SPEC approved
Resume file: None
