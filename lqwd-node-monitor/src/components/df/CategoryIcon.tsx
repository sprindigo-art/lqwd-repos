import {
  ArrowDown,
  ArrowUp,
  Database,
  Link2,
  Server,
  Settings,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { IncidentLayer } from "@/lib/overview/incidents";

// =====================================================
// CategoryIcon — presentation-only "WHAT is this alert" glyph (D-R5)
// =====================================================
// The approved redesign (sketch `.child .ic` :128) labels every child row with a
// NEUTRAL category icon that says WHAT the alert is — a node, a service, a host, a
// storage volume, the chain backend, or a fee move (raise ↑ / lower ↓). This is
// STRICTLY presentation: the glyph carries NO severity meaning and NO action. It
// paints in the neutral `text-df-faint` decorative hue and NEVER a severity color
// (T-12-14-03) — severity stays state-only (tinted chip + edge bar + the
// right-pinned `severityText` status). A category icon can neither imply nor enable
// execution (T-12-14-02): it is an inert `aria-hidden` <svg>.

/** The seven presentation categories a child row can announce. */
export type CategoryKind =
  | "node"
  | "service"
  | "host"
  | "storage"
  | "chain"
  | "fee-raise"
  | "fee-lower";

/**
 * Category → one lucide glyph. Zap=node, Settings=service (the cog), Server=host,
 * Database=storage, Link2=chain (the on-chain backend), ArrowUp/ArrowDown=fee move.
 * Presentation-only — none of these is ever tinted a severity hue.
 */
export const categoryIcon: Record<CategoryKind, LucideIcon> = {
  node: Zap,
  service: Settings,
  host: Server,
  storage: Database,
  chain: Link2,
  "fee-raise": ArrowUp,
  "fee-lower": ArrowDown,
};

/**
 * Map an incident child's `(layer, feeKind)` to its category. `feeKind` WINS — a
 * fee summary row is a fee-raise/fee-lower regardless of its `nodes` layer — so the
 * arrow glyph (not the node bolt) leads the fee row. Otherwise the five layers map
 * 1:1: nodes→node, services→service, hosts→host, storage→storage, bitcoind→chain.
 */
export function categoryFor(layer: IncidentLayer, feeKind?: "raise" | "lower"): CategoryKind {
  if (feeKind === "raise") return "fee-raise";
  if (feeKind === "lower") return "fee-lower";
  switch (layer) {
    case "nodes":
      return "node";
    case "services":
      return "service";
    case "hosts":
      return "host";
    case "storage":
      return "storage";
    case "bitcoind":
      return "chain";
  }
}

/**
 * Render the category glyph as an inert, neutral-hue leading icon (~15px). It is
 * `aria-hidden` (the row's text label carries the accessible name) and never
 * severity-colored — the sole sanctioned tint is the decorative `text-df-faint`.
 */
export function CategoryIcon({
  category,
  className,
}: {
  category: CategoryKind;
  className?: string;
}) {
  const Icon = categoryIcon[category];
  return (
    <Icon
      className={cn(
        "size-[15px] flex-none text-df-faint" /* df-faint-ok: aria-hidden category icon glyph, not content text */,
        className
      )}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}
