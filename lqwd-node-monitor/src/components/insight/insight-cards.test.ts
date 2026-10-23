import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InsightCardRow } from "@/components/insight/InsightCardRow";
import { InsightCardList } from "@/components/insight/InsightCardList";
import { InsightCardSchema } from "@/lib/insight/schema";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import type { InsightCard } from "@/lib/insight/types";

// =====================================================
// insight-cards.test.ts — card rendering primitives (04-10)
// =====================================================
// Scope discipline: SIGNAL_LABELS vocabulary coverage is frozen by
// labels.test.ts (04-02) — NOT re-tested here. This file asserts the
// components consume the SHARED map (one card per severity shows its mapped
// label verbatim) and that components/insight defines no local label map.
// Server Components are plain functions — renderToStaticMarkup under the
// node environment is the established no-jsdom harness.

const PUBKEY_A = `02${"ab".repeat(32)}`;
const PUBKEY_B = `03${"cd".repeat(32)}`;

/** Every fixture passes the frozen contract — drift fails here, not in render. */
function makeCard(overrides: Partial<InsightCard>): InsightCard {
  const base = {
    schemaVersion: 1 as const,
    id: `htlc_timeout_fc:${PUBKEY_A}:node`,
    severity: "critical" as const,
    node: { pubkey: PUBKEY_A, alias: "LQWD-France", backend: "lnd" as const },
    target: { kind: "node" as const },
    signal: "htlc_timeout_fc" as const,
    evidence: {
      metric: "htlcTimeoutCloses",
      observed: 4,
      threshold: 2,
      unit: "closes",
      window: "30d",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${PUBKEY_A}/closes`,
    },
    suggestedAction: null,
    suppressed: { active: false, reason: null },
    provenance: "deterministic" as const,
    rateLimitGuidance: null,
  };
  return InsightCardSchema.parse({ ...base, ...overrides });
}

const criticalCard = makeCard({});

const warnSuppressedCard = makeCard({
  id: `fee_raise:${PUBKEY_A}:123x456x0`,
  severity: "warn",
  signal: "fee_raise",
  target: { kind: "channel", chanId: "123456", channelPoint: "abc:0", remotePubkey: PUBKEY_B },
  evidence: {
    metric: "feePpmVsVolume",
    observed: 12,
    threshold: 50,
    unit: "ppm",
    window: "90d",
    asOf: "2026-06-12T00:00:00.000Z",
    deepLink: `/${PUBKEY_A}/fees`,
    detail: {
      hysteresis: "clear",
      withheldAction: "update_fee",
    },
  },
  suggestedAction: null,
  suppressed: { active: true, reason: "node flagged AP-11 — write recommendations withheld" },
});

const infoCard = makeCard({
  id: `ap12a_conn_exhaustion:${PUBKEY_A}:node`,
  severity: "info",
  signal: "ap12a_conn_exhaustion",
  provenance: "llm-inference",
  evidence: {
    metric: "connExhaustionRisk",
    observed: 1,
    threshold: 1,
    unit: "n/a",
    window: "30d",
    asOf: "2026-06-12T00:00:00.000Z",
    deepLink: `/${PUBKEY_A}/scorecard`,
  },
});

const fleetCard = makeCard({
  id: "fleet_close_cluster:fleet:2026-06-12T00",
  severity: "warn",
  signal: "fleet_close_cluster",
  node: null,
  target: { kind: "fleet", pubkeys: [PUBKEY_A, PUBKEY_B] },
  evidence: {
    metric: "nodesInCluster",
    observed: 2,
    threshold: 2,
    unit: "nodes",
    window: "1h",
    asOf: "2026-06-12T00:00:00.000Z",
    deepLink: "/pending",
  },
});

const actionCard = makeCard({
  id: `rebalance_degraded:${PUBKEY_A}:789x1x0`,
  severity: "warn",
  signal: "rebalance_degraded",
  target: { kind: "channel", chanId: "789", channelPoint: "def:0", remotePubkey: PUBKEY_B },
  suggestedAction: {
    type: "rebalance",
    params: { partnerPubkey: PUBKEY_B, amountSat: 1500000, direction: "out" },
  },
  rateLimitGuidance: "1 write recommendation(s) for this node this load — suggested max 4/day",
});

function renderRow(card: InsightCard): string {
  return renderToStaticMarkup(createElement(InsightCardRow, { card }));
}

describe("InsightCardRow — shared SIGNAL_LABELS consumption", () => {
  it("renders the mapped label verbatim for a critical card", () => {
    expect(renderRow(criticalCard)).toContain(SIGNAL_LABELS.htlc_timeout_fc);
  });

  it("renders the mapped label verbatim for a warn card", () => {
    expect(renderRow(warnSuppressedCard)).toContain(SIGNAL_LABELS.fee_raise);
  });

  it("renders the mapped label verbatim for an info card", () => {
    expect(renderRow(infoCard)).toContain(SIGNAL_LABELS.ap12a_conn_exhaustion);
  });

  it("imports the shared map and defines no local label map in components/insight", () => {
    const componentsDir = dirname(fileURLToPath(import.meta.url));
    const rowSource = readFileSync(join(componentsDir, "InsightCardRow.tsx"), "utf8");
    expect(rowSource).toContain('from "@/lib/insight/labels"');

    // No component file may DEFINE a label map — vocabulary is engine-owned.
    const componentFiles = readdirSync(componentsDir).filter((f) => f.endsWith(".tsx"));
    expect(componentFiles.length).toBeGreaterThan(0);
    for (const file of componentFiles) {
      const source = readFileSync(join(componentsDir, file), "utf8");
      expect(source, `${file} must not define a local label map`).not.toMatch(
        /SIGNAL_LABELS\s*[:=]\s*\{/,
      );
      expect(source, `${file} must not define a label record type`).not.toMatch(
        /Record<DetectorId,\s*string>/,
      );
    }
  });
});

describe("InsightCardRow — state rendering", () => {
  it("renders the suppression reason verbatim with the disabled action area", () => {
    const html = renderRow(warnSuppressedCard);
    expect(html).toContain("node flagged AP-11 — write recommendations withheld");
    expect(html).toContain("SUPPRESSED");
    // Withheld type string only — suggestedAction is structurally null
    // (T-04-29): no params can reach the DOM.
    expect(html).toContain("update_fee");
    expect(html).toContain("opacity-50");
  });

  it("renders hysteresis state from evidence.detail", () => {
    expect(renderRow(warnSuppressedCard)).toContain("hysteresis: clear");
  });

  it("renders suggested-action params as key/value rows with AFM-002 sat formatting", () => {
    const html = renderRow(actionCard);
    expect(html).toContain("rebalance");
    expect(html).toContain("amountSat");
    expect(html).toContain("1,500,000"); // formatSats — never raw 1500000
    expect(html).toContain("suggested max 4/day");
  });

  it("renders fleet cards with FLEET-WIDE and the member count", () => {
    const html = renderRow(fleetCard);
    expect(html).toContain("FLEET-WIDE");
    expect(html).toContain("2 nodes");
    expect(html).toContain("open pending →");
  });

  it("renders the deep link verbatim as the href", () => {
    expect(renderRow(criticalCard)).toContain(`href="/${PUBKEY_A}/closes"`);
  });
});

describe("InsightCardList — severity sections, engine order preserved", () => {
  it("renders sections critical → warn → info with counts, skipping empty sections", () => {
    const html = renderToStaticMarkup(
      createElement(InsightCardList, { cards: [criticalCard, warnSuppressedCard, fleetCard] }),
    );
    expect(html).toContain("CRITICAL — 1");
    expect(html).toContain("WARN — 2");
    expect(html).not.toContain("INFO —");
    // Engine order within the warn section: fee_raise was ranked before the
    // fleet cluster card by the engine — the section must not reorder.
    expect(html.indexOf(SIGNAL_LABELS.fee_raise)).toBeLessThan(
      html.indexOf(SIGNAL_LABELS.fleet_close_cluster),
    );
    expect(html.indexOf("CRITICAL — 1")).toBeLessThan(html.indexOf("WARN — 2"));
  });

  it("renders nothing for an empty card set — the page owns the empty state", () => {
    expect(renderToStaticMarkup(createElement(InsightCardList, { cards: [] }))).toBe("");
  });
});
