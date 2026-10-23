import "server-only";

// =====================================================
// NODE-04 — per-node approved-but-unclaimed update_fee reader (live withdraw wiring)
// =====================================================
// The 13-06 NodeChannelsTable composed the D-01 WithdrawAffordance but left its
// `approvedByChanId` prop unwired — an approved intent could never render Withdraw
// (the structural hole the operator gate re-catches). This is the missing READ: it
// maps THIS node's approved-but-unclaimed `update_fee` intents to a
// chanId → commandId map so the channels sub-route can feed `approvedByChanId` and
// the reused withdraw path becomes live.
//
// `state = 'approved'` IS the approved-but-unclaimed set by the queue state machine
// (claimNext flips it to 'claimed'); belt-and-suspenders we also require
// `claimed_at IS NULL`. Server-only read of the RW nodemon queue DB, scoped to the
// resolved node's pubkey (parameter-bound via drizzle `eq`, never concatenated —
// T-13-12-04). Fail-soft: ANY failure (DB down, schema drift) degrades to an EMPTY
// map `{}` so the channels page never hard-fails; an empty map is honest (no
// withdraw affordances shown). Mirrors the lazy-import queue-read pattern in
// chain-telemetry.ts / claim.ts (`const { dbNodemon } = await import(...)`).

/** Shape of the `params` jsonb we care about — the pre-targeted channel id. */
interface UpdateFeeParams {
  chanId?: unknown;
}

/**
 * Read THIS node's approved-but-unclaimed `update_fee` intents into a
 * `chanId → commandId` map. Rows are ordered `created_at` ASC so a duplicate
 * chanId resolves to the MOST RECENT intent (last write wins). Rows with a
 * null/absent `params.chanId` are skipped. Never throws — any error → `{}`.
 */
export async function approvedFeeIntentsByChanId(
  pubkey: string,
): Promise<Record<string, string>> {
  try {
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commands } = await import("@/lib/db/schema/nodemon");
    const { and, eq, isNull } = await import("drizzle-orm");

    const rows = await dbNodemon
      .select({ id: commands.id, params: commands.params, createdAt: commands.createdAt })
      .from(commands)
      .where(
        and(
          eq(commands.nodePubkey, pubkey),
          eq(commands.actionType, "update_fee"),
          eq(commands.state, "approved"),
          isNull(commands.claimedAt),
        ),
      )
      .orderBy(commands.createdAt);

    const map: Record<string, string> = {};
    for (const row of rows) {
      const chanIdRaw = (row.params as UpdateFeeParams | null)?.chanId;
      if (chanIdRaw == null) continue;
      const chanId = String(chanIdRaw);
      if (chanId === "") continue;
      // created_at ASC → the last assignment for a chanId is the most recent intent.
      map[chanId] = row.id;
    }
    return map;
  } catch (error) {
    console.error("approvedFeeIntentsByChanId read failed:", error);
    return {};
  }
}
