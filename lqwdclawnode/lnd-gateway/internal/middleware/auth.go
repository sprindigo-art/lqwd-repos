// Package middleware provides HTTP middleware for the lnd-gateway.
package middleware

import (
	"context"
	"net/http"
	"strings"
)

// TokenLevel represents the authorization level of a request.
type TokenLevel int

const (
	TokenNone  TokenLevel = iota
	TokenAgent            // Can read + initiate writes
	TokenAdmin            // Can confirm + admin operations
)

type contextKey string

const tokenLevelKey contextKey = "tokenLevel"

// Auth returns middleware that validates Bearer tokens.
// Two-token system: agent token (OpenClaw) and admin token (human/confirm-bot).
func Auth(agentToken, adminToken string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Health + discovery endpoints are always public (Caddy allowlist
			// gates /v1/health/detailed externally — localhost/VM operators
			// read the full operational snapshot directly).
			if r.URL.Path == "/v1/health" || r.URL.Path == "/v1/health/detailed" ||
				r.URL.Path == "/v1/discovery" {
				ctx := context.WithValue(r.Context(), tokenLevelKey, TokenNone)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// L402 endpoints use their own auth scheme (not Bearer)
			if strings.HasPrefix(r.URL.Path, "/v1/l402/") {
				ctx := context.WithValue(r.Context(), tokenLevelKey, TokenNone)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// MCP endpoint uses its own Bearer API-key auth scheme (not the
			// gateway's agent/admin Bearer tokens). See mcpserver/server.go.
			if strings.HasPrefix(r.URL.Path, "/v1/mcp") {
				ctx := context.WithValue(r.Context(), tokenLevelKey, TokenNone)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Internal endpoints use CF Access auth (not Bearer)
			if strings.HasPrefix(r.URL.Path, "/v1/internal/") {
				ctx := context.WithValue(r.Context(), tokenLevelKey, TokenNone)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Admin dashboard uses session-based auth (not Bearer)
			if strings.HasPrefix(r.URL.Path, "/admin/") {
				ctx := context.WithValue(r.Context(), tokenLevelKey, TokenNone)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			auth := r.Header.Get("Authorization")
			if auth == "" {
				WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "missing Authorization header",
				})
				return
			}

			token := strings.TrimPrefix(auth, "Bearer ")
			if token == auth {
				WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "Authorization header must use Bearer scheme",
				})
				return
			}

			var level TokenLevel
			switch token {
			case adminToken:
				level = TokenAdmin
			case agentToken:
				level = TokenAgent
			default:
				WriteJSON(w, http.StatusForbidden, map[string]any{
					"ok":    false,
					"error": "invalid token",
				})
				return
			}

			ctx := context.WithValue(r.Context(), tokenLevelKey, level)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireAdmin rejects requests not using the admin token.
// Apply to /v1/confirm/* and /v1/admin/* endpoints.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if GetTokenLevel(r.Context()) != TokenAdmin {
			WriteJSON(w, http.StatusForbidden, map[string]any{
				"ok":    false,
				"error": "this endpoint requires the admin token",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// GetTokenLevel extracts the token level from the request context.
func GetTokenLevel(ctx context.Context) TokenLevel {
	if v, ok := ctx.Value(tokenLevelKey).(TokenLevel); ok {
		return v
	}
	return TokenNone
}

// SetTokenLevel stores a token level in a context. Used by tests.
func SetTokenLevel(ctx context.Context, level TokenLevel) context.Context {
	return context.WithValue(ctx, tokenLevelKey, level)
}
