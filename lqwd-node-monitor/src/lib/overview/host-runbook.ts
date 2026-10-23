// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// host-runbook.ts — verify-first runbook builder per incident driver class (D-11)
// =====================================================
// Every host incident driver class maps to a verify-first runbook: "Verify first"
// symptom-confirmation steps PRECEDE any remedial command (UI-SPEC Copywriting
// Contract — calm, plain operator language). This module emits COPY ONLY:
// inert strings consumed exclusively by the CommandModal with kind:"runbook"
// (escaped text + copy-to-clipboard). NodeMonitor never executes anything
// (T-14-11 — no exec path exists in this phase).
//
// HARD (T-14-10, 12-11 precedent): no string in any output may contain a
// credential, a token, a connection URL, or an internal DB name. The command
// strings are plain operator shell text a human reviews and runs on the node.

import type { RunbookStep } from "@/components/df/CommandModal";

/** The closed driver-class union — the four host incident drivers (D-11). */
export type HostRunbookDriver =
  | "bitcoind-down"
  | "service-not-functioning"
  | "disk-filling"
  | "node-critical";

/** The CommandModal consumer contract: title + ordered steps + inert command. */
export interface HostRunbook {
  title: string;
  runbook: RunbookStep[];
  command: string;
}

/** Number a list of step texts 1..n into the RunbookStep shape. */
function steps(texts: string[]): RunbookStep[] {
  return texts.map((text, i) => ({ n: i + 1, text }));
}

/**
 * Build the verify-first runbook for a driver class. Exhaustive over the closed
 * union — no default fallthrough, so an unhandled class is a compile error, never
 * an undefined at runtime.
 *
 * `serviceLabel` (used by "service-not-functioning") is the service's HUMAN
 * display label — copy names the label the operator sees in the UI, never a raw
 * machine key. Callers pass it from the service display map.
 */
export function buildHostRunbook(
  driver: HostRunbookDriver,
  serviceLabel = "the service",
): HostRunbook {
  switch (driver) {
    case "bitcoind-down":
      return {
        title: "Restart bitcoind",
        runbook: steps([
          "Verify first — confirm bitcoind is actually down: run `systemctl status bitcoind` on the host and check the unit is not active.",
          "Cross-check the daemon directly: run `bitcoin-cli getblockchaininfo` — a normal reply means bitcoind is up and this alert may be stale; stop here and re-check data freshness instead.",
          "Review the last log lines for the failure cause: `journalctl -u bitcoind -n 50`. If the disk is full or the process was killed for memory, fix that cause first — a restart alone will not hold.",
          "Once the outage is confirmed and the cause is understood, run the command below, then repeat step 1 to confirm the unit is active again.",
        ]),
        command: "systemctl restart bitcoind",
      };

    case "service-not-functioning":
      return {
        title: `Recover ${serviceLabel}`,
        runbook: steps([
          `Verify first — confirm ${serviceLabel} is running but not functioning: run \`systemctl status\` for its unit on the host. An active unit alongside this alert means the process is up but unresponsive.`,
          `Inspect the recent logs for errors or a hang: \`journalctl -u <service-unit> -n 50\` (substitute the host's actual unit name).`,
          `If ${serviceLabel} is up but dead, restart it with the command below, then repeat step 1 and confirm it reports functioning again. If it fails the same way twice, stop and investigate the logged error before another restart.`,
        ]),
        command: "systemctl restart <service-unit>",
      };

    case "disk-filling":
      return {
        title: "Free disk space",
        runbook: steps([
          "Verify first — confirm the volume is actually filling: run `df -h` on the host and check the usage and growth match this alert.",
          "Find what is growing: `du -xh --max-depth=2 / 2>/dev/null | sort -h | tail -20` — logs and chain data are the usual suspects.",
          "If journal logs are the growth source, reclaim space with the command below. If something else is growing, archive or remove it deliberately — never delete chain data or channel state to free space.",
        ]),
        command: "journalctl --vacuum-size=500M",
      };

    case "node-critical":
      return {
        title: "Investigate critical node",
        runbook: steps([
          "Verify first — check the node's status directly: run `lncli getinfo` on the node (or your LDK node's status command) and confirm whether it responds and reports synced to chain.",
          "Check the node's service and recent logs on the host: `systemctl status` its unit and `journalctl -u <node-unit> -n 50` for the driving error.",
          "Open the node in Node Detail to see which signal is driving the critical, then act on that specific driver — do not restart blindly; a restart can force-close channels mid-operation.",
        ]),
        command: "lncli getinfo",
      };
  }
}
