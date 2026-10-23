# Pitfalls Research

**Domain:** Local-first Lightning fleet operator-control dashboard — reads production warehouses (`routing_vm` LND + `ldk-lspd-main` LDK), computes deterministic insight, and applies operator-approved fee changes to a LIVE 26-node routing fleet via a signed pull-queue + node-side cron heartbeat.
**Researched:** 2026-06-05
**Confidence:** HIGH (analytics + Lightning-ops pitfalls are operator-documented in `lqwdLogs/_library`; write-path + Next.js pitfalls verified against Postgres queue idioms and framework docs)

> This is a financial control surface over a live routing fleet. A wrong number drives a wrong decision; a wrong write mis-prices or double-applies on a node carrying tens of BTC. Every pitfall below is domain-specific — generic web-app advice is omitted.

---

## Critical Pitfalls

### Pitfall 1: `WHERE timestamp = MAX(timestamp)` on event-driven warehouse tables (AFM-001)

**What goes wrong:**
`lnd_node_channel_info`, `lnd_node_peer_info`, `lnd_node_pending_channels`, and `lnd_node_pending_sweeps` are **event-driven** — each row is one entity's update at one moment, NOT a synchronized fleet snapshot. A query filtering to the single newest timestamp returns ~1 row (the last channel that happened to update), so a 480-channel node renders as a 1-channel node. Every downstream scorecard dimension, fee signal, and recommendation card built on that count is wrong.

**Why it happens:**
The table *looks* like a snapshot — it has a `timestamp` column and one row per channel. The mental model "latest timestamp = current state of everything" is intuitive and wrong for append-only event logs. This is documented as a real failure that corrupted ~7 deliverables in the Canada 2026-05-26 review before the operator caught it by contradiction ("Canada has almost 500 active channels").

**How to avoid:**
- Use the `DISTINCT ON (entity_id) ... ORDER BY entity_id, timestamp DESC` idiom for every event-driven table — make it the *only* sanctioned latest-state query shape. Centralize it in one helper so no hand-written `MAX(timestamp)` can slip into a query function.
- Cross-validate channel counts against `lnd_node_info` (a TRUE per-node snapshot) — its `active_channels`/`inactive_channels`/`pending_channels` are authoritative ground truth. The two MUST match.
- Codify the affected/not-affected table list in the Drizzle schema layer as comments/types so the boundary is visible at the call site. (`lnd_node_info` and `lnd_node_closed_channels` are snapshot/event-record and `MAX`/per-row is fine; the other four are NOT.)

**Warning signs:**
- A query returns 1 row (or single digits) where domain knowledge says hundreds.
- Channel count from `lnd_node_channel_info` disagrees with `lnd_node_info.active_channels`.
- A node's scorecard suddenly swings dozens of points between refreshes with no real event.

**Phase to address:**
Phase 1 (Foundations — read layer). Build the `DISTINCT ON` helper and the `lnd_node_info` cross-validation as the first thing on top of the connections. Phase 2 verification must reproduce a known `lqwdLogs` node's channel/forward counts before any scorecard ships.

---

### Pitfall 2: sat→BTC and msat→sat conversion errors (AFM-002 + `fee_msat` convention)

**What goes wrong:**
Two compounding unit bugs. (1) sat→BTC eyeballed instead of `÷100,000,000` — every affected value in the Canada review was **10× off** (3.36 BTC reported vs 33.6 BTC actual; 30 BTC vs 300 BTC routing volume). (2) Fees are stored in **millisatoshis**; using a `fee` column or forgetting `/1000.0` makes every fee/revenue figure 1000× wrong. Combined, a node looks both smaller and lower-value than reality, and fee recommendations fire on numbers off by three orders of magnitude.

**Why it happens:**
Large 9–12 digit sat integers don't carry an obvious scale; the brain rounds "billions of sats" to a plausible-feeling BTC number. The msat/sat distinction is invisible unless you know the column semantics — `fee_msat` and `fee` can coexist and "fee" reads as the obvious one.

**How to avoid:**
- Do ALL unit math in SQL or in one typed formatter — never in narrative/component code. `ROUND(sat_col / 100000000.0, 4) AS btc` and `fee_msat / 1000.0 AS fee_sat`. Forbid raw `fee` and raw sat→BTC division anywhere in component code.
- Single shared `formatSats`/`formatBtc`/`feeMsatToSat` utility, unit-tested with the known reference values (3,359,047,565 sat = 33.6 BTC, etc.). Every displayed number goes through it.
- Back-conversion assertion in the read-layer verification: any displayed BTC value × 100,000,000 must equal the source sat value within ±1%.

