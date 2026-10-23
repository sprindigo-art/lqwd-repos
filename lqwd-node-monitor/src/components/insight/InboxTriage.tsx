"use client";

import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import type { EnqueuePreviewProps } from "@/components/queue/EnqueuePreview";
import type { ExportBlock } from "@/lib/export/block";
import { DetailDrawer } from "@/components/insight/DetailDrawer";
import { BatchConfirmDialog, type BatchRow } from "@/components/insight/BatchConfirmDialog";
import type { TrendPoint } from "@/lib/console/trends";
import { cn, FOCUS_RING } from "@/lib/utils";

// =====================================================
// InboxTriage — the single interaction island (Phase 7, INBOX-01/02)
// =====================================================
// "use client" island. The server (inbox/page.tsx) computes EVERYTHING — the
// partition, facet counts, the rendered spine/groups/suppressed/rail children,
// and the serializable per-card view-models. This island owns ONLY interaction
// state (Phase-5/6 repo law): the rail on/off `.syn.railoff` swap, the
// cross-node multi-select Set<cardId>, and (wired in 07-04) the URL-synced
// DetailDrawer + BatchConfirmDialog.
//
// Containment (T-05-03 / T-06-20): receives SERIALIZABLE props ONLY — never an
// InsightCard, never the server-only signer / backend resolver. The batch flow
// (07-04) sends `{pubkey, params}[]` to the `enqueueBatch` server action; the
// server signs once per row.
//
// 07-03 SCOPE: this is the minimal mount that renders the server children and
// hosts the rail-toggle + selection shell so the page compiles and the layout
// is interactive at the structural level. The DetailDrawer (reads ?card),
// BatchConfirmDialog, and multi-select wiring land in 07-04 — the prop contract
// below is the STABLE seam they build against.

/** Serializable evidence the drawer renders as its `<dl>` (raw values, AFM-002 at render). */
export interface CardEvidenceViewModel {
  metric: string;
  observed: number;
  threshold: number;
  unit: string;
  window: string;
  asOf: string;
}

/** A serializable per-card view-model the drawer (07-04) hydrates from. */
export interface CardViewModel {
  id: string;
  /** Action type for the drawer's action-leaf switch (null on info/suppressed). */
  actionType: string | null;
  /** Mono uppercase signal label for the drawer header. */
  signalLabel: string;
  /** Display alias / FLEET-WIDE for the header's node·severity line. */
  nodeLabel: string;
  /** Severity for the header tint (state color only). */
  severity: string;
  /** Structured evidence rendered as the drawer's `<dl>`. */
  evidence: CardEvidenceViewModel;
  /** Server-resolved enqueue props for update_fee on an LND node, else null. */
  enqueueProps: EnqueuePreviewProps | null;
  /** Server-built export block for close/rebalance/remediate, else null. */
  exportBlock: ExportBlock | null;
  /** Honest runbook/pending note when neither enqueue nor export applies. */
  runbookNote: string | null;
}

export interface InboxTriageProps {
  /** Whitelist-validated `?card` id from the page (null when no drawer open). */
  activeCardId: string | null;
  /** Serializable per-card view-models keyed by card id (drawer hydration). */
  cardViewModels: Record<string, CardViewModel>;
  /** Card ids that are batch-eligible (LND update_fee) — the selectable set. */
  batchEligibleIds: string[];
  /**
   * Server-resolved batch payload per eligible card id ({pubkey, params} +
   * display nodeLabel + the card's rateLimitGuidance). The selectable universe;
   * suppressed/LDK/non-fee cards are structurally absent (server-gated).
   */
  batchRows: Record<string, BatchRow>;
  /** Trend series + its REAL window for the OPENED `?card` only (server-fetched,
   *  Pitfall 5). windowDays drives the drawer's honest "{N}-day trend" label. */
  activeSeries: { points: TrendPoint[]; windowDays: number } | null;
  /** Server-rendered presentation: FacetRail (rail) + spine/groups/suppressed (main). */
  rail: React.ReactNode;
  children: React.ReactNode;
}

