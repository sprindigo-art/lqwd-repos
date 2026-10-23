"use client";

import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { serviceDisplay } from "@/lib/overview/service-display";
import { EventTable } from "@/components/console/EventTable";
import { AiReadPanel, type AiReadLine } from "@/components/df/AiReadPanel";

// =====================================================
// NodeLogsStream (B4 / NODE-04) — service-filterable logs + advisory AI (Client)
// =====================================================
// A logs/events stream over the console `EventTable`, filterable by service (a chip
// per service, relabeled via `serviceDisplay().label` — never the raw machine key
// on screen). Notable errors carry an inline, dismissible `AiReadPanel` explanation
// that is clearly labeled AI.
//
// SAFETY (HARDEN-03, re-affirmed): the AI read is ADVISORY-ONLY. It NEVER emits a
// runnable command or a signed param — there is NO queue-write import and NO
// command-emission path anywhere in this file. The AI explains; it never
// executes and never produces the fee `params`.
//
// `"use client"` owns the service-filter + per-read dismiss state; every rendered
// value arrives pre-formatted (no unit math here).

/** One log/event line for the stream. */
export interface NodeLogLine {
  /** Stable id (row + AI-read dismiss identity). */
  id: string;
  /** Raw service key — relabeled for display via `serviceDisplay()`. */
  service: string;
  /** Pre-formatted timestamp (formatting happened upstream). */
  ts: string;
  /** Severity level of the line — drives the level chip text. */
  level: "info" | "warn" | "error";
  /** The log message (rendered as inert text). */
  message: string;
  /**
   * Optional advisory AI explanation for a NOTABLE error. Advisory-only — it can
   * never carry or emit a command. Rendered in a dismissible `AiReadPanel`.
   */
  aiRead?: AiReadLine[];
}

export interface NodeLogsStreamProps {
  /** The log lines to render (newest-first ordering already applied upstream). */
  logs: NodeLogLine[];
}

/** The "all services" sentinel for the filter. */
const ALL = "__all__";

/**
 * The service-filterable log stream. Renders a chip per distinct service (display
 * label), the filtered `EventTable`, and dismissible advisory AI reads for the
 * filtered notable errors. Emits no command — advisory only.
 */
export function NodeLogsStream({ logs }: NodeLogsStreamProps) {
  const [active, setActive] = useState<string>(ALL);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  // Distinct services present in the stream — the filter chip set.
  const services = useMemo(() => {
    const seen = new Set<string>();
    for (const line of logs) seen.add(line.service);
    return [...seen];
  }, [logs]);

  const filtered = useMemo(
    () => (active === ALL ? logs : logs.filter((line) => line.service === active)),
    [logs, active],
  );

  // Notable errors (with an AI read) still visible after filtering + dismissal.
  const aiReads = filtered.filter(
    (line) => line.aiRead && line.aiRead.length > 0 && !dismissed.has(line.id),
  );

  function dismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
        Logs
      </div>

      {/* Service filter chips — display labels, never the raw machine key. */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip active={active === ALL} onClick={() => setActive(ALL)}>
          All
        </FilterChip>
        {services.map((service) => (
          <FilterChip
            key={service}
            active={active === service}
            onClick={() => setActive(service)}
          >
            {serviceDisplay(service).label}
          </FilterChip>
        ))}
      </div>

      {filtered.length > 0 ? (
        <EventTable
          columns={[
            { key: "ts", label: "Time", mono: true },
            { key: "service", label: "Service" },
            { key: "level", label: "Level", mono: true },
            { key: "message", label: "Message" },
          ]}
          rows={filtered.map((line) => ({
            ts: line.ts,
            service: serviceDisplay(line.service).label,
            level: line.level,
            message: line.message,
          }))}
        />
      ) : (
        <div className="rounded-df-card border border-df-border bg-df-surface-sub px-4 py-3 font-df-mono text-[12px] text-df-muted">
          No log events in this window.
        </div>
      )}

      {/* Inline advisory AI reads for notable errors — dismissible, never a command. */}
      {aiReads.length > 0 && (
        <div className="flex flex-col gap-3">
          {aiReads.map((line) => (
            <AiReadPanel
              key={line.id}
              heading={`AI read · ${serviceDisplay(line.service).label}`}
              lines={line.aiRead ?? []}
              onDismiss={() => dismiss(line.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** A navy filter chip (structure, never a health hue). Active = navy fill. */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-df-pill border px-2.5 py-1 font-df-mono text-[11px] font-semibold tracking-[0.04em] transition-colors",
        active
          ? "border-df-brand bg-df-brand text-white"
          : "border-df-border bg-df-surface text-df-muted hover:bg-df-surface-sub",
      )}
    >
      {children}
    </button>
  );
}
