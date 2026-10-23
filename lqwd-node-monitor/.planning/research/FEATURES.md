# Feature Landscape

**Domain:** Lightning Network node-operator control dashboard (multi-node LND + LDK/LSPD fleet)
**Researched:** 2026-06-05
**Overall confidence:** HIGH for single-node tool features (well-documented), MEDIUM for fleet-level patterns (Torq is the only mature multi-node reference)

## How to read this

This maps the operator-facing feature set of the five reference tools (ThunderHub, RTL, LNDg, Lightning Terminal/litd, Amboss) plus Torq (the one true multi-node manager) and Faraday (close recommendations). Each feature is tagged **table-stakes** (operators expect it), **differentiator** (sets NodeMonitor apart), or **anti-feature** (deliberately NOT built). Every row carries a complexity estimate and a gap/creep verdict against the spec (`vast-popping-starlight.md`).

The decisive framing difference: every reference tool except Torq is a **single-node, credentialed, web-served control panel that lives next to the node**. NodeMonitor is a **local-first, credential-less, fleet-wide read+queue tool that lives away from the nodes**. That architecture choice is what makes several "table-stakes" features either out of scope or deliberately reshaped — and it is itself the core differentiator.

---

## Reference Tool Feature Matrix

| Capability | ThunderHub | RTL | LNDg | litd | Torq | Amboss | NodeMonitor (spec) |
|---|---|---|---|---|---|---|---|
| Channel list / balance view | Yes | Yes | Yes | Yes | Yes (1000+ ch) | Yes | **Yes** (per-node console) |
| Per-channel fee/policy edit | Yes | Yes | Yes | Yes | Yes | (via mgr) | **Yes** (queued `update_fee`) |
| Bulk/mass fee update | Partial | Yes | Yes (AutoFee) | Yes (Autofees) | Yes (workflows) | — | **Partial** (per-card, no batch v1) |
| Automated/dynamic fees | No | No | **Yes** | **Yes** | **Yes** | — | **No** (deterministic suggest only) |
| Rebalancing (circular) | Yes | Yes (Loop/Boltz) | **Yes (auto)** | Yes (Loop) | **Yes (auto)** | — | **Export-only** (Prong 2) |
| Open channel | Yes | Yes (batch) | Yes (batch) | Yes | Yes | — | **No** (not in scope) |
| Coop close channel | Yes | Yes | Yes | Yes | Yes | — | **Export-only** (Prong 2) |
| Force close channel | Yes | Yes | Yes | Yes | Yes | — | **Export-only** (Prong 2) |
| Peer connect/disconnect | Yes | Yes | (monitor) | Yes | Yes | — | **Read-only** (peer view) |
| Forwarding/revenue analytics | Yes | Yes (reports) | **Yes (P&L)** | **Yes (ROI/ch)** | **Yes (deep)** | **Yes** | **Yes** (curated) |
| Failed-HTLC analysis | No | No | **Yes** | Partial | **Yes** | — | Possible (insight) |
| Node health / liveness | Partial | Partial | Partial | Partial | Partial | **Yes** | **Yes (10-dim scorecard)** |
| Multi-node / fleet view | No | Multi-config | No | No | **Yes** | **Yes (watchlist)** | **Yes (primary)** |
| Force-close risk detection | No | No | No | No | No | Partial | **Yes (AP-11/AP-12)** |
| LDK / non-LND support | No | CLN/Eclair | No | No | CLN | Implementation-agnostic | **Yes (LND+LDK)** |
| Holds node credentials | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** | No (read API) | **No (by design)** |

Confidence: HIGH for the per-tool columns (each verified against official docs / GitHub READMEs). The NodeMonitor column is the spec, not yet built.

---

## Table Stakes

Features an operator expects in any node-control tool. Missing these makes NodeMonitor feel like a toy.

