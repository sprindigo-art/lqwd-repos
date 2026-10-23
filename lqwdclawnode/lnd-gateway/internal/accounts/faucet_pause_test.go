package accounts

// Phase 21 (Agent B, 2026-04-22): tests for the faucet-pause file-flag
// mechanism. Covers:
//   - MockStore.ReserveChannelSlot returns ErrFaucetPaused when the flag
//     file exists
//   - MockStore.ReserveChannelSlot succeeds normally when the flag file
//     is absent
//   - AdminFaucetPause creates the file with the expected JSON shape
//   - AdminFaucetResume removes the file
//   - AdminFaucetResume is a no-op when the file is already absent
//   - Both handlers work under Bearer auth and the legacy X-Admin-Token
//
// Tests use t.TempDir() — they never touch /var/lib/... so they are safe
// to run concurrently with the real gateway.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fpAdminToken = "test-admin-token-pause"

// newPauseHandlers builds a ChannelHandlers wired to a MockStore with a
// temp pause-file path. Returns the handlers, the store, and the path.
func newPauseHandlers(t *testing.T) (*ChannelHandlers, *MockStore, string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "faucet-paused")
	store := NewMockStore()
	store.FaucetPauseFilePath = path
	ch := &ChannelHandlers{
		Store:               store,
		AdminToken:          fpAdminToken,
		Logger:              slog.Default(),
		FaucetPauseFilePath: path,
	}
	return ch, store, path
}

// (a) ReserveChannelSlot returns ErrFaucetPaused when the file is present.
func TestReserveChannelSlot_FaucetPaused(t *testing.T) {
	_, store, path := newPauseHandlers(t)
	ctx := context.Background()

	if err := os.WriteFile(path, []byte(`{"reason":"maintenance","actor":"op"}`), 0o644); err != nil {
		t.Fatalf("write pause file: %v", err)
	}

	agent, _, err := store.Register(ctx, "paused-agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	pubkey := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	_, err = store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@1.2.3.4:9735", 20_000, 1_354)
	if !errors.Is(err, ErrFaucetPaused) {
		t.Fatalf("expected ErrFaucetPaused; got %v", err)
	}
}

// (b) ReserveChannelSlot proceeds normally when the file is absent.
func TestReserveChannelSlot_FaucetNotPaused(t *testing.T) {
	_, store, path := newPauseHandlers(t)
	ctx := context.Background()

	// Sanity: file must not exist.
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("pause file should not exist at start: %v", err)
	}

	agent, _, err := store.Register(ctx, "normal-agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	pubkey := "02abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
	grantID, err := store.ReserveChannelSlot(ctx, agent.ID, pubkey, pubkey+"@1.2.3.4:9735", 20_000, 1_354)
	if err != nil {
		t.Fatalf("ReserveChannelSlot: %v", err)
	}
	if grantID == "" {
		t.Fatal("expected grant ID, got empty")
	}
}

