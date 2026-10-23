// Single sanctioned CSV path for the entire codebase (NODE-02 security boundary).
// No ad-hoc CSV string concatenation is permitted anywhere else — every cell, row,
// and document routes through these named exports. Third-party CSV serialization
// libraries are FORBIDDEN by the T-02-SC supply-chain allowlist; this module is
// the deliberate, unit-tested hand-rolled exception (RESEARCH Pitfall 8).
//
// Threat model: Lightning peer aliases (peer_alias_in/out, lnd_alias) are arbitrary
// attacker-controlled strings broadcast on the public network. This module is the
// boundary between the warehouse and the operator's spreadsheet (T-03-04) and the
// Content-Disposition header (T-03-05).

/**
 * Leading characters that make Excel/Sheets evaluate a cell as a formula
 * (OWASP CSV-injection guidance): `=`, `+`, `-`, `@`, tab, CR.
 */
export const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Serialize one cell per RFC 4180 with optional formula-injection escaping.
 *
 * `escapeFormula` is the caller's per-column decision (D-08): text columns
 * (aliases, free text) MUST escape; raw numeric/hex/pubkey columns are
 * pattern-constrained and stay verbatim for lossless audit. When a column's
 * type is unknown, default to `escapeFormula: true` (A5 — under-escaping is
 * the risk).
 *
 * Escape order matters: the leading apostrophe is applied BEFORE RFC-4180
 * quoting so the apostrophe itself is inside the quoted value.
 */
export function csvCell(
  value: string | null | undefined,
  opts: { escapeFormula: boolean }
): string {
  if (value === null || value === undefined) return "";
  let v = value;
  if (opts.escapeFormula && FORMULA_TRIGGER.test(v)) v = `'${v}`; // text columns only (aliases)
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Join pre-serialized cells (already through csvCell) into one CSV record. */
export function csvRow(cells: string[]): string {
  return cells.join(",");
}

/** Join records into a full RFC-4180 document: CRLF line endings + trailing CRLF. */
export function csvDocument(lines: string[]): string {
  return lines.join("\r\n") + "\r\n";
}

/**
 * Sanitize a provenance value so an attacker-controlled alias can never break
 * out of its `# ` comment line (T-03-04 adjunct — comment lines bypass csvCell
 * quoting). Two vectors are neutralized (CR-01):
 *  - vertical whitespace (CR/LF, U+2028/U+2029) would inject new CSV rows;
 *  - commas and double quotes would split the comment line into extra cells on
 *    spreadsheet import (CSV has no comment syntax), letting a payload such as
 *    `x,=HYPERLINK(...)` land in a fresh cell where the leading `=` is evaluated
 *    as a formula. With commas stripped, every provenance line imports as a
 *    single cell that begins with `#` — never a formula trigger.
 */
function provenanceValue(s: string): string {
  return s.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[",]/g, " ");
}

export interface ProvenanceParams {
  alias: string;
  pubkey: string;
  table: string;
  window: string;
  exportedAt: Date;
  dataAsOf: Date | null;
}

/**
 * D-10 provenance block: five `# key: value` comment lines emitted before the
 * header row — node (alias + pubkey on one line), table, window, exported-at
 * (ISO-8601 UTC), data-as-of (the view's freshness stamp; "unknown" when null).
 */
export function buildProvenance(p: ProvenanceParams): string[] {
  return [
    `# node: ${provenanceValue(p.alias)} (${provenanceValue(p.pubkey)})`,
    `# table: ${provenanceValue(p.table)}`,
    `# window: ${provenanceValue(p.window)}`,
    `# exported-at: ${p.exportedAt.toISOString()}`,
    `# data-as-of: ${p.dataAsOf ? p.dataAsOf.toISOString() : "unknown"}`,
  ];
}

/**
 * Content-Disposition header-injection guard (T-03-05, RESEARCH Pitfall 8).
 * The ONLY path an alias may take into a filename: replace every run of
 * characters outside [A-Za-z0-9_-] with a single `_`, collapse repeats, trim
 * edge underscores, and fall back to "node" when nothing survives.
 */
export function sanitizeFilenamePart(s: string): string {
  const cleaned = s
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned === "" ? "node" : cleaned;
}

/**
 * D-10 export filename: `{sanitized-alias}_{table}_{window}_{YYYYMMDDTHHmmssZ}.csv`.
 * The timestamp is compact UTC derived from toISOString() with separators and
 * milliseconds stripped.
 */
export function buildExportFilename(
  alias: string,
  table: string,
  window: string,
  at: Date
): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
  return `${sanitizeFilenamePart(alias)}_${table}_${window}_${stamp}.csv`;
}
