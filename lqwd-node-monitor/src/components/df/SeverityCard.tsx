import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { DF } from "@/lib/df/tokens";
import {
  severityAccent,
  severityIcon,
  severityLabel,
  severityVariants,
  type Severity,
} from "./Severity";
import {
  EvidenceChart,
  EvidencePanel,
  type EvidenceChartProps,
} from "./EvidenceChart";
import { WhyChain, type WhyChainEvent } from "./WhyChain";
import { AiReadPanel, type AiReadLine } from "./AiReadPanel";
import { SeverityRow } from "./SeverityRow";
import { CommandModal, type CommandModalProps } from "./CommandModal";
import { ImplTag } from "./ImplTag";
import { FreshnessChip } from "./FreshnessChip";

// =====================================================
// SeverityCard — the v2 severity-tinted incident card (Server)
// =====================================================
// Rebuilt to FULL Data-Forward v2 prototype fidelity (locked Ops Center v2
// snapshot, queue-incident card lines 280-357 — and `SeverityHeroCard` in the
// co-located file for the hero block 127-228). The previous build was only the
// card's HEADER STRIP (icon + kicker + title + one body line); this restores the
// bulk of the prototype card below the title:
//
//   1. a 38×38 washed ICON TILE + a white-on-accent sev CHIP (header grammar)
//   2. an inline EVIDENCE PANEL region (the 212px inset — `EvidencePanel` +
//      `EvidenceChart` for the sparkline-bearing cards)
//   3. a META ROW: layer chip (`ImplTag`) + freshness (`FreshnessChip`) + an
//      expand toggle (chevron rotates when expanded)
//   4. an EXPAND DRAWER (animated with the existing `v2drop` keyframe): the
//      why-chain timeline (`WhyChain`), an AI-read callout (`AiReadPanel`),
//      grouped child rows (`SeverityRow`), and an export affordance (`CommandModal`).
//
// COMPOSITION over reimplementation: every sub-block is an EXISTING df/* primitive
// imported here — this file owns layout/composition only, not the primitives.
//
// SSR-safety: this is a Server Component. The composed primitives that are
// `"use client"` (EvidenceChart, AiReadPanel, CommandModal) render their
// SSR-safe CHROME server-side (the Recharts SVG subtree is the only client-only
// region); a card with no evidence/children still renders. All sev→class mapping
// flows through `severityVariants`/`severityAccent`/`severityIcon` from
// `Severity.ts` (the single ramp source) — navy is NEVER a card accent (DS-01).
//
// AFM-002: this is presentational — any numeric evidence (sats/fees, ages) is
// pre-formatted by the caller; the card does NO unit math.

/** Per-severity wash for the 38×38 icon tile (the soft tint behind the glyph). */
const severityWash: Record<Severity, string> = {
  critical: DF.criticalTint,
  warning: DF.warningTint,
  watch: DF.watchTint,
  healthy: DF.okTint,
  stale: DF.staleTint,
};

/** Evidence-panel props (minus the chart) plus the chart's data, for the inset. */
export interface SeverityEvidence
  extends Pick<EvidenceChartProps, "series" | "accent" | "threshold" | "band" | "area" | "projection" | "marker" | "axisLabels" | "stale" | "lastGoodLabel" | "idSuffix"> {
  /** Left caption, e.g. "Minutes behind chain tip · last 30 min". */
  evLabel: string;
  /** Right bold value, e.g. "+22m" / "DOWN". */
  evValue: string;
  /** The bold value color (defaults to the chart accent). */
  evValueColor?: string;
  /** Optional caption below the chart. */
  evNote?: string;
  /** Plot height — inline cards default to 58. */
  height?: 104 | 58;
}

/** The export affordance — the `CommandModal` props minus its trigger (we supply it). */
export type SeverityExport = Omit<CommandModalProps, "trigger" | "sev"> & {
  /** Override the modal's sev chip; defaults to the card's `sev`. */
  sev?: Severity;
};

/** One grouped child alert (clears when the root cause recovers). */
export interface SeverityChild {
  /** Child severity — drives the fallback dot + default status color. */
  sev: Severity;
  /** Single label — mono node id / service name / fee phrase ("lqwd-rtr-04"). */
  node: ReactNode;
  /** Leading NEUTRAL category glyph (from `CategoryIcon`) — WHAT the alert is. */
  icon?: ReactNode;
  /** Right-pinned STATE word, painted via `severityText[statusSev ?? sev]`. */
  status?: ReactNode;
  /** Severity coloring the `status` (defaults to the child `sev`). */
  statusSev?: Severity;
  /** When set, the row is a `next/link` click-through (fee rows → `/{pubkey}/fees`). */
  href?: string;
  /** @deprecated NO-OP layer chip — accepted for back-compat, never rendered. */
  kind?: ReactNode;
  /** Note clause ("2 HTLCs at risk") — suppressed when it echoes the label. */
  note?: ReactNode;
  /** @deprecated Right-pinned faint detail ("last good 22m ago") — when no status. */
  detail?: ReactNode;
}

