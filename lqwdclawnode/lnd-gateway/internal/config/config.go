// Package config handles environment variable parsing and validation for the lnd-gateway.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all gateway configuration, parsed from environment variables.
type Config struct {
	// Server
	ListenAddr string // HTTP listen address (default: 127.0.0.1:7778)

	// Authentication (two-token system)
	AgentToken string // Token for OpenClaw agent (read + initiate writes)
	AdminToken string // Token for human/confirm-bot (confirm + admin ops)

	// LND connection
	LNDHost        string // LND gRPC host (default: 127.0.0.1:10009)
	TLSCertPath    string // Path to LND TLS cert
	MacaroonDir    string // Directory containing scoped macaroons
	ReadMacaroon   string // Filename for readonly macaroon (default: readonly.macaroon)
	InvMacaroon    string // Filename for invoice macaroon (default: invoice.macaroon)
	ChanMacaroon   string // Filename for channel-admin macaroon (default: channeladmin.macaroon)
	PayMacaroon    string // Filename for pay macaroon (default: pay.macaroon)

	// Budget enforcement
	MaxChannelSizeSats  int64 // Max sats for a single channel open
	MaxPaymentSats      int64 // Max sats for a single payment
	MaxRebalanceFeeSats int64 // Max sats fee for a rebalance
	MaxDailySpendSats   int64 // Max total outflow per rolling 24h window
	MaxFeeRateSatVB     int64 // Max on-chain fee rate (sat/vB) — reject above this

	// Rate limiting
	ReadRatePerMin  int // Max read requests per minute (default: 60)
	WriteRatePerMin int // Max write requests per minute (default: 10)

	// L402 client budget
	MaxL402PaymentSats int64 // Max sats for a single L402 client payment (default: 1000)

	// Mock mode
	MockMode bool // If true, return static mock responses instead of calling LND

	// Kill switch
	KillSwitchPath string // File path to check for kill switch (default: /etc/lnd-gateway/kill-switch)

	// Audit
	AuditDBPath    string // Path to SQLite audit database
	AuditFallback  string // Path to JSON fallback log

	// Confirmation
	ConfirmExpirySeconds int // How long a confirmation stays valid (default: 300)

	// L402 protocol
	L402Enabled       bool   // Enable L402 endpoints (default: false)
	L402SigningKey    string // Hex-encoded 32-byte key for macaroon HMAC signing
	L402TokenExpiry   int    // Token TTL in seconds (default: 86400 = 24h)
	L402InvoiceExpiry int    // Invoice expiry in seconds (default: 600 = 10min)
	L402DBPath        string // Path to L402 token SQLite database

	// Cloudflare Access (Phase 10)
	CFAccessTeam       string // CF Access team domain (e.g., "lqwd")
	CFAccessAUD        string // CF Access application audience tag
	InternalAuthSecret string // Shared secret for X-Internal-Auth header (32+ byte hex)

	// Account system (Phase 11-12)
	DatabaseURL        string // PostgreSQL connection string for account/credit storage
	FaucetDailyCapSats int64  // Global daily faucet grant cap in sats (default: 10000)

	// Proxy (Phase 13)
	ProxyEnabled             bool  // Enable credit proxy endpoints (default: true)
	ProxyPriceSats           int64 // Flat-rate cost per proxy call in sats (default: 10)
	ProxyUpstreamTimeoutSecs int   // Upstream call timeout in seconds (default: 30)

	// Channel faucet (Phase 14)
	// Defaults target the smallest viable channel for a faucet intro:
	//   - 20,000 sats matches LND's default minchansize floor
	//   - 1,354 push = 1,000 spendable + 354-sat p2wsh dust/reserve buffer
	//     (LND channel_reserve = max(1% of capacity, 354) = 354 for 20k caps)
	FaucetChannelSizeSats int64 // Channel size in sats (default: 20000)
	FaucetPushSats        int64 // Sats pushed to peer on open (default: 1354 = 1000 spendable + 354 dust)
	FaucetChannelCap      int   // Max total channel grants (default: 100)

	// FaucetPauseFilePath (Phase 21, 2026-04-22) is the flag-file path
	// whose presence pauses the channel faucet. When this file exists,
	// ReserveChannelSlot returns ErrFaucetPaused and /v1/discovery
	// surfaces faucet_paused=true in the channel_faucet block. The
	// file-flag design mirrors the kill-switch so pause state survives
	// gateway restarts and can be tripped by `touch` if Telegram is
	// unavailable. Faucet-only scope — operator channel-open/close/send
	// operations are unaffected.
	FaucetPauseFilePath string

	// Admin dashboard (Phase 15)
	AdminUsername     string // Dashboard login username
	AdminPasswordHash string // bcrypt hash of dashboard password

	// MCP (Phase 16)
	MCPBillingEnabled bool // Enable credit billing for MCP tool calls (default: false)
}

