"use client";

import { useState } from "react";

import { enqueueAndApprove, type EnqueueAndApproveInput } from "@/app/actions/queue";
import { updateFeeBoundsSchema } from "@/lib/queue/bounds";
import { feeMsatToSat, formatSats } from "@/lib/format/units";
import type { EnqueuePreviewProps } from "@/components/queue/EnqueuePreview";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

// =====================================================
// NodeFeeEnqueue — the B8 per-channel fee-queue leaf (FORK of EnqueuePreview)
// =====================================================
// RESEARCH Drift 1: EnqueuePreview CANNOT be reused verbatim for B8 — it lands a
// `pending_approval` row via a different action, still carries a redundant confirm
// dialog, shows the wrong success copy, and has no stale-baseline gate. This is
// the forked leaf.
//
// KEPT VERBATIM from EnqueuePreview (the load-bearing invariants):
//   • params-only / server-signs boundary — the client sends { pubkey, params,
//     staleAck } ONLY and NEVER produces or sends an HMAC signature;
//   • the updateFeeBoundsSchema client clamp (UX echo of the authoritative gate);
//   • the CONTROL_CHROME mono-uppercase button voice;
//   • the EditRow / PreviewRow grammar + AFM-002 formatting (no inline unit math).
//
// The four B8 deltas (RESEARCH Drift 1 + D-11 + D-05):
//   1. calls the enqueueAndApprove action → lands `approved` in ONE act;
//   2. the redundant browser confirm dialog is DROPPED — the navy CONFIRM button
//      IS the deliberate gesture (D-11);
//   3. success copy is the D-11 verbatim "Queued + approved · fee intent for
//      <chan_id short> awaits this node's next verified tick.";
//   4. the D-05 stale-baseline gate — a stale baseline shows the warning + blocks
//      CONFIRM until the operator sets staleAck, which is threaded into the action.
//
// B8 is NO-AI: suggestedPpm = currentPpm (the props builder seeds it), so ppm is
// editable both UP and DOWN (fixing the canary's no-clean-revert gap).

// Bounds echo of the frozen bounds.ts gate — input min/max attrs + editable clamp.
const PPM_BOUNDS = { min: 0, max: 5000 } as const;
const BASE_MSAT_BOUNDS = { min: 0, max: 100_000 } as const;
const TIMELOCK_BOUNDS = { min: 18, max: 2016 } as const;

/** mono-uppercase-over-outline-button chrome — the shared control voice. */
const CONTROL_CHROME = cn(
  buttonVariants({ variant: "outline", size: "sm" }),
  "font-mono text-xs font-semibold tracking-[0.14em] uppercase",
);

/** Clamp an integer edit to its bound band (UX only; the server re-validates). */
function clamp(value: number, bounds: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return bounds.min;
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
}

/** Short chan_id for the success copy — never the full identifier. */
function shortChanId(chanId: string): string {
  return chanId.length <= 12 ? chanId : `${chanId.slice(0, 6)}…${chanId.slice(-4)}`;
}

/**
 * PURE, exported D-05 gate predicate (mirrors ApprovePanel's `approveBlocked =
 * isStale && !staleAck`). CONFIRM is blocked whenever the baseline is stale and
 * the operator has NOT acknowledged it; a fresh baseline never blocks. Exported so
 * the D-05 behavior is unit-testable dep-free (RESEARCH §H — no jsdom).
 */
export function feeEnqueueConfirmBlocked({
  baselineStale,
  staleAck,
}: {
  baselineStale: boolean;
  staleAck: boolean;
}): boolean {
  return baselineStale && !staleAck;
}

/** Editable working copy of the bounds-clamped fields. */
interface FeeEdit {
  ppm: number;
  baseMsat: number;
  timelock: number;
}

/**
 * PURE, exported builder of the EXACT `{ pubkey, params, staleAck }` handed to
 * enqueueAndApprove. Threads the operator's acknowledged `staleAck` through
 * verbatim (D-05) and clamps every param to its bound band (defense in depth).
 * Exported so the staleAck-threading is unit-testable dep-free (no DOM click).
 */
export function buildEnqueueAndApproveArgs(
  props: Pick<EnqueuePreviewProps, "pubkey" | "chanId" | "channelPoint" | "currentPpm">,
  edit: FeeEdit,
  staleAck: boolean,
): EnqueueAndApproveInput {
  return {
    pubkey: props.pubkey,
    params: {
      chanId: props.chanId,
      channelPoint: props.channelPoint,
      currentPpm: props.currentPpm,
      suggestedPpm: clamp(edit.ppm, PPM_BOUNDS),
      baseFeeMsat: clamp(edit.baseMsat, BASE_MSAT_BOUNDS),
      timeLockDelta: clamp(edit.timelock, TIMELOCK_BOUNDS),
    },
    staleAck,
  };
}

/** B8 leaf props: the serializable EnqueuePreviewProps + the D-05 stale flag. */
export interface NodeFeeEnqueueProps extends EnqueuePreviewProps {
  /** D-05 gate: the channel's fee baseline is older than FEE_BASELINE_STALE_MS. */
  baselineStale: boolean;
  /** Optional relative-age label for the stale warning copy (e.g. "7h"). */
  baselineAgeLabel?: string;
  /** Seed the expanded state (testability + deep-link affordance); defaults to false. */
  defaultOpen?: boolean;
}

