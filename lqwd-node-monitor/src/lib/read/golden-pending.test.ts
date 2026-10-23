import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { currentPendingChannels } from "@/lib/read/pending";
import { PENDING_RECENCY_HOURS } from "@/lib/console/config";

// dbRouting is loaded lazily (only when HAS_DB) so this suite imports cleanly —
// and skips via skipIf — without ROUTING_VM_DATABASE_URL (the warehouse client
// constructs a postgres() pool + requires env at module load).
async function routing() {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  return dbRouting;
}

// =====================================================
// PENDING-01 GOLDEN cross-consistency invariants (live)
// =====================================================
// The pending tables retain months of resolved residue; "currently pending"
// means the recency-filtered read in src/lib/read/pending.ts. This suite
// proves the filter reproduces the INDEPENDENT lnd_node_info snapshot, for
// every node with nonzero pending state:
//
//   1. COUNT of currently-pending PENDING_OPEN rows ≈ pending_channels
//      (verified exact at probe time: Indonesia 12 == 12; assumption A4 —
//      pending_channels may count opens only, so tolerance, not equality)
//   2. SUM(limbo_balance) over currently-pending FORCE_CLOSE + WAITING_CLOSE
//      rows ≈ total_limbo_balance (verified EXACT on 9 nodes at probe time,
//      incl. Brazil 70,621,359 + 16,570,308 == 87,191,667)
//
// Assertions are the INVARIANT, not frozen literals — snapshot ticks differ
// by minutes, so the golden.test.ts tolerance precedent applies:
// tol = Math.max(3, ceil(expected * 0.03)).
//
// Skips cleanly when ROUTING_VM_DATABASE_URL is absent (no warehouse network).

const HAS_DB = !!process.env.ROUTING_VM_DATABASE_URL;

interface NodeSnapshot {
  pubkey: string;
  alias: string | null;
  pendingChannels: number;
  totalLimboBalance: number;
}

interface Measured extends NodeSnapshot {
  currentOpens: number;
  currentLimboSum: number;
}

function tol(expected: number): number {
  return Math.max(3, Math.ceil(Math.abs(expected) * 0.03));
}

describe.skipIf(!HAS_DB)("PENDING-01 golden invariants (live)", () => {
  const measured: Measured[] = [];

  beforeAll(async () => {
    const db = await routing();

    // Independent snapshot: latest lnd_node_info per node (AFM-001 DISTINCT ON).
    const snapshots = (await db.execute(sql`
      SELECT DISTINCT ON (pubkey) pubkey, alias, pending_channels, total_limbo_balance
      FROM lnd_node_info
      WHERE pubkey IS NOT NULL
      ORDER BY pubkey, timestamp DESC
    `)) as unknown as Array<{
      pubkey: string;
      alias: string | null;
      pending_channels: number | string | null;
      total_limbo_balance: number | string | null;
    }>;

    // The sanctioned currently-pending read (fleet-wide).
    const rows = await currentPendingChannels(PENDING_RECENCY_HOURS);

    const byNode = new Map<string, { opens: number; limbo: number }>();
    for (const r of rows) {
      const pk = r["local_pubkey"] as string | null;
      if (!pk) continue;
      const acc = byNode.get(pk) ?? { opens: 0, limbo: 0 };
      const state = r["channel_state"] as string | null;
      if (state === "PENDING_OPEN") acc.opens += 1;
      if (state === "FORCE_CLOSE" || state === "WAITING_CLOSE") {
        acc.limbo += Number(r["limbo_balance"] ?? 0);
      }
      byNode.set(pk, acc);
    }

    for (const s of snapshots) {
      const pendingChannels = Number(s.pending_channels ?? 0);
      const totalLimboBalance = Number(s.total_limbo_balance ?? 0);
      const m = byNode.get(s.pubkey);
      // Only nodes with nonzero pending on EITHER side participate (0 ≈ 0 is
      // trivially true and would drown the signal in quiet nodes).
      if (pendingChannels === 0 && totalLimboBalance === 0 && !m) continue;
      measured.push({
        pubkey: s.pubkey,
        alias: s.alias,
        pendingChannels,
        totalLimboBalance,
        currentOpens: m?.opens ?? 0,
        currentLimboSum: m?.limbo ?? 0,
      });
    }

    // Surface the measured numbers for the operator checkpoint.
    for (const n of measured) {
      console.log(
        `[golden] ${n.alias ?? n.pubkey.slice(0, 12)}: opens=${n.currentOpens} vs ` +
          `pending_channels=${n.pendingChannels} | limboSum=${n.currentLimboSum} vs ` +
          `total_limbo_balance=${n.totalLimboBalance}`,
      );
    }
  });

  // IN-07: a fleet-wide zero-pending day is a legitimate, healthy condition —
  // the per-node invariants hold vacuously. Skip with a notice instead of
  // failing the live gate; the invariants below stay the real assertions.
  function skipIfQuietFleet(ctx: { skip: () => void }): void {
    if (measured.length === 0) {
      console.warn(
        "[golden] fleet has zero pending channels right now — invariants hold vacuously; skipping",
      );
      ctx.skip();
    }
  }

  it("currently-pending PENDING_OPEN count ≈ lnd_node_info.pending_channels per node", (ctx) => {
    skipIfQuietFleet(ctx);
    for (const n of measured) {
      expect(
        Math.abs(n.currentOpens - n.pendingChannels),
        `${n.alias ?? n.pubkey}: opens ${n.currentOpens} vs pending_channels ${n.pendingChannels}`,
      ).toBeLessThanOrEqual(tol(n.pendingChannels));
    }
  });

  it("currently-pending Σ limbo_balance (FORCE_CLOSE + WAITING_CLOSE) ≈ total_limbo_balance per node", (ctx) => {
    skipIfQuietFleet(ctx);
    for (const n of measured) {
      expect(
        Math.abs(n.currentLimboSum - n.totalLimboBalance),
        `${n.alias ?? n.pubkey}: limboSum ${n.currentLimboSum} vs total_limbo_balance ${n.totalLimboBalance}`,
      ).toBeLessThanOrEqual(tol(n.totalLimboBalance));
    }
  });
});
