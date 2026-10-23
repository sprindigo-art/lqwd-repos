// Package mock provides static LND responses for local testing without a real LND node.
// Activated via GATEWAY_MOCK=true.
package mock

import (
	"crypto/rand"
	"encoding/hex"
	"time"
)

// GetInfo returns a mock getinfo response.
func GetInfo() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"identity_pubkey":       "02mock1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
			"alias":                 "LQWDClaw-NodeOps-Mock",
			"num_active_channels":   5,
			"num_inactive_channels": 1,
			"num_pending_channels":  0,
			"num_peers":             8,
			"block_height":          880000,
			"block_hash":            "0000000000000000000mock000000000000000000000000000000000000000000",
			"synced_to_chain":       true,
			"synced_to_graph":       true,
			"version":               "0.20.1-beta commit=mock",
			"chains": []map[string]any{
				{"chain": "bitcoin", "network": "mainnet"},
			},
		},
	}
}

// WalletBalance returns a mock wallet balance.
func WalletBalance() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"total_balance":       int64(5_000_000),
			"confirmed_balance":   int64(4_500_000),
			"unconfirmed_balance": int64(500_000),
		},
	}
}

// ChannelBalance returns a mock channel balance.
func ChannelBalance() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"local_balance":                int64(15_000_000),
			"remote_balance":               int64(10_000_000),
			"pending_open_local_balance":   int64(0),
			"pending_open_remote_balance":  int64(0),
		},
	}
}

// ListChannels returns mock channels.
func ListChannels() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"channels": []map[string]any{
				{
					"chan_id":                 "850000000000000001",
					"remote_pubkey":           "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
					"capacity":                int64(5_000_000),
					"local_balance":           int64(3_000_000),
					"remote_balance":          int64(2_000_000),
					"active":                  true,
					"private":                 false,
					"initiator":               true,
					"total_satoshis_sent":     int64(1_200_000),
					"total_satoshis_received": int64(800_000),
					"num_updates":             1234,
					"pending_htlcs":           []map[string]any{},
				},
				{
					"chan_id":                 "850000000000000002",
					"remote_pubkey":           "03peer2aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333355",
					"capacity":                int64(10_000_000),
					"local_balance":           int64(7_000_000),
					"remote_balance":          int64(3_000_000),
					"active":                  true,
					"private":                 false,
					"initiator":               true,
					"total_satoshis_sent":     int64(5_000_000),
					"total_satoshis_received": int64(3_500_000),
					"num_updates":             5678,
					"pending_htlcs":           []map[string]any{},
				},
				{
					"chan_id":                 "850000000000000003",
					"remote_pubkey":           "03peer3aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333366",
					"capacity":                int64(2_000_000),
					"local_balance":           int64(500_000),
					"remote_balance":          int64(1_500_000),
					"active":                  false,
					"private":                 false,
					"initiator":               false,
					"total_satoshis_sent":     int64(100_000),
					"total_satoshis_received": int64(50_000),
					"num_updates":             42,
					"pending_htlcs":           []map[string]any{},
				},
			},
		},
	}
}

// PendingChannels returns mock pending-channel state. The fixture is keyed off
// the lndparse testdata funding_txid (0000111122223333…55556677889900) so the
// shared parser in internal/lndparse can round-trip this payload end-to-end in
// both concrete-slice and JSON-generic shapes.
//
// The shape matches the widened (*GRPCClient).PendingChannels response in
// internal/lnd/grpc.go: four per-bucket slices plus total_limbo_balance.
// Callers MUST allowlist fields before exposing externally (D-20 — see the
// security comment on the live gRPC wrapper).
func PendingChannels() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"pending_open_channels": []map[string]any{
				{
					"channel_point":   "0000111122223333444455556677889900001111222233334444555566778899:0",
					"remote_node_pub": "03mockpending000000000000000000000000000000000000000000000000000001",
					"capacity":        int64(20000),
					"local_balance":   int64(18646),
					"remote_balance":  int64(1354),
					"commit_fee":      int64(500),
					"fee_per_kw":      int64(2500),
				},
			},
			"pending_closing_channels": []map[string]any{
				{
					"channel_point":   "aaaabbbb00000000000000000000000000000000000000000000000000000000:0",
					"remote_node_pub": "03mockclosing0000000000000000000000000000000000000000000000000001",
					"capacity":        int64(50000),
					"local_balance":   int64(25000),
					"remote_balance":  int64(25000),
				},
			},
			"pending_force_closing_channels": []map[string]any{
				{
					"channel_point":   "ccccdddd00000000000000000000000000000000000000000000000000000000:0",
					"remote_node_pub": "03mockforce00000000000000000000000000000000000000000000000000001",
					"capacity":        int64(100000),
					"local_balance":   int64(50000),
					"remote_balance":  int64(50000),
				},
			},
			"waiting_close_channels": []map[string]any{},
			"total_limbo_balance":    int64(25000),
		},
	}
}

