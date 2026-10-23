package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestGatewayVersionHeaderSet asserts the happy-path: header is set on the
// response, inner handler runs normally, body is untouched, status preserved.
func TestGatewayVersionHeaderSet(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	wrapped := GatewayVersion("v3.0.0-test")(inner)

	req := httptest.NewRequest("GET", "/anything", nil)
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Gateway-Version"); got != "v3.0.0-test" {
		t.Errorf("X-Gateway-Version=%q want v3.0.0-test", got)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status=%d want 200", rec.Code)
	}
	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), `"ok":true`) {
		t.Errorf("body altered by middleware: %s", body)
	}
}

// TestGatewayVersionEmptyVersion confirms an empty/"dev" version still
// produces a header entry (never absent). This is the behaviour SKL-03
// bash preambles rely on — if the header is absent they would log noisy
// "gateway unreachable or pre-Phase-22" warnings on every call.
func TestGatewayVersionEmptyVersion(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := GatewayVersion("")(inner)

	req := httptest.NewRequest("GET", "/anything", nil)
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)

	if _, exists := rec.Header()["X-Gateway-Version"]; !exists {
		t.Error("X-Gateway-Version header not set on empty version")
	}
}
