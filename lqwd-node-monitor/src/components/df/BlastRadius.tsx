// =====================================================
// BlastRadius — root-cause → impacted-nodes containment view (DS-02, Server)
// =====================================================
// One root-cause card wired to N impacted targets. Rebuilt from the original
// fixed-648px SVG (which clipped variable-length labels and pinned itself far-left,
// unable to use container width — audit A2) into responsive df-token HTML:
//   • the root-cause card leads, tinted by the incident's OWN severity;
//   • each target is an instrument row — severity dot, a neutral layer type-tag
//     (VM/SERVICE/NODE/… — audit C2), the mono id, a truncated note (full text on
//     hover via `title`), and the explicit severity WORD (color is never the sole
//     signal — audit A8);
//   • every row is colored by its OWN severity via the canonical ramp, so a WATCH
//     incident no longer renders an all-red tree (audit A3).
// Pure props-driven HTML, no hardcoded hexes — SSR-safe and noc-guard clean.

import { severityVariants, severityAccent, severityText, severityLabel, type Severity } from "./Severity";
import { LayerTag } from "./LayerTag";
import type { IncidentLayer } from "@/lib/overview/incidents";
import { cn } from "@/lib/utils";

/** A node impacted by the root cause — drawn as one instrument row. */
export interface BlastTarget {
  /** Node id, e.g. "lqwd-rtr-04" — rendered mono. */
  name: string;
  /** The risk note, e.g. "2 HTLCs at risk" / "channel state stale". */
  note: string;
  /**
   * This target's OWN severity — colors its dot/tint/status word so the diagram
   * reflects real state, not an all-red tree (audit A3). Optional: callers without
   * per-target severity render a neutral row.
   */
  sev?: Severity;
  /** This target's layer — drives the neutral VM/SERVICE/NODE type tag (audit C2). */
  layer?: IncidentLayer;
}

export interface BlastRadiusProps {
  /** Root-cause host id, e.g. "host-03" — rendered mono inside the root card. */
  host: string;
  /** The root-cause failure line, e.g. "bitcoind stalled" — under the host id. */
  hostStatus: string;
  /** The incident's rolled-up severity — tints the root card. Defaults to critical. */
  rootSev?: Severity;
  /** Impacted nodes (1..N). Each gets an instrument row. */
  targets: BlastTarget[];
  /** Eyebrow over the root card. Defaults to the prototype copy. */
  rootCauseLabel?: string;
}

/**
 * Root-cause blast-radius containment view. Fully responsive: the root card and
 * the target list stack in a narrow rail and never clip. Renders in every severity
 * state; a single target or twelve both lay out cleanly.
 */
export function BlastRadius({
  host,
  hostStatus,
  rootSev = "critical",
  targets,
  rootCauseLabel = "ROOT CAUSE · FIX HERE",
}: BlastRadiusProps) {
  return (
    <div
      role="group"
      aria-label={`Blast radius: ${host} affecting ${targets.length} node${
        targets.length === 1 ? "" : "s"
      }`}
      className="flex flex-col gap-3"
    >
      {/* ── root cause card — tinted by the incident's own severity ── */}
      <div>
        <div className="mb-1.5 font-df-mono text-[9.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
          {rootCauseLabel}
        </div>
        <div
          className={cn(
            "rounded-[10px] border-2 px-3 py-2.5",
            severityVariants({ sev: rootSev }),
          )}
        >
          <div className="truncate font-df-mono text-[13px] font-bold text-df-ink" title={host}>
            {host}
          </div>
          <div className={cn("mt-0.5 truncate text-[11px] font-medium", severityText[rootSev])} title={hostStatus}>
            {hostStatus}
          </div>
        </div>
        <div className="mt-1.5 font-df-mono text-[10.5px] text-df-muted">
          {targets.length} impacted {targets.length === 1 ? "entity" : "entities"}
        </div>
      </div>

      {/* ── impacted targets — one instrument row each, colored by own severity
          (neutral when the caller supplies none) ── */}
      <ul className="flex flex-col gap-1.5">
        {targets.map((t, i) => (
          <li
            key={`${t.name}-${i}`}
            className={cn(
              "flex items-center gap-2 rounded-[8px] border px-2.5 py-2",
              t.sev
                ? severityVariants({ sev: t.sev })
                : "border-df-border-soft bg-df-surface",
            )}
          >
            <span
              className={cn(
                "size-2 flex-none rounded-full",
                t.sev ? severityAccent[t.sev] : "bg-df-faint",
              )}
              aria-hidden="true"
            />
            {t.layer !== undefined && <LayerTag layer={t.layer} className="flex-none" />}
            <span
              className="min-w-0 flex-none truncate font-df-mono text-[11.5px] font-semibold text-df-ink"
              title={t.name}
            >
              {t.name}
            </span>
            <span className="min-w-0 truncate text-[11px] text-df-muted" title={t.note}>
              {t.note}
            </span>
            {t.sev !== undefined && (
              <span
                className={cn(
                  "ms-auto flex-none font-df-mono text-[10px] font-semibold tracking-[0.06em] uppercase",
                  severityText[t.sev],
                )}
              >
                {severityLabel[t.sev]}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
