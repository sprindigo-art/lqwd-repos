import { describe, it, expect } from "vitest";
import { buildExportBlock, safeToken } from "@/lib/export/commands";
import { CHANNEL_POINT_RE, PUBKEY_RE } from "@/lib/export/validate";
import { InsightCardSchema } from "@/lib/insight/schema";
import type { InsightCard } from "@/lib/insight/types";
import type { ExportBlock } from "@/lib/export/block";

// =====================================================
// commands.test.ts — Phase 5 EXPORT-01 / PENDING-03 (D-04..D-10, T-05-*)
// =====================================================
// NO DB / no server — pure builder coverage. Every fixture is validated through
// the FROZEN InsightCardSchema (stuck-pending.test.ts discipline) so the test
// can never drift from the contract the builders code against.

const NODE_PK = "02" + "a".repeat(64);
const REMOTE_PK = "03" + "b".repeat(64);
const PARTNER_PK = "03" + "c".repeat(64);
const TXID = "f".repeat(64);
const CHAN_POINT = `${TXID}:1`;
const DECIMAL_SCID = "895633969997611009";

// ── fixture factory ──────────────────────────────────────────────────────────
function cardFixture(over: Partial<InsightCard> = {}): InsightCard {
  const base: InsightCard = {
    schemaVersion: 1,
    id: "test-card",
    severity: "warn",
    node: { pubkey: NODE_PK, alias: "LQWD-Canada", backend: "lnd" },
    target: { kind: "channel", chanId: DECIMAL_SCID, channelPoint: CHAN_POINT, remotePubkey: REMOTE_PK },
    signal: "channel_close_candidate",
    evidence: {
      metric: "forwards90d",
      observed: 0,
      threshold: 1,
      unit: "count",
      window: "90d",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${NODE_PK}/closes`,
      detail: {},
    },
    suggestedAction: {
      type: "close_channel",
      params: { chanId: DECIMAL_SCID, channelPoint: CHAN_POINT, force: false },
    },
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  };
  // Shallow-merge the few fields tests override; validate the assembled card.
  const merged = { ...base, ...over } as InsightCard;
  return InsightCardSchema.parse(merged);
}

// Convenience: every produced block's commands flattened for hygiene asserts.
function allCommands(block: ExportBlock): string[] {
  return block.steps.map((s) => s.command).filter((c): c is string => c !== null);
}

describe("buildExportBlock — gate (Pitfall 5)", () => {
  it("returns null for a suppressed card (suggestedAction null)", () => {
    const card = cardFixture({ suggestedAction: null });
    expect(buildExportBlock(card)).toBeNull();
  });

  it("returns null for an update_fee card", () => {
    const card = cardFixture({
      signal: "fee_raise",
      suggestedAction: {
        type: "update_fee",
        params: {
          chanId: DECIMAL_SCID,
          channelPoint: CHAN_POINT,
          currentPpm: 1,
          suggestedPpm: 2,
          baseFeeMsat: 1000,
          timeLockDelta: 80,
        },
      },
    });
    expect(buildExportBlock(card)).toBeNull();
  });

  it("returns null for an investigate card", () => {
    const card = cardFixture({
      provenance: "deterministic",
      suggestedAction: { type: "investigate", params: {} },
    });
    expect(buildExportBlock(card)).toBeNull();
  });

  it("returns null for a fleet card (node null)", () => {
    const card = cardFixture({
      node: null,
      target: { kind: "fleet", pubkeys: [NODE_PK] },
      signal: "fleet_close_cluster",
      suggestedAction: null,
    });
    expect(buildExportBlock(card)).toBeNull();
  });
});

describe("buildExportBlock — withheld state (T-05-01)", () => {
  it("withholds when channelPoint fails validation — no partial command, no echo", () => {
    const card = cardFixture({
      target: { kind: "channel", chanId: DECIMAL_SCID, channelPoint: `${TXID}:1; rm -rf`, remotePubkey: REMOTE_PK },
      suggestedAction: {
        type: "close_channel",
        params: { chanId: DECIMAL_SCID, channelPoint: `${TXID}:1; rm -rf`, force: false },
      },
    });
    const block = buildExportBlock(card)!;
    expect(block).not.toBeNull();
    expect(block.steps).toHaveLength(1);
    expect(block.steps[0].command).toBeNull();
    expect(block.steps[0].note).toBe("params failed validation — export withheld");
    expect(block.copyAll).toBeNull();
    expect(block.contextLines).toEqual([]);
    expect(block.safetyLines).toEqual([]);
  });
});

describe("buildCloseExport — coop", () => {
  const card = cardFixture({
    evidence: {
      metric: "forwards90d",
      observed: 0,
      threshold: 1,
      unit: "count",
      window: "90d",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${NODE_PK}/closes`,
      detail: { capacitySat: 50_000_000, peerAlias: "PeerNode" },
    },
  });

  it("step 1 verifies read-only with getchaninfo --chan_id and listchannels --peer", () => {
    const block = buildExportBlock(card)!;
    expect(block.steps[0].label).toMatch(/^step 1 — verify/);
    expect(block.steps[0].command).toContain(`lncli getchaninfo --chan_id ${DECIMAL_SCID}`);
    expect(block.steps[0].command).toContain(`lncli listchannels --peer ${REMOTE_PK}`);
  });

  it("step 2 closes with funding_txid + output_index, no --force on coop", () => {
    const block = buildExportBlock(card)!;
    expect(block.steps[1].command).toBe(`lncli closechannel --funding_txid ${TXID} --output_index 1`);
  });

  it("safetyLines include the coop HTLC-wait note", () => {
    const block = buildExportBlock(card)!;
    expect(block.safetyLines.some((l) => /coop close/.test(l) && /WAITS/.test(l))).toBe(true);
  });

  it("copyAll carries the timelock honesty comment", () => {
    const block = buildExportBlock(card)!;
    expect(block.copyAll).toContain(
      "# csv_delay (force-close lock) is shown by step 1 — the warehouse does not carry it",
    );
  });

  it("title says coop close", () => {
    expect(buildExportBlock(card)!.title).toBe("close_channel — coop close");
  });

  it("copyAll anatomy ordered: context comments → safety comments → step headers → commands", () => {
    const block = buildExportBlock(card)!;
    const ca = block.copyAll!;
    const iCtx = ca.indexOf("# node:");
    const iSafety = ca.indexOf("# coop close");
    const iStep1 = ca.indexOf("# step 1");
    const iVerify = ca.indexOf("lncli getchaninfo");
    const iStep2 = ca.indexOf("# step 2");
    const iClose = ca.indexOf("lncli closechannel");
    expect(iCtx).toBeGreaterThanOrEqual(0);
    expect(iCtx).toBeLessThan(iSafety);
    expect(iSafety).toBeLessThan(iStep1);
    expect(iStep1).toBeLessThan(iVerify);
    expect(iVerify).toBeLessThan(iStep2);
    expect(iStep2).toBeLessThan(iClose);
  });
});

