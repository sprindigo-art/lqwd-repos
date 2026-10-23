// Package accounts manages agent registration, authentication, and credit ledger operations.
package accounts

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"
	"time"
)

var (
	// ErrFaucetChannelCap is returned when the global channel faucet cap is reached.
	ErrFaucetChannelCap = fmt.Errorf("channel faucet cap reached")
	// ErrPubkeyBanned is returned when a pubkey has been banned from the channel faucet.
	ErrPubkeyBanned = fmt.Errorf("pubkey banned from channel faucet")
	// Phase 21: faucet pause
	// ErrFaucetPaused is returned by ReserveChannelSlot when the faucet
	// pause flag file (config.FaucetPauseFilePath, default
	// /var/lib/lnd-gateway/faucet-paused) exists. The file's contents
	// (written by AdminFaucetPause) carry the pause reason + actor;
	// /v1/discovery surfaces that reason so honest agents don't waste a
	// /register attempt on a paused faucet. Faucet-only — operator
	// channel-open/close/send ops are unaffected.
	ErrFaucetPaused = fmt.Errorf("channel faucet is paused")
)

// FaucetBanAfterFailures is the number of consecutive failed channel-open
// attempts before a pubkey is banned from the faucet. Changed from 1 (ban-
// on-first-failure) to 3 on 2026-04-22 after a UAT session found that the
// single-failure ban is too aggressive: transient reachability glitches
// (firewall propagation delay, ConnectPeer retry races) permanently banned
// honest agents. 3 failures gives a sensible safety margin for typical
// transient issues while still protecting against abuse. Operator override
// via FAUCET_BAN_AFTER_FAILURES env var is supported by config.Load.
const FaucetBanAfterFailures = 3

// FailCategory classifies a fail_reason string into a machine-readable enum
// so agents (and operators) can distinguish recoverable from permanent
// failures without parsing free-text. Kept as a helper rather than a DB
// column to avoid a schema migration on hot production.
//
// Categories:
//   - connect_peer_failed   — could not reach the agent's advertised node_uri
//   - funding_rejected      — peer accepted the peer connection but rejected funding
//                             (commonly: missing alias, channel config, reserve)
//   - reserve_insufficient  — LQWD side's LND wallet lacks on-chain headroom
//   - timeout               — LND gRPC call timed out (deadline)
//   - validation            — malformed pubkey / node_uri
//   - unknown               — could not classify; check fail_reason
func FailCategory(failReason string) string {
	fr := strings.ToLower(failReason)
	switch {
	case strings.Contains(fr, "connect_peer") || strings.Contains(fr, "not online") || strings.Contains(fr, "no route to host"):
		return "connect_peer_failed"
	case strings.Contains(fr, "reserved wallet balance") || strings.Contains(fr, "insufficient funds for fee"):
		return "reserve_insufficient"
	case strings.Contains(fr, "channel request rejected") || strings.Contains(fr, "funding error") || strings.Contains(fr, "funding_error"):
		return "funding_rejected"
	case strings.Contains(fr, "timeout") || strings.Contains(fr, "context deadline exceeded"):
		return "timeout"
	case strings.Contains(fr, "invalid node_uri") || strings.Contains(fr, "invalid pubkey"):
		return "validation"
	case fr == "":
		return ""
	default:
		return "unknown"
	}
}

