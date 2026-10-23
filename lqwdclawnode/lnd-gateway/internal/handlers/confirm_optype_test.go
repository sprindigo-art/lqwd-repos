package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

func TestEndpointToOpType(t *testing.T) {
	cases := []struct {
		endpoint string
		want     string
	}{
		{"/v1/payments/send", "payment"},
		{"/v1/channels/open", "channel_open"},
		{"/v1/channels/close", "channel_close"},
		{"/v1/onchain/send", "onchain_send"},
		{"/v1/rebalance", "rebalance"},
		{"/v1/unknown", ""},
		{"", ""},
	}
	for _, tc := range cases {
		if got := endpointToOpType(tc.endpoint); got != tc.want {
			t.Errorf("endpointToOpType(%q) = %q, want %q", tc.endpoint, got, tc.want)
		}
	}
}

// TestConfirmOperation_WritesCanonicalOpType verifies that when a confirmation
// is executed (mock mode), the audit entry's op_type is one of the canonical
// values recognized by DailySpend — not the prior "confirmed_/v1/..." form that
// silently excluded all confirmed ops from the daily spend ledger.
func TestConfirmOperation_WritesCanonicalOpType(t *testing.T) {
	cases := []struct {
		name         string
		endpoint     string
		wantOpType   string
		amountSats   int64
	}{
		{"payment", "/v1/payments/send", "payment", 1500},
		{"channel_open", "/v1/channels/open", "channel_open", 500000},
		{"channel_close", "/v1/channels/close", "channel_close", 0},
		{"onchain_send", "/v1/onchain/send", "onchain_send", 100000},
		{"rebalance", "/v1/rebalance", "rebalance", 10000},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			deps := newTestDeps(t)
			op := deps.Confirm.Create(tc.endpoint, "desc", `{}`, tc.amountSats)

			body, _ := json.Marshal(map[string]string{"operation_id": op.ID})
			req := httptest.NewRequest("POST", "/v1/confirm", bytes.NewReader(body))
			ctx := middleware.SetTokenLevel(req.Context(), middleware.TokenAdmin)
			ctx = middleware.SetRequestID(ctx, "rid")
			req = req.WithContext(ctx)
			w := httptest.NewRecorder()

			deps.ConfirmOperation(w, req)

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
			}

			entries, err := deps.Audit.Query(audit.QueryFilter{OpType: tc.wantOpType, Limit: 10})
			if err != nil {
				t.Fatalf("audit.Query: %v", err)
			}
			if len(entries) == 0 {
				t.Fatalf("no audit entry with op_type=%q found after confirm of %s", tc.wantOpType, tc.endpoint)
			}
			found := false
			for _, e := range entries {
				if e.ResponseCode == http.StatusOK && e.AmountSats == tc.amountSats {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("no 200 audit entry with amount=%d and op_type=%q; got %d entries", tc.amountSats, tc.wantOpType, len(entries))
			}
		})
	}
}

// TestConfirmOperation_DailySpendIncludesConfirmedPayments is the end-to-end
// regression: a confirmed payment must show up in DailySpend. Before the fix,
// this returned zero because op_type was "confirmed_/v1/payments/send" which
// was not in the DailySpend IN (...) filter.
func TestConfirmOperation_DailySpendIncludesConfirmedPayments(t *testing.T) {
	deps := newTestDeps(t)
	op := deps.Confirm.Create("/v1/payments/send", "pay 2000 sat", `{}`, 2000)

	body, _ := json.Marshal(map[string]string{"operation_id": op.ID})
	req := httptest.NewRequest("POST", "/v1/confirm", bytes.NewReader(body))
	ctx := middleware.SetTokenLevel(req.Context(), middleware.TokenAdmin)
	ctx = middleware.SetRequestID(ctx, "rid")
	req = req.WithContext(ctx)
	w := httptest.NewRecorder()

	deps.ConfirmOperation(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}

	spend, err := deps.Audit.DailySpend()
	if err != nil {
		t.Fatalf("DailySpend: %v", err)
	}
	if spend != 2000 {
		t.Fatalf("DailySpend = %d, want 2000 (confirmed payment should be counted)", spend)
	}
}
