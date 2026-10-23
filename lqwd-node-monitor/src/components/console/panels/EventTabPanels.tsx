import { forwardsTabData } from "@/lib/console/forwards";
import { closesTabData } from "@/lib/console/closes";
import type { WindowKey } from "@/lib/console/config";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { isStale } from "@/lib/scorecard/freshness";
import { STALENESS } from "@/lib/scorecard/config";
import { feeMsatToSat, formatSats } from "@/lib/format/units";
import { CapBanner } from "@/components/console/CapBanner";
import { EventTable } from "@/components/console/EventTable";
import { ExportButton } from "@/components/console/ExportButton";
import { SummaryStrip } from "@/components/console/SummaryStrip";
import { WindowPicker } from "@/components/console/WindowPicker";
import { FreshnessStamp } from "@/components/scorecard/FreshnessStamp";

// =====================================================
// NODE-01 event tab panels — Forwards + Closes (D-05/D-06/D-07/D-09)
// =====================================================
// Two async Server Components composed by [tab]/page.tsx. Layout top-to-bottom
// per UI-SPEC §Event tables: WindowPicker (default 7d) with FreshnessStamp +
// Export CSV right-aligned in the same header row → SummaryStrip → CapBanner
// (only when N > cap, export right-aligned inside) → EventTable of the newest
// ROW_CAP rows.
//
// ALL formatting happens HERE at the boundary: sat/fee values route through
// units.ts (AFM-002 — fee cells via feeMsatToSat, NEVER the raw `fee` column),
// closes timestamps through parseDbTimestampUtc (WR-01), forwards timestamps
// via the ns-epoch → ms conversion (the read layer's documented /1e6 form).
// EventTable receives pre-formatted strings only (T-02-07).
//
// Export hrefs carry the CURRENT window key (D-09: export = the full selected
// window, not the 500-row render cap). windowKey arrives ALREADY validated
// against WINDOW_PRESETS by the page — never an unvalidated string.

interface EventPanelProps {
  pubkey: string;
  alias: string;
  windowKey: WindowKey;
}

function shortHex(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex;
}

/** Dates only — UTC, date + time (event rows need the clock, not just the day). */
const timeFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function formatTime(d: Date | null): string {
  return d === null ? "—" : timeFormat.format(d);
}

function staleFor(asOf: Date | null): boolean {
  return isStale(asOf, STALENESS.warnAfterHours);
}

