import Link from "next/link";

import type { DetectorId, InsightCard } from "@/lib/insight/types";
import type { InfoGroups as InfoGroupsMap } from "@/lib/insight/triage";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import { serializeFacets, type FacetState } from "@/lib/insight/triage-facets";
import type { EnqueueAffordance } from "@/lib/queue/enqueue-props";
import { formatSats } from "@/lib/format/units";
import { BackendBadge } from "@/components/scorecard/BackendBadge";
import { cn, FOCUS_RING } from "@/lib/utils";

// =====================================================
// InfoGroups — collapsed info (fee) bulk, two-level native <details> (Phase 7, INBOX-01)
// =====================================================
// SERVER component. Receives the pre-partitioned `groups` map (signal → node →
// cards) from `partitionTriage` (07-01) — only `info`-severity, non-suppressed
// cards reach here (Pitfall 6). Renders a two-level NATIVE <details> nest
// (D-02 — zero-JS, reload-stable, accessible), ALL COLLAPSED on load:
//   per-signal  (Fee raise · 303 ▸)
//     └ per-node (Canada · 118 ▸)
//          └ rows (each a ?card drawer trigger + a checkbox slot + an
//            ENQUEUE ALL slot on the node header)
// Counts are mono tabular-nums, right-aligned.
//
// Server renders STRUCTURE only; the interactive ENQUEUE ALL trigger and the
// cross-node multi-select Set live in the 07-04 InboxTriage client island.
// This component exposes the serializable hooks the island binds to:
//   - data-enqueue-card / data-enqueue-node on selectable rows
//   - the per-node ENQUEUE ALL slot rendered only when a node group has ≥1
//     LND-backed update_fee card (server-resolved via the passed affordance map)
// suppressed / LDK / non-fee cards carry no enqueue slot (affordance "none"/"ldk").

/**
 * Build the drawer-open href: active facets (preserved) + `?card={id}`.
 * (Opening a card keeps facets; only FacetRail navigation strips `?card`.)
 */
function cardHref(cardId: string, facets: FacetState): string {
  const params = new URLSearchParams(serializeFacets(facets));
  params.set("card", cardId);
  return `/inbox?${params.toString()}`;
}

/** Short channel identity for a fee row — chanId, else the channel point tail. */
function channelLabel(card: InsightCard): string {
  const action = card.suggestedAction;
  if (action !== null && action.type === "update_fee") {
    return action.params.chanId || action.params.channelPoint;
  }
  return card.evidence.metric;
}

interface InfoGroupsProps {
  /** info, non-suppressed — signal → (pubkey|"fleet") → cards (partitionTriage). */
  groups: InfoGroupsMap;
  /** Active facet selection — preserved on each row's drawer-open href. */
  facets: FacetState;
  /**
   * Server-resolved enqueue affordance per card id (resolveEnqueueAffordance,
   * server-only backend gate). The island reads these to decide which rows are
   * selectable and which node headers render an ENQUEUE ALL trigger.
   */
  enqueueById: Map<string, EnqueueAffordance>;
}

