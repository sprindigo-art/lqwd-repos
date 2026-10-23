package accounts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/handlers"
)

// setupProxyTest creates a ProxyHandlers with a MockStore, a registered agent, and the raw API key.
func setupProxyTest(t *testing.T) (*ProxyHandlers, *MockStore, *Agent, string) {
	t.Helper()
	store := NewMockStore()
	agent, rawKey, err := store.Register(context.Background(), "test-agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	deps := &handlers.Dependencies{MockMode: true}
	ph := &ProxyHandlers{Store: store, Deps: deps, Price: 10, Timeout: 30 * time.Second}
	return ph, store, agent, rawKey
}

// proxyRequest builds an HTTP request with the agent in context, auth header, and idempotency key.
func proxyRequest(t *testing.T, method, path string, agent *Agent, rawKey, idempKey string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(method, path, nil)
	ctx := SetAgent(r.Context(), agent)
	r = r.WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+rawKey)
	if idempKey != "" {
		r.Header.Set("X-Idempotency-Key", idempKey)
	}
	return r
}

// parseBody decodes a JSON response body into a map.
func parseBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	return body
}

// TestProxyNodeStats verifies PROX-01: successful proxy call debits credits.
func TestProxyNodeStats(t *testing.T) {
	ph, store, agent, rawKey := setupProxyTest(t)
	idempKey := uuid.New().String()
	r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec := httptest.NewRecorder()

	ph.NodeStats(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseBody(t, rec)
	if body["ok"] != true {
		t.Errorf("expected ok=true, got %v", body["ok"])
	}

	// Verify balance: 150 (grant) - 10 (debit) = 140
	profile, err := store.Profile(context.Background(), agent.ID)
	if err != nil {
		t.Fatalf("profile: %v", err)
	}
	if profile.BalanceSats != 140 {
		t.Errorf("expected balance 140, got %d", profile.BalanceSats)
	}
}

// TestProxyInsufficientCredits verifies PROX-01: 402 when balance too low.
func TestProxyInsufficientCredits(t *testing.T) {
	store := NewMockStore()
	agent, rawKey, _ := store.Register(context.Background(), "poor-agent", "127.0.0.1")

	// Manually drain credits to leave only 5 sats (below price of 10)
	store.mu.Lock()
	store.credits[agent.ID] = append(store.credits[agent.ID], creditEntry{
		ID:          uuid.New().String(),
		AmountSats:  -145,
		TxType:      "debit",
		Description: "test drain",
		Status:      "settled",
		CreatedAt:   time.Now().Add(-25 * time.Hour), // yesterday — doesn't count against daily cap
	})
	store.mu.Unlock()

	deps := &handlers.Dependencies{MockMode: true}
	ph := &ProxyHandlers{Store: store, Deps: deps, Price: 10, Timeout: 30 * time.Second}

	idempKey := uuid.New().String()
	r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec := httptest.NewRecorder()
	ph.NodeStats(rec, r)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseBody(t, rec)
	if body["error"] != "insufficient_credits" {
		t.Errorf("expected error=insufficient_credits, got %v", body["error"])
	}
}

// TestProxySpendCapExceeded verifies PROX-01: 402 when daily spend cap reached.
func TestProxySpendCapExceeded(t *testing.T) {
	ph, _, agent, rawKey := setupProxyTest(t)

	// Tier 1 cap = 100 sats. At 10 sats/call, 10 calls = 100 sats = cap.
	for i := 0; i < 10; i++ {
		idempKey := uuid.New().String()
		r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
		rec := httptest.NewRecorder()
		ph.NodeStats(rec, r)
		if rec.Code != http.StatusOK {
			t.Fatalf("call %d: expected 200, got %d: %s", i+1, rec.Code, rec.Body.String())
		}
	}

	// 11th call should fail with spend cap exceeded
	idempKey := uuid.New().String()
	r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec := httptest.NewRecorder()
	ph.NodeStats(rec, r)

	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseBody(t, rec)
	if body["error"] != "spend_cap_exceeded" {
		t.Errorf("expected error=spend_cap_exceeded, got %v", body["error"])
	}
}

// TestReserveSettleFlow verifies PROX-02: debit entry created, no reserve remains.
func TestReserveSettleFlow(t *testing.T) {
	ph, store, agent, rawKey := setupProxyTest(t)
	idempKey := uuid.New().String()
	r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec := httptest.NewRecorder()

	ph.NodeStats(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Check transactions: should have a debit, no reserve
	entries, _, err := store.Transactions(context.Background(), agent.ID, "", 100)
	if err != nil {
		t.Fatalf("transactions: %v", err)
	}

	var hasDebit, hasReserve bool
	for _, e := range entries {
		if e.TxType == "debit" {
			hasDebit = true
		}
		if e.TxType == "reserve" {
			hasReserve = true
		}
	}
	if !hasDebit {
		t.Error("expected debit transaction after settle")
	}
	if hasReserve {
		t.Error("expected no reserve transactions after settle")
	}
}

// TestProxyUpstreamFailureRefund verifies PROX-02: refund on upstream 500.
func TestProxyUpstreamFailureRefund(t *testing.T) {
	store := NewMockStore()
	agent, rawKey, _ := store.Register(context.Background(), "test-agent", "127.0.0.1")
	deps := &handlers.Dependencies{MockMode: true}

	// Custom fetch that returns 500
	failFetch := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"ok":false,"error":"boom"}`))
	}

	ph := &ProxyHandlers{Store: store, Deps: deps, Price: 10, Timeout: 30 * time.Second}

	idempKey := uuid.New().String()
	r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec := httptest.NewRecorder()

	ph.handleProxy(rec, r, "node-stats", failFetch)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseBody(t, rec)
	if body["error"] != "upstream_failure" {
		t.Errorf("expected error=upstream_failure, got %v", body["error"])
	}
	details, _ := body["details"].(map[string]any)
	if details["credits_refunded"] != true {
		t.Error("expected credits_refunded=true")
	}

	// Balance should be unchanged (150 sats)
	profile, _ := store.Profile(context.Background(), agent.ID)
	if profile.BalanceSats != DefaultTier1GrantSats {
		t.Errorf("expected balance %d after refund, got %d", DefaultTier1GrantSats, profile.BalanceSats)
	}
}

// TestProxyTimeoutRefund verifies PROX-02: refund when upstream times out.
func TestProxyTimeoutRefund(t *testing.T) {
	store := NewMockStore()
	agent, rawKey, _ := store.Register(context.Background(), "test-agent", "127.0.0.1")
	deps := &handlers.Dependencies{MockMode: true}

	// Slow fetch that exceeds the timeout
	slowFetch := func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			// Context cancelled — write 504 to simulate gateway timeout
			w.WriteHeader(http.StatusGatewayTimeout)
		case <-time.After(5 * time.Second):
			w.WriteHeader(http.StatusOK)
		}
	}

	// Very short timeout to trigger
	ph := &ProxyHandlers{Store: store, Deps: deps, Price: 10, Timeout: 1 * time.Millisecond}

	idempKey := uuid.New().String()
	r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec := httptest.NewRecorder()

	ph.handleProxy(rec, r, "node-stats", slowFetch)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", rec.Code, rec.Body.String())
	}

	// Balance should be unchanged (150 sats)
	profile, _ := store.Profile(context.Background(), agent.ID)
	if profile.BalanceSats != DefaultTier1GrantSats {
		t.Errorf("expected balance %d after timeout refund, got %d", DefaultTier1GrantSats, profile.BalanceSats)
	}
}

// TestProxyIdempotencyReplay verifies PROX-03: replay returns cached response, debits only once.
func TestProxyIdempotencyReplay(t *testing.T) {
	ph, store, agent, rawKey := setupProxyTest(t)
	idempKey := uuid.New().String()

	// First call
	r1 := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec1 := httptest.NewRecorder()
	ph.NodeStats(rec1, r1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first call: expected 200, got %d", rec1.Code)
	}

	// Second call with same idempotency key
	r2 := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec2 := httptest.NewRecorder()
	ph.NodeStats(rec2, r2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("replay call: expected 200, got %d: %s", rec2.Code, rec2.Body.String())
	}

	// Should have replay header
	if rec2.Header().Get("X-Idempotency-Replay") != "true" {
		t.Error("expected X-Idempotency-Replay: true on replay")
	}

	// Balance should reflect only one debit: 150 - 10 = 140
	profile, _ := store.Profile(context.Background(), agent.ID)
	if profile.BalanceSats != 140 {
		t.Errorf("expected balance 140 (debited once), got %d", profile.BalanceSats)
	}
}

// TestProxyMissingIdempotencyKey verifies PROX-03: 400 when header is missing.
func TestProxyMissingIdempotencyKey(t *testing.T) {
	ph, _, agent, rawKey := setupProxyTest(t)

	// Request without X-Idempotency-Key
	r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, "")
	rec := httptest.NewRecorder()
	ph.NodeStats(rec, r)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	body := parseBody(t, rec)
	if body["error"] != "missing_idempotency_key" {
		t.Errorf("expected error=missing_idempotency_key, got %v", body["error"])
	}
}

// TestProxyRequestID verifies PROX-04: X-Request-ID is present and a valid UUID.
func TestProxyRequestID(t *testing.T) {
	ph, _, agent, rawKey := setupProxyTest(t)
	idempKey := uuid.New().String()

	r := proxyRequest(t, "POST", "/v1/internal/proxy/node-stats", agent, rawKey, idempKey)
	rec := httptest.NewRecorder()
	ph.NodeStats(rec, r)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	reqID := rec.Header().Get("X-Request-ID")
	if reqID == "" {
		t.Fatal("expected X-Request-ID header to be set")
	}
	if _, err := uuid.Parse(reqID); err != nil {
		t.Errorf("X-Request-ID is not a valid UUID: %s", reqID)
	}
}
