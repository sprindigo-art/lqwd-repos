import "server-only";

// =====================================================
// QUEUE-04 — atomic claim + fail-closed TTL expire + stale-claim reaper
// =====================================================
// The phase's core SAFETY surface. Three server-only sweeps over `commands`,
// each fail-closed and each parameter-bound (never string-concatenated — the
// latest.ts SQL-injection discipline):
//
//   claimNext()  — SELECT one `approved`, non-expired row, `.for("update",
//                  { skipLocked: true })` (→ SELECT … FOR UPDATE SKIP LOCKED),
//                  flip to `claimed`, write an approved→claimed audit row.
//                  The DB row-lock is the ONLY correct no-double-apply primitive
//                  under concurrency: two overlapping ticks can never claim the
//                  same row (Success Criterion 4, RESEARCH Pitfall 3).
//
//   expireSweep(now) — fail-closed TTL. Any pre-execution row past `expires_at`
//                  flips to `expired` (D-11, Pitfall 4); claimNext already
//                  excludes past-expiry rows so an expired row is never claimed.
//
//   reaperSweep(now, timeoutMs) — independent stale-claim rescue. A `claimed`
//                  row whose `claimed_at` predates `now - timeoutMs` is released
//                  back to `approved` (legal reaper edge in state.ts), rescuing a
//                  dead executor's orphaned claim (D-14, Pitfall 4). The window
//                  defaults to NODEMON_CLAIMED_TIMEOUT_MS (config placeholder).
//
// `now` is INJECTED into the sweeps (mirrors isStale(now=…)) so the TTL/reaper
// tests drive the clock deterministically without `sleep` (§Observability).
// Each transition is `UPDATE … WHERE id=? AND state=<expected>` PLUS a
// command_audit INSERT inside ONE dbNodemon.transaction() (lost-update guard).

import { and, eq, gt, inArray, lt, sql } from "drizzle-orm";

/** States the TTL sweep fail-closes to `expired` (pre-execution, non-terminal). */
const EXPIRABLE_STATES = ["pending_approval", "approved", "claimed"] as const;

/**
 * Reaper-window fallback (ms). SINGLE-SOURCED with the node-side bash tick
 * (scripts/node/check-queue): both read `NODEMON_CLAIMED_TIMEOUT_MS` and fall
 * back to this SAME 15-minute value (Q4). The prior 5-min TS default diverged
 * from the bash 15-min literal, opening a 5–15 min re-claim/double-apply window
 * if both reapers ran; keeping one env var + one fallback closes it. Must exceed
 * the max claim→execute latency.
 */
export const DEFAULT_CLAIMED_TIMEOUT_MS = 900_000; // 15 min — matches check-queue

/** Resolve the reaper window from NODEMON_CLAIMED_TIMEOUT_MS, else the shared default. */
export function defaultClaimedTimeoutMs(): number {
  const raw = process.env.NODEMON_CLAIMED_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLAIMED_TIMEOUT_MS;
}

/**
 * Atomic single-row claim — the no-double-apply guarantee (QUEUE-04). In ONE
 * transaction: SELECT the oldest `approved` row not past `expires_at` with
 * FOR UPDATE SKIP LOCKED, flip it to `claimed` (set claimed_at), write the
 * approved→claimed audit row (actor 'executor'). Returns `{ id }` or `null`.
 *
 * Two overlapping ticks: the row lock makes the loser SKIP the locked row and
 * fall through to `null` — exactly one claim ever succeeds.
 */
export async function claimNext(): Promise<{ id: string } | null> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

  return dbNodemon.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: commands.id })
      .from(commands)
      .where(and(eq(commands.state, "approved"), gt(commands.expiresAt, sql`now()`)))
      .orderBy(commands.createdAt)
      .limit(1)
      .for("update", { skipLocked: true }); // ← SELECT … FOR UPDATE SKIP LOCKED

    if (!row) return null;

    await tx
      .update(commands)
      .set({ state: "claimed", claimedAt: sql`now()` })
      .where(and(eq(commands.id, row.id), eq(commands.state, "approved")));

    await tx.insert(commandAudit).values({
      commandId: row.id,
      fromState: "approved",
      toState: "claimed",
      actor: "executor",
    });

    return { id: row.id };
  });
}

/**
 * Fail-closed TTL sweep (D-11). Every pre-execution row whose `expires_at` is
 * strictly before `now` flips to `expired` (+ an audit row per transition). An
 * expired row is never returned by claimNext (it filters `expires_at > now()`),
 * so expiry is fail-closed. `now` is injectable for deterministic tests.
 * Returns the number of rows expired.
 */
export async function expireSweep(now: Date = new Date()): Promise<number> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

  return dbNodemon.transaction(async (tx) => {
    // Select the victims first (with their current state) so each audit row
    // records the true from-state, then flip them in one guarded UPDATE.
    const victims = await tx
      .select({ id: commands.id, state: commands.state })
      .from(commands)
      .where(
        and(lt(commands.expiresAt, now), inArray(commands.state, [...EXPIRABLE_STATES])),
      );

    if (victims.length === 0) return 0;

    const ids = victims.map((v) => v.id);
    await tx
      .update(commands)
      .set({ state: "expired" })
      .where(and(inArray(commands.id, ids), inArray(commands.state, [...EXPIRABLE_STATES])));

    await tx.insert(commandAudit).values(
      victims.map((v) => ({
        commandId: v.id,
        fromState: v.state,
        toState: "expired" as const,
        actor: "executor",
        reason: "ttl_expired",
      })),
    );

    return victims.length;
  });
}

/**
 * Stale-claim reaper (D-14). Independent of the TTL sweep: any `claimed` row
 * whose `claimed_at` predates `now - claimedTimeoutMs` is RELEASED back to
 * `approved` (the legal reaper-release edge in state.ts) so a fresh executor can
 * re-claim it — rescuing a dead executor's orphaned claim. `now` and the window
 * are injectable; the window defaults to NODEMON_CLAIMED_TIMEOUT_MS. Returns the
 * number of rows released.
 */
export async function reaperSweep(
  now: Date = new Date(),
  claimedTimeoutMs: number = defaultClaimedTimeoutMs(),
): Promise<number> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

  // Cutoff is a real Date — parameter-bound by Drizzle, never string-concatenated.
  const cutoff = new Date(now.getTime() - claimedTimeoutMs);

  return dbNodemon.transaction(async (tx) => {
    const victims = await tx
      .select({ id: commands.id })
      .from(commands)
      .where(and(eq(commands.state, "claimed"), lt(commands.claimedAt, cutoff)));

    if (victims.length === 0) return 0;

    const ids = victims.map((v) => v.id);
    await tx
      .update(commands)
      .set({ state: "approved", claimedAt: null })
      .where(and(inArray(commands.id, ids), eq(commands.state, "claimed")));

    await tx.insert(commandAudit).values(
      victims.map((v) => ({
        commandId: v.id,
        fromState: "claimed",
        toState: "approved" as const,
        actor: "executor",
        reason: "reaper_released_stale_claim",
        staleAcknowledged: true,
      })),
    );

    return victims.length;
  });
}
