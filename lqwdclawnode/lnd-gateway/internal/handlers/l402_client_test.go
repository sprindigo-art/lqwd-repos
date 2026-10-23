package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// mockLNDForL402 implements lnd.Client with only SendPayment wired.
// All other methods panic if called (tests only exercise SendPayment).
type mockLNDForL402 struct {
	lnd.Client // embed interface for unimplemented methods
	sendPaymentFunc func(ctx context.Context, req lnd.SendPaymentRequest) (map[string]any, error)
}

func (m *mockLNDForL402) SendPayment(ctx context.Context, req lnd.SendPaymentRequest) (map[string]any, error) {
	return m.sendPaymentFunc(ctx, req)
}

// TestL402HTTPClientTransportBounds verifies the package-level HTTP client has
// bounded Transport settings (HTTP-03, decisions D-07/D-08/D-09).
func TestL402HTTPClientTransportBounds(t *testing.T) {
	transport, ok := l402HTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatal("l402HTTPClient.Transport is not *http.Transport")
	}
	if transport.MaxIdleConns != 10 {
		t.Errorf("MaxIdleConns = %d, want 10", transport.MaxIdleConns)
	}
	if transport.MaxConnsPerHost != 5 {
		t.Errorf("MaxConnsPerHost = %d, want 5", transport.MaxConnsPerHost)
	}
	if transport.IdleConnTimeout != 90*time.Second {
		t.Errorf("IdleConnTimeout = %v, want 90s", transport.IdleConnTimeout)
	}
}

// TestL402PayContextPropagation verifies that a cancelled caller context
// propagates to the initial HTTP fetch, causing it to fail (HTTP-01, D-01/D-02/D-03).
func TestL402PayContextPropagation(t *testing.T) {
	// Upstream blocks until the request context is cancelled
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	deps := newTestDeps(t)
	deps.MockMode = false
	deps.LND = &mockLNDForL402{} // should never be called

	ld := &L402Deps{
		Deps:     deps,
		MockMode: false,
	}

	// Create a pre-cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	req := httptest.NewRequest("POST", "/v1/l402/pay", nil)
	req = req.WithContext(ctx)

	result, err := ld.executeL402Fetch(req, L402PayRequest{
		URL:     upstream.URL,
		MaxSats: 100,
	})

	if err == nil {
		t.Fatal("expected error from cancelled context, got nil")
	}
	if result != nil {
		t.Fatalf("expected nil result, got %+v", result)
	}
	if !strings.Contains(err.Error(), "context canceled") {
		t.Errorf("error should contain 'context canceled', got: %s", err.Error())
	}
}

// TestL402PayUpstreamFailureReceipt verifies that when upstream returns non-200
// after payment, the error includes the preimage and the result Body JSON
// contains a receipt with preimage (HTTP-02, D-04/D-05/D-06).
func TestL402PayUpstreamFailureReceipt(t *testing.T) {
	var callCount atomic.Int32

	// Mock upstream: first call returns 402 challenge, second returns 502
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := callCount.Add(1)
		if n == 1 {
			// 402 challenge
			w.Header().Set("WWW-Authenticate", `L402 macaroon="test_mac", invoice="lnbc_test"`)
			w.WriteHeader(http.StatusPaymentRequired)
			json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"invoice":      "lnbc_test",
					"amount_sats":  5,
					"macaroon":     "test_mac",
					"payment_hash": "test_hash",
				},
			})
			return
		}
		// Subsequent calls: upstream failure after payment
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprint(w, `{"error":"internal"}`)
	}))
	defer upstream.Close()

	deps := newTestDeps(t)
	deps.MockMode = false
	deps.LND = &mockLNDForL402{
		sendPaymentFunc: func(ctx context.Context, req lnd.SendPaymentRequest) (map[string]any, error) {
			return map[string]any{
				"data": map[string]any{
					"payment_preimage": "test_preimage_abc123",
				},
			}, nil
		},
	}

	ld := &L402Deps{
		Deps:     deps,
		MockMode: false,
	}

	req := httptest.NewRequest("POST", "/v1/l402/pay", nil)
	result, err := ld.executeL402Fetch(req, L402PayRequest{
		URL:     upstream.URL,
		MaxSats: 100,
	})

	// Error must exist and contain preimage + status code
	if err == nil {
		t.Fatal("expected error for upstream 502, got nil")
	}
	if !strings.Contains(err.Error(), "test_preimage_abc123") {
		t.Errorf("error should contain preimage, got: %s", err.Error())
	}
	if !strings.Contains(err.Error(), "502") {
		t.Errorf("error should contain status code 502, got: %s", err.Error())
	}

	// Result must exist with receipt data
	if result == nil {
		t.Fatal("expected non-nil result with receipt")
	}
	if result.PaidSats != 5 {
		t.Errorf("PaidSats = %d, want 5", result.PaidSats)
	}
	if result.PaymentHash != "test_hash" {
		t.Errorf("PaymentHash = %q, want test_hash", result.PaymentHash)
	}

	// Body JSON must contain preimage in receipt
	if !strings.Contains(result.Body, "preimage") {
		t.Errorf("Body should contain 'preimage' key, got: %s", result.Body)
	}
	if !strings.Contains(result.Body, "test_preimage_abc123") {
		t.Errorf("Body should contain preimage value, got: %s", result.Body)
	}
}

// TestL402Pay_RequestID verifies that outbound L402 client HTTP requests carry
// the X-Request-ID header from the inbound request context (OBS-01d per D-14).
func TestL402Pay_RequestID(t *testing.T) {
	var capturedRequestID string

	// Mock upstream: returns a simple 200 JSON (no 402 challenge — just test header propagation)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedRequestID = r.Header.Get("X-Request-ID")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer upstream.Close()

	deps := newTestDeps(t)
	deps.MockMode = false
	deps.LND = &mockLNDForL402{} // should not be called for non-402

	ld := &L402Deps{
		Deps:     deps,
		MockMode: false,
	}

	// Build request with known request ID in context
	body, _ := json.Marshal(L402PayRequest{
		URL:     upstream.URL,
		MaxSats: 100,
	})
	req := httptest.NewRequest("POST", "/v1/l402/pay", bytes.NewReader(body))
	ctx := middleware.SetRequestID(req.Context(), "trace-l402-xyz")
	ctx = middleware.SetTokenLevel(ctx, middleware.TokenAgent)
	req = req.WithContext(ctx)
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	ld.L402Pay(w, req)

	if capturedRequestID != "trace-l402-xyz" {
		t.Fatalf("expected outbound X-Request-ID='trace-l402-xyz', got %q", capturedRequestID)
	}
}
