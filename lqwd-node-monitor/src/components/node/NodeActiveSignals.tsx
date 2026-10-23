"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";

import { SeverityCard } from "@/components/df/SeverityCard";
import type { Severity } from "@/components/df/Severity";
import type { WhyChainEvent } from "@/components/df/WhyChain";
import type { AiReadLine } from "@/components/df/AiReadPanel";
import {
  CommandModal,
  type CommandKind,
  type RunbookStep,
} from "@/components/df/CommandModal";

// =====================================================
// NodeActiveSignals (B6 / NODE-04) — adaptive-action signals (Client, inert)
// =====================================================
// This node's incidents rendered with the SAME `SeverityCard` + `WhyChain` +
// adaptive-action system as the overview. Each signal exposes EXACTLY ONE adaptive
// action (the `action` prop is a single discriminated-union value — the type makes
// "one action per signal" unrepresentable-otherwise):
//   • Export fix  → opens the inert `CommandModal` (copy-to-run, NEVER executes)
//   • Open runbook→ opens the inert `CommandModal` (host-op steps, NEVER executes)
//   • Investigate → read-only navigation (a plain link; emits nothing)
//
// SAFETY (D-04 / HARDEN-03, load-bearing): NOTHING here mutates the node or emits a
// command. There is NO server action, NO queue-write import, NO signed param.
// `CommandModal` is copy-only; the dashboard holds zero node credentials. The AI
// (rendered as advisory `aiLines` in the card drawer) explains and never executes.
//
// The `"use client"` directive exists only to own the per-card expand state; the
// composed `SeverityCard` is otherwise presentational.

/** The single adaptive action a signal may expose — exactly one per signal. */
export type AdaptiveAction =
  | {
      /** Inert command/runbook export — opens the copy-only `CommandModal`. */
      kind: "export" | "runbook";
      /** Button copy ("Export fix" / "Open runbook"). */
      label: string;
      /** The exact command a human will run (rendered inert, copy-only). */
      command: string;
      /** Ordered runbook steps shown above the command. */
      runbook: RunbookStep[];
      /** Modal risk-tier framing (defaults per kind). */
      commandKind?: CommandKind;
      /** Modal intent line under the title. */
      intent?: string;
    }
  | {
      /** Read-only navigation drill — emits nothing. */
      kind: "investigate";
      /** Button copy (defaults to "Investigate"). */
      label?: string;
      /** The read-only route to drill into. */
      href: string;
    };

/** One active signal for this node. */
export interface NodeSignal {
  /** Stable id (card key + expand identity). */
  id: string;
  /** Severity — drives the card accent/tint/chip via the Severity ramp. */
  sev: Severity;
  /** Headline identity for the signal. */
  title: ReactNode;
  /** The one-line "why" under the title. */
  why?: string;
  /** Optional mono uppercase chip override. */
  label?: ReactNode;
  /** Detection-chain events for the drawer's `WhyChain`. */
  timeline?: WhyChainEvent[];
  /** Advisory AI-read lines for the drawer's `AiReadPanel` (explains, never runs). */
  aiLines?: AiReadLine[];
  /** Honest freshness for the card meta row. */
  freshness?: { asOf: Date | null; stale: boolean; now?: Date };
  /** The EXACTLY-ONE adaptive action this signal exposes. */
  action: AdaptiveAction;
}

export interface NodeActiveSignalsProps {
  /** This node's active signals (already root-cause grouped upstream). */
  signals: NodeSignal[];
  /** Deterministic "now" for freshness rendering (SSR/test stability). */
  now?: Date;
}

/** The navy control used as the `CommandModal` trigger / investigate link. */
function ActionButton({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-df-btn bg-df-chrome px-3.5 py-2 text-[12.5px] font-semibold text-white">
      {children}
    </span>
  );
}

/** Render the signal's single adaptive action — inert modal or read-only link. */
function AdaptiveActionControl({ action, sev }: { action: AdaptiveAction; sev: Severity }) {
  if (action.kind === "investigate") {
    // Read-only navigation — emits nothing, mutates nothing.
    return (
      <Link href={action.href}>
        <ActionButton>{action.label ?? "Investigate"}</ActionButton>
      </Link>
    );
  }
  // Export fix / Open runbook — the inert copy-only CommandModal (never executes).
  return (
    <CommandModal
      title={action.label}
      intent={action.intent}
      sev={sev}
      kind={action.commandKind ?? (action.kind === "runbook" ? "runbook" : "command")}
      command={action.command}
      runbook={action.runbook}
      trigger={<button type="button"><ActionButton>{action.label}</ActionButton></button>}
    />
  );
}

/**
 * The active-signals stack. Each signal is a `SeverityCard` whose expand drawer
 * reveals the why-chain, the advisory AI read, and the single inert adaptive
 * action. No signal path mutates the node or emits a command.
 */
export function NodeActiveSignals({ signals, now }: NodeActiveSignalsProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (signals.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <SectionKicker>Active signals</SectionKicker>
        <div className="rounded-df-card border border-df-border bg-df-surface-sub px-4 py-3 font-df-mono text-[12px] text-df-muted">
          No active signals on this node.
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionKicker>Active signals · {signals.length}</SectionKicker>
      <div className="flex flex-col gap-3">
        {signals.map((signal) => {
          const isOpen = expanded === signal.id;
          return (
            <SeverityCard
              key={signal.id}
              sev={signal.sev}
              title={signal.title}
              label={signal.label}
              why={signal.why}
              freshness={
                signal.freshness && { ...signal.freshness, now: signal.freshness.now ?? now }
              }
              expanded={isOpen}
              onToggle={() => setExpanded(isOpen ? null : signal.id)}
              expandLabel={isOpen ? "Hide" : "Show why + action"}
              timeline={signal.timeline}
              aiLines={signal.aiLines}
              childrenFooter={<AdaptiveActionControl action={signal.action} sev={signal.sev} />}
            />
          );
        })}
      </div>
    </section>
  );
}

/** Mono uppercase section kicker. */
function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
      {children}
    </div>
  );
}
