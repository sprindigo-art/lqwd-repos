import { describe, it, expect, beforeAll } from "vitest";
import { sql } from "drizzle-orm";
import { latestNodeInfoAll, type LatestNodeInfoRow } from "@/lib/read/node-info";
import { routingForFleet } from "@/lib/scorecard/dimensions/routing";
import { revenueForFleet } from "@/lib/scorecard/dimensions/revenue";
import { liquidityForFleet } from "@/lib/scorecard/dimensions/liquidity";
import { channelHealthFromNodeInfo } from "@/lib/scorecard/dimensions/channel-health";
import { forceCloseForFleet } from "@/lib/scorecard/dimensions/force-close";
import { loadFleetView } from "@/lib/scorecard/fleet";
import {
  NO_DATA_DIMENSIONS,
  type DimensionResult,
  type FleetView,
} from "@/lib/scorecard/types";

// =====================================================
// D-14 — Canada reference-node golden validation (live, skipIf no DB)
// =====================================================
// THE PHASE GATE (ROADMAP success criterion 4): Canada's computed scorecard
// numbers must validate against live lqwdLogs reference invariants BEFORE any
// downstream consumer acts on them. Scaffold copied from the Phase 1 golden
// (src/lib/read/golden.test.ts): describe.skipIf(!HAS_DB), lazy routing(),
// alias resolution with breez/lspd/ldk exclusions, documented fallback pubkey,
// the Phase 1 ±3% channel tolerance, and [golden] operator-checkpoint lines.
//
// Assertions are INVARIANT RANGES, never frozen literals — the warehouse
// drifts. The RESEARCH §Reference-Node Validation snapshot (2026-06-09:
// 7,023 forwards/7d; 208,389.7 sat 7d earnings; 631.7 PPM; ~0.76 outbound;
// ~26% rebalance; LOCAL 803 / COOP 1,499 closes) is the human-readable
// checkpoint printed next to the computed values, not a hardcoded equality.

const HAS_DB = !!process.env.ROUTING_VM_DATABASE_URL;

/** Documented Canada anchor fallback if the live alias lookup returns nothing. */
const CANADA_FALLBACK_PUBKEY =
  "0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907e1";

// dbRouting is loaded lazily (only when HAS_DB) so this suite imports cleanly —
// and skips via skipIf — without ROUTING_VM_DATABASE_URL (the warehouse client
// constructs a postgres() pool + requires env at module load).
async function routing() {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  return dbRouting;
}

