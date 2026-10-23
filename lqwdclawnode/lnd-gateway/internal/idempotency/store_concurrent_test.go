package idempotency

import (
	"sync"
	"sync/atomic"
	"testing"
)

func TestConcurrentCheckAndReserve(t *testing.T) {
	s := setupTestStore(t)

	const N = 10
	var reserved, rejected atomic.Int64

	start := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(N)

	for i := 0; i < N; i++ {
		go func() {
			defer wg.Done()
			<-start
			cached, err := s.CheckAndReserve("race-key", "/v1/test")
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if cached == nil {
				reserved.Add(1)
			} else {
				rejected.Add(1)
			}
		}()
	}

	close(start)
	wg.Wait()

	if got := reserved.Load(); got != 1 {
		t.Errorf("expected exactly 1 reservation, got %d", got)
	}
	if got := rejected.Load(); got != int64(N-1) {
		t.Errorf("expected %d rejections, got %d", N-1, got)
	}
}
