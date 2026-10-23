import {
  pgTable,
  integer,
  text,
  varchar,
  bigint,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

// =====================================================
// routing_vm (LND) — read-only warehouse schema
// =====================================================
// Hand-curated from a one-time read-only `drizzle-kit pull` of the LIVE
// routing_vm warehouse + confirmed against information_schema.columns (D-09).
// Externally managed + event-driven — NEVER push/migrate against this DB (D-02).
// No rows copied; pull migration/meta artifacts are NOT committed.
//
// Per-table identity columns + AFM-001 snapshot/event-driven semantics are
// annotated inline (RESEARCH §D, Pitfall 6). Phase 1 typed the golden-invariant
// pair (lnd_node_channel_info + lnd_node_info); Phase 2 adds the five scorecard
// tables (forwards, closed_channels, restart, peer_info, rebalance_invoices),
// live-verified against information_schema 2026-06-09. Remaining event tables
// are typed as their consuming phase lands. All sat/msat fields render through
// @/lib/format/units (AFM-002).

// -----------------------------------------------------
// lnd_node_channel_info
// AFM-001: EVENT-DRIVEN. Latest channel state ONLY via
//   SELECT DISTINCT ON (chan_id) ... ORDER BY chan_id, timestamp DESC
//   NEVER MAX(timestamp) (the documented 480-channels-as-1 failure).
// Identity column (per-node partition): local_pubkey
// Latest-state key: chan_id   |   Time column: timestamp
// -----------------------------------------------------
export const lndNodeChannelInfo = pgTable("lnd_node_channel_info", {
  id: integer("id").primaryKey(),
  active: boolean("active"),
  localPubkey: text("local_pubkey"), // AFM-001 identity (per-node partition)
  remotePubkey: text("remote_pubkey"),
  channelPoint: text("channel_point"),
  chanId: varchar("chan_id"), // AFM-001 DISTINCT ON key
  capacity: bigint("capacity", { mode: "bigint" }),
  localBalance: bigint("local_balance", { mode: "bigint" }),
  remoteBalance: bigint("remote_balance", { mode: "bigint" }),
  commitFee: bigint("commit_fee", { mode: "bigint" }),
  commitWeight: bigint("commit_weight", { mode: "bigint" }),
  feePerKw: bigint("fee_per_kw", { mode: "bigint" }),
  totalSatoshisSent: bigint("total_satoshis_sent", { mode: "bigint" }),
  totalSatoshisReceived: bigint("total_satoshis_received", { mode: "bigint" }),
  initiator: boolean("initiator"),
  lifetime: bigint("lifetime", { mode: "bigint" }),
  uptime: bigint("uptime", { mode: "bigint" }),
  outgoingFeeBaseMsat: bigint("outgoing_fee_base_msat", { mode: "bigint" }),
  outgoingFeeRateMilliMsat: bigint("outgoing_fee_rate_milli_msat", { mode: "bigint" }),
  incomingFeeBaseMsat: bigint("incoming_fee_base_msat", { mode: "bigint" }),
  incomingFeeRateMilliMsat: bigint("incoming_fee_rate_milli_msat", { mode: "bigint" }),
  timestamp: timestamp("timestamp"), // AFM-001 ORDER BY ... DESC key
  closed: boolean("closed"),
  updatedAt: timestamp("updated_at"),
});

// -----------------------------------------------------
// lnd_node_info
// AFM-001: APPEND-ONLY (verified 8.05M rows / 26 nodes; Canada 371,545 rows).
//   Latest-per-node ONLY via
//     SELECT DISTINCT ON (pubkey) ... ORDER BY pubkey, timestamp DESC
//   — see src/lib/read/node-info.ts. NEVER a bare select (RESEARCH Pitfall 1:
//   a direct WHERE pubkey=$x returns hundreds of thousands of rows).
//   Cross-validates the channel DISTINCT ON count (active_channels is the
//   canonical AFM-001 sanity check).
// Identity column: pubkey   |   Time column: timestamp
// -----------------------------------------------------
export const lndNodeInfo = pgTable("lnd_node_info", {
  id: integer("id").primaryKey(),
  pubkey: text("pubkey"), // identity (snapshot key)
  alias: text("alias"),
  activeChannels: integer("active_channels"), // golden-invariant cross-check target
  pendingChannels: integer("pending_channels"),
  inactiveChannels: integer("inactive_channels"),
  numPeers: integer("num_peers"),
  blockHeight: integer("block_height"),
  syncedToChain: boolean("synced_to_chain"),
  syncedToGraph: boolean("synced_to_graph"),
  uris: text("uris"),
  localChannelBalance: bigint("local_channel_balance", { mode: "bigint" }),
  remoteChannelBalance: bigint("remote_channel_balance", { mode: "bigint" }),
  totalWalletBalance: bigint("total_wallet_balance", { mode: "bigint" }),
  confirmedWalletBalance: bigint("confirmed_wallet_balance", { mode: "bigint" }),
  unconfirmedWalletBalance: bigint("unconfirmed_wallet_balance", { mode: "bigint" }),
  timestamp: timestamp("timestamp"),
  version: text("version"),
  unsettledLocalBalanceMsat: bigint("unsettled_local_balance_msat", { mode: "bigint" }),
  unsettledRemoteBalanceMsat: bigint("unsettled_remote_balance_msat", { mode: "bigint" }),
  pendingOpenLocalBalanceMsat: bigint("pending_open_local_balance_msat", { mode: "bigint" }),
  pendingOpenRemoteBalanceMsat: bigint("pending_open_remote_balance_msat", { mode: "bigint" }),
  totalLimboBalance: bigint("total_limbo_balance", { mode: "bigint" }),
});

// -----------------------------------------------------
// lnd_node_forwards
// EVENT log: one row per forward. Identity column (per-node partition): lnd_pubkey
// Time column: timestamp_ns — NANOSECONDS since epoch (BIGINT). Window math
// needs *1e9 (RESEARCH Pitfall 3): a window built in seconds/ms silently
// selects nothing or everything.
// Verified live against information_schema 2026-06-09.
// -----------------------------------------------------
export const lndNodeForwards = pgTable("lnd_node_forwards", {
  id: integer("id").primaryKey(),
  chanIdIn: varchar("chan_id_in"),
  chanIdOut: varchar("chan_id_out"),
  amtIn: bigint("amt_in", { mode: "bigint" }),
  amtOut: bigint("amt_out", { mode: "bigint" }),
  // FORBIDDEN — AFM-002: use fee_msat/1000.0, NEVER raw fee (1000x-off failure).
  fee: bigint("fee", { mode: "bigint" }),
  feeMsat: bigint("fee_msat", { mode: "bigint" }), // AFM-002 sanctioned: fee_msat/1000.0 = sats
  amtInMsat: bigint("amt_in_msat", { mode: "bigint" }),
  amtOutMsat: bigint("amt_out_msat", { mode: "bigint" }),
  // NANOSECONDS since epoch — window math needs *1e9 (RESEARCH Pitfall 3)
  timestampNs: bigint("timestamp_ns", { mode: "bigint" }),
  lndPubkey: varchar("lnd_pubkey"), // identity (per-node partition)
  peerAliasIn: text("peer_alias_in"),
  peerAliasOut: text("peer_alias_out"),
});

// -----------------------------------------------------
// lnd_node_closed_channels
// ONE ROW PER CLOSE (NOT event-duplicated — verified 3,238 rows / 3,177
// distinct chan_id for Canada; aggregate by row, no DISTINCT ON needed).
// Identity column (per-node partition): local_pubkey
// Verified enum values (live, 2026-06-09):
//   close_type      ∈ COOPERATIVE_CLOSE, LOCAL_FORCE_CLOSE, REMOTE_FORCE_CLOSE,
//                     ABANDONED, BREACH_CLOSE, FUNDING_CANCELED
//   close_initiator ∈ INITIATOR_LOCAL, INITIATOR_REMOTE, INITIATOR_BOTH
// -----------------------------------------------------
export const lndNodeClosedChannels = pgTable("lnd_node_closed_channels", {
  id: integer("id").primaryKey(),
  channelPoint: text("channel_point"),
  chanId: bigint("chan_id", { mode: "bigint" }), // BIGINT here (varchar in channel_info)
  chainHash: text("chain_hash"),
  closingTxHash: text("closing_tx_hash"),
  remotePubkey: text("remote_pubkey"),
  capacity: bigint("capacity", { mode: "bigint" }),
  closeHeight: bigint("close_height", { mode: "bigint" }),
  settledBalance: bigint("settled_balance", { mode: "bigint" }),
  timeLockedBalance: bigint("time_locked_balance", { mode: "bigint" }),
  closeType: text("close_type"), // see verified enum above
  openInitiator: text("open_initiator"),
  closeInitiator: text("close_initiator"), // see verified enum above
  localPubkey: text("local_pubkey"), // identity (per-node partition)
  lndAlias: text("lnd_alias"),
  timestamp: timestamp("timestamp"),
});

// -----------------------------------------------------
// lnd_restart
// LATEST restart only — no history; restart-loop detection NOT possible from
// this table (RESEARCH Open Question 2). Columns are exactly these four
// (no id, verified live 2026-06-09).
// Identity column: pubkey   |   Time column: last_restart
// -----------------------------------------------------
export const lndRestart = pgTable("lnd_restart", {
  alias: text("alias"),
  pubkey: text("pubkey"), // identity
  restarted: boolean("restarted"),
  lastRestart: timestamp("last_restart"),
});

// -----------------------------------------------------
// lnd_node_peer_info
// CUMULATIVE LIFETIME peer log (one row per peer EVER connected; flapcount is
// lifetime, not recent — verified Canada: 22,868 rows = 22,868 distinct peers
// ever seen). Current peer count = lnd_node_info.num_peers via latestNodeInfo —
// NEVER COUNT(*) of this table (RESEARCH Pitfall 2).
// Identity column (per-node partition): local_pubkey
// -----------------------------------------------------
export const lndNodePeerInfo = pgTable("lnd_node_peer_info", {
  id: integer("id").primaryKey(),
  peerPubkey: text("peer_pubkey"),
  address: text("address"),
  alias: text("alias"),
  flapcount: bigint("flapcount", { mode: "bigint" }), // LIFETIME cumulative, not recent
  totalCapacity: bigint("total_capacity", { mode: "bigint" }),
  numChannels: bigint("num_channels", { mode: "bigint" }),
  localPubkey: text("local_pubkey"), // identity (per-node partition)
  connectedTo: text("connected_to"),
  timestamp: timestamp("timestamp"),
});

// -----------------------------------------------------
// internal_rebalance_invoices
// One row per rebalance invoice. Success-rate read (verified live):
//   COUNT(*) FILTER (WHERE paid_status) / NULLIF(COUNT(*),0) over a window
//   — Canada 7d: 37 paid / 143 total ≈ 26%.
// Identity column (per-node partition): requesting_node_pubkey
// Time column: timestamp
// -----------------------------------------------------
export const internalRebalanceInvoices = pgTable("internal_rebalance_invoices", {
  internalInvoiceId: integer("internal_invoice_id").primaryKey(),
  paymentRequest: text("payment_request"),
  requestingNodePubkey: varchar("requesting_node_pubkey"), // identity (per-node partition)
  requestingNodeAlias: text("requesting_node_alias"),
  outgoingChannelId: varchar("outgoing_channel_id"),
  remotePubkey: varchar("remote_pubkey"),
  remoteAlias: text("remote_alias"),
  amount: bigint("amount", { mode: "bigint" }),
  paidStatus: boolean("paid_status"), // success-rate numerator filter
  timestamp: timestamp("timestamp"),
});

// -----------------------------------------------------
// lnd_node_pending_channels
// EVENT-DRIVEN, upsert-per-tick: the collector updates a channel's row every
// tick WHILE it is pending; when it resolves, the row simply stops updating —
// it is NEVER deleted. The table is therefore mostly RESOLVED RESIDUE
// (live-verified 2026-06-10: 1,790 rows, only ~63 currently pending).
// Currently-pending reads MUST apply the recency filter in
// src/lib/read/pending.ts (updated_at > now() - PENDING_RECENCY_HOURS) —
// a bare select misrepresents months-old residue as live state.
// Identity column (per-node partition): local_pubkey
// Latest-state key: channel_point — DISTINCT ON (channel_point) required
//   (142 duplicate channel_points from channels re-entering pending) with the
//   channel_point IS NOT NULL guard (WR-01: DISTINCT ON collapses NULL keys).
// Verified channel_state enum (complete, live 2026-06-10):
//   PENDING_OPEN | WAITING_CLOSE | FORCE_CLOSE
// Sweep join: closing_txid = lnd_node_pending_sweeps.outpoint_txid
//   (26/38 current sweeps join to a current force-close; ORPHANS EXIST —
//   anchor outputs / sweeps whose close already left pending — never drop them).
// Time columns are timestamptz ({ withTimezone: true }) — these pending tables
// are the ONLY timestamptz tables in routing_vm (ldk.ts lsps1_orders precedent).
// created_at = age anchor (first observed); updated_at = recency filter key.
// -----------------------------------------------------
export const lndNodePendingChannels = pgTable("lnd_node_pending_channels", {
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  localPubkey: text("local_pubkey"), // identity (per-node partition)
  lndAlias: text("lnd_alias"),
  channelPoint: text("channel_point"), // DISTINCT ON key when read
  remoteNodePub: text("remote_node_pub"),
  capacity: bigint("capacity", { mode: "bigint" }),
  localBalance: bigint("local_balance", { mode: "bigint" }),
  remoteBalance: bigint("remote_balance", { mode: "bigint" }),
  localChanReserveSat: bigint("local_chan_reserve_sat", { mode: "bigint" }),
  remoteChanReserveSat: bigint("remote_chan_reserve_sat", { mode: "bigint" }),
  initiator: text("initiator"),
  commitmentType: text("commitment_type"),
  numForwardingPackages: integer("num_forwarding_packages"),
  chanStatusFlags: text("chan_status_flags"),
  channelState: text("channel_state"), // PENDING_OPEN | WAITING_CLOSE | FORCE_CLOSE
  closing: boolean("closing"),
  limboBalance: bigint("limbo_balance", { mode: "bigint" }),
  closingTxid: text("closing_txid"), // joins pending_sweeps.outpoint_txid
  maturityHeight: integer("maturity_height"),
  blocksTilMaturity: integer("blocks_til_maturity"),
  recoveredBalance: bigint("recovered_balance", { mode: "bigint" }),
  anchorState: text("anchor_state"),
  createdAt: timestamp("created_at", { withTimezone: true }), // age anchor
  updatedAt: timestamp("updated_at", { withTimezone: true }), // recency filter key
});

// -----------------------------------------------------
// lnd_node_pending_sweeps
// EVENT-DRIVEN, upsert-per-outpoint-per-tick: same residue semantics as
// lnd_node_pending_channels — rows persist after the sweep resolves
// (live-verified 2026-06-10: 2,019 rows, only ~38 currently pending).
// Currently-pending reads MUST use the recency filter in src/lib/read/pending.ts.
// Identity column (per-node partition): lnd_pubkey — NOT local_pubkey
//   (live information_schema introspection 2026-06-10 corrected the old stub;
//   same identity split as forwards vs closed_channels).
// NO DISTINCT ON needed: 2,019 rows = 2,019 distinct outpoints (verified
//   upsert-per-outpoint).
// Force-close join: outpoint_txid = lnd_node_pending_channels.closing_txid
//   (orphans exist — render them, never drop them; every sat accounted for).
// created_at / updated_at are timestamptz ({ withTimezone: true }).
// -----------------------------------------------------
export const lndNodePendingSweeps = pgTable("lnd_node_pending_sweeps", {
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  lndAlias: text("lnd_alias"),
  lndPubkey: text("lnd_pubkey"), // identity (per-node partition) — NOT local_pubkey
  outpointTxid: text("outpoint_txid"), // joins pending_channels.closing_txid
  outpointOutputIndex: integer("outpoint_output_index"),
  witnessType: integer("witness_type"),
  amountSat: integer("amount_sat"),
  satPerByte: integer("sat_per_byte"),
  requestedSatPerByte: integer("requested_sat_per_byte"),
  satPerVbyte: bigint("sat_per_vbyte", { mode: "bigint" }),
  requestedSatPerVbyte: bigint("requested_sat_per_vbyte", { mode: "bigint" }),
  broadcastAttempts: integer("broadcast_attempts"), // PENDING-01 field
  nextBroadcastHeight: integer("next_broadcast_height"),
  requestedConfTarget: integer("requested_conf_target"),
  force: boolean("force"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});
