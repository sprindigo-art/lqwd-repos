import { cn } from "@/lib/utils";

// =====================================================
// QueueTimeline — read-only audit transition timeline (QUEUE-03 / D-08)
// =====================================================
// Presentational component with NO logic (no "use client", no fetch, no health
// computation) — the append-only command_audit rows read back VERBATIM, mirroring
// ActiveSignalsPanel's verbatim-row grammar (T-02-07). The CALLER hands in an
// ordered AuditRow[]; this component only maps each transition to a row.
//
// State→chip mapping (UI-SPEC Color section): SUCCEEDED ok-green; REJECTED /
// FAILED / EXPIRED critical-red; every in-flight / pre-terminal state
// (PENDING_APPROVAL, APPROVED, CLAIMED, EXECUTING, DRAFT) neutral — no severity
// hue until terminal. Mono uppercase chips in the GradeBadge grammar — NO dots,
// NO icons (sketch rule). Hairline borders, mono density, tabular-nums times.
//
// Containment (V5): `reason` is free operator text — it renders as a React TEXT
// NODE only, never an HTML/markdown sink.

/** One append-only audit transition, pre-shaped by the caller (timestamps pre-formatted). */
export interface AuditRow {
  /** NULL on the initial enqueue transition. */
  fromState: string | null;
  toState: string;
  /** "operator" | "executor". */
  actor: string;
  /** Pre-formatted UTC timestamp string (no Date math in this presentational leaf). */
  ts: string;
  /** Optional D-07 reject reason — rendered as a text node only. */
  reason?: string | null;
  /** D-10 — true when the approval carried a stale-data acknowledgement. */
  staleAcknowledged?: boolean;
}

/** Terminal severity buckets (UI-SPEC). Everything else is neutral. */
const OK_STATES = new Set(["succeeded"]);
const CRITICAL_STATES = new Set(["rejected", "failed", "expired"]);

/** Map a to-state to its severity-tinted chip classes (no dots/icons). */
function chipClass(toState: string): string {
  const s = toState.toLowerCase();
  const base =
    "inline-block rounded-[3px] border px-1.5 py-0.5 font-df-mono text-xs font-semibold tracking-[0.14em] uppercase tabular-nums";
  if (OK_STATES.has(s)) {
    return cn(base, "border-df-ok/40 bg-df-ok-tint text-df-ok-text");
  }
  if (CRITICAL_STATES.has(s)) {
    return cn(base, "border-df-critical/40 bg-df-critical-tint text-df-critical");
  }
  // Neutral in-flight / pre-terminal — no severity hue.
  return cn(base, "border-df-border bg-df-surface-sub text-df-muted");
}

interface QueueTimelineProps {
  rows: AuditRow[];
}

export function QueueTimeline({ rows }: QueueTimelineProps) {
  // Should never happen post-enqueue (the enqueue writes the first audit row).
  if (rows.length === 0) {
    return <p className="font-df-mono text-xs text-df-muted">No transitions recorded.</p>;
  }

  return (
    <div className="flex flex-col">
      {rows.map((row, i) => (
        <div
          key={`${row.toState}-${row.ts}-${i}`}
          className="border-b border-df-border px-4 py-3 last:border-b-0"
        >
          <div className="flex items-baseline gap-3">
            <span className={chipClass(row.toState)}>{row.toState}</span>
            <span className="font-df-mono text-xs text-df-muted">
              {row.fromState !== null ? `from ${row.fromState}` : "enqueued"}
            </span>
            <span className="ms-auto flex items-baseline gap-3">
              <span className="font-df-mono text-xs text-df-muted">{row.actor}</span>
              <span className="font-df-mono text-xs tabular-nums text-df-muted">{row.ts}</span>
            </span>
          </div>
          {(row.reason || row.staleAcknowledged) && (
            <div className="mt-1 flex flex-col gap-0.5">
              {row.reason && (
                <p className="font-df-mono text-xs text-df-muted">reason: {row.reason}</p>
              )}
              {row.staleAcknowledged && (
                <p className="font-df-mono text-xs text-df-warning">
                  approved with stale-data acknowledgement
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