type Phase = "idle" | "submitting" | "queued" | "error";

/** One inert key/value preview row in the params grammar. */
function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 font-mono text-xs">
      <span className="text-foreground/45">{label}</span>
      <span className="tabular-nums text-foreground/60">{children}</span>
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
    <div className="flex flex-wrap items-baseline gap-3 font-mono text-xs">
      <span className="text-foreground/45">{label}</span>
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
          "w-24 rounded-[3px] border border-border bg-card px-2 py-0.5 text-right font-mono text-xs tabular-nums",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "disabled:opacity-50",
        )}
      />
      <span className="text-foreground/35">
        bounds {bounds.min.toLocaleString("en-US")}–{bounds.max.toLocaleString("en-US")}
      </span>
      {overridden && (
        <span className="rounded-[3px] border border-status-warn/40 bg-status-warn/10 px-1.5 py-0.5 font-semibold tracking-[0.14em] text-status-warn uppercase">
          OVERRIDDEN
        </span>
      )}
    </div>
  );
}

export function NodeFeeEnqueue(props: NodeFeeEnqueueProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [staleAck, setStaleAck] = useState(false);

  // Editable-within-bounds working copy (seeded from the no-AI baseline = current).
  const [ppm, setPpm] = useState(() => clamp(props.suggestedPpm, PPM_BOUNDS));
  const [baseMsat, setBaseMsat] = useState(() => clamp(props.baseFeeMsat, BASE_MSAT_BOUNDS));
  const [timelock, setTimelock] = useState(() => clamp(props.timeLockDelta, TIMELOCK_BOUNDS));

  const submitting = phase === "submitting";
  const queued = phase === "queued";

  // D-05 blocked-by-default: CONFIRM is disabled on a stale baseline until acked.
  const confirmBlocked = feeEnqueueConfirmBlocked({
    baselineStale: props.baselineStale,
    staleAck,
  });

  async function handleConfirm() {
    if (confirmBlocked) return; // belt-and-suspenders; the button is already disabled.
    setPhase("submitting");
    setErrorText(null);
    // params ONLY + the acknowledged staleAck — the client NEVER supplies a signature.
    const args = buildEnqueueAndApproveArgs(props, { ppm, baseMsat, timelock }, staleAck);
    // Client-side clamp echo of the authoritative server gate (defense in depth).
    const parsed = updateFeeBoundsSchema.safeParse(args.params);
    if (!parsed.success) {
      setPhase("error");
      setErrorText(
        `COULD NOT QUEUE — ${parsed.error.issues[0]?.message ?? "invalid params"}. Nothing was written.`,
      );
      return;
    }
    const result = await enqueueAndApprove(args);
    if (result.ok) {
      setPhase("queued");
    } else {
      setPhase("error");
      setErrorText(result.error);
    }
  }

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
        {open ? "hide preview" : "queue fee change"}
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

          {/* 2 — editable-within-bounds rows (raise OR lower) with override flagging. */}
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

          {/* 4 — D-05 stale-baseline gate: gold warning + the blocking ack checkbox. */}
          {props.baselineStale && (
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-xs text-status-warn">
                Baseline may be stale — this channel&apos;s last fee reading is{" "}
                {props.baselineAgeLabel ?? "over 6h"} old. Confirm you&apos;re setting against the
                intended current policy before you queue.
              </p>
              <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-foreground/70">
                <Checkbox
                  checked={staleAck}
                  onCheckedChange={(v) => setStaleAck(v === true)}
                  disabled={submitting || queued}
                  aria-label="I acknowledge this fee baseline may be stale"
                />
                <span>I acknowledge this fee baseline may be stale</span>
              </label>
            </div>
          )}

          {/* 5 — the ONE deliberate write act (navy chrome, no extra confirm dialog) + echo. */}
          <div className="flex flex-col items-end gap-1">
            {!queued ? (
              <>
                <p className="w-full text-left font-mono text-[11px] text-foreground/45">
                  Signs a fee intent this node verifies and applies. NodeMonitor holds no node
                  credentials.
                </p>
                <button
                  type="button"
                  onClick={() => void handleConfirm()}
                  disabled={submitting || confirmBlocked}
                  className={cn(
                    CONTROL_CHROME,
                    "border-brand text-brand hover:bg-brand/5",
                    "disabled:opacity-50",
                  )}
                  aria-live="polite"
                >
                  {submitting ? "QUEUEING…" : "ENQUEUE + APPROVE"}
                </button>
              </>
            ) : (
              <span
                className="font-mono text-xs font-semibold tracking-[0.14em] text-status-ok uppercase"
                aria-live="polite"
              >
                Queued + approved · fee intent for {shortChanId(props.chanId)} awaits this node&apos;s
                next verified tick.
              </span>
            )}
            {phase === "error" && errorText !== null && (
              <p className="font-mono text-xs text-status-critical" aria-live="assertive">
                {errorText}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
