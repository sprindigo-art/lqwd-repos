---
phase: 01-foundations-read-layer
reviewed: 2026-06-09T00:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - src/lib/db/env.ts
  - src/lib/db/warehouse-routing.ts
  - src/lib/db/warehouse-ldk.ts
  - src/lib/db/nodemon.ts
  - src/lib/db/health.ts
  - src/lib/db/schema/routing.ts
  - src/lib/db/schema/ldk.ts
  - src/lib/db/schema/nodemon.ts
  - src/instrumentation.ts
  - src/lib/read/latest.ts
  - src/lib/read/nodes.ts
  - src/lib/format/units.ts
  - src/lib/utils.ts
  - src/app/(status)/page.tsx
  - src/app/layout.tsx
  - db/role-grants.sql
  - drizzle.routing.config.ts
  - drizzle.ldk.config.ts
  - drizzle.nodemon.config.ts
  - src/lib/read/latest.test.ts
  - src/lib/read/nodes.test.ts
  - src/lib/format/units.test.ts
  - src/lib/db/health.test.ts
  - src/lib/read/golden.test.ts
findings:
  critical: 0
  warning: 6
  info: 5
  total: 11
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

The read foundation is well-disciplined on the headline security/correctness contracts:
`import "server-only"` is present on every DB/credential module; the AFM-001 latest-state
helper uses `DISTINCT ON (chan_id) ... ORDER BY chan_id, timestamp DESC` with the pubkey
**parameter-bound** (verified via the no-DB shape test rendering `$1`); the AFM-002 formatter
is the single conversion source and its five operator-anchored BTC reference values were
re-derived and match exactly; the unified LND/LDK mapper keeps a clean typed per-backend
boundary with no `any`-leak; no secrets are committed (`.env.local` is git-ignored, only
`.env.example` with name-only placeholders is tracked); and no dangerous sinks
(`eval`/`innerHTML`/`exec`) exist in the tree.

No BLOCKERS were found. However, the adversarial pass surfaced several real correctness gaps
that will bite once live data flows: (1) the AFM-001 helper does not exclude rows with a NULL
`chan_id`, which `DISTINCT ON` silently collapses to a single row — a latent AFM-001-class
miscount; (2) `Number(bigint)` conversions in the formatter and LDK aggregation can lose
precision above 2^53 msat, which is reachable at fleet scale; (3) the `assertReadOnly` boot
probe has a re-throw path that can let an *unexpected* DB error be misread, and its temp-table
probe is not a complete write test; (4) the status page LDK aggregation conflates
"usable" with "active" and forces `inactiveChannels` for every not-usable channel. These are
WARNINGs because they degrade correctness/robustness rather than crash or leak — but several
directly touch the "every sat accounted for / no AFM-001 miscount" core value.

## Warnings

### WR-01: AFM-001 latest-channel helper does not exclude NULL `chan_id` — `DISTINCT ON` collapses them to one row

**File:** `src/lib/read/latest.ts:24-31`
**Issue:** `chanId` is declared nullable in the schema (`varchar("chan_id")`, no `.notNull()`,
`src/lib/db/schema/routing.ts:39`). `SELECT DISTINCT ON (chan_id) ... ORDER BY chan_id,
timestamp DESC` treats *all* rows where `chan_id IS NULL` as a single distinct group and returns
exactly one of them. If the event-driven warehouse ever emits channel rows before a `chan_id`
is assigned (pending opens, partial syncs), every such row collapses into one — the exact
"N-channels-read-as-1" failure-mode family AFM-001 exists to prevent, just relocated from the
time dimension to the key dimension. The golden test only checks `active && !closed` counts on
three well-formed reference nodes, so it would not catch this.
**Fix:**
```ts
export function buildLatestChannelsSql(localPubkey: string): SQL {
  return sql`
    SELECT DISTINCT ON (chan_id) *
    FROM lnd_node_channel_info
    WHERE local_pubkey = ${localPubkey}
      AND chan_id IS NOT NULL
    ORDER BY chan_id, timestamp DESC
  `;
}
```

### WR-02: `Number(bigint)` conversions lose precision above 2^53 at fleet msat scale

