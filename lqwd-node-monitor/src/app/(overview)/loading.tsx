import { NavRailShell } from "@/components/df/NavRailShell";

// =====================================================
// (overview)/loading.tsx — honest in-shell loading boundary
// =====================================================
// The route group had no loading.tsx, so a slow warehouse read left the operator
// on a blank screen with no chrome during navigation (U1). This Suspense fallback
// keeps the NavRailShell rail + top bar mounted and states, honestly, that data is
// still being read — never a fabricated fleet summary or a fake "Live" pill (the
// shell renders neither without real counts / a poll epoch). df tokens only.

/** In-shell loading state: rail stays, honest "reading" copy, no fabricated data. */
export default function OverviewLoading() {
  return (
    <NavRailShell
      active="ops"
      title="Loading…"
      showViewToggle={false}
      showFleetSummary={false}
      showLivePill={false}
    >
      <div className="flex flex-col py-10" role="status" aria-live="polite">
        <h1 className="text-[23px] font-semibold text-df-ink">Reading the fleet…</h1>
        <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-df-muted">
          Loading the latest warehouse read. This view is read-only — nothing in the fleet is being
          changed while it loads.
        </p>
        {/* Neutral placeholder rows — decorative shimmer only, never fake data. */}
        <div className="mt-8 flex flex-col gap-3" aria-hidden="true">
          <div className="h-16 w-full animate-pulse rounded-df-card bg-df-border-soft" />
          <div className="h-16 w-full animate-pulse rounded-df-card bg-df-border-soft" />
          <div className="h-16 w-full animate-pulse rounded-df-card bg-df-border-soft" />
        </div>
      </div>
    </NavRailShell>
  );
}
