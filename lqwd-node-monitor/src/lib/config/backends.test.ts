import { afterEach, describe, expect, it, vi } from "vitest";

// D-03 backend map resolution: NODE_BACKENDS env override → DEFAULT_BACKENDS → "lnd".
// NODE_BACKENDS is parsed once at module scope, so each case stubs the env and
// re-imports the module fresh (vi.resetModules + dynamic import). `server-only`
// is aliased to a no-op stub by vitest.config.ts.

const PUBKEY_A = "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PUBKEY_B = "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

async function importBackends() {
  vi.resetModules();
  return import("@/lib/config/backends");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("backendFor (D-03 operator backend map)", () => {
  it("defaults an unmapped pubkey to 'lnd'", async () => {
    vi.stubEnv("NODE_BACKENDS", "");
    const { backendFor } = await importBackends();
    expect(backendFor(PUBKEY_A)).toBe("lnd");
  });

  it("maps a pubkey to 'ldk' via the NODE_BACKENDS env override", async () => {
    vi.stubEnv("NODE_BACKENDS", JSON.stringify({ [PUBKEY_A]: "ldk" }));
    const { backendFor } = await importBackends();
    expect(backendFor(PUBKEY_A)).toBe("ldk");
    // other pubkeys still fall through to the default layer
    expect(backendFor(PUBKEY_B)).toBe("lnd");
  });

  it("env override beats the DEFAULT_BACKENDS layer", async () => {
    // DEFAULT_BACKENDS is currently empty, so the default-layer answer for any
    // pubkey is "lnd". The env layer resolving "ldk" for the same pubkey proves
    // the override is consulted FIRST (env → DEFAULT_BACKENDS → "lnd").
    vi.stubEnv("NODE_BACKENDS", JSON.stringify({ [PUBKEY_B]: "ldk" }));
    const { backendFor } = await importBackends();
    expect(backendFor(PUBKEY_B)).toBe("ldk");
  });

  it("throws a descriptive error on malformed NODE_BACKENDS JSON (fail-loud, T-02-06)", async () => {
    vi.stubEnv("NODE_BACKENDS", "{not json");
    await expect(importBackends()).rejects.toThrow(/NODE_BACKENDS is not valid JSON/);
  });

  it("throws when NODE_BACKENDS maps a pubkey to a value that is not 'lnd' or 'ldk'", async () => {
    vi.stubEnv("NODE_BACKENDS", JSON.stringify({ [PUBKEY_A]: "cln" }));
    await expect(importBackends()).rejects.toThrow(/must be "lnd" or "ldk"/);
  });
});
