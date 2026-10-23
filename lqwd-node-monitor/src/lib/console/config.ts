// =====================================================
// Phase 3 console — the SINGLE tuning surface
// =====================================================
// STARTING VALUES, NOT CONTRACT — the operator retunes here as fleet data
// accumulates; read modules (pending.ts, console/*.ts), pages, and the CSV
// export never embed these values. Same philosophy as
// src/lib/scorecard/config.ts (Phase 2 D-02).
//
// Pure module: no server runtime imports — test-imported and safe anywhere.

/**
 * D-06 window presets: URL key → bound integer days. The key arrives from the
 * URL and selects the integer; ONLY the integer is parameter-bound into SQL.
 * Never bind a user string into a SQL interval — the whitelist key lookup is
 * the validation boundary.
 */
export const WINDOW_PRESETS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;

export type WindowKey = keyof typeof WINDOW_PRESETS;

/** D-05: event-table tabs default to the 7-day window (matches scorecard windows). */
export const DEFAULT_WINDOW: WindowKey = "7d";

/** D-07: each event table renders the newest ROW_CAP rows under a summary strip. */
export const ROW_CAP = 500;

/**
 * Currently-pending recency window (hours). The pending tables retain months
 * of resolved residue (rows stop updating on resolution, never deleted) —
 * "currently pending" = updated_at within this window. At 6h the live data
 * reproduced lnd_node_info.pending_channels and total_limbo_balance EXACTLY
 * (golden cross-check verified on 9 nodes incl. Brazil 87,191,667; encoded in
 * src/lib/read/golden-pending.test.ts). Assumption A3: tunable as the
 * collector cadence evolves — the golden test catches drift.
 */
export const PENDING_RECENCY_HOURS = 6;

/** D-01: the eight console tabs, in locked presentation order. */
export const TAB_KEYS = [
  "scorecard",
  "channels",
  "fees",
  "liquidity",
  "forwards",
  "closes",
  "peers",
  "pending",
] as const;

export type TabKey = (typeof TAB_KEYS)[number];

/** NODE-02 minimum export set — tabs whose tables get an Export CSV button. */
export const EXPORTABLE_TABS: readonly TabKey[] = ["channels", "forwards", "closes", "fees"];
