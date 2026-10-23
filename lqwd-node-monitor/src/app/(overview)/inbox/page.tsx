import { loadInsightView, type InsightView } from "@/lib/insight/engine";
import { facetCounts, partitionTriage } from "@/lib/insight/triage";
import { applyFacets, seriesKindFor } from "@/lib/insight/triage";
import { parseFacets } from "@/lib/insight/triage-facets";
import { resolveEnqueueAffordance, type EnqueueAffordance } from "@/lib/queue/enqueue-props";
import { buildExportBlock } from "@/lib/export/commands";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import { forwardsDailySeries, closesDailySeries, type TrendPoint } from "@/lib/console/trends";
import type { InsightCard } from "@/lib/insight/types";
import { NarrateButton } from "@/components/insight/NarrateButton";
import { FacetRail } from "@/components/insight/FacetRail";
import { SeveritySpine } from "@/components/insight/SeveritySpine";
import { InfoGroups } from "@/components/insight/InfoGroups";
import { SuppressedBlock } from "@/components/insight/SuppressedBlock";
import { InboxTriage, type CardViewModel } from "@/components/insight/InboxTriage";
import type { BatchRow } from "@/components/insight/BatchConfirmDialog";
import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { BoardEmpty } from "@/components/df/BoardEmpty";

// Live warehouse read at request time (Server Component) — never prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Root layout template renders this as "Inbox | NodeMonitor".
export const metadata = { title: "Inbox" };

// Shared operator nav — every surface reachable from every screen.
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

// =====================================================
// INBOX-01 / INBOX-02 — the triage spine at /inbox (Phase 7, sketch-005 winner E)
// =====================================================
// THE single fleet-wide recommendation surface (D-05). One loadInsightView()
// call is the entire data path (D-08: one engine, two views) — the page applies
// NO ranking and NO severity computation (D-06, T-02-07); it only PARTITIONS the
// pre-ranked cards into the severity spine + collapsed info groups + suppressed
// block (triage.ts, 07-01), computes facet counts over the UNFILTERED set,
// applies the URL-param facets to narrow the visible set, and renders the four
// server presentation components + the FacetRail under the one InboxTriage
// client island (drawer / multi-select / batch confirm land in 07-04).
//
// Facet model (D-09): the URL is the single source of truth. parseFacets reads
// ?sev/?node/?signal/?action (whitelisted, invalid dropped — 07-01); facet
// navigation strips ?card by construction (FacetRail, OQ-1 settled), so a facet
// change arrives with no ?card and the drawer is closed. ?card is whitelist-
// validated against the live card-id set before it is handed to the island
// (T-07-08); an unknown ?card degrades to "no drawer", never an error.
//
// Honesty rules: SUPPRESSED cards stay visible with the reason verbatim (D-14,
// SuppressedBlock); the empty state names the timestamp — absence IS the signal;
// the AP-12 placeholder is page copy, NOT a card (D-12).

/** "fleet clear at {timestamp}" formatting — dates only, no sat math here. */
const clearStampFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

/** Next passes searchParams as a Promise of a plain string|string[] record. */
type RawSearchParams = Record<string, string | string[] | undefined>;

interface InboxPageProps {
  searchParams: Promise<RawSearchParams>;
}

/** Build a URLSearchParams from the Next searchParams record (repeated keys preserved). */
function toUrlSearchParams(raw: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.append(key, value);
    }
  }
  return params;
}

/** Display label for the drawer header's node·severity line. */
function nodeLabelFor(card: InsightCard): string {
  if (card.node === null) return "FLEET-WIDE";
  return card.node.alias ?? card.node.pubkey;
}

/**
 * Honest runbook note when neither enqueue (LND fee) nor an export block
 * applies — the operator gets a verbatim "investigate" / unsupported line, never
 * a fabricated action.
 */
function runbookNoteFor(card: InsightCard, affordance: EnqueueAffordance): string | null {
  if (affordance.kind === "ldk") {
    return "LDK fee enqueue not yet supported — deferred to a later phase.";
  }
  if (card.suggestedAction === null) {
    return "No automated action — investigate from the evidence above.";
  }
  if (card.suggestedAction.type === "investigate") {
    return "Investigate from the evidence above — no automated remediation for this signal.";
  }
  return null;
}

