# Phase 6: Command Queue + Approval UI (Prong 1) - Research

**Researched:** 2026-06-15
**Domain:** Durable signed command queue (Postgres + Drizzle), HMAC TS↔bash interop, state-machine concurrency (`FOR UPDATE SKIP LOCKED`), Next.js App Router server-action write path + approval UI
**Confidence:** HIGH (stack is the in-repo proven set; HMAC byte-equivalence empirically proven this session; SKIP LOCKED confirmed in installed Drizzle types)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Enqueue flow**
- **D-01:** ENQUEUE control mirrors the Phase 5 inline-expand — one component on `update_fee` cards working identically on `/inbox` (`InsightCardRow`) and the console Active Signals panel (`ActiveSignalsPanel`). AP-11/AP-12-suppressed cards arrive with a null `update_fee` action (INSIGHT-06), so the control is simply absent there.
- **D-02:** Preview-then-confirm — expanding shows the exact intent (node, chan_id/channel point, current → proposed ppm, base fee msat, timelock delta, computed `expires_at`) with a deliberate CONFIRM ENQUEUE action. Nothing is written to `nodemon` until confirm.
- **D-03:** Params editable within validated bounds before enqueue — operator may nudge ppm/base/timelock within strict min/max. Audit row MUST record the value as **operator-overridden** when it differs from the engine's deterministic suggestion. The `update_fee` param bounds become a **Phase 6 design artifact** (a zod schema mirroring the gateway `Limits`) — the **same bounds Phase 7 re-enforces node-side**, so they must be frozen here.
- **D-04:** HMAC signed once at enqueue — on CONFIRM, sign over `node_pubkey + command_id + action_type + canonical(params) + expires_at` (SHA-256, lowercase hex, key-sorted canonical JSON). **Store the exact canonical string itself** plus the hex digest on the row. Params + `expires_at` fixed from creation; signature immutable; approval merely flips state.

**Approval & queue UI**
- **D-05:** Dedicated `/queue` page — standalone fleet-wide page listing all `pending_approval` (and in-flight) commands across nodes, approval review inline. Parallels `/inbox` and `/pending`.
- **D-06:** Live re-query diff at the approval moment — each row re-queries the node's current fee policy at render and shows current → proposed diff (ppm, base, timelock) plus a data-freshness stamp. The diff and the stale-gate both run off this fresh read. Do NOT rely on the enqueue-time snapshot for "current".
- **D-07:** Approve and reject both take a confirm; rejection reason optional (short free-text captured into the audit row when provided, not required).
- **D-08:** Append-only audit surfaced as a per-command transition timeline (state, actor, timestamp, reason) inline on `/queue`.

**Stale-data approval gate**
- **D-09:** Reuse existing freshness bands (same data-freshness bands shown across console/inbox/pending) — no new queue-specific threshold.
- **D-10:** Blocked-until-acknowledged, via checkbox — when the node's latest data is past the "stale" band at approval time, APPROVE is **disabled by default**, unlocked only by a required "I acknowledge data is stale" checkbox; the acknowledgement is recorded in the audit row. This is a checkbox-gated override, **NOT an un-overridable lock** — the verifier expects the override.

**Lifetime & secret design (cross-phase freeze)**
- **D-11:** `expires_at` = enqueue + 24h, signed once at enqueue; it is the hard execution deadline. If not claimed+executed by `expires_at`, the row fails closed → `expired`. The 24h default is config-tunable.
- **D-12:** Per-node HMAC secret lives in env, keyed by pubkey (e.g. `NODEMON_HMAC_SECRET_<pubkey-or-alias>`), loaded `server-only`. **Never in the `nodemon` DB and never in any client bundle.** Per-node secret, never a dashboard master. This is the **format/location freeze** Phase 7's downloader depends on.
- **D-13:** Stub executor exercises post-approval states in tests only; UI renders them read-only. The stub drives `claimed→executing→succeeded|failed` in the automated suite (proving atomic claim, overlapping-tick no-double-apply, TTL→`expired`, stale-claim reaper). The `/queue` + audit UI RENDERS those states but there is **no operator "simulate" control**.
- **D-14:** Stale-claim reaper window is a config placeholder (`claimed_timeout = N × assumed_interval`) with a documented provisional default, proven now against a simulated interval; Phase 7 sets the real number once heartbeat cadence is fixed.

### Claude's Discretion
- Exact `/queue` layout, diff rendering, timeline visual grammar, enqueue preview block styling — driven through the binding design skills (sketch-findings-nodemonitor + frontend-design); reuse the Phase 5 expand visual grammar.
- `command_id` / nonce idempotency-key generation and the canonical-JSON serializer implementation — honoring CLAUDE.md §4 (store the canonical string verbatim; constant-time compare on any TS-side verify).
- Drizzle schema specifics for the three `nodemon` tables (commands / executions / audit) and the migration. Researcher confirms the `SELECT … FOR UPDATE SKIP LOCKED` + reaper mechanics.
- Where the live "current policy" read sources from (AFM-001 latest-state helper vs an existing fee reader) — honoring AFM-001/002.
- Provisional values for the 24h TTL and reaper window defaults (within the shapes locked in D-11/D-14).

### Deferred Ideas (OUT OF SCOPE)
- **Rebalance request table** — future extension; NOT this phase. Phase 6 is `update_fee` only.
- **Queue action types beyond `update_fee`** (queued closes/rebalances) — explicit v2/deferred.
- **Operator dev-only "simulate execution" control** — considered (D-13) and rejected as throwaway UI.
- **Scheduled recommendation refresh / background card computation** — v2/deferred; queue stays on-demand.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QUEUE-01 | Operator can enqueue an `update_fee` intent from a recommendation card into `nodemon`; created `pending_approval`, does nothing until approved. | §Architecture Pattern 1 (server-action write path mirroring `narrate.ts`); §Code Examples (enqueue server action); the frozen `update_fee` params (`src/lib/insight/schema.ts`) seed the preview; the `commands` table + `pending_approval` initial state in §Standard Stack schema. |
| QUEUE-02 | Each command HMAC-signed over `node_pubkey + command_id + action_type + canonical(params) + expires_at` (SHA-256, lowercase hex, key-sorted canonical JSON), per-node secret. | §Pattern 2 + §Code Examples — canonical serializer + signer; **byte-identical TS↔openssl proven this session**; per-node secret env design (D-12); store canonical string verbatim. |
| QUEUE-03 | Operator approves/rejects in UI (shows live current policy, proposed change, freshness; blocks approval on stale data); only `approved` execution-eligible; every transition in append-only audit. | §Pattern 3 (approval transition in a transaction writing audit); §Pattern 4 (state machine); AFM-001 `latestChannelsForNode` for live policy (D-06); `isStale` reuse (D-09/D-10); append-only audit table. |
| QUEUE-04 | Full state machine proven against a **stub executor** with atomic `SELECT … FOR UPDATE SKIP LOCKED` claim, fail-closed TTL→`expired` expiry, stale-claim reaper for rows stuck past N×interval. | §Pattern 4 + §Pattern 5; Drizzle `.for("update", { skipLocked: true })` **confirmed in installed types**; §Validation Architecture (overlapping-tick test, TTL expiry test, reaper test) — pure/integration suite, no live node. |
</phase_requirements>

