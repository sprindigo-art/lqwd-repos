import "server-only";

import { backendFor } from "@/lib/config/backends";
import { expiryLabel, ttlHours } from "@/lib/queue/ttl";
import type { EnqueuePreviewProps } from "@/components/queue/EnqueuePreview";
import type { ChannelBaseline } from "@/lib/read/latest";

// =====================================================
// channel-enqueue-props — server-side props builder for the B8 fee-queue leaf
// =====================================================
// The channel-row analog of resolveEnqueueAffordance (enqueue-props.ts). It is
// THE single place backendFor (server-only, T-02-02/D-12) is resolved for the B8
// per-channel fee-queue control, so the gate logic lives once and the forked
// client leaf (NodeFeeEnqueue) never imports the backend resolver.
//
// B8 is NO-AI (the 08-04 canary mitigation — a rec-card-only path caused 3×
// channel mis-targeting): there is no recommendation, so the baseline
// `suggestedPpm` is seeded to the channel's OWN `currentPpm`. The operator raises
// OR lowers from there (fixing the canary's no-clean-revert gap). The result
// carries ONLY serializable data (the props + the D-05 baselineStale flag) — the
// ChannelBaseline / raw row never crosses to the client (containment).
//
// Gate (project core value — never enqueue an action no node can execute):
//   - backendFor(pubkey) === "ldk" ⇒ "ldk" (policy renders read-only, no control)
//   - backendFor(pubkey) === "lnd" ⇒ "lnd" + the EnqueuePreviewProps + baselineStale
//
// expiresAtLabel is computed HERE (server-side, +TTL) so enqueue-time TTL stays
// authoritative server-side, mirroring enqueue-props.ts / enqueue.ts.

/** Server-resolved fee-queue affordance for one channel row. */
export type ChannelEnqueueAffordance =
  | { kind: "ldk" }
  | { kind: "lnd"; props: EnqueuePreviewProps; baselineStale: boolean };

/**
 * Resolve the per-channel fee-queue affordance for one {@link ChannelBaseline}.
 * LDK-backed nodes return the read-only marker (no queue control); LND-backed
 * nodes get the pre-targeted EnqueuePreviewProps (chanId bound to THIS channel,
 * `suggestedPpm = currentPpm`, expiresAtLabel computed server-side) plus the D-05
 * `baselineStale` boolean for the stale-baseline gate.
 */
export function resolveChannelEnqueueProps(
  row: ChannelBaseline,
  pubkey: string,
  nodeLabel: string,
): ChannelEnqueueAffordance {
  if (backendFor(pubkey) === "ldk") {
    return { kind: "ldk" };
  }
  // No-AI baseline: current policy IS the suggestion (null policy ⇒ 0, the
  // operator sets an explicit value within the bounds gate before CONFIRM).
  const currentPpm = row.currentPpm ?? 0;
  const expiresAt = new Date(Date.now() + ttlHours() * 3600_000);
  return {
    kind: "lnd",
    props: {
      pubkey,
      nodeLabel,
      chanId: row.chanId,
      channelPoint: row.channelPoint ?? "",
      currentPpm,
      suggestedPpm: currentPpm, // B8 is no-AI — the baseline is the channel's own current ppm
      // An UNKNOWN base fee (null, T-18-14) seeds the editable field to 0 — an
      // explicit operator-adjustable starting point within the bounds gate, NOT a
      // claimed "current" value (the honest display path renders null as "—").
      baseFeeMsat: row.baseFeeMsat ?? 0,
      timeLockDelta: row.timeLockDelta,
      // IN-05: humanized server-side — never the raw ISO string in the panel.
      expiresAtLabel: expiryLabel(expiresAt),
    },
    baselineStale: row.baselineStale,
  };
}
