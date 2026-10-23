import { CommandModal, type RunbookStep } from "@/components/df/CommandModal";

// =====================================================
// C6 — VerifyFirstRunbook (SVC-02, Server)
// =====================================================
// A UNIFIED verify-first runbook: symptom-confirmation steps come FIRST (the
// "Verify first" lead), THEN the remediation command(s) as INERT copy-to-run via
// the shipped `CommandModal` / `CommandPanel`. It NEVER executes anything and emits
// no signed param — the dashboard holds zero node credentials; a human runs the
// exported command on the node (re-affirmed Phase 16 HARDEN-03).
//
// One tree, two variants:
//   • infra (bitcoind) → the safe COORDINATED-restart procedure (explicitly NOT an
//     auto-restart) — every node on the host shares this backend, so it is framed
//     as a higher-risk host operation (`kind="runbook"`).
//   • custom (addressBalances / other) → the service-specific recovery
//     (`kind="command"`).
//
// Server Component. `CommandModal` is a `"use client"` boundary (Radix dialog +
// clipboard copy); composing it here needs no client JS in this module. The
// command/runbook strings render as React-escaped inert text inside `CommandModal`.

interface VerifyFirstRunbookProps {
  /** "infra" (bitcoind, coordinated restart) or "custom" (service recovery). */
  variant: "infra" | "custom";
  /** Operator-facing service name (never the raw key) — used in prose. */
  serviceLabel: string;
  /** Raw service machine key — used in the inert shell command (systemctl unit). */
  serviceKey: string;
  /** The host the service runs on — used in prose + the command comment. */
  hostId: string;
}

/** Per-variant verify-first steps, inert command, and remediation runbook. */
function buildRunbook(props: VerifyFirstRunbookProps): {
  verifySteps: string[];
  command: string;
  runbook: RunbookStep[];
  kind: "runbook" | "command";
  intent: string;
} {
  const { variant, serviceLabel, serviceKey, hostId } = props;

  if (variant === "infra") {
    return {
      kind: "runbook",
      intent: `Coordinated restart of ${serviceLabel} on ${hostId} — every node on this host shares it.`,
      verifySteps: [
        `Confirm the symptom: is blocks-behind in the vitals above still climbing, or has it recovered on its own?`,
        `Verify it is the backend, not the network — run \`bitcoin-cli getblockchaininfo\` on ${hostId} and compare \`blocks\` vs \`headers\`.`,
        `Check the dependents / blast radius above BEFORE acting — a restart affects every node on ${hostId}.`,
      ],
      command: [
        `# Coordinated restart — run on ${hostId}. NOT automated by NodeMonitor.`,
        `sudo systemctl restart bitcoind`,
        `# then watch it catch up to the chain tip:`,
        `watch -n5 'bitcoin-cli getblockchaininfo | jq ".blocks, .headers"'`,
      ].join("\n"),
      runbook: [
        { n: 1, text: `Announce the maintenance window — every node on ${hostId} depends on this bitcoind.` },
        { n: 2, text: `Restart bitcoind on the host (command below), then confirm blocks catches up to headers.` },
        { n: 3, text: `Verify each dependent node (blast radius above) reconnects before closing the window.` },
      ],
    };
  }

  return {
    kind: "command",
    intent: `Recovery for ${serviceLabel} on ${hostId}.`,
    verifySteps: [
      `Confirm the symptom: check the last-successful-run and error count in the vitals above.`,
      `Read the log tail above for the failing step before restarting.`,
      `Confirm the dependency the service needs is reachable — a restart won't fix an unreachable dependency.`,
    ],
    command: [
      `# Recovery — run on ${hostId}. NOT automated by NodeMonitor.`,
      `sudo systemctl restart ${serviceKey}`,
      `# then confirm the next run completes without errors:`,
      `journalctl -u ${serviceKey} -n 50 --no-pager`,
    ].join("\n"),
    runbook: [
      { n: 1, text: `Confirm the dependency the service needs is reachable before restarting.` },
      { n: 2, text: `Restart the service (command below).` },
      { n: 3, text: `Watch the next scheduled run complete without errors in the log tail above.` },
    ],
  };
}

/**
 * The verify-first runbook. Renders the "Verify first" symptom-confirmation steps
 * FIRST, then an inert `CommandModal` (copy-to-run) for the remediation. Never
 * executes; emits no command or signed param. Server Component.
 */
export function VerifyFirstRunbook(props: VerifyFirstRunbookProps) {
  const { serviceLabel } = props;
  const { verifySteps, command, runbook, kind, intent } = buildRunbook(props);

  return (
    <section className="flex flex-col gap-4 rounded-df-card border border-df-border bg-df-surface p-5">
      <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
        Runbook
      </div>

      {/* VERIFY FIRST — symptom-confirmation steps precede any command (Copywriting). */}
      <div className="flex flex-col gap-3">
        <div className="font-df-mono text-[12px] font-bold tracking-[0.06em] text-df-brand uppercase">
          Verify first
        </div>
        <ol className="flex flex-col gap-2.5">
          {verifySteps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                className="mt-0.5 flex size-5 flex-none items-center justify-center rounded-full bg-df-border-soft text-[11px] font-bold text-df-brand"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <p className="text-[13px] leading-relaxed text-df-ink">{step}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* THEN the remediation — inert copy-to-run via CommandModal (never executes). */}
      <div className="border-t border-df-border-soft pt-4">
        <CommandModal
          title={`Runbook · ${serviceLabel}`}
          intent={intent}
          sev={kind === "runbook" ? "critical" : "warning"}
          kind={kind}
          command={command}
          runbook={runbook}
          trigger={
            <button
              type="button"
              className="rounded-df-btn bg-df-chrome px-4 py-2 font-df-mono text-[12.5px] font-semibold text-white"
            >
              {kind === "runbook" ? "Open runbook" : "Export fix"}
            </button>
          }
        />
      </div>
    </section>
  );
}
