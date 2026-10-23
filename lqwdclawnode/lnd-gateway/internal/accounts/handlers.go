package accounts

import (
	"context"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/feeestimate"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// Handlers provides HTTP handlers for account management endpoints.
type Handlers struct {
	Store       AccountStore
	LND         lnd.Client // nil in credit-proxy-only mode
	MockMode    bool
	ChannelSize int64
	PushAmount  int64
	AdminToken  string // For admin endpoints (reset-rate-limit, etc.) — accepted as Authorization: Bearer
	Logger      *slog.Logger
	// FeeEstimator (Phase 22 REN-04): background-polled sat/vB source for
	// the channel-faucet OpenChannel path. Read once per grant open and
	// (a) passed to LND as SatPerVbyte cap, (b) persisted on the grant
	// row via Store.SetChannelFundingFeeRate so Plan 22-03's CAS UPDATE
	// surfaces the value in /v1/internal/channel/status. Nil when the
	// subsystem is disabled at boot — openChannelAsync falls back to
	// LND's auto-pick and leaves the grant row's fee column NULL.
	FeeEstimator *feeestimate.Estimator
}

// registerRequest is the JSON body for POST /v1/internal/accounts/register.
type registerRequest struct {
	Name    string `json:"name"`
	Pubkey  string `json:"pubkey,omitempty"`
	NodeURI string `json:"node_uri,omitempty"`
}

// Register creates a new agent account with a faucet grant.
//
// Phase 22 REN-02 contract: the response returns agent credentials
// (api_key) and next_steps — it does NOT include `channel_point` inline.
// The on-chain channel open is async (Phase 14 D-13), so `channel_point`
// is not yet known at register time. Agents MUST poll
// GET /v1/internal/channel/status to observe the `channel_point` once
// the open confirms. That handler performs a live-LND lookup + atomic
// CAS transition on every poll (Plan 22-03), so agents do not need to
// wait for the background poller's 15-minute cadence to see the
// transition from pending_open → open.
//
// Load-bearing test: accounts/handlers_test.go:TestRegisterResponseNoChannelPoint
// asserts `channel_point` does not appear anywhere in the register
// response body. If a future edit re-introduces it here, that test
// fails and the PR blocks merge. The authoritative surface for
// `channel_point` is /v1/internal/channel/status — not /register.
//
// POST /v1/internal/accounts/register
func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "name is required",
		})
		return
	}

	if req.Name == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "name is required",
		})
		return
	}

	if len(req.Name) > 100 {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "name must be 1-100 characters",
		})
		return
	}

	// Get client IP: prefer CF-Connecting-IP, fall back to RemoteAddr (per D-10)
	ipAddr := r.Header.Get("CF-Connecting-IP")
	if ipAddr == "" {
		ipAddr = r.RemoteAddr
		// Strip port if present
		if host, _, err := net.SplitHostPort(ipAddr); err == nil {
			ipAddr = host
		}
	}

	// Check registration rate limit (3 per IP per hour)
	allowed, err := h.Store.CheckRegistrationLimit(r.Context(), ipAddr)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "internal error",
		})
		return
	}
	if !allowed {
		middleware.WriteJSON(w, http.StatusTooManyRequests, map[string]any{
			"ok":    false,
			"error": "registration rate limit exceeded (3 per hour)",
		})
		return
	}

	// Check global faucet cap (per D-10)
	faucetAllowed, err := h.Store.CheckFaucetCap(r.Context(), int64(DefaultTier1GrantSats))
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "internal error",
		})
		return
	}
	if !faucetAllowed {
		middleware.WriteJSON(w, http.StatusTooManyRequests, map[string]any{
			"ok":    false,
			"error": "daily faucet limit reached, try again tomorrow",
		})
		return
	}

	agent, rawKey, err := h.Store.Register(r.Context(), req.Name, ipAddr)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "registration failed",
		})
		return
	}

	// Channel faucet: attempt channel open if pubkey provided (per D-01, D-11)
	var channelGranted bool
	var channelStatus, channelID, channelReason string

	if req.Pubkey != "" {
		// Validate pubkey format: 66-char hex (per D-08)
		if !ValidatePubkey(req.Pubkey) {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
				"ok":    false,
				"error": "pubkey must be 66-character hex string",
			})
			return
		}
		// Validate node_uri required with pubkey (per D-09)
		if req.NodeURI == "" {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
				"ok":    false,
				"error": "node_uri required when pubkey is provided",
			})
			return
		}
		// Validate node_uri format: pubkey@host:port
		parts := strings.SplitN(req.NodeURI, "@", 2)
		if len(parts) != 2 || parts[0] != req.Pubkey {
			middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
				"ok":    false,
				"error": "node_uri must be pubkey@host:port",
			})
			return
		}

		// Try to reserve channel slot (per D-22 advisory lock)
		grantID, reserveErr := h.Store.ReserveChannelSlot(r.Context(), agent.ID, req.Pubkey, req.NodeURI, h.ChannelSize, h.PushAmount)
		switch {
		case reserveErr == nil:
			channelGranted = true
			channelStatus = "pending"
			channelID = grantID
			// Fire async channel open (per D-13) -- registration never blocks
			go h.openChannelAsync(grantID, agent.ID, req.Pubkey, req.NodeURI)
		case reserveErr == ErrFaucetChannelCap:
			channelReason = "faucet_exhausted"
		case reserveErr == ErrPubkeyBanned:
			channelReason = "pubkey_banned"
		default:
			// Log but don't fail registration (per D-23)
			if h.Logger != nil {
				h.Logger.Error("channel slot reservation failed", "error", reserveErr, "agent_id", agent.ID)
			}
		}
	}

	nextSteps := map[string]any{
		// Quickstart reference for agents — Phase 18 (Option A) deploys
		// a static /for-agents page on the lqwdclaw.bot apex.
		"docs_url":      "https://lqwdclaw.bot/for-agents",
		"mcp_url":       "https://api.lqwdclaw.bot/v1/mcp",
		"discovery_url": "https://api.lqwdclaw.bot/v1/discovery",
		// example_curl previously demonstrated an authenticated proxy call
		// to /v1/internal/proxy/node-stats. Removed 2026-04-21: v1 has no
		// paid service, so the proxy is not advertised. If the agent
		// registered with pubkey+node_uri, channel_status_url below is the
		// authenticated-Bearer call that demonstrates how to use the
		// api_key. Without a channel grant, the MCP surface (check_balance,
		// check_channel_status) is the Bearer demo.
	}
	// lqwd_node surfaces LQWD's own Lightning URI so agents who skipped
	// discovery still see it in the register response. Agents SHOULD
	// peer-connect to this URI from their node BEFORE calling register
	// to avoid the ConnectPeer-failure auto-ban trap. Mirrors the
	// lqwd_node block in /v1/discovery. Omitted when LQWD_NODE_URI is
	// not set by the operator.
	if nodeURI := os.Getenv("LQWD_NODE_URI"); nodeURI != "" {
		nextSteps["lqwd_node_uri"] = nodeURI
		nextSteps["lqwd_node_instruction"] = "If you have not already, peer-connect to this URI from your node before polling channel_status_url. Pre-established peer connections make the async OpenChannel succeed on first try."
	}
	respData := map[string]any{
		"agent": map[string]any{
			"id":         agent.ID,
			"name":       agent.Name,
			"tier":       agent.Tier,
			"status":     agent.Status,
			"created_at": agent.CreatedAt,
		},
		"api_key":    rawKey,
		"next_steps": nextSteps,
	}
	if req.Pubkey != "" {
		respData["channel_granted"] = channelGranted
		if channelGranted {
			respData["channel_status"] = channelStatus
			respData["channel_id"] = channelID
			// Agent needs a way to poll their pending channel open.
			// Surfaced ONLY when a channel was granted — keeps the public
			// discovery catalog tight, while still giving granted agents
			// a path to learn when their channel goes active.
			nextSteps["channel_status_url"] = "https://api.lqwdclaw.bot/v1/internal/channel/status"
		} else {
			respData["channel_status"] = "not_granted"
			respData["channel_reason"] = channelReason
		}
	}
	middleware.WriteJSON(w, http.StatusCreated, map[string]any{"ok": true, "data": respData})
}

