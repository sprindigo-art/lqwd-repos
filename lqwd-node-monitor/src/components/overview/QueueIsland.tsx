"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

import type { GroupedIncident, IncidentLayer } from "@/lib/overview/incidents";
import type { DetectorId } from "@/lib/insight/types";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import { applyFilter, type OverviewFacets } from "@/lib/overview/filter";
import { serviceDisplay } from "@/lib/overview/service-display";
import { severityLabel, type Severity } from "@/components/df/Severity";
import { SeverityCard, type SeverityChild } from "@/components/df/SeverityCard";
import { CategoryIcon, categoryFor } from "@/components/df/CategoryIcon";
import { QueueFilters } from "@/components/overview/QueueFilters";

// =====================================================
// QueueIsland — client-side filtered attention queue (OVW-01/OVW-05, backlog #1)
// =====================================================
// The hero + attention queue + filter chips + filtered-empty state used to render
// on the SERVER, so every filter chip was a `<Link>` that changed the URL and
// re-ran all five ~8s warehouse reads. Filtering is a PURE, ISOMORPHIC view
// (`applyFilter` — D-09), so it belongs in the browser: the server assembles the
// full `GroupedIncident[]` ONCE and hands it here; this island narrows it from
// client facet state (instant, zero re-fetch) and keeps the URL in sync via
// `history.replaceState` (reload-/share-safe) WITHOUT any `router.push/refresh`.
//
// The AI band, fleet-vitals grid, healthy collapse and safety footer stay on the
// server page — only the filter-reactive block moved here.
//
// DS-01: severity is STATE only. The hero/queue cards map sev→class through the
// df primitives' own mappers; the filter chips read navy STRUCTURE chrome via
// `QueueFilters` (never a severity hue). Service rows are RELABELED through
// `serviceDisplay` so the raw machine key never reaches the screen (backlog #9).

/**
 * Map one grouped child to the condensed SeverityRow record (D-R5/D-R6):
 *   [category icon] single label ─────────── right-pinned severity status
 *
 * • `icon` — the NEUTRAL category glyph for the child's (layer, feeKind); severity
 *   never rides the icon (T-12-14-03), only the right-pinned status color.
 * • `node` — the single label: service rows relabel via `serviceDisplay` (#9), fee
 *   rows read the count phrase (`why`), everything else its `entityLabel`.
 * • `status` — regular rows show the severity STATE word colored by `severityText`;
 *   fee rows show a NAVY structural "fees →" (no severity color) and route to the
 *   node's fees tab via `href` (`/{pubkey}/fees`). Fee rows are never critical (#4).
 * • `note` is intentionally omitted so the row never echoes its own label.
 */
// The reason shown on a NODE child row (quick 260721-gqi #3). Node rows must carry a
// human-readable reason, never a bare node name and never a raw machine signal key:
//   • a raw DetectorId `why` (e.g. "stuck_open") humanizes through SIGNAL_LABELS;
//   • a rollup / scorecard `why` (already a human phrase, e.g. "17 channels · …") passes
//     through verbatim;
//   • an empty `why` falls back to the entityLabel so the row is never blank.
// GATED to layer === "nodes" only — bitcoind ("bitcoind") and host ("host-metrics")
// rows keep their entityLabel (hostname) and must NEVER show their raw `why`.
function nodeRowLabel(child: GroupedIncident): ReactNode {
  const why = child.why;
  if (why.length === 0) return child.entityLabel;
  return SIGNAL_LABELS[why as DetectorId] ?? why;
}

function toSeverityChild(child: GroupedIncident): SeverityChild {
  const isFee = child.feeKind !== undefined;
  const label = isFee
    ? child.why
    : child.layer === "services"
      ? serviceDisplay(String(child.entityLabel)).label
      : child.layer === "nodes"
        ? nodeRowLabel(child)
        : child.entityLabel;
  return {
    sev: child.severity,
    node: label,
    icon: <CategoryIcon category={categoryFor(child.layer, child.feeKind)} />,
    status: isFee ? (
      <span className="font-semibold text-df-chrome">fees →</span>
    ) : (
      severityLabel[child.severity].toLowerCase()
    ),
    statusSev: isFee ? undefined : child.severity,
    href: isFee ? child.href : undefined,
  };
}

/** The non-critical children cap (D-R6): criticals are NEVER capped, the rest top-5. */
const NON_CRITICAL_CAP = 5;

/**
 * One attention-queue incident card (OVW-01). Collapsed to a one-liner by default;
 * the chevron expands the nested condensed child rows (D-R6/D-R8). When a LAYER
 * filter is active the card AUTO-EXPANDS so the 12-13-narrowed children are visible.
 * Child order is STABLE (no `.sort`): fee summaries (<=2) → ALL criticals (never
 * capped, T-12-14-01) → the non-critical top-5, with a "show N more" footer revealing
 * the rest.
 */
