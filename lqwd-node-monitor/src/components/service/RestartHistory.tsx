import { WhyChain, type WhyChainEvent } from "@/components/df/WhyChain";

// =====================================================
// C4 — RestartHistory (SVC-02, Server)
// =====================================================
// A READ-ONLY restart/recovery timeline for ONE service — when the process last
// cycled — rendered on the shipped `WhyChain` detection-chain spine. It never
// mutates and never emits a command; it is a factual history of observed cycles.
//
// Honest empty state (Copywriting Contract): when no restarts are recorded the
// verbatim "No restarts recorded for this service." copy renders — never a
// fabricated event. Events are supplied pre-formatted (timestamp + text +
// severity) by the read layer, oldest → newest.

/** The verbatim empty-state copy (Copywriting Contract) — do NOT drift. */
export const RESTART_HISTORY_EMPTY = "No restarts recorded for this service.";

interface RestartHistoryProps {
  /** Ordered restart/recovery events, oldest → newest. Empty → honest empty state. */
  events: WhyChainEvent[];
}

/**
 * The read-only restart/recovery timeline. Renders the `WhyChain` spine when there
 * are events, otherwise the verbatim honest empty state. Server Component.
 */
export function RestartHistory({ events }: RestartHistoryProps) {
  return (
    <section className="flex flex-col gap-3 rounded-df-card border border-df-border bg-df-surface p-5">
      <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
        Restart history
      </div>
      {events.length === 0 ? (
        <p className="text-[13.5px] text-df-muted">{RESTART_HISTORY_EMPTY}</p>
      ) : (
        <WhyChain events={events} label="Restart / recovery timeline" />
      )}
    </section>
  );
}
