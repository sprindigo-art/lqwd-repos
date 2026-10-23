// =====================================================
// sanitizeCommentText — Phase 5 EXPORT-01 / PENDING-03 (T-05-02 / Pitfall 2)
// =====================================================
// Pure module: no server-only imports, no DB, no env — test-imported and safe
// anywhere.
//
// T-04-19 lineage: a peer-chosen alias is REMOTE-CONTROLLED data, and a `#`
// shell comment is only inert until a newline breaks out of it. Any
// card-sourced string that lands inside a comment line (aliases, peer labels)
// must first have its breakout class neutralized. RESEARCH Pitfall 2: strip
// control characters (which include CR/LF) and the shell-active set
// (`` ` ``, `$`, `\`), then cap length — comments stay single-line and inert.

/**
 * Characters removed from any card-sourced string before it enters a `#`
 * comment line: all C0/C1 control chars (`\x00-\x1F`, `\x7F` — this covers
 * `\n`, `\r`, and `\t`) plus the shell-active set `` ` ``, `$`, `\`.
 */
const COMMENT_UNSAFE_RE = /[\x00-\x1F\x7F`$\\]/g;

/**
 * Neutralize a card-sourced string for use inside a `#` comment line: strip
 * control chars + shell-active chars, then truncate to `maxLen`. Returns inert
 * single-line text — never sanitize-and-trust, this is containment only.
 */
export function sanitizeCommentText(input: string, maxLen = 120): string {
  return input.replace(COMMENT_UNSAFE_RE, "").slice(0, maxLen);
}
