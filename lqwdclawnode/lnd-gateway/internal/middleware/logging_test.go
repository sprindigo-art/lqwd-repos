package middleware

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"log/slog"
	"os"
)

var uuidV4Re = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestLogging_RequestID_Header(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	handler := Logging(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	id := w.Header().Get("X-Request-ID")
	if id == "" {
		t.Fatal("expected X-Request-ID response header, got empty")
	}
	if !uuidV4Re.MatchString(id) {
		t.Fatalf("X-Request-ID %q does not match UUID v4 pattern", id)
	}
}

func TestLogging_RequestID_Context(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	var ctxID string

	handler := Logging(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctxID = GetRequestID(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	headerID := w.Header().Get("X-Request-ID")
	if ctxID == "" {
		t.Fatal("GetRequestID returned empty string from context")
	}
	if ctxID != headerID {
		t.Fatalf("context ID %q != header ID %q", ctxID, headerID)
	}
}

func TestLogging_RequestID_NeverTrustsIncoming(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	handler := Logging(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Request-ID", "attacker-controlled-id")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	id := w.Header().Get("X-Request-ID")
	if id == "attacker-controlled-id" {
		t.Fatal("gateway must generate its own X-Request-ID, not trust incoming")
	}
	if !uuidV4Re.MatchString(id) {
		t.Fatalf("X-Request-ID %q does not match UUID v4 pattern", id)
	}
}