**File:** `src/lib/format/units.ts:8-9`, `src/lib/read/nodes.ts:81-82,123-124`
**Issue:** `feeMsatToSat`, `formatSats`, and `formatBtc` all funnel through `Number(value)`.
`localBalanceSats` on `UnifiedNode` is typed `number` and the LDK path sums per-channel msat
into a `bigint` then converts. `Number.MAX_SAFE_INTEGER` is 9.007e15; fleet-wide msat totals
reach that range (~90,000 BTC expressed in msat = 9e15 msat), and forwarding `fee_msat` sums
across 26 nodes are unbounded. Past the safe-integer boundary, `Number(bigint)` silently rounds —
producing wrong-by-a-few-sats balances. CLAUDE.md's core value is literally "every sat must be
accounted for," so silent rounding here is a real correctness liability even though it is
out-of-range for the current single-node test fixtures.
**Fix:** Do msat→sat division on the bigint domain before narrowing, and guard the narrowing:
```ts
export function feeMsatToSat(msat: bigint | number): number {
  if (typeof msat === "bigint") {
    // integer-divide in bigint domain, keep the sub-sat remainder as a float
    const sats = msat / 1000n;
    const rem = Number(msat % 1000n) / 1000;
    return Number(sats) + rem; // Number(sats) still safe up to 9e15 sats
  }
  return msat / MSAT_PER_SAT;
}
```
For `formatSats`/`formatBtc`, prefer formatting the bigint directly (e.g.
`sats.toLocaleString()` on bigint, or `Intl.NumberFormat`) rather than `Number(sats)`.

### WR-03: `assertReadOnly` re-throws any unexpected DB error as if it were a contract violation

**File:** `src/lib/db/health.ts:56-70`
**Issue:** The catch returns PASS only for SQLSTATE `25006`/`42501`; for everything else it
`throw error`. A transient failure during the probe (network blip, `42P07` duplicate temp table
from a leaked prior connection, `57014` statement timeout) is then surfaced as a fatal boot abort
indistinguishable from a genuine "warehouse permits writes" violation. Worse, if the temp-table
`CREATE` itself were rejected by the driver before reaching Postgres (no `.code`), `pgCode`
returns `undefined`, the SQLSTATE branch is skipped, and the original (possibly benign) error
aborts boot. The probe also tests only DDL (`CREATE TEMP TABLE`); some read-only enforcement
configurations permit temp DDL but reject DML — an `INSERT`/`UPDATE` probe is the stronger signal
the comment claims to provide.
**Fix:** Use a DML write probe (which `default_transaction_read_only` always rejects with 25006),
and on an unexpected non-read-only SQLSTATE, fail with an explicit "unexpected error during
read-only probe" message rather than re-throwing a raw driver error that reads as a contract
violation:
```ts
await tx.execute(sql`CREATE TEMP TABLE _ro_probe (x int)`);
await tx.execute(sql`INSERT INTO _ro_probe (x) VALUES (1)`); // DML — the real write test
throw new Error(`${name}: warehouse permits writes (read-only NOT enforced)`);
// ...
const code = pgCode(error);
if (code === READ_ONLY_SQLSTATE || code === INSUFFICIENT_PRIV_SQLSTATE) return;
if (error instanceof Error && error.message.includes("permits writes")) throw error;
throw new Error(`${name}: unexpected error during read-only probe (code=${code ?? "none"})`);
```

### WR-04: LDK status-page aggregation conflates "usable" with "active" and miscounts inactive channels

**File:** `src/app/(status)/page.tsx:66-71`
**Issue:** The loop does `if (c.isUsable) active += 1; else inactive += 1;`. `is_channel_usable`
is false for a freshly-funded-but-not-yet-ready channel, a channel whose peer is momentarily
offline, etc. — none of which are "inactive" in the operator sense. Every not-usable channel
(including channels still confirming) is counted as `inactiveChannels`, while `pendingChannels`
is hard-coded `0`. The page also never reads `isChannelReady` even though it is selected
(`page.tsx:54`), so the readiness signal that would let you separate pending-open from
inactive is fetched and discarded. Result: the LDK row's channel counts will not match what an
operator sees in the LSP.
**Fix:** Derive the three buckets from both flags, e.g. ready+usable → active, ready+!usable →
inactive, !ready → pending:
```ts
for (const c of ldkChannels) {
  if (!c.isReady) pending += 1;
  else if (c.isUsable) active += 1;
  else inactive += 1;
}
// ...pendingChannels: pending
```

### WR-05: `latestChannelsForNode` returns `result as unknown as Record<string, unknown>[]` — unverified shape crosses the read boundary

**File:** `src/lib/read/latest.ts:43-45`
**Issue:** The double assertion `result as unknown as Record<string, unknown>[]` defeats type
checking on the single most safety-critical read in the phase. The golden test then indexes
untyped string keys (`r["active"]`, `r["closed"]`, `golden.test.ts:95-96`) with no compile-time
guarantee those columns exist or are booleans — a column rename in the warehouse would silently
make the filter always-false (every channel counted as not-active) and the invariant would pass
vacuously for an offline node (`0 ≈ 0`) while masking real drift. This is the same family of
"types lie at the boundary" risk the unified mapper was carefully built to avoid in `nodes.ts`.
**Fix:** Type the row explicitly (a minimal interface of the columns consumed) and assert to that,
or run the query through Drizzle's typed `select()` against `lndNodeChannelInfo` so `active`/
`closed`/`chanId` are checked, rather than `Record<string, unknown>`.

