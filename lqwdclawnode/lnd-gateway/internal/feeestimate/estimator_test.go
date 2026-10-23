package feeestimate

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// fakeMempool returns an httptest.Server that responds with the given body and
// status code for every request. Used to inject deterministic fee-recommendation
// responses into the estimator without reaching out to mempool.space.
func fakeMempool(t *testing.T, body string, status int) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		fmt.Fprint(w, body)
	}))
}

func TestFetchHappyPath(t *testing.T) {
	srv := fakeMempool(t, `{"fastestFee":37,"halfHourFee":32,"hourFee":28,"economyFee":20,"minimumFee":1}`, 200)
	defer srv.Close()
	e := New(Config{MempoolAPIBase: srv.URL, FallbackSatVB: 20})
	e.Start(context.Background())
	if got := e.Current(); got != 32 {
		t.Errorf("Current=%d want 32 (halfHourFee)", got)
	}
}

func TestFetchFailureUsesFallback(t *testing.T) {
	srv := fakeMempool(t, `<html>500</html>`, 500)
	defer srv.Close()
	e := New(Config{MempoolAPIBase: srv.URL, FallbackSatVB: 20})
	e.Start(context.Background())
	if got := e.Current(); got != 20 {
		t.Errorf("Current=%d want fallback 20", got)
	}
}

func TestClampOutOfBandHighStartup(t *testing.T) {
	srv := fakeMempool(t, `{"halfHourFee":5000}`, 200)
	defer srv.Close()
	e := New(Config{MempoolAPIBase: srv.URL, FallbackSatVB: 20})
	e.Start(context.Background())
	if got := e.Current(); got != 20 {
		t.Errorf("Current=%d want fallback 20 after clamp-high", got)
	}
}

func TestClampOutOfBandLowStartup(t *testing.T) {
	srv := fakeMempool(t, `{"halfHourFee":0}`, 200)
	defer srv.Close()
	e := New(Config{MempoolAPIBase: srv.URL, FallbackSatVB: 20})
	e.Start(context.Background())
	if got := e.Current(); got != 20 {
		t.Errorf("Current=%d want fallback 20 after clamp-low", got)
	}
}

func TestBandSelection(t *testing.T) {
	body := `{"fastestFee":37,"halfHourFee":32,"hourFee":28}`
	for _, tc := range []struct {
		band string
		want int
	}{
		{"fastestFee", 37},
		{"halfHourFee", 32},
		{"hourFee", 28},
	} {
		t.Run(tc.band, func(t *testing.T) {
			srv := fakeMempool(t, body, 200)
			defer srv.Close()
			e := New(Config{MempoolAPIBase: srv.URL, PriorityBand: tc.band, FallbackSatVB: 20})
			e.Start(context.Background())
			if got := e.Current(); got != tc.want {
				t.Errorf("band=%s Current=%d want %d", tc.band, got, tc.want)
			}
		})
	}
}

func TestMissingBandKeepsFallback(t *testing.T) {
	// halfHourFee is absent; estimator should fall back to FallbackSatVB on startup.
	srv := fakeMempool(t, `{"fastestFee":37,"hourFee":28}`, 200)
	defer srv.Close()
	e := New(Config{MempoolAPIBase: srv.URL, PriorityBand: "halfHourFee", FallbackSatVB: 17})
	e.Start(context.Background())
	if got := e.Current(); got != 17 {
		t.Errorf("Current=%d want 17 when band missing", got)
	}
}

func TestConcurrentCurrent(t *testing.T) {
	srv := fakeMempool(t, `{"halfHourFee":32}`, 200)
	defer srv.Close()
	e := New(Config{MempoolAPIBase: srv.URL, PollInterval: 5 * time.Millisecond, FallbackSatVB: 20})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e.Start(ctx)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 200; j++ {
				_ = e.Current()
			}
		}()
	}
	wg.Wait()
	if got := e.Current(); got < 1 {
		t.Errorf("Current=%d after concurrency; expected > 0", got)
	}
}

// TestMidSessionFailureKeepsLastKnown exercises the mid-session fetch-failure
// path: first response is healthy, a subsequent poll fails, Current() must keep
// the last-known healthy value rather than zeroing or reverting to fallback.
func TestMidSessionFailureKeepsLastKnown(t *testing.T) {
	var mu sync.Mutex
	callCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		callCount++
		n := callCount
		mu.Unlock()
		if n == 1 {
			w.WriteHeader(200)
			fmt.Fprint(w, `{"halfHourFee":42}`)
			return
		}
		w.WriteHeader(500)
		fmt.Fprint(w, `boom`)
	}))
	defer srv.Close()

	e := New(Config{MempoolAPIBase: srv.URL, PollInterval: 10 * time.Millisecond, FallbackSatVB: 20})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e.Start(ctx)
	// Startup (call #1) landed 42. Wait for at least one failing poll.
	time.Sleep(60 * time.Millisecond)
	if got := e.Current(); got != 42 {
		t.Errorf("Current=%d want 42 (last-known preserved on mid-session failure)", got)
	}
}
