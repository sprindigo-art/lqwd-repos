package accounts

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/feeestimate"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lndparse"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// checkAdminAuth validates the admin token from either
// `Authorization: Bearer <token>` (the canonical header, matching
// /v1/confirm and /v1/admin/kill-switch) OR the legacy `X-Admin-Token`
// header (kept for backwards compatibility with existing operator
// scripts). Returns true if either header matches the configured
// AdminToken. Emits a deprecation warning header when the legacy form
// is used so operators can migrate on their next touch.
//
// Standardization decision (2026-04-22): the admin-auth header
// inconsistency surfaced in the A-Z UAT (unban needed X-Admin-Token,
// other admin endpoints used Bearer) — fixed by accepting both here
// and planning to retire X-Admin-Token in a later phase.
func checkAdminAuth(r *http.Request, w http.ResponseWriter, configuredToken string) bool {
	if configuredToken == "" {
		return false
	}
	// Prefer canonical Authorization: Bearer.
	if authz := r.Header.Get("Authorization"); strings.HasPrefix(authz, "Bearer ") {
		if strings.TrimPrefix(authz, "Bearer ") == configuredToken {
			return true
		}
	}
	// Fall back to legacy X-Admin-Token with deprecation signal.
	if token := r.Header.Get("X-Admin-Token"); token != "" && token == configuredToken {
		w.Header().Set("Warning", `299 - "X-Admin-Token is deprecated; use Authorization: Bearer <token>"`)
		return true
	}
	return false
}

// ChannelHandlers provides HTTP handlers for channel faucet endpoints.
type ChannelHandlers struct {
	Store      AccountStore
	LND        lnd.Client
	AdminToken string // Required token for admin endpoints (X-Admin-Token header)
	Logger     *slog.Logger
	// FaucetPauseFilePath (Phase 21, 2026-04-22): flag-file path that
	// AdminFaucetPause creates and AdminFaucetResume removes. Mirrors
	// config.FaucetPauseFilePath. The file-flag design survives gateway
	// restarts and can be tripped by `touch` if Telegram is unavailable.
	FaucetPauseFilePath string
	// AdvertisedChannelSizeSats + AdvertisedPushSats mirror the same
	// constants in internal/handlers/discovery.go. Wired in main.go so
	// AdminFaucetConfig can surface these to the agent without the
	// accounts package importing handlers (would create a cycle).
	// Added 2026-04-22 (Phase 21 gateway-gap fix).
	AdvertisedChannelSizeSats int64
	AdvertisedPushSats        int64
	// FeeEstimator (Phase 22 REN-04): shared reference to the background
	// fee-rate poller. openChannelAsync in handlers.go is the primary
	// reader (it's where OpenChannel is actually called), but this field
	// is held here too so Plan 22-03's CAS-handling ChannelStatus path
	// can surface the live value if it ever needs to read from the
	// estimator directly. Nil when the subsystem is disabled at boot.
	FeeEstimator *feeestimate.Estimator
}

