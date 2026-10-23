package l402

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "l402-test.db")
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	s, err := NewStore(dbPath, logger)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestCreateAndLookup(t *testing.T) {
	s := testStore(t)
	expires := time.Now().Add(1 * time.Hour)

	err := s.CreateChallenge("abc123", "mac-data", "lnbc50n1...", "/v1/l402/node-stats", 5, expires)
	if err != nil {
		t.Fatalf("CreateChallenge: %v", err)
	}

	tok, err := s.Lookup("abc123")
	if err != nil {
		t.Fatalf("Lookup: %v", err)
	}
	if tok == nil {
		t.Fatal("Lookup returned nil")
	}
	if tok.PaymentHash != "abc123" {
		t.Errorf("expected payment_hash abc123, got %s", tok.PaymentHash)
	}
	if tok.Status != StatusPending {
		t.Errorf("expected status pending, got %s", tok.Status)
	}
	if tok.AmountSats != 5 {
		t.Errorf("expected 5 sats, got %d", tok.AmountSats)
	}
}

func TestMarkPaid(t *testing.T) {
	s := testStore(t)
	expires := time.Now().Add(1 * time.Hour)
	s.CreateChallenge("hash1", "mac", "inv", "/test", 10, expires)

	err := s.MarkPaid("hash1", "preimage-hex")
	if err != nil {
		t.Fatalf("MarkPaid: %v", err)
	}

	tok, _ := s.Lookup("hash1")
	if tok.Status != StatusPaid {
		t.Errorf("expected paid, got %s", tok.Status)
	}
	if tok.Preimage != "preimage-hex" {
		t.Errorf("expected preimage-hex, got %s", tok.Preimage)
	}
}

func TestMarkPaidNotFound(t *testing.T) {
	s := testStore(t)
	err := s.MarkPaid("nonexistent", "preimage")
	if err == nil {
		t.Fatal("expected error for nonexistent payment_hash")
	}
}

func TestConsume(t *testing.T) {
	s := testStore(t)
	expires := time.Now().Add(1 * time.Hour)
	s.CreateChallenge("hash2", "mac", "inv", "/test", 10, expires)
	s.MarkPaid("hash2", "pre")

	tok, err := s.Consume("hash2")
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if tok.Status != StatusConsumed {
		t.Errorf("expected consumed, got %s", tok.Status)
	}

	// Second consume should fail (single-use)
	_, err = s.Consume("hash2")
	if err == nil {
		t.Fatal("expected error on second consume")
	}
}

func TestConsumePending(t *testing.T) {
	s := testStore(t)
	expires := time.Now().Add(1 * time.Hour)
	s.CreateChallenge("hash3", "mac", "inv", "/test", 10, expires)

	_, err := s.Consume("hash3")
	if err == nil {
		t.Fatal("expected error consuming pending token")
	}
}

func TestConsumeExpired(t *testing.T) {
	s := testStore(t)
	expires := time.Now().Add(-1 * time.Hour) // already expired
	s.CreateChallenge("hash4", "mac", "inv", "/test", 10, expires)
	s.MarkPaid("hash4", "pre")

	_, err := s.Consume("hash4")
	if err == nil {
		t.Fatal("expected error consuming expired token")
	}
}

func TestCleanup(t *testing.T) {
	s := testStore(t)
	s.CreateChallenge("fresh", "mac", "inv", "/test", 10, time.Now().Add(1*time.Hour))
	s.CreateChallenge("stale", "mac", "inv", "/test", 10, time.Now().Add(-1*time.Hour))

	n, err := s.Cleanup()
	if err != nil {
		t.Fatalf("Cleanup: %v", err)
	}
	if n != 1 {
		t.Errorf("expected 1 cleaned up, got %d", n)
	}

	// Fresh should still exist
	tok, _ := s.Lookup("fresh")
	if tok == nil {
		t.Error("fresh token should still exist")
	}

	// Stale should be gone
	tok, _ = s.Lookup("stale")
	if tok != nil {
		t.Error("stale token should be deleted")
	}
}

func TestLookupNotFound(t *testing.T) {
	s := testStore(t)
	tok, err := s.Lookup("nonexistent")
	if err != nil {
		t.Fatalf("Lookup error: %v", err)
	}
	if tok != nil {
		t.Error("expected nil for nonexistent token")
	}
}
