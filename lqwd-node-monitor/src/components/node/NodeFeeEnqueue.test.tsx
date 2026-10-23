import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  NodeFeeEnqueue,
  buildEnqueueAndApproveArgs,
  feeEnqueueConfirmBlocked,
  type NodeFeeEnqueueProps,
} from "@/components/node/NodeFeeEnqueue";

// =====================================================
// NodeFeeEnqueue.test.tsx — the D-05 stale-baseline gate (blocked → ack → enabled)
// =====================================================
// The automated behavioral coverage for the 08-04-canary mitigation: a stale fee
// baseline must BLOCK the one-click enqueue+approve CONFIRM until the operator
// acknowledges it, and the acknowledged `staleAck` must be threaded verbatim into
// the enqueueAndApprove call. DEP-FREE per RESEARCH §H (LOCKED) — `renderToStaticMarkup`
// from react-dom/server under `environment: "node"` + the pure exported predicate
// + the pure params-builder. NO jsdom / @testing-library (see TwoAxisPip.test.tsx).

const PUBKEY = "0".repeat(66);

/** A full props object for the render assertions; `baselineStale` is overridden per test. */
function baseProps(overrides: Partial<NodeFeeEnqueueProps> = {}): NodeFeeEnqueueProps {
  return {
    pubkey: PUBKEY,
    nodeLabel: "LQWD-Ireland",
    chanId: "123456789012345",
    channelPoint: "abc:0",
    currentPpm: 100,
    suggestedPpm: 100,
    baseFeeMsat: 1000,
    timeLockDelta: 80,
    expiresAtLabel: "2026-07-09T00:00:00.000Z",
    baselineStale: false,
    // Open on first paint so the static markup carries the CONFIRM control + gate.
    defaultOpen: true,
    ...overrides,
  };
}

describe("feeEnqueueConfirmBlocked — the pure D-05 gate predicate", () => {
  it("(1) blocks CONFIRM when the baseline is stale and unacknowledged", () => {
    expect(feeEnqueueConfirmBlocked({ baselineStale: true, staleAck: false })).toBe(true);
  });

  it("(2) unblocks once acknowledged, and a fresh baseline never blocks", () => {
    expect(feeEnqueueConfirmBlocked({ baselineStale: true, staleAck: true })).toBe(false);
    expect(feeEnqueueConfirmBlocked({ baselineStale: false, staleAck: false })).toBe(false);
    expect(feeEnqueueConfirmBlocked({ baselineStale: false, staleAck: true })).toBe(false);
  });
});

describe("NodeFeeEnqueue — the D-05 gate rendered treatment", () => {
  it("(1) a stale baseline renders the DISABLED CONFIRM + the verbatim stale warning", () => {
    const html = renderToStaticMarkup(
      createElement(NodeFeeEnqueue, baseProps({ baselineStale: true, baselineAgeLabel: "7h" })),
    );
    // the one deliberate write act is present…
    expect(html).toContain("ENQUEUE + APPROVE");
    // …and it is DISABLED (blocked-by-default on a stale, unacknowledged baseline).
    expect(html).toMatch(/<button[^>]*\bdisabled\b[^>]*>[^<]*ENQUEUE \+ APPROVE/);
    // the verbatim UI-SPEC stale-baseline warning appears, with the age label.
    expect(html).toContain("Baseline may be stale —");
    expect(html).toContain("7h");
  });

  it("a fresh baseline renders NO stale warning and an ENABLED CONFIRM", () => {
    const html = renderToStaticMarkup(
      createElement(NodeFeeEnqueue, baseProps({ baselineStale: false })),
    );
    expect(html).toContain("ENQUEUE + APPROVE");
    expect(html).not.toContain("Baseline may be stale —");
    // no disabled button in the fresh, non-submitting, non-queued state.
    expect(html).not.toContain('disabled=""');
  });
});

describe("buildEnqueueAndApproveArgs — staleAck threads verbatim into the action input", () => {
  it("(3) passes the operator's acknowledged staleAck through to the enqueueAndApprove input", () => {
    const acked = buildEnqueueAndApproveArgs(
      { pubkey: PUBKEY, chanId: "chan-1", channelPoint: "cp:0", currentPpm: 100 },
      { ppm: 250, baseMsat: 1500, timelock: 40 },
      true,
    );
    expect(acked.staleAck).toBe(true);
    // params-only: the client sends the bounds-clamped params + pubkey, never a signature.
    expect(acked.pubkey).toBe(PUBKEY);
    expect(acked.params.chanId).toBe("chan-1");
    expect(acked.params.suggestedPpm).toBe(250); // raise OR lower — editable up and down
    expect(Object.keys(acked).sort()).toEqual(["params", "pubkey", "staleAck"]);
    expect("signature" in acked).toBe(false);

    // and an un-acknowledged confirm threads staleAck=false.
    const unacked = buildEnqueueAndApproveArgs(
      { pubkey: PUBKEY, chanId: "chan-1", channelPoint: "cp:0", currentPpm: 100 },
      { ppm: 1, baseMsat: 0, timelock: 18 },
      false,
    );
    expect(unacked.staleAck).toBe(false);
    expect(unacked.params.suggestedPpm).toBe(1); // clean revert down to ppm 1 (canary fix)
  });
});
