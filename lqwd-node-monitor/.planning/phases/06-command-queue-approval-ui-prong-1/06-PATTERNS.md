# Phase 6: Command Queue + Approval UI (Prong 1) - Pattern Map

**Mapped:** 2026-06-15
**Files analyzed:** 16 new/modified (8 queue lib modules, 1 server action, 1 page, 3 components, 1 schema, 1 migration dir, 1 .env.example)
**Analogs found:** 16 / 16

> Every "hard" sub-problem already has a sanctioned in-repo analog. The genuinely new code is small + pure (canonicalizer, signer, state table, bounds, claim/reaper). Planner: copy structure from the analog cited per file; do not re-derive. All sat/msat/ppm rendering goes through `@/lib/format/units.ts` (AFM-002) — never inline `/1e8`/`*1000`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/db/schema/nodemon.ts` (extend) | model/schema | CRUD | `src/lib/db/schema/routing.ts` | role-match (warehouse RO schema → owned RW schema) |
| `src/lib/queue/canonical.ts` | utility (pure) | transform | `src/lib/read/latest.ts` (pure-fragment + lazy-import split) | partial (pure-module discipline) |
| `src/lib/queue/sign.ts` | utility (server-only) | transform | `src/lib/config/backends.ts` (server-only env resolution) | role-match |
| `src/lib/queue/state.ts` | utility (pure) | event-driven | `src/lib/scorecard/freshness.ts` (pure, clock-injectable) | partial (pure transition logic) |
| `src/lib/queue/bounds.ts` | model/validation (pure) | transform | `src/lib/insight/schema.ts` (zod `.strict()` contract) | exact (extends the frozen `update_fee` params) |
| `src/lib/queue/enqueue.ts` | service (server-only) | CRUD/transactional | `src/lib/db/health.ts` `assertWritable` (`dbNodemon.transaction`) | role-match |
| `src/lib/queue/claim.ts` | service (server-only) | event-driven/transactional | `src/lib/db/health.ts` (txn) + `src/lib/read/latest.ts` (`sql` fragment) | role-match |
| `src/lib/queue/stub-executor.ts` | test driver (server-only) | event-driven | `src/lib/queue/claim.ts` (this phase) / `health.ts` txn | role-match |
| `src/app/actions/queue.ts` | controller (server action) | request-response | `src/app/actions/narrate.ts` | exact |
| `src/app/(overview)/queue/page.tsx` | route (RSC) | request-response | `src/app/(overview)/inbox/page.tsx` | exact |
| `src/components/queue/EnqueuePreview.tsx` | component (client leaf) | request-response | `src/components/export/CommandExport.tsx` | exact (expand → inert preview → deliberate confirm) |
| `src/components/queue/ApprovePanel.tsx` | component (client leaf) | request-response | `src/components/export/CommandExport.tsx` (per-button confirm-state grammar) | role-match |
| `src/components/queue/QueueTimeline.tsx` | component (RSC, presentational) | request-response | `src/components/console/ActiveSignalsPanel.tsx` (verbatim row renderer) | role-match |
| enqueue-control mount points (edit `InsightCardRow.tsx` + `ActiveSignalsPanel.tsx`) | component (edit) | request-response | the existing `CommandExport` mount in both surfaces | exact |
| `drizzle/nodemon/*` (generated migration) | migration | CRUD | `drizzle.nodemon.config.ts` (the only generate/migrate config) | exact |
| `.env.example` (add `NODEMON_HMAC_SECRET_<pubkey>`, TTL, reaper) | config | — | `src/lib/db/env.ts` `requireEnv` contract | role-match |

---

## Pattern Assignments

### `src/lib/db/schema/nodemon.ts` (model/schema, CRUD) — EXTEND

**Analog:** `src/lib/db/schema/routing.ts` (pgTable column-mapping grammar) — but note this is the **inverse role**: routing.ts is hand-curated RO over externally-owned tables; nodemon.ts is the **only Drizzle-owned generate/migrate schema** (D-08). Currently `export {}` (lines 1-8). Replace it.

**Drizzle import + pgTable grammar** (`routing.ts` lines 1-9, 35-60):
```typescript
import { pgTable, integer, text, varchar, bigint, boolean, timestamp } from "drizzle-orm/pg-core";
export const lndNodeChannelInfo = pgTable("lnd_node_channel_info", {
  id: integer("id").primaryKey(),
  chanId: varchar("chan_id"),
  // ... snake_case DB column ↔ camelCase TS field
});
```

**For Phase 6 add (per RESEARCH §Recommended Structure + Standard Stack):** `pgEnum` for the state column (`draft|pending_approval|approved|claimed|executing|succeeded|failed|rejected|expired`), and three tables — `commands` (id `uuid` PK app-supplied pre-sign, `nodePubkey`, `actionType`, `params jsonb`, `canonicalPayload text` stored VERBATIM, `signatureHex text`, `state` enum, `expiresAt`, `claimedAt`, `createdAt`), `command_executions`, `command_audit` (`commandId`, `fromState` nullable, `toState`, `actor`, `reason` nullable, `staleAcknowledged boolean`, `ts`). `pgEnum`, `uuid`, `jsonb`, `timestamp` confirmed exported by installed `drizzle-orm@0.45.2` (RESEARCH Sources).

**Timestamptz note:** the pending tables use `timestamp("...", { withTimezone: true })` (`routing.ts` lines 255-257) — follow that for queue timestamps if timezone-correctness matters for TTL math.

---

### `src/lib/queue/canonical.ts` (utility, pure transform) — NEW

**Analog:** `src/lib/read/latest.ts` — for the **pure-fragment + no-server-only discipline** (it splits `buildLatestChannelsSql` as a pure, test-without-DB export from the DB-touching `latestChannelsForNode`). Apply the same: `canonicalize()` + `buildSignedPayload()` are PURE (no DB, no env, no `server-only`), test-importable anywhere (RESEARCH Pitfall 7).

**Mirror the `schema.ts` contract intent** (`schema.ts` lines 11-13, 22-24): this module is a **cross-phase freeze** — its output is hashed byte-identically by Phase 7's bash `openssl`. The frozen `update_fee` params are flat strings/numbers (`schema.ts` lines 99-113), so a ~6-line recursive key-sort serializer suffices (RESEARCH §Pattern 2, §State of the Art — do NOT add an RFC-8785 dependency).

Concrete serializer + `buildSignedPayload` (newline-joined `node_pubkey + command_id + action_type + canonical + expires_at`) given verbatim in RESEARCH §Pattern 2 (proven byte-identical to openssl `3994bd2c…`). Store the canonical string verbatim on the row (CLAUDE.md §4).

---

### `src/lib/queue/sign.ts` (utility, server-only transform) — NEW

**Analog:** `src/lib/config/backends.ts` — for **server-only env resolution with fail-loud lookup**.

**server-only + env-keyed resolution** (`backends.ts` lines 1-2, 62-65):
```typescript
import "server-only";
export function backendFor(pubkey: string): Backend {
  return ENV_OVERRIDES[pubkey] ?? DEFAULT_BACKENDS[pubkey] ?? "lnd";
}
```

**For Phase 6 (D-12):** key the secret by pubkey `NODEMON_HMAC_SECRET_<pubkey>`, fail loud when missing (the `requireEnv` voice — see `env.ts` lines 11-17: `throw new Error("Missing required env: " + name)`). Never read DB, never reach a client bundle. HMAC + `timingSafeEqual` verbatim in RESEARCH §Pattern 3 (`createHmac("sha256", secret).update(payload,"utf8").digest("hex")`; constant-time compare). This is the FORMAT/LOCATION freeze Phase 7's downloader mirrors (A3 — freeze exact key form).

---

### `src/lib/queue/state.ts` (utility, pure) — NEW

**Analog:** `src/lib/scorecard/freshness.ts` — for the **pure, clock-injectable, no-DB transition logic** that the deterministic test suite drives.

**Clock-injection pattern** (`freshness.ts` lines 29-32):
```typescript
export function isStale(asOf: Date | null, warnAfterHours: number, now: Date = new Date()): boolean {
  if (asOf === null) return true;
  return now.getTime() - asOf.getTime() > warnAfterHours * MS_PER_HOUR;
}
```

**For Phase 6:** a pure `LEGAL` transition table + `canTransition(from, to)` (verbatim in RESEARCH §Pattern 4) with NO DB/env imports. Inject `now` into any TTL/expiry predicate helper (mirrors `isStale(now=…)`) so the expire/reaper tests are deterministic without `sleep` (RESEARCH §Observability — Clock control).

---

### `src/lib/queue/bounds.ts` (model/validation, pure) — NEW

**Analog:** `src/lib/insight/schema.ts` — EXACT. This **extends the frozen `update_fee` params** and must be pure (no server-only).

**zod `.strict()` flat-params grammar** (`schema.ts` lines 99-113):
```typescript
type: z.literal("update_fee"),
params: z.object({
  chanId: z.string(), channelPoint: z.string(),
  currentPpm: z.number(), suggestedPpm: z.number(),
  baseFeeMsat: z.number(), timeLockDelta: z.number(),
}).strict(),
```

**For Phase 6 (D-03):** add min/max bounds (provisional — `suggestedPpm ≤5000`, `baseFeeMsat ≤100_000`, `timeLockDelta 18–2016`; RESEARCH §Code Examples bounds schema). **FLAG FOR OPERATOR** (A1 — no gateway `Limits` struct exists; these are the SAME bounds Phase 7 re-enforces node-side, must be frozen). Keep `.strict()` like every level in `schema.ts` (line 28: field additions are breaking changes). Record operator-override when a value differs from the engine suggestion (audited per D-03).

---

### `src/lib/queue/enqueue.ts` (service, server-only transactional) — NEW

**Analog:** `src/lib/db/health.ts` `assertWritable` (lines 77-86) — for the **`dbNodemon.transaction()` shape**; composes canonical.ts + sign.ts.

**Transaction grammar** (`health.ts` lines 78-82):
```typescript
await db.transaction(async (tx) => {
  await tx.execute(sql`CREATE TEMP TABLE _rw_probe (x int)`);
  await tx.execute(sql`DROP TABLE _rw_probe`);
});
```

**Lazy-import the server-only DB inside the function** (the `latest.ts` lines 42-47 / `narrate.ts` lines 30-31 precedent) so pure callers don't spin a pool. Full enqueue (randomUUID + expiresAt + canonicalize + sign + `INSERT commands` + `INSERT command_audit` in one txn) verbatim in RESEARCH §Code Examples "Enqueue". `command_id`/`expires_at` generated app-side BEFORE signing (RESEARCH Pitfall 2 — never `DEFAULT gen_random_uuid()` on the signed id).

---

### `src/lib/queue/claim.ts` (service, server-only transactional) — NEW

**Analog:** `src/lib/db/health.ts` (transaction shape) + `src/lib/read/latest.ts` (`sql` template / lazy DB import).

**For Phase 6 (QUEUE-04):** `claimNext()` using `.for("update", { skipLocked: true })` inside `dbNodemon.transaction` (verbatim in RESEARCH §Pattern 5 — confirmed in installed `select.d.ts`). Plus `expire` and `reaper` UPDATE…WHERE sweeps (fail-closed, RESEARCH Pitfall 4 — independent `expires_at < now()` and `claimed_at < now()-claimed_timeout` sweeps). `localPubkey`/params ALWAYS parameter-bound, never string-concatenated (the `latest.ts` lines 16-17 SQL-injection discipline). Lazy-import `dbNodemon` (latest.ts precedent).

---

### `src/lib/queue/stub-executor.ts` (test driver, server-only) — NEW

**Analog:** `src/lib/queue/claim.ts` (this phase) — drives `claimed→executing→succeeded|failed` + writes `command_executions`, using the same transactional-flip grammar.

**D-13 constraint:** TEST-SUITE ONLY. There is **no operator "simulate" control** and no UI mount (RESEARCH Anti-Patterns — a throwaway "simulate execution" button is explicitly rejected). The overlapping-tick no-double-apply test runs two concurrent `claimNext()` against one approved row and asserts exactly one claim (RESEARCH Pitfall 3, §Test Map QUEUE-04).

---

### `src/app/actions/queue.ts` (controller, server action) — NEW

**Analog:** `src/app/actions/narrate.ts` — EXACT. Same shape: `"use server"`, no public API route, client never supplies the signed payload, server re-validates + recomputes.

**Server-action result-object grammar** (`narrate.ts` lines 1, 23, 69-96):
```typescript
"use server";
export type NarrateResult = { ok: true; text: string } | { ok: false; error: string };
export async function narrate(scope: NarrateScope): Promise<NarrateResult> {
  if (scope.level === "node" && !PUBKEY_RE.test(scope.pubkey)) {
    return { ok: false, error: "invalid pubkey ..." };
  }
  try {
    const { loadInsightView } = await import("@/lib/insight/engine"); // lazy server-only import
    // ...
    return { ok: true, text };
  } catch (error) {
    console.error("narrate action failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
```

**For Phase 6:** export `enqueueCommand`, `approveCommand`, `rejectCommand` returning `{ ok: true; id } | { ok: false; error }`. Re-validate intent with `bounds.ts` server-side (authoritative — RESEARCH §Pattern 1). Reuse the 66-hex `PUBKEY_RE` (`narrate.ts` line 19). Lazy-import the server-only `@/lib/queue/enqueue`|`claim` (line 227 of RESEARCH §Pattern 1). Error strings map to the UI-SPEC copywriting contract (e.g. "NO SIGNING SECRET FOR THIS NODE", "THIS COMMAND IS NO LONGER PENDING APPROVAL" on the `state=<expected>` guard miss).

---

### `src/app/(overview)/queue/page.tsx` (route, RSC) — NEW

**Analog:** `src/app/(overview)/inbox/page.tsx` — EXACT (D-05 says `/queue` parallels `/inbox` and `/pending`).

**RSC dynamic-read + header + empty-state grammar** (`inbox/page.tsx` lines 9-13, 41-101):
```typescript
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Inbox" }; // → "Queue"
export default async function InboxPage() {
  let view: InsightView;
  try { view = await loadInsightView(); }
  catch (error) { console.error("Inbox load failed:", error); return (/* honest error main */); }
  // header: font-display uppercase title left + FreshnessStamp right (lines 75-89)
  // empty state: named timestamp, absence IS the signal (lines 92-98)
}
```

**For Phase 6 (D-06/D-08):** read `nodemon` commands; for each, re-query live current policy via `latestChannelsForNode(pubkey)` (`src/lib/read/latest.ts` — the AFM-001 sanctioned read, NEVER `MAX(timestamp)`); compute the diff with `@/lib/format/units.ts`; stamp freshness via `isStale` (`freshness.ts`) + `<FreshnessStamp>` (`src/components/scorecard/FreshnessStamp.tsx`, lines 1-13). Render the audit timeline (`QueueTimeline`) and the `ApprovePanel` client leaf per row. Empty/error copy is verbatim from UI-SPEC ("QUEUE IS EMPTY", etc.).

---

### `src/components/queue/EnqueuePreview.tsx` (component, client leaf) — NEW

**Analog:** `src/components/export/CommandExport.tsx` — EXACT (UI-SPEC: "structurally mirrors CommandExport.tsx — expand → inert preview → deliberate confirm").

**Client-leaf expand + CONTROL_CHROME + key/value-rows grammar** (`CommandExport.tsx` lines 1-3, 42-45, 91-119):
```typescript
"use client";
import { useState } from "react";
const CONTROL_CHROME = cn(buttonVariants({ variant: "outline", size: "sm" }),
  "font-mono text-xs font-semibold tracking-[0.14em] uppercase");
