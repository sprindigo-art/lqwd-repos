"use client";

import { useState } from "react";
import { Info } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { severityAccent, severityLabel, type Severity } from "./Severity";

// =====================================================
// CommandModal — runbook + command export (DS-02, inert text)
// =====================================================
// A `"use client"` modal that shows the runbook steps + the exact command a
// human will run for a higher-risk action. It reuses the vendored Radix
// `@/components/ui/dialog` (focus-trap / scroll-lock / ESC already solved —
// RESEARCH "Don't Hand-Roll"); it does NOT build a custom overlay.
//
// SECURITY (T-10-06 / T-10-07, ASVS V14):
//   - Command / runbook strings render as INERT TEXT inside a `<code>` block,
//     React-escaped — never via a raw-HTML sink prop, never executed.
//   - The modal only COPIES the command (`navigator.clipboard.writeText`); it
//     NEVER executes it (zero-write-path re-affirmed — the dashboard holds no
//     node credentials; a human runs the exported command on the node).
//   - Command strings are verbatim — NO units.ts transform (they are literal
//     shell, not displayed quantities).
//
// The inert body is the exported `CommandPanel` so the inert-text behavior is
// unit-testable under `renderToStaticMarkup` without the Radix portal/open state.

// ─────────────────────────────────────────────────────────────
// Risk-tier variants (prototype "command type" logic, Ops Center 757)
// ─────────────────────────────────────────────────────────────
// Three modes, each with distinct kicker / cmd-label / note / copy-button copy.
// The copy is FROZEN to the prototype so the risk-tier framing is unambiguous —
// none of these modes change the inert-text security property; they only reframe.

/** The three command risk tiers the modal can frame. */
export type CommandKind = "command" | "investigate" | "runbook";

interface KindMeta {
  /** Header kicker beside the sev chip (e.g. "Runbook · host operation"). */
  kicker: string;
  /** Optional uppercase label above the code block (empty for plain export). */
  cmdLabel: string;
  /** The info-ⓘ note shown beside copy — reaffirms the zero-execution property. */
  note: string;
  /** Copy-button copy ("Copy command" / "Copy diagnostic"). */
  primary: string;
}

/** Frozen per-tier framing copy — mirrors the prototype, do NOT drift. */
export const COMMAND_KIND_META: Record<CommandKind, KindMeta> = {
  command: {
    kicker: "Exported command",
    cmdLabel: "",
    note: "Runs on your machine — never executed by NodeMonitor.",
    primary: "Copy command",
  },
  investigate: {
    kicker: "Investigate · read-only",
    cmdLabel: "Inspect command · read-only",
    note: "Read-only — gathers data, applies no change. No fix is run.",
    primary: "Copy command",
  },
  runbook: {
    kicker: "Runbook · host operation",
    cmdLabel: "Diagnostic command",
    note: "Higher-risk host operation — review each step. NodeMonitor runs nothing for you.",
    primary: "Copy diagnostic",
  },
};

/** One runbook step: an ordinal + its instruction text. */
export interface RunbookStep {
  n: number;
  text: string;
}

/** The inert modal body — runbook steps + the navy command code block + copy. */
export interface CommandPanelProps {
  /** The exact command string a human will run. Rendered as INERT escaped text. */
  command: string;
  /** Ordered runbook steps shown above the command. */
  runbook: RunbookStep[];
  /**
   * Risk tier — selects the kicker / cmd-label / note / copy-button copy. The
   * per-tier `cmdLabel` is used unless an explicit `cmdLabel` prop overrides it.
   */
  kind?: CommandKind;
  /** Explicit uppercase label above the code block (overrides the tier default). */
  cmdLabel?: string;
  /** Explicit note beside copy (overrides the tier default; ⓘ icon still shown). */
  note?: string;
}

/**
 * The inert command/runbook body. Renders the command inside a `<code>` block
 * as React-escaped text and copies it via the clipboard — it NEVER executes
 * the command and NEVER uses an HTML sink.
 */
