"use client";

import { Check, Sparkles, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { severityAccent, type Severity } from "./Severity";

// =====================================================
// AiReadPanel — navy "AI read" advisory band (Client, presentational)
// =====================================================
// The prototype "What needs you now" navy band (Ops Center 92-124). Unlike v1
// NarrateButton this is PURELY presentational — it calls no action, it just
// renders the advisory text the page already produced and (optionally) reports a
// dismiss intent up to the parent.
//
// SECURITY (RESEARCH §Security Domain):
//  - Spoofing mitigation (T-10-04): the verbatim zero-credential safety label is
//    a BUILT-IN element, not caller-supplied — the panel can never imply it runs
//    commands. The exact copy is frozen below.
//  - Tampering mitigation (T-10-03 / V14): advisory head/body text renders as
//    INERT plain text via `whitespace-pre-wrap`. React escapes by default — there
//    is NO `dangerouslySetInnerHTML` anywhere, so an advisory string containing
//    angle brackets is escaped, never live markup.
//
// The panel sits on the navy `bg-df-chrome` surface (chrome, NOT a severity hue);
// per-line rank squares carry a per-severity accent (df severity accent token).
// The `"use client"` directive exists only because the optional ✕ dismiss control
// wires an `onClick`; without `onDismiss` the panel renders identically server-side
// (the dismiss button is simply not emitted), so SSR string tests still pass.

/** Frozen verbatim zero-credential safety copy — do NOT edit (T-10-04). */
export const AI_SAFETY_LABEL = "AI · explains & ranks, never runs commands";
/** Frozen verbatim zero-credential footnote — do NOT edit (T-10-04). */
export const AI_ZERO_CREDENTIAL_NOTE = "NodeMonitor runs nothing for you.";
/** Frozen verbatim all-clear lead — do NOT edit (T-10-04). */
export const AI_ALL_CLEAR_LEAD = "Nothing needs you right now.";

/**
 * One advisory line — a numbered priority rank + a bold lead clause and a muted
 * continuation body. `head`/`body` map to the prototype's white-lead + blue-body
 * split; the older single-`text` shape is still accepted for back-compat.
 */
export interface AiReadLine {
  /** Severity tints the rank square's background (never the chrome bg). */
  sev: Severity;
  /**
   * Bold white lead clause (e.g. "host-03 bitcoind stalled. "). Optional only for
   * back-compat — when omitted, `text` is rendered as the muted body instead.
   */
  head?: string;
  /** Muted-blue continuation body (the "why" detail after the lead). */
  body?: string;
  /**
   * @deprecated Legacy single-string advisory. Still rendered (as the muted body)
   * so existing callers keep compiling; prefer `head` + `body`.
   */
  text?: string;
}

interface AiReadPanelProps {
  /** 1-4 advisory lines (the deterministic cards remain the source of truth). */
  lines: AiReadLine[];
  /** Optional band heading (defaults to the prototype's "What needs you now"). */
  heading?: string;
  /**
   * All-clear "calm" mode — renders the green-check "Nothing needs you right now"
   * state instead of the ranked lines. `calmDetail` continues the sentence.
   */
  allClear?: boolean;
  /** Continuation sentence shown after the all-clear lead (muted blue). */
  calmDetail?: string;
  /**
   * Optional dismiss handler. When provided, a ✕ control renders in the header
   * (the panel never self-hides — dismissal is the parent's state).
   */
  onDismiss?: () => void;
  /** Extra classes merged last via `cn()`. */
  className?: string;
}

/** The muted-blue body color from the prototype (`#CBD6EC`). */
const BODY_COLOR = "#CBD6EC";
/** The safety-pill border + muted label color from the prototype (`#A9B8D6`). */
const PILL_COLOR = "#A9B8D6";

/**
 * The navy AI-read advisory band. Carries the verbatim zero-credential safety
 * label and renders every advisory line as inert plain text — either as ranked
 * priority lines or, in `allClear` mode, the green-check calm state.
 */
export function AiReadPanel({
  lines,
  heading,
  allClear,
  calmDetail,
  onDismiss,
  className,
}: AiReadPanelProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-df-card-lg bg-df-chrome p-5 text-white shadow-df-hover",
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="inline-flex size-6 flex-none items-center justify-center rounded-df-btn bg-white/15">
          <Sparkles className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <span className="font-df-mono text-xs font-bold tracking-[0.08em] uppercase">
          {heading ?? "What needs you now"}
        </span>
        {/* Built-in spoofing-mitigation label — verbatim, not caller-supplied. */}
        <span
          className="rounded-df-pill border px-2.5 py-0.5 text-[11px] whitespace-nowrap"
          style={{ borderColor: "rgba(255,255,255,0.18)", color: PILL_COLOR }}
        >
          {AI_SAFETY_LABEL}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss AI read"
            className="ml-auto inline-flex size-6 flex-none items-center justify-center rounded-df-pill text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
          </button>
        )}
      </div>

      {allClear ? (
        <div className="flex items-center gap-3">
          <span
            className="inline-flex size-[30px] flex-none items-center justify-center rounded-df-btn"
            style={{ backgroundColor: "rgba(30,158,99,0.15)" }}
            aria-hidden="true"
          >
            <Check className="size-[17px]" strokeWidth={2.4} style={{ color: "#54D08A" }} />
          </span>
          {/* INERT plain text — React-escaped, whitespace-pre-wrap, no HTML sink. */}
          <p
            className="text-[14px] leading-relaxed whitespace-pre-wrap"
            style={{ color: BODY_COLOR }}
          >
            <span className="font-semibold text-white">{AI_ALL_CLEAR_LEAD}</span>
            {calmDetail ? ` ${calmDetail}` : ""}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {lines.map((line, i) => (
            <div key={i} className="flex items-start gap-3">
              {/* Numbered priority rank — colored ordinal square (severity accent). */}
              <span
                className={cn(
                  "mt-0.5 inline-flex size-5 flex-none items-center justify-center rounded-df-pill text-[10px] font-bold text-white",
                  severityAccent[line.sev],
                )}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              {/* INERT plain text — React-escaped, whitespace-pre-wrap, no HTML sink.
                  Bold white lead clause + muted-blue continuation body. */}
              <p
                className="text-[14px] leading-relaxed whitespace-pre-wrap"
                style={{ color: BODY_COLOR }}
              >
                {line.head && <span className="font-semibold text-white">{line.head}</span>}
                {line.body ?? line.text ?? ""}
              </p>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 border-t border-white/10 pt-3 font-df-mono text-[11px] text-white/55">
        {AI_ZERO_CREDENTIAL_NOTE}
      </p>
    </section>
  );
}
