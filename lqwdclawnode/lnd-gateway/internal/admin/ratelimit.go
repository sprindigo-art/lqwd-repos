package admin

import (
	"sync"
	"time"
)

// attemptRecord tracks login failure attempts for a single IP.
type attemptRecord struct {
	count   int
	firstAt time.Time
}

// LoginRateLimiter tracks failed login attempts by IP.
// Blocks after maxAttempts failures within window duration.
type LoginRateLimiter struct {
	mu          sync.Mutex
	attempts    map[string]*attemptRecord
	maxAttempts int
	window      time.Duration
}

// NewLoginRateLimiter creates a rate limiter with the given threshold and window.
func NewLoginRateLimiter(maxAttempts int, window time.Duration) *LoginRateLimiter {
	return &LoginRateLimiter{
		attempts:    make(map[string]*attemptRecord),
		maxAttempts: maxAttempts,
		window:      window,
	}
}

// Allow checks if the IP is allowed to attempt login.
// Returns (allowed, retryAfter). If blocked, retryAfter indicates when the window expires.
func (l *LoginRateLimiter) Allow(ip string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	rec, ok := l.attempts[ip]
	if !ok {
		return true, 0
	}

	// If window expired, reset
	if time.Since(rec.firstAt) > l.window {
		delete(l.attempts, ip)
		return true, 0
	}

	if rec.count >= l.maxAttempts {
		retryAfter := l.window - time.Since(rec.firstAt)
		return false, retryAfter
	}
	return true, 0
}

// RecordFailure increments the failure count for an IP.
func (l *LoginRateLimiter) RecordFailure(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	rec, ok := l.attempts[ip]
	if !ok || time.Since(rec.firstAt) > l.window {
		l.attempts[ip] = &attemptRecord{count: 1, firstAt: time.Now()}
		return
	}
	rec.count++
}

// Reset clears attempts for an IP (called on successful login).
func (l *LoginRateLimiter) Reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, ip)
}
