import { describe, expect, it } from "vitest";

import {
  buildHostRunbook,
  type HostRunbook,
  type HostRunbookDriver,
} from "@/lib/overview/host-runbook";

// =====================================================
// host-runbook.test.ts — verify-first runbook builder per driver class (D-11)
// =====================================================
// Every incident driver class maps to a verify-first runbook: "Verify first"
// symptom-confirmation steps PRECEDE any command (UI-SPEC Copywriting Contract).
// This module emits inert copy only — consumed by CommandModal kind:"runbook",
// never executed. HARD (T-14-10): no output string may contain a credential,
// a connection URL, or an internal DB name (12-11 precedent — routing_vm = 0).

const DRIVERS: HostRunbookDriver[] = [
  "bitcoind-down",
  "service-not-functioning",
  "disk-filling",
  "node-critical",
];

/** Collect every output string of a runbook into one scannable list. */
function allStrings(rb: HostRunbook): string[] {
  return [rb.title, rb.command, ...rb.runbook.map((s) => s.text)];
}

describe("buildHostRunbook — shape per driver class (closed union, exhaustive)", () => {
  it.each(DRIVERS)("%s returns a title, ≥2 numbered steps, and a non-empty command", (driver) => {
    const rb = buildHostRunbook(driver);
    expect(rb).toBeDefined();
    expect(rb.title.length).toBeGreaterThan(0);
    expect(rb.runbook.length).toBeGreaterThanOrEqual(2);
    expect(rb.command.trim().length).toBeGreaterThan(0);
  });

  it.each(DRIVERS)("%s numbers steps consecutively from 1 (RunbookStep contract)", (driver) => {
    const rb = buildHostRunbook(driver);
    expect(rb.runbook.map((s) => s.n)).toEqual(rb.runbook.map((_, i) => i + 1));
  });

  it.each(DRIVERS)("%s leads with a 'Verify first' symptom-confirmation step (D-11)", (driver) => {
    const rb = buildHostRunbook(driver);
    expect(rb.runbook[0].text).toMatch(/^Verify first/);
  });
});

describe("buildHostRunbook — per-class verification anchors", () => {
  it("bitcoind-down verifies via systemctl status + getblockchaininfo before restarting", () => {
    const rb = buildHostRunbook("bitcoind-down");
    expect(rb.runbook[0].text).toContain("systemctl status bitcoind");
    expect(allStrings(rb).join("\n")).toContain("getblockchaininfo");
    expect(rb.command).toBe("systemctl restart bitcoind");
  });

  it("service-not-functioning verifies service status before any restart", () => {
    const rb = buildHostRunbook("service-not-functioning", "LSPD");
    expect(rb.runbook[0].text).toContain("systemctl status");
    expect(rb.command).toContain("systemctl restart");
  });

  it("disk-filling verifies with df -h before reclaiming space", () => {
    const rb = buildHostRunbook("disk-filling");
    expect(rb.runbook[0].text).toContain("df -h");
    expect(rb.command.trim().length).toBeGreaterThan(0);
  });

  it("node-critical verifies node status first and its command is read-only diagnostics", () => {
    const rb = buildHostRunbook("node-critical");
    expect(rb.runbook[0].text).toMatch(/status|getinfo/);
    expect(rb.command).toContain("lncli getinfo");
  });
});

describe("buildHostRunbook — service display label (human label, never a machine key)", () => {
  it("names the passed display label in the copy", () => {
    const rb = buildHostRunbook("service-not-functioning", "LND signer");
    expect(allStrings(rb).join("\n")).toContain("LND signer");
  });

  it("falls back to a readable generic label — never 'undefined'", () => {
    const rb = buildHostRunbook("service-not-functioning");
    const joined = allStrings(rb).join("\n");
    expect(joined).not.toContain("undefined");
    expect(rb.title.length).toBeGreaterThan(0);
  });
});

describe("buildHostRunbook — credential/DB-name hygiene (T-14-10, 12-11 precedent)", () => {
  const FORBIDDEN = ["routing_vm", "password", "postgres://", "PGPASSWORD"];

  it.each(DRIVERS)("%s output contains no credential, connection URL, or DB name", (driver) => {
    const rb = buildHostRunbook(driver, "LSPD");
    const joined = allStrings(rb).join("\n").toLowerCase();
    for (const token of FORBIDDEN) {
      expect(joined).not.toContain(token.toLowerCase());
    }
  });
});
