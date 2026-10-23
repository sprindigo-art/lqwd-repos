import type { IncidentLayer } from "@/lib/overview/incidents";
import { cn } from "@/lib/utils";

// Type identifier for an entity's layer (audit C2). Shared names collide across
// layers — a VM host, its bitcoind, and its node can all read "LQWD-Canada" — so a
// small mono tag disambiguates VM vs SERVICE vs NODE wherever those labels appear.
// Structure/neutral styling only; it never encodes severity (severity = color).

/** Short operator-facing type label per incident layer. */
export const LAYER_TAG_LABEL: Record<IncidentLayer, string> = {
  hosts: "VM",
  services: "SERVICE",
  bitcoind: "CHAIN",
  nodes: "NODE",
  storage: "STORAGE",
};

/** Neutral mono type-tag chip (VM / SERVICE / NODE / CHAIN / STORAGE). */
export function LayerTag({ layer, className }: { layer: IncidentLayer; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-[4px] border border-df-border bg-df-surface-sub px-1.5 py-0.5 font-df-mono text-[9.5px] font-semibold tracking-[0.08em] text-df-muted uppercase",
        className,
      )}
    >
      {LAYER_TAG_LABEL[layer]}
    </span>
  );
}
