import { describe, expect, it } from "vitest";

import { applyFilter, parseOverviewFacets, type OverviewFacets } from "@/lib/overview/filter";
import type { GroupedIncident, IncidentLayer } from "@/lib/overview/incidents";
import type { Severity } from "@/components/df/Severity";

// =====================================================
// filter.test.ts — whitelist codec + pure no-resort view (OVW-05 / D-09)
// =====================================================
// V5 (threat T-12-02): operator-editable ?layer/?sev query params are checked
// against a CLOSED vocabulary; an invalid value is silently dropped and widens
// the view — it NEVER throws.
// D-09: applyFilter is a pure VIEW over the same grouped incident set — it
// re-queries nothing, re-sorts nothing (engine order preserved), mutates nothing.
// OVW-05: filtering a non-empty queue to zero matches yields [] so the page can
// show the "nothing matches this filter" empty state distinct from all-clear.

/** Minimal GroupedIncident fixture — filter only reads `layer` + `severity`. */
function inc(key: string, layer: IncidentLayer, severity: Severity): GroupedIncident {
  return {
    key,
    layer,
    severity,
    stale: false,
    why: `${key} reason`,
    entityLabel: key,
    asOf: null,
    children: [],
  };
}

describe("parseOverviewFacets", () => {
  it("parses a whitelisted layer + severity into typed facets", () => {
    const facets = parseOverviewFacets(new URLSearchParams("layer=hosts&sev=critical"));
    expect(facets).toEqual({ layer: ["hosts"], sev: ["critical"] });
  });

  it("silently drops invalid values and never throws (V5)", () => {
    // `mars` is not a layer; `warn` is the INSIGHT vocab — the df severity is
    // `warning`, so `warn` is invalid here. Both drop to empty, no throw.
    expect(() => parseOverviewFacets(new URLSearchParams("layer=mars&sev=warn"))).not.toThrow();
    const facets = parseOverviewFacets(new URLSearchParams("layer=mars&sev=warn"));
    expect(facets).toEqual({ layer: [], sev: [] });
  });

  it("drops the non-filterable df severities (healthy/stale are not filter facets)", () => {
    const facets = parseOverviewFacets(new URLSearchParams("sev=healthy&sev=stale&sev=watch"));
    expect(facets.sev).toEqual(["watch"]);
  });

  it("parses CSV and repeated keys, deduping in first-seen order", () => {
    const csv = parseOverviewFacets(new URLSearchParams("layer=hosts,nodes,hosts"));
    expect(csv.layer).toEqual(["hosts", "nodes"]);
    const repeated = parseOverviewFacets(new URLSearchParams("layer=hosts&layer=nodes&layer=hosts"));
    expect(repeated.layer).toEqual(["hosts", "nodes"]);
  });

  it("returns empty facets for an empty query (widest view)", () => {
    expect(parseOverviewFacets(new URLSearchParams(""))).toEqual({ layer: [], sev: [] });
  });
});

describe("applyFilter", () => {
  const incidents: GroupedIncident[] = [
    inc("host-3", "hosts", "critical"),
    inc("svc-1", "services", "warning"),
    inc("node-9", "nodes", "watch"),
    inc("btc-2", "bitcoind", "critical"),
  ];

  it("keeps only the matching layer when a layer facet is set", () => {
    const out = applyFilter(incidents, { layer: ["hosts"], sev: [] });
    expect(out.map((i) => i.key)).toEqual(["host-3"]);
  });

  it("intersects layer AND severity facets", () => {
    const out = applyFilter(incidents, { layer: ["hosts", "bitcoind"], sev: ["critical"] });
    expect(out.map((i) => i.key)).toEqual(["host-3", "btc-2"]);
  });

  it("returns the full set unchanged for empty facets, preserving order (no re-sort)", () => {
    const out = applyFilter(incidents, { layer: [], sev: [] });
    expect(out.map((i) => i.key)).toEqual(["host-3", "svc-1", "node-9", "btc-2"]);
  });

  it("is a pure view — does not mutate the input array or its order", () => {
    const before = incidents.map((i) => i.key);
    applyFilter(incidents, { layer: ["nodes"], sev: [] });
    expect(incidents.map((i) => i.key)).toEqual(before);
  });

  it("yields [] when a non-empty queue filters to zero matches (honest empty state)", () => {
    const out = applyFilter(incidents, { layer: ["storage"], sev: [] });
    expect(out).toEqual([]);
  });

  it("never re-sorts: a severity facet preserves ranked order, not severity order", () => {
    // watch precedes critical in the input; filtering by both must keep that order.
    const out = applyFilter(incidents, { layer: [], sev: ["watch", "critical"] });
    expect(out.map((i) => i.key)).toEqual(["host-3", "node-9", "btc-2"]);
  });
});

