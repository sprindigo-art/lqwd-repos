// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// host-filter.ts — Hosts-list sev/stale facet codec + pure view filter + the
// ONE sanctioned worst-first sort (HOST-01, D-08)
// =====================================================
// Filtering the Hosts list is a PURE VIEW concern: the already-loaded host card
// set is narrowed in place with no re-query. This module clones the
// `node-filter.ts` whitelist-widen-on-invalid discipline with the hosts
// vocabulary:
//   • sev   — All | Critical | Warning | Watch | Healthy  (the direct df ramp
//             MINUS stale — stale is an honest-state toggle, NOT a sev chip)
//   • stale — a single "stale only" boolean toggle        (→ the row's stale flag)
//
// Security (V5, mirrors node-filter.ts): the ?sev / ?stale params are
// operator-editable and untrusted. Every value is whitelisted against the closed
// vocab BEFORE use; an invalid value SILENTLY WIDENS the view (drops to the
// permissive default) — a bad URL degrades to a wider list, never an error page.
// No free string ever reaches a query or the DOM.
//
// D-08: `sortHostsWorstFirst` is the ONLY sort Phase 14 introduces — a view-side
// ordering over loaded card models only, NEVER applied to assembleIncidents
// children (engine-order-is-LAW). `applyHostFilters` itself never sorts and never
// mutates. Severity is NOT re-derived here: both functions read the rollup flags
// already present on the loaded row.

import type { Severity } from "@/components/df/Severity";

/** The closed `sev` vocabulary — the active df ramp plus the widest default.
 *  `stale` is deliberately excluded (D-08 orthogonality): staleness is the
 *  separate honest-state toggle, never a ramp chip. */
export type HostSevFacet = "all" | Exclude<Severity, "stale">;

/** The whitelisted facet state parsed from the URL. */
export interface HostFacets {
  sev: HostSevFacet;
  stale: boolean;
}

/**
 * The minimal loaded-row shape the filter and sort read (a structural subset of
 * the host card model the Hosts route loads). Only these flags drive the view;
 * severity is read, never re-derived.
 */
export interface HostFilterRow {
  /** Stable host identifier — also the deterministic sort tiebreak. */
  hostId: string;
  /** The df rollup severity already computed for the loaded host. */
  severity: Severity;
  /** The host's honest stale/no-telemetry flag (D-08) — no fresh data. */
  stale: boolean;
}

// ── Closed vocabulary (typed against the source union, never free strings) ──
const SEV_VALUES = new Set<Exclude<Severity, "stale">>([
  "critical",
  "warning",
  "watch",
  "healthy",
]);

const isSev = (v: string | null): v is Exclude<Severity, "stale"> =>
  v != null && SEV_VALUES.has(v as Exclude<Severity, "stale">);

/**
 * Parse a URLSearchParams into a whitelisted HostFacets. Never throws on bad
 * input — an invalid `?sev` (including the non-chip `stale` token) widens to
 * `"all"`, and any non-truthy `?stale` widens to `false` (V5). The stale toggle
 * is on for the `1`/`true` tokens only.
 */
export function parseHostFacets(params: URLSearchParams): HostFacets {
  const sev = params.get("sev");
  const stale = params.get("stale");
  return {
    sev: isSev(sev) ? sev : "all",
    stale: stale === "1" || stale === "true",
  };
}

/**
 * A PURE VIEW over the loaded host set. A row is KEPT when it satisfies EVERY
 * active facet (AND semantics); an `"all"`/`false` facet matches everything.
 * The sev facet matches the rollup severity exactly; the stale toggle keeps only
 * stale/no-telemetry hosts. Never sorts (the caller's loaded order is preserved)
 * and never mutates the input array. Filtering a non-empty set to zero matches
 * yields `[]` so the page can show the honest "nothing matches" empty state.
 */
export function applyHostFilters<T extends HostFilterRow>(hosts: T[], facets: HostFacets): T[] {
  return hosts.filter(
    (host) =>
      (facets.sev === "all" || host.severity === facets.sev) &&
      (!facets.stale || host.stale),
  );
}

/**
 * Worst-first ordering group per row (Open Q3 pin). Lower = earlier:
 *   0 critical · 1 warning · 2 watch · 3 stale group · 4 healthy.
 *
 * Severity wins over staleness: an at-risk host keeps its severity band even
 * when its data is stale — staleness must never bury a critical. Only an
 * otherwise-quiet host (healthy rollup, or a literal `stale` severity) with no
 * fresh telemetry falls into the stale group — AFTER at-risk, BEFORE healthy.
 * severity-map.ts's RAMP_RANK is module-private (deliberately: it excludes stale,
 * which this sort must place), so the grouping lives here as the sort's own table.
 */
function sortGroup(row: HostFilterRow): number {
  switch (row.severity) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    case "watch":
      return 2;
    case "stale":
      return 3;
    case "healthy":
      return row.stale ? 3 : 4;
  }
}

/**
 * The ONE sanctioned Phase-14 sort (D-08): severity rank desc, stale/no-telemetry
 * hosts grouped after at-risk but before healthy, healthy last, ties broken by
 * hostId ascending. Returns a NEW array — the input is never mutated. View-side
 * over loaded card models only; NEVER applied to assembleIncidents children
 * (engine-order-is-LAW).
 */
export function sortHostsWorstFirst<T extends HostFilterRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ga = sortGroup(a);
    const gb = sortGroup(b);
    if (ga !== gb) return ga - gb;
    return a.hostId < b.hostId ? -1 : a.hostId > b.hostId ? 1 : 0;
  });
}
