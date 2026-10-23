import type { InsightCard, SuggestedAction } from "@/lib/insight/types";
import type { InsightKnobs } from "@/lib/insight/config";
import type { PolicyChange } from "@/lib/insight/fee-history";

// =====================================================
// INSIGHT-06 — self-guardrail post-passes (D-14 / D-15 / D-16)
// =====================================================
// Pure module: no server-only imports, no DB — three non-mutating post-passes
// over the computed card set. The tool must not recommend actions that
// reproduce the patterns it detects. ENGINE ORDER (apply exactly this way):
//
//   1. applyHysteresis        — hold churn-y update_fee cards (D-15)
//   2. applySuppression       — withhold ALL writes on flagged nodes (D-14)
//   3. applyRateLimitGuidance — count surviving writes, guidance text (D-16)
//
// Hysteresis runs first so its state string lands on every fee card before
// suppression can null the action; suppression runs before the rate-limit
// counter so suppressed writes never inflate the per-node count.
//
// Flag-source discipline (Pitfall 5 / T-04-17): suppression takes a
// Set<pubkey> built UPSTREAM from the typed scorecard `tier1Breach` field on
// the forceClose dimension (AP-11) — NEVER from display-label string
// matching, which an operator label retune would silently disable. The Set
// shape also lets deterministic AP-12 flags slot in when log ingestion
// lands. LLM cards never enter the set and carry null actions structurally
// (D-12) — this module never inspects provenance.

/**
 * Write-type actions — the ones Phases 5/6 could turn into fleet mutations.
 * `remediate_pending` is included (T-04-16): although Phase 5 renders it as an
 * operator-run runbook rather than a signed policy write, it still carries live
 * params (channelPoint / outpointTxid / suggestedSatPerVbyte) that must be
 * withheld on AP-11/AP-12-flagged nodes — D-14 withholds ALL writes, no
 * exceptions. `investigate` is the only non-write action and is never counted.
 */
export const WRITE_ACTION_TYPES: ReadonlySet<SuggestedAction["type"]> = new Set([
  "update_fee",
  "close_channel",
  "rebalance",
  "remediate_pending",
]);

// D-14 exact, user-visible reason — rendered verbatim on SUPPRESSED cards.
const SUPPRESSION_REASON = "node flagged AP-11 — write recommendations withheld";

const MS_PER_HOUR = 3_600_000;

/** New card with one evidence.detail entry added (never mutates the input card). */
function withDetail(card: InsightCard, key: string, value: string | number): InsightCard {
  return {
    ...card,
    evidence: {
      ...card.evidence,
      detail: { ...(card.evidence.detail ?? {}), [key]: value },
    },
  };
}

/**
 * D-15 — stateless fee hysteresis. Only touches cards whose suggestedAction
 * is `update_fee`. Min-delta evaluates from the card's own params
 * (|suggestedPpm − currentPpm|); min-interval from the supplied
 * lastPolicyChange reconstruction (fee-history.ts — no persistence, D-07).
 * Held cards KEEP the card but null the action; EVERY fee card (held or
 * passing) surfaces its state in evidence.detail.hysteresis. Same-direction
 * nudges inside the interval are also held — conservative D-15 reading.
 * No observed change (null / missing map entry) passes — the LDK-sparse
 * degradation documented in fee-history.ts.
 */
export function applyHysteresis(
  cards: InsightCard[],
  historyByChanId: Map<string, PolicyChange | null>,
  config: Pick<InsightKnobs, "feeMinDeltaPpm" | "feeMinIntervalHours">,
  now: Date = new Date(),
): InsightCard[] {
  return cards.map((card) => {
    const action = card.suggestedAction;
    if (action === null || action.type !== "update_fee") return { ...card };

    const delta = Math.abs(action.params.suggestedPpm - action.params.currentPpm);
    if (delta < config.feeMinDeltaPpm) {
      return {
        ...withDetail(card, "hysteresis", `held: delta ${delta} < ${config.feeMinDeltaPpm}`),
        suggestedAction: null,
      };
    }

    const change = historyByChanId.get(action.params.chanId) ?? null;
    if (change !== null) {
      const hoursSince = Math.floor((now.getTime() - change.changedAt.getTime()) / MS_PER_HOUR);
      if (hoursSince < config.feeMinIntervalHours) {
        return {
          ...withDetail(
            card,
            "hysteresis",
            `held: last change ${hoursSince}h ago < ${config.feeMinIntervalHours}h`,
          ),
          suggestedAction: null,
        };
      }
    }

    return withDetail(card, "hysteresis", "clear");
  });
}

/**
 * D-14 — visible suppression of write recommendations on flagged nodes.
 * For every card with a write-type action on a flagged node: KEEP the card
 * (fail-loud rendering), set the exact suppression reason, NULL the
 * suggestedAction so params never reach the Phase 5/6 contract surface
 * (T-04-16), and echo the would-be action type as a display string in
 * evidence.detail.withheldAction so the operator sees what was withheld.
 */
export function applySuppression(
  cards: InsightCard[],
  flaggedPubkeys: ReadonlySet<string>,
): InsightCard[] {
  return cards.map((card) => {
    const action = card.suggestedAction;
    if (action === null || !WRITE_ACTION_TYPES.has(action.type)) return { ...card };
    if (card.node === null || !flaggedPubkeys.has(card.node.pubkey)) return { ...card };

    return {
      ...withDetail(card, "withheldAction", action.type),
      suggestedAction: null,
      suppressed: { active: true, reason: SUPPRESSION_REASON },
    };
  });
}