// ChannelGrant represents a channel faucet grant to an agent.
type ChannelGrant struct {
	ID           string     `json:"id"`
	AgentID      string     `json:"agent_id"`
	Pubkey       string     `json:"pubkey"`
	NodeURI      string     `json:"node_uri"`
	Status       string     `json:"status"` // pending, pending_open, open, failed, closed
	FundingTxID  string     `json:"funding_txid,omitempty"`
	OutputIndex  int        `json:"output_index,omitempty"`
	ChannelSize  int64      `json:"channel_size_sats"`
	PushAmount   int64      `json:"push_amount_sats"`
	FailReason   string     `json:"fail_reason,omitempty"`
	Banned       bool       `json:"banned"`
	// BannedUntil, when non-nil, represents a time-limited ban. The pubkey
	// is considered banned when (banned = TRUE) OR (banned_until IS NOT
	// NULL AND banned_until > NOW()). Added 2026-04-22 (Phase 21) to give
	// operators a time-bounded ban option instead of only the permanent
	// banned = TRUE binary.
	BannedUntil  *time.Time `json:"banned_until,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	OpenedAt     *time.Time `json:"opened_at,omitempty"`
	ClosedAt     *time.Time `json:"closed_at,omitempty"`
	ClosedReason string     `json:"closed_reason,omitempty"`
	// FundingFeeRateSatVB (Phase 22 REN-04): sat/vB the OpenChannel call
	// passed to LND for the funding tx, persisted at open-init time so
	// Plan 22-03's CAS transition propagates the value to
	// /v1/internal/channel/status. Nil when the fee-estimate subsystem
	// was absent (legacy / disabled), or when the grant row was created
	// before the populator landed. Sourced from internal/feeestimate
	// Estimator.Current().
	FundingFeeRateSatVB *int64 `json:"funding_fee_rate_sat_vb,omitempty"`
	// ChannelPoint (Phase 22 CHO-01): the on-chain funding outpoint
	// (funding_txid:output_index) as LND reports it, populated by the
	// Plan 22-03 CAS path on pending_open → open or pending_open → closed
	// transitions. Nil for pre-Phase-22 rows and for rows still in
	// pending_open (the funding tx has not confirmed yet, so LND has no
	// channel_point to give us). Sourced from lndparse.LiveChannelLookup.
	ChannelPoint *string `json:"channel_point,omitempty"`
}

// ValidatePubkey checks that a pubkey is a 66-character hex string.
func ValidatePubkey(pk string) bool {
	if len(pk) != 66 {
		return false
	}
	_, err := hex.DecodeString(pk)
	return err == nil
}

var (
	// ErrInsufficientCredits is returned when an agent lacks sufficient balance for a reserve.
	ErrInsufficientCredits = fmt.Errorf("insufficient credits")
	// ErrSpendCapExceeded is returned when the daily spend cap would be exceeded.
	ErrSpendCapExceeded = fmt.Errorf("daily spend cap exceeded")
)

// DefaultTier1GrantSats is the number of sats credited on Tier 1 registration.
const DefaultTier1GrantSats = 150

// DefaultTier2GrantSats is the number of sats credited on Tier 2 claim.
const DefaultTier2GrantSats = 500

// Tier1DailySpendCap is the max sats a Tier 1 agent can spend per day.
const Tier1DailySpendCap = int64(100)

// Tier2DailySpendCap is the max sats a Tier 2 agent can spend per day.
const Tier2DailySpendCap = int64(400)

// DefaultFaucetDailyCap is the global daily faucet grant limit in sats.
const DefaultFaucetDailyCap = int64(10000)

// DailySpendCapForTier returns the daily spend cap for the given tier.
func DailySpendCapForTier(tier int) int64 {
	switch tier {
	case 2:
		return Tier2DailySpendCap
	default:
		return Tier1DailySpendCap
	}
}

var (
	// ErrTooYoung is returned when an account is too new for Tier 2 claim.
	ErrTooYoung = fmt.Errorf("account age must be at least 1 hour")
	// ErrNameMismatch is returned when the provided name doesn't match registration.
	ErrNameMismatch = fmt.Errorf("provided name does not match registration name")
	// ErrFaucetCap is returned when the global daily faucet limit is reached.
	ErrFaucetCap = fmt.Errorf("daily faucet limit reached, try again tomorrow")
)

// base62Charset is used for API key token encoding.
const base62Charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// Agent represents a registered API agent.
type Agent struct {
	ID           string
	Name         string
	APIKeyHash   string
	IPAddress    string
	Tier         int
	Status       string // "active" or "suspended"
	CreatedAt    time.Time
	KeyRotatedAt *time.Time
	SuspendedAt  *time.Time
}

// AgentProfile is the public-facing agent profile returned by the API.
type AgentProfile struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	Tier             int       `json:"tier"`
	Status           string    `json:"status"`
	BalanceSats      int64     `json:"balance_sats"`
	SettledSats      int64     `json:"settled_sats"`
	ReservedSats     int64     `json:"reserved_sats"`
	AvailableSats    int64     `json:"available_sats"`
	DailySpendRemain int64     `json:"daily_spend_remaining"`
	CreatedAt        time.Time `json:"created_at"`
}

// TransactionEntry represents a single credit ledger entry.
type TransactionEntry struct {
	ID          string    `json:"id"`
	AmountSats  int64     `json:"amount_sats"`
	TxType      string    `json:"tx_type"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

// Tier2ClaimResult is the result of attempting a Tier 2 upgrade.
type Tier2ClaimResult struct {
	AlreadyClaimed bool  `json:"already_claimed"`
	GrantSats      int64 `json:"grant_sats"`
	NewTier        int   `json:"new_tier"`
}

// ReserveRequest holds parameters for a credit reservation.
type ReserveRequest struct {
	AgentID        string
	AmountSats     int64
	IdempotencyKey string
	Endpoint       string
	RequestID      string
}

// ReserveResult is returned from ReserveCredits.
type ReserveResult struct {
	ReserveID string          // UUID of the reserve ledger entry
	Cached    *CachedResponse // Non-nil if idempotency hit
}

// CachedResponse holds a previously-cached proxy response.
type CachedResponse struct {
	StatusCode   int
	ResponseBody string
}

// ChannelGrantEntry wraps ChannelGrant with the agent's display name.
type ChannelGrantEntry struct {
	ChannelGrant
	AgentName string `json:"agent_name"`
}

// AdminMetrics holds aggregate dashboard statistics.
type AdminMetrics struct {
	TotalAgents          int   `json:"total_agents"`
	TotalCreditsGranted  int64 `json:"total_credits_granted"`
	TotalL402Calls       int   `json:"total_l402_calls"`
	DailyFaucetSpend     int64 `json:"daily_faucet_spend"`
	TotalChannelsOpened  int   `json:"total_channels_opened"`
	ActiveChannels       int   `json:"active_channels"`
	TotalSatsPushed      int64 `json:"total_sats_pushed"`
	FaucetSlotsRemaining int   `json:"faucet_slots_remaining"`
}

// TimePoint represents a single time-series data point for charts.
type TimePoint struct {
	Bucket         time.Time `json:"bucket"`
	CreditsGranted int64     `json:"credits_granted"`
	L402Calls      int       `json:"l402_calls"`
}

// AgentListEntry is the admin view of an agent for the agent table.
type AgentListEntry struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Tier        int        `json:"tier"`
	BalanceSats int64      `json:"balance_sats"`
	Status      string     `json:"status"`
	LastActive  *time.Time `json:"last_active"`
	CreatedAt   time.Time  `json:"created_at"`
}