// ListPeers returns mock peers.
func ListPeers() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"peers": []map[string]any{
				{
					"pub_key":    "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
					"address":    "1.2.3.4:9735",
					"bytes_sent": 1234567,
					"bytes_recv": 7654321,
					"sat_sent":   int64(1_200_000),
					"sat_recv":   int64(800_000),
					"inbound":    false,
					"ping_time":  int64(25000),
				},
				{
					"pub_key":    "03peer2aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333355",
					"address":    "5.6.7.8:9735",
					"bytes_sent": 2345678,
					"bytes_recv": 8765432,
					"sat_sent":   int64(5_000_000),
					"sat_recv":   int64(3_500_000),
					"inbound":    false,
					"ping_time":  int64(15000),
				},
			},
		},
	}
}

// Health returns mock health status.
func Health() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"status":        "healthy",
			"mock_mode":     true,
			"lnd_connected": true,
			"wallet_locked": false,
			"uptime":        time.Since(time.Now().Add(-1 * time.Hour)).String(),
		},
	}
}

// FeeEstimate returns mock fee estimates.
func FeeEstimate() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"fastest_fee": int64(25),
			"half_hour":   int64(15),
			"hour":        int64(8),
			"economy":     int64(3),
			"minimum":     int64(1),
		},
	}
}

// --- Phase 2: Write operation mock responses ---

// OpenChannel returns a mock channel open response (confirmation required).
func OpenChannel(nodePubkey string, localAmount int64) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"funding_txid": "mocktxid1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
			"output_index": 0,
			"node_pubkey":  nodePubkey,
			"local_amount": localAmount,
			"status":       "pending_open",
		},
	}
}

// CloseChannel returns a mock channel close response (confirmation required).
func CloseChannel(chanID string) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"closing_txid": "mockclosetxid567890abcdef1234567890abcdef1234567890abcdef12345678",
			"chan_id":       chanID,
			"status":       "pending_close",
		},
	}
}

// mockPreimage generates a cryptographically random 32-byte preimage as hex.
func mockPreimage() string {
	var preimage [32]byte
	rand.Read(preimage[:])
	return hex.EncodeToString(preimage[:])
}

// SendPayment returns a mock payment response.
func SendPayment(paymentRequest string, amountSats int64) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"payment_hash":    "mockpaymenthash1234567890abcdef1234567890abcdef1234567890abcdef12",
			"payment_preimage": mockPreimage(),
			"amount_sats":     amountSats,
			"fee_sats":        int64(10),
			"status":          "SUCCEEDED",
			"num_hops":        3,
		},
	}
}

// CreateInvoice returns a mock invoice creation response.
func CreateInvoice(amountSats int64, memo string) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"payment_request": "lnbc" + "mockpaymentrequest1234567890abcdef",
			"r_hash":          "mockrhash1234567890abcdef1234567890abcdef1234567890abcdef12345678",
			"add_index":       42,
			"amount_sats":     amountSats,
			"memo":            memo,
		},
	}
}

// LookupInvoice returns a mock invoice lookup response.
func LookupInvoice() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"r_hash":      "mockrhash1234567890abcdef1234567890abcdef1234567890abcdef12345678",
			"memo":        "test invoice",
			"amount_sats": int64(50_000),
			"settled":     true,
			"state":       "SETTLED",
			"creation_date": time.Now().Add(-1 * time.Hour).Unix(),
			"settle_date":   time.Now().Add(-30 * time.Minute).Unix(),
		},
	}
}

// SendOnChain returns a mock on-chain send response (confirmation required).
func SendOnChain(addr string, amountSats int64) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"txid":        "mockonsendtxid1234567890abcdef1234567890abcdef1234567890abcdef1234",
			"amount_sats": amountSats,
			"address":     addr,
			"fee_sats":    int64(2500),
		},
	}
}

// NewAddress returns a mock new address.
func NewAddress(addrType string) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"address": "bc1qmock1234567890abcdef1234567890abcdef1234",
			"type":    addrType,
		},
	}
}

// ListTransactions returns mock on-chain transactions.
func ListTransactions() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"transactions": []map[string]any{
				{
					"tx_hash":        "mocktx1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
					"amount":         int64(500_000),
					"num_confirmations": 100,
					"block_height":   879900,
					"time_stamp":     time.Now().Add(-2 * time.Hour).Unix(),
					"label":          "channel open",
				},
				{
					"tx_hash":        "mocktx2345678901abcdef1234567890abcdef1234567890abcdef1234567890bc",
					"amount":         int64(-250_000),
					"num_confirmations": 50,
					"block_height":   879950,
					"time_stamp":     time.Now().Add(-1 * time.Hour).Unix(),
					"label":          "withdrawal",
				},
			},
		},
	}
}

