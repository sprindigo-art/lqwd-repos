package l402

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestConcurrentConsume(t *testing.T) {
	s := testStore(t)

	// Setup: create a paid token ready for consumption
	err := s.CreateChallenge("race-hash", "mac", "inv", "/test", 10, time.Now().Add(1*time.Hour))
	if err != nil {
		t.Fatalf("CreateChallenge: %v", err)
	}
	err = s.MarkPaid("race-hash", "preimage-hex")
	if err != nil {
		t.Fatalf("MarkPaid: %v", err)
	}

	const N = 10
	var successes, failures atomic.Int64

	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(N)

	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			<-start
			_, err := s.Consume("race-hash")
			if err == nil {
				successes.Add(1)
			} else {
				failures.Add(1)
			}
		}()
	}

	close(start)
	wg.Wait()

	if got := successes.Load(); got != 1 {
		t.Errorf("expected exactly 1 successful consume, got %d", got)
	}
	if got := failures.Load(); got != int64(N-1) {
		t.Errorf("expected %d failed consumes, got %d", N-1, got)
	}
}
