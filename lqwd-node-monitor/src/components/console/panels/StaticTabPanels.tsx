import { channelsTabData } from "@/lib/console/channels";
import { feesTabData } from "@/lib/console/fees";
import { liquidityTabData } from "@/lib/console/liquidity";
import { peersTabData, FLAP_COUNT_LIFETIME_NOTE } from "@/lib/console/peers";
import { PENDING_RECENCY_HOURS, ROW_CAP } from "@/lib/console/config";
import { buildPendingView, currentPendingChannels, currentPendingSweeps } from "@/lib/read/pending";
import { isStale } from "@/lib/scorecard/freshness";
import { STALENESS } from "@/lib/scorecard/config";
import { formatSats } from "@/lib/format/units";
import { CapBanner } from "@/components/console/CapBanner";
import { EventTable } from "@/components/console/EventTable";
import { ExportButton } from "@/components/console/ExportButton";
import { PendingBoard } from "@/components/console/PendingBoard";
import { SummaryStrip } from "@/components/console/SummaryStrip";
import { FreshnessStamp } from "@/components/scorecard/FreshnessStamp";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// =====================================================
// NODE-01 static tab panels + the per-node Pending tab (D-01/D-03/D-13)
// =====================================================
// Five async Server Components composed by [tab]/page.tsx: Channels, Fees,
// Liquidity, Peers (AFM-001 latest-state shapers from 03-04) and the per-node
// Pending panel (the sanctioned currently-pending read, PENDING_RECENCY_HOURS
// scope). All formatting happens HERE at the boundary (AFM-002 via units.ts) —
// EventTable/SummaryStrip receive pre-formatted strings only (T-02-07).
//
// Every panel carries a FreshnessStamp scoped to its OWN source data (success
// criterion 4); stale flags via the same tunable threshold as the scorecard
// (STALENESS.warnAfterHours). Latest-state tabs get NO window picker — a
// window is meaningless for current state (UI-SPEC §Event tables).
//
// Empty and error states render the LOCKED UI-SPEC §Copywriting strings —
// scope-naming, never decorative, read-only reassurance on errors.

interface PanelProps {
  pubkey: string;
  alias: string;
}

function shortHex(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex;
}

/** "txid:vout" → truncated txid, vout kept (PendingBoard precedent). */
function shortChannelPoint(channelPoint: string): string {
  const sep = channelPoint.lastIndexOf(":");
  if (sep === -1) return shortHex(channelPoint);
  return `${shortHex(channelPoint.slice(0, sep))}${channelPoint.slice(sep)}`;
}

/** Per-panel staleness against the same tunable threshold as the scorecard. */
function staleFor(asOf: Date | null): boolean {
  return isStale(asOf, STALENESS.warnAfterHours);
}

/**
 * Deterministic largest-first order for latest-state rows before the ROW_CAP
 * slice (WR-03): the latest readers return DISTINCT ON (chan_id) / Map
 * insertion order, so an unsorted slice drops an arbitrary tail. Capacity
 * descending with chan id as tiebreaker keeps the cap meaningful and the
 * CapBanner copy ("largest") honest.
 */
function byCapacityDesc(
  a: { capacitySat: string | null; chanId: string },
  b: { capacitySat: string | null; chanId: string }
): number {
  return (
    Number(b.capacitySat ?? 0) - Number(a.capacitySat ?? 0) || a.chanId.localeCompare(b.chanId)
  );
}

/** Locked empty state (UI-SPEC §Copywriting) — names the scope, never a bare blank table. */
function EmptyState({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card/30 px-6 py-10">
      <h3 className="text-2xl font-semibold tracking-tight">{heading}</h3>
      <p className="text-sm text-foreground/60">{body}</p>
    </div>
  );
}

