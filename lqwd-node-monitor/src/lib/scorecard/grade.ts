import type {
  DimensionKey,
  DimensionResult,
  GradedDimension,
  Letter,
  Tier1Breach,
} from "@/lib/scorecard/types";
import type { Band, BackendConfig, DimConfig, Tier1Line } from "@/lib/scorecard/config";

// =====================================================
// D-05/D-06/D-07/D-08 grading engine (pure — no server-only, no DB)
// =====================================================
// D-07 HARD RULE: color comes ONLY from tier1 breaches. Warn-level NEVER
// escalates to red. Composite is a separate, un-averaged-with-critical number —
// a Tier-1 breach surfaces as a distinct critical chip, never diluted by nine
// healthy dimensions, and a minor issue never fakes a critical.
//
// All thresholds come from DimConfig parameters (D-02 single tuning surface).
// The ONLY numeric literals here are the letter anchors (A=90 B=80 C=70 D=60,
// 100 cap / 0 floor) and a degenerate-band epsilon.

// Letter anchors — the fixed grade scale, not tunable thresholds.
const ANCHOR_A = 90;
const ANCHOR_B = 80;
const ANCHOR_C = 70;
const ANCHOR_D = 60;
const PCT_MAX = 100;
const PCT_MIN = 0;
const ANCHOR_STEP = ANCHOR_A - ANCHOR_B; // 10 — spacing between adjacent anchors
const EPS = 1e-9; // guards degenerate (equal-cutoff) bands, e.g. forceClose a:0 vs b:1

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Linear interpolation of v from [lo, hi] onto [pLo, pHi] (degenerate-span guarded). */
const lerp = (v: number, lo: number, hi: number, pLo: number, pHi: number): number =>
  pLo + (pHi - pLo) * ((v - lo) / Math.max(hi - lo, EPS));

/** Letter from percentage: A ≥90, B ≥80, C ≥70, D ≥60, else F. */
export function letterFor(pct: number): Letter {
  if (pct >= ANCHOR_A) return "A";
  if (pct >= ANCHOR_B) return "B";
  if (pct >= ANCHOR_C) return "C";
  if (pct >= ANCHOR_D) return "D";
  return "F";
}

/**
 * Raw value → 0..100 percentage against a tunable Band (D-02).
 * Direction normalization: everything is folded into a single "goodness" axis —
 *  - higher-better: raw as-is (cutoffs a ≥ b ≥ c ≥ d).
 *  - lower-better:  graded on badness (cutoffs a ≤ b ≤ c ≤ d), negated into goodness.
 *  - mid-better:    raw → |raw − (center ?? 0.5)| deviation, then lower-better.
 * Anchors: value at cutoff a → 90, b → 80, c → 70, d → 60; linear between.
 * Beyond a: 90 + step × min(1, |raw−a| / |a−b|), capped 100.
 * Worse than d: linear extension of the c→d slope from 60 down, floored at 0.
 */
export function pctFor(raw: number, band: Band): number {
  // Fold onto a single higher-better "goodness" axis.
  let v: number;
  let a: number;
  let b: number;
  let c: number;
  let d: number;
  if (band.direction === "higher-better") {
    v = raw;
    ({ a, b, c, d } = band);
  } else {
    // lower-better (and mid-better deviation) → negate badness into goodness.
    const badness =
      band.direction === "mid-better" ? Math.abs(raw - (band.center ?? 0.5)) : raw;
    v = -badness;
    a = -band.a;
    b = -band.b;
    c = -band.c;
    d = -band.d;
  }

  let pct: number;
  if (v >= a) {
    // Better than the A cutoff: scale toward 100 over one a→b span.
    pct = ANCHOR_A + ANCHOR_STEP * Math.min(1, Math.abs(v - a) / Math.max(Math.abs(a - b), EPS));
  } else if (v >= b) {
    pct = lerp(v, b, a, ANCHOR_B, ANCHOR_A);
  } else if (v >= c) {
    pct = lerp(v, c, b, ANCHOR_C, ANCHOR_B);
  } else if (v >= d) {
    pct = lerp(v, d, c, ANCHOR_D, ANCHOR_C);
  } else {
    // Worse than the D cutoff: continue the c→d slope down, floored at 0.
    pct = ANCHOR_D - ANCHOR_STEP * (Math.abs(d - v) / Math.max(Math.abs(c - d), EPS));
  }
  return clamp(pct, PCT_MIN, PCT_MAX);
}