| Feature | Why Expected | Complexity | Spec Status |
|---|---|---|---|
| Channel list with local/remote balance + active/inactive/pending state | The #1 thing every tool shows; the operator's primary mental model | Low | ✅ Covered (per-node console) |
| Per-channel fee report (current base + ppm, inbound/outbound) | Can't reason about fees without seeing them | Low | ✅ Covered |
| Forwarding history + routing-fee earnings (per channel + per node) | Core "is this node/channel earning?" question | Med | ✅ Covered (forwards view) |
| Liquidity balance summary (total local vs remote, per-channel ratio) | Drives every rebalance/fee decision | Low | ✅ Covered |
| Closed-channel list with close type (coop/force/local/remote initiator) | Required to diagnose force-close problems | Med | ✅ Covered (closes view) |
| Peer list with connection state + flap/disconnect signal | Peer hygiene is a standard operator concern | Low–Med | ✅ Covered (peer view) |
| Fee/policy editing | The single most-used write action in all tools | Med | ✅ Covered (Prong 1 queue) |
| Channel close (coop + force) | Universal control action | Med | ⚠️ **Reshaped** — export-only (Prong 2), not in-app execute |
| Rebalancing | Universal liquidity action | High | ⚠️ **Reshaped** — export-only (Prong 2) |
| Node liveness / health at a glance | "Is my node up and well?" | Med | ✅ Covered (scorecard) |
| CSV / data export | Accounting + record-keeping (RTL, LNDg, Torq all do this) | Low | ❌ **GAP** — not in spec (see Gaps) |

**Verdict on reshaped table-stakes:** Close + rebalance are table-stakes *capabilities*, but NodeMonitor deliberately delivers them as **exported commands** rather than in-app execution. This is defensible and correct for the credential-less architecture — but it must be *visibly present* (the operator must be able to act on a flagged channel without leaving the tool), which the spec satisfies via Prong 2. Do not let "export-only" degrade into "absent."

---

## Differentiators

Features that set NodeMonitor apart from the single-node incumbents. These are the reasons to build it rather than run ThunderHub on each box.

| Feature | Value Proposition | Complexity | Spec Status |
|---|---|---|---|
| **Fleet-wide single pane** (26 nodes, LND+LDK in one model) | No incumbent except Torq does multi-node; none unify LND+LDK | High | ✅ Core of spec |
| **10-dimension per-node health scorecard** | Turns raw warehouse data into an at-a-glance "which node needs me" ranking — nothing else does this | High | ✅ Core of spec |
| **Deterministic anti-pattern detectors** (AP-11 close-storm, AP-12a/b PG contention, force-close HTLC-timeout signature) | Encodes hard-won fleet-specific incident knowledge no off-the-shelf tool has; AP-11 alone caught fleet-cascade events worth real money | High | ✅ Core of spec |
| **Force-close *risk* prediction** (not just detection after the fact) | litd/Faraday recommend closes; none predict force-close risk from HTLC-timeout/PG-contention precursors | High | ✅ Covered (insight engine) |
| **Recommendation cards with evidence + suggested params** | LNDg/litd auto-act; NodeMonitor *recommends with auditable evidence* and keeps a human in the loop | Med | ✅ Core of spec |
| **Credential-less, local-first architecture** | Dashboard never holds 26 macaroons; nodes pull outbound-only — a security posture no incumbent offers | High | ✅ Core differentiator |
| **Signed instruction queue + operator approval gate** | Durable, audited, HMAC-signed hand-off — stronger accountability than any incumbent's fire-and-forget RPC | High | ✅ Prong 1 |
| **Cross-node comparison / fleet median bands** | Identify outliers against fleet baselines (the `healthy-range-bands.md` cross-node template) | Med | ⚠️ **Partial GAP** — implied but not explicit (see Gaps) |
| **Optional LLM narrative over flagged cards** | Plain-English "here's what I'd do" — novel, and correctly off-by-default/non-authoritative | Med | ✅ Covered |
| **Fee-crash / earnings-step-down detection** | France lost ~$1,150 to a 4-month undetected PPM crash; this directly prevents recurrence | Med | ⚠️ Implied in fee signals; make explicit (see Gaps) |