describe("buildCloseExport — force", () => {
  const card = cardFixture({
    suggestedAction: {
      type: "close_channel",
      params: { chanId: DECIMAL_SCID, channelPoint: CHAN_POINT, force: true },
    },
  });

  it("step 2 ends with --force", () => {
    const block = buildExportBlock(card)!;
    expect(block.steps[1].command!.endsWith("--force")).toBe(true);
  });

  it("safetyLines include the force time-lock note", () => {
    const block = buildExportBlock(card)!;
    expect(block.safetyLines.some((l) => /TIME-LOCKED for the CSV delay/.test(l))).toBe(true);
  });
});

describe("buildCloseExport — chanId fallback", () => {
  const card = cardFixture({
    target: { kind: "channel", chanId: "deadbeef", channelPoint: CHAN_POINT, remotePubkey: REMOTE_PK },
    suggestedAction: {
      type: "close_channel",
      params: { chanId: "deadbeef", channelPoint: CHAN_POINT, force: false },
    },
  });

  it("uses --chan_point and never --chan_id when chanId fails CHAN_ID_RE", () => {
    const block = buildExportBlock(card)!;
    const verify = block.steps[0].command!;
    expect(verify).toContain(`lncli getchaninfo --chan_point ${CHAN_POINT}`);
    const whole = [block.copyAll, ...allCommands(block)].join("\n");
    expect(whole).not.toContain("--chan_id");
  });
});