// openChannelAsync performs the LND ConnectPeer + OpenChannel sequence in a background goroutine.
// Updates the channel grant status in the store on completion or failure.
func (h *Handlers) openChannelAsync(grantID, agentID, pubkey, nodeURI string) {
	logger := h.Logger
	if logger != nil {
		logger = logger.With("grant_id", grantID, "agent_id", agentID)
	}

	parts := strings.SplitN(nodeURI, "@", 2)
	if len(parts) != 2 {
		h.Store.UpdateChannelStatus(context.Background(), grantID, "failed", "", "invalid node_uri", 0)
		return
	}
	host := parts[1]

	// Step 1: ConnectPeer (15s timeout per D-07)
	connectCtx, connectCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer connectCancel()

	if h.MockMode {
		_ = mock.ConnectPeer()
	} else {
		_, err := h.LND.ConnectPeer(connectCtx, pubkey, host)
		if err != nil && !strings.Contains(err.Error(), "already connected") {
			if logger != nil {
				logger.Error("connect peer failed", "error", err)
			}
			h.Store.UpdateChannelStatus(context.Background(), grantID, "failed", "", "connect_peer: "+err.Error(), 0)
			return
		}
	}

	// Step 2: OpenChannel (60s timeout — peer negotiation can be slow on signet/testnet)
	openCtx, openCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer openCancel()

	// Phase 22 REN-04 populator: read the current sat/vB ONCE per grant
	// open. When the estimator is wired, the value propagates to LND as
	// the funding-tx fee-rate cap AND is persisted onto the grant row.
	// When the estimator is nil (disabled at boot), satVB stays 0 so the
	// OpenChannel call omits the SatPerVbyte field (LND auto-picks) and
	// the funding_fee_rate_sat_vb column stays NULL. That matches the
	// pre-revision behavior; no regression for legacy deploys.
	var satVB int64
	if h.FeeEstimator != nil {
		satVB = int64(h.FeeEstimator.Current())
	} else if logger != nil {
		logger.Warn("openChannelAsync: FeeEstimator not wired; LND will auto-pick fee rate")
	}

	var resp map[string]any
	if h.MockMode {
		resp = mock.OpenChannel(pubkey, h.ChannelSize)
	} else {
		var openErr error
		resp, openErr = h.LND.OpenChannel(openCtx, lnd.OpenChannelRequest{
			NodePubkey:         pubkey,
			LocalFundingAmount: h.ChannelSize,
			PushSat:            h.PushAmount,
			SatPerVbyte:        satVB,
		})
		if openErr != nil {
			if logger != nil {
				logger.Error("open channel failed", "error", openErr)
			}
			// On context deadline, LND may still complete the open — mark as pending
			// so the background poller can detect the channel and update status.
			if openCtx.Err() != nil {
				h.Store.UpdateChannelStatus(context.Background(), grantID, "pending", "", "open_channel: timeout, awaiting poller", 0)
				if logger != nil {
					logger.Warn("open channel timed out — poller will detect if LND completed", "grant_id", grantID)
				}
				return
			}
			h.Store.UpdateChannelStatus(context.Background(), grantID, "failed", "", "open_channel: "+openErr.Error(), 0)
			return
		}
	}

	// Extract funding txid from response
	data, _ := resp["data"].(map[string]any)
	txid, _ := data["funding_txid"].(string)
	outIdx := 0
	if idx, ok := data["output_index"].(int); ok {
		outIdx = idx
	}

	h.Store.UpdateChannelStatus(context.Background(), grantID, "pending_open", txid, "", outIdx)
	// Phase 22 REN-04: persist the fee rate alongside the funding txid so
	// the row is complete at the same instant Plan 22-03's CAS UPDATE
	// fires. SetChannelFundingFeeRate is a no-op on satVB<=0 so the
	// legacy path (estimator absent) still leaves the column NULL.
	if err := h.Store.SetChannelFundingFeeRate(context.Background(), grantID, satVB); err != nil {
		if logger != nil {
			logger.Error("persist funding fee rate failed", "error", err, "sat_vb", satVB)
		}
	}
	if logger != nil {
		logger.Info("channel open initiated", "funding_txid", txid, "push_sats", h.PushAmount, "sat_vb", satVB)
	}
}