// AccountStore defines the contract for agent account operations.
type AccountStore interface {
	// Phase 11
	Register(ctx context.Context, name, ipAddr string) (*Agent, string, error)
	Authenticate(ctx context.Context, apiKeyHash string) (*Agent, error)
	Profile(ctx context.Context, agentID string) (*AgentProfile, error)
	RotateKey(ctx context.Context, agentID, currentKeyHash string) (string, error)
	CheckRegistrationLimit(ctx context.Context, ipAddr string) (bool, error)
	// Phase 12
	ClaimTier2(ctx context.Context, agentID, providedName string) (*Tier2ClaimResult, error)
	Transactions(ctx context.Context, agentID, cursor string, limit int) ([]TransactionEntry, string, error)
	DailySpendRemaining(ctx context.Context, agentID string, tier int) (int64, error)
	CheckFaucetCap(ctx context.Context, grantAmount int64) (bool, error)
	Close()
	// Phase 13
	ReserveCredits(ctx context.Context, req ReserveRequest) (*ReserveResult, error)
	SettleReserve(ctx context.Context, reserveID, idempotencyKey, endpoint string, statusCode int, responseBody string) error
	RefundReserve(ctx context.Context, reserveID, idempotencyKey, endpoint string) error
	CleanupOrphanedReserves(ctx context.Context, maxAge time.Duration) (int64, error)
	// Phase 15 -- Admin Dashboard
	ListAgents(ctx context.Context, search string, sortBy string, sortDir string, offset, limit int) ([]AgentListEntry, int, error)
	AggregateMetrics(ctx context.Context) (*AdminMetrics, error)
	TimeSeriesMetrics(ctx context.Context, rangeHours int) ([]TimePoint, error)
	GrantCredits(ctx context.Context, agentID string, amountSats int64, reason string) error
	SuspendAgent(ctx context.Context, agentID string) error
	UnsuspendAgent(ctx context.Context, agentID string) error
	// Phase 15.1 -- Dashboard Polish
	ListAllChannelGrants(ctx context.Context, status string, sortBy string, sortDir string, offset, limit int) ([]ChannelGrantEntry, int, error)
	// Phase 14 -- Channel Faucet
	ReserveChannelSlot(ctx context.Context, agentID, pubkey, nodeURI string, channelSize, pushAmount int64) (string, error)
	UpdateChannelStatus(ctx context.Context, grantID, status, fundingTxID, failReason string, outputIndex int) error
	GetChannelGrant(ctx context.Context, agentID string) (*ChannelGrant, error)
	GetChannelGrantByID(ctx context.Context, grantID string) (*ChannelGrant, error)
	ListPendingChannels(ctx context.Context) ([]ChannelGrant, error)
	ClearPubkeyBan(ctx context.Context, pubkey string) error

	// SetChannelFundingFeeRate (Phase 22 REN-04): persists the sat/vB the
	// OpenChannel call passed to LND onto the grant row's
	// funding_fee_rate_sat_vb column. Called exactly once per grant, by
	// openChannelAsync after a successful OpenChannel response. Plan
	// 22-03's CAS UPDATE surfaces this value in /v1/internal/channel/status.
	// Passing satVB<=0 is a no-op (defensive — avoids recording 0 as a
	// "real" rate when the estimator is nil / disabled).
	SetChannelFundingFeeRate(ctx context.Context, grantID string, satVB int64) error

	// UpdateChannelStatusCAS (Phase 22 CHO-01/CHO-02) atomically transitions
	// a grant from expectedStatus to newStatus only if the row's current
	// status still matches expectedStatus. Returns (true, nil) when the
	// UPDATE matched a row; (false, nil) when another writer (the poller,
	// or a concurrent request handler) already transitioned the row.
	// Callers that see (false, nil) must re-read via GetChannelGrant to
	// observe the authoritative current state.
	//
	// channelPoint is written unconditionally on a match; fundingFeeRateSatVB
	// is written only when non-nil (nil leaves the existing value unchanged).
	// This is the mitigation for the UAT-11 / UAT-12 stuck-pending bug class:
	// both the inline /v1/internal/channel/status handler and the background
	// poller funnel their transitions through this single CAS so neither can
	// clobber the other's write.
	UpdateChannelStatusCAS(ctx context.Context, grantID, expectedStatus, newStatus, channelPoint string, fundingFeeRateSatVB *int64) (bool, error)

	// BanPubkeyUntil sets a time-limited ban on a pubkey. When until is
	// nil, the ban is permanent (sets banned = TRUE). When until is a
	// future timestamp, sets banned_until = until (does NOT set banned =
	// TRUE, so the ban auto-expires at that time). Added 2026-04-22
	// (Phase 21) so operators can issue "ban for 1h/24h/7d" instead of
	// only the permanent ban the ClearPubkeyBan pathway assumes.
	BanPubkeyUntil(ctx context.Context, pubkey string, until *time.Time) error

	// FaucetChannelCapValue returns the configured maximum number of
	// active faucet channel grants. Needed by the Phase 21 faucet-admin
	// /faucet_config endpoint so the agent can surface runtime config
	// values without reading the gateway env file (which is not readable
	// by the agent user). Added 2026-04-22 (Phase 21).
	FaucetChannelCapValue() int

	// ResetIPRateLimit backdates all agents from this IP so the
	// registration rate-limit counter (COUNT(*) WHERE ip_address = ?
	// AND created_at > NOW() - INTERVAL '1 hour') no longer sees them.
	// Returns the number of rows affected. Added 2026-04-22 to replace
	// the manual SQL recipe operators had to run during UAT iteration.
	ResetIPRateLimit(ctx context.Context, ipAddr string) (int64, error)
}

// generateAPIKey creates a new API key with "lqwd_" prefix + 43-char base62 token.
// Uses crypto/rand for secure random generation.
func generateAPIKey() (string, error) {
	// Generate 32 random bytes
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}

	// Convert to base62
	num := new(big.Int).SetBytes(b)
	base := big.NewInt(int64(len(base62Charset)))

	var result strings.Builder
	result.Grow(43)
	for num.Sign() > 0 {
		mod := new(big.Int)
		num.DivMod(num, base, mod)
		result.WriteByte(base62Charset[mod.Int64()])
	}

	// Pad to 43 characters if needed
	for result.Len() < 43 {
		result.WriteByte(base62Charset[0])
	}

	token := result.String()
	// Truncate to exactly 43 if longer
	if len(token) > 43 {
		token = token[:43]
	}

	return "lqwd_" + token, nil
}

// sha256Hex returns the hex-encoded SHA-256 hash of a string.
func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// SHA256Hex is the exported version of sha256Hex for use by other packages.
func SHA256Hex(s string) string {
	return sha256Hex(s)
}
