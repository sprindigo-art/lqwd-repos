package lnd

import (
	"context"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/lightningnetwork/lnd/lnrpc"
	"github.com/lightningnetwork/lnd/lnrpc/routerrpc"
	"github.com/lightningnetwork/lnd/lnrpc/walletrpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

// GRPCClient implements Client using real LND gRPC calls.
type GRPCClient struct {
	conn      *grpc.ClientConn
	lightning lnrpc.LightningClient
	router    routerrpc.RouterClient
	wallet    walletrpc.WalletKitClient
	macaroons *MacaroonSet
}

// Verify interface compliance.
var _ Client = (*GRPCClient)(nil)

// NewGRPCClient connects to LND via gRPC with TLS and returns a Client.
func NewGRPCClient(host, tlsCertPath string, macaroons *MacaroonSet) (*GRPCClient, error) {
	certBytes, err := os.ReadFile(tlsCertPath)
	if err != nil {
		return nil, fmt.Errorf("read TLS cert: %w", err)
	}

	certPool := x509.NewCertPool()
	if !certPool.AppendCertsFromPEM(certBytes) {
		return nil, fmt.Errorf("failed to parse TLS cert from %s", tlsCertPath)
	}

	tlsCreds := credentials.NewClientTLSFromCert(certPool, "")
	conn, err := grpc.NewClient(host,
		grpc.WithTransportCredentials(tlsCreds),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(50*1024*1024)),
	)
	if err != nil {
		return nil, fmt.Errorf("grpc dial %s: %w", host, err)
	}

	return &GRPCClient{
		conn:      conn,
		lightning: lnrpc.NewLightningClient(conn),
		router:    routerrpc.NewRouterClient(conn),
		wallet:    walletrpc.NewWalletKitClient(conn),
		macaroons: macaroons,
	}, nil
}

func (c *GRPCClient) Close() error {
	return c.conn.Close()
}

// --- Read-Only Methods ---

func (c *GRPCClient) GetInfo(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.GetInfo(ctx, &lnrpc.GetInfoRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{
		"identity_pubkey":       resp.IdentityPubkey,
		"alias":                 resp.Alias,
		"version":               resp.Version,
		"num_active_channels":   resp.NumActiveChannels,
		"num_inactive_channels": resp.NumInactiveChannels,
		"num_pending_channels":  resp.NumPendingChannels,
		"num_peers":             resp.NumPeers,
		"block_height":          resp.BlockHeight,
		"block_hash":            resp.BlockHash,
		"synced_to_chain":       resp.SyncedToChain,
		"synced_to_graph":       resp.SyncedToGraph,
		"chains":                resp.Chains,
		"uris":                  resp.Uris,
	}), nil
}

func (c *GRPCClient) WalletBalance(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.WalletBalance(ctx, &lnrpc.WalletBalanceRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{
		"total_balance":       resp.TotalBalance,
		"confirmed_balance":   resp.ConfirmedBalance,
		"unconfirmed_balance": resp.UnconfirmedBalance,
	}), nil
}

