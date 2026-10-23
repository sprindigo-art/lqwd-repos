package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestHealthPublic_MinimalBody guards against leaking operational details
// through the public /v1/health endpoint. If any future change adds keys
// like kill_switch, pending_confirms, budget_limits, or uptime_seconds
// to the public response, this test fails — those belong on the
// localhost-only /v1/health/detailed path.
func TestHealthPublic_MinimalBody(t *testing.T) {
	deps := newTestDeps(t)

	req := httptest.NewRequest("GET", "/v1/health", nil)
	w := httptest.NewRecorder()
	deps.Health(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	data, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("missing data object: %v", body)
	}
	if data["status"] != "healthy" {
		t.Fatalf("status = %v, want healthy", data["status"])
	}

	forbidden := []string{"kill_switch", "pending_confirms", "budget_limits", "uptime_seconds", "mock_mode"}
	for _, k := range forbidden {
		if _, present := data[k]; present {
			t.Errorf("public /v1/health must not expose %q (value=%v)", k, data[k])
		}
	}
}

// TestHealthDetailed_FullBody verifies /v1/health/detailed still carries
// the operational snapshot operators rely on for localhost probing.
func TestHealthDetailed_FullBody(t *testing.T) {
	deps := newTestDeps(t)

	req := httptest.NewRequest("GET", "/v1/health/detailed", nil)
	w := httptest.NewRecorder()
	deps.HealthDetailed(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var body map[string]any
	json.Unmarshal(w.Body.Bytes(), &body)
	data, _ := body["data"].(map[string]any)

	// In mock mode (newTestDeps sets MockMode=true), the handler delegates to
	// mock.Health() which carries its own detail set (status, mock_mode,
	// lnd_connected, wallet_locked, uptime). Either mock or production detail
	// shape is acceptable — what we assert is that it's NOT the minimized shape.
	if len(data) <= 1 {
		t.Fatalf("detailed body looks minimized (only %d keys): %v", len(data), data)
	}
	if data["status"] != "healthy" {
		t.Fatalf("status = %v, want healthy", data["status"])
	}
}
