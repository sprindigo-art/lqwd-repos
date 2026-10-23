// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// host-rollup.ts — VIEW-SIDE worst-of host severity + D-05 driver line (HOST-01)
// =====================================================
// The hosts screens need ONE severity per host card (chrome + chip) plus one
// plain-language driver line naming WHY. This is a NEW view-side pure module — it
// is DELIBERATELY separate from `incidents.ts`'s `gradeHost` (Phase-12-LOCKED,
// stale-or-healthy only) and is NEVER wired into the incident tree.
//
// Four contributor classes fold into the worst-of rung, each graded ONLY through
// the sanctioned mappers (a raw inline severity-string compare is forbidden — Pitfall):
//   • infra     — the host-level service trio (severityFromService) PLUS bitcoind's
//                 chain bands (a gradeChain mirror; incidents.ts stays untouched).
//   • nodes     — pre-reduced on-host node severities (callers map ScorecardView →
//                 Severity via the nodes-page switch; this module never reads scorecards).
//   • resources — cpu / mem / per-mount disk-FREE %, via evaluateBand → severityFromBand.
//   • storage   — per-mount projected days-to-full, via evaluateDaysToFull (D-13).
//
// rollup.sev = worstSeverity(all contributor sevs). `stale` is orthogonal (D-08):
// worstSeverity filters it, so a no-data child NEVER promotes a host to critical.
// A no-telemetry host (hasData=false) is the CALLER's branch — it never reaches here.
//
// driver = the phrase of the FIRST contributor whose sev === rollup.sev in the fixed
// precedence infra → nodes → resources → storage; null when the host is healthy.

import type { Severity } from "@/components/df/Severity";
import type { HostMetricsView } from "@/lib/read/host-metrics";
import type { ServiceHealthState } from "@/lib/read/service-health";
import type { ChainTelemetryView } from "@/lib/read/chain-telemetry";
import type { StorageGrowth } from "@/lib/read/storage-growth";
import {
  severityFromBand,
  severityFromService,
  worstSeverity,
} from "@/lib/overview/severity-map";
import {
  TELEMETRY_BANDS,
  evaluateBand,
  evaluateDaysToFull,
} from "@/lib/read/telemetry-bands";
import { humanizeDaysToFull } from "@/lib/read/storage-projection";

/** The already-loaded per-host evidence the rollup folds (no DB, no render). */
export interface HostRollupInput {
  /** Latest vitals + per-mount storage (resources are read from here). */
  host: HostMetricsView;
  /** Host-level service trio (bitcoind · esplora · postgres). */
  services: ServiceHealthState[];
  /** Optional bitcoind chain evidence — graded via the gradeChain mirror. */
  chain?: ChainTelemetryView | null;
  /** Pre-reduced on-host node severities (caller maps scorecards → Severity). */
  nodeSeverities: Severity[];
  /** Per-mount storage growth projections (days-to-full drives storage severity). */
  storage: StorageGrowth[];
}

/** Worst-of host severity plus the one-line D-05 driver (null when healthy). */
export interface HostRollup {
  sev: Severity;
  /** `driven by: <contributor phrase>` — omitted (null) when the host is healthy. */
  driver: string | null;
}

/** One contributor's reduced severity + the phrase naming its worst element. */
interface Contributor {
  sev: Severity;
  phrase: string | null;
}

