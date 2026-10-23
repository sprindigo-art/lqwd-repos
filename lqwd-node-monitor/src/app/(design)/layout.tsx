import type { ReactNode } from "react";

// =====================================================
// (design) route group — minimal gallery shell (RSC)
// =====================================================
// The DS-02 primitive gallery lives in its OWN route group so it is isolated from
// the (overview) console: it does NOT inherit the (overview) masthead, and it has
// NO `@modal` parallel-route slot (route groups isolate layouts). This shell wraps
// `{children}` on the df page ground only — the gallery page supplies its own
// chrome. v1 screens are untouched by this addition (D-05, additive).
//
// df-* tokens only — no retired NOC v1 utilities cross this surface
// (DS-03; enforced by `npm run lint:noc-guard`).

export const metadata = { title: "Design System — DS-02 Gallery" };

export default function DesignLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="min-h-screen bg-df-bg text-df-ink">{children}</div>;
}