// ChannelStatus returns the channel grant for the authenticated agent.
// GET /v1/internal/channel/status
//
// Phase 22 CHO-01: when the DB row is pending_open and an LND client is
// wired, perform an authoritative live-LND lookup via lndparse and
// inline-transition the row via UpdateChannelStatusCAS. This closes the
// UAT-11/UAT-12 stuck-pending gap: an agent polling /channel/status gets
// the authoritative status in the same request rather than waiting for
// the 15-minute poller tick. Both the handler and the poller funnel
// transitions through the same CAS method (FM-1 mitigation), so
// concurrent writers never clobber each other's channel_point or
// funding_fee_rate_sat_vb.
//
// Graceful degradation (D-03): any LND lookup failure, CAS error, or
// "still confirming" LND result leaves the row untouched and returns the
// DB view. The background poller continues retrying on its own tick.
func (ch *ChannelHandlers) ChannelStatus(w http.ResponseWriter, r *http.Request) {
	agent := GetAgent(r.Context())
	if agent == nil {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "not authenticated"})
		return
	}
	grant, err := ch.Store.GetChannelGrant(r.Context(), agent.ID)
	if err != nil {
		if ch.Logger != nil {
			ch.Logger.Error("channel status: store read failed", "agent_id", agent.ID, "error", err)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "internal error"})
		return
	}
	if grant == nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "no channel grant found"})
		return
	}

	// Phase 22 CHO-01: authoritative live-LND lookup when DB row is
	// pending_open and an LND client is available. Skipped otherwise
	// (mock mode with ch.LND == nil, or rows already in a terminal state).
	if grant.Status == "pending_open" && ch.LND != nil && grant.FundingTxID != "" {
		status, channelPoint, _, lookupErr := lndparse.LiveChannelLookup(
			r.Context(), ch.LND, grant.FundingTxID, grant.OutputIndex,
		)
		switch {
		case lookupErr != nil:
			// D-03 graceful degrade: log and return DB view. Poller will retry.
			if ch.Logger != nil {
				ch.Logger.Warn("channel status: live lookup failed; returning DB view",
					"grant_id", grant.ID, "error", lookupErr)
			}
		case status == "open":
			updated, casErr := ch.Store.UpdateChannelStatusCAS(
				r.Context(), grant.ID, "pending_open", "open",
				channelPoint, grant.FundingFeeRateSatVB,
			)
			if casErr != nil {
				if ch.Logger != nil {
					ch.Logger.Error("channel status: CAS update failed",
						"grant_id", grant.ID, "error", casErr)
				}
				// Continue — return DB view; poller will retry.
			} else if updated {
				// We won the CAS; reflect the transition in the in-memory
				// grant we're about to return. The columns match what the
				// CAS wrote: status="open", channel_point, opened_at=NOW.
				grant.Status = "open"
				cp := channelPoint
				grant.ChannelPoint = &cp
				now := time.Now()
				grant.OpenedAt = &now
			} else {
				// Someone else transitioned first (poller / concurrent
				// request). Re-read to surface the authoritative value
				// instead of returning stale pending_open.
				if fresh, freshErr := ch.Store.GetChannelGrant(r.Context(), agent.ID); freshErr == nil && fresh != nil {
					grant = fresh
				}
			}
		case status == "closed":
			updated, casErr := ch.Store.UpdateChannelStatusCAS(
				r.Context(), grant.ID, "pending_open", "closed",
				channelPoint, grant.FundingFeeRateSatVB,
			)
			if casErr != nil {
				if ch.Logger != nil {
					ch.Logger.Error("channel status: CAS close update failed",
						"grant_id", grant.ID, "error", casErr)
				}
			} else if updated {
				grant.Status = "closed"
				cp := channelPoint
				grant.ChannelPoint = &cp
				now := time.Now()
				grant.ClosedAt = &now
			} else {
				if fresh, freshErr := ch.Store.GetChannelGrant(r.Context(), agent.ID); freshErr == nil && fresh != nil {
					grant = fresh
				}
			}
		case status == "pending_open":
			// D-03: channel still confirming in LND. Leave row, return DB view.
			if ch.Logger != nil {
				ch.Logger.Info("channel status: still pending_open in LND",
					"grant_id", grant.ID, "funding_txid", grant.FundingTxID)
			}
		}
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": grant})
}

