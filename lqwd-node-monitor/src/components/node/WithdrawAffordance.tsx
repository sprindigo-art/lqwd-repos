"use client";

import { useState } from "react";

import { withdrawCommand } from "@/app/actions/queue";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =====================================================
// WithdrawAffordance — the D-01 undo for an approved-but-unclaimed intent
// =====================================================
// The B8 companion to ApprovePanel: a "use client" leaf that receives SERIALIZABLE
// props ONLY (the command UUID) and owns nothing but the local submit state. It is
// the operator's undo for the approve→claim window — today an approved-unclaimed
// row can only clear via the 24h TTL or a manual DB write.
//
// Security (mirrors ApprovePanel): the client sends { id } ONLY — NEVER a
// signature. withdrawCommand re-validates + re-guards server-side; the guarded
// `WHERE state='approved'` transition IS the claim-race safety (D-02) — if the
// node already claimed the row, the server surfaces the verbatim "too late,
// already claimed" copy and this renders it in place.

/** mono-uppercase-over-outline-button chrome — the shared control voice. */
const CONTROL_CHROME = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "font-mono text-xs font-semibold tracking-[0.14em] uppercase",
);

/** UI-SPEC D-01 confirm copy (verbatim). */
const WITHDRAW_CONFIRM =
  "Pull this approved fee intent before the node claims it? The audit trail is preserved.";

interface WithdrawAffordanceProps {
  /** The approved command's UUID — re-validated + re-guarded server-side. */
  commandId: string;
}

type Phase = "idle" | "submitting" | "done" | "error";

export function WithdrawAffordance({ commandId }: WithdrawAffordanceProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  const submitting = phase === "submitting";

  async function handleWithdraw() {
    if (!window.confirm(WITHDRAW_CONFIRM)) return;
    setPhase("submitting");
    setErrorText(null);
    // { id } ONLY — the client NEVER sends a signature.
    const result = await withdrawCommand({ id: commandId });
    if (result.ok) {
      setPhase("done");
    } else {
      // A lost race surfaces the verbatim "too late, already claimed" copy.
      setPhase("error");
      setErrorText(result.error);
    }
  }

  if (phase === "done") {
    return (
      <p
        className="font-mono text-xs font-semibold tracking-[0.14em] text-status-ok uppercase"
        aria-live="polite"
      >
        WITHDRAWN — RELOAD THE QUEUE
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleWithdraw()}
        disabled={submitting}
        className={cn(CONTROL_CHROME, "border-brand text-brand hover:bg-brand/5", "disabled:opacity-50")}
        aria-live="polite"
      >
        {submitting ? "WITHDRAWING…" : "WITHDRAW"}
      </button>
      {phase === "error" && errorText !== null && (
        <p className="font-mono text-xs text-status-critical" aria-live="assertive">
          {errorText}
        </p>
      )}
    </div>
  );
}
