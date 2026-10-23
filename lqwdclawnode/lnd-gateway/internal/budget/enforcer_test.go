package budget

import (
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
)

func setupTestEnforcer(t *testing.T, limits Limits) *Enforcer {
	t.Helper()
	dir := t.TempDir()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	auditLog, err := audit.New(
		filepath.Join(dir, "audit.db"),
		filepath.Join(dir, "fallback.jsonl"),
		logger, nil, 0,
	)
	if err != nil {
		t.Fatalf("audit.New: %v", err)
	}
	t.Cleanup(func() { auditLog.Close() })
	return New(limits, auditLog)
}

func TestPerOpLimits(t *testing.T) {
	e := setupTestEnforcer(t, Limits{
		MaxChannelSizeSats:  1_000_000,
		MaxPaymentSats:      500_000,
		MaxRebalanceFeeSats: 5_000,
		MaxDailySpendSats:   10_000_000,
		MaxFeeRateSatVB:     100,
		MaxL402PaymentSats:  500,
	})

	tests := []struct {
		name    string
		opType  string
		amount  int64
		feeRate int64
		allowed bool
	}{
		{"channel under limit", "channel_open", 500_000, 0, true},
		{"channel at limit", "channel_open", 1_000_000, 0, true},
		{"channel over limit", "channel_open", 1_000_001, 0, false},
		{"payment under limit", "payment", 100_000, 0, true},
		{"payment over limit", "payment", 500_001, 0, false},
		{"onchain under limit", "onchain_send", 500_000, 0, true},
		{"onchain over limit", "onchain_send", 500_001, 0, false},
		{"rebalance under limit", "rebalance", 5_000, 0, true},
		{"rebalance over limit", "rebalance", 5_001, 0, false},
		{"fee rate under limit", "channel_open", 100_000, 50, true},
		{"fee rate at limit", "channel_open", 100_000, 100, true},
		{"fee rate over limit", "channel_open", 100_000, 101, false},
		{"l402 under limit", "l402_payment", 500, 0, true},
		{"l402 over limit", "l402_payment", 501, 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := e.Check(tt.opType, tt.amount, tt.feeRate)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Allowed != tt.allowed {
				t.Errorf("expected Allowed=%v, got %v (reason: %s)", tt.allowed, result.Allowed, result.Reason)
			}
		})
	}
}

func TestDailyCeiling(t *testing.T) {
	e := setupTestEnforcer(t, Limits{
		MaxChannelSizeSats:  10_000_000,
		MaxPaymentSats:      10_000_000,
		MaxRebalanceFeeSats: 10_000_000,
		MaxDailySpendSats:   1_000_000,
		MaxFeeRateSatVB:     1000,
	})

	// First check — should have full budget
	result, err := e.Check("payment", 500_000, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Fatal("first 500k payment should be allowed")
	}

	// Simulate spending by logging to audit DB
	e.audit.Log(audit.Entry{
		Endpoint:     "payment",
		Method:       "POST",
		TokenLevel:   "agent",
		ResponseCode: 200,
		AmountSats:   800_000,
		OpType:       "payment",
	})

	// Now check a 300k payment — should exceed daily ceiling (800k + 300k > 1M)
	result, err = e.Check("payment", 300_000, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Allowed {
		t.Error("should be blocked by daily ceiling")
	}

	// But a 200k payment should still fit (800k + 200k = 1M)
	result, err = e.Check("payment", 200_000, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Errorf("200k should fit in daily ceiling, reason: %s", result.Reason)
	}
}
