import {
  pgTable,
  integer,
  varchar,
  bigint,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// =====================================================
// ldk-lspd-main (LDK) — read-only warehouse schema
// =====================================================
// Hand-curated from LIVE information_schema.columns introspection (D-09) — NOT
// from memory. The research carried these tables as [ASSUMED]; every column
// below is verbatim from the confirmed introspection recorded in
// docs/LDK-INTROSPECTION.md (captured 2026-06-09). No [ASSUMED] columns persist.
// Externally managed — NEVER push/migrate against this DB (D-02). No rows copied.
//
// LDK is single-node (the LSP itself): per-node identity is `peer_pubkey` (the
// channel counterparty), NOT an LND-style `local_pubkey` partition. AFM-001's
// event-driven DISTINCT ON failure mode does NOT apply: lightning_channels is a
// current-state table (one row per live channel keyed by channel_id), not an
// append-only event log. All *_msat / *_sat / *_satoshis values render through
// @/lib/format/units (AFM-002). See docs/LDK-INTROSPECTION.md for the full surface.

// -----------------------------------------------------
// lightning_channels — current per-channel state (identity: peer_pubkey; key: channel_id)
// -----------------------------------------------------
export const lightningChannels = pgTable("lightning_channels", {
  id: integer("id").primaryKey(),
  channelId: varchar("channel_id"),
  shortChannelId: bigint("short_channel_id", { mode: "bigint" }),
  fundingTxid: varchar("funding_txid"),
  peerPubkey: varchar("peer_pubkey"), // LDK per-channel counterparty identity
  isChannelReady: boolean("is_channel_ready"),
  isChannelUsable: boolean("is_channel_usable"),
  channelValueSatoshis: bigint("channel_value_satoshis", { mode: "bigint" }),
  outboundCapacityMsat: bigint("outbound_capacity_msat", { mode: "bigint" }),
  inboundCapacityMsat: bigint("inbound_capacity_msat", { mode: "bigint" }),
  feerateSatPer1000Weight: integer("feerate_sat_per_1000_weight"),
  availableBalanceForSendMsat: bigint("available_balance_for_send_msat", { mode: "bigint" }),
  availableBalanceForRecvMsat: bigint("available_balance_for_recv_msat", { mode: "bigint" }),
  channelCanSendPayments: boolean("channel_can_send_payments"),
  public: boolean("public"),
  inboundHtlcMinimumMsat: bigint("inbound_htlc_minimum_msat", { mode: "bigint" }),
  inboundHtlcMaximumMsat: bigint("inbound_htlc_maximum_msat", { mode: "bigint" }),
  nextOutboundHtlcMinimumMsat: bigint("next_outbound_htlc_minimum_msat", { mode: "bigint" }),
  nextOutboundHtlcLimitMsat: bigint("next_outbound_htlc_limit_msat", { mode: "bigint" }),
  status: varchar("status"),
  createTime: timestamp("create_time"),
  updateTime: timestamp("update_time"),
  balanceMsat: bigint("balance_msat", { mode: "bigint" }),
});

// -----------------------------------------------------
// lsps1_orders — LSPS1 channel-purchase orders
// -----------------------------------------------------
export const lsps1Orders = pgTable("lsps1_orders", {
  id: integer("id").primaryKey(),
  requestId: integer("request_id"),
  orderId: varchar("order_id"),
  apiVersion: integer("api_version"),
  lspBalanceSat: bigint("lsp_balance_sat", { mode: "bigint" }),
  clientBalanceSat: bigint("client_balance_sat", { mode: "bigint" }),
  requiredChannelConfirmations: integer("required_channel_confirmations"),
  fundingConfirmsWithinBlocks: integer("funding_confirms_within_blocks"),
  channelExpiryBlocks: integer("channel_expiry_blocks"),
  token: varchar("token"),
  createdAt: timestamp("created_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  announceChannel: boolean("announce_channel"),
  orderState: varchar("order_state"),
  payment: jsonb("payment"),
  paymentExpiryBlock: integer("payment_expiry_block"),
  paymentHash: varchar("payment_hash"),
  paymentPreimage: varchar("payment_preimage"),
  paymentPreimageReceivedAt: timestamp("payment_preimage_received_at", { withTimezone: true }),
  paymentPreimageClaimedAt: timestamp("payment_preimage_claimed_at", { withTimezone: true }),
  paymentPreimageClaimed: boolean("payment_preimage_claimed"),
  numOfRetries: integer("num_of_retries"),
  lastRetryAt: timestamp("last_retry_at", { withTimezone: true }),
  channel: jsonb("channel"),
  channelId: varchar("channel_id"),
  temporaryChannelId: varchar("temporary_channel_id"),
  recordCreatedAt: timestamp("record_created_at", { withTimezone: true }),
  recordUpdatedAt: timestamp("record_updated_at", { withTimezone: true }),
  status: varchar("status"),
  errorMsg: varchar("error_msg"),
});

// -----------------------------------------------------
// payments — LDK payment log (amount_msat → AFM-002 formatter)
// -----------------------------------------------------
export const payments = pgTable("payments", {
  id: integer("id").primaryKey(),
  hash: varchar("hash"),
  preimage: varchar("preimage"),
  secret: varchar("secret"),
  amountMsat: bigint("amount_msat", { mode: "bigint" }),
  direction: varchar("direction"),
  status: varchar("status"),
  lspFeeLimits: jsonb("lsp_fee_limits"),
  createTime: timestamp("create_time"),
  timestampAsString: varchar("timestamp_as_string"),
});

// -----------------------------------------------------
// transactions — on-chain tx log (received/sent in sats; fee truncates sub-sat)
// -----------------------------------------------------
export const transactions = pgTable("transactions", {
  id: integer("id").primaryKey(),
  transaction: varchar("transaction"),
  txid: varchar("txid"),
  received: bigint("received", { mode: "bigint" }),
  sent: bigint("sent", { mode: "bigint" }),
  fee: integer("fee"),
  confirmationHeight: integer("confirmation_height"),
  confirmationTimestamp: bigint("confirmation_timestamp", { mode: "bigint" }),
  createTime: timestamp("create_time"),
  timestampAsString: varchar("timestamp_as_string"),
});
