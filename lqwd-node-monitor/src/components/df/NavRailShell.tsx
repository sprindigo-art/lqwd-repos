import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, Server, Shield, Zap } from "lucide-react";

import { cn, FOCUS_RING } from "@/lib/utils";
import { PollAge } from "./PollAge";
import { RefreshControl } from "./RefreshControl";

// =====================================================
// NavRailShell — 60px navy rail + sticky top bar with operator instrumentation
// =====================================================
// Adapts MastheadNav's active-link `cn()` grammar to the prototype's vertical
// navy LEFT rail (prototype Ops Center 39-88) + sticky top bar. The active nav
// key is a PROP (not `usePathname`) so the shell stays a Server Component — the
// page that renders it knows its own active key.
//
// G5 rebuild — the top bar now reproduces the prototype's operator
// instrumentation as reusable, props-driven parts (gap-analysis #8):
//   1. Fleet ramp bar — segmented severity proportion strip (crit/warn/watch/ok).
//   2. Tally counts — `4 crit · 1 warn · 2 watch · 19 ok` with severity coloring.
//   3. View-tab toggle — "Mid-incident / All clear" segmented control.
//   4. Live-poll pill — "Live · polled Ns ago" with a green ring status dot.
//   5. Bottom avatar — the rail's `margin-top:auto` user affordance.
// All five are ADDITIVE/optional with sensible defaults, so existing callers
// (the gallery) keep compiling and the shell stays a Server Component — the
// view-tab toggle renders as presentational markup (active state via prop; the
// page wires navigation via per-tab `href`), never a client `onClick`.

/** The rail's nav keys (icons per D-06). */
const RAIL_ITEMS = [
  { key: "ops", href: "/", label: "Home", Icon: Activity },
  { key: "nodes", href: "/nodes", label: "Nodes", Icon: Zap },
  { key: "hosts", href: "/hosts", label: "Hosts", Icon: Server },
  { key: "security", href: "/security", label: "Security", Icon: Shield },
] as const;

/** Active nav key — the page declares which rail item is current. */
export type NavKey = (typeof RAIL_ITEMS)[number]["key"];

// ─────────────────────────────────────────────────────────────────────────────
// Fleet severity instrumentation (ramp + tally)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four fleet severity buckets the top-bar instruments summarize. Mirrors the
 * prototype `counts` object (`{crit,warn,watch,ok}`, Ops Center logic 747). These
 * are the SET-DISJOINT health states — chrome/brand never appears here.
 */
export interface FleetCounts {
  crit: number;
  warn: number;
  watch: number;
  ok: number;
}

/**
 * The ramp/tally bucket order + their df severity token classes. The order is the
 * prototype's left-to-right crit→warn→watch→ok ramp; each bucket carries the
 * bright NON-TEXT severity hue (ramp fill) and the AA-text hue (tally count).
 */
const FLEET_BUCKETS = [
  { key: "crit", label: "crit", fill: "bg-df-critical", text: "text-df-critical" },
  { key: "warn", label: "warn", fill: "bg-df-warning", text: "text-df-warning" },
  { key: "watch", label: "watch", fill: "bg-df-watch", text: "text-df-watch" },
  { key: "ok", label: "ok", fill: "bg-df-ok", text: "text-df-ok-text" },
] as const;

/**
 * The 230px segmented severity ramp — one flex segment per non-zero bucket, width
 * proportional to its share of the fleet. When every node is ok the ramp is a solid
 * ok strip (prototype: `isAllClear ? [{w:'100%',c:ok}] : […]`). Decorative — the
 * tally below carries the accessible numbers, so the ramp is `aria-hidden`.
 */
function FleetRamp({ counts }: { counts: FleetCounts }) {
  const total = counts.crit + counts.warn + counts.watch + counts.ok;
  // Honest empty-fleet guard: a zero total would divide-by-zero; render the neutral
  // track with no segments rather than NaN widths.
  const segments =
    total > 0
      ? FLEET_BUCKETS.filter((b) => counts[b.key] > 0).map((b) => ({
          key: b.key,
          fill: b.fill,
          // toFixed(1) matches the prototype's `pct()` rounding so widths sum cleanly.
          width: `${((counts[b.key] / total) * 100).toFixed(1)}%`,
        }))
      : [];

  return (
    <div
      aria-hidden="true"
      className="flex h-[9px] w-[230px] overflow-hidden rounded-df-pill bg-df-border"
      data-testid="fleet-ramp"
    >
      {segments.map((seg) => (
        <span
          key={seg.key}
          className={cn("h-full", seg.fill)}
          style={{ width: seg.width }}
          data-ramp-seg={seg.key}
        />
      ))}
    </div>
  );
}