## Summary

Phase 6 builds the project's first **DB-write UI** — a durable, signed, operator-gated `update_fee` queue in the local `nodemon` Postgres DB — and proves its full state machine against a **stub executor** before any node credential exists. The entire stack is already in the repo and battle-tested across Phases 1–5: Next.js 16 App Router server actions (the `narrate.ts` precedent), the `dbNodemon` RW Drizzle client (already wired + health-checked as writable), `drizzle-kit` pointed exclusively at `nodemon` (the only generate/migrate DB), Node's built-in `crypto` for HMAC, and zod for bounds validation. **No new dependencies are required.** The work is schema design, a pure signer/canonicalizer, a state-machine + claim/reaper module, a server-action write path, and the `/queue` approval UI — all reusing established patterns.

The two highest-risk surfaces both resolved cleanly under verification. First, **HMAC TS↔bash byte-equivalence**: this session empirically proved that Node `createHmac("sha256", secret).update(canonicalString,"utf8").digest("hex")` produces a byte-identical digest to `openssl dgst -sha256 -hmac` **when the exact canonical payload string is stored verbatim and hashed directly** (no base64, no `jq` re-serialization) — exactly the CLAUDE.md §4 design. A deliberate base64-round-trip test mismatched, but the cause was a macOS `base64 -d` truncation artifact in the *test harness*, not the design — a pitfall the test suite must avoid, documented below. Second, **atomic claim**: Drizzle's installed `.for("update", { skipLocked: true })` API (confirmed in `select.d.ts` → `LockStrength`/`LockConfig`) maps directly to `SELECT … FOR UPDATE SKIP LOCKED`, giving the no-double-apply guarantee natively. The reaper and TTL-expiry are plain `UPDATE … WHERE` sweeps over timestamp predicates, fully testable against a stub executor with a controllable clock.

The one genuine **design artifact to freeze** is the `update_fee` param-bounds zod schema (D-03): the workspace has **no discoverable gateway `Limits` struct** — the planner must define provisional bounds (LOW confidence; flag for operator confirmation) that Phase 7 re-enforces node-side. The LDK `updatechanpolicy`-equivalent remains **unconfirmed** (STATE blocker) but does not block this phase — Phase 6 enqueues `update_fee` intents for any node; backend-specific applicability is a Phase 7 node-side concern. The stub executor is backend-agnostic.

**Primary recommendation:** Model the three tables (`commands`, `command_executions`, `command_audit`) in `src/lib/db/schema/nodemon.ts` with a `pgEnum` state column; build a **pure** `canonicalize()` + `signCommand()` module (no DB, no env — test-imported anywhere) and store the canonical string verbatim; implement claim/expire/reaper as `dbNodemon.transaction()` calls using `.for("update", { skipLocked: true })`; wire enqueue and approve/reject as `"use server"` actions mirroring `narrate.ts`; render `/queue` as a Server Component computing the live AFM-001 diff with thin `"use client"` confirm/checkbox leaves mirroring `CommandExport.tsx`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Enqueue intent (preview → confirm → write row) | API / Backend (server action) | Browser/Client (preview leaf owns expand/edit state only) | The write + sign must happen server-side; the client only collects the (bounds-validated) intent. Mirrors `narrate.ts` — client never supplies the signed payload. |
| HMAC sign | API / Backend (server-only) | — | Secret is `server-only` env (D-12); signing never reaches a client bundle. The LLM and the client both never produce signed params (CLAUDE.md §5). |
| Param bounds validation | API / Backend (zod, authoritative) | Browser/Client (zod, UX echo) | Same zod schema runs client-side for instant feedback AND server-side as the real gate (defense in depth). Phase 7 re-enforces a **third** time node-side. |
| Approve / reject transition | API / Backend (server action, transactional) | Browser/Client (confirm + stale checkbox leaf) | State flip + audit insert must be atomic and server-authoritative. Client owns only the confirm gesture and the D-10 acknowledgement checkbox. |
| Atomic claim (`FOR UPDATE SKIP LOCKED`) | API / Backend (DB transaction) | Database (row lock) | The no-double-apply guarantee lives in the DB's row-lock semantics, invoked from a Drizzle transaction. In Phase 6 only the **stub executor** (test harness) invokes it. |
| TTL expiry + stale-claim reaper | API / Backend (sweep) | Database | Plain `UPDATE … WHERE` predicate sweeps; fail-closed. Proven against a stub clock in-phase; Phase 7 schedules the real cadence. |
| Live current-policy diff | API / Backend (Server Component read) | Database (warehouse RO, AFM-001) | `/queue` re-reads current policy at render via the sanctioned AFM-001 helper (D-06), never the enqueue snapshot. |
| Audit timeline render | Frontend Server (RSC) | Browser/Client (none — read-only) | Append-only audit rows read back and rendered as a timeline; purely presentational (D-08). |
| Per-node HMAC secret resolution | API / Backend (`server-only` env) | — | Keyed by pubkey, env-only, never DB, never client (D-12). Freeze point for Phase 7. |

## Standard Stack