// ForwardingHistory returns mock forwarding events.
func ForwardingHistory() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"forwarding_events": []map[string]any{
				{
					"timestamp":    time.Now().Add(-30 * time.Minute).Unix(),
					"chan_id_in":   "850000000000000001",
					"chan_id_out":  "850000000000000002",
					"amt_in":      int64(100_000),
					"amt_out":     int64(99_900),
					"fee":         int64(100),
					"fee_msat":    int64(100_000),
				},
				{
					"timestamp":    time.Now().Add(-15 * time.Minute).Unix(),
					"chan_id_in":   "850000000000000002",
					"chan_id_out":  "850000000000000001",
					"amt_in":      int64(50_000),
					"amt_out":     int64(49_950),
					"fee":         int64(50),
					"fee_msat":    int64(50_000),
				},
			},
			"last_offset_index": 2,
		},
	}
}

// ConnectPeer returns a mock peer connect response.
func ConnectPeer() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"message": "peer connected successfully",
		},
	}
}

// DisconnectPeer returns a mock peer disconnect response.
func DisconnectPeer() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"message": "peer disconnected successfully",
		},
	}
}

// --- Phase 3: Analytics & Intelligence mock responses ---

// FeeReport returns aggregate fee data across all channels.
func FeeReport() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"channel_fees": []map[string]any{
				{
					"chan_id":          "850000000000000001",
					"remote_pubkey":    "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
					"base_fee_msat":    int64(1000),
					"fee_rate_ppm":     int64(100),
					"time_lock_delta":  40,
				},
				{
					"chan_id":          "850000000000000002",
					"remote_pubkey":    "03peer2aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333355",
					"base_fee_msat":    int64(1000),
					"fee_rate_ppm":     int64(150),
					"time_lock_delta":  40,
				},
				{
					"chan_id":          "850000000000000003",
					"remote_pubkey":    "03peer3aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333366",
					"base_fee_msat":    int64(500),
					"fee_rate_ppm":     int64(50),
					"time_lock_delta":  40,
				},
			},
			"total_fee_revenue_sats": int64(150),
			"total_forwarded_sats":   int64(150_000),
			"period_hours":           24,
		},
	}
}

// GraphNodeInfo returns mock network graph info for a node.
func GraphNodeInfo(pubKey string, includeChannels bool) map[string]any {
	data := map[string]any{
		"node": map[string]any{
			"pub_key":     pubKey,
			"alias":       "MockNode-" + pubKey[:8],
			"color":       "#3399ff",
			"last_update": time.Now().Add(-2 * time.Hour).Unix(),
			"addresses": []map[string]any{
				{"network": "tcp", "addr": "1.2.3.4:9735"},
			},
			"features": map[string]any{
				"0":  "data-loss-protect",
				"5":  "upfront-shutdown-script",
				"9":  "tlv-onion",
				"12": "static-remote-key",
				"14": "payment-addr",
				"17": "multi-path-payments",
				"23": "anchors-zero-fee-htlc-tx",
			},
		},
		"num_channels":    12,
		"total_capacity":  int64(50_000_000),
	}

	if includeChannels {
		data["channels"] = []map[string]any{
			{
				"chan_id":       "860000000000000001",
				"capacity":     int64(5_000_000),
				"node1_pub":    pubKey,
				"node2_pub":    "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
				"last_update":  time.Now().Add(-1 * time.Hour).Unix(),
			},
		}
	}

	return map[string]any{"ok": true, "data": data}
}

// GraphChannelInfo returns mock network graph info for a channel.
func GraphChannelInfo(chanID string) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"chan_id":    chanID,
			"capacity":  int64(5_000_000),
			"node1_pub": "02mock1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
			"node2_pub": "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
			"node1_policy": map[string]any{
				"time_lock_delta":    40,
				"min_htlc":          int64(1000),
				"fee_base_msat":     int64(1000),
				"fee_rate_ppm":      int64(100),
				"disabled":          false,
				"max_htlc_msat":     int64(4_950_000_000),
				"last_update":       time.Now().Add(-3 * time.Hour).Unix(),
			},
			"node2_policy": map[string]any{
				"time_lock_delta":    40,
				"min_htlc":          int64(1000),
				"fee_base_msat":     int64(500),
				"fee_rate_ppm":      int64(75),
				"disabled":          false,
				"max_htlc_msat":     int64(4_950_000_000),
				"last_update":       time.Now().Add(-1 * time.Hour).Unix(),
			},
		},
	}
}

