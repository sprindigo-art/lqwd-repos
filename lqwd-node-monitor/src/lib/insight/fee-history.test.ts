import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildFeeHistorySql, lastPolicyChange } from "@/lib/insight/fee-history";

// Fee-policy HISTORY shape + pure-scan tests (NO DB) — INSIGHT-06 hysteresis
// data source. The critical distinction under test (Pitfall 1): this is a
// windowed per-channel SERIES scan over event-driven `lnd_node_channel_info`,
// NEVER a latest-state read — so the SQL must carry a window bound and must
// NOT carry DISTINCT ON (current policy belongs exclusively to the sanctioned
// AFM-001 reader in src/lib/read/latest.ts).

const dialect = new PgDialect();

function render(built: ReturnType<typeof buildFeeHistorySql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

const ts = (iso: string) => new Date(iso);

describe("buildFeeHistorySql shape", () => {
  it("targets lnd_node_channel_info with the hysteresis series columns", () => {
    const { sql } = render(buildFeeHistorySql(48));
    expect(sql).toContain("lnd_node_channel_info");
    expect(sql).toContain("chan_id");
    expect(sql).toContain("local_pubkey");
    expect(sql).toContain("outgoing_fee_rate_milli_msat");
  });

  it("is windowed via make_interval with the hours BOUND as a param (T-04-18 SQLi)", () => {
    const { sql, params } = render(buildFeeHistorySql(48));
    expect(sql).toContain("make_interval");
    expect(params).toContain(48);
    expect(sql).not.toContain("48");
  });

  it("compares against now() AT TIME ZONE 'UTC' — offset-less UTC column boundary (WR-04)", () => {
    const { sql } = render(buildFeeHistorySql(48));
    expect(sql).toContain("(now() at time zone 'utc') - make_interval");
    expect(sql).not.toContain("> now() -");
  });

  it("orders by chan_id, timestamp ASC — chronological per-channel series", () => {
    const { sql } = render(buildFeeHistorySql(48));
    expect(sql).toContain("order by");
    expect(sql).toContain("chan_id, timestamp asc");
  });

  it("does NOT contain DISTINCT ON — this is a history scan, not a latest read (Pitfall 1)", () => {
    const { sql } = render(buildFeeHistorySql(48));
    expect(sql).not.toContain("distinct on");
  });

  it("excludes NULL chan_id rows — keyless snapshots cannot join a per-channel series (WR-01)", () => {
    const { sql } = render(buildFeeHistorySql(48));
    expect(sql).toContain("chan_id is not null");
  });
});

describe("module banner — history-vs-latest distinction documented (Pitfall 1)", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/insight/fee-history.ts"), "utf8");

  it("banner contains the word 'history'", () => {
    expect(source.toLowerCase()).toContain("history");
  });

  it("banner references the sanctioned latest.ts reader for current policy", () => {
    expect(source).toContain("latest.ts");
  });
});

describe("lastPolicyChange", () => {
  it("returns null when no change is observed in the window ([100, 100, 100])", () => {
    const series = [
      { timestamp: ts("2026-06-11T00:00:00Z"), ppm: 100 },
      { timestamp: ts("2026-06-11T06:30:00Z"), ppm: 100 },
      { timestamp: ts("2026-06-11T13:00:00Z"), ppm: 100 },
    ];
    expect(lastPolicyChange(series)).toBeNull();
  });

  it("returns the change timestamp + direction up for [100, 100, 120]", () => {
    const third = ts("2026-06-11T13:00:00Z");
    const series = [
      { timestamp: ts("2026-06-11T00:00:00Z"), ppm: 100 },
      { timestamp: ts("2026-06-11T06:30:00Z"), ppm: 100 },
      { timestamp: third, ppm: 120 },
    ];
    expect(lastPolicyChange(series)).toEqual({ changedAt: third, direction: "up" });
  });

  it("returns direction down when the value drops", () => {
    const second = ts("2026-06-11T06:30:00Z");
    const series = [
      { timestamp: ts("2026-06-11T00:00:00Z"), ppm: 120 },
      { timestamp: second, ppm: 80 },
    ];
    expect(lastPolicyChange(series)).toEqual({ changedAt: second, direction: "down" });
  });

  it("returns the MOST RECENT change when several occur ([100, 120, 120, 90] → down at 4th)", () => {
    const fourth = ts("2026-06-11T19:30:00Z");
    const series = [
      { timestamp: ts("2026-06-11T00:00:00Z"), ppm: 100 },
      { timestamp: ts("2026-06-11T06:30:00Z"), ppm: 120 },
      { timestamp: ts("2026-06-11T13:00:00Z"), ppm: 120 },
      { timestamp: fourth, ppm: 90 },
    ];
    expect(lastPolicyChange(series)).toEqual({ changedAt: fourth, direction: "down" });
  });

  it("returns null for an empty series", () => {
    expect(lastPolicyChange([])).toBeNull();
  });

  it("returns null for a single-row series — one snapshot cannot show a change", () => {
    expect(lastPolicyChange([{ timestamp: ts("2026-06-11T00:00:00Z"), ppm: 100 }])).toBeNull();
  });
});
