import "server-only";

import { buildDeepLink } from "@/lib/insight/deeplink";
import type { InsightCard } from "@/lib/insight/types";
import { CARD_SCHEMA_VERSION } from "@/lib/insight/types";
import { getFleetPgHealth, type PgHealthVerdict } from "@/lib/read/pg-health";
import { TELEMETRY_BANDS, type BandSeverity } from "@/lib/read/telemetry-bands";

// =====================================================
// AP-12a/b — DETERMINISTIC detector (COL-02; LLM stopgap RETIRED)
// =====================================================
// This module used to be the bounded D-11/D-12 LLM fallback: AP-12's
// signatures (PG-log `FATAL: too many clients`, SQLSTATE 40001 storms,
// pg_stat_* counters) had no warehouse source, so an LLM narrated
// circumstantial evidence. Phase 15 closed that gap — `pg_health` now carries
// the RAW counters and the read layer (src/lib/read/pg-health.ts) derives the
// AP-12a-vs-b discriminator + bands at read time (D-14). The LLM text-
// generation path is REMOVED: no AI SDK import exists here anymore; log text is
// never narrated here (so no untrusted-data delimiters are needed — the
// detector consumes numeric counters only and emits no runnable command,
// T-15-07).
//
// FROZEN retirement contract (RESEARCH §COL-02 / 15-PATTERNS):
//   - AP12_NO_DATA_PLACEHOLDER exported verbatim — still the honest UI copy
//     whenever NO pg_health data exists yet (collector not landed / migration
//     not applied on a host).
//   - Signal ids stay EXACTLY "ap12a_conn_exhaustion" / "ap12b_serialization".
//   - Id dedupe rule (D-08) unchanged: `${signal}:${pubkey}:node`.
//   - InsightCard output shape unchanged.
// What changed: provenance is now "deterministic" (never "llm-inference"),
// severity derives from the read-time band (not hardcoded "info"), and
// evidence carries the ACTUAL counter (too_many_clients / conn saturation /
// 40001 rate-multiple) with the band cutoff as threshold.

/**
 * No-data UI copy (D-11 honesty pattern): a static section string, NOT a
 * card — rendered whenever pg_health has no rows yet for any host.
 */
export const AP12_NO_DATA_PLACEHOLDER =
  "AP-12a/b — no data, needs log ingestion (PG log / pg_stat_* capture is an open Tier-2 gap)";

/** The node identity the detector stamps onto cards (CardNode-compatible). */
export interface Ap12NodeRef {
  pubkey: string;
  alias: string | null;
  backend: "lnd" | "ldk";
}

/** Detector output: cards + whether ANY pg_health data existed (placeholder gate). */
export interface Ap12DetectorResult {
  cards: InsightCard[];
  hasData: boolean;
}

/**
 * Runbook-confirmed AP-12a threshold: >100 `FATAL: too many clients` lines in
 * a sample confirms active exhaustion (AP-12 runbook; grep -c threshold).
 */
const TOO_MANY_CLIENTS_CONFIRM = 100;

/** Band severity → card severity (scorecard taxonomy, D-01 — no new values). */
function bandToSeverity(band: BandSeverity): "critical" | "warn" | "info" {
  if (band === "critical") return "critical";
  if (band === "warn") return "warn";
  return "info";
}

