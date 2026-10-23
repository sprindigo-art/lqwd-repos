import type { ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { DF } from "@/lib/df/tokens";
import { severityAccent, severityLabel, type Severity } from "./Severity";
import {
  EvidenceChart,
  EvidencePanel,
  type EvidenceChartProps,
} from "./EvidenceChart";
import { BlastRadius, type BlastTarget } from "./BlastRadius";
import { WhyChain, type WhyChainEvent } from "./WhyChain";
import { AiReadPanel, type AiReadLine } from "./AiReadPanel";
import { SeverityRow } from "./SeverityRow";
import { CommandModal, type CommandModalProps } from "./CommandModal";
import { chartAccentFor } from "./SeverityCard";

// =====================================================
// SeverityHeroCard — the "Top priority" hero incident block (Server)
// =====================================================
// The prototype's single richest visual: the Ops Center v2 hero card (locked
// snapshot lines 127-228). It is NOT a wider SeverityCard — it has its own
// grammar: a "Top priority" eyebrow + rule, a pulsing CRITICAL chip (`v2pulse`),
// a "ROOT CAUSE · N nodes roll up" chip + a "data fresh · Ns" indicator, a 23px
// headline + multi-line narrative, meta chips, a 392px EVIDENCE sparkline panel,
// the BLAST RADIUS diagram, a resolution callout, footer toggle + primary action,
// and an expand grid (why-chain + AI grouping + grouped children).
//
// COMPOSITION over reimplementation: every sub-block is an EXISTING df/* primitive
// (`EvidencePanel`/`EvidenceChart`, `BlastRadius`, `WhyChain`, `AiReadPanel`,
// `SeverityRow`, `CommandModal`). This file owns the hero layout only.
//
// SSR-safety: Server Component. The Recharts subtree inside the evidence panel is
// the only client-only region; everything else (chip row, headline, BlastRadius
// SVG, blast callout, expand grid) renders server-side. Animations reuse the
// existing `v2pulse`/`v2flow`/`v2drop` keyframes — no new globals.
//
// DS-01: severity is STATE. The hero defaults to `critical` (the prototype hero is
// always the top-priority critical incident) but accepts any sev; navy chrome is
// used ONLY for the structural action button / AI band, never as a severity color.

/** The hero evidence panel — chart data plus its label/value/note chrome. */
export interface HeroEvidence
  extends Pick<EvidenceChartProps, "series" | "accent" | "threshold" | "band" | "area" | "projection" | "marker" | "axisLabels" | "stale" | "lastGoodLabel" | "idSuffix"> {
  /** Left caption, e.g. "Minutes behind chain tip · +22m". */
  evLabel: string;
  /** Right bold value, e.g. "+22m". */
  evValue: string;
  /** The bold value color (defaults to the chart accent). */
  evValueColor?: string;
  /** Caption below the chart, e.g. "Climbing since 14:08 · alert at +15m". */
  evNote?: string;
}

/** The blast-radius region: root-cause host + impacted targets + a resolution line. */
export interface HeroBlast {
  /** Root-cause host id ("host-03"). */
  host: string;
  /** Root-cause failure line ("bitcoind stalled"). */
  hostStatus: string;
  /** Impacted nodes wired to the host. */
  targets: BlastTarget[];
  /** Section eyebrow note ("one host outage → 3 nodes on it"). */
  note?: ReactNode;
  /** The green-check resolution callout ("Restart bitcoind … all 3 clear"). */
  resolution?: ReactNode;
}

/** One grouped child alert under the hero (clears when the root cause recovers). */
export interface HeroChild {
  sev: Severity;
  node: ReactNode;
  kind?: ReactNode;
  note?: ReactNode;
  detail?: ReactNode;
}

/** The export affordance — `CommandModal` props minus the trigger (we supply it). */
export type HeroExport = Omit<CommandModalProps, "trigger" | "sev"> & {
  sev?: Severity;
};

interface SeverityHeroCardProps {
  /** Hero state — defaults to `critical` (the top-priority incident). */
  sev?: Severity;
  /** Top eyebrow over the rule (defaults to "Top priority"). */
  eyebrow?: ReactNode;
  /** Override the sev chip label (defaults per sev). */
  label?: ReactNode;
  /** "ROOT CAUSE · N nodes roll up" chip text (omit to hide the chip). */
  rootCauseChip?: ReactNode;
  /** "data fresh · Ns" recency text (omit to hide the indicator). */
  freshLabel?: ReactNode;
  /** The 23px headline. */
  title: ReactNode;
  /** The multi-line narrative body under the headline. */
  narrative?: ReactNode;
  /** Meta chips under the narrative ("bitcoind · host-03", "flagged 14:08 · 22m ago"). */
  metaChips?: ReactNode[];
  /** The 392px evidence sparkline panel. */
  evidence?: HeroEvidence;
  /** The blast-radius region (diagram + resolution callout). */
  blast?: HeroBlast;
  /** Whether the expand grid is open (caller owns the toggle state). */
  expanded?: boolean;
  /** Expand-toggle click. */
  onToggle?: () => void;
  /** Expand-toggle copy. */
  expandLabel?: ReactNode;
  /** Detection-chain events for the expand grid's `WhyChain`. */
  timeline?: WhyChainEvent[];
  /** AI-grouping advisory lines for the expand grid's `AiReadPanel`. */
  aiLines?: AiReadLine[];
  /** Grouped child alerts in the expand grid. */
  childAlerts?: HeroChild[];
  /** Heading over the grouped child rows. */
  childrenLabel?: ReactNode;
  /** Primary action — opens a `CommandModal` (the exported fix). */
  primaryAction?: HeroExport;
  /** Extra classes merged last via `cn()`. */
  className?: string;
}

/**
 * The "Top priority" hero incident card. Composes the real df primitives into the
 * prototype hero grammar: root-cause chips, narrative, a 392px evidence sparkline,
 * the BlastRadius diagram + resolution callout, and an expand grid (why-chain /
 * AI grouping / grouped children). Every region is OPTIONAL — a `{ title }`-only
 * hero still renders.
 */
export function SeverityHeroCard({
  sev = "critical",
  eyebrow = "Top priority",
  label,
  rootCauseChip,
  freshLabel,
  title,
  narrative,
  metaChips,
  evidence,
  blast,
  expanded = false,
  onToggle,
  expandLabel,
  timeline,
  aiLines,
  childAlerts,
  childrenLabel,
  primaryAction,
  className,
}: SeverityHeroCardProps) {
  const accentHex = chartAccentFor(sev);
  const hasGrid =
    expanded &&
    ((timeline && timeline.length > 0) ||
      (aiLines && aiLines.length > 0) ||
      (childAlerts && childAlerts.length > 0));

  return (
    <section className={cn("mb-6", className)}>
      {/* Eyebrow + rule. */}
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className="font-df-mono text-[11.5px] font-bold tracking-[0.09em] uppercase"
          style={{ color: accentHex }}
        >
          {eyebrow}
        </span>
        <span className="h-px flex-1" style={{ backgroundColor: DF.border }} aria-hidden="true" />
      </div>

      <div
        className="overflow-hidden rounded-df-card-lg border bg-df-surface shadow-df-hover"
        style={{ borderColor: DF.criticalBorder }}
      >
        <div className="flex items-stretch">
          {/* 7px left accent bar. */}
          <div className="w-[7px] flex-none" style={{ backgroundColor: accentHex }} aria-hidden="true" />

          <div className="min-w-0 flex-1 p-6">
            {/* Header row: chips + headline + narrative + meta + evidence panel. */}
            <div className="flex items-start gap-[18px]">
              <div className="min-w-0 flex-1">
                <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                  {/* Pulsing CRITICAL chip — white-on-accent with a v2pulse dot. */}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-df-pill px-2.5 py-1 font-df-mono text-[11px] font-bold tracking-[0.07em] text-white",
                      severityAccent[sev],
                    )}
                  >
                    <span
                      className="size-[7px] flex-none rounded-full bg-white"
                      style={{ animation: "v2pulse 1.8s infinite" }}
                      aria-hidden="true"
                    />
                    {label ?? severityLabel[sev]}
                  </span>
                  {rootCauseChip !== undefined && (
                    <span
                      className="rounded-df-pill border px-2.5 py-1 font-df-mono text-[11px] font-bold tracking-[0.06em]"
                      style={{
                        color: accentHex,
                        backgroundColor: DF.criticalTint,
                        borderColor: DF.criticalBorder,
                      }}
                    >
                      {rootCauseChip}
                    </span>
                  )}
                  {freshLabel !== undefined && (
                    <span className="ms-0.5 inline-flex items-center gap-1.5 text-[11.5px] text-df-muted">
                      <span
                        className="size-1.5 flex-none rounded-full"
                        style={{ backgroundColor: DF.ok }}
                        aria-hidden="true"
                      />
                      {freshLabel}
                    </span>
                  )}
                </div>

                <h2 className="text-[23px] font-bold leading-[1.18] tracking-[-0.02em] text-df-ink">
                  {title}
                </h2>
                {narrative !== undefined && (
                  <p className="mt-2.5 max-w-[62ch] text-[14.5px] leading-relaxed text-df-muted">
                    {narrative}
                  </p>
                )}

                {metaChips && metaChips.length > 0 && (
                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {metaChips.map((chip, i) => (
                      <span
                        key={i}
                        className="rounded-df-pill bg-df-border-soft px-2.5 py-1 font-df-mono text-[11.5px] text-df-muted"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* 392px hero evidence sparkline panel. */}
              {evidence && (
                <div className="hidden w-[392px] flex-none lg:block">
                  <EvidencePanel
                    evLabel={evidence.evLabel}
                    evValue={evidence.evValue}
                    evValueColor={evidence.evValueColor}
                    accent={evidence.accent}
                    evNote={evidence.evNote}
                  >
                    <EvidenceChart
                      series={evidence.series}
                      accent={evidence.accent}
                      threshold={evidence.threshold}
                      band={evidence.band}
                      area={evidence.area}
                      projection={evidence.projection}
                      marker={evidence.marker}
                      axisLabels={evidence.axisLabels}
                      stale={evidence.stale}
                      lastGoodLabel={evidence.lastGoodLabel}
                      height={104}
                      idSuffix={evidence.idSuffix}
                    />
                  </EvidencePanel>
                </div>
              )}
            </div>

            {/* Blast radius region: eyebrow + diagram + resolution callout. */}
            {blast && (
              <div className="mt-4 rounded-df-card border border-df-critical-border bg-df-critical-tint px-4 pt-3.5 pb-3">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="font-df-mono text-[10.5px] font-bold tracking-[0.08em] text-df-critical uppercase">
                    Blast radius
                  </span>
                  {blast.note !== undefined && (
                    <span className="text-[11.5px] text-df-muted">{blast.note}</span>
                  )}
                </div>
                <BlastRadius host={blast.host} hostStatus={blast.hostStatus} targets={blast.targets} />
                {blast.resolution !== undefined && (
                  <div className="mt-3 flex items-center gap-2 border-t border-df-critical-border pt-3">
                    <Check
                      className="size-3.5 flex-none"
                      strokeWidth={2.4}
                      style={{ color: DF.ok }}
                      aria-hidden="true"
                    />
                    <span className="text-[12.5px] text-df-ink/80">{blast.resolution}</span>
                  </div>
                )}
              </div>
            )}

            {/* Footer: expand toggle + primary action. */}
            {(onToggle !== undefined || primaryAction) && (
              <div className="mt-4 flex items-center gap-2.5 border-t border-df-border-soft pt-4">
                {onToggle !== undefined && (
                  <button
                    type="button"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    className="inline-flex items-center gap-1.5 rounded-df-btn border border-df-border px-3 py-1.5 text-[12.5px] font-semibold text-df-chrome transition-colors hover:bg-df-chrome/5"
                  >
                    <ChevronRight
                      className={cn("size-[11px] transition-transform", expanded && "rotate-90")}
                      strokeWidth={2.6}
                      aria-hidden="true"
                    />
                    {expandLabel ?? (expanded ? "Hide detection chain" : "Why-chain · grouped alerts")}
                  </button>
                )}
                {primaryAction && (
                  <div className="ms-auto">
                    <CommandModal
                      {...primaryAction}
                      sev={primaryAction.sev ?? sev}
                      trigger={
                        <button
                          type="button"
                          className="rounded-df-btn bg-df-chrome px-4 py-2.5 text-[13px] font-semibold text-white"
                        >
                          {primaryAction.title}
                        </button>
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Expand grid — why-chain + AI grouping + grouped children (v2drop). */}
        {hasGrid && (
          <div
            className="border-t border-df-border-soft bg-df-surface-sub px-6 pt-[18px] pb-[22px] ps-[31px]"
            style={{ animation: "v2drop .2s ease" }}
          >
            <div className="grid gap-7 lg:grid-cols-2">
              <div>
                {timeline && timeline.length > 0 && <WhyChain events={timeline} />}
                {aiLines && aiLines.length > 0 && (
                  <div className="mt-1">
                    <AiReadPanel lines={aiLines} heading="AI grouping" />
                  </div>
                )}
              </div>
              {childAlerts && childAlerts.length > 0 && (
                <div>
                  {childrenLabel !== undefined && (
                    <div className="mb-[13px] font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
                      {childrenLabel}
                    </div>
                  )}
                  <div className="flex flex-col gap-2.5">
                    {childAlerts.map((ch, i) => (
                      <SeverityRow
                        key={i}
                        sev={ch.sev}
                        id={ch.node}
                        kind={ch.kind}
                        note={ch.note}
                        detail={ch.detail}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
