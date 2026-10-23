import { BlastRadius, type BlastTarget } from "@/components/df/BlastRadius";

// =====================================================
// C5 — Dependents (SVC-02, Server)
// =====================================================
// What depends on THIS service — the blast radius the operator must see BEFORE
// acting. Rendered on the shipped `BlastRadius` grammar: the service (its owning
// host as the root-cause card) fanned out to the nodes + services that share it.
//
// The dependent set is DERIVED from the read-time ownership map (servicesByHost /
// nodesByHost) upstream and passed in as pre-built targets — never a fabricated
// list. A host-level infra service (e.g. bitcoind) fans out to every node on its
// host; a node-scoped service typically has no cross-node dependents, in which
// case the honest empty state renders instead of an empty diagram.

interface DependentsProps {
  /** Root-cause label (the owning host / service root), rendered mono in the card. */
  rootLabel: string;
  /** The root status line under the root label (e.g. the health verdict). */
  rootStatus: string;
  /** Impacted dependents derived from the ownership map. Empty → honest empty state. */
  targets: BlastTarget[];
  /** Honest empty-state copy when nothing depends on this service. */
  emptyLabel?: string;
}

/**
 * The service dependents / blast-radius panel. Renders the `BlastRadius` diagram
 * when there are dependents (derived from the ownership map), otherwise an honest
 * empty state. Server Component; read-only, emits nothing.
 */
export function Dependents({
  rootLabel,
  rootStatus,
  targets,
  emptyLabel = "Nothing else depends on this service.",
}: DependentsProps) {
  return (
    <section className="flex flex-col gap-3 rounded-df-card border border-df-border bg-df-surface p-5">
      <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
        Dependents · blast radius
      </div>
      {targets.length === 0 ? (
        <p className="text-[13.5px] text-df-muted">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <BlastRadius
            host={rootLabel}
            hostStatus={rootStatus}
            targets={targets}
            rootCauseLabel="THIS SERVICE · IMPACT"
          />
        </div>
      )}
    </section>
  );
}