/** Worse-of two band severities (critical > warn > healthy). */
function worseBand(a: BandSeverity, b: BandSeverity): BandSeverity {
  const rank = { healthy: 0, warn: 1, critical: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Build the deterministic AP-12 card for one node from a read-time verdict.
 * Pure — exported for unit tests. Returns null when no variant fired.
 *
 * Severity comes from the DERIVED band, never hardcoded:
 *  - ap12a: worse of the conn-saturation band and the too-many-clients grade
 *    (>100 lines = critical per the runbook confirm threshold; >0 = warn).
 *  - ap12b: the pg_40001_rate_multiple band (≥10× baseline ⇒ critical).
 */
export function buildAp12Card(
  node: Ap12NodeRef,
  verdict: PgHealthVerdict,
  asOf: string,
  hostId: string,
  /** Badge a stale/undated sample honestly in evidence detail (I-pg/HARDEN-03). */
  stale: boolean = false,
): InsightCard | null {
  if (verdict.ap12Variant == null) return null;

  const signal =
    verdict.ap12Variant === "ap12a" ? "ap12a_conn_exhaustion" : "ap12b_serialization";

  let band: BandSeverity;
  let metric: string;
  let observed: number;
  let threshold: number;
  let unit: string;
  let window: string;

  if (verdict.ap12Variant === "ap12a") {
    const tooManyClients = verdict.tooManyClients ?? 0;
    const tmcBand: BandSeverity =
      tooManyClients > TOO_MANY_CLIENTS_CONFIRM
        ? "critical"
        : tooManyClients > 0
          ? "warn"
          : "healthy";
    band = worseBand(verdict.connSaturation?.band ?? "healthy", tmcBand);
    window = "latest sample";
    if (tooManyClients > 0) {
      // The exhaustion signature itself: FATAL too-many-clients log lines.
      metric = "pg_too_many_clients";
      observed = tooManyClients;
      threshold = TOO_MANY_CLIENTS_CONFIRM;
      unit = "log lines";
    } else {
      // Saturation-driven: exhaustion imminent (active/max ≥ 0.8).
      metric = "pg_conn_saturation";
      observed = verdict.connSaturation?.value ?? 0;
      threshold = TELEMETRY_BANDS.pg_conn_saturation.healthy;
      unit = "ratio";
    }
  } else {
    band = verdict.rateMultiple?.band ?? "critical";
    metric = "pg_40001_rate_multiple";
    observed = verdict.rateMultiple?.value ?? 0;
    threshold = TELEMETRY_BANDS.pg_40001_rate_multiple.healthy;
    unit = "x baseline";
    window = "latest 2 samples, per-day scaled";
  }

  return {
    schemaVersion: CARD_SCHEMA_VERSION,
    // Dedupe rule (D-08): `${signal}:${pubkey}:node` — stable across recomputes.
    id: `${signal}:${node.pubkey}:node`,
    severity: bandToSeverity(band),
    node: { pubkey: node.pubkey, alias: node.alias, backend: node.backend },
    target: { kind: "node" },
    signal,
    evidence: {
      metric,
      observed,
      threshold,
      unit,
      window,
      asOf,
      deepLink: buildDeepLink(node.pubkey, "scorecard"),
      // A stale sample is BADGED, never presented as fresh (detail values are
      // string|number by schema, so the badge is the string "true").
      detail: stale
        ? { source: "pg_health", hostId, stale: "true" }
        : { source: "pg_health", hostId },
    },
    // Advisory posture retained: AP-12 remediation is a runbook, not a
    // signable queue intent — never reaches the Phase 5/6 signing surface.
    suggestedAction: null,
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  };
}

/**
 * Deterministic AP-12a/b cards from pg_health counters: fan over the fleet
 * pg_health views (latest + previous sample per host, verdict derived at
 * read time), map each flagged host's declared node pubkeys onto the
 * requested nodes, and emit one card per (node, fired variant). hasData=false
 * (no pg_health rows anywhere) is the caller's AP12_NO_DATA_PLACEHOLDER case.
 */
export async function ap12AdvisoryCards(nodes: Ap12NodeRef[]): Promise<Ap12DetectorResult> {
  if (nodes.length === 0) return { cards: [], hasData: false };

  const views = await getFleetPgHealth();
  const hasData = views.some((v) => v.hasData);
  const nodeByPubkey = new Map(nodes.map((n) => [n.pubkey, n]));

  const cards: InsightCard[] = [];
  for (const view of views) {
    if (view.verdict == null || view.verdict.ap12Variant == null) continue;
    // I-pg (HARDEN-03): asOf comes from the sample's OWN collectedAt — never a
    // fabricated now(). A null collectedAt stamps the epoch sentinel (visibly
    // ancient), and any stale/undated view is badged stale on the card.
    const asOf = (view.collectedAt ?? new Date(0)).toISOString();
    const staleView = view.stale || view.collectedAt == null;
    for (const pubkey of view.nodePubkeys) {
      const node = nodeByPubkey.get(pubkey);
      if (node === undefined) continue;
      const card = buildAp12Card(node, view.verdict, asOf, view.hostId, staleView);
      if (card != null) cards.push(card);
    }
  }

  return { cards, hasData };
}