/** Locked error state (UI-SPEC §Copywriting) — problem + read-only reassurance + next step. */
function TabError({ tabName }: { tabName: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card/40 px-6 py-10">
      <h3 className="text-2xl font-semibold tracking-tight">Couldn&apos;t load {tabName}.</h3>
      <p className="text-sm text-foreground/60">
        The warehouse didn&apos;t respond. Your data is unchanged — this view is read-only. Check
        the connection and reload.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Channels — latest state, no window picker, exportable (NODE-02 minimum set)
// ---------------------------------------------------------------------------

export async function ChannelsPanel({ pubkey, alias }: PanelProps) {
  let data;
  try {
    data = await channelsTabData(pubkey);
  } catch {
    return <TabError tabName="channels" />;
  }

  const shown = [...data.rows].sort(byCapacityDesc).slice(0, ROW_CAP);
  const rows = shown.map((r) => ({
    chanId: r.chanId,
    remote: r.remotePubkey ? shortHex(r.remotePubkey) : "—",
    channelPoint: r.channelPoint ? shortChannelPoint(r.channelPoint) : "—",
    status: r.active ? "active" : "inactive",
    capacity: r.capacityDisplay,
    local: r.localBalanceDisplay,
    remoteBalance: r.remoteBalanceDisplay,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-4">
        {<FreshnessStamp asOf={data.asOf} stale={staleFor(data.asOf)} />}
        <ExportButton href={`/${pubkey}/channels/export`} />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState
          heading="No channels to show"
          body={`The warehouse returned no channels for ${alias}. If that's unexpected, check data freshness above.`}
        />
      ) : (
        <>
          <SummaryStrip
            cells={[
              { label: "channels", value: data.strip.count.toLocaleString("en-US") },
              { label: "Σ capacity", value: data.strip.totalCapacityDisplay },
              { label: "Σ local", value: data.strip.totalLocalDisplay },
              { label: "Σ remote", value: data.strip.totalRemoteDisplay },
            ]}
          />
          <CapBanner
            shown={shown.length}
            total={data.rows.length}
            variant="largest"
            exportSlot={<ExportButton href={`/${pubkey}/channels/export`} />}
          />
          <EventTable
            columns={[
              { key: "chanId", label: "chan id", mono: true },
              { key: "remote", label: "remote peer", mono: true },
              { key: "channelPoint", label: "channel point", mono: true },
              { key: "status", label: "status", mono: true },
              { key: "capacity", label: "capacity (sat)", align: "right", mono: true },
              { key: "local", label: "local (sat)", align: "right", mono: true },
              { key: "remoteBalance", label: "remote (sat)", align: "right", mono: true },
            ]}
            rows={rows}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fees — latest per-channel fee policy, exportable (NODE-02 minimum set)
// ---------------------------------------------------------------------------

export async function FeesPanel({ pubkey, alias }: PanelProps) {
  let data;
  try {
    data = await feesTabData(pubkey);
  } catch {
    return <TabError tabName="fees" />;
  }

  const shown = [...data.rows].sort(byCapacityDesc).slice(0, ROW_CAP);
  const rows = shown.map((r) => ({
    chanId: r.chanId,
    remote: r.remotePubkey ? shortHex(r.remotePubkey) : "—",
    capacity: r.capacityDisplay,
    baseFee: r.baseFeeSatDisplay,
    feeRate: r.feeRatePpmDisplay,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-4">
        {<FreshnessStamp asOf={data.asOf} stale={staleFor(data.asOf)} />}
        <ExportButton href={`/${pubkey}/fees/export`} />
      </div>
      {data.rows.length === 0 ? (
        <EmptyState
          heading="No channels to show"
          body={`The warehouse returned no channels for ${alias}. If that's unexpected, check data freshness above.`}
        />
      ) : (
        <>
          <SummaryStrip
            cells={[
              { label: "channels", value: data.strip.count.toLocaleString("en-US") },
              {
                label: "avg rate (ppm)",
                value:
                  data.strip.avgRatePpm === null
                    ? "—"
                    : Math.round(data.strip.avgRatePpm).toLocaleString("en-US"),
              },
              {
                label: "avg base fee (sat)",
                value:
                  data.strip.avgBaseFeeSat === null ? "—" : formatSats(data.strip.avgBaseFeeSat),
              },
            ]}
          />
          <CapBanner
            shown={shown.length}
            total={data.rows.length}
            variant="largest"
            exportSlot={<ExportButton href={`/${pubkey}/fees/export`} />}
          />
          <EventTable
            columns={[
              { key: "chanId", label: "chan id", mono: true },
              { key: "remote", label: "remote peer", mono: true },
              { key: "capacity", label: "capacity (sat)", align: "right", mono: true },
              { key: "baseFee", label: "base fee (sat)", align: "right", mono: true },
              { key: "feeRate", label: "fee rate (ppm)", align: "right", mono: true },
            ]}
            rows={rows}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Liquidity — routable balance per channel (active, non-closed); no export
// ---------------------------------------------------------------------------

export async function LiquidityPanel({ pubkey, alias }: PanelProps) {
  let data;
  try {
    data = await liquidityTabData(pubkey);
  } catch {
    return <TabError tabName="liquidity" />;
  }

  const shown = [...data.rows].sort(byCapacityDesc).slice(0, ROW_CAP);
  const rows = shown.map((r) => ({
    chanId: r.chanId,
    remote: r.remotePubkey ? shortHex(r.remotePubkey) : "—",
    local: r.localBalanceDisplay,
    remoteBalance: r.remoteBalanceDisplay,
    capacity: r.capacityDisplay,
    localPct: r.localRatio === null ? "—" : `${(r.localRatio * 100).toFixed(1)}%`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-4">
        {<FreshnessStamp asOf={data.asOf} stale={staleFor(data.asOf)} />}
      </div>
      {data.rows.length === 0 ? (
        <EmptyState
          heading="No channels to show"
          body={`The warehouse returned no channels for ${alias}. If that's unexpected, check data freshness above.`}
        />
      ) : (
        <>
          <SummaryStrip
            cells={[
              { label: "Σ local", value: data.strip.totalLocalDisplay },
              { label: "Σ remote", value: data.strip.totalRemoteDisplay },
              { label: "Σ capacity", value: data.strip.totalCapacityDisplay },
              {
                label: "local share",
                value:
                  data.strip.overallLocalPct === null
                    ? "—"
                    : `${data.strip.overallLocalPct.toFixed(1)}%`,
              },
            ]}
          />
          <CapBanner shown={shown.length} total={data.rows.length} variant="largest" />
          <EventTable
            columns={[
              { key: "chanId", label: "chan id", mono: true },
              { key: "remote", label: "remote peer", mono: true },
              { key: "local", label: "local (sat)", align: "right", mono: true },
              { key: "remoteBalance", label: "remote (sat)", align: "right", mono: true },
              { key: "capacity", label: "capacity (sat)", align: "right", mono: true },
              { key: "localPct", label: "local %", align: "right", mono: true },
            ]}
            rows={rows}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peers — channel counterparties, honest headline (Pitfall 5); no strip/export
// ---------------------------------------------------------------------------

export async function PeersPanel({ pubkey, alias }: PanelProps) {
  let data;
  try {
    data = await peersTabData(pubkey);
  } catch {
    return <TabError tabName="peers" />;
  }

  // Largest partners first (WR-03) — Map insertion order is not meaningful.
  const shown = [...data.rows]
    .sort(
      (a, b) =>
        b.totalCapacitySat - a.totalCapacitySat || a.remotePubkey.localeCompare(b.remotePubkey)
    )
    .slice(0, ROW_CAP);
  const rows = shown.map((r) => ({
    alias: r.alias ?? "—",
    peer: shortHex(r.remotePubkey),
    channels: r.channelCount.toLocaleString("en-US"),
    capacity: r.totalCapacityDisplay,
    flaps: r.flapCountLifetime === null ? "—" : r.flapCountLifetime.toLocaleString("en-US"),
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Honest labeling (Pitfall 5): connected peers ≠ channel partners. */}
      <div className="flex flex-wrap items-center gap-4">
        <p className="font-mono text-base font-semibold tabular-nums">
          {data.headline.numPeers === null ? "—" : data.headline.numPeers.toLocaleString("en-US")}{" "}
          connected peers ·{" "}
          <span className="text-foreground/60">
            {/* Count what's actually rendered — the capped slice, not the shaper
                total; the two disagree exactly when ROW_CAP bites (WR-03). */}
            showing {shown.length.toLocaleString("en-US")} channel partners
          </span>
        </p>
        <span className="ms-auto">
          {<FreshnessStamp asOf={data.asOf} stale={staleFor(data.asOf)} />}
        </span>
      </div>
      {data.rows.length === 0 ? (
        <EmptyState
          heading="No peers to show"
          body={`The warehouse returned no peers for ${alias}. If that's unexpected, check data freshness above.`}
        />
      ) : (
        <>
          <CapBanner shown={shown.length} total={data.rows.length} variant="largest" />
          <EventTable
            columns={[
              { key: "alias", label: "alias" },
              { key: "peer", label: "peer pubkey", mono: true },
              { key: "channels", label: "channels", align: "right", mono: true },
              { key: "capacity", label: "capacity (sat)", align: "right", mono: true },
              {
                key: "flaps",
                // Lifetime-cumulative tooltip (LabeledTooltip composition from
                // DimensionRow) — never present flapcount as recent activity.
                label: (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex items-center underline decoration-dotted decoration-foreground/30 underline-offset-4">
                          flaps (lifetime)
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{FLAP_COUNT_LIFETIME_NOTE}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ),
                align: "right",
                mono: true,
              },
            ]}
            rows={rows}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending — node-scoped currently-pending board (PENDING-01 / D-13)
// ---------------------------------------------------------------------------

export async function PendingTabPanel({ pubkey, alias }: PanelProps) {
  let view;
  try {
    const [channels, sweeps] = await Promise.all([
      currentPendingChannels(PENDING_RECENCY_HOURS, pubkey),
      currentPendingSweeps(PENDING_RECENCY_HOURS, pubkey),
    ]);
    view = buildPendingView(channels, sweeps);
  } catch {
    return <TabError tabName="pending" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-4">
        {<FreshnessStamp asOf={view.asOf} stale={staleFor(view.asOf)} />}
      </div>
      {view.nodes.length === 0 ? (
        <EmptyState
          heading="No pending channels"
          body={`${alias} has nothing in flight. Pending opens and closes will appear here with state, age, and limbo balance.`}
        />
      ) : (
        <PendingBoard view={view} scope="node" />
      )}
    </div>
  );
}
