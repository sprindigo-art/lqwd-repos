import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface FreshnessStampProps {
  /** Worst-case oldest timestamp across the node's source tables (D-13). */
  asOf: Date | null;
  stale: boolean;
  breakdown?: Array<{ table: string; asOf: Date | null }>;
}

/** Dates only here — no sat/BTC math (AFM-002 lives at the render layer). */
const dateFormat = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});

function formatDate(d: Date | null): string {
  return d === null ? "—" : dateFormat.format(d);
}

/**
 * D-13: every node carries a "data as of" stamp; past the staleness threshold
 * the node stays visible with an explicit STALE marker — plain uppercase mono
 * text (no glyph, per the sketch's no-emoji rule), a first-class, frequent
 * state (fail-loud), never a hidden edge case. The dotted underline advertises
 * the per-dimension breakdown tooltip (checker W-2).
 */
export function FreshnessStamp({ asOf, stale, breakdown }: FreshnessStampProps) {
  if (asOf === null) {
    return <span className="font-df-mono text-xs text-df-muted">no data yet</span>;
  }

  const stamp = stale ? (
    <span className={cn("font-df-mono text-xs font-semibold tabular-nums text-df-stale-text")}>
      STALE — data as of {formatDate(asOf)}
    </span>
  ) : (
    <span className="font-df-mono text-xs tabular-nums text-df-muted">
      data as of {formatDate(asOf)}
    </span>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 underline decoration-dotted decoration-df-border underline-offset-4">
            {stamp}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="flex flex-col gap-1">
            {stale && (
              <span>
                This node&apos;s grade rests on data older than the freshness threshold. Shown
                anyway, flagged so you know.
              </span>
            )}
            {breakdown?.map((row) => (
              <span key={row.table} className="flex justify-between gap-3 tabular-nums">
                <span>{row.table}</span>
                <span>{formatDate(row.asOf)}</span>
              </span>
            ))}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
