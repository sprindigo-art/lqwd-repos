import { describe, expect, it } from "vitest";
import { sanitizeCommentText } from "@/lib/export/sanitize";

// =====================================================
// sanitizeCommentText injection-containment suite (T-05-02 / Pitfall 2)
// =====================================================
// The peer-chosen alias is remote-controlled data; a `#` comment line is only
// inert until a newline breaks out of it. These fixtures assert the breakout
// class is neutralized before any card string reaches a shell comment.

describe("sanitizeCommentText (T-05-02 / Pitfall 2)", () => {
  it("collapses newlines so the value cannot break out of a # comment line", () => {
    const out = sanitizeCommentText("evil\nrm -rf ~/.lnd");
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\r");
  });

  it("strips backtick, $, and \\ (shell-active chars)", () => {
    const out = sanitizeCommentText("a`$(reboot)`b\\");
    expect(out).not.toContain("`");
    expect(out).not.toContain("$");
    expect(out).not.toContain("\\");
  });

  it("truncates input longer than the cap to exactly maxLen chars (default 120)", () => {
    const out = sanitizeCommentText("x".repeat(500));
    expect(out.length).toBe(120);
  });

  it("respects a custom maxLen", () => {
    const out = sanitizeCommentText("x".repeat(500), 10);
    expect(out.length).toBe(10);
  });

  it("passes a normal alias and a truncated pubkey through unchanged", () => {
    expect(sanitizeCommentText("LQWD-Canada")).toBe("LQWD-Canada");
    expect(sanitizeCommentText("02ab…ef")).toBe("02ab…ef");
  });

  it("strips tab and all C0/C1 control chars (\\x00-\\x1F, \\x7F)", () => {
    const out = sanitizeCommentText("a\tb\x00c\x1fd\x7fe");
    expect(out).toBe("abcde");
  });
});
