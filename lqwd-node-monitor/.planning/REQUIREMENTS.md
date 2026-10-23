# NodeMonitor — Requirements

Derived from the approved spec (`~/.claude/plans/vast-popping-starlight.md`), validated and sharpened by project research (`.planning/research/`). All v1 requirements are hypotheses until shipped and validated.

## v1 Requirements

### Read Layer (READ)

- [ ] **READ-01**: Operator can connect the app to both warehouses (`routing_vm`, `ldk-lspd-main`) read-only via env-supplied URLs, with a boot-time health check that fails loudly if either is unreachable or not read-only.
  - *AC:* Three Drizzle clients on three least-privilege roles (2 RO warehouses + 1 RW `nodemon`); read-only enforced at the DB **role** level; `import "server-only"` guards all DB/credential modules; no `localhost` literals (config-driven for the local→VM flip).
- [ ] **READ-02**: All "latest channel state" reads use a single sanctioned `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC` helper — never `WHERE timestamp = MAX(timestamp)` on event-driven `lnd_node_channel_info` (AFM-001).
  - *AC:* Channel counts cross-validated against `lnd_node_info.active_channels`; a unit test reproduces the Canada reference channel count.
- [x] **READ-03**: All sat/BTC/fee values render through a single unit formatter (`fee_msat/1000.0`, correct sat→BTC) — no ad-hoc conversions anywhere (AFM-002).
  - *AC:* Formatter unit-tested against known `lqwdLogs` reference values.
- [x] **READ-04**: LND and LDK node data are normalized into one unified per-node model so the UI renders both fleets through the same components.

### Fleet Overview (FLEET)

- [ ] **FLEET-01**: Operator sees a fleet overview listing all nodes with at-a-glance health, curated to operator-relevant signals (not a Grafana firehose).
- [ ] **FLEET-02**: Operator sees a per-node 10-dimension health scorecard computed from the warehouse (stability, PG health, restart, peer, routing, force-close prevention, channel health, revenue, liquidity, visibility).
- [ ] **FLEET-03**: Operator can compare each node against fleet-median bands (cross-node comparison), not just per-node in isolation.

### Per-Node Console (NODE)

- [x] **NODE-01**: Operator can drill into one node and view its channels, fee report, liquidity balance, forwards, closes, and peers.
- [x] **NODE-02**: Operator can export any per-node table (channels, forwards, closes, fees) to CSV for accounting/audit.

### Pending Channel Monitor (PENDING)

- [x] **PENDING-01**: Operator sees all pending channels — pending opens, pending coop-closes, and pending force-closes — per node and fleet-wide, with state, age, limbo/time-locked balance, and (for sweeps) `broadcast_attempts`. Built from `lnd_node_pending_channels` + `lnd_node_pending_sweeps`.
- [ ] **PENDING-02**: A stuck-pending detector flags, with evidence and severity, three cases:
  - (a) **Force-close past maturity** — channel still pending force-close after its expected maturity/CSV delay has elapsed (time-locked balance present, maturity height passed) → restart/attention candidate.
  - (b) **Stuck sweep** — a pending sweep with high `broadcast_attempts`, aged `created_at`, or under-fee'd output → CPFP-bump candidate.
  - (c) **Stuck open** — a pending-open channel that has not confirmed within an expected window → aged-funding candidate.
  - *AC:* Stuck cards surface in the fleet triage inbox (INSIGHT-03) ranked by limbo balance at risk.
- [x] **PENDING-03**: For each stuck case, operator gets a Prong-2 **exported** remediation command/runbook (never an automated write):
  - stuck sweep → `lncli wallet bumpfee` / CPFP command with the outpoint + a suggested sat/vB, mirroring `lqwdLogs/_library/scripts/07-bump-stuck-sweeps.sh`;
  - force-close past maturity → the **safe coordinated-restart procedure** (referencing the drain-wrapper / `01-safe-lnd-restart.sh`), explicitly NOT an auto-restart;
  - each export echoes context (chan point, peer, limbo amount, age, attempts) and safety notes.

### Insight Engine (INSIGHT)

