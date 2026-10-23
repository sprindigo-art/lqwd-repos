import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { latestChannelsForNode } from "@/lib/read/latest";

// dbRouting is loaded lazily (only when HAS_DB) so this suite imports cleanly —
// and skips via skipIf — without ROUTING_VM_DATABASE_URL (the warehouse client
// constructs a postgres() pool + requires env at module load).
async function routing() {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  return dbRouting;
}

// =====================================================
// GOLDEN cross-consistency invariant (READ-02 AC, D-04/D-05/D-06)
// =====================================================
// Live test across the reference node SET — Canada (anchor) + a Tier-M 16GB node
// (Sweden) + an edge node (India). For each node it asserts the AFM-001
// DISTINCT ON (chan_id) latest-state count of ACTIVE, NOT-closed channels is
// within tolerance of lnd_node_info.active_channels (a TRUE snapshot). This is
// the documented Canada sanity check (COUNT(*) FILTER (WHERE active AND NOT
// closed) ≈ active_channels) generalized across the set.
//
// The assertion is the INVARIANT, not a frozen literal — it survives live drift
// between the event-driven channel log and the periodic snapshot, and an
// offline/zero-activity edge node passes 0 ≈ 0.
//
// Skips cleanly when ROUTING_VM_DATABASE_URL is absent (no warehouse network).

const HAS_DB = !!process.env.ROUTING_VM_DATABASE_URL;

// D-04 reference set. Pubkeys are resolved live by alias at runtime (below);
// these are the documented fallbacks if the alias lookup returns nothing.
const REFERENCE_FALLBACK: Record<string, string> = {
  Canada: "0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1",
  Sweden: "032312e5e15e89211df36e473d76af60672e3efebfe42a9b2113acbb456050b502",
  India: "02b20c736785ce8e801d50ae0bb6f6daa534a992445b44f4b6255ebedebd84c037",
};

interface RefNode {
  name: string;
  pubkey: string;
  activeChannels: number;
  distinctActiveNotClosed: number;
}

/** Resolve a node's latest snapshot pubkey + active_channels by alias (live). */
async function resolveByAlias(name: string, like: string): Promise<{ pubkey: string; activeChannels: number } | null> {
  const db = await routing();
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (pubkey) pubkey, active_channels
    FROM lnd_node_info
    WHERE alias ILIKE ${like}
      AND alias NOT ILIKE ${"%breez%"}
      AND alias NOT ILIKE ${"%lspd%"}
      AND alias NOT ILIKE ${"%ldk%"}
    ORDER BY pubkey, timestamp DESC
    LIMIT 1
  `)) as unknown as Array<{ pubkey: string; active_channels: number }>;
  if (!rows.length) return null;
  return { pubkey: rows[0].pubkey, activeChannels: Number(rows[0].active_channels) };
}

/** Latest active_channels snapshot for an exact pubkey. */
async function latestActiveChannelsSnapshot(pubkey: string): Promise<number> {
  const db = await routing();
  const rows = (await db.execute(sql`
    SELECT active_channels
    FROM lnd_node_info
    WHERE pubkey = ${pubkey}
    ORDER BY timestamp DESC
    LIMIT 1
  `)) as unknown as Array<{ active_channels: number }>;
  return rows.length ? Number(rows[0].active_channels) : 0;
}

const SET: Array<{ name: string; like: string }> = [
  { name: "Canada", like: "%canada%" },
  { name: "Sweden", like: "%sweden%" },
  { name: "India", like: "%india%" },
];

describe.skipIf(!HAS_DB)("READ-02 golden cross-consistency invariant (live)", () => {
  const resolved: RefNode[] = [];

  beforeAll(async () => {
    for (const { name, like } of SET) {
      const byAlias = await resolveByAlias(name, like);
      const pubkey = byAlias?.pubkey ?? REFERENCE_FALLBACK[name];
      const activeChannels = byAlias?.activeChannels ?? (await latestActiveChannelsSnapshot(pubkey));

      // AFM-001 helper: latest state per chan_id, filtered to active + not closed
      // (the canonical cross-validation target for active_channels).
      const rows = await latestChannelsForNode(pubkey);
      const distinctActiveNotClosed = rows.filter(
        (r) => r["active"] === true && r["closed"] !== true,
      ).length;

      resolved.push({ name, pubkey, activeChannels, distinctActiveNotClosed });
    }
    // Surface the measured numbers for the operator checkpoint.
    for (const n of resolved) {
      const diff = Math.abs(n.distinctActiveNotClosed - n.activeChannels);
      const tol = Math.max(3, Math.ceil(n.activeChannels * 0.03));

      console.log(
        `[golden] ${n.name} (${n.pubkey.slice(0, 12)}…): DISTINCT ON active=${n.distinctActiveNotClosed} ` +
          `vs lnd_node_info.active_channels=${n.activeChannels} | diff=${diff} tol=${tol}`,
      );
    }
  });

  it("Canada (anchor) DISTINCT ON channel count ≈ active_channels", () => {
    const n = resolved.find((r) => r.name === "Canada")!;
    const tol = Math.max(3, Math.ceil(n.activeChannels * 0.03));
    expect(Math.abs(n.distinctActiveNotClosed - n.activeChannels)).toBeLessThanOrEqual(tol);
    // Anchor must be a real fleet node (hundreds of channels), proving the helper
    // did NOT collapse to ~1 (the MAX(timestamp) failure).
    expect(n.distinctActiveNotClosed).toBeGreaterThan(50);
  });

  it("Tier-M (Sweden) holds the invariant", () => {
    const n = resolved.find((r) => r.name === "Sweden")!;
    const tol = Math.max(3, Math.ceil(n.activeChannels * 0.03));
    expect(Math.abs(n.distinctActiveNotClosed - n.activeChannels)).toBeLessThanOrEqual(tol);
  });

  it("edge node (India) holds the invariant (tolerates offline 0 ≈ 0)", () => {
    const n = resolved.find((r) => r.name === "India")!;
    const tol = Math.max(3, Math.ceil(n.activeChannels * 0.03));
    expect(Math.abs(n.distinctActiveNotClosed - n.activeChannels)).toBeLessThanOrEqual(tol);
  });
});