describe("buildRebalanceExport — honest placeholder (D-07)", () => {
  const card = cardFixture({
    signal: "rebalance_degraded",
    target: { kind: "node" },
    node: { pubkey: NODE_PK, alias: "LQWD-Canada", backend: "lnd" },
    evidence: {
      metric: "failureRate",
      observed: 1,
      threshold: 0.5,
      unit: "ratio",
      window: "90d",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${NODE_PK}/overview`,
      detail: { partnerAlias: "PartnerNode" },
    },
    suggestedAction: {
      type: "rebalance",
      params: { partnerPubkey: PARTNER_PK, amountSat: 250_000, direction: "out" },
    },
  });

  it("step 1 is the read-only listchannels --peer for the partner", () => {
    const block = buildExportBlock(card)!;
    expect(block.steps[0].command).toBe(`lncli listchannels --peer ${PARTNER_PK}`);
  });

  it("step 2 is the locked placeholder — command null", () => {
    const block = buildExportBlock(card)!;
    expect(block.steps[1].command).toBeNull();
    expect(block.steps[1].note).toBe(
      "rebalance execution is operator/AI-managed — no generated command yet",
    );
  });

  it("contextLines echo partner alias, amount, and direction", () => {
    const block = buildExportBlock(card)!;
    const values = block.contextLines.map((l) => l.value).join(" | ");
    expect(values).toContain("PartnerNode");
    expect(values).toContain("250,000");
    expect(values).toContain("out");
  });

  it("no runnable rebalance/bos command appears anywhere", () => {
    const block = buildExportBlock(card)!;
    const whole = [block.copyAll, ...allCommands(block)].join("\n");
    expect(whole).not.toMatch(/\bbos\b/);
    expect(whole).not.toMatch(/rebalance-lnd/);
  });

  it("falls back to truncated pubkey when partnerAlias absent", () => {
    const noAlias = cardFixture({
      signal: "rebalance_degraded",
      target: { kind: "node" },
      node: { pubkey: NODE_PK, alias: "LQWD-Canada", backend: "lnd" },
      evidence: {
        metric: "failureRate",
        observed: 1,
        threshold: 0.5,
        unit: "ratio",
        window: "90d",
        asOf: "2026-06-12T00:00:00.000Z",
        deepLink: `/${NODE_PK}/overview`,
        detail: {},
      },
      suggestedAction: {
        type: "rebalance",
        params: { partnerPubkey: PARTNER_PK, amountSat: 250_000, direction: "out" },
      },
    });
    const block = buildExportBlock(noAlias)!;
    const values = block.contextLines.map((l) => l.value).join(" | ");
    expect(values).toContain("alias unknown");
    expect(values).toContain(PARTNER_PK.slice(0, 8));
  });
});

describe("buildExportBlock — LDK locked fallback (RESEARCH §1)", () => {
  const card = cardFixture({
    node: { pubkey: NODE_PK, alias: "LQwD-Lspd-ldk", backend: "ldk" },
  });

  it("renders no runnable command and the honest manual-procedure notes", () => {
    const block = buildExportBlock(card)!;
    expect(allCommands(block)).toEqual([]);
    const notes = block.steps.map((s) => s.note).filter(Boolean).join(" | ");
    expect(notes).toContain("not supported on LDK — manual procedure");
    const allText = [...block.safetyLines, ...block.steps.map((s) => s.note ?? "")].join(" | ");
    expect(allText).toContain("coordinate with the LSPD operator");
  });

  it("still echoes full params in contextLines", () => {
    const block = buildExportBlock(card)!;
    expect(block.contextLines.length).toBeGreaterThan(0);
  });
});

describe("buildExportBlock — suite-wide hygiene (Pitfall 8 / T-05-02)", () => {
  const blocks: ExportBlock[] = [
    buildExportBlock(cardFixture())!,
    buildExportBlock(cardFixture({ suggestedAction: { type: "close_channel", params: { chanId: DECIMAL_SCID, channelPoint: CHAN_POINT, force: true } } }))!,
    buildExportBlock(
      cardFixture({
        signal: "rebalance_degraded",
        target: { kind: "node" },
        suggestedAction: { type: "rebalance", params: { partnerPubkey: PARTNER_PK, amountSat: 250_000, direction: "in" } },
      }),
    )!,
  ];

  it("no bare command contains a comma", () => {
    for (const block of blocks) {
      for (const cmd of allCommands(block)) {
        expect(cmd).not.toContain(",");
      }
    }
  });

  it("no bare command contains a formatSats-style grouped integer", () => {
    for (const block of blocks) {
      for (const cmd of allCommands(block)) {
        expect(cmd).not.toMatch(/\d{1,3}(,\d{3})+/);
      }
    }
  });

  it("hostile alias renders single-line, no backtick, in contextLines", () => {
    const hostile = cardFixture({
      evidence: {
        metric: "forwards90d",
        observed: 0,
        threshold: 1,
        unit: "count",
        window: "90d",
        asOf: "2026-06-12T00:00:00.000Z",
        deepLink: `/${NODE_PK}/closes`,
        detail: { peerAlias: "evil`\n$(rm -rf ~)" },
      },
    });
    const block = buildExportBlock(hostile)!;
    const values = block.contextLines.map((l) => l.value).join("\n");
    expect(values).not.toContain("`");
    expect(values).not.toContain("$");
    // the sanitized alias must not introduce its own newline mid-value
    const peerLine = block.contextLines.find((l) => /peer/i.test(l.key));
    expect(peerLine?.value.includes("\n")).toBe(false);
    // and the alias cannot break out of its `#` comment line in copyAll: the
    // line carrying the peer alias is a single `#` comment (newline stripped).
    const peerCopyLine = block
      .copyAll!.split("\n")
      .find((l) => l.includes(peerLine!.value));
    expect(peerCopyLine).toBeDefined();
    expect(peerCopyLine!.startsWith("#")).toBe(true);
  });
});

