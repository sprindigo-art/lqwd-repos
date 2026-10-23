import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildRestartAllSql, hoursSince, toRestartDate } from "@/lib/scorecard/dimensions/restart";

// Restart dimension shape test (NO DB). Asserts the defensive DISTINCT ON
// (pubkey) latest-row form with last_restart DESC ordering and the NULL-key
// exclusion, and that the AFM-001 failure shape MAX( never appears.

const dialect = new PgDialect();

function render() {
  const q = dialect.sqlToQuery(buildRestartAllSql());
  return { sql: q.sql.toLowerCase(), params: q.params };
}

describe("buildRestartAllSql shape", () => {
  it("emits DISTINCT ON (pubkey) (defensive latest-per-node form)", () => {
    const { sql } = render();
    expect(sql).toContain("distinct on (pubkey)");
  });

  it("orders by pubkey, last_restart DESC", () => {
    const { sql } = render();
    expect(sql).toContain("order by pubkey, last_restart desc");
  });

  it("excludes NULL-key rows (DISTINCT ON NULL-collapse guard)", () => {
    const { sql } = render();
    expect(sql).toContain("pubkey is not null");
  });

  it("never uses MAX( (the AFM-001 failure mode)", () => {
    const { sql } = render();
    expect(sql).not.toContain("max(");
  });
});

describe("hoursSince formula", () => {
  const now = Date.UTC(2026, 5, 9, 12, 0, 0); // 2026-06-09T12:00:00Z

  it("returns hours since last_restart rounded to 1 decimal", () => {
    const thirtySixHoursAgo = new Date(now - 36 * 3_600_000);
    expect(hoursSince(thirtySixHoursAgo, now)).toBe(36);
    const ninetyMinAgo = new Date(now - 90 * 60_000);
    expect(hoursSince(ninetyMinAgo, now)).toBe(1.5);
    const sevenMinAgo = new Date(now - 7 * 60_000);
    expect(hoursSince(sevenMinAgo, now)).toBe(0.1);
  });

  it("returns null when last_restart is null (unknown, not zero)", () => {
    expect(hoursSince(null, now)).toBeNull();
  });
});

describe("toRestartDate driver-boundary coercion", () => {
  // postgres.js raw .execute surfaces last_restart as a STRING (verified live
  // in the D-14 golden run) — the mapper must coerce before .getTime().
  it("coerces an ISO/pg timestamp string to a Date", () => {
    const d = toRestartDate("2025-03-13 04:05:06+00");
    expect(d).toBeInstanceOf(Date);
    expect(Number.isNaN(d!.getTime())).toBe(false);
  });

  it("parses an OFFSET-LESS pg string as UTC, never host-local (WR-01)", () => {
    // `lnd_restart.last_restart` is `timestamp without time zone` storing UTC
    // wall time; the previous '+00'-suffixed fixture masked the host-local
    // parse bug. This assertion fails on any non-UTC host if the coercion
    // regresses to a bare new Date(string).
    const d = toRestartDate("2025-03-13 04:05:06");
    expect(d!.getTime()).toBe(Date.UTC(2025, 2, 13, 4, 5, 6));
  });

  it("passes a real Date through and keeps null as null", () => {
    const real = new Date("2025-03-13T04:05:06Z");
    expect(toRestartDate(real)).toBe(real);
    expect(toRestartDate(null)).toBeNull();
  });

  it("returns null (not Invalid Date) for an unparseable string", () => {
    expect(toRestartDate("not-a-timestamp")).toBeNull();
  });
});
