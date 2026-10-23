import { DetectorIdSchema, SeveritySchema, SuggestedActionSchema } from "@/lib/insight/schema";
import type { DetectorId, Severity } from "@/lib/insight/types";
import type { ActionFacetKey, FacetState } from "@/lib/insight/triage";

// =====================================================
// triage-facets — search-param ⇄ facet-state codec (Phase 7, INBOX-02)
// =====================================================
// Pure module: NO server-side-only imports, NO DB — test-imported and safe
// anywhere. The URL is the single source of truth for the inbox facet filter
// (D-09): the server reads `searchParams`, narrows the spine, and renders only
// the visible set. This codec turns untrusted, operator-editable query params
// into a typed, WHITELISTED FacetState and back.
//
// Security (V5 / Pitfall 3, threat T-07-01): every facet value is checked
// against a closed vocabulary before it is ever used — ?sev against the
// 3-severity enum, ?node against the 66-hex lowercase PUBKEY_RE (the exact
// queue.ts line-24 discipline), ?signal against DetectorIdSchema, ?action
// against the action-type union. Invalid values are SILENTLY DROPPED (ignored
// facet), never thrown — a bad URL degrades to a wider view, not an error page.
//
// Orthogonality (D-09/D-10, threat T-07-02): the codec never reads or writes the
// ?card key. ?card is the drawer's own search param, read client-side; facet
// navigation must round-trip without clobbering it.

export type { FacetState };

/** The 66-hex lowercase pubkey gate — identical to queue.ts line 24. */
const PUBKEY_RE = /^[0-9a-f]{66}$/;

// ── Closed vocabularies (derived from the FROZEN schema, never hand-listed) ──
const SEVERITY_VALUES = new Set<Severity>(SeveritySchema.options);
const SIGNAL_VALUES = new Set<DetectorId>(DetectorIdSchema.options);

/** All 5 suggestedAction `type` literals, derived from the discriminated union. */
const ACTION_TYPE_VALUES = SuggestedActionSchema.options.map(
  (member) => member.shape.type.value,
) as ActionFacetKey[];

/** The action-facet vocabulary: the 5 action types plus the synthetic "none". */
export const ACTION_FACET_VALUES: ReadonlySet<ActionFacetKey> = new Set<ActionFacetKey>([
  ...ACTION_TYPE_VALUES,
  "none",
]);

// ── Read helpers ─────────────────────────────────────────────────────────────

/**
 * Collect all raw values for a key from a URLSearchParams: both repeated keys
 * (`?sev=a&sev=b`) and CSV (`?sev=a,b`) are supported. Empty tokens are dropped.
 */
function readRaw(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  for (const value of params.getAll(key)) {
    for (const token of value.split(",")) {
      const trimmed = token.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

/** Whitelist + dedupe, preserving first-seen order. Invalid values dropped. */
function whitelist<T extends string>(raw: string[], allow: (v: string) => v is T): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of raw) {
    if (!allow(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

const isSeverity = (v: string): v is Severity => SEVERITY_VALUES.has(v as Severity);
const isSignal = (v: string): v is DetectorId => SIGNAL_VALUES.has(v as DetectorId);
const isAction = (v: string): v is ActionFacetKey =>
  ACTION_FACET_VALUES.has(v as ActionFacetKey);
const isPubkey = (v: string): v is string => PUBKEY_RE.test(v);

/**
 * Parse a URLSearchParams (or the Next `searchParams` plain object via
 * `new URLSearchParams(...)`) into a whitelisted FacetState. The ?card key is
 * ignored entirely. Never throws on bad input.
 */
export function parseFacets(params: URLSearchParams): FacetState {
  return {
    sev: whitelist(readRaw(params, "sev"), isSeverity),
    node: whitelist(readRaw(params, "node"), isPubkey),
    signal: whitelist(readRaw(params, "signal"), isSignal),
    action: whitelist(readRaw(params, "action"), isAction),
  };
}

/**
 * Serialize a FacetState back to a deterministic query string. Keys are emitted
 * in a fixed order (sev, node, signal, action), each as a repeated key, values
 * in the FacetState's own order. An empty state yields the empty string. The
 * ?card key is never emitted (orthogonal). `serialize(parse(x))` is stable.
 */
export function serializeFacets(state: FacetState): string {
  const sp = new URLSearchParams();
  for (const value of state.sev) sp.append("sev", value);
  for (const value of state.node) sp.append("node", value);
  for (const value of state.signal) sp.append("signal", value);
  for (const value of state.action) sp.append("action", value);
  return sp.toString();
}
