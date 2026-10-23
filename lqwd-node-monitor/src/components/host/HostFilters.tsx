"use client";

import Link from "next/link";

import type { HostFacets, HostSevFacet } from "@/lib/overview/host-filter";
import { cn } from "@/lib/utils";

// =====================================================
// HostFilters — sev / stale toggle-chip island (HOST-01 · A2)
// =====================================================
// A verbatim structural clone of `NodeFilters` with the HOSTS vocabulary.
// Filtering the Hosts list is a PURE VIEW over the loaded fleet: each chip is a
// reload-safe <Link> that sets its facet in the URL query string, so the RSC page
// re-runs `parseHostFacets` + `applyHostFilters` over the SAME host read — a chip
// click narrows the view, never re-queries the warehouse. The URL is the single
// source of truth; a hand-edited value degrades to a wider view (V5,
// `parseHostFacets` whitelists), never an error.
//
// DS-01: the active chip is navy STRUCTURE chrome (`bg-df-brand` / white) — navy
// does structure + active state, NEVER a health hue. The sev chips do NOT tint
// themselves by severity; every chip reads the same navy-active / hairline-inactive
// treatment (identical grammar to `NodeFilters`).

/** Serialize facets to a query-relative href — `?` clears when everything is the widest default. */
function hrefFor(next: HostFacets): string {
  const sp = new URLSearchParams();
  if (next.sev !== "all") sp.set("sev", next.sev);
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

// The sev facet — the direct df ramp (MINUS stale) plus the widest default. Navy
// chrome only; the chip NEVER paints its own severity hue (DS-01).
const SEV_CHIPS: ReadonlyArray<{ value: HostSevFacet; label: string }> = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "watch", label: "Watch" },
  { value: "healthy", label: "Healthy" },
];

export function HostFilters({ facets }: { facets: HostFacets }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-5 gap-y-2"
      role="group"
      aria-label="Filter the hosts"
    >
      {/* Severity facet. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SEV_CHIPS.map(({ value, label }) => (
          <Chip
            key={value}
            active={facets.sev === value}
            label={label}
            href={hrefFor({ ...facets, sev: value })}
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
