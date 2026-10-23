import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildHtlcTimeoutSql,
  detectHtlcTimeout,
  type HtlcNodeMeta,
  type HtlcRow,
} from "@/lib/insight/detectors/htlc-timeout";
import { INSIGHT_CONFIG, type InsightKnobs } from "@/lib/insight/config";
import { InsightCardSchema } from "@/lib/insight/schema";

// HTLC-timeout force-close signature detector tests (INSIGHT-02, NO DB).
//
// Shape tests assert the force-close-analysis-methodology Query 1 signature is
// rendered with fixed enum literals, a NULLIF-guarded settled ratio, the
// bound window param ($1, number-typed — T-04-08), and the fixed 24h
// escalation bucket. The lazy-import test (T-04-09) asserts the server-only
// DB client never enters this module's top-level import graph. Fixture tests
// drive the pure detectHtlcTimeout with coerced rows — warn/critical
// escalation, healthy-band silence, signature-filter count semantics, schema
// parse, and config-driven thresholds (no hardcoded 2/10).

const moduleSource = readFileSync(
  fileURLToPath(new URL("./htlc-timeout.ts", import.meta.url)),
  "utf8",
);

const dialect = new PgDialect();

function render(built: ReturnType<typeof buildHtlcTimeoutSql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

describe("buildHtlcTimeoutSql shape", () => {
  it("renders the Query 1 signature: LOCAL_FORCE_CLOSE + time_locked_balance > 0 + NULLIF-guarded settled ratio", () => {
    const { sql } = render(buildHtlcTimeoutSql(30));
    expect(sql).toContain("'local_force_close'");
    expect(sql).toContain("time_locked_balance > 0");
    expect(sql).toContain("nullif(capacity");
    expect(sql).toContain("settled_balance");
    expect(sql).toContain("< 0.8");
  });

  it("aggregates fleet-wide per node and excludes NULL local_pubkey", () => {
    const { sql } = render(buildHtlcTimeoutSql(30));
    expect(sql).toContain("group by local_pubkey");
    expect(sql).toContain("local_pubkey is not null");
  });

  it("binds the window-days param ($1) instead of interpolating it (T-04-08)", () => {
    const { sql, params } = render(buildHtlcTimeoutSql(30));
    expect(sql).toContain("$1");
    expect(params).toContain(30);
    expect(params.every((p) => typeof p === "number")).toBe(true);
  });

  it("carries the fixed 24h escalation bucket via make_interval(hours => 24)", () => {
    const { sql } = render(buildHtlcTimeoutSql(30));
    expect(sql).toContain("make_interval(hours => 24)");
  });

  it("computes avg settled ratio and total time-locked over the signature filter", () => {
    const { sql } = render(buildHtlcTimeoutSql(30));
    expect(sql).toContain("avg(");
    expect(sql).toContain("sum(time_locked_balance)");
    expect(sql).toContain("max(timestamp) as as_of");
  });

  it("never pins the AFM-001 failure shape WHERE timestamp =", () => {
    const { sql } = render(buildHtlcTimeoutSql(30));
    expect(sql).not.toContain("where timestamp =");
  });
});

describe("buildHtlcTimeoutSql lazy-import shape (T-04-09)", () => {
  it("imports no DB client at module top level — warehouse-routing only via await import inside the executor", () => {
    // No static import of the server-only DB client anywhere in the module.
    expect(moduleSource).not.toMatch(/^import .*warehouse-routing/m);
    expect(moduleSource).not.toMatch(/^import .*["']postgres["']/m);
    // The executor lazy-imports it.
    expect(moduleSource).toContain('await import("@/lib/db/warehouse-routing")');
  });
});

// ── detectHtlcTimeout fixtures ──────────────────────────────────────────────

const PUBKEY_A = `02${"a".repeat(64)}`;
const PUBKEY_B = `03${"b".repeat(64)}`;

const AS_OF = new Date("2026-06-11T18:00:00Z");

const META: ReadonlyMap<string, HtlcNodeMeta> = new Map([
  [PUBKEY_A, { alias: "LQWD-Canada", backend: "lnd" }],
  [PUBKEY_B, { alias: "LQWD-France", backend: "lnd" }],
]);

const CONFIG: InsightKnobs = INSIGHT_CONFIG.lnd;

function row(overrides: Partial<HtlcRow> & { pubkey: string }): HtlcRow {
  return {
    sigCount: 0,
    sigCount24h: 0,
    avgSettledRatio: null,
    totalTimeLockedSat: 0,
    asOf: AS_OF,
    ...overrides,
  };
}

describe("detectHtlcTimeout fixtures", () => {
  it("fires a warn card at sigCount = 2 in the 30d window with full evidence", () => {
    const cards = detectHtlcTimeout(
      [
        row({
          pubkey: PUBKEY_A,
          sigCount: 2,
          avgSettledRatio: 0.65,
          totalTimeLockedSat: 1_500_000,
        }),
      ],
      CONFIG,
      META,
    );
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.severity).toBe("warn");
    expect(card.signal).toBe("htlc_timeout_fc");
    expect(card.id).toBe(`htlc_timeout_fc:${PUBKEY_A}:node`);
    expect(card.target).toEqual({ kind: "node" });
    expect(card.node).toEqual({ pubkey: PUBKEY_A, alias: "LQWD-Canada", backend: "lnd" });
    expect(card.suggestedAction).toEqual({ type: "investigate", params: {} });
    expect(card.provenance).toBe("deterministic");
    expect(card.suppressed).toEqual({ active: false, reason: null });
    expect(card.rateLimitGuidance).toBeNull();
    expect(card.evidence.metric).toBe("htlcTimeoutSignatureCloses");
    expect(card.evidence.observed).toBe(2);
    expect(card.evidence.threshold).toBe(CONFIG.htlcTimeoutMinCount);
    expect(card.evidence.unit).toBe("closes");
    expect(card.evidence.window).toBe("30d");
    expect(card.evidence.asOf).toBe(AS_OF.toISOString());
    expect(card.evidence.deepLink).toBe(`/${PUBKEY_A}/closes`);
    expect(card.evidence.detail).toEqual({
      avgSettledRatio: 0.65,
      totalTimeLockedSat: 1_500_000,
    });
  });

  it("escalates to a single critical card at sigCount24h = 10 — window 24h, critical supersedes warn", () => {
    const cards = detectHtlcTimeout(
      [
        row({
          pubkey: PUBKEY_A,
          sigCount: 12,
          sigCount24h: 10,
          avgSettledRatio: 0.45,
          totalTimeLockedSat: 9_000_000,
        }),
      ],
      CONFIG,
      META,
    );
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.severity).toBe("critical");
    expect(card.evidence.observed).toBe(10);
    expect(card.evidence.threshold).toBe(CONFIG.htlcTimeoutCriticalCount);
    expect(card.evidence.window).toBe("24h");
    expect(card.suggestedAction).toEqual({ type: "investigate", params: {} });
  });

  it("stays silent at sigCount = 1 (healthy band 0–1 FC/month)", () => {
    const cards = detectHtlcTimeout(
      [row({ pubkey: PUBKEY_A, sigCount: 1, avgSettledRatio: 0.7, totalTimeLockedSat: 50_000 })],
      CONFIG,
      META,
    );
    expect(cards).toEqual([]);
  });

  it("stays silent when plain LOCAL_FCs miss the signature — SQL-filtered rows arrive with sigCount 0", () => {
    // A node with 3 plain LOCAL_FCs at settled ratio ≥ 0.8 reaches detect()
    // with sigCount 0 (the SQL FILTER excluded them) — count semantics only.
    const cards = detectHtlcTimeout([row({ pubkey: PUBKEY_A, sigCount: 0 })], CONFIG, META);
    expect(cards).toEqual([]);
  });

  it("emits at most one card per node and every card parses via InsightCardSchema.array()", () => {
    const cards = detectHtlcTimeout(
      [
        row({
          pubkey: PUBKEY_A,
          sigCount: 12,
          sigCount24h: 10,
          avgSettledRatio: 0.45,
          totalTimeLockedSat: 9_000_000,
        }),
        row({ pubkey: PUBKEY_B, sigCount: 3, avgSettledRatio: 0.6, totalTimeLockedSat: 250_000 }),
      ],
      CONFIG,
      META,
    );
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.id)).size).toBe(2);
    expect(() => InsightCardSchema.array().parse(cards)).not.toThrow();
  });

  it("omits avgSettledRatio from detail when the aggregate is null", () => {
    const cards = detectHtlcTimeout(
      [row({ pubkey: PUBKEY_A, sigCount: 2, avgSettledRatio: null, totalTimeLockedSat: 0 })],
      CONFIG,
      META,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].evidence.detail).toEqual({ totalTimeLockedSat: 0 });
  });

  it("reads thresholds and window from the config parameter — mutating a copy changes firing", () => {
    const fixture = [row({ pubkey: PUBKEY_A, sigCount: 2, sigCount24h: 5 })];

    // Raise the warn floor: 2 no longer fires.
    const raised: InsightKnobs = { ...CONFIG, htlcTimeoutMinCount: 3 };
    expect(detectHtlcTimeout(fixture, raised, META)).toEqual([]);

    // Lower the critical ceiling: 5 in 24h now escalates.
    const lowered: InsightKnobs = { ...CONFIG, htlcTimeoutCriticalCount: 5 };
    const critical = detectHtlcTimeout(fixture, lowered, META);
    expect(critical).toHaveLength(1);
    expect(critical[0].severity).toBe("critical");
    expect(critical[0].evidence.threshold).toBe(5);

    // The warn window string derives from htlcWindowDays, not a literal.
    const widened: InsightKnobs = { ...CONFIG, htlcWindowDays: 90 };
    const warn = detectHtlcTimeout(fixture, widened, META);
    expect(warn).toHaveLength(1);
    expect(warn[0].evidence.window).toBe("90d");
  });
});

// ── 18-06: malformed-pubkey fail-soft (review I2) ─────────────────────────────
// buildDeepLink throws on a non-`^[0-9a-f]{66}$` pubkey; a single malformed
// warehouse local_pubkey must degrade THIS node to no card, never throw out of
// assembleCards and reject the whole insight view.
describe("detectHtlcTimeout — malformed pubkey fail-soft (I2)", () => {
  const BAD_PK = "NOT_A_VALID_PUBKEY";

  it("degrades a malformed-pubkey row to no card instead of throwing", () => {
    const fixture = [row({ pubkey: BAD_PK, sigCount: 5 })];
    expect(() => detectHtlcTimeout(fixture, CONFIG, META)).not.toThrow();
    expect(detectHtlcTimeout(fixture, CONFIG, META)).toEqual([]);
  });

  it("still emits the good-pubkey card when another row's pubkey is malformed", () => {
    const cards = detectHtlcTimeout(
      [row({ pubkey: BAD_PK, sigCount: 5 }), row({ pubkey: PUBKEY_A, sigCount: 5 })],
      CONFIG,
      META,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].node?.pubkey).toBe(PUBKEY_A);
  });
});
