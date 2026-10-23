import { feeMsatToSat } from "@/lib/format/units";

// =====================================================
// READ-04 — unified per-node model + per-backend boundary (D-09/D-10)
// =====================================================
// One `UnifiedNode` shape the UI renders identically for BOTH fleets. `mapLndNode`
// and `mapLdkNode` are the ONLY place LND vs LDK column differences live (D-10) —
// the rest of the app sees `UnifiedNode` and never branches on backend.
//
// Invariants enforced here:
//  - No backend-specific field leaks as `any`; per-backend input rows are typed
//    (LndNodeRow / LdkNodeRow), and backend-only extras hang off a discriminated
//    union (`UnifiedNodeWithExtras`), never `any` (T-04-01).
//  - Balances stay RAW sats in the model. The mapper performs NO inline sat→BTC
//    or msat→sat math — AFM-002 owns conversion at render (T-04-03). LDK balances arrive in
//    msat and are normalized to sats via the sanctioned `feeMsatToSat` (AFM-002),
//    the only msat→sat path — not ad-hoc math.
//  - `mapLdkNode` references ONLY columns confirmed live in docs/LDK-INTROSPECTION.md
//    (Plan 03). LDK is single-node; fields it cannot provide are explicit 0/null,
//    never undefined-leaked (T-04-04).

export type Backend = "lnd" | "ldk";

/** The single per-node shape the UI consumes — identical across both backends. */
export interface UnifiedNode {
  backend: Backend;
  pubkey: string;
  alias: string | null;
  activeChannels: number;
  inactiveChannels: number;
  pendingChannels: number;
  localBalanceSats: number; // RAW sats — formatter applied only at render (AFM-002)
  remoteBalanceSats: number;
}

// -----------------------------------------------------
// Per-backend input rows (the typed translation surface — no `any`)
// -----------------------------------------------------

/** Subset of `lnd_node_info` (schema/routing.ts) the unified model needs. Balances RAW sats. */
export interface LndNodeRow {
  pubkey: string;
  alias: string | null;
  activeChannels: number | null;
  inactiveChannels: number | null;
  pendingChannels: number | null;
  localChannelBalance: bigint | number | null;
  remoteChannelBalance: bigint | number | null;
}

/**
 * Aggregated LDK node view derived from `lightning_channels` (schema/ldk.ts).
 * LDK is single-node (the LSP itself); the caller sums per-channel counts +
 * msat balances and hands them in. Balances are msat (LDK `*_msat` columns) and
 * are normalized to sats here via the AFM-002 formatter.
 */
export interface LdkNodeRow {
  pubkey: string;
  alias: string | null;
  activeChannels: number | null;
  inactiveChannels: number | null;
  pendingChannels: number | null;
  localBalanceMsat: bigint | number | null;
  remoteBalanceMsat: bigint | number | null;
}

// -----------------------------------------------------
// Backend-specific extras — discriminated union, NEVER `any`
// -----------------------------------------------------
// A UnifiedNode is enough for the status page; deeper per-backend detail (LSPS1
// order context, LND forward stats) hangs off this typed union when later phases
// need it — keeping the per-backend boundary closed without an `any` escape hatch.
export type UnifiedNodeWithExtras =
  | (UnifiedNode & { backend: "lnd"; lnd?: { numPeers?: number } })
  | (UnifiedNode & { backend: "ldk"; ldk?: { lspBalanceSats?: number } });

// -----------------------------------------------------
// Helpers — coerce nullable warehouse values to explicit, defined primitives
// -----------------------------------------------------
const intOrZero = (v: number | null | undefined): number => v ?? 0;
const satsOrZero = (v: bigint | number | null | undefined): number =>
  v == null ? 0 : Number(v);

// -----------------------------------------------------
// mapLndNode — from lnd_node_info (the LND per-backend translation surface)
// -----------------------------------------------------
/**
 * Normalize an `lnd_node_info` row into a UnifiedNode. Channel counts come
 * straight from the snapshot (active_channels is the AFM-001 cross-check target,
 * see latestChannelsForNode). Balances are already sat — kept RAW (no conversion).
 */
export function mapLndNode(row: LndNodeRow): UnifiedNode {
  return {
    backend: "lnd",
    pubkey: row.pubkey,
    alias: row.alias ?? null,
    activeChannels: intOrZero(row.activeChannels),
    inactiveChannels: intOrZero(row.inactiveChannels),
    pendingChannels: intOrZero(row.pendingChannels),
    localBalanceSats: satsOrZero(row.localChannelBalance), // RAW sat — no conversion here
    remoteBalanceSats: satsOrZero(row.remoteChannelBalance),
  };
}

// -----------------------------------------------------
// mapLdkNode — from lightning_channels (the LDK per-backend translation surface)
// -----------------------------------------------------
/**
 * Normalize the aggregated LDK node view into the SAME UnifiedNode shape. LDK
 * balances are msat (`*_msat` columns, docs/LDK-INTROSPECTION.md) → normalized to
 * sats via `feeMsatToSat` (the AFM-002 sanctioned msat→sat path, never inline math).
 * Fields LDK cannot provide are explicit 0/null — never undefined-leaked.
 */
export function mapLdkNode(row: LdkNodeRow): UnifiedNode {
  return {
    backend: "ldk",
    pubkey: row.pubkey,
    alias: row.alias ?? null,
    activeChannels: intOrZero(row.activeChannels),
    inactiveChannels: intOrZero(row.inactiveChannels),
    pendingChannels: intOrZero(row.pendingChannels),
    // msat → sat via AFM-002 formatter (the only sanctioned conversion path).
    localBalanceSats: row.localBalanceMsat == null ? 0 : feeMsatToSat(row.localBalanceMsat),
    remoteBalanceSats: row.remoteBalanceMsat == null ? 0 : feeMsatToSat(row.remoteBalanceMsat),
  };
}
