import Link from "next/link";
import type { ReactNode } from "react";
import { Check, X } from "lucide-react";

import {
  severityAccent,
  severityLabel,
  severityVariants,
  type Severity,
} from "@/components/df/Severity";
import { ThresholdMeter } from "@/components/df/ThresholdMeter";
import { FreshnessChip } from "@/components/df/FreshnessChip";
import { ServiceWhyAccordion } from "@/components/df/ServiceWhyAccordion";
import { serviceDisplay } from "@/lib/overview/service-display";
import { cn } from "@/lib/utils";
import { renderNowMs } from "@/lib/time/render-now";

// =====================================================
// HostCard — worst-of chrome + meters + infra trio + node dots (HOST-01 · A3/A4)
// =====================================================
// One card per host. COMPOSITION-ONLY: every sub-block is an EXISTING df primitive
// (SeverityCard's chrome grammar via `severityVariants`/`severityAccent`,
// `ThresholdMeter` ×3, `TwoAxisPip` ×3, `FreshnessChip`, `ui/tooltip` dots).
//
// The card computes NO health (the 12-10 lesson): EVERY severity — the card's
// worst-of, each meter's, each dot's — arrives PRE-COMPUTED via the model the page
// builds from the rollup + the read-time bands. This file grades nothing and
// reads no threshold config — it never reduces or re-derives a severity. Sev→class
// flows only through `severityVariants`/`severityAccent`/`severityLabel` (DS-01); navy is
// NEVER a card accent — the card carries navy only on its (structural) links.
//
// NESTED-LINK LAW (Pitfall 6): the card root is a plain <div>; an absolutely-
// positioned stretched <Link> (z-0) covers it and carries the whole-body click to
// `/hosts/${hostId}`; each node dot is its OWN <Link> to `/${pubkey}` rendered
// `relative z-10` ABOVE the stretched link — never an <a> nested inside an <a>.
//
// No-telemetry variant (D-06/A4): when `hasData` is false the card wears the gold
// stale treatment, a `NO TELEMETRY` chip, hatched `ThresholdMeter stale` meters,
// an honest-unknown trio, and the honest no-telemetry body — never green, never
// hidden. It still links through to Host Detail (same honest emptiness in full).

/** One resource meter (CPU / MEM / DISK) — pct + its read-time-band severity. */
export interface HostMeterModel {
  /** 0–100 fill percentage (used%). */
  pct: number;
  /** Severity from the read-time band — computed by the page, never here. */
  sev: Severity;
  /**
   * Optional pre-formatted absolute amount shown left of the % (the page owns all
   * unit math — the card never touches bytes/cores). E.g. "15.7 / 32.0 GiB" for
   * memory, "1.2 / 2.9 TiB" for disk, "load 1.84" for CPU. Omitted → % only.
   */
  detail?: string;
}

