import Link from "next/link";

import type { Letter, StatusColor } from "@/lib/scorecard/types";
import type { TrendPoint } from "@/lib/console/trends";
import { GradeBadge } from "@/components/scorecard/GradeBadge";
import { Sparkline } from "./Sparkline";

// =====================================================
// EvidencePanel — per-dimension evidence (sketch 003 synthesis)
// =====================================================
// Server Component, one per graded dimension. Head = name + severity chip +
// "open {tab} →" deep link; body = mono evidence line + optional 160x40 navy
// sparkline (.evbody grid 1fr auto). Everything arrives PRE-FORMATTED
// (AFM-002 upstream) — zero math, zero unit conversion here (T-02-07). NO
// inline percentage anywhere: pct lives only in the chip's title tooltip
// (the 3-slot console header owns the single on-page inline %).

interface EvidencePanelProps {
  /** Dimension display name. */
  name: string;
  /** Chip passthrough — decided upstream, rendered verbatim (T-02-07). */
  color: StatusColor;
  letter: Letter | null;
  title?: string;
  /** Pre-formatted mono evidence line (AFM-002 upstream). */
  evidence: string;
  /** "open {tab} →" deep link target. */
  href?: string;
  /** e.g. "forwards" — the link text. */
  tabLabel?: string;
  /** Sparkline series; omitted/empty/single-point → evidence line only. */
  series?: TrendPoint[] | null;
}

export function EvidencePanel({
  name,
  color,
  letter,
  title,
  evidence,
  href,
  tabLabel,
  series,
}: EvidencePanelProps) {
  const hasSparkline = (series?.length ?? 0) >= 2;

  return (
    <section className="rounded-lg border border-border bg-card">
      {/* Panel head: name + chip + deep link (sketch panel-head grammar). */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="font-mono text-xs font-semibold tracking-[0.14em] text-foreground/45 uppercase">
          {name}
        </span>
        <GradeBadge size="sm" color={color} letter={letter} title={title} />
        {href !== undefined && (
          <Link
            href={href}
            className="ms-auto font-mono text-xs text-brand-light transition-colors hover:text-brand-glow"
          >
            {`open ${tabLabel ?? "evidence"} →`}
          </Link>
        )}
      </div>

      {/* Body: .evbody grid 1fr auto — mono evidence line + optional sparkline. */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-4">
        <span className="font-mono text-sm tabular-nums text-foreground/80">{evidence}</span>
        {hasSparkline && <Sparkline points={series as TrendPoint[]} />}
      </div>
    </section>
  );
}