// Profile returns the authenticated agent's profile with balance.
// GET /v1/internal/accounts/me
func (h *Handlers) Profile(w http.ResponseWriter, r *http.Request) {
	agent := GetAgent(r.Context())
	if agent == nil {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
			"ok":    false,
			"error": "not authenticated",
		})
		return
	}

	profile, err := h.Store.Profile(r.Context(), agent.ID)
	if err != nil || profile == nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "failed to retrieve profile",
		})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": profile,
	})
}

// RotateKey generates a new API key, invalidating the current one.
// POST /v1/internal/accounts/rotate-key
func (h *Handlers) RotateKey(w http.ResponseWriter, r *http.Request) {
	agent := GetAgent(r.Context())
	if agent == nil {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
			"ok":    false,
			"error": "not authenticated",
		})
		return
	}

	keyHash := GetKeyHash(r.Context())
	newKey, err := h.Store.RotateKey(r.Context(), agent.ID, keyHash)
	if err != nil {
		middleware.WriteJSON(w, http.StatusConflict, map[string]any{
			"ok":    false,
			"error": "key rotation conflict — retry",
		})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"api_key": newKey,
		},
	})
}

// claimTier2Request is the JSON body for POST /v1/internal/accounts/claim-tier2.
type claimTier2Request struct {
	Name string `json:"name"`
}