export function InboxTriage({
  activeCardId,
  cardViewModels,
  batchEligibleIds,
  batchRows,
  activeSeries,
  rail,
  children,
}: InboxTriageProps) {
  // Interaction state ONLY (the repo law): the rail on/off `.syn.railoff` swap,
  // the cross-node multi-select Set, and which rows the confirm dialog targets.
  const [railOff, setRailOff] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialogIds, setDialogIds] = useState<string[] | null>(null);

  const eligible = useMemo(() => new Set(batchEligibleIds), [batchEligibleIds]);

  // WR-02: selection lives in this Set, but the checkbox visual is written onto
  // the SERVER-rendered rows; a facet <Link> click is a soft-nav that re-renders
  // fresh (unchecked) rows while the Set persists — the "N selected" count would
  // then lie and silently drop filtered-out cards at confirm. Reset the selection
  // (and any open dialog) whenever the FACET portion of the URL changes (?card is
  // excluded so opening/closing the drawer never clears a selection). Done via
  // React's adjust-state-during-render pattern (not an effect — no extra commit).
  const searchParams = useSearchParams();
  const facetKey = (() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("card");
    return p.toString();
  })();
  const [prevFacetKey, setPrevFacetKey] = useState(facetKey);
  if (facetKey !== prevFacetKey) {
    setPrevFacetKey(facetKey);
    setSelected(new Set());
    setDialogIds(null);
  }

  /** The active card's view-model (null when no drawer / unknown id). */
  const activeCard = activeCardId !== null ? (cardViewModels[activeCardId] ?? null) : null;

  /** Resolve a set of ids to their server-built BatchRows (skipping unknowns). */
  const rowsFor = useCallback(
    (ids: readonly string[]): BatchRow[] =>
      ids.map((id) => batchRows[id]).filter((row): row is BatchRow => row !== undefined),
    [batchRows],
  );

  /**
   * Delegated interaction on the server-rendered children: a checkbox slot
   * (`data-select-card`) toggles multi-select; a per-node ENQUEUE ALL slot
   * (`data-enqueue-card-ids`) opens the confirm dialog scoped to that node's
   * eligible ids. The server owns the structure; the island owns the state.
   */
  const handleChildClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;

      const enqueueSlot = target.closest<HTMLElement>("[data-enqueue-card-ids]");
      if (enqueueSlot !== null) {
        event.preventDefault();
        const ids = (enqueueSlot.dataset.enqueueCardIds ?? "")
          .split(",")
          .filter((id) => id.length > 0 && eligible.has(id));
        if (ids.length > 0) setDialogIds(ids);
        return;
      }

      const selectSlot = target.closest<HTMLElement>("[data-select-card]");
      if (selectSlot !== null) {
        event.preventDefault();
        const id = selectSlot.dataset.selectCard;
        if (id === undefined || !eligible.has(id)) return;
        setSelected((prev) => {
          const next = new Set(prev);
          const checked = !next.has(id);
          if (checked) next.add(id);
          else next.delete(id);
          // Reflect the toggle on the server-rendered slot (data-state + a11y).
          selectSlot.setAttribute("data-state", checked ? "checked" : "unchecked");
          selectSlot.setAttribute("aria-checked", checked ? "true" : "false");
          return next;
        });
      }
    },
    [eligible],
  );

  const selectedRows = rowsFor(Array.from(selected));
  const dialogRows = dialogIds !== null ? rowsFor(dialogIds) : selectedRows;

  return (
    <div className={`syn${railOff ? " railoff" : ""}`}>
      {/* Rail (grid col 1) — FacetRail's <nav class="railpane"> IS the grid
          item. .syn.railoff collapses it to 0-width + visibility:hidden. */}
      {rail}

      <div className="flex flex-col gap-4">
        {/* Rail toggle lives in the MAIN column, NOT inside .railpane: the rail
            collapses to 0-width + visibility:hidden, so a toggle placed inside it
            vanished together with the rail and left no way to bring it back
            (operator gap, 2026-06-16). Here it stays visible to re-open. */}
        <button
          type="button"
          onClick={() => setRailOff((v) => !v)}
          aria-pressed={!railOff}
          className={cn(
            "self-start rounded-[3px] border border-df-border px-2 py-1 font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase transition-colors hover:text-df-brand",
            FOCUS_RING,
          )}
        >
          {railOff ? "▸ show filters" : "◧ hide filters"}
        </button>

        {/* Cross-node multi-select action bar — visible only with a selection. */}
        {selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-[3px] border border-df-brand/40 bg-df-brand/5 px-3 py-2">
            <span className="font-df-mono text-xs font-semibold tracking-[0.06em] text-df-muted uppercase">
              {selected.size.toLocaleString("en-US")} selected
            </span>
            <button
              type="button"
              onClick={() => setDialogIds(Array.from(selected))}
              className={cn(
                "ms-auto rounded-[3px] font-df-mono text-xs font-semibold tracking-[0.14em] text-df-brand uppercase hover:underline",
                FOCUS_RING,
              )}
            >
              enqueue selected ▸
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className={cn(
                "rounded-[3px] font-df-mono text-xs tracking-[0.14em] text-df-muted uppercase hover:text-df-ink",
                FOCUS_RING,
              )}
            >
              clear
            </button>
          </div>
        )}

        {/* Server-rendered spine/groups/suppressed. Selection + ENQUEUE ALL are
            delegated off the server-marked data-* slots (the structure is the
            server's; the state is the island's). */}
        <div className="flex flex-col gap-6" onClick={handleChildClick}>
          {children}
        </div>
      </div>

      {/* URL-synced act-in-place drawer — opens off `?card` (D-10). */}
      <DetailDrawer activeCardId={activeCardId} card={activeCard} series={activeSeries} />

      {/* Aggregate-scope confirm → enqueueBatch → verbatim per-row tally. */}
      <BatchConfirmDialog
        open={dialogIds !== null}
        onOpenChange={(open) => {
          if (!open) setDialogIds(null);
        }}
        rows={dialogRows}
      />
    </div>
  );
}
