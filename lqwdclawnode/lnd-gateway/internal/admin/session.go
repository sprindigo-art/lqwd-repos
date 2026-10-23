// Package admin provides session auth, CSRF middleware, rate limiting, and API handlers
// for the admin dashboard.
package admin

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"sync"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// Session holds data for a logged-in admin session.
type Session struct {
	Username  string
	CreatedAt time.Time
	ExpiresAt time.Time
}

// SessionStore manages opaque session tokens in memory.
type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewSessionStore creates a new in-memory session store.
func NewSessionStore() *SessionStore {
	return &SessionStore{
		sessions: make(map[string]*Session),
	}
}

// Create generates a crypto/rand 32-byte base64url token and stores the session.
func (s *SessionStore) Create(username string, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.URLEncoding.EncodeToString(b)
	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[token] = &Session{
		Username:  username,
		CreatedAt: now,
		ExpiresAt: now.Add(ttl),
	}
	return token, nil
}

// Validate checks that a token exists and has not expired.
// Lazy cleanup: removes expired sessions on access.
func (s *SessionStore) Validate(token string) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()

	sess, ok := s.sessions[token]
	if !ok {
		return nil
	}
	if time.Now().After(sess.ExpiresAt) {
		delete(s.sessions, token)
		return nil
	}
	return sess
}

// Delete removes a session (logout).
func (s *SessionStore) Delete(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
}

type adminContextKey string

const usernameKey adminContextKey = "admin_username"

// SessionAuth returns middleware that validates the "session" cookie.
// On success, stores the admin username in context.
func SessionAuth(store *SessionStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie("session")
			if err != nil || cookie.Value == "" {
				middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "unauthorized",
				})
				return
			}

			sess := store.Validate(cookie.Value)
			if sess == nil {
				middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
					"ok":    false,
					"error": "unauthorized",
				})
				return
			}

			ctx := context.WithValue(r.Context(), usernameKey, sess.Username)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetAdminUsername extracts the admin username from context.
func GetAdminUsername(ctx context.Context) string {
	if v, ok := ctx.Value(usernameKey).(string); ok {
		return v
	}
	return ""
}
