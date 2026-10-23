// =====================================================
// D-13 — the SINGLE detector tuning surface (Phase 4)
// =====================================================
// STARTING VALUES, NOT CONTRACT — the operator retunes here as fleet data
// accumulates; detector code (detectors/*.ts) never embeds thresholds.
//
// D-13 rule: this file holds detector-ONLY knobs. Where a detector grades a
// metric the scorecard already grades, it READS the scorecard's band at the
// use-site — `SCORECARD_CONFIG[backend].forceClose.tier1.value` (AP-11 close
// storm, ≥50 self-closes/hr) and `SCORECARD_CONFIG[backend].revenue.tier1.value`
// (PPM-LOW, <10 PPM) — and NEVER restates those numbers here. There is no
// close-storm or PPM-low knob in this file by design; do not add one
// (config.test.ts enforces this — T-04-05 threshold-fork drift).
//
// Per-backend (lnd vs ldk) like SCORECARD_CONFIG: ldk is its own object
// literal so the per-backend tuning surface exists from day one, even while
// the starting values are identical.
//
// Pure module: no server runtime imports — test-imported and safe anywhere.
//
// Confidence/justification per knob below. [ASSUMED] marks judgment-only
// values per the RESEARCH Assumptions Log (A1–A7) — operator retunes freely.

export interface InsightKnobs {
  // ── HTLC-timeout force-close signature (detector 4) ──────────────────────
  /** Rolling window (days) for counting HTLC-timeout-signed LOCAL_FCs. MEDIUM — force-close-analysis-methodology.md Query 1 window. */
  htlcWindowDays: number;
  /** Warn at ≥2 signature closes in window — 2× the healthy 0–1 FC/month ceiling (healthy-range-bands.md LND table). MEDIUM. */
  htlcTimeoutMinCount: number;
  /** Critical at ≥10 in 24h — approaching storm territory without tripping AP-11's ≥50/hr (read from SCORECARD_CONFIG). MEDIUM. */
  htlcTimeoutCriticalCount: number;

  // ── Fee signals: raise / lower / close-candidate (detector 5) ────────────
  /** Raise: 90d forwards at/above this = high-volume channel. MEDIUM — France fee-optimization tier table §5. */
  feeHighVolumeForwards: number;
  /** Raise: policy PPM below this floor on a high-volume channel → raise to floor. France Dec-2025 realistic baseline floor; healthy band 30–150 (healthy-range-bands.md France additions). MEDIUM. */
  feeFloorPpm: number;
  /** Lower: policy PPM above this ceiling = top of the low-volume/liquidity-only tier (150–500). [ASSUMED A1] LOW — no incident data validates "lower"; ship conservative. */
  feeCeilingPpm: number;
  /** Lower: 90d forwards below this = low-volume channel. [ASSUMED A1] LOW — tier-table range only. */
  feeLowVolumeForwards: number;
  /** Lower: suggested PPM target = low-volume tier entry. [ASSUMED A1] LOW. */
  feeLowerTargetPpm: number;
  /** Close-candidate: channel age (days) with zero 90d forwards → "dead channel — close instead of tuning" (fee-optimization-and-recommendations.md tier table, verbatim). MEDIUM. */
  closeCandidateAgeDays: number;

  // ── Fee-crash / earnings step-down (detector 7, D-09) ────────────────────
  // Baseline window: trailing 28 days ENDING 7 days ago (now-35d … now-7d),
  // aggregated as ONE window — matches the matrix's `_7d / _4w_prior`
  // formulation and absorbs France's healthy week-to-week PPM variance
  // (14.2–38.8); a 1-week baseline would false-positive on the 38.8→14.2 swing.
  /** PPM-DRIFT fires when ppm7d < ratio × ppmBaseline. France Jan-05 crash week ratio ≈0.13 fires; worst healthy week ≈0.46 sits near the line — golden fixture encodes the boundary (04-05). MEDIUM — cross-node-monitoring-matrix.md Tier-1. */
  ppmDriftRatio: number;
  /** EARNINGS-DROP fires when earnings7dSat < ratio × baselineWeeklyEarningsSat — catches volume-loss collapse at unchanged PPM. France crash ratio ≈0.07. MEDIUM — cross-node-monitoring-matrix.md Tier-1. */
  earningsDropRatio: number;
  /** Noise floor: require this many forwards in the baseline window — a near-idle node has no baseline to step down from. MEDIUM — SCORECARD null-PPM precedent (no flow ≠ 0 PPM). */
  baselineForwardsMin: number;
  /** Noise floor: require baseline PPM at/above this — an already-crashed node cannot step down again. MEDIUM. */
  ppmBaselineMin: number;

