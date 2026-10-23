import "server-only";

import type { Backend } from "@/lib/read/nodes";

// =====================================================
// D-03 — operator backend map (pubkey → lnd | ldk)
// =====================================================
// Config-driven, NEVER warehouse-derived: LDK rows arrive in `routing_vm` in the
// `lnd_*` table shape, so the warehouse cannot tell you the backend. The operator
// maintains this map; the optional NODE_BACKENDS env (JSON Record<pubkey, Backend>)
// overrides it for the local→VM flip without a code change (D-03/D-04).
//
// server-only (T-02-02): this module reads process.env and must never reach a
// client bundle. The pure scorecard math modules carry no env and stay importable
// anywhere server-side.

/**
 * Default fleet map (operator-maintained). Seeding query against `routing_vm`
 * was not run at implementation time (production read not authorized for this
 * mock-first build) — known LDK alias to add when confirmed: `LQwD-Lspd-ldk`
 * (the LDK/LSPD node). `LQWD-Breez`/`LQWD-Breez-2` stay "lnd" by default
 * (RESEARCH Open Question 1 — flip via NODE_BACKENDS if the operator confirms).
 */
const DEFAULT_BACKENDS: Record<string, Backend> = {
  // "<pubkey>": "ldk",   // e.g. LQwD-Lspd-ldk — all others default to "lnd"
};

/**
 * Parse NODE_BACKENDS once at module scope — fail-loud (T-02-06): malformed
 * config must throw a descriptive error at boot, never silently fall back to a
 * wrong backend map (a wrong map mis-routes commands/recovery in later phases).
 */
function parseEnvOverrides(): Record<string, Backend> {
  const rawEnv = process.env.NODE_BACKENDS;
  if (!rawEnv) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawEnv);
  } catch (error) {
    throw new Error(
      "NODE_BACKENDS is not valid JSON (expected {\"<pubkey>\": \"lnd\"|\"ldk\", ...}): " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error('NODE_BACKENDS must be a JSON object mapping pubkey → "lnd" | "ldk"');
  }
  const overrides: Record<string, Backend> = {};
  for (const [pubkey, backend] of Object.entries(parsed)) {
    if (backend !== "lnd" && backend !== "ldk") {
      throw new Error(
        `NODE_BACKENDS["${pubkey}"] must be "lnd" or "ldk", got: ${JSON.stringify(backend)}`,
      );
    }
    overrides[pubkey] = backend;
  }
  return overrides;
}

const ENV_OVERRIDES: Record<string, Backend> = parseEnvOverrides();

/** Resolve a node's backend: env override → operator default map → "lnd" (D-03). */
export function backendFor(pubkey: string): Backend {
  return ENV_OVERRIDES[pubkey] ?? DEFAULT_BACKENDS[pubkey] ?? "lnd";
}
