package idempotency

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func setupTestStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	s, err := New(filepath.Join(dir, "idemp.db"), logger)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestNewKeyAllowsThrough(t *testing.T) {
	s := setupTestStore(t)

	cached, err := s.CheckAndReserve("key-1", "/v1/payments/send")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if cached != nil {
		t.Error("new key should return nil (allow through)")
	}
}

func TestDuplicateKeyReturnsCached(t *testing.T) {
	s := setupTestStore(t)

	// Store a response
	err := s.Store("key-1", "/v1/payments/send", 200, `{"ok":true,"data":{"payment_hash":"abc"}}`)
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	// Check same key
	cached, err := s.CheckAndReserve("key-1", "/v1/payments/send")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if cached == nil {
		t.Fatal("duplicate key should return cached response")
	}
	if cached.StatusCode != 200 {
		t.Errorf("expected status 200, got %d", cached.StatusCode)
	}
	if cached.ResponseBody != `{"ok":true,"data":{"payment_hash":"abc"}}` {
		t.Errorf("unexpected response body: %s", cached.ResponseBody)
	}
}

func TestEmptyKeyBypassesIdempotency(t *testing.T) {
	s := setupTestStore(t)

	// Empty key should always allow through
	cached, err := s.CheckAndReserve("", "/v1/payments/send")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if cached != nil {
		t.Error("empty key should always return nil")
	}

	// Storing with empty key should be a no-op
	err = s.Store("", "/v1/payments/send", 200, `{}`)
	if err != nil {
		t.Fatalf("Store with empty key: %v", err)
	}
}

func TestDifferentEndpointsDontCollide(t *testing.T) {
	s := setupTestStore(t)

	err := s.Store("key-1", "/v1/payments/send", 200, `{"type":"payment"}`)
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	// Same key, different endpoint — should allow through
	cached, err := s.CheckAndReserve("key-1", "/v1/channels/open")
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if cached != nil {
		t.Error("same key on different endpoint should not collide")
	}
}

func TestCleanup(t *testing.T) {
	s := setupTestStore(t)

	// Store a key (24h TTL by default, can't easily test expiry without modifying)
	err := s.Store("key-1", "/v1/test", 200, `{}`)
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	// Cleanup should remove 0 (nothing expired yet)
	n, err := s.Cleanup()
	if err != nil {
		t.Fatalf("Cleanup: %v", err)
	}
	if n != 0 {
		t.Errorf("expected 0 removed, got %d", n)
	}
}
