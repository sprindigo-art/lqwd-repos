import { DEFAULT_WINDOW, EXPORTABLE_TABS, WINDOW_PRESETS, type WindowKey } from "@/lib/console/config";
import { assembleCsv } from "@/lib/csv/export";
import { buildExportFilename } from "@/lib/csv/serialize";
import { latestNodeInfo } from "@/lib/read/node-info";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { buildForwardsFullSql, type ForwardRow } from "@/lib/console/forwards";
import { buildClosesFullSql, type ClosedChannelRow } from "@/lib/console/closes";
import { channelsTabData } from "@/lib/console/channels";
import { feesTabData } from "@/lib/console/fees";

// =====================================================
// NODE-02 — shared CSV export handler
// =====================================================
// Extracted verbatim from `[pubkey]/[tab]/export/route.ts` so the redesign's
// static `channels/` and `forwards/` sub-route folders can each keep the
// `/{pubkey}/{tab}/export` path reachable (Pitfall 5): once those become static
// folders the dynamic `[tab]/export` route no longer resolves for them, so both
// delegate here. The externally observable behavior of
// `/{pubkey}/{tab}/export?window=` is byte-identical to the pre-extraction route.
//
// Server-side because the client only ever holds the capped 500 rows — the
// export re-queries the FULL selected window (D-09) through the 03-04 no-LIMIT
// builders. Validation gauntlet runs BEFORE any query (ASVS V5 / T-03-14 /
// T-13-11-02); every failure is an identical 404. All assembly logic lives in
// tested modules (export.ts, serialize.ts) — this handler is glue only.

const PUBKEY_RE = /^[0-9a-f]{66}$/;

const notFound = () => new Response("Not found", { status: 404 });

/** Full-window rows + per-table freshness (max ts of the result set, D-10 data-as-of). */
async function loadRows(
  tab: string,
  pubkey: string,
  days: number,
): Promise<{ rows: unknown[]; dataAsOf: Date | null }> {
  // Latest-state tables: reuse the tab shapers (window validated but ignored).
  if (tab === "channels") {
    const view = await channelsTabData(pubkey);
    return { rows: view.rows, dataAsOf: view.asOf };
  }
  if (tab === "fees") {
    const view = await feesTabData(pubkey);
    return { rows: view.rows, dataAsOf: view.asOf };
  }
  // Event tables: FULL window via the no-LIMIT builders (D-09). Rows arrive
  // newest-first, so row 0 carries the window's max timestamp.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  if (tab === "forwards") {
    const result = await dbRouting.execute(buildForwardsFullSql(pubkey, days));
    const rows = result as unknown as ForwardRow[];
    const maxNs = rows[0]?.timestamp_ns;
    return { rows, dataAsOf: maxNs == null ? null : new Date(Number(maxNs) / 1e6) };
  }
  if (tab === "closes") {
    const result = await dbRouting.execute(buildClosesFullSql(pubkey, days));
    const rows = result as unknown as ClosedChannelRow[];
    return { rows, dataAsOf: parseDbTimestampUtc(rows[0]?.timestamp ?? null) };
  }
  // Exhaustive dispatch — fail LOUD, never fall through to another table's
  // query (WR-05): a new EXPORTABLE_TABS entry without a branch here would
  // otherwise silently export mislabeled closes rows; in an audit-grade
  // export path mislabeling is worse than erroring.
  throw new Error(`loadRows: unhandled exportable tab "${tab}"`);
}

/**
 * Shared CSV export handler for `/{pubkey}/{tab}/export?window={key}`. Runs the
 * full validation gauntlet (PUBKEY_RE → 404, EXPORTABLE_TABS membership → 404,
 * WINDOW_PRESETS key → 404) BEFORE any query, then dispatches loadRows and
 * assembles the CSV response. Callable from the legacy dynamic route and from
 * the redesign's static sub-route export segments.
 */
export async function handleCsvExport(
  req: Request,
  params: { pubkey: string; tab: string },
): Promise<Response> {
  const { pubkey, tab } = params;
  // Validation gauntlet — ALL gates before ANY query (T-03-14).
  if (!PUBKEY_RE.test(pubkey)) return notFound();
  if (!(EXPORTABLE_TABS as readonly string[]).includes(tab)) return notFound();
  // Latest-state tabs (channels/fees) ignore the window entirely, and their
  // pages emit `?window=latest` — accept that literal for THEM only (CR-02);
  // event tabs still require a WINDOW_PRESETS key. Gate stays before any query.
  const isLatestStateTab = tab === "channels" || tab === "fees";
  const windowParam = new URL(req.url).searchParams.get("window") ?? DEFAULT_WINDOW;
  const isPresetKey = Object.prototype.hasOwnProperty.call(WINDOW_PRESETS, windowParam);
  if (!isPresetKey && !(isLatestStateTab && windowParam === "latest")) return notFound();
  // `latest` maps to the default preset key — loadRows ignores it for
  // latest-state tabs; only the validated preset integer ever reaches SQL.
  const windowKey = (isPresetKey ? windowParam : DEFAULT_WINDOW) as WindowKey;

  const node = await latestNodeInfo(pubkey);
  if (!node) return notFound();
  const alias = node.alias ?? pubkey.slice(0, 12);

  // Latest-state tables ignore the window entirely — provenance and filename
  // say "latest" so the audit metadata never claims a window that had no
  // effect on the data (IN-05/D-10). Event tables keep the validated key.
  const windowLabel = isLatestStateTab ? "latest" : windowKey;

  const { rows, dataAsOf } = await loadRows(tab, pubkey, WINDOW_PRESETS[windowKey]);
  const exportedAt = new Date();
  const csv = assembleCsv({ table: tab, window: windowLabel, alias, pubkey, exportedAt, dataAsOf, rows });
  if (csv === null) return notFound();

  // T-03-16: the alias reaches Content-Disposition ONLY through
  // buildExportFilename → sanitizeFilenamePart ([A-Za-z0-9_-] whitelist).
  const filename = buildExportFilename(alias, tab, windowLabel, exportedAt);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
