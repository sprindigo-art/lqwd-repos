import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, Server } from "lucide-react";

import { NavRailShell } from "@/components/df/NavRailShell";
import { TwoAxisPip } from "@/components/df/TwoAxisPip";
import { FreshnessChip } from "@/components/df/FreshnessChip";

// =====================================================
// C1 — ServiceDetailShell + ServiceHeader (SVC-02, Server)
// =====================================================
// The Service Detail chrome + identity block for ONE service, composed as a thin
// wrapper over the shipped primitives. It renders inside `NavRailShell` (the v2
// app shell) and leads with a `ServiceHeader` carrying:
//   • the service DISPLAY name (never the raw machine key — resolved upstream via
//     serviceDisplay().label and passed in as `serviceLabel`),
//   • the owning node (mono, links back to Node Detail) + its host id,
//   • a FULL-SIZE two-axis health block (the same locked `TwoAxisPip` grammar the
//     grid uses, expanded to a prominent width so the running×functioning verdict
//     is the first thing the operator reads),
//   • an honest `FreshnessChip` (collector-freshness — has this service reported).
//
// One tree, two variants: this shell is variant-agnostic. The infra (bitcoind) vs
// custom (addressBalances) split lives ONLY in the DATA the route resolves and in
// which evidence chart `ServiceVitals` shows — never in this chrome.
//
// Server Component: no client JS. The two-axis color law is LOCKED in
// TwoAxisPip.combinedState(); this shell composes it, it never re-derives it.

/** Truncate a 66-hex pubkey to the prototype's `8…6` glance form. */
function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

export interface ServiceHeaderProps {
  /** Operator-facing service name (serviceDisplay().label) — never the raw key. */
  serviceLabel: string;
  /** Optional one-line description of what the service does. */
  description?: string;
  /** The owning node's 66-hex pubkey — rendered truncated (mono), links to Node Detail. */
  pubkey: string;
  /** Owning node alias, or null → the truncated pubkey stands in. */
  nodeAlias: string | null;
  /** The host id the service runs on (mono). */
  hostId: string;
  /** RUNNING axis — the native process/probe is up. */
  running: boolean;
  /** FUNCTIONING axis — the probe says functioning AND it is not functioning-stale. */
  functioning: boolean;
  /** Humanized last-heartbeat age (e.g. "8s ago" / "stale · 22m ago"). */
  heartbeat?: string;
  /** Humanized last-run summary (e.g. "2m ago · ok" / "failed · last ok 41m ago"). */
  lastRun?: string;
  /** Raw trailing-window error count. */
  errorCount: number;
  /** Collector-observed timestamp for the freshness chip (null → "no data yet"). */
  asOf: Date | null;
  /** Past the collector-freshness window — drives the honest stale treatment. */
  stale: boolean;
  /** Deterministic "now" for the relative-age render (SSR/test stability). */
  now?: Date;
}

/**
 * The service identity header. Presentational + serializable-prop-driven. Renders
 * the display name, the owning node/host (node links back to Node Detail), a
 * FULL-SIZE two-axis health block, and an honest freshness chip. Never fabricates
 * a state — the two-axis verdict is the real running×functioning ServiceHealthState.
 */
export function ServiceHeader({
  serviceLabel,
  description,
  pubkey,
  nodeAlias,
  hostId,
  running,
  functioning,
  heartbeat,
  lastRun,
  errorCount,
  asOf,
  stale,
  now,
}: ServiceHeaderProps) {
  const nodeTitle = nodeAlias ?? shortPubkey(pubkey);

  return (
    <header className="flex flex-col gap-4 rounded-df-card border border-df-border bg-df-surface px-5 py-4">
      {/* Back-to-node affordance — navy structure, never a health hue. */}
      <Link
        href={`/${pubkey}`}
        className="inline-flex w-fit items-center gap-1.5 font-df-mono text-[11px] font-semibold tracking-[0.06em] text-df-brand uppercase underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
        {nodeTitle}
      </Link>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_auto]">
        {/* Identity: service display name (never a raw key) + owning node/host. */}
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-[23px] leading-[1.18] font-bold tracking-[-0.02em] text-df-ink">
            {serviceLabel}
          </h1>
          {description && (
            <p className="max-w-prose text-[13px] leading-relaxed text-df-muted">{description}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 font-df-mono text-[11.5px] text-df-muted">
              <Server
                className="size-3.5 flex-none text-df-brand"
                strokeWidth={2}
                aria-hidden="true"
              />
              <span>{hostId}</span>
            </span>
            <Link
              href={`/${pubkey}`}
              className="font-df-mono text-[12px] tabular-nums text-df-brand underline-offset-4 hover:underline"
            >
              {shortPubkey(pubkey)}
            </Link>
            <FreshnessChip asOf={asOf} stale={stale} now={now} />
          </div>
        </div>

        {/* FULL-SIZE two-axis health block — the first verdict the operator reads. */}
        <div className="w-full lg:w-[320px]">
          <TwoAxisPip
            running={running}
            functioning={functioning}
            name={serviceLabel}
            heartbeat={heartbeat}
            lastRun={lastRun}
            errorCount={errorCount}
          />
        </div>
      </div>
    </header>
  );
}

interface ServiceDetailShellProps {
  /** The already-built `ServiceHeader` element (C1 identity block). */
  header: ReactNode;
  /** Top-bar title (the service display name). */
  navTitle: string;
  /** Optional top-bar subtitle (e.g. the owning node). */
  navSubtitle?: string;
  /** The REAL fetch epoch (ms) for the honest ticking data-age pill. */
  pollSinceMs?: number;
  /** The C2–C6 section content. */
  children: ReactNode;
}

/**
 * The Service Detail shell: `NavRailShell` chrome (nodes rail active, no fake fleet
 * summary/view-toggle for a single-service surface) wrapping the `ServiceHeader`
 * identity block and the section content. Server Component.
 */
export function ServiceDetailShell({
  header,
  navTitle,
  navSubtitle,
  pollSinceMs,
  children,
}: ServiceDetailShellProps) {
  return (
    <NavRailShell
      active="nodes"
      title={navTitle}
      subtitle={navSubtitle}
      pollSinceMs={pollSinceMs}
      showFleetSummary={false}
      showViewToggle={false}
    >
      <div className="flex flex-col gap-6">
        {header}
        {children}
      </div>
    </NavRailShell>
  );
}
