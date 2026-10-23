// Package lnd provides an interface and gRPC implementation for communicating with LND.
// The Client interface abstracts all LND RPC calls so handlers never import proto types.
// In mock mode, handlers bypass this package entirely.
package lnd

import "context"

// Client defines all LND operations the gateway needs.
// Each method returns the gateway-style {"ok": true, "data": {...}} envelope.
type Client interface {
	// Read-only
	GetInfo(ctx context.Context) (map[string]any, error)
	WalletBalance(ctx context.Context) (map[string]any, error)
	ChannelBalance(ctx context.Context) (map[string]any, error)
	ListChannels(ctx context.Context) (map[string]any, error)
	PendingChannels(ctx context.Context) (map[string]any, error)
	ListPeers(ctx context.Context) (map[string]any, error)
	ClosedChannels(ctx context.Context) (map[string]any, error)
	FeeEstimate(ctx context.Context, targetConf int32) (map[string]any, error)
	ListTransactions(ctx context.Context) (map[string]any, error)
	ForwardingHistory(ctx context.Context, startTime, endTime uint64) (map[string]any, error)

	// Channel operations
	OpenChannel(ctx context.Context, req OpenChannelRequest) (map[string]any, error)
	CloseChannel(ctx context.Context, req CloseChannelRequest) (map[string]any, error)

	// Payments & invoices
	SendPayment(ctx context.Context, req SendPaymentRequest) (map[string]any, error)
	CreateInvoice(ctx context.Context, req CreateInvoiceRequest) (map[string]any, error)
	LookupInvoice(ctx context.Context, rHash string) (map[string]any, error)

	// On-chain
	SendCoins(ctx context.Context, req SendCoinsRequest) (map[string]any, error)
	NewAddress(ctx context.Context, addrType string) (map[string]any, error)

	// Peers
	ConnectPeer(ctx context.Context, pubkey, host string) (map[string]any, error)
	DisconnectPeer(ctx context.Context, pubkey string) (map[string]any, error)

	// Analytics
	FeeReport(ctx context.Context) (map[string]any, error)
	GetNodeInfo(ctx context.Context, pubkey string, includeChannels bool) (map[string]any, error)
	GetChanInfo(ctx context.Context, chanID uint64) (map[string]any, error)
	ChannelScores(ctx context.Context) (map[string]any, error)

	// Write (analytics)
	Rebalance(ctx context.Context, req RebalanceRequest) (map[string]any, error)
	UpdateChannelPolicy(ctx context.Context, req UpdatePolicyRequest) (map[string]any, error)

	// Lifecycle
	Close() error
}

// --- Request structs (Go-native, no proto imports needed by handlers) ---

// OpenChannelRequest is the gateway representation of an open channel request.
// JSON tags match the public handler API in internal/handlers/write.go so the
// executor can unmarshal confirmation request bodies directly into this type.
type OpenChannelRequest struct {
	NodePubkey         string `json:"node_pubkey"`
	LocalFundingAmount int64  `json:"local_funding_amount"`
	PushSat            int64  `json:"push_sats,omitempty"`
	TargetConf         int32  `json:"target_conf,omitempty"`
	SatPerVbyte        int64  `json:"sat_per_vbyte,omitempty"`
	Private            bool   `json:"private,omitempty"`
	IdempotencyKey     string `json:"idempotency_key,omitempty"`
}

// CloseChannelRequest is the gateway representation of a close channel request.
// ChannelPoint carries the handler's "chan_id" string, which is formatted as
// "txid:vout" (not a CLN short channel ID) — see grpc.go:CloseChannel.
type CloseChannelRequest struct {
	ChannelPoint string `json:"chan_id"`
	Force        bool   `json:"force,omitempty"`
	TargetConf   int32  `json:"target_conf,omitempty"`
	SatPerVbyte  int64  `json:"sat_per_vbyte,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// SendPaymentRequest is the gateway representation of a payment request.
type SendPaymentRequest struct {
	PaymentRequest string `json:"payment_request"`
	AmountSats     int64  `json:"amount_sats,omitempty"`
	TimeoutSeconds int32  `json:"timeout_seconds,omitempty"`
	FeeLimitSat    int64  `json:"fee_limit_sats,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// CreateInvoiceRequest is the gateway representation of an invoice creation.
type CreateInvoiceRequest struct {
	AmountSats  int64  `json:"amount_sats"`
	Memo        string `json:"memo,omitempty"`
	ExpirySecs  int64  `json:"expiry,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// SendCoinsRequest is the gateway representation of an on-chain send.
type SendCoinsRequest struct {
	Addr           string `json:"address"`
	Amount         int64  `json:"amount_sats"`
	SatPerVbyte    int64  `json:"sat_per_vbyte,omitempty"`
	TargetConf     int32  `json:"target_conf,omitempty"`
	SendAll        bool   `json:"send_all,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// UpdatePolicyRequest is the gateway representation of a channel fee update.
type UpdatePolicyRequest struct {
	ChanID      string `json:"chan_id,omitempty"`   // empty = all channels
	BaseFeeMsat int64  `json:"base_fee_msat"`
	FeeRatePPM  int64  `json:"fee_rate_ppm"`
	TimeLockDelta uint32 `json:"time_lock_delta,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}

// RebalanceRequest is the gateway representation of a circular rebalance.
// JSON tags match the public handler API (handlers.Rebalance) so the executor
// can unmarshal the stored confirmation body directly.
type RebalanceRequest struct {
	OutgoingChanID string `json:"outgoing_chan_id"`
	IncomingChanID string `json:"incoming_chan_id"`
	AmountSats     int64  `json:"amount_sats"`
	MaxFeeSats     int64  `json:"max_fee_sats"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`
}