// ── Nested-tree fixture (D-R4): a grouped card is one OWNER + descendant children,
//    each child carrying its OWN layer/severity the tree filter reads. ────────────
function grouped(
  key: string,
  layer: IncidentLayer,
  severity: Severity,
  children: GroupedIncident[],
): GroupedIncident {
  return { ...inc(key, layer, severity), children };
}

describe("applyFilter — tree-aware (D-R4)", () => {
  it("keeps a host card when only a DESCENDANT matches the layer facet (owner-or-descendant match)", () => {
    // Owner layer is 'hosts' but the only alerting child is a node — a nodes filter
    // must keep it; the old top-level-only match would wrongly hide it.
    const host = grouped("h1", "hosts", "critical", [inc("c-node", "nodes", "critical")]);
    const out = applyFilter([host], { layer: ["nodes"], sev: [] });
    expect(out.map((i) => i.key)).toEqual(["h1"]);
    expect(out[0].children.map((c) => c.key)).toEqual(["c-node"]);
  });

  it("matches the severity facet on ANY descendant severity, not just the owner's rolled-up rung", () => {
    // Owner severity 'warning' but a child is 'critical' — a critical filter keeps it.
    const host = grouped("h1", "hosts", "warning", [
      inc("c1", "nodes", "warning"),
      inc("c2", "services", "critical"),
    ]);
    const out = applyFilter([host], { layer: [], sev: ["critical"] });
    expect(out.map((i) => i.key)).toEqual(["h1"]);
    // No layer facet -> children are NOT narrowed.
    expect(out[0].children.map((c) => c.key)).toEqual(["c1", "c2"]);
  });

  it("narrows a surviving card's children to the active layer and returns a FRESH card (input unmutated)", () => {
    const host = grouped("h1", "hosts", "critical", [
      inc("c-node", "nodes", "critical"),
      inc("c-svc", "services", "warning"),
    ]);
    const input = [host];
    const out = applyFilter(input, { layer: ["services"], sev: [] });
    expect(out).toHaveLength(1);
    // visible children narrowed to the service-layer child only.
    expect(out[0].children.map((c) => c.key)).toEqual(["c-svc"]);
    // the returned card is a FRESH object; the input incident is not mutated.
    expect(out[0]).not.toBe(host);
    expect(host.children.map((c) => c.key)).toEqual(["c-node", "c-svc"]);
  });

  it("retains every child when NO layer facet is active (no narrowing; same reference)", () => {
    const host = grouped("h1", "hosts", "critical", [
      inc("c1", "nodes", "critical"),
      inc("c2", "services", "warning"),
    ]);
    const out = applyFilter([host], { layer: [], sev: [] });
    expect(out[0].children.map((c) => c.key)).toEqual(["c1", "c2"]);
    // layer facet empty -> the card passes through unchanged (identical reference).
    expect(out[0]).toBe(host);
  });

  it("matches a childless leaf on its OWN layer/severity (back-compat with the flat cases)", () => {
    const leaf = inc("solo", "nodes", "critical");
    expect(applyFilter([leaf], { layer: ["nodes"], sev: [] }).map((i) => i.key)).toEqual(["solo"]);
    expect(applyFilter([leaf], { layer: ["hosts"], sev: [] })).toEqual([]);
    expect(applyFilter([leaf], { layer: [], sev: ["critical"] }).map((i) => i.key)).toEqual([
      "solo",
    ]);
  });

  it("hides a grouped card when NO descendant matches the active layer", () => {
    const host = grouped("h1", "hosts", "warning", [inc("c1", "nodes", "warning")]);
    expect(applyFilter([host], { layer: ["storage"], sev: [] })).toEqual([]);
  });
});

// Type-level guard: OverviewFacets.sev is the df Severity subset, not insight sev.
const _typeGuard: OverviewFacets = { layer: ["hosts"], sev: ["critical"] };
void _typeGuard;
