import { Download } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =====================================================
// NODE-02 — "Export CSV" (the only action verb this phase)
// =====================================================
// A plain <a href download> styled as the vendored Button outline variant —
// no client JS in v1: the export route responds with the file directly, so
// browser-native download behavior stands in for the UI-SPEC busy/failure
// states ("Exporting…" / the locked failure copy). RECORDED DEVIATION from
// UI-SPEC §CSV export, noted in 03-05-SUMMARY for the 03-09 operator
// checkpoint; a thin client wrapper restoring the locked states is the known
// follow-up if the operator flags it.

interface ExportButtonProps {
  href: string;
}

export function ExportButton({ href }: ExportButtonProps) {
  return (
    <a
      href={href}
      download
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        // Console-label voice over the outline-button chrome.
        "font-mono text-xs font-semibold tracking-[0.14em] uppercase"
      )}
    >
      {/* 16px icon — buttonVariants sizes un-classed svgs, but pin it anyway. */}
      <Download className="size-4" aria-hidden="true" />
      Export CSV
    </a>
  );
}
