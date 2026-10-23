import { describe, expect, it } from "vitest";

import {
  applyNodeFilters,
  parseNodeFacets,
  type NodeFacets,
  type NodeFilterRow,
} from "@/lib/overview/node-filter";

// =====================================================
// node-filter.test.ts — Nodes-list facet codec + pure no-resort view (NODE-03)
// =====================================================
// Mirrors the shipped `overview/filter.ts` contract for the Nodes list (UI-SPEC A2):
//   • type   — All | LND routing (lnd) | LDK/LSP (ldk)      (closed enum)
//   • status — All | Healthy | At-risk | Offline            (closed enum)
//   • stale  — a single "stale only" boolean toggle
// V5 (mirrors filter.ts): operator-editable ?type/?status/?stale params are
// whitelisted against a CLOSED vocabulary; an invalid value SILENTLY WIDENS the
// view (never throws). applyNodeFilters is a PURE view — it only `.filter`s, never
// `.sort`s (input order preserved) and never mutates the input array.

/**
 * Minimal loaded-row fixture. The filter reads only backend/severity/stale, but the
 * assertions identify rows by `pubkey` — so the fixture is a structural superset of
 * `NodeFilterRow`. `applyNodeFilters` is generic (`<T extends NodeFilterRow>`), so it
 * preserves this wider row type and `.pubkey` stays accessible on the output.
 */
type TestRow = NodeFilterRow & { pubkey: string };
function row(
  pubkey: string,
  backend: NodeFilterRow["backend"],
  severity: NodeFilterRow["severity"],
  stale = false,
): TestRow {
  return { pubkey, backend, severity, stale };
}

describe("parseNodeFacets", () => {
  it("parses a valid ?type=lnd&status=at-risk&stale=1 into the typed facet object", () => {
    const facets = parseNodeFacets(new URLSearchParams("type=lnd&status=at-risk&stale=1"));
    expect(facets).toEqual({ type: "lnd", status: "at-risk", stale: true });
  });

  it("silently WIDENS an invalid ?type=banana to 'all' and never throws (V5)", () => {
    expect(() => parseNodeFacets(new URLSearchParams("type=banana"))).not.toThrow();
    const facets = parseNodeFacets(new URLSearchParams("type=banana&status=mars&stale=maybe"));
    expect(facets).toEqual({ type: "all", status: "all", stale: false });
  });

  it("returns the widest facets for an empty query", () => {
    expect(parseNodeFacets(new URLSearchParams(""))).toEqual({
      type: "all",
      status: "all",
      stale: false,
    });
  });
});

describe("applyNodeFilters", () => {
  const nodes: TestRow[] = [
    row("lnd-crit", "lnd", "critical"),
    row("lnd-warn", "lnd", "warning"),
    row("lnd-ok", "lnd", "healthy"),
    row("ldk-ok", "ldk", "healthy"),
    row("ldk-warn", "ldk", "warning"),
    row("lnd-stale", "lnd", "stale", true),
  ];

  it("returns the full set unchanged for All/All/false (same length, same order)", () => {
    const out = applyNodeFilters(nodes, { type: "all", status: "all", stale: false });
    expect(out.map((n) => n.pubkey)).toEqual(nodes.map((n) => n.pubkey));
  });

  it("narrows type=ldk to LDK-backend nodes only", () => {
    const out = applyNodeFilters(nodes, { type: "ldk", status: "all", stale: false });
    expect(out.map((n) => n.pubkey)).toEqual(["ldk-ok", "ldk-warn"]);
  });

  it("narrows status=at-risk to critical|warning rows only", () => {
    const out = applyNodeFilters(nodes, { type: "all", status: "at-risk", stale: false });
    expect(out.map((n) => n.pubkey)).toEqual(["lnd-crit", "lnd-warn", "ldk-warn"]);
  });

  it("stale-only returns only stale rows; healthy rows are excluded", () => {
    const out = applyNodeFilters(nodes, { type: "all", status: "all", stale: true });
    expect(out.map((n) => n.pubkey)).toEqual(["lnd-stale"]);
  });

  it("combines type=lnd AND status=at-risk (intersecting facets)", () => {
    const out = applyNodeFilters(nodes, { type: "lnd", status: "at-risk", stale: false });
    expect(out.map((n) => n.pubkey)).toEqual(["lnd-crit", "lnd-warn"]);
  });

  it("yields [] on zero matches (honest empty) and does not mutate the input array", () => {
    const before = nodes.map((n) => n.pubkey);
    const out = applyNodeFilters(nodes, { type: "ldk", status: "at-risk", stale: true });
    expect(out).toEqual([]);
    expect(nodes.map((n) => n.pubkey)).toEqual(before);
  });
});

// Type-level guard: NodeFacets carries the closed vocab, never free strings.
const _typeGuard: NodeFacets = { type: "lnd", status: "at-risk", stale: true };
void _typeGuard;
