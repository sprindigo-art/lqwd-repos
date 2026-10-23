import "server-only";

// =====================================================
// Fail-loud env contract (RESEARCH §I)
// =====================================================
// Every DB module reads its URL from env at boot and throws (with the missing
// var name) if absent — NO dev-DB default, NO host literal in source.
// The local `nodemon` URL (host included) lives ONLY in git-ignored `.env.local`.

/** Reads `process.env[name]`; throws if missing/empty. No dev-DB fallback. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error("Missing required env: " + name);
  }
  return value;
}

/**
 * HARDEN-02: the vars the app hard-requires to boot — the local→VM flip is
 * config-only, so pointing THESE at VM endpoints is the ONLY change needed. This
 * is the SINGLE SOURCE OF TRUTH for the boot-required contract: the DB clients
 * resolve their URL through `requireEnv`, the boot health check asserts the same
 * names up front (fail loud, by name), and `.env.example` documents them. Adding
 * a boot-critical connection var means adding it HERE — nowhere else duplicates
 * the list.
 */
export const REQUIRED_BOOT_ENV_VARS = [
  "ROUTING_VM_DATABASE_URL", // routing_vm warehouse (read-only)
  "LDK_LSPD_DATABASE_URL", // ldk-lspd-main warehouse (read-only)
  "NODEMON_QUEUE_URL", // local nodemon queue DB (read-write)
] as const;

/**
 * Assert every boot-required var is present, failing LOUD on the FIRST missing
 * one (throws with its name). No localhost default: a misconfigured VM boot halts
 * here instead of silently connecting to the wrong host (T-18-29 / T-18-30).
 */
export function assertBootEnv(): void {
  for (const name of REQUIRED_BOOT_ENV_VARS) {
    requireEnv(name);
  }
}

/**
 * D-03 pooler flag. Prepared statements stay ON unless a transaction-mode
 * PgBouncer fronts the warehouse (`WAREHOUSE_PG_TXN_POOLER=true` → prepare:false).
 */
export function warehousePrepareFlag(): boolean {
  return process.env.WAREHOUSE_PG_TXN_POOLER !== "true";
}
