import Link from "next/link";

import type { InsightCard } from "@/lib/insight/types";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import { buildExportBlock } from "@/lib/export/commands";
import { formatSats } from "@/lib/format/units";
import { resolveEnqueueAffordance } from "@/lib/queue/enqueue-props";
import { BackendBadge } from "@/components/scorecard/BackendBadge";
import { CommandExport } from "@/components/export/CommandExport";
import { EnqueuePreview } from "@/components/queue/EnqueuePreview";
import { cn } from "@/lib/utils";

// =====================================================
// InsightCardRow — one engine card rendered VERBATIM (INSIGHT-03)
// =====================================================
// Server Component. The engine already ranked, graded, suppressed, and
// guarded every card — this row renders the pre-built InsightCard with NO
// ranking, NO severity computation, and NO formatting math beyond the
// sanctioned AFM-002 formatters (T-02-07). Labels come from the shared
// SIGNAL_LABELS vocabulary (@/lib/insight/labels) — never redefined here.
//
// Sketch rules (sketch-findings-nodemonitor, binding): plain uppercase mono
// signal text in the severity tint — no emoji, no dots, no icons for state;
// IBM Plex Mono for data; hairline borders; tight radii; navy only on links.
//
// Suppression rendering (D-14 fail-loud): the card STAYS visible with
// card.suppressed.reason verbatim in the warn tint; the action area renders
// disabled. suggestedAction is structurally null on suppressed cards
// (guardrails.ts) — only the withheldAction type string from evidence.detail
// reaches the DOM, never params (T-04-29).
//
// Phase 5 export mount (EXPORT-01 / PENDING-03): the suggested-action box
// carries the EXPORT control. buildExportBlock(card) is the SOLE gate (Pitfall
// 5) — it returns null for update_fee/investigate/suppressed/fleet/LDK-on-
// structural-fail, so the leaf renders ONLY for close_channel / rebalance /
// remediate_pending. Absence IS the signal: no placeholder, no disabled button,
// no JSX type-check duplicated here. The block is built server-side; the leaf
// receives plain serializable strings only — the card never crosses (T-05-03).

/** Severity tint per the scorecard taxonomy — state color, used nowhere else. */
const SEVERITY_TEXT: Record<InsightCard["severity"], string> = {
  critical: "text-status-critical",
  warn: "text-status-warn",
  info: "text-foreground/60",
};

/**
 * Display formatting only — NO unit conversion (raw card values stay raw).
 * Sat-denominated values route through the AFM-002 formatter; ratios keep
 * two decimals; everything else gets en-US separators.
 */
function formatValue(value: number, unit: string): string {
  if (unit === "sats") return formatSats(value);
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  return value.toFixed(2);
}

/** Param display: sat-keyed numbers route through AFM-002 (formatSats). */
function formatParamValue(key: string, value: unknown): string {
  if (typeof value === "number") {
    return /sat/i.test(key) ? formatSats(value) : value.toLocaleString("en-US");
  }
  if (value === null) return "—";
  return String(value);
}

/** "open {tab} →" label derived from the validated deeplink.ts path shape. */
function tabLabelFromLink(deepLink: string): string {
  const segments = deepLink.split("?")[0].split("/").filter(Boolean);
  if (segments.length >= 2) return segments[1];
  return segments[0] ?? "evidence";
}

interface InsightCardRowProps {
  card: InsightCard;
}

