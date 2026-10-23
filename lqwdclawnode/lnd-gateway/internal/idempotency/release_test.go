package idempotency

import (
	"testing"
)

func TestRelease_DeletesPendingReservation(t *testing.T) {
	s := setupTestStore(t)

	// First CheckAndReserve: new reservation created with status_code=0
	cached, err := s.CheckAndReserve("k1", "/v1/l402/pay")
	if err != nil {
		t.Fatalf("CheckAndReserve: %v", err)
	}
	if cached != nil {
		t.Fatal("expected new reservation (nil cached), got a cached response")
	}

	// Second call on same key returns 409 "duplicate request in progress"
	cached, err = s.CheckAndReserve("k1", "/v1/l402/pay")
	if err != nil {
		t.Fatalf("CheckAndReserve: %v", err)
	}
	if cached == nil || cached.StatusCode != 409 {
		t.Fatalf("expected 409 duplicate-in-progress, got %+v", cached)
	}

	// Release drops the pending reservation
	if err := s.Release("k1", "/v1/l402/pay"); err != nil {
		t.Fatalf("Release: %v", err)
	}

	// After Release, a fresh CheckAndReserve gets a clean slot
	cached, err = s.CheckAndReserve("k1", "/v1/l402/pay")
	if err != nil {
		t.Fatalf("CheckAndReserve after Release: %v", err)
	}
	if cached != nil {
		t.Fatalf("expected fresh reservation after Release, got cached: %+v", cached)
	}
}

// TestRelease_DoesNotDeleteCompletedResponse guards against data loss.
// Only pending rows (status_code=0) may be released — a confirmed 200/4xx/5xx
// response must be preserved so retries replay the outcome.
func TestRelease_DoesNotDeleteCompletedResponse(t *testing.T) {
	s := setupTestStore(t)

	if err := s.Store("k1", "/v1/payments/send", 200, `{"ok":true}`); err != nil {
		t.Fatalf("Store: %v", err)
	}

	if err := s.Release("k1", "/v1/payments/send"); err != nil {
		t.Fatalf("Release: %v", err)
	}

	cached, err := s.CheckAndReserve("k1", "/v1/payments/send")
	if err != nil {
		t.Fatalf("CheckAndReserve: %v", err)
	}
	if cached == nil {
		t.Fatal("Release must not delete completed responses")
	}
	if cached.StatusCode != 200 || cached.ResponseBody != `{"ok":true}` {
		t.Fatalf("completed response corrupted: %+v", cached)
	}
}

func TestRelease_EmptyKeyIsNoop(t *testing.T) {
	s := setupTestStore(t)
	if err := s.Release("", "/v1/l402/pay"); err != nil {
		t.Fatalf("Release with empty key should be a no-op, got error: %v", err)
	}
}
