import type { InsightCard, Severity } from "@/lib/insight/types";
import { InsightCardRow } from "@/components/insight/InsightCardRow";

// =====================================================
// InsightCardList — severity-sectioned card list (INSIGHT-03, D-06)
// =====================================================
// Server Component. The engine's rankCards already ordered the array
// critical → warn → info with deterministic tie-breaks (D-06) — this list
// applies NO ranking logic of its own (T-02-07): it partitions the pre-ranked
// array into severity sections (a stable filter that preserves the engine's
// order within each section) and renders uppercase mono section heads.
// Empty sections render nothing; a fully-empty card set renders nothing —
// the PAGE owns the honest empty state (absence IS the signal).

const SECTIONS: ReadonlyArray<{ severity: Severity; head: string; tint: string }> = [
  { severity: "critical", head: "CRITICAL", tint: "text-status-critical" },
  { severity: "warn", head: "WARN", tint: "text-status-warn" },
  { severity: "info", head: "INFO", tint: "text-foreground/60" },
];

interface InsightCardListProps {
  cards: InsightCard[];
}

export function InsightCardList({ cards }: InsightCardListProps) {
  if (cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.map(({ severity, head, tint }) => {
        // Stable partition — engine order preserved within the section.
        const section = cards.filter((card) => card.severity === severity);
        if (section.length === 0) return null;

        return (
          <section
            key={severity}
            className="overflow-hidden rounded-lg border border-border bg-card"
          >
            <div className="flex items-center border-b border-border px-4 py-2.5">
              <span
                className={`font-mono text-xs font-semibold tracking-[0.14em] uppercase ${tint}`}
              >
                {head} — {section.length}
              </span>
            </div>
            {section.map((card) => (
              <InsightCardRow key={card.id} card={card} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