/** Resolve Canada's latest snapshot pubkey + active_channels by alias (live). */
async function resolveCanada(): Promise<{ pubkey: string; activeChannels: number } | null> {
  const db = await routing();
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (pubkey) pubkey, active_channels
    FROM lnd_node_info
    WHERE alias ILIKE ${"%canada%"}
      AND alias NOT ILIKE ${"%breez%"}
      AND alias NOT ILIKE ${"%lspd%"}
      AND alias NOT ILIKE ${"%ldk%"}
    ORDER BY pubkey, timestamp DESC
    LIMIT 1
  `)) as unknown as Array<{ pubkey: string; active_channels: number }>;
  if (!rows.length) return null;
  return { pubkey: rows[0].pubkey, activeChannels: Number(rows[0].active_channels) };
}

const LIVE_TIMEOUT = 180_000; // fleet-wide aggregates over event tables — be generous

describe.skipIf(!HAS_DB)("D-14 Canada golden — scorecard reference validation (live)", () => {
  let canadaPubkey: string;
  let canadaActiveChannelsSnapshot: number;
  let infoRows: LatestNodeInfoRow[];
  let routingDim: DimensionResult | undefined;
  let revenueDim: DimensionResult | undefined;
  let liquidityDim: DimensionResult | undefined;
  let channelHealthDim: DimensionResult | undefined;
  let forceCloseDim: DimensionResult | undefined;
  let feeMsat7dDirect: number; // AFM-002 back-conversion numerator (raw msat)
  let fleet: FleetView;

  beforeAll(async () => {
    const byAlias = await resolveCanada();
    canadaPubkey = byAlias?.pubkey ?? CANADA_FALLBACK_PUBKEY;
    canadaActiveChannelsSnapshot = byAlias?.activeChannels ?? 0;

    // Fetch dimension maps + the AFM-002 back-conversion query close together
    // so live drift between reads stays inside the ±1% tolerance.
    const db = await routing();
    const [info, routingMap, revenueMap, liquidityMap, forceCloseMap, feeRows] =
      await Promise.all([
        latestNodeInfoAll(),
        routingForFleet(),
        revenueForFleet(),
        liquidityForFleet(),
        forceCloseForFleet(),
        db.execute(sql`
          SELECT SUM(fee_msat) AS fee_msat_7d
          FROM lnd_node_forwards
          WHERE lnd_pubkey = ${canadaPubkey}
            AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - 7 * 86400) * 1e9
        `) as unknown as Promise<Array<{ fee_msat_7d: string | number | null }>>,
      ]);
    infoRows = info;
    routingDim = routingMap.get(canadaPubkey);
    revenueDim = revenueMap.get(canadaPubkey);
    liquidityDim = liquidityMap.get(canadaPubkey);
    channelHealthDim = channelHealthFromNodeInfo(info).get(canadaPubkey);
    forceCloseDim = forceCloseMap.get(canadaPubkey);
    feeMsat7dDirect = Number(feeRows[0]?.fee_msat_7d ?? 0);

    // The full pipeline under test — the single server call the pages render.
    fleet = await loadFleetView();

    // Operator checkpoint: computed values next to the RESEARCH 2026-06-09
    // reference snapshot (sanity ranges, NOT assertions).
    console.log(
      `[golden] Canada routing: forwards7d=${routingDim?.raw} volumeSat=${routingDim?.extras?.volumeSat} (ref 2026-06-09: 7,023 fwd / 739,079,154 sat)`,
    );
    console.log(
      `[golden] Canada revenue: ppm24h=${revenueDim?.raw} earnings7dSat=${revenueDim?.extras?.earnings7dSat} (ref: 631.7 PPM / 208,389.7 sat)`,
    );
    console.log(
      `[golden] Canada liquidity: outboundRatio=${liquidityDim?.raw} capacitySat=${liquidityDim?.extras?.capacitySat} rebalanceSuccessRate=${liquidityDim?.extras?.rebalanceSuccessRate} (ref: ~0.76 / 3.027B sat / ~0.26)`,
    );
    console.log(
      `[golden] Canada channelHealth: activeChannels=${channelHealthDim?.extras?.activeChannels} vs snapshot=${canadaActiveChannelsSnapshot} inactiveRatio=${channelHealthDim?.raw} (ref: 487 active)`,
    );
    console.log(
      `[golden] Canada forceClose: localFc30d=${forceCloseDim?.raw} coopRemoteShare=${forceCloseDim?.extras?.coopRemoteShare} maxHourlySelfCloses=${forceCloseDim?.extras?.maxHourlySelfCloses} (ref all-time: LOCAL 803 / COOP 1,499)`,
    );
    const canadaView = fleet.nodes.find((n) => n.pubkey === canadaPubkey);
    console.log(
      `[golden] Canada pipeline: composite=${canadaView?.compositePct} (${canadaView?.compositeLetter}) dot=${canadaView?.dot} stale=${canadaView?.stale} asOf=${canadaView?.asOf?.toISOString()} fleetSize=${fleet.nodes.length}`,
    );
  }, LIVE_TIMEOUT);

  it("latestNodeInfoAll returns exactly one row per pubkey across the fleet (>20 nodes)", () => {
    // Proves the append-only trap (RESEARCH Pitfall 1) is closed: 8M rows in,
    // one latest row per node out.
    const pubkeys = infoRows.map((r) => r.pubkey);
    expect(infoRows.length).toBe(new Set(pubkeys).size);
    expect(infoRows.length).toBeGreaterThan(20); // fleet ≈ 26
  });

  it("routing: Canada forwards 7d > 0 with positive outbound volume", () => {
    expect(routingDim).toBeDefined();
    expect(routingDim!.raw).toBeGreaterThan(0); // ref 7,023 forwards/7d
    expect(routingDim!.extras?.volumeSat).toBeGreaterThan(0);
  });

  it("revenue: Canada 24h fee-PPM is a plausible PPM in (0, 100000)", () => {
    // Proves fee_msat numerator + amt_in_msat denominator (ref 631.7 PPM) —
    // the raw `fee` column would be 1000x off; a sat/msat mixup would be 1e6 off.
    expect(revenueDim).toBeDefined();
    expect(revenueDim!.raw).toBeGreaterThan(0);
    expect(revenueDim!.raw).toBeLessThan(100_000);
    expect(revenueDim!.extras?.earnings7dSat).toBeGreaterThan(0); // ref 208,389.7 sat
  });

  it("AFM-002 back-conversion: extras.earnings7dSat ≈ SUM(fee_msat)/1000 within ±1%", () => {
    const expectedSat = feeMsat7dDirect / 1000;
    expect(expectedSat).toBeGreaterThan(0);
    const earnings = revenueDim!.extras!.earnings7dSat;
    expect(Math.abs(earnings - expectedSat)).toBeLessThanOrEqual(expectedSat * 0.01);
  });

  it("liquidity: Canada outbound ratio in [0,1] with capacity > 1e9 sat", () => {
    expect(liquidityDim).toBeDefined();
    expect(liquidityDim!.raw).toBeGreaterThanOrEqual(0); // ref ≈0.76
    expect(liquidityDim!.raw).toBeLessThanOrEqual(1);
    expect(liquidityDim!.extras?.capacitySat).toBeGreaterThan(1e9); // ref 3.027B
  });

  it("channelHealth: Canada activeChannels within the Phase-1 ±3% tolerance of the snapshot", () => {
    expect(channelHealthDim).toBeDefined();
    const active = channelHealthDim!.extras!.activeChannels;
    // Exact Phase 1 tolerance formula (golden.test.ts): max(3, ceil(x * 0.03)).
    const tol = Math.max(3, Math.ceil(canadaActiveChannelsSnapshot * 0.03));
    expect(Math.abs(active - canadaActiveChannelsSnapshot)).toBeLessThanOrEqual(tol);
    expect(active).toBeGreaterThan(50); // anchor is a real fleet node, ref 487
  });

  it("forceClose: coopRemoteShare in [0,1], window count ≥ 0, non-degenerate close mix", () => {
    expect(forceCloseDim).toBeDefined();
    expect(forceCloseDim!.raw).toBeGreaterThanOrEqual(0);
    // Canada has 1,499 all-time coop closes (ref) — the share must be present
    // and a real ratio, proving the close_type/close_initiator filters return
    // non-degenerate data rather than all-NULL.
    const share = forceCloseDim!.extras?.coopRemoteShare;
    expect(share).toBeDefined();
    expect(share!).toBeGreaterThanOrEqual(0);
    expect(share!).toBeLessThanOrEqual(1);
    expect(forceCloseDim!.extras?.maxHourlySelfCloses).toBeGreaterThanOrEqual(0);
  });

  it("rebalance success rate (when present) is a ratio in [0,1]", () => {
    const rate = liquidityDim?.extras?.rebalanceSuccessRate;
    if (rate !== undefined) {
      expect(rate).toBeGreaterThanOrEqual(0); // ref ≈0.26
      expect(rate).toBeLessThanOrEqual(1);
    }
  });

  it("full pipeline: loadFleetView yields a valid graded Canada view (10 dims, 3 nodata)", () => {
    const canada = fleet.nodes.find((n) => n.pubkey === canadaPubkey);
    expect(canada).toBeDefined();
    expect(canada!.dimensions).toHaveLength(10);
    // Canada is the live anchor: all 7 computable dims have data, so EXACTLY
    // the 3 structural no-data dims (stability/pgHealth/visibility) are grey.
    const noData = canada!.dimensions.filter((d) => d.color === "nodata");
    expect(noData).toHaveLength(3);
    expect(noData.map((d) => d.key).sort()).toEqual([...NO_DATA_DIMENSIONS].sort());
    expect(canada!.compositePct).toBeGreaterThan(0);
    expect(canada!.compositePct).toBeLessThanOrEqual(100);
    expect(["ok", "warn", "critical"]).toContain(canada!.dot);
    expect(canada!.asOf).not.toBeNull();
  });

  it("full pipeline: D-09 order holds — every critical node indexes before every non-critical", () => {
    const dots = fleet.nodes.map((n) => n.dot);
    const firstNonCritical = dots.findIndex((d) => d !== "critical");
    if (firstNonCritical !== -1) {
      expect(dots.slice(firstNonCritical).every((d) => d !== "critical")).toBe(true);
    }
    expect(fleet.nodes.length).toBeGreaterThan(20); // whole fleet assembled
    expect(fleet.fetchedAt).toBeInstanceOf(Date);
  });
});
