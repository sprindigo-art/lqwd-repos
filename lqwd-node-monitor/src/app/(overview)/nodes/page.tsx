import type { ReactNode } from "react";

import { loadFleetView } from "@/lib/scorecard/fleet";
import type { GradedDimension, ScorecardView } from "@/lib/scorecard/types";
import { applyNodeFilters, parseNodeFacets } from "@/lib/overview/node-filter";
import type { Severity } from "@/components/df/Severity";
import { NavRailShell, type FleetCounts, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { BoardEmpty } from "@/components/df/BoardEmpty";
import { NodeFilters } from "@/components/node/NodeFilters";
import { NodesTable, type NodeRow } from "@/components/node/NodesTable";

// Live warehouse read at request time (Server Component) — never prerendered. A
// `"use client"` directive here would fail the build: `loadFleetView` reaches the
// server-only warehouse clients. The interactive concerns (filter chips, column
// sort) live in the two client islands below; this page only reads, maps, filters.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Nodes" };

// ─────────────────────────────────────────────────────────────
// Operator nav — the shared rail, now with the Nodes surface (D-R7). Mirrors the
// overview's array so every screen reaches the fleet.
// ─────────────────────────────────────────────────────────────
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

/**
 * scorecard node → df Severity (mirrors the overview's `nodeSeverity`): stale
 * dominates, else the node's own critical/warn/ok dot. This is a switch on the
 * SCORECARD's own field, NOT a df-sev→class chain (sanctioned per the overview).
 */
function nodeSeverity(node: ScorecardView): Severity {
  if (node.stale) return "stale";
  switch (node.dot) {
    case "critical":
      return "critical";
    case "warn":
      return "warning";
    case "ok":
      return "healthy";
  }
}

/** Find a graded dimension on the loaded scorecard by key (evidence, wired not re-queried). */
function dimOf(node: ScorecardView, key: GradedDimension["key"]): GradedDimension | undefined {
  return node.dimensions.find((d) => d.key === key);
}

/**
 * Map a loaded `ScorecardView` to the serializable table row. Every evidence
 * figure is READ from the already-computed scorecard dimensions — no new read,
 * no unit math here (the AFM-002 formatters apply at render in the table).
 */
function toRow(node: ScorecardView): NodeRow {
  const channelHealth = dimOf(node, "channelHealth");
  const liquidity = dimOf(node, "liquidity");
  const revenue = dimOf(node, "revenue");
  const routing = dimOf(node, "routing");
  return {
    pubkey: node.pubkey,
    alias: node.alias,
    backend: node.backend,
    severity: nodeSeverity(node),
    stale: node.stale,
    reason: node.reason,
    asOf: node.asOf,
    activeChannels: channelHealth?.extras?.activeChannels ?? null,
    liquidityRatio: liquidity?.raw ?? null,
    localSat: liquidity?.extras?.localSat ?? null,
    remoteSat: liquidity?.extras?.remoteSat ?? null,
    forwards7d: routing?.raw ?? null,
    earnings7dSat: revenue?.extras?.earnings7dSat ?? null,
  };
}

/** Fleet ramp/tally counts from the node severities (stale is honest, not folded into ok). */
function countSeverities(rows: NodeRow[]): FleetCounts {
  const counts: FleetCounts = { crit: 0, warn: 0, watch: 0, ok: 0 };
  for (const row of rows) {
    if (row.severity === "critical") counts.crit += 1;
    else if (row.severity === "warning") counts.warn += 1;
    else if (row.severity === "watch") counts.watch += 1;
    else if (row.severity === "healthy") counts.ok += 1;
  }
  return counts;
}

/** Mono uppercase section kicker (overview grammar). */
function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
      {children}
    </div>
  );
}

/** The zero-credential posture strip — verbatim copy, navy structural chrome. */
function SafetyFooter() {
  return (
    <footer className="rounded-df-card border border-df-border bg-[#EAEEF6] px-5 py-4">
      <p className="text-[13.5px] leading-relaxed text-df-ink">
        <span className="font-semibold">Zero node credentials stored.</span>{" "}
        <span className="text-df-muted">
          NodeMonitor reads and ranks; it never changes the fleet. High-risk fixes export as
          commands you run — the AI explains, it never executes.
        </span>
      </p>
    </footer>
  );
}

export default async function NodesListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Whitelist the operator-editable ?type/?status/?stale params (V5): invalid
  // values silently widen the view, never throw.
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) for (const v of value) usp.append(key, v);
    else if (value !== undefined) usp.append(key, value);
  }
  const facets = parseNodeFacets(usp);
  const isFiltered = facets.type !== "all" || facets.status !== "all" || facets.stale;

  let fetchedAt: Date;
  let allRows: NodeRow[];
  try {
    const fleet = await loadFleetView();
    fetchedAt = fleet.fetchedAt;
    allRows = fleet.nodes.map(toRow);
  } catch (error) {
    // Page-level honest-error fallback — read-only view, nothing was mutated.
    // Stays inside the shell (audit B2) so a warehouse blip never strands the operator.
    console.error("Nodes list load failed:", error);
    return (
      <BoardError
        active="nodes"
        opsNav={OPS_NAV}
        title="Nodes"
        heading="Couldn't load the fleet."
        body="The warehouse reads didn't respond. Your data is unchanged — this view is read-only. Check the connections and reload."
      />
    );
  }

  const rows = applyNodeFilters(allRows, facets);

  return (
    <NavRailShell
      active="nodes"
      title="Nodes"
      subtitle="Fleet"
      counts={countSeverities(allRows)}
      // Honest chrome: the pill ticks from the REAL fetch epoch — no fake "Live".
      pollSinceMs={fetchedAt.getTime()}
      opsNav={OPS_NAV}
      showViewToggle={false}
    >
      <div className="flex flex-col gap-6 pb-16">
        {/* Header grammar mirrors inbox/pending/queue: h1 + one-line description
            (audit B5) so the board has a real heading outline for AT. */}
        <header className="flex flex-col gap-1">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-df-ink">Nodes</h1>
          <p className="text-sm text-df-muted">
            the fleet, ranked worst-first · evidence per node · read-only until you act
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <SectionKicker>NODES · {rows.length}</SectionKicker>
          <NodeFilters facets={facets} />
        </section>

        {rows.length === 0 ? (
          isFiltered && facets.status === "at-risk" ? (
            <BoardEmpty
              heading="All nodes healthy."
              body="Every node is reporting fresh — nothing needs attention right now."
            />
          ) : isFiltered ? (
            <BoardEmpty
              heading="No matching nodes."
              body="Clear the filter to see the full fleet."
            />
          ) : (
            <BoardEmpty
              heading="No nodes reporting yet."
              body="The fleet read returned no nodes — nothing to show."
            />
          )
        ) : (
          <NodesTable rows={rows} />
        )}

        <SafetyFooter />
      </div>
    </NavRailShell>
  );
}
