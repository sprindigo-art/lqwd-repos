"use client";

import { useState } from "react";

import { enqueueCommand } from "@/app/actions/queue";
import { updateFeeBoundsSchema } from "@/lib/queue/bounds";
import { feeMsatToSat, formatSats } from "@/lib/format/units";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// =====================================================
// EnqueuePreview — the ONE enqueue client leaf (QUEUE-01 / D-01 / D-02)
// =====================================================
// Structural twin of CommandExport: expand → inert preview → deliberate confirm.
// Presentational + one server action; it owns the `open`/edit/confirm state and
// NOTHING else. It receives SERIALIZABLE props only — never the card (containment
// T-05-03). It NEVER imports the signer or the server-only backend resolver (T-06-20/D-12):
// the props builder resolves the backend server-side and only mounts this leaf
// for LND-backed, non-null update_fee cards.
//
// Security (T-06-17/T-06-18): the client clamps edits to updateFeeBoundsSchema
// for UX, but the CONFIRM act sends params ONLY — enqueueCommand re-validates and
// SIGNS server-side. The client never produces or sends an HMAC signature.
//
// Sketch rules (sketch-findings-nodemonitor, binding): mono uppercase text
// controls, no icons-for-state, no animation, hairline borders, tight radii;
// navy reserved for the focus ring + the CONFIRM act; severity does state. Every
// numeric value renders via @/lib/format/units.ts with tabular-nums — no inline
// unit math. All free text renders as TEXT NODES only (V5) — never an HTML sink.

// The provisional bounds (bounds.ts [ASSUMED] band) — used for the input
// min/max attributes and the editable clamp. Single source: the zod schema's
// shape, read here so the UI echo can never drift from the server gate.
const PPM_BOUNDS = { min: 0, max: 5000 } as const;
const BASE_MSAT_BOUNDS = { min: 0, max: 100_000 } as const;
const TIMELOCK_BOUNDS = { min: 18, max: 2016 } as const;

/** mono-uppercase-over-outline-button chrome — the CommandExport control voice. */
const CONTROL_CHROME = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "font-df-mono text-xs font-semibold tracking-[0.14em] uppercase",
);

/** Clamp an integer edit to its bound band (UX only; the server re-validates). */
function clamp(value: number, bounds: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
}

/** Serializable enqueue payload — the SOLE thing that crosses to this leaf. */
export interface EnqueuePreviewProps {
  /** Owning node — 66-hex; re-validated server-side. */
  pubkey: string;
  /** Display alias / fallback pubkey for the `node` preview row. */
  nodeLabel: string;
  chanId: string;
  channelPoint: string;
  currentPpm: number;
  /** The engine's deterministic suggestion — the override baseline (D-03). */
  suggestedPpm: number;
  baseFeeMsat: number;
  timeLockDelta: number;
  /** Computed server-side (+TTL) so enqueue-time TTL stays authoritative. */
  expiresAtLabel: string;
}

type Phase = "idle" | "submitting" | "queued" | "error";

/** One inert key/value preview row in the params grammar. */
function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 font-df-mono text-xs">
      <span className="text-df-muted">{label}</span>
      <span className="tabular-nums text-df-muted">{children}</span>
    </div>
  );
}

