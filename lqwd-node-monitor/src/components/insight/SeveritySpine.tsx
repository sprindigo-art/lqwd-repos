import Link from "next/link";

import type { InsightCard } from "@/lib/insight/types";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import { serializeFacets, type FacetState } from "@/lib/insight/triage-facets";
import { formatSats } from "@/lib/format/units";
import { BackendBadge } from "@/components/scorecard/BackendBadge";
import { cn } from "@/lib/utils";

// =====================================================
// SeveritySpine — the critical+warn triage rows (Phase 7, INBOX-01)
// =====================================================
// SERVER component. Receives the pre-partitioned `spine` array (critical + warn,
// non-suppressed) from `partitionTriage` (07-01) — applies NO ranking and NO
// severity computation (engine order is law). Each row reuses InsightCardRow's
// identity/evidence grammar VERBATIM and is ALSO the drawer trigger: it is a
// <Link> that sets `?card={card.id}` while preserving the active facet params
// (via `serializeFacets`), so the 07-04 client DetailDrawer opens off `?card`.
//
// Design contract (sketch-005 winner E, BINDING): severity color is STATE-only
// — a `.sectionbar` 3px left border + label tint, no dots/emoji/icons. Navy is
// STRUCTURE/ACT-only (the deep-link). IBM Plex Mono carries data. A CRITICAL is
// NEVER folded (Pitfall 6 / D-04); only a `warn` overflow tail may collapse into
// a native <details>.

/** Severity tint per the scorecard taxonomy (InsightCardRow precedent) — state color only. */
const SEVERITY_TEXT: Record<InsightCard["severity"], string> = {
  critical: "text-df-critical",
  warn: "text-df-warning",
  info: "text-df-muted",
};

/** Display formatting only — sat values route through AFM-002; no unit math here. */
function formatValue(value: number, unit: string): string {
  if (unit === "sats") return formatSats(value);
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toFixed(2);
}

/**
 * Build the drawer-open href for a row: the active facets (preserved) PLUS
 * `?card={id}`. Facet params are carried so opening a card never drops the
 * current filter; `?card` is appended last. (Facet *navigation* strips `?card`
 * — that is the FacetRail's job; here we are opening a card, so we keep facets.)
 */
function cardHref(cardId: string, facets: FacetState): string {
  const facetQuery = serializeFacets(facets);
  const params = new URLSearchParams(facetQuery);
  params.set("card", cardId);
  return `/inbox?${params.toString()}`;
}

/** After how many warn rows the overflow tail folds into a native <details>. */
const WARN_VISIBLE_CAP = 8;

interface SpineRowProps {
  card: InsightCard;
  facets: FacetState;
  activeCardId: string | null;
}

/** One spine row — InsightCardRow's identity+evidence grammar, as a drawer trigger. */
function SpineRow({ card, facets, activeCardId }: SpineRowProps) {
  const label = SIGNAL_LABELS[card.signal];
  const isActive = activeCardId === card.id;

  return (
    <Link
      href={cardHref(card.id, facets)}
      scroll={false}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "block border-b border-df-border px-4 py-3 transition-colors last:border-b-0 hover:bg-df-surface-sub",
        isActive && "bg-df-surface-sub",
      )}
    >
      {/* Identity line: signal label · node identity · "open →" affordance. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className={cn(
            "font-df-mono text-xs font-semibold tracking-[0.06em] uppercase",
            SEVERITY_TEXT[card.severity],
          )}
        >
          {label}
        </span>

        {card.node !== null ? (
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{card.node.alias ?? card.node.pubkey}</span>
            <BackendBadge backend={card.node.backend} />
          </span>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="font-df-mono text-xs font-semibold tracking-[0.06em] uppercase">
              FLEET-WIDE
            </span>
            {card.target.kind === "fleet" && (
              <span className="font-df-mono text-xs tabular-nums text-df-muted">
                {card.target.pubkeys.length} node{card.target.pubkeys.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
        )}

        <span className="ms-auto font-df-mono text-xs whitespace-nowrap text-df-brand">
          open →
        </span>
      </div>

      {/* Evidence line — raw card values, AFM-002 at render only. */}
      <p className="mt-1 font-df-mono text-xs text-df-muted">
        {card.evidence.metric} {formatValue(card.evidence.observed, card.evidence.unit)}{" "}
        {card.evidence.unit} · threshold {formatValue(card.evidence.threshold, card.evidence.unit)}{" "}
        · {card.evidence.window}
      </p>
    </Link>
  );
}

interface SeveritySpineProps {
  /** critical + warn, non-suppressed — engine-ordered (partitionTriage output). */
  spine: InsightCard[];
  /** Active facet selection — preserved on each row's drawer-open href. */
  facets: FacetState;
  /** The currently-open `?card` id (whitelist-validated by the page), or null. */
  activeCardId: string | null;
}

export function SeveritySpine({ spine, facets, activeCardId }: SeveritySpineProps) {
  // Stable severity partition — engine order preserved within each section.
  const critical = spine.filter((card) => card.severity === "critical");
  const warn = spine.filter((card) => card.severity === "warn");

  // A critical is NEVER folded (Pitfall 6). A warn overflow tail MAY fold.
  const warnHead = warn.slice(0, WARN_VISIBLE_CAP);
  const warnTail = warn.slice(WARN_VISIBLE_CAP);

  if (spine.length === 0) {
    return (
      <section className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
        <div className="sectionbar info">no critical or warn signals</div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {critical.length > 0 && (
        <section className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
          <div className="sectionbar crit">CRITICAL — {critical.length}</div>
          {critical.map((card) => (
            <SpineRow key={card.id} card={card} facets={facets} activeCardId={activeCardId} />
          ))}
        </section>
      )}

      {warn.length > 0 && (
        <section className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
          <div className="sectionbar warn">WARN — {warn.length}</div>
          {warnHead.map((card) => (
            <SpineRow key={card.id} card={card} facets={facets} activeCardId={activeCardId} />
          ))}
          {warnTail.length > 0 && (
            <details className="fold">
              <summary className="flex items-center gap-3 border-b border-df-border px-4 py-2.5 font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase last:border-b-0">
                <span className="tw">▸</span>
                <span>{warnTail.length} more warn</span>
              </summary>
              {warnTail.map((card) => (
                <SpineRow key={card.id} card={card} facets={facets} activeCardId={activeCardId} />
              ))}
            </details>
          )}
        </section>
      )}
    </div>
  );
}
