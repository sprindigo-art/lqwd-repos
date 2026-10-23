import { cn } from "@/lib/utils";

interface BackendBadgeProps {
  backend: "lnd" | "ldk";
}

/**
 * D-04: backend is a visible node attribute. Navy is brand/structural chrome
 * only — it is NOT a health color (UI-SPEC §Color). Rendered as a tracked
 * mono micro-tag so it reads as console metadata, not a status signal.
 */
export function BackendBadge({ backend }: BackendBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 font-df-mono text-xs leading-none font-semibold tracking-[0.14em] text-white uppercase",
        backend === "lnd" ? "bg-df-brand" : "bg-df-brand-light"
      )}
    >
      {backend === "lnd" ? "LND" : "LDK"}
    </span>
  );
}