### Core
| Library | Version (installed) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 | Typed schema for the 3 `nodemon` tables; transactions; `.for("update",{skipLocked:true})` | Workspace standard; the ONLY Drizzle-owned (generate/migrate) DB is `nodemon` (D-08). `dbNodemon` client already wired + health-checked writable. |
| `drizzle-kit` | 0.31.10 | `generate` + `migrate` the `nodemon` schema | `drizzle.nodemon.config.ts` already exists (out: `./drizzle/nodemon`, schema: `./src/lib/db/schema/nodemon.ts`). `npm run db:generate` / `db:migrate` wired. |
| `postgres` (postgres.js) | 3.4.9 | Driver under `dbNodemon`; native transactions | Already paired with Drizzle for `nodemon` (local, RW, `max:5`, no `prepare` override — direct connection). |
| `node:crypto` (built-in) | Node 22.22.2 | HMAC-SHA256 signing + `timingSafeEqual` verify | Zero dependency. `createHmac('sha256',secret).update(canonical,'utf8').digest('hex')` — **proven byte-identical to openssl this session**. |
| `zod` | 3.25.76 | `update_fee` param-bounds schema (D-03), enqueue/approve input validation | Already the validation standard; extends the frozen `update_fee` params shape from `src/lib/insight/schema.ts`. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `server-only` | 0.0.1 | Guard the signer/secret/DB modules out of client bundles | On every module that reads `process.env` HMAC secrets or the `dbNodemon` client (D-12). |
| Next.js server actions (`"use server"`) | next 16.1.6 | Enqueue + approve/reject write path | The `narrate.ts` precedent: no public API route, client never supplies signed payload, server recomputes/validates. |
| `@/lib/read/latest.ts` (`latestChannelsForNode`) | in-repo | Live current-policy read at approval (D-06) | AFM-001 `DISTINCT ON (chan_id)` — the ONLY sanctioned latest-state read. Never re-derive. |
| `@/lib/scorecard/freshness.ts` (`isStale`, `worstCaseAsOf`) | in-repo | Stale-gate at approval (D-09/D-10) | Reuse the existing band; do NOT fork a queue-specific threshold. |
| `@/lib/format/units.ts` | in-repo | Every ppm/sat/msat in the diff + preview (AFM-002) | No ad-hoc conversions — grep guard blocks `/1e8`/`*1000` in src. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:crypto` HMAC | a crypto npm lib (e.g. `jose`, `hash.js`) | Unnecessary — built-in `crypto` is byte-identical to the bash `openssl` verifier and adds zero supply-chain surface. **Do not add a dependency.** |
| Drizzle `.for("update",{skipLocked:true})` | raw `sql\`… FOR UPDATE SKIP LOCKED\`` template | Drizzle's typed builder is cleaner and confirmed in installed types; raw `sql` is the fallback only if a corner case needs it. Both compile to identical SQL. |
| Custom key-sorted canonicalizer | `json-canonicalize` / `canonicalize` npm (RFC 8785 JCS) | The params shape is **flat, all-string/number, no nesting** (frozen `update_fee` schema), so a ~6-line recursive key-sort serializer is sufficient, auditable, and dependency-free. Adding an RFC-8785 lib is over-engineering for this surface AND introduces a slopsquat-risk install. Hand-roll the tiny serializer; store the output verbatim. |
| `gen_random_uuid()` for `command_id` | `crypto.randomUUID()` in app code | Either works. Prefer app-side `crypto.randomUUID()` so the `command_id` is known **before** signing (it is part of the signed payload) without a DB round-trip. Use DB `gen_random_uuid()` only for surrogate PKs that aren't signed. |

**Installation:**
```bash
# NONE. Every dependency is already installed (verified versions above).
# This phase installs ZERO new packages.
```

**Version verification:** All versions confirmed via `node -e "require('<pkg>/package.json').version"` against `node_modules` on 2026-06-15: drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, zod 3.25.76, Node 22.22.2, OpenSSL 3.6.2.

## Package Legitimacy Audit

> **No external packages are installed in this phase.** All required libraries are already present and proven across Phases 1–5. slopcheck not run because there is nothing to install.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No installs — phase uses only in-tree dependencies. |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs).
**Packages flagged as suspicious [SUS]:** none (no installs).

*If the planner later decides to add an RFC-8785 canonicalizer (NOT recommended — see Alternatives), it MUST be gated behind a `checkpoint:human-verify` and slopchecked first. The recommendation is to hand-roll the ~6-line serializer instead.*

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
  RECOMMENDATION CARD    │  update_fee card (InsightCardRow /            │
  (frozen schema)  ─────▶│  ActiveSignalsPanel) — suppressed cards have  │
                         │  null action ⇒ NO enqueue control (D-01)      │
                         └───────────────┬─────────────────────────────┘
                                         │ expand (inert)
                                         ▼
                         ┌─────────────────────────────────────────────┐
   CLIENT LEAF           │  Enqueue preview leaf  ("use client")         │
   (Phase 5 grammar)     │  • current→proposed ppm/base/timelock         │
                         │  • editable within zod bounds (D-03)          │
                         │  • computed expires_at (D-11)                  │
                         │  • CONFIRM ENQUEUE (the deliberate act, D-02)  │
                         └───────────────┬─────────────────────────────┘
                                         │ server action  enqueueCommand(intent)
                                         ▼
   ┌──────────────────────────── SERVER (server-only) ───────────────────────────┐
   │  1. zod re-validate bounds (authoritative)                                   │
   │  2. command_id = randomUUID(); expires_at = now()+24h                        │
   │  3. canonical = canonicalize(params)   ← pure, key-sorted, no whitespace     │
   │  4. payload = node_pubkey \n command_id \n action_type \n canonical \n exp   │
   │  5. secret  = env NODEMON_HMAC_SECRET_<pubkey>   (D-12, never DB/client)     │
   │  6. sig     = HMAC-SHA256(secret, payload).hex()                             │
   │  7. INSERT commands{ state:'pending_approval', canonical_payload, sig, ...}  │
   │  8. INSERT command_audit{ from:null, to:'pending_approval', actor, ts }      │
   │     (steps 7–8 in ONE dbNodemon.transaction)                                 │
   └─────────────────────────────────┬───────────────────────────────────────────┘
                                      │
                                      ▼
   ┌─────────────────────────── /queue PAGE (RSC, D-05) ──────────────────────────┐
   │  for each pending/in-flight command:                                         │
   │    • AFM-001 latestChannelsForNode(pubkey) ⇒ LIVE current policy (D-06)       │
   │    • diff current → proposed  +  isStale() freshness stamp (D-09)             │
   │    • audit timeline (append-only read-back, D-08)                             │
   │    APPROVE leaf ("use client"): confirm + (if stale) ack checkbox (D-10)      │
   └───────┬──────────────────────────────────────────────┬───────────────────────┘
           │ approveCommand(id, ack?)                       │ rejectCommand(id, reason?)
           ▼                                                ▼
   ┌─────────────────────────── SERVER (transactional) ──────────────────────────┐
   │  UPDATE commands SET state='approved' WHERE id=? AND state='pending_approval'│
   │  + INSERT command_audit{ from:'pending_approval', to:'approved'|'rejected' } │
   └─────────────────────────────────┬───────────────────────────────────────────┘
                                      │ (Phase 7 node reads here; Phase 6 = STUB)
                                      ▼
   ┌────────────────── STUB EXECUTOR (TEST SUITE ONLY, D-13) ─────────────────────┐
   │  claim:  BEGIN; SELECT … WHERE state='approved' AND expires_at>now()         │
   │            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;                │
   │          UPDATE …'claimed'; COMMIT      ← no-double-apply (overlapping ticks) │
   │  execute: 'claimed'→'executing'→'succeeded'|'failed' (+ command_executions)   │
   │  expire:  UPDATE …'expired' WHERE expires_at<now() AND state IN(...)  (D-11)  │
   │  reaper:  UPDATE …'failed'/'approved' WHERE state='claimed'                   │
   │            AND claimed_at < now()-claimed_timeout   (D-14)                    │
   └──────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/lib/db/schema/nodemon.ts     # 3 tables + state pgEnum (the ONLY migrated schema)