// ── Task 2: remediate runbooks (PENDING-03 / D-09, D-10) ──────────────────────

const SWEEP_TXID = "e".repeat(64);
const FC_CHAN_POINT = `${"d".repeat(64)}:0`;
const OPEN_CHAN_POINT = `${"c".repeat(64)}:2`;

// bump_fee card mirrors stuckSweepCard output: target kind "sweep".
function bumpFeeCard(over: { suggestedSatPerVbyte?: number | null; channelPoint?: string | null } = {}): InsightCard {
  return cardFixture({
    severity: "warn",
    signal: "stuck_sweep",
    target: { kind: "sweep", outpointTxid: SWEEP_TXID, outpointOutputIndex: 1 },
    evidence: {
      metric: "sweepBroadcastAttempts",
      observed: 12,
      threshold: 6,
      unit: "attempts",
      window: "24h snapshot",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${NODE_PK}/pending`,
      detail: { limboSat: 1_234_567, outpoint: `${SWEEP_TXID}:1`, attempts: 12, ageHours: 49.5 },
    },
    suggestedAction: {
      type: "remediate_pending",
      params: {
        case: "bump_fee",
        channelPoint: "channelPoint" in over ? (over.channelPoint ?? null) : null,
        outpointTxid: SWEEP_TXID,
        suggestedSatPerVbyte: "suggestedSatPerVbyte" in over ? (over.suggestedSatPerVbyte ?? null) : 25,
      },
    },
  });
}

// restart_procedure card mirrors fcPastMaturityCard output: target kind "channel".
function restartCard(): InsightCard {
  return cardFixture({
    severity: "critical",
    signal: "stuck_fc_past_maturity",
    target: { kind: "channel", chanId: null, channelPoint: FC_CHAN_POINT, remotePubkey: REMOTE_PK },
    evidence: {
      metric: "blocksPastMaturity",
      observed: 200,
      threshold: 6,
      unit: "blocks",
      window: "24h snapshot",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${NODE_PK}/pending`,
      detail: { limboSat: 5_000_000, channelPoint: FC_CHAN_POINT, ageHours: 72.2 },
    },
    suggestedAction: {
      type: "remediate_pending",
      params: { case: "restart_procedure", channelPoint: FC_CHAN_POINT, outpointTxid: null, suggestedSatPerVbyte: null },
    },
  });
}

