// lnd-gateway is the HTTP/JSON gateway to LND for the LQWDClaw-NodeOps system.
// It exposes a controlled API surface with budget enforcement, idempotency,
// rate limiting, confirmation flows, and audit logging.
//
// The agent (OpenClaw) talks to this gateway via curl — never directly to LND.
package main

import (
	"context"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	adminweb "github.com/lqwdtech/lqwdclawnode/lnd-gateway/admin"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/accounts"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/admin"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/budget"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/confirm"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/config"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/feeestimate"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/handlers"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/idempotency"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/killswitch"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/l402"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mcpserver"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// Version is overridden at build time via
//
//	-ldflags "-X main.Version=$(git describe --tags --always --dirty)"
//
// See lqwdclawnode/scripts/deploy-gateway.sh build_binary() for the injection.
// Defaults to "dev" for local builds without ldflags. Surfaced on every
// response through the middleware.GatewayVersion chain wrap (Phase 22 SKL-03).
var Version = "dev"

func main() {
	fmt.Println("  LQWDClaw-NodeOps Gateway — LQWD Technologies Corp.")

	// Structured JSON logger (stderr so stdout stays clean for banner)
	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))

	// Load config
	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Assert env config matches the public advertisement in /v1/discovery.
	// Fail-fast on drift — a gateway that promises 20k/1354 in the catalog
	// but runs with FAUCET_CHANNEL_SIZE_SATS=100000 produces silent LND
	// failures ("reserved wallet balance invalidated" during OpenChannel)
	// that exhaust the wallet's anchor reserve headroom. This exact drift
	// caused 3+ hours of UAT debugging on 2026-04-21. The only cure is a
	// refuse-to-start at boot so ops sees the problem immediately.
	if err := handlers.ValidateAdvertisementConsistency(cfg.FaucetChannelSizeSats, cfg.FaucetPushSats); err != nil {
		logger.Error("channel-faucet advertisement mismatch — gateway refusing to start", "error", err)
		os.Exit(1)
	}

	if cfg.MockMode {
		logger.Info("starting in MOCK mode — no real LND connection")
	}

	// Initialize kill switch early — audit logger needs it for post-hoc budget check
	ks := killswitch.New(cfg.KillSwitchPath)

	// Initialize audit logger
	auditLog, err := audit.New(cfg.AuditDBPath, cfg.AuditFallback, logger, ks, cfg.MaxDailySpendSats)
	if err != nil {
		logger.Error("failed to initialize audit logger", "error", err)
		os.Exit(1)
	}
	defer auditLog.Close()

	// Initialize idempotency store (separate DB to avoid lock contention with audit)
	idempDBPath := filepath.Join(filepath.Dir(cfg.AuditDBPath), "idempotency.db")
	idempStore, err := idempotency.New(idempDBPath, logger)
	if err != nil {
		logger.Error("failed to initialize idempotency store", "error", err)
		os.Exit(1)
	}
	defer idempStore.Close()

	// Initialize L402 subsystem (if enabled)
	var l402Store *l402.Store
	var l402Service *l402.Service
	if cfg.L402Enabled {
		l402DBPath := filepath.Join(filepath.Dir(cfg.AuditDBPath), "l402.db")
		if cfg.L402DBPath != "" && cfg.L402DBPath != "data/l402.db" {
			l402DBPath = cfg.L402DBPath
		}
		var err error
		l402Store, err = l402.NewStore(l402DBPath, logger)
		if err != nil {
			logger.Error("failed to initialize L402 store", "error", err)
			os.Exit(1)
		}
		defer l402Store.Close()

		l402Service, err = l402.NewService(cfg.L402SigningKey)
		if err != nil {
			logger.Error("failed to initialize L402 service", "error", err)
			os.Exit(1)
		}
		logger.Info("L402 protocol enabled", "token_expiry_s", cfg.L402TokenExpiry, "invoice_expiry_s", cfg.L402InvoiceExpiry)
	}

	// Initialize CF Access verifier (if configured)
	var cfVerifier *oidc.IDTokenVerifier
	if cfg.CFAccessTeam != "" && cfg.CFAccessAUD != "" {
		keySet := oidc.NewRemoteKeySet(
			context.Background(),
			fmt.Sprintf("https://%s.cloudflareaccess.com/cdn-cgi/access/certs", cfg.CFAccessTeam),
		)
		cfVerifier = oidc.NewVerifier(
			fmt.Sprintf("https://%s.cloudflareaccess.com", cfg.CFAccessTeam),
			keySet,
			&oidc.Config{ClientID: cfg.CFAccessAUD},
		)
		logger.Info("CF Access verifier initialized", "team", cfg.CFAccessTeam)
	} else {
		logger.Info("CF Access not configured — internal endpoints will use shared secret only")
	}

	// Initialize subsystems
	budgetEnforcer := budget.New(budget.Limits{
		MaxChannelSizeSats:  cfg.MaxChannelSizeSats,
		MaxPaymentSats:      cfg.MaxPaymentSats,
		MaxRebalanceFeeSats: cfg.MaxRebalanceFeeSats,
		MaxDailySpendSats:   cfg.MaxDailySpendSats,
		MaxFeeRateSatVB:     cfg.MaxFeeRateSatVB,
		MaxL402PaymentSats:  cfg.MaxL402PaymentSats,
	}, auditLog)

	confirmMgr := confirm.New(cfg.ConfirmExpirySeconds)
	rateLimiter := middleware.NewRateLimiter(cfg.ReadRatePerMin, cfg.WriteRatePerMin)

	// Phase 22 REN-04: background fee-rate estimator. Polls a
	// mempool.space-compatible endpoint hourly, clamps absurd values,
	// exposes a thread-safe Current() read that openChannelAsync uses
	// as (a) LND SatPerVbyte and (b) the persisted
	// funding_fee_rate_sat_vb on the grant row. Env vars per D-24:
	//   MEMPOOL_API_BASE      (default https://mempool.space/api)
	//   FEE_POLL_INTERVAL     (default 1h)
	//   FEE_PRIORITY_BAND     (default halfHourFee)
	//   FEE_FALLBACK_SAT_VB   (default 20)
	feeCtx, feeCancel := context.WithCancel(context.Background())
	defer feeCancel()
	feeEstimator := feeestimate.New(feeestimate.Config{
		MempoolAPIBase: envStr("MEMPOOL_API_BASE", "https://mempool.space/api"),
		PollInterval:   envDuration("FEE_POLL_INTERVAL", time.Hour, logger),
		PriorityBand:   envStr("FEE_PRIORITY_BAND", "halfHourFee"),
		FallbackSatVB:  envInt("FEE_FALLBACK_SAT_VB", 20, logger),
		Logger:         logger,
	})
	feeEstimator.Start(feeCtx)
	logger.Info("fee estimator started",
		"mempool_api_base", envStr("MEMPOOL_API_BASE", "https://mempool.space/api"),
		"priority_band", envStr("FEE_PRIORITY_BAND", "halfHourFee"),
		"current_sat_vb", feeEstimator.Current(),
	)

	// Initialize LND gRPC client (production only)
	var lndClient lnd.Client
	var executor *lnd.Executor
	if !cfg.MockMode {
		macSet, err := lnd.LoadMacaroons(cfg.MacaroonDir, lnd.MacaroonNames{
			Readonly:     cfg.ReadMacaroon,
			Invoice:      cfg.InvMacaroon,
			ChannelAdmin: cfg.ChanMacaroon,
			Pay:          cfg.PayMacaroon,
		})
		if err != nil {
			logger.Error("failed to load macaroons", "error", err)
			os.Exit(1)
		}

		lndClient, err = lnd.NewGRPCClient(cfg.LNDHost, cfg.TLSCertPath, macSet)
		if err != nil {
			logger.Error("failed to connect to LND", "error", err)
			os.Exit(1)
		}
		defer lndClient.Close()
		executor = lnd.NewExecutor(lndClient)
		logger.Info("connected to LND", "host", cfg.LNDHost)
	}

	// Handler dependencies
	deps := &handlers.Dependencies{
		MockMode:            cfg.MockMode,
		DataDir:             filepath.Dir(cfg.AuditDBPath),
		LND:                 lndClient,
		Executor:            executor,
		Audit:               auditLog,
		Budget:              budgetEnforcer,
		Idempotency:         idempStore,
		Confirm:             confirmMgr,
		KillSwitch:          ks,
		StartTime:           time.Now(),
		FaucetPauseFilePath: cfg.FaucetPauseFilePath,
	}

	// Build router
	mux := http.NewServeMux()

	// Read-only endpoints (agent token OK)
	mux.HandleFunc("POST /v1/info", deps.GetInfo)
	mux.HandleFunc("POST /v1/wallet/balance", deps.WalletBalance)
	mux.HandleFunc("POST /v1/wallet/channel-balance", deps.ChannelBalance)
	mux.HandleFunc("POST /v1/channels", deps.ListChannels)
	// Phase 22 CHO-03: operator-facing pending-channel view. Bearer-authed
	// via the internal middleware stack. NOT added to the Caddy
	// api.lqwdclaw.bot allowlist — external callers see 404 at the edge.
	// Response struct is explicitly allowlisted in handlers.go (D-20) to
	// prevent funding-txid / counterparty-pubkey leakage.
	mux.HandleFunc("POST /v1/channels/pending", deps.PendingChannels)
	mux.HandleFunc("POST /v1/peers", deps.ListPeers)
	mux.HandleFunc("POST /v1/fees/estimate", deps.FeeEstimate)
	mux.HandleFunc("POST /v1/audit/recent", deps.AuditRecent)
	mux.HandleFunc("GET /v1/health", deps.Health)
	// Detailed health lives on a distinct path so the edge proxy (Caddy)
	// can allowlist /v1/health without exposing operational detail.
	mux.HandleFunc("GET /v1/health/detailed", deps.HealthDetailed)
	// Public agent-discovery catalog — no auth. Describes the onboarding
	// surface (MCP URL, registration URL, tier matrix, example calls) so
	// agents self-orient without reading human docs.
	mux.HandleFunc("GET /v1/discovery", deps.Discovery)

	// Phase 2: Write endpoints (agent token — budget checked, confirmation required)
	mux.HandleFunc("POST /v1/channels/open", deps.OpenChannel)
	mux.HandleFunc("POST /v1/channels/close", deps.CloseChannel)
	mux.HandleFunc("POST /v1/payments/send", deps.SendPayment)
	mux.HandleFunc("POST /v1/invoices/create", deps.CreateInvoice)
	mux.HandleFunc("POST /v1/invoices/lookup", deps.LookupInvoice)
	mux.HandleFunc("POST /v1/onchain/send", deps.SendOnChain)
	mux.HandleFunc("POST /v1/onchain/newaddress", deps.NewAddress)
	mux.HandleFunc("POST /v1/onchain/transactions", deps.ListTransactions)
	mux.HandleFunc("POST /v1/routing/forwarding", deps.ForwardingHistory)
	mux.HandleFunc("POST /v1/peers/connect", deps.ConnectPeer)
	mux.HandleFunc("POST /v1/peers/disconnect", deps.DisconnectPeer)

	// Phase 3: Analytics & intelligence endpoints
	mux.HandleFunc("POST /v1/routing/fee-report", deps.FeeReport)
	mux.HandleFunc("POST /v1/routing/fees", deps.UpdateChannelFees)
	mux.HandleFunc("POST /v1/graph/node", deps.GraphNodeInfo)
	mux.HandleFunc("POST /v1/graph/channel", deps.GraphChannelInfo)
	mux.HandleFunc("POST /v1/analytics/channel-scores", deps.ChannelScores)
	mux.HandleFunc("POST /v1/rebalance", deps.Rebalance)

	// Phase 4: Audit query & summary endpoints
	mux.HandleFunc("POST /v1/audit/query", deps.AuditQuery)
	mux.HandleFunc("POST /v1/audit/summary", deps.AuditSummary)

	// Phase 5: Sub-agent / orchestrator endpoint
	mux.HandleFunc("POST /v1/node/summary", deps.NodeSummary)

	// Confirmation endpoints (admin token ONLY)
	mux.Handle("POST /v1/confirm", middleware.RequireAdmin(http.HandlerFunc(deps.ConfirmOperation)))
	mux.Handle("POST /v1/reject", middleware.RequireAdmin(http.HandlerFunc(deps.RejectOperation)))
	mux.Handle("POST /v1/confirm/list", middleware.RequireAdmin(http.HandlerFunc(deps.ListPending)))

	// Admin endpoints (admin token ONLY)
	mux.Handle("POST /v1/admin/kill-switch", middleware.RequireAdmin(http.HandlerFunc(deps.KillSwitchToggle)))
	mux.Handle("POST /v1/admin/restart-lnd", middleware.RequireAdmin(http.HandlerFunc(deps.RestartLND)))

	// L402 endpoints (separate auth scheme — bypasses Bearer auth)
	if cfg.L402Enabled {
		l402Deps := &handlers.L402Deps{
			Service:       l402Service,
			Store:         l402Store,
			TokenExpiry:   cfg.L402TokenExpiry,
			InvoiceExpiry: cfg.L402InvoiceExpiry,
			MockMode:      cfg.MockMode,
			Deps:          deps,
		}
		l402Mw := middleware.L402Auth(l402Service, l402Store)
		mux.Handle("GET /v1/l402/node-stats", l402Mw(http.HandlerFunc(l402Deps.NodeStats)))
		mux.Handle("GET /v1/l402/network-analytics", l402Mw(http.HandlerFunc(l402Deps.NetworkAnalytics)))
		mux.Handle("GET /v1/l402/promo", l402Mw(http.HandlerFunc(l402Deps.Promo)))
		// L402 client endpoint (uses Bearer auth, not L402 — agent pays external L402 services)
		mux.HandleFunc("POST /v1/l402/pay", l402Deps.L402Pay)
	}

	// Internal endpoints (CF Access auth — bypasses Bearer auth via auth.go skip)
	if cfg.InternalAuthSecret != "" {
		cfMw := middleware.CFAccessAuth(cfVerifier, cfg.InternalAuthSecret)
		mux.Handle("GET /v1/internal/node-stats", cfMw(http.HandlerFunc(deps.InternalNodeStats)))
		mux.Handle("GET /v1/internal/network-analytics", cfMw(http.HandlerFunc(deps.InternalNetworkAnalytics)))
		mux.Handle("GET /v1/internal/promo", cfMw(http.HandlerFunc(deps.InternalPromo)))
		logger.Info("internal endpoints enabled", "cf_access", cfVerifier != nil)

		// Account system
		var acctStore accounts.AccountStore
		if cfg.MockMode || cfg.DatabaseURL == "" {
			mockStore := accounts.NewMockStore()
			mockStore.FaucetDailyCapSats = cfg.FaucetDailyCapSats
			mockStore.FaucetChannelCap = cfg.FaucetChannelCap
			// Phase 21: wire the pause flag path so ReserveChannelSlot
			// can short-circuit when the operator pauses the faucet.
			mockStore.FaucetPauseFilePath = cfg.FaucetPauseFilePath
			acctStore = mockStore
			logger.Info("account store: mock (in-memory)")
		} else {
			pgStore, err := accounts.NewPGStore(context.Background(), cfg.DatabaseURL, cfg.FaucetDailyCapSats, cfg.FaucetChannelCap)
			if err != nil {
				logger.Error("failed to initialize account store", "error", err)
				os.Exit(1)
			}
			defer pgStore.Close()
			// Phase 21: wire the pause flag path (see MockStore branch).
			pgStore.FaucetPauseFilePath = cfg.FaucetPauseFilePath
			acctStore = pgStore
			logger.Info("account store: PostgreSQL")
		}
		acctHandlers := &accounts.Handlers{
			Store:        acctStore,
			LND:          lndClient,
			MockMode:     cfg.MockMode,
			ChannelSize:  cfg.FaucetChannelSizeSats,
			PushAmount:   cfg.FaucetPushSats,
			AdminToken:   cfg.AdminToken,
			Logger:       logger,
			FeeEstimator: feeEstimator, // Phase 22 REN-04: openChannelAsync reads Current() per grant open
		}
		apiKeyMw := accounts.APIKeyAuth(acctStore)

		// Channel faucet handlers
		channelHandlers := &accounts.ChannelHandlers{
			Store:                     acctStore,
			LND:                       lndClient,
			AdminToken:                cfg.AdminToken,
			Logger:                    logger,
			FaucetPauseFilePath:       cfg.FaucetPauseFilePath,
			AdvertisedChannelSizeSats: handlers.AdvertisedChannelSizeSats,
			AdvertisedPushSats:        handlers.AdvertisedPushSats,
			FeeEstimator:              feeEstimator, // Phase 22 REN-04: shared handle for future CAS/status consumers
		}

		// Account endpoints (CF Access + optional API key per D-07)
		// Registration: CF Access only (agent has no key yet)
		mux.Handle("POST /v1/internal/accounts/register", cfMw(http.HandlerFunc(acctHandlers.Register)))
		// Reachability pre-flight (2026-04-22): lets agents verify LQWD
		// can reach their node_uri before they burn a /register attempt.
		// Mitigates UAT ban-on-first-failure trap.
		mux.Handle("POST /v1/internal/accounts/reachability-check", cfMw(http.HandlerFunc(acctHandlers.ReachabilityCheck)))
		// Profile + rotation: CF Access + API key (defense-in-depth)
		mux.Handle("GET /v1/internal/accounts/me", cfMw(apiKeyMw(http.HandlerFunc(acctHandlers.Profile))))
		mux.Handle("POST /v1/internal/accounts/rotate-key", cfMw(apiKeyMw(http.HandlerFunc(acctHandlers.RotateKey))))
		// Phase 12: Credit ledger endpoints
		mux.Handle("POST /v1/internal/accounts/claim-tier2", cfMw(apiKeyMw(http.HandlerFunc(acctHandlers.ClaimTier2))))
		mux.Handle("GET /v1/internal/accounts/transactions", cfMw(apiKeyMw(http.HandlerFunc(acctHandlers.Transactions))))
		logger.Info("account endpoints enabled")

		// Phase 14: Channel faucet endpoints
		mux.Handle("GET /v1/internal/channel/status", cfMw(apiKeyMw(http.HandlerFunc(channelHandlers.ChannelStatus))))
		// Agent-facing retry (2026-04-22): retries the channel open on
		// the agent's last failed grant without creating a new account
		// or burning the /register rate limit.
		mux.Handle("POST /v1/internal/channel/retry", cfMw(apiKeyMw(http.HandlerFunc(acctHandlers.RetryChannel))))
		mux.Handle("POST /v1/internal/admin/channel/unban", cfMw(http.HandlerFunc(channelHandlers.AdminUnbanPubkey)))
		// Phase 21 (Agent A, 2026-04-22): time-limited pubkey ban.
		// Accepts {"pubkey", "duration"} where duration is "1h", "24h",
		// "7d", or "permanent". Auth: Bearer or X-Admin-Token.
		mux.Handle("POST /v1/internal/admin/channel/ban", cfMw(http.HandlerFunc(channelHandlers.AdminBanPubkeyUntil)))

		// Post-UAT admin recovery endpoint (2026-04-22): reset per-IP
		// registration rate limit. Operator recourse for debugging
		// sessions that exhaust the 3/hr cap.
		mux.Handle("POST /v1/internal/admin/accounts/reset-rate-limit", cfMw(http.HandlerFunc(acctHandlers.AdminResetRateLimit)))

		// Phase 21 (Agent B, 2026-04-22): faucet pause/resume routes.
		// Scope is faucet-only — operator channel-open/close/send ops
		// continue working while paused. State is a flag file so it
		// survives gateway restarts and can be tripped by `touch` if
		// Telegram is unavailable.
		mux.Handle("POST /v1/internal/admin/faucet/pause", cfMw(http.HandlerFunc(channelHandlers.AdminFaucetPause)))
		mux.Handle("POST /v1/internal/admin/faucet/resume", cfMw(http.HandlerFunc(channelHandlers.AdminFaucetResume)))

		// Phase 22 SKL-03/SKL-04: operator-visible alert sink for skill
		// preambles. Validates {level, source, message}, emits a structured
		// log entry at the requested level; faucet-monitor tails these logs
		// for source=skill:* and forwards warn/error to the operator
		// Telegram channel. Same dual-auth gate as the other admin routes
		// (bearer + X-Internal-Auth via cfMw).
		mux.Handle("POST /v1/internal/admin/alert", cfMw(http.HandlerFunc(handlers.AdminAlert)))

		// Phase 21 gap fix (2026-04-22): token-authed admin read endpoints
		// so the faucet-admin OpenClaw skill can back /faucet_channels and
		// /faucet_config without the session auth the dashboard uses.
		mux.Handle("GET /v1/internal/admin/faucet/channels", cfMw(http.HandlerFunc(channelHandlers.AdminListFaucetChannels)))
		mux.Handle("GET /v1/internal/admin/faucet/config", cfMw(http.HandlerFunc(channelHandlers.AdminFaucetConfig)))
		// Pre-aggregated summary for /faucet_status — one call returns
		// counts-by-status + recent bans/fails + config, so the skill
		// doesn't have to count rows (LLM miscounting was the bug).
		mux.Handle("GET /v1/internal/admin/faucet/summary", cfMw(http.HandlerFunc(channelHandlers.AdminFaucetSummary)))

		// Channel faucet poller (15-minute interval, same pattern as proxy cleanup)
		pollerCtx, pollerCancel := context.WithCancel(context.Background())
		defer pollerCancel()
		channelHandlers.StartPoller(pollerCtx, 15*time.Minute, logger)

		logger.Info("channel faucet enabled",
			"channel_size_sats", cfg.FaucetChannelSizeSats,
			"push_sats", cfg.FaucetPushSats,
			"channel_cap", cfg.FaucetChannelCap,
		)

		// Phase 13: Proxy endpoints (CF Access + API key auth)
		var proxyHandlers *accounts.ProxyHandlers
		if cfg.ProxyEnabled {
			proxyHandlers = &accounts.ProxyHandlers{
				Store:   acctStore,
				Deps:    deps,
				Price:   cfg.ProxyPriceSats,
				Timeout: time.Duration(cfg.ProxyUpstreamTimeoutSecs) * time.Second,
			}
			mux.Handle("POST /v1/internal/proxy/node-stats", cfMw(apiKeyMw(http.HandlerFunc(proxyHandlers.NodeStats))))
			mux.Handle("POST /v1/internal/proxy/network-analytics", cfMw(apiKeyMw(http.HandlerFunc(proxyHandlers.NetworkAnalytics))))
			mux.Handle("POST /v1/internal/proxy/promo", cfMw(apiKeyMw(http.HandlerFunc(proxyHandlers.Promo))))

			// Background cleanup for orphaned proxy reserves (per D-09)
			cleanupMaxAge := time.Duration(cfg.ProxyUpstreamTimeoutSecs*2) * time.Second
			if cleanupMaxAge < 60*time.Second {
				cleanupMaxAge = 60 * time.Second
			}
			cleanupCtx, cleanupCancel := context.WithCancel(context.Background())
			defer cleanupCancel()
			proxyHandlers.StartCleanup(cleanupCtx, 5*time.Minute, cleanupMaxAge, logger)

			logger.Info("proxy endpoints enabled",
				"price_sats", cfg.ProxyPriceSats,
				"timeout_secs", cfg.ProxyUpstreamTimeoutSecs,
			)
		} else {
			logger.Info("proxy endpoints disabled (PROXY_DISABLED=true)")
		}

		// Phase 16: MCP server (tool discovery for AI agents)
		// When proxy is disabled, MCP billing is also disabled (no proxy handlers to delegate to)
		mcpBilling := cfg.MCPBillingEnabled && cfg.ProxyEnabled
		mcpSrv := mcpserver.New(mcpserver.Config{
			Deps:            deps,
			Store:           acctStore,
			ProxyHandlers:   proxyHandlers,
			AccountHandlers: acctHandlers,
			ChannelHandlers: channelHandlers,
			BillingEnabled:  mcpBilling,
		})
		// Mount under internal namespace with CF Access auth only (per D-04).
		// Individual tool handlers enforce API key auth where needed.
		// Register tool works without API key (agent has no key yet).
		mux.Handle("/v1/internal/mcp", cfMw(mcpSrv.Handler()))
		// Public MCP endpoint — MCP server handles its own Bearer API-key auth
		// (internal/mcpserver/server.go:48-62). External agents hit this path
		// through Caddy at api.lqwdclaw.bot/v1/mcp.
		mux.Handle("/v1/mcp", mcpSrv.Handler())
		mux.Handle("/v1/mcp/", mcpSrv.Handler())
		logger.Info("MCP server enabled",
			"billing", cfg.MCPBillingEnabled,
			"endpoints", "/v1/internal/mcp, /v1/mcp, /v1/mcp/",
		)

		// Phase 15: Admin Dashboard
		if cfg.AdminUsername != "" && cfg.AdminPasswordHash != "" {
			sessionStore := admin.NewSessionStore()
			loginLimiter := admin.NewLoginRateLimiter(5, 15*time.Minute)

			adminHandlers := &admin.AdminHandlers{
				Store:             acctStore,
				Sessions:          sessionStore,
				RateLimiter:       loginLimiter,
				AdminUsername:     cfg.AdminUsername,
				AdminPasswordHash: cfg.AdminPasswordHash,
			}

			sessionMw := admin.SessionAuth(sessionStore)

			// Login: rate-limited, no session required
			mux.HandleFunc("POST /admin/api/login", adminHandlers.Login)

			// Logout: session required
			mux.Handle("POST /admin/api/logout", sessionMw(http.HandlerFunc(adminHandlers.Logout)))

			// Read endpoints: session required
			mux.Handle("GET /admin/api/metrics", sessionMw(http.HandlerFunc(adminHandlers.Metrics)))
			mux.Handle("GET /admin/api/agents", sessionMw(http.HandlerFunc(adminHandlers.ListAgents)))
			mux.Handle("GET /admin/api/channels", sessionMw(http.HandlerFunc(adminHandlers.ListChannels)))
			mux.Handle("GET /admin/api/agents/", sessionMw(http.HandlerFunc(adminHandlers.AgentTransactions)))

			// Mutating endpoints: session + CSRF required
			mux.Handle("POST /admin/api/agents/", sessionMw(admin.CSRFMiddleware(http.HandlerFunc(adminHandlers.GrantCredits))))
			mux.Handle("PATCH /admin/api/agents/", sessionMw(admin.CSRFMiddleware(http.HandlerFunc(adminHandlers.UpdateStatus))))

			// Serve embedded SPA with client-side routing fallback
			subFS, err := fs.Sub(adminweb.FS, "dist")
			if err != nil {
				logger.Error("failed to create admin sub-filesystem", "error", err)
				os.Exit(1)
			}

			mux.HandleFunc("/admin/", func(w http.ResponseWriter, r *http.Request) {
				// Strip /admin/ prefix for file lookup
				path := strings.TrimPrefix(r.URL.Path, "/admin/")
				if path == "" {
					path = "index.html"
				}
				// Try static file first; fall back to index.html for SPA routing
				f, err := subFS.Open(path)
				if err != nil {
					path = "index.html"
					f, err = subFS.Open(path)
					if err != nil {
						http.NotFound(w, r)
						return
					}
				}
				defer f.Close()
				// Detect content type from extension
				switch {
				case strings.HasSuffix(path, ".html"):
					w.Header().Set("Content-Type", "text/html; charset=utf-8")
				case strings.HasSuffix(path, ".js"):
					w.Header().Set("Content-Type", "application/javascript")
				case strings.HasSuffix(path, ".css"):
					w.Header().Set("Content-Type", "text/css")
				case strings.HasSuffix(path, ".svg"):
					w.Header().Set("Content-Type", "image/svg+xml")
				case strings.HasSuffix(path, ".json"):
					w.Header().Set("Content-Type", "application/json")
				case strings.HasSuffix(path, ".png"):
					w.Header().Set("Content-Type", "image/png")
				case strings.HasSuffix(path, ".ico"):
					w.Header().Set("Content-Type", "image/x-icon")
				}
				stat, _ := f.Stat()
				if seeker, ok := f.(io.ReadSeeker); ok {
					http.ServeContent(w, r, path, stat.ModTime(), seeker)
				} else {
					w.WriteHeader(http.StatusOK)
					io.Copy(w, f)
				}
			})

			logger.Info("admin dashboard enabled", "path", "/admin/")
		} else {
			logger.Info("admin dashboard disabled (ADMIN_USERNAME/ADMIN_PASSWORD_HASH not set)")
		}
	}

	// Apply middleware chain (innermost first)
	var handler http.Handler = mux
	handler = killSwitchMiddleware(ks)(handler)
	handler = rateLimiter.Middleware(handlers.IsWriteEndpoint)(handler)
	handler = middleware.Auth(cfg.AgentToken, cfg.AdminToken)(handler)
	handler = middleware.Logging(logger)(handler)
	handler = middleware.Recovery(logger)(handler)
	// Phase 22 SKL-03: stamp X-Gateway-Version on every response. Wrapped
	// OUTER-MOST (after Recovery) so a panic recovered downstream does not
	// strip the header. Per D-13, every handler path inherits this.
	handler = middleware.GatewayVersion(Version)(handler)

	// Create server
	srv := &http.Server{
		Addr:         cfg.ListenAddr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start periodic cleanup goroutine (idempotency + L402 tokens)
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if n, err := idempStore.Cleanup(); err != nil {
				logger.Error("idempotency cleanup failed", "error", err)
			} else if n > 0 {
				logger.Info("idempotency cleanup", "removed", n)
			}
			if l402Store != nil {
				if n, err := l402Store.Cleanup(); err != nil {
					logger.Error("L402 token cleanup failed", "error", err)
				} else if n > 0 {
					logger.Info("L402 token cleanup", "removed", n)
				}
			}
		}
	}()

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		logger.Info("received signal, shutting down", "signal", sig)

		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()

		if err := srv.Shutdown(ctx); err != nil {
			logger.Error("server shutdown error", "error", err)
		}
	}()

	// Start server
	logger.Info("lnd-gateway starting",
		"addr", cfg.ListenAddr,
		"mock_mode", cfg.MockMode,
		"max_channel_sats", cfg.MaxChannelSizeSats,
		"max_payment_sats", cfg.MaxPaymentSats,
		"max_daily_spend_sats", cfg.MaxDailySpendSats,
		"max_fee_rate_sat_vb", cfg.MaxFeeRateSatVB,
	)

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}

	logger.Info("lnd-gateway stopped")
}

// envStr returns the env var value or fallback when unset/empty.
func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envInt parses an integer env var; on malformed input logs a warning and
// returns the fallback. Defensive — never fail-fast on env typos for the
// fee subsystem since the fallback path is always safe.
func envInt(key string, fallback int, logger *slog.Logger) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		logger.Warn("env: failed to parse int; using fallback", "key", key, "value", v, "fallback", fallback, "error", err)
		return fallback
	}
	return n
}

// envDuration parses a Go duration env var; on malformed input logs a warning
// and returns the fallback. Same defensive rationale as envInt.
func envDuration(key string, fallback time.Duration, logger *slog.Logger) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		logger.Warn("env: failed to parse duration; using fallback", "key", key, "value", v, "fallback", fallback, "error", err)
		return fallback
	}
	return d
}

// killSwitchMiddleware blocks write operations when the kill switch is active.
func killSwitchMiddleware(ks *killswitch.KillSwitch) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if ks.IsActive() && handlers.IsWriteEndpoint(r.URL.Path) {
				middleware.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{
					"ok":      false,
					"error":   "kill_switch_active",
					"message": "Write operations are blocked. Kill switch is engaged.",
					"status":  ks.Status(),
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
