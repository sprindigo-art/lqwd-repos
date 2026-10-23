import { describe, expect, it } from "vitest";
import { isStale, worstCaseAsOf } from "@/lib/scorecard/freshness";

// D-13: worst-case (oldest) freshness stamp + tunable stale flag.

const OLD = new Date("2026-06-01T00:00:00Z");
const MID = new Date("2026-06-05T12:00:00Z");
const NEW = new Date("2026-06-09T18:00:00Z");

describe("worstCaseAsOf (D-13 honest staleness floor)", () => {
  it("picks the OLDEST of mixed dates", () => {
    expect(worstCaseAsOf([NEW, OLD, MID])).toBe(OLD);
  });

  it("ignores nulls (no-data dims excluded from the floor)", () => {
    expect(worstCaseAsOf([null, MID, null, NEW])).toBe(MID);
  });

  it("all-null → null", () => {
    expect(worstCaseAsOf([null, null])).toBeNull();
    expect(worstCaseAsOf([])).toBeNull();
  });
});

describe("isStale (tunable warnAfterHours)", () => {
  const WARN_HOURS = 6;
  const now = new Date("2026-06-09T12:00:00Z");

  it("exactly AT the threshold → not stale; just past → stale", () => {
    const exactlySixHoursOld = new Date(now.getTime() - WARN_HOURS * 3600 * 1000);
    expect(isStale(exactlySixHoursOld, WARN_HOURS, now)).toBe(false);

    const justPast = new Date(exactlySixHoursOld.getTime() - 1);
    expect(isStale(justPast, WARN_HOURS, now)).toBe(true);
  });

  it("fresh stamp → not stale", () => {
    const oneHourOld = new Date(now.getTime() - 3600 * 1000);
    expect(isStale(oneHourOld, WARN_HOURS, now)).toBe(false);
  });

  it("null asOf → stale true (unknown freshness must never read as fresh)", () => {
    expect(isStale(null, WARN_HOURS, now)).toBe(true);
  });
});
