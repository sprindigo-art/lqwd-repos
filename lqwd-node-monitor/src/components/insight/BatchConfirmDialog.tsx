"use client";

import { useState } from "react";

import { enqueueBatch, type BatchRowResult, type EnqueueInput } from "@/app/actions/queue";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// =====================================================
// BatchConfirmDialog — aggregate-scope confirm + enqueueBatch + per-row tally (INBOX-04)
// =====================================================
// "use client". Receives the selected batch as serializable `BatchRow[]`
// ({pubkey, params} + display nodeLabel + the card's rateLimitGuidance) built
// SERVER-side and threaded through the island. It states the AGGREGATE SCOPE
// before firing (D-06): "N intents → M nodes, ppm range X–Y, all engine-
// suggested, expires +24h" — there is NO editable input (engine values only,
// Pitfall 4). On confirm it disables the button (single in-flight, the
// EnqueuePreview `submitting` precedent — prevents double-enqueue), calls
// `enqueueBatch(rows)` with PARAMS ONLY (the client NEVER supplies an HMAC; the
// server signs once per row — CLAUDE.md §5), then renders the verbatim
// { results, queued, skipped } tally inline, grouped by node, each skip's error
// byte-for-byte. All tally / scope text renders as React TEXT NODES (V5).

/** One selected row: the enqueue payload + display fields for the scope summary. */
export interface BatchRow extends EnqueueInput {
  /** Display alias / short pubkey for the per-node tally grouping. */
  nodeLabel: string;
  /** The card's advisory rate-limit guidance (D-08) — surfaced, never blocking. */
  rateLimitGuidance: string | null;
}

type Phase = "idle" | "submitting" | "done";

/** mono-uppercase control voice (EnqueuePreview/CommandExport precedent). */
const CONTROL_CHROME = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "font-df-mono text-xs font-semibold tracking-[0.14em] uppercase",
);

interface BatchConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected, server-resolved batch rows (engine values verbatim). */
  rows: BatchRow[];
}

export function BatchConfirmDialog({ open, onOpenChange, rows }: BatchConfirmDialogProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [results, setResults] = useState<BatchRowResult[] | null>(null);

  const submitting = phase === "submitting";
  const done = phase === "done";

  // ── Aggregate scope (D-06) — all numerics via toLocaleString, no inline math. ──
  const intentCount = rows.length;
  const nodeCount = new Set(rows.map((r) => r.pubkey)).size;
  const ppms = rows.map((r) => r.params.suggestedPpm);
  const ppmMin = ppms.length > 0 ? Math.min(...ppms) : 0;
  const ppmMax = ppms.length > 0 ? Math.max(...ppms) : 0;
  const advisories = rows.filter((r) => r.rateLimitGuidance !== null);

  // De-dup the advisory strings so a repeated guidance shows once.
  const advisoryText = Array.from(new Set(advisories.map((r) => r.rateLimitGuidance!)));

  async function handleConfirm() {
    setPhase("submitting");
    // params ONLY — the client NEVER supplies an HMAC; the server signs per row.
    const payload: EnqueueInput[] = rows.map((r) => ({ pubkey: r.pubkey, params: r.params }));
    const result = await enqueueBatch(payload);
    setResults(result.results);
    setPhase("done");
  }

  /** Reset to idle when the dialog is dismissed so a re-open starts clean. */
  function handleOpenChange(next: boolean) {
    if (!next) {
      setPhase("idle");
      setResults(null);
    }
    onOpenChange(next);
  }

  // Group the tally rows by node label for the verbatim per-row report (D-07).
  const byNode = new Map<string, BatchRowResult[]>();
  if (results !== null) {
    for (const r of results) {
      const list = byNode.get(r.pubkey) ?? [];
      list.push(r);
      byNode.set(r.pubkey, list);
    }
  }
  // Map pubkey → a display label from the submitted rows.
  const labelFor = new Map(rows.map((r) => [r.pubkey, r.nodeLabel]));
  const queued = results?.filter((r) => r.ok).length ?? 0;
  const skipped = (results?.length ?? 0) - queued;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-df-mono text-sm font-semibold tracking-[0.06em] uppercase">
            {done ? "enqueue result" : "confirm bulk enqueue"}
          </DialogTitle>
        </DialogHeader>

        {!done ? (
          <div className="flex flex-col gap-3">
            {/* Aggregate scope (D-06) — engine values only, no editable input. */}
            <p className="font-df-mono text-xs text-df-muted">
              {intentCount.toLocaleString("en-US")} intent{intentCount === 1 ? "" : "s"} →{" "}
              {nodeCount.toLocaleString("en-US")} node{nodeCount === 1 ? "" : "s"} · ppm range{" "}
              <span className="tabular-nums">
                {ppmMin.toLocaleString("en-US")}–{ppmMax.toLocaleString("en-US")}
              </span>{" "}
              · all engine-suggested · expires +24h
            </p>

            {/* Rate-limit guidance — advisory only, still enqueue all (D-08). */}
            {advisoryText.length > 0 && (
              <div className="flex flex-col gap-1 rounded-[3px] border border-df-warning/30 bg-df-warning/5 px-3 py-2">
                {advisoryText.map((text, i) => (
                  <p key={i} className="font-df-mono text-xs text-df-warning">
                    {text}
                  </p>
                ))}
              </div>
            )}

            <p className="font-df-mono text-xs text-df-muted">
              Each intent is re-validated and signed server-side. Nothing is written until you
              confirm.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Verbatim per-row tally, grouped by node (D-07). */}
            <p className="font-df-mono text-xs font-semibold tracking-[0.06em] uppercase">
              <span className="text-df-ok-text">{queued.toLocaleString("en-US")} queued</span>
              {" · "}
              <span className={skipped > 0 ? "text-df-critical" : "text-df-muted"}>
                {skipped.toLocaleString("en-US")} skipped
              </span>
            </p>

            <div className="flex flex-col gap-2">
              {Array.from(byNode.entries()).map(([pubkey, list]) => (
                <div key={pubkey} className="flex flex-col gap-0.5">
                  <span className="font-df-mono text-xs font-semibold text-df-muted">
                    {labelFor.get(pubkey) ?? pubkey}
                  </span>
                  {list.map((r, i) => (
                    <div key={i} className="flex items-baseline gap-3 font-df-mono text-xs ps-3">
                      <span className="tabular-nums text-df-muted">{r.chanId}</span>
                      {r.ok ? (
                        <span className="text-df-ok-text">queued</span>
                      ) : (
                        <span className="text-df-critical">{r.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {!done ? (
            <>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
                className={cn(CONTROL_CHROME, "disabled:opacity-50")}
              >
                cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={submitting || intentCount === 0}
                className={cn(
                  CONTROL_CHROME,
                  "border-df-brand text-df-brand hover:bg-df-brand/5",
                  "disabled:opacity-50",
                )}
                aria-live="polite"
              >
                {submitting ? "QUEUEING…" : "CONFIRM ENQUEUE"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className={cn(CONTROL_CHROME)}
            >
              close
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
