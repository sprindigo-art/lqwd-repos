"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

// =====================================================
// FacetDropdown — collapsible, scrollable facet group (Phase 7, INBOX-02 polish)
// =====================================================
// "use client" wrapper around a server-rendered facet list. Its open/closed
// state is REACT-OWNED so it PERSISTS across the server soft-navigation that a
// facet <Link> click triggers — the previous flat rail reset/collapsed on every
// click (operator gap, 2026-06-16). It also opens by default ONLY when a filter
// in this dimension is active, so an untouched rail stays compact (one header
// row per dimension) and never makes the page taller than the data warrants.
//
// The children (the facet <Link> rows) stay SERVER-rendered: live counts + the
// URL-toggle hrefs come from the server. This island owns only the disclosure
// state — never card data, never the signer (containment).

interface FacetDropdownProps {
  /** Dimension label (severity / node / signal / action). */
  heading: string;
  /** How many values in this dimension are currently active (drives the badge + default-open). */
  activeCount: number;
  /** Total selectable values in this dimension (faint right-aligned count). */
  total: number;
  /** The server-rendered facet rows. */
  children: React.ReactNode;
}

export function FacetDropdown({ heading, activeCount, total, children }: FacetDropdownProps) {
  // Open by default only when this dimension already has an active facet — keeps
  // the rail compact on first load, and surfaces the operator's own selection.
  const [open, setOpen] = useState(activeCount > 0);

  return (
    <div className="facetdd flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase transition-colors hover:text-df-ink"
      >
        <span className={cn("tw inline-block transition-transform", open && "rotate-90")} aria-hidden>
          ▸
        </span>
        <span className="truncate">{heading}</span>
        <span className="ms-auto flex items-center gap-1.5">
          {activeCount > 0 && (
            <span className="rounded-[3px] bg-df-brand/10 px-1.5 text-df-brand tabular-nums">
              {activeCount}
            </span>
          )}
          <span className="tabular-nums text-df-muted">{total}</span>
        </span>
      </button>

      {open && (
        <div className="mt-0.5 flex max-h-56 flex-col gap-0.5 overflow-y-auto pe-1 pb-1">
          {children}
        </div>
      )}
    </div>
  );
}
