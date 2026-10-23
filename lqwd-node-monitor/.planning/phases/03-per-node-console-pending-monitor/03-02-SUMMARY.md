---
phase: 03-per-node-console-pending-monitor
plan: 02
subsystem: csv-export
tags: [csv, rfc-4180, security, formula-injection, header-injection, tdd]
requires: []
provides:
  - "src/lib/csv/serialize.ts — csvCell, csvRow, csvDocument, buildProvenance, sanitizeFilenamePart, buildExportFilename"
affects:
  - "03-07 (NODE-02 export route consumes these primitives)"
tech-stack:
  added: []
  patterns:
    - "Single-sanctioned-path banner module (mirrors AFM-002 units.ts) — no ad-hoc CSV concat permitted elsewhere"
    - "Formula escape applied BEFORE RFC-4180 quoting (composition order)"
key-files:
  created:
    - src/lib/csv/serialize.ts
    - src/lib/csv/serialize.test.ts
  modified: []
decisions:
  - "Provenance values collapse CR/LF/U+2028/U+2029 to a space — comment lines bypass csvCell quoting, so attacker aliases must not break out of the # block (Rule 2 addition)"
  - "sanitizeFilenamePart replaces disallowed runs with single _, collapses repeats, trims edge underscores, falls back to 'node'"
metrics:
  duration: "~5 min"
  completed: "2026-06-10T21:29:00Z"
  tasks: 2
  files: 2
---

# Phase 3 Plan 02: Hand-Rolled CSV Serializer Summary

RFC-4180 CSV serializer with OWASP formula-injection escaping, D-10 provenance comment block, and Content-Disposition filename sanitization — hand-rolled with 29 unit tests because the T-02-SC supply-chain allowlist forbids CSV libraries.

## What Was Built

`src/lib/csv/serialize.ts` is the single sanctioned CSV path (banner mirrors the AFM-002 units.ts convention):

- **`FORMULA_TRIGGER`** — `/^[=+\-@\t\r]/`, exported for the test suite; matches OWASP CSV-injection trigger characters.
- **`csvCell(value, { escapeFormula })`** — null/undefined → empty string; leading `'` when escaping is on and the trigger matches (escape applied BEFORE quoting so the apostrophe sits inside the quotes); RFC-4180 quote-and-double when the value contains `"`, `,`, LF, or CR. `escapeFormula: false` keeps raw numeric/hex columns verbatim for lossless audit (D-08) — `-42` survives untouched.
- **`csvRow` / `csvDocument`** — comma join; CRLF join with trailing CRLF per RFC 4180.
- **`buildProvenance(p)`** — five `# key: value` lines in D-10 order: node (alias + pubkey on one line), table, window, exported-at (ISO-8601 UTC), data-as-of (`"unknown"` when null).
- **`sanitizeFilenamePart(s)`** — whitelist `[A-Za-z0-9_-]`; disallowed runs become a single `_`, repeats collapse, edge underscores trim, empty result falls back to `"node"`. The ONLY path an alias may take into a filename (T-03-05).
- **`buildExportFilename(alias, table, window, at)`** — `{sanitized-alias}_{table}_{window}_{YYYYMMDDTHHmmssZ}.csv`.

## Task Commits (TDD: RED → GREEN per task)

| Task | Phase | Commit | Description |
| ---- | ----- | ------ | ----------- |
| 1 | RED | a27d646 | Failing tests: RFC-4180 quoting, one test per trigger char, composition, CRLF |
| 1 | GREEN | 46725d7 | csvCell/csvRow/csvDocument + FORMULA_TRIGGER |
| 2 | RED | 636a5b8 | Failing tests: provenance order/null, sanitizer whitelist + injection payload, filename contract |
| 2 | GREEN | 71dcea7 | buildProvenance/sanitizeFilenamePart/buildExportFilename |

## Verification

- `npx vitest run src/lib/csv/serialize.test.ts` — 29/29 pass
- `npx tsc --noEmit` — clean
- All six FORMULA_TRIGGER characters individually tested; `csvDocument` CRLF asserted via `toContain("\r\n")`
- Header-injection payload `x"; filename=evil` sanitizes to `/^[A-Za-z0-9_-]+$/`
- `grep "papaparse\|csv-stringify\|csv-parse" package.json` — nothing; zero new dependencies (T-03-SC accepted as planned)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] CR/LF collapse in provenance values**
- **Found during:** Task 2
- **Issue:** Provenance `#` comment lines bypass `csvCell` quoting; an attacker-controlled alias containing CR/LF could terminate the comment line and inject arbitrary CSV rows (including formula cells) into the document body.
- **Fix:** Private `provenanceValue()` collapses `\r`, `\n`, `\u2028`, `\u2029` runs to a single space before interpolation; test asserts no emitted line contains CR/LF and every line still starts with `# `.
- **Files modified:** src/lib/csv/serialize.ts, src/lib/csv/serialize.test.ts
- **Commit:** 71dcea7 (test in 636a5b8)

### Notes

- `.planning/phases/03-per-node-console-pending-monitor/03-PATTERNS.md` is referenced as plan context but is untracked in the main repo and therefore absent from this worktree; the RESEARCH.md reference implementation (§Code Examples, Pattern 4, Pitfall 8) covered all needed guidance.

## Known Stubs

None — all exports are fully implemented and tested.

## Threat Flags

None — all security surface introduced (csvCell formula escape, filename sanitizer) was already registered in the plan's threat model (T-03-04, T-03-05); the provenance CR/LF collapse is an adjunct mitigation under T-03-04.

## TDD Gate Compliance

Both tasks followed RED → GREEN with verified-failing tests committed before implementation (a27d646 → 46725d7; 636a5b8 → 71dcea7). No refactor commits needed.

## Self-Check: PASSED

All created files and all four task commits (a27d646, 46725d7, 636a5b8, 71dcea7) verified present.
