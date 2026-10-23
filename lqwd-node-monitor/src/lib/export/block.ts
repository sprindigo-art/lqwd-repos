// =====================================================
// ExportBlock contract — Phase 5 EXPORT-01 / PENDING-03
// =====================================================
// Pure type module: zero module dependencies, no classes — serializable only.
// ExportBlock/ExportStep cross the Server-Component → client-leaf boundary as
// props, so every field is a string, number, or null (no Date, no functions,
// no class instances). Raw values stay RAW here; the AFM-002 formatter
// (src/lib/format/units.ts) applies at assembly of comment/UI lines only —
// never inside a bare `command` string.

/** A single export step: a labelled command (or honest no-command state). */
export interface ExportStep {
  /** e.g. "step 1 — verify (read-only)" / "step 2 — close". */
  label: string;
  /** Bare command(s), newline-joined; null for honest-state steps. */
  command: string | null;
  /** Honest-state copy or guidance when command is null. */
  note: string | null;
}

/** The full export block rendered below an actionable insight card. */
export interface ExportBlock {
  /** e.g. "close_channel — coop close". */
  title: string;
  /** UI key/value echo rows. */
  contextLines: { key: string; value: string }[];
  /** Visible safety notes (D-05). */
  safetyLines: string[];
  steps: ExportStep[];
  /** Full annotated shell snippet; null = nothing copyable. */
  copyAll: string | null;
}
