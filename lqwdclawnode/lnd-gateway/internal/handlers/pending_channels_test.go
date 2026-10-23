package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestPendingChannelsAllowlist guards the Phase 22 CHO-03 / D-20 response-struct
// allowlist for POST /v1/channels/pending. The handler MUST NOT json-marshal
// the raw LND PendingChannels response — it must funnel through filterPendingChannels,
// producing a response whose per-channel maps contain ONLY the 5 allowlisted
// fields {channel_point, remote_node_pub, capacity, local_balance, remote_balance}.
//
// Rationale (W6 structural allowlist, strictly stronger than a substring denylist):
// a substring denylist like "body must not contain funding_txid" only catches
// field names the test author thought to list. Iterating every per-channel map
// across all 4 buckets and asserting each key is in the 5-element allowlist
// set catches ANY field leakage — including fields a future LND version might
// add that today's denylist never knew to guard.
func TestPendingChannelsAllowlist(t *testing.T) {
	deps := newTestDeps(t) // MockMode=true — handler routes through mock.PendingChannels()

	req := httptest.NewRequest("POST", "/v1/channels/pending", nil)
	rec := httptest.NewRecorder()
	deps.PendingChannels(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	body := rec.Body.String()
	// Top-level keys must appear in the envelope's `data` object.
	for _, allow := range []string{
		"pending_open_channels",
		"pending_closing_channels",
		"pending_force_closing_channels",
		"waiting_close_channels",
		"total_limbo_balance",
	} {
		if !strings.Contains(body, allow) {
			t.Errorf("response missing required key %q. Body: %s", allow, body)
		}
	}

	// Structural allowlist check: iterate every per-channel map in all 4 buckets
	// and assert each map's keys are in the allowlist set. Strictly stronger
	// than a substring denylist.
	var parsed struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	allowedFields := map[string]bool{
		"channel_point":   true,
		"remote_node_pub": true,
		"capacity":        true,
		"local_balance":   true,
		"remote_balance":  true,
	}
	buckets := []string{
		"pending_open_channels",
		"pending_closing_channels",
		"pending_force_closing_channels",
		"waiting_close_channels",
	}
	for _, bucket := range buckets {
		raw, ok := parsed.Data[bucket]
		if !ok {
			t.Errorf("bucket %q missing from response.data", bucket)
			continue
		}
		var chans []map[string]json.RawMessage
		if err := json.Unmarshal(raw, &chans); err != nil {
			t.Errorf("unmarshal bucket %q: %v", bucket, err)
			continue
		}
		for i, ch := range chans {
			for k := range ch {
				if !allowedFields[k] {
					t.Errorf("bucket %q[%d] leaked non-allowlisted field %q (W6 structural allowlist)", bucket, i, k)
				}
			}
		}
	}
}

// TestPendingChannelsMockFixtureRoundTrip sanity-checks that the mock fixture
// from Plan 22-02 still produces the expected per-bucket counts through the
// filter. Guards against a future fixture change silently zeroing buckets.
func TestPendingChannelsMockFixtureRoundTrip(t *testing.T) {
	deps := newTestDeps(t)

	req := httptest.NewRequest("POST", "/v1/channels/pending", nil)
	rec := httptest.NewRecorder()
	deps.PendingChannels(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var parsed struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Plan 22-02 mock fixture: 1 pending_open, 1 pending_closing, 1 pending_force_closing, 0 waiting_close.
	type bucketExpect struct {
		key  string
		want int
	}
	for _, be := range []bucketExpect{
		{"pending_open_channels", 1},
		{"pending_closing_channels", 1},
		{"pending_force_closing_channels", 1},
		{"waiting_close_channels", 0},
	} {
		raw := parsed.Data[be.key]
		var chans []map[string]any
		if err := json.Unmarshal(raw, &chans); err != nil {
			t.Errorf("unmarshal %q: %v", be.key, err)
			continue
		}
		if len(chans) != be.want {
			t.Errorf("bucket %q len=%d want %d", be.key, len(chans), be.want)
		}
	}

	// total_limbo_balance must be the mock's 25000.
	var tlb int64
	if err := json.Unmarshal(parsed.Data["total_limbo_balance"], &tlb); err != nil {
		t.Errorf("unmarshal total_limbo_balance: %v", err)
	}
	if tlb != 25000 {
		t.Errorf("total_limbo_balance=%d want 25000", tlb)
	}
}
