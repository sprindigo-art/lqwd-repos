package handlers

import (
	"net/http"
	"testing"
)

// --- FeeReport tests ---

func TestFeeReport_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.FeeReport, map[string]any{})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	if resp["ok"] != true {
		t.Fatal("expected ok=true")
	}
	data := resp["data"].(map[string]any)
	if data["channel_fees"] == nil {
		t.Fatal("expected channel_fees in response")
	}
}

// --- GraphNodeInfo tests ---

func TestGraphNodeInfo_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.GraphNodeInfo, map[string]any{
		"pub_key":          "03peer1aaaaabbbbbbccccccddddddeeeeeefffff00000011111122222233333344",
		"include_channels": true,
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	data := resp["data"].(map[string]any)
	if data["node"] == nil {
		t.Fatal("expected node in response")
	}
	if data["channels"] == nil {
		t.Fatal("expected channels when include_channels=true")
	}
}

func TestGraphNodeInfo_MissingPubKey(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.GraphNodeInfo, map[string]any{})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// --- GraphChannelInfo tests ---

func TestGraphChannelInfo_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.GraphChannelInfo, map[string]any{
		"chan_id": "850000000000000001",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	data := resp["data"].(map[string]any)
	if data["node1_policy"] == nil || data["node2_policy"] == nil {
		t.Fatal("expected node policies in response")
	}
}

func TestGraphChannelInfo_MissingChanID(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.GraphChannelInfo, map[string]any{})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// --- ChannelScores tests ---

func TestChannelScores_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.ChannelScores, map[string]any{})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	resp := decodeResp(t, w)
	data := resp["data"].(map[string]any)
	if data["scores"] == nil {
		t.Fatal("expected scores in response")
	}
	if data["average_health"] == nil {
		t.Fatal("expected average_health in response")
	}
}

// --- Rebalance tests ---

// As of Phase 16.2, Rebalance requires admin confirmation: the handler now
// returns 202 Accepted with an operation_id instead of executing immediately.
// Regression guard: if anyone reverts this to synchronous execution, the LLM
// prompt-injection path to drain up to MaxRebalanceFeeSats per call returns.
func TestRebalance_RequiresConfirmation(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.Rebalance, map[string]any{
		"outgoing_chan_id": "850000000000000001",
		"incoming_chan_id": "850000000000000002",
		"amount_sats":     500_000,
		"max_fee_sats":    500,
		"idempotency_key": "test-reb-1",
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
	if deps.Confirm.Count() != 1 {
		t.Fatalf("expected 1 pending confirmation, got %d", deps.Confirm.Count())
	}
}

func TestRebalance_BudgetExceeded(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.Rebalance, map[string]any{
		"outgoing_chan_id": "850000000000000001",
		"incoming_chan_id": "850000000000000002",
		"amount_sats":     500_000,
		"max_fee_sats":    50_000, // exceeds 10,000 rebalance fee limit
		"idempotency_key": "test-reb-exceed",
	})

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRebalance_MissingFields(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.Rebalance, map[string]any{
		"outgoing_chan_id": "850000000000000001",
	})
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestRebalance_Idempotency(t *testing.T) {
	deps := newTestDeps(t)
	body := map[string]any{
		"outgoing_chan_id": "850000000000000001",
		"incoming_chan_id": "850000000000000002",
		"amount_sats":     500_000,
		"max_fee_sats":    500,
		"idempotency_key": "test-reb-idemp",
	}
	w1 := postJSON(deps.Rebalance, body)
	w2 := postJSON(deps.Rebalance, body)

	if w2.Header().Get("X-Idempotent-Replay") != "true" {
		t.Fatal("expected idempotent replay on second call")
	}
	if w1.Code != w2.Code {
		t.Fatalf("status codes should match: %d vs %d", w1.Code, w2.Code)
	}
	// First call must be 202 Accepted — Rebalance is confirmation-gated.
	if w1.Code != http.StatusAccepted {
		t.Fatalf("first call expected 202, got %d", w1.Code)
	}
}

// --- UpdateChannelFees tests ---

func TestUpdateChannelFees_MockSuccess(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.UpdateChannelFees, map[string]any{
		"chan_id":        "850000000000000001",
		"base_fee_msat": 1000,
		"fee_rate_ppm":  150,
		"idempotency_key": "test-fees-1",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateChannelFees_AllChannels(t *testing.T) {
	deps := newTestDeps(t)
	w := postJSON(deps.UpdateChannelFees, map[string]any{
		"base_fee_msat":    500,
		"fee_rate_ppm":     100,
		"idempotency_key":  "test-fees-all",
	})

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}
