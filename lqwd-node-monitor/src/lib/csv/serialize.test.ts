import { describe, it, expect } from "vitest";
import {
  FORMULA_TRIGGER,
  csvCell,
  csvRow,
  csvDocument,
  buildProvenance,
  sanitizeFilenamePart,
  buildExportFilename,
} from "@/lib/csv/serialize";

// NODE-02 security boundary tests (RESEARCH §Code Examples, Pitfall 8).
// Lightning peer aliases are attacker-controlled strings broadcast on the public
// network — every formula-trigger character must be individually covered (T-03-04).

describe("csvCell — RFC-4180 quoting", () => {
  it("passes a plain cell through unquoted", () => {
    expect(csvCell("abc", { escapeFormula: true })).toBe("abc");
  });

  it("quotes a cell containing a comma", () => {
    expect(csvCell("a,b", { escapeFormula: false })).toBe('"a,b"');
  });

  it('quotes a cell containing a double quote and doubles it: a"b → "a""b"', () => {
    expect(csvCell('a"b', { escapeFormula: false })).toBe('"a""b"');
  });

  it("quotes a cell containing a newline", () => {
    expect(csvCell("a\nb", { escapeFormula: false })).toBe('"a\nb"');
  });

  it("quotes a cell containing a carriage return", () => {
    expect(csvCell("a\rb", { escapeFormula: false })).toBe('"a\rb"');
  });

  it("serializes null to an empty string", () => {
    expect(csvCell(null, { escapeFormula: true })).toBe("");
  });

  it("serializes undefined to an empty string", () => {
    expect(csvCell(undefined, { escapeFormula: true })).toBe("");
  });
});

describe("csvCell — formula-injection escape (T-03-04, one case per trigger char)", () => {
  it("escapes a leading '=' with an apostrophe", () => {
    expect(csvCell('=HYPERLINK("http://evil")', { escapeFormula: true })).toBe(
      "\"'=HYPERLINK(\"\"http://evil\"\")\""
    );
    expect(csvCell("=SUM(A1)", { escapeFormula: true })).toBe("'=SUM(A1)");
  });

  it("escapes a leading '+' with an apostrophe", () => {
    expect(csvCell("+1+2", { escapeFormula: true })).toBe("'+1+2");
  });

  it("escapes a leading '-' with an apostrophe", () => {
    expect(csvCell("-2+3", { escapeFormula: true })).toBe("'-2+3");
  });

  it("escapes a leading '@' with an apostrophe", () => {
    expect(csvCell("@SUM(A1)", { escapeFormula: true })).toBe("'@SUM(A1)");
  });

  it("escapes a leading tab with an apostrophe", () => {
    expect(csvCell("\tabc", { escapeFormula: true })).toBe("'\tabc");
  });

  it("escapes a leading CR with an apostrophe (then RFC-4180-quotes the CR)", () => {
    expect(csvCell("\rabc", { escapeFormula: true })).toBe("\"'\rabc\"");
  });

  it("does NOT escape formula triggers when escapeFormula is false", () => {
    expect(csvCell("=SUM(A1)", { escapeFormula: false })).toBe("=SUM(A1)");
    expect(csvCell("+1", { escapeFormula: false })).toBe("+1");
    expect(csvCell("@x", { escapeFormula: false })).toBe("@x");
  });

  it("keeps a negative raw number verbatim with escapeFormula false (D-08 lossless raw columns)", () => {
    expect(csvCell("-42", { escapeFormula: false })).toBe("-42");
  });

  it("applies formula escape BEFORE RFC-4180 quoting: =a,b → \"'=a,b\"", () => {
    expect(csvCell("=a,b", { escapeFormula: true })).toBe("\"'=a,b\"");
  });

  it("exports the FORMULA_TRIGGER regex matching exactly =, +, -, @, tab, CR at start", () => {
    for (const ch of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(FORMULA_TRIGGER.test(`${ch}x`)).toBe(true);
    }
    expect(FORMULA_TRIGGER.test("x=")).toBe(false);
    expect(FORMULA_TRIGGER.test("abc")).toBe(false);
  });
});

describe("csvRow / csvDocument — RFC-4180 structure", () => {
  it("csvRow joins pre-serialized cells with commas", () => {
    expect(csvRow(["a", '"b,c"', ""])).toBe('a,"b,c",');
  });

  it("csvDocument joins lines with CRLF and ends with a trailing CRLF", () => {
    const doc = csvDocument(["h1,h2", "a,b"]);
    expect(doc).toContain("\r\n");
    expect(doc).toBe("h1,h2\r\na,b\r\n");
  });
});

