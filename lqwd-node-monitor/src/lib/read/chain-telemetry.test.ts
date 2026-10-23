import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildLatestChainTelemetrySql,
  deriveBlocksBehind,
  buildChainEvidence,
  getChainTelemetry,
  type LatestChainTelemetryRow,
  type ChainTelemetryView,
} from "@/lib/read/chain-telemetry";
import {
  seedTelemetryFixture,
  cleanupTelemetryFixture,
  type SeededTelemetry,
} from "@/lib/read/telemetry-fixture";

// =====================================================
// AFM-001 chain-telemetry helper-shape test (NO DB)
// =====================================================
const dialect = new PgDialect();

function render(hostId: string) {
  const built = dialect.sqlToQuery(buildLatestChainTelemetrySql(hostId));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("AFM-001 buildLatestChainTelemetrySql SQL shape", () => {
  it("emits DISTINCT ON (host_id)", () => {
    expect(render("host-1").sql).toContain("distinct on (host_id)");
  });

  it("orders by host_id, collected_at DESC", () => {
    expect(render("host-1").sql).toContain("order by host_id, collected_at desc");
  });

  it("never uses MAX(", () => {
    expect(render("host-1").sql).not.toContain("max(");
  });

  it("parameter-binds hostId ($1)", () => {
    const evil = "'; DROP TABLE chain_telemetry; --";
    const { sql, params } = render(evil);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });
});

describe("deriveBlocksBehind (read-time, D-14 — never a stored column)", () => {
  it("is headers - blocks when both present", () => {
    expect(deriveBlocksBehind(880_000n, 880_000n)).toBe(0);
    expect(deriveBlocksBehind(880_000n, 879_998n)).toBe(2);
  });

  it("is null when either side is missing", () => {
    expect(deriveBlocksBehind(null, 880_000n)).toBeNull();
    expect(deriveBlocksBehind(880_000n, null)).toBeNull();
  });
});

describe("buildChainEvidence (D-14 bands attached at read time)", () => {
  const synced: LatestChainTelemetryRow = {
    host_id: "h",
    collected_at: new Date(),
    blocks: 880_000n,
    headers: 880_000n,
    verification_progress: "0.99999",
    ibd: false,
    size_on_disk_bytes: 700_000_000_000n,
    peer_count: 12,
    peers_in: 6,
    peers_out: 6,
    mempool_tx_count: 1500,
    mempool_bytes: 12_000_000n,
    mempool_min_fee: "0.00001",
  };

  it("grades a fully-synced node healthy across blocks-behind / progress / peers", () => {
    const e = buildChainEvidence(synced);
    expect(e.blocksBehind).toBe(0);
    expect(e.bands.blocksBehind?.band).toBe("healthy");
    expect(e.bands.verificationProgress?.band).toBe("healthy");
    expect(e.bands.peers?.band).toBe("healthy");
    expect(e.bands.blocksBehind?.value).toBe(0);
  });

  it("grades a far-behind node critical on blocks-behind", () => {
    const behind = { ...synced, blocks: 879_980n }; // 20 behind → critical
    const e = buildChainEvidence(behind);
    expect(e.blocksBehind).toBe(20);
    expect(e.bands.blocksBehind?.band).toBe("critical");
  });

  it("grades a low-peer node on the peers band", () => {
    const lonely = { ...synced, peer_count: 2 }; // <3 → critical
    const e = buildChainEvidence(lonely);
    expect(e.bands.peers?.band).toBe("critical");
  });

  it("attaches no bands when there is no chain row (no-data)", () => {
    const e = buildChainEvidence(null);
    expect(e.blocksBehind).toBeNull();
    expect(e.bands.blocksBehind).toBeNull();
    expect(e.bands.verificationProgress).toBeNull();
    expect(e.bands.peers).toBeNull();
  });
});

// =====================================================
// Seeded (live nodemon DB) — skips cleanly with no NODEMON_QUEUE_URL
// =====================================================
const HAS_DB = !!process.env.NODEMON_QUEUE_URL;
const KEY = "chain-telemetry-test";

describe.skipIf(!HAS_DB)("getChainTelemetry (seeded)", () => {
  let seeded: SeededTelemetry;
  let views: ChainTelemetryView[];

  beforeAll(async () => {
    seeded = await seedTelemetryFixture(KEY);
    views = await getChainTelemetry();
  });

  afterAll(async () => {
    await cleanupTelemetryFixture(KEY);
  });

  function viewFor(hostId: string): ChainTelemetryView | undefined {
    return views.find((v) => v.hostId === hostId);
  }

  it("returns exactly one entry per declared host_id", () => {
    for (const hostId of seeded.allHostIds) {
      expect(views.filter((v) => v.hostId === hostId)).toHaveLength(1);
    }
  });

  it("derives blocks-behind at read time and grades it healthy on the fresh host", () => {
    const fresh = viewFor(seeded.freshHostId);
    expect(fresh?.blocksBehind).toBe(0);
    expect(fresh?.bands.blocksBehind?.band).toBe("healthy");
    expect(fresh?.stale).toBe(false);
  });

  it("derives blocks-behind on the stale host and reads stale (D-13)", () => {
    const stale = viewFor(seeded.staleHostId);
    expect(stale?.blocksBehind).toBe(2);
    expect(stale?.stale).toBe(true);
  });

  it("declared-but-never-reported host reads as no-data", () => {
    const silent = viewFor(seeded.neverReportedHostId);
    expect(silent?.hasData).toBe(false);
    expect(silent?.chain).toBeNull();
    expect(silent?.blocksBehind).toBeNull();
  });
});
