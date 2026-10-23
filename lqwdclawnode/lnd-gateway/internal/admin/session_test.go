package admin

import (
	"testing"
	"time"
)

func TestSessionStore_CreateAndValidate(t *testing.T) {
	store := NewSessionStore()
	token, err := store.Create("admin", 1*time.Hour)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	sess := store.Validate(token)
	if sess == nil {
		t.Fatal("expected valid session")
	}
	if sess.Username != "admin" {
		t.Errorf("expected username=admin, got %s", sess.Username)
	}
}

func TestSessionStore_Expired(t *testing.T) {
	store := NewSessionStore()
	token, err := store.Create("admin", 1*time.Millisecond)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	time.Sleep(5 * time.Millisecond)
	sess := store.Validate(token)
	if sess != nil {
		t.Error("expected nil for expired session")
	}
}

func TestSessionStore_Delete(t *testing.T) {
	store := NewSessionStore()
	token, err := store.Create("admin", 1*time.Hour)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	store.Delete(token)
	sess := store.Validate(token)
	if sess != nil {
		t.Error("expected nil after delete")
	}
}