// ClaimTier2 processes a Tier 2 challenge claim.
// POST /v1/internal/accounts/claim-tier2
func (h *Handlers) ClaimTier2(w http.ResponseWriter, r *http.Request) {
	agent := GetAgent(r.Context())
	if agent == nil {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
			"ok":    false,
			"error": "not authenticated",
		})
		return
	}

	var req claimTier2Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Name == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "name is required",
		})
		return
	}

	// Check faucet cap before granting (per D-10)
	allowed, err := h.Store.CheckFaucetCap(r.Context(), int64(DefaultTier2GrantSats))
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "internal error",
		})
		return
	}
	if !allowed {
		middleware.WriteJSON(w, http.StatusTooManyRequests, map[string]any{
			"ok":    false,
			"error": "daily faucet limit reached, try again tomorrow",
		})
		return
	}

	result, err := h.Store.ClaimTier2(r.Context(), agent.ID, req.Name)
	if err != nil {
		switch err {
		case ErrTooYoung:
			middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
				"ok":    false,
				"error": err.Error(),
			})
		case ErrNameMismatch:
			middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
				"ok":    false,
				"error": err.Error(),
			})
		default:
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
				"ok":    false,
				"error": "claim failed",
			})
		}
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": result,
	})
}

// Transactions returns paginated transaction history.
// GET /v1/internal/accounts/transactions?cursor={cursor}&limit={limit}
func (h *Handlers) Transactions(w http.ResponseWriter, r *http.Request) {
	agent := GetAgent(r.Context())
	if agent == nil {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
			"ok":    false,
			"error": "not authenticated",
		})
		return
	}

	cursor := r.URL.Query().Get("cursor")
	limitStr := r.URL.Query().Get("limit")
	limit := 20 // default per D-12
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	entries, nextCursor, err := h.Store.Transactions(r.Context(), agent.ID, cursor, limit)
	if err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "invalid cursor",
		})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"transactions": entries,
			"next_cursor":  nextCursor,
		},
	})
}