// AdminUnbanPubkey clears the ban flag for a given pubkey.
// POST /v1/internal/admin/channel/unban
// Requires Authorization: Bearer <admin-token> (preferred) or the
// legacy X-Admin-Token header (deprecated — emits a Warning header).
func (ch *ChannelHandlers) AdminUnbanPubkey(w http.ResponseWriter, r *http.Request) {
	// Verify admin token (in addition to CF Access)
	if !checkAdminAuth(r, w, ch.AdminToken) {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized: invalid or missing admin token (supply Authorization: Bearer <token>)"})
		return
	}

	var req struct {
		Pubkey string `json:"pubkey"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Pubkey == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "pubkey is required"})
		return
	}
	if !ValidatePubkey(req.Pubkey) {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid pubkey format"})
		return
	}
	if err := ch.Store.ClearPubkeyBan(r.Context(), req.Pubkey); err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to clear ban"})
		return
	}
	middleware.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": map[string]any{"pubkey": req.Pubkey, "banned": false}})
}

// StartPoller launches a background goroutine that periodically checks pending channel
// grants against LND state and transitions stale pending rows to failed.
//
// Fires an initial poll 5 seconds after startup (to let LND come up),
// then every `interval`. Without the initial fire, pending_open → open
// transitions would take up to `interval` minutes — during Phase 21
// deploy testing this left a channel stuck in pending_open for 16
// hours because the gateway kept getting restarted before the first
// 15-minute tick could fire. Regression guard: any gateway restart
// should pick up on-chain-confirmed channels within 15s of startup.
func (ch *ChannelHandlers) StartPoller(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	go func() {
		// Small initial delay to let LND finish coming up (avoids
		// spurious "list channels failed" errors in the log during
		// the first few seconds after boot).
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
		ch.pollChannelStatus(ctx, logger)

		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				ch.pollChannelStatus(ctx, logger)
			}
		}
	}()
}

// pollChannelStatus checks all pending channel grants and updates their status
// based on current LND state. Also recovers stale pending grants (older than 1 hour
// with no funding txid) by transitioning them to failed.
//
// Phase 22 CHO-02: rewritten to delegate live-LND resolution to the shared
// lndparse package and to funnel the resulting transitions through
// UpdateChannelStatusCAS. This is the FM-1 mitigation — both the poller
// and the inline ChannelStatus handler go through the same CAS method,
// so neither can clobber the other's channel_point / funding_fee_rate
// on a concurrent transition.
//
// The previous per-poll "build a map of all LND channel_points" approach
// was replaced with a per-grant LiveChannelLookup call. Cost is O(pending)
// RPCs per tick instead of O(1), but (a) pending count is typically
// small (single digits even at peak), (b) ListChannels is cheap, and
// (c) the shared parser is the single source of truth — no more silent
// type-assertion fallthroughs (UAT-11 bug class).
func (ch *ChannelHandlers) pollChannelStatus(ctx context.Context, logger *slog.Logger) {
	pending, err := ch.Store.ListPendingChannels(ctx)
	if err != nil {
		logger.Error("channel poller: list pending failed", "error", err)
		return
	}
	if len(pending) == 0 {
		return
	}

	// Stale-pending recovery: transition rows in 'pending' status older than 1 hour to 'failed'.
	// This prevents slots from being permanently consumed by grants that never received
	// a funding txid (e.g., openChannelAsync crashed or LND was unreachable).
	staleCutoff := time.Now().Add(-1 * time.Hour)
	for _, grant := range pending {
		if grant.Status == "pending" && grant.FundingTxID == "" && grant.CreatedAt.Before(staleCutoff) {
			ch.Store.UpdateChannelStatus(ctx, grant.ID, "failed", "", "stale_pending: no funding txid after 1 hour", 0)
			logger.Warn("channel poller: stale pending grant recovered", "grant_id", grant.ID, "created_at", grant.CreatedAt)
			continue
		}
	}

	// No LND client in mock mode — nothing authoritative to check against.
	if ch.LND == nil {
		return
	}

	// Per-grant authoritative lookup via shared lndparse. Same code path
	// the inline /v1/internal/channel/status handler uses, so the two
	// writers converge on identical semantics.
	for _, grant := range pending {
		if grant.FundingTxID == "" {
			continue // no funding txid yet (and not stale -- handled above)
		}
		status, channelPoint, _, lookupErr := lndparse.LiveChannelLookup(
			ctx, ch.LND, grant.FundingTxID, grant.OutputIndex,
		)
		if lookupErr != nil {
			logger.Warn("channel poller: live lookup failed",
				"grant_id", grant.ID, "error", lookupErr)
			continue
		}
		switch status {
		case "open":
			if grant.Status != "pending_open" {
				continue
			}
			updated, casErr := ch.Store.UpdateChannelStatusCAS(
				ctx, grant.ID, "pending_open", "open",
				channelPoint, grant.FundingFeeRateSatVB,
			)
			if casErr != nil {
				logger.Error("channel poller: CAS update to open failed",
					"grant_id", grant.ID, "error", casErr)
				continue
			}
			if updated {
				logger.Info("channel opened",
					"grant_id", grant.ID, "channel_point", channelPoint)
			}
			// updated=false is benign — the inline handler got there first.
		case "closed":
			if grant.Status != "pending_open" {
				continue
			}
			updated, casErr := ch.Store.UpdateChannelStatusCAS(
				ctx, grant.ID, "pending_open", "closed",
				channelPoint, grant.FundingFeeRateSatVB,
			)
			if casErr != nil {
				logger.Error("channel poller: CAS update to closed failed",
					"grant_id", grant.ID, "error", casErr)
				continue
			}
			if updated {
				logger.Info("channel closed",
					"grant_id", grant.ID, "channel_point", channelPoint)
			}
		case "pending_open":
			// Still confirming on-chain — next tick retries. No-op.
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 21 (Agent A, 2026-04-22): Time-limited pubkey ban handler.
// Unique section anchor: adminBanPubkeyUntilHandlerBlockPhase21AgentA
// ─────────────────────────────────────────────────────────────────────────────

// parseBanDuration parses the duration string supplied to the time-ban
// endpoint. Accepts:
//   - "permanent"               → returns (nil, true, nil) — permanent ban
//   - Go duration syntax        → e.g. "1h", "24h", "30m" via time.ParseDuration
//   - "<N>d" shorthand          → e.g. "7d" becomes 168h (time.ParseDuration
//     lacks native "d" support)
//
// Returns (duration, isPermanent, error). Zero or negative durations are
// rejected so callers can't set a ban in the past (which would be a no-op
// and confuse operators).
func parseBanDuration(s string) (time.Duration, bool, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, false, fmt.Errorf("duration is required")
	}
	if strings.EqualFold(s, "permanent") {
		return 0, true, nil
	}
	// Shorthand "<N>d" → "<N*24>h".
	if strings.HasSuffix(s, "d") && len(s) > 1 {
		var days int
		if _, err := fmt.Sscanf(s, "%dd", &days); err == nil && days > 0 {
			return time.Duration(days) * 24 * time.Hour, false, nil
		}
		return 0, false, fmt.Errorf("invalid day duration: %s", s)
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, false, fmt.Errorf("invalid duration: %s", s)
	}
	if d <= 0 {
		return 0, false, fmt.Errorf("duration must be positive: %s", s)
	}
	return d, false, nil
}

// AdminBanPubkeyUntil sets a time-limited or permanent ban on a pubkey.
// POST /v1/internal/admin/channel/ban
//
// Request body: {"pubkey": "<66-char hex>", "duration": "1h"|"24h"|"7d"|"permanent"}
//
// Response body:
//
//	{"ok": true, "data": {
//	    "pubkey": "<hex>",
//	    "banned_until": "<RFC3339>" | null,
//	    "permanent": true|false
//	}}
//
// Reuses checkAdminAuth (accepts Authorization: Bearer <token> OR the
// legacy X-Admin-Token header). Matches the auth contract of the
// existing AdminUnbanPubkey handler.
func (ch *ChannelHandlers) AdminBanPubkeyUntil(w http.ResponseWriter, r *http.Request) {
	if !checkAdminAuth(r, w, ch.AdminToken) {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized: invalid or missing admin token (supply Authorization: Bearer <token>)"})
		return
	}

	var req struct {
		Pubkey   string `json:"pubkey"`
		Duration string `json:"duration"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid JSON body"})
		return
	}
	if req.Pubkey == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "pubkey is required"})
		return
	}
	if !ValidatePubkey(req.Pubkey) {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid pubkey format"})
		return
	}

	dur, permanent, err := parseBanDuration(req.Duration)
	if err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}

	var until *time.Time
	if !permanent {
		u := time.Now().Add(dur).UTC()
		until = &u
	}

	if err := ch.Store.BanPubkeyUntil(r.Context(), req.Pubkey, until); err != nil {
		if ch.Logger != nil {
			ch.Logger.Error("admin ban pubkey failed", "pubkey", req.Pubkey, "permanent", permanent, "error", err)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to apply ban"})
		return
	}

	resp := map[string]any{
		"pubkey":    req.Pubkey,
		"permanent": permanent,
	}
	if until != nil {
		resp["banned_until"] = until.Format(time.RFC3339)
	} else {
		resp["banned_until"] = nil
	}
	middleware.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "data": resp})
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 21 (Agent B, 2026-04-22): faucet pause handlers.
// Unique section anchor: adminFaucetPauseHandlersBlockPhase21AgentB
//
// The faucet-pause mechanism halts new channel-faucet reservations without
// touching operator channel-open/close/send — it is faucet-only scope. It
// works by creating / removing a flag file on disk whose presence
// ReserveChannelSlot (PGStore + MockStore) checks at entry and whose
// presence /v1/discovery surfaces as channel_faucet.faucet_paused = true
// so honest agents don't burn a /register attempt.
//
// File format: JSON body of
//   { "reason": "...", "actor": "...", "paused_at": "<RFC3339>" }
// Both handlers reuse checkAdminAuth (Bearer OR legacy X-Admin-Token).
// ─────────────────────────────────────────────────────────────────────────────

