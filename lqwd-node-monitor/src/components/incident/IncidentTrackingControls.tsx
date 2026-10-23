"use client";

import { useEffect, useState, useTransition } from "react";

import {
  ackIncident,
  assignIncident,
  snoozeIncident,
  unsnoozeIncident,
} from "@/app/actions/incident-tracking";
import { cn, FOCUS_RING } from "@/lib/utils";

// =====================================================
// IncidentTrackingControls — INC-02 tracking cluster (Client, D-02..D-06)
// =====================================================
// The phase's ONLY client-triggered mutation surface: Acknowledge (D-05),
// Assign-to-me / Unassign (D-02), and a fixed 1h·4h·24h Snooze segmented control
// (D-03) plus an un-snooze affordance. Every gesture calls its Plan-05 server
// action inside `useTransition` (optimistic pending, like NarrateButton); the
// optimistic state REVERTS on a `{ ok:false }` result. Nothing here is
// destructive — tracking metadata only, zero write-path to the fleet — so there
// is no confirm dialog.
//
// DS-01 (color law): navy is the affordance/active color (`text-df-brand`,
// navy-filled active). The severity ramp is NEVER used for the controls
// themselves — only the incident's own severity chip (rendered elsewhere) wears
// state color. Every control is a real <button> with `aria-pressed`; the snooze
// presets are a labeled `role="group"`.

/** Serializable tracking snapshot (Dates cross the RSC boundary as ISO strings). */
export interface IncidentTrackingState {
  ackedAt: string | Date | null;
  owner: string | null;
  snoozeUntil: string | Date | null;
}

interface IncidentTrackingControlsProps {
  incidentKey: string;
  tracking: IncidentTrackingState;
}

const SNOOZE_PRESETS = ["1h", "4h", "24h"] as const;
type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

const PRESET_MS: Record<SnoozePreset, number> = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

/**
 * Clock read for EVENT HANDLERS, not render. Reading the clock in response to a
 * click is legitimately impure — the constraint applies to render, which may run
 * more than once per commit. Kept at module scope so that distinction is explicit.
 */
function nowPlus(ms: number): Date {
  return new Date(Date.now() + ms);
}

function toDate(v: string | Date | null): Date | null {
  if (v === null) return null;
  return v instanceof Date ? v : new Date(v);
}

