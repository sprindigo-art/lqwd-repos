import type { InsightCard } from "@/lib/insight/types";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import { BackendBadge } from "@/components/scorecard/BackendBadge";

// =====================================================
// SuppressedBlock — always-visible suppressed cards (Phase 7, INBOX-01 / D-03)
// =====================================================
// SERVER component. Receives the pre-partitioned `suppressed` array (any card
// whose suppressed.active is true — suppression wins over severity) from
// `partitionTriage` (07-01). A DISTINCT, ALWAYS-VISIBLE block — NEVER inside a
// fold (D-03): the operator must never click to discover a suppressed
// emergency.
//
// Honesty (D-14 fail-loud): `card.suppressed.reason` renders VERBATIM in the
// warn tint as a React TEXT NODE only — no HTML sink, no dangerouslySetInnerHTML
// (V5 / threat T-07-09). Suppressed cards carry `suggestedAction === null`
// (guardrails) ⇒ the disabled `withheld — {type}` area renders the withheld
// action type string ONLY, NEVER params (T-04-29 / threat T-07-10). There is NO
// enqueue affordance here — structurally excluded (threat T-07-10).

interface SuppressedBlockProps {
  /** Any suppressed card — engine-ordered (partitionTriage output). */
  suppressed: InsightCard[];
}

export function SuppressedBlock({ suppressed }: SuppressedBlockProps) {
  if (suppressed.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
      <div className="sectionbar suppressed">SUPPRESSED — {suppressed.length}</div>

      {suppressed.map((card) => {
        const label = SIGNAL_LABELS[card.signal];
        // Only the withheld action type string reaches the DOM (never params).
        const withheldAction = card.evidence.detail?.withheldAction;

        return (
          <article key={card.id} className="border-b border-df-border px-4 py-3 last:border-b-0">
            {/* Identity line: signal label · node identity (no deep-link / no act). */}
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-df-mono text-xs font-semibold tracking-[0.06em] text-df-muted uppercase">
                {label}
              </span>
              {card.node !== null ? (
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold">
                    {card.node.alias ?? card.node.pubkey}
                  </span>
                  <BackendBadge backend={card.node.backend} />
                </span>
              ) : (
                <span className="font-df-mono text-xs font-semibold tracking-[0.06em] uppercase">
                  FLEET-WIDE
                </span>
              )}
            </div>

            {/* D-14 fail-loud: suppression reason VERBATIM, warn tint, text node only. */}
            {card.suppressed.reason !== null && (
              <p className="mt-1 font-df-mono text-xs font-semibold text-df-warning">
                <span className="tracking-[0.06em] uppercase">SUPPRESSED</span> —{" "}
                {card.suppressed.reason}
              </p>
            )}

            {/* Disabled withheld area — type string only, NEVER params, NO enqueue. */}
            <div className="mt-2 rounded-[3px] border border-df-border bg-df-surface-sub px-3 py-2 opacity-50">
              <span className="font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase">
                withheld — {withheldAction !== undefined ? String(withheldAction) : "action"}
              </span>
              <p className="mt-0.5 font-df-mono text-xs text-df-muted">
                params withheld while node is flagged
              </p>
            </div>
          </article>
        );
      })}
    </section>
  );
}