// toggle button (lines 96-104) → instant expand, no animation (line 106)
// context echo: key/value rows (lines 110-119): label text-foreground/45, value tabular-nums
```

**For Phase 6 (D-01/D-02/D-03):** receive serializable props ONLY (never the card — T-05-03 / lines 16-18). Render `current → proposed ppm` / `base fee (msat)` / `timelock delta` / `expires` rows (all via `@/lib/format/units.ts`, `tabular-nums`); editable-within-`bounds.ts` inputs; the `CONFIRM ENQUEUE` deliberate act calls `enqueueCommand` server action (the leaf-calls-action wiring is new vs CommandExport's clipboard-only side effect). `OVERRIDDEN` warn-chip on nudged params. Suppressed-node cards have null action → control simply absent (the `buildExportBlock===null ⇒ no leaf` precedent, `InsightCardRow.tsx` lines 82, 160-163).

---

### `src/components/queue/ApprovePanel.tsx` (component, client leaf) — NEW

**Analog:** `src/components/export/CommandExport.tsx` `CopyButton` (lines 50-84) — the **per-control confirm-state + in-place label-swap + honest-failure** grammar; reuse for the APPROVE/REJECT confirm gesture.

**In-place state-swap + aria-live grammar** (`CommandExport.tsx` lines 50-83):
```typescript
const [state, setState] = useState<CopyState>("idle");
const buttonLabel = state === "copied" ? "COPIED" : state === "failed" ? "COPY FAILED" : label;
<button ... aria-live="polite" className={cn(CONTROL_CHROME, state === "failed" && "text-status-warn")}>
```

**For Phase 6 (D-07/D-10):** APPROVE (navy) + REJECT (critical-red) each take a confirm; optional reject reason free-text rendered as a TEXT NODE only (the CommandExport containment rule, lines 20-22 / 146-148 — never an HTML sink). The stale-ack `<input type="checkbox">` (vendor `checkbox` from the radix allowlist OR styled native per UI-SPEC) disables APPROVE until checked; ack flows to the audit row. Calls `approveCommand`/`rejectCommand`.

---

### `src/components/queue/QueueTimeline.tsx` (component, RSC presentational) — NEW

**Analog:** `src/components/console/ActiveSignalsPanel.tsx` — the **verbatim-row-renderer with NO logic** pattern (D-08: append-only audit read back as a read-only timeline).

**Panel + verbatim row grammar** (`ActiveSignalsPanel.tsx` lines 46-94):
```typescript
export function ActiveSignalsPanel({ signals }: ActiveSignalsPanelProps) {
  if (signals.length === 0) return null; // absence IS the signal
  return (
    <section className="rounded-lg border border-status-critical/40 bg-card">
      <div className="flex items-center border-b border-border px-4 py-2.5">{/* panel head */}</div>
      {signals.map((signal, i) => (/* mono uppercase label + detail + optional second line */))}
    </section>
  );
}
```

**For Phase 6 (D-08):** one row per audit transition (`from → to`, actor, ts, optional reason/staleAck). State→chip mapping from UI-SPEC (`SUCCEEDED` ok-green, `REJECTED/FAILED/EXPIRED` critical-red, in-flight neutral) — mono uppercase chips, **no dots/icons** (sketch rule). "No transitions recorded." empty copy from UI-SPEC.

---

### Enqueue-control mount points — EDIT `InsightCardRow.tsx` + `ActiveSignalsPanel.tsx`

**Analog:** the existing `CommandExport` mount in BOTH files — EXACT (D-01: one component, both surfaces).

**Mount grammar** (`InsightCardRow.tsx` lines 160-163; `ActiveSignalsPanel.tsx` lines 88-93):
```typescript
{exportBlock !== null && (
  <CommandExport block={exportBlock} blockId={`export-${card.id}`} />
)}
```

**For Phase 6:** mount `<EnqueuePreview>` on `update_fee` cards exactly where `<CommandExport>` mounts, fed serializable props built server-side. Because suppressed cards carry null actions upstream (`guardrails.ts`), the control is simply absent — no new guard (CONTEXT Reusable Assets). Note `CommandExport`/`buildExportBlock` returns null for `update_fee` today, so enqueue and export are complementary, non-overlapping mounts on the same suggested-action box.

---

### `drizzle/nodemon/*` (migration) — GENERATED

**Analog:** `drizzle.nodemon.config.ts` (lines 1-14) — the ONLY config that may run `generate`/`migrate` (D-08). `out: "./drizzle/nodemon"`, `schema: "./src/lib/db/schema/nodemon.ts"`. Run `npm run db:generate` then `db:migrate` against `NODEMON_QUEUE_URL`; commit the generated migration. NEVER point generate/migrate at a warehouse (routing.ts header lines 16-17).

---

### `.env.example` (config) — EDIT

**Analog:** `src/lib/db/env.ts` `requireEnv` contract (lines 11-17). Add the per-node `NODEMON_HMAC_SECRET_<pubkey>` naming contract (D-12 — document the exact key form, A3 freeze for Phase 7), plus optional `NODEMON_TTL_HOURS` (D-11, default 24) and `claimed_timeout` reaper placeholder (D-14). The HMAC secret is `server-only`, never in DB, never in any client bundle.

---

## Shared Patterns

### Server-only + lazy DB import (keeps pure modules pool-free)
**Source:** `src/lib/read/latest.ts` lines 42-47; `src/app/actions/narrate.ts` lines 30-31; `src/lib/config/backends.ts` line 1.
**Apply to:** every queue module that touches `dbNodemon` or env (`sign.ts`, `enqueue.ts`, `claim.ts`, `stub-executor.ts`, `queue.ts`). Top-level `import "server-only"`; lazy `await import("@/lib/db/nodemon")` INSIDE functions. Keep `canonical.ts`/`state.ts`/`bounds.ts` PURE (no DB/env) so the deterministic test suite runs without a pool (RESEARCH Pitfall 7).

### Transactional flip + audit insert (atomic state change)
**Source:** `src/lib/db/health.ts` `assertWritable` lines 77-86 (`dbNodemon.transaction`); RESEARCH §Pattern 4.
**Apply to:** `enqueue.ts`, `claim.ts`, `queue.ts` approve/reject, `stub-executor.ts`. Every state flip is `UPDATE … WHERE id=? AND state=<expected>` PLUS a `command_audit` INSERT in ONE `dbNodemon.transaction()`. The `WHERE state=<expected>` guard makes it idempotent and surfaces the "no longer pending" lost-race error (UI-SPEC error copy).

### Fail-loud env resolution
**Source:** `src/lib/db/env.ts` lines 11-17 (`throw new Error("Missing required env: " + name)`); `src/lib/config/backends.ts` lines 33-58 (throw on malformed config).
**Apply to:** `sign.ts` (missing `NODEMON_HMAC_SECRET_<pubkey>` → descriptive throw, surfaced as the "NO SIGNING SECRET" UI error).

### AFM-002 unit rendering (no inline conversions)
**Source:** `src/lib/format/units.ts` (`feeMsatToSat`, `formatSats`, `formatBtc`); usage in `InsightCardRow.tsx` lines 50-63.
**Apply to:** every ppm/sat/msat/timelock value in `EnqueuePreview`, the `/queue` diff, and `QueueTimeline`. `tabular-nums`. NEVER inline `/1e8`/`*1000` (grep-guarded).

### AFM-001 latest-state read (no MAX-timestamp)
**Source:** `src/lib/read/latest.ts` `latestChannelsForNode` lines 42-51.
**Apply to:** the `/queue` live current-policy re-query (D-06). NEVER `WHERE timestamp = MAX(...)` (the documented 480-channels-as-1 failure, RESEARCH Anti-Patterns).

### Client-leaf containment (serializable props, text-node render)
**Source:** `src/components/export/CommandExport.tsx` lines 16-22, 146-148.
**Apply to:** `EnqueuePreview`, `ApprovePanel`. Leaves receive plain serializable strings/props ONLY — the card never crosses the boundary. Free-text (reject reason) renders as a TEXT NODE, never an HTML/markdown sink (V5 input-validation, RESEARCH Security Domain).

### NOC Light sketch grammar (mono uppercase, no icons-for-state)
**Source:** `.claude/skills/sketch-findings-nodemonitor/SKILL.md` lines 9, 20-24; `CommandExport`/`InsightCardRow` chrome.
**Apply to:** all three new components. Navy only for chrome/focus-ring/the deliberate CONFIRM/APPROVE act; severity color (`text-status-critical|warn|ok|stale`) does state; mono uppercase chips, no dots/icons; hairline borders, tight radii. Controls are lowercase-on-trigger, UPPERCASE-on-commit (`CommandExport` lines 60-61).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Every file maps to an in-repo analog. The genuinely *new* logic (key-sort canonicalizer, HMAC signer, state transition table, `FOR UPDATE SKIP LOCKED` claim/reaper) has no structural analog in-repo but is fully specified verbatim in RESEARCH §Patterns 2–5 + §Code Examples; the planner copies those, not a file. |

**Adjacent-but-not-analog note:** there is no existing server action that *writes* to a DB (`narrate.ts` is read-only) and no existing `FOR UPDATE SKIP LOCKED` usage — Phase 6 is the project's first DB-write UI. The write-path *shape* is borrowed from `narrate.ts` (server-action contract) + `health.ts` (transaction grammar); the concurrency primitive is new (RESEARCH §Pattern 5, confirmed in installed Drizzle types).

## Metadata

**Analog search scope:** `src/app/actions`, `src/app/(overview)`, `src/lib/db` (+ `schema/`), `src/lib/queue` (empty — new), `src/lib/insight`, `src/lib/read`, `src/lib/scorecard`, `src/lib/format`, `src/lib/config`, `src/components/{export,insight,console,queue,scorecard}`, `drizzle.nodemon.config.ts`, `.claude/skills/`.
**Files scanned:** ~18 read in full; ~110 enumerated.
**Pattern extraction date:** 2026-06-15
