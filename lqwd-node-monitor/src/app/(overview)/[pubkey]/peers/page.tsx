import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadFleetView, latestNodeInfoFallback } from "@/lib/scorecard/fleet";
import { peersTabData, type PeersTabView } from "@/lib/console/peers";
import { latestChannelsForNode, projectChannelBaseline } from "@/lib/read/latest";
import { aggregateLiquidityByPeer } from "@/lib/read/liquidity-split";
import { parsePageParam, slicePage } from "@/lib/console/paginate";
import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { NodeDetailTabs } from "@/components/node/NodeDetailTabs";
import { NodePeersTable } from "@/components/node/NodePeersTable";
import { cn, FOCUS_RING } from "@/lib/utils";

// Live warehouse read at request time (Server Component) — never prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// =====================================================
// NODE-04 — the /{pubkey}/peers sub-route (G1 + G2 + G4)
// =====================================================
// The peers surface broken off the heavy single-scroll Node Detail (G1): a real RSC
// sub-route that server-renders ONLY the channel-partner table, paginated. Each peer
// row carries a per-peer capacity-weighted liquidity gauge (G4) and links to that
// peer's channels (G2, NodePeersTable).
//
// PEER SOURCE (T-13-13-02): peers are CHANNEL COUNTERPARTIES via the sanctioned
// `peersTabData` — NEVER a COUNT over the cumulative lnd_node_peer_info lifetime log
// (Pitfall 5). The per-peer local/remote split comes from the real channel rows via
// `aggregateLiquidityByPeer`; peersTabData carries capacity but not the routable
// split, so the gauge's lean is derived from `latestChannelsForNode`, honest-empty
// when unknowable (T-13-13-03 — no fabricated split).
//
// Validation gauntlet (ASVS V5, T-13-13-01) — BEFORE any read:
//   1. PUBKEY_RE on the pubkey segment          → notFound()
//   2. resolve the node (fleet + PERF-01 no-404) → notFound() on a never-seen pubkey
// The optional ?focus peer is PUBKEY_RE-validated too (an invalid ?focus is silently
// ignored, never concatenated anywhere). Supplementary reads are fail-soft (`.catch`)
// so one broken layer degrades to an honest-empty gauge, never a page crash.

const PUBKEY_RE = /^[0-9a-f]{66}$/;

/** Operator nav — the shared six-item rail so a read failure never dead-ends (B2). */
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

/** Per-request dedupe so generateMetadata + the page share ONE fleet read. */
const getFleet = cache(loadFleetView);

function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

/** Read the FIRST value of a raw searchParams entry (arrays widen to their head). */
function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