interface SeverityCardProps {
  /** The card's state — drives the accent bar, tint, border, icon tile, and chip. */
  sev: Severity;
  /** Headline identity for the card (node alias, host, incident title). */
  title: ReactNode;
  /** Optional override for the mono uppercase severity chip label (defaults per sev). */
  label?: ReactNode;
  /** The "why" paragraph under the title (the incident explanation). */
  why?: ReactNode;
  /** Optional stale-data pill in the header (gold, dashed). */
  stalePill?: boolean;
  /** Node implementation chip in the meta row ("Routing · LND"). */
  impl?: "lnd" | "ldk";
  /** Freshness chip in the meta row — worst-case source timestamp + stale flag. */
  freshness?: { asOf: Date | null; stale: boolean; now?: Date };
  /** Inline evidence panel (label + value + sparkline) on the right. */
  evidence?: SeverityEvidence;
  /** Whether the expand drawer is open (the caller owns the toggle state). */
  expanded?: boolean;
  /** Expand-toggle click — wires the chevron affordance (no handler → no toggle). */
  onToggle?: () => void;
  /** Expand-toggle copy ("Why-chain · 4 events" / "Hide"). */
  expandLabel?: ReactNode;
  /** Detection-chain events for the expand drawer's `WhyChain` timeline. */
  timeline?: WhyChainEvent[];
  /** AI-read advisory lines for the expand drawer's `AiReadPanel`. */
  aiLines?: AiReadLine[];
  /** Grouped child alerts shown in the expand drawer. */
  childAlerts?: SeverityChild[];
  /** Optional heading over the grouped child rows. */
  childrenLabel?: ReactNode;
  /**
   * Optional slot rendered INSIDE the drawer immediately AFTER the child rows — the
   * "show N more" / "show less" control the island supplies. Renders only when the
   * card is `expanded`.
   */
  childrenFooter?: ReactNode;
  /** Export affordance — opens a `CommandModal` with the runbook/command. */
  exportAction?: SeverityExport;
  /**
   * Free-form body slot (back-compat with the v1 header-strip card). Rendered as a
   * muted line under the title when no `why` is given — keeps existing callers and
   * the frozen gallery compiling.
   */
  body?: ReactNode;
  /**
   * Back-compat JSX body. The v1 gallery passes the evidence line as JSX
   * `children`; it renders as the muted body line (same as `body`) so the frozen
   * gallery keeps compiling. New callers should use `body`/`why` + `childAlerts`.
   */
  children?: ReactNode;
  /** Extra classes merged last via `cn()` (caller layout, width, etc.). */
  className?: string;
}

/**
 * A severity-tinted incident card with the full v2 composition: a washed icon
 * tile + sev chip header, an inline evidence panel, a meta row, and an expand
 * drawer (why-chain / AI-read / grouped children / export). Every region is
 * OPTIONAL and degrades gracefully — a bare `{ sev, title }` card still renders.
 */