function QueueIncidentCard({
  incident,
  layerActive,
}: {
  incident: GroupedIncident;
  layerActive: boolean;
}) {
  // `expanded` defaults to the layer-filter state (auto-expand surviving cards) until
  // the operator explicitly toggles it (then the manual choice wins).
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [showAllNonCritical, setShowAllNonCritical] = useState(false);
  const expanded = userExpanded ?? layerActive;

  const children = incident.children;
  const grouped = children.length > 0;

  // STABLE partitions — preserve input (engine) order within each group, no `.sort`.
  const feeRows = children.filter((c) => c.feeKind !== undefined).slice(0, 2);
  const regular = children.filter((c) => c.feeKind === undefined);
  const criticals = regular.filter((c) => c.severity === "critical");
  const nonCriticals = regular.filter((c) => c.severity !== "critical");
  const shownNonCritical = showAllNonCritical
    ? nonCriticals
    : nonCriticals.slice(0, NON_CRITICAL_CAP);

  // [fee (<=2)] + [all criticals — never capped] + [non-critical top-5 / all].
  const displayed = [...feeRows, ...criticals, ...shownNonCritical];
  const rows = displayed.map(toSeverityChild);

  const hiddenNonCritical = nonCriticals.length - NON_CRITICAL_CAP;
  const childrenFooter =
    hiddenNonCritical > 0 ? (
      <button
        type="button"
        onClick={() => setShowAllNonCritical((v) => !v)}
        className="font-df-mono text-[11px] tracking-[0.05em] text-df-chrome uppercase hover:underline"
      >
        {showAllNonCritical ? "show less" : `show ${hiddenNonCritical} more (non-critical)`}
      </button>
    ) : undefined;

  const childCount = children.length;

  return (
    <SeverityCard
      sev={incident.severity}
      // The card headline links to the Incident Detail page (INC-01) keyed by the
      // engine `.key`; the nested child rows keep their own per-source deep-links
      // (fee → `/{pubkey}/fees`, etc.). Navy STRUCTURAL affordance (nav is action,
      // never a severity hue — DS-01); the key is a trusted engine value in an
      // INTERNAL relative href re-validated by the detail page's KEY_RE gate.
      title={
        <Link href={`/incidents/${incident.key}`} className="hover:underline">
          {incident.entityLabel}
        </Link>
      }
      why={incident.why}
      // Stale renders honestly as its OWN state (gold STALE pill + chip), never
      // recolored critical (D-08); a fresh incident shows the green freshness dot.
      stalePill={incident.stale}
      freshness={{ asOf: incident.asOf, stale: incident.stale }}
      expanded={expanded}
      onToggle={grouped ? () => setUserExpanded(!expanded) : undefined}
      expandLabel={expanded ? "Hide" : `${childCount} alert${childCount === 1 ? "" : "s"}`}
      childAlerts={grouped ? rows : undefined}
      childrenLabel={grouped ? `${childCount} alert${childCount === 1 ? "" : "s"} roll up` : undefined}
      childrenFooter={childrenFooter}
    />
  );
}

interface QueueIslandProps {
  /** The full grouped incident set (unfiltered) assembled once on the server. */
  incidents: GroupedIncident[];
  /** The whitelisted facets parsed from the URL on the server — the hydrate seed. */
  initialFacets: OverviewFacets;
}

/**
 * The client-side filtered attention queue. Holds facet state, derives the view
 * with the ISOMORPHIC `applyFilter` (same pure module the server uses), renders
 * the hero + queue + honest filtered-empty copy, and syncs the URL on every facet
 * change via `history.replaceState` — no server round-trip, no re-fetch.
 */
export function QueueIsland({ incidents, initialFacets }: QueueIslandProps) {
  const [facets, setFacets] = useState<OverviewFacets>(initialFacets);

  // Keep the URL in sync with client facet state (reload-/share-safe). This is a
  // pure history swap — NO `router.push`/`router.refresh`, so the Server Component
  // never re-runs and the warehouse reads never re-fire (backlog #1).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams();
    for (const layer of facets.layer) sp.append("layer", layer);
    for (const sev of facets.sev) sp.append("sev", sev);
    const query = sp.toString();
    const url = query.length > 0 ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [facets]);

  /** Flip a layer/severity value in state (empty layer value clears the dimension). */
  function handleToggle(dim: "layer" | "sev", value: string) {
    setFacets((prev) => {
      if (dim === "layer") {
        if (value === "") return { ...prev, layer: [] };
        const v = value as IncidentLayer;
        const has = prev.layer.includes(v);
        return {
          ...prev,
          layer: has ? prev.layer.filter((x) => x !== v) : [...prev.layer, v],
        };
      }
      const v = value as Severity;
      const has = prev.sev.includes(v);
      return {
        ...prev,
        sev: has ? prev.sev.filter((x) => x !== v) : [...prev.sev, v],
      };
    });
  }

  // The queue is a PURE view of the same grouped set (D-09) — no re-query/re-sort.
  // The worst incident is the FIRST queue card (no separate single-node hero — the
  // "Top priority" hero was removed as redundant; the AI band already says what
  // needs you now, and the queue is the full ranked list).
  const filtered = applyFilter(incidents, facets);
  const queue = filtered;

  // Honest filtered-empty copy — distinct from the all-clear state (OVW-05).
  const filteredLayerLabel = facets.layer.join(", ");
  const filteredSevLabel = facets.sev.map((s) => severityLabel[s].toLowerCase()).join(", ");
  const filteredEmptyHead = `No ${[filteredLayerLabel, filteredSevLabel].filter(Boolean).join(" / ") || "matching"} incidents right now.`;

  return (
    <>
      {/* Attention queue + filters (OVW-01 / OVW-05) — the full ranked incident list,
          worst-first. No separate top-priority hero. */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
            ATTENTION QUEUE · {queue.length}
          </div>
        </div>
        <QueueFilters facets={facets} onToggle={handleToggle} />

        {filtered.length === 0 ? (
          <div className="rounded-df-card border border-df-border bg-df-surface px-5 py-8 text-center">
            <div className="text-[15.5px] font-semibold text-df-ink">{filteredEmptyHead}</div>
            <p className="mx-auto mt-2 max-w-xl text-[13.5px] text-df-muted">
              Clear the filter to see the full attention queue.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map((incident) => (
              <QueueIncidentCard
                key={incident.key}
                incident={incident}
                layerActive={facets.layer.length > 0}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
