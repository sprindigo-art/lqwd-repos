import { describe, expect, it } from "vitest";
import {
  CHANNEL_POINT_RE,
  CHAN_ID_RE,
  PUBKEY_RE,
  TXID_RE,
  safeSatPerVbyte,
  validateActionForExport,
} from "@/lib/export/validate";

// =====================================================
// validateActionForExport injection-rejection suite (EXPORT-01 AC3 / T-05-01)
// =====================================================
// Two gates: (1) SuggestedActionSchema.safeParse re-parse, (2) per-field
// format regexes BEFORE any value reaches a command string. Hostile fixtures
// (`;`, newline, backtick, `$(`) must each return ok:false — this is the
// security floor every command builder (plan 05-03) stands on.

const HEX64 = "a".repeat(64);
const HEX66 = "0".repeat(66);

function closeAction(over: Record<string, unknown> = {}) {
  return {
    type: "close_channel",
    params: { chanId: "895633969997611009", channelPoint: `${HEX64}:1`, force: false, ...over },
  };
}

function rebalanceAction(over: Record<string, unknown> = {}) {
  return {
    type: "rebalance",
    params: { partnerPubkey: HEX66, amountSat: 50000, direction: "out", ...over },
  };
}

function remediateAction(over: Record<string, unknown> = {}) {
  return {
    type: "remediate_pending",
    params: {
      case: "bump_fee",
      channelPoint: null,
      outpointTxid: HEX64,
      suggestedSatPerVbyte: 12,
      ...over,
    },
  };
}

describe("validateActionForExport — close_channel (T-05-01)", () => {
  it("accepts a valid coop close", () => {
    expect(validateActionForExport(closeAction())).toEqual({ ok: true });
  });

  it("rejects every channelPoint injection fixture", () => {
    const injections = [
      `${HEX64}:1; rm -rf ~`,
      `${HEX64}:1\nlncli stop`,
      "$(reboot):0",
      `${HEX64}:1 && echo x`,
      `${"A".repeat(64)}:1`, // uppercase hex
      "../../../etc/passwd:0",
      "`reboot`:0",
    ];
    for (const channelPoint of injections) {
      expect(validateActionForExport(closeAction({ channelPoint }))).toMatchObject({ ok: false });
    }
  });

  it("still exports with a non-decimal chanId (chanId is a SOFT field, A2)", () => {
    expect(validateActionForExport(closeAction({ chanId: "not-decimal" }))).toEqual({ ok: true });
  });
});

describe("validateActionForExport — rebalance", () => {
  it("accepts a valid rebalance", () => {
    expect(validateActionForExport(rebalanceAction())).toEqual({ ok: true });
  });

  it("rejects a partnerPubkey that does not match /^[0-9a-f]{66}$/", () => {
    for (const partnerPubkey of [`${"0".repeat(65)};`, "0".repeat(65), "A".repeat(66)]) {
      expect(validateActionForExport(rebalanceAction({ partnerPubkey }))).toMatchObject({
        ok: false,
      });
    }
  });

  it("rejects non-positive / non-integer / unsafe amountSat", () => {
    for (const amountSat of [0, -1, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validateActionForExport(rebalanceAction({ amountSat }))).toMatchObject({ ok: false });
    }
  });
});

describe("validateActionForExport — remediate_pending", () => {
  it("rejects a hostile outpointTxid", () => {
    expect(
      validateActionForExport(remediateAction({ outpointTxid: `${"a".repeat(63)};` })),
    ).toMatchObject({ ok: false });
  });

  it("accepts a valid 64-hex txid", () => {
    expect(validateActionForExport(remediateAction({ outpointTxid: HEX64 }))).toEqual({ ok: true });
  });

  it("rejects a hostile channelPoint when present", () => {
    expect(
      validateActionForExport(
        remediateAction({ outpointTxid: null, channelPoint: `${HEX64}:1\nrm` }),
      ),
    ).toMatchObject({ ok: false });
  });
});

describe("validateActionForExport — non-exportable types", () => {
  it("rejects update_fee structurally", () => {
    const action = {
      type: "update_fee",
      params: {
        chanId: "1",
        channelPoint: `${HEX64}:0`,
        currentPpm: 1,
        suggestedPpm: 2,
        baseFeeMsat: 0,
        timeLockDelta: 40,
      },
    };
    expect(validateActionForExport(action)).toMatchObject({ ok: false });
  });

  it("rejects investigate structurally", () => {
    expect(validateActionForExport({ type: "investigate", params: {} })).toMatchObject({
      ok: false,
    });
  });
});

describe("validateActionForExport — schema gate (Gate 1) runs first", () => {
  it("rejects an object that fails SuggestedActionSchema shape (extra key)", () => {
    expect(
      validateActionForExport(closeAction({ extra: "boom" })),
    ).toMatchObject({ ok: false });
  });

  it("rejects a wrong-type params field before any regex runs", () => {
    expect(validateActionForExport(closeAction({ force: "yes" }))).toMatchObject({ ok: false });
  });

  it("rejects non-object input", () => {
    for (const bad of [null, undefined, "close_channel", 42]) {
      expect(validateActionForExport(bad)).toMatchObject({ ok: false });
    }
  });
});

describe("safeSatPerVbyte", () => {
  it("passes through an in-range integer", () => {
    expect(safeSatPerVbyte(500)).toBe(500);
    expect(safeSatPerVbyte(1)).toBe(1);
    expect(safeSatPerVbyte(5000)).toBe(5000);
  });

  it("returns null for out-of-range / non-integer / null", () => {
    expect(safeSatPerVbyte(0)).toBeNull();
    expect(safeSatPerVbyte(5001)).toBeNull();
    expect(safeSatPerVbyte(2.5)).toBeNull();
    expect(safeSatPerVbyte(null)).toBeNull();
  });
});

describe("exported format regexes", () => {
  it("CHANNEL_POINT_RE matches 64-hex:index and rejects breakouts", () => {
    expect(CHANNEL_POINT_RE.test(`${HEX64}:1`)).toBe(true);
    expect(CHANNEL_POINT_RE.test(`${HEX64}:1;rm`)).toBe(false);
  });

  it("TXID_RE matches exactly 64 lowercase hex", () => {
    expect(TXID_RE.test(HEX64)).toBe(true);
    expect(TXID_RE.test(`${HEX64}a`)).toBe(false);
  });

  it("PUBKEY_RE matches exactly 66 lowercase hex", () => {
    expect(PUBKEY_RE.test(HEX66)).toBe(true);
    expect(PUBKEY_RE.test("0".repeat(67))).toBe(false);
  });

  it("CHAN_ID_RE matches a decimal SCID string", () => {
    expect(CHAN_ID_RE.test("895633969997611009")).toBe(true);
    expect(CHAN_ID_RE.test("not-decimal")).toBe(false);
  });
});