// aged_funding card mirrors stuckOpenCard output.
function agedFundingCard(): InsightCard {
  return cardFixture({
    severity: "warn",
    signal: "stuck_open",
    target: { kind: "channel", chanId: null, channelPoint: OPEN_CHAN_POINT, remotePubkey: REMOTE_PK },
    evidence: {
      metric: "pendingOpenAgeHours",
      observed: 100,
      threshold: 48,
      unit: "hours",
      window: "24h snapshot",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${NODE_PK}/pending`,
      detail: { limboSat: 2_000_000, channelPoint: OPEN_CHAN_POINT, ageHours: 100.4 },
    },
    suggestedAction: {
      type: "remediate_pending",
      params: { case: "aged_funding", channelPoint: OPEN_CHAN_POINT, outpointTxid: null, suggestedSatPerVbyte: null },
    },
  });
}

describe("buildRemediateExport — bump_fee (D-10)", () => {
  it("step 1 is pendingsweeps with a jq-filter comment naming the outpoint in copyAll", () => {
    const block = buildExportBlock(bumpFeeCard())!;
    expect(block.steps[0].command).toContain("lncli wallet pendingsweeps");
    expect(block.copyAll).toContain(`${SWEEP_TXID}:1`);
  });

  it("step 2 is bumpfee --sat_per_vbyte <rate> <outpoint> with positional outpoint", () => {
    const block = buildExportBlock(bumpFeeCard())!;
    expect(block.steps[1].command).toBe(`lncli wallet bumpfee --sat_per_vbyte 25 ${SWEEP_TXID}:1`);
  });

  it("safetyLines include the D-10 mempool sanity-check reminder", () => {
    const block = buildExportBlock(bumpFeeCard())!;
    expect(block.safetyLines.some((l) => /sanity-check this rate against current mempool/.test(l))).toBe(true);
  });

  it("renders the anchor-channel bumpforceclosefee alternative ONLY when channelPoint present", () => {
    const without = buildExportBlock(bumpFeeCard({ channelPoint: null }))!;
    expect(without.copyAll).not.toContain("bumpforceclosefee");
    const withCp = buildExportBlock(bumpFeeCard({ channelPoint: FC_CHAN_POINT }))!;
    expect(withCp.copyAll).toContain(`# alternative (anchor channels): lncli wallet bumpforceclosefee ${FC_CHAN_POINT}`);
  });

  it("null rate → step 2 command null with honest no-rate note; verify still renders", () => {
    const block = buildExportBlock(bumpFeeCard({ suggestedSatPerVbyte: null }))!;
    expect(block.steps[0].command).toContain("lncli wallet pendingsweeps");
    expect(block.steps[1].command).toBeNull();
    expect(block.steps[1].note).toBe("no suggested rate — read requested_sat_per_vbyte from step 1");
  });

  it("rate out of safeSatPerVbyte bounds → no-rate state", () => {
    const block = buildExportBlock(bumpFeeCard({ suggestedSatPerVbyte: 99_999 }))!;
    expect(block.steps[1].command).toBeNull();
    expect(block.steps[1].note).toBe("no suggested rate — read requested_sat_per_vbyte from step 1");
  });

  it("context echoes outpoint, limbo (formatSats), age, attempts", () => {
    const block = buildExportBlock(bumpFeeCard())!;
    const values = block.contextLines.map((l) => `${l.key}=${l.value}`).join(" | ");
    expect(values).toContain(`${SWEEP_TXID}:1`);
    expect(values).toContain("1,234,567");
    expect(values).toContain("50h"); // 49.5h rounds to 50
    expect(values).toContain("12");
  });
});

describe("buildRemediateExport — bump_fee, no sweep target", () => {
  it("non-sweep target → step 2 command null, honest take-from-step-1 note", () => {
    const card = cardFixture({
      severity: "warn",
      signal: "stuck_sweep",
      target: { kind: "channel", chanId: null, channelPoint: FC_CHAN_POINT, remotePubkey: REMOTE_PK },
      evidence: {
        metric: "sweepBroadcastAttempts",
        observed: 12,
        threshold: 6,
        unit: "attempts",
        window: "24h snapshot",
        asOf: "2026-06-12T00:00:00.000Z",
        deepLink: `/${NODE_PK}/pending`,
        detail: { limboSat: 1000 },
      },
      suggestedAction: {
        type: "remediate_pending",
        params: { case: "bump_fee", channelPoint: null, outpointTxid: SWEEP_TXID, suggestedSatPerVbyte: 25 },
      },
    });
    const block = buildExportBlock(card)!;
    expect(block.steps[1].command).toBeNull();
    expect(block.steps[1].note).toMatch(/take the full outpoint from step 1/);
    // never invent an output index
    const whole = [block.copyAll, ...allCommands(block)].join("\n");
    expect(whole).not.toMatch(/bumpfee.*:\d/);
  });
});