/**
 * The full serializable drawer/groups view-model for a card. Carries the
 * evidence (raw values; AFM-002 at render), the LND enqueue props (else null),
 * the close/rebalance/remediate export block (else null), and an honest runbook
 * note — so the client drawer never imports the server-only engine/signer.
 */
function viewModelFor(card: InsightCard, affordance: EnqueueAffordance): CardViewModel {
  const exportBlock = card.suggestedAction !== null ? buildExportBlock(card) : null;
  return {
    id: card.id,
    actionType: card.suggestedAction?.type ?? null,
    signalLabel: SIGNAL_LABELS[card.signal],
    nodeLabel: nodeLabelFor(card),
    severity: card.severity,
    evidence: {
      metric: card.evidence.metric,
      observed: card.evidence.observed,
      threshold: card.evidence.threshold,
      unit: card.evidence.unit,
      window: card.evidence.window,
      asOf: card.evidence.asOf,
    },
    enqueueProps: affordance.kind === "lnd" ? affordance.props : null,
    exportBlock,
    runbookNote: runbookNoteFor(card, affordance),
  };
}

/** The batch payload row for an LND update_fee card (engine values verbatim). */
function batchRowFor(card: InsightCard): BatchRow | null {
  const action = card.suggestedAction;
  if (action === null || action.type !== "update_fee" || card.node === null) return null;
  return {
    pubkey: card.node.pubkey,
    params: action.params,
    nodeLabel: nodeLabelFor(card),
    rateLimitGuidance: card.rateLimitGuidance,
  };
}

/** The opened card's trend series plus the ACTUAL window it spans (drives the
 *  drawer's honest "{N}-day trend" label — never a fixed/wrong window, WR-01). */
export interface ActiveSeries {
  points: TrendPoint[];
  windowDays: number;
}

/**
 * Fetch the daily trend series for the OPENED card ONLY (Pitfall 5 — never fan
 * across all cards). `seriesKindFor` (07-01) maps the card's signal to one of
 * the sanctioned series; reads are guarded `.catch(() => null)` so a warehouse
 * hiccup degrades to the honest "no trend data" fallback. The fee/revenue kind
 * remaps `feesSat` into the polyline `n` channel (console page precedent) —
 * shape-over-time only, no unit math (the /1000.0 is in SQL). The returned
 * `windowDays` is the REAL span (closes → 30, forwards → 7) so the drawer labels
 * the trend honestly instead of a hardcoded "14-day".
 */
async function seriesForActiveCard(card: InsightCard | undefined): Promise<ActiveSeries | null> {
  if (card === undefined || card.node === null) return null;
  const kind = seriesKindFor(card);
  if (kind === null) return null;
  const pubkey = card.node.pubkey;
  if (kind === "closes") {
    const closes = await closesDailySeries(pubkey, 30).catch(() => null);
    return closes === null ? null : { points: closes, windowDays: 30 };
  }
  const forwards = await forwardsDailySeries(pubkey, "7d").catch(() => null);
  if (forwards === null) return null;
  const points =
    kind === "forwards-fees"
      ? forwards.map((point) => ({ day: point.day, n: point.feesSat ?? 0 }))
      : forwards; // forwards-count → n is already the count
  return { points, windowDays: 7 };
}

