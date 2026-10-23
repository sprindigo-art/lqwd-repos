# LDK Warehouse Live Introspection (`ldk-lspd-main`)

Source of truth for the LDK warehouse column shapes. The research carried these as
`[ASSUMED]` (no `lqwdLogs` query exercises them and they are not LND-shaped). These
were confirmed **live** via `information_schema.columns` against the real
`ldk-lspd-main` warehouse (read-only, via the interim `grafana_demo_ro` bridge).

- **Captured:** 2026-06-09
- **Method:** `SELECT table_name, column_name, data_type, is_nullable, ordinal_position
  FROM information_schema.columns WHERE table_schema='public' AND table_name IN
  ('lightning_channels','lsps1_orders','payments','transactions')
  ORDER BY table_name, ordinal_position`
- **Connection:** `dbLdk` URL (`LDK_LSPD_DATABASE_URL`), session `default_transaction_read_only=on`.
- **Granted (visible) tables:** `lightning_channels`, `lsps1_orders`, `payments`, `transactions` (only these 4).

These verbatim rows are the only authority for `src/lib/db/schema/ldk.ts` — no memory-guessed
columns may persist anywhere in code.

## `lightning_channels`

| # | column | data_type | nullable |
|---|--------|-----------|----------|
| 1 | id | integer | NOT NULL |
| 2 | channel_id | character varying | NOT NULL |
| 3 | short_channel_id | bigint | NULL |
| 4 | funding_txid | character varying | NOT NULL |
| 5 | peer_pubkey | character varying | NOT NULL |
| 6 | is_channel_ready | boolean | NOT NULL |
| 7 | is_channel_usable | boolean | NOT NULL |
| 8 | channel_value_satoshis | bigint | NOT NULL |
| 9 | outbound_capacity_msat | bigint | NOT NULL |
| 10 | inbound_capacity_msat | bigint | NOT NULL |
| 11 | feerate_sat_per_1000_weight | integer | NOT NULL |
| 12 | available_balance_for_send_msat | bigint | NOT NULL |
| 13 | available_balance_for_recv_msat | bigint | NOT NULL |
| 14 | channel_can_send_payments | boolean | NOT NULL |
| 15 | public | boolean | NOT NULL |
| 16 | inbound_htlc_minimum_msat | bigint | NOT NULL |
| 17 | inbound_htlc_maximum_msat | bigint | NOT NULL |
| 18 | next_outbound_htlc_minimum_msat | bigint | NOT NULL |
| 19 | next_outbound_htlc_limit_msat | bigint | NOT NULL |
| 20 | status | character varying | NOT NULL |
| 21 | create_time | timestamp without time zone | NULL |
| 22 | update_time | timestamp without time zone | NULL |
| 23 | balance_msat | bigint | NULL |

> No `id`/created snapshot column drives "latest state" the way LND's event-driven
> `lnd_node_channel_info` does — LDK `lightning_channels` is a per-channel current-state
> table keyed by `channel_id`. AFM-001's `DISTINCT ON` failure mode does NOT apply here;
> there is one row per live channel. (Confirmed by `is_channel_ready`/`status` being
> current-state booleans, not an append-only event log.)

## `lsps1_orders`

| # | column | data_type | nullable |
|---|--------|-----------|----------|
| 1 | id | integer | NOT NULL |
| 2 | request_id | integer | NOT NULL |
| 3 | order_id | character varying | NULL |
| 4 | api_version | integer | NOT NULL |
| 5 | lsp_balance_sat | bigint | NOT NULL |
| 6 | client_balance_sat | bigint | NOT NULL |
| 7 | required_channel_confirmations | integer | NOT NULL |
| 8 | funding_confirms_within_blocks | integer | NOT NULL |
| 9 | channel_expiry_blocks | integer | NOT NULL |
| 10 | token | character varying | NULL |
| 11 | created_at | timestamp with time zone | NOT NULL |
| 12 | expires_at | timestamp with time zone | NOT NULL |
| 13 | announce_channel | boolean | NOT NULL |
| 14 | order_state | character varying | NOT NULL |
| 15 | payment | jsonb | NOT NULL |
| 16 | payment_expiry_block | integer | NULL |
| 17 | payment_hash | character varying | NULL |
| 18 | payment_preimage | character varying | NULL |
| 19 | payment_preimage_received_at | timestamp with time zone | NULL |
| 20 | payment_preimage_claimed_at | timestamp with time zone | NULL |
| 21 | payment_preimage_claimed | boolean | NULL |
| 22 | num_of_retries | integer | NULL |
| 23 | last_retry_at | timestamp with time zone | NULL |
| 24 | channel | jsonb | NULL |
| 25 | channel_id | character varying | NULL |
| 26 | temporary_channel_id | character varying | NULL |
| 27 | record_created_at | timestamp with time zone | NULL |
| 28 | record_updated_at | timestamp with time zone | NULL |
| 29 | status | character varying | NULL |
| 30 | error_msg | character varying | NULL |

## `payments`

| # | column | data_type | nullable |
|---|--------|-----------|----------|
| 1 | id | integer | NOT NULL |
| 2 | hash | character varying | NOT NULL |
| 3 | preimage | character varying | NULL |
| 4 | secret | character varying | NULL |
| 5 | amount_msat | bigint | NOT NULL |
| 6 | direction | character varying | NOT NULL |
| 7 | status | character varying | NOT NULL |
| 8 | lsp_fee_limits | jsonb | NULL |
| 9 | create_time | timestamp without time zone | NULL |
| 10 | timestamp_as_string | character varying | NULL |

## `transactions`

| # | column | data_type | nullable |
|---|--------|-----------|----------|
| 1 | id | integer | NOT NULL |
| 2 | transaction | character varying | NULL |
| 3 | txid | character varying | NULL |
| 4 | received | bigint | NULL |
| 5 | sent | bigint | NULL |
| 6 | fee | integer | NULL |
| 7 | confirmation_height | integer | NULL |
| 8 | confirmation_timestamp | bigint | NULL |
| 9 | create_time | timestamp without time zone | NULL |
| 10 | timestamp_as_string | character varying | NULL |

## Notes for the unified model (Plan 04, READ-04)

- **LDK balance/amount fields are in msat** (`*_msat` columns) or **sat** (`*_satoshis`,
  `*_sat`) — route every display value through `@/lib/format/units` (AFM-002). `transactions.fee`
  is `integer` (sats) but truncates sub-sat; prefer msat sources where available.
- **LDK per-node identity is `peer_pubkey`** on `lightning_channels` (the channel counterparty),
  not a `local_pubkey` like LND. The LDK warehouse is single-node (the LSP itself), so there is
  no per-`local_pubkey` partitioning the way `routing_vm` has across the fleet. Plan 04's
  `mapLdkNode` must account for this asymmetry.