// RetryChannel re-attempts the channel open for the authenticated agent's
// most recent grant. Decoupled from /register so the agent can iterate on
// reachability (firewall, DNS, port) WITHOUT burning /register rate limit
// slots or creating throwaway agent rows (the UAT polluted the agents
// table with v1/v2/v3/v4 accounts). Same api_key survives across
// retries.
//
// Contract:
//   - Caller is authenticated via Bearer api_key (APIKeyAuth middleware)
//   - Looks up agent's most recent channel_grant
//   - Only retries when that grant's status is "failed"
//   - Creates a NEW grant row for the retry (preserves failure history)
//   - Kicks off the same async open-channel flow as /register
//   - Each retry counts toward the ban-after-3-failures threshold
//     (agent with 3 consecutive failures still loses access)
//
// POST /v1/internal/channel/retry
// Auth: Authorization: Bearer <lqwd_api_key>
// Body: (empty; uses the pubkey+node_uri from the agent's most recent grant)
func (h *Handlers) RetryChannel(w http.ResponseWriter, r *http.Request) {
	agent := GetAgent(r.Context())
	if agent == nil {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "not authenticated"})
		return
	}

	// Find the agent's most recent grant. If none, there's nothing to
	// retry — they should hit /register first.
	prior, err := h.Store.GetChannelGrant(r.Context(), agent.ID)
	if err != nil {
		if h.Logger != nil {
			h.Logger.Error("retry: lookup grant failed", "error", err, "agent_id", agent.ID)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to look up prior grant"})
		return
	}
	if prior == nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "no prior channel grant found; call /v1/internal/accounts/register with pubkey+node_uri first"})
		return
	}
	// Only retry from a terminal-failure state. If the grant is still
	// pending / pending_open / active / open, there's nothing to retry.
	if prior.Status != "failed" {
		middleware.WriteJSON(w, http.StatusConflict, map[string]any{
			"ok":    false,
			"error": "latest channel grant is not in failed state; nothing to retry",
			"data":  map[string]any{"current_status": prior.Status, "grant_id": prior.ID},
		})
		return
	}

	// Reserve a new slot. Pubkey ban check inside the store will refuse
	// if the threshold has been reached — surface that as 403 so the
	// agent knows no further retries are possible without operator help.
	newGrantID, err := h.Store.ReserveChannelSlot(r.Context(), agent.ID, prior.Pubkey, prior.NodeURI, h.ChannelSize, h.PushAmount)
	if err != nil {
		switch err {
		case ErrFaucetChannelCap:
			middleware.WriteJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "channel faucet cap reached; retry later"})
			return
		case ErrPubkeyBanned:
			middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
				"ok":    false,
				"error": "pubkey banned from faucet; contact operator or review your node reachability",
				"data":  map[string]any{"fail_category": FailCategory(prior.FailReason), "last_fail_reason": prior.FailReason},
			})
			return
		default:
			if h.Logger != nil {
				h.Logger.Error("retry: reserve slot failed", "error", err, "agent_id", agent.ID)
			}
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to reserve new grant"})
			return
		}
	}

	// Kick off the async open in a goroutine — same flow as /register's
	// channel path.
	go h.openChannelAsync(newGrantID, agent.ID, prior.Pubkey, prior.NodeURI)

	if h.Logger != nil {
		h.Logger.Info("channel retry accepted", "agent_id", agent.ID, "prior_grant_id", prior.ID, "new_grant_id", newGrantID)
	}
	middleware.WriteJSON(w, http.StatusAccepted, map[string]any{
		"ok": true,
		"data": map[string]any{
			"channel_id":         newGrantID,
			"prior_grant_id":     prior.ID,
			"prior_fail_reason":  prior.FailReason,
			"prior_fail_category": FailCategory(prior.FailReason),
			"status":             "pending",
			"channel_status_url": "https://api.lqwdclaw.bot/v1/internal/channel/status",
		},
	})
}

