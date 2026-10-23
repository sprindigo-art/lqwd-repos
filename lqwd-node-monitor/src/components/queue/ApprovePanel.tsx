"use client";

import { useState } from "react";

import { approveCommand, rejectCommand } from "@/app/actions/queue";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// =====================================================
// ApprovePanel — the approval client leaf (QUEUE-03 / D-07 / D-10)
// =====================================================
// "use client" leaf receiving SERIALIZABLE props ONLY (commandId, the live
// isStale flag + asOf computed server-side at render, never the command row).
// It owns nothing but the local confirm/submit state, the reject-reason draft,
// and the stale-ack checkbox.
//
// Security (T-06-21/T-06-23): the client NEVER sends a signature — APPROVE sends
// { id, staleAck } and REJECT sends { id, reason } to the server actions, which
// re-validate + re-guard the transition server-side. The optional reject reason
// renders as a TEXT NODE only via React children — never an HTML/markdown sink
// (V5 / CommandExport containment precedent).
//
// D-10 (blocked-by-default, NOT a hard lock): when isStale, APPROVE stays
// disabled until the operator checks "I acknowledge the data is stale"; the ack
// boolean flows to approveCommand and is written to the audit row. This is a
// deliberate gate the operator CAN clear — it never permanently locks approval.
//
// Sketch rules (sketch-findings-nodemonitor, binding): mono uppercase text
// controls, no icons-for-state, no animation, hairline borders, tight radii;
// navy reserved for the focus ring + the APPROVE act; critical-red for REJECT
// and the stale-gate warning. Confirm copy is verbatim from the UI-SPEC.

/** mono-uppercase-over-outline-button chrome — the CommandExport control voice. */
const CONTROL_CHROME = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "font-df-mono text-xs font-semibold tracking-[0.14em] uppercase",
);

/** UI-SPEC confirm copy (Destructive / irreversible actions table). */
const APPROVE_CONFIRM =
  "Approve this fee update for execution? Only approved commands become execution-eligible.";
const REJECT_CONFIRM = "Reject this command? This is terminal — it cannot be re-approved.";

interface ApprovePanelProps {
  /** The command UUID — re-validated + re-guarded server-side. */
  commandId: string;
  /** LIVE staleness of the current-policy re-query for this row (D-09/D-06), server-computed. */
  isStale: boolean;
  /** The worst-case live "data as of" stamp, pre-formatted server-side. */
  asOf: string;
}

type Phase = "idle" | "submitting" | "done" | "error";

export function ApprovePanel({ commandId, isStale, asOf }: ApprovePanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [staleAck, setStaleAck] = useState(false);
  const [reason, setReason] = useState("");

  const submitting = phase === "submitting";
  const done = phase === "done";

  // D-10 blocked-by-default: APPROVE is disabled on stale data until acknowledged.
  const approveBlocked = isStale && !staleAck;

  async function handleApprove() {
    if (approveBlocked) return; // belt-and-suspenders; the button is already disabled.
    if (!window.confirm(APPROVE_CONFIRM)) return;
    setPhase("submitting");
    setErrorText(null);
    // params-free: the client sends ONLY { id, staleAck } — never a signature.
    const result = await approveCommand({ id: commandId, staleAck });
    if (result.ok) {
      setPhase("done");
    } else {
      setPhase("error");
      setErrorText(result.error);
    }
  }

  async function handleReject() {
    if (!window.confirm(REJECT_CONFIRM)) return;
    setPhase("submitting");
    setErrorText(null);
    const trimmed = reason.trim();
    const result = await rejectCommand({
      id: commandId,
      reason: trimmed.length > 0 ? trimmed : undefined,
    });
    if (result.ok) {
      setPhase("done");
    } else {
      setPhase("error");
      setErrorText(result.error);
    }
  }

  // Terminal in-place echo — the row no longer needs an action surface.
  if (done) {
    return (
      <p
        className="font-df-mono text-xs font-semibold tracking-[0.14em] text-df-ok-text uppercase"
        aria-live="polite"
      >
        DONE — RELOAD THE QUEUE
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* D-10 stale-data gate — warn-tinted line + the blocking ack checkbox. */}
      {isStale && (
        <div className="flex flex-col gap-1.5">
          <p className="font-df-mono text-xs text-df-warning">
            data is stale — last fetched {asOf}. approve is blocked until acknowledged.
          </p>
          <label className="flex cursor-pointer items-center gap-2 font-df-mono text-xs text-df-muted">
            <Checkbox
              checked={staleAck}
              onCheckedChange={(v) => setStaleAck(v === true)}
              disabled={submitting}
              aria-label="I acknowledge the data is stale"
            />
            <span>I acknowledge the data is stale</span>
          </label>
        </div>
      )}

      {/* Optional reject reason — free text, rendered (in the timeline) as a text node only. */}
      <label className="flex flex-col gap-1 font-df-mono text-xs text-df-muted">
        <span className="tracking-[0.06em] uppercase">reason (optional)</span>
        <input
          type="text"
          value={reason}
          disabled={submitting}
          onChange={(e) => setReason(e.target.value)}
          placeholder="why is this being rejected?"
          className={cn(
            "rounded-[3px] border border-df-border bg-df-surface px-2 py-1 font-df-mono text-xs text-df-muted",
            "focus-visible:ring-2 focus-visible:ring-df-brand focus-visible:outline-none",
            "disabled:opacity-50",
          )}
        />
      </label>

      {/* The two deliberate acts — APPROVE (navy) blocked-by-default on stale;
          REJECT (critical-red). Each takes a window.confirm gesture (D-07). */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleApprove()}
          disabled={submitting || approveBlocked}
          className={cn(
            CONTROL_CHROME,
            "border-df-brand text-df-brand hover:bg-df-brand/5",
            "disabled:opacity-50",
          )}
          aria-live="polite"
        >
          {submitting ? "WORKING…" : "APPROVE"}
        </button>
        <button
          type="button"
          onClick={() => void handleReject()}
          disabled={submitting}
          className={cn(
            CONTROL_CHROME,
            "border-df-critical/50 text-df-critical hover:bg-df-critical/5",
            "disabled:opacity-50",
          )}
          aria-live="polite"
        >
          REJECT
        </button>
      </div>

      {phase === "error" && errorText !== null && (
        <p className="font-df-mono text-xs text-df-critical" aria-live="assertive">
          {errorText}
        </p>
      )}
    </div>
  );
}
