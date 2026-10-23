import type { InsightCard } from "@/lib/insight/types";
import type { ExportBlock, ExportStep } from "@/lib/export/block";
import {
  validateActionForExport,
  CHAN_ID_RE,
  CHANNEL_POINT_RE,
  PUBKEY_RE,
  safeSatPerVbyte,
} from "@/lib/export/validate";
import { sanitizeCommentText } from "@/lib/export/sanitize";
import { formatSats } from "@/lib/format/units";

// =====================================================
// commands.ts — pure command builders (Phase 5 — EXPORT-01 / PENDING-03)
// =====================================================
// Pure module: no server-only imports, no DB, no env — vitest-testable with zero
// infrastructure (stuck-pending.ts discipline). Implements:
//   D-04 commented context echo, D-05 twice-rendered safety notes,
//   D-06 verify-step-first anatomy, D-07 honest rebalance placeholder,
//   D-09/D-10 PENDING-03 runbooks (task 2), and the locked LDK honest fallback.
// Every lncli flag comes VERBATIM from RESEARCH §4 (verified against LND
// v0.20.1-beta source). No invented flags, no invented values.
//
// Threats addressed: T-05-01 (validate-before-interpolate gate + per-site regex
// re-check + withheld block on failure), T-05-02 (sanitizeCommentText on every
// card-sourced string entering a `#` line), T-05-03 (structural null/non-export
// gate), T-05-04 (restart/abandonchannel never runnable — task 2), T-05-05
// (no invented timelock/rate — verify-step honesty, conditional context echo).
//
// AFM-002 boundary: formatSats (commas) appears ONLY in comment/UI lines; bare
// `command` strings interpolate RAW integers (RESEARCH Pitfall 8).

/** Action types that may ever produce an export block (RESEARCH Pitfall 5). */
const EXPORTABLE_TYPES = new Set(["close_channel", "rebalance", "remediate_pending"]);

// ── gate-then-interpolate (E1/E2 — the SINGLE allowlist site) ─────────────────

/**
 * The ONE gate-then-interpolate point (T-05-01 / review E1, E2). Returns
 * `value` VERBATIM only when it matches the anchored allowlist regex; otherwise
 * null — the caller withholds the command (never interpolates a raw value into
 * a shell line). Commands here are shell-string templates, not argv tokens, so
 * safety rests entirely on uniform allowlist coverage: making the gate and the
 * interpolation site one and the same is what closes the "validated upstream,
 * trusted here" drift every sibling call site could otherwise introduce.
 */
export function safeToken(value: string, regex: RegExp): string | null {
  return regex.test(value) ? value : null;
}

// ── shared comment helpers ────────────────────────────────────────────────────

/**
 * `# `-prefix a CARD-SOURCED line after neutralizing it (T-05-02): strip
 * control + shell-active chars AND cap length — remote-controlled aliases stay
 * inert and single-line.
 */
function comment(line: string): string {
  return `# ${sanitizeCommentText(line)}`;
}

/**
 * `# `-prefix a TRUSTED STATIC constant (safety notes, runbook steps). These
 * are author-written, never card-sourced, so they are control-char-stripped for
 * defense-in-depth but NOT length-capped — the 120-char cap must never truncate
 * trusted guidance in copyAll (review E-copy: RESTART_KEY_STEPS/AGED_FUNDING_
 * GUIDANCE were silently cut). copyAll shows the full text verbatim.
 */
function commentTrusted(line: string): string {
  return `# ${sanitizeCommentText(line, Infinity)}`;
}

/** Truncate a pubkey to `02ab…cdef — alias unknown` honest form (A5). */
function truncPubkey(pk: string): string {
  if (!PUBKEY_RE.test(pk)) return `${sanitizeCommentText(pk).slice(0, 12)}… — alias unknown`;
  return `${pk.slice(0, 8)}…${pk.slice(-4)} — alias unknown`;
}

/** A context key/value row with the value sanitized for inert display. */
function ctx(key: string, value: string): { key: string; value: string } {
  return { key, value: sanitizeCommentText(value) };
}

