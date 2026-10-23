package accounts

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAPIKeyAuthValid(t *testing.T) {
	store := NewMockStore()
	agent, rawKey, err := store.Register(context.Background(), "test-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	var gotAgent *Agent
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAgent = GetAgent(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	handler := APIKeyAuth(store)(next)

	req := httptest.NewRequest("GET", "/v1/internal/accounts/me", nil)
	req.Header.Set("Authorization", "Bearer "+rawKey)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if gotAgent == nil {
		t.Fatal("expected agent in context, got nil")
	}
	if gotAgent.ID != agent.ID {
		t.Errorf("expected agent ID %s, got %s", agent.ID, gotAgent.ID)
	}
}

func TestAPIKeyAuthMissing(t *testing.T) {
	store := NewMockStore()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	})

	handler := APIKeyAuth(store)(next)

	req := httptest.NewRequest("GET", "/v1/internal/accounts/me", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAPIKeyAuthNoPrefix(t *testing.T) {
	store := NewMockStore()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	})

	handler := APIKeyAuth(store)(next)

	req := httptest.NewRequest("GET", "/v1/internal/accounts/me", nil)
	req.Header.Set("Authorization", "Bearer some-random-key")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAPIKeyAuthInvalidKey(t *testing.T) {
	store := NewMockStore()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called")
	})

	handler := APIKeyAuth(store)(next)

	req := httptest.NewRequest("GET", "/v1/internal/accounts/me", nil)
	req.Header.Set("Authorization", "Bearer lqwd_nonexistentkey12345678901234567890123")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAPIKeyAuthSuspended(t *testing.T) {
	store := NewMockStore()
	_, rawKey, err := store.Register(context.Background(), "suspended-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	// Manually suspend the agent via the mock store
	store.mu.Lock()
	for _, agent := range store.agents {
		if agent.Name == "suspended-agent" {
			agent.Status = "suspended"
		}
	}
	store.mu.Unlock()

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler should not be called for suspended agent")
	})

	handler := APIKeyAuth(store)(next)

	req := httptest.NewRequest("GET", "/v1/internal/accounts/me", nil)
	req.Header.Set("Authorization", "Bearer "+rawKey)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSetGetAgent(t *testing.T) {
	agent := &Agent{ID: "test-id", Name: "test"}
	ctx := SetAgent(context.Background(), agent)
	got := GetAgent(ctx)
	if got == nil || got.ID != "test-id" {
		t.Errorf("expected agent test-id, got %v", got)
	}

	// nil context returns nil
	got = GetAgent(context.Background())
	if got != nil {
		t.Errorf("expected nil agent from empty context, got %v", got)
	}
}

func TestSetGetKeyHash(t *testing.T) {
	ctx := SetKeyHash(context.Background(), "abc123")
	got := GetKeyHash(ctx)
	if got != "abc123" {
		t.Errorf("expected abc123, got %s", got)
	}

	// empty context returns empty
	got = GetKeyHash(context.Background())
	if got != "" {
		t.Errorf("expected empty string, got %s", got)
	}
}