- [ ] **INSIGHT-01**: The engine emits structured recommendation cards `{severity, node, target, signal, evidence, suggested_action, params}` from encoded `lqwdLogs/_library` thresholds. The card schema is frozen as a hard contract before export/queue consume it.
- [ ] **INSIGHT-02**: Deterministic detectors fire with correct severity + evidence for: AP-11 close-storm (≥50 self-closes/hr), AP-12a connection-exhaustion, AP-12b serialization-storm, force-close HTLC-timeout signature, fee signals (raise/lower/close-candidate), and rebalance-success signals.
- [ ] **INSIGHT-03**: Operator sees one fleet-wide, severity-ranked triage inbox of recommendation cards across all nodes (not only per-node tabs).
- [x] **INSIGHT-04**: An explicit fee-crash / earnings-step-down detector flags sudden fee-revenue collapse per node.
- [ ] **INSIGHT-05**: A fleet-wide temporal correlation detector flags same-hour multi-node close clusters (the AP-11 cascade signature).
- [ ] **INSIGHT-06**: The engine **suppresses write recommendations** (fee updates) to any node currently flagged AP-11/AP-12, and applies fee hysteresis + per-node write rate-limit guidance — the tool must not recommend actions that reproduce the patterns it detects.
- [x] **INSIGHT-07**: Operator can optionally generate a plain-English LLM narrative over the flagged cards; it is off by default, narrates only, and never produces or alters signed action params (numeric values come from the deterministic engine).

### Command Export — Prong 2 (EXPORT)

- [x] **EXPORT-01**: For closures and rebalances, operator gets a ready-to-run, fully-parameterized `lncli` (LND) / `lncmd` (LDK) command with context + safety notes (echoing peer alias, capacity, and timelock). Pure client-side string generation; no write path.

### Command Queue — Prong 1 (QUEUE)

- [ ] **QUEUE-01**: Operator can enqueue an `update_fee` intent from a recommendation card into the `nodemon` queue DB; it is created in `pending_approval` and does nothing until explicitly approved.
- [ ] **QUEUE-02**: Each queued command is HMAC-signed over `node_pubkey + command_id + action_type + canonical(params) + expires_at` (SHA-256, lowercase hex, key-sorted canonical JSON), with a per-node secret.
- [ ] **QUEUE-03**: Operator approves/rejects a command in the UI; only `approved` commands are eligible for execution; every state transition is recorded in an append-only audit table.
- [ ] **QUEUE-04**: The full state machine (`draft→pending_approval→approved→claimed→executing→succeeded|failed|rejected|expired`) is proven against a **stub executor** with: atomic `SELECT … FOR UPDATE SKIP LOCKED` claim, fail-closed expiry (TTL→`expired`), and a stale-claim reaper for rows stuck past N×interval.

### Inbox Triage Rebuild (INBOX)

- [x] **INBOX-01**: The `/inbox` opens with critical + warn cards as individual scannable rows above the fold and routine/info (fee) cards collapsed into expandable per-signal → per-node count groups; it never renders all cards as one flat scroll, and no card is dropped — suppressed cards stay visible with their reason verbatim.
- [x] **INBOX-02**: A collapsible filter rail filters the inbox by severity, node, signal, and suggested action, each with a live count; facets combine to narrow the visible set; the rail toggles off for a full-width view.
- [x] **INBOX-03**: Selecting a card opens an in-page detail drawer with the card's full evidence (metric, observed vs threshold, window, freshness/trend) and its suggested-action affordance (enqueue / export / remediate / investigate), without navigating away from the inbox.
- [x] **INBOX-04**: Fee-update groups expose a bulk-enqueue action (per-node and/or multi-select) that enqueues many `update_fee` intents in one gesture through the Phase-6 signed queue — each re-validated and re-signed server-side (never a client signature), honoring AP-11/AP-12 write suppression and per-node rate-limit guidance.

### Node Execution — heartbeat distribution (EXEC)

- [ ] **EXEC-01**: A scripts folder (`check-queue` + `apply-fee`) + bash downloader, deployed via the existing fleet remote-fileserver pattern, installs/updates a node's crontab heartbeat — no persistent daemon/agent/AI on the node.
- [ ] **EXEC-02**: On each heartbeat tick a node reads only its own pubkey's `approved` jobs, verifies the HMAC, re-enforces param bounds **node-side**, applies via local `lncli`/`lncmd` using **argv invocation (never shell-string interpolation)**, and writes the result + execution row + audit back to the queue.
- [ ] **EXEC-03**: End-to-end validated on one pilot node: an approved `update_fee` applies and reports `succeeded` with the new policy visible on-node; and the five failure modes are rejected/handled — tampered HMAC, un-approved row, expired command, overlapping ticks (no double-apply), wrong-pubkey job.