/**
 * Assemble the annotated copy-all snippet in the locked D-04 anatomy order:
 * context `#` comments → safety `#` comments → per-step `# step N` header +
 * bare commands (honest-state steps render their note as a `#` comment, no
 * runnable line). Every comment input is sanitized; commands pass through RAW.
 */
function assembleCopyAll(
  contextLines: { key: string; value: string }[],
  safetyLines: string[],
  steps: ExportStep[],
): string {
  const lines: string[] = [];
  // context values are card-sourced (already sanitized+capped by ctx()) — keep
  // the cap; safety/step notes are trusted STATIC constants — emit verbatim.
  for (const c of contextLines) lines.push(comment(`${c.key}: ${c.value}`));
  for (const s of safetyLines) lines.push(commentTrusted(s));
  for (const step of steps) {
    lines.push(commentTrusted(step.label));
    if (step.command !== null) lines.push(step.command);
    else if (step.note !== null) lines.push(commentTrusted(step.note));
  }
  return lines.join("\n");
}

/** The locked withheld block — no param echo, no partial command (T-05-01). */
function withheldBlock(type: string): ExportBlock {
  return {
    title: `${type} — export withheld`,
    contextLines: [],
    safetyLines: [],
    steps: [{ label: "export", command: null, note: "params failed validation — export withheld" }],
    copyAll: null,
  };
}

// ── LDK honest fallback (RESEARCH §1 — locked) ────────────────────────────────

const LDK_MANUAL_NOTE = "not supported on LDK — manual procedure";
const LDK_COORDINATE_NOTE = "coordinate with the LSPD operator";

/**
 * Locked LDK fallback for ALL three action types: full sanitized context echo,
 * NO runnable command, the two honest notes. Currently unreachable at runtime
 * (all action detectors hardcode backend "lnd"; DEFAULT_BACKENDS empty) but
 * NODE_BACKENDS can flip a node with zero code change — so it ships + is tested.
 */
function buildLdkFallback(type: string, contextLines: { key: string; value: string }[]): ExportBlock {
  const steps: ExportStep[] = [
    { label: "manual procedure", command: null, note: LDK_MANUAL_NOTE },
  ];
  const safetyLines = [LDK_COORDINATE_NOTE];
  return {
    title: `${type} — LDK (manual)`,
    contextLines,
    safetyLines,
    steps,
    copyAll: assembleCopyAll(contextLines, safetyLines, steps),
  };
}

// ── close builder (EXPORT-01, D-06) ───────────────────────────────────────────

const TIMELOCK_HONESTY =
  "csv_delay (force-close lock) is shown by step 1 — the warehouse does not carry it";

function closeContextLines(card: InsightCard): { key: string; value: string }[] {
  const node = card.node!;
  const detail = card.evidence.detail ?? {};
  const target = card.target;
  const lines: { key: string; value: string }[] = [];

  lines.push(ctx("node", `${node.alias ?? node.pubkey} (${node.backend})`));

  // peer: prefer detail.peerAlias, else truncated remotePubkey + alias unknown.
  const peerAlias = detail.peerAlias;
  const remotePubkey = target.kind === "channel" ? target.remotePubkey : null;
  if (typeof peerAlias === "string" && peerAlias.length > 0) {
    lines.push(ctx("peer", peerAlias));
  } else if (remotePubkey !== null) {
    lines.push(ctx("peer", truncPubkey(remotePubkey)));
  }

  // capacity: formatSats (comment/UI only) — omit when absent (unknown ≠ 0).
  const cap = detail.capacitySat;
  if (typeof cap === "number") lines.push(ctx("capacity", `${formatSats(cap)} sats`));

  // chan_id echo-back (soft — sanitized echo regardless of CHAN_ID_RE).
  const chanId = target.kind === "channel" ? target.chanId : null;
  if (chanId !== null) lines.push(ctx("chan_id", chanId));

  const channelPoint = target.kind === "channel" ? target.channelPoint : null;
  if (channelPoint !== null) lines.push(ctx("channel_point", channelPoint));

  return lines;
}

const COOP_SAFETY =
  "coop close — funds available ~immediately after confirm; with active HTLCs the close WAITS until they resolve and the channel shows disabled in listchannels until the close tx broadcasts.";