  // ── Fleet temporal close-cluster correlation (detector 8, D-10) ──────────
  /** Scan window (hours) for hour-bucketed self-initiated close clusters. [ASSUMED A7] derived from incident evidence, not operator-validated. */
  clusterScanWindowHours: number;
  /** Per-node self-closes inside one hour bucket to count the node — ~5× the 0–1 FC/month healthy budget compressed into an hour; deliberately far below AP-11's 50/hr (read from SCORECARD_CONFIG) to catch the cascade EARLIER and wider. [ASSUMED A7]. */
  clusterPerNodeMinCloses: number;
  /** Warn at ≥2 nodes in one bucket — the post-migration reciprocation signature (2025-07-16, 2025-09-02). [ASSUMED A7]. */
  clusterMinNodesWarn: number;
  /** Critical at ≥3 nodes — reproduces the 2024-09-09 fleet-wide cascade signature (France 213 + India 175 + Sweden 106). [ASSUMED A7]. */
  clusterMinNodesCritical: number;

  // ── Rebalance-success signals (detector 6) ───────────────────────────────
  /** Partner-binary failure: flag a partner at 0% success with at least this many 7d attempts (France: 6 partners at 0% in May 2026). MEDIUM — cross-node-monitoring-matrix.md Tier-2. */
  rebalanceBinaryMinAttempts: number;
  /** Per-(node,partner) HAVING COUNT(*) floor so single-attempt partners never enter the binary scan. MEDIUM — matrix rule "HAVING COUNT(*) >= 5". */
  rebalancePartnerMinAttempts: number;
  /** Node-level degradation: 7d success rate below this fires (target band >90%; Canada 18%/26% and France 23% are the degraded references — healthy-range-bands.md). MEDIUM. */
  rebalanceSuccessWarnRate: number;
  /** Node-level degradation: minimum 7d attempts before the rate is meaningful. MEDIUM. */
  rebalanceMinAttempts: number;
  /** Cap on suggested rebalance amountSat (sizing rule: half the imbalance, capped here). [ASSUMED A5] — bounded further by Phase 6 node-side bound re-enforcement. */
  rebalanceMaxAmountSat: number;

  // ── Stuck-pending (detectors 9–11, PENDING-02) ───────────────────────────
  /** FC past maturity: blocks past maturity before firing (~1h of blocks) — absorbs snapshot lag at the 6h collector cadence. [ASSUMED A3] — case definition is PENDING-02 AC; only the grace number is judgment. */
  fcMaturityGraceBlocks: number;
  /** FC past maturity: critical when blocks-past-maturity exceeds this (~1 day stuck). [ASSUMED A3]. */
  fcPastMaturityCriticalBlocks: number;
  /** Stuck sweep: warn at broadcast_attempts above this — verbatim from the matrix "Pending sweep stagnation" Tier-2 rule. MEDIUM — cross-node-monitoring-matrix.md. */
  sweepStuckAttempts: number;
  /** Stuck sweep: warn at sweep age (days) above this — verbatim matrix Tier-2 line. MEDIUM. */
  sweepStuckAgeDays: number;
  /** Stuck sweep: critical attempts — approaching France's worst case of 17 attempts (93–190 stuck outpoints reference). MEDIUM — healthy-range-bands.md. */
  sweepCriticalAttempts: number;
  /** Stuck open: warn at PENDING_OPEN age (hours) — ≈144 confs of headroom is generous for any sane funding fee. [ASSUMED A2] — no library threshold for aged funding. */
  openStuckWarnHours: number;
  /** Stuck open: critical age (hours) — indicates an abandoned/under-fee'd funding tx. [ASSUMED A2]. */
  openStuckCriticalHours: number;

