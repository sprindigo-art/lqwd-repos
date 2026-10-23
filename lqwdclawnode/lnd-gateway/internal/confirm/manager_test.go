package confirm

import (
	"testing"
	"time"
)

func TestCreateAndConfirm(t *testing.T) {
	m := New(60)

	op := m.Create("/v1/channels/open", "Open 500k sat channel to 02abc", `{"pubkey":"02abc","amount":500000}`, 500_000)
	if op == nil {
		t.Fatal("Create returned nil")
	}
	if op.ID == "" {
		t.Fatal("operation ID is empty")
	}
	if op.Endpoint != "/v1/channels/open" {
		t.Errorf("expected endpoint /v1/channels/open, got %s", op.Endpoint)
	}

	// Confirm should return the operation
	confirmed := m.Confirm(op.ID)
	if confirmed == nil {
		t.Fatal("Confirm returned nil")
	}
	if confirmed.ID != op.ID {
		t.Errorf("confirmed ID mismatch: %s != %s", confirmed.ID, op.ID)
	}

	// Second confirm should return nil (already consumed)
	if m.Confirm(op.ID) != nil {
		t.Error("second Confirm should return nil")
	}
}

func TestReject(t *testing.T) {
	m := New(60)
	op := m.Create("/v1/payments/send", "Send 100k sats", `{}`, 100_000)

	if !m.Reject(op.ID) {
		t.Error("Reject should return true for existing op")
	}

	// Should not be confirmable after reject
	if m.Confirm(op.ID) != nil {
		t.Error("Confirm after Reject should return nil")
	}

	// Reject non-existent
	if m.Reject("op_nonexistent") {
		t.Error("Reject non-existent should return false")
	}
}

func TestExpiry(t *testing.T) {
	m := New(1) // 1 second expiry

	op := m.Create("/v1/channels/open", "Test op", `{}`, 100_000)
	time.Sleep(1500 * time.Millisecond)

	// Should be expired
	if m.Confirm(op.ID) != nil {
		t.Error("expired operation should not be confirmable")
	}
}

func TestList(t *testing.T) {
	m := New(300)

	m.Create("/v1/channels/open", "Op 1", `{}`, 100_000)
	m.Create("/v1/payments/send", "Op 2", `{}`, 200_000)

	ops := m.List()
	if len(ops) != 2 {
		t.Errorf("expected 2 pending ops, got %d", len(ops))
	}
}

func TestCount(t *testing.T) {
	m := New(300)

	if m.Count() != 0 {
		t.Error("initial count should be 0")
	}

	m.Create("/v1/channels/open", "Op 1", `{}`, 100_000)
	if m.Count() != 1 {
		t.Errorf("expected count 1, got %d", m.Count())
	}

	m.Create("/v1/payments/send", "Op 2", `{}`, 200_000)
	if m.Count() != 2 {
		t.Errorf("expected count 2, got %d", m.Count())
	}
}

func TestUniqueIDs(t *testing.T) {
	m := New(300)
	ids := make(map[string]bool)

	for i := 0; i < 100; i++ {
		op := m.Create("/v1/test", "test", `{}`, 0)
		if ids[op.ID] {
			t.Errorf("duplicate ID generated: %s", op.ID)
		}
		ids[op.ID] = true
	}
}
