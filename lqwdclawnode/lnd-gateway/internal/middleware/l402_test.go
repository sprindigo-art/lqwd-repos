package middleware

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/l402"
)

const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func setupL402(t *testing.T) (*l402.Service, *l402.Store) {
	t.Helper()
	svc, err := l402.NewService(testKey)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	dir := t.TempDir()
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	store, err := l402.NewStore(filepath.Join(dir, "l402.db"), logger)
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return svc, store
}

func TestL402NoAuth(t *testing.T) {
	svc, store := setupL402(t)
	handler := L402Auth(svc, store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}))

	req := httptest.NewRequest("GET", "/v1/l402/node-stats", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// Should pass through to handler (no auth = handler issues 402)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200 (passthrough), got %d", rr.Code)
	}
}

func TestL402InvalidScheme(t *testing.T) {
	svc, store := setupL402(t)
	handler := L402Auth(svc, store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/v1/l402/node-stats", nil)
	req.Header.Set("Authorization", "Bearer some-token")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for Bearer scheme on L402, got %d", rr.Code)
	}
}

func TestL402InvalidFormat(t *testing.T) {
	svc, store := setupL402(t)
	handler := L402Auth(svc, store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))

	req := httptest.NewRequest("GET", "/v1/l402/node-stats", nil)
	req.Header.Set("Authorization", "L402 no-colon-here")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for bad format, got %d", rr.Code)
	}
}

func TestL402ValidFlow(t *testing.T) {
	svc, store := setupL402(t)

	// Create a preimage/hash pair
	preimage := make([]byte, 32)
	for i := range preimage {
		preimage[i] = byte(i)
	}
	hash := sha256.Sum256(preimage)
	paymentHash := hex.EncodeToString(hash[:])
	preimageHex := hex.EncodeToString(preimage)

	// Mint macaroon and store challenge
	expires := time.Now().Add(1 * time.Hour)
	mac, err := svc.MintMacaroon(paymentHash, "/v1/l402/node-stats", "GET", expires)
	if err != nil {
		t.Fatalf("MintMacaroon: %v", err)
	}

	store.CreateChallenge(paymentHash, mac, "lnbc50n1...", "/v1/l402/node-stats", 5, expires)
	store.MarkPaid(paymentHash, preimageHex)

	// Now try to consume
	handler := L402Auth(svc, store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": "node-stats"})
	}))

	req := httptest.NewRequest("GET", "/v1/l402/node-stats", nil)
	req.Header.Set("Authorization", "L402 "+mac+":"+preimageHex)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestL402ReplayRejected(t *testing.T) {
	svc, store := setupL402(t)

	preimage := make([]byte, 32)
	for i := range preimage {
		preimage[i] = byte(i + 1)
	}
	hash := sha256.Sum256(preimage)
	paymentHash := hex.EncodeToString(hash[:])
	preimageHex := hex.EncodeToString(preimage)

	expires := time.Now().Add(1 * time.Hour)
	mac, _ := svc.MintMacaroon(paymentHash, "/v1/l402/node-stats", "GET", expires)
	store.CreateChallenge(paymentHash, mac, "inv", "/v1/l402/node-stats", 5, expires)
	store.MarkPaid(paymentHash, preimageHex)

	handler := L402Auth(svc, store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}))

	// First request — should succeed
	req := httptest.NewRequest("GET", "/v1/l402/node-stats", nil)
	req.Header.Set("Authorization", "L402 "+mac+":"+preimageHex)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("first request: expected 200, got %d", rr.Code)
	}

	// Second request — replay, should be rejected
	req2 := httptest.NewRequest("GET", "/v1/l402/node-stats", nil)
	req2.Header.Set("Authorization", "L402 "+mac+":"+preimageHex)
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusUnauthorized {
		t.Errorf("replay: expected 401, got %d: %s", rr2.Code, rr2.Body.String())
	}
}

func TestL402WrongPreimage(t *testing.T) {
	svc, store := setupL402(t)

	preimage := make([]byte, 32)
	hash := sha256.Sum256(preimage)
	paymentHash := hex.EncodeToString(hash[:])

	expires := time.Now().Add(1 * time.Hour)
	mac, _ := svc.MintMacaroon(paymentHash, "/v1/l402/node-stats", "GET", expires)
	store.CreateChallenge(paymentHash, mac, "inv", "/v1/l402/node-stats", 5, expires)
	store.MarkPaid(paymentHash, "wrong")

	handler := L402Auth(svc, store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("should not reach handler")
	}))

	req := httptest.NewRequest("GET", "/v1/l402/node-stats", nil)
	req.Header.Set("Authorization", "L402 "+mac+":"+"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for wrong preimage, got %d", rr.Code)
	}
}

func TestL402WrongEndpoint(t *testing.T) {
	svc, store := setupL402(t)

	preimage := make([]byte, 32)
	for i := range preimage {
		preimage[i] = byte(i + 2)
	}
	hash := sha256.Sum256(preimage)
	paymentHash := hex.EncodeToString(hash[:])
	preimageHex := hex.EncodeToString(preimage)

	expires := time.Now().Add(1 * time.Hour)
	// Token is for /v1/l402/promo, not /v1/l402/node-stats
	mac, _ := svc.MintMacaroon(paymentHash, "/v1/l402/promo", "GET", expires)
	store.CreateChallenge(paymentHash, mac, "inv", "/v1/l402/promo", 1, expires)
	store.MarkPaid(paymentHash, preimageHex)

	handler := L402Auth(svc, store)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("should not reach handler")
	}))

	req := httptest.NewRequest("GET", "/v1/l402/node-stats", nil)
	req.Header.Set("Authorization", "L402 "+mac+":"+preimageHex)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403 for wrong endpoint, got %d", rr.Code)
	}
}

func TestMatchEndpoint(t *testing.T) {
	tests := []struct {
		pattern string
		path    string
		want    bool
	}{
		{"/v1/l402/node-stats", "/v1/l402/node-stats", true},
		{"/v1/l402/*", "/v1/l402/node-stats", true},
		{"/v1/l402/*", "/v1/l402/promo", true},
		{"/v1/l402/*", "/v1/info", false},
		{"/v1/l402/node-stats", "/v1/l402/promo", false},
		// Path traversal cases (DEF-01)
		{"/../v1/l402/node-stats", "/../v1/l402/node-stats", true},
		{"/v1/l402/node-stats", "/../v1/l402/node-stats", true},
		{"/v1/l402/*", "/v1/l402/../l402/node-stats", true},
		{"/v1/l402/*", "/v1/l402/../../admin/kill", false},
		{"/v1/l402/node-stats", "/v1/l402/../../admin/kill", false},
	}
	for _, tt := range tests {
		got := matchEndpoint(tt.pattern, tt.path)
		if got != tt.want {
			t.Errorf("matchEndpoint(%q, %q) = %v, want %v", tt.pattern, tt.path, got, tt.want)
		}
	}
}
