import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadFleetView, latestNodeInfoFallback } from "@/lib/scorecard/fleet";
import {
  latestChannelsForNode,
  projectChannelBaseline,
  type ChannelBaseline,
} from "@/lib/read/latest";
import { parsePageParam, slicePage } from "@/lib/console/paginate";
import { approvedFeeIntentsByChanId } from "@/lib/read/approved-fee-intents";
import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { NodeDetailTabs } from "@/components/node/NodeDetailTabs";
import { NodeChannelsTable } from "@/components/node/NodeChannelsTable";
import { ExportButton } from "@/components/console/ExportButton";
import { cn, FOCUS_RING } from "@/lib/utils";

// Live warehouse + queue read at request time (Server Component) — never
// prerendered. The read helpers below are server-only (lazy DB clients).
export const dynamic = "force-dynamic";
export const revalidate = 0;

// =====================================================
// NODE-04 / G1+G2 — the channels sub-route at /{pubkey}/channels
// =====================================================
// The single-scroll Node Detail (13-08) rendered every channel inline; the operator
// gate (13-NODE-DETAIL-GATE-FEEDBACK) rejected the firehose. This is the real,
// paginated RSC sub-route that server-renders ONLY the channels table (G1 fast load,
// deep-linkable) and REUSES the 13-06 NodeChannelsTable verbatim (per-channel
// fee-queue + stale gate + withdraw) — it is NOT rebuilt.
//
// Validation gauntlet (ASVS V5, two-gate — mirrors 13-09):
//   1. PUBKEY_RE on the pubkey segment            → notFound() BEFORE any read.
//   2. The node resolves from the bounded fleet read OR the single-node fallback
//      (PERF-01 no-404 for >30d-stale nodes); a genuinely-never-seen pubkey 404s.
// The `?peer` / `?chan` interconnection filters (G2) are format-validated too: an
// invalid value is IGNORED (widens to unfiltered), never passed into a read — the
// filter is applied IN-MEMORY over the already-read rows.
//
// Task 4 wires the live withdraw path: approvedFeeIntentsByChanId(pubkey) → the
// `approvedByChanId` prop so an approved-but-unclaimed row actually renders Withdraw.

const PUBKEY_RE = /^[0-9a-f]{66}$/;
const CHAN_RE = /^\d+$/;

/** Operator nav — the shared six-item rail so a read failure never dead-ends (B2). */
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

/** Per-request dedupe so generateMetadata + the page share ONE warehouse read. */
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
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { pubkey } = await params;
  if (!PUBKEY_RE.test(pubkey)) return { title: "Node not found" };
  const fleet = await getFleet();
  const node =
    fleet.nodes.find((n) => n.pubkey === pubkey) ?? (await latestNodeInfoFallback(pubkey));
  if (!node) return { title: "Node not found" };
  return { title: `${node.alias ?? shortPubkey(node.pubkey)} — Channels` };
}

