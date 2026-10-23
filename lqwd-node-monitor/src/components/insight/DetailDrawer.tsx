"use client";

import { useRouter, useSearchParams } from "next/navigation";

import type { TrendPoint } from "@/lib/console/trends";
import type { CardViewModel } from "@/components/insight/InboxTriage";
import { formatSats } from "@/lib/format/units";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Sparkline } from "@/components/console/Sparkline";
import { EnqueuePreview } from "@/components/queue/EnqueuePreview";
import { CommandExport } from "@/components/export/CommandExport";
import { cn } from "@/lib/utils";

// =====================================================
// DetailDrawer — the URL-synced act-in-place drawer (Phase 7, INBOX-03)
// =====================================================
// "use client" overlay. Open state is the URL (`?card=ID`) — deep-linkable,
// back-button-closable, reload-safe (D-10; ScorecardModal URL-sync precedent).
// It hydrates the selected card's detail SOLELY from the server-passed,
// serializable `CardViewModel` map (never the server-only engine — containment
// T-07-16). The body switches on the card's action type and embeds the VERBATIM
// existing action leaves (D-12): `<EnqueuePreview>` for LND update_fee, the
// `<CommandExport>` block for close/rebalance/remediate, the pending runbook
// note otherwise. NO new action component is created here, and the signer/engine
// is NEVER imported.
//
// Design contract (sketch-005 winner E, BINDING): a fixed right Sheet that
// slides in via tw-animate-css (the vendored Sheet's `data-open:animate-in
// slide-in-from-right-*`, NOT tailwindcss-animate). The `.dh` header (title ·
// node·severity · ✕), a `<dl>` of mono tabular-nums right-aligned evidence rows,
// the `.spark` trend with an HONEST "no trend data" fallback, and the `.dact`
// action row. Navy is reserved for the act + focus only; severity does state.
// Every evidence value renders as a React TEXT NODE (V5) via the AFM-002
// formatter — no inline unit math, no HTML sink.

/** Severity tint — state color only (scorecard taxonomy, InsightCardRow precedent). */
const SEVERITY_TEXT: Record<string, string> = {
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

/** One right-aligned mono evidence row in the drawer `<dl>`. */
function EvidenceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-df-border py-1.5 last:border-b-0">
      <dt className="font-df-mono text-xs tracking-[0.06em] text-df-muted uppercase">{label}</dt>
      <dd className="text-right font-df-mono text-xs tabular-nums text-df-muted">{children}</dd>
    </div>
  );
}

interface DetailDrawerProps {
  /** Whitelist-validated `?card` id from the page (null when no drawer open). */
  activeCardId: string | null;
  /** Serializable view-model for the active card (null when none / unknown). */
  card: CardViewModel | null;
  /**
   * Daily trend series + its REAL window for the OPENED card only (server-fetched,
   * Pitfall 5). `null` ⇒ the honest "no trend data" fallback; `Sparkline` also
   * returns null for <2 points so a one-point window is never drawn as a line.
   * `windowDays` labels the trend honestly (7 for forwards, 30 for closes) — never
   * a hardcoded "14-day" caption over a different window (WR-01).
   */
  series: { points: TrendPoint[]; windowDays: number } | null;
}

export function DetailDrawer({ activeCardId, card, series }: DetailDrawerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Open state IS the URL — `?card` present ⇒ open (reload-safe). The page has
  // already whitelist-validated the id against the live card set; an unknown id
  // arrives as `card === null` and the drawer stays closed.
  const open = activeCardId !== null && card !== null;

  /** Close = strip `?card`, preserving the active facets (reload-safe replace). */
  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("card");
    const query = params.toString();
    router.replace(query.length > 0 ? `/inbox?${query}` : "/inbox", { scroll: false });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md"
        aria-describedby={undefined}
      >
        {card !== null && (
          <>
            {/* .dh header — display title + node·severity. ✕ is the Sheet's own. */}
            <SheetHeader className="gap-1 border-b border-df-border px-4 py-4">
              <SheetTitle className="font-df-mono text-sm font-semibold tracking-[0.06em] uppercase">
                {card.signalLabel}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex items-baseline gap-2 font-df-mono text-xs">
                  <span className="font-semibold text-df-ink">{card.nodeLabel}</span>
                  <span
                    className={cn(
                      "tracking-[0.14em] uppercase",
                      SEVERITY_TEXT[card.severity] ?? "text-df-muted",
                    )}
                  >
                    {card.severity}
                  </span>
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 px-4 py-4">
              {/* Evidence <dl> — metric, observed vs threshold, window, freshness. */}
              <dl className="flex flex-col">
                <EvidenceRow label="metric">{card.evidence.metric}</EvidenceRow>
                <EvidenceRow label="observed">
                  {formatValue(card.evidence.observed, card.evidence.unit)} {card.evidence.unit}
                </EvidenceRow>
                <EvidenceRow label="threshold">
                  {formatValue(card.evidence.threshold, card.evidence.unit)} {card.evidence.unit}
                </EvidenceRow>
                <EvidenceRow label="window">{card.evidence.window}</EvidenceRow>
                <EvidenceRow label="as of">{card.evidence.asOf}</EvidenceRow>
              </dl>

              {/* .spark trend — honest "no trend data" fallback (D-13). Sparkline
                  returns null for <2 points, so a one-point window also falls
                  through to the label — never a fabricated line. */}
              <div className="flex flex-col gap-1.5">
                <span className="font-df-mono text-xs tracking-[0.14em] text-df-muted uppercase">
                  {series !== null ? `${series.windowDays}-day trend` : "trend"}
                </span>
                {series !== null && series.points.length >= 2 ? (
                  <div className="spark">
                    <Sparkline points={series.points} />
                  </div>
                ) : (
                  <span className="font-df-mono text-xs text-df-muted">no trend data</span>
                )}
              </div>

              {/* .dact action row — the VERBATIM existing leaf by action type
                  (D-12). No new action component; no signer import. */}
              <div className="dact flex flex-col gap-2 border-t border-df-border pt-3">
                {card.enqueueProps !== null ? (
                  <EnqueuePreview {...card.enqueueProps} />
                ) : card.exportBlock !== null ? (
                  <CommandExport block={card.exportBlock} blockId={`drawer-export-${card.id}`} />
                ) : (
                  <p className="font-df-mono text-xs text-df-muted">
                    {card.runbookNote ?? "No automated action — investigate from the evidence above."}
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