src/lib/queue/
├── canonical.ts                 # PURE key-sorted serializer (no DB, no env) + tests
├── sign.ts                      # server-only: secret resolution + HMAC + timingSafeEqual
├── state.ts                     # PURE state-machine transition table + guards + tests
├── bounds.ts                    # PURE zod update_fee bounds (D-03 design artifact) + tests
├── enqueue.ts                   # server-only: build canonical payload + INSERT (txn)
├── claim.ts                     # server-only: FOR UPDATE SKIP LOCKED claim + expire + reaper
└── stub-executor.ts             # TEST-ONLY driver of post-approval states (D-13)
src/app/actions/queue.ts         # "use server": enqueue / approve / reject (narrate.ts shape)
src/app/(overview)/queue/page.tsx# RSC: live AFM-001 diff + freshness + audit timeline
src/components/queue/            # "use client" leaves: EnqueuePreview, ApprovePanel, Timeline
drizzle/nodemon/                 # generated migration (committed)
```

### Pattern 1: Server-action write path (mirror `narrate.ts`)
**What:** Enqueue/approve/reject are `"use server"` actions, NOT public API routes. The client leaf calls the action; the server re-validates bounds, recomputes `command_id`/`expires_at`/canonical/signature, and writes. The client **never** supplies the signed payload or the signature.
**When to use:** Every queue write.
**Example:**
```typescript
// Source: in-repo precedent src/app/actions/narrate.ts (Phase 4 D-17)
"use server";
import { z } from "zod";
import { updateFeeBoundsSchema } from "@/lib/queue/bounds";

const EnqueueInput = z.object({
  pubkey: z.string().regex(/^[0-9a-f]{66}$/),
  params: updateFeeBoundsSchema, // authoritative bounds re-check, server-side
});

