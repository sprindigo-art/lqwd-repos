"use client";

import { useState } from "react";

import { AiReadPanel, type AiReadLine } from "@/components/df/AiReadPanel";

// =====================================================
// AiBandClient — session-scoped dismiss wrapper around AiReadPanel (OVW-02 / D-05)
// =====================================================
// "use client" island. The deterministic band lines come from the server
// (`buildBandLines` / `buildCalmState` over the SAME grouped incident set) and are
// passed in as serializable props — this wrapper adds ONLY the dismiss interaction.
//
// D-05 (threat T-12-DIS-01): the dismiss is SESSION-SCOPED client state — a plain
// `useState(false)`. There is NO persistence (no localStorage / sessionStorage /
// cookie): a real problem can never stay hidden, because every reload re-derives
// the band from live state. `AiReadPanel` itself never self-hides (it has no dismiss
// state) — hiding is exclusively this island's `useState`, and the wrapper renders
// nothing only while `dismissed` is true.
//
// T-12-UI-01: the band's verbatim, caller-immutable `AI_SAFETY_LABEL` /
// zero-credential copy is BUILT INTO `AiReadPanel` — this wrapper passes only
// advisory text and a dismiss handler, so the band can never imply it runs commands.

interface AiBandClientProps {
  /** 1-4 deterministic advisory lines (server-built; the source of truth). */
  lines: AiReadLine[];
  /** Optional band heading override (defaults to "What needs you now"). */
  heading?: string;
  /** All-clear calm mode — renders the green-check "Nothing needs you right now". */
  allClear?: boolean;
  /** Continuation sentence after the all-clear lead (muted blue). */
  calmDetail?: string;
  /** Extra classes merged into the panel via `cn()`. */
  className?: string;
}

/**
 * Wraps `AiReadPanel` with a session-scoped dismiss. While dismissed the band
 * renders nothing; a reload re-mounts it from live state (no persistence, D-05).
 */
export function AiBandClient({ lines, heading, allClear, calmDetail, className }: AiBandClientProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <AiReadPanel
      lines={lines}
      heading={heading}
      allClear={allClear}
      calmDetail={calmDetail}
      onDismiss={() => setDismissed(true)}
      className={className}
    />
  );
}
