// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// filter.ts — overview layer/severity facet codec + pure view filter (OVW-05/D-09)
// =====================================================
// Filtering the attention queue is a PURE VIEW concern (D-09): the same grouped
// incident set is narrowed in place, with no re-query and no re-sort. This module
// mirrors the Phase-7 `triage-facets.ts` codec discipline but over a DIFFERENT,
// overview-specific vocabulary:
//   • layer — the five IncidentLayer values (hosts|services|bitcoind|nodes|storage).
//   • sev   — the FILTERABLE df severities (critical|warning|watch). `healthy` and
//             `stale` are honest states the queue surfaces but are not filter chips,
//             so they are NOT in the severity vocabulary (UI-SPEC §5).
//
// Security (V5 / threat T-12-02): the ?layer / ?sev params are operator-editable
// and untrusted. Every value is whitelisted against the closed vocab BEFORE use;
// an invalid value is SILENTLY DROPPED (it widens the view), never thrown — a bad
// URL degrades to a wider queue, not an error page. This is the exact triage-facets
// precedent. NOTE: the insight codec uses the INSIGHT severity vocab
// (critical|warn|info) — it is deliberately NOT reused here; `warn`/`info` are
// invalid overview severities.
//
// Engine-order-is-LAW (D-09): `applyFilter` only `.filter`s — there is NO `.sort`
// anywhere, so the ranked order assembled by `incidents.ts` is preserved and the
// input array is never mutated.

import type { Severity } from "@/components/df/Severity";
import type { GroupedIncident, IncidentLayer } from "@/lib/overview/incidents";

/** The whitelisted facet state parsed from the URL — both dimensions OR within. */
export interface OverviewFacets {
  layer: IncidentLayer[];
  /** The df severity SUBSET used as filter chips (critical|warning|watch). */
  sev: Severity[];
}

// ── Closed vocabularies (typed against the source unions, never free strings) ──
// Typing these arrays as the source unions makes the compiler reject any value
// that is not a real IncidentLayer / df Severity — the vocab cannot drift from the
// types the queue actually carries.
const LAYER_VALUES = new Set<IncidentLayer>([
  "hosts",
  "services",
  "bitcoind",
  "nodes",
  "storage",
]);

/** The filterable severity subset — `healthy`/`stale` are honest states, not chips. */
const FILTER_SEVERITIES = new Set<Severity>(["critical", "warning", "watch"]);

// ── Read helpers (mirror triage-facets.ts) ──────────────────────────────────

/**
 * Collect all raw values for a key: both repeated keys (`?layer=a&layer=b`) and
 * CSV (`?layer=a,b`) are supported. Empty tokens are dropped.
 */
function readRaw(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  for (const value of params.getAll(key)) {
    for (const token of value.split(",")) {
      const trimmed = token.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

/** Whitelist + dedupe, preserving first-seen order. Invalid values dropped. */
function whitelist<T extends string>(raw: string[], allow: (v: string) => v is T): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of raw) {
    if (!allow(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

const isLayer = (v: string): v is IncidentLayer => LAYER_VALUES.has(v as IncidentLayer);
const isSeverity = (v: string): v is Severity => FILTER_SEVERITIES.has(v as Severity);

/**
 * Parse a URLSearchParams (or the Next `searchParams` object via
 * `new URLSearchParams(...)`) into a whitelisted OverviewFacets. Never throws on
 * bad input — invalid `?layer` / `?sev` values are silently dropped (V5).
 */
export function parseOverviewFacets(params: URLSearchParams): OverviewFacets {
  return {
    layer: whitelist(readRaw(params, "layer"), isLayer),
    sev: whitelist(readRaw(params, "sev"), isSeverity),
  };
}

/**
 * The set of layers present in an incident's TREE: the union of its descendant
 * children's layers, or — for a childless leaf — its own layer. This is the field
 * the tree-aware match reads so a host card whose only alerting child is a node is
 * matched by a `layer=nodes` filter (owner-or-descendant, D-R4).
 */
function treeLayers(inc: GroupedIncident): Set<IncidentLayer> {
  return inc.children.length > 0
    ? new Set(inc.children.map((c) => c.layer))
    : new Set([inc.layer]);
}

/** The severities present in an incident's tree (descendant union, else own). */
function treeSevs(inc: GroupedIncident): Set<Severity> {
  return inc.children.length > 0
    ? new Set(inc.children.map((c) => c.severity))
    : new Set([inc.severity]);
}

/**
 * A PURE, TREE-AWARE VIEW over the grouped incident set (D-09 / D-R4). A card is
 * KEPT when ANY alert in its tree — the owner OR any descendant child — matches the
 * active layer set AND the active severity set (an empty facet matches everything).
 * This fixes the old top-level-only match that hid grouped `layer:"hosts"` cards
 * whenever the operator filtered by `nodes`/`services`.
 *
 * When a LAYER facet is active, each surviving card's visible `children` are narrowed
 * to those whose layer is in the facet, and a FRESH card object is returned (the input
 * incident's `children` array is never mutated). With NO layer facet the card passes
 * through unchanged (same reference). There is NO `.sort` — engine order is preserved;
 * filtering a non-empty queue to zero matches yields `[]` so the page can show the
 * honest "nothing matches this filter" empty state (OVW-05).
 */
export function applyFilter(
  incidents: GroupedIncident[],
  facets: OverviewFacets,
): GroupedIncident[] {
  return incidents
    .filter(
      (incident) =>
        (facets.layer.length === 0 ||
          facets.layer.some((l) => treeLayers(incident).has(l))) &&
        (facets.sev.length === 0 || facets.sev.some((s) => treeSevs(incident).has(s))),
    )
    .map((incident) =>
      facets.layer.length > 0
        ? { ...incident, children: incident.children.filter((c) => facets.layer.includes(c.layer)) }
        : incident,
    );
}
