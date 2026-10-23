import type { DetectorId } from "@/lib/insight/types";

// =====================================================
// SIGNAL_LABELS — the card-label vocabulary (Phase 4)
// =====================================================
// Pure module: no server runtime imports — test-imported and safe anywhere.
//
// Engine vocabulary, NOT component code: both Wave-5 UI surfaces — 04-10
// (InsightCardRow inbox) and 04-11 (console SignalRows) — import this from
// @/lib/insight/labels, keeping the two plans parallel-safe with zero
// cross-plan component imports.
//
// Labels are UPPERCASE PLAIN TEXT ONLY — never emoji, icons, or dots
// (sketch-findings-nodemonitor binding: status is conveyed by text + color
// tokens, no glyph vocabulary). labels.test.ts enforces /^[A-Z0-9 —-]+$/.

export const SIGNAL_LABELS: Record<DetectorId, string> = {
  ap11_close_storm: "CLOSE STORM",
  ap12a_conn_exhaustion: "CONN EXHAUSTION",
  ap12b_serialization: "SERIALIZATION",
  htlc_timeout_fc: "HTLC-TIMEOUT FC",
  fee_raise: "FEE RAISE",
  fee_lower: "FEE LOWER",
  channel_close_candidate: "CLOSE CANDIDATE",
  rebalance_partner_failure: "REBALANCE PARTNER",
  rebalance_degraded: "REBALANCE DEGRADED",
  fee_stepdown: "FEE STEP-DOWN",
  fleet_close_cluster: "CLOSE CLUSTER",
  stuck_fc_past_maturity: "STUCK FORCE-CLOSE",
  stuck_sweep: "STUCK SWEEP",
  stuck_open: "STUCK OPEN",
};