// faucetPauseFileFormat is the on-disk shape written by AdminFaucetPause
// and parsed by handlers/discovery.go when surfacing the pause reason.
// Kept exported within the package so tests can assert the shape.
type faucetPauseFileFormat struct {
	Reason   string `json:"reason"`
	Actor    string `json:"actor"`
	PausedAt string `json:"paused_at"`
}

// AdminFaucetPause writes the faucet-pause flag file so
// ReserveChannelSlot will refuse new registrations and /v1/discovery will
// advertise faucet_paused=true. Idempotent: re-pausing overwrites the
// file with a refreshed reason/actor/timestamp.
//
// POST /v1/internal/admin/faucet/pause
// Request body: {"reason": "...", "actor": "..."}
func (ch *ChannelHandlers) AdminFaucetPause(w http.ResponseWriter, r *http.Request) {
	if !checkAdminAuth(r, w, ch.AdminToken) {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized: invalid or missing admin token (supply Authorization: Bearer <token>)"})
		return
	}

	if ch.FaucetPauseFilePath == "" {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "faucet pause file path not configured"})
		return
	}

	var req struct {
		Reason string `json:"reason"`
		Actor  string `json:"actor"`
	}
	// Body is optional — a `curl -X POST` with no body should still
	// pause. Decode errors on empty body are swallowed deliberately.
	_ = json.NewDecoder(r.Body).Decode(&req)

	payload := faucetPauseFileFormat{
		Reason:   strings.TrimSpace(req.Reason),
		Actor:    strings.TrimSpace(req.Actor),
		PausedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if payload.Reason == "" {
		payload.Reason = "paused (no reason provided)"
	}

	buf, err := json.Marshal(payload)
	if err != nil {
		if ch.Logger != nil {
			ch.Logger.Error("faucet pause: marshal failed", "error", err)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to encode pause file"})
		return
	}

	// Ensure parent directory exists (0o755 — same convention the
	// kill-switch infrastructure uses). WriteFile replaces existing
	// content atomically enough for our single-writer use case.
	if dir := filepath_Dir(ch.FaucetPauseFilePath); dir != "" {
		_ = os.MkdirAll(dir, 0o755)
	}
	if err := os.WriteFile(ch.FaucetPauseFilePath, buf, 0o644); err != nil {
		if ch.Logger != nil {
			ch.Logger.Error("faucet pause: write flag file failed", "path", ch.FaucetPauseFilePath, "error", err)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to write pause file"})
		return
	}

	if ch.Logger != nil {
		ch.Logger.Warn("channel faucet paused", "actor", payload.Actor, "reason", payload.Reason, "path", ch.FaucetPauseFilePath)
	}
	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"faucet_paused": true,
			"reason":        payload.Reason,
			"actor":         payload.Actor,
			"paused_at":     payload.PausedAt,
		},
	})
}