// (c) AdminFaucetPause creates the file with the expected JSON content.
func TestAdminFaucetPause_WritesFile(t *testing.T) {
	ch, _, path := newPauseHandlers(t)

	body := bytes.NewBufferString(`{"reason":"planned maintenance","actor":"op1"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/faucet/pause", body)
	req.Header.Set("Authorization", "Bearer "+fpAdminToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	ch.AdminFaucetPause(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	buf, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read pause file: %v", err)
	}
	var payload struct {
		Reason   string `json:"reason"`
		Actor    string `json:"actor"`
		PausedAt string `json:"paused_at"`
	}
	if err := json.Unmarshal(buf, &payload); err != nil {
		t.Fatalf("decode pause file: %v; body=%s", err, string(buf))
	}
	if payload.Reason != "planned maintenance" {
		t.Errorf("reason = %q, want %q", payload.Reason, "planned maintenance")
	}
	if payload.Actor != "op1" {
		t.Errorf("actor = %q, want %q", payload.Actor, "op1")
	}
	if payload.PausedAt == "" {
		t.Error("paused_at must be set (RFC3339 timestamp)")
	}
}

// (d) AdminFaucetResume removes the file.
func TestAdminFaucetResume_RemovesFile(t *testing.T) {
	ch, _, path := newPauseHandlers(t)

	// Seed: create the file first.
	if err := os.WriteFile(path, []byte(`{"reason":"test","actor":"x","paused_at":"2026-04-22T00:00:00Z"}`), 0o644); err != nil {
		t.Fatalf("seed pause file: %v", err)
	}

	body := bytes.NewBufferString(`{"actor":"op1"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/faucet/resume", body)
	req.Header.Set("Authorization", "Bearer "+fpAdminToken)
	rec := httptest.NewRecorder()
	ch.AdminFaucetResume(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("pause file must be removed after resume; stat err=%v", err)
	}
}

// (e) AdminFaucetResume is a no-op when the file is already absent.
func TestAdminFaucetResume_NoOpWhenAbsent(t *testing.T) {
	ch, _, path := newPauseHandlers(t)

	// Sanity: file absent.
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("pause file should not exist at start: %v", err)
	}

	body := bytes.NewBufferString(`{"actor":"op1"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/faucet/resume", body)
	req.Header.Set("Authorization", "Bearer "+fpAdminToken)
	rec := httptest.NewRecorder()
	ch.AdminFaucetResume(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (idempotent); body=%s", rec.Code, rec.Body.String())
	}
}

// (f) Both handlers accept Bearer AND legacy X-Admin-Token (matches
// Phase 20's admin-auth contract).
func TestAdminFaucetPauseResume_BothAuthHeaders(t *testing.T) {
	for _, tc := range []struct {
		name   string
		set    func(*http.Request)
		reject bool
	}{
		{
			name: "bearer",
			set: func(r *http.Request) {
				r.Header.Set("Authorization", "Bearer "+fpAdminToken)
			},
		},
		{
			name: "x-admin-token",
			set: func(r *http.Request) {
				r.Header.Set("X-Admin-Token", fpAdminToken)
			},
		},
		{
			name: "no-auth",
			set:  func(r *http.Request) {},
			reject: true,
		},
		{
			name: "bad-bearer",
			set: func(r *http.Request) {
				r.Header.Set("Authorization", "Bearer wrong")
			},
			reject: true,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ch, _, path := newPauseHandlers(t)

			// Pause first
			req := httptest.NewRequest("POST", "/v1/internal/admin/faucet/pause", bytes.NewBufferString(`{"reason":"r","actor":"a"}`))
			tc.set(req)
			rec := httptest.NewRecorder()
			ch.AdminFaucetPause(rec, req)

			if tc.reject {
				if rec.Code != http.StatusUnauthorized {
					t.Fatalf("pause status = %d, want 401 for %s", rec.Code, tc.name)
				}
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Errorf("unauth pause must not create flag file")
				}
				return
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("pause status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}

			// Resume
			req = httptest.NewRequest("POST", "/v1/internal/admin/faucet/resume", bytes.NewBufferString(`{"actor":"a"}`))
			tc.set(req)
			rec = httptest.NewRecorder()
			ch.AdminFaucetResume(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("resume status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Errorf("resume must remove flag file")
			}
		})
	}
}

// Sanity: the Warning header is emitted when the legacy X-Admin-Token
// is used, matching the Phase 20 deprecation signal.
func TestAdminFaucetPause_XAdminTokenEmitsDeprecationWarning(t *testing.T) {
	ch, _, _ := newPauseHandlers(t)
	req := httptest.NewRequest("POST", "/v1/internal/admin/faucet/pause", bytes.NewBufferString(`{"reason":"r","actor":"a"}`))
	req.Header.Set("X-Admin-Token", fpAdminToken)
	rec := httptest.NewRecorder()
	ch.AdminFaucetPause(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	warn := rec.Header().Get("Warning")
	if !strings.Contains(strings.ToLower(warn), "x-admin-token") {
		t.Errorf("expected deprecation Warning header; got %q", warn)
	}
}