**Warning signs:**
- A headline BTC/fee figure "feels" an order of magnitude off vs a known `lqwdLogs` review.
- Two views show the same metric with a 10× or 1000× discrepancy.
- A fee recommendation card fires on a ppm that's implausibly high/low.

**Phase to address:**
Phase 1 (read-layer formatters + unit tests). Re-verified in Phase 2 (scorecard) and Phase 4 (insight engine — fee thresholds operate on `fee_msat/1000.0`).

---

### Pitfall 3: Double-applying a fee update across overlapping cron heartbeats

**What goes wrong:**
A heartbeat tick claims an `approved` job; the action script is slow (lncli/lncmd round-trip, or a retry); the next cron tick fires before the first finishes and claims the same row again → the fee policy is applied twice (or two executors race), corrupting the audit trail and potentially double-counting in any "applied delta" logic. On a routing fleet this mis-prices channels and pollutes the very analytics that drive the next decision.

**Why it happens:**
Cron has no concept of "previous tick still running." A naive `SELECT approved jobs` → `apply` → `UPDATE status` leaves a window between SELECT and UPDATE where a second worker sees the same row.

**How to avoid:**
- Atomic claim in a SINGLE statement — `UPDATE commands SET status='claimed', claimed_at=now(), executor_id=$me WHERE id=$id AND status='approved' RETURNING *`. Only the worker that gets a row back proceeds; the race-losing tick gets zero rows and skips. (Equivalently `SELECT ... FOR UPDATE SKIP LOCKED` then update — but the conditional-UPDATE-RETURNING form is simpler and sufficient here.) This is the project's locked design — enforce it in the `check-queue` script, never a read-then-write pair.
- Per-command idempotency key + a node-side "already applied this idempotency key" guard, so even a retry after a crashed claim can't double-apply.
- Stale-claim recovery: a job stuck in `claimed`/`executing` past a timeout is requeued/failed explicitly, not silently re-grabbed.

**Warning signs:**
- Two `executions` rows for one `command_id` with overlapping timestamps.
- `lncli` reports the policy is already at the target value on a "fresh" apply.
- Heartbeat run time approaching or exceeding the cron interval.

**Phase to address:**
Phase 6 (command queue — atomic claim + idempotency in the schema/claim logic) and Phase 7 (node heartbeat — the `check-queue` claim must be the single atomic statement; pilot-node verification explicitly tests overlapping ticks).

---

### Pitfall 4: Stale / expired intents applying after conditions changed

**What goes wrong:**
An operator approves "raise chan X to 500 ppm" based on a snapshot. Hours pass before the node's heartbeat applies it (node offline, queue backlog, long approval-to-apply gap). By apply time the channel may be closed, force-closed (AP-11), drained, or already re-priced — the fee change is now wrong or applied to a dead channel. On a fleet where AP-11 close-storms can vaporize a channel base in an hour, "approved an hour ago" can mean "the target no longer exists."

**Why it happens:**
The queue decouples decide-time from apply-time (by design, for security), but that gap is exactly where the world moves. Without a TTL, an old intent looks identical to a fresh one when the heartbeat finally reads it.

**How to avoid:**
- TTL per command — expired (un-applied past TTL) commands auto-`expired`, never apply. This is the project's locked design; make the TTL short (minutes, not hours) for fee changes.
- Node-side pre-apply revalidation: before `updatechanpolicy`, the apply script confirms the target channel is still active and still owned by this node; abort + report if not.
- Surface "approved age" in the UI and warn when approving against data older than N minutes (ties to Pitfall 9).

**Warning signs:**
- Commands sitting in `approved` longer than the TTL.
- Apply scripts erroring with "channel not found" / "channel inactive."
- A spike of `expired` commands after a node availability event.

**Phase to address:**
Phase 6 (TTL + `expired` transition in the state machine) and Phase 7 (node-side target-still-valid revalidation before apply).

---

### Pitfall 5: HMAC / signing weaknesses and clock-skew on the verify path

