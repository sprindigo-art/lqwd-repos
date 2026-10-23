// =====================================================
// QUEUE-02 — PURE canonicalizer + signed-payload builder (D-04)
// =====================================================
// The cross-phase HMAC freeze. The canonical string this module emits is hashed
// BYTE-IDENTICALLY by the Phase 7 bash `openssl` verifier (CLAUDE.md §4):
//   openssl dgst -sha256 -hmac "$SECRET" < canonical_payload
// so the dashboard stores the exact canonical string verbatim on the command row
// and bash never re-serializes JSON (no `jq`, no base64 — RESEARCH Pitfall 1).
//
// PURE MODULE — no server-side guard import, no DB, no env. Test-importable
// anywhere (RESEARCH Pitfall 7). The frozen `update_fee` params are flat
// strings/numbers, so a ~6-line recursive key-sort serializer is sufficient —
// do NOT add an RFC-8785 dependency (over-engineering + slopsquat risk,
// RESEARCH §State of the Art).

/**
 * Recursively key-sorted, whitespace-free JSON serializer. Object keys are
 * emitted in deterministic sorted order so the output is stable across input
 * key ordering; arrays preserve order; leaves serialize via `JSON.stringify`.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort(); // deterministic key order
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
}

/**
 * The signed payload (D-04): the five fields newline-joined in EXACTLY the order
 * nodePubkey, commandId, actionType, canonicalParams, expiresAt. The
 * `canonicalParams` substring is the verbatim `canonicalize(params)` output;
 * this whole string is stored on the row and hashed directly by Phase 7.
 */
export function buildSignedPayload(p: {
  nodePubkey: string;
  commandId: string;
  actionType: string;
  canonicalParams: string;
  expiresAt: string;
}): string {
  return [p.nodePubkey, p.commandId, p.actionType, p.canonicalParams, p.expiresAt].join("\n");
}