### Hardening (HARDEN)

- [x] **HARDEN-01**: Grade-A security scan (no CRITICAL/HIGH) before any production deploy.
- [ ] **HARDEN-02**: The app boots to a VM from env vars only (DB URLs, fileserver location, secrets) — the local→VM flip is config-only, no code changes.

## v2.0 — Operations Center Requirements

Full-stack redesign on the locked "Data-Forward" design system. Reuses the v1 backend (READ/INSIGHT/EXPORT/QUEUE/EXEC); replaces the v1 UI (FLEET/NODE-console/INBOX). Design source of truth: claude.ai/design project `372850ad-bbae-46da-a40f-3eb3d03befa0`.

### Design System (DS)

- [x] **DS-01**: A Data-Forward design-system foundation defines all tokens (color, type scale, spacing, radius, shadow), the IBM Plex Sans/Mono pairing, and a canonical severity ramp (critical/warning/watch=teal/healthy) kept structurally separate from brand navy; light-only.
  - *AC:* one canonical token set (resolves the prototype drift: chrome `#13284F` vs brand `#1A3C79`, ok-green `#1E9E63` vs `#1E7A4E`, critical `#E0392B` vs `#D92638`); no severity hue reused as chrome.
- [x] **DS-02**: Shared component primitives are extracted from the locked prototypes — severity-tinted card/row, inline evidence chart (Recharts), two-axis status pip, freshness chip, runbook/command modal, AI-read panel, nav rail/shell — reused across every v2 screen.
- [x] **DS-03**: The NOC-instrument look is retired — prior mono-instrument tokens/components superseded; exactly one theme ships.

### Ops Center Overview (OVW)

- [x] **OVW-01**: Operator sees a full-stack attention queue spanning nodes/hosts/services/bitcoind/storage, root-cause grouped (one host outage rolls its child node alerts into a single incident), each row showing severity + a one-line why + the layer.
- [x] **OVW-02**: An AI "what needs you now" band presents 1–4 prioritized plain-language lines; advisory-only (never emits a command); dismissible; per-line severity.
- [x] **OVW-03**: A fleet-vitals rollup shows per-layer counts (nodes/hosts/services/bitcoind/storage) and a strictly proportional health bar.
- [x] **OVW-04**: The overview has an honest all-clear state (calm hero when nothing is wrong) and honest stale/no-data representation everywhere (never faked freshness).
- [x] **OVW-05**: The queue filters by layer (Hosts/Services/bitcoind/Nodes/Storage) and severity, with honest empty states.

### Node UI + Service Health (NODE / SVC)

- [x] **NODE-03**: The Nodes list is rebuilt on the new system — at-risk rows pop (left accent + tint), type/status/stale filters, sortable columns, liquidity/forwarding evidence, row→detail navigation.
- [x] **NODE-04**: Node Detail is rebuilt — identity, Lightning performance (channels/fees/forwards/peers/history), active diagnostics with evidence charts, adaptive action (Export fix / Open runbook / Investigate), read-only safety posture.
- [x] **SVC-01**: Node Detail carries a per-node control-plane service-health grid for the 6 LQWD services (aiLiquidityManager, internalRebalancer, Monitoring, nodeAuditor, addressBalances, channelAcceptor) + infra deps, each shown two-axis — RUNNING (process alive) AND FUNCTIONING NORMALLY (fresh heartbeat / last successful run / no error spike) — green only when both; the "up but dead" state is unmistakable.
- [x] **SVC-02**: Service Detail shows one service's two-axis health, heartbeat / last-successful-run / error count, a log tail, restart history, dependents, and a unified verify-first runbook; with infra (bitcoind) and custom-service (addressBalances) variants.

### Host / Infra Monitoring (HOST)

- [ ] **HOST-01**: The Hosts list shows per-host cards with a worst-of severity rollup (infra + nodes + resources), CPU/mem/disk meters with threshold coloring, the infra trio (bitcoind/esplora/postgres) two-axis, node-health dots, and filters/sort (incl. stale).
- [ ] **HOST-02**: Host Detail shows VM vitals (CPU/mem/disk + sparklines), infra services (two-axis), storage volumes with %/day growth + projected time-to-full, the nodes on the host, and the root-cause incident + runbook.

