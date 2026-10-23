package handlers

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/budget"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/confirm"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/idempotency"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/killswitch"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

func newTestDeps(t *testing.T) *Dependencies {
	t.Helper()
	tmpDir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))

	auditLog, err := audit.New(
		filepath.Join(tmpDir, "audit.db"),
		filepath.Join(tmpDir, "fallback.jsonl"),
		logger, nil, 0,
	)
	if err != nil {
		t.Fatal(err)
	}

	idempStore, err := idempotency.New(filepath.Join(tmpDir, "idemp.db"), logger)
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() {
		auditLog.Close()
		idempStore.Close()
	})

	return &Dependencies{
		MockMode: true,
		Audit:    auditLog,
		Budget: budget.New(budget.Limits{
			MaxChannelSizeSats:  5_000_000,
			MaxPaymentSats:      1_000_000,
			MaxRebalanceFeeSats: 10_000,
			MaxDailySpendSats:   10_000_000,
			MaxFeeRateSatVB:     100,
		}, auditLog),
		Idempotency: idempStore,
		Confirm:     confirm.New(300),
		KillSwitch:  killswitch.New(filepath.Join(tmpDir, "kill-switch")),
		StartTime:   time.Now(),
	}
}

func postJSON(handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/test", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	// Set agent token context and request ID
	ctx := middleware.SetTokenLevel(req.Context(), middleware.TokenAgent)
	ctx = middleware.SetRequestID(ctx, "test-request-id")
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	return w
}

func decodeResp(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v\nbody: %s", err, w.Body.String())
	}
	return resp
}

// --- OpenChannel tests ---

func TestOpenChannel_RequiresConfirmation(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.OpenChannel, map[string]any{
		"node_pubkey":          "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
		"local_funding_amount": 500_000,
		"idempotency_key":      "test-open-1",
	})

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["confirmation_required"] != true {
		t.Fatal("expected confirmation_required=true")
	}
	if resp["operation_id"] == nil || resp["operation_id"] == "" {
		t.Fatal("expected non-empty operation_id")
	}
}

func TestOpenChannel_BudgetExceeded(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.OpenChannel, map[string]any{
		"node_pubkey":          "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
		"local_funding_amount": 50_000_000, // exceeds 5M limit
		"idempotency_key":      "test-open-exceed",
	})

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["error"] != "budget_exceeded" {
		t.Fatalf("expected budget_exceeded error, got %v", resp["error"])
	}
}

func TestOpenChannel_Idempotency(t *testing.T) {
	deps := newTestDeps(t)
	body := map[string]any{
		"node_pubkey":          "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
		"local_funding_amount": 500_000,
		"idempotency_key":      "test-open-idemp",
	}

	// First call
	w1 := postJSON(deps.OpenChannel, body)
	if w1.Code != http.StatusAccepted {
		t.Fatalf("first call: expected 202, got %d", w1.Code)
	}
	resp1 := decodeResp(t, w1)

	// Second call with same key — should return cached
	w2 := postJSON(deps.OpenChannel, body)
	if w2.Code != http.StatusAccepted {
		t.Fatalf("second call: expected 202, got %d", w2.Code)
	}
	if w2.Header().Get("X-Idempotent-Replay") != "true" {
		t.Fatal("expected X-Idempotent-Replay header on second call")
	}
	resp2 := decodeResp(t, w2)
	if resp1["operation_id"] != resp2["operation_id"] {
		t.Fatal("idempotent replay should return same operation_id")
	}
}

func TestOpenChannel_MissingFields(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.OpenChannel, map[string]any{})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestOpenChannel_FeeRateGuard(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.OpenChannel, map[string]any{
		"node_pubkey":          "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
		"local_funding_amount": 500_000,
		"sat_per_vbyte":        200, // exceeds 100 limit
		"idempotency_key":      "test-open-feeguard",
	})

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// --- CloseChannel tests ---

func TestCloseChannel_RequiresConfirmation(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.CloseChannel, map[string]any{
		"chan_id":          "850000000000000001",
		"idempotency_key": "test-close-1",
	})

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["confirmation_required"] != true {
		t.Fatal("expected confirmation_required=true")
	}
}

// --- SendPayment tests ---

func TestSendPayment_RequiresConfirmation(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.SendPayment, map[string]any{
		"payment_request": "lnbc500u1mockpayreq",
		"amount_sats":     50_000,
		"idempotency_key": "test-pay-1",
	})

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["confirmation_required"] != true {
		t.Fatal("expected confirmation_required=true")
	}
	if resp["operation_id"] == nil || resp["operation_id"] == "" {
		t.Fatal("expected non-empty operation_id")
	}
	if resp["amount_sats"] != float64(50_000) {
		t.Fatalf("expected amount_sats=50000, got %v", resp["amount_sats"])
	}
}

func TestSendPayment_BudgetExceeded(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.SendPayment, map[string]any{
		"payment_request": "lnbc5000000u1mockpayreq",
		"amount_sats":     5_000_000, // exceeds 1M limit
		"idempotency_key": "test-pay-exceed",
	})

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSendPayment_Idempotency(t *testing.T) {
	deps := newTestDeps(t)
	body := map[string]any{
		"payment_request": "lnbc500u1mockpayreq",
		"amount_sats":     50_000,
		"idempotency_key": "test-pay-idemp",
	}
	w1 := postJSON(deps.SendPayment, body)
	if w1.Code != http.StatusAccepted {
		t.Fatalf("first call: expected 202, got %d", w1.Code)
	}
	w2 := postJSON(deps.SendPayment, body)
	if w2.Code != http.StatusAccepted {
		t.Fatalf("second call: expected 202, got %d", w2.Code)
	}

	if w2.Header().Get("X-Idempotent-Replay") != "true" {
		t.Fatal("expected idempotent replay on second call")
	}
	resp1 := decodeResp(t, w1)
	resp2 := decodeResp(t, w2)
	if resp1["operation_id"] != resp2["operation_id"] {
		t.Fatal("idempotent replay should return same operation_id")
	}
}

