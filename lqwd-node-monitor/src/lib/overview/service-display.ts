// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// service-display.ts — presentation-only service RELABEL map (LOCKED backlog #9)
// =====================================================
// Services are observed and modeled by raw machine key (`addressBalances`,
// `aiLiquidityManager`, `channelAcceptor`, `internalRebalancer`, `nodeAuditor`,
// `esplora`, `bitcoind`, …). Operators should not have to read machine keys, so
// this map turns each raw key into an operator-facing { label, description }.
//
// RELABEL ONLY. This module:
//   • changes NO data model — it reads nothing off the two-axis health state,
//   • changes NO health logic — the interval-based staleness clock remains the
//     SOLE source of a service's severity (T-12-10-01). A label can never re-grade
//     or recolor a service; it only renames the row at render.
//
// `addressBalances` is a background cron that rebuilds the node's used-address
// index on its scheduled interval (6h; success = "Successfully completed database
// update"). It is correctly modeled — only its DISPLAY name was wrong. Operator
// seed: "Address List Sync".

/** One operator-facing display entry for a raw service key. Presentation only. */
export interface ServiceDisplayEntry {
  /** Operator-facing name shown in place of the raw machine key. */
  label: string;
  /** One-line plain-language description of what the service does. May be empty. */
  description: string;
}

/**
 * Seed map: raw service_name → { label, description }. `addressBalances` is
 * operator-verbatim; the other observed keys carry sensible labels the operator
 * may refine later. Adding/removing an entry NEVER changes health — it only
 * changes the rendered name (relabel, not remove).
 */
export const SERVICE_DISPLAY: Record<string, ServiceDisplayEntry> = {
  addressBalances: {
    label: "Address List Sync",
    description:
      "Background cron that rebuilds the node's used-address index on its expected interval.",
  },
  aiLiquidityManager: {
    label: "AI Liquidity Manager",
    description: "Advisory liquidity-balancing planner (recommends, never executes).",
  },
  channelAcceptor: {
    label: "Channel Acceptor",
    description: "Policy gate that vets inbound channel-open requests against fleet rules.",
  },
  internalRebalancer: {
    label: "Internal Rebalancer",
    description: "Scheduled circular rebalance job that evens out channel liquidity.",
  },
  nodeAuditor: {
    label: "Node Auditor",
    description: "Periodic node self-audit that checks config, peers and channel health.",
  },
  esplora: {
    label: "Esplora",
    description: "Block explorer / chain-index backend the node queries for on-chain data.",
  },
  bitcoind: {
    label: "Bitcoind",
    description: "Bitcoin Core backend providing the node's chain state and mempool.",
  },
};

/**
 * Domain acronyms that must render fully uppercase rather than Title-Cased.
 * Keyed by the lowercased token so matching is case-insensitive. Operators read
 * "LND", never "Lnd" (backlog: raw service key `lnd` was rendering "Lnd").
 */
const ACRONYMS = new Set([
  "lnd",
  "ai",
  "htlc",
  "lsp",
  "lspd",
  "vm",
  "rpc",
  "db",
  "cpu",
  "io",
  "ppm",
  "id",
  "url",
  "api",
  "ldk",
]);

/** Title-Case one token, but uppercase known domain acronyms whole (`lnd`→"LND"). */
function caseToken(word: string): string {
  if (ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Humanize a raw camelCase (or lowercase) key into Title Case words, e.g.
 * `someNewService` → "Some New Service", `watchtower` → "Watchtower". Splits on
 * camelCase boundaries and digit runs, treats non-alphanumeric characters as word
 * separators, and Title-Cases each token — EXCEPT known domain acronyms, which are
 * uppercased whole (`lnd` → "LND", `aiManager` → "AI Manager"). Returns "" for
 * empty/blank input so the caller degrades gracefully. Never throws.
 */
function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // ACRONYMWord boundary
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2") // letter→digit boundary
    .replace(/[^a-zA-Z0-9]+/g, " ") // non-alphanumerics → space
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map(caseToken)
    .join(" ");
}

/**
 * Resolve a raw service key to its operator-facing display entry. Known keys
 * return their seeded { label, description }; unknown keys degrade to a humanized
 * label with an empty (neutral) description — never a fabricated claim. Pure and
 * total: same input → same output, and it NEVER throws (empty/blank/non-camel
 * input yields an empty label instead of an error).
 */
export function serviceDisplay(name: string): ServiceDisplayEntry {
  const seeded = SERVICE_DISPLAY[name];
  if (seeded) return seeded;
  return { label: humanize(name ?? ""), description: "" };
}
