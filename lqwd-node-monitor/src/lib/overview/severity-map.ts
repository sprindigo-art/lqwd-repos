// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// severity-map.ts — the SINGLE documented severity normalization boundary (D-06)
// =====================================================
// Four upstream subsystems each speak a different severity dialect:
//   • insight       → "critical" | "warn" | "info"        (no -ing, `info` not `watch`)
//   • telemetry band→ "healthy" | "warn" | "critical"     (no native watch tier)
//   • service-health→ two-axis booleans (running ∧ functioning), NOT a ramp
//   • scorecard     → (routed through the helpers below)
// Every one of them MUST cross into the canonical df `Severity` 5-state ramp
// through exactly these four functions. A blind string passthrough silently
// produces an invalid df `sev`, which falls through `severityVariants` to
// `healthy` and mis-colors incidents (RESEARCH Pitfall 1). Each function's input
// is typed to the literal source union so a raw `"warn"` cannot leak through —
// TypeScript rejects it at the call site, the type system IS the guard.

import type { Severity } from "@/components/df/Severity";
import type { ServiceHealthState } from "@/lib/read/service-health";

/**
 * insight severity → df Severity.
 *   critical → critical, warn → warning (insight drops the -ing),
 *   info → watch.
 *
 * DISCRETIONARY A1 RESOLVED (D-06): insight `info` maps to df `watch`, NOT hidden.
 * Info cards are surfaced advisories the operator should keep an eye on, so they
 * land on the lowest active rung (`watch`) rather than vanishing into `healthy`.
 */
export function severityFromInsight(s: "critical" | "warn" | "info"): Severity {
  switch (s) {
    case "critical":
      return "critical";
    case "warn":
      return "warning";
    case "info":
      return "watch";
  }
}

/**
 * telemetry-band severity → df Severity.
 *   critical → critical, warn → warning, healthy → healthy.
 * Bands have no native `watch` tier — they never emit one.
 */
export function severityFromBand(b: "healthy" | "warn" | "critical"): Severity {
  switch (b) {
    case "critical":
      return "critical";
    case "warn":
      return "warning";
    case "healthy":
      return "healthy";
  }
}

/**
 * two-axis service health → df Severity, by documented precedence:
 *   1. noData      → stale   (declared-but-silent; never a false outage)
 *   2. stale       → stale   (per-service functioning-staleness, D-17)
 *   3. !running    → critical
 *   4. !functioning→ critical (running but dead — the "up but dead" guard)
 *   5. else        → healthy
 *
 * DISCRETIONARY A2 RESOLVED (D-06): the no-data case and the functioning-stale
 * case BOTH collapse into one `stale` bucket — there is no 6th segment. `stale`
 * is the honest "no fresh fact" state regardless of which clock produced it.
 * `collectorStale` is deliberately NOT consulted here: a stale collector tick does
 * not down a batch service (it is surfaced separately upstream).
 */
export function severityFromService(s: ServiceHealthState): Severity {
  if (s.noData) return "stale";
  if (s.stale) return "stale";
  if (!s.running) return "critical";
  if (!s.functioning) return "critical";
  return "healthy";
}

// Fixed worst-child rank on the ACTIVE ramp only. `stale` is intentionally absent:
// it is orthogonal to the critical→healthy axis (D-08) and must never participate
// in the reduction (see worstSeverity).
const RAMP_RANK: Record<Exclude<Severity, "stale">, number> = {
  critical: 3,
  warning: 2,
  watch: 1,
  healthy: 0,
};

/**
 * Reduce a set of child severities to the single worst rung on
 * critical > warning > watch > healthy.
 *
 * `stale` is ORTHOGONAL (D-08 / D-02): it is filtered out BEFORE reducing so a
 * stale child can never promote an otherwise-healthy parent to critical. Staleness
 * is surfaced via a separate flag, not through this reducer. Empty input (or an
 * all-stale set, which is empty after the filter) → `healthy`: no non-stale child
 * means nothing on the active ramp is wrong.
 */
export function worstSeverity(severities: Severity[]): Severity {
  let worst: Exclude<Severity, "stale"> = "healthy";
  for (const s of severities) {
    if (s === "stale") continue; // orthogonal — never promotes (D-08)
    if (RAMP_RANK[s] > RAMP_RANK[worst]) worst = s;
  }
  return worst;
}

/**
 * Fee-severity guard (LOCKED backlog #4): a fee alert is NEVER the thing that
 * pages the operator red. Demote `critical` to at most `warning`; every other
 * rung passes through unchanged.
 *
 * `stale` passes through deliberately — a stale fee fact stays honestly stale
 * (orthogonal to the ramp, D-08), never silently rewritten to `warning`. The
 * incident assembler applies this to every grouped fee summary severity so an
 * upstream-critical fee card can never out-shout a real outage.
 */
export function clampBelowCritical(sev: Severity): Severity {
  return sev === "critical" ? "warning" : sev;
}
