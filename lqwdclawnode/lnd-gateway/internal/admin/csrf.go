package admin

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// CSRFMiddleware validates that X-CSRF-Token header matches csrf_token cookie
// on POST, PATCH, DELETE requests. GET/HEAD/OPTIONS pass through.
func CSRFMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Safe methods pass through
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}

		// Read csrf_token cookie
		cookie, err := r.Cookie("csrf_token")
		if err != nil || cookie.Value == "" {
			middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
				"ok":    false,
				"error": "missing CSRF cookie",
			})
			return
		}

		// Read X-CSRF-Token header
		header := r.Header.Get("X-CSRF-Token")
		if header == "" {
			middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
				"ok":    false,
				"error": "missing CSRF header",
			})
			return
		}

		// Constant-time comparison
		if subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(header)) != 1 {
			middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
				"ok":    false,
				"error": "CSRF token mismatch",
			})
			return
		}

		next.ServeHTTP(w, r)
	})
}

// GenerateCSRFToken creates a 32-byte crypto/rand base64url token.
func GenerateCSRFToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(b), nil
}
