package lnd

import (
	"context"
	"encoding/json"
	"testing"
)

// fakeClient records calls for testing the executor routing.
type fakeClient struct {
	lastMethod string
	lastReq    any
}

func (f *fakeClient) GetInfo(context.Context) (map[string]any, error)         { return nil, nil }
func (f *fakeClient) WalletBalance(context.Context) (map[string]any, error)   { return nil, nil }
func (f *fakeClient) ChannelBalance(context.Context) (map[string]any, error)  { return nil, nil }
func (f *fakeClient) ListChannels(context.Context) (map[string]any, error)    { return nil, nil }
func (f *fakeClient) PendingChannels(context.Context) (map[string]any, error) { return nil, nil }
func (f *fakeClient) ListPeers(context.Context) (map[string]any, error)       { return nil, nil }
func (f *fakeClient) ClosedChannels(context.Context) (map[string]any, error)  { return nil, nil }
func (f *fakeClient) ListTransactions(context.Context) (map[string]any, error) { return nil, nil }
func (f *fakeClient) FeeEstimate(_ context.Context, _ int32) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) ForwardingHistory(_ context.Context, _, _ uint64) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) FeeReport(context.Context) (map[string]any, error) { return nil, nil }
func (f *fakeClient) GetNodeInfo(_ context.Context, _ string, _ bool) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) GetChanInfo(_ context.Context, _ uint64) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) ChannelScores(context.Context) (map[string]any, error)           { return nil, nil }
func (f *fakeClient) ConnectPeer(_ context.Context, _, _ string) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) DisconnectPeer(_ context.Context, _ string) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) LookupInvoice(_ context.Context, _ string) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) NewAddress(_ context.Context, _ string) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) Rebalance(_ context.Context, _ RebalanceRequest) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) UpdateChannelPolicy(_ context.Context, _ UpdatePolicyRequest) (map[string]any, error) {
	return nil, nil
}
func (f *fakeClient) Close() error { return nil }

func (f *fakeClient) OpenChannel(_ context.Context, req OpenChannelRequest) (map[string]any, error) {
	f.lastMethod = "OpenChannel"
	f.lastReq = req
	return ok(map[string]any{"routed": true}), nil
}

func (f *fakeClient) CloseChannel(_ context.Context, req CloseChannelRequest) (map[string]any, error) {
	f.lastMethod = "CloseChannel"
	f.lastReq = req
	return ok(map[string]any{"routed": true}), nil
}

func (f *fakeClient) SendPayment(_ context.Context, req SendPaymentRequest) (map[string]any, error) {
	f.lastMethod = "SendPayment"
	f.lastReq = req
	return ok(map[string]any{"routed": true}), nil
}

func (f *fakeClient) CreateInvoice(_ context.Context, req CreateInvoiceRequest) (map[string]any, error) {
	f.lastMethod = "CreateInvoice"
	f.lastReq = req
	return ok(map[string]any{"routed": true}), nil
}

func (f *fakeClient) SendCoins(_ context.Context, req SendCoinsRequest) (map[string]any, error) {
	f.lastMethod = "SendCoins"
	f.lastReq = req
	return ok(map[string]any{"routed": true}), nil
}

// Ensure fakeClient implements Client
var _ Client = (*fakeClient)(nil)

func TestExecutor_OpenChannel(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	body, _ := json.Marshal(OpenChannelRequest{
		NodePubkey:         "02aabb",
		LocalFundingAmount: 500000,
	})

	resp, err := exec.Execute(context.Background(), "/v1/channels/open", string(body))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if fc.lastMethod != "OpenChannel" {
		t.Fatalf("expected OpenChannel, got %s", fc.lastMethod)
	}
	if resp["ok"] != true {
		t.Fatal("expected ok=true")
	}
}

func TestExecutor_CloseChannel(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	body, _ := json.Marshal(CloseChannelRequest{
		ChannelPoint: "abc:0",
		Force:        false,
	})

	_, err := exec.Execute(context.Background(), "/v1/channels/close", string(body))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if fc.lastMethod != "CloseChannel" {
		t.Fatalf("expected CloseChannel, got %s", fc.lastMethod)
	}
}

func TestExecutor_SendCoins(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	body, _ := json.Marshal(SendCoinsRequest{
		Addr:   "bc1qtest",
		Amount: 100000,
	})

	_, err := exec.Execute(context.Background(), "/v1/onchain/send", string(body))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if fc.lastMethod != "SendCoins" {
		t.Fatalf("expected SendCoins, got %s", fc.lastMethod)
	}
}

