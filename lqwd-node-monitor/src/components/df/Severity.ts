import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Eye,
  type LucideIcon,
} from "lucide-react";

// =====================================================
// Severity.ts — the SINGLE source of truth for the DS-02 severity ramp
// =====================================================
// DS-01 contract: severity color is STATE only and is set-disjoint from the
// navy chrome/brand structure tokens. Every df severity primitive (SeverityCard,
// SeverityRow, …) consumes `severityVariants` — there are NO `if (sev === …)`
// class chains anywhere else (RESEARCH anti-pattern). The five ramp states map
// 1:1 to the `--color-df-*` utility classes defined in `globals.css`:
//   critical → df-critical, warning → df-warning, watch → df-watch,
//   healthy → df-ok, stale → df-stale.
// `healthy` deliberately uses the green ramp; `stale` is the honest no-fresh-data
// gold (shape-distinct treatment lives in the consuming primitives).

/**
 * The accent / tint / border ramp keyed by severity. The base class is empty —
 * each consumer layers it onto its own structural classes (accent bar, padding,
 * radius) via `cn()`. Only the severity-bearing surface classes live here so the
 * ramp stays the one place a sev→class mapping is allowed to exist.
 */
export const severityVariants = cva("", {
  variants: {
    sev: {
      critical: "bg-df-critical-tint border-df-critical-border text-df-critical",
      warning: "bg-df-warning-tint border-df-warning-border text-df-warning",
      watch: "bg-df-watch-tint border-df-watch-border text-df-watch",
      // No dedicated `--color-df-ok-border` token shipped in 10-01; the bright
      // `df-ok` hue is the closest canonical token for healthy's hairline border.
      healthy: "bg-df-ok-tint border-df-ok text-df-ok-text",
      stale: "bg-df-stale-tint border-df-stale-border text-df-stale-text",
    },
  },
  defaultVariants: {
    sev: "healthy",
  },
});

/** The five-state ramp — the only severities any df primitive accepts. */
export type Severity = NonNullable<VariantProps<typeof severityVariants>["sev"]>;

/**
 * Accent-bar / dot color class per severity (the bright NON-TEXT hue). The card's
 * 6px left bar and a row's leading dot paint with these — distinct from the `-text`
 * AA-text role the ramp's `text-*` slot carries.
 */
export const severityAccent: Record<Severity, string> = {
  critical: "bg-df-critical",
  warning: "bg-df-warning",
  watch: "bg-df-watch",
  healthy: "bg-df-ok",
  stale: "bg-df-stale-dot",
};

/**
 * D-06 permits icons in v2 — one lucide glyph per severity. AlertOctagon reads as
 * a hard stop (critical), AlertTriangle as caution (warning), Eye as "watch this"
 * (watch), CheckCircle2 as healthy, CircleDashed as the honest stale/no-data glyph.
 */
export const severityIcon: Record<Severity, LucideIcon> = {
  critical: AlertOctagon,
  warning: AlertTriangle,
  watch: Eye,
  healthy: CheckCircle2,
  stale: CircleDashed,
};

/** Short uppercase label per severity (the mono kicker on cards/rows). */
export const severityLabel: Record<Severity, string> = {
  critical: "CRITICAL",
  warning: "WARNING",
  watch: "WATCH",
  healthy: "HEALTHY",
  stale: "STALE",
};

/**
 * AA text-color class per severity — the ONLY sanctioned place a severity maps to a
 * `text-*` role for the right-pinned status word on a condensed child row (D-R5).
 * Distinct from `severityAccent` (the bright NON-TEXT dot/bar hue): these are the
 * AA-legible text hues (`healthy`→`ok-text`, `stale`→`stale-text`). Consumers read
 * this map instead of inlining `if (sev === …)` chains, keeping Severity.ts the
 * single sev→class source.
 */
export const severityText: Record<Severity, string> = {
  critical: "text-df-critical",
  warning: "text-df-warning",
  watch: "text-df-watch",
  healthy: "text-df-ok-text",
  stale: "text-df-stale-text",
};