// --- SendOnChain tests ---

func TestSendOnChain_RequiresConfirmation(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.SendOnChain, map[string]any{
		"address":          "bc1qmock1234567890abcdef1234567890abcdef1234",
		"amount_sats":      100_000,
		"idempotency_key":  "test-onchain-1",
	})

	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["confirmation_required"] != true {
		t.Fatal("expected confirmation_required=true")
	}
}

func TestSendOnChain_BudgetExceeded(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.SendOnChain, map[string]any{
		"address":          "bc1qmock1234567890abcdef1234567890abcdef1234",
		"amount_sats":      5_000_000, // exceeds 1M payment limit
		"idempotency_key":  "test-onchain-exceed",
	})

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// --- CreateInvoice tests ---

func TestCreateInvoice_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.CreateInvoice, map[string]any{
		"amount_sats": 100_000,
		"memo":        "test invoice",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// --- LookupInvoice tests ---

func TestLookupInvoice_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.LookupInvoice, map[string]any{
		"r_hash": "mockrhash1234567890abcdef",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// --- NewAddress tests ---

func TestNewAddress_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.NewAddress, map[string]any{
		"type": "p2tr",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// --- ListTransactions tests ---

func TestListTransactions_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.ListTransactions, map[string]any{})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// --- ForwardingHistory tests ---

func TestForwardingHistory_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.ForwardingHistory, map[string]any{})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// --- ConnectPeer tests ---

func TestConnectPeer_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.ConnectPeer, map[string]any{
		"pubkey": "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
		"host":   "1.2.3.4:9735",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestConnectPeer_MissingFields(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.ConnectPeer, map[string]any{})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// --- Uniform confirmation flow test (Gap 2 coverage) ---

// TestAllWriteOps_RequireConfirmation verifies that every destructive write
// operation returns HTTP 202 Accepted with confirmation_required=true and a
// non-empty operation_id. This ensures uniform two-phase confirmation across
// all four ops: OpenChannel, CloseChannel, SendPayment, SendOnChain.
func TestAllWriteOps_RequireConfirmation(t *testing.T) {
	cases := []struct {
		name    string
		handler func(deps *Dependencies) http.HandlerFunc
		body    map[string]any
	}{
		{
			name:    "OpenChannel",
			handler: func(d *Dependencies) http.HandlerFunc { return d.OpenChannel },
			body: map[string]any{
				"node_pubkey":          "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
				"local_funding_amount": 500_000,
				"idempotency_key":      "uniform-open-1",
			},
		},
		{
			name:    "CloseChannel",
			handler: func(d *Dependencies) http.HandlerFunc { return d.CloseChannel },
			body: map[string]any{
				"chan_id":          "850000000000000001",
				"idempotency_key": "uniform-close-1",
			},
		},
		{
			name:    "SendPayment",
			handler: func(d *Dependencies) http.HandlerFunc { return d.SendPayment },
			body: map[string]any{
				"payment_request": "lnbc500u1uniformtest",
				"amount_sats":     50_000,
				"idempotency_key": "uniform-pay-1",
			},
		},
		{
			name:    "SendOnChain",
			handler: func(d *Dependencies) http.HandlerFunc { return d.SendOnChain },
			body: map[string]any{
				"address":          "bc1qmock1234567890abcdef1234567890abcdef1234",
				"amount_sats":      100_000,
				"idempotency_key":  "uniform-onchain-1",
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			deps := newTestDeps(t)
			w := postJSON(tc.handler(deps), tc.body)

			if w.Code != http.StatusAccepted {
				t.Fatalf("%s: expected HTTP 202 Accepted, got %d — body: %s",
					tc.name, w.Code, w.Body.String())
			}

			resp := decodeResp(t, w)

			if resp["confirmation_required"] != true {
				t.Errorf("%s: expected confirmation_required=true, got %v",
					tc.name, resp["confirmation_required"])
			}

			opID, _ := resp["operation_id"].(string)
			if opID == "" {
				t.Errorf("%s: expected non-empty operation_id, got %v",
					tc.name, resp["operation_id"])
			}
		})
	}
}

// --- IsWriteEndpoint tests ---

func TestIsWriteEndpoint(t *testing.T) {
	writes := []string{
		"/v1/channels/open", "/v1/channels/close",
		"/v1/payments/send", "/v1/onchain/send",
		"/v1/peers/connect", "/v1/peers/disconnect",
	}
	for _, path := range writes {
		if !IsWriteEndpoint(path) {
			t.Errorf("expected %q to be a write endpoint", path)
		}
	}

	reads := []string{"/v1/info", "/v1/channels", "/v1/peers", "/v1/fees/estimate"}
	for _, path := range reads {
		if IsWriteEndpoint(path) {
			t.Errorf("expected %q to NOT be a write endpoint", path)
		}
	}
}