/** Evaluate a dimension's SINGLE Tier-1 line (D-08) against raw or an extras metric. */
function evaluateTier1(result: DimensionResult, tier1: Tier1Line | undefined): Tier1Breach | null {
  if (!tier1) return null;
  const metricValue = tier1.metric === "raw" ? result.raw : result.extras?.[tier1.metric];
  if (typeof metricValue !== "number" || Number.isNaN(metricValue)) return null;
  const breached =
    (tier1.op === ">" && metricValue > tier1.value) ||
    (tier1.op === "<" && metricValue < tier1.value) ||
    (tier1.op === ">=" && metricValue >= tier1.value) ||
    (tier1.op === "<=" && metricValue <= tier1.value);
  return breached ? { label: tier1.label } : null;
}

/** D-01 no-data dimension: greyed, excluded from the rollup (pct/letter null). */
export function gradeNoData(key: DimensionKey): GradedDimension {
  return {
    key,
    raw: null,
    pct: null,
    letter: null,
    color: "nodata",
    tier1Breach: null,
    asOf: null,
  };
}

/**
 * Grade one dimension against its tunable DimConfig (D-05).
 * Color rule (D-07): "critical" ONLY on a Tier-1 breach; C/D/F letters are
 * "warn" at most; A/B are "ok". Null raw → no-data (note/asOf preserved).
 */
export function gradeDimension(
  key: DimensionKey,
  result: DimensionResult,
  cfg: DimConfig,
): GradedDimension {
  if (result.raw === null) {
    return { ...gradeNoData(key), note: result.note, asOf: result.asOf };
  }
  const pct = pctFor(result.raw, cfg.band);
  const letter = letterFor(pct);
  const tier1Breach = evaluateTier1(result, cfg.tier1);
  const color = tier1Breach ? "critical" : letter === "A" || letter === "B" ? "ok" : "warn";
  return {
    key,
    raw: result.raw,
    pct,
    letter,
    color,
    tier1Breach,
    note: result.note,
    asOf: result.asOf,
    extras: result.extras, // RAW passthrough for render-layer detail (AFM-002 formats at render)
  };
}

/**
 * Composite = UNWEIGHTED mean of pct over gradable dims (D-06): no-data dims
 * excluded, NO weighting shipped. Breached dims stay IN the mean — the chip is
 * the separate critical signal (D-07). Null when nothing is gradable.
 */
export function compositeOf(dims: GradedDimension[]): { pct: number; letter: Letter } | null {
  const pcts = dims.map((d) => d.pct).filter((p): p is number => p !== null);
  if (pcts.length === 0) return null;
  const pct = Math.round(pcts.reduce((sum, p) => sum + p, 0) / pcts.length);
  return { pct, letter: letterFor(pct) };
}

/**
 * D-07 node dot: "critical" iff ≥1 Tier-1 breach (never diluted); else "warn"
 * iff any computable dim graded C/D/F (warns NEVER escalate to red); else "ok".
 */
export function nodeDot(dims: GradedDimension[]): "ok" | "warn" | "critical" {
  if (dims.some((d) => d.tier1Breach !== null)) return "critical";
  if (dims.some((d) => d.letter === "C" || d.letter === "D" || d.letter === "F")) return "warn";
  return "ok";
}

/** All Tier-1 breach labels in dimension order — rendered as "critical: {label}" chips. */
export function criticalChips(dims: GradedDimension[]): string[] {
  return dims
    .filter((d): d is GradedDimension & { tier1Breach: Tier1Breach } => d.tier1Breach !== null)
    .map((d) => d.tier1Breach.label);
}

/**
 * D-06 reason subtext: the critical breach if one exists, otherwise the
 * lowest-pct non-healthy (C/D/F) dimension's configured reasonLabel; else null.
 */
export function reasonFor(dims: GradedDimension[], cfg: BackendConfig): string | null {
  const breached = dims.find((d) => d.tier1Breach !== null);
  if (breached?.tier1Breach) return `critical: ${breached.tier1Breach.label}`;
  const unhealthy = dims
    .filter(
      (d): d is GradedDimension & { pct: number } =>
        d.pct !== null && (d.letter === "C" || d.letter === "D" || d.letter === "F"),
    )
    .sort((x, y) => x.pct - y.pct);
  const worst = unhealthy[0];
  if (!worst) return null;
  const dimCfg = (cfg as Partial<Record<DimensionKey, DimConfig>>)[worst.key];
  return dimCfg?.reasonLabel ?? null;
}