const FORCE_SAFETY =
  "force close broadcasts the latest commitment tx; settled funds are TIME-LOCKED for the CSV delay before they can be spent (see step 1 csv_delay).";

function buildVerifyStep(card: InsightCard): ExportStep {
  const params = (card.suggestedAction as { params: { chanId: string; channelPoint: string } }).params;
  const target = card.target;
  const remotePubkey = target.kind === "channel" ? target.remotePubkey : null;

  // chan_id when it passes CHAN_ID_RE, else the --chan_point fallback (A2/SOFT).
  // Both identifiers gate-then-interpolate through safeToken (E2) — channelPoint
  // is HARD-gated upstream, so its fallback token is guaranteed present here.
  const verifyCmds: string[] = [];
  const chanIdTok = safeToken(params.chanId, CHAN_ID_RE);
  const chanPointTok = safeToken(params.channelPoint, CHANNEL_POINT_RE);
  if (chanIdTok !== null) {
    verifyCmds.push(`lncli getchaninfo --chan_id ${chanIdTok}`);
  } else if (chanPointTok !== null) {
    verifyCmds.push(`lncli getchaninfo --chan_point ${chanPointTok}`);
  }
  // listchannels --peer only when the remotePubkey passes PUBKEY_RE (E4) — a
  // hostile remotePubkey withholds this line, never emits a raw --peer arg.
  const peerTok = remotePubkey === null ? null : safeToken(remotePubkey, PUBKEY_RE);
  if (peerTok !== null) {
    verifyCmds.push(`lncli listchannels --peer ${peerTok}`);
  }

  return {
    label: "step 1 — verify (read-only)",
    command: verifyCmds.join("\n"),
    note: null,
  };
}

function buildCloseExport(card: InsightCard): ExportBlock {
  const params = (card.suggestedAction as { params: { channelPoint: string; force: boolean } }).params;
  const force = params.force;

  // E1: re-gate channelPoint AT the interpolation site (the upstream gate is not
  // enough — safeToken makes the gate and the split-and-interpolate one). A
  // mismatch withholds the whole close block rather than emitting a partial line.
  const channelPoint = safeToken(params.channelPoint, CHANNEL_POINT_RE);
  if (channelPoint === null) return withheldBlock("close_channel");
  const [txid, idx] = channelPoint.split(":");

  const contextLines = closeContextLines(card);
  const safetyLines = [force ? FORCE_SAFETY : COOP_SAFETY, TIMELOCK_HONESTY];

  const closeCmd = `lncli closechannel --funding_txid ${txid} --output_index ${idx}${force ? " --force" : ""}`;
  const steps: ExportStep[] = [
    buildVerifyStep(card),
    { label: "step 2 — close", command: closeCmd, note: null },
  ];

  return {
    title: `close_channel — ${force ? "force" : "coop"} close`,
    contextLines,
    safetyLines,
    steps,
    copyAll: assembleCopyAll(contextLines, safetyLines, steps),
  };
}

// ── rebalance builder (D-07 honest placeholder) ───────────────────────────────

const REBALANCE_PLACEHOLDER =
  "rebalance execution is operator/AI-managed — no generated command yet";

/** Plain-words direction for the context echo (out = push, in = pull). */
function directionWords(direction: "out" | "in"): string {
  return direction === "out" ? "out (push local→remote)" : "in (pull remote→local)";
}