**What goes wrong:**
The dashboard HMAC-signs each command row; the node verifies before executing. Failure modes: (a) signing only *some* fields, so an attacker who can write to the queue DB mutates an unsigned field (e.g. the params, or `node_pubkey`) without breaking the signature; (b) non-constant-time comparison enabling timing attacks; (c) a TTL/nonce tied to wall-clock with skew between dashboard and node, so valid jobs expire early or expired jobs verify; (d) one shared secret for all 26 nodes, so a leak compromises the whole fleet.

**Why it happens:**
HMAC "works" in the happy path even when it signs the wrong field set or compares non-constant-time — the bug is invisible until probed. Clock skew is silent until a node's clock drifts.

**How to avoid:**
- Sign a canonical serialization of ALL security-relevant fields: `node_pubkey + action_type + canonical(params) + idempotency_key + created_at + ttl`. Verify the exact same canonical form node-side. A tampered DB row then fails verification — the queue is treated as untrusted transport, which is the whole point of the design.
- Per-node shared secret (not one fleet-wide secret); secret lives only on the dashboard host and the one node. Blast radius of a leak = one node.
- Constant-time comparison for the MAC.
- Make expiry primarily server/DB-driven (compare against DB `now()`), not the node's local clock, to neutralize skew; if node-side time is used, allow a bounded skew window and require NTP on nodes.

**Warning signs:**
- Verification passes after manually editing a `params` value in the DB (must FAIL — test this).
- Nodes rejecting valid jobs intermittently (clock drift).
- Secret reused across nodes in config.

**Phase to address:**
Phase 6 (canonical signing over all fields, per-node secrets) and Phase 7 (node-side verify uses identical canonicalization; pilot test that a bad-HMAC row is rejected). Security-scan gate before any production deploy (Constraints: Grade-A, no CRITICAL/HIGH).

---

### Pitfall 6: A node executing the wrong pubkey's job

**What goes wrong:**
Node B's heartbeat applies a fee change intended for node A — because the check-queue script filters loosely, or `node_pubkey` is matched as an unsigned/mutable field, or a config copy-paste left two nodes sharing an identity. Result: the wrong node's channels get re-priced, and the audit trail attributes it to the wrong node.

**Why it happens:**
Per-node deploys are copy-paste-heavy (26 nodes, same scripts). A single wrong env var or a `WHERE status='approved'` that forgot `AND node_pubkey=$me` mis-targets. If `node_pubkey` isn't inside the HMAC, a DB-layer mistake silently re-points a job.

**How to avoid:**
- Atomic claim MUST be scoped by identity: `... WHERE id=$id AND status='approved' AND node_pubkey=$my_pubkey RETURNING *`. A node never reads or claims rows for another pubkey.
- `node_pubkey` is inside the HMAC (Pitfall 5), so it can't be flipped post-signing.
- Node identity derived from the node's own creds at runtime (query its real pubkey via lncli/lncmd) and asserted to equal the configured pubkey before claiming anything — catches a mis-provisioned config.
- Per-node secret (Pitfall 5) means a job signed for A literally won't verify on B even if mis-routed.

**Warning signs:**
- An `executions` row whose `executor_id`/node doesn't match the command's `node_pubkey`.
- A node's configured pubkey ≠ its lncli-reported pubkey at startup.

**Phase to address:**
Phase 7 (identity-scoped atomic claim + runtime pubkey self-check), reinforced by Phase 6 (pubkey in HMAC).

---

### Pitfall 7: lncli/lncmd command injection from un-sanitized params

**What goes wrong:**
Params flow dashboard → queue (jsonb) → node bash script → `lncli updatechanpolicy ...`. If the apply script interpolates params into a shell string (`lncli updatechanpolicy --base_fee_msat $base --fee_rate $rate --chan_point $cp`), a malicious or malformed param (`; rm -rf`, `$(...)`, backticks, a chan_point with shell metacharacters) executes as the node's privileged user — which holds admin creds to a live Lightning node.

**Why it happens:**
Bash makes string interpolation the path of least resistance, and the queue row "feels trusted" because it's operator-approved — but the queue is untrusted transport by design, and approval is human, not a sanitizer.

**How to avoid:**
- Never build a shell string from params. Validate each param against a strict type/range first (base_fee_msat: non-negative integer; fee_rate_ppm: integer within bounds; chan_point: exact `^[0-9a-f]{64}:[0-9]+$` regex), reject anything that doesn't match, then pass as separate `argv` elements (no shell re-parsing). Prefer invoking lncli/lncmd without `sh -c`.
- Whitelist action types (v1: `update_fee` only — locked design). Unknown action_type = hard reject.
- This sits BEHIND HMAC verify and bounds re-enforcement — defense in depth, not a single gate.

