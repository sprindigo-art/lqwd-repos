import { MastheadNav } from "@/components/chrome/MastheadNav";

// =====================================================
// ConsoleMasthead — the v1-surface chrome header
// =====================================================
// The masthead (LQWD wordmark + Node Operations + primary nav) is brand/
// structural chrome — navy only, never a health color (sketch contract: severity
// hue does state, appears nowhere in the chrome). Light NOC theme: solid light
// bar, no decorative washes.
//
// Extracted from (overview)/layout.tsx so the shared route-group layout no longer
// stacks this over the overview `/` (which carries its own NavRailShell chrome).
// The v1 sibling pages (/inbox, /pending, /queue, /{pubkey}/{tab}) mount this at
// the top of their tree to keep the chrome they previously inherited from the
// layout. Server Component — MastheadNav stays the only client part (usePathname).
//
// The warehouse DB name is deliberately NOT rendered here (info-disclosure
// surface removed — CLAUDE.md forbids exposing connection details).

export function ConsoleMasthead() {
  return (
    <header className="relative border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3.5">
        <span className="rounded-sm bg-brand px-2 py-1 font-mono text-xs leading-none font-bold tracking-[0.18em] text-white">
          LQWD
        </span>
        <span className="font-display text-sm font-semibold tracking-[0.22em] uppercase">
          Node Operations
        </span>
        <div className="ms-8">
          <MastheadNav />
        </div>
      </div>
    </header>
  );
}