function buildRebalanceExport(card: InsightCard): ExportBlock {
  const params = (
    card.suggestedAction as {
      params: { partnerPubkey: string; amountSat: number; direction: "out" | "in" };
    }
  ).params;
  const node = card.node!;
  const detail = card.evidence.detail ?? {};

  const partnerAlias = detail.partnerAlias;
  const partnerLine =
    typeof partnerAlias === "string" && partnerAlias.length > 0
      ? partnerAlias
      : truncPubkey(params.partnerPubkey);

  const contextLines = [
    ctx("node", `${node.alias ?? node.pubkey} (${node.backend})`),
    ctx("partner", partnerLine),
    ctx("amount", `${formatSats(params.amountSat)} sats`),
    ctx("direction", directionWords(params.direction)),
  ];
  const safetyLines: string[] = [
    "rebalancing runs through the fleet's custom circular-rebalance script + external AI service — verify liquidity first.",
  ];

  // partnerPubkey is HARD-gated upstream; re-gate at the interpolation site (E2)
  // so the verify line withholds rather than emit a raw --peer arg on any drift.
  const partnerTok = safeToken(params.partnerPubkey, PUBKEY_RE);
  const verifyStep: ExportStep =
    partnerTok !== null
      ? { label: "step 1 — verify (read-only)", command: `lncli listchannels --peer ${partnerTok}`, note: null }
      : { label: "step 1 — verify (read-only)", command: null, note: "partner pubkey failed validation — verify command withheld" };
  const steps: ExportStep[] = [
    verifyStep,
    { label: "step 2 — rebalance", command: null, note: REBALANCE_PLACEHOLDER },
  ];

  return {
    title: "rebalance — operator/AI-managed",
    contextLines,
    safetyLines,
    steps,
    copyAll: assembleCopyAll(contextLines, safetyLines, steps),
  };
}

// ── remediate builder (PENDING-03 — D-09 / D-10) ──────────────────────────────

type RemediateParams = {
  case: "bump_fee" | "restart_procedure" | "aged_funding";
  channelPoint: string | null;
  outpointTxid: string | null;
  suggestedSatPerVbyte: number | null;
};

/** A `# step N` header note that embeds the channelPoint as a jq filter hint. */
function pendingChannelsFilterNote(channelPoint: string | null): string {
  if (channelPoint === null) return "filter the relevant channel by channel_point";
  return `filter: .[] | select(.channel.channel_point == "${sanitizeCommentText(channelPoint)}")`;
}

/**
 * Shared remediate context echo — conditional-add from evidence.detail
 * (unknown ≠ invented; T-05-05). limboSat → formatSats (comment/UI), ageHours →
 * rounded + "h", attempts as-is, outpoint/channelPoint sanitized.
 */
function remediateContextLines(card: InsightCard): { key: string; value: string }[] {
  const node = card.node!;
  const detail = card.evidence.detail ?? {};
  const lines: { key: string; value: string }[] = [];

  lines.push(ctx("node", `${node.alias ?? node.pubkey} (${node.backend})`));

  const cp = detail.channelPoint;
  if (typeof cp === "string") lines.push(ctx("channel_point", cp));
  const outpoint = detail.outpoint;
  if (typeof outpoint === "string") lines.push(ctx("outpoint", outpoint));

  const limbo = detail.limboSat;
  if (typeof limbo === "number") lines.push(ctx("limbo", `${formatSats(limbo)} sats`));

  const age = detail.ageHours;
  if (typeof age === "number") lines.push(ctx("age", `${Math.round(age)}h`));

  const attempts = detail.attempts;
  if (typeof attempts === "number") lines.push(ctx("attempts", String(attempts)));

  return lines;
}

const BUMP_FEE_SANITY =
  "sanity-check this rate against current mempool conditions before running.";
const NO_RATE_NOTE = "no suggested rate — read requested_sat_per_vbyte from step 1";
const NO_OUTPOINT_NOTE =
  "no sweep outpoint on this card — take the full outpoint from step 1 output (never invent an output index)";