**Warning signs:**
- Apply scripts using `eval`, `sh -c "...$param..."`, or unquoted variable interpolation.
- A param value containing any non-numeric/non-hex character reaching the shell.

**Phase to address:**
Phase 7 (apply-script param validation + argv-not-string invocation). Phase 5 (command export) shares this: the exported `lncli` string must escape/validate params so a copy-pasted command can't be a hidden injection.

---

### Pitfall 8: Not re-enforcing fee bounds node-side (trusting dashboard-supplied limits)

**What goes wrong:**
The dashboard computes "raise to 500 ppm" and the node applies it blindly. If a bug, a stale recommendation, or a tampered row sends `fee_rate=5,000,000 ppm` (or base_fee in BTC), the node prices a channel out of all routing — or to near-zero, leaking fees. On a live fleet this is real lost revenue and routing flight.

**Why it happens:**
It feels redundant to re-check bounds the dashboard "already" enforced. But the dashboard is across a trust boundary; the node is the last line of defense and the only place creds live.

**How to avoid:**
- Node re-enforces hard param bounds at apply time (max ppm, max base_fee_msat, min/max sane ranges), mirroring the gateway's `Limits` pattern (`lqwdclawnode/lnd-gateway/internal/handlers` — reference only). Never trust dashboard-supplied bounds alone — this is the locked design.
- Bounds live in the node script (or pulled config), version-pinned, so a dashboard bug can't widen them.
- Out-of-bounds job → reject + report `failed` with reason, never clamp-silently (silent clamp hides the bug).

**Warning signs:**
- An apply succeeded with a ppm/base_fee far outside the healthy bands in `healthy-range-bands.md`.
- Node bounds defined only on the dashboard side.

**Phase to address:**
Phase 7 (node-side bounds re-enforcement). Phase 4 must also clamp recommendation params to healthy bands so the queue rarely carries an out-of-bounds intent in the first place.

---

### Pitfall 9: Approving an action against stale data (decision-time vs apply-time gap)

**What goes wrong:**
The operator reads a scorecard, sees "channel idle, raise fee," and approves — but the underlying warehouse snapshot is minutes/hours old, or the channel state changed since the recommendation card was generated. The approval looks confident but is anchored to a stale world. Pairs with Pitfall 4 but the failure is at the human/UI layer, not the queue.

**Why it happens:**
Dashboards present computed cards as authoritative and timeless. Warehouse ingestion lag and refresh cadence are invisible unless surfaced. The operator can't tell a 30-second-old card from a 3-hour-old one.

**How to avoid:**
- Stamp every recommendation card and scorecard with the source-data timestamp ("as of HH:MM, N min ago") and the warehouse's newest `lnd_node_info` timestamp for that node.
- Warn/block approval when the underlying data is older than a threshold; offer a refresh-then-reconfirm.
- Show the live current fee/policy next to the proposed change at approval time (not just the delta), so the operator sees what they're actually overwriting.

**Warning signs:**
- Cards with no visible data-freshness indicator.
- Warehouse ingestion lag spikes (newest snapshot far behind wall clock).

**Phase to address:**
Phase 2 (freshness stamps on scorecards), Phase 4 (cards carry as-of timestamp + evidence), Phase 6 (approval UI shows current policy + freshness, blocks on stale).

---

### Pitfall 10: The tool's own recommendations triggering Lightning-specific cascades (AP-11 / AP-12 / routing flight / force-close)

**What goes wrong:**
The insight engine recommends actions that, applied at fleet scale, *cause* the very anti-patterns it's meant to detect:
- **AP-11 close-storm:** a "close N dead channels" recommendation applied broadly, or fee changes that prompt peers to close, mimics the ≥50-closes/hour signature and erodes peer trust / capital.
- **AP-12b serialization storm:** every fee update is an `UpdateEdgePolicy` write. Pushing many fee changes to one node at once (or a churny auto-adjust loop) multiplies SERIALIZABLE write conflicts (Japan: 614K `40001` errors over 81 days, driven by 194 channels × graph-write concurrency). The tool meant to optimize fees becomes the contention source.
- **Routing flight:** an aggressive fee jump on a productive channel drives traffic away; the next analytics pass sees "low forwards," recommends another change — an oscillation.
- **Force-close cascade:** anything that destabilizes a node (overload, mass policy writes during local-bitcoind lag) raises HTLC-timeout force-close risk; intra-fleet channels reciprocate (the AP-11 mechanism).

