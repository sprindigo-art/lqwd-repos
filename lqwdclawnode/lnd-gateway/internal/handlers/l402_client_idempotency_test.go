package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// TestL402Pay_MockMode_StoresIdempotencyResponse is the regression guard for
// REVIEW-CODE-GATEWAY.md CR-04. Before Phase 16.2, L402Pay's mock-mode success
// path returned 200 without calling Idempotency.Store(), so the pending
// reservation kept status_code=0. Any retry within 24h saw the pending row
// and got 409 "duplicate request in progress" — a paid-but-unrecoverable
// state the caller could not escape.
func TestL402Pay_MockMode_StoresIdempotencyResponse(t *testing.T) {
	deps := newTestDeps(t)
	deps.MockMode = true

	ld := &L402Deps{Deps: deps, MockMode: true}

	body := map[string]any{
		"url":             "https://example.com/paid",
		"max_sats":        100,
		"idempotency_key": "l402-dup-1",
	}

	// First request — should succeed with 200
	w1 := postL402Pay(t, ld, body)
	if w1.Code != http.StatusOK {
		t.Fatalf("first call: expected 200, got %d; body=%s", w1.Code, w1.Body.String())
	}

	// Second request with same idempotency key — MUST return the same 200
	// response (not a 409 "duplicate in progress" from a stuck reservation).
	w2 := postL402Pay(t, ld, body)
	if w2.Code != http.StatusOK {
		t.Fatalf("replay: expected 200, got %d; body=%s", w2.Code, w2.Body.String())
	}
	if w2.Header().Get("Content-Type") == "" {
		t.Error("replay response should have Content-Type set")
	}
	// Replays should yield byte-for-byte the stored response body.
	if w1.Body.String() != w2.Body.String() {
		t.Fatalf("replay body differs from original:\n first=%s\nsecond=%s", w1.Body.String(), w2.Body.String())
	}
}

// postL402Pay posts to L402Pay with an agent-token context, mirroring the
// production middleware chain.
func postL402Pay(t *testing.T, ld *L402Deps, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/v1/l402/pay", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	ctx := middleware.SetTokenLevel(req.Context(), middleware.TokenAgent)
	ctx = middleware.SetRequestID(ctx, "test-rid")
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()
	ld.L402Pay(w, req)
	return w
}