/** Locked empty state — event-tab variant (UI-SPEC §Copywriting). */
function EmptyWindow({ kind, alias, window }: { kind: string; alias: string; window: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-card/30 px-6 py-10">
      <h3 className="text-2xl font-semibold tracking-tight">No {kind} in this window</h3>
      <p className="text-sm text-foreground/60">
        Nothing recorded for {alias} in the last {window}. Try a wider window, or export a different
        range.
      </p>
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
// Forwards — windowed event table (ns-epoch source)
// ---------------------------------------------------------------------------

export async function ForwardsPanel({ pubkey, alias, windowKey }: EventPanelProps) {
  let data;
  try {
    data = await forwardsTabData(pubkey, windowKey);
  } catch {
    return <TabError tabName="forwards" />;
  }

  const exportHref = `/${pubkey}/forwards/export?window=${windowKey}`;

  const rows = data.rows.map((r) => ({
    // ns since epoch → ms → Date (forwards.ts /1e6 precedent — time, not sats).
    time: formatTime(r.timestamp_ns == null ? null : new Date(Number(r.timestamp_ns) / 1e6)),
    chanIn: r.chan_id_in ?? "—",
    chanOut: r.chan_id_out ?? "—",
    peerIn: r.peer_alias_in ?? "—",
    peerOut: r.peer_alias_out ?? "—",
    amtIn: r.amt_in === null ? "—" : formatSats(Number(r.amt_in)),
    amtOut: r.amt_out === null ? "—" : formatSats(Number(r.amt_out)),
    // AFM-002: fee_msat via feeMsatToSat — NEVER the raw `fee` column.
    fee: r.fee_msat === null ? "—" : formatSats(feeMsatToSat(Number(r.fee_msat))),
  }));

  const busiest =
    data.busiest === null ? "—" : (data.busiest.peerAliasOut ?? data.busiest.chanIdOut ?? "—");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <WindowPicker basePath={`/${pubkey}/forwards`} selected={windowKey} />
        <div className="ms-auto flex flex-wrap items-center gap-4">
          <FreshnessStamp asOf={data.asOf} stale={staleFor(data.asOf)} />
          <ExportButton href={exportHref} />
        </div>
      </div>
      {data.rows.length === 0 ? (
        <EmptyWindow kind="forwards" alias={alias} window={windowKey} />
      ) : (
        <>
          <SummaryStrip
            cells={[
              { label: "forwards", value: data.summary.n.toLocaleString("en-US") },
              { label: "Σ amt out (sat)", value: formatSats(data.summary.totalAmtOutSat) },
              { label: "Σ fees (sat)", value: formatSats(data.summary.totalFeesSat) },
              {
                label: "avg fee (sat)",
                value: data.summary.avgFeeSat === null ? "—" : formatSats(data.summary.avgFeeSat),
              },
              { label: "busiest channel", value: busiest },
            ]}
          />
          <CapBanner
            shown={data.rows.length}
            total={data.totalCount}
            exportSlot={<ExportButton href={exportHref} />}
          />
          <EventTable
            columns={[
              { key: "time", label: "time (utc)", mono: true },
              { key: "chanIn", label: "chan in", mono: true },
              { key: "chanOut", label: "chan out", mono: true },
              { key: "peerIn", label: "peer in" },
              { key: "peerOut", label: "peer out" },
              { key: "amtIn", label: "amt in (sat)", align: "right", mono: true },
              { key: "amtOut", label: "amt out (sat)", align: "right", mono: true },
              { key: "fee", label: "fee (sat)", align: "right", mono: true },
            ]}
            rows={rows}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Closes — windowed event table (one row per close, close_type verbatim)
// ---------------------------------------------------------------------------

/** Console-label strings for the per-close_type strip cells (zero-quiet: only nonzero render). */
const CLOSE_TYPE_LABELS: ReadonlyArray<{
  key: keyof Awaited<ReturnType<typeof closesTabData>>["summary"]["byCloseType"];
  label: string;
}> = [
  { key: "COOPERATIVE_CLOSE", label: "coop closes" },
  { key: "LOCAL_FORCE_CLOSE", label: "local FC" },
  { key: "REMOTE_FORCE_CLOSE", label: "remote FC" },
  { key: "ABANDONED", label: "abandoned" },
  { key: "BREACH_CLOSE", label: "breach" },
  { key: "FUNDING_CANCELED", label: "funding canceled" },
];

export async function ClosesPanel({ pubkey, alias, windowKey }: EventPanelProps) {
  let data;
  try {
    data = await closesTabData(pubkey, windowKey);
  } catch {
    return <TabError tabName="closes" />;
  }

  const exportHref = `/${pubkey}/closes/export?window=${windowKey}`;

  const rows = data.rows.map((r) => ({
    time: formatTime(parseDbTimestampUtc(r.timestamp)),
    peer: r.remote_pubkey === null ? "—" : shortHex(r.remote_pubkey),
    // Verbatim close_type (Pitfall 10 — the operator sees the source truth).
    closeType: r.close_type ?? "—",
    capacity: r.capacity === null ? "—" : formatSats(Number(r.capacity)),
    settled: r.settled_balance === null ? "—" : formatSats(Number(r.settled_balance)),
  }));

  const typeCells = CLOSE_TYPE_LABELS.filter(({ key }) => data.summary.byCloseType[key] > 0).map(
    ({ key, label }) => ({
      label,
      value: data.summary.byCloseType[key].toLocaleString("en-US"),
    })
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <WindowPicker basePath={`/${pubkey}/closes`} selected={windowKey} />
        <div className="ms-auto flex flex-wrap items-center gap-4">
          <FreshnessStamp asOf={data.asOf} stale={staleFor(data.asOf)} />
          <ExportButton href={exportHref} />
        </div>
      </div>
      {data.rows.length === 0 ? (
        <EmptyWindow kind="closes" alias={alias} window={windowKey} />
      ) : (
        <>
          <SummaryStrip
            cells={[
              { label: "closes", value: data.summary.n.toLocaleString("en-US") },
              { label: "Σ capacity (sat)", value: formatSats(data.summary.totalCapacitySat) },
              { label: "Σ settled (sat)", value: formatSats(data.summary.totalSettledSat) },
              ...typeCells,
            ]}
          />
          <CapBanner
            shown={data.rows.length}
            total={data.totalCount}
            exportSlot={<ExportButton href={exportHref} />}
          />
          <EventTable
            columns={[
              { key: "time", label: "close time (utc)", mono: true },
              { key: "peer", label: "peer", mono: true },
              { key: "closeType", label: "close type", mono: true },
              { key: "capacity", label: "capacity (sat)", align: "right", mono: true },
              { key: "settled", label: "settled (sat)", align: "right", mono: true },
            ]}
            rows={rows}
          />
        </>
      )}
    </div>
  );
}