**The strongest differentiator is the combination:** fleet scorecard + encoded anti-patterns + credential-less queue. Each alone is interesting; together they are a tool that literally cannot be assembled from existing products. The roadmap should protect this combination as the MVP spine.

---

## Anti-Features

Features to **explicitly NOT build**. The spec already excludes several; this section confirms each is correctly excluded and adds ones the spec should also avoid.

| Anti-Feature | Why Avoid | What to Do Instead | Spec Status |
|---|---|---|---|
| **Custodial flows / deposits / withdrawals** | Faucet-only ethos; custodial risk is existential for a TSX-listed issuer | Read + signed-intent only; sats stay on-node | ✅ Already excluded |
| **Grafana panel parity / firehose metrics** | NodeMonitor's whole thesis is *curation*; a full panel grid dilutes the action-first value and re-creates the Grafana mirror | Surface only metrics that justify/target an action | ✅ Already excluded |
| **Faucet-node management** (`LQWD-AI-Launchpad`/`lnd-gateway`) | The AI runs it; double-management invites conflicting writes | Leave it to the AI agent; out of scope | ✅ Already excluded |
| **Persistent daemon/agent/AI on the nodes** | Expands attack surface + ops burden; violates outbound-only posture | Cron heartbeat + pre-downloaded bash only | ✅ Already excluded |
| **Automated/autopilot fee setting** (LNDg AutoFee, litd Autofees, Torq workflows) | Auto-acting fees remove the human-in-loop accountability that is NodeMonitor's core value; an unattended bad rule can crash PPM fleet-wide (the exact France failure mode, automated) | Deterministic *suggestions* + operator-approved queue | ✅ Implicitly excluded — **make explicit** so no one adds an "autopilot" toggle later |
| **Automated/autopilot rebalancing** (LNDg Autopilot, Torq auto-rebalance) | Same accountability concern + rebalances are higher-risk/cost; auto-rebalance can burn fees on dead routes | Export-only commands with safety notes (Prong 2) | ✅ Aligned with export-only decision |
| **In-app channel open** | Adds funding-tx/credential complexity for low operator value here; not a fleet-attention driver | Out of scope; operator opens via node CLI if needed | ✅ Implicitly out (not in requirements) — confirm exclusion |
| **In-app force-close/coop-close execution (v1)** | Highest-risk write; broadcasting wrong state or closing the wrong channel is unrecoverable; demands stricter gates than v1 has | Export-only (Prong 2) until Phase 8 hardening | ✅ Aligned |
| **Loop / Pool / submarine-swap integration** | Third-party custodial-adjacent services; adds dependency + scope; not the fleet's liquidity model | Rebalance via internal circular (exported `lncmd`/`lncli`) | ✅ Implicitly out — **confirm exclusion** (RTL/litd both bundle these) |
| **Watchtower management** (LNDg) | Niche; node-local concern, not a fleet-attention driver | Out of scope | ✅ Implicitly out |
| **Real-time per-event streaming / WebSocket node connections** | Implies live node connections (credentials/inbound) — contradicts the read-warehouse + queue architecture | Periodic warehouse reads + scheduled recommendation refresh | ✅ Architecturally excluded — guard against "live" scope creep |
| **Multi-tenant / public-facing UI** | This is an internal operator tool; auth/RBAC beyond operator-approval is a Phase 8 concern, not a feature | Local-first now; single-operator approval gate | ✅ Aligned (RBAC deferred to Phase 8) |

**Most important anti-feature to hold the line on:** *autopilot anything*. Three of the five comparables (LNDg, litd, Torq) lead with automation. It will be tempting to add an "auto-apply low-risk fee suggestions" toggle. Resist it in v1 — the human-approval gate IS the product's safety story, and removing it for fees first is how France's undetected PPM crash becomes a self-inflicted automated one. Document this as a locked decision.

