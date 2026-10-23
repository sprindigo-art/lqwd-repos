"use client";

import { useState } from "react";

import type { ExportBlock } from "@/lib/export/block";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =====================================================
// CommandExport — the ONE client leaf (Phase 5 — EXPORT-01 / PENDING-03)
// =====================================================
// Presentational only — every string is pre-built server-side by
// buildExportBlock(card) and handed in as plain serializable props (the
// FleetPendingBoard/NarrateButton precedent). This leaf owns NOTHING but the
// `open` toggle and per-button copied/failed state; it has no fetch, no server
// action, no card knowledge — clipboard write is its only side effect (D-03
// locked: no auto-run affordance, no reveal gate — expanding is the act, the
// command renders as inert text).
//
// Containment (T-05-09): all block content renders as TEXT NODES — no raw-HTML
// injection sink, no markdown rendering. The card-sourced strings were already
// sanitized upstream (sanitize.ts) before they became ExportBlock fields.
// Clipboard failure is NEVER silent (Pitfall 6 / T-05-11): feature-detect,
// show the locked failure copy, announce via aria-live.
//
// Sketch rules (sketch-findings-nodemonitor, binding): mono uppercase text
// controls, no icons-for-state, no animation, tight radii, hairline borders;
// navy only via the existing focus-visible ring; severity color does state.

/** Verbatim copy handler (RESEARCH §Code Examples) — feature-detect, honest fail. */
async function copy(text: string, setState: (s: "copied" | "failed") => void) {
  try {
    if (!navigator.clipboard) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    setState("copied");
  } catch {
    setState("failed"); // locked honest failure copy; never silent
  }
}

/** mono-uppercase-over-outline-button chrome — the ExportButton voice, no icon. */
const CONTROL_CHROME = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "font-df-mono text-xs font-semibold tracking-[0.14em] uppercase",
);

type CopyState = "idle" | "copied" | "failed";

/** One COPY control with in-place label swap + locked failure helper line. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<CopyState>("idle");

  function handleCopy() {
    void copy(text, (s) => {
      setState(s);
      window.setTimeout(() => setState("idle"), 1500);
    });
  }

  const buttonLabel =
    state === "copied" ? "COPIED" : state === "failed" ? "COPY FAILED" : label;

  return (
    <span className="flex flex-col items-end">
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          CONTROL_CHROME,
          state === "copied" && "text-df-ok-text",
          state === "failed" && "text-df-warning",
        )}
        aria-live="polite"
      >
        {buttonLabel}
      </button>
      {state === "failed" && (
        <span className="mt-1 font-df-mono text-xs text-df-warning">
          copy failed — select the text manually
        </span>
      )}
    </span>
  );
}

interface CommandExportProps {
  block: ExportBlock;
  blockId: string;
}

export function CommandExport({ block, blockId }: CommandExportProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={blockId}
        className={CONTROL_CHROME}
      >
        {open ? "hide commands" : "export commands"}
      </button>

      {/* Instant expand — no animation (FleetPendingBoard precedent). */}
      {open && (
        <div id={blockId} className="mt-2 flex flex-col gap-2">
          {/* 1 — context echo: key/value rows in the existing params grammar. */}
          {block.contextLines.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {block.contextLines.map((line) => (
                <div key={line.key} className="flex gap-3 font-df-mono text-xs">
                  <span className="text-df-muted">{line.key}</span>
                  <span className="tabular-nums text-df-muted">{line.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* 2 — safety notes (D-05 visible render; repeated as # in copyAll). */}
          {block.safetyLines.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {block.safetyLines.map((note, i) => (
                <p key={i} className="font-df-mono text-xs text-df-muted">
                  <span className="font-semibold text-df-warning">safety:</span> {note}
                </p>
              ))}
            </div>
          )}

          {/* 3 — step sections: header + COPY above the bare-command <pre>; or
              the honest-state note in place of the <pre> when command is null. */}
          {block.steps.map((step, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase">
                  {step.label}
                </span>
                {step.command !== null && (
                  <span className="ms-auto">
                    <CopyButton text={step.command} label="COPY" />
                  </span>
                )}
              </div>
              {step.command !== null ? (
                // Plain text node — no raw-HTML sink, no markdown rendering.
                <pre className="rounded-[3px] border border-df-border bg-df-surface-sub px-3 py-2 font-df-mono text-xs leading-5 overflow-x-auto whitespace-pre">
                  {step.command}
                </pre>
              ) : (
                step.note !== null && (
                  <p className="font-df-mono text-xs font-semibold tracking-[0.06em] text-df-muted uppercase">
                    {step.note}
                  </p>
                )
              )}
            </div>
          ))}

          {/* 4 — footer: COPY ALL grabs the full annotated block (# comments). */}
          {block.copyAll !== null && (
            <div className="flex justify-end">
              <CopyButton text={block.copyAll} label="COPY ALL" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
