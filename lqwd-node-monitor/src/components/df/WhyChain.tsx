// =====================================================
// WhyChain — detection / why-chain timeline spine (DS-02, Server)
// =====================================================
// The dot-and-line vertical timeline the prototype reveals inside an expanded
// incident card ("Why this is flagged · detection chain"): each event is a
// severity-colored dot, a connecting line down to the next event, a mono
// timestamp, and the event text. The last event's connector is transparent so
// the spine terminates cleanly.
//
// Ported from the locked Ops Center v2 snapshot `evColors`/`buildTimeline`
// (lines 686-688) and the timeline markup (lines 192-203 / 321-332). Pure
// props-driven HTML — no Recharts — so it renders SSR-safe under
// `renderToStaticMarkup`.
//
// Severity grammar: WhyChain consumes the canonical five-state `Severity` ramp
// (Severity.ts) rather than the prototype's ad-hoc `info/warn/crit/watch/stale`
// keys, keeping it set-disjoint with every other df primitive. The per-severity
// dot/line hexes below ARE the prototype `evColors` values, expressed against the
// canonical ramp (critical=crit, warning=warn, watch, stale; healthy maps to the
// prototype's neutral `info` row). They're df severity/decorative hexes mirrored
// in tokens.ts — never the legacy NOC chrome tokens (noc-guard clean).

import { severityLabel, severityText, type Severity } from "@/components/df/Severity";
import { DF } from "@/lib/df/tokens";
import { cn } from "@/lib/utils";

/** One detection-chain event on the spine. */
export interface WhyChainEvent {
  /** Mono timestamp, e.g. "14:08", or `null` when the event carries no time. */
  time: string | null;
  /** The event sentence, e.g. "Chain tip unchanged for 3 polls → host flagged". */
  text: string;
  /** Severity of THIS event — drives the dot + connector color. */
  severity: Severity;
}

export interface WhyChainProps {
  /** Ordered detection events, oldest → newest (the spine reads top to bottom). */
  events: WhyChainEvent[];
  /**
   * Optional eyebrow over the spine. Defaults to the prototype copy; pass `null`
   * to suppress it when the surface already prints its own section label (audit
   * A4 — kills the "Detection chain" / "Why this is flagged · detection chain"
   * double header on the incident detail page).
   */
  label?: string | null;
}

/**
 * Per-severity dot + connector colors. These are the prototype `evColors` values
 * (line 686) re-keyed onto the canonical `Severity` ramp:
 *   critical → crit, warning → warn, watch → watch, stale → stale,
 *   healthy  → the prototype's neutral `info` row (faint dot, soft gray line).
 * `dot` is the bright/decorative hue; `line` is the muted connector tint.
 */
const evColors: Record<Severity, { dot: string; line: string }> = {
  critical: { dot: DF.critical, line: "#F1D3CF" },
  warning: { dot: DF.warning, line: "#EADFC8" },
  watch: { dot: DF.watch, line: DF.watchBorder }, // #C2E3DD
  healthy: { dot: DF.faint, line: "#E2E5EB" }, // prototype "info" neutral row
  stale: { dot: DF.staleText, line: DF.staleBorder }, // #A9912F / #E9DCB6
};

/**
 * Vertical detection-chain timeline. Props-driven; each event renders a colored
 * dot, a connector to the next event (transparent on the last), a mono timestamp,
 * and the event text. SSR-renderable (plain HTML, no Recharts).
 */
export function WhyChain({
  events,
  label = "Why this is flagged · detection chain",
}: WhyChainProps) {
  return (
    <div>
      {label !== null && (
        <div className="mb-[13px] font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
          {label}
        </div>
      )}
      <div className="flex flex-col">
        {events.map((ev, i) => {
          const c = evColors[ev.severity];
          const isLast = i === events.length - 1;
          // The last connector is transparent so the spine ends without a dangling
          // line — matches `buildTimeline` (line:i===last?'transparent':c.line).
          const lineColor = isLast ? "transparent" : c.line;
          return (
            <div key={i} className="flex gap-3">
              {/* dot + connector rail */}
              <div className="flex flex-none flex-col items-center">
                <span
                  className="size-[9px] flex-none rounded-full"
                  style={{
                    background: c.dot,
                    border: "2px solid #FAFBFD",
                    boxShadow: `0 0 0 1px ${c.dot}`,
                  }}
                />
                <span
                  className="w-0.5 flex-1"
                  style={{ background: lineColor, minHeight: "14px" }}
                />
              </div>
              {/* timestamp (omitted when absent — no "—" wall) + severity word + text */}
              <div className="min-w-0 pb-[14px]">
                <div className="flex items-center gap-2">
                  {ev.time !== null && (
                    <span className="font-df-mono text-[11px] text-df-muted">{ev.time}</span>
                  )}
                  <span
                    className={cn(
                      "font-df-mono text-[9.5px] font-semibold tracking-[0.06em] uppercase",
                      severityText[ev.severity],
                    )}
                  >
                    {severityLabel[ev.severity]}
                  </span>
                </div>
                <p className="mt-px text-[13px] leading-[1.45] text-df-ink">{ev.text}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