func TestExecutor_SendPayment(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	body, _ := json.Marshal(SendPaymentRequest{
		PaymentRequest: "lnbc1...",
		AmountSats:     1000,
	})

	_, err := exec.Execute(context.Background(), "/v1/payments/send", string(body))
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if fc.lastMethod != "SendPayment" {
		t.Fatalf("expected SendPayment, got %s", fc.lastMethod)
	}
}

func TestExecutor_UnknownEndpoint(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	_, err := exec.Execute(context.Background(), "/v1/nonexistent", "{}")
	if err == nil {
		t.Fatal("expected error for unknown endpoint")
	}
}

// The following tests replay the exact JSON shape that handlers/write.go
// serializes into the confirmation RequestBody. If the JSON tags on
// OpenChannelRequest / CloseChannelRequest / SendCoinsRequest / SendPaymentRequest
// drift from the public handler API, these will catch it — the previous
// Executor tests missed the bug because they marshalled and unmarshalled
// the same type.

func TestExecutor_HandlerShape_OpenChannel_PreservesPushSats(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	// Exactly what handlers.OpenChannel marshals (see internal/handlers/write.go).
	handlerBody := `{"node_pubkey":"02aabb","local_funding_amount":500000,"push_sats":25000,"target_conf":6,"sat_per_vbyte":10,"private":false,"idempotency_key":"k"}`

	_, err := exec.Execute(context.Background(), "/v1/channels/open", handlerBody)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	got, ok := fc.lastReq.(OpenChannelRequest)
	if !ok {
		t.Fatalf("last req wrong type: %T", fc.lastReq)
	}
	if got.PushSat != 25000 {
		t.Fatalf("push_sats lost: expected 25000, got %d", got.PushSat)
	}
	if got.NodePubkey != "02aabb" {
		t.Fatalf("node_pubkey lost: got %q", got.NodePubkey)
	}
	if got.LocalFundingAmount != 500000 {
		t.Fatalf("local_funding_amount lost: got %d", got.LocalFundingAmount)
	}
}

func TestExecutor_HandlerShape_CloseChannel_PreservesChanID(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	handlerBody := `{"chan_id":"txid123:0","force":true,"target_conf":6,"sat_per_vbyte":12,"idempotency_key":"k"}`

	_, err := exec.Execute(context.Background(), "/v1/channels/close", handlerBody)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	got, ok := fc.lastReq.(CloseChannelRequest)
	if !ok {
		t.Fatalf("last req wrong type: %T", fc.lastReq)
	}
	if got.ChannelPoint != "txid123:0" {
		t.Fatalf("chan_id lost: expected txid123:0, got %q", got.ChannelPoint)
	}
	if !got.Force {
		t.Fatal("force lost")
	}
}

func TestExecutor_HandlerShape_SendCoins_PreservesAddressAndAmount(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	handlerBody := `{"address":"bc1qtest","amount_sats":100000,"target_conf":6,"sat_per_vbyte":8,"send_all":false,"idempotency_key":"k"}`

	_, err := exec.Execute(context.Background(), "/v1/onchain/send", handlerBody)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	got, ok := fc.lastReq.(SendCoinsRequest)
	if !ok {
		t.Fatalf("last req wrong type: %T", fc.lastReq)
	}
	if got.Addr != "bc1qtest" {
		t.Fatalf("address lost: got %q", got.Addr)
	}
	if got.Amount != 100000 {
		t.Fatalf("amount_sats lost: got %d", got.Amount)
	}
}

func TestExecutor_HandlerShape_SendPayment_PreservesAllFields(t *testing.T) {
	fc := &fakeClient{}
	exec := NewExecutor(fc)

	handlerBody := `{"payment_request":"lnbc1abc","amount_sats":1500,"timeout_seconds":60,"fee_limit_sats":50,"idempotency_key":"k"}`

	_, err := exec.Execute(context.Background(), "/v1/payments/send", handlerBody)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	got, ok := fc.lastReq.(SendPaymentRequest)
	if !ok {
		t.Fatalf("last req wrong type: %T", fc.lastReq)
	}
	if got.PaymentRequest != "lnbc1abc" {
		t.Fatalf("payment_request lost: got %q", got.PaymentRequest)
	}
	if got.AmountSats != 1500 {
		t.Fatalf("amount_sats lost: got %d", got.AmountSats)
	}
	if got.TimeoutSeconds != 60 {
		t.Fatalf("timeout_seconds lost: got %d", got.TimeoutSeconds)
	}
	if got.FeeLimitSat != 50 {
		t.Fatalf("fee_limit_sats lost: got %d", got.FeeLimitSat)
	}
}
