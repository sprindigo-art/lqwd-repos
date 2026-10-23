package middleware

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	jose "gopkg.in/go-jose/go-jose.v2"
)

// setupMockCFAccess creates a mock JWKS server and returns a verifier, signing key, and issuer URL.
func setupMockCFAccess(t *testing.T) (*oidc.IDTokenVerifier, *rsa.PrivateKey, string) {
	t.Helper()

	// Generate RSA key pair
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}

	// Build JWKS JSON
	jwks := map[string]any{
		"keys": []map[string]any{
			{
				"kty": "RSA",
				"alg": "RS256",
				"use": "sig",
				"kid": "test-kid",
				"n":   base64urlEncode(key.PublicKey.N.Bytes()),
				"e":   base64urlEncode(big.NewInt(int64(key.PublicKey.E)).Bytes()),
			},
		},
	}
	jwksBytes, _ := json.Marshal(jwks)

	// Start mock JWKS + OIDC discovery server
	mux := http.NewServeMux()
	var serverURL string

	mux.HandleFunc("/cdn-cgi/access/certs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(jwksBytes)
	})
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"issuer":   serverURL,
			"jwks_uri": serverURL + "/cdn-cgi/access/certs",
		})
	})

	server := httptest.NewServer(mux)
	serverURL = server.URL
	t.Cleanup(server.Close)

	// Create OIDC key set and verifier
	keySet := oidc.NewRemoteKeySet(context.Background(), serverURL+"/cdn-cgi/access/certs")
	verifier := oidc.NewVerifier(serverURL, keySet, &oidc.Config{
		ClientID: "test-aud",
	})

	return verifier, key, serverURL
}

// signTestJWT creates a signed JWT with the given claims.
func signTestJWT(t *testing.T, key *rsa.PrivateKey, issuer, audience string, expiry time.Time) string {
	t.Helper()

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: key},
		(&jose.SignerOptions{}).WithHeader("kid", "test-kid"),
	)
	if err != nil {
		t.Fatalf("create signer: %v", err)
	}

	now := time.Now()
	claims := map[string]any{
		"iss": issuer,
		"aud": []string{audience},
		"exp": expiry.Unix(),
		"iat": now.Unix(),
		"sub": "test-service-token",
	}
	claimsJSON, _ := json.Marshal(claims)

	jws, err := signer.Sign(claimsJSON)
	if err != nil {
		t.Fatalf("sign JWT: %v", err)
	}

	compact, err := jws.CompactSerialize()
	if err != nil {
		t.Fatalf("serialize JWT: %v", err)
	}
	return compact
}

// base64urlEncode encodes bytes as base64url without padding.
func base64urlEncode(data []byte) string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	result := make([]byte, 0, (len(data)*8+5)/6)
	for i := 0; i < len(data); i += 3 {
		var val uint32
		remaining := len(data) - i
		switch {
		case remaining >= 3:
			val = uint32(data[i])<<16 | uint32(data[i+1])<<8 | uint32(data[i+2])
			result = append(result, alphabet[val>>18&0x3F], alphabet[val>>12&0x3F], alphabet[val>>6&0x3F], alphabet[val&0x3F])
		case remaining == 2:
			val = uint32(data[i])<<16 | uint32(data[i+1])<<8
			result = append(result, alphabet[val>>18&0x3F], alphabet[val>>12&0x3F], alphabet[val>>6&0x3F])
		case remaining == 1:
			val = uint32(data[i]) << 16
			result = append(result, alphabet[val>>18&0x3F], alphabet[val>>12&0x3F])
		}
	}
	return string(result)
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"ok":true}`))
	})
}

func TestCFAccessValidFlow(t *testing.T) {
	verifier, key, issuer := setupMockCFAccess(t)
	jwt := signTestJWT(t, key, issuer, "test-aud", time.Now().Add(5*time.Minute))

	handler := CFAccessAuth(verifier, "test-secret-value")(okHandler())
	req := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	req.Header.Set("Cf-Access-Jwt-Assertion", jwt)
	req.Header.Set("X-Internal-Auth", "test-secret-value")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCFAccessMissingJWT(t *testing.T) {
	verifier, _, _ := setupMockCFAccess(t)

	handler := CFAccessAuth(verifier, "test-secret-value")(okHandler())
	req := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	req.Header.Set("X-Internal-Auth", "test-secret-value")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}

	var body map[string]any
	json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "missing Cf-Access-Jwt-Assertion header" {
		t.Errorf("unexpected error: %v", body["error"])
	}
}

func TestCFAccessInvalidJWT(t *testing.T) {
	verifier, _, _ := setupMockCFAccess(t)

	handler := CFAccessAuth(verifier, "test-secret-value")(okHandler())
	req := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	req.Header.Set("Cf-Access-Jwt-Assertion", "not-a-valid-jwt")
	req.Header.Set("X-Internal-Auth", "test-secret-value")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}

	var body map[string]any
	json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "invalid CF Access token" {
		t.Errorf("unexpected error: %v", body["error"])
	}
}

func TestCFAccessWrongSecret(t *testing.T) {
	verifier, key, issuer := setupMockCFAccess(t)
	jwt := signTestJWT(t, key, issuer, "test-aud", time.Now().Add(5*time.Minute))

	handler := CFAccessAuth(verifier, "test-secret-value")(okHandler())
	req := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	req.Header.Set("Cf-Access-Jwt-Assertion", jwt)
	req.Header.Set("X-Internal-Auth", "wrong-secret")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}

	var body map[string]any
	json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "invalid internal auth" {
		t.Errorf("unexpected error: %v", body["error"])
	}
}

func TestCFAccessMissingSecret(t *testing.T) {
	verifier, key, issuer := setupMockCFAccess(t)
	jwt := signTestJWT(t, key, issuer, "test-aud", time.Now().Add(5*time.Minute))

	handler := CFAccessAuth(verifier, "test-secret-value")(okHandler())
	req := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	req.Header.Set("Cf-Access-Jwt-Assertion", jwt)
	// No X-Internal-Auth header

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}

	var body map[string]any
	json.NewDecoder(rec.Body).Decode(&body)
	if body["error"] != "invalid internal auth" {
		t.Errorf("unexpected error: %v", body["error"])
	}
}

func TestCFAccessNilVerifier(t *testing.T) {
	// When verifier is nil (CF not configured), only shared secret is checked
	handler := CFAccessAuth(nil, "dev-secret")(okHandler())

	// Valid secret should pass through
	req := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	req.Header.Set("X-Internal-Auth", "dev-secret")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 with nil verifier + correct secret, got %d: %s", rec.Code, rec.Body.String())
	}

	// Wrong secret should still fail
	req2 := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	req2.Header.Set("X-Internal-Auth", "wrong-secret")

	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusForbidden {
		t.Errorf("expected 403 with nil verifier + wrong secret, got %d", rec2.Code)
	}
}

func TestAuthSkipsInternal(t *testing.T) {
	// Auth middleware should pass /v1/internal/* through without Bearer token
	handler := Auth("agent-tok", "admin-tok")(okHandler())

	req := httptest.NewRequest("GET", "/v1/internal/node-stats", nil)
	// No Authorization header

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200 for /v1/internal/ without Bearer, got %d: %s", rec.Code, rec.Body.String())
	}
}
