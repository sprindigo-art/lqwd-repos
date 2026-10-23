import { describe, it, expect, afterEach } from "vitest";
import { requireEnv, assertBootEnv, REQUIRED_BOOT_ENV_VARS } from "@/lib/db/env";
import { classifyReadOnlyProbe } from "@/lib/db/read-only-probe";

// =====================================================
// health.test.ts — env-missing path (no network) + guarded live checks
// =====================================================
// The live-DB assertions need the warehouse (IP-whitelisted, not reachable from
// CI/this host), so they are guarded behind skipIf on ROUTING_VM_DATABASE_URL and
// skip cleanly without network. The env-missing path is asserted with no network.
//
// NOTE: we exercise the env-missing path via requireEnv() — the exact thrower
// runStartupHealthCheck() calls FIRST for each required var. Importing health.ts
// (and thus the client singletons) eagerly calls requireEnv at module load, so a
// direct requireEnv assertion is the network-free way to prove the fail-loud
// contract: runStartupHealthCheck throws with the missing var name.

describe("requireEnv fail-loud env contract (no network)", () => {
  it("throws naming the missing var when absent", () => {
    const name = "DEFINITELY_MISSING_ENV_VAR_FOR_TEST";
    delete process.env[name];
    expect(() => requireEnv(name)).toThrowError(`Missing required env: ${name}`);
  });

  it("returns the value when present", () => {
    const name = "PRESENT_ENV_VAR_FOR_TEST";
    process.env[name] = "value";
    expect(requireEnv(name)).toBe("value");
    delete process.env[name];
  });
});

// =====================================================
// assertBootEnv — HARDEN-02 env-only-boot gate (no network)
// =====================================================
// This is the FIRST thing runStartupHealthCheck() runs — the fail-loud env
// contract for the local→VM flip. A missing required var must halt the boot LOUD,
// naming the specific var, instead of a silent localhost default (T-18-29/30).
// Asserted DB-less: assertBootEnv only reads process.env (no singletons, no
// network), so the misconfig path is provable without warehouse access.
describe("assertBootEnv — env-only-boot gate names the missing var (no network)", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    // Restore every touched var so suites stay isolated.
    for (const name of Object.keys(saved)) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
      delete saved[name];
    }
  });

  function stub(name: string, value: string | undefined): void {
    if (!(name in saved)) saved[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it("passes when every required boot var is present", () => {
    for (const name of REQUIRED_BOOT_ENV_VARS) stub(name, "postgres://x@host:5432/db");
    expect(() => assertBootEnv()).not.toThrow();
  });

  it("throws naming the SPECIFIC missing var (misconfigured VM boot halts loud)", () => {
    // Populate all, then drop each one in turn — the thrown error must name it.
    for (const missing of REQUIRED_BOOT_ENV_VARS) {
      for (const name of REQUIRED_BOOT_ENV_VARS) stub(name, "postgres://x@host:5432/db");
      stub(missing, undefined);
      expect(() => assertBootEnv()).toThrowError(`Missing required env: ${missing}`);
    }
  });

  it("hard-requires the three DB URLs (the local→VM flip contract)", () => {
    expect([...REQUIRED_BOOT_ENV_VARS]).toEqual([
      "ROUTING_VM_DATABASE_URL",
      "LDK_LSPD_DATABASE_URL",
      "NODEMON_QUEUE_URL",
    ]);
  });
});

// =====================================================
// classifyReadOnlyProbe — role-level read-only verdict (no network)
// =====================================================
// The boot read-only probe attempts a write the ROLE should be denied on a REAL
// warehouse table (the session `default_transaction_read_only` flag is stripped
// first, so the outcome reflects the role's GRANTS, not the client's session).
// Only a genuine role-level insufficient-privilege (42501) confirms read-only.
// A read-only-transaction (25006) is the session flag masking the role grant —
// inconclusive, NEVER a pass (a role holding INSERT with the session flag on must
// not slip through — the cross-engine health.ts:56 conflict, T-18-13).
describe("classifyReadOnlyProbe — role grants, not the session flag (no network)", () => {
  it("42501 (role insufficient_privilege) on a real table ⇒ read-only-confirmed (PASS)", () => {
    expect(classifyReadOnlyProbe("42501")).toBe("read-only-confirmed");
  });

  it("25006 (session read-only flag) is NOT sufficient to pass ⇒ inconclusive", () => {
    expect(classifyReadOnlyProbe("25006")).toBe("inconclusive");
    expect(classifyReadOnlyProbe("25006")).not.toBe("read-only-confirmed");
  });

  it("an accepted write (no error code) ⇒ writable (fail loud on a genuinely writable role)", () => {
    expect(classifyReadOnlyProbe(undefined)).toBe("writable");
  });

  it("a post-privilege-gate constraint error (23502) still proves the role can write ⇒ writable", () => {
    expect(classifyReadOnlyProbe("23502")).toBe("writable");
  });
});

// Live-DB assertions: skip cleanly without warehouse access.
describe.skipIf(!process.env.ROUTING_VM_DATABASE_URL)(
  "runStartupHealthCheck (live DBs)",
  () => {
    it("passes against real warehouses + local nodemon", async () => {
      const { runStartupHealthCheck } = await import("@/lib/db/health");
      await expect(runStartupHealthCheck()).resolves.toBeUndefined();
    });
  },
);
