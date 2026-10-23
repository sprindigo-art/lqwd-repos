package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RateLimiter implements a token bucket rate limiter per endpoint category.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	read    int // tokens per minute for read endpoints
	write   int // tokens per minute for write endpoints
}

type bucket struct {
	tokens    float64
	maxTokens float64
	refillRate float64 // tokens per second
	lastRefill time.Time
}

// NewRateLimiter creates a rate limiter with per-minute limits for read and write endpoints.
func NewRateLimiter(readPerMin, writePerMin int) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*bucket),
		read:    readPerMin,
		write:   writePerMin,
	}
}

// Middleware returns HTTP middleware that enforces rate limits.
// isWrite is a function that determines if a path is a write operation.
func (rl *RateLimiter) Middleware(isWrite func(path string) bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Health + discovery endpoints are exempt (detailed is Caddy-gated
			// externally). MCP endpoint is exempt — billing + per-agent caps
			// enforce at the tool-call layer, gateway-wide rate-limit would
			// throttle legitimate streaming traffic.
			if r.URL.Path == "/v1/health" || r.URL.Path == "/v1/health/detailed" ||
				r.URL.Path == "/v1/discovery" ||
				strings.HasPrefix(r.URL.Path, "/v1/mcp") {
				next.ServeHTTP(w, r)
				return
			}

			category := "read"
			limit := rl.read
			if isWrite(r.URL.Path) {
				category = "write"
				limit = rl.write
			}

			if !rl.allow(category, limit) {
				retryAfter := 60 / limit
				if retryAfter < 1 {
					retryAfter = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				WriteJSON(w, http.StatusTooManyRequests, map[string]any{
					"ok":          false,
					"error":       "rate_limit_exceeded",
					"message":     "Too many requests. Slow down.",
					"retry_after": retryAfter,
				})
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func (rl *RateLimiter) allow(category string, perMin int) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[category]
	if !ok {
		maxTokens := float64(perMin)
		b = &bucket{
			tokens:     maxTokens,
			maxTokens:  maxTokens,
			refillRate: maxTokens / 60.0, // tokens per second
			lastRefill: time.Now(),
		}
		rl.buckets[category] = b
	}

	// Refill tokens based on elapsed time
	now := time.Now()
	elapsed := now.Sub(b.lastRefill).Seconds()
	b.tokens += elapsed * b.refillRate
	if b.tokens > b.maxTokens {
		b.tokens = b.maxTokens
	}
	b.lastRefill = now

	if b.tokens < 1.0 {
		return false
	}

	b.tokens -= 1.0
	return true
}
