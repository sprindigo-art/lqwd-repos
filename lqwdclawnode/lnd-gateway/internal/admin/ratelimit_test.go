package admin

import (
	"testing"
	"time"
)

func TestRateLimiter_AllowsUnderLimit(t *testing.T) {
	rl := NewLoginRateLimiter(5, 15*time.Minute)

	for i := 0; i < 4; i++ {
		rl.RecordFailure("1.2.3.4")
	}

	allowed, _ := rl.Allow("1.2.3.4")
	if !allowed {
		t.Error("expected allowed with 4 failures (limit is 5)")
	}
}

func TestRateLimiter_BlocksOverLimit(t *testing.T) {
	rl := NewLoginRateLimiter(5, 15*time.Minute)

	for i := 0; i < 5; i++ {
		rl.RecordFailure("1.2.3.4")
	}

	allowed, retryAfter := rl.Allow("1.2.3.4")
	if allowed {
		t.Error("expected blocked after 5 failures")
	}
	if retryAfter <= 0 {
		t.Error("expected positive retryAfter duration")
	}

	// Different IP should still be allowed
	allowed, _ = rl.Allow("5.6.7.8")
	if !allowed {
		t.Error("expected different IP to be allowed")
	}
}

func TestRateLimiter_ResetClearsAttempts(t *testing.T) {
	rl := NewLoginRateLimiter(5, 15*time.Minute)

	for i := 0; i < 5; i++ {
		rl.RecordFailure("1.2.3.4")
	}

	rl.Reset("1.2.3.4")

	allowed, _ := rl.Allow("1.2.3.4")
	if !allowed {
		t.Error("expected allowed after reset")
	}
}
