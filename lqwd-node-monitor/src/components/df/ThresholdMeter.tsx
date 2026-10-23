import { severityAccent, type Severity } from "@/components/df/Severity";
import { cn } from "@/lib/utils";

// =====================================================
// ThresholdMeter — the D-03 severity fill meter (Server)
// =====================================================
// A horizontal severity-ramp-colored fill meter: 6px hairline track (df-border-soft,
// rounded-df-pill) + a colored fill proportional to a 0–100 pct value. Shared by the
// HOST-01 card CPU/MEM/DISK meters and the HOST-02 storage volume rows.
//
// PRESENTATION-PURE (the 12-10 lesson): the caller computes `sev` from the read-time
// band config (telemetry-bands / days-to-full bands, D-13) — this component NEVER
// derives severity from pct and NEVER hardcodes a threshold. The fill class comes
// exclusively from `severityAccent[sev]` (Severity.ts is the ONE sev→class source).
//
// Honest-stale (DS-01/D-06): `stale` renders the gold df-stale-* dashed/hatched track
// with NO colored fill — a meter can never paint green or red off old data.
//
// A11y: role="meter" + aria-valuenow/min/max + aria-label. Never color alone — the
// consumer always renders an adjacent mono numeric value (e.g. `82%`).

interface ThresholdMeterProps {
  /** Fill percentage 0–100 — clamped; rendered literally as the fill width. */
  pct: number;
  /** Severity computed by the CALLER from read-time bands — never derived here. */
  sev: Severity;
  /** Honest-stale: gold dashed track, no severity fill (DS-01). */
  stale?: boolean;
  /** Accessible name for the meter, e.g. "CPU usage". */
  label?: string;
  /** Extra classes merged last via `cn()`. */
  className?: string;
}

/**
 * The D-03 threshold meter. Fill color is `severityAccent[sev]` only; fill width is
 * the clamped pct. `stale` swaps the whole track for the gold dashed no-fill
 * treatment — never a fresh-looking fill off old data.
 */
export function ThresholdMeter({ pct, sev, stale = false, label, className }: ThresholdMeterProps) {
  const clamped = Math.min(100, Math.max(0, pct));
  const meterA11y = {
    role: "meter" as const,
    "aria-valuenow": clamped,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-label": label ?? (stale ? "usage meter (stale data)" : "usage meter"),
  };

  if (stale) {
    // Gold hatched/dashed stale track — NO severity fill, ever (D-06/Pitfall 4).
    return (
      <div
        {...meterA11y}
        className={cn(
          "h-1.5 w-full rounded-df-pill border border-dashed border-df-stale-border bg-df-stale-tint",
          className,
        )}
        style={{
          // faint diagonal hatch echoing StaleChart's gold stripes
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 3px, var(--color-df-stale-border) 3px, var(--color-df-stale-border) 4px)",
        }}
      />
    );
  }

  return (
    <div
      {...meterA11y}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-df-pill border border-df-border-soft bg-df-border-soft",
        className,
      )}
    >
      <div
        className={cn("h-full rounded-df-pill", severityAccent[sev])}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
