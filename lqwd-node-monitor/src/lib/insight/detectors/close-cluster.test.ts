import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildClusterSql,
  detectCloseCluster,
  type ClusterRow,
} from "@/lib/insight/detectors/close-cluster";
import { INSIGHT_CONFIG } from "@/lib/insight/config";
import { FLEET_PENDING_LINK } from "@/lib/insight/deeplink";
import { InsightCardSchema } from "@/lib/insight/schema";

// D-10 fleet temporal close-cluster tests (NO DB). Two halves:
//  - SQL shape (PgDialect render): INITIATOR_LOCAL hour-bucket aggregate over
//    lnd_node_closed_channels, local_pubkey identity, bound window param.
//  - Pure detection on incident-shaped golden fixtures: 2024-09-09 fleet
//    cascade (3 nodes → critical), 2025-07-16 post-migration reciprocation
//    (2 qualifying nodes → warn), single-node noise (AP-11's job, not D-10's),
//    and the documented bucket-boundary-straddle v1 limitation (Pitfall 8).

const CFG = INSIGHT_CONFIG.lnd;

const dialect = new PgDialect();

function render(built: ReturnType<typeof buildClusterSql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

/** 66-lowercase-hex pubkeys for fixture nodes. */
const FRANCE = "aa".repeat(33);
const INDIA = "bb".repeat(33);
const SWEDEN = "cc".repeat(33);
const CANADA = "dd".repeat(33);
const AUSTRALIA = "ee".repeat(33);
const BRAZIL = "ff".repeat(33);

function row(bucket_hour: string, local_pubkey: string, close_count: number): ClusterRow {
  return { bucket_hour, local_pubkey, close_count };
}

describe("buildClusterSql shape", () => {
  it("filters self-initiated closes via the fixed INITIATOR_LOCAL enum literal", () => {
    const { sql } = render(buildClusterSql(24));
    expect(sql).toContain("'initiator_local'");
  });

  it("hour-buckets via date_trunc and groups per (bucket, node) on the local_pubkey identity column", () => {
    const { sql } = render(buildClusterSql(24));
    expect(sql).toContain("date_trunc('hour'");
    expect(sql).toContain("local_pubkey");
    expect(sql).toContain("group by date_trunc('hour'");
  });

  it("windows via make_interval with a BOUND parameter — never an interpolated number", () => {
    const { sql, params } = render(buildClusterSql(36));
    expect(sql).toContain("make_interval");
    expect(sql).toContain("$1");
    expect(params).toEqual([36]);
    expect(sql).not.toContain("36");
  });

  it("never pins the AFM-001 failure shape WHERE timestamp =", () => {
    const { sql } = render(buildClusterSql(24));
    expect(sql).not.toContain("where timestamp =");
  });
});

describe("detectCloseCluster (D-10) — incident golden fixtures", () => {
  it("2024-09-09 cascade: France + India + Sweden same hour → exactly 1 critical fleet card listing all 3", () => {
    // France 93 self-initiated in one hour (213 that day); India and Sweden
    // cascading in the same bucket — the ≥3-node fleet-wide signature.
    const rows = [
      row("2024-09-09 14:00:00", FRANCE, 93),
      row("2024-09-09 14:00:00", INDIA, 40),
      row("2024-09-09 14:00:00", SWEDEN, 25),
    ];
    const cards = detectCloseCluster(rows, CFG);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.severity).toBe("critical");
    expect(card.signal).toBe("fleet_close_cluster");
    expect(card.node).toBeNull();
    expect(card.target.kind).toBe("fleet");
    if (card.target.kind === "fleet") {
      expect(card.target.pubkeys).toHaveLength(3);
      expect(card.target.pubkeys).toEqual([...card.target.pubkeys].sort());
      expect(new Set(card.target.pubkeys)).toEqual(new Set([FRANCE, INDIA, SWEDEN]));
    }
    expect(card.suggestedAction).toEqual({ type: "investigate", params: {} });
    expect(card.evidence.metric).toBe("sameHourSelfCloseNodes");
    expect(card.evidence.observed).toBe(3);
    expect(card.evidence.threshold).toBe(CFG.clusterMinNodesCritical);
    expect(card.evidence.unit).toBe("nodes");
    expect(card.evidence.window).toBe(`${CFG.clusterScanWindowHours}h`);
    expect(card.evidence.deepLink).toBe(FLEET_PENDING_LINK);
    // Per-node counts + the bucket hour land in detail.
    expect(card.evidence.detail?.[FRANCE]).toBe(93);
    expect(card.evidence.detail?.[INDIA]).toBe(40);
    expect(card.evidence.detail?.[SWEDEN]).toBe(25);
    expect(card.evidence.detail?.bucketHour).toBe("2024-09-09T14:00:00.000Z");
    // The bucket hour IS the event identity — it is baked into the dedupe id.
    expect(card.id).toContain("2024-09-09T14:00:00.000Z");
    expect(card.id.startsWith("fleet_close_cluster:fleet:")).toBe(true);
  });

  it("2025-07-16 reciprocation: Canada + Australia qualify, Brazil (4) below the per-node line → one card with exactly the 2 qualifying nodes", () => {
    const rows = [
      row("2025-07-16 09:00:00", CANADA, 101),
      row("2025-07-16 09:00:00", AUSTRALIA, 20),
      row("2025-07-16 09:00:00", BRAZIL, 4), // below clusterPerNodeMinCloses (5)
    ];
    const cards = detectCloseCluster(rows, CFG);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    // 2 nodes ≥ warn line (2), below critical line (3).
    expect(["warn", "critical"]).toContain(card.severity);
    expect(card.severity).toBe("warn");
    expect(card.node).toBeNull();
    if (card.target.kind === "fleet") {
      expect(new Set(card.target.pubkeys)).toEqual(new Set([CANADA, AUSTRALIA]));
    } else {
      expect.unreachable("expected a fleet target");
    }
    expect(card.evidence.observed).toBe(2);
    expect(card.evidence.threshold).toBe(CFG.clusterMinNodesWarn);
    expect(card.evidence.detail?.[BRAZIL]).toBeUndefined();
  });

  it("single-node noise: one node at 60 closes in an hour, no other node ≥5 → NO cluster card (that is AP-11's job)", () => {
    const rows = [
      row("2026-06-11 22:00:00", CANADA, 60),
      row("2026-06-11 22:00:00", BRAZIL, 2),
    ];
    expect(detectCloseCluster(rows, CFG)).toEqual([]);
  });

  it("boundary-straddle (accepted v1 behavior — Pitfall 8): a storm split :58–:02 across two buckets, each side <5 per node → no card", () => {
    // Two nodes each split a 6-close burst 3/3 across adjacent hour buckets:
    // date_trunc('hour') smears the event below the per-node line on both
    // sides. Documented v1 limitation — a sliding window is a v2 knob; the
    // module banner carries this caveat.
    const rows = [
      row("2026-06-11 21:00:00", FRANCE, 3),
      row("2026-06-11 22:00:00", FRANCE, 3),
      row("2026-06-11 21:00:00", INDIA, 3),
      row("2026-06-11 22:00:00", INDIA, 3),
    ];
    expect(detectCloseCluster(rows, CFG)).toEqual([]);
  });

  it("coerces string/bigint counts (raw-execute surface) and parses every card via InsightCardSchema", () => {
    const rows: ClusterRow[] = [
      { bucket_hour: "2026-06-11 10:00:00", local_pubkey: FRANCE, close_count: "12" },
      { bucket_hour: "2026-06-11 10:00:00", local_pubkey: INDIA, close_count: 9n },
      { bucket_hour: "2026-06-11 10:00:00", local_pubkey: SWEDEN, close_count: 7 },
    ];
    const cards = detectCloseCluster(rows, CFG);
    expect(cards).toHaveLength(1);
    expect(cards[0].severity).toBe("critical");
    for (const card of cards) {
      expect(() => InsightCardSchema.parse(card)).not.toThrow();
    }
  });

  it("fires one card PER qualifying bucket (two cascade hours → two cards, distinct ids)", () => {
    const rows = [
      row("2026-06-11 10:00:00", FRANCE, 8),
      row("2026-06-11 10:00:00", INDIA, 6),
      row("2026-06-11 11:00:00", FRANCE, 9),
      row("2026-06-11 11:00:00", INDIA, 7),
    ];
    const cards = detectCloseCluster(rows, CFG);
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.id)).size).toBe(2);
  });
});
