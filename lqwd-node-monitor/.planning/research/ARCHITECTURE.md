# Architecture Research

**Domain:** Local-first Lightning fleet operator control tool (read-only warehouse analytics + pull-based signed command queue)
**Researched:** 2026-06-05
**Confidence:** HIGH (architecture is pre-decided in the approved spec; this is a pressure-test of correctness + boundaries, verified against Postgres queue, HMAC-replay, and Drizzle multi-connection literature)

## Verdict

The architecture is **sound and well-matched to its constraints**. The pull-based, credential-on-node, queue-as-handoff design is the correct shape for "dashboard must never hold node creds and never touch a node." It mirrors a pattern already in production on the fleet, which de-risks the highest-uncertainty component (Phase 7).

Five corrections / sharpenings are needed before build — none change the shape, all tighten correctness:

1. **Claim query** should be `SELECT … FOR UPDATE SKIP LOCKED` then `UPDATE`, not `UPDATE … WHERE id=? AND status='approved'`. The spec's form is *atomic and safe* but assumes the cron already knows the `id`; a self-scoped poller doesn't. Use the CTE form to claim the node's *next* eligible job.
2. **HMAC payload must bind `node_pubkey + command_id + action_type + canonical(params) + expires_at`** — not just the params blob. Without binding pubkey + id + expiry, a valid signature could be replayed or cross-applied to another node. (Verified against HMAC replay literature.)
3. **Expiry must be enforced node-side against the *signed* `expires_at`, not just a DB column** — clock skew on the node must fail-closed (reject), never fail-open (apply stale).
4. **Read path and write path need physically separate Postgres roles + separate Drizzle clients**, not one client with discipline. The warehouse role is literally incapable of `INSERT`; the queue role has no `SELECT` on warehouses.
5. **The approval gate, not the HMAC, is the primary replay defense.** HMAC proves "the dashboard authored this"; the `status` state machine proves "this runs exactly once." Both are required; don't conflate them.

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  NodeMonitor Dashboard (Next.js App Router, local host)            │
│                                                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Read views │  │  Insight   │  │  Command   │  │  Approval   │  │
│  │ (RSC)      │  │  engine    │  │  export    │  │  UI         │  │
│  │ scorecard  │  │ (rules +   │  │ (Prong 2)  │  │ (Prong 1)   │  │
│  │ channels   │  │  LLM narr.)│  │ copy-paste │  │ sign+enqueue│  │
│  └─────┬──────┘  └─────┬──────┘  └────────────┘  └──────┬──────┘  │
│        │ SELECT        │ (reads cards)         INSERT signed │     │
└────────┼───────────────┼─────────────────────────────────┼───────┘
   read-only role        │                       read-write role
         ▼               ▼                                  ▼
  ┌───────────────────────────────┐            ┌──────────────────────┐
  │ routing_vm  +  ldk-lspd-main  │            │  nodemon queue DB     │
  │ (existing warehouses)         │            │  commands/executions/ │
  │ grafana_demo_ro (SELECT only) │            │  audit                │
  └───────────────────────────────┘            └────────▲────────┬─────┘
                                                outbound │ poll   │ write
                                            own pubkey's │ result │ back
                                            approved rows│        ▼
                                          ┌──────────────┴───────────────┐
                                          │ Per-node heartbeat (crontab)  │
                                          │ bash, no daemon, outbound-only│
                                          │ check-queue:                  │
                                          │   claim (FOR UPDATE SKIP LOCK)│
                                          │   verify HMAC (binds pubkey)  │
                                          │   check expiry (fail-closed)  │
                                          │   bounds-check params         │
                                          │   apply-fee → lncli/lncmd     │
                                          │   write result + audit back   │
                                          └──────────────▲────────────────┘
                       scripts + crontab installed/updated│
                                          ┌───────────────┴────────────────┐
                                          │ Remote fileserver + bash        │
                                          │ downloader (mirrors existing    │
                                          │ LND-fleet pattern)              │
                                          └─────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Boundary (what it must NOT do) | Implementation |