/** One service tile (running × functioning). `known=false` is the honest no-data row. */
export interface HostServiceTile {
  /** Raw machine service key — the card resolves the label via `serviceDisplay`. */
  serviceName: string;
  /** Declared AND reporting — false renders the honest no-data row. */
  known: boolean;
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

/**
 * One on-host LND node + the node-associated scripts that run on THIS VM for it
 * (internalRebalancer, aiLiquidityManager, nodeAuditor, monitoring…). Scripts are
 * host-owned (you remediate them on the VM) and node-associated (they tend a node);
 * this block is where the two meet on the host surface.
 */
export interface HostNodeBlock {
  pubkey: string;
  alias: string | null;
  /** The node's worst-of severity — colors the LND header chip; computed by the page. */
  sev: Severity;
  /** The node-scoped services running on this host for this node. */
  services: HostServiceTile[];
}

/** The serializable per-host card model the page computes and the card renders. */
export interface HostCardModel {
  hostId: string;
  hostname: string | null;
  /** Worst-of host severity (chrome + chip) — from `buildHostRollup`. */
  sev: Severity;
  /** D-05 driver line, already formatted as "driven by: <phrase>"; null when healthy. */
  driver: string | null;
  /** False for a declared-but-never-reported host → the A4 no-telemetry variant. */
  hasData: boolean;
  /** Read-time staleness (D-06) — hatches the meters + hides fresh-looking values. */
  stale: boolean;
  /** Worst-case source stamp for the FreshnessChip (null → "no data yet"). */
  asOf: Date | null;
  cpu: HostMeterModel;
  mem: HostMeterModel;
  disk: HostMeterModel;
  /** VM-level services (no node association): bitcoind · postgres · esplora · disk/monitor. */
  vmServices: HostServiceTile[];
  /** Per-LND-node blocks: each node + the scripts that tend it, grouped on this VM. */
  nodeBlocks: HostNodeBlock[];
}

interface HostCardProps {
  model: HostCardModel;
  /** Deterministic "now" for the FreshnessChip age (tests/gallery). */
  now?: Date;
  className?: string;
}

/** Mono uppercase kicker + hatch-aware value for one resource meter row. */
function MeterRow({
  kicker,
  meter,
  stale,
}: {
  kicker: string;
  meter: HostMeterModel;
  stale: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 flex-none font-df-mono text-[10.5px] font-bold tracking-[0.06em] text-df-muted uppercase">
        {kicker}
      </span>
      <ThresholdMeter
        pct={meter.pct}
        sev={meter.sev}
        stale={stale}
        label={`${kicker} usage`}
        className="flex-1"
      />
      {/* Absolute amount (bytes/cores/load) — the honest figure behind the %. */}
      {!stale && meter.detail !== undefined && (
        <span className="flex-none text-right font-df-mono text-[12px] tabular-nums text-df-muted whitespace-nowrap">
          {meter.detail}
        </span>
      )}
      <span className="w-10 flex-none text-right font-df-mono text-[13px] font-semibold tabular-nums text-df-ink">
        {stale ? "—" : `${Math.round(meter.pct)}%`}
      </span>
    </div>
  );
}

/** Combined service health: green ONLY when both axes pass; else a red state. */
function serviceState(running: boolean, functioning: boolean): { label: string; ok: boolean } {
  if (running && functioning) return { label: "HEALTHY", ok: true };
  if (running && !functioning) return { label: "UP · NOT HEALTHY", ok: false };
  return { label: "DOWN", ok: false };
}

/** One compact running/functioning flag — mono caption + check/cross glyph. */
function AxisFlag({ label, on }: { label: string; on: boolean }) {
  const Icon = on ? Check : X;
  return (
    <span className="inline-flex items-center gap-1 font-df-mono text-[10px] font-bold tracking-[0.04em] uppercase">
      <span className="text-df-muted">{label}</span>
      <Icon
        className={cn("size-3.5 flex-none", on ? "text-df-ok" : "text-df-critical")}
        strokeWidth={2.6}
        aria-hidden="true"
      />
    </span>
  );
}

/**
 * One service row in the compact services table — name + status chip + running/
 * functioning flags + 1h error count. A `known=false` tile (declared service with
 * no data) renders the honest "no data" row; presence-gated services are filtered
 * out upstream when absent, so they never reach here as a no-data row. `indent`
 * insets node-associated script rows under their LND-node header.
 */
function ServiceRow({
  tile,
  indent = false,
  nowMs,
}: {
  tile: HostServiceTile;
  indent?: boolean;
  nowMs: number;
}) {
  const label = serviceDisplay(tile.serviceName).label;
  const pad = cn("flex items-center gap-3 py-2.5 pe-3", indent ? "ps-7" : "ps-3");

  if (!tile.known) {
    return (
      <div className={pad}>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-df-ink">
          {label}
        </span>
        <span className="rounded-df-pill border border-dashed border-df-stale-border bg-df-stale-tint px-2 py-0.5 font-df-mono text-[9.5px] font-bold tracking-[0.04em] text-df-stale-text uppercase">
          no data
        </span>
      </div>
    );
  }

  const state = serviceState(tile.running, tile.functioning);
  const row = (
    <div className={pad}>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-df-ink">{label}</span>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-df-pill px-2 py-0.5 font-df-mono text-[9.5px] font-bold tracking-[0.04em] whitespace-nowrap uppercase",
          state.ok ? "bg-df-ok-tint text-df-ok-text" : "bg-df-critical-tint text-df-critical",
        )}
      >
        <span
          className={cn(
            "size-1.5 flex-none rounded-full",
            state.ok ? "bg-df-ok" : "bg-df-critical animate-[v2pulse_1.5s_infinite]",
          )}
          aria-hidden="true"
        />
        {state.label}
      </span>
      <AxisFlag label="run" on={tile.running} />
      <AxisFlag label="fn" on={tile.functioning} />
      <span
        className={cn(
          "w-14 flex-none text-right font-df-mono text-[11px] font-semibold tabular-nums",
          tile.errorCount > 5
            ? "text-df-critical"
            : tile.errorCount > 0
              ? "text-df-warning"
              : "text-df-muted",
        )}
      >
        {tile.errorCount} err
      </span>
    </div>
  );

  // A known, not-green tile gains the honest expand affordance; healthy rows unchanged.
  if (!state.ok) {
    return (
      <div className={cn(indent ? "ps-4" : "")}>
        <ServiceWhyAccordion
          detail={tile.detail ?? null}
          detectionMethod={tile.detectionMethod ?? null}
          errorCount={tile.errorCount}
          lastSuccessAt={tile.lastSuccessAt ?? null}
          functioningStale={tile.functioningStale ?? false}
          collectorStale={tile.collectorStale ?? false}
          nowMs={nowMs}
        >
          {row}
        </ServiceWhyAccordion>
      </div>
    );
  }

  return row;
}