/** One editable, bounds-clamped integer field with an inline min–max echo + override chip. */
function EditRow({
  label,
  value,
  bounds,
  suggested,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  bounds: { min: number; max: number };
  suggested: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const overridden = value !== suggested;
  return (
    <div className="flex flex-wrap items-baseline gap-3 font-df-mono text-xs">
      <span className="text-df-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value), bounds))}
        className={cn(
          "w-24 rounded-[3px] border border-df-border bg-df-surface px-2 py-0.5 text-right font-df-mono text-xs tabular-nums",
          "focus-visible:ring-2 focus-visible:ring-df-brand focus-visible:outline-none",
          "disabled:opacity-50",
        )}
      />
      <span className="text-df-muted">
        bounds {bounds.min.toLocaleString("en-US")}–{bounds.max.toLocaleString("en-US")}
      </span>
      {overridden && (
        <span className="rounded-[3px] border border-df-warning/40 bg-df-warning/10 px-1.5 py-0.5 font-semibold tracking-[0.14em] text-df-warning uppercase">
          OVERRIDDEN
        </span>
      )}
    </div>
  );
}

export function EnqueuePreview(props: EnqueuePreviewProps) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);

  // Editable-within-bounds working copy (seeded from the engine suggestion).
  const [ppm, setPpm] = useState(() => clamp(props.suggestedPpm, PPM_BOUNDS));
  const [baseMsat, setBaseMsat] = useState(() => clamp(props.baseFeeMsat, BASE_MSAT_BOUNDS));
  const [timelock, setTimelock] = useState(() => clamp(props.timeLockDelta, TIMELOCK_BOUNDS));

  const submitting = phase === "submitting";

  async function handleConfirm() {
    // Confirm gesture (D-02/D-04) — the write + HMAC signature is immutable after this.
    if (!window.confirm("Sign and queue this fee update? It will sign immutably and wait for your approval. Confirm to write.")) {
      return;
    }
    setPhase("submitting");
    setErrorText(null);
    // Client-side clamp echo of the authoritative server gate (defense in depth).
    const candidate = {
      chanId: props.chanId,
      channelPoint: props.channelPoint,
      currentPpm: props.currentPpm,
      suggestedPpm: clamp(ppm, PPM_BOUNDS),
      baseFeeMsat: clamp(baseMsat, BASE_MSAT_BOUNDS),
      timeLockDelta: clamp(timelock, TIMELOCK_BOUNDS),
    };
    const parsed = updateFeeBoundsSchema.safeParse(candidate);
    if (!parsed.success) {
      setPhase("error");
      setErrorText(`COULD NOT QUEUE — ${parsed.error.issues[0]?.message ?? "invalid params"}. Nothing was written.`);
      return;
    }
    // params ONLY — the client NEVER supplies a signature; the server signs.
    const result = await enqueueCommand({ pubkey: props.pubkey, params: parsed.data });
    if (result.ok) {
      setPhase("queued");
    } else {
      setPhase("error");
      setErrorText(result.error);
    }
  }

  const queued = phase === "queued";

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`enqueue-${props.chanId}`}
        className={CONTROL_CHROME}
        disabled={queued}
      >
        {open ? "hide preview" : "enqueue fee update"}
      </button>

      {/* Instant expand — no animation (CommandExport precedent). */}
      {open && (
        <div id={`enqueue-${props.chanId}`} className="mt-2 flex flex-col gap-2">
          {/* 1 — inert preview rows (node / channel / identity). */}
          <div className="flex flex-col gap-0.5">
            <PreviewRow label="node">{props.nodeLabel}</PreviewRow>
            <PreviewRow label="channel">{props.chanId}</PreviewRow>
            <PreviewRow label="current → proposed ppm">
              {props.currentPpm.toLocaleString("en-US")} → {ppm.toLocaleString("en-US")}
            </PreviewRow>
          </div>

          {/* 2 — editable-within-bounds rows with override flagging. */}
          <div className="flex flex-col gap-1">
            <EditRow
              label="proposed ppm"
              value={ppm}
              bounds={PPM_BOUNDS}
              suggested={clamp(props.suggestedPpm, PPM_BOUNDS)}
              disabled={submitting || queued}
              onChange={setPpm}
            />
            <EditRow
              label="base fee (msat)"
              value={baseMsat}
              bounds={BASE_MSAT_BOUNDS}
              suggested={clamp(props.baseFeeMsat, BASE_MSAT_BOUNDS)}
              disabled={submitting || queued}
              onChange={setBaseMsat}
            />
            <EditRow
              label="timelock delta"
              value={timelock}
              bounds={TIMELOCK_BOUNDS}
              suggested={clamp(props.timeLockDelta, TIMELOCK_BOUNDS)}
              disabled={submitting || queued}
              onChange={setTimelock}
            />
          </div>

          {/* 3 — derived sat echo + expiry (AFM-002 formatter, never inline math). */}
          <div className="flex flex-col gap-0.5">
            <PreviewRow label="base fee (sat)">{formatSats(feeMsatToSat(baseMsat))}</PreviewRow>
            <PreviewRow label="expires">{props.expiresAtLabel}</PreviewRow>
          </div>

          {/* 4 — the deliberate write act (navy chrome) + in-place success/error echo. */}
          <div className="flex flex-col items-end gap-1">
            {!queued ? (
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={submitting}
                className={cn(
                  CONTROL_CHROME,
                  "border-df-brand text-df-brand hover:bg-df-brand/5",
                  "disabled:opacity-50",
                )}
                aria-live="polite"
              >
                {submitting ? "QUEUEING…" : "CONFIRM ENQUEUE"}
              </button>
            ) : (
              <span
                className="font-df-mono text-xs font-semibold tracking-[0.14em] text-df-ok-text uppercase"
                aria-live="polite"
              >
                QUEUED — PENDING APPROVAL
              </span>
            )}
            {phase === "error" && errorText !== null && (
              <p className="font-df-mono text-xs text-df-critical" aria-live="assertive">
                {errorText}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