---

## Fleet-Level Features (26 nodes — what single-node tools can't do)

This is where NodeMonitor has almost no competition. Only **Torq** (multi-node, but credentialed/per-node-connected) and **Amboss** (external watchlist, read-only) operate above a single node. Neither does fleet *health scoring* or fleet-specific *anti-pattern* detection.

| Fleet Feature | Why It Matters at 26 Nodes | Complexity | Spec Status |
|---|---|---|---|
| Fleet overview table (all nodes ranked by health/attention) | The "where do I look first" question — impossible in single-node tools | Med | ✅ Covered (Phase 2) |
| Cross-node scorecard comparison + fleet-median bands | A node is "unhealthy" relative to its peers; absolute thresholds miss drift | Med | ⚠️ **GAP** — scorecard is per-node; cross-node *comparison view* not explicit |
| Fleet-wide anti-pattern correlation (e.g., AP-11 same-day cascade across France/India/Sweden) | The 2024-09-09 cascade hit 3 nodes simultaneously — only a fleet view catches "many nodes flagging the same hour" | High | ⚠️ **GAP** — per-node detectors exist; *cross-node temporal correlation* not specified |
| Fleet roll-up alerting/severity inbox (one place for all flagged cards) | At 26 nodes, per-node tabs don't scale; need a triage queue | Med | ⚠️ Implied by recommendation cards; a *fleet inbox* view isn't explicit |
| LND-vs-LDK unified model | Two implementations, one fleet; operators shouldn't context-switch tooling | High | ✅ Covered (per-node agent abstraction) |
| Per-node version/upgrade-lag tracking | France review: aggressive upgrade cadence caused incidents; fleet needs version drift visibility | Low–Med | ⚠️ **GAP** — `cross-node-monitoring-matrix.md` Tier-4 wants it; not in spec requirements |

**Assessment:** The spec nails per-node depth but treats "fleet" mostly as "a list of nodes you drill into." The genuinely fleet-*native* features — cross-node comparison, temporal correlation of anti-patterns, a unified triage inbox — are the highest-value differentiators *and* the least specified. Flag these for the roadmap (likely Phase 2 enrichment + Phase 4 insight-engine outputs) rather than letting them fall through.

---

## Validation: the Two-Pronged Action Model

The spec splits writes into **Prong 1** (fees → signed queue, node pulls + applies) and **Prong 2** (closes/rebalances → exported copy-paste commands). Validating against how incumbents handle write actions and confirmations:

**How incumbents do it:**
- ThunderHub / RTL / LNDg / litd / Torq all hold credentials and execute writes **directly via RPC**, typically behind a single client-side confirm dialog. No durable signed intent, no separate approval gate, no audit trail beyond the node's own logs.
- LNDg / litd / Torq go further into **unattended automation** (auto-fee, auto-rebalance, workflows) — the opposite of human-in-loop.
- Notably, **none of the reference tools have a strong UI-level confirmation/guard against force-closing the wrong channel** (search found no evidence of force-close-specific warning dialogs; the safety story is "be careful"). Faraday only *recommends* closes; it doesn't gate execution.

**Verdict on the two-pronged model: SOUND and stronger than incumbents.** Specifically:

1. **Prong 1 (signed queue for fees) is more accountable than any incumbent.** HMAC signing + explicit operator-approval state + atomic claim + node-side bounds re-enforcement + idempotency/TTL is a genuinely better-engineered write path than the fire-and-forget RPC every comparable uses. The defense-in-depth (dashboard can't bypass node bounds; tampered rows rejected; un-approved rows never read) directly addresses the *absence* of guards in incumbents.

2. **Prong 2 (export-only for closes/rebalances) correctly matches risk to gate.** Because no incumbent guards force-close execution well, deferring the highest-risk action to a human-run, fully-parameterized command **with context + safety notes** is the right call — it adds the warning layer the incumbents lack, without the dashboard ever broadcasting a close.

3. **Confirmation UX recommendation (small enhancement):** incumbents under-warn on destructive actions. For Prong 2 exported close/rebalance commands, the spec's "safety notes" should be *opinionated and specific* — e.g., for a force-close: counterparty-lock implications, on-chain fee/timelock cost, "is this the right `chan_id`?" echo-back of the channel's peer alias + capacity. This is cheap (client-side string + template) and is exactly where the incumbents are weak.

4. **One risk to watch:** the queue's `update_fee` bounds must mirror the gateway's `Limits` *on the node*, not just in the dashboard. The spec already says this ("re-enforces param bounds at apply time") — keep it non-negotiable. A fee write is "low-risk" only because of that node-side clamp; without it, a bad ppm could still crash a channel's flow.

**No changes required to the model.** It is correctly risk-tiered and exceeds incumbent safety. The only additions are *richer Prong-2 safety notes* and an explicit *no-autopilot* decision.

---

## Feature Dependencies

```
Read layer (Drizzle, warehouses)
   └─> Fleet overview + per-node console
          └─> 10-dim scorecard
                 └─> Insight engine (anti-pattern + fee + rebalance detectors)
                        ├─> Recommendation cards  ──> Prong 2 (command export)   [no queue needed; ships early]
                        ├─> Recommendation cards  ──> Prong 1 (enqueue update_fee)
                        │                                  └─> nodemon queue DB + approval UI
                        │                                         └─> node heartbeat + scripts (execution)
                        └─> Optional LLM narrative (over cards; off by default)

Cross-node comparison / fleet inbox  ──depends on──>  scorecard + insight engine outputs (fleet roll-up)
```

Key ordering implications:
- **Prong 2 has zero queue dependency** — it's pure client-side string generation off recommendation cards. It can and should ship before Prong 1 (spec Phase 5 before 6 — correct).
- **Cross-node comparison/inbox** depend only on scorecard + insight outputs, not on the queue — they can be added in the analytics arc (Phase 2/4) without waiting for execution infra.
- **The queue (Phase 6) and node heartbeat (Phase 7)** are the only execution dependencies; everything upstream delivers standalone value read-only.

---

## MVP Recommendation

Prioritize (in spec order, which is sound):
1. **Read layer + fleet overview + per-node console** (table stakes; reproduces known node-review numbers — also the correctness gate against the DISTINCT-ON / sat→BTC failure modes).
2. **10-dimension scorecard + insight engine with AP-11/AP-12 + fee/rebalance detectors** (the differentiator spine).
3. **Prong 2 command export** (table-stakes action capability, zero write-risk, ships standalone value early).
4. **Prong 1 queue + approval UI + node heartbeat** (the accountable fee-write path).

Add to MVP scope (cheap, high-value, currently under-specified):
- **Cross-node comparison view + fleet triage inbox** — fold into the fleet-overview/insight phases; this is the fleet-native value and barely more work than the per-node views.
- **Explicit fee-crash / earnings-step-down detector** — directly prevents the documented France loss; it's one more detector in an engine already being built.
- **CSV export** of fleet/forwarding/closes — accounting parity with every incumbent; low cost.

Defer (correctly, to Phase 8 or never):
- Queue actions beyond `update_fee` (closes/rebalances) — stays export-only until stricter gates.
- Dashboard RBAC / multi-operator — Phase 8.
- Version-lag tracking, config-drift — nice-to-have monitoring, lower priority than action features.

Never build: autopilot fees/rebalancing, custodial flows, Loop/Pool integration, in-app force-close, on-node daemon, Grafana parity.

---

## Gap / Creep Assessment vs the Spec

**Scope creep risk in the spec:** **None found.** The spec is unusually disciplined — every feature traces to an action, and the Out-of-Scope section pre-empts the obvious creep vectors (Grafana parity, custodial, faucet node, on-node daemon). The two-pronged model is *narrower* than incumbents, not broader.

**Table-stakes / high-value features the spec is missing or under-specifies:**

| Gap | Severity | Recommendation |
|---|---|---|
| **CSV / data export** | Low–Med | Every incumbent (RTL, LNDg, Torq) has it; operators expect it for accounting/audit. Add to per-node console + fleet views. |
| **Cross-node comparison view** (vs fleet-median bands) | **Med–High** | The `healthy-range-bands.md` cross-node template exists but the spec only delivers *per-node* scorecards. The fleet-relative view is a top differentiator — make it explicit in the fleet-overview phase. |
| **Fleet-wide temporal anti-pattern correlation** (same-hour AP-11 across nodes = cascade) | **Med–High** | The 2024-09-09 cascade is the marquee incident; detecting "N nodes flagging the same hour" needs a cross-node correlation pass, not just per-node detectors. Add to insight engine. |
| **Fleet triage inbox** (one severity-ranked queue of all cards) | Med | At 26 nodes, per-node tabs don't scale for triage. Cheap to add once cards exist. |
| **Explicit fee-crash / earnings-step-down detector** | Med | Implied by fee signals but the *step-down* / *PPM-crash* detector (France's $1,150 lesson) deserves to be a named card with its own threshold. |
| **Richer Prong-2 safety notes** (echo-back peer alias/capacity, force-close cost/timelock) | Low | Incumbents under-warn here; cheap client-side win that makes export-only *safer* than incumbent execute. |
| **Version-lag / config-drift tracking** | Low | Tier-4 monitoring want; defer, but note it exists. |

**Decisions to lock (to prevent future creep):**
- No autopilot / unattended automation for any write action in v1 (the human-approval gate is the product).
- No Loop/Pool/submarine-swap integration (third-party custodial-adjacent).
- No in-app channel open and no in-app close execution in v1.

---

## Sources

- ThunderHub features (channel/fee/rebalance/liquidity): https://docs.thunderhub.io/ , https://github.com/apotdevin/thunderhub , https://medium.com/coinmonks/lightning-network-channel-balancing-with-thunderhub-972b41bf9243 — HIGH
- LNDg (AutoFee, auto-rebalance, P&L, failed-HTLC, API): https://github.com/cryptosharks131/lndg , https://github.com/cryptosharks131/lndg/blob/master/README.md , https://raspibolt.org/guide/bonus/lightning/lndg.html , https://www.nobsbitcoin.com/lndg-v1-7-0/ — HIGH
- RTL (mass fee update, close, peers, reports, CSV export, Loop/Boltz): https://github.com/Ride-The-Lightning/RTL/blob/master/.github/docs/Application_features.md , https://github.com/Ride-The-Lightning/RTL — HIGH
- Lightning Terminal / litd (Autofees, ROI/channel dashboard, Loop/Pool): https://lightning.engineering/posts/2023-04-26-litd-release/ , https://docs.lightning.engineering/lightning-network-tools/lightning-terminal/autofees , https://github.com/lightninglabs/lightning-terminal — HIGH
- Torq (multi-node, tags, workflows, auto-rebalance, dry-run, HTLC firewall, 1000+ ch): https://github.com/lncapital/torq , https://github.com/lncapital/torq/blob/main/README.md , https://www.nobsbitcoin.com/torq-v1-0-3/ , https://docs.torq.co/hc/docs/en/categories/automations — HIGH
- Faraday close recommendations: https://lightning.engineering/posts/2020-04-02-faraday/ — MEDIUM
- LND force-close safety semantics: https://github.com/lightningnetwork/lnd/blob/master/docs/safety.md — HIGH
- Monitoring tool landscape (lndmon, lntop, lndash): https://www.lopp.net/lightning-information.html , https://lightning.engineering/posts/2019-07-22-lndmon-v0.1/ — MEDIUM
- Internal: `vast-popping-starlight.md`, `PROJECT.md`, `healthy-range-bands.md`, `cross-node-monitoring-matrix.md` — primary source of truth for spec + thresholds
