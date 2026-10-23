// Pure module: no server runtime imports, no DB, no AI SDK — fixture-testable anywhere.
// =====================================================
// ai-band.ts — the deterministic "what needs you now" line builder (OVW-02/D-04/D-05)
// =====================================================
// Builds the 1–4 advisory `AiReadLine`s the navy `AiReadPanel` renders, straight
// off the already-engine-ranked grouped incidents. Determinism is the source of
// truth:
//   • D-05 / OVW-02 — ZERO LLM dependency. The optional, env-gated rephrase lives
//     in the EXISTING server-recomputing `narrate()` action; this module adds NO
//     new LLM path. It mirrors the pure-builder/optional-LLM split of
//     `insight/narrative.ts` (the `buildNarrationPrompt` half) but stays even
//     simpler — there is no prompt here, just inert line copy.
//   • D-04 — line ORDER follows the ranked incident order; the band NEVER re-ranks
//     (no `.sort`, Pitfall 3). Each line's `sev` is the incident's own severity.
//   • Advisory-only BY CONSTRUCTION (T-12-01, project core value) — `AiReadLine`
//     has no action/param/command field, and `buildBandLines` adds none. The band
//     can never emit a runnable command; the `Object.keys` test pins this.
//
// Inputs are never mutated. The optional LLM rephrase, when enabled elsewhere,
// only restyles these same lines' prose — never their `sev` or which lines appear.

import type { AiReadLine } from "@/components/df/AiReadPanel";
import type { GroupedIncident } from "@/lib/overview/incidents";

/** The band renders at most this many advisory lines (UI-SPEC §2: 1–4 lines). */
const MAX_BAND_LINES = 4;

/**
 * Build the deterministic advisory band lines from the top-ranked grouped
 * incidents. Takes the FIRST ≤4 incidents IN ORDER (no re-sort — D-04/Pitfall 3),
 * templating each into an inert `{ sev, head, body }` line. Returns `[]` for an
 * empty queue — the page renders the calm all-clear state instead.
 *
 * CRITICAL: never add an `action`/`param`/`command` field to a line. `AiReadLine`
 * has none, and that is the structural advisory-only guarantee (T-12-01).
 */
export function buildBandLines(incidents: GroupedIncident[]): AiReadLine[] {
  return incidents.slice(0, MAX_BAND_LINES).map((incident) => ({
    // Per-line severity straight off the ranked incident (D-04) — no re-grading.
    sev: incident.severity,
    // Bold lead clause: the entity that needs attention. Plain operator language.
    head: `${incident.entityLabel} — `,
    // Muted continuation: the one-line operator reason already on the incident.
    body: incident.why,
  }));
}

/** The summary the calm all-clear hero needs (deterministic, no DB). */
export interface CalmSummary {
  /** count of healthy, fresh nodes (the <n> in the calm copy). */
  nodeCount: number;
  /** humanized time since the last incident resolved (the <t>), or null when none. */
  lastIncidentAgo?: string | null;
}

/** The all-clear state the `AiReadPanel` renders in `allClear` mode. */
export interface CalmState {
  allClear: true;
  /** Continuation sentence after the frozen `AI_ALL_CLEAR_LEAD` ("Nothing needs you right now."). */
  calmDetail: string;
}

/**
 * Build the all-clear calm-state copy for the AI band's calm hero (OVW-04/D-08).
 * The frozen lead ("Nothing needs you right now.") lives in `AiReadPanel`; this
 * supplies the continuation per UI-SPEC §Copywriting:
 *   "All <n> nodes are healthy and reporting fresh — the last incident resolved <t> ago."
 * The last-incident clause is dropped honestly when there is no prior incident.
 */
export function buildCalmState(summary: CalmSummary): CalmState {
  const { nodeCount, lastIncidentAgo } = summary;
  const lastIncidentClause = lastIncidentAgo
    ? ` — the last incident resolved ${lastIncidentAgo} ago`
    : "";
  const calmDetail = `All ${nodeCount} nodes are healthy and reporting fresh${lastIncidentClause}.`;
  return { allClear: true as const, calmDetail };
}