export function InfoGroups({ groups, facets, enqueueById }: InfoGroupsProps) {
  if (groups.size === 0) return null;

  const signals = Array.from(groups.keys());

  return (
    <section className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
      <div className="sectionbar info">INFO — routine bulk</div>

      {signals.map((signal) => {
        const byNode = groups.get(signal);
        if (byNode === undefined) return null;
        const signalLabel = SIGNAL_LABELS[signal as DetectorId];
        const signalCount = Array.from(byNode.values()).reduce((n, list) => n + list.length, 0);
        const nodeKeys = Array.from(byNode.keys());

        return (
          // Level 1: per-signal fold — collapsed on load (no `open` attr).
          <details key={signal} className="fold border-b border-df-border last:border-b-0">
            <summary className="flex items-center gap-3 px-4 py-2.5 font-df-mono text-xs font-semibold tracking-[0.06em] uppercase hover:bg-df-surface-sub">
              <span className="tw text-df-muted">▸</span>
              <span className="text-df-ink">{signalLabel}</span>
              <span className="ms-auto tabular-nums text-df-muted">{signalCount}</span>
            </summary>

            {nodeKeys.map((nodeKey) => {
              const cards = byNode.get(nodeKey) ?? [];
              if (cards.length === 0) return null;
              const first = cards[0];
              const nodeLabel = nodeKey === "fleet" ? "FLEET-WIDE" : (first.node?.alias ?? nodeKey);
              const backend = first.node?.backend ?? null;
              // Node header carries the ENQUEUE ALL slot only when ≥1 card here
              // is an LND-backed update_fee (server-resolved). The actual trigger
              // is the 07-04 island; here we render the slot + data hooks.
              const enqueueableIds = cards
                .filter((c) => enqueueById.get(c.id)?.kind === "lnd")
                .map((c) => c.id);

              return (
                // Level 2: per-node fold — also collapsed on load.
                <details key={nodeKey} className="fold border-t border-df-border bg-df-surface-sub">
                  <summary className="flex items-center gap-3 py-2 ps-9 pe-4 font-df-mono text-xs hover:bg-df-surface-sub">
                    <span className="tw text-df-muted">▸</span>
                    <span className="flex items-baseline gap-2">
                      <span className="font-semibold">{nodeLabel}</span>
                      {backend !== null && <BackendBadge backend={backend} />}
                    </span>
                    <span className="ms-auto flex items-center gap-3">
                      {/* ENQUEUE ALL — a REAL focusable button (audit F): the
                          island's delegated onClick fires on mouse AND on
                          Enter/Space via the button's native activation, so the
                          batch is keyboard/AT-reachable. The button lives inside
                          the <summary>; the island calls preventDefault so the
                          click never toggles the fold. */}
                      {enqueueableIds.length > 0 && (
                        <button
                          type="button"
                          data-enqueue-node={nodeKey}
                          data-enqueue-card-ids={enqueueableIds.join(",")}
                          className={cn(
                            "rounded-[3px] font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase hover:text-df-brand",
                            FOCUS_RING
                          )}
                        >
                          enqueue all ▸
                        </button>
                      )}
                      <span className="tabular-nums text-df-muted">{cards.length}</span>
                    </span>
                  </summary>

                  {cards.map((card) => {
                    const affordance = enqueueById.get(card.id);
                    const selectable = affordance?.kind === "lnd";
                    return (
                      <div
                        key={card.id}
                        className="flex items-center gap-3 border-t border-df-border-soft py-2 ps-12 pe-4"
                      >
                        {/* Selection control — a REAL checkbox button on
                            selectable (LND update_fee) rows (audit F): the
                            island toggles the multi-select Set off its delegated
                            onClick, which fires on mouse AND Enter/Space, and
                            writes back data-state + aria-checked. Non-selectable
                            rows keep an inert decorative box. */}
                        {selectable ? (
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked="false"
                            aria-label="Select for batch enqueue"
                            data-select-card={card.id}
                            data-select-node={nodeKey}
                            data-state="unchecked"
                            className={cn(
                              "inline-block h-3.5 w-3.5 shrink-0 rounded-[3px] border border-df-border data-[state=checked]:border-df-brand data-[state=checked]:bg-df-brand",
                              FOCUS_RING
                            )}
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="inline-block h-3.5 w-3.5 shrink-0 rounded-[3px] border border-df-border opacity-40"
                          />
                        )}
                        <Link
                          href={cardHref(card.id, facets)}
                          scroll={false}
                          className="flex flex-1 items-baseline gap-3 font-df-mono text-xs text-df-muted hover:text-df-ink"
                        >
                          <span className="truncate">{channelLabel(card)}</span>
                          <span className="ms-auto tabular-nums text-df-muted">
                            {card.evidence.metric}{" "}
                            {card.evidence.unit === "sats"
                              ? formatSats(card.evidence.observed)
                              : card.evidence.observed.toLocaleString("en-US")}{" "}
                            {card.evidence.unit}
                          </span>
                          <span className="text-df-brand">open →</span>
                        </Link>
                      </div>
                    );
                  })}
                </details>
              );
            })}
          </details>
        );
      })}
    </section>
  );
}
