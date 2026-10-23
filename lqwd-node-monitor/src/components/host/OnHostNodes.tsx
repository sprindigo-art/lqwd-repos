import { SeverityRow } from "@/components/df/SeverityRow";
import { ImplTag } from "@/components/df/ImplTag";
import { FreshnessChip } from "@/components/df/FreshnessChip";
import { ServiceWhyAccordion } from "@/components/df/ServiceWhyAccordion";
import { severityLabel, type Severity } from "@/components/df/Severity";
import { serviceDisplay } from "@/lib/overview/service-display";
import { cn } from "@/lib/utils";
import { renderNowMs } from "@/lib/time/render-now";

// =====================================================
// OnHostNodes (HOST-02 · B6 / D-12) — compact on-host node rows (Server)
// =====================================================
// One compact `SeverityRow` per on-host node (the Phase-13 grammar trimmed: no
// sortable headers, no full evidence column set). The row uses the NEW columnar
// `SeverityRow` props only (`id`/`note`/`status`/`statusSev`/`href`) — never the
// deprecated v1 aliases. `href` promotes the whole row to a Link → Node Detail.
//
// PRESENTATION-PURE: this component computes NO health. The per-node severity
// (`sev`) is reduced BY THE PAGE from the scorecard (stale-or-dot ramp) and passed
// in; the evidence figures arrive pre-read from the loaded scorecard dimensions
// (the nodes-page toRow/dimOf convention) — no new read, no sat math here.

/** One node-associated script running on this VM (running × functioning). */
export interface OnHostNodeScript {
  serviceName: string;
  running: boolean;
  functioning: boolean;
  errorCount: number;
  // Gap B explainability (additive/optional) — feed the not-green why-accordion.
  /** Probe-supplied reason; NULL for the live LND fleet → the honest fallback renders. */
  detail?: string | null;
  /** Inventory-side detection_method — rendered as a chip in the why-panel. */
  detectionMethod?: string | null;
  /** Last successful run; NULL → "never". */
  lastSuccessAt?: Date | null;
  /** Per-service functioning-staleness flag. */
  functioningStale?: boolean;
  /** Collector-freshness flag. */
  collectorStale?: boolean;
}

/** One compact on-host node row — evidence figures pre-read from the scorecard. */
export interface OnHostNodeRow {
  /** Node pubkey — the Node Detail href target (`/${pubkey}`). */
  pubkey: string;
  /** Display alias (sans); falls back to the pubkey when null. */
  alias: string | null;
  /** Node implementation — drives the `ImplTag`. */
  backend: "lnd" | "ldk";
  /** Worst-of node severity — the CALLER reduces it; the row only paints it. */
  sev: Severity;
  /** Worst-case freshness stamp for the row's `FreshnessChip`. */
  asOf: Date | null;
  /** Past the staleness threshold — the shape-distinct stale chip. */
  stale: boolean;
  /** Active channel count (mono); null when unknown. */
  activeChannels: number | null;
  /** Local liquidity share 0–1 (compact bar + mono); null when unknown. */
  liquidityRatio: number | null;
  /** Trailing forwards count (mono); null when unknown. */
  forwards: number | null;
  /** Node-associated scripts that run on THIS VM for the node (host-owned). */
  scripts: OnHostNodeScript[];
}

export interface OnHostNodesProps {
  /** The on-host node rows (empty → honest empty state). */
  nodes: OnHostNodeRow[];
}

/** A compact neutral local/remote liquidity bar — evidence, never a health hue. */
function LiquidityMini({ ratio }: { ratio: number | null }) {
  if (ratio === null) {
    return <span className="font-df-mono text-[11px] text-df-muted">— liq</span>;
  }
  const localPct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-1.5 w-10 overflow-hidden rounded-df-pill bg-df-border"
        aria-hidden="true"
      >
        <span className="block h-full rounded-df-pill bg-df-slate" style={{ width: `${localPct}%` }} />
      </span>
      <span className="font-df-mono text-[11px] tabular-nums text-df-muted">{localPct}% local</span>
    </span>
  );
}