interface PageProps {
  params: Promise<{ pubkey: string }>;
  // Next delivers repeated params as string[] — the sibling sub-routes' honest
  // type + firstParam discipline (IN-04).
  searchParams: Promise<{ page?: string | string[]; focus?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { pubkey } = await params;
  if (!PUBKEY_RE.test(pubkey)) return { title: "Node not found" };
  const fleet = await getFleet();
  const node =
    fleet.nodes.find((n) => n.pubkey === pubkey) ?? (await latestNodeInfoFallback(pubkey));
  if (!node) return { title: "Node not found" };
  return { title: `${node.alias ?? shortPubkey(node.pubkey)} — Peers` };
}

export default async function NodePeersPage({ params, searchParams }: PageProps) {
  const { pubkey } = await params;

  // ── Gate 1 (ASVS V5) — validate the segment BEFORE any warehouse read. ───────
  if (!PUBKEY_RE.test(pubkey)) notFound();

  // ── Gate 2 — resolve the node (bounded fleet OR PERF-01 single-node fallback). ─
  // WR-02: the gate reads are try/catch-guarded — a warehouse outage renders the
  // honest read-only degrade copy (the /{pubkey} overview pattern), never a raw
  // 500 and never a fake 404. notFound() stays OUTSIDE the try.
  let node: Awaited<ReturnType<typeof latestNodeInfoFallback>> = null;
  let loadFailed = false;
  try {
    const fleet = await getFleet();
    node = fleet.nodes.find((n) => n.pubkey === pubkey) ?? (await latestNodeInfoFallback(pubkey));
  } catch (error) {
    console.error("Peers node resolution failed:", error);
    loadFailed = true;
  }

  if (loadFailed) {
    // B2 — honest read-failure INSIDE the shell so the rail/nav never vanishes.
    return (
      <BoardError
        active="nodes"
        opsNav={OPS_NAV}
        title="Peers"
        heading="Couldn't load this node."
        body="The warehouse/telemetry reads didn't respond. Your data is unchanged — this view is read-only. Check the connections and reload."
      />
    );
  }

  if (node === null) notFound();

  const sp = await searchParams;
  const pageParam = firstParam(sp.page);
  const focusParam = firstParam(sp.focus);
  // ?focus is operator-editable — only a format-valid peer is honored (invalid ignored).
  const focus = focusParam !== undefined && PUBKEY_RE.test(focusParam) ? focusParam : undefined;

  // ── Fail-soft reads (strictly AFTER validation), each `.catch`-guarded. ──────
  // WR-05: the latest-channel rows are read ONCE and the same snapshot feeds both
  // the partner rows (via peersTabData) and the per-peer liquidity gauges — two
  // separate reads of the event-driven table could disagree mid-request.
  const rawChannels = await latestChannelsForNode(pubkey).catch((error: unknown) => {
    console.error("Latest channels load failed:", error);
    return null;
  });
  const peers = await peersTabData(pubkey, rawChannels ?? undefined).catch((error: unknown) => {
    console.error("Peers load failed:", error);
    return { headline: { numPeers: null, shownPartners: 0 }, rows: [], asOf: null } as PeersTabView;
  });

  // Per-peer routable split from the REAL channel rows (never fabricated).
  const channelRows = rawChannels ? rawChannels.map((row) => projectChannelBaseline(row)) : [];
  const liquidityByPeer = aggregateLiquidityByPeer(channelRows);

  const total = peers.rows.length;

  // When a valid ?focus peer exists AND is a known partner, land on ITS page so the
  // highlight is visible; otherwise honor ?page (clamped by parsePageParam).
  const focusIndex =
    focus !== undefined ? peers.rows.findIndex((r) => r.remotePubkey === focus) : -1;
  const frame = parsePageParam(pageParam, { total });
  const { pageCount, pageSize } = frame;
  const page = focusIndex >= 0 ? Math.floor(focusIndex / pageSize) + 1 : frame.page;

  const pageRows = slicePage(peers.rows, page, pageSize);

  const alias = node.alias ?? shortPubkey(node.pubkey);
  const numPeersLabel = peers.headline.numPeers === null ? "—" : peers.headline.numPeers.toLocaleString("en-US");

  // Pager hrefs preserve ?focus so paging never drops the incoming highlight context.
  const focusQuery = focus !== undefined ? `&focus=${focus}` : "";
  const prevHref = page > 1 ? `/${pubkey}/peers?page=${page - 1}${focusQuery}` : null;
  const nextHref = page < pageCount ? `/${pubkey}/peers?page=${page + 1}${focusQuery}` : null;

  return (
    <NavRailShell active="nodes" title={alias} subtitle="Peers" showFleetSummary={false} showLivePill={false}>
      {/* B10 — the dense peers table takes the full shell width (no reading-column cap). */}
      <div className="flex flex-col gap-6 pb-16">
        <NodeDetailTabs pubkey={pubkey} active="peers" alias={alias} counts={{ peers: peers.headline.shownPartners }} />

        {/* Honest headline: connected peers (num_peers) vs shown channel partners.
            NO CSV export here (unlike the channels/forwards siblings): peers is a
            DERIVED live-state partner view — a snapshot of the current channel graph,
            not an exportable latest-state table or event log. The full-width headline
            (no export slot) makes that omission deliberate, not an accidental gap (audit E). */}
        <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
          {numPeersLabel} connected peers · showing {peers.headline.shownPartners.toLocaleString("en-US")}{" "}
          channel partners
        </div>

        <NodePeersTable
          pubkey={pubkey}
          rows={pageRows}
          liquidityByPeer={liquidityByPeer}
          focus={focus}
        />

        {/* Prev/Next pager — preserves ?focus; omitted when a single page. */}
        {pageCount > 1 && (
          <nav
            aria-label="Peers pagination"
            className="flex items-center justify-between font-df-mono text-[11.5px] text-df-muted"
          >
            {prevHref ? (
              <Link href={prevHref} className={cn("rounded-df-btn text-df-brand hover:underline", FOCUS_RING)}>
                ← Prev
              </Link>
            ) : (
              <span className="text-df-muted">← Prev</span>
            )}
            <span className="tabular-nums">
              Page {page} of {pageCount}
            </span>
            {nextHref ? (
              <Link href={nextHref} className={cn("rounded-df-btn text-df-brand hover:underline", FOCUS_RING)}>
                Next →
              </Link>
            ) : (
              <span className="text-df-muted">Next →</span>
            )}
          </nav>
        )}
      </div>
    </NavRailShell>
  );
}