func (c *GRPCClient) ChannelBalance(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.ChannelBalance(ctx, &lnrpc.ChannelBalanceRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	data := map[string]any{}
	if resp.LocalBalance != nil {
		data["local_balance_sat"] = resp.LocalBalance.Sat
		data["local_balance_msat"] = resp.LocalBalance.Msat
	}
	if resp.RemoteBalance != nil {
		data["remote_balance_sat"] = resp.RemoteBalance.Sat
		data["remote_balance_msat"] = resp.RemoteBalance.Msat
	}
	if resp.PendingOpenLocalBalance != nil {
		data["pending_open_local_sat"] = resp.PendingOpenLocalBalance.Sat
	}
	if resp.PendingOpenRemoteBalance != nil {
		data["pending_open_remote_sat"] = resp.PendingOpenRemoteBalance.Sat
	}
	return ok(data), nil
}

func (c *GRPCClient) ListChannels(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.ListChannels(ctx, &lnrpc.ListChannelsRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	channels := make([]map[string]any, 0, len(resp.Channels))
	for _, ch := range resp.Channels {
		channels = append(channels, map[string]any{
			"chan_id":                 ch.ChanId,
			"channel_point":           ch.ChannelPoint,
			"remote_pubkey":           ch.RemotePubkey,
			"capacity":                ch.Capacity,
			"local_balance":           ch.LocalBalance,
			"remote_balance":          ch.RemoteBalance,
			"active":                  ch.Active,
			"private":                 ch.Private,
			"initiator":               ch.Initiator,
			"total_satoshis_sent":     ch.TotalSatoshisSent,
			"total_satoshis_received": ch.TotalSatoshisReceived,
			"num_updates":             ch.NumUpdates,
			"pending_htlcs":           len(ch.PendingHtlcs),
			"unsettled_balance":       ch.UnsettledBalance,
			"uptime":                  ch.Uptime,
			"lifetime":                ch.Lifetime,
		})
	}
	return ok(map[string]any{
		"channels": channels,
		"count":    len(channels),
	}), nil
}

// PendingChannels returns the per-channel pending-state payload from LND. The
// envelope data carries four per-bucket slices plus total_limbo_balance. Each
// per-channel record includes channel_point, remote_node_pub, capacity, and
// the local/remote balances; pending_open additionally carries commit_fee and
// fee_per_kw.
//
// SECURITY: Callers MUST allowlist fields before exposing this payload
// externally — funding_txids and counterparty pubkeys are sensitive. The
// /v1/admin/faucet/summary and /v1/internal/channel/status handlers build
// response structs that filter this payload down to non-identifying counts
// and grant-scoped fields (D-20; see Phase 22 Plans 04/05).
func (c *GRPCClient) PendingChannels(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.PendingChannels(ctx, &lnrpc.PendingChannelsRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	pendingOpen := make([]map[string]any, 0, len(resp.PendingOpenChannels))
	for _, p := range resp.PendingOpenChannels {
		if p.Channel == nil {
			continue
		}
		pendingOpen = append(pendingOpen, map[string]any{
			"channel_point":   p.Channel.ChannelPoint,
			"remote_node_pub": p.Channel.RemoteNodePub,
			"capacity":        p.Channel.Capacity,
			"local_balance":   p.Channel.LocalBalance,
			"remote_balance":  p.Channel.RemoteBalance,
			"commit_fee":      p.CommitFee,
			"fee_per_kw":      p.FeePerKw,
		})
	}
	pendingClosing := make([]map[string]any, 0, len(resp.PendingClosingChannels))
	for _, p := range resp.PendingClosingChannels {
		if p.Channel == nil {
			continue
		}
		pendingClosing = append(pendingClosing, map[string]any{
			"channel_point":   p.Channel.ChannelPoint,
			"remote_node_pub": p.Channel.RemoteNodePub,
			"capacity":        p.Channel.Capacity,
			"local_balance":   p.Channel.LocalBalance,
			"remote_balance":  p.Channel.RemoteBalance,
		})
	}
	pendingForceClosing := make([]map[string]any, 0, len(resp.PendingForceClosingChannels))
	for _, p := range resp.PendingForceClosingChannels {
		if p.Channel == nil {
			continue
		}
		pendingForceClosing = append(pendingForceClosing, map[string]any{
			"channel_point":   p.Channel.ChannelPoint,
			"remote_node_pub": p.Channel.RemoteNodePub,
			"capacity":        p.Channel.Capacity,
			"local_balance":   p.Channel.LocalBalance,
			"remote_balance":  p.Channel.RemoteBalance,
		})
	}
	waitingClose := make([]map[string]any, 0, len(resp.WaitingCloseChannels))
	for _, p := range resp.WaitingCloseChannels {
		if p.Channel == nil {
			continue
		}
		waitingClose = append(waitingClose, map[string]any{
			"channel_point":   p.Channel.ChannelPoint,
			"remote_node_pub": p.Channel.RemoteNodePub,
			"capacity":        p.Channel.Capacity,
			"local_balance":   p.Channel.LocalBalance,
			"remote_balance":  p.Channel.RemoteBalance,
		})
	}
	return ok(map[string]any{
		"pending_open_channels":          pendingOpen,
		"pending_closing_channels":       pendingClosing,
		"pending_force_closing_channels": pendingForceClosing,
		"waiting_close_channels":         waitingClose,
		"total_limbo_balance":            resp.TotalLimboBalance,
	}), nil
}

func (c *GRPCClient) ListPeers(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.ListPeers(ctx, &lnrpc.ListPeersRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	peers := make([]map[string]any, 0, len(resp.Peers))
	for _, p := range resp.Peers {
		peers = append(peers, map[string]any{
			"pub_key":    p.PubKey,
			"address":    p.Address,
			"bytes_sent": p.BytesSent,
			"bytes_recv": p.BytesRecv,
			"sat_sent":   p.SatSent,
			"sat_recv":   p.SatRecv,
			"inbound":    p.Inbound,
			"ping_time":  p.PingTime,
			"sync_type":  p.SyncType.String(),
		})
	}
	return ok(map[string]any{
		"peers": peers,
		"count": len(peers),
	}), nil
}

func (c *GRPCClient) ClosedChannels(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.ClosedChannels(ctx, &lnrpc.ClosedChannelsRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	channels := make([]map[string]any, 0, len(resp.Channels))
	for _, ch := range resp.Channels {
		channels = append(channels, map[string]any{
			"channel_point":       ch.ChannelPoint,
			"chan_id":             ch.ChanId,
			"chain_hash":          ch.ChainHash,
			"closing_tx_hash":     ch.ClosingTxHash,
			"remote_pubkey":       ch.RemotePubkey,
			"capacity":            ch.Capacity,
			"close_height":        ch.CloseHeight,
			"settled_balance":     ch.SettledBalance,
			"time_locked_balance": ch.TimeLockedBalance,
			"close_type":          ch.CloseType.String(),
		})
	}
	return ok(map[string]any{
		"channels": channels,
		"count":    len(channels),
	}), nil
}

func (c *GRPCClient) FeeEstimate(ctx context.Context, targetConf int32) (map[string]any, error) {
	if targetConf <= 0 {
		targetConf = 6
	}
	resp, err := c.wallet.EstimateFee(ctx, &walletrpc.EstimateFeeRequest{
		ConfTarget: targetConf,
	}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	return ok(map[string]any{
		"sat_per_kw":    resp.SatPerKw,
		"sat_per_vbyte": resp.SatPerKw / 250, // approximate
		"target_conf":   targetConf,
	}), nil
}

func (c *GRPCClient) ListTransactions(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.GetTransactions(ctx, &lnrpc.GetTransactionsRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	txns := make([]map[string]any, 0, len(resp.Transactions))
	for _, tx := range resp.Transactions {
		txns = append(txns, map[string]any{
			"tx_hash":           tx.TxHash,
			"amount":            tx.Amount,
			"num_confirmations": tx.NumConfirmations,
			"block_height":      tx.BlockHeight,
			"time_stamp":        tx.TimeStamp,
			"total_fees":        tx.TotalFees,
			"label":             tx.Label,
		})
	}
	return ok(map[string]any{
		"transactions": txns,
		"count":        len(txns),
	}), nil
}

func (c *GRPCClient) ForwardingHistory(ctx context.Context, startTime, endTime uint64) (map[string]any, error) {
	resp, err := c.lightning.ForwardingHistory(ctx, &lnrpc.ForwardingHistoryRequest{
		StartTime: startTime,
		EndTime:   endTime,
	}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}
	events := make([]map[string]any, 0, len(resp.ForwardingEvents))
	for _, e := range resp.ForwardingEvents {
		events = append(events, map[string]any{
			"chan_id_in":   e.ChanIdIn,
			"chan_id_out":  e.ChanIdOut,
			"amt_in":       e.AmtIn,
			"amt_out":      e.AmtOut,
			"fee":          e.Fee,
			"fee_msat":     e.FeeMsat,
			"timestamp":    e.Timestamp,
			"timestamp_ns": e.TimestampNs,
		})
	}
	return ok(map[string]any{
		"forwarding_events": events,
		"count":             len(events),
		"last_offset_index": resp.LastOffsetIndex,
	}), nil
}

// --- Channel Operations ---

func (c *GRPCClient) OpenChannel(ctx context.Context, req OpenChannelRequest) (map[string]any, error) {
	pubkeyBytes, err := hex.DecodeString(req.NodePubkey)
	if err != nil {
		return nil, fmt.Errorf("decode pubkey: %w", err)
	}

	openReq := &lnrpc.OpenChannelRequest{
		NodePubkey:         pubkeyBytes,
		LocalFundingAmount: req.LocalFundingAmount,
		PushSat:            req.PushSat,
		TargetConf:         req.TargetConf,
		SatPerVbyte:        uint64(req.SatPerVbyte),
		Private:            req.Private,
	}

	resp, err := c.lightning.OpenChannelSync(ctx, openReq, c.macaroons.ChannelAdmin)
	if err != nil {
		return nil, err
	}

	txid := ""
	if resp.GetFundingTxidBytes() != nil {
		// LND returns txid bytes in reversed order
		txidBytes := resp.GetFundingTxidBytes()
		reversed := make([]byte, len(txidBytes))
		for i, b := range txidBytes {
			reversed[len(txidBytes)-1-i] = b
		}
		txid = hex.EncodeToString(reversed)
	}

	return ok(map[string]any{
		"funding_txid":    txid,
		"output_index":    resp.OutputIndex,
		"channel_pending": true,
	}), nil
}

func (c *GRPCClient) CloseChannel(ctx context.Context, req CloseChannelRequest) (map[string]any, error) {
	parts := strings.SplitN(req.ChannelPoint, ":", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid channel_point format, expected txid:index")
	}
	outputIndex, err := strconv.ParseUint(parts[1], 10, 32)
	if err != nil {
		return nil, fmt.Errorf("parse output index: %w", err)
	}

	closeReq := &lnrpc.CloseChannelRequest{
		ChannelPoint: &lnrpc.ChannelPoint{
			FundingTxid: &lnrpc.ChannelPoint_FundingTxidStr{
				FundingTxidStr: parts[0],
			},
			OutputIndex: uint32(outputIndex),
		},
		Force:       req.Force,
		TargetConf:  req.TargetConf,
		SatPerVbyte: uint64(req.SatPerVbyte),
	}

	// Timeout for close channel stream — prevents indefinite blocking if LND hangs
	closeCtx, closeCancel := context.WithTimeout(ctx, 60*time.Second)
	defer closeCancel()

	stream, err := c.lightning.CloseChannel(closeCtx, closeReq, c.macaroons.ChannelAdmin)
	if err != nil {
		return nil, err
	}

	// Read first update from the stream
	update, err := stream.Recv()
	if err != nil {
		return nil, fmt.Errorf("close channel stream: %w", err)
	}

	result := map[string]any{
		"close_initiated": true,
	}
	if closePending := update.GetClosePending(); closePending != nil {
		txidBytes := closePending.GetTxid()
		reversed := make([]byte, len(txidBytes))
		for i, b := range txidBytes {
			reversed[len(txidBytes)-1-i] = b
		}
		result["closing_txid"] = hex.EncodeToString(reversed)
	}

	return ok(result), nil
}

// --- Payments & Invoices ---

func (c *GRPCClient) SendPayment(ctx context.Context, req SendPaymentRequest) (map[string]any, error) {
	timeout := int32(60)
	if req.TimeoutSeconds > 0 {
		timeout = req.TimeoutSeconds
	}
	feeLimit := int64(1000) // 1000 sat default fee limit
	if req.FeeLimitSat > 0 {
		feeLimit = req.FeeLimitSat
	}

	payCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	stream, err := c.router.SendPaymentV2(payCtx, &routerrpc.SendPaymentRequest{
		PaymentRequest: req.PaymentRequest,
		Amt:            req.AmountSats,
		TimeoutSeconds: timeout,
		FeeLimitSat:    feeLimit,
	}, c.macaroons.Pay)
	if err != nil {
		return nil, err
	}

	// Read stream until terminal state
	var lastPayment *lnrpc.Payment
	for {
		payment, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("payment stream: %w", err)
		}
		lastPayment = payment
		if payment.Status == lnrpc.Payment_SUCCEEDED || payment.Status == lnrpc.Payment_FAILED {
			break
		}
	}

	if lastPayment == nil {
		return nil, fmt.Errorf("no payment status received")
	}

	result := map[string]any{
		"payment_hash":     lastPayment.PaymentHash,
		"payment_preimage": lastPayment.PaymentPreimage,
		"status":           lastPayment.Status.String(),
		"fee_sat":          lastPayment.FeeSat,
		"fee_msat":         lastPayment.FeeMsat,
		"value_sat":        lastPayment.ValueSat,
		"value_msat":       lastPayment.ValueMsat,
	}

	if lastPayment.Status == lnrpc.Payment_FAILED {
		result["failure_reason"] = lastPayment.FailureReason.String()
		return map[string]any{"ok": false, "error": "payment_failed", "data": result}, nil
	}

	return ok(result), nil
}

func (c *GRPCClient) CreateInvoice(ctx context.Context, req CreateInvoiceRequest) (map[string]any, error) {
	expiry := int64(3600) // 1 hour default
	if req.ExpirySecs > 0 {
		expiry = req.ExpirySecs
	}

	resp, err := c.lightning.AddInvoice(ctx, &lnrpc.Invoice{
		Value:  req.AmountSats,
		Memo:   req.Memo,
		Expiry: expiry,
	}, c.macaroons.Invoice)
	if err != nil {
		return nil, err
	}

	return ok(map[string]any{
		"r_hash":          hex.EncodeToString(resp.RHash),
		"payment_request": resp.PaymentRequest,
		"add_index":       resp.AddIndex,
	}), nil
}

func (c *GRPCClient) LookupInvoice(ctx context.Context, rHash string) (map[string]any, error) {
	hashBytes, err := hex.DecodeString(rHash)
	if err != nil {
		return nil, fmt.Errorf("decode r_hash: %w", err)
	}

	resp, err := c.lightning.LookupInvoice(ctx, &lnrpc.PaymentHash{
		RHash: hashBytes,
	}, c.macaroons.Invoice)
	if err != nil {
		return nil, err
	}

	return ok(map[string]any{
		"r_hash":          hex.EncodeToString(resp.RHash),
		"payment_request": resp.PaymentRequest,
		"memo":            resp.Memo,
		"value":           resp.Value,
		"settled":         resp.Settled,
		"state":           resp.State.String(),
		"creation_date":   resp.CreationDate,
		"settle_date":     resp.SettleDate,
		"expiry":          resp.Expiry,
		"amt_paid_sat":    resp.AmtPaidSat,
	}), nil
}

// --- On-Chain ---

func (c *GRPCClient) SendCoins(ctx context.Context, req SendCoinsRequest) (map[string]any, error) {
	sendReq := &lnrpc.SendCoinsRequest{
		Addr:        req.Addr,
		Amount:      req.Amount,
		SatPerVbyte: uint64(req.SatPerVbyte),
		TargetConf:  req.TargetConf,
		SendAll:     req.SendAll,
	}

	resp, err := c.lightning.SendCoins(ctx, sendReq, c.macaroons.Pay)
	if err != nil {
		return nil, err
	}

	return ok(map[string]any{
		"txid": resp.Txid,
	}), nil
}

func (c *GRPCClient) NewAddress(ctx context.Context, addrType string) (map[string]any, error) {
	aType := lnrpc.AddressType_TAPROOT_PUBKEY
	switch strings.ToLower(addrType) {
	case "p2wkh", "np2wkh":
		aType = lnrpc.AddressType_WITNESS_PUBKEY_HASH
	case "p2tr", "taproot":
		aType = lnrpc.AddressType_TAPROOT_PUBKEY
	}

	resp, err := c.lightning.NewAddress(ctx, &lnrpc.NewAddressRequest{
		Type: aType,
	}, c.macaroons.ChannelAdmin)
	if err != nil {
		return nil, err
	}

	return ok(map[string]any{
		"address": resp.Address,
		"type":    addrType,
	}), nil
}

// --- Peers ---

func (c *GRPCClient) ConnectPeer(ctx context.Context, pubkey, host string) (map[string]any, error) {
	_, err := c.lightning.ConnectPeer(ctx, &lnrpc.ConnectPeerRequest{
		Addr: &lnrpc.LightningAddress{
			Pubkey: pubkey,
			Host:   host,
		},
		Perm: true,
	}, c.macaroons.ChannelAdmin)
	if err != nil {
		return nil, err
	}

	return ok(map[string]any{
		"message": "connected to " + pubkey[:16] + "...",
	}), nil
}

func (c *GRPCClient) DisconnectPeer(ctx context.Context, pubkey string) (map[string]any, error) {
	_, err := c.lightning.DisconnectPeer(ctx, &lnrpc.DisconnectPeerRequest{
		PubKey: pubkey,
	}, c.macaroons.ChannelAdmin)
	if err != nil {
		return nil, err
	}

	return ok(map[string]any{
		"message": "disconnected from " + pubkey[:16] + "...",
	}), nil
}

// --- Analytics ---

func (c *GRPCClient) FeeReport(ctx context.Context) (map[string]any, error) {
	resp, err := c.lightning.FeeReport(ctx, &lnrpc.FeeReportRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}

	channels := make([]map[string]any, 0, len(resp.ChannelFees))
	for _, cf := range resp.ChannelFees {
		channels = append(channels, map[string]any{
			"chan_id":       cf.ChanId,
			"channel_point": cf.ChannelPoint,
			"base_fee_msat": cf.BaseFeeMsat,
			"fee_rate_ppm":  cf.FeePerMil * 1000, // convert to ppm
			"fee_rate":      cf.FeeRate,
		})
	}

	return ok(map[string]any{
		"channel_fees":  channels,
		"day_fee_sum":   resp.DayFeeSum,
		"week_fee_sum":  resp.WeekFeeSum,
		"month_fee_sum": resp.MonthFeeSum,
	}), nil
}

func (c *GRPCClient) GetNodeInfo(ctx context.Context, pubkey string, includeChannels bool) (map[string]any, error) {
	resp, err := c.lightning.GetNodeInfo(ctx, &lnrpc.NodeInfoRequest{
		PubKey:          pubkey,
		IncludeChannels: includeChannels,
	}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}

	data := map[string]any{
		"total_capacity": resp.TotalCapacity,
		"num_channels":   resp.NumChannels,
	}
	if resp.Node != nil {
		data["alias"] = resp.Node.Alias
		data["pubkey"] = resp.Node.PubKey
		data["last_update"] = resp.Node.LastUpdate
		data["color"] = resp.Node.Color
		addrs := make([]string, 0, len(resp.Node.Addresses))
		for _, a := range resp.Node.Addresses {
			addrs = append(addrs, a.Addr)
		}
		data["addresses"] = addrs
	}

	if includeChannels && len(resp.Channels) > 0 {
		chans := make([]map[string]any, 0, len(resp.Channels))
		for _, ch := range resp.Channels {
			chans = append(chans, map[string]any{
				"channel_id": ch.ChannelId,
				"capacity":   ch.Capacity,
				"node1_pub":  ch.Node1Pub,
				"node2_pub":  ch.Node2Pub,
			})
		}
		data["channels"] = chans
	}

	return ok(data), nil
}

func (c *GRPCClient) GetChanInfo(ctx context.Context, chanID uint64) (map[string]any, error) {
	resp, err := c.lightning.GetChanInfo(ctx, &lnrpc.ChanInfoRequest{
		ChanId: chanID,
	}, c.macaroons.Readonly)
	if err != nil {
		return nil, err
	}

	data := map[string]any{
		"channel_id":  resp.ChannelId,
		"chan_point":  resp.ChanPoint,
		"capacity":    resp.Capacity,
		"node1_pub":   resp.Node1Pub,
		"node2_pub":   resp.Node2Pub,
		"last_update": resp.LastUpdate,
	}
	if resp.Node1Policy != nil {
		data["node1_policy"] = map[string]any{
			"time_lock_delta": resp.Node1Policy.TimeLockDelta,
			"min_htlc":        resp.Node1Policy.MinHtlc,
			"max_htlc_msat":   resp.Node1Policy.MaxHtlcMsat,
			"fee_base_msat":   resp.Node1Policy.FeeBaseMsat,
			"fee_rate_ppm":    resp.Node1Policy.FeeRateMilliMsat,
		}
	}
	if resp.Node2Policy != nil {
		data["node2_policy"] = map[string]any{
			"time_lock_delta": resp.Node2Policy.TimeLockDelta,
			"min_htlc":        resp.Node2Policy.MinHtlc,
			"max_htlc_msat":   resp.Node2Policy.MaxHtlcMsat,
			"fee_base_msat":   resp.Node2Policy.FeeBaseMsat,
			"fee_rate_ppm":    resp.Node2Policy.FeeRateMilliMsat,
		}
	}

	return ok(data), nil
}

func (c *GRPCClient) ChannelScores(ctx context.Context) (map[string]any, error) {
	// Get channels and forwarding history, compute scores
	chResp, err := c.lightning.ListChannels(ctx, &lnrpc.ListChannelsRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}

	// Get 7-day forwarding history
	now := time.Now()
	weekAgo := now.Add(-7 * 24 * time.Hour)
	fwdResp, err := c.lightning.ForwardingHistory(ctx, &lnrpc.ForwardingHistoryRequest{
		StartTime: uint64(weekAgo.Unix()),
		EndTime:   uint64(now.Unix()),
	}, c.macaroons.Readonly)
	if err != nil {
		return nil, fmt.Errorf("forwarding history: %w", err)
	}

	// Count forwards per channel
	fwdCount := map[uint64]int64{}
	fwdVolume := map[uint64]int64{}
	for _, e := range fwdResp.ForwardingEvents {
		fwdCount[e.ChanIdIn]++
		fwdCount[e.ChanIdOut]++
		fwdVolume[e.ChanIdIn] += int64(e.AmtIn)
		fwdVolume[e.ChanIdOut] += int64(e.AmtOut)
	}

	scores := make([]map[string]any, 0, len(chResp.Channels))
	for _, ch := range chResp.Channels {
		// Balance score: best when 50/50
		localRatio := float64(ch.LocalBalance) / float64(ch.Capacity)
		balanceScore := 1.0 - 2.0*abs(localRatio-0.5)

		// Activity score: based on forwards this week
		forwards := fwdCount[ch.ChanId]
		activityScore := min(float64(forwards)/20.0, 1.0) // 20+ forwards = 1.0

		// Uptime score
		uptimeScore := 0.0
		if ch.Lifetime > 0 {
			uptimeScore = float64(ch.Uptime) / float64(ch.Lifetime)
		}

		// Overall health
		health := balanceScore*0.35 + activityScore*0.35 + uptimeScore*0.30

		recommendation := "hold"
		if health < 0.3 {
			recommendation = "review for closure"
		} else if balanceScore < 0.2 {
			recommendation = "rebalance"
		}

		scores = append(scores, map[string]any{
			"chan_id":        ch.ChanId,
			"remote_pubkey":  ch.RemotePubkey,
			"capacity":       ch.Capacity,
			"local_balance":  ch.LocalBalance,
			"health_score":   int(health * 100),
			"balance_score":  int(balanceScore * 100),
			"activity_score": int(activityScore * 100),
			"uptime_score":   int(uptimeScore * 100),
			"forwards_7d":    forwards,
			"volume_7d":      fwdVolume[ch.ChanId],
			"recommendation": recommendation,
		})
	}

	return ok(map[string]any{
		"channels": scores,
		"count":    len(scores),
	}), nil
}

// --- Write (Analytics) ---

func (c *GRPCClient) Rebalance(ctx context.Context, req RebalanceRequest) (map[string]any, error) {
	// Build a circular payment via routerrpc
	outChanID, err := strconv.ParseUint(req.OutgoingChanID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse outgoing_chan_id: %w", err)
	}
	inChanID, err := strconv.ParseUint(req.IncomingChanID, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("parse incoming_chan_id: %w", err)
	}

	// Get our own info for the self-payment invoice
	info, err := c.lightning.GetInfo(ctx, &lnrpc.GetInfoRequest{}, c.macaroons.Readonly)
	if err != nil {
		return nil, fmt.Errorf("get own info: %w", err)
	}

	// Create self-invoice for rebalance amount
	inv, err := c.lightning.AddInvoice(ctx, &lnrpc.Invoice{
		Value:  req.AmountSats,
		Memo:   "circular rebalance",
		Expiry: 300,
	}, c.macaroons.Invoice)
	if err != nil {
		return nil, fmt.Errorf("create rebalance invoice: %w", err)
	}

	maxFee := req.MaxFeeSats
	if maxFee <= 0 {
		maxFee = 1000
	}

	payCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()

	stream, err := c.router.SendPaymentV2(payCtx, &routerrpc.SendPaymentRequest{
		PaymentRequest:   inv.PaymentRequest,
		FeeLimitSat:      maxFee,
		OutgoingChanIds:  []uint64{outChanID},
		LastHopPubkey:    []byte(info.IdentityPubkey),
		TimeoutSeconds:   120,
		AllowSelfPayment: true,
	}, c.macaroons.Pay)
	if err != nil {
		return nil, fmt.Errorf("send rebalance: %w", err)
	}

	_ = inChanID // Used for route hints in advanced rebalancing

	var lastPayment *lnrpc.Payment
	for {
		payment, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("rebalance stream: %w", err)
		}
		lastPayment = payment
		if payment.Status == lnrpc.Payment_SUCCEEDED || payment.Status == lnrpc.Payment_FAILED {
			break
		}
	}

	if lastPayment == nil {
		return nil, fmt.Errorf("no rebalance payment status")
	}

	if lastPayment.Status == lnrpc.Payment_FAILED {
		return map[string]any{
			"ok":    false,
			"error": "rebalance_failed",
			"data": map[string]any{
				"failure_reason": lastPayment.FailureReason.String(),
			},
		}, nil
	}

	return ok(map[string]any{
		"status":       lastPayment.Status.String(),
		"amount_sats":  req.AmountSats,
		"fee_sat":      lastPayment.FeeSat,
		"fee_msat":     lastPayment.FeeMsat,
		"payment_hash": lastPayment.PaymentHash,
	}), nil
}

func (c *GRPCClient) UpdateChannelPolicy(ctx context.Context, req UpdatePolicyRequest) (map[string]any, error) {
	timeLockDelta := uint32(40) // LND default
	if req.TimeLockDelta > 0 {
		timeLockDelta = req.TimeLockDelta
	}

	policyReq := &lnrpc.PolicyUpdateRequest{
		BaseFeeMsat:   req.BaseFeeMsat,
		FeeRatePpm:    uint32(req.FeeRatePPM),
		TimeLockDelta: timeLockDelta,
	}

	if req.ChanID != "" {
		// Update specific channel
		parts := strings.SplitN(req.ChanID, ":", 2)
		if len(parts) == 2 {
			idx, _ := strconv.ParseUint(parts[1], 10, 32)
			policyReq.Scope = &lnrpc.PolicyUpdateRequest_ChanPoint{
				ChanPoint: &lnrpc.ChannelPoint{
					FundingTxid: &lnrpc.ChannelPoint_FundingTxidStr{
						FundingTxidStr: parts[0],
					},
					OutputIndex: uint32(idx),
				},
			}
		}
	} else {
		policyReq.Scope = &lnrpc.PolicyUpdateRequest_Global{Global: true}
	}

	resp, err := c.lightning.UpdateChannelPolicy(ctx, policyReq, c.macaroons.ChannelAdmin)
	if err != nil {
		return nil, err
	}

	target := "all channels"
	if req.ChanID != "" {
		target = "channel " + req.ChanID
	}

	failedUpdates := make([]map[string]any, 0)
	for _, fu := range resp.FailedUpdates {
		failedUpdates = append(failedUpdates, map[string]any{
			"reason": fu.UpdateError,
		})
	}

	return ok(map[string]any{
		"message":        "fees updated for " + target,
		"base_fee_msat":  req.BaseFeeMsat,
		"fee_rate_ppm":   req.FeeRatePPM,
		"failed_updates": failedUpdates,
	}), nil
}

// --- Helpers ---

func ok(data map[string]any) map[string]any {
	return map[string]any{
		"ok":   true,
		"data": data,
	}
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