**Why it happens:**
The dashboard optimizes per-channel/per-node locally without modeling the fleet-wide and write-volume side effects of applying many changes. The fleet is heavily intra-connected, so local actions have non-local consequences.

**How to avoid:**
- Rate-limit writes per node: cap fee-update jobs applied per node per interval (the heartbeat applies a bounded batch, not the whole backlog) — directly throttles the `UpdateEdgePolicy` / 40001 pressure. Fee stabilization is the documented AP-12b mitigation; the tool must not be the churn source.
- Hysteresis / floors on fee recommendations (don't re-recommend a change within X of the last applied value; respect a minimum interval between changes to the same channel) to prevent oscillation/flight.
- The engine SHOULD surface AP-11/AP-12 detectors as *guardrails on its own output*: if a node is currently showing AP-12 contention or AP-11 signature, suppress/flag new write recommendations to that node ("node under contention — do not push policy writes now").
- Keep closures/rebalances export-only (locked v1 scope) — the highest-cascade-risk actions stay human-run, never auto-applied.
- Respect AP-11 response playbook: during a detected close-storm, the tool must NOT recommend restarts or more closes; it should alert and freeze write recommendations.

**Warning signs:**
- A node's `40001` rate climbing after the tool starts pushing fee jobs.
- The same channel re-recommended on consecutive refreshes (oscillation).
- A "close dead channels" card targeting many channels on one node at once.
- Recommendations to a node already flagged AP-11/AP-12.

**Phase to address:**
Phase 4 (hysteresis/floors + self-guardrail: suppress writes to contended/storming nodes), Phase 6/7 (per-node write rate-limit / bounded apply batch), Phase 8 (hardening — tune intervals, gate any future closure/rebalance actions behind stricter checks).

---

### Pitfall 11: LLM narrative layer hallucinating numbers

**What goes wrong:**
The optional LLM narrative ("here's what I'd do and why") invents or mis-states figures — a fabricated BTC capacity, a wrong channel count, a ppm that isn't in the evidence — presented in confident prose next to the deterministic cards. The operator trusts the narrative and approves a write against a hallucinated number. This is exactly the AFM-002 class of error, now generated automatically.

**Why it happens:**
LLMs confabulate numbers, especially large sat values and conversions. If the narrative is free-text over a node's data rather than strictly over the structured card fields, it can drift from the evidence.

**How to avoid:**
- LLM narrates ONLY the already-computed, structured card fields — it never computes or restates a number the deterministic engine didn't produce. Feed it the exact `{severity, signal, evidence, params}` and constrain it to phrase, not calculate.
- Off by default (locked design). Deterministic cards stand alone and are the source of truth; the narrative is decoration, clearly labeled as such, never the basis for approval.
- Post-generation guard: assert every numeric token in the narrative appears in the source card payload; flag/strip any that don't.
- Never let the narrative drive a write — approval is always against the structured card + live policy, not the prose.

**Warning signs:**
- A number in the narrative that doesn't appear in the underlying card.
- Narrative and card disagreeing on a figure.

**Phase to address:**
Phase 4 (narrative constrained to structured fields + numeric-token guard; off by default).

---

### Pitfall 12: Accidentally writing to a read-only warehouse / leaking DB creds to the client

**What goes wrong:**
Two Next.js/Drizzle-specific failures: (a) a query function meant for the warehouse issues a write (or a migration tool points at `routing_vm`), mutating a production analytics DB the whole fleet's reporting depends on; (b) a warehouse/queue connection string or the HMAC secret leaks into a Client Component bundle or to the browser because a secret was imported across the server/client boundary, or used in a `"use client"` file / passed as a prop.

**Why it happens:**
Drizzle uses the same client API for read and write — nothing stops a write against a "read-only" connection unless the DB role enforces it. In App Router, the server/client boundary is easy to cross accidentally; importing a module that reads `process.env.DATABASE_URL` into a client component, or returning secrets in a server-component prop, ships them to the browser.

**How to avoid:**
- Enforce read-only at the DATABASE role, not just convention — use the `grafana_demo_ro` (SELECT-only) role for `routing_vm`/`ldk-lspd-main`. A stray write then errors at Postgres, regardless of app-code bugs. Read-write role is scoped to the `nodemon` queue DB only.
- Never run drizzle-kit/migrations against the warehouse connections — only against `nodemon`. Separate config files; the warehouse connection has no migration entry point.
- All DB access and secret use stays in Server Components / route handlers / server-only modules. Mark server-only modules with `import "server-only"` so a client import fails the build. No connection string, macaroon, or HMAC secret is ever read in a `"use client"` file, passed as a prop to a client component, or embedded in a `NEXT_PUBLIC_` var.
- The dashboard holds ZERO node credentials (locked design) — only DB URLs + the per-node HMAC secrets, all server-side.

**Warning signs:**
- Any `INSERT/UPDATE/DELETE` in a warehouse query function.
- A migration config referencing `routing_vm`/`ldk-lspd-main`.
- A secret or connection string appearing in the client bundle (grep the build output / check `NEXT_PUBLIC_`).
- `process.env` DB/secret access inside a `"use client"` module.

**Phase to address:**
Phase 1 (read-only roles enforced at DB level; `import "server-only"` guards; separate migration config). Re-checked in every phase that adds a query. Security-scan gate before deploy.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hand-writing `MAX(timestamp)` queries instead of the `DISTINCT ON` helper | Faster one-off query | Re-introduces AFM-001; wrong counts everywhere | Never |
| Formatting sat/BTC/fee in component code instead of one tested utility | Quick inline display | AFM-002 10×/1000× errors creep back per view | Never |
| Read-only "by convention" (app code) instead of a SELECT-only DB role | Skip role setup | One bug mutates a production warehouse | Never |
| Read-then-write job claim instead of single atomic UPDATE…RETURNING | Simpler script | Double-apply under overlapping cron | Never |
| One fleet-wide HMAC secret instead of per-node | Less key management | Single leak = whole fleet writable | Never |
| Trusting dashboard-supplied bounds (skip node-side re-check) | Less duplicate code | A dashboard bug mis-prices a live node | Never |
| Applying the whole approved backlog per heartbeat (no per-node cap) | Fewer ticks to drain | AP-12b write-conflict storm on busy nodes | Only on a quiesced/test node |
| Closures/rebalances in the queue before stricter gates | More automation sooner | High-cascade actions auto-applied (AP-11 risk) | Never in v1 — export-only until Phase 8 gates |
| LLM narrative on by default | Nicer first impression | Hallucinated numbers drive approvals | Never as approval basis; off by default |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `routing_vm` / `ldk-lspd-main` warehouses | Treating event-driven tables as snapshots; using `fee` not `fee_msat/1000.0` | `DISTINCT ON` for event tables; cross-validate counts vs `lnd_node_info`; all fee math via `fee_msat/1000.0` |
| `lnd_node_info` vs `lnd_node_channel_info` | Assuming both are snapshots | `lnd_node_info` IS a snapshot (ground truth); `lnd_node_channel_info` is event-driven |
| `nodemon` queue DB | Read-then-write claim; unsigned fields; no TTL | Atomic identity-scoped claim; HMAC over canonical all-fields; TTL→`expired` |
| `lncli` (LND apply) | Shell-string interpolation of params | Validate per-type, pass as argv, no `sh -c`; node re-enforces bounds |
| `lncmd` (LDK apply) | Assuming LND param shapes/bounds | LDK-specific param validation + bounds; one abstract action model, two validated backends |
| Node-side cron heartbeat | Overlapping ticks; stale claims never recovered; node clock skew | Single atomic claim; stale-claim timeout→requeue; DB-driven expiry, NTP on nodes |
| LLM provider (AI SDK `getModel()`) | Free-text narrative computing numbers | Narrate structured card fields only; numeric-token guard; off by default |
| Existing fileserver/downloader pattern (Phase 7) | Inventing new distribution infra | Mirror the existing LND-fleet downloader/cron pattern (operator points to it) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Pushing many fee writes to one node fast | `40001` serialization storm climbs (AP-12b) | Per-node write rate-limit / bounded apply batch; fee hysteresis | High-channel nodes (Japan 194 ch) first |
| Recommendation oscillation (re-price → flight → re-price) | Same channel re-recommended each refresh | Hysteresis + min interval between changes per channel | Any productive channel under aggressive fee deltas |
| Full-table scans on event-driven warehouse tables across 26 nodes | Slow fleet overview; warehouse load | `DISTINCT ON` with proper ordering; per-node filters; consider cached/scheduled refresh | As history grows on the warehouse |
| Heartbeat run time approaching cron interval | Overlapping ticks, double-claim attempts | Atomic claim makes overlap safe; also tune interval (Phase 8) | Slow node / slow lncli round-trips |
| Synchronous fleet-wide read on every page load | Dashboard sluggish at 26 nodes | Scheduled recommendation refresh (Phase 8); server-side caching | All 26 nodes + history |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Read-only enforced only in app code | A bug mutates a production warehouse | SELECT-only DB role (`grafana_demo_ro` pattern) at Postgres level |
| Node creds on the dashboard host | 26-node compromise surface | Dashboard holds zero node creds; creds stay on-node; pull-based outbound-only |
| HMAC over a subset of fields | Tampered DB row executes | Sign canonical serialization of ALL security fields incl. `node_pubkey`, `params`, TTL |
| One fleet-wide secret | Single leak = whole fleet writable | Per-node shared secret; minimal blast radius |
| Param injection into lncli/lncmd | Arbitrary code as node-privileged user | Strict per-type validation; argv not shell-string; whitelist action types |
| Trusting dashboard bounds | Mis-priced live channel | Node re-enforces hard bounds (mirror gateway `Limits`) |
| Secret/conn-string crossing to client bundle | Credential leak to browser | `import "server-only"`; no `NEXT_PUBLIC_` secrets; server-only DB access |
| Stale/expired intent applies | Wrong action on changed state | TTL→`expired`; node-side target revalidation before apply |
| Wrong-pubkey job execution | Mis-targeted fleet write | Identity-scoped atomic claim; pubkey in HMAC; runtime pubkey self-check |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Cards look authoritative but carry no data-freshness | Operator approves against stale state | "As of HH:MM (N min ago)" on every card/scorecard; block approval on stale |
| Delta shown without current value | Operator can't see what's being overwritten | Show live current policy next to proposed change at approval |
| No audit trail / opaque state transitions | Can't reconstruct what was applied, by whom, when | Append-only `audit` table mirroring every transition; surface history in UI |
| LLM prose presented as fact | Hallucinated number drives a write | Narrative clearly labeled, constrained to card fields, never the approval basis |
| One-click apply with no confirm on a live node | Accidental fleet write | Explicit operator approval gate (`approved` state) + confirm; live policy shown |
| Firehose of Grafana-style detail | Signal buried; wrong decisions | Curate to action-relevant signals only (locked product framing) |
| Bulk "close all dead channels" affordance | Mimics AP-11 close-storm | Closures export-only, per-channel context + safety notes, human-run |

## "Looks Done But Isn't" Checklist

- [ ] **Channel counts:** Often missing `lnd_node_info` cross-validation — verify counts match the snapshot table for a known node (e.g. Canada ~480).
- [ ] **Fee/BTC figures:** Often missing the `/1000.0` and `/100_000_000` discipline — verify back-conversion within ±1% against source sats.
- [ ] **Atomic claim:** Often a read-then-write pair — verify overlapping ticks can't double-apply (pilot-node test).
- [ ] **HMAC:** Often signs a subset — verify a manually-edited `params` row FAILS verification.
- [ ] **TTL:** Often absent — verify an aged-out approved command auto-`expired` and never applies.
- [ ] **Bounds:** Often only dashboard-side — verify an out-of-bounds job is rejected at the node.
- [ ] **Identity:** Often loose `WHERE` — verify node B never claims node A's job (and pubkey self-check at startup).
- [ ] **Read-only:** Often convention-only — verify an attempted warehouse write errors at the DB role.
- [ ] **Secrets:** Often boundary-crossed — verify no conn-string/secret in the client bundle.
- [ ] **Self-guardrails:** Often missing — verify the engine suppresses write recommendations to a node currently flagged AP-11/AP-12.
- [ ] **Audit:** Often partial — verify every state transition writes an append-only audit row.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| AFM-001 wrong counts shipped | MEDIUM | Re-run with `DISTINCT ON`; cross-check `lnd_node_info`; cascade-correct dependent scorecards/cards |
| AFM-002 wrong units shipped | MEDIUM | Recompute via shared formatter; back-convert ±1%; correct every dependent figure |
| Double-applied fee | MEDIUM | Read true current policy from node; re-apply target once; reconcile audit; fix claim atomicity |
| Stale intent applied to dead/changed channel | MEDIUM | Verify channel state; revert/re-price if recoverable; add/tighten TTL + node revalidation |
| Tool-triggered AP-12b storm | HIGH | Stop pushing writes to the node; apply AP-12b fix (native-SQL + fee stabilization + PG tuning); add per-node write cap |
| Tool-triggered/observed AP-11 close-storm | HIGH | Execute AP-11 playbook (disable restarter, snapshot channel.db, alert peers, no restart); freeze write recommendations fleet-wide |
| Warehouse accidentally written | HIGH | Halt; assess mutation; restore from warehouse backup; switch to SELECT-only role to prevent recurrence |
| Secret/cred leaked to client | HIGH | Rotate affected per-node secret(s); rebuild without the leak; audit access; add `server-only` guard |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| AFM-001 event-driven `MAX(timestamp)` | Phase 1 (read layer) | Counts match `lnd_node_info` for a known node (Phase 2) |
| AFM-002 sat/BTC/msat units | Phase 1 (formatters) | Back-conversion ±1% in read-layer tests |
| Double-apply across cron ticks | Phase 6 + 7 | Pilot-node overlapping-tick test never double-applies |
| Stale/expired intents | Phase 6 (TTL) + 7 (revalidate) | Aged-out command auto-`expired`; node aborts on dead target |
| HMAC/clock-skew | Phase 6 (sign) + 7 (verify) | Tampered `params` row rejected; skew-tolerant expiry |
| Wrong-pubkey execution | Phase 7 (identity claim) + 6 (pubkey in HMAC) | Node B can't claim node A's job; pubkey self-check |
| lncli/lncmd injection | Phase 7 (apply) + 5 (export) | Param with shell metachar rejected; argv invocation |
| Node-side bounds not re-enforced | Phase 7 (bounds) + 4 (clamp) | Out-of-bounds job rejected at node |
| Approving against stale data | Phase 2 + 4 + 6 | Freshness stamp shown; approval blocked on stale |
| Tool-triggered AP-11/AP-12/flight | Phase 4 (guardrails/hysteresis) + 6/7 (rate-limit) + 8 | Writes suppressed to flagged nodes; per-node write cap holds |
| LLM hallucinated numbers | Phase 4 (constrained narrative) | Numeric tokens all trace to card payload; off by default |
| Warehouse write / client cred leak | Phase 1 (RO role + `server-only`) | DB write errors; no secret in client bundle |

## Sources

- `lqwdLogs/_library/analytical-failure-modes.md` — AFM-001 (event-driven `MAX(timestamp)`), AFM-002 (sat→BTC), Canada 2026-05-26 review (HIGH — operator-documented real failures).
- `lqwdLogs/_library/operational-anti-patterns.md` — AP-11 close-storm (France/Sweden/India 2024-09-09 fleet-wide cascade; ≥50 closes/hr signature), AP-12a/b PG-LND contention (SouthAfrica 93K `too many clients`; Japan 614K `40001`) (HIGH — operator-documented).
- `.planning/PROJECT.md` and `~/.claude/plans/vast-popping-starlight.md` — locked architecture: signed pull-queue, atomic claim, HMAC, node-side bounds, read-only roles, export-only high-risk actions (HIGH — approved spec).
- MEMORY `failure_distinct_on_vs_max_timestamp` — original incident record (HIGH).
- [PostgreSQL FOR UPDATE SKIP LOCKED / atomic claim for job queues — Netdata](https://www.netdata.cloud/academy/update-skip-locked/), [DB Pro](https://www.dbpro.app/blog/postgresql-skip-locked), [Solid Queue / BigBinary](https://www.bigbinary.com/blog/solid-queue), [claim/unclaim + stale recovery — DEV](https://dev.to/daniel_romitelli_44e77dc6/the-queue-was-a-table-how-i-built-claimunclaim-workers-with-skip-locked-stale-recovery-and-1ojm) (MEDIUM — confirms atomic-claim idiom + stale-claim recovery).
- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection) (MEDIUM — confirms argv-not-shell-string prevention for lncli/lncmd params).

---
*Pitfalls research for: Lightning fleet operator-control dashboard (warehouse analytics + signed pull-queue writes)*
*Researched: 2026-06-05*