describe("buildRemediateExport — restart_procedure (D-09, AP-11)", () => {
  const block = () => buildExportBlock(restartCard())!;

  it("step 1 is pendingchannels with a channelPoint jq-filter comment", () => {
    const b = block();
    expect(b.steps[0].command).toContain("lncli pendingchannels");
    expect(b.copyAll).toContain(FC_CHAN_POINT);
  });

  it("step 2 is null with the 4 numbered key steps citing the canonical scripts", () => {
    const b = block();
    expect(b.steps[1].command).toBeNull();
    const note = b.steps[1].note!;
    expect(note).toContain("05-fleet-coordination.sh");
    expect(note).toContain("01-safe-lnd-restart.sh");
    expect(note).toContain("lncli getinfo");
    expect(note).toMatch(/synced_to_chain/);
  });

  it("safetyLines include the AP-11 freeze-first note", () => {
    const b = block();
    expect(b.safetyLines.some((l) => /do NOT auto-restart/.test(l) && /freeze and preserve logs/.test(l))).toBe(true);
  });

  it("no step.command contains 'restart' (no runnable restart — T-04-14)", () => {
    const b = block();
    for (const cmd of allCommands(b)) expect(cmd).not.toContain("restart");
  });
});

describe("buildRemediateExport — aged_funding (RESEARCH §3)", () => {
  const block = () => buildExportBlock(agedFundingCard())!;

  it("step 1 is pendingchannels with a channelPoint filter comment", () => {
    const b = block();
    expect(b.steps[0].command).toContain("lncli pendingchannels");
    expect(b.copyAll).toContain(OPEN_CHAN_POINT);
  });

  it("guidance includes the mempool check, CPFP with operator-filled placeholder, 2016-block note", () => {
    const b = block();
    const text = [b.copyAll ?? "", ...b.steps.map((s) => s.note ?? "")].join("\n");
    expect(text).toContain("bitcoin-cli getmempoolentry");
    expect(text).toContain("<change_index from lncli listunspent --min_confs=0>");
    expect(text).toMatch(/2016/);
  });

  it("safetyLines include the abandonchannel DANGER note (never a runnable step)", () => {
    const b = block();
    expect(b.safetyLines.some((l) => /abandonchannel/.test(l) && /LOSE FUNDS/.test(l))).toBe(true);
    for (const cmd of allCommands(b)) expect(cmd).not.toContain("abandonchannel");
  });
});

describe("buildRemediateExport — context echo (all three, PENDING-03)", () => {
  it("each renders channel_point/outpoint + limbo + age, and attempts when present", () => {
    for (const card of [bumpFeeCard(), restartCard(), agedFundingCard()]) {
      const block = buildExportBlock(card)!;
      const keys = block.contextLines.map((l) => l.key).join(",");
      expect(keys).toMatch(/limbo|outpoint|channel_point/);
      const values = block.contextLines.map((l) => l.value).join(" ");
      // limbo rendered via formatSats (grouped) somewhere in the block
      expect(values).toMatch(/[\d,]{4,}/);
    }
  });
});

// ── 18-06: safeToken gate-then-interpolate (E1, E2) ───────────────────────────

describe("safeToken — the single gate-then-interpolate helper (E1/E2)", () => {
  it("returns the value verbatim ONLY on an anchored-regex match", () => {
    expect(safeToken(CHAN_POINT, CHANNEL_POINT_RE)).toBe(CHAN_POINT);
    expect(safeToken(REMOTE_PK, PUBKEY_RE)).toBe(REMOTE_PK);
  });

  it("withholds (null) on ANY mismatch — never returns a partial/raw value", () => {
    expect(safeToken(`${TXID}:1; rm -rf`, CHANNEL_POINT_RE)).toBeNull();
    expect(safeToken("DEADBEEF", PUBKEY_RE)).toBeNull();
    expect(safeToken("", CHANNEL_POINT_RE)).toBeNull();
    // an unanchored partial match must still withhold (RE is anchored ^…$)
    expect(safeToken(`ok\n${TXID}:1`, CHANNEL_POINT_RE)).toBeNull();
  });
});

// ── 18-06: E-copy — trusted static safety/runbook constants emitted VERBATIM ───

