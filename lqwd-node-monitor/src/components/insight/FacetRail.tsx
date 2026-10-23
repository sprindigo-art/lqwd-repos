import Link from "next/link";

import type { DetectorId, Severity } from "@/lib/insight/types";
import type { ActionFacetKey, FacetCounts, FacetState } from "@/lib/insight/triage";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import { serializeFacets } from "@/lib/insight/triage-facets";
import { FacetDropdown } from "@/components/insight/FacetDropdown";
import { cn } from "@/lib/utils";

// =====================================================
// FacetRail — collapsible facet filter rail (Phase 7, INBOX-02)
// =====================================================
// SERVER component, the left column of the `.syn` CSS-grid swap (NOT a vendored
// shadcn sidebar — the rail-off toggle is a client affordance owned by the
// 07-04 InboxTriage island; this component renders the rail CONTENT + counts).
//
// Counts come from `facetCounts(view.cards)` — computed server-side over the
// UNFILTERED set (Pitfall 2 / threat T-07-11), so the rail always shows
// fleet-wide totals that never drift when a facet is active. Each facet is a
// <Link> that TOGGLES that facet value in the query string via `serializeFacets`
// (server re-render, D-09). The active facet highlights in navy (`.facet.on`) —
// navy reserved for structure/active state only (design contract).
//
// SETTLED CONTRACT (OQ-1, 07-RESEARCH lines 375-378 — binding for 07-03 + 07-04):
// facet links strip ?card — a facet change closes the drawer. Every href is
// built from `serializeFacets(nextFacetState)` ONLY; it MUST NOT carry forward
// the current ?card param. The drawer (07-04) opens solely off ?card, so
// omitting it from facet links closes the drawer on any facet change by
// construction. (The verify grep asserts no `card=` token appears here.)

/** Toggle a value within one facet dimension (OR within a dimension). */
function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

/** href for toggling a facet value — facets ONLY, never ?card (OQ-1 settled). */
function facetHref(next: FacetState): string {
  const query = serializeFacets(next);
  return query.length > 0 ? `/inbox?${query}` : "/inbox";
}

const SEVERITY_ORDER: readonly Severity[] = ["critical", "warn", "info"];

/** Plain-English action-facet labels (uppercase mono, no glyphs). */
const ACTION_LABELS: Record<ActionFacetKey, string> = {
  update_fee: "UPDATE FEE",
  close_channel: "CLOSE CHANNEL",
  rebalance: "REBALANCE",
  remediate_pending: "REMEDIATE PENDING",
  investigate: "INVESTIGATE",
  none: "NO ACTION",
};

interface FacetLinkProps {
  href: string;
  label: string;
  count: number;
  active: boolean;
}

/**
 * One `.facet` row — a multi-select checkbox marker (navy when active), the
 * label, and a right-aligned count. The whole row is a <Link> that TOGGLES this
 * value in the URL, so several values can be active at once (OR within a
 * dimension, AND across dimensions). Navy appears only on the active marker
 * (structure/active state — design contract).
 */
function FacetLink({ href, label, count, active }: FacetLinkProps) {
  return (
    <Link
      href={href}
      scroll={false}
      role="checkbox"
      aria-checked={active}
      className={cn("facet uppercase", active && "on")}
    >
      <span className={cn("fcheck", active && "on")} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-start tracking-[0.06em]">{label}</span>
      <span className="fc tabular-nums">{count}</span>
    </Link>
  );
}

interface FacetRailProps {
  /** Counts over the UNFILTERED set (facetCounts(view.cards)). */
  counts: FacetCounts;
  /** Active facet selection (parseFacets(searchParams)). */
  facets: FacetState;
}

export function FacetRail({ counts, facets }: FacetRailProps) {
  // Node facet rows sorted by descending count, then alias — stable, readable.
  const nodeEntries = Object.entries(counts.node).sort(
    (a, b) => b[1].count - a[1].count || (a[1].alias ?? a[0]).localeCompare(b[1].alias ?? b[0]),
  );
  const signalEntries = Object.entries(counts.signal) as [DetectorId, number][];
  const actionEntries = Object.entries(counts.action) as [ActionFacetKey, number][];

  return (
    <nav
      aria-label="Filter recommendations"
      className="railpane flex flex-col gap-1.5 overflow-hidden rounded-df-card border border-df-border bg-df-surface p-2"
    >
      <FacetDropdown heading="severity" activeCount={facets.sev.length} total={SEVERITY_ORDER.length}>
        {SEVERITY_ORDER.map((sev) => {
          const active = facets.sev.includes(sev);
          return (
            <FacetLink
              key={sev}
              href={facetHref({ ...facets, sev: toggle(facets.sev, sev) })}
              label={sev}
              count={counts.severity[sev]}
              active={active}
            />
          );
        })}
      </FacetDropdown>

      {nodeEntries.length > 0 && (
        <FacetDropdown heading="node" activeCount={facets.node.length} total={nodeEntries.length}>
          {nodeEntries.map(([pubkey, { alias, count }]) => {
            const active = facets.node.includes(pubkey);
            return (
              <FacetLink
                key={pubkey}
                href={facetHref({ ...facets, node: toggle(facets.node, pubkey) })}
                label={alias ?? pubkey}
                count={count}
                active={active}
              />
            );
          })}
        </FacetDropdown>
      )}

      {signalEntries.length > 0 && (
        <FacetDropdown
          heading="signal"
          activeCount={facets.signal.length}
          total={signalEntries.length}
        >
          {signalEntries.map(([signal, count]) => {
            const active = facets.signal.includes(signal);
            return (
              <FacetLink
                key={signal}
                href={facetHref({ ...facets, signal: toggle(facets.signal, signal) })}
                label={SIGNAL_LABELS[signal]}
                count={count}
                active={active}
              />
            );
          })}
        </FacetDropdown>
      )}

      {actionEntries.length > 0 && (
        <FacetDropdown
          heading="action"
          activeCount={facets.action.length}
          total={actionEntries.length}
        >
          {actionEntries.map(([action, count]) => {
            const active = facets.action.includes(action);
            return (
              <FacetLink
                key={action}
                href={facetHref({ ...facets, action: toggle(facets.action, action) })}
                label={ACTION_LABELS[action]}
                count={count}
                active={active}
              />
            );
          })}
        </FacetDropdown>
      )}
    </nav>
  );
}
