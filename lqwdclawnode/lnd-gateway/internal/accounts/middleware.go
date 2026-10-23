package accounts

import (
	"context"
	"net/http"
	"strings"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

type agentContextKey struct{}
type keyHashContextKey struct{}

// SetAgent stores an authenticated agent in the request context.
func SetAgent(ctx context.Context, agent *Agent) context.Context {
	return context.WithValue(ctx, agentContextKey{}, agent)
}

// GetAgent extracts the authenticated agent from the request context.
func GetAgent(ctx context.Context) *Agent {
	if a, ok := ctx.Value(agentContextKey{}).(*Agent); ok {
		return a
	}
	return nil
}

// SetKeyHash stores the current API key hash in the request context.
// Used by RotateKey handler for optimistic concurrency check.
func SetKeyHash(ctx context.Context, hash string) context.Context {
	return context.WithValue(ctx, keyHashContextKey{}, hash)
}

// GetKeyHash extracts the API key hash from the request context.
func GetKeyHash(ctx context.Context) string {
	if h, ok := ctx.Value(keyHashContextKey{}).(string); ok {
		return h
	}
	return ""
}

// APIKeyAuth returns middleware that validates Bearer lqwd_... API keys.
// Extracts key from Authorization header, hashes with SHA-256, looks up in store.
// Injects authenticated agent and key hash into request context.
func APIKeyAuth(store AccountStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			if auth == "" || !strings.HasPrefix(auth, "Bearer lqwd_") {
				middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "missing or invalid API key",
				})
				return
			}

			rawKey := strings.TrimPrefix(auth, "Bearer ")
			keyHash := sha256Hex(rawKey)

			agent, err := store.Authenticate(r.Context(), keyHash)
			if err != nil || agent == nil {
				middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "invalid API key",
				})
				return
			}

			if agent.Status != "active" {
				middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
					"ok":    false,
					"error": "account suspended",
				})
				return
			}

			ctx := SetAgent(r.Context(), agent)
			ctx = SetKeyHash(ctx, keyHash)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