describe("copyAll emits trusted safety/runbook constants verbatim (E-copy)", () => {
  it("restart_procedure copyAll carries the FULL RESTART_KEY_STEPS (past the old 120 cap)", () => {
    const block = buildExportBlock(restartCard())!;
    // The 4th numbered step sits well beyond char 120 of the joined constant —
    // proves the 120-char cap no longer truncates the runbook inside copyAll.
    expect(block.copyAll).toContain(
      "(4) re-check lncli pendingchannels for maturity progression.",
    );
    // the full note is present verbatim in copyAll, not just the raw steps array
    expect(block.copyAll).toContain(block.steps[1].note!);
  });

  it("aged_funding copyAll carries the FULL AGED_FUNDING_GUIDANCE (2016-block tail)", () => {
    const block = buildExportBlock(agedFundingCard())!;
    expect(block.copyAll).toContain(
      "LND auto-forgets unconfirmed inbound channels after 2016 blocks",
    );
    expect(block.copyAll).toContain(block.steps[1].note!);
  });

  it("coop-close copyAll carries the FULL COOP_SAFETY note (past 120 chars)", () => {
    const block = buildExportBlock(cardFixture())!;
    expect(block.copyAll).toContain(
      "the channel shows disabled in listchannels until the close tx broadcasts.",
    );
  });
});

// ── 18-06: hostile-input coverage (E4 remotePubkey / E5 outpoint) ─────────────

describe("hostile interpolated identifiers never reach a runnable line (E4/E5)", () => {
  it("E4: a hostile target.remotePubkey produces no `--peer` line", () => {
    const hostile = cardFixture({
      target: {
        kind: "channel",
        chanId: DECIMAL_SCID,
        channelPoint: CHAN_POINT,
        remotePubkey: `${REMOTE_PK}; rm -rf ~`,
      },
    });
    const block = buildExportBlock(hostile)!;
    const whole = [block.copyAll, ...allCommands(block)].join("\n");
    expect(whole).not.toContain("--peer");
    expect(whole).not.toContain("rm -rf");
    // the coop close itself still renders (only the --peer verify is withheld)
    expect(block.steps[1].command).toBe(
      `lncli closechannel --funding_txid ${TXID} --output_index 1`,
    );
  });

  it("E5: a malformed outpointTxid → null bump command + NO_OUTPOINT_NOTE", () => {
    const card = cardFixture({
      severity: "warn",
      signal: "stuck_sweep",
      target: { kind: "sweep", outpointTxid: "NOT_HEX; rm -rf ~", outpointOutputIndex: 1 },
      evidence: {
        metric: "sweepBroadcastAttempts",
        observed: 12,
        threshold: 6,
        unit: "attempts",
        window: "24h snapshot",
        asOf: "2026-06-12T00:00:00.000Z",
        deepLink: `/${NODE_PK}/pending`,
        detail: { limboSat: 1000 },
      },
      suggestedAction: {
        type: "remediate_pending",
        params: { case: "bump_fee", channelPoint: null, outpointTxid: TXID, suggestedSatPerVbyte: 25 },
      },
    });
    const block = buildExportBlock(card)!;
    expect(block.steps[1].command).toBeNull();
    expect(block.steps[1].note).toBe(
      "no sweep outpoint on this card — take the full outpoint from step 1 output (never invent an output index)",
    );
    const whole = [block.copyAll, ...allCommands(block)].join("\n");
    expect(whole).not.toContain("rm -rf");
    expect(whole).not.toMatch(/bumpfee.*NOT_HEX/);
  });

  it("E5: an oversized output index (>5 digits) → null bump command + NO_OUTPOINT_NOTE", () => {
    const card = cardFixture({
      severity: "warn",
      signal: "stuck_sweep",
      target: { kind: "sweep", outpointTxid: TXID, outpointOutputIndex: 123456 },
      evidence: {
        metric: "sweepBroadcastAttempts",
        observed: 12,
        threshold: 6,
        unit: "attempts",
        window: "24h snapshot",
        asOf: "2026-06-12T00:00:00.000Z",
        deepLink: `/${NODE_PK}/pending`,
        detail: { limboSat: 1000 },
      },
      suggestedAction: {
        type: "remediate_pending",
        params: { case: "bump_fee", channelPoint: null, outpointTxid: TXID, suggestedSatPerVbyte: 25 },
      },
    });
    const block = buildExportBlock(card)!;
    expect(block.steps[1].command).toBeNull();
    expect(block.steps[1].note).toMatch(/take the full outpoint from step 1/);
    // the oversized index must not appear on any runnable bump line
    for (const cmd of allCommands(block)) expect(cmd).not.toContain("bumpfee");
  });
});