### WR-06: `dynamic = "force-dynamic"` page has no error boundary — a warehouse outage renders an unhandled 500 with a leaked stack

**File:** `src/app/(status)/page.tsx:32-95`
**Issue:** `loadUnifiedNodes()` awaits two live warehouse queries at request time with no
try/catch and no `error.tsx` in the route segment. CLAUDE.md's error-handling convention is
"wrap logic in try-catch, log errors with context, return standardized responses." If either
warehouse is unreachable mid-session (the India node review documents nodes going offline for
days), the Server Component throws and Next renders the default error page; in development that
page can surface the raw error/stack, and a postgres connection error can include host/role
fragments. The empty-state path (`nodes.length === 0`) is handled, but the *throw* path is not.
**Fix:** Add `src/app/(status)/error.tsx` (a client error boundary) and/or wrap the fetch:
```ts
try {
  const { nodes, fetchedAt } = await loadUnifiedNodes();
} catch (e) {
  console.error("FleetStatusPage load failed:", e);
  // render a safe "warehouse unreachable" state — never the raw error
}
```

## Info

### IN-01: `assertReachable` swallows the underlying error, hindering boot diagnosis

**File:** `src/lib/db/health.ts:42-48`
**Issue:** The bare `catch {}` discards the real connection error and throws only
`"<name>: unreachable"`. On a failed boot the operator cannot tell auth failure from DNS failure
from SSL mismatch. The module comment forbids logging connection strings (correct), but the
SQLSTATE/`errno` can be surfaced safely.
**Fix:** `catch (e) { console.error(`${name} reachability failed:`, pgCode(e) ?? e); throw new Error(`${name}: unreachable`); }` — log the code, not the URL.

### IN-02: `UnifiedNodeWithExtras` is exported but unused — dead surface area in Phase 1

**File:** `src/lib/read/nodes.ts:73-75`
**Issue:** The discriminated-union extras type is defined and exported but no code or test
constructs or consumes it this phase. It documents intent for later phases but currently reads as
dead code. Acceptable as a forward declaration, but flag so it is either covered by a type-level
test or deferred to the phase that needs it.
**Fix:** Either add a `expectTypeOf`/compile assertion exercising both arms, or move the type to
the phase that introduces backend-specific extras.

### IN-03: `.gitignore` ignores `.env.local` family but not a plain `.env`

**File:** `.gitignore:33-37`
**Issue:** Only `.env.local` / `.env.*.local` are ignored. CLAUDE.md notes "other projects use
`.env` files (Git-ignored)"; if a contributor following that convention drops a plain `.env`
with a real `ROUTING_VM_DATABASE_URL` (credentials embedded), it would be trackable. Currently no
`.env` exists and only `.env.example` is tracked, so this is preventative, not an active leak.
**Fix:** Add `.env` (and optionally `.env.*` with a `!.env.example` exception) to `.gitignore`.

### IN-04: Brand navy `#1A3C79` is hard-coded as inline styles instead of a theme token

**File:** `src/app/(status)/page.tsx:100,114,131`; secondary `#2A5299` at `:131`
**Issue:** CLAUDE.md (§3) mandates the navy live as a CSS variable in `globals.css` `@theme`
(`--color-brand: #1A3C79`) so shadcn/Recharts inherit it; here it is repeated as
`style={{ color: "#1A3C79" }}` magic-string literals, and `#2A5299` is an undocumented second
magic color. Functional but violates the stated theming convention and will drift from charts.
**Fix:** Define `--color-brand` (and a brand-2 if needed) in `@theme` and use Tailwind classes
(`text-brand`, `bg-brand`) instead of inline hex.

### IN-05: `pendingChannels: 0` hard-coded for LDK with only an inline comment

**File:** `src/app/(status)/page.tsx:80`
**Issue:** The LDK node always reports zero pending channels because the granted columns can't
derive it. This is a known limitation, but a silent `0` can read as "confirmed: no pending" to an
operator rather than "unknown / not measured," which matters for a control tool whose value is
accountability.
**Fix:** Consider modeling unknown-vs-zero distinctly (e.g. `pendingChannels: number | null` in
`UnifiedNode`, rendering `—` for null) so the UI does not assert a count it never measured.

---

_Reviewed: 2026-06-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
