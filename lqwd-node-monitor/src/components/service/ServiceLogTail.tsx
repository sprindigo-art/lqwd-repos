"use client";

import { useState } from "react";

import { EventTable } from "@/components/console/EventTable";
import { AiReadPanel, type AiReadLine } from "@/components/df/AiReadPanel";

// =====================================================
// C3 — ServiceLogTail (SVC-02, Client)
// =====================================================
// A log tail for ONE service — the generic `EventTable` fed pre-formatted rows —
// with an inline, DISMISSIBLE `AiReadPanel` above it explaining the pattern.
//
// SECURITY / HONESTY (re-affirmed Phase 16 HARDEN-03):
//   - The AI read is ADVISORY ONLY. This module imports NOTHING from the queue /
//     command / signing layers — there is no enqueue path and no runnable command
//     can be emitted from here. `AiReadLine` carries no action field; the panel's
//     verbatim "explains & ranks, never runs commands" safety label is built in.
//   - Rows are PRE-FORMATTED strings (AFM-002 / timestamp coercion / ordering all
//     happened upstream); `EventTable` renders them as React-escaped text.
//
// `"use client"` exists only for the dismiss state around `AiReadPanel` (the ✕
// control). With the panel dismissed, only the log table renders. When there are
// no rows, the honest empty-state copy renders instead of a fabricated line.

/** Log-tail column descriptors (time / level / message), rendered as-is. */
const LOG_COLUMNS = [
  { key: "time", label: "TIME", mono: true },
  { key: "level", label: "LEVEL", mono: true },
  { key: "message", label: "MESSAGE" },
] as const;

interface ServiceLogTailProps {
  /** Pre-formatted log rows (newest-first from the read layer). */
  rows: Record<string, string>[];
  /** 1–4 advisory AI-read lines explaining the pattern (advisory-only). */
  aiLines: AiReadLine[];
  /** Honest empty-state copy when the window has no events. */
  emptyLabel?: string;
}

/**
 * The service log tail + inline dismissible advisory AI read. Composes only the
 * generic EventTable + the advisory AiReadPanel — no queue/command import, so no
 * runnable command can ever originate here.
 */
export function ServiceLogTail({
  rows,
  aiLines,
  emptyLabel = "No log events in this window.",
}: ServiceLogTailProps) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
        Log tail
      </div>

      {!dismissed && aiLines.length > 0 && (
        <AiReadPanel lines={aiLines} onDismiss={() => setDismissed(true)} />
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-df-border bg-df-surface p-6 text-center">
          <p className="text-[13.5px] text-df-muted">{emptyLabel}</p>
        </div>
      ) : (
        <EventTable columns={[...LOG_COLUMNS]} rows={rows} />
      )}
    </section>
  );
}