/** Coerce a raw bigint|number|string|null column to a finite number, else null. */
function num(v: bigint | number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── infra ────────────────────────────────────────────────────────────────────

/** Concise driver phrase for a non-green service, mirroring severityFromService. */
function servicePhrase(s: ServiceHealthState): string {
  if (s.noData) return `${s.serviceName} no data`;
  if (!s.running) return `${s.serviceName} down`;
  return `${s.serviceName} not functioning`; // running but dead
}

/**
 * gradeChain MIRROR (incidents.ts is LOCKED — do not import it): stale/no-data
 * dominates, else the worst of the present chain bands via the sanctioned mapper.
 */
function gradeChain(c: ChainTelemetryView): Severity {
  if (c.stale || !c.hasData) return "stale";
  const bands = [c.bands.blocksBehind, c.bands.verificationProgress, c.bands.peers]
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .map((b) => severityFromBand(b.band));
  return worstSeverity(bands);
}

/** Plain-language phrase naming bitcoind's worst present chain band. */
function chainPhrase(c: ChainTelemetryView): string {
  const candidates: Array<{ sev: Severity; phrase: string }> = [];
  if (c.bands.blocksBehind !== null) {
    candidates.push({
      sev: severityFromBand(c.bands.blocksBehind.band),
      phrase: `bitcoind ${c.bands.blocksBehind.value} blocks behind`,
    });
  }
  if (c.bands.verificationProgress !== null) {
    candidates.push({
      sev: severityFromBand(c.bands.verificationProgress.band),
      phrase: "bitcoind still syncing",
    });
  }
  if (c.bands.peers !== null) {
    candidates.push({
      sev: severityFromBand(c.bands.peers.band),
      phrase: "bitcoind low peer count",
    });
  }
  const worst = worstSeverity(candidates.map((x) => x.sev));
  return candidates.find((x) => x.sev === worst)?.phrase ?? "bitcoind unhealthy";
}

function gradeInfra(services: ServiceHealthState[], chain: ChainTelemetryView | null): Contributor {
  const entries: Array<{ sev: Severity; phrase: string }> = services.map((s) => ({
    sev: severityFromService(s),
    phrase: servicePhrase(s),
  }));
  if (chain != null) {
    entries.push({ sev: gradeChain(chain), phrase: chainPhrase(chain) });
  }
  const sev = worstSeverity(entries.map((e) => e.sev));
  const phrase = sev === "healthy" ? null : (entries.find((e) => e.sev === sev)?.phrase ?? null);
  return { sev, phrase };
}

// ── nodes ────────────────────────────────────────────────────────────────────

function gradeNodes(nodeSeverities: Severity[]): Contributor {
  const sev = worstSeverity(nodeSeverities);
  if (sev === "healthy") return { sev, phrase: null };
  const count = nodeSeverities.filter((s) => s === sev).length;
  return { sev, phrase: `${count} node${count === 1 ? "" : "s"} ${sev}` };
}

// ── resources (cpu / mem / per-mount disk-FREE %) ─────────────────────────────

function gradeResources(host: HostMetricsView): Contributor {
  const entries: Array<{ sev: Severity; phrase: string }> = [];
  const m = host.metrics;

  const cpu = num(m?.cpu_pct);
  if (cpu !== null) {
    entries.push({
      sev: severityFromBand(evaluateBand(cpu, TELEMETRY_BANDS.cpuPctBusy)),
      phrase: "CPU saturated",
    });
  }

  const memTotal = num(m?.mem_total_kb);
  const memAvail = num(m?.mem_available_kb);
  if (memTotal !== null && memTotal > 0 && memAvail !== null) {
    const memAvailPct = (memAvail / memTotal) * 100;
    entries.push({
      sev: severityFromBand(evaluateBand(memAvailPct, TELEMETRY_BANDS.memAvailablePct)),
      phrase: "memory low",
    });
  }

  // Per-mount disk. The band is %-FREE, so it receives 100 − usedPct — feeding raw
  // used% here would invert the grade (a near-full disk reading as healthy).
  let diskWorst: Severity = "healthy";
  for (const row of host.storage) {
    const total = num(row.total_bytes);
    const used = num(row.used_bytes);
    if (total === null || total <= 0 || used === null) continue;
    const pctFree = 100 - (used / total) * 100;
    const sev = severityFromBand(evaluateBand(pctFree, TELEMETRY_BANDS.diskPctFree));
    diskWorst = worstSeverity([diskWorst, sev]);
  }
  if (diskWorst !== "healthy") {
    entries.push({ sev: diskWorst, phrase: "disk space low" });
  }

  const sev = worstSeverity(entries.map((e) => e.sev));
  const phrase = sev === "healthy" ? null : (entries.find((e) => e.sev === sev)?.phrase ?? null);
  return { sev, phrase };
}

// ── storage (projected days-to-full, D-13) ────────────────────────────────────

function gradeStorage(storage: StorageGrowth[]): Contributor {
  // Only an `ok` projection with a real days-to-full carries a severity (HOST-02
  // honesty gate) — a gathering / stale / not-growing mount contributes nothing here.
  const projected = storage.filter(
    (g): g is StorageGrowth & { daysToFull: number } =>
      g.status === "ok" && g.daysToFull !== null,
  );
  let sev: Severity = "healthy";
  let worstDays: number | null = null;
  for (const g of projected) {
    const s = evaluateDaysToFull(g.daysToFull); // already a df Severity literal (D-13)
    sev = worstSeverity([sev, s]);
    if (worstDays === null || g.daysToFull < worstDays) worstDays = g.daysToFull;
  }
  if (sev === "healthy" || worstDays === null) return { sev: "healthy", phrase: null };
  return { sev, phrase: `disk filling — ${humanizeDaysToFull(worstDays)}` };
}

// ── rollup ─────────────────────────────────────────────────────────────────

/**
 * Fold a host's cross-layer evidence into ONE worst-of severity + a D-05 driver
 * line. Contributors are graded via the sanctioned mappers only and reduced with
 * `worstSeverity` (stale filtered — D-08). The driver names the FIRST contributor
 * matching the rollup severity in the fixed precedence infra → nodes → resources →
 * storage; it is null (omitted) when the host is healthy.
 */
export function buildHostRollup(input: HostRollupInput): HostRollup {
  // Fixed precedence order (D-05): infra → nodes → resources → storage.
  const contributors: Contributor[] = [
    gradeInfra(input.services, input.chain ?? null),
    gradeNodes(input.nodeSeverities),
    gradeResources(input.host),
    gradeStorage(input.storage),
  ];

  const sev = worstSeverity(contributors.map((c) => c.sev));
  if (sev === "healthy") return { sev, driver: null };

  const hit = contributors.find((c) => c.sev === sev);
  const phrase = hit?.phrase ?? null;
  return { sev, driver: phrase === null ? null : `driven by: ${phrase}` };
}