export default async function InboxPage({ searchParams }: InboxPageProps) {
  let view: InsightView;
  try {
    view = await loadInsightView();
  } catch (error) {
    console.error("Inbox load failed:", error);
    return (
      <BoardError
        active="inbox"
        opsNav={OPS_NAV}
        title="Inbox"
        heading="Couldn't load the Inbox."
        body="The warehouse didn't respond. Your data is unchanged — this view is read-only. Check the connection and reload."
      />
    );
  }

  const isEmpty = view.cards.length === 0;

  // ── Facet parse + partition + counts (all over the request-time card set) ──
  const rawParams = toUrlSearchParams(await searchParams);
  const facets = parseFacets(rawParams);

  // Counts are computed over the UNFILTERED set (Pitfall 2 / T-07-11) so the
  // rail always shows fleet-wide totals, independent of the active facets.
  const counts = facetCounts(view.cards);

  // The rendered set is the facet-narrowed cards, re-partitioned for display.
  const visible = applyFacets(view.cards, facets);
  const { spine, groups, suppressed } = partitionTriage(visible);

  // Server-only enqueue gate, resolved once per card → the island's serializable
  // view-models + the InfoGroups ENQUEUE ALL / checkbox affordance map.
  const enqueueById = new Map<string, EnqueueAffordance>();
  const cardViewModels: Record<string, CardViewModel> = {};
  const batchRows: Record<string, BatchRow> = {};
  const batchEligibleIds: string[] = [];
  const cardById = new Map<string, InsightCard>();
  for (const card of view.cards) {
    cardById.set(card.id, card);
    const affordance = resolveEnqueueAffordance(card);
    enqueueById.set(card.id, affordance);
    cardViewModels[card.id] = viewModelFor(card, affordance);
    if (affordance.kind === "lnd") {
      const row = batchRowFor(card);
      if (row !== null) {
        batchRows[card.id] = row;
        batchEligibleIds.push(card.id);
      }
    }
  }

  // ?card is whitelist-validated against the live card-id set (T-07-08):
  // unknown / tampered ids degrade to "no drawer", never an error page.
  const rawCard = rawParams.get("card");
  const activeCardId = rawCard !== null && cardViewModels[rawCard] !== undefined ? rawCard : null;

  // Trend series — fetched for the OPENED card ONLY (Pitfall 5), never a fan-out.
  const activeSeries =
    activeCardId !== null ? await seriesForActiveCard(cardById.get(activeCardId)) : null;

  return (
    <NavRailShell
      active="inbox"
      title="Inbox"
      opsNav={OPS_NAV}
      showViewToggle={false}
      showFleetSummary={false}
      // Freshness standardized to the top-bar PollAge (audit F) — same as
      // nodes/hosts — instead of an in-page FreshnessStamp.
      pollSinceMs={view.fetchedAt.getTime()}
    >
      <div className="flex flex-col gap-6">

      {/* Header grammar mirrors /pending: display-role title left. Freshness now
          lives in the shared top-bar PollAge (audit F), not an in-page stamp. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-df-ink">
            Triage inbox
          </h1>
          <p className="text-sm text-df-muted">
            fleet-wide recommendations · severity-ranked by the insight engine · read-only until
            you act
          </p>
        </div>
        {view.llmEnabled && <NarrateButton scope={{ level: "fleet" }} />}
      </header>

      {isEmpty ? (
        // Honest empty state — absence IS the signal (sketch rule).
        <BoardEmpty
          heading="No active recommendations"
          body="Every node is inside its thresholds right now — nothing needs a decision."
          footnote={`fleet clear at ${clearStampFormat.format(view.fetchedAt)} UTC`}
        />
      ) : (
        // The interaction island hosts the rail (left) + spine/groups/suppressed
        // (right). Server computes; the island owns only interaction state. The
        // drawer/multi-select/batch confirm mount here in 07-04.
        <InboxTriage
          activeCardId={activeCardId}
          cardViewModels={cardViewModels}
          batchEligibleIds={batchEligibleIds}
          batchRows={batchRows}
          activeSeries={activeSeries}
          rail={<FacetRail counts={counts} facets={facets} />}
        >
          <SeveritySpine spine={spine} facets={facets} activeCardId={activeCardId} />
          <InfoGroups groups={groups} facets={facets} enqueueById={enqueueById} />
          <SuppressedBlock suppressed={suppressed} />
        </InboxTriage>
      )}

      {/* D-12: when the LLM is off, AP-12a/b honesty copy is PAGE COPY in a
          static info section — never a card. */}
      {view.ap12Placeholder !== null && (
        <section className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
          <div className="border-b border-df-border px-4 py-2.5">
            <span className="font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase">
              AP-12A/B
            </span>
          </div>
          <p className="px-4 py-3 font-df-mono text-xs text-df-muted">{view.ap12Placeholder}</p>
        </section>
      )}
      </div>
    </NavRailShell>
  );
}
