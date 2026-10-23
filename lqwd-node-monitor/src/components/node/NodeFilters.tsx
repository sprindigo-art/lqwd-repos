"use client";

import Link from "next/link";

import type {
  NodeFacets,
  NodeStatusFacet,
  NodeTypeFacet,
} from "@/lib/overview/node-filter";
import type { Backend } from "@/lib/read/nodes";
import { cn } from "@/lib/utils";

// =====================================================
// NodeFilters — type / status / stale toggle-chip island (NODE-03 · A2)
// =====================================================
// "use client" island. Filtering is a PURE VIEW over the loaded fleet: each chip
// is a reload-safe <Link> that sets its facet in the URL query string, so the RSC
// page re-runs `parseNodeFacets` + `applyNodeFilters` over the SAME (TTL-memoized)
// fleet read — a chip click narrows the view, never re-queries the warehouse. The
// URL is the single source of truth; a hand-edited value degrades to a wider view
// (V5, `parseNodeFacets` whitelists), never an error.
//
// DS-01: the active chip is navy STRUCTURE chrome (`bg-df-brand` / white) — navy
// does structure + active state, NEVER a health hue. The status chips do not tint
// themselves by severity; every chip reads the same navy-active / hairline-inactive
// treatment (identical grammar to `QueueFilters`).

/** Serialize facets to a query-relative href — `?` clears when everything is the widest default. */
function hrefFor(next: NodeFacets): string {
  const sp = new URLSearchParams();
  if (next.type !== "all") sp.set("type", next.type);
  if (next.status !== "all") sp.set("status", next.status);
  if (next.stale) sp.set("stale", "1");
  const query = sp.toString();
  return query.length > 0 ? `?${query}` : "?";
}

/** Shared chip chrome — navy structural fill when active, hairline + muted when not. */
function chipClass(active: boolean): string {
  return cn(
    "inline-flex items-center rounded-df-pill border px-2.5 py-1 font-df-mono text-[11.5px] font-medium tracking-[0.02em] transition-colors",
    active
      ? "border-df-brand bg-df-brand text-white"
      : "border-df-border text-df-muted hover:border-df-brand/40 hover:text-df-brand",
  );
}

function Chip({ active, label, href }: { active: boolean; label: string; href: string }) {
  return (
    <Link href={href} aria-pressed={active} className={chipClass(active)}>
      {label}
    </Link>
  );
}

const TYPE_CHIPS: ReadonlyArray<{ value: NodeTypeFacet; label: string }> = [
  { value: "all", label: "All" },
  { value: "lnd" satisfies Backend, label: "LND routing" },
  { value: "ldk" satisfies Backend, label: "LDK/LSP" },
];

const STATUS_CHIPS: ReadonlyArray<{ value: NodeStatusFacet; label: string }> = [
  { value: "all", label: "All" },
  { value: "healthy", label: "Healthy" },
  { value: "at-risk", label: "At-risk" },
  { value: "offline", label: "Offline" },
];

export function NodeFilters({ facets }: { facets: NodeFacets }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2"
      role="group"
      aria-label="Filter the fleet"
    >
      {/* Type facet. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TYPE_CHIPS.map(({ value, label }) => (
          <Chip
            key={value}
            active={facets.type === value}
            label={label}
            href={hrefFor({ ...facets, type: value })}
          />
        ))}
      </div>

      {/* Status facet. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_CHIPS.map(({ value, label }) => (
          <Chip
            key={value}
            active={facets.status === value}
            label={label}
            href={hrefFor({ ...facets, status: value })}
          />
        ))}
      </div>

      {/* Stale-only toggle (single boolean facet). */}
      <Chip
        active={facets.stale}
        label="Stale only"
        href={hrefFor({ ...facets, stale: !facets.stale })}
      />
    </div>
  );
}
