"use client";

import { useEffect, useState } from "react";

import { formatPollAge } from "./NavRailShell";

// =====================================================
// PollAge — an HONEST, client-ticking data-age label
// =====================================================
// Replaces the fake "Live · polled Ns ago" green-dot pill (D-R7). This label
// makes NO live-connection claim: it states only the true AGE of the data,
// derived from the real fetch epoch the page hands down, and ticks that age
// forward once a second. There is intentionally NO "Live" word and NO green
// status-dot ring — the page's core honesty principle (advisory-only, honest
// staleness) forbids implying a freshness the read cannot guarantee.
//
// Hydration: `now` seeds from `sinceMs` so the FIRST client paint equals the
// SSR paint (age 0s) — no hydration flash. The interval then advances `now` to
// the real wall clock; the interval is cleared on unmount so no timer leaks
// (T-12-15-03). df-token-only markup (noc-guard clean).

/** Zero-padded local HH:MM:SS from an epoch — the honest "data as of" clock. */
function clockLabel(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * The honest data-age label: `data as of HH:MM:SS · Ns ago`, the age ticking
 * client-side from the real fetch epoch.
 */
export function PollAge({ sinceMs }: { sinceMs: number }) {
  // Seed with the fetch epoch so first client paint == SSR paint (age 0s).
  const [now, setNow] = useState<number>(() => sinceMs);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageSeconds = Math.max(0, Math.floor((now - sinceMs) / 1000));

  return (
    <div
      className="flex items-center gap-1.5 font-df-mono text-[11px] text-df-muted"
      data-testid="poll-age"
    >
      data as of{" "}
      {/* Clock derives from local time; suppress a benign TZ/boundary rehydration diff. */}
      <b className="font-medium text-df-muted" suppressHydrationWarning>
        {clockLabel(sinceMs)}
      </b>{" "}
      ·{" "}
      <b className="font-semibold tabular-nums text-df-ink" suppressHydrationWarning>
        {formatPollAge(ageSeconds)} ago
      </b>
    </div>
  );
}
