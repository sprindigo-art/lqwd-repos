import Link from "next/link";
import { notFound } from "next/navigation";

import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { NodeDetailTabs } from "@/components/node/NodeDetailTabs";
import { NodeForwardsTable } from "@/components/node/NodeForwardsTable";
import { ExportButton } from "@/components/console/ExportButton";
import { forwardsPageData, type ForwardsPageView } from "@/lib/console/forwards";
import { DEFAULT_PAGE_SIZE } from "@/lib/console/paginate";
import { DEFAULT_WINDOW, WINDOW_PRESETS, type WindowKey } from "@/lib/console/config";
import { latestNodeInfo } from "@/lib/read/node-info";
import { cn, FOCUS_RING } from "@/lib/utils";

// Live warehouse read at request time (Server Component) — never prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// =====================================================
// G1 — the routed forwards event log at /{pubkey}/forwards
// =====================================================
// The forwarding history lifted OFF the heavy single-scroll node page onto its
// own RSC sub-route (gate feedback G1): windowed (24h/7d/30d/90d) and SERVER-side
// OFFSET-paginated (forwardsPageData → buildForwardsPageSql). Each row's chan-in /
// chan-out links to the related channel(s) on /{pubkey}/channels?chan= (G2, owned
// by NodeForwardsTable). NODE-02 CSV export stays reachable via the sibling static
// `forwards/export/route.ts` (shared handler).
//
// Validation gauntlet (ASVS V5) — EVERYTHING before any warehouse read:
//   1. PUBKEY_RE on the pubkey segment                → notFound()
//   2. resolve the node (latestNodeInfo)              → notFound() on miss
// The ?window param is whitelist-mapped against WINDOW_PRESETS membership — the
// KEY is the SQL boundary (only the bound integer days reaches SQL, never a user
// string). ?page is parsed by forwardsPageData via parsePageParam (clamped int
// OFFSET, never string-interpolated). The page read is fail-soft (`.catch`) so a
// broken warehouse degrades to the honest-empty table, never a 500.

const PUBKEY_RE = /^[0-9a-f]{66}$/;
const WINDOW_KEYS = Object.keys(WINDOW_PRESETS) as WindowKey[];

/** Operator nav — the shared six-item rail so a read failure never dead-ends (B2). */
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

/** First value of a possibly-repeated search param. */
function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Truncate a 66-hex pubkey to the `8…6` glance form. */
function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

interface PageProps {
  params: Promise<{ pubkey: string }>;
  searchParams: Promise<{ window?: string | string[]; page?: string | string[] }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { pubkey } = await params;
  if (!PUBKEY_RE.test(pubkey)) return { title: "Node not found" };
  return { title: `${shortPubkey(pubkey)} — Forwards` };
}