/**
 * D-16 — per-node write rate-limit GUIDANCE (text only, no enforcement).
 * Counts unsuppressed write cards per pubkey in this load and stamps the
 * guidance string on each of them; non-write and suppressed cards keep null.
 */
export function applyRateLimitGuidance(
  cards: InsightCard[],
  config: Pick<InsightKnobs, "maxWritesPerDay">,
): InsightCard[] {
  const isCountedWrite = (card: InsightCard): boolean =>
    card.node !== null &&
    card.suggestedAction !== null &&
    WRITE_ACTION_TYPES.has(card.suggestedAction.type) &&
    !card.suppressed.active;

  const writesPerNode = new Map<string, number>();
  for (const card of cards) {
    if (!isCountedWrite(card)) continue;
    const pubkey = card.node!.pubkey;
    writesPerNode.set(pubkey, (writesPerNode.get(pubkey) ?? 0) + 1);
  }

  return cards.map((card) => {
    if (!isCountedWrite(card)) return { ...card };
    const n = writesPerNode.get(card.node!.pubkey) ?? 0;
    return {
      ...card,
      rateLimitGuidance: `${n} write recommendation(s) for this node this load — suggested max ${config.maxWritesPerDay}/day`,
    };
  });
}

// =====================================================
// AIX-01 — assertAdvisoryOnly: text-level command-free guardrail (D-13 / T-17-02)
// =====================================================
// The NON-NEGOTIABLE post-check on LLM narration output. The incident "read" must
// stay ADVISORY prose ("this usually indicates X, worth checking Y") and NEVER
// surface a runnable command, `lncli`/`lncmd` invocation, config edit, shell
// fence, `$ ` prompt, or a numbered "do X then Y" remediation. This is the last
// line of the fleet-write-safety invariant (project core value) — the model is
// told to stay advisory (system prompt), and this gate proves it did before the
// text ever reaches the operator.
//
// Pure + text-level: NO DB, NO `server-only`, and NO import of the legitimate
// human-run command-EXPORT module (where real `lncli` strings live for the
// operator export flow). This guardrail applies ONLY to LLM narration text.
// The false-positive boundary is deliberate: plain triage prose must pass.

// Runnable-command / tool-invocation signatures. Case-insensitive.
//
// WR-01: the bare daemon/subject nouns `bitcoind`, `docker`, `psql` are NOT listed
// as invocations — `bitcoind` is a first-class incident LAYER and the dominant
// critical driver, so an advisory sentence NARRATING it ("the bitcoind backend on
// lnd-france is unreachable") is prose, not a command, and must PASS. Tokens that
// are ONLY ever commands (`lncli`, `lncmd`, `systemctl`, `bitcoin-cli`, `pg_ctl`,
// `sudo`) stay bare-word. Where a subject noun could still be a real invocation we
// ANCHOR to a following subcommand/flag instead of deleting outright: `docker` must
// be followed by a subcommand, `psql` by a flag. `bitcoind`'s CLI surface is already
// covered by `bitcoin-cli`, so its bare noun is dropped entirely.
const COMMAND_SIGNATURES: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\blncli\b/i, reason: "contains an lncli invocation" },
  { re: /\blncmd\b/i, reason: "contains an lncmd invocation" },
  { re: /\bsystemctl\b/i, reason: "contains a systemctl invocation" },
  { re: /\bbitcoin-cli\b/i, reason: "contains a bitcoin-cli invocation" },
  { re: /\bsudo\b/i, reason: "contains a sudo invocation" },
  { re: /\bpg_ctl\b/i, reason: "contains a pg_ctl invocation" },
  // Anchored: a real `docker` invocation carries a subcommand — the bare noun as a
  // subject ("the docker daemon looks unhealthy") passes.
  {
    re: /\bdocker\s+(run|exec|restart|stop|start|compose|ps|logs|kill|rm|pull)\b/i,
    reason: "contains a docker invocation",
  },
  // Anchored: a real `psql` invocation carries a flag; bare "psql connectivity is
  // degraded" as prose passes.
  { re: /\bpsql\s+-/i, reason: "contains a psql invocation" },
];

/** A fenced code block — no code belongs in an advisory read. */
const SHELL_FENCE = /```/;
/** A line that opens with a `$ ` shell prompt. */
const SHELL_PROMPT = /^[ \t]*\$ /m;
/** A single "N. …" imperative step. Two or more of these = a runnable step-list. */
const STEP_ITEM = /^[ \t]*\d+\.\s+\S/gm;
/** A config-file edit reference (e.g. `lnd.conf`, `bitcoin.conf`) or a `--config` flag. */
const CONFIG_EDIT = /\b[\w-]+\.conf\b|--config\b/i;

/**
 * Assert that a piece of LLM narration is advisory-only (command-free). Returns
 * `{ ok: true }` for plain triage prose; `{ ok: false, reason }` the moment it
 * matches any runnable-command / imperative-remediation signature. Case-insensitive
 * throughout. This is a hard gate — a caller that gets `{ ok: false }` withholds
 * the read entirely (the deterministic incident card stands alone).
 */
export function assertAdvisoryOnly(text: string): { ok: boolean; reason?: string } {
  for (const { re, reason } of COMMAND_SIGNATURES) {
    if (re.test(text)) return { ok: false, reason };
  }
  if (SHELL_FENCE.test(text)) return { ok: false, reason: "contains a code fence" };
  if (SHELL_PROMPT.test(text)) return { ok: false, reason: "contains a shell prompt line" };
  const steps = text.match(STEP_ITEM) ?? [];
  if (steps.length >= 2) return { ok: false, reason: "contains a numbered step-list" };
  if (CONFIG_EDIT.test(text)) return { ok: false, reason: "contains a config-edit reference" };
  return { ok: true };
}
