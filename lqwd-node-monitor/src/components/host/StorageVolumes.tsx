import { ThresholdMeter } from "@/components/df/ThresholdMeter";
import type { Severity } from "@/components/df/Severity";
import type { StorageGrowth } from "@/lib/read/storage-growth";
import {
  formatPctPerDay,
  humanizeDaysToFull,
  projectionStatusCopy,
} from "@/lib/read/storage-projection";
import { cn } from "@/lib/utils";

// =====================================================
// StorageVolumes (HOST-02 · B5 / D-13…D-16) — dense volume rows (Server)
// =====================================================
// One dense glanceable row per volume: mono mount name + `ThresholdMeter` (used-%
// fill) + mono current % + mono %/day rate + the projection slot. The projection
// slot ALWAYS renders — the row is NEVER silently hidden (D-14).
//
// PRESENTATION-PURE: this component computes NO health. The row severity (`sev`)
// is computed BY THE PAGE at read time (worst of used-% band and days-to-full
// band, per UI-SPEC assumption 6) and passed in; the meter only paints it.
//
// LEGIBLE STATUS BRANCH (Pitfall 4 — mirrors VmVitals' `stale ? StaleChart : chart`):
// the projection branches on `growth.status`, never on `daysToFull` presence alone.
//   • status "ok"        → `humanizeDaysToFull(daysToFull)` (the D-15 humanizer)
//   • every other status → `projectionStatusCopy(status, …)` (verbatim D-14 copy)
// `status === "stale"` ALSO flips the whole row to the gold stale treatment
// (`ThresholdMeter stale` + df-stale row tint). `flat-or-negative` still shows the
// signed rate PLUS "not growing" (the rate stays non-null through that gate).

/** One storage volume row — the page pre-computes `sev` from the read-time bands. */
export interface StorageVolumeRow {
  /** Mount/volume name, e.g. "/" or "/mnt/data". */
  mount: string;
  /** Current used percentage (0–100). */
  usedPct: number;
  /** Row severity — the CALLER's worst-of(used-% band, days-to-full band). */
  sev: Severity;
  /** The full growth result (status drives the projection branch + rate). */
  growth: StorageGrowth;
  /** Age of the latest sample (ms) — feeds the stale projection copy. */
  ageMs?: number;
  /** First→last span of the gathered series (ms) — feeds the gathering ETA. */
  currentSpanMs?: number;
  /** Minimum trusted window (ms) — defaults to the storage-growth 1h gate. */
  minWindowMs?: number;
}

export interface StorageVolumesProps {
  /** The per-mount volume rows for this host (empty → honest empty state). */
  volumes: StorageVolumeRow[];
}

/**
 * The storage-volumes section. Each row always shows either a humanized projection
 * or its honest D-14 status copy — never a silently-hidden row. A stale row flips
 * to the gold treatment. Empty state renders the honest no-volumes copy.
 */
export function StorageVolumes({ volumes }: StorageVolumesProps) {
  if (volumes.length === 0) {
    return (
      <div className="rounded-df-card border border-df-border bg-df-surface px-4 py-6 text-center text-[13px] text-df-muted">
        No storage volumes reported for this host.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {volumes.map((v) => {
        const isStale = v.growth.status === "stale";

        // Legible status branch (Pitfall 4): branch on the STATUS, not on whether a
        // days-to-full number happens to exist.
        let projectionText: string;
        if (v.growth.status === "ok") {
          projectionText = humanizeDaysToFull(v.growth.daysToFull ?? 0);
        } else {
          projectionText = projectionStatusCopy(v.growth.status, {
            ageMs: v.ageMs,
            currentSpanMs: v.currentSpanMs,
            minWindowMs: v.minWindowMs,
          });
        }

        return (
          <div
            key={v.mount}
            className={cn(
              "flex flex-col gap-2 rounded-[10px] border px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
              isStale
                ? "border-dashed border-df-stale-border bg-df-stale-tint"
                : "border-df-border-soft bg-df-surface",
            )}
          >
            {/* Mount name (mono). */}
            <span className="w-full min-w-0 truncate font-df-mono text-[12.5px] font-medium text-df-ink sm:w-40">
              {v.mount}
            </span>

            {/* Used-% meter + current % — the meter never derives its own severity. */}
            <div className="flex flex-1 items-center gap-3">
              <ThresholdMeter
                pct={v.usedPct}
                sev={v.sev}
                stale={isStale}
                label={`${v.mount} used`}
                className="flex-1"
              />
              <span className="font-df-mono text-[12.5px] font-semibold tabular-nums text-df-ink">
                {Math.round(v.usedPct)}%
              </span>
            </div>

            {/* Signed %/day rate — shown whenever a rate is computable. */}
            <span className="font-df-mono text-[11.5px] tabular-nums text-df-muted sm:w-24 sm:text-right">
              {v.growth.pctPerDay !== null ? formatPctPerDay(v.growth.pctPerDay) : "—"}
            </span>

            {/* Projection slot — ALWAYS present; humanized when ok, honest copy else. */}
            <span
              className={cn(
                "font-df-mono text-[11.5px] tabular-nums sm:w-44 sm:text-right",
                isStale ? "text-df-stale-text" : "text-df-muted",
              )}
            >
              {projectionText}
            </span>
          </div>
        );
      })}
    </div>
  );
}
