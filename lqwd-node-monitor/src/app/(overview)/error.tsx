"use client";

import { useEffect } from "react";

import { NavRailShell } from "@/components/df/NavRailShell";
import { cn, FOCUS_RING } from "@/lib/utils";

// =====================================================
// (overview)/error.tsx — honest in-shell error boundary (U1)
// =====================================================
// The route group had no error.tsx, so an unhandled read/render failure escaped to
// Next's default full-screen error page — stranding the operator with no rail, no
// nav, and a stack-trace-ish shell. This boundary keeps the NavRailShell chrome
// mounted and states, honestly, that a DATA-SOURCE problem occurred — not a fleet
// failure — and that the fleet is unchanged (the dashboard is read-only). It offers
// a single `reset()` retry. Client Component (Next error boundaries must be).
//
// It NEVER echoes the raw error message into the UI (it may carry a DB name / DSN /
// hostId, T-14-20); the message is logged to the console for the operator's own
// devtools instead. No fabricated fleet summary or live pill renders here.

export default function OverviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Console only — never surface a raw error (may leak a DSN / table / hostId).
    console.error("Overview render error:", error);
  }, [error]);

  return (
    <NavRailShell
      active="ops"
      title="Something went wrong"
      showViewToggle={false}
      showFleetSummary={false}
      showLivePill={false}
    >
      <div className="flex flex-col py-10" role="alert">
        <h1 className="text-[23px] font-semibold text-df-ink">Couldn&apos;t load this view.</h1>
        <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-df-muted">
          The read model hit an error — a data-source problem, not a fleet failure. Your data is
          unchanged; this dashboard is read-only. Retry the read below, or check the warehouse
          connection and reload.
        </p>
        {error.digest !== undefined && (
          <p className="mt-2 font-df-mono text-xs text-df-muted">Reference: {error.digest}</p>
        )}
        <div className="mt-6">
          <button
            type="button"
            onClick={() => reset()}
            className={cn(
              "rounded-df-btn border border-df-border bg-df-surface px-4 py-2 font-df-mono text-xs font-semibold tracking-[0.06em] text-df-ink uppercase transition-colors hover:bg-df-border-soft",
              FOCUS_RING
            )}
          >
            Retry read
          </button>
        </div>
      </div>
    </NavRailShell>
  );
}