/** A subtle mono caption row that titles a service group (e.g. "VM SERVICES"). */
function GroupCaption({ children }: { children: ReactNode }) {
  return (
    <div className="bg-df-surface-sub/50 px-3 py-1.5 font-df-mono text-[9.5px] font-bold tracking-[0.08em] text-df-muted uppercase">
      {children}
    </div>
  );
}

/**
 * The header row for one on-host LND node block — "LND" kind + alias (deep-links to
 * the node, escaping the stretched card link via z-10) + the node's worst-of
 * severity chip. Its node-associated scripts render as indented ServiceRows below.
 */
function LndNodeHeader({ block }: { block: HostNodeBlock }) {
  const alias = block.alias ?? `${block.pubkey.slice(0, 10)}…`;
  return (
    <div className="flex items-center gap-3 bg-df-surface-sub/30 px-3 py-2.5">
      <span className="flex-none font-df-mono text-[10px] font-bold tracking-[0.06em] text-df-muted uppercase">
        LND
      </span>
      <Link
        href={`/${block.pubkey}`}
        className="relative z-10 min-w-0 flex-1 truncate text-[13px] font-semibold text-df-ink hover:text-df-brand hover:underline"
      >
        {alias}
      </Link>
      <span
        className={cn(
          "inline-flex items-center rounded-df-pill border px-2 py-0.5 font-df-mono text-[9.5px] font-bold tracking-[0.04em] whitespace-nowrap uppercase",
          severityVariants({ sev: block.sev }),
        )}
      >
        {severityLabel[block.sev]}
      </span>
    </div>
  );
}

/**
 * A host summary card — worst-of chrome + driver line, three threshold meters, the
 * bitcoind/esplora/postgres two-axis trio, and interactive node dots. Reads a
 * pre-computed model (no health logic here) and composes existing df primitives
 * with the stretched-link pattern. The no-telemetry variant (hasData=false) wears
 * the gold honest-empty treatment and still links to Host Detail.
 */
