package middleware

import (
	"crypto/subtle"
	"net/http"

	"github.com/coreos/go-oidc/v3/oidc"
)

// CFAccessAuth returns per-route middleware that validates both:
// 1. Cf-Access-Jwt-Assertion header (JWT signed by CF Access)
// 2. X-Internal-Auth header (shared secret)
// Both MUST be valid -- 403 if either fails (defense-in-depth per D-05).
//
// If verifier is nil (CF Access not configured), only the shared secret
// is checked. This allows dev/mock mode without Cloudflare infrastructure.
func CFAccessAuth(verifier *oidc.IDTokenVerifier, internalSecret string) func(http.Handler) http.Handler {
	secretBytes := []byte(internalSecret)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// 1. Validate CF Access JWT (skip if verifier is nil -- dev/mock mode)
			if verifier != nil {
				accessJWT := r.Header.Get("Cf-Access-Jwt-Assertion")
				if accessJWT == "" {
					WriteJSON(w, http.StatusForbidden, map[string]any{
						"ok":    false,
						"error": "missing Cf-Access-Jwt-Assertion header",
					})
					return
				}

				_, err := verifier.Verify(r.Context(), accessJWT)
				if err != nil {
					WriteJSON(w, http.StatusForbidden, map[string]any{
						"ok":    false,
						"error": "invalid CF Access token",
					})
					return
				}
			}

			// 2. Validate shared secret (constant-time comparison per D-04)
			secret := r.Header.Get("X-Internal-Auth")
			if subtle.ConstantTimeCompare([]byte(secret), secretBytes) != 1 {
				WriteJSON(w, http.StatusForbidden, map[string]any{
					"ok":    false,
					"error": "invalid internal auth",
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