export function InsightCardRow({ card }: InsightCardRowProps) {
  const label = SIGNAL_LABELS[card.signal];
  const hysteresis = card.evidence.detail?.hysteresis;
  const withheldAction = card.evidence.detail?.withheldAction;
  // The gate lives entirely in buildExportBlock (null for non-exportable
  // types / suppressed / fleet / structural fail) — never inspect card type here.
  const exportBlock = card.suggestedAction !== null ? buildExportBlock(card) : null;
  // Enqueue control (QUEUE-01 / D-01): the backend gate is resolved server-side
  // here (backendFor via the server-only props builder). It is COMPLEMENTARY to
  // exportBlock — buildExportBlock returns null for update_fee, so these never
  // overlap on the same box. Suppressed cards carry a null action ⇒ "none".
  const enqueue = resolveEnqueueAffordance(card);

  return (
    <article className="border-b border-border px-4 py-3 last:border-b-0">
      {/* Identity line: signal label · node identity · deep link. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span
          className={cn(
            "font-mono text-xs font-semibold tracking-[0.06em] uppercase",
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
            <span className="font-mono text-xs font-semibold tracking-[0.06em] uppercase">
              FLEET-WIDE
            </span>
            {card.target.kind === "fleet" && (
              <span className="font-mono text-xs tabular-nums text-foreground/60">
                {card.target.pubkeys.length} node{card.target.pubkeys.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
        )}

        <Link
          href={card.evidence.deepLink}
          className="ms-auto font-mono text-xs whitespace-nowrap text-brand-light transition-colors hover:text-brand-glow"
        >
          {`open ${tabLabelFromLink(card.evidence.deepLink)} →`}
        </Link>
      </div>

      {/* Evidence line — raw card values, AFM-002 at render only. */}
      <p className="mt-1 font-mono text-xs text-foreground/60">
        {card.evidence.metric} {formatValue(card.evidence.observed, card.evidence.unit)}{" "}
        {card.evidence.unit} · threshold {formatValue(card.evidence.threshold, card.evidence.unit)}{" "}
        · {card.evidence.window}
      </p>

      {/* D-14 fail-loud: suppression reason verbatim, warn tint. */}
      {card.suppressed.active && card.suppressed.reason !== null && (
        <p className="mt-1 font-mono text-xs font-semibold text-status-warn">
          <span className="tracking-[0.06em] uppercase">SUPPRESSED</span> —{" "}
          {card.suppressed.reason}
        </p>
      )}

      {/* D-15 hysteresis state — stamped on every fee card, held or clear. */}
      {hysteresis !== undefined && (
        <p className="mt-1 font-mono text-xs text-foreground/60">hysteresis: {hysteresis}</p>
      )}

      {/* D-16 rate-limit guidance — text only, write cards only. */}
      {card.rateLimitGuidance !== null && (
        <p className="mt-1 font-mono text-xs text-foreground/60">{card.rateLimitGuidance}</p>
      )}

      {/* Suggested-action block: type + flat params as mono key/value rows. */}
      {card.suggestedAction !== null && (
        <div className="mt-2 rounded-[3px] border border-border bg-muted/40 px-3 py-2">
          <span className="font-mono text-xs font-semibold tracking-[0.14em] text-foreground/60 uppercase">
            suggested — {card.suggestedAction.type}
          </span>
          {Object.entries(card.suggestedAction.params).map(([key, value]) => (
            <div key={key} className="mt-0.5 flex gap-3 font-mono text-xs">
              <span className="text-foreground/45">{key}</span>
              <span className="tabular-nums">{formatParamValue(key, value)}</span>
            </div>
          ))}
          {/* EXPORT control — only when buildExportBlock yields a block (Pitfall 5). */}
          {exportBlock !== null && (
            <CommandExport block={exportBlock} blockId={`export-${card.id}`} />
          )}
          {/* ENQUEUE control (QUEUE-01) — complementary to export; LND-backed
              update_fee cards get the preview leaf, LDK-backed render the honest
              unsupported state, all others render nothing (server-resolved gate). */}
          {enqueue.kind === "lnd" && <EnqueuePreview {...enqueue.props} />}
          {enqueue.kind === "ldk" && (
            <p className="mt-2 border-t border-status-warn/30 pt-2 font-mono text-xs tracking-[0.06em] text-status-warn uppercase">
              LDK fee enqueue not yet supported — deferred to Phase 7
            </p>
          )}
        </div>
      )}

      {/* Suppressed cards: disabled action area — withheld type only, never
          params (suggestedAction is structurally null here, T-04-29). */}
      {card.suggestedAction === null && card.suppressed.active && (
        <div className="mt-2 rounded-[3px] border border-border bg-muted/40 px-3 py-2 opacity-50">
          <span className="font-mono text-xs font-semibold tracking-[0.14em] text-foreground/60 uppercase">
            withheld — {withheldAction ?? "action"}
          </span>
          <p className="mt-0.5 font-mono text-xs text-foreground/45">
            params withheld while node is flagged
          </p>
        </div>
      )}
    </article>
  );
}