export function SeverityCard({
  sev,
  title,
  label,
  why,
  stalePill,
  impl,
  freshness,
  evidence,
  expanded = false,
  onToggle,
  expandLabel,
  timeline,
  aiLines,
  childAlerts,
  childrenLabel,
  childrenFooter,
  exportAction,
  body,
  children,
  className,
}: SeverityCardProps) {
  const Icon = severityIcon[sev];
  const accentHex = chartAccentFor(sev);
  // The v1 JSX `children` is a back-compat body line; `body` wins if both given.
  const bodyNode = body ?? children;
  const hasMeta = impl !== undefined || freshness !== undefined || onToggle !== undefined;
  const hasDrawer =
    expanded &&
    ((timeline && timeline.length > 0) ||
      (aiLines && aiLines.length > 0) ||
      (childAlerts && childAlerts.length > 0) ||
      childrenFooter !== undefined ||
      exportAction !== undefined);

  return (
    <div
      className={cn(
        // structural shell — radius/shadow/border from df chrome-neutral tokens
        "overflow-hidden rounded-df-card border bg-df-surface shadow-df-rest transition-shadow hover:shadow-df-hover",
        // severity ramp supplies the tint bg + tint border + text role
        severityVariants({ sev }),
        className,
      )}
    >
      <div className="flex items-stretch">
        {/* 6px left accent bar — the bright NON-TEXT severity hue (state-only). */}
        <div className={cn("w-1.5 flex-none", severityAccent[sev])} aria-hidden="true" />

        <div className="flex min-w-0 flex-1 items-start gap-[18px] p-4">
          {/* 38×38 washed icon tile — a real leading block, not a bare inline glyph. */}
          <span
            className="mt-px flex size-[38px] flex-none items-center justify-center rounded-[10px]"
            style={{ backgroundColor: severityWash[sev] }}
            aria-hidden="true"
          >
            <Icon className="size-[19px]" strokeWidth={1.9} style={{ color: accentHex }} />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {/* Header row: white-on-accent sev chip + title + optional stale pill. */}
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={cn(
                  "rounded-[5px] px-2 py-0.5 font-df-mono text-[10.5px] font-bold tracking-[0.07em] text-white",
                  severityAccent[sev],
                )}
              >
                {label ?? severityLabel[sev]}
              </span>
              <h3 className="min-w-0 text-[15.5px] font-semibold tracking-[-0.01em] text-df-ink">
                {title}
              </h3>
              {stalePill && <StalePill />}
            </div>

            {/* Why paragraph (or the back-compat body line). */}
            {why !== undefined ? (
              <p className="max-w-[64ch] text-[13.5px] leading-relaxed text-df-muted">{why}</p>
            ) : (
              bodyNode !== undefined && (
                <div className="text-[13px] leading-relaxed text-df-muted">{bodyNode}</div>
              )
            )}

            {/* Meta row: layer chip + freshness + expand toggle. */}
            {hasMeta && (
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                {impl !== undefined && <ImplTag impl={impl} />}
                {freshness !== undefined && (
                  <FreshnessChip asOf={freshness.asOf} stale={freshness.stale} now={freshness.now} />
                )}
                {onToggle !== undefined && (
                  <ExpandToggle expanded={expanded} onToggle={onToggle} label={expandLabel} />
                )}
              </div>
            )}
          </div>

          {/* Inline evidence panel (the 212px inset) — label + value + sparkline. */}
          {evidence && (
            <div className="hidden w-[212px] flex-none sm:block">
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
                  height={evidence.height ?? 58}
                  idSuffix={evidence.idSuffix}
                />
              </EvidencePanel>
            </div>
          )}
        </div>
      </div>

      {/* Expand drawer — animated via the v2drop keyframe (globals.css). */}
      {hasDrawer && (
        <div
          className="border-t border-df-border-soft bg-df-surface-sub px-5 pt-4 pb-[18px] ps-[62px]"
          style={{ animation: "v2drop .2s ease" }}
        >
          {(timeline?.length || aiLines?.length) && (
            <div className="grid gap-7 lg:grid-cols-[1.1fr_1fr]">
              {timeline && timeline.length > 0 && <WhyChain events={timeline} />}
              {aiLines && aiLines.length > 0 && (
                <div>
                  <AiReadPanel lines={aiLines} />
                </div>
              )}
            </div>
          )}

          {childAlerts && childAlerts.length > 0 && (
            <div className="mt-4">
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
                    icon={ch.icon}
                    status={ch.status}
                    statusSev={ch.statusSev}
                    href={ch.href}
                    note={ch.note}
                    detail={ch.detail}
                  />
                ))}
              </div>
            </div>
          )}

          {/* "show N more" / "show less" slot — after the child rows, expanded only. */}
          {childrenFooter !== undefined && <div className="mt-2.5">{childrenFooter}</div>}

          {exportAction && (
            <div className="mt-4 flex">
              <CommandModal
                {...exportAction}
                sev={exportAction.sev ?? sev}
                trigger={<ExportButton label={exportAction.title} />}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Local composition helpers (header chip, meta toggle, export trigger)
// ─────────────────────────────────────────────────────────────

/** Map a severity to its chart-accent hex (the bright NON-TEXT hue) from tokens. */
export function chartAccentFor(sev: Severity): string {
  switch (sev) {
    case "critical":
      return DF.critical;
    case "warning":
      return DF.warning;
    case "watch":
      return DF.watch;
    case "healthy":
      return DF.ok;
    case "stale":
      return DF.staleDot;
  }
}

/** The gold dashed "STALE DATA" pill from the prototype header (Ops Center 292). */
function StalePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-dashed border-df-stale-border bg-df-stale-tint px-2 py-0.5 font-df-mono text-[10px] font-bold tracking-[0.04em] text-df-stale-text uppercase">
      <span className="size-1.5 flex-none rounded-[2px] bg-df-stale-dot" aria-hidden="true" />
      STALE DATA
    </span>
  );
}

/** The chevron expand toggle — rotates 90° when expanded (matches `inc.chev`). */
function ExpandToggle({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean;
  onToggle: () => void;
  label?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="-ms-1 inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5 text-xs font-semibold text-df-chrome transition-colors hover:bg-df-chrome/5"
    >
      <ChevronRight
        className={cn("size-[11px] transition-transform", expanded && "rotate-90")}
        strokeWidth={2.6}
        aria-hidden="true"
      />
      {label ?? (expanded ? "Hide why-chain" : "Why-chain")}
    </button>
  );
}

/** The navy export button used as the `CommandModal` trigger. */
function ExportButton({ label }: { label: ReactNode }) {
  return (
    <button
      type="button"
      className="rounded-df-btn bg-df-chrome px-3.5 py-2 text-[12.5px] font-semibold text-white"
    >
      {label}
    </button>
  );
}
