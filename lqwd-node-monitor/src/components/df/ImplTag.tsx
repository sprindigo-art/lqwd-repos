import { cn } from "@/lib/utils";

// =====================================================
// ImplTag — node-implementation micro-tag (Server)
// =====================================================
// Structurally identical to v1 BackendBadge, but the v2 grammar paints the impl
// tag with its OWN df impl-tag tokens — NOT the structural navy. v1 painted the
// tag with the structural-navy utilities; that conflated implementation with
// chrome. Here LND wears `text-df-lnd` on `bg-df-lnd-bg`, LDK wears `text-df-ldk`
// on `bg-df-ldk-bg` (RESEARCH Standard Stack). Severity/structure split preserved:
// neither variant touches the NOC navy utilities.
//
// The default label is the prototype's two-part `role · impl` form — "Routing ·
// LND" / "LSP · LDK" (Node Detail line 88) — not the bare impl token. Pass
// `withRole={false}` for the compact impl-only badge.
//
// [ASSUMED A2] The LDK impl-tag hex (#7A4FA3 on #F1EAF8) is an assumed value
// pending operator confirmation — see 10-RESEARCH A2.

interface ImplTagProps {
  /** Node implementation — LND (routing) or LDK/LSPD. */
  impl: "lnd" | "ldk";
  /**
   * Show the prototype's two-part `role · impl` label ("Routing · LND" /
   * "LSP · LDK") instead of the bare impl token. Defaults to `true` to match the
   * Node Detail header pill (prototype line 88); pass `false` for the compact
   * impl-only badge.
   */
  withRole?: boolean;
  /** Extra classes merged last via `cn()`. */
  className?: string;
}

/**
 * The role word that precedes the impl in the prototype's two-part label: LND
 * nodes are routing nodes, LDK nodes are LSP nodes (RESEARCH Standard Stack).
 */
const IMPL_ROLE: Record<ImplTagProps["impl"], string> = {
  lnd: "Routing",
  ldk: "LSP",
};

/** A tracked mono micro-tag for the node implementation, in df impl-tag tokens. */
export function ImplTag({ impl, withRole = true, className }: ImplTagProps) {
  const tokenLabel = impl === "lnd" ? "LND" : "LDK";
  // Prototype shows the full "Routing · LND" / "LSP · LDK" two-part label; the
  // role word is dropped only when `withRole` is explicitly false.
  const label = withRole ? `${IMPL_ROLE[impl]} · ${tokenLabel}` : tokenLabel;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-df-pill px-2 py-0.5 font-df-mono text-[11px] leading-none font-semibold tracking-[0.04em]",
        impl === "lnd" ? "bg-df-lnd-bg text-df-lnd" : "bg-df-ldk-bg text-df-ldk",
        className,
      )}
    >
      {label}
    </span>
  );
}
