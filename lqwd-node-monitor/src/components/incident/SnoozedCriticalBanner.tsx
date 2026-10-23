import { severityVariants } from "@/components/df/Severity";
import { cn } from "@/lib/utils";

// =====================================================
// SnoozedCriticalBanner — D-04 honesty banner (Server, non-dismissible)
// =====================================================
// The honesty mechanism: snoozing declutters but never fully HIDES a critical.
// Persistent, fleet-wide, always-visible whenever ≥1 critical is snoozed; zero
// snoozed criticals → the banner is absent. There is deliberately NO dismiss
// control (unlike the AI read) — muting a critical must stay visible until it is
// un-snoozed or resolved (D-04 invariant / threat T-17-16 info-hiding).
//
// DS-01: this is a STATE surface, so it wears the critical severity ramp via the
// sanctioned `severityVariants` mapper (tint/border/text) + a 3px left
// `.sectionbar`-grammar border — NEVER navy. Pure server component: no client
// directive, no interactivity, no dismiss handler.

interface SnoozedCriticalBannerProps {
  /** Number of snoozed CRITICAL incidents (the reconcile `snoozedCriticals` length). */
  count: number;
}

/**
 * Renders `null` when `count === 0` (absent); otherwise the critical-ramp honesty
 * banner with the pluralized UI-SPEC copy and the count in mono `tabular-nums`.
 */
export function SnoozedCriticalBanner({ count }: SnoozedCriticalBannerProps) {
  if (count <= 0) return null;

  const noun = count === 1 ? "incident" : "incidents";

  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 border-l-[3px] px-4 py-2.5",
        severityVariants({ sev: "critical" }),
      )}
    >
      <span className="font-df-mono text-sm font-bold tabular-nums">{count}</span>
      <span className="font-df-mono text-xs font-semibold tracking-[0.07em]">
        snoozed critical {noun} — muted, not resolved
      </span>
    </div>
  );
}
