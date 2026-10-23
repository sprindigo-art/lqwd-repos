// Package lndparse unit tests. Real assertions landed in Plan 22-02; the
// Wave-0 t.Skip stubs from Plan 22-01 are retired here.
//
// TestParseChannelStateDualShape is the critical regression guard for the
// UAT-11 / UAT-12 bug class: the poller was silently falling through the
// empty-state branch when LND's response was decoded as []map[string]any
// rather than []any. We exercise both shapes here against a single fixture
// and assert identical output — any future drift fails CI loudly instead of
// leaving channels stuck pending for 16 hours.
package lndparse

import (
	"encoding/json"
	"os"
	"testing"
)

const testFundingTxID = "0000111122223333444455556677889900001111222233334444555566778899"

func loadFixture(t *testing.T, name string) map[string]any {
	t.Helper()
	b, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal %s: %v", name, err)
	}
	return m
}

// TestParseChannelStateOpen asserts that when LND's ListChannels response
// contains the target funding_txid, ParseChannelState returns
// ("open", "<funding_txid>:<output_index>", "", nil).
func TestParseChannelStateOpen(t *testing.T) {
	resp := loadFixture(t, "open_channel.json")
	status, cp, closeType, err := ParseChannelState(resp, nil, testFundingTxID, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != "open" {
		t.Errorf("status = %q, want %q", status, "open")
	}
	if cp != testFundingTxID+":0" {
		t.Errorf("channel_point = %q, want %q", cp, testFundingTxID+":0")
	}
	if closeType != "" {
		t.Errorf("closeType = %q, want empty", closeType)
	}
}

// TestParseChannelStateClosed asserts that when the channel appears in
// ClosedChannels (and NOT in ListChannels), ParseChannelState returns
// ("closed", channel_point, close_type, nil).
func TestParseChannelStateClosed(t *testing.T) {
	closedResp := loadFixture(t, "closed_channel.json")
	empty := map[string]any{"data": map[string]any{"channels": []any{}}}
	status, cp, closeType, err := ParseChannelState(empty, closedResp, testFundingTxID, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != "closed" {
		t.Errorf("status = %q, want %q", status, "closed")
	}
	if cp == "" {
		t.Error("channel_point is empty")
	}
	if closeType != "COOPERATIVE_CLOSE" {
		t.Errorf("closeType = %q, want %q", closeType, "COOPERATIVE_CLOSE")
	}
}

// TestParseChannelStateNotFound asserts D-03 semantics: when neither list
// contains the funding_txid, ParseChannelState returns ("pending_open", "",
// "", nil) — not an error. The poller loops on this result until the channel
// appears in ListChannels.
func TestParseChannelStateNotFound(t *testing.T) {
	resp := loadFixture(t, "not_found.json")
	status, cp, closeType, err := ParseChannelState(resp, nil, testFundingTxID, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if status != "pending_open" {
		t.Errorf("status = %q, want %q", status, "pending_open")
	}
	if cp != "" {
		t.Errorf("channel_point = %q, want empty", cp)
	}
	if closeType != "" {
		t.Errorf("closeType = %q, want empty", closeType)
	}
}

// TestParseChannelStateMalformed asserts D-02 semantics: a structurally
// malformed LND response (e.g., `data` is a string rather than a map) MUST
// return a non-nil error — never a silent empty-state default. This is the
// contract that prevents the UAT-11 bug class from recurring at the parser
// boundary.
func TestParseChannelStateMalformed(t *testing.T) {
	resp := loadFixture(t, "malformed.json")
	status, cp, closeType, err := ParseChannelState(resp, nil, testFundingTxID, 0)
	if err == nil {
		t.Fatal("expected error on malformed input, got nil")
	}
	if status != "" || cp != "" || closeType != "" {
		t.Errorf("expected zero-value returns on error, got (%q, %q, %q)", status, cp, closeType)
	}
}

// TestParseChannelStateDualShape is the explicit regression guard for the
// UAT-11 / UAT-12 bug. It runs the same happy path twice — once with the
// channels slice built as []map[string]any (the in-process concrete shape
// produced by the gRPC wrapper in internal/lnd/grpc.go), and once with it
// built as []any (the shape that emerges after a JSON marshal/unmarshal
// round-trip). Both MUST return identical (status, channel_point, "", nil).
func TestParseChannelStateDualShape(t *testing.T) {
	ch := map[string]any{
		"channel_point": testFundingTxID + ":0",
	}
	respA := map[string]any{"data": map[string]any{"channels": []map[string]any{ch}}}
	respB := map[string]any{"data": map[string]any{"channels": []any{ch}}}

	cases := []struct {
		name string
		in   map[string]any
	}{
		{"concrete_slice_in_process", respA},
		{"generic_slice_json_roundtrip", respB},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, cp, closeType, err := ParseChannelState(tc.in, nil, testFundingTxID, 0)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if status != "open" {
				t.Errorf("status = %q, want %q", status, "open")
			}
			if cp != testFundingTxID+":0" {
				t.Errorf("channel_point = %q, want %q", cp, testFundingTxID+":0")
			}
			if closeType != "" {
				t.Errorf("closeType = %q, want empty", closeType)
			}
		})
	}
}
