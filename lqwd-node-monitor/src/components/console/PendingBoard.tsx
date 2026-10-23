import type {
  PendingNodeGroup,
  PendingRow,
  PendingSweepRow,
  PendingView,
} from "@/lib/read/pending";
import { buildFleetPendingSummary } from "@/lib/console/pending-summary";
import { FleetPendingBoard } from "@/components/console/FleetPendingBoard";
import { formatSats } from "@/lib/format/units";
import { cn } from "@/lib/utils";

// =====================================================
// PENDING-01 / D-11 / D-13 — the one pending surface, both scopes
// =====================================================
// Server Component parameterized by scope: fleet-wide at /pending (node
// groups separated by the 2xl token) and per-node in the console's Pending
// tab. Renders buildPendingView() output VERBATIM (T-02-07): grouping,
// nesting, orphan retention, and oldest-first ordering all happened in
// src/lib/read/pending.ts — nothing is re-ordered or re-derived here.
//
// D-13 is display-only: section HEADINGS carry the status colors from the
// UI-SPEC Color table (opens=ok, coop=warn, force=critical — funds in limbo
// are genuinely at risk) as colored heading TEXT — no marker dots (sketch 001:
// no emoji, no dots, no icons for state). Individual rows get NO red/yellow
// judgment and ages render prominent but UNJUDGED. The stuck detector is Phase 4.
//
// Sat values route through formatSats (AFM-002 single source of truth —
// pending.ts hands limbo/amounts raw on purpose: "render formats").
// Durations are formatted here, dates-and-durations-only, following the
// FreshnessStamp precedent — no sat/BTC math outside units.ts.

interface PendingBoardProps {
  view: PendingView;
  scope: "fleet" | "node";
}

/**
 * The three locked sections in D-13 presentation order. This is the UI-SPEC
 * Color table as a constant — a spec mapping per section TYPE, not a color
 * derived from data values.
 */
const LOCKED_SECTIONS = [
  {
    key: "PENDING_OPEN",
    label: "Pending opens",
    empty: "No pending opens",
    headClass: "text-df-ok-text",
  },
  {
    key: "WAITING_CLOSE",
    label: "Coop closes",
    empty: "No pending coop closes",
    headClass: "text-df-warning",
  },
  {
    key: "FORCE_CLOSE",
    label: "Force closes",
    empty: "No pending force closes",
    headClass: "text-df-critical",
  },
] as const;