/** Combined script health: green ONLY when both axes pass; else a red state. */
function scriptState(running: boolean, functioning: boolean): { label: string; ok: boolean } {
  if (running && functioning) return { label: "HEALTHY", ok: true };
  if (running && !functioning) return { label: "UP · NOT HEALTHY", ok: false };
  return { label: "DOWN", ok: false };
}

/** One indented node-associated script row under its node (host-owned service). */
function ScriptRow({ script, nowMs }: { script: OnHostNodeScript; nowMs: number }) {
  const state = scriptState(script.running, script.functioning);
  const row = (
    <div className="flex items-center gap-3 py-1">
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-df-ink">
        {serviceDisplay(script.serviceName).label}
      </span>
      {script.errorCount > 0 && (
        <span className="font-df-mono text-[10.5px] tabular-nums text-df-warning">
          {script.errorCount} err
        </span>
      )}
      <span
        className={cn(
          "rounded-df-pill px-2 py-0.5 font-df-mono text-[9px] font-bold tracking-[0.04em] whitespace-nowrap uppercase",
          state.ok ? "bg-df-ok-tint text-df-ok-text" : "bg-df-critical-tint text-df-critical",
        )}
      >
        {state.label}
      </span>
    </div>
  );

  // Not-green scripts gain the honest expand affordance; healthy scripts unchanged.
  if (!state.ok) {
    return (
      <ServiceWhyAccordion
        detail={script.detail ?? null}
        detectionMethod={script.detectionMethod ?? null}
        errorCount={script.errorCount}
        lastSuccessAt={script.lastSuccessAt ?? null}
        functioningStale={script.functioningStale ?? false}
        collectorStale={script.collectorStale ?? false}
        nowMs={nowMs}
      >
        {row}
      </ServiceWhyAccordion>
    );
  }

  return row;
}

/**
 * The on-host nodes section. One compact `SeverityRow` per node, clicking through
 * to Node Detail; the evidence columns ride the row's `note` slot. Each node's
 * node-associated scripts (host-owned, node-associated) render as an indented list
 * beneath it. Empty state renders the honest "infrastructure only" copy.
 */
export function OnHostNodes({ nodes }: OnHostNodesProps) {
  const nowMs = renderNowMs();
  if (nodes.length === 0) {
    return (
      <div className="rounded-df-card border border-df-border bg-df-surface px-5 py-8 text-center">
        <div className="text-[15px] font-semibold text-df-ink">No nodes on this host.</div>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] text-df-muted">
          This host runs infrastructure only.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {nodes.map((n) => (
        <div key={n.pubkey} className="flex flex-col gap-1.5">
          <SeverityRow
            sev={n.sev}
            id={n.alias ?? n.pubkey}
            href={`/${n.pubkey}`}
            status={severityLabel[n.sev]}
            statusSev={n.sev}
            note={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <ImplTag impl={n.backend} />
                <span className="font-df-mono text-[11px] tabular-nums text-df-muted">
                  {n.activeChannels ?? "—"} ch
                </span>
                <LiquidityMini ratio={n.liquidityRatio} />
                <span className="font-df-mono text-[11px] tabular-nums text-df-muted">
                  {n.forwards ?? "—"} fwds
                </span>
                <FreshnessChip asOf={n.asOf} stale={n.stale} className={cn("ms-0")} />
              </span>
            }
          />
          {n.scripts.length > 0 && (
            <div className="ms-3 flex flex-col gap-0.5 border-s border-df-border-soft ps-4">
              <div className="font-df-mono text-[9px] font-bold tracking-[0.06em] text-df-muted uppercase">
                services on this VM
              </div>
              {n.scripts.map((s) => (
                <ScriptRow key={s.serviceName} script={s} nowMs={nowMs} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
