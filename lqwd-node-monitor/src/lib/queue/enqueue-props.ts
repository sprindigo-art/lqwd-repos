import "server-only";

import { backendFor } from "@/lib/config/backends";
import { expiryLabel, ttlHours } from "@/lib/queue/ttl";
import type { InsightCard } from "@/lib/insight/types";
import type { EnqueuePreviewProps } from "@/components/queue/EnqueuePreview";

// =====================================================
// enqueue-props — server-side props builder for the EnqueuePreview leaf (D-01/D-01b)
// =====================================================
// THE single place backendFor (server-only, T-02-02/T-06-20/D-12) is resolved for
// the enqueue control. Both card surfaces (InsightCardRow + the console page's
// SignalRow builder) call this so the gate logic lives once and the client leaf
// never imports the resolver. The result is a small discriminated shape carrying
// only SERIALIZABLE data (the props, or the unsupported flag) — never the card.
//
// Gate (RESEARCH Open Q2 RESOLVED; project core value — never enqueue an action
// no node can execute):
//   - card.suggestedAction null / not update_fee / no node ⇒ "none" (no control)
//   - backendFor(pubkey) === "lnd" ⇒ "lnd" + the EnqueuePreview props
//   - backendFor(pubkey) === "ldk" ⇒ "ldk" (the honest unsupported affordance)
//
// expiresAtLabel is computed HERE (server-side, +TTL) so enqueue-time TTL stays
// authoritative server-side, mirroring enqueue.ts's NODEMON_TTL_HOURS default.

/** Server-resolved enqueue affordance for one card. */
export type EnqueueAffordance =
  | { kind: "none" }
  | { kind: "lnd"; props: EnqueuePreviewProps }
  | { kind: "ldk" };

/**
 * Resolve the enqueue affordance for a card. Returns "none" unless the card
 * carries a non-null `update_fee` suggested action on a node; for those, the
 * server-resolved backend decides between the LND enqueue control and the LDK
 * unsupported state.
 */
export function resolveEnqueueAffordance(card: InsightCard): EnqueueAffordance {
  const action = card.suggestedAction;
  if (action === null || action.type !== "update_fee" || card.node === null) {
    return { kind: "none" };
  }
  const pubkey = card.node.pubkey;
  if (backendFor(pubkey) === "ldk") {
    return { kind: "ldk" };
  }
  const p = action.params;
  const expiresAt = new Date(Date.now() + ttlHours() * 3600_000);
  return {
    kind: "lnd",
    props: {
      pubkey,
      nodeLabel: card.node.alias ?? pubkey,
      chanId: p.chanId,
      channelPoint: p.channelPoint,
      currentPpm: p.currentPpm,
      suggestedPpm: p.suggestedPpm,
      baseFeeMsat: p.baseFeeMsat,
      timeLockDelta: p.timeLockDelta,
      // IN-05: humanized server-side — same "expires" row format as the B8 leaf.
      expiresAtLabel: expiryLabel(expiresAt),
    },
  };
}