/** D-10 stuck-sweep CPFP via `lncli wallet bumpfee` (outpoint POSITIONAL). */
function bumpFeeExport(card: InsightCard, params: RemediateParams): ExportBlock {
  const contextLines = remediateContextLines(card);
  const safetyLines = [BUMP_FEE_SANITY];

  // The ONLY honest output-index source is the sweep target (params carries the
  // txid only). Gate-then-interpolate the assembled outpoint through safeToken —
  // `outpointTok` is non-null ONLY when it passes CHANNEL_POINT_RE (E2/E5).
  const target = card.target;
  const rawOutpoint =
    target.kind === "sweep"
      ? `${target.outpointTxid}:${target.outpointOutputIndex}`
      : null;
  const outpointTok = rawOutpoint === null ? null : safeToken(rawOutpoint, CHANNEL_POINT_RE);

  // Step 1 — verify (read-only); jq-filter the outpoint in the copyAll comment
  // ONLY when it is format-valid (E3: gate on the validated token, not `!==
  // null`, so a malformed outpoint never rides even a `#`-commented line).
  const verifyComment =
    outpointTok !== null ? `   # find ${outpointTok}, check broadcast_attempts` : "";
  const step1: ExportStep = {
    label: "step 1 — verify (read-only)",
    command: `lncli wallet pendingsweeps${verifyComment}`,
    note: null,
  };

  // Step 2 — bump (CPFP/RBF). Honest no-rate / no-outpoint states never invent.
  const rate = safeSatPerVbyte(params.suggestedSatPerVbyte);
  let step2: ExportStep;
  if (outpointTok === null) {
    step2 = { label: "step 2 — bump", command: null, note: NO_OUTPOINT_NOTE };
  } else if (rate === null) {
    step2 = { label: "step 2 — bump", command: null, note: NO_RATE_NOTE };
  } else {
    step2 = {
      label: "step 2 — bump",
      command: `lncli wallet bumpfee --sat_per_vbyte ${rate} ${outpointTok}`,
      note: null,
    };
  }

  const steps = [step1, step2];
  let copyAll = assembleCopyAll(contextLines, safetyLines, steps);
  // Pitfall 4: bumpforceclosefee takes a channel_point — render ONLY as a
  // commented anchor-channel alternative when the channelPoint gates clean (E2).
  const anchorTok =
    params.channelPoint === null ? null : safeToken(params.channelPoint, CHANNEL_POINT_RE);
  if (anchorTok !== null) {
    copyAll += `\n# alternative (anchor channels): lncli wallet bumpforceclosefee ${anchorTok}`;
  }

  return { title: "remediate_pending — stuck sweep (bump_fee)", contextLines, safetyLines, steps, copyAll };
}

const RESTART_KEY_STEPS = [
  "(1) coordinate fleet peers — run 05-fleet-coordination.sh --target-pubkey <pubkey> --action disable on the counterparties;",
  "(2) drain HTLCs + restart via 01-safe-lnd-restart.sh --restart (the drain wrapper — NOT a raw restart);",
  "(3) verify back: lncli getinfo shows synced_to_chain true, then re-enable peers;",
  "(4) re-check lncli pendingchannels for maturity progression.",
].join(" ");
const RESTART_AP11_SAFETY =
  "do NOT auto-restart — if a close-storm is in progress, freeze and preserve logs first.";

/** D-09 FC-past-maturity restart RUNBOOK — key steps + script pointers, no run. */
function restartProcedureExport(card: InsightCard, params: RemediateParams): ExportBlock {
  const contextLines = remediateContextLines(card);
  // Blocks past maturity rode in evidence.observed.
  if (typeof card.evidence.observed === "number") {
    contextLines.push(ctx("blocks_past_maturity", String(card.evidence.observed)));
  }
  const safetyLines = [RESTART_AP11_SAFETY];

  const step1: ExportStep = {
    label: "step 1 — verify (read-only)",
    command: `lncli pendingchannels   # ${pendingChannelsFilterNote(params.channelPoint)}`,
    note: null,
  };
  // No runnable restart command exists by design (T-04-14).
  const step2: ExportStep = { label: "step 2 — coordinated restart (key steps)", command: null, note: RESTART_KEY_STEPS };

  const steps = [step1, step2];
  return {
    title: "remediate_pending — force-close past maturity (restart_procedure)",
    contextLines,
    safetyLines,
    steps,
    copyAll: assembleCopyAll(contextLines, safetyLines, steps),
  };
}