  // ── Hysteresis + write guardrails (D-15 / D-16, INSIGHT-06) ──────────────
  /** Fee hysteresis min-delta: fire update_fee only when |suggested − current| is at least this — below it the write isn't worth the AP-12b UpdateEdgePolicy churn it generates (operational-anti-patterns.md AP-12b fix: "stabilize fees"). [ASSUMED A6] — direction is library-cited, the number is judgment. */
  feeMinDeltaPpm: number;
  /** Fee hysteresis min-interval (hours) since the last observed policy change — snapshot cadence of ~6.5h resolves 24h reliably; sub-12h knobs would alias against the collector cadence. [ASSUMED A6]. */
  feeMinIntervalHours: number;
  /** D-16 rate-limit GUIDANCE (text only, no enforcement): suggested max write recommendations per node per day — keeps a node under ~1 edge-update per 6h, consistent with AP-12b fee stabilization. [ASSUMED A4]. */
  maxWritesPerDay: number;
}

export const INSIGHT_CONFIG: Record<"lnd" | "ldk", InsightKnobs> = {
  lnd: {
    htlcWindowDays: 30,
    htlcTimeoutMinCount: 2,
    htlcTimeoutCriticalCount: 10,

    feeHighVolumeForwards: 100,
    feeFloorPpm: 30,
    feeCeilingPpm: 500,
    feeLowVolumeForwards: 10,
    feeLowerTargetPpm: 150,
    closeCandidateAgeDays: 90,

    ppmDriftRatio: 0.5,
    earningsDropRatio: 0.3,
    baselineForwardsMin: 200,
    ppmBaselineMin: 5,

    clusterScanWindowHours: 24,
    clusterPerNodeMinCloses: 5,
    clusterMinNodesWarn: 2,
    clusterMinNodesCritical: 3,

    rebalanceBinaryMinAttempts: 20,
    rebalancePartnerMinAttempts: 5,
    rebalanceSuccessWarnRate: 0.5,
    rebalanceMinAttempts: 20,
    rebalanceMaxAmountSat: 5_000_000,

    fcMaturityGraceBlocks: 6,
    fcPastMaturityCriticalBlocks: 144,
    sweepStuckAttempts: 5,
    sweepStuckAgeDays: 14,
    sweepCriticalAttempts: 12,
    openStuckWarnHours: 24,
    openStuckCriticalHours: 72,

    feeMinDeltaPpm: 10,
    feeMinIntervalHours: 24,
    maxWritesPerDay: 4,
  },
  // LDK starts IDENTICAL to LND pending LDK-specific incident data — but it is
  // its own object literal so the per-backend tuning surface exists from day
  // one (same posture as SCORECARD_CONFIG): retune ldk values here without
  // touching lnd or any detector code. Caveat (RESEARCH open question 3): LDK
  // fee-policy snapshot cadence is unverified — if sparse, hysteresis
  // min-interval degrades to "no observed change → pass" for LDK nodes.
  ldk: {
    htlcWindowDays: 30,
    htlcTimeoutMinCount: 2,
    htlcTimeoutCriticalCount: 10,

    feeHighVolumeForwards: 100,
    feeFloorPpm: 30,
    feeCeilingPpm: 500,
    feeLowVolumeForwards: 10,
    feeLowerTargetPpm: 150,
    closeCandidateAgeDays: 90,

    ppmDriftRatio: 0.5,
    earningsDropRatio: 0.3,
    baselineForwardsMin: 200,
    ppmBaselineMin: 5,

    clusterScanWindowHours: 24,
    clusterPerNodeMinCloses: 5,
    clusterMinNodesWarn: 2,
    clusterMinNodesCritical: 3,

    rebalanceBinaryMinAttempts: 20,
    rebalancePartnerMinAttempts: 5,
    rebalanceSuccessWarnRate: 0.5,
    rebalanceMinAttempts: 20,
    rebalanceMaxAmountSat: 5_000_000,

    fcMaturityGraceBlocks: 6,
    fcPastMaturityCriticalBlocks: 144,
    sweepStuckAttempts: 5,
    sweepStuckAgeDays: 14,
    sweepCriticalAttempts: 12,
    openStuckWarnHours: 24,
    openStuckCriticalHours: 72,

    feeMinDeltaPpm: 10,
    feeMinIntervalHours: 24,
    maxWritesPerDay: 4,
  },
};
