"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import type { Severity } from "@/components/df/Severity";
import { severityLabel } from "@/components/df/Severity";
import type { IncidentLayer } from "@/lib/overview/incidents";
import type { OverviewFacets } from "@/lib/overview/filter";
import { cn } from "@/lib/utils";

// =====================================================
// QueueFilters — layer + severity toggle-chip island (OVW-05 / D-09)
// =====================================================
// "use client" island. Filtering is a PURE VIEW over the same grouped incident
// set (D-09): each chip is a <Link> that TOGGLES its facet value in the URL query
// string, so the server re-renders the narrowed view and the filter is
// reload-/back-safe (the URL is the single source of truth — mirrors the Phase-7
// triage-facets URL-sync approach). `parseOverviewFacets` on the page whitelists
// whatever lands in `?layer` / `?sev`, so a hand-edited URL degrades to a wider
// view, never an error (V5).
//
// DS-01 (DS-01 / sketch-findings): the active chip is navy STRUCTURE chrome
// (`bg-df-brand` fill / white text) — navy does structure + active state, NEVER a
// health hue. The severity ramp is state-only and appears NOWHERE as chip chrome,
// so the severity chips do NOT tint themselves by their own severity; they read
// the same navy-active / hairline-inactive treatment as the layer chips. Chip
// labels for severities come from `severityLabel` (no `if (sev === …)` chains).

/** Toggle a value within one facet dimension (OR within the dimension). */
function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

/**
 * Serialize facets to a query-relative href (`?layer=…&sev=…`). Keys are emitted
 * in a fixed order (layer, sev), each as a repeated key. An empty state clears the
 * query (`?`), resolving against the current path so the chip never hardcodes a
 * route — the page that mounts this island owns the path.
 */
function hrefFor(next: OverviewFacets): string {
  const sp = new URLSearchParams();
  for (const layer of next.layer) sp.append("layer", layer);
  for (const sev of next.sev) sp.append("sev", sev);
  const query = sp.toString();
  return query.length > 0 ? `?${query}` : "?";
}

/** Layer chip vocabulary + display copy (UI-SPEC §5; `bitcoind` stays lowercase). */
const LAYER_CHIPS: ReadonlyArray<{ value: IncidentLayer; label: string }> = [
  { value: "hosts", label: "Hosts" },
  { value: "services", label: "Services" },
  { value: "bitcoind", label: "bitcoind" },
  { value: "nodes", label: "Nodes" },
  { value: "storage", label: "Storage" },
];

/** The filterable severity chips — labels via `severityLabel`, no inline strings. */
const SEVERITY_CHIPS: readonly Severity[] = ["critical", "warning", "watch"];

/** Shared chip chrome — navy structural fill when active, hairline + muted when not. */
function chipClass(active: boolean): string {
  return cn(
    "inline-flex items-center rounded-df-pill border px-2.5 py-1 font-df-mono text-[11.5px] font-medium tracking-[0.02em] transition-colors",
    active
      ? "border-df-brand bg-df-brand text-white"
      : "border-df-border text-df-muted hover:border-df-brand/40 hover:text-df-brand",
  );
}

interface QueueFiltersProps {
  /** The current whitelisted facets (parsed from the URL by the page / island). */
  facets: OverviewFacets;
  /**
   * OPTIONAL client-toggle handler. When provided, chips render as
   * `<button type="button">` firing `onToggle(dim, value)` — a pure CLIENT toggle
   * with NO navigation (the island owns facet state + URL sync). An empty layer
   * `value` clears the layer dimension (the "All" chip). When ABSENT, chips fall
   * back to the reload-safe `<Link>` hrefs (back-compat for any server caller).
   */
  onToggle?: (dim: "layer" | "sev", value: string) => void;
  /** Extra classes merged last via `cn()`. */
  className?: string;
}

/**
 * A single chip that renders as a client `<button>` (when `onClick` is given) or a
 * reload-safe `<Link>` (when `href` is given). Exactly one of the two paths is
 * active — the caller decides based on whether an `onToggle` handler was supplied.
 */
function Chip({
  active,
  label,
  href,
  onClick,
}: {
  active: boolean;
  label: ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  if (onClick !== undefined) {
    return (
      <button type="button" onClick={onClick} aria-pressed={active} className={chipClass(active)}>
        {label}
      </button>
    );
  }
  return (
    <Link href={href ?? "?"} aria-pressed={active} className={chipClass(active)}>
      {label}
    </Link>
  );
}

/**
 * The layer + severity toggle-chip row. With `onToggle` the chips are client
 * buttons that flip facet state in place (no navigation, no re-fetch); without it
 * each chip is a reload-safe `<Link>` that toggles its value in the URL. Either
 * way the active chip carries navy structural chrome (DS-01).
 */
export function QueueFilters({ facets, onToggle, className }: QueueFiltersProps) {
  const layerActive = facets.layer.length === 0;

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}
      role="group"
      aria-label="Filter the attention queue"
    >
      {/* Layer dimension — leads with an "All" chip that clears the layer facet. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          active={layerActive}
          label="All"
          href={onToggle ? undefined : hrefFor({ ...facets, layer: [] })}
          onClick={onToggle ? () => onToggle("layer", "") : undefined}
        />
        {LAYER_CHIPS.map(({ value, label }) => {
          const active = facets.layer.includes(value);
          return (
            <Chip
              key={value}
              active={active}
              label={label}
              href={onToggle ? undefined : hrefFor({ ...facets, layer: toggle(facets.layer, value) })}
              onClick={onToggle ? () => onToggle("layer", value) : undefined}
            />
          );
        })}
      </div>

      {/* Severity dimension — chips read navy structural chrome, never a sev hue. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {SEVERITY_CHIPS.map((sev) => {
          const active = facets.sev.includes(sev);
          return (
            <Chip
              key={sev}
              active={active}
              label={severityLabel[sev]}
              href={onToggle ? undefined : hrefFor({ ...facets, sev: toggle(facets.sev, sev) })}
              onClick={onToggle ? () => onToggle("sev", sev) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
