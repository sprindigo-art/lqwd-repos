package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInternalNodeStats(t *testing.T) {
	deps := &Dependencies{MockMode: true}
	req := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	rec := httptest.NewRecorder()

	deps.InternalNodeStats(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %s", ct)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body["ok"] != true {
		t.Fatal("expected ok=true")
	}
	data, _ := body["data"].(map[string]any)
	if data["alias"] == nil {
		t.Fatal("expected data.alias to be present")
	}
	if data["identity_pubkey"] == nil {
		t.Fatal("expected data.identity_pubkey to be present")
	}
	// Must NOT have 402 challenge headers
	if rec.Header().Get("WWW-Authenticate") != "" {
		t.Fatal("internal endpoint must not return WWW-Authenticate header")
	}
}

func TestInternalNetworkAnalytics(t *testing.T) {
	deps := &Dependencies{MockMode: true}
	req := httptest.NewRequest("GET", "/v1/internal/network-analytics", nil)
	rec := httptest.NewRecorder()

	deps.InternalNetworkAnalytics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %s", ct)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body["ok"] != true {
		t.Fatal("expected ok=true")
	}
	data, _ := body["data"].(map[string]any)
	if data["alias"] == nil {
		t.Fatal("expected data.alias to be present")
	}
	if data["day_fee_sum"] == nil {
		t.Fatal("expected data.day_fee_sum to be present")
	}
	// Must NOT have 402 challenge headers
	if rec.Header().Get("WWW-Authenticate") != "" {
		t.Fatal("internal endpoint must not return WWW-Authenticate header")
	}
}

func TestInternalPromo(t *testing.T) {
	deps := &Dependencies{MockMode: true}
	req := httptest.NewRequest("GET", "/v1/internal/promo", nil)
	rec := httptest.NewRecorder()

	deps.InternalPromo(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	ct := rec.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Fatalf("expected Content-Type application/json, got %s", ct)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if body["ok"] != true {
		t.Fatal("expected ok=true")
	}
	data, _ := body["data"].(map[string]any)
	if data["message"] == nil {
		t.Fatal("expected data.message to be present")
	}
	// Must NOT have 402 challenge headers
	if rec.Header().Get("WWW-Authenticate") != "" {
		t.Fatal("internal endpoint must not return WWW-Authenticate header")
	}
}