export default async function NodeChannelsPage({ params, searchParams }: PageProps) {
  const { pubkey } = await params;

  // ── Gate 1 (ASVS V5, T-13-12-01): validate the segment BEFORE any read. ──────
  if (!PUBKEY_RE.test(pubkey)) notFound();

  // ── Gate 2: resolve the node (bounded fleet OR PERF-01 single-node fallback). ─
  // WR-02: the gate reads are try/catch-guarded — a warehouse outage renders the
  // honest read-only degrade copy (the /{pubkey} overview pattern), never a raw
  // 500 and never a fake 404. notFound() stays OUTSIDE the try.
  let node: Awaited<ReturnType<typeof latestNodeInfoFallback>> = null;
  let loadFailed = false;
  try {
    const fleet = await getFleet();
    node = fleet.nodes.find((n) => n.pubkey === pubkey) ?? (await latestNodeInfoFallback(pubkey));
  } catch (error) {
    console.error("Channels node resolution failed:", error);
    loadFailed = true;
  }

  if (loadFailed) {
    // B2 — honest read-failure INSIDE the shell so the rail/nav never vanishes.
    return (
      <BoardError
        active="nodes"
        opsNav={OPS_NAV}
        title="Channels"
        heading="Couldn't load this node."
        body="The warehouse/telemetry reads didn't respond. Your data is unchanged — this view is read-only. Check the connections and reload."
      />
    );
  }

  if (node === null) notFound();

  const alias = node.alias ?? shortPubkey(node.pubkey);

  // ── Interconnection filters (G2). Format-validate BEFORE use; an invalid value
  //    widens to unfiltered (never a throw, never a bad value into a read). ──────
  const sp = await searchParams;
  const rawPeer = firstParam(sp.peer);
  const rawChan = firstParam(sp.chan);
  const peerFilter = rawPeer !== undefined && PUBKEY_RE.test(rawPeer) ? rawPeer : null;
  const chanFilter = rawChan !== undefined && CHAN_RE.test(rawChan) ? rawChan : null;

  // ── Reads (strictly AFTER validation), each fail-soft. ───────────────────────
  // The channels baseline + THIS node's approved-but-unclaimed update_fee intents;
  // the latter (already fail-soft to {}) makes the reused withdraw path live.
  const [rawChannels, approvedByChanId] = await Promise.all([
    latestChannelsForNode(pubkey).catch(() => [] as Record<string, unknown>[]),
    approvedFeeIntentsByChanId(pubkey),
  ]);
  const allRows: ChannelBaseline[] = rawChannels.map((row) => projectChannelBaseline(row));

  // In-memory interconnection filter over the already-read rows (never a query).
  const filteredRows = allRows.filter((row) => {
    if (peerFilter !== null && row.peerPubkey !== peerFilter) return false;
    if (chanFilter !== null && row.chanId !== chanFilter) return false;
    return true;
  });

  // ── Pagination over the (filtered) rows. ─────────────────────────────────────
  const frame = parsePageParam(firstParam(sp.page), { total: filteredRows.length });
  const pageRows = slicePage(filteredRows, frame.page, frame.pageSize);

  // Query-string preserving the active filter for the pager/clear links.
  const filterQs = new URLSearchParams();
  if (peerFilter !== null) filterQs.set("peer", peerFilter);
  if (chanFilter !== null) filterQs.set("chan", chanFilter);
  const filterQsString = filterQs.toString();
  const pageHref = (page: number) => {
    const qs = new URLSearchParams(filterQsString);
    if (page > 1) qs.set("page", String(page));
    const q = qs.toString();
    return q === "" ? `/${pubkey}/channels` : `/${pubkey}/channels?${q}`;
  };

  const filterActive = peerFilter !== null || chanFilter !== null;
  const filterLabel =
    peerFilter !== null
      ? `peer ${shortPubkey(peerFilter)}`
      : chanFilter !== null
        ? `channel ${chanFilter}`
        : "";

  return (
    <NavRailShell active="nodes" title={alias} subtitle="Channels" showFleetSummary={false} showLivePill={false}>
      {/* B10 — the dense channels table takes the full shell width (no reading-column
          cap); the cap belongs on the prose-y overview, not on the densest table. */}
      <div className="flex flex-col gap-6 pb-16">
        <NodeDetailTabs pubkey={pubkey} active="channels" alias={alias} counts={{ channels: allRows.length }} />

        {/* Section head: honest count + CSV export (NODE-02, latest-state window). */}
        <div className="flex items-center justify-between gap-4">
          <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
            Channels · {filterActive ? `${filteredRows.length} of ${allRows.length}` : allRows.length}
          </div>
          <ExportButton href={`/${pubkey}/channels/export?window=latest`} />
        </div>

        {/* Navy-structural filter affordance (G2) — a filter is navigation state,
            never a severity hue. Clear returns to the unfiltered sub-route. */}
        {filterActive && (
          <div className="flex items-center gap-3 font-df-mono text-[11.5px] text-df-muted">
            <span>
              Filtered by <span className="text-df-ink">{filterLabel}</span>
            </span>
            <Link
              href={`/${pubkey}/channels`}
              className={cn("rounded-df-btn font-semibold text-df-brand hover:underline", FOCUS_RING)}
            >
              clear
            </Link>
          </div>
        )}

        {/* B8 reuse — the paginated fee-queue table with the G2 peer link and the
            LIVE withdraw wiring: an approved-but-unclaimed row renders Withdraw. */}
        <NodeChannelsTable
          pubkey={pubkey}
          nodeLabel={alias}
          rows={pageRows}
          approvedByChanId={approvedByChanId}
          peerHrefBase={`/${pubkey}/peers`}
        />

        {/* Pager — Prev/Next preserve the active ?peer/?chan filter. */}
        {frame.pageCount > 1 && (
          <nav
            aria-label="Channels pagination"
            className="flex items-center justify-between font-df-mono text-[11.5px]"
          >
            {frame.page > 1 ? (
              <Link
                href={pageHref(frame.page - 1)}
                className={cn("rounded-df-btn font-semibold text-df-brand hover:underline", FOCUS_RING)}
              >
                ← Prev
              </Link>
            ) : (
              <span className="text-df-muted">← Prev</span>
            )}
            <span className="text-df-muted tabular-nums">
              Page {frame.page} of {frame.pageCount}
            </span>
            {frame.page < frame.pageCount ? (
              <Link
                href={pageHref(frame.page + 1)}
                className={cn("rounded-df-btn font-semibold text-df-brand hover:underline", FOCUS_RING)}
              >
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
