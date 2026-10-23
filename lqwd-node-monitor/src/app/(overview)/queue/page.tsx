
import { asc } from "drizzle-orm";

import { latestChannelsForNode } from "@/lib/read/latest";
import { isStale, worstCaseAsOf } from "@/lib/scorecard/freshness";
import { STALENESS } from "@/lib/scorecard/config";
import { feeMsatToSat, formatSats } from "@/lib/format/units";
import { FreshnessStamp } from "@/components/scorecard/FreshnessStamp";
import { ApprovePanel } from "@/components/queue/ApprovePanel";
import { QueueTimeline, type AuditRow } from "@/components/queue/QueueTimeline";
import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { BoardEmpty } from "@/components/df/BoardEmpty";

// Shared operator nav — every surface reachable from every screen.
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

// Live warehouse + queue read at request time (Server Component) — never prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Root layout template renders this as "Queue | NodeMonitor".
export const metadata = { title: "Queue" };

// =====================================================
// QUEUE-03 / D-05 / D-06 / D-08 — the fleet-wide command queue + approval page
// =====================================================
// THE dedicated, fleet-wide approval surface (D-05), parallel to /inbox: it
// lists every pending_approval + in-flight command across the fleet and lets the
// operator approve/reject inline. For EACH command the page re-queries the LIVE
// current fee policy via the AFM-001 sanctioned read (latestChannelsForNode —
// DISTINCT ON chan_id, never the greatest-timestamp form, D-06) and renders the
// current→proposed diff against that live policy, never the enqueue-time
// snapshot. Freshness reuses the existing data-freshness band (isStale +
// STALENESS.warnAfterHours — D-09, no new queue-specific threshold) and the
// per-command append-only audit (command_audit) renders as a read-only
// QueueTimeline (D-08).
//
// Security/containment: this RSC reads server-side only (dbNodemon lazy-imported
// inside the loader). The ApprovePanel/QueueTimeline are handed SERIALIZABLE
// props only — the command row never crosses to a client bundle, and the reject
// reason renders as a text node (V5). The page computes NOTHING the engine owns:
// the diff numbers route through @/lib/format/units.ts (AFM-002, tabular-nums).
//
// Sketch grammar (binding): navy reserved for header chrome + the active-nav
// state; all severity color is state-only; mono-uppercase density, hairline
// borders, no icons-for-state.

// The non-terminal states the queue surfaces (pending first, then in-flight).
const PENDING_STATE = "pending_approval";
const IN_FLIGHT_STATES = new Set(["approved", "claimed", "executing"]);

/**
 * The update_fee params shape stored on the command row (bounds.ts). Every
 * field is OPTIONAL at the render boundary: the queue surfaces ALL non-terminal
 * commands, and a future non-update_fee command type carries params WITHOUT
 * these fee fields. Treating them as always-present is the /queue 500 bug — one
 * malformed row crashed the whole page on `params.timeLockDelta.toLocaleString`.
 * The renderers below null-guard every field into a safe "—" fallback.
 */
interface UpdateFeeParams {
  chanId?: string;
  channelPoint?: string;
  currentPpm?: number;
  suggestedPpm?: number;
  baseFeeMsat?: number;
  timeLockDelta?: number;
}

/** One command's assembled view-model — all rendering-ready, serializable. */
interface QueueRowView {
  id: string;
  pubkey: string;
  state: string;
  isPending: boolean;
  params: UpdateFeeParams;
  /** LIVE current policy from the AFM-001 re-query (null when the channel is not found live). */
  livePpm: number | null;
  liveBaseMsat: number | null;
  /** LIVE freshness of the matched channel row (D-09). */
  asOf: Date | null;
  stale: boolean;
  audit: AuditRow[];
}

/** Coerce a raw warehouse cell to a finite number (bigint | number | string | null). */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v as number);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a raw warehouse timestamp cell to a Date (or null). */
function asDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTC stamp formatting for the timeline rows + the stale-ack asOf line. */
const tsFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function formatTs(d: Date | null): string {
  return d === null ? "—" : `${tsFormat.format(d)} UTC`;
}

/** Short mono pubkey (first 8 · last 6) — matches every other board (audit F);
 *  the full 66-hex key stays available on hover via the title attribute. */