// Load reads configuration from environment variables with sensible defaults.
func Load() (*Config, error) {
	cfg := &Config{
		ListenAddr:           envOr("GATEWAY_LISTEN", "127.0.0.1:7778"),
		AgentToken:           os.Getenv("GATEWAY_AGENT_TOKEN"),
		AdminToken:           os.Getenv("GATEWAY_ADMIN_TOKEN"),
		LNDHost:              envOr("LND_GRPC_HOST", "127.0.0.1:10009"),
		TLSCertPath:          os.Getenv("LND_TLS_CERT_PATH"),
		MacaroonDir:          envOr("LND_MACAROON_DIR", "/lnd/data/chain/bitcoin/mainnet"),
		ReadMacaroon:         envOr("LND_READONLY_MACAROON", "readonly.macaroon"),
		InvMacaroon:          envOr("LND_INVOICE_MACAROON", "invoice.macaroon"),
		ChanMacaroon:         envOr("LND_CHANNEL_MACAROON", "channeladmin.macaroon"),
		PayMacaroon:          envOr("LND_PAY_MACAROON", "pay.macaroon"),
		MaxChannelSizeSats:   envInt64Or("MAX_CHANNEL_SIZE_SATS", 5_000_000),
		MaxPaymentSats:       envInt64Or("MAX_PAYMENT_SATS", 1_000_000),
		MaxRebalanceFeeSats:  envInt64Or("MAX_REBALANCE_FEE_SATS", 10_000),
		MaxDailySpendSats:    envInt64Or("MAX_DAILY_SPEND_SATS", 10_000_000),
		MaxFeeRateSatVB:      envInt64Or("MAX_FEE_RATE_SAT_VB", 100),
		ReadRatePerMin:       envIntOr("RATE_LIMIT_READ", 60),
		WriteRatePerMin:      envIntOr("RATE_LIMIT_WRITE", 10),
		MaxL402PaymentSats:   envInt64Or("MAX_L402_PAYMENT_SATS", 1000),
		MockMode:             envBool("GATEWAY_MOCK"),
		KillSwitchPath:       envOr("KILL_SWITCH_PATH", "/etc/lnd-gateway/kill-switch"),
		AuditDBPath:          envOr("AUDIT_DB_PATH", "data/audit.db"),
		AuditFallback:        envOr("AUDIT_FALLBACK_PATH", "data/audit-fallback.jsonl"),
		ConfirmExpirySeconds: envIntOr("CONFIRM_EXPIRY_SECONDS", 300),

		L402Enabled:       envBool("L402_ENABLED"),
		L402SigningKey:    os.Getenv("L402_SIGNING_KEY"),
		L402TokenExpiry:   envIntOr("L402_TOKEN_EXPIRY", 86400),
		L402InvoiceExpiry: envIntOr("L402_INVOICE_EXPIRY", 600),
		L402DBPath:        envOr("L402_DB_PATH", "data/l402.db"),

		CFAccessTeam:       os.Getenv("CF_ACCESS_TEAM"),
		CFAccessAUD:        os.Getenv("CF_ACCESS_AUD"),
		InternalAuthSecret: os.Getenv("INTERNAL_AUTH_SECRET"),

		DatabaseURL:        os.Getenv("DATABASE_URL"),
		FaucetDailyCapSats: envInt64Or("FAUCET_DAILY_CAP_SATS", 10000),

		ProxyEnabled:             !envBool("PROXY_DISABLED"),
		ProxyPriceSats:           envInt64Or("PROXY_PRICE_SATS", 10),
		ProxyUpstreamTimeoutSecs: envIntOr("PROXY_UPSTREAM_TIMEOUT_SECS", 30),

		FaucetChannelSizeSats: envInt64Or("FAUCET_CHANNEL_SIZE_SATS", 20_000),
		FaucetPushSats:        envInt64Or("FAUCET_PUSH_SATS", 1_354),
		FaucetChannelCap:      envIntOr("FAUCET_CHANNEL_CAP", 100),
		FaucetPauseFilePath:   envOr("FAUCET_PAUSE_FILE_PATH", "/var/lib/lnd-gateway/faucet-paused"),

		AdminUsername:     os.Getenv("ADMIN_USERNAME"),
		AdminPasswordHash: os.Getenv("ADMIN_PASSWORD_HASH"),

		MCPBillingEnabled: envBool("MCP_BILLING_ENABLED"),
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	var errs []string

	if !c.MockMode {
		if c.AgentToken == "" {
			errs = append(errs, "GATEWAY_AGENT_TOKEN is required")
		}
		if c.AdminToken == "" {
			errs = append(errs, "GATEWAY_ADMIN_TOKEN is required")
		}
		if c.AgentToken != "" && c.AgentToken == c.AdminToken {
			errs = append(errs, "GATEWAY_AGENT_TOKEN and GATEWAY_ADMIN_TOKEN must be different")
		}
		if c.TLSCertPath == "" {
			errs = append(errs, "LND_TLS_CERT_PATH is required when not in mock mode")
		}
	} else {
		// In mock mode, use placeholder tokens if not set
		if c.AgentToken == "" {
			c.AgentToken = "mock-agent-token"
		}
		if c.AdminToken == "" {
			c.AdminToken = "mock-admin-token"
		}
	}

	if c.L402Enabled && !c.MockMode {
		if c.L402SigningKey == "" {
			errs = append(errs, "L402_SIGNING_KEY is required when L402 is enabled (non-mock)")
		} else if len(c.L402SigningKey) != 64 {
			errs = append(errs, "L402_SIGNING_KEY must be 64 hex characters (32 bytes)")
		}
	}
	if c.L402Enabled && c.MockMode && c.L402SigningKey == "" {
		c.L402SigningKey = "0000000000000000000000000000000000000000000000000000000000000001"
	}

	// Internal auth: required if CF Access is configured, optional in mock
	if c.MockMode && c.InternalAuthSecret == "" {
		c.InternalAuthSecret = "mock-internal-secret"
	}

	if c.MaxChannelSizeSats <= 0 {
		errs = append(errs, "MAX_CHANNEL_SIZE_SATS must be positive")
	}
	if c.MaxPaymentSats <= 0 {
		errs = append(errs, "MAX_PAYMENT_SATS must be positive")
	}
	if c.MaxDailySpendSats <= 0 {
		errs = append(errs, "MAX_DAILY_SPEND_SATS must be positive")
	}

	if len(errs) > 0 {
		return fmt.Errorf("config validation failed:\n  %s", strings.Join(errs, "\n  "))
	}
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt64Or(key string, fallback int64) int64 {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.ParseInt(v, 10, 64); err == nil {
			return i
		}
	}
	return fallback
}

func envIntOr(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}

func envBool(key string) bool {
	v := strings.ToLower(os.Getenv(key))
	return v == "true" || v == "1" || v == "yes"
}
