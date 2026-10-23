// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// node-filter.ts — Nodes-list type/status/stale facet codec + pure view filter (NODE-03)
// =====================================================
// Filtering the Nodes list (UI-SPEC A2) is a PURE VIEW concern: the already-loaded
// fleet set is narrowed in place, with no re-query and no re-sort. This module is
// the Nodes-list sibling of `overview/filter.ts` — same whitelist-widen-on-invalid
// discipline, a DIFFERENT, Nodes-specific vocabulary:
//   • type   — All | LND routing (`lnd`) | LDK/LSP (`ldk`)   (closed enum → node Backend)
//   • status — All | Healthy | At-risk | Offline             (closed enum → row severity)
//   • stale  — a single "stale only" boolean toggle          (→ the row's stale flag)
//
// Security (V5, mirrors filter.ts): the ?type / ?status / ?stale params are
// operator-editable and untrusted. Every value is whitelisted against the closed
// vocab BEFORE use; an invalid value SILENTLY WIDENS the view (drops to the
// permissive default) — a bad URL degrades to a wider list, never an error page.
//
// Engine-order-is-LAW: `applyNodeFilters` only `.filter`s — there is NO `.sort`
// anywhere, so the caller's loaded order is preserved and the input array is never
// mutated. Severity is NOT re-derived here: the status/stale facets read the flags
// already present on the loaded row.

import type { Backend } from "@/lib/read/nodes";
import type { Severity } from "@/components/df/Severity";

/** The closed `type` vocabulary — node `Backend` values, plus the widest default. */
export type NodeTypeFacet = Backend | "all";

/** The closed `status` vocabulary — the widest default plus the three UI-SPEC A2 states. */
export type NodeStatusFacet = "all" | "healthy" | "at-risk" | "offline";

/** The whitelisted facet state parsed from the URL. */
export interface NodeFacets {
  type: NodeTypeFacet;
  status: NodeStatusFacet;
  stale: boolean;
}

/**
 * The minimal loaded-row shape the filter reads (a structural subset of the
 * `ScorecardView` the Nodes route loads — see scorecard/types.ts). Only these
 * three flags drive the facets; severity is read, never re-derived.
 */
export interface NodeFilterRow {
  backend: Backend;
  /** The df severity already computed for the loaded row (critical…stale). */
  severity: Severity;
  /** The row's honest stale flag (D-08) — no fresh data. */
  stale: boolean;
}

// ── Closed vocabularies (typed against the source unions, never free strings) ──
const TYPE_VALUES = new Set<Backend>(["lnd", "ldk"]);
const STATUS_VALUES = new Set<Exclude<NodeStatusFacet, "all">>([
  "healthy",
  "at-risk",
  "offline",
]);

/**
 * status → the df severities that satisfy it. `At-risk` is the actionable
 * critical|warning band (the row that "pops"); `Healthy` covers the quiet green
 * plus the minor `watch` advisory; `Offline` is the honest no-fresh-data `stale`
 * severity. The five ramp states each map to exactly one status bucket.
 */
const STATUS_SEVERITIES: Record<Exclude<NodeStatusFacet, "all">, ReadonlySet<Severity>> = {
  healthy: new Set<Severity>(["healthy", "watch"]),
  "at-risk": new Set<Severity>(["critical", "warning"]),
  offline: new Set<Severity>(["stale"]),
};

const isType = (v: string | null): v is Backend => v != null && TYPE_VALUES.has(v as Backend);
const isStatus = (v: string | null): v is Exclude<NodeStatusFacet, "all"> =>
  v != null && STATUS_VALUES.has(v as Exclude<NodeStatusFacet, "all">);

/**
 * Parse a URLSearchParams into a whitelisted NodeFacets. Never throws on bad input
 * — an invalid `?type` / `?status` widens to `"all"`, and any non-truthy `?stale`
 * widens to `false` (V5). The `stale` toggle is on for the `1`/`true` tokens only.
 */
export function parseNodeFacets(params: URLSearchParams): NodeFacets {
  const type = params.get("type");
  const status = params.get("status");
  const stale = params.get("stale");
  return {
    type: isType(type) ? type : "all",
    status: isStatus(status) ? status : "all",
    stale: stale === "1" || stale === "true",
  };
}

/**
 * A PURE VIEW over the loaded node set. A row is KEPT when it satisfies EVERY active
 * facet (AND semantics); an `"all"`/`false` facet matches everything. There is NO
 * `.sort` — the caller's loaded order is preserved — and the input array is never
 * mutated. Filtering a non-empty set to zero matches yields `[]` so the page can
 * show the honest "nothing matches this filter" empty state.
 */
export function applyNodeFilters<T extends NodeFilterRow>(nodes: T[], facets: NodeFacets): T[] {
  return nodes.filter(
    (node) =>
      (facets.type === "all" || node.backend === facets.type) &&
      (facets.status === "all" || STATUS_SEVERITIES[facets.status].has(node.severity)) &&
      (!facets.stale || node.stale),
  );
}