// ChannelScores returns computed health scores for all channels.
func ChannelScores() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"scores": []map[string]any{
				{
					"chan_id":           "850000000000000001",
					"remote_pubkey":     "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
					"health_score":      85,
					"activity_score":    90,
					"balance_score":     80,
					"uptime_score":      95,
					"forwarding_volume": int64(1_200_000),
					"fee_revenue":       int64(120),
					"recommendation":    "healthy — good forwarding volume",
				},
				{
					"chan_id":           "850000000000000002",
					"remote_pubkey":     "03peer2aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333355",
					"health_score":      72,
					"activity_score":    80,
					"balance_score":     60,
					"uptime_score":      90,
					"forwarding_volume": int64(5_000_000),
					"fee_revenue":       int64(500),
					"recommendation":    "imbalanced — consider rebalancing outbound",
				},
				{
					"chan_id":           "850000000000000003",
					"remote_pubkey":     "03peer3aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333366",
					"health_score":      25,
					"activity_score":    10,
					"balance_score":     30,
					"uptime_score":      0,
					"forwarding_volume": int64(100_000),
					"fee_revenue":       int64(5),
					"recommendation":    "unhealthy — inactive, low volume, consider closing",
				},
			},
			"average_health": 61,
		},
	}
}

// Rebalance returns a mock circular rebalance response.
func Rebalance(outChanID, inChanID string, amountSats, maxFeeSats int64) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"status":           "SUCCEEDED",
			"amount_sats":      amountSats,
			"fee_sats":         int64(50),
			"fee_ppm":          int64(100),
			"outgoing_chan_id":  outChanID,
			"incoming_chan_id":  inChanID,
			"num_hops":         4,
			"rebalance_id":     "mockreb_" + outChanID[:6] + "_" + inChanID[:6],
		},
	}
}

// UpdateChannelFees returns a mock fee update response.
func UpdateChannelFees(chanID string, baseFeeMsat, feeRatePPM int64) map[string]any {
	target := "all channels"
	if chanID != "" {
		target = "channel " + chanID
	}
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"message":          "fees updated for " + target,
			"base_fee_msat":    baseFeeMsat,
			"fee_rate_ppm":     feeRatePPM,
			"channels_updated": 3,
		},
	}
}

// NodeSummary returns a mock aggregated node status for external consumption.
func NodeSummary() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"node": map[string]any{
				"alias":       "LQWDClaw-NodeOps",
				"pubkey":      "02aabbccddee00112233445566778899aabbccddee00112233445566778899aabb",
				"version":     "0.20.1-beta",
				"synced":      true,
				"block_height": 890123,
			},
			"balances": map[string]any{
				"onchain_confirmed_sats": 1_500_000,
				"onchain_unconfirmed_sats": 0,
				"channel_local_sats":     4_200_000,
				"channel_remote_sats":    3_800_000,
				"channel_pending_sats":   0,
				"total_sats":            5_700_000,
			},
			"channels": map[string]any{
				"active":   3,
				"inactive": 0,
				"pending":  0,
				"total_capacity_sats": 8_000_000,
				"avg_local_ratio":     0.525,
			},
			"peers": map[string]any{
				"connected": 3,
			},
			"routing": map[string]any{
				"total_forwards_7d":   42,
				"total_fees_earned_7d": 1_250,
				"avg_forward_size":     150_000,
			},
			"health": map[string]any{
				"status":           "healthy",
				"kill_switch":      false,
				"avg_channel_score": 78.5,
				"uptime_hours":     168,
			},
			"generated_at": time.Now().UTC().Format(time.RFC3339),
		},
	}
}

// L402ClientPay returns a mock L402 client payment result.
func L402ClientPay(url string, maxSats int64) map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"url":          url,
			"paid_sats":    int64(5),
			"payment_hash": "mock_payment_hash_for_l402_client",
			"response":     map[string]any{"ok": true, "data": map[string]any{"message": "mock L402 response"}},
		},
	}
}

// L402NetworkAnalytics returns mock aggregated network analytics.
func L402NetworkAnalytics() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"alias":               "LQWDClaw-NodeOps-Mock",
			"num_active_channels": 5,
			"num_peers":           8,
			"day_fee_sum":         int64(150),
			"week_fee_sum":        int64(1250),
			"month_fee_sum":       int64(4800),
		},
	}
}

// L402Promo returns mock promotional content.
func L402Promo() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"message":  "LQWDClaw — AI-powered Lightning node operations by LQWD Technologies Corp.",
			"website":  "https://lqwdclaw.bot",
			"node":     "LQWDClaw",
			"exchange": "TSX.V: LQWD | OTCQB: LQWDF",
		},
	}
}

// L402NodeStats returns a mock L402 node-stats response (public-safe curated data).
func L402NodeStats() map[string]any {
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"identity_pubkey":     "02mock1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
			"alias":               "LQWDClaw-NodeOps-Mock",
			"num_active_channels": 5,
			"num_peers":           8,
			"synced_to_chain":     true,
			"synced_to_graph":     true,
			"block_height":        880000,
			"version":             "0.20.1-beta commit=mock",
		},
	}
}