export async function enqueueCommand(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = EnqueueInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid intent" };
  const { enqueue } = await import("@/lib/queue/enqueue"); // lazy import keeps server-only DB out of any caller's graph
  try {
    const id = await enqueue(parsed.data.pubkey, parsed.data.params);
    return { ok: true, id };
  } catch (e) {
    console.error("enqueueCommand failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

### Pattern 2: Pure canonicalizer + verbatim storage (the cross-phase freeze)
**What:** A dependency-free, recursively key-sorted, whitespace-free JSON serializer over the flat `update_fee` params. The **output string is stored verbatim** on the row (`canonical_payload` column) so the Phase 7 bash verifier hashes it directly — never re-serializes with `jq`.
**When to use:** Once at enqueue (D-04). The signature is immutable thereafter.
**Example:**
```typescript
// Source: empirically proven byte-identical to openssl this session (see Pitfall 1)
// PURE module — no DB, no env, no server-only — test-importable anywhere.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort(); // deterministic key order
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

// signed payload = newline-joined fields; the canonical(params) substring is what bash re-hashes
export function buildSignedPayload(p: {
  nodePubkey: string; commandId: string; actionType: string;
  canonicalParams: string; expiresAt: string;
}): string {
  return [p.nodePubkey, p.commandId, p.actionType, p.canonicalParams, p.expiresAt].join("\n");
}
```

### Pattern 3: server-only signer with constant-time verify
**What:** Resolve the per-node secret from env (D-12), HMAC the payload, return lowercase hex. Any TS-side verification uses `timingSafeEqual` (CLAUDE.md §4).
**Example:**
```typescript
// Source: node:crypto docs (createHmac/timingSafeEqual) + CLAUDE.md §4
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** D-12: env keyed by pubkey, server-only, never DB/client. Frozen format Phase 7 mirrors. */
function secretFor(pubkey: string): string {
  const key = `NODEMON_HMAC_SECRET_${pubkey}`;
  const v = process.env[key];
  if (!v) throw new Error(`Missing per-node HMAC secret env: ${key}`);
  return v;
}

export function signPayload(pubkey: string, payload: string): string {
  return createHmac("sha256", secretFor(pubkey)).update(payload, "utf8").digest("hex");
}

export function verifyPayload(pubkey: string, payload: string, expectedHex: string): boolean {
  const actual = Buffer.from(signPayload(pubkey, payload), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

### Pattern 4: State machine as a pure transition table + transactional flip
**What:** A pure module enumerates legal transitions; every flip is a transactional `UPDATE … WHERE id=? AND state=<expected>` **plus** an audit insert, in one `dbNodemon.transaction()`. The `WHERE state=<expected>` guard makes the flip idempotent and prevents lost-update races.
**State machine:** `draft → pending_approval → approved → claimed → executing → succeeded | failed`, plus terminal `rejected` (from `pending_approval`) and `expired` (TTL fail-closed from any non-terminal pre-execution state). Model the state column as a `pgEnum`.
**Example:**
```typescript
// Source: in-repo dbNodemon.transaction (drizzle postgres-js, confirmed) + CONTEXT D-03/D-08
const LEGAL: Record<string, readonly string[]> = {
  draft: ["pending_approval", "expired"],
  pending_approval: ["approved", "rejected", "expired"],
  approved: ["claimed", "expired"],
  claimed: ["executing", "approved" /*reaper release*/, "failed" /*reaper fail*/, "expired"],
  executing: ["succeeded", "failed"],
  succeeded: [], failed: [], rejected: [], expired: [],
};
export function canTransition(from: string, to: string): boolean {
  return LEGAL[from]?.includes(to) ?? false;
}
```

### Pattern 5: Atomic claim, TTL expiry, stale-claim reaper
**What:** Three server-only sweeps over the `commands` table, each fail-closed.
- **Claim:** select ONE `approved` row not past `expires_at`, lock it, flip to `claimed`. `FOR UPDATE SKIP LOCKED` guarantees two overlapping ticks never claim the same row (no double-apply, QUEUE-04).
- **Expire:** `UPDATE … 'expired' WHERE expires_at < now() AND state IN ('pending_approval','approved','claimed')` — fail-closed TTL (D-11).
- **Reaper:** `UPDATE … WHERE state='claimed' AND claimed_at < now() - claimed_timeout` — rescues rows whose executor died mid-flight (D-14).
**Example:**
```typescript
// Source: Drizzle .for("update",{skipLocked:true}) CONFIRMED in installed select.d.ts (LockStrength/LockConfig)
import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { dbNodemon } from "@/lib/db/nodemon";
import { commands, commandAudit } from "@/lib/db/schema/nodemon";

/** Atomic single-row claim — the no-double-apply guarantee (QUEUE-04). */
export async function claimNext(): Promise<{ id: string } | null> {
  return dbNodemon.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: commands.id })
      .from(commands)
      .where(and(eq(commands.state, "approved"), gt(commands.expiresAt, sql`now()`)))
      .orderBy(commands.createdAt)
      .limit(1)
      .for("update", { skipLocked: true }); // ← SELECT … FOR UPDATE SKIP LOCKED
    if (!row) return null;
    await tx.update(commands).set({ state: "claimed", claimedAt: sql`now()` }).where(eq(commands.id, row.id));
    await tx.insert(commandAudit).values({ commandId: row.id, fromState: "approved", toState: "claimed", actor: "executor" });
    return { id: row.id };
  });
}
```

### Anti-Patterns to Avoid
- **`WHERE timestamp = MAX(timestamp)` for current policy** — the documented AFM-001 "480-channels-read-as-1" failure. Use `latestChannelsForNode` (D-06).
- **Re-serializing params in bash with `jq`** — key-order/whitespace drift breaks the signature. Store + hash the canonical string verbatim (CLAUDE.md §4).
- **base64 across the bash boundary** — macOS/GNU `base64` wrapping & truncation differ (proven below). Hash the raw canonical string directly.
- **Putting the secret in the `nodemon` DB** — hands the signing key to the exact tampered-row threat HMAC defends against (D-12).
- **A throwaway "simulate execution" UI button** — explicitly rejected (D-13). Post-approval states are driven only by the test stub and (Phase 7) the real node.
- **Letting the client send the signature or signed payload** — the server recomputes everything; client supplies only the bounds-validated intent (narrate.ts precedent, CLAUDE.md §5).
- **A second freshness threshold** — reuse `isStale` / `STALENESS` band (D-09).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Latest channel/current fee policy | A `MAX(timestamp)` query or new reader | `latestChannelsForNode` (AFM-001) | Event-driven warehouse; the documented N-read-as-1 failure mode. |
| sat/msat/ppm conversion in the diff | inline `/1e8` or `*1000` | `@/lib/format/units.ts` (AFM-002) | grep guard blocks ad-hoc conversions; single tested source. |
| Stale detection | new threshold | `isStale` + `worstCaseAsOf` + `STALENESS` band | D-09 reuse; no forked taxonomy. |
| Atomic single-row claim | app-level "select then update" without a lock | Drizzle `.for("update",{skipLocked:true})` | DB row-lock is the only correct no-double-apply primitive under concurrency. |
| HMAC / constant-time compare | a crypto npm lib or `===` on hex | `node:crypto` `createHmac` + `timingSafeEqual` | Built-in, byte-identical to openssl, timing-safe. |
| Card → intent params | re-deriving fee fields | the frozen `update_fee` params from `src/lib/insight/schema.ts` | Frozen contract; mutating it breaks Phase 5 too. |
| UUID for `command_id` | custom id scheme | `crypto.randomUUID()` (app-side, pre-sign) | Standard, collision-safe, known before signing. |

**Key insight:** Almost every "hard" sub-problem here already has a sanctioned in-repo solution (AFM-001, AFM-002, freshness, narrate.ts server-action shape, CommandExport client-leaf grammar). The genuinely *new* code is small and pure: the canonicalizer, the signer, the state table, the bounds schema, and the claim/reaper sweeps. Keep each pure and DB-free where possible so the stub-executor proof is a fast unit/integration suite, not a UI-driven one.

## Runtime State Inventory

> Phase 6 is **greenfield write** (new tables in an empty schema), not a rename/refactor. This inventory confirms no hidden runtime state must migrate.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `src/lib/db/schema/nodemon.ts` is `export {}` (table-less by design). No existing rows to migrate. | Create 3 new tables via `drizzle-kit generate`+`migrate`. |
| Live service config | None — no external service consumes the queue in Phase 6 (Phase 7's node-side reader is out of scope). | None. |
| OS-registered state | None — no cron/task registration in this phase (the heartbeat is Phase 7, EXEC-01). | None. |
| Secrets/env vars | NEW: `NODEMON_HMAC_SECRET_<pubkey>` (D-12), `NODEMON_QUEUE_URL` (already wired). The HMAC secret **format/location is frozen here** for Phase 7's downloader; no existing secret renamed. Optional new config: TTL hours (D-11), `claimed_timeout` (D-14). | Document the env var naming contract; add to `.env.example`. |
| Build artifacts | None stale — `drizzle/nodemon/` migration dir is currently empty; this phase creates the first migration. | Commit the generated migration. |

**Nothing found in categories that block:** verified — the only NEW runtime surface is the per-node HMAC secret env contract (a deliberate freeze, not a migration) and the new migration file.

## Common Pitfalls

### Pitfall 1: base64 round-trip breaks the bash HMAC verify (test-harness trap)
**What goes wrong:** A test (or a node script) that base64-encodes the canonical payload, ships it, then `base64 -d | openssl dgst` produces a **different digest** than Node.
**Why it happens:** macOS `base64 -d` silently truncated a 167-byte payload to 165 bytes in this session's test (`00.000Z` → `00.00`), and GNU vs BSD base64 differ on line-wrapping/padding. The signature then never matches.
**How to avoid:** **Store the canonical payload string verbatim** in the `commands.canonical_payload` column and hash it **directly** (`openssl dgst -sha256 -hmac "$SECRET" < payload`). No base64, no `jq`. This session **proved byte-identical** Node↔openssl digests with direct string hashing (`3994bd2c…` on both sides).
**Warning signs:** Any HMAC test that calls `base64`/`btoa`/`Buffer.toString('base64')` in the round-trip; differing byte counts between Node `Buffer.byteLength` and `wc -c`.

### Pitfall 2: signing before `command_id`/`expires_at` are fixed
**What goes wrong:** Signature computed over a payload whose `command_id` or `expires_at` later changes (e.g. DB-generated id, recomputed TTL) → permanent verify failure.
**Why it happens:** `command_id` is *part of the signed payload* (D-04) but is easy to let the DB assign post-insert.
**How to avoid:** Generate `command_id = crypto.randomUUID()` and `expires_at = now()+TTL` **in app code before signing**; INSERT them as-is. Params + `expires_at` are immutable from creation (D-04).
**Warning signs:** `DEFAULT gen_random_uuid()` on the signed `command_id` column; recomputing `expires_at` at approval.

### Pitfall 3: claim without a lock (double-apply)
**What goes wrong:** Two overlapping executor ticks both read the same `approved` row and both flip it → double fee application.
**Why it happens:** A naive "SELECT … WHERE state='approved'" then "UPDATE" without row locking.
**How to avoid:** `.for("update",{skipLocked:true})` inside a transaction (Pattern 5). The overlapping-tick test (two concurrent `claimNext()` against one approved row) must assert exactly one claim succeeds.
**Warning signs:** No `transaction()` wrapper; no `FOR UPDATE`; a test that passes serially but is never run concurrently.

### Pitfall 4: TTL/reaper not fail-closed
**What goes wrong:** An expired or orphaned-claimed row stays executable, or a dead executor leaves a row `claimed` forever.
**Why it happens:** Expiry checked only at claim time; no reaper sweep.
**How to avoid:** Independent `expire` sweep (`expires_at < now()` → `expired`) AND reaper sweep (`claimed_at < now()-claimed_timeout`). Both run on the same cadence as claim. Default to the *safe* terminal/retry state on ambiguity.
**Warning signs:** No `claimed_at` column; expiry logic only inside `claimNext`.

### Pitfall 5: stale-data gate built as a hard lock
**What goes wrong:** Approval is permanently blocked on stale data, contradicting D-10.
**Why it happens:** Misreading ROADMAP criterion 3 as an immovable block.
**How to avoid:** D-10 is **blocked-by-default + audited checkbox override**. APPROVE disabled until the "I acknowledge data is stale" checkbox is checked; the acknowledgement lands in the audit row. The verifier expects the override path.
**Warning signs:** No acknowledgement checkbox; no audit field for the ack.

### Pitfall 6: postgres.js `prepare` / pooling assumptions
**What goes wrong:** Adding `prepare:false` or PgBouncer-style tuning to the `nodemon` client.
**Why it happens:** Cargo-culting the warehouse pooler caveat.
**How to avoid:** `nodemon` is a **direct local connection** (`dbNodemon` already set with `max:5`, no `prepare` override). Leave it. The `WAREHOUSE_PG_TXN_POOLER` flag applies only to the RO warehouses (`env.ts`).
**Warning signs:** Editing `src/lib/db/nodemon.ts` to add `prepare:false`.

### Pitfall 7: importing the server-only DB/signer into a pure test or client
**What goes wrong:** A no-DB unit test (canonicalizer/state-machine) spins up a `postgres()` pool or trips `server-only`.
**Why it happens:** Direct top-level import of `dbNodemon`/signer from a pure module.
**How to avoid:** Keep `canonical.ts`/`state.ts`/`bounds.ts` pure (no DB/env imports); lazy-import `dbNodemon` inside functions (the `narrate.ts`/`fee-history.ts` precedent). Vitest carries the `@/` alias (no Next plugin).
**Warning signs:** `import { dbNodemon }` at module top of a pure module; a unit test that needs `NODEMON_QUEUE_URL`.

## Code Examples

### update_fee bounds schema (D-03 design artifact — provisional, FLAG FOR OPERATOR)
```typescript
// Source: extends the FROZEN update_fee params (src/lib/insight/schema.ts).
// Bounds are PROVISIONAL — no gateway `Limits` struct was discoverable in the
// workspace (lqwd-node schema confirms fields are integers: feeRatePpm,
// baseFeeMilliSat, timeLockDelta). [ASSUMED] — operator must confirm before Phase 7.
import { z } from "zod";
export const updateFeeBoundsSchema = z.object({
  chanId: z.string().min(1),
  channelPoint: z.string().min(1),
  currentPpm: z.number().int().nonnegative(),
  suggestedPpm: z.number().int().min(0).max(5000),      // [ASSUMED] provisional ppm ceiling
  baseFeeMsat: z.number().int().min(0).max(100_000),    // [ASSUMED] provisional base ceiling
  timeLockDelta: z.number().int().min(18).max(2016),    // [ASSUMED] CLTV delta sane band
}).strict();
```

### Enqueue (build canonical payload + transactional insert)
```typescript
// Source: composes Patterns 2+3+4; in-repo dbNodemon.transaction.
import "server-only";
import { randomUUID } from "node:crypto";
import { dbNodemon } from "@/lib/db/nodemon";
import { commands, commandAudit } from "@/lib/db/schema/nodemon";
import { canonicalize, buildSignedPayload } from "@/lib/queue/canonical";
import { signPayload } from "@/lib/queue/sign";