describe("buildProvenance — D-10 comment block", () => {
  const exportedAt = new Date("2026-06-10T21:30:00.000Z");
  const dataAsOf = new Date("2026-06-10T21:25:42.000Z");

  it("produces five #-prefixed lines: node (alias+pubkey), table, window, exported-at, data-as-of — in order", () => {
    const lines = buildProvenance({
      alias: "MyNode",
      pubkey: "02abc123",
      table: "forwards",
      window: "7d",
      exportedAt,
      dataAsOf,
    });
    expect(lines).toHaveLength(5);
    for (const line of lines) expect(line.startsWith("# ")).toBe(true);
    expect(lines[0]).toContain("MyNode");
    expect(lines[0]).toContain("02abc123");
    expect(lines[1]).toContain("forwards");
    expect(lines[2]).toContain("7d");
    expect(lines[3]).toContain("2026-06-10T21:30:00.000Z");
    expect(lines[3]).toMatch(/Z$/);
    expect(lines[4]).toContain("2026-06-10T21:25:42.000Z");
  });

  it('renders data-as-of as "unknown" when dataAsOf is null', () => {
    const lines = buildProvenance({
      alias: "MyNode",
      pubkey: "02abc123",
      table: "channels",
      window: "30d",
      exportedAt,
      dataAsOf: null,
    });
    expect(lines[4]).toContain("unknown");
  });

  it("cannot be broken out of by CR/LF in an attacker-controlled alias", () => {
    const lines = buildProvenance({
      alias: "evil\r\n=HYPERLINK(1),x",
      pubkey: "02abc123",
      table: "forwards",
      window: "7d",
      exportedAt,
      dataAsOf,
    });
    // Every emitted line must still be a single #-comment line — no injected rows.
    for (const line of lines) {
      expect(line.startsWith("# ")).toBe(true);
      expect(line).not.toMatch(/[\r\n]/);
    }
  });

  it("cannot smuggle a formula cell via commas in an attacker-controlled alias (CR-01)", () => {
    const lines = buildProvenance({
      alias: 'x,=HYPERLINK("http://evil","open")',
      pubkey: "02abc123",
      table: "forwards",
      window: "7d",
      exportedAt,
      dataAsOf,
    });
    for (const line of lines) {
      // Each provenance line stays a single #-comment line…
      expect(line.startsWith("# ")).toBe(true);
      // …and no comma-delimited cell of the imported row may begin with a
      // formula trigger (=, +, -, @, tab, CR) — the spreadsheet-side check.
      for (const cell of line.split(",")) {
        expect(cell).not.toMatch(FORMULA_TRIGGER);
      }
    }
  });

  it("strips commas and double quotes from provenance values (no surviving delimiter)", () => {
    const lines = buildProvenance({
      alias: 'a,"b",c',
      pubkey: "02abc123",
      table: "forwards",
      window: "7d",
      exportedAt,
      dataAsOf,
    });
    expect(lines[0]).not.toContain(",");
    expect(lines[0]).not.toContain('"');
  });
});

describe("sanitizeFilenamePart — Content-Disposition header-injection guard (T-03-05)", () => {
  it("strips/replaces everything outside [A-Za-z0-9_-] (spaces, punctuation, unicode, CR/LF)", () => {
    const out = sanitizeFilenamePart("Node Alias! 🚀;\r\nX");
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(out).not.toMatch(/[\s"';]/);
  });

  it("never returns an empty string (falls back to 'node')", () => {
    expect(sanitizeFilenamePart("🚀🚀🚀")).toBe("node");
    expect(sanitizeFilenamePart("")).toBe("node");
  });

  it('defeats the header-injection payload x"; filename=evil', () => {
    const out = sanitizeFilenamePart('x"; filename=evil');
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("passes a clean alias through unchanged", () => {
    expect(sanitizeFilenamePart("MyNode-01_test")).toBe("MyNode-01_test");
  });
});

describe("buildExportFilename — D-10 filename contract", () => {
  const at = new Date("2026-06-10T21:30:05.123Z");

  it("formats {alias}_{table}_{window}_{YYYYMMDDTHHmmssZ}.csv", () => {
    expect(buildExportFilename("MyNode", "forwards", "7d", at)).toBe(
      "MyNode_forwards_7d_20260610T213005Z.csv"
    );
  });

  it("matches the canonical filename pattern for every window preset", () => {
    for (const window of ["24h", "7d", "30d", "90d"]) {
      const name = buildExportFilename("MyNode", "forwards", window, at);
      expect(name).toMatch(/^[A-Za-z0-9_-]+_[a-z]+_(24h|7d|30d|90d)_\d{8}T\d{6}Z\.csv$/);
    }
  });

  it("sanitizes a malicious alias before it enters the filename", () => {
    const name = buildExportFilename('x"; filename=evil', "closes", "90d", at);
    expect(name).toMatch(/^[A-Za-z0-9_-]+_closes_90d_\d{8}T\d{6}Z\.csv$/);
    expect(name).not.toContain('"');
    expect(name).not.toContain(";");
  });
});