export function HostCard({ model, now, className }: HostCardProps) {
  const { hostId, hostname, sev, driver, hasData, stale, asOf, cpu, mem, disk, vmServices, nodeBlocks } =
    model;
  const name = hostname ?? hostId;
  const nowMs = now?.getTime() ?? renderNowMs();
  // No-telemetry wears the gold stale ramp; otherwise the worst-of ramp.
  const chromeSev: Severity = hasData ? sev : "stale";
  const chipLabel = hasData ? severityLabel[sev] : "NO TELEMETRY";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-df-card border bg-df-surface shadow-df-rest transition-shadow hover:shadow-df-hover",
        severityVariants({ sev: chromeSev }),
        className,
      )}
    >
      {/* Stretched card link (Pitfall 6) — carries the whole-body click to Host
          Detail; node dots render ABOVE it (z-10) so they escape to their node. */}
      <Link href={`/hosts/${hostId}`} className="absolute inset-0 z-0" aria-label={`Open ${name} detail`}>
        <span className="sr-only">Open host detail</span>
      </Link>

      <div className="flex items-stretch">
        {/* 6px left accent bar — the bright NON-TEXT severity hue (state-only). */}
        <div className={cn("w-1.5 flex-none", severityAccent[chromeSev])} aria-hidden="true" />

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          {/* 1. Header row: name + sev/NO-TELEMETRY chip + freshness. */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={cn(
                "rounded-[5px] px-2 py-0.5 font-df-mono text-[10.5px] font-bold tracking-[0.07em] text-white",
                severityAccent[chromeSev],
              )}
            >
              {chipLabel}
            </span>
            <h3 className="min-w-0 truncate text-[15.5px] font-semibold tracking-[-0.01em] text-df-ink">
              {name}
            </h3>
            <FreshnessChip asOf={asOf} stale={stale} now={now} className="ms-auto" />
          </div>

          {/* 2. Driver line (D-05) — omitted when healthy; the no-telemetry body
                 replaces it entirely in the A4 variant. */}
          {hasData ? (
            driver !== null && (
              <p className="text-[13px] leading-relaxed text-df-muted">{driver}</p>
            )
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-[13.5px] font-semibold text-df-ink">No telemetry yet.</p>
              <p className="max-w-[64ch] text-[13px] leading-relaxed text-df-muted">
                Declared in the fleet — this host reports once its collector onboards. Shown
                honestly, never assumed healthy.
              </p>
            </div>
          )}

          {/* 3. Resource meters — CPU / MEM / DISK (hatched + "—" when stale). */}
          <div className="flex flex-col gap-2">
            <MeterRow kicker="CPU" meter={cpu} stale={stale} />
            <MeterRow kicker="MEM" meter={mem} stale={stale} />
            <MeterRow kicker="DISK" meter={disk} stale={stale} />
          </div>

          {/* 4. Services on this VM — ONE compact card. VM-level services (bitcoind ·
                 postgres · esplora-when-present · disk/monitor) grouped first, then a
                 block per on-host LND node: the node header + the node-associated
                 scripts that run on this VM (rebalancer, AI manager, auditor…). Scripts
                 are host-owned, node-associated — shown here because this is where you
                 remediate them. */}
          {(vmServices.length > 0 || nodeBlocks.length > 0) && (
            <div className="divide-y divide-df-border-soft overflow-hidden rounded-[13px] border border-df-border bg-df-surface">
              {vmServices.length > 0 && (
                <>
                  <GroupCaption>VM services</GroupCaption>
                  {vmServices.map((tile) => (
                    <ServiceRow key={tile.serviceName} tile={tile} nowMs={nowMs} />
                  ))}
                </>
              )}
              {nodeBlocks.map((block) => (
                <div key={block.pubkey} className="divide-y divide-df-border-soft">
                  <LndNodeHeader block={block} />
                  {block.services.map((tile) => (
                    <ServiceRow key={tile.serviceName} tile={tile} indent nowMs={nowMs} />
                  ))}
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