const TTL_HOURS = Number(process.env.NODEMON_TTL_HOURS ?? 24); // D-11 config-tunable

export async function enqueue(pubkey: string, params: UpdateFeeParams): Promise<string> {
  const commandId = randomUUID();
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600_000).toISOString();
  const canonicalParams = canonicalize(params);
  const payload = buildSignedPayload({
    nodePubkey: pubkey, commandId, actionType: "update_fee", canonicalParams, expiresAt,
  });
  const signature = signPayload(pubkey, payload);
  return dbNodemon.transaction(async (tx) => {
    await tx.insert(commands).values({
      id: commandId, nodePubkey: pubkey, actionType: "update_fee",
      params, canonicalPayload: payload, signatureHex: signature,
      state: "pending_approval", expiresAt,
    });
    await tx.insert(commandAudit).values({
      commandId, fromState: null, toState: "pending_approval", actor: "operator",
    });
    return commandId;
  });
}
```

### Approval transition with stale-ack audit (D-07/D-10)
```typescript
// Source: Pattern 4 transactional flip + isStale gate (D-09/D-10).
export async function approve(id: string, staleAck: boolean): Promise<void> {
  await dbNodemon.transaction(async (tx) => {
    const updated = await tx.update(commands)
      .set({ state: "approved" })
      .where(and(eq(commands.id, id), eq(commands.state, "pending_approval")))
      .returning({ id: commands.id });
    if (updated.length === 0) throw new Error("command not in pending_approval");
    await tx.insert(commandAudit).values({
      commandId: id, fromState: "pending_approval", toState: "approved",
      actor: "operator", staleAcknowledged: staleAck, // recorded per D-10
    });
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| App-level queue locking / advisory locks | `SELECT … FOR UPDATE SKIP LOCKED` (Postgres 9.5+) | long-standard | The canonical, race-free single-consumer claim; Drizzle exposes it natively via `.for()`. |
| `react-is` override for charts (N/A here) | — | — | Not relevant — no charts in Phase 6. |
| Hand-rolled UUID | `crypto.randomUUID()` (Node 16+) | stable | Standard, app-side, available before signing. |

**Deprecated/outdated:**
- RFC-8785 canonicalizer libs for this surface: **unnecessary** — the params are flat strings/ints; a 6-line key-sort serializer is sufficient and avoids a dependency/slopsquat install.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `update_fee` bounds (ppm ≤5000, baseMsat ≤100k, timeLockDelta 18–2016) are provisional — no gateway `Limits` struct found in the workspace. | §Code Examples bounds schema | Phase 7 re-enforces the SAME bounds node-side; wrong bounds either reject valid intents or admit unsafe ones. **Operator must confirm before freeze.** |
| A2 | The LDK `updatechanpolicy` equivalent is unconfirmed (STATE blocker), but does NOT block Phase 6 — the queue enqueues `update_fee` for any node and the stub executor is backend-agnostic. **RESOLVED:** enqueue control scoped to `backendFor(pubkey)==='lnd'`; LDK renders an honest unsupported state (plan 06-05 Task 3). | §Summary, §Open Questions (RESOLVED) | Resolved fail-safe — no enqueue offered for a backend that cannot execute it; the queue substrate is unaffected. |
| A3 | Per-node secret env name `NODEMON_HMAC_SECRET_<pubkey>` — exact key form (full 66-hex pubkey vs operator alias) is Claude's discretion within D-12; must be byte-stable for Phase 7. | §Pattern 3, D-12 | Phase 7's downloader places the secret under the identical key; a mismatch yields "signed with a key the node doesn't have". Freeze the exact form. |
| A4 | Provisional TTL = 24h (D-11) and `claimed_timeout = N × assumed_interval` (D-14) defaults — shapes are locked, numbers are placeholders. | §Code Examples enqueue, §Pattern 5 | Numbers are config-tunable and re-set by Phase 7; low risk. |
| A5 | `command_audit` is append-only by convention (no UPDATE/DELETE in app code); not enforced by a DB trigger in this phase. | §Architecture, D-08 | If strict append-only is a verifier requirement, add an INSERT-only grant or a trigger; otherwise convention + code review suffices for a single-operator local tool. |

## Open Questions (RESOLVED)

1. **Exact `update_fee` bounds (A1). — RESOLVED.**
   - What we know: fields are integers (lqwd-node schema); the spec calls them "the gateway `Limits`."
   - What's unclear: no `Limits` struct is in the workspace; concrete min/max unknown.
   - **Disposition (RESOLVED):** Provisional bounds (`suggestedPpm ≤ 5000`, `baseFeeMsat ≤ 100000`, `timeLockDelta 18–2016`) are carried in plan **06-02 `src/lib/queue/bounds.ts`**, flagged `[ASSUMED]` for operator confirmation before the Phase 7 freeze. No gateway `Limits` struct exists in the workspace; Phase 7 re-enforces the SAME bounds node-side. Operator must confirm the exact numbers before the freeze.

2. **LDK fee-policy applicability (A2 / STATE blocker). — RESOLVED.**
   - What we know: LDK rows flow through the same warehouse tables; `lncmd updatechanpolicy` equivalent is unverified.
   - What's unclear: whether LDK nodes can accept a queued `update_fee` at all.
   - **Disposition (RESOLVED):** Fail-safe — never enqueue an action no node can execute (project core value). Plan **06-05 Task 3** gates the enqueue control on `backendFor(pubkey) === "lnd"` (the Phase 2 backend resolver, `src/lib/config/backends.ts`, returns `"lnd" | "ldk"`, `server-only`), and renders an honest unsupported/disabled state for LDK-backed nodes (Phase 2 D-01 grammar) instead of offering the enqueue action. The queue substrate stays backend-agnostic; the real LDK fee command is deferred to Phase 7.

3. **Append-only enforcement strength (A5). — RESOLVED.**
   - What we know: D-08 says append-only; app code will only INSERT audit rows.
   - What's unclear: whether the verifier wants DB-level enforcement (trigger / INSERT-only grant).
   - **Disposition (RESOLVED):** Append-only **by convention** this phase — no UPDATE/DELETE paths are authored against `command_audit`, and the audit access module is insert-only (recorded in plan **06-01**, table def ~line 88 and threat T-06-03). DB-level hardening (trigger / INSERT-only grant) is **deferred to a later phase**; convention plus the single RW role and code review suffices for a single-operator local tool.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Local Postgres (`nodemon`) | All queue writes/migrations | ✓ | `postgres://nodemon_rw@127.0.0.1:5433/nodemon` wired; health check proves writable | — |
| `drizzle-kit` | generate/migrate the schema | ✓ | 0.31.10; `drizzle.nodemon.config.ts` present; `npm run db:generate`/`db:migrate` | — |
| Node `crypto` | HMAC sign/verify | ✓ | Node 22.22.2 (built-in) | — |
| `openssl` | bash-verify equivalence proof (test parity) | ✓ | OpenSSL 3.6.2 | — |
| `psql` CLI | optional manual DB inspection | ✗ | — | `drizzle-kit studio` / app health probe; not required for the phase |
| Per-node HMAC secret env | signing (D-12) | ✗ (not yet set) | — | Provide a test secret in test env; document the env contract; real secret is Phase 7's delivery |

**Missing dependencies with no fallback:** none — every blocking dependency is present.
**Missing dependencies with fallback:** `psql` (use `drizzle-kit studio`); the per-node secret env (set a test value now; real value frozen-by-contract for Phase 7).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4 (`npm test` → `vitest run`) |
| Config file | `vitest.config.*` (carries `@/` alias; plain node/ESM, no Next plugin — STATE Phase-1 decision) |
| Quick run command | `npx vitest run src/lib/queue` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-02 | Canonicalizer is key-sorted, whitespace-free, stable | unit (pure) | `npx vitest run src/lib/queue/canonical.test.ts` | ❌ Wave 0 |
| QUEUE-02 | HMAC hex digest matches openssl over the verbatim canonical string | integration | `npx vitest run src/lib/queue/sign.test.ts` (asserts known-vector + optional openssl cross-check) | ❌ Wave 0 |
| QUEUE-02 | `timingSafeEqual` verify accepts good sig, rejects tampered | unit | `npx vitest run src/lib/queue/sign.test.ts` | ❌ Wave 0 |
| QUEUE-01/03 | State transition table rejects illegal flips | unit (pure) | `npx vitest run src/lib/queue/state.test.ts` | ❌ Wave 0 |
| QUEUE-03 | `update_fee` bounds zod rejects out-of-range; flags operator-override | unit (pure) | `npx vitest run src/lib/queue/bounds.test.ts` | ❌ Wave 0 |
| QUEUE-01 | Enqueue writes `pending_approval` + audit row in one txn | integration (live nodemon) | `npx vitest run src/lib/queue/enqueue.test.ts` | ❌ Wave 0 |
| QUEUE-03 | Approve flips only from `pending_approval`; records stale-ack | integration | `npx vitest run src/lib/queue/approve.test.ts` | ❌ Wave 0 |
| QUEUE-04 | **Overlapping-tick no-double-apply**: 2 concurrent `claimNext()` on 1 approved row → exactly 1 claim | integration (live nodemon) | `npx vitest run src/lib/queue/claim.test.ts` | ❌ Wave 0 |
| QUEUE-04 | Fail-closed TTL: row past `expires_at` → `expired`, not claimable | integration | `npx vitest run src/lib/queue/claim.test.ts` | ❌ Wave 0 |
| QUEUE-04 | Stale-claim reaper: `claimed` past `claimed_timeout` → released/failed | integration | `npx vitest run src/lib/queue/claim.test.ts` | ❌ Wave 0 |
| QUEUE-04 | Stub executor drives `claimed→executing→succeeded\|failed` + execution row | integration | `npx vitest run src/lib/queue/stub-executor.test.ts` | ❌ Wave 0 |

### Observability / Sampling Points (state machine)
- **Per state transition:** an append-only `command_audit` row (`from`, `to`, `actor`, `ts`, optional `reason`/`staleAck`) — the in-phase observability surface (D-08), read back as the `/queue` timeline.
- **Claim sample:** assert exactly-once via row count of `claimed` after N concurrent claims.
- **Expiry sample:** assert `state='expired'` count after the sweep with a clock past `expires_at`.
- **Reaper sample:** assert orphaned `claimed` rows transition after `claimed_timeout`.
- **Clock control:** inject `now`/Date into expire/reaper (mirrors `isStale(now=…)`) so tests drive TTL/reaper deterministically without `sleep`.

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/queue`
- **Per wave merge:** `npm test` (full suite green)
- **Phase gate:** full suite green + the three QUEUE-04 concurrency/TTL/reaper tests green before `/gsd:verify-work`; operator visual checkpoint on `/queue` (UI hint: yes).

### Wave 0 Gaps
- [ ] `src/lib/queue/canonical.test.ts` — covers QUEUE-02 serializer
- [ ] `src/lib/queue/sign.test.ts` — covers QUEUE-02 HMAC + verify (+ optional openssl cross-check)
- [ ] `src/lib/queue/state.test.ts` — covers QUEUE-01/03 transition guards
- [ ] `src/lib/queue/bounds.test.ts` — covers QUEUE-03 bounds + override flag
- [ ] `src/lib/queue/enqueue.test.ts`, `approve.test.ts`, `claim.test.ts`, `stub-executor.test.ts` — covers QUEUE-01/03/04 against live nodemon
- [ ] Shared test fixture/helper: seed a `commands` row + truncate between tests (live `nodemon`)
- [ ] Framework install: none — Vitest 4 already present.

## Security Domain

> `security_enforcement` config not located; defaulting to enabled. This phase is security-critical (signing, write path, credential boundary).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-operator local tool; no auth in v1 (RBAC is v2/deferred). |
| V3 Session Management | no | No sessions. |
| V4 Access Control | yes | DB-role least privilege: `nodemon_rw` is the only RW role; warehouses RO. Server actions (no public API surface) are the only write entry (narrate.ts precedent). |
| V5 Input Validation | yes | zod bounds on `update_fee` params, server-authoritative (`bounds.ts`); pubkey 66-hex regex; reject reason free-text treated as data (text node render, never HTML sink — CommandExport precedent). |
| V6 Cryptography | yes | HMAC-SHA256 via `node:crypto` (never hand-rolled); lowercase hex; `timingSafeEqual` verify; per-node secret `server-only` env, never DB/client (D-12). |
| V7 Error Handling/Logging | yes | Never log the HMAC secret or full signature material; structured error returns from server actions (narrate.ts shape). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Tampered DB row (params/sig altered) | Tampering | HMAC over `node_pubkey+command_id+action_type+canonical(params)+expires_at`; node re-verifies before applying (Phase 7). Secret NOT in DB (D-12). |
| Replay of a captured row after expiry | Replay | `expires_at` bound INTO the signed payload + fail-closed TTL→`expired` (D-11); `command_id`/nonce uniqueness. |
| Double-apply via overlapping executor ticks | Tampering/DoS | `FOR UPDATE SKIP LOCKED` atomic claim (QUEUE-04 test). |
| Privilege escalation via client-supplied signature | Spoofing | Client never supplies the signature/payload; server recomputes from validated intent (narrate.ts / CLAUDE.md §5). |
| Out-of-bounds fee (e.g. 0 or absurd ppm) | Tampering | zod bounds server-side AND node-side re-enforcement (Phase 7); same frozen schema. |
| Secret leakage to client bundle | Info disclosure | `import "server-only"` on signer + secret modules; signer never imported by a client component. |
| SQL injection in queue queries | Tampering | Drizzle parameterized queries / `sql` template binding only (the AFM-001 / latest.ts discipline — never string-concat identifiers). |
| Stale-data approval | Tampering (integrity of decision) | Blocked-by-default + audited checkbox ack (D-10); diff off the LIVE AFM-001 read (D-06). |

## Sources

### Primary (HIGH confidence)
- In-repo source (authoritative local truth): `src/lib/db/nodemon.ts`, `src/lib/db/schema/nodemon.ts`, `src/lib/db/env.ts`, `src/lib/db/health.ts`, `drizzle.nodemon.config.ts`, `src/lib/insight/schema.ts` (frozen `update_fee` params), `src/app/actions/narrate.ts` (server-action shape), `src/components/export/CommandExport.tsx` (client-leaf grammar), `src/lib/read/latest.ts` (AFM-001), `src/lib/scorecard/freshness.ts` (`isStale`), `src/lib/format/units.ts` (AFM-002), `src/lib/insight/fee-history.ts`, `src/lib/config/backends.ts`, `db/role-grants.sql`.
- `../CLAUDE.md` (NodeMonitor §1/§4/§5) — read-only role boundary, HMAC TS↔bash interop (hex, key-sorted canonical, store-verbatim), LLM-never-signs. BINDING.
- `.planning/{REQUIREMENTS,ROADMAP,STATE}.md` + Phase 6 CONTEXT.md (D-01..D-14). BINDING.
- Installed `drizzle-orm@0.45.2` types: `pg-core/query-builders/select.d.ts` → `for(strength: LockStrength, config?: LockConfig)` confirms `.for("update",{skipLocked:true})` → `SELECT … FOR UPDATE SKIP LOCKED`; `pg-core` exports `pgEnum`, `uuid`, `jsonb`, `timestamp`, `integer`, etc. **HIGH**.
- **Empirical proof this session:** Node `createHmac("sha256",secret).update(canonical,"utf8").digest("hex")` === `openssl dgst -sha256 -hmac` over the verbatim canonical string → identical digest `3994bd2c05475ac6d321242b38ad159e737e0b5c4c1e7c3e3d94565ea0fe19be`. The base64-round-trip mismatch traced to macOS `base64 -d` truncation (test-harness pitfall). **HIGH**.
- Version verification via `node -e require(...).version`: drizzle-orm 0.45.2, drizzle-kit 0.31.10, postgres 3.4.9, zod 3.25.76, Node 22.22.2, OpenSSL 3.6.2. **HIGH**.

### Secondary (MEDIUM confidence)
- `lqwd-node` schema (`src/db/schema.ts`): `feeRatePpm`/`baseFeeMilliSat`/`timeLockDelta` are integers — informs the bounds schema field types. **MEDIUM** (adjacent project, not the gateway `Limits`).

### Tertiary (LOW confidence)
- Provisional `update_fee` numeric bounds (A1) — no gateway `Limits` struct discoverable; numbers are assumed and must be operator-confirmed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is the in-repo proven set; zero new installs; versions verified against `node_modules`.
- Architecture (server-action write path, state machine, claim/reaper): HIGH — mirrors `narrate.ts`; `.for("update",{skipLocked:true})` confirmed in installed types; transaction support confirmed.
- HMAC interop: HIGH — byte-identical TS↔openssl proven empirically this session; the base64 pitfall isolated and documented.
- `update_fee` bounds: LOW — no gateway `Limits` found; provisional, flagged for operator confirmation (A1, Open Q1).
- LDK fee applicability: LOW — STATE blocker, unconfirmed; does not block Phase 6 (A2, Open Q2).
- Pitfalls: HIGH — drawn from the documented AFM-001/§4 disciplines + the empirically-reproduced base64 trap.

**Research date:** 2026-06-15
**Valid until:** 2026-07-15 (stable in-repo stack; revisit only if Drizzle/postgres.js major-bump or the gateway `Limits` becomes available).
