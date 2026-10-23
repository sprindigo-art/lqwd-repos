import Link from "next/link";

import type { ExportBlock } from "@/lib/export/block";
import type { EnqueueAffordance } from "@/lib/queue/enqueue-props";
import { CommandExport } from "@/components/export/CommandExport";
import { EnqueuePreview } from "@/components/queue/EnqueuePreview";

// =====================================================
// ActiveSignalsPanel — top-of-console signals (sketch 003 synthesis)
// =====================================================
// Server Component. THE gap-4 fix: signals get their OWN red-headed panel,
// physically severed from grades (chips live in the rail/evidence heads — the
// two never share a container). One row per tier-1 breach (red), fleet-outlier
// (amber), or per-node insight card (Phase 4, D-08 — severity-tinted). The
// SignalRow[] is BUILT BY THE CALLER (03-15) from node.dimensions — this
// component renders it VERBATIM, no health logic (T-02-07). Disappears
// entirely on healthy nodes; the page composes without it (rail + evidence
// panels carry it).

export interface SignalRow {
  kind: "breach" | "outlier" | "insight";
  /** Breach label, "fleet outlier — {dimension}", or insight SIGNAL_LABELS entry. */
  label: string;
  /** Pre-formatted mono why-line (AFM-002 upstream). */
  detail: string;
  /** "open {tab} →" deep link. */
  href?: string;
  tabLabel?: string;
  /** Insight rows only — pre-computed by the caller (D-01 taxonomy). */
  severity?: "critical" | "warn" | "info";
  /** Insight rows only — suppression reason / hysteresis hold (D-14/D-15 visibility). */
  stateLine?: string;
  /** Insight rows only — pre-built export block (Phase 5); strings only, never the card. */
  exportBlock?: ExportBlock;
  /** Insight rows only — server-resolved enqueue affordance (Phase 6, D-01);
      the backend gate is resolved by the caller via the server-only props
      builder, so this panel never imports backendFor (serializable only). */
  enqueue?: EnqueueAffordance;
}

/** Severity → label text class (same status tokens as breach/outlier — no new colors). */
const INSIGHT_LABEL_CLASS: Record<NonNullable<SignalRow["severity"]>, string> = {
  critical: "font-mono text-xs font-semibold tracking-[0.06em] text-status-critical uppercase",
  warn: "font-mono text-xs font-semibold tracking-[0.06em] text-status-warn uppercase",
  info: "font-mono text-xs font-semibold tracking-[0.06em] text-foreground/70 uppercase",
};

interface ActiveSignalsPanelProps {
  signals: SignalRow[];
}

export function ActiveSignalsPanel({ signals }: ActiveSignalsPanelProps) {
  // Healthy node → no panel at all (sketch rule: the absence IS the signal).
  if (signals.length === 0) return null;

  return (
    <section className="rounded-lg border border-status-critical/40 bg-card">
      {/* Red panel-head — the severed-from-grades marker. */}
      <div className="flex items-center border-b border-border px-4 py-2.5">
        <span className="font-mono text-xs font-semibold tracking-[0.14em] text-status-critical uppercase">
          Active signals
        </span>
        <span className="ms-auto font-mono text-xs tabular-nums text-foreground/45">
          {signals.length}
        </span>
      </div>

      {signals.map((signal, i) =>
        signal.kind === "insight" ? (
          // Insight rows (Phase 4): severity-mapped label + the same mono
          // why-line/href anatomy, plus an optional stateLine second line —
          // the visible suppression/hysteresis surface on the console (D-14).
          <div
            key={`${signal.kind}-${signal.label}-${i}`}
            className="border-b border-border px-4 py-3 last:border-b-0"
          >
            <div className="flex items-baseline gap-4">
              <span className={INSIGHT_LABEL_CLASS[signal.severity ?? "info"]}>
                {signal.label}
              </span>
              <span className="font-mono text-xs text-foreground/60">{signal.detail}</span>
              {signal.href !== undefined && (
                <Link
                  href={signal.href}
                  className="ms-auto font-mono text-xs whitespace-nowrap text-brand-light transition-colors hover:text-brand-glow"
                >
                  {`open ${signal.tabLabel ?? "evidence"} →`}
                </Link>
              )}
            </div>
            {signal.stateLine !== undefined && (
              <p className="mt-1 font-mono text-xs text-status-warn/70">{signal.stateLine}</p>
            )}
            {/* Phase 5 (D-01): the SAME export leaf as /inbox on exportable rows.
                The page's buildInsightSignals pre-built the ExportBlock (strings
                only, never the card — T-05-03); this stays a verbatim renderer. */}
            {signal.exportBlock && (
              <CommandExport block={signal.exportBlock} blockId={`export-signal-${i}`} />
            )}
            {/* Phase 6 (D-01): the SAME enqueue leaf as /inbox. The caller resolved
                the backend server-side (backendFor) into a serializable affordance;
                this stays a verbatim renderer. LDK → honest unsupported state. */}
            {signal.enqueue?.kind === "lnd" && <EnqueuePreview {...signal.enqueue.props} />}
            {signal.enqueue?.kind === "ldk" && (
              <p className="mt-2 border-t border-status-warn/30 pt-2 font-mono text-xs tracking-[0.06em] text-status-warn uppercase">
                LDK fee enqueue not yet supported — deferred to Phase 7
              </p>
            )}
          </div>
        ) : (
          <div
            key={`${signal.kind}-${signal.label}-${i}`}
            className="flex items-baseline gap-4 border-b border-border px-4 py-3 last:border-b-0"
          >
            <span
              className={
                signal.kind === "breach"
                  ? "font-mono text-xs font-semibold tracking-[0.06em] text-status-critical uppercase"
                  : "font-mono text-xs font-semibold tracking-[0.06em] text-status-warn lowercase"
              }
            >
              {signal.label}
            </span>
            <span className="font-mono text-xs text-foreground/60">{signal.detail}</span>
            {signal.href !== undefined && (
              <Link
                href={signal.href}
                className="ms-auto font-mono text-xs whitespace-nowrap text-brand-light transition-colors hover:text-brand-glow"
              >
                {`open ${signal.tabLabel ?? "evidence"} →`}
              </Link>
            )}
          </div>
        ),
      )}
    </section>
  );
}
