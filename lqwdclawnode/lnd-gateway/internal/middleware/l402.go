package middleware

import (
	"context"
	"net/http"
	"path"
	"strings"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/l402"
)

const l402TokenKey contextKey = "l402Token"

// GetL402Token extracts the consumed L402 token from the request context.
func GetL402Token(ctx context.Context) *l402.Token {
	if v, ok := ctx.Value(l402TokenKey).(*l402.Token); ok {
		return v
	}
	return nil
}

// L402Auth returns middleware that validates L402 Authorization headers on /v1/l402/* routes.
// If the request has no Authorization header, it passes through (the handler will issue a 402 challenge).
// If the request has a valid L402 header, it verifies the macaroon + preimage and marks the token consumed.
func L402Auth(service *l402.Service, store *l402.Store) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")

			// No auth header → pass through to handler (which will issue 402 challenge)
			if auth == "" {
				next.ServeHTTP(w, r)
				return
			}

			// Must be L402 scheme
			if !strings.HasPrefix(auth, "L402 ") {
				WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "L402 endpoints require L402 authorization scheme",
				})
				return
			}

			// Parse "L402 <macaroon>:<preimage>"
			tokenStr := strings.TrimPrefix(auth, "L402 ")
			parts := strings.SplitN(tokenStr, ":", 2)
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
				WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "invalid L402 header format, expected: L402 <macaroon>:<preimage>",
				})
				return
			}
			macaroonB64, preimageHex := parts[0], parts[1]

			// Verify macaroon signature and extract caveats
			result, err := service.VerifyMacaroon(macaroonB64)
			if err != nil {
				WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "invalid macaroon: " + err.Error(),
				})
				return
			}

			// Verify preimage matches payment_hash (constant-time)
			if !l402.VerifyPreimage(preimageHex, result.PaymentHash) {
				WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "preimage does not match payment_hash",
				})
				return
			}

			// Check endpoint caveat matches request path
			if !matchEndpoint(result.Endpoint, r.URL.Path) {
				WriteJSON(w, http.StatusForbidden, map[string]any{
					"ok":    false,
					"error": "token not valid for this endpoint",
				})
				return
			}

			// Check method caveat
			if result.Method != "" && result.Method != r.Method {
				WriteJSON(w, http.StatusForbidden, map[string]any{
					"ok":    false,
					"error": "token not valid for this HTTP method",
				})
				return
			}

			// Consume the token (single-use enforcement + expiry check)
			token, err := store.Consume(result.PaymentHash)
			if err != nil {
				WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "token validation failed: " + err.Error(),
				})
				return
			}

			// Store the verified token in context for handlers (audit, rate limiting)
			ctx := context.WithValue(r.Context(), l402TokenKey, token)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// matchEndpoint checks if a request path matches the endpoint caveat pattern.
// Supports exact match and wildcard patterns like "/v1/l402/*".
func matchEndpoint(pattern, requestPath string) bool {
	pattern = path.Clean(pattern)
	requestPath = path.Clean(requestPath)
	if pattern == requestPath {
		return true
	}
	if strings.HasSuffix(pattern, "/*") {
		prefix := strings.TrimSuffix(pattern, "/*")
		return strings.HasPrefix(requestPath, prefix+"/")
	}
	return false
}
