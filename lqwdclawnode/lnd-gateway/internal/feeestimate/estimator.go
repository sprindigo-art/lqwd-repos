// Package feeestimate provides a background-polled Bitcoin fee-rate estimator
// sourced from a mempool.space-compatible recommended-fees endpoint. Phase 22
// REN-04 populator — produces the sat/vB value that the channel-faucet
// OpenChannel path passes to LND as SatPerVbyte AND persists onto the
// faucet_channels grant row so Plan 22-03's CAS surfaces it on
// /v1/internal/channel/status.
//
// Behavior (CONTEXT.md D-21..D-25):
//   - Startup synchronous fetch; on failure, boot with FallbackSatVB + warn.
//   - Background goroutine refreshes every PollInterval (default 1h).
//   - Mid-session fetch failures: keep last-known value, log warn (do NOT zero).
//   - Sanity clamp: values outside (1, 1000) are rejected; startup → fallback,
//     mid-session → keep last-known. Both paths log warn.
//   - Priority band: defaults to halfHourFee (med-high — ~30-min confirmation)
//     per user directive; overridable to fastestFee or hourFee via env.
//
// Thread safety: Current() is safe for concurrent callers. fetchOnce writes
// through a sync.RWMutex; Current() takes an RLock.
package feeestimate

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

// Config holds tunables for the estimator. Zero values trigger sensible
// defaults in New.
type Config struct {
	// MempoolAPIBase is the scheme+host+path prefix the estimator appends
	// "/v1/fees/recommended" to. Default: "https://mempool.space/api".
	MempoolAPIBase string
	// PollInterval is how often the background goroutine refreshes the
	// cached value after the synchronous startup fetch. Default: 1 hour.
	PollInterval time.Duration
	// PriorityBand selects which field of the mempool response is read.
	// One of "fastestFee", "halfHourFee", "hourFee". Default: "halfHourFee".
	PriorityBand string
	// FallbackSatVB is used when startup fetch fails or the clamp rejects
	// the value on startup. Also the pre-fetch initial value so Current()
	// never returns 0. Default: 20 sat/vB.
	FallbackSatVB int
	// Logger is used for info/warn events. Defaults to a stderr JSON logger.
	Logger *slog.Logger
	// HTTPClient is optional; tests inject a client pointed at httptest.
	// Default: 10-second timeout.
	HTTPClient *http.Client
}

// Estimator is a thread-safe holder for the most-recently observed Bitcoin
// fee rate (sat/vB). Construct with New, then call Start(ctx) once.
type Estimator struct {
	cfg     Config
	mu      sync.RWMutex
	current int
}

// New returns an Estimator with defaults applied for zero-valued Config
// fields. The returned estimator has Current() == FallbackSatVB until Start
// runs its initial fetch.
func New(cfg Config) *Estimator {
	if cfg.MempoolAPIBase == "" {
		cfg.MempoolAPIBase = "https://mempool.space/api"
	}
	if cfg.PollInterval == 0 {
		cfg.PollInterval = time.Hour
	}
	if cfg.PriorityBand == "" {
		cfg.PriorityBand = "halfHourFee"
	}
	if cfg.FallbackSatVB == 0 {
		cfg.FallbackSatVB = 20
	}
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.NewJSONHandler(os.Stderr, nil))
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Estimator{
		cfg:     cfg,
		current: cfg.FallbackSatVB,
	}
}

// Start performs a synchronous initial fetch (falling back to FallbackSatVB on
// error) and spawns a background goroutine that refreshes every PollInterval.
// The goroutine exits cleanly when ctx is cancelled.
func (e *Estimator) Start(ctx context.Context) {
	e.fetchOnce(ctx, true /* startup */)
	go e.loop(ctx)
}

// Current returns the most recently observed sat/vB, guaranteed > 0 (never
// returns 0 — the pre-fetch default is FallbackSatVB).
func (e *Estimator) Current() int {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.current
}

func (e *Estimator) loop(ctx context.Context) {
	t := time.NewTicker(e.cfg.PollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			e.fetchOnce(ctx, false /* mid-session */)
		}
	}
}

// fetchOnce performs a single GET against the mempool endpoint. startup=true
// toggles the "on failure, use fallback" path; startup=false preserves the
// last-known value on failure (D-23).
func (e *Estimator) fetchOnce(ctx context.Context, startup bool) {
	url := e.cfg.MempoolAPIBase + "/v1/fees/recommended"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		e.handleFailure(startup, fmt.Errorf("build request: %w", err))
		return
	}
	resp, err := e.cfg.HTTPClient.Do(req)
	if err != nil {
		e.handleFailure(startup, fmt.Errorf("http do: %w", err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		e.handleFailure(startup, fmt.Errorf("mempool status %d", resp.StatusCode))
		return
	}
	var fees map[string]json.Number
	if err := json.NewDecoder(resp.Body).Decode(&fees); err != nil {
		e.handleFailure(startup, fmt.Errorf("decode: %w", err))
		return
	}
	raw, ok := fees[e.cfg.PriorityBand]
	if !ok {
		e.handleFailure(startup, fmt.Errorf("priority band %q missing from response", e.cfg.PriorityBand))
		return
	}
	v, err := raw.Int64()
	if err != nil {
		e.handleFailure(startup, fmt.Errorf("band %q not numeric: %w", e.cfg.PriorityBand, err))
		return
	}
	satVB := int(v)
	// Sanity band per D-23: reject absurd values that would signal a
	// compromised / misconfigured upstream (1 sat/vB = min-relay floor,
	// 1000 sat/vB = pathological mempool spike). Inclusive bounds rejected.
	if satVB <= 1 || satVB >= 1000 {
		e.cfg.Logger.Warn("feeestimate: value out of sanity band; using fallback behavior",
			"value", satVB, "band", e.cfg.PriorityBand, "startup", startup)
		if startup {
			e.set(e.cfg.FallbackSatVB)
		}
		// mid-session: keep last-known (do nothing); caller already has a
		// non-zero value from either a prior successful fetch or the
		// FallbackSatVB seeded at construction time.
		return
	}
	e.set(satVB)
	e.cfg.Logger.Info("feeestimate: updated",
		"sat_vb", satVB, "band", e.cfg.PriorityBand, "startup", startup)
}

func (e *Estimator) handleFailure(startup bool, err error) {
	if startup {
		e.cfg.Logger.Warn("feeestimate: startup fetch failed; using fallback",
			"error", err, "fallback_sat_vb", e.cfg.FallbackSatVB)
		e.set(e.cfg.FallbackSatVB)
		return
	}
	e.cfg.Logger.Warn("feeestimate: mid-session fetch failed; keeping last-known",
		"error", err, "last_known_sat_vb", e.Current())
}

func (e *Estimator) set(v int) {
	e.mu.Lock()
	e.current = v
	e.mu.Unlock()
}