// ReachabilityCheck tries to dial the supplied node_uri from LQWD's LND
// and reports whether the peer connection succeeded. Consumed by agents
// BEFORE calling /register so they can confirm their node is publicly
// reachable without burning a registration attempt and risking a ban on
// ConnectPeer failure.
//
// Closes UAT Gap #11 (2026-04-21): fresh agents had no way to validate
// reachability before registering. ConnectPeer failures during the
// faucet's async OpenChannel counted against the (previously 1, now 3)
// failure threshold; a single transient firewall-propagation glitch
// could burn the pubkey.
//
// Behavior:
//   - 10 s timeout on ConnectPeer
//   - If connect succeeds: peer remains connected (agent was going to
//     pre-peer anyway per /for-agents guidance, saves them a roundtrip)
//   - If connect fails: response includes the LND error text so the
//     agent knows whether to fix DNS, firewall, port, or pubkey
//   - No account, no channel grant, no rate-limit consumption
//   - Mock mode returns reachable=true deterministically
//
// POST /v1/internal/accounts/reachability-check
// Auth: CF Access (externally) — no api_key required.
// Body: {"pubkey": "<66-hex>", "node_uri": "<pubkey>@<host>:<port>"}
func (h *Handlers) ReachabilityCheck(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pubkey  string `json:"pubkey"`
		NodeURI string `json:"node_uri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid JSON body"})
		return
	}
	if !ValidatePubkey(req.Pubkey) {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid pubkey format (expected 66-char hex)"})
		return
	}
	// Parse pubkey@host:port form.
	parts := strings.SplitN(req.NodeURI, "@", 2)
	if len(parts) != 2 || parts[0] != req.Pubkey {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "node_uri must be '<pubkey>@<host>:<port>' and match the pubkey field"})
		return
	}
	host := parts[1]

	// Phase 22 REN-01: derive dialed_port + observed_source_ip once so
	// every response branch (mock, reachable, already_connected,
	// unreachable) can surface them consistently. dialed_port tells the
	// agent which port we actually dialed — lets them catch typos in
	// the node_uri's host:port component. observed_source_ip is the IP
	// we saw the request come FROM (CF-Connecting-IP when fronted by
	// Cloudflare, else the TCP socket remote addr). Agents behind NAT
	// can cross-check this against their node_uri host to self-detect
	// DNS / port-forward mismatches before registering.
	portStr := ""
	if colon := strings.LastIndex(host, ":"); colon >= 0 {
		portStr = host[colon+1:]
	}
	observedIP := r.Header.Get("CF-Connecting-IP")
	if observedIP == "" {
		if ip, _, splitErr := net.SplitHostPort(r.RemoteAddr); splitErr == nil {
			observedIP = ip
		} else {
			// r.RemoteAddr without port (e.g. unix socket / test harness) —
			// take it verbatim. Empty string is acceptable; the field
			// stays empty rather than missing to keep the response shape
			// stable across branches.
			observedIP = r.RemoteAddr
		}
	}

	// Mock mode: deterministic success so test harnesses don't need a
	// live LND peer to exercise this endpoint.
	if h.MockMode || h.LND == nil {
		middleware.WriteJSON(w, http.StatusOK, map[string]any{
			"ok": true,
			"data": map[string]any{
				"reachable":          true,
				"mock":               true,
				"dialed_port":        portStr,
				"observed_source_ip": observedIP,
			},
		})
		return
	}

	// Real LND: 10 s ceiling on ConnectPeer so a misconfigured node
	// can't hold the handler open forever.
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if _, err := h.LND.ConnectPeer(ctx, req.Pubkey, host); err != nil {
		// Already-connected is a success for this endpoint's contract —
		// it means LQWD can reach the peer, which is what the agent
		// actually asked us to verify.
		if strings.Contains(strings.ToLower(err.Error()), "already connected") {
			middleware.WriteJSON(w, http.StatusOK, map[string]any{
				"ok": true,
				"data": map[string]any{
					"reachable":          true,
					"already_connected":  true,
					"dialed_port":        portStr,
					"observed_source_ip": observedIP,
				},
			})
			return
		}
		middleware.WriteJSON(w, http.StatusOK, map[string]any{
			"ok": true,
			"data": map[string]any{
				"reachable":          false,
				"error":              err.Error(),
				"dialed_port":        portStr,
				"observed_source_ip": observedIP,
			},
		})
		return
	}
	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"reachable":          true,
			"dialed_port":        portStr,
			"observed_source_ip": observedIP,
		},
	})
}

// AdminResetRateLimit backdates recent registrations from the supplied IP
// address so the 3/hr/IP registration rate-limit counter (COUNT(*) against
// agents.created_at) stops seeing them. Returns the number of rows shifted.
//
// Added 2026-04-22 as the programmatic replacement for the manual SQL
// recipe operators had to run during the A-Z UAT when iterative debugging
// exhausted the IP's rate-limit budget. Production rate limit stays at
// 3/hr (operator preference) — this is purely an escape hatch for
// operator-led recovery, not a rate-limit raise.
//
// POST /v1/internal/admin/accounts/reset-rate-limit
// Auth: Authorization: Bearer <admin-token> (or legacy X-Admin-Token).
// Body: {"ip_address": "x.x.x.x"}
func (h *Handlers) AdminResetRateLimit(w http.ResponseWriter, r *http.Request) {
	if !checkAdminAuth(r, w, h.AdminToken) {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized: invalid or missing admin token (supply Authorization: Bearer <token>)"})
		return
	}
	var req struct {
		IPAddress string `json:"ip_address"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.IPAddress == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "ip_address is required"})
		return
	}
	// Minimal sanity: reject obvious junk. Full IPv4/IPv6 validation is
	// not strictly required since the WHERE clause just won't match bad
	// values, but catching obviously-malformed inputs here makes typos
	// actionable rather than silent no-ops.
	if ip := net.ParseIP(req.IPAddress); ip == nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid ip_address format"})
		return
	}
	affected, err := h.Store.ResetIPRateLimit(r.Context(), req.IPAddress)
	if err != nil {
		if h.Logger != nil {
			h.Logger.Error("reset ip rate limit failed", "error", err, "ip", req.IPAddress)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to reset rate limit"})
		return
	}
	if h.Logger != nil {
		h.Logger.Info("admin reset ip rate limit", "ip", req.IPAddress, "rows_affected", affected)
	}
	middleware.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": map[string]any{"ip_address": req.IPAddress, "rows_affected": affected}})
}
