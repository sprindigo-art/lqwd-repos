"use client";

import { useState, useTransition } from "react";

import { narrate, type NarrateScope } from "@/app/actions/narrate";

// =====================================================
// NarrateButton — D-17 client trigger (both scope levels)
// =====================================================
// The repo's first interactive client leaf. Wave-5 pages mount it at the inbox
// (fleet scope) and on the per-node console (node scope); it renders only when
// the server told the page the LLM flag is on — but visibility is NOT the
// gate: the narrate server action re-checks isLlmEnabled() itself.
//
// Injection containment (T-04-19/T-04-23): the LLM's text renders as PLAIN
// TEXT in a whitespace-pre-wrap paragraph — no raw-HTML injection, no
// markdown rendering — under a header that marks it as LLM output.
// Sketch rules: no icons/emoji for state; mono uppercase labels; hairline
// borders; tight radii; navy is the interactive accent.

interface NarrateButtonProps {
  scope: NarrateScope;
}

export function NarrateButton({ scope }: NarrateButtonProps) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      setError(null);
      const result = await narrate(scope);
      if (result.ok) {
        setText(result.text);
      } else {
        setText(null);
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-[3px] border border-df-border bg-df-surface px-3 py-1.5 font-df-mono text-xs font-semibold tracking-[0.14em] text-df-brand uppercase transition-colors hover:border-df-brand-light hover:text-df-brand disabled:cursor-default disabled:opacity-60"
      >
        {isPending ? "GENERATING…" : "NARRATE — LLM"}
      </button>

      {(text !== null || error !== null) && (
        <section className="mt-3 rounded-md border border-df-border bg-df-surface">
          <div className="border-b border-df-border px-4 py-2.5">
            <span className="font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase">
              LLM OUTPUT — narrative only, not a recommendation source
            </span>
          </div>
          {/* Plain text only — no raw-HTML injection, no markdown rendering. */}
          <p className="px-4 py-3 font-df-mono text-xs whitespace-pre-wrap text-df-ink">
            {error ?? text}
          </p>
        </section>
      )}
    </div>
  );
}
