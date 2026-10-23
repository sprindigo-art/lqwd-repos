import Link from "next/link";
import { ArrowLeft, Server } from "lucide-react";

import { cn, FOCUS_RING } from "@/lib/utils";
import {
  severityAccent,
  severityLabel,
  severityVariants,
  type Severity,
} from "@/components/df/Severity";
import { ImplTag } from "@/components/df/ImplTag";
import { FreshnessChip } from "@/components/df/FreshnessChip";

// =====================================================
// NodeHeader (B1 / NODE-04) — node identity header (Server)
// =====================================================
// The single-scroll Node Detail's identity block, composed as a thin wrapper over
// the already-shipped read model (Plan 08 supplies the props from
// node-info.ts / nodes.ts). It renders: the node alias (23px/700 sans), the
// truncated pubkey (mono), a role chip (`ImplTag` — "Routing · LND" / "LSP · LDK",
// the locked impl primitive), the host it runs on (a link target that may resolve
// in Phase 14), an OVERALL HEALTH PILL = worst-of across all layers, an honest
// `FreshnessChip`, and a back-to-overview affordance.
//
// DS-01 color law: the overall-health pill is the ONLY severity surface here and
// maps sev→class EXCLUSIVELY through the Severity ramp API
// (`severityVariants`/`severityAccent`/`severityLabel`) — there is NO `sev === …`
// chain in this JSX. Navy is STRUCTURE only (the role chip tokens, the host link,
// the back affordance); it never signals health.

/** The host a node runs on — the link target may resolve to Host Detail in Phase 14. */
export interface NodeHeaderHost {
  /** Host identifier (machine key). */
  hostId: string;
  /** Operator-facing host label (hostname when known, else the id). */
  label: string;
  /** Optional link to the (Phase-14) Host Detail surface; unlinked when absent. */
  href?: string;
}

export interface NodeHeaderProps {
  /** 66-hex node pubkey (rendered truncated, mono). */
  pubkey: string;
  /** Node alias, or null → the truncated pubkey stands in as the title. */
  alias: string | null;
  /** Backend — drives the role chip (LND routing / LDK-LSP). */
  backend: "lnd" | "ldk";
  /** The host this node runs on, when known. */
  host?: NodeHeaderHost | null;
  /** Worst-of severity across every layer — the overall health pill state (D-02). */
  overall: Severity;
  /** Worst-case source timestamp across the node's reads (D-13). */
  asOf: Date | null;
  /** Past the staleness threshold — drives the honest stale freshness treatment. */
  stale: boolean;
  /** Deterministic "now" for the relative-age render (SSR/test stability). */
  now?: Date;
  /** Back-nav href (defaults to the Nodes board — unified with NodeDetailTabs). */
  backHref?: string;
}

/** Truncate a 66-hex pubkey to the prototype's `8…6` glance form. */
function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

/**
 * The node identity header. Presentational + serializable-prop-driven so Plan 08
 * can wire it directly over the read model. Renders honest freshness and a
 * worst-of overall-health pill; never fabricates a state.
 */
export function NodeHeader({
  pubkey,
  alias,
  backend,
  host,
  overall,
  asOf,
  stale,
  now,
  backHref = "/nodes",
}: NodeHeaderProps) {
  const title = alias ?? shortPubkey(pubkey);

  return (
    <header className="flex flex-col gap-3 rounded-df-card border border-df-border bg-df-surface px-5 py-4">
      {/* Back-to-Nodes affordance — navy structure, never a health hue. Unified with
          NodeDetailTabs' "← Nodes"/`/nodes` so the whole node-detail set backs out to
          the same board (audit E — was "← Fleet overview"→`/`). */}
      <Link
        href={backHref}
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-df-btn font-df-mono text-[11px] font-semibold tracking-[0.06em] text-df-brand uppercase underline-offset-4 hover:underline",
          FOCUS_RING,
        )}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
        Nodes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Identity: alias (23px/700 sans) + truncated pubkey (mono) + role + host. */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[23px] leading-[1.18] font-bold tracking-[-0.02em] text-df-ink">
              {title}
            </h1>
            <ImplTag impl={backend} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="font-df-mono text-[12px] tabular-nums text-df-muted">
              {shortPubkey(pubkey)}
            </span>
            {host && (
              <span className="inline-flex items-center gap-1.5 font-df-mono text-[11.5px] text-df-muted">
                <Server className="size-3.5 flex-none text-df-brand" strokeWidth={2} aria-hidden="true" />
                {host.href ? (
                  <Link href={host.href} className="text-df-brand underline-offset-4 hover:underline">
                    {host.label}
                  </Link>
                ) : (
                  <span>{host.label}</span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Overall health pill + honest freshness — the ONLY sev surface here. */}
        <div className="flex flex-col items-end gap-2">
          <OverallHealthPill sev={overall} />
          <FreshnessChip asOf={asOf} stale={stale} now={now} />
        </div>
      </div>
    </header>
  );
}

/**
 * The worst-of overall-health pill. sev→class flows ONLY through the Severity ramp
 * API (`severityVariants` tint/border/text + `severityAccent` dot + `severityLabel`
 * word) — no `sev === …` chain (DS-01).
 */
function OverallHealthPill({ sev }: { sev: Severity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-df-pill border px-3 py-1 font-df-mono text-[11px] font-bold tracking-[0.06em] uppercase",
        severityVariants({ sev }),
      )}
    >
      <span className={cn("size-2 flex-none rounded-full", severityAccent[sev])} aria-hidden="true" />
      {severityLabel[sev]}
    </span>
  );
}