### Incident & Alert Lifecycle (INC)

- [x] **INC-01**: Incident Detail shows the root-cause why-chain / detection timeline, a blast-radius diagram (one host → its affected nodes), the grouped child alerts, and related cross-links.
- [x] **INC-02**: An operator can acknowledge / assign / snooze an incident; these are tracking-only (update the incident record, never touch the fleet); status + owner reflect the change; a critical incident cannot be silently muted.

### AI Explanation Layer (AIX)

- [x] **AIX-01**: An AI log/error read explains, in plain operator language, what a service's log pattern means, whether it needs attention now, and the dependency/impact path; clearly labeled AI, dismissible, and never emits a runnable command.
- [x] **AIX-02**: AI cross-layer correlation ties an infra failure to its downstream node/HTLC impact, producing the root-cause grouping rationale shown on the overview and incident detail.

### Data Collection Expansion (Phase 15 — pre-AI data-gap fill)
- [x] **COL-01**: Service log/error events (matched error/warn lines — level, message, service, host, node, timestamp, normalized signature) are persisted into a bounded, retention-capped `nodemon` table at `*/5`; known-benign patterns are suppressed; `NodeLogsStream`/`ServiceLogTail` render real data, not the empty stub.
- [x] **COL-02**: PostgreSQL AP-12 signatures (`FATAL: too many clients`, serialization `40001`) + `pg_stat_*` counters are ingested, making AP-12 detection deterministic and retiring the `ap12-advisory` LLM fallback.
- [x] **COL-03**: Deeper Ubuntu/VM metrics (per-core CPU + steal/iowait, disk I/O per device, network errors/drops/retransmits, memory detail + OOM, fd/limits, systemd failed units, clock skew, core count) are collected RAW into `nodemon` and surfaced on host/VM detail.
- [x] **COL-04**: Log capture is interval-complete and rotation-safe — every `[ERR]` written during a `*/5` interval is recorded (incremental offset-checkpoint scan replaces the fixed 64KB tail; per-log cursor in a LOCAL node state file so the collector stays SELECT-only on the warehouse; bounded per-tick bytes with a LOGGED truncation), across both LND stable-name rename-archive and Postgres timestamped-filename (glob/newest-match) rotation.
- [x] **COL-05**: Capture breadth and fidelity — lines are captured by `log_patterns_config` match (not just a single `error_pattern` substring), native-probed services (postgres/bitcoind) are log-tailed (tailing decoupled from `detection_method`), and signatures normalize out IP:port so per-peer errors collapse.
- [x] **COL-06**: Classification reflects reality and paths self-maintain — `log_patterns_config` is re-derived from REAL fleet logs (CMGR noise suppressed, HSWC churn benign, sweep failures flagged, LND "too many clients" → ap12); per-node log paths are populated owner-side via a discovery script + declarative service→path convention; the `lncli` wrapper uses an absolute `LNCLI_BIN` (fixes the root/cron `pubkey=none` skip).

### Telemetry Ingestion (TEL)

- [ ] **TEL-01**: Host/VM metrics (CPU/mem/disk/network, storage usage + growth) are ingested into the read model, extending the Phase 8 heartbeat/collector pattern.
- [ ] **TEL-02**: Service-health signals (running + functioning: heartbeat freshness, last-successful-run, error counts) are ingested for the infra trio and the 6 custom services, per node/host.
- [ ] **TEL-03**: bitcoind/chain telemetry (sync lag / blocks behind tip, verificationprogress, peers, mempool) is ingested and surfaced as evidence with thresholds.

### Hardening (HARDEN, continued)

- [x] **HARDEN-03**: A Grade-A security scan (no CRITICAL/HIGH) of the new v2 surfaces precedes any production deploy; re-affirms the zero-write-path posture on the new UI and that the AI layer never emits executable params.

## Deferred / Future (beyond current scope)

