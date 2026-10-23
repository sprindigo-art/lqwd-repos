import { ShieldCheck } from "lucide-react";

// =====================================================
// ReadOnlySafetyPosture (B7 / NODE-04) — zero-credential posture strip (Server)
// =====================================================
// The navy-washed safety-posture strip, present on every Node Detail load. Reuses
// the overview `SafetyFooter` chrome grammar (`bg-[#EAEEF6]` + navy shield) but
// carries the D-08 reconciled Node-Detail copy VERBATIM from the UI-SPEC
// "Node Detail safety posture" row — the write-path-aware reaffirmation that
// NodeMonitor holds ZERO node credentials and never directly changes the node.
//
// DS-01: navy is STRUCTURE only here (the wash + the shield). It is NOT a health
// hue — nothing on this strip encodes severity. The copy below is FROZEN to the
// contract; do not paraphrase (a checker asserts the exact string).

/** Frozen zero-credential lead — verbatim from UI-SPEC "Node Detail safety posture". */
export const SAFETY_POSTURE_LEAD = "Zero node credentials stored.";

/** Frozen reconciled write-path body — verbatim from UI-SPEC "Node Detail safety posture". */
export const SAFETY_POSTURE_BODY =
  "NodeMonitor reads and ranks; it never directly changes this node. A fee change is a signed intent the node itself verifies (HMAC), re-bounds-checks, and applies — you approve it here, the node runs it. High-risk fixes export as commands you run. The AI explains; it never executes.";

/**
 * The read-only safety-posture strip. Presentational + static — the copy is a
 * built-in constant (never caller-supplied) so the strip can never be made to
 * imply a credential it does not hold.
 */
export function ReadOnlySafetyPosture() {
  return (
    <section className="flex items-start gap-3 rounded-df-card border border-df-border bg-[#EAEEF6] px-5 py-4">
      <span
        className="mt-0.5 inline-flex size-8 flex-none items-center justify-center rounded-df-btn"
        style={{ backgroundColor: "rgba(19,40,79,0.08)" }}
        aria-hidden="true"
      >
        <ShieldCheck className="size-[18px] text-df-chrome" strokeWidth={2} />
      </span>
      <p className="text-[13.5px] leading-relaxed text-df-ink">
        <span className="font-semibold">{SAFETY_POSTURE_LEAD}</span>{" "}
        <span className="text-df-muted">{SAFETY_POSTURE_BODY}</span>
      </p>
    </section>
  );
}
