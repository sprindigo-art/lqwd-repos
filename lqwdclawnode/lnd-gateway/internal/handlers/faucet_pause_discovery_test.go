package handlers

// Phase 21 (Agent B, 2026-04-22): /v1/discovery surfaces faucet_paused
// when the pause flag file exists.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// (g) discovery includes faucet_paused + pause_reason when the file exists.
func TestDiscovery_FaucetPaused_FlagPresent(t *testing.T) {
	deps := newTestDeps(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "faucet-paused")
	deps.FaucetPauseFilePath = path

	if err := os.WriteFile(path, []byte(`{"reason":"planned maintenance","actor":"op","paused_at":"2026-04-22T00:00:00Z"}`), 0o644); err != nil {
		t.Fatalf("write pause file: %v", err)
	}

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	data := body["data"].(map[string]any)
	cf, ok := data["channel_faucet"].(map[string]any)
	if !ok {
		t.Fatalf("channel_faucet not an object: %T", data["channel_faucet"])
	}
	paused, _ := cf["faucet_paused"].(bool)
	if !paused {
		t.Errorf("channel_faucet.faucet_paused = %v, want true", cf["faucet_paused"])
	}
	reason, _ := cf["pause_reason"].(string)
	if reason != "planned maintenance" {
		t.Errorf("channel_faucet.pause_reason = %q, want %q", reason, "planned maintenance")
	}
	if pausedAt, _ := cf["paused_at"].(string); pausedAt != "2026-04-22T00:00:00Z" {
		t.Errorf("channel_faucet.paused_at = %q, want 2026-04-22T00:00:00Z", pausedAt)
	}
}

// (h) discovery omits the faucet_paused field when the file is absent.
func TestDiscovery_FaucetPaused_FlagAbsent(t *testing.T) {
	deps := newTestDeps(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "faucet-paused")
	deps.FaucetPauseFilePath = path

	// Sanity: file doesn't exist.
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("pause file should not exist; stat err=%v", err)
	}

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	data := body["data"].(map[string]any)
	cf := data["channel_faucet"].(map[string]any)

	if _, present := cf["faucet_paused"]; present {
		t.Errorf("channel_faucet.faucet_paused must be absent when flag file missing")
	}
	if _, present := cf["pause_reason"]; present {
		t.Errorf("channel_faucet.pause_reason must be absent when flag file missing")
	}
}

// Malformed pause file: still surfaces faucet_paused=true with a generic
// reason — we'd rather over-advertise paused than silently lie about
// faucet health.
func TestDiscovery_FaucetPaused_MalformedFile(t *testing.T) {
	deps := newTestDeps(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "faucet-paused")
	deps.FaucetPauseFilePath = path

	if err := os.WriteFile(path, []byte("not json at all"), 0o644); err != nil {
		t.Fatalf("write malformed file: %v", err)
	}

	req := httptest.NewRequest("GET", "/v1/discovery", nil)
	w := httptest.NewRecorder()
	deps.Discovery(w, req)

	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	data := body["data"].(map[string]any)
	cf := data["channel_faucet"].(map[string]any)

	if paused, _ := cf["faucet_paused"].(bool); !paused {
		t.Errorf("channel_faucet.faucet_paused must be true even with malformed file")
	}
	if reason, _ := cf["pause_reason"].(string); reason == "" {
		t.Errorf("channel_faucet.pause_reason must be non-empty even with malformed file")
	}
}
