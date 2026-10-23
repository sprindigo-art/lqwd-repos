import Link from "next/link";

import { cn, FOCUS_RING } from "@/lib/utils";

// =====================================================
// NodeDetailTabs — the shared Node-Detail sub-nav strip (Server)
// =====================================================
// The ONE tab bar rendered on the lean overview AND every routed sub-route
// (channels / peers / forwards), so the four Node-Detail surfaces are a single
// click-navigable set (gate feedback G1/G2, locked structure 2026-07-09). Each tab
// is a `next/link` to a real RSC sub-route (code-split, deep-linkable, paginated) —
// this component owns ONLY the nav chrome, never the data.
//
// COLOR LAW (13-UI-SPEC § Color): the active-tab marker is the NAVY STRUCTURAL
// treatment (df-brand text + a brand underline, mirroring NavRailShell's OperatorNav)
// — structure/action, NEVER a severity hue. A tab being current is navigation state,
// not health state. `active` is a PROP (not `usePathname`) so this stays a Server
// Component — the page that renders it knows its own active key.
//
// Optional `counts` render a small mono count beside a label ONLY when a real number
// is supplied (the overview passes channel/peer counts; sub-routes may omit) — an
// undefined count renders no badge, never a fabricated 0.

/** The four Node-Detail surfaces, in bar order. */
const TAB_KEYS = ["overview", "channels", "peers", "forwards"] as const;

/** Which Node-Detail surface is current. */
export type NodeDetailTab = (typeof TAB_KEYS)[number];

/** Optional real counts rendered beside the Channels / Peers labels. */
export interface NodeDetailTabCounts {
  channels?: number;
  peers?: number;
}

export interface NodeDetailTabsProps {
  /** The owning node pubkey (66-hex) — the base of every sub-route href. */
  pubkey: string;
  /** The current surface — its tab carries the navy structural active marker. */
  active: NodeDetailTab;
  /** Optional honest counts beside labels (overview supplies these; sub-routes may omit). */
  counts?: NodeDetailTabCounts;
  /**
   * Optional node alias — when provided, renders a compact identity header (a
   * "← Nodes" back link + the alias) above the tab bar so the sub-route tabs name
   * the node. The overview tab omits it (its richer NodeHeader already identifies
   * the node).
   */
  alias?: string;
}

/** Build one tab's definition: label, href, and its optional count key. */
function tabDefs(pubkey: string): { key: NodeDetailTab; label: string; href: string }[] {
  return [
    { key: "overview", label: "Overview", href: `/${pubkey}` },
    { key: "channels", label: "Channels", href: `/${pubkey}/channels` },
    { key: "peers", label: "Peers", href: `/${pubkey}/peers` },
    { key: "forwards", label: "Forwards", href: `/${pubkey}/forwards` },
  ];
}

/** The count for a tab, if the caller supplied one (undefined ⇒ no badge). */
function countFor(key: NodeDetailTab, counts?: NodeDetailTabCounts): number | undefined {
  if (counts === undefined) return undefined;
  if (key === "channels") return counts.channels;
  if (key === "peers") return counts.peers;
  return undefined;
}

/**
 * The shared Node-Detail tab bar. Renders Overview / Channels / Peers / Forwards as
 * `next/link` entries; the `active` tab gets the navy structural marker. Server-safe.
 */
export function NodeDetailTabs({ pubkey, active, counts, alias }: NodeDetailTabsProps) {
  return (
    <div className="flex flex-col gap-3">
      {alias !== undefined && (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/nodes"
            className={cn("rounded-df-btn font-df-mono text-[11.5px] text-df-brand hover:underline", FOCUS_RING)}
          >
            ← Nodes
          </Link>
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-df-ink">{alias}</h1>
        </div>
      )}
      <nav
        aria-label="Node detail"
        data-testid="node-detail-tabs"
        className="flex items-center gap-0.5 border-b border-df-border"
      >
      {tabDefs(pubkey).map((tab) => {
        const isActive = tab.key === active;
        const count = countFor(tab.key, counts);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            data-tab={tab.key}
            data-active={isActive ? "true" : undefined}
            className={cn(
              "relative rounded-df-btn px-3 py-[7px] font-df-mono text-[11.5px] tracking-[0.07em] uppercase transition-colors",
              isActive
                ? "font-semibold text-df-brand"
                : "text-df-muted hover:bg-df-border-soft hover:text-df-ink",
              FOCUS_RING,
            )}
          >
            {tab.label}
            {typeof count === "number" && (
              <span className="ms-1.5 font-semibold tabular-nums text-df-ink" data-testid={`tab-count-${tab.key}`}>
                {count}
              </span>
            )}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-df-brand"
              />
            )}
          </Link>
        );
      })}
      </nav>
    </div>
  );
}