- [ ] **AI-narrative depth**: richer LLM advisory beyond per-node narrative (deferred until v1 deterministic engine is validated).
- [ ] **Queue actions beyond `update_fee`** (e.g. queued closes/rebalances behind stricter multi-party gates).
- [ ] **Dashboard RBAC** (multi-operator roles) — single-operator local tool in v1.
- [ ] **Scheduled recommendation refresh** (background cron computing cards) — on-demand in v1.

## Out of Scope (explicit)

- **Autopilot / auto-apply of any write action** — every write requires explicit operator approval; this human gate is the core safety story. Re-adding it would defeat the design.
- **In-app channel open/close execution in v1** — closures/rebalances are export-only (Prong 2) until stricter gates exist.
- **The AI-operated faucet node** (`LQWD-AI-Launchpad` / `lnd-gateway`) — AI runs it; not monitored/managed here.
- **SaturnZap** — not on any fleet node.
- **Deposits / withdrawals / custodial flows** — faucet-only ethos, no custodial risk.
- **Persistent daemon/agent/AI on nodes** — cron + pre-downloaded bash only.
- **Replacing Grafana / exhaustive panel parity** — curated operator signals only.
- **Loop/Pool or third-party liquidity-service integration** — out of scope for an internal control tool.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| READ-01 | Phase 1 | Pending |
| READ-02 | Phase 1 | Pending |
| READ-03 | Phase 1 | Complete |
| READ-04 | Phase 1 | Complete |
| FLEET-01 | Phase 2 | Pending |
| FLEET-02 | Phase 2 | Pending |
| FLEET-03 | Phase 2 | Pending |
| NODE-01 | Phase 3 | Complete |
| NODE-02 | Phase 3 | Complete |
| PENDING-01 | Phase 3 | Complete |
| INSIGHT-01 | Phase 4 | Complete |
| INSIGHT-02 | Phase 4 | Complete |
| INSIGHT-03 | Phase 4 | Complete |
| INSIGHT-04 | Phase 4 | Complete |
| INSIGHT-05 | Phase 4 | Complete |
| INSIGHT-06 | Phase 4 | Complete |
| INSIGHT-07 | Phase 4 | Complete |
| PENDING-02 | Phase 4 | Complete |
| EXPORT-01 | Phase 5 | Complete |
| PENDING-03 | Phase 5 | Complete |
| QUEUE-01 | Phase 6 | Pending |
| QUEUE-02 | Phase 6 | Pending |
| QUEUE-03 | Phase 6 | Pending |
| QUEUE-04 | Phase 6 | Pending |
| INBOX-01 | Phase 7 | Complete |
| INBOX-02 | Phase 7 | Complete |
| INBOX-03 | Phase 7 | Complete |
| INBOX-04 | Phase 7 | Complete |
| EXEC-01 | Phase 8 | Pending |
| EXEC-02 | Phase 8 | Pending |
| EXEC-03 | Phase 8 | Pending |
| HARDEN-01 | Phase 18 | Complete |
| HARDEN-02 | Phase 18 | Pending |

### v2.0 — Operations Center Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DS-01 | Phase 10 | Complete |
| DS-02 | Phase 10 | Complete |
| DS-03 | Phase 10 | Complete |
| TEL-01 | Phase 11 | Pending |
| TEL-02 | Phase 11 | Pending |
| TEL-03 | Phase 11 | Pending |
| OVW-01 | Phase 12 | Complete |
| OVW-02 | Phase 12 | Complete |
| OVW-03 | Phase 12 | Complete |
| OVW-04 | Phase 12 | Complete |
| OVW-05 | Phase 12 | Complete |
| NODE-03 | Phase 13 | Complete |
| NODE-04 | Phase 13 | Complete |
| SVC-01 | Phase 13 | Complete |
| SVC-02 | Phase 13 | Complete |
| HOST-01 | Phase 14 | Pending |
| HOST-02 | Phase 14 | Pending |
| COL-01 | Phase 15 | Complete |
| COL-02 | Phase 15 | Complete |
| COL-03 | Phase 15 | Complete |
| COL-04 | Phase 16 | Complete |
| COL-05 | Phase 16 | Complete |
| COL-06 | Phase 16 | Complete |
| INC-01 | Phase 17 | Complete |
| INC-02 | Phase 17 | Complete |
| AIX-01 | Phase 17 | Complete |
| AIX-02 | Phase 17 | Complete |
| HARDEN-03 | Phase 18 | Complete |