export default async function NodeForwardsPage({ params, searchParams }: PageProps) {
  const { pubkey } = await params;

  // ── Validation gauntlet — before ANY read (ASVS V5). ────────────────────────
  if (!PUBKEY_RE.test(pubkey)) notFound();

  // WR-01: a warehouse OUTAGE is not a missing node — a rejected read renders the
  // honest read-only degrade copy (the /{pubkey} overview pattern); notFound() is
  // reserved for a RESOLVED-but-absent pubkey.
  let node: Awaited<ReturnType<typeof latestNodeInfo>> = null;
  let loadFailed = false;
  try {
    node = await latestNodeInfo(pubkey);
  } catch (error) {
    console.error("Forwards node resolution failed:", error);
    loadFailed = true;
  }

  if (loadFailed) {
    // B2 — honest read-failure INSIDE the shell so the rail/nav never vanishes.
    return (
      <BoardError
        active="nodes"
        opsNav={OPS_NAV}
        title="Forwards"
        heading="Couldn't load this node."
        body="The warehouse/telemetry reads didn't respond. Your data is unchanged — this view is read-only. Check the connections and reload."
      />
    );
  }

  // notFound() OUTSIDE the try — its control-flow signal is never swallowed.
  if (node === null) notFound();

  const sp = await searchParams;

  // ?window: accept ONLY a key present in WINDOW_PRESETS (whitelist) — the KEY is
  // the SQL boundary; anything else falls back to DEFAULT_WINDOW.
  const rawWindow = firstParam(sp.window);
  const windowKey: WindowKey =
    rawWindow != null && Object.prototype.hasOwnProperty.call(WINDOW_PRESETS, rawWindow)
      ? (rawWindow as WindowKey)
      : DEFAULT_WINDOW;

  // ?page is handed raw to forwardsPageData → parsePageParam (clamped int OFFSET).
  const rawPage = firstParam(sp.page);

  // Fail-soft: a broken warehouse read degrades to the honest-empty table.
  const view: ForwardsPageView | null = await forwardsPageData(pubkey, windowKey, rawPage).catch(
    (error: unknown) => {
      console.error("Forwards page read failed:", error);
      return null;
    },
  );

  const summary = view?.summary ?? { n: 0, totalAmtOutSat: 0, totalFeesSat: 0, avgFeeSat: null };
  const rows = view?.rows ?? [];
  const pagination = view?.pagination ?? {
    page: 1,
    offset: 0,
    pageCount: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };

  const alias = node.alias ?? shortPubkey(node.pubkey);
  const prevPage = pagination.page > 1 ? pagination.page - 1 : null;
  const nextPage = pagination.page < pagination.pageCount ? pagination.page + 1 : null;

  return (
    <NavRailShell active="nodes" title={alias} subtitle="Forwards" showFleetSummary={false} showLivePill={false}>
      {/* B10 — the dense forwards log takes the full shell width (no reading-column cap). */}
      <div className="flex flex-col gap-6 pb-16">
        <NodeDetailTabs pubkey={pubkey} active="forwards" alias={alias} />

        {/* Window selector (resets to page 1 by omitting ?page) + CSV export. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Forwards window"
            data-testid="forwards-window-selector"
            className="flex items-center gap-0.5"
          >
            {WINDOW_KEYS.map((key) => {
              const isActive = key === windowKey;
              return (
                <Link
                  key={key}
                  href={`/${pubkey}/forwards?window=${key}`}
                  data-window={key}
                  data-active={isActive ? "true" : undefined}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    // E — the active window is a FILLED/BORDERED navy chip matching the
                    // Prev/Next pager below (was color-only, which mismatched the pager).
                    "rounded-df-pill border px-3 py-1 font-df-mono text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors",
                    isActive
                      ? "border-df-brand bg-df-brand-tint text-df-brand"
                      : "border-transparent text-df-muted hover:border-df-border hover:bg-df-surface hover:text-df-ink",
                    FOCUS_RING,
                  )}
                >
                  {key}
                </Link>
              );
            })}
          </nav>
          <ExportButton href={`/${pubkey}/forwards/export?window=${windowKey}`} />
        </div>

        <NodeForwardsTable pubkey={pubkey} summary={summary} rows={rows} />

        {/* Server-side pager — preserves the validated window key. */}
        <nav
          aria-label="Forwards pagination"
          data-testid="forwards-pager"
          className="flex items-center justify-between gap-3"
        >
          <div className="font-df-mono text-[11px] tabular-nums text-df-muted">
            Page {pagination.page} of {pagination.pageCount}
          </div>
          <div className="flex items-center gap-2">
            {prevPage !== null ? (
              <Link
                href={`/${pubkey}/forwards?window=${windowKey}&page=${prevPage}`}
                rel="prev"
                className={cn(
                  "rounded-df-pill border border-df-border px-3 py-1 font-df-mono text-[11px] font-semibold tracking-[0.08em] text-df-brand uppercase hover:bg-df-surface",
                  FOCUS_RING,
                )}
              >
                Prev
              </Link>
            ) : (
              <span className="rounded-df-pill border border-df-border px-3 py-1 font-df-mono text-[11px] font-semibold tracking-[0.08em] text-df-muted uppercase">
                Prev
              </span>
            )}
            {nextPage !== null ? (
              <Link
                href={`/${pubkey}/forwards?window=${windowKey}&page=${nextPage}`}
                rel="next"
                className={cn(
                  "rounded-df-pill border border-df-border px-3 py-1 font-df-mono text-[11px] font-semibold tracking-[0.08em] text-df-brand uppercase hover:bg-df-surface",
                  FOCUS_RING,
                )}
              >
                Next
              </Link>
            ) : (
              <span className="rounded-df-pill border border-df-border px-3 py-1 font-df-mono text-[11px] font-semibold tracking-[0.08em] text-df-muted uppercase">
                Next
              </span>
            )}
          </div>
        </nav>
      </div>
    </NavRailShell>
  );
}
