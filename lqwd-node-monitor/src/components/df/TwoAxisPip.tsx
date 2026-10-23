import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";

// =====================================================
// TwoAxisPip — running × functioning service tile (Server)
// =====================================================
// The node-detail two-axis service grammar (prototype Node Detail tiles 154-187 +
// the green-only-when-both logic 562-574). A service is HEALTHY only when it is
// BOTH running AND functioning; "running but not functioning" is the dangerous
// "up but dead" state and renders a visually DISTINCT alarming treatment so it
// can never be mistaken for healthy.
//
// G4 fidelity rebuild — restores the prototype's full tile composition:
//   • tile chrome: 4px left accent bar + per-state tint/border + rounded card;
//   • header: service name + right-aligned status chip whose alarm dot PULSES
//     (the `v2pulse` keyframe) in the up-but-dead / down states;
//   • two BOXED inset sub-panels ("Running" / "Functioning"), each a bordered
//     inset with a 9px uppercase caption + check/cross glyph + yes/no text, the
//     Functioning box red-tinted when it fails;
//   • a divided footer: `last heartbeat`, `last run` (red when "failed"), and
//     `errors · 1h`, each a label/value pair with conditional value colors.
//
// Strict-precedence combined state, mirrored on DimensionRow's early-return state
// machine. Numerics here are plain counts/ages (error counts, heartbeat ages) —
// NO sat math, so no units.ts dependency.

interface TwoAxisPipProps {
  /** Process is up (systemd/supervisor reports the unit active). */
  running: boolean;
  /** Process is doing its job (heartbeat fresh, last run succeeded). */
  functioning: boolean;
  /** Optional service name shown in the tile header (e.g. "addressBalances"). */
  name?: string;
  /** Optional last-heartbeat age string (already humanized, e.g. "8s ago"). */
  heartbeat?: string;
  /**
   * Optional last-run summary (already humanized, e.g. "2m ago · ok" or
   * "failed 41m ago"). Rendered red when it contains "failed".
   */
  lastRun?: string;
  /** Optional error count over the trailing window (plain integer). */
  errorCount?: number;
  /** Extra classes merged last via `cn()`. */
  className?: string;
}

/** Combined health: green ONLY when both axes are true; otherwise a red state. */
function combinedState(
  running: boolean,
  functioning: boolean,
): { label: string; ok: boolean } {
  // STRICT precedence, green-only-when-both (prototype 562-574):
  if (running && functioning) return { label: "HEALTHY", ok: true };
  if (running && !functioning) return { label: "UP · NOT HEALTHY", ok: false };
  return { label: "DOWN", ok: false };
}

/**
 * One BOXED axis sub-panel — a bordered inset with a 9px uppercase caption, a
 * check/cross glyph, and yes/no text. The box red-tints when the axis fails
 * (prototype `funcBg`/`funcBorder`); a passing axis uses the neutral inset wash.
 */
function AxisBox({ label, on }: { label: string; on: boolean }) {
  const Icon = on ? Check : X;
  return (
    <div
      className={cn(
        "flex-1 rounded-lg border px-2.5 py-2",
        on
          ? "border-df-border-soft bg-df-surface-sub"
          : "border-df-critical-border bg-df-critical-tint",
      )}
    >
      <div className="font-df-mono text-[9px] font-bold tracking-[0.05em] text-df-muted uppercase">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <Icon
          className={cn("size-3.5 flex-none", on ? "text-df-ok" : "text-df-critical")}
          strokeWidth={2.6}
          aria-hidden="true"
        />
        <span
          className={cn(
            "font-df-mono text-xs font-semibold",
            on ? "text-df-ok-text" : "text-df-critical",
          )}
        >
          {on ? "yes" : "no"}
        </span>
      </div>
    </div>
  );
}

/** One divided-footer label/value row with a conditional value color. */
function FooterRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10.5px] whitespace-nowrap text-df-muted">{label}</span>
      <span
        className={cn(
          "font-df-mono text-[10.5px] font-semibold whitespace-nowrap tabular-nums",
          valueClassName ?? "text-df-muted",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Two-axis running × functioning service tile. Green only when BOTH axes pass;
 * the up-but-dead state is unmistakably distinct — red tile chrome + a pulsing
 * alarm dot + a red "Functioning: no" box. Renders error/heartbeat/last-run
 * numerics without throwing.
 */
export function TwoAxisPip({
  running,
  functioning,
  name,
  heartbeat,
  lastRun,
  errorCount,
  className,
}: TwoAxisPipProps) {
  const state = combinedState(running, functioning);
  const hasFooter =
    heartbeat !== undefined || lastRun !== undefined || errorCount !== undefined;

  // Heartbeat goes gold when stale (prototype `hbColor` #A9912F on "stale").
  const heartbeatStale = heartbeat !== undefined && /stale/i.test(heartbeat);
  // Last run goes red when the last run failed (prototype `lastRunColor`).
  const lastRunFailed = lastRun !== undefined && /failed/i.test(lastRun);

  return (
    <div
      className={cn(
        // Tile chrome: 4px left accent bar + per-state tint/border + rounded card.
        "rounded-[13px] border border-l-4 p-4",
        state.ok
          ? "border-df-border border-l-df-ok bg-df-surface"
          : "border-df-critical-border border-l-df-critical bg-df-critical-tint",
        className,
      )}
    >
      {/* Header: service name + right-aligned status chip (alarm dot pulses). */}
      <div className="flex items-center gap-2">
        {name !== undefined && (
          <span className="truncate text-[13.5px] font-semibold text-df-ink">
            {name}
          </span>
        )}
        <span
          className={cn(
            "ms-auto inline-flex w-fit items-center gap-1.5 rounded-df-pill px-2 py-0.5 font-df-mono text-[9.5px] font-bold tracking-[0.04em] whitespace-nowrap uppercase",
            state.ok
              ? "bg-df-ok-tint text-df-ok-text"
              : "bg-df-critical-tint text-df-critical",
          )}
        >
          <span
            className={cn(
              "size-1.5 flex-none rounded-full",
              state.ok ? "bg-df-ok" : "bg-df-critical",
              // Pulse the alarm dot in the non-healthy states (prototype nmpulse).
              !state.ok && "animate-[v2pulse_1.5s_infinite]",
            )}
            aria-hidden="true"
          />
          {state.label}
        </span>
      </div>

      {/* Two BOXED inset sub-panels — Functioning red-tints on failure. */}
      <div className="mt-3 flex gap-2">
        <AxisBox label="Running" on={running} />
        <AxisBox label="Functioning" on={functioning} />
      </div>

      {/* Divided footer: last heartbeat · last run · errors · 1h. */}
      {hasFooter && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-df-border-soft pt-3">
          {heartbeat !== undefined && (
            <FooterRow
              label="last heartbeat"
              value={heartbeat}
              valueClassName={heartbeatStale ? "text-df-stale-text" : "text-df-muted"}
            />
          )}
          {lastRun !== undefined && (
            <FooterRow
              label="last run"
              value={lastRun}
              valueClassName={lastRunFailed ? "text-df-critical" : "text-df-muted"}
            />
          )}
          {errorCount !== undefined && (
            <FooterRow
              label="errors · 1h"
              value={errorCount.toLocaleString("en-US")}
              valueClassName={
                errorCount > 5
                  ? "text-df-critical"
                  : errorCount > 0
                    ? "text-df-warning"
                    : "text-df-muted"
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