/**
 * The `4 crit · 1 warn · 2 watch · 19 ok` tally — the accessible companion to the
 * ramp. Each count is the bright severity TEXT hue; the label stays muted. Tabular
 * numerals keep the counts from jittering as they tick (prototype `.v2-num`).
 */
function FleetTally({ counts }: { counts: FleetCounts }) {
  return (
    <div className="flex gap-3 font-df-mono text-[11.5px] tabular-nums text-df-muted">
      {FLEET_BUCKETS.map((b) => (
        <span key={b.key}>
          <b className={cn("font-semibold", b.text)}>{counts[b.key]}</b> {b.label}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Operator nav (top-bar navigation)
// ─────────────────────────────────────────────────────────────────────────────

/** One top-bar operator-nav destination. `count` is an OPTIONAL honest open-count. */
export interface OpsNavItem {
  /** Stable key, matched against the shell `active` key for the current underline. */
  key: string;
  /** Visible link label (e.g. "Ops Center", "Inbox"). */
  label: string;
  /** Navigation target surface. */
  href: string;
  /** Optional real open-count — renders a trailing badge ONLY when a number is given. */
  count?: number;
}

/**
 * The default operator nav — every surface reachable from every screen so no page
 * is a nav dead-end (D-R7). Pages that don't pass their own `opsNav` (e.g. the node
 * detail tabs) inherit the full six-item bar, matching home/nodes/hosts.
 */
const DEFAULT_OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

/**
 * The top-bar operator nav row. Mono uppercase links; the item whose `key` matches
 * the shell's active key gets the df-brand text + a brand underline, the rest are
 * muted → hover ink. A count badge renders ONLY when the page supplies a real number
 * (undefined omits the badge — never a fabricated 0/placeholder, T-12-15-02).
 */
function OperatorNav({ items, active }: { items: OpsNavItem[]; active: string }) {
  return (
    <nav aria-label="Operator" className="flex items-center gap-0.5" data-testid="operator-nav">
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative rounded-df-btn px-3 py-[7px] font-df-mono text-[11.5px] tracking-[0.07em] uppercase transition-colors",
              FOCUS_RING,
              isActive
                ? "font-semibold text-df-brand"
                : "text-df-muted hover:bg-df-border-soft hover:text-df-ink",
            )}
          >
            {item.label}
            {typeof item.count === "number" && (
              <span className="ms-1.5 font-semibold text-df-critical" data-testid={`opsnav-count-${item.key}`}>
                {item.count}
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View-tab toggle (segmented control)
// ─────────────────────────────────────────────────────────────────────────────

/** One segmented view-tab (prototype `mkTab`): a key, a label, and an optional href. */
export interface ViewTab {
  /** Stable key matched against `activeView` to pick the selected segment. */
  key: string;
  /** Visible segment label (e.g. "Mid-incident" / "All clear"). */
  label: string;
  /** Optional navigation target — when present the segment is a `Link`. */
  href?: string;
}

/** The prototype's two-state Mid-incident / All clear toggle (logic 752). */
const DEFAULT_VIEW_TABS: ViewTab[] = [
  { key: "incident", label: "Mid-incident" },
  { key: "allclear", label: "All clear" },
];

/**
 * The "Preview" segmented view toggle. Presentational + Server-safe: the selected
 * segment is driven by the `activeView` prop (not client state), and each segment
 * navigates via its `href` when supplied. The active segment lifts onto a white
 * chip with a soft shadow; the rest are transparent muted text (prototype 80).
 */
function ViewToggle({
  tabs,
  activeView,
  label,
}: {
  tabs: ViewTab[];
  activeView: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-[7px]" data-testid="view-toggle">
      <span className="text-[11px] text-df-muted">{label}</span>
      <div
        role="tablist"
        aria-label="Fleet view"
        className="flex rounded-df-btn bg-df-border-soft p-0.5"
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeView;
          const segClass = cn(
            "rounded-df-pill px-[11px] py-[5px] text-[11.5px] font-semibold whitespace-nowrap transition-colors",
            FOCUS_RING,
            isActive
              ? "bg-df-surface text-df-chrome shadow-df-rest"
              : "bg-transparent text-df-muted hover:text-df-ink",
          );
          const common = {
            role: "tab" as const,
            "aria-selected": isActive,
            "data-view-tab": tab.key,
            "data-active": isActive ? "true" : undefined,
            className: segClass,
          };
          return tab.href !== undefined ? (
            <Link key={tab.key} href={tab.href} {...common}>
              {tab.label}
            </Link>
          ) : (
            <span key={tab.key} {...common}>
              {tab.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live-poll status pill
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a poll age in seconds into the prototype's compact relative label
 * (`4s` / `3m` / `2h`). Mirrors the glanceable recency the operator scans for —
 * not a wall-clock stamp. Negative/NaN ages clamp to `0s` (honest, never `-`).
 */
export function formatPollAge(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/**
 * The "Live · polled Ns ago" pill with a green ring status dot (prototype 83-86).
 * The dot uses the ok NON-TEXT hue with a soft ring; the age is bold tabular ink.
 */
function LivePollPill({ pollAgeSeconds }: { pollAgeSeconds: number }) {
  return (
    <div
      className="flex items-center gap-2 rounded-df-btn border border-df-border bg-df-surface px-3 py-[7px] text-xs text-df-muted"
      data-testid="live-poll-pill"
    >
      <span
        aria-hidden="true"
        className="size-[7px] rounded-full bg-df-ok shadow-[0_0_0_3px_rgba(30,158,99,0.13)]"
      />
      Live · polled{" "}
      <span className="font-semibold tabular-nums text-df-ink">
        {formatPollAge(pollAgeSeconds)}
      </span>{" "}
      ago
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell
// ─────────────────────────────────────────────────────────────────────────────

interface NavRailShellProps {
  /**
   * The active surface key. A `NavKey` highlights the matching left-rail icon; any
   * other operator-nav key (inbox/pending/queue) still underlines its top-bar item
   * without a rail icon. Widened to string so the triage surfaces can share the shell.
   */
  active: NavKey | (string & {});
  /** Page title shown in the sticky top bar. */
  title: string;
  /** Optional subtitle under the title. */
  subtitle?: string;
  /**
   * Top-bar operator nav items. Defaults to Ops Center · Inbox · Pending · Queue
   * so the overview can reach the triage/approval surfaces (D-R7). The item whose
   * `key` equals `active` is underlined as the current surface.
   */
  opsNav?: OpsNavItem[];
  /**
   * The REAL fetch epoch (ms). When provided AND `showLivePill`, the pill renders
   * the honest ticking <PollAge/> ("data as of HH:MM:SS · Ns ago") INSTEAD of the
   * fake "Live" green-dot pill — no live-connection claim (D-R7 / T-12-15-01).
   */
  pollSinceMs?: number;
  /**
   * REAL fleet severity counts powering the ramp + tally. The summary renders
   * ONLY when a page supplies real counts — there is no fabricated all-clear
   * baseline (U2): omitting counts omits the ramp/tally entirely, so a solid
   * green "26 ok" strip can never render during live criticals.
   */
  counts?: FleetCounts;
  /** View-tab definitions for the segmented toggle. Defaults to Mid-incident/All clear. */
  viewTabs?: ViewTab[];
  /** The selected view-tab key. Defaults to the first tab ("incident"). */
  activeView?: string;
  /** Leading label on the view toggle (prototype "Preview"). */
  viewLabel?: string;
  /**
   * DEMO-ONLY (the gallery): an EXPLICIT static poll age renders the prototype's
   * "Live · polled Ns ago" pill. Real pages must pass `pollSinceMs` instead —
   * when NEITHER is supplied the shell renders an honest "no data yet" stamp,
   * never a fake "Live · polled 0s ago" claim (U3).
   */
  pollAgeSeconds?: number;
  /** Hide the live-poll pill when a page has no polling context. */
  showLivePill?: boolean;
  /** Hide the fleet ramp + tally (e.g. non-fleet pages). */
  showFleetSummary?: boolean;
  /** Hide the view-tab toggle. */
  showViewToggle?: boolean;
  /**
   * Optional EXTRA right-aligned top-bar slot, rendered before the toggle/pill.
   * Kept for back-compat — the gallery passes a token caption here.
   */
  topBarEnd?: ReactNode;
  /**
   * Content width. `"default"` keeps the centered 1180px reading column every
   * console page has used; `"wide"` lets a dense grid page (e.g. Hosts) stretch
   * edge-to-edge so its cards can breathe. Defaults to `"default"`.
   */
  contentWidth?: "default" | "wide";
  /** Page content. */
  children: ReactNode;
}

/**
 * The v2 application shell: a fixed 60px navy rail (with a bottom avatar) on the
 * left, a sticky blurred top bar carrying the fleet ramp/tally + view toggle +
 * live-poll pill, and a centered content container. Server Component.
 */
export function NavRailShell({
  active,
  title,
  subtitle,
  opsNav = DEFAULT_OPS_NAV,
  pollSinceMs,
  counts,
  viewTabs = DEFAULT_VIEW_TABS,
  activeView,
  viewLabel = "Preview",
  pollAgeSeconds,
  showLivePill = true,
  showFleetSummary = true,
  // The fleet "Preview / Mid-incident / All clear" toggle is overview-specific;
  // every other surface (nodes, hosts, node detail) hides it. Default off so pages
  // relying on defaults (the node-detail tabs) don't show a spurious toggle.
  showViewToggle = false,
  topBarEnd,
  // Fill the screen by default — wasting horizontal space is a global anti-pattern
  // for this dense NOC. A page can still opt back into the centered reading column
  // with contentWidth="default" if its content genuinely reads better narrow.
  contentWidth = "wide",
  children,
}: NavRailShellProps) {
  // Default the selected view to the first tab so the toggle always has one active
  // segment even when the page does not steer it.
  const selectedView = activeView ?? viewTabs[0]?.key ?? "";

  return (
    <div className="relative min-h-screen bg-df-bg">
      {/* Fixed 60px navy left rail. */}
      <nav
        aria-label="Primary"
        className="fixed inset-y-0 left-0 z-30 flex w-[60px] flex-col items-center gap-1.5 bg-df-chrome py-3.5"
      >
        <span className="mb-5 flex size-8 items-center justify-center rounded-df-btn bg-white">
          <span className="size-3 rounded-[4px] border-[2.5px] border-df-chrome" aria-hidden="true" />
        </span>
        {RAIL_ITEMS.map(({ key, href, label, Icon }) => {
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={href}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex size-10 items-center justify-center rounded-[11px] transition-colors",
                FOCUS_RING,
                isActive
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon className="size-[19px]" strokeWidth={1.9} aria-hidden="true" />
            </Link>
          );
        })}
        {/* Bottom-pinned avatar affordance (prototype `margin-top:auto` circle). */}
        <span
          aria-hidden="true"
          data-testid="rail-avatar"
          className="mt-auto size-8 rounded-full bg-df-chrome-accent"
        />
      </nav>

      {/* Content column offset past the rail. */}
      <div className="ml-[60px] min-w-0 flex-1">
        {/* Sticky blurred top bar. `flex-wrap` + `gap-y` so the six-item nav +
            230px ramp + tally + right cluster reflow instead of clipping below
            ~1300px laptop widths (audit D). */}
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-df-border bg-df-bg/90 px-8 py-3.5 backdrop-blur-md">
          {/* Compact breadcrumb — page/entity identity that persists on scroll
              (audit B4). Subtle mono; the divider separates it from the nav. */}
          <div className="flex min-w-0 items-center gap-2.5" data-testid="breadcrumb">
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate font-df-mono text-[11.5px] font-semibold tracking-[0.05em] text-df-ink">
                {title}
              </span>
              {subtitle !== undefined && (
                <span className="truncate font-df-mono text-[10.5px] text-df-muted">
                  {subtitle}
                </span>
              )}
            </span>
            <span aria-hidden="true" className="h-6 w-px flex-none bg-df-border" />
          </div>

          {/* Operator nav — working links off the overview (D-R7): no dead-end. */}
          <OperatorNav items={opsNav} active={active} />

          {/* Fleet ramp + tally (severity pulse) — REAL counts only (U2). No
              counts → no summary; a fabricated solid-green baseline never renders. */}
          {showFleetSummary && counts !== undefined && (
            <div className="ms-5 flex items-center gap-2.5" data-testid="fleet-summary">
              <FleetRamp counts={counts} />
              <FleetTally counts={counts} />
            </div>
          )}

          {/* Right cluster: extra slot, view toggle, live pill. */}
          <div className="ms-auto flex items-center gap-3">
            {topBarEnd !== undefined && topBarEnd}
            {showViewToggle && (
              <ViewToggle tabs={viewTabs} activeView={selectedView} label={viewLabel} />
            )}
            {/* On-demand + auto warehouse re-read, beside the "data as of" stamp.
                Mounted unconditionally, so every NavRailShell page gets it. */}
            <RefreshControl />
            {showLivePill &&
              (pollSinceMs !== undefined ? (
                // Honest path (D-R7): a ticking data-AGE, no "Live"/green dot.
                <PollAge sinceMs={pollSinceMs} />
              ) : pollAgeSeconds !== undefined ? (
                // EXPLICIT demo path (the gallery only): the static "Live" pill.
                <LivePollPill pollAgeSeconds={pollAgeSeconds} />
              ) : (
                // Honest no-data stamp (U3): no fetch epoch → say so. Never a
                // fabricated "Live · polled 0s ago" claim.
                <span
                  data-testid="poll-no-data"
                  className="font-df-mono text-xs text-df-muted"
                >
                  no data yet
                </span>
              ))}
          </div>
        </header>

        <main
          className={cn(
            "mx-auto px-8 py-6",
            contentWidth === "wide" ? "max-w-none" : "max-w-[1180px]",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
