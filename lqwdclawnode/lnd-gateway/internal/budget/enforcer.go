// Package budget enforces per-operation and daily rolling window spend limits.
// Budget checks are serialized via SQLite transactions to prevent race conditions.
package budget

import (
	"fmt"
	"sync"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
)

// Limits holds all budget limits.
type Limits struct {
	MaxChannelSizeSats  int64
	MaxPaymentSats      int64
	MaxRebalanceFeeSats int64
	MaxDailySpendSats   int64
	MaxFeeRateSatVB     int64
	MaxL402PaymentSats  int64 // Max sats for a single L402 client payment (default: 1000)
}

// Enforcer checks operations against budget limits.
type Enforcer struct {
	limits Limits
	audit  *audit.Logger
	mu     sync.Mutex // Serialize budget checks to prevent race conditions
}

// New creates a budget enforcer.
func New(limits Limits, auditLog *audit.Logger) *Enforcer {
	return &Enforcer{
		limits: limits,
		audit:  auditLog,
	}
}

// CheckResult is returned by Check with the decision.
type CheckResult struct {
	Allowed       bool
	Reason        string
	DailySpent    int64
	DailyRemaining int64
}

// Check validates an operation against per-op limits and the daily ceiling.
// This method is serialized — only one budget check runs at a time.
func (e *Enforcer) Check(opType string, amountSats int64, feeRateSatVB int64) (*CheckResult, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Per-operation limit check
	switch opType {
	case "channel_open":
		if amountSats > e.limits.MaxChannelSizeSats {
			return &CheckResult{
				Allowed: false,
				Reason:  fmt.Sprintf("channel size %d sats exceeds limit of %d sats", amountSats, e.limits.MaxChannelSizeSats),
			}, nil
		}
	case "payment":
		if amountSats > e.limits.MaxPaymentSats {
			return &CheckResult{
				Allowed: false,
				Reason:  fmt.Sprintf("payment %d sats exceeds limit of %d sats", amountSats, e.limits.MaxPaymentSats),
			}, nil
		}
	case "onchain_send":
		if amountSats > e.limits.MaxPaymentSats {
			return &CheckResult{
				Allowed: false,
				Reason:  fmt.Sprintf("on-chain send %d sats exceeds limit of %d sats", amountSats, e.limits.MaxPaymentSats),
			}, nil
		}
	case "rebalance":
		if amountSats > e.limits.MaxRebalanceFeeSats {
			return &CheckResult{
				Allowed: false,
				Reason:  fmt.Sprintf("rebalance fee %d sats exceeds limit of %d sats", amountSats, e.limits.MaxRebalanceFeeSats),
			}, nil
		}
	case "l402_payment":
		limit := e.limits.MaxL402PaymentSats
		if limit <= 0 {
			limit = 1000 // default 1000 sats
		}
		if amountSats > limit {
			return &CheckResult{
				Allowed: false,
				Reason:  fmt.Sprintf("L402 payment %d sats exceeds limit of %d sats", amountSats, limit),
			}, nil
		}
	}

	// On-chain fee rate guard
	if feeRateSatVB > 0 && e.limits.MaxFeeRateSatVB > 0 && feeRateSatVB > e.limits.MaxFeeRateSatVB {
		return &CheckResult{
			Allowed: false,
			Reason:  fmt.Sprintf("fee rate %d sat/vB exceeds limit of %d sat/vB — mempool fees too high, try later", feeRateSatVB, e.limits.MaxFeeRateSatVB),
		}, nil
	}

	// Daily rolling window check
	dailySpent, err := e.audit.DailySpend()
	if err != nil {
		return nil, fmt.Errorf("query daily spend: %w", err)
	}

	remaining := e.limits.MaxDailySpendSats - dailySpent
	if amountSats > remaining {
		return &CheckResult{
			Allowed:        false,
			Reason:         fmt.Sprintf("daily spend ceiling reached: %d/%d sats used, operation needs %d sats", dailySpent, e.limits.MaxDailySpendSats, amountSats),
			DailySpent:     dailySpent,
			DailyRemaining: remaining,
		}, nil
	}

	return &CheckResult{
		Allowed:        true,
		DailySpent:     dailySpent,
		DailyRemaining: remaining - amountSats,
	}, nil
}

// GetLimits returns the current budget limits (for health/info endpoints).
func (e *Enforcer) GetLimits() Limits {
	return e.limits
}