|-----------|----------------|-------------------------------|----------------|
| Read layer | SELECT warehouse data, normalize LND+LDK to one node/channel model | Never INSERT/UPDATE; never touch `nodemon` | Drizzle, `grafana_demo_ro` role, env URLs, RSC server queries |
| Insight engine | Pure functions: warehouse rows → recommendation cards | No DB writes; no side effects; deterministic | TS pure modules sourcing `lqwdLogs/_library` thresholds; optional LLM narrate-only over already-computed cards |
| Command export (Prong 2) | Render fully-parameterized `lncli`/`lncmd` strings | No write path at all — pure client-side string gen | Client component; zero DB; ships standalone |
| Approval UI / signer (Prong 1) | Operator confirms → server computes HMAC → INSERT `approved` row | Never executes; never holds node creds; only writes queue | Server action, queue read-write role, HMAC secret server-side only |
| nodemon queue DB | Durable signed/approved/audited handoff between decide and apply | Single source of shared state; no business logic | Postgres: `commands`, `executions`, `audit` |
| Node heartbeat | Claim own approved jobs, verify, bounds-check, apply with local creds, report | Never listens inbound; never trusts dashboard-supplied bounds; one action type (v1) | bash crontab + `check-queue` + `apply-fee`, shells to `lncli`/`lncmd` |
| Distribution | Push scripts → fileserver → downloader installs scripts + crontab per node | No execution logic; just delivery | bash downloader, mirrors existing fleet pattern |

## Resolving the Five Spec Questions

### 1. Command-queue state machine + atomic claim

**State machine is robust.** `draft → pending_approval → approved → claimed → executing → succeeded|failed|rejected|expired` is a correct DAG with clear terminal states. Two refinements:

- **Add a `stale_recovery` path.** A node that claims a job (`claimed`/`executing`) then dies (reboot, OOM, network drop mid-tick) leaves a "stuck" row that never reaches a terminal state. Without recovery it blocks nothing (it's pubkey-scoped) but it silently never applies. Mitigation: a `claimed_at` timeout — a job in `claimed`/`executing` older than `N × heartbeat_interval` is reaped back to `approved` (bounded retry count) or to `failed` (audit reason: `claim_timeout`). This is standard claim/unclaim-with-stale-recovery practice for Postgres queues.
- **`expired` must be a node-side AND a sweep decision.** Two enforcement points: (a) the node refuses to apply if `now() > signed expires_at` (fail-closed), and (b) a periodic sweep marks past-TTL `approved` rows `expired` so they're not re-claimed. Both needed — the node guards correctness, the sweep keeps the queue clean.

**Atomic claim — the spec's form is safe but incomplete for a self-poller.**

The spec's `UPDATE commands SET status='claimed', claimed_at=now() WHERE id=? AND status='approved' RETURNING *` is genuinely atomic and double-apply-safe *once you know the id*. But a heartbeat polling "give me my next job" doesn't have an id yet — if it `SELECT`s candidates then `UPDATE`s by id in a second statement, two overlapping ticks can both see the same row before either claims it. Use the single-statement CTE claim instead:

```sql
WITH next AS (
  SELECT id FROM commands
  WHERE node_pubkey = $1
    AND status = 'approved'
    AND expires_at > now()
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE commands c
SET status = 'claimed', claimed_at = now(), executor_id = $2
FROM next
WHERE c.id = next.id
RETURNING c.*;
```

`FOR UPDATE SKIP LOCKED` guarantees overlapping ticks (or a slow prior run still holding a row) get disjoint rows — no double-claim, no blocking. This is the canonical Postgres-as-queue pattern (verified across multiple current sources). With ~26 nodes each polling only their own pubkey's rows, contention is effectively zero; SKIP LOCKED is correctness insurance, not a throughput need.

**Idempotency:** Two layers. (a) The `status` transition itself is the idempotency guard — a claimed/succeeded row cannot be re-claimed because the `WHERE status='approved'` predicate no longer matches. (b) Keep the spec's per-command idempotency key so a retried *apply script* (e.g., heartbeat applied the fee but crashed before writing `succeeded`) can detect "I already did this" before re-running `lncli`. For `update_fee` the underlying op is naturally idempotent (setting a policy to X twice = X), which is a good v1 safety margin; don't rely on that for future non-idempotent actions.

**Confidence: HIGH.** This is well-trodden Postgres queue territory.

### 2. Security of the pull model — remaining attack surfaces

The defense-in-depth stack (HMAC + approved-only + node-side bounds + per-pubkey scope) is the right model. Remaining surfaces and mitigations:

| Attack surface | Risk | Mitigation |
|----------------|------|------------|
| **Queue DB compromise** (attacker can INSERT/UPDATE rows directly) | Attacker injects a malicious `update_fee`, or flips a row to `approved` | HMAC is the firewall: the node verifies the signature over `pubkey+id+action+params+expires_at` before applying. An attacker without the per-node HMAC secret cannot forge a row the node will run. The secret lives only on the dashboard host + the node — *never in the queue DB*. This is exactly why HMAC + DB-status are separate layers. |
| **Replay** (re-present a previously valid row) | A captured valid row is re-inserted to apply twice | Two guards: (a) DB status — a `succeeded` row can't return to `approved`; the claim predicate won't match. (b) Signed `expires_at` bounds the window even if status were tampered. Optionally bind the command `id` (unique) into the HMAC so a copied signature can't be attached to a fresh row id. |
| **Cross-node application** (node A applies node B's job) | Wrong fee policy on wrong node | `node_pubkey` is in the HMAC payload AND in the claim `WHERE node_pubkey=$1`. A row signed for B fails HMAC verify on A. Belt-and-suspenders: the apply script re-reads the local node's own pubkey and asserts it equals the row's `node_pubkey` before acting. |
| **Clock skew on expiry** | Node clock wrong → applies stale or rejects valid | Fail-closed: if `now() > expires_at` reject. Generous-but-bounded TTL (e.g. hours, not days). Require NTP on nodes (already fleet-standard). Never widen the window to "fix" a skewed node — fix the clock. |
| **Param-bounds bypass** | Dashboard sends ppm=999999 | Node re-enforces hard `Limits` (max ppm, max base fee) at apply time, mirroring `lnd-gateway`'s `Limits` — never trusts dashboard-supplied bounds. Out-of-bounds → `failed` + audit, not clamped-and-applied. |
| **HMAC secret exfiltration** (dashboard host or one node compromised) | Forge rows for that one node | Per-node distinct secrets → blast radius is one node, not the fleet. Rotatable via the same fileserver/downloader path that ships scripts. Secret never in git, never in the queue DB, never logged. |
| **Whitelist creep** | A future action type with custodial/destructive effect slips into the pull path | v1 hard-codes `update_fee` as the *only* executable action node-side; the script literally has no handler for anything else. Closures/rebalances stay export-only (Prong 2) until Phase 8 stricter gates. Enforce the whitelist on the *node*, not just the UI. |

**One structural addition:** make `audit` append-only at the DB level (revoke UPDATE/DELETE for the queue role on `audit`; INSERT-only). A compromised dashboard role then cannot rewrite history.

**Confidence: HIGH** for the model; **MEDIUM** on operational secret-rotation mechanics (depends on the existing fleet downloader's secret-handling, which the operator points to in Phase 7).

### 3. Read/write separation in one Next.js app

Do **not** rely on coding discipline ("remember not to write to the warehouse"). Enforce at the role and client level:

- **Three Drizzle clients, three roles, three env URLs:**
  - `dbRouting` → `routing_vm` via `grafana_demo_ro` (SELECT-only, physically cannot INSERT)
  - `dbLdk` → `ldk-lspd-main` via the equivalent read-only role
  - `dbQueue` → `nodemon` via a read-write role scoped to `commands/executions/audit` only (no access to warehouse DBs — different server/DB entirely)
- **Module boundary:** `src/lib/db/warehouse/` exports only `dbRouting`/`dbLdk` and read query functions; `src/lib/db/queue/` exports only `dbQueue` and the enqueue/approve/claim functions. No module imports both write+warehouse handles. A lint rule or simple convention (warehouse module exposes no mutation functions) makes accidental writes structurally impossible.
- **`withReplicas()` is the wrong abstraction here** — that's for read-scaling one logical DB. These are three distinct databases with distinct trust levels; keep them as separate explicit clients.
- **Connection pooling caution:** Next.js dev hot-reload can leak pools ("too many connections" is a known Drizzle+serverless footgun). Use a module-level singleton per client (globalThis cache in dev), and small pool sizes — this is local-first, low-concurrency.

**Confidence: HIGH.**

### 4. Build order validation

The 8-phase order is **correct and well-sequenced** — it front-loads standalone value and isolates the highest-risk component last-but-one. Validation + coupling notes:

| Phase | Depends on | Coupling risk | Notes |
|-------|-----------|---------------|-------|
| 1. Foundations | — | none | Config-driven read connections + warehouse reachability. Sets the env-var contract everything else inherits. |
| 2. Fleet overview | 1 | low | Scorecard is read-only compute. Verify against known `lqwdLogs` numbers here (catches DISTINCT-ON / sat→BTC failure modes early). |
| 3. Per-node console | 1, 2 | low | Shares the normalized LND+LDK model from 2; mostly more views. |
| 4. Insight engine | 1–3 | low | Pure functions over the same reads. **Cards produced here are the input to Phases 5 + 6** — this is the real fork point. |
| 5. Command export (Prong 2) | 4 | **none to write path** | Ships standalone, zero DB risk. Correctly placed *before* the queue — delivers value while the risky write path is still unbuilt. |
| 6. Queue + approval UI (Prong 1) | 4, queue DB | medium | Introduces `nodemon` DB, HMAC signing, state machine, approval gate. **Build + test the queue end-to-end with a fake/stub executor here** — don't wait for real nodes. |
| 7. Node scripts + heartbeat | 6 | **highest** | The only phase touching real nodes + creds. Mirrors existing fleet downloader (de-risked). Pilot-node-first is correct. |
| 8. Hardening | all | — | More action types, RBAC, VM flip, scheduled refresh. |

**Two ordering refinements:**

- **Move the queue *schema + state machine + claim logic* validation into Phase 6 with a stub node executor**, before any real node exists. The claim/expiry/idempotency correctness (Question 1) is independent of `lncli` and should be proven against a script that just logs "would apply" — so Phase 7 only adds the credential/`lncli` surface, not also debugging the state machine.
- **Phase 4's card schema is a hard contract** for both 5 and 6 (`{severity, node, target, signal, evidence, suggested_action, params}`). Freeze it at end of Phase 4; Phases 5/6 consume it. If `params` shape churns later, both prongs break — version the card schema.

**Hidden coupling to flag:** the **HMAC secret distribution** is logically part of Phase 6 (the dashboard must sign with a secret the node will later hold) but physically delivered by the Phase 7 downloader. Decide the secret format/location in Phase 6, deliver it in Phase 7, but don't let the gap cause a Phase-7 "the dashboard signed with a key the node doesn't have" surprise.

**Confidence: HIGH.**

### 5. Local-now / VM-ready: what must be config-driven

The local→VM flip is zero-code **iff** every host-specific value is env-injected and nothing assumes `localhost`. The full config surface:

| Config | Why it must be env-driven | Local value | VM value |
|--------|--------------------------|-------------|----------|
| `ROUTING_VM_DATABASE_URL` | warehouse host moves | direct to `192.243.215.101` | same / internal addr |
| `LDK_LSPD_DATABASE_URL` | warehouse host moves | `192.243.215.101` | same |
| `NODEMON_QUEUE_URL` | queue DB may relocate (local Postgres now → shared instance later) | local Postgres | warehouse VM / dedicated |
| `NODEMON_HMAC_SECRET_*` (per node) | secrets never in code/git | env / secret file | secret manager / env |
| `FILESERVER_BASE_URL` | the downloader's source location | operator-provided | operator-provided |
| `LLM_*` (model, key, enabled flag) | optional layer, off by default | unset | optional |
| `HEARTBEAT_INTERVAL` | tunable in Phase 8 | crontab default | tuned |
| Bind host/port for Next.js | no hardcoded `localhost` | `0.0.0.0` or env | env |

**Rules:** no `localhost` literals anywhere; all three DB clients read URLs from env at boot and fail loud if missing (don't default to a dev DB); secrets only from env/secret-file, never committed; the node scripts take fileserver + queue URL + secret as parameters/env, not hardcoded. A boot-time config validator (assert all required env present, all DBs reachable) makes the VM flip a config diff, not a code diff. This is already a Phase 1 requirement — keep it strict.

**Confidence: HIGH.**

## Architectural Patterns

### Pattern 1: Queue-as-handoff (decouple decide from apply)

**What:** The dashboard *decides* and writes a durable signed intent; the node *applies* by polling. The queue table is the only shared state; neither side calls the other directly.
**When:** When the deciding host must not hold the executing host's credentials or reach it on the network — exactly this case.
**Trade-offs:** + No inbound holes, creds stay on-node, durable audit, UI location-independent. − Latency = heartbeat interval (fine for fee changes); requires stale-recovery + expiry handling (solved above).

### Pattern 2: Sign-at-author, verify-at-apply (HMAC envelope)

**What:** The dashboard HMACs `pubkey+id+action+canonical(params)+expires_at` at enqueue; the node verifies before any side effect. DB status handles once-only; HMAC handles authenticity.
**When:** Whenever an untrusted-ish transport (a DB other parties can write) sits between authoring and execution.
**Trade-offs:** + Survives queue-DB compromise; per-node secrets bound blast radius. − Secret distribution + rotation is real operational work (rides the existing downloader).

### Pattern 3: Read-replica-style role isolation across distinct DBs

**What:** Separate Drizzle client + Postgres role per database, with the warehouse role physically SELECT-only. Safety is enforced by the DB grant, not application code.
**When:** Any time one app spans data stores of different trust/mutability levels.
**Trade-offs:** + Accidental warehouse writes are impossible, not just discouraged. − Three connection configs to manage; pool-leak discipline in dev.

### Pattern 4: Deterministic rules with optional narration

**What:** Recommendation cards are pure functions of warehouse rows; the LLM only narrates already-computed cards. Rules stand alone and are reproducible/auditable.
**When:** Financial/operational decisions that must be defensible.
**Trade-offs:** + Auditable, testable against historical events. − LLM can't surface signals the rules miss (acceptable; rules are the contract).

## Anti-Patterns

### Anti-Pattern 1: Two-statement SELECT-then-UPDATE claim
**What people do:** `SELECT next approved row` then `UPDATE … WHERE id=that`.
**Why wrong:** Overlapping ticks read the same row before either claims it → double-apply.
**Instead:** Single-statement CTE with `FOR UPDATE SKIP LOCKED` (Question 1).

### Anti-Pattern 2: HMAC over params only
**What people do:** Sign just the `params` jsonb.
**Why wrong:** A valid signature can be replayed or moved to a different node/command id.
**Instead:** Sign `pubkey+id+action+canonical(params)+expires_at`; canonicalize JSON so re-serialization doesn't break verification.

### Anti-Pattern 3: One DB client, "be careful not to write to warehouses"
**What people do:** Single Drizzle instance, rely on code review.
**Why wrong:** One stray mutation against a production warehouse.
**Instead:** Separate clients + SELECT-only warehouse role (Question 3).

### Anti-Pattern 4: Fail-open on expiry / clock skew
**What people do:** Treat a missing/odd `expires_at` as "no expiry, apply anyway."
**Why wrong:** Applies stale fee intents after the situation changed.
**Instead:** Fail-closed — reject if not provably within the signed window.

### Anti-Pattern 5: UI-only whitelist
**What people do:** Restrict to `update_fee` in the dashboard, leave the node script generic.
**Why wrong:** A compromised/buggy queue row with another action type executes.
**Instead:** The node script has handlers for whitelisted actions only; unknown action → `rejected` + audit.

## Integration Points

### External Services

| Service | Integration | Notes |
|---------|-------------|-------|
| `routing_vm` warehouse | Drizzle, `grafana_demo_ro`, env URL | `fee_msat/1000.0`; latest-per-`chan_id` (never `WHERE timestamp=MAX(...)`); event-driven tables |
| `ldk-lspd-main` warehouse | Drizzle read-only, env URL | LDK equivalents normalized to same node/channel model |
| `nodemon` queue DB | Drizzle read-write, scoped role | Only DB the app writes; `audit` append-only |
| Remote fileserver | bash downloader pull | Operator points to existing fleet implementation in Phase 7 |
| `lncli` / `lncmd` | Node-side shell only | Local creds; never reachable from dashboard |
| LLM (AI SDK `getModel()`) | Optional, off by default | Narrate-only over computed cards; default a Claude model |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Read layer ↔ Insight engine | direct function calls (cards from rows) | Insight is pure; no writes |
| Insight engine ↔ Prong 2 export | reads card `params` | Pure string gen; no DB |
| Approval UI ↔ queue DB | server action INSERT signed row | HMAC computed server-side; secret never client-side |
| Queue DB ↔ Node heartbeat | node polls own pubkey's approved rows, writes results | Only shared state; outbound-only from node |
| Fileserver ↔ Node | downloader installs scripts + crontab | Mirrors existing pattern; no new on-node software |

## Scaling Considerations

This is a ~26-node, single-operator tool — "scale" means fleet growth and poll frequency, not user load.

| Scale | Adjustment |
|-------|-----------|
| 26 nodes (now) | Per-pubkey polling, SKIP LOCKED makes contention irrelevant; single small queue DB fine |
| ~100 nodes | Still trivial for Postgres-as-queue; tune heartbeat interval; index `commands(node_pubkey, status, created_at)` |
| Many action types | Per-action handler modules node-side; stricter per-action gates (Phase 8); consider per-action TTLs |

**First bottleneck:** not throughput — it's **operational secret rotation + stale-job recovery** as node count grows. Solve the reaper + rotation path early (Phase 8) rather than when it bites.

## Sources

- [PostgreSQL FOR UPDATE SKIP LOCKED: The One-Liner Job Queue — DB Pro](https://www.dbpro.app/blog/postgresql-skip-locked)
- [Using FOR UPDATE SKIP LOCKED For Queue Workflows — Netdata](https://www.netdata.cloud/academy/update-skip-locked/)
- [The Queue Was a Table: Claim/Unclaim Workers with SKIP LOCKED, Stale Recovery, Retry Caps — DEV](https://dev.to/daniel_romitelli_44e77dc6/the-queue-was-a-table-how-i-built-claimunclaim-workers-with-skip-locked-stale-recovery-and-1ojm)
- [Potential Consequences of Using Postgres as a Job Queue — richyen.com](https://richyen.com/postgres/2026/05/04/postgres_job_queue.html)
- [Protecting Requests with HMAC, Timestamps, and Nonces — Trones Notes](https://thomasrones.com/technical/system-design/hmac-timestamp-nonce/)
- [Replay Attack: No Expiry on Authentication Headers (HMAC SHA-256) — Medium](https://medium.com/@gowthami09027/api-pentesting-part-2-replay-attack-no-expiry-on-authentication-headers-hmac-sha-256-dd619b52cdc7)
- [Drizzle ORM — Database connection / Read Replicas](https://orm.drizzle.team/docs/connect-overview)
- [Too many connections with Drizzle (pool leak) — drizzle-orm#1988](https://github.com/drizzle-team/drizzle-orm/issues/1988)
- Project spec: `~/.claude/plans/vast-popping-starlight.md`; `.planning/PROJECT.md`; `lqwdLogs/_library` thresholds + `failure_distinct_on_vs_max_timestamp`

---
*Architecture research for: local-first Lightning fleet control tool with pull-based signed command queue*
*Researched: 2026-06-05*
