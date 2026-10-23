"use client";

import { useState, useTransition } from "react";

import { narrateIncident } from "@/app/actions/narrate-incident";
import { AiReadPanel, type AiReadLine } from "@/components/df/AiReadPanel";
import { severityAccent, type Severity } from "@/components/df/Severity";
import { cn, FOCUS_RING } from "@/lib/utils";

// =====================================================
// IncidentReadClient — AIX-01/AIX-02 on-demand AI read (Client, D-12/D-13/D-15)
// =====================================================
// The on-demand advisory read region: an EXPLAIN trigger (NarrateButton grammar),
// a worstSeverity-derived VERDICT badge, the reused (inert) `AiReadPanel`, and a
// session-only dismiss (AiBandClient precedent — plain `useState(false)`, NO
// persistence, so a reload re-derives it, D-15).
//
// Deterministic-first (FM-5): the read is opt-in and never blocks the page. On
// {ok:false}/withheld/flag-off we render the fixed "AI read unavailable…" copy —
// the deterministic incident cards stand alone.
//
// SECURITY: the prose renders through `AiReadPanel`'s INERT whitespace-pre-wrap,
// React-escaped path (T-17-15) — NO `dangerouslySetInnerHTML`, no markdown-to-HTML.
// The verdict is derived from the deterministic payload's `worstSeverity` (NEVER
// the model's mood) and wears the SEVERITY ramp, never navy (DS-01, FM-3): a
// critical is never visually downgraded.

/**
 * Verdict label per severity — advisory + command-free (D-13). Derived from the
 * incident's deterministic `worstSeverity`, never from model text. The three
 * off-ramp severities (healthy/stale) collapse to "Informational" by design.
 */
export const VERDICT_LABEL: Record<Severity, string> = {
  critical: "Act now",
  warning: "Monitor",
  watch: "Informational",
  healthy: "Informational",
  stale: "Informational",
};

/** Fixed degradation copy — the read is absent, the cards stand alone (FM-5). */
const READ_UNAVAILABLE = "AI read unavailable — the incident details below stand on their own.";

/**
 * The one-line urgency verdict chip. Wears the df severity ramp
 * (`severityAccent[sev]`) — NEVER navy (navy = chrome, not state). White mono
 * uppercase text pairs the color with the explicit word (DS-01: color never the
 * sole signal).
 */
export function VerdictBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-df-pill px-2.5 py-0.5 font-df-mono text-[11px] font-bold tracking-[0.08em] text-white uppercase",
        severityAccent[severity],
      )}
    >
      {VERDICT_LABEL[severity]}
    </span>
  );
}

interface IncidentReadClientProps {
  incidentKey: string;
  /** Deterministic worst severity of the incident — drives the verdict badge. */
  worstSeverity: Severity;
  /** AIX-02 one-line "why grouped" rationale (no action field, by construction). */
  rationaleLine?: AiReadLine;
}

export function IncidentReadClient({
  incidentKey,
  worstSeverity,
  rationaleLine,
}: IncidentReadClientProps) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();

  // Session-only dismiss (D-15): while dismissed the whole read region renders
  // nothing; a reload re-mounts it (no persistence). Mirrors AiBandClient.
  if (dismissed) return null;

  function handleExplain() {
    startTransition(async () => {
      setFailed(false);
      const res = await narrateIncident(incidentKey);
      if (res.ok) {
        setText(res.text);
      } else {
        setText(null);
        setFailed(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {/* AIX-02 rationale — reuses AiReadLine (no action field), shown alongside. */}
      {rationaleLine && (
        <p className="font-df-mono text-xs leading-relaxed text-df-muted">
          {rationaleLine.head}
          {rationaleLine.body ?? rationaleLine.text ?? ""}
        </p>
      )}

      {/* On-demand trigger (D-12) — NarrateButton grammar; server re-checks the flag. */}
      {text === null && (
        <button
          type="button"
          onClick={handleExplain}
          disabled={isPending}
          className={cn(
            "w-fit rounded-[3px] border border-df-border bg-df-surface px-3 py-1.5 font-df-mono text-xs font-semibold tracking-[0.14em] text-df-brand uppercase transition-colors hover:border-df-brand-light hover:text-df-brand disabled:cursor-default disabled:opacity-60",
            FOCUS_RING,
          )}
        >
          {isPending ? "READING…" : "EXPLAIN — LLM"}
        </button>
      )}

      {/* Degradation (FM-5): read failed/withheld — cards stand alone, never blocks. */}
      {failed && text === null && (
        <p className="font-df-mono text-xs text-df-muted">{READ_UNAVAILABLE}</p>
      )}

      {/* Success: verdict badge LEADS the inert AiReadPanel prose (D-13). */}
      {text !== null && (
        <div className="flex flex-col gap-2">
          <VerdictBadge severity={worstSeverity} />
          <AiReadPanel
            lines={[{ sev: worstSeverity, body: text }]}
            onDismiss={() => setDismissed(true)}
          />
        </div>
      )}
    </div>
  );
}