function shortPubkey(pubkey: string): string {
  return pubkey.length <= 16 ? pubkey : `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
}

/**
 * Server-only loader: read every queue command + its audit, then re-query the
 * LIVE current policy per command (AFM-001, D-06). dbNodemon is lazy-imported so
 * a pure importer of this module never spins a pool (latest.ts precedent).
 */
async function loadQueue(): Promise<QueueRowView[]> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

  // All commands + the full append-only audit, ordered oldest-first per command.
  const commandRows = await dbNodemon.select().from(commands);
  const auditRows = await dbNodemon
    .select()
    .from(commandAudit)
    .orderBy(asc(commandAudit.ts));

  // Group audit rows per command id (already time-ordered by the query).
  const auditByCommand = new Map<string, AuditRow[]>();
  for (const a of auditRows) {
    const list = auditByCommand.get(a.commandId) ?? [];
    list.push({
      fromState: a.fromState,
      toState: a.toState,
      actor: a.actor,
      ts: formatTs(asDate(a.ts)),
      reason: a.reason,
      staleAcknowledged: a.staleAcknowledged ?? false,
    });
    auditByCommand.set(a.commandId, list);
  }

  // Surface only pending + in-flight (terminal states drop off the operator queue).
  const visible = commandRows.filter(
    (c) => c.state === PENDING_STATE || IN_FLIGHT_STATES.has(c.state),
  );

  // Re-query the LIVE current policy per command (AFM-001 — the ONLY sanctioned
  // current-policy read, never the enqueue snapshot, never greatest-timestamp, D-06).
  const views = await Promise.all(
    visible.map(async (c): Promise<QueueRowView> => {
      const params = c.params as UpdateFeeParams;
      let livePpm: number | null = null;
      let liveBaseMsat: number | null = null;
      let asOf: Date | null = null;
      try {
        const live = await latestChannelsForNode(c.nodePubkey);
        const match = live.find((row) => String(row.chan_id) === String(params.chanId));
        if (match) {
          livePpm = num(match.outgoing_fee_rate_milli_msat);
          liveBaseMsat = num(match.outgoing_fee_base_msat);
          asOf = asDate(match.timestamp);
        }
      } catch (error) {
        // Live re-query failed for this node — surface as unknown freshness
        // (fail-loud: a null asOf reads as stale, never as fresh).
        console.error("queue live-policy re-query failed for a node");
        void error;
      }
      const worstAsOf = worstCaseAsOf([asOf]);
      return {
        id: c.id,
        pubkey: c.nodePubkey,
        state: c.state,
        isPending: c.state === PENDING_STATE,
        params,
        livePpm,
        liveBaseMsat,
        asOf: worstAsOf,
        stale: isStale(worstAsOf, STALENESS.warnAfterHours),
        audit: auditByCommand.get(c.id) ?? [],
      };
    }),
  );

  // Pending first, then in-flight (the operator's triage order, D-05).
  return views.sort((a, b) => Number(b.isPending) - Number(a.isPending));
}

/** One inert diff key/value row in the params grammar (AFM-002 tabular-nums). */
function DiffRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 font-df-mono text-xs">
      <span className="text-df-muted">{label}</span>
      <span className="tabular-nums text-df-muted">{children}</span>
    </div>
  );
}

/**
 * The current→proposed value pair (live current on the left, proposed on the
 * right). Both sides null-guard to "—": `current` is null when the live channel
 * policy is not found, and `proposed` is undefined when the command's params
 * lack this fee field (non-update_fee command) — neither may throw (/queue 500).
 */
function diffPair(current: number | null, proposed: number | null | undefined): React.ReactNode {
  const left = current === null ? "—" : current.toLocaleString("en-US");
  const right = proposed == null ? "—" : proposed.toLocaleString("en-US");
  return (
    <>
      {left} → {right}
    </>
  );
}

export default async function QueuePage() {
  let rows: QueueRowView[];
  try {
    rows = await loadQueue();
  } catch (error) {
    console.error("Queue load failed:", error);
    return (
      <BoardError
        active="queue"
        opsNav={OPS_NAV}
        title="Queue"
        heading="Couldn't load the Queue."
        body="The queue store didn't respond. Nothing was changed — this view is read-only until you act. Check the connection and reload."
      />
    );
  }

  const isEmpty = rows.length === 0;
  // Header freshness = the worst-case live stamp across every surfaced command;
  // fed to the top-bar PollAge (audit F). Per-command staleness renders per row.
  const headerAsOf = worstCaseAsOf(rows.map((r) => r.asOf));

  return (
    <NavRailShell
      active="queue"
      title="Queue"
      opsNav={OPS_NAV}
      showViewToggle={false}
      showFleetSummary={false}
      // Freshness standardized to the top-bar PollAge (audit F) — same as
      // nodes/hosts — instead of an in-page FreshnessStamp. headerStale is still
      // reflected per-command below.
      pollSinceMs={headerAsOf?.getTime()}
    >
      <div className="flex flex-col gap-6">
      {/* Header grammar mirrors /inbox: display-role title left. Freshness now
          lives in the shared top-bar PollAge (audit F). */}
      <header className="flex flex-col gap-1">
        <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-df-ink">Queue</h1>
        <p className="text-sm text-df-muted">
          fleet-wide pending + in-flight commands · live current policy · read-only until you act
        </p>
      </header>

      {isEmpty ? (
        // Honest empty state (UI-SPEC copy) — absence IS the signal.
        <BoardEmpty
          heading="Queue is empty"
          body="No fee-update intents have been enqueued. Enqueue one from a fee recommendation on the Inbox or a node console."
          footnote="Nodes flagged for a close-storm or connection issue have fee actions suppressed — no enqueue control appears for them."
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => (
            <li
              key={row.id}
              className="overflow-hidden rounded-df-card border border-df-border bg-df-surface"
            >
              {/* Command head: node + channel + state + freshness stamp. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-df-border px-4 py-2.5">
                <span className="font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase">
                  {row.state}
                </span>
                <span className="font-df-mono text-xs text-df-muted">
                  channel {row.params.chanId ?? "—"}
                </span>
                <span className="font-df-mono text-xs text-df-muted" title={row.pubkey}>
                  {shortPubkey(row.pubkey)}
                </span>
                <span className="ms-auto">
                  <FreshnessStamp asOf={row.asOf} stale={row.stale} />
                </span>
              </div>

              <div className="flex flex-col gap-4 px-4 py-3 md:flex-row md:gap-8">
                {/* LIVE current→proposed diff (D-06). Current is the AFM-001 live
                    policy, NOT the enqueue snapshot; proposed is the signed param. */}
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="mb-1 font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase">
                    current → proposed
                  </span>
                  <DiffRow label="ppm">{diffPair(row.livePpm, row.params.suggestedPpm)}</DiffRow>
                  <DiffRow label="base fee (msat)">
                    {diffPair(row.liveBaseMsat, row.params.baseFeeMsat)}
                  </DiffRow>
                  <DiffRow label="base fee (sat)">
                    {row.liveBaseMsat === null ? "—" : formatSats(feeMsatToSat(row.liveBaseMsat))} →{" "}
                    {row.params.baseFeeMsat == null
                      ? "—"
                      : formatSats(feeMsatToSat(row.params.baseFeeMsat))}
                  </DiffRow>
                  <DiffRow label="timelock delta">
                    {row.params.timeLockDelta == null
                      ? "—"
                      : row.params.timeLockDelta.toLocaleString("en-US")}
                  </DiffRow>
                  {row.livePpm === null && (
                    <p className="mt-1 font-df-mono text-xs text-df-warning">
                      live channel policy not found — current values unavailable.
                    </p>
                  )}
                </div>

                {/* Append-only audit timeline (D-08) — read-only, verbatim. */}
                <div className="flex-1">
                  <span className="mb-1 block font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase">
                    audit
                  </span>
                  <div className="overflow-hidden rounded-[6px] border border-df-border">
                    <QueueTimeline rows={row.audit} />
                  </div>
                </div>
              </div>

              {/* Approval surface — pending rows only. Stale flag + asOf flow in;
                  the ApprovePanel sends params + the stale-ack boolean to the
                  server action, never a signature. */}
              {row.isPending && (
                <div className="border-t border-df-border px-4 py-3">
                  <ApprovePanel
                    commandId={row.id}
                    isStale={row.stale}
                    asOf={formatTs(row.asOf)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
        )}
      </div>
    </NavRailShell>
  );
}
