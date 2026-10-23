import type { ReactNode } from "react";

// =====================================================
// Shared route-group container
// =====================================================
// The masthead lived here and was rendered for ALL children — extracted to
// <ConsoleMasthead /> (src/components/chrome/ConsoleMasthead), now mounted by the
// v1 sibling pages that need it; the overview page owns its single chrome via
// NavRailShell.
//
// The @modal parallel-route slot was REMOVED (operator decision 2026-07-10:
// full-page navigation, no modals). It was the sole source of systemic
// client-side soft-navigation 404s: every route hard-loaded fine, but soft-nav
// to any route without an explicit @modal match failed parallel-route
// reconciliation and 404'd. Its remaining files all rendered null (leftover
// placeholders from the retired (.)[pubkey] scorecard-modal interceptor), so
// nothing user-visible was lost. This layout is now a plain container; every
// (overview) route is a full page.

export default function OverviewLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  // Full-width pass-through. The old `mx-auto max-w-6xl px-6` reading column caged
  // every surface into a centered ~1152px box AND (because NavRailShell's rail is
  // `fixed` at the viewport edge) pushed the rail out of alignment with its own
  // content. Width now belongs to each page: NavRailShell owns its chrome + the
  // per-page `contentWidth`, so the site fills the screen.
  return <div className="relative min-h-screen">{children}</div>;
}