const LOCKED_KEYS: ReadonlySet<string> = new Set(LOCKED_SECTIONS.map((s) => s.key));

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Durations only here — no sat/BTC math (AFM-002 lives in units.ts). */
function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "—";
  if (ageMs < MS_PER_MINUTE) return "<1m";
  const days = Math.floor(ageMs / MS_PER_DAY);
  const hours = Math.floor((ageMs % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ageMs % MS_PER_HOUR) / MS_PER_MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Raw warehouse numeric-string → "1,234 sat" via the sanctioned formatter. */
function sats(value: string | number | null): string {
  if (value === null) return "—";
  return `${formatSats(Number(value))} sat`;
}

function shortHex(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex;
}

/** "txid:vout" → truncated txid, vout kept (the operator-recognizable part). */
function shortChannelPoint(channelPoint: string): string {
  const sep = channelPoint.lastIndexOf(":");
  if (sep === -1) return shortHex(channelPoint);
  return `${shortHex(channelPoint.slice(0, sep))}${channelPoint.slice(sep)}`;
}

/** One sweep line — nested under its force-close parent, or in the orphan group. */
function SweepLine({ sweep }: { sweep: PendingSweepRow }) {
  return (
    <p className="font-df-mono text-xs tabular-nums text-df-muted">
      {"↳ sweep "}
      {sweep.outpointTxid ? shortHex(sweep.outpointTxid) : "—"}
      {sweep.outpointOutputIndex !== null && `:${sweep.outpointOutputIndex}`}
      {" · "}
      {sweep.broadcastAttempts ?? "—"}
      {" broadcast attempts · "}
      {sats(sweep.amountSat)}
      {" · "}
      {sweep.satPerVbyte ?? "—"}
      {" sat/vB"}
      {sweep.requestedSatPerVbyte !== null && ` (req ${sweep.requestedSatPerVbyte})`}
    </p>
  );
}

function PendingRowItem({ row }: { row: PendingRow }) {
  return (
    <div className="flex flex-col">
      {/* Mobile: fields stack (FleetRow grid-collapse pattern); md+: one line. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-1 px-3 py-2 transition-colors hover:bg-df-surface md:grid-cols-[minmax(0,1.5fr)_max-content_minmax(0,1fr)_minmax(0,10rem)]">
        {/* CHANNEL — channel point + remote peer. Always visible (mobile row 1). */}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-df-mono text-sm tabular-nums">
            {row.channelPoint ? shortChannelPoint(row.channelPoint) : "—"}
          </span>
          {row.remoteNodePub !== null && (
            <span className="font-df-mono text-xs text-df-muted">
              → {shortHex(row.remoteNodePub)}
            </span>
          )}
        </span>

        {/* AGE — prominent, Heading-role mono, UNJUDGED (D-13: no thresholds). */}
        <span className="justify-self-end font-df-mono text-base font-semibold tabular-nums md:justify-self-start">
          {formatAge(row.ageMs)}
        </span>

        {/* STATE — verbatim channel_state (Pitfall 10: source truth in the row). */}
        <span className="col-span-full font-df-mono text-xs text-df-muted md:col-span-1">
          {row.state}
        </span>

        {/* LIMBO — time-locked balance, AFM-002 via formatSats. */}
        <span className="col-span-full flex flex-col gap-0.5 md:col-span-1 md:items-end md:justify-self-end md:text-right">
          <span className="font-df-mono text-sm tabular-nums">{sats(row.limboBalance)}</span>
          {row.blocksTilMaturity !== null && row.blocksTilMaturity > 0 && (
            <span className="font-df-mono text-xs tabular-nums text-df-muted">
              {row.blocksTilMaturity} blocks til maturity
            </span>
          )}
        </span>
      </div>

      {/* Sweeps nest indented under their parent force-close (D-13). */}
      {row.sweeps.length > 0 && (
        <div className="flex flex-col gap-1 pb-2 ps-9 pe-3">
          {row.sweeps.map((sweep, i) => (
            <SweepLine key={sweep.outpointTxid ?? i} sweep={sweep} />
          ))}
        </div>
      )}
    </div>
  );
}

function PendingSection({
  label,
  empty,
  headClass,
  rows,
}: {
  label: string;
  empty: string;
  headClass: string;
  rows: PendingRow[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {/* Zero-quiet discipline (D-07/D-12): the heading wears its severity
          color only when the section holds rows — an empty force-close section
          never flashes red. Colored TEXT, never a marker dot (sketch 001). */}
      <h3
        className={cn(
          "flex items-center gap-1.5 font-df-mono text-xs font-semibold tracking-[0.14em] uppercase",
          rows.length > 0 ? headClass : "text-df-muted"
        )}
      >
        {label}
        <span className={cn("tabular-nums", rows.length === 0 && "text-df-muted")}>
          {rows.length}
        </span>
      </h3>
      {rows.length === 0 ? (
        // Empty sections collapse to one quiet line — shown, never hidden.
        <p className="text-sm text-df-muted">{empty}</p>
      ) : (
        <div className="divide-y divide-df-border overflow-hidden rounded-df-card border border-df-border bg-df-surface-sub">
          {rows.map((row, i) => (
            <PendingRowItem key={row.channelPoint ?? `${row.state}-${i}`} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function NodeGroup({ node, scope }: { node: PendingNodeGroup; scope: "fleet" | "node" }) {
  // Unexpected channel_state values still render (03-01 decision: sections is
  // an open Record so no row is ever dropped — every sat accounted for).
  const extraKeys = Object.keys(node.sections).filter((key) => !LOCKED_KEYS.has(key));

  return (
    <section className="flex flex-col gap-4">
      {/* Fleet scope groups carry their own identity; the console's Pending
          tab sits under the node header already. */}
      {scope === "fleet" && (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-base leading-tight font-semibold">
            {node.lndAlias ?? shortHex(node.localPubkey)}
          </h2>
          <span className="font-df-mono text-xs text-df-muted">{shortHex(node.localPubkey)}</span>
        </header>
      )}

      {LOCKED_SECTIONS.map((section) => (
        <PendingSection
          key={section.key}
          label={section.label}
          empty={section.empty}
          headClass={section.headClass}
          rows={node.sections[section.key] ?? []}
        />
      ))}

      {extraKeys.map((key) => (
        <PendingSection
          key={key}
          label={key}
          empty=""
          headClass="text-df-stale-text"
          rows={node.sections[key]}
        />
      ))}

      {/* Orphan sweeps — no matching force-close row, rendered quietly, never
          dropped (every sat accounted for). */}
      {node.unattachedSweeps.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* Quiet inventory heading — not a severity section, so no state
              color; and never a marker dot (sketch 001 no-dot grammar). */}
          <h3 className="flex items-center gap-1.5 font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase">
            Unattached sweeps
            <span className="tabular-nums text-df-muted">{node.unattachedSweeps.length}</span>
          </h3>
          <div className="flex flex-col gap-1 rounded-df-card border border-df-border bg-df-surface-sub px-3 py-2">
            {node.unattachedSweeps.map((sweep, i) => (
              <SweepLine key={sweep.outpointTxid ?? i} sweep={sweep} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function PendingBoard({ view, scope }: PendingBoardProps) {
  // A fully empty view is the PAGE's locked empty state (UI-SPEC §Copywriting
  // owns "Nothing pending fleet-wide" / "No pending channels") — render nothing.
  if (view.nodes.length === 0) return null;

  // Fleet scope (sketch 004 winner B): the dense counts + drill-in board. The
  // per-node console tab keeps the sectioned layout below — it shows one node,
  // so length was never the problem the fleet page had.
  if (scope === "fleet") {
    return <FleetPendingBoard summary={buildFleetPendingSummary(view)} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {view.nodes.map((node) => (
        <NodeGroup key={node.localPubkey} node={node} scope={scope} />
      ))}
    </div>
  );
}