/** Compact relative age: "3m", "2h", "1d" — mono stamp copy, no unit math libs. */
function formatAge(from: Date): string {
  const secs = Math.max(0, Math.floor((Date.now() - from.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/** Short local wall-clock time (HH:MM) for the "snoozed until {time}" chip. */
function formatUntil(until: Date): string {
  return until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Shared button chrome: mono uppercase label, hairline border, 3px radius, navy ink. */
const CONTROL_BASE = cn(
  "rounded-[3px] border px-3 py-1.5 font-df-mono text-xs font-semibold tracking-[0.14em] uppercase transition-colors disabled:cursor-default disabled:opacity-60",
  FOCUS_RING,
);
/** Idle (navy-outline) affordance. */
const CONTROL_IDLE =
  "border-df-border bg-df-surface text-df-brand hover:border-df-brand-light hover:text-df-brand";
/** Active/engaged (navy-filled) affordance. */
const CONTROL_ACTIVE = "border-df-brand bg-df-brand text-white hover:bg-df-brand-light";

export function IncidentTrackingControls({ incidentKey, tracking }: IncidentTrackingControlsProps) {
  const [acked, setAcked] = useState<boolean>(toDate(tracking.ackedAt) !== null);
  const [owner, setOwner] = useState<string | null>(tracking.owner);
  const [ackedAt, setAckedAt] = useState<Date | null>(toDate(tracking.ackedAt));
  const [snoozeUntil, setSnoozeUntil] = useState<Date | null>(toDate(tracking.snoozeUntil));
  const [isPending, startTransition] = useTransition();

  const assigned = owner !== null;

  // Snooze expiry is time-dependent, so the clock must live in state, not in a
  // render-time Date.now() read: this is a CLIENT component, where render is
  // re-entrant (concurrent rendering, StrictMode double-render) and two reads in
  // one logical render can disagree. Ticking it also means an expiring snooze
  // now clears itself in place instead of waiting for the next interaction.
  // Mirrors the PollAge pattern. The interval only runs while a snooze is set.
  // Starts at 0 so a future snoozeUntil reads as snoozed on the first paint —
  // matching what the server rendered — and the interval corrects it within 1s.
  // No synchronous setState in the effect body (that cascades renders); the
  // interval callback is the only writer.
  const [nowMs, setNowMs] = useState<number>(0);
  useEffect(() => {
    if (snoozeUntil === null) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snoozeUntil]);

  const isSnoozed = snoozeUntil !== null && snoozeUntil.getTime() > nowMs;

  function handleAck() {
    if (acked) return; // no un-ack action; the stamp is the terminal state
    const prev = { acked, ackedAt };
    setAcked(true);
    setAckedAt(new Date());
    startTransition(async () => {
      const res = await ackIncident(incidentKey);
      if (!res.ok) {
        setAcked(prev.acked);
        setAckedAt(prev.ackedAt);
      }
    });
  }

  function handleAssign() {
    const prevOwner = owner;
    setOwner(assigned ? null : "you");
    startTransition(async () => {
      const res = await assignIncident(incidentKey);
      if (!res.ok) setOwner(prevOwner);
    });
  }

  function handleSnooze(preset: SnoozePreset) {
    const prev = snoozeUntil;
    setSnoozeUntil(nowPlus(PRESET_MS[preset]));
    startTransition(async () => {
      const res = await snoozeIncident(incidentKey, preset);
      if (!res.ok) setSnoozeUntil(prev);
    });
  }

  function handleUnsnooze() {
    const prev = snoozeUntil;
    setSnoozeUntil(null);
    startTransition(async () => {
      const res = await unsnoozeIncident(incidentKey);
      if (!res.ok) setSnoozeUntil(prev);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Acknowledge (D-05) — toggle to the "ack'd · {owner} · {age}" terminal stamp. */}
      <button
        type="button"
        onClick={handleAck}
        disabled={isPending}
        aria-pressed={acked}
        className={cn(CONTROL_BASE, acked ? CONTROL_ACTIVE : CONTROL_IDLE)}
      >
        {acked && ackedAt
          ? `ack'd · ${owner ?? "operator"} · ${formatAge(ackedAt)}`
          : "Acknowledge"}
      </button>

      {/* Assign-to-me / Unassign (D-02) — solo operator toggle, no named list. */}
      <button
        type="button"
        onClick={handleAssign}
        disabled={isPending}
        aria-pressed={assigned}
        className={cn(CONTROL_BASE, assigned ? CONTROL_ACTIVE : CONTROL_IDLE)}
      >
        {assigned ? "Unassign" : "Assign to me"}
      </button>

      {/* Snooze (D-03) — fixed-preset segmented control, no custom picker. */}
      <div
        role="group"
        aria-label="Snooze incident"
        className="inline-flex items-center gap-1 rounded-[3px] border border-df-border bg-df-surface p-0.5"
      >
        {SNOOZE_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => handleSnooze(preset)}
            disabled={isPending}
            aria-pressed={false}
            className="rounded-[3px] px-2 py-1 font-df-mono text-xs font-semibold tabular-nums tracking-[0.1em] text-df-brand uppercase transition-colors hover:bg-df-brand hover:text-white disabled:cursor-default disabled:opacity-60"
          >
            {preset}
          </button>
        ))}
      </div>

      {/* Snoozed-state chip + un-snooze affordance (reversible, D-03). */}
      {isSnoozed && snoozeUntil && (
        <span className="inline-flex items-center gap-2 font-df-mono text-xs tabular-nums text-df-muted">
          <span>snoozed until {formatUntil(snoozeUntil)}</span>
          <button
            type="button"
            onClick={handleUnsnooze}
            disabled={isPending}
            className="rounded-[3px] border border-df-border bg-df-surface px-2 py-1 font-df-mono text-xs font-semibold tracking-[0.1em] text-df-brand uppercase transition-colors hover:border-df-brand-light disabled:cursor-default disabled:opacity-60"
          >
            Un-snooze
          </button>
        </span>
      )}
    </div>
  );
}