export function CommandPanel({ command, runbook, kind = "command", cmdLabel, note }: CommandPanelProps) {
  const [copied, setCopied] = useState(false);
  const meta = COMMAND_KIND_META[kind];
  const resolvedCmdLabel = cmdLabel ?? (meta.cmdLabel || undefined);
  const resolvedNote = note ?? meta.note;

  async function onCopy() {
    // COPY ONLY — the command is handed to a human, never executed here.
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can reject (permissions / insecure context); leave the label
      // unchanged rather than throwing — the command text is still selectable.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {runbook.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="font-mono text-[10.5px] font-bold tracking-[0.08em] text-foreground/45 uppercase">
            Runbook steps
          </div>
          <ol className="flex flex-col gap-2.5">
            {runbook.map((step) => (
              <li key={step.n} className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ backgroundColor: "#EEF2FA", color: "#13284F" }}
                >
                  {step.n}
                </span>
                <p className="text-[13px] leading-relaxed text-foreground/80">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {resolvedCmdLabel && (
        <div className="font-mono text-[10.5px] font-bold tracking-[0.08em] text-foreground/45 uppercase">
          {resolvedCmdLabel}
        </div>
      )}

      {/* Navy df-chrome code block. The command is a TEXT CHILD of <code> —
          React escapes it; no raw-HTML sink prop is used anywhere. */}
      <div
        className="overflow-auto rounded-[11px] p-4"
        style={{ backgroundColor: "#13284F" }}
      >
        <code
          className="font-mono text-[12.5px] leading-relaxed"
          style={{ color: "#DCE4F4", whiteSpace: "pre" }}
        >
          {command}
        </code>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCopy}
          className="rounded-[9px] px-4 py-2 font-mono text-[13px] font-semibold text-white"
          style={{ backgroundColor: "#13284F" }}
        >
          {copied ? "Copied ✓" : meta.primary}
        </button>
        {resolvedNote && (
          <span className="flex items-center gap-1.5 text-xs text-foreground/45">
            <Info className="size-3.5 flex-none" strokeWidth={1.8} aria-hidden="true" />
            {resolvedNote}
          </span>
        )}
      </div>
    </div>
  );
}

export interface CommandModalProps extends CommandPanelProps {
  /** Modal title (the action name, e.g. "Restart bitcoind on host-03"). */
  title: string;
  /** Optional one-line intent shown under the title. */
  intent?: string;
  /**
   * Severity — drives the white-on-accent sev chip in the header (e.g. CRITICAL).
   * Defaults to `critical` since the modal exists for higher-risk actions.
   */
  sev?: Severity;
  /** The trigger element (e.g. an "Export fix" button). */
  trigger: React.ReactNode;
}

/**
 * The runbook/command export modal. Reuses the Radix Dialog; renders the inert
 * `CommandPanel` body. The command is copyable but never executed. The header
 * carries a white-on-accent sev chip + the risk-tier kicker so the operator sees
 * the framing (e.g. "CRITICAL · Runbook · host operation") before acting.
 */
export function CommandModal({
  title,
  intent,
  sev = "critical",
  trigger,
  ...panel
}: CommandModalProps) {
  const kind = panel.kind ?? "command";
  const kicker = COMMAND_KIND_META[kind].kicker;

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={cn("sm:max-w-[580px]")}>
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2.5">
            {/* White-on-accent sev chip — severity is STATE, painted via the
                df severity accent token (never the navy chrome). */}
            <span
              className={cn(
                "rounded-[5px] px-2 py-0.5 font-mono text-[10.5px] font-bold tracking-[0.07em] text-white",
                severityAccent[sev],
              )}
            >
              {severityLabel[sev]}
            </span>
            <span className="font-mono text-[12px] text-foreground/45">{kicker}</span>
          </div>
          <DialogTitle>{title}</DialogTitle>
          {intent && <p className="text-[13px] leading-relaxed text-foreground/70">{intent}</p>}
        </DialogHeader>
        <CommandPanel {...panel} />
        <DialogClose className="sr-only">Close</DialogClose>
      </DialogContent>
    </Dialog>
  );
}
