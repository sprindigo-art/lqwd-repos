
import { PENDING_RECENCY_HOURS } from "@/lib/console/config";
import {
  buildPendingView,
  currentPendingChannels,
  currentPendingSweeps,
  type PendingView,
} from "@/lib/read/pending";
import { PendingBoard } from "@/components/console/PendingBoard";
import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { BoardEmpty } from "@/components/df/BoardEmpty";

// Shared operator nav — every surface reachable from every screen.
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

// Live warehouse read at request time (Server Component) — never prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Root layout template renders this as "Pending | NodeMonitor".
export const metadata = { title: "Pending" };

// =====================================================
// PENDING-01 / D-11 — the fleet-wide pending board at /pending
// =====================================================
// The fleet half of the two pending surfaces (the per-node half is the
// console's Pending tab). Reads ONLY via the sanctioned recency-filtered
// readers in src/lib/read/pending.ts (T-03-18 — bare reads would show months
// of resolved residue as live), shapes once through buildPendingView, and
// hands the view to PendingBoard scope="fleet" VERBATIM (T-02-07): grouping
// by node, oldest-first ordering, and sweep nesting all happened in the
// shaper — nothing is re-derived here.
//
// Display-only per D-13: no age judgment, no row-level red/yellow — the
// stuck detector is Phase 4. No window picker either: the recency horizon is
// the PENDING_RECENCY_HOURS config tunable, not an operator control.
//
// Routing note (assumption A1): this static /pending segment wins over the
// dynamic [pubkey] sibling in App Router resolution — and PUBKEY_RE would
// 404 the literal "pending" anyway (not 66 hex chars).

export default async function FleetPendingPage() {
  let view: PendingView;
  try {
    const [channels, sweeps] = await Promise.all([
      currentPendingChannels(PENDING_RECENCY_HOURS),
      currentPendingSweeps(PENDING_RECENCY_HOURS),
    ]);
    view = buildPendingView(channels, sweeps);
  } catch (error) {
    console.error("Fleet pending load failed:", error);
    return (
      <BoardError
        active="pending"
        opsNav={OPS_NAV}
        title="Pending"
        heading="Couldn't load Pending."
        body="The warehouse didn't respond. Your data is unchanged — this view is read-only. Check the connection and reload."
      />
    );
  }

  const isEmpty = view.nodes.length === 0;

  return (
    <NavRailShell
      active="pending"
      title="Pending"
      opsNav={OPS_NAV}
      showViewToggle={false}
      showFleetSummary={false}
      // Freshness standardized to the top-bar PollAge (audit F) — same as
      // nodes/hosts — instead of an in-page FreshnessStamp.
      pollSinceMs={view.asOf?.getTime()}
    >
      <div className="flex flex-col gap-6">
      {/* Header composition mirrors the overview: Display-role title left.
          Freshness now lives in the shared top-bar PollAge (audit F). */}
      <header className="flex flex-col gap-1">
        <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-df-ink">
          Pending channels
        </h1>
        <p className="text-sm text-df-muted">
          opens, coop closes, and force closes across the fleet · grouped by node, oldest first
        </p>
      </header>

      {isEmpty ? (
        // The page owns the locked fleet empty state (PendingBoard renders
        // null on a fully-empty view by design — UI-SPEC §Copywriting).
        <BoardEmpty
          heading="Nothing pending fleet-wide"
          body="No pending opens, coop closes, or force closes on any node. New pending channels appear here, oldest first."
        />
      ) : (
        // Fleet board (sketch 004 winner B): a totals strip over a counts +
        // drill-in node list. PendingBoard owns its own panel chrome now, so
        // the page no longer double-wraps it in a section/panel-head.
        <PendingBoard view={view} scope="fleet" />
        )}
      </div>
    </NavRailShell>
  );
}