// AdminFaucetResume removes the faucet-pause flag file. No-op when the
// file is already absent (returns 200 so `/faucet_resume` is idempotent).
//
// POST /v1/internal/admin/faucet/resume
// Request body: {"actor": "..."}
func (ch *ChannelHandlers) AdminFaucetResume(w http.ResponseWriter, r *http.Request) {
	if !checkAdminAuth(r, w, ch.AdminToken) {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized: invalid or missing admin token (supply Authorization: Bearer <token>)"})
		return
	}

	if ch.FaucetPauseFilePath == "" {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "faucet pause file path not configured"})
		return
	}

	var req struct {
		Actor string `json:"actor"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	actor := strings.TrimSpace(req.Actor)

	if err := os.Remove(ch.FaucetPauseFilePath); err != nil && !os.IsNotExist(err) {
		if ch.Logger != nil {
			ch.Logger.Error("faucet resume: remove flag file failed", "path", ch.FaucetPauseFilePath, "error", err)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to remove pause file"})
		return
	}

	if ch.Logger != nil {
		ch.Logger.Warn("channel faucet resumed", "actor", actor, "path", ch.FaucetPauseFilePath)
	}
	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"faucet_paused": false,
			"actor":         actor,
		},
	})
}

// filepath_Dir returns the directory component of a file path. Local
// helper so this file doesn't need to import path/filepath just for one
// use (keeps the import list tight and the helper testable).
func filepath_Dir(p string) string {
	i := strings.LastIndex(p, "/")
	if i < 0 {
		return ""
	}
	return p[:i]
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 21 gateway-gap fix (2026-04-22): token-authed admin read endpoints.
//
// The original Phase 21 skill spec assumed /admin/api/channels (session-authed
// dashboard endpoint) and /etc/lnd-gateway/env (not agent-readable) could be
// used by the faucet-admin skill. They can't. These two handlers wrap the same
// store methods behind the Bearer-accepting checkAdminAuth so the agent can
// surface faucet state from Telegram.
// Unique section anchor: adminFaucetReadEndpointsBlockPhase21GapFix
// ─────────────────────────────────────────────────────────────────────────────

// AdminListFaucetChannels handles GET /v1/internal/admin/faucet/channels.
// Behaviourally identical to admin.ListChannels (session-authed dashboard
// endpoint) but accepts the Bearer admin token instead of a session cookie.
// Query params: status, sort (default created_at), dir (default desc),
// page (default 1), per_page (default 20, max 100). Response shape matches
// the dashboard endpoint: { ok, channels, total, page, per_page }.
func (ch *ChannelHandlers) AdminListFaucetChannels(w http.ResponseWriter, r *http.Request) {
	if !checkAdminAuth(r, w, ch.AdminToken) {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized: invalid or missing admin token (supply Authorization: Bearer <token>)"})
		return
	}

	q := r.URL.Query()
	status := q.Get("status")
	sortBy := q.Get("sort")
	if sortBy == "" {
		sortBy = "created_at"
	}
	dir := q.Get("dir")
	if dir == "" {
		dir = "desc"
	}

	page := 1
	if v := q.Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			page = n
		}
	}
	perPage := 20
	if v := q.Get("per_page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 100 {
			perPage = n
		}
	}
	offset := (page - 1) * perPage

	channels, total, err := ch.Store.ListAllChannelGrants(r.Context(), status, sortBy, dir, offset, perPage)
	if err != nil {
		if ch.Logger != nil {
			ch.Logger.Error("admin list faucet channels failed", "error", err)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to list channels"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"channels": channels,
		"total":    total,
		"page":     page,
		"per_page": perPage,
	})
}

// AdminFaucetConfig handles GET /v1/internal/admin/faucet/config.
// Returns the runtime faucet configuration values the faucet-admin skill
// needs for /faucet_config. Values sourced from:
//   - channel_size_sats, push_sats: ChannelHandlers struct (mirrored from
//     handlers.AdvertisedChannelSizeSats/Push at wire time)
//   - channel_cap: Store.FaucetChannelCapValue()
//   - ban_after_failures: accounts.FaucetBanAfterFailures constant
//   - lqwd_node_uri: LQWD_NODE_URI env (may be empty)
//   - faucet_paused: derived from FaucetPauseFilePath presence
func (ch *ChannelHandlers) AdminFaucetConfig(w http.ResponseWriter, r *http.Request) {
	if !checkAdminAuth(r, w, ch.AdminToken) {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized: invalid or missing admin token (supply Authorization: Bearer <token>)"})
		return
	}

	paused := false
	if ch.FaucetPauseFilePath != "" {
		if _, err := os.Stat(ch.FaucetPauseFilePath); err == nil {
			paused = true
		}
	}

	cfg := map[string]any{
		"channel_size_sats":  ch.AdvertisedChannelSizeSats,
		"push_sats":          ch.AdvertisedPushSats,
		"channel_cap":        ch.Store.FaucetChannelCapValue(),
		"ban_after_failures": FaucetBanAfterFailures,
		"lqwd_node_uri":      os.Getenv("LQWD_NODE_URI"),
		"faucet_paused":      paused,
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": cfg,
	})
}

// AdminFaucetSummary handles GET /v1/internal/admin/faucet/summary.
// Returns pre-aggregated faucet state for the faucet-admin skill's
// /faucet_status command. Doing the aggregation server-side avoids
// LLM counting errors (previously Grok miscounted a 1/7 split as 1/1/6)
// and keeps the skill's bash orchestration minimal.
//
// Response shape:
//   {
//     "ok": true,
//     "data": {
//       "total": 8,
//       "by_status": { "open": 1, "pending_open": 0, "pending": 0,
//                      "failed": 7, "closed": 0 },
//       "recent_bans_24h": 0,
//       "recent_fails_24h": 7,
//       "config": { channel_size_sats, push_sats, channel_cap,
//                   ban_after_failures, lqwd_node_uri, faucet_paused }
//     }
//   }
func (ch *ChannelHandlers) AdminFaucetSummary(w http.ResponseWriter, r *http.Request) {
	if !checkAdminAuth(r, w, ch.AdminToken) {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "unauthorized: invalid or missing admin token (supply Authorization: Bearer <token>)"})
		return
	}

	// Pull ALL grants once (per_page=1000 covers any realistic cap).
	// We aggregate server-side so the LLM doesn't count rows itself.
	channels, total, err := ch.Store.ListAllChannelGrants(r.Context(), "", "created_at", "desc", 0, 1000)
	if err != nil {
		if ch.Logger != nil {
			ch.Logger.Error("admin faucet summary: list grants failed", "error", err)
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to list grants"})
		return
	}

	// Seed with zero entries for every expected status so absent states
	// render as 0 and the skill never needs a fallback.
	byStatus := map[string]int{
		"open":         0,
		"pending_open": 0,
		"pending":      0,
		"failed":       0,
		"closed":       0,
	}
	cutoff24h := time.Now().Add(-24 * time.Hour)
	recentBans24h := 0
	recentFails24h := 0
	now := time.Now()

	for _, g := range channels {
		if _, ok := byStatus[g.Status]; ok {
			byStatus[g.Status]++
		} else {
			byStatus[g.Status]++
		}
		// Recent bans (24h): grants where either a permanent ban
		// applies (banned_until non-nil and after now) or the grant
		// landed in failed with a banning fail category in the 24h
		// window. For now conservative definition — count grants
		// whose BannedUntil is in the future (active time-ban) and
		// whose CreatedAt is within 24h.
		if g.BannedUntil != nil && g.BannedUntil.After(now) && g.CreatedAt.After(cutoff24h) {
			recentBans24h++
		}
		// Recent fails (24h): any grant in failed state created in
		// the last 24 hours.
		if g.Status == "failed" && g.CreatedAt.After(cutoff24h) {
			recentFails24h++
		}
	}

	// Reuse the config block from AdminFaucetConfig so a single
	// /summary call carries everything /faucet_status renders.
	paused := false
	if ch.FaucetPauseFilePath != "" {
		if _, statErr := os.Stat(ch.FaucetPauseFilePath); statErr == nil {
			paused = true
		}
	}
	cfgBlock := map[string]any{
		"channel_size_sats":  ch.AdvertisedChannelSizeSats,
		"push_sats":          ch.AdvertisedPushSats,
		"channel_cap":        ch.Store.FaucetChannelCapValue(),
		"ban_after_failures": FaucetBanAfterFailures,
		"lqwd_node_uri":      os.Getenv("LQWD_NODE_URI"),
		"faucet_paused":      paused,
	}

	responseData := map[string]any{
		"total":            total,
		"by_status":        byStatus,
		"recent_bans_24h":  recentBans24h,
		"recent_fails_24h": recentFails24h,
		"config":           cfgBlock,
	}

	// Phase 22 CHO-04: surface pending-close / force-close counts from a
	// live LND PendingChannels call. Skip gracefully when the RPC fails or
	// no LND client is wired — the rest of the summary is still useful for
	// operators, and a silent zero on RPC failure would be misleading (an
	// operator seeing pending_close_count=0 should be able to trust the node
	// truly has no pending-close channels).
	if ch.LND != nil {
		pending, err := ch.LND.PendingChannels(r.Context())
		if err == nil {
			if data, ok := pending["data"].(map[string]any); ok {
				// Dual-shape assertion — handle both []map[string]any (in-process)
				// and []any (JSON round-trip) identically via countBucket.
				responseData["pending_close_count"] = countBucket(data["pending_closing_channels"])
				responseData["force_close_count"] = countBucket(data["pending_force_closing_channels"])
			}
		} else if ch.Logger != nil {
			ch.Logger.Warn("admin faucet summary: PendingChannels failed; pending-count fields omitted",
				"error", err)
		}
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": responseData,
	})
}

// countBucket returns the element count of a raw LND pending-channels bucket.
// Tolerates both []map[string]any (in-process gRPC wrapper) and []any
// (JSON round-trip) concrete slice types — same dual-shape discipline as
// internal/lndparse. Unknown shapes return 0 rather than panicking.
func countBucket(raw any) int {
	switch v := raw.(type) {
	case []map[string]any:
		return len(v)
	case []any:
		return len(v)
	}
	return 0
}