const AGED_FUNDING_GUIDANCE = [
  "check the funding tx on-chain/mempool: bitcoin-cli getmempoolentry <funding_txid> (gone from mempool = re-broadcast/CPFP territory);",
  "if WE initiated and the tx is underfee'd, CPFP via a wallet-controlled output: lncli wallet bumpfee --sat_per_vbyte <rate> <change_index from lncli listunspent --min_confs=0>;",
  "if the PEER initiated, LND auto-forgets unconfirmed inbound channels after 2016 blocks (~2 weeks) — usually no local action.",
].join(" ");
const ABANDON_DANGER =
  "DANGER: lncli abandonchannel is dev-mode-gated (--i_know_what_i_am_doing) and can LOSE FUNDS if the funding tx ever confirms — intentionally NOT a runnable step.";

/** RESEARCH §3 aged_funding proposed runbook — verify + guidance + danger note. */
function agedFundingExport(card: InsightCard, params: RemediateParams): ExportBlock {
  const contextLines = remediateContextLines(card);
  const safetyLines = [ABANDON_DANGER];

  const step1: ExportStep = {
    label: "step 1 — verify (read-only)",
    command: `lncli pendingchannels   # ${pendingChannelsFilterNote(params.channelPoint)}`,
    note: null,
  };
  const step2: ExportStep = { label: "step 2 — remediation guidance", command: null, note: AGED_FUNDING_GUIDANCE };

  const steps = [step1, step2];
  return {
    title: "remediate_pending — aged pending open (aged_funding)",
    contextLines,
    safetyLines,
    steps,
    copyAll: assembleCopyAll(contextLines, safetyLines, steps),
  };
}

/** PENDING-03 sub-dispatch on params.case to the three runbook builders. */
function buildRemediateExport(card: InsightCard): ExportBlock {
  const params = (card.suggestedAction as { params: RemediateParams }).params;
  switch (params.case) {
    case "bump_fee":
      return bumpFeeExport(card, params);
    case "restart_procedure":
      return restartProcedureExport(card, params);
    case "aged_funding":
      return agedFundingExport(card, params);
  }
}

// ── dispatcher ────────────────────────────────────────────────────────────────

/**
 * Build the export block for an actionable insight card, or null when the card
 * is not exportable. Gate order (RESEARCH Pitfall 5 + Pattern 1):
 *   1. structural: null action / non-exportable type / fleet (node null) → null
 *   2. validateActionForExport → on failure the locked WITHHELD block
 *   3. LDK backend → the locked honest manual-procedure fallback
 *   4. dispatch to the per-type pure builder
 */
export function buildExportBlock(card: InsightCard): ExportBlock | null {
  const action = card.suggestedAction;
  // 1. Structural gate — never inspect evidence.detail.withheldAction.
  if (action === null) return null;
  if (!EXPORTABLE_TYPES.has(action.type)) return null;
  if (card.node === null) return null;

  // 2. Validate every command-bound param BEFORE any interpolation.
  const result = validateActionForExport(action);
  if (!result.ok) return withheldBlock(action.type);

  // 3. LDK locked fallback — full context echo, no runnable command.
  if (card.node.backend === "ldk") {
    const contextLines = ldkContextLines(card);
    return buildLdkFallback(action.type, contextLines);
  }

  // 4. Dispatch.
  switch (action.type) {
    case "close_channel":
      return buildCloseExport(card);
    case "rebalance":
      return buildRebalanceExport(card);
    case "remediate_pending":
      return buildRemediateExport(card);
    default:
      return null;
  }
}

/** Full context echo for the LDK fallback, reusing the per-type echo shapes. */
function ldkContextLines(card: InsightCard): { key: string; value: string }[] {
  const action = card.suggestedAction!;
  if (action.type === "close_channel") return closeContextLines(card);
  if (action.type === "rebalance") {
    const node = card.node!;
    const detail = card.evidence.detail ?? {};
    const p = action.params;
    const partnerAlias = detail.partnerAlias;
    const partnerLine =
      typeof partnerAlias === "string" && partnerAlias.length > 0
        ? partnerAlias
        : truncPubkey(p.partnerPubkey);
    return [
      ctx("node", `${node.alias ?? node.pubkey} (${node.backend})`),
      ctx("partner", partnerLine),
      ctx("amount", `${formatSats(p.amountSat)} sats`),
      ctx("direction", directionWords(p.direction)),
    ];
  }
  // remediate_pending
  return remediateContextLines(card);
}
