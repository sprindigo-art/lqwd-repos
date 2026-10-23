// Package handlers implements HTTP handlers for all gateway endpoints.
// In mock mode, handlers return static responses. In production, they call LND gRPC.
package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/budget"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/confirm"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/idempotency"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/killswitch"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// Dependencies holds all shared dependencies for handlers.
type Dependencies struct {
	MockMode    bool
	DataDir     string        // e.g. /var/lib/lnd-gateway
	LND         lnd.Client    // nil when MockMode=true
	Executor    *lnd.Executor // nil when MockMode=true
	Audit       *audit.Logger
	Budget      *budget.Enforcer
	Idempotency *idempotency.Store
	Confirm     *confirm.Manager
	KillSwitch  *killswitch.KillSwitch
	StartTime   time.Time
	// FaucetPauseFilePath (Phase 21, 2026-04-22): when this file exists
	// on disk, /v1/discovery surfaces faucet_paused=true and parses the
	// JSON payload to expose pause_reason. Wired from
	// config.FaucetPauseFilePath by main.go.
	FaucetPauseFilePath string
}

// Health returns a minimal public health status. The body intentionally
// contains no operational details — a public /v1/health endpoint should
// not leak kill-switch state, pending-confirm counts, budget limits, or
// uptime (all probe-able fingerprints). Operators wanting the full
// snapshot should call /v1/health/detailed from localhost; Caddy's edge
// allowlist returns 404 for that path to non-localhost callers.
func (d *Dependencies) Health(w http.ResponseWriter, r *http.Request) {
	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": map[string]any{"status": "healthy"},
	})
}

// HealthDetailed returns the full operational snapshot: mock mode,
// uptime, kill-switch state, pending-confirm count, and budget limits.
// Intended for localhost callers only — exposure is prevented at the
// edge proxy (Caddy passthrough allowlist does not include this path).
func (d *Dependencies) HealthDetailed(w http.ResponseWriter, r *http.Request) {
	if d.MockMode {
		middleware.WriteJSON(w, http.StatusOK, mock.Health())
		return
	}

	// TODO: Real LND health check (wallet lock detection, gRPC connectivity)
	data := map[string]any{
		"ok": true,
		"data": map[string]any{
			"status":            "healthy",
			"mock_mode":         false,
			"uptime_seconds":    int(time.Since(d.StartTime).Seconds()),
			"kill_switch":       d.KillSwitch.Status(),
			"pending_confirms":  d.Confirm.Count(),
			"budget_limits":     d.Budget.GetLimits(),
		},
	}
	middleware.WriteJSON(w, http.StatusOK, data)
}

// GetInfo returns LND node info.
func (d *Dependencies) GetInfo(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "info", func() (map[string]any, int) {
		if d.MockMode {
			return mock.GetInfo(), http.StatusOK
		}
		resp, err := d.LND.GetInfo(r.Context())
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// WalletBalance returns on-chain wallet balance.
func (d *Dependencies) WalletBalance(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "wallet_balance", func() (map[string]any, int) {
		if d.MockMode {
			return mock.WalletBalance(), http.StatusOK
		}
		resp, err := d.LND.WalletBalance(r.Context())
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// ChannelBalance returns Lightning channel balance.
func (d *Dependencies) ChannelBalance(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "channel_balance", func() (map[string]any, int) {
		if d.MockMode {
			return mock.ChannelBalance(), http.StatusOK
		}
		resp, err := d.LND.ChannelBalance(r.Context())
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// ListChannels returns all open channels.
func (d *Dependencies) ListChannels(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "list_channels", func() (map[string]any, int) {
		if d.MockMode {
			return mock.ListChannels(), http.StatusOK
		}
		resp, err := d.LND.ListChannels(r.Context())
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// pendingChannelsResponse is the allowlisted response struct for
// POST /v1/channels/pending — explicitly NOT a raw LND passthrough, per
// D-20 and PITFALLS.md Pitfall 3. Prevents funding-txid / counterparty-
// pubkey leakage on the surface the faucet-admin skill consumes. The
// upstream widened (*GRPCClient).PendingChannels wrapper includes fields
// like commit_fee and fee_per_kw on the pending_open records — those are
// DELIBERATELY DROPPED here.
type pendingChannelsResponse struct {
	PendingOpenChannels         []pendingChannelSummary `json:"pending_open_channels"`
	PendingClosingChannels      []pendingChannelSummary `json:"pending_closing_channels"`
	PendingForceClosingChannels []pendingChannelSummary `json:"pending_force_closing_channels"`
	WaitingCloseChannels        []pendingChannelSummary `json:"waiting_close_channels"`
	TotalLimboBalance           int64                   `json:"total_limbo_balance"`
}

// pendingChannelSummary is the only per-channel shape that survives filtering.
// Adding fields here is a security-relevant change and REQUIRES a corresponding
// update to TestPendingChannelsAllowlist and the plan's threat-model allowlist.
type pendingChannelSummary struct {
	ChannelPoint  string `json:"channel_point"`
	RemoteNodePub string `json:"remote_node_pub"`
	Capacity      int64  `json:"capacity"`
	LocalBalance  int64  `json:"local_balance"`
	RemoteBalance int64  `json:"remote_balance"`
}

// PendingChannels returns pending channel state buckets from LND.
// Allowlisted response struct per D-20; the raw LND response is NEVER
// marshalled directly. Bearer-authed, localhost-only (NOT added to the
// Caddy api.lqwdclaw.bot allowlist — external callers see 404 at the edge).
//
// Phase 22 CHO-03.
func (d *Dependencies) PendingChannels(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "pending_channels", func() (map[string]any, int) {
		var raw map[string]any
		if d.MockMode {
			raw = mock.PendingChannels()
		} else {
			resp, err := d.LND.PendingChannels(r.Context())
			if err != nil {
				return lndErr(err), http.StatusBadGateway
			}
			raw = resp
		}
		return filterPendingChannels(raw), http.StatusOK
	})
}

// filterPendingChannels narrows the raw LND PendingChannels response to the
// explicit pendingChannelsResponse shape and wraps it in the standard gateway
// envelope ({"ok":true,"data":{...}}). Each source bucket is mapped via
// filterBucket, which copies ONLY the five allowlisted fields per channel.
// Fields absent from the source are zero-valued; extra fields are dropped.
//
// Tolerates both []map[string]any (in-process gRPC wrapper) and []any (JSON
// round-trip) concrete slice types — matching the dual-shape discipline in
// internal/lndparse.
func filterPendingChannels(raw map[string]any) map[string]any {
	data, ok := raw["data"].(map[string]any)
	if !ok {
		// Degenerate input — return a zero-valued but structurally complete
		// response rather than panicking. Operator skills depend on every
		// bucket being present (even if empty).
		return map[string]any{
			"ok": true,
			"data": map[string]any{
				"pending_open_channels":          []pendingChannelSummary{},
				"pending_closing_channels":       []pendingChannelSummary{},
				"pending_force_closing_channels": []pendingChannelSummary{},
				"waiting_close_channels":         []pendingChannelSummary{},
				"total_limbo_balance":            int64(0),
			},
		}
	}
	out := pendingChannelsResponse{
		PendingOpenChannels:         filterBucket(data["pending_open_channels"]),
		PendingClosingChannels:      filterBucket(data["pending_closing_channels"]),
		PendingForceClosingChannels: filterBucket(data["pending_force_closing_channels"]),
		WaitingCloseChannels:        filterBucket(data["waiting_close_channels"]),
		TotalLimboBalance:           coerceInt64(data["total_limbo_balance"]),
	}
	// Serialize as map[string]any so logAndRespond's audit path handles it
	// uniformly with the other handlers' envelope shape.
	return map[string]any{
		"ok": true,
		"data": map[string]any{
			"pending_open_channels":          out.PendingOpenChannels,
			"pending_closing_channels":       out.PendingClosingChannels,
			"pending_force_closing_channels": out.PendingForceClosingChannels,
			"waiting_close_channels":         out.WaitingCloseChannels,
			"total_limbo_balance":            out.TotalLimboBalance,
		},
	}
}

// filterBucket maps a raw per-bucket slice to []pendingChannelSummary.
// Handles []map[string]any (concrete in-process shape) and []any (post-JSON
// generic shape); other shapes yield an empty slice.
func filterBucket(raw any) []pendingChannelSummary {
	out := []pendingChannelSummary{}
	switch v := raw.(type) {
	case []map[string]any:
		for _, ch := range v {
			out = append(out, pendingChannelSummary{
				ChannelPoint:  stringField(ch, "channel_point"),
				RemoteNodePub: stringField(ch, "remote_node_pub"),
				Capacity:      coerceInt64(ch["capacity"]),
				LocalBalance:  coerceInt64(ch["local_balance"]),
				RemoteBalance: coerceInt64(ch["remote_balance"]),
			})
		}
	case []any:
		for _, e := range v {
			ch, ok := e.(map[string]any)
			if !ok {
				continue
			}
			out = append(out, pendingChannelSummary{
				ChannelPoint:  stringField(ch, "channel_point"),
				RemoteNodePub: stringField(ch, "remote_node_pub"),
				Capacity:      coerceInt64(ch["capacity"]),
				LocalBalance:  coerceInt64(ch["local_balance"]),
				RemoteBalance: coerceInt64(ch["remote_balance"]),
			})
		}
	}
	return out
}

// stringField reads a string field from a raw LND map with a zero-value fallback.
// Comma-ok form enforced — no underscore swallows (UAT-11 discipline).
func stringField(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

// coerceInt64 normalizes numeric fields from the raw LND map across the
// concrete types the gRPC wrapper and JSON round-tripper produce.
func coerceInt64(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int:
		return int64(x)
	case int32:
		return int64(x)
	case float64:
		return int64(x)
	}
	return 0
}

// ListPeers returns connected peers.
func (d *Dependencies) ListPeers(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "list_peers", func() (map[string]any, int) {
		if d.MockMode {
			return mock.ListPeers(), http.StatusOK
		}
		resp, err := d.LND.ListPeers(r.Context())
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// FeeEstimate returns current mempool fee estimates.
func (d *Dependencies) FeeEstimate(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "fee_estimate", func() (map[string]any, int) {
		if d.MockMode {
			return mock.FeeEstimate(), http.StatusOK
		}
		resp, err := d.LND.FeeEstimate(r.Context(), 6)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// ConfirmOperation executes a previously created pending operation.
// Requires admin token.
func (d *Dependencies) ConfirmOperation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OperationID string `json:"operation_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OperationID == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "operation_id is required",
		})
		return
	}

	op := d.Confirm.Confirm(req.OperationID)
	if op == nil {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]any{
			"ok":    false,
			"error": "operation not found or expired",
		})
		return
	}

	opType := endpointToOpType(op.Endpoint)

	if d.MockMode {
		middleware.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": "operation confirmed and executed (mock)",
			"operation": op,
		})
		d.Audit.Log(audit.Entry{
			Endpoint:     "confirmed:" + op.Endpoint,
			Method:       "POST",
			TokenLevel:   "admin",
			ResponseCode: http.StatusOK,
			AmountSats:   op.AmountSats,
			OpType:       opType,
			RequestID:    middleware.GetRequestID(r.Context()),
		})
		return
	}

	// Execute the real LND operation via the executor
	resp, err := d.Executor.Execute(r.Context(), op.Endpoint, op.RequestBody)
	if err != nil {
		middleware.WriteJSON(w, http.StatusBadGateway, map[string]any{
			"ok":    false,
			"error": "lnd_error: " + err.Error(),
		})
		d.Audit.Log(audit.Entry{
			Endpoint:     "confirmed:" + op.Endpoint,
			Method:       "POST",
			TokenLevel:   "admin",
			ResponseCode: http.StatusBadGateway,
			AmountSats:   op.AmountSats,
			OpType:       opType,
			Error:        err.Error(),
			RequestID:    middleware.GetRequestID(r.Context()),
		})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, resp)
	d.Audit.Log(audit.Entry{
		Endpoint:     "confirmed:" + op.Endpoint,
		Method:       "POST",
		TokenLevel:   "admin",
		ResponseCode: http.StatusOK,
		AmountSats:   op.AmountSats,
		OpType:       opType,
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}

// endpointToOpType maps a confirmation operation endpoint to the canonical
// op_type used by DailySpend() and other audit analytics. The canonical set
// is intentionally small: {payment, channel_open, channel_close, onchain_send,
// rebalance}. Any unrecognized endpoint yields an empty string, which is
// counted but excluded from spend aggregation.
//
// Keep this in sync with audit.Logger.DailySpend()'s op_type IN (...) clause.
func endpointToOpType(endpoint string) string {
	switch endpoint {
	case "/v1/payments/send":
		return "payment"
	case "/v1/channels/open":
		return "channel_open"
	case "/v1/channels/close":
		return "channel_close"
	case "/v1/onchain/send":
		return "onchain_send"
	case "/v1/rebalance":
		return "rebalance"
	default:
		return ""
	}
}

// RejectOperation cancels a pending operation.
// Requires admin token.
func (d *Dependencies) RejectOperation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OperationID string `json:"operation_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.OperationID == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "operation_id is required",
		})
		return
	}

	if d.Confirm.Reject(req.OperationID) {
		middleware.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": "operation rejected",
		})
	} else {
		middleware.WriteJSON(w, http.StatusNotFound, map[string]any{
			"ok":    false,
			"error": "operation not found",
		})
	}
}

// ListPending returns all pending confirmation operations.
func (d *Dependencies) ListPending(w http.ResponseWriter, r *http.Request) {
	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": d.Confirm.List(),
	})
}

// KillSwitchToggle engages or disengages the programmatic kill switch.
// Requires admin token.
func (d *Dependencies) KillSwitchToggle(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Action string `json:"action"` // "engage" or "disengage"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "action is required (engage/disengage)",
		})
		return
	}

	switch req.Action {
	case "engage":
		d.KillSwitch.Engage()
		middleware.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": "kill switch engaged — all write operations blocked",
			"status":  d.KillSwitch.Status(),
		})
	case "disengage":
		d.KillSwitch.Disengage()
		middleware.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": "kill switch disengaged",
			"status":  d.KillSwitch.Status(),
		})
	default:
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "action must be 'engage' or 'disengage'",
		})
	}
}

// RestartLND triggers an LND restart via a systemd path unit.
// Writes a trigger file that a systemd .path watcher picks up to restart LND.
// This avoids needing elevated privileges in the gateway process.
func (d *Dependencies) RestartLND(w http.ResponseWriter, r *http.Request) {
	d.Audit.Log(audit.Entry{
		Endpoint:     "/v1/admin/restart-lnd",
		Method:       "POST",
		TokenLevel:   "agent",
		ResponseCode: http.StatusOK,
		OpType:       "restart_lnd_initiated",
		RequestID:    middleware.GetRequestID(r.Context()),
	})

	triggerPath := filepath.Join(d.DataDir, "restart-lnd")
	if err := os.WriteFile(triggerPath, []byte(time.Now().UTC().Format(time.RFC3339)), 0644); err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "failed to write restart trigger: " + err.Error(),
		})
		d.Audit.Log(audit.Entry{
			Endpoint:     "/v1/admin/restart-lnd",
			Method:       "POST",
			TokenLevel:   "agent",
			ResponseCode: http.StatusInternalServerError,
			OpType:       "restart_lnd_trigger_failed",
			RequestID:    middleware.GetRequestID(r.Context()),
		})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": "LND restart triggered — check /v1/health in ~10 seconds",
	})
}

// AuditRecent returns recent audit log entries.
func (d *Dependencies) AuditRecent(w http.ResponseWriter, r *http.Request) {
	entries, err := d.Audit.Recent(50)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "failed to query audit log: " + err.Error(),
		})
		return
	}
	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": entries,
	})
}

// logAndRespond is a helper that logs the request/response to the audit DB.
func (d *Dependencies) logAndRespond(w http.ResponseWriter, r *http.Request, endpoint string, fn func() (map[string]any, int)) {
	resp, status := fn()
	middleware.WriteJSON(w, status, resp)

	// Audit log
	respBytes, _ := json.Marshal(resp)
	d.Audit.Log(audit.Entry{
		Endpoint:     endpoint,
		Method:       r.Method,
		TokenLevel:   tokenLevelStr(r),
		ResponseCode: status,
		ResponseBody: string(respBytes),
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}

func tokenLevelStr(r *http.Request) string {
	level := middleware.GetTokenLevel(r.Context())
	switch level {
	case middleware.TokenAdmin:
		return "admin"
	case middleware.TokenAgent:
		return "agent"
	default:
		return "none"
	}
}

// lndErr wraps an LND error into the gateway error envelope.
func lndErr(err error) map[string]any {
	return map[string]any{
		"ok":    false,
		"error": "lnd_error: " + err.Error(),
	}
}

// IsWriteEndpoint returns true for endpoints that modify state.
func IsWriteEndpoint(path string) bool {
	writeEndpoints := map[string]bool{
		"/v1/channels/open":    true,
		"/v1/channels/close":   true,
		"/v1/payments/send":    true,
		"/v1/invoices/create":  true,
		"/v1/onchain/send":     true,
		"/v1/onchain/newaddr":  true,
		"/v1/peers/connect":    true,
		"/v1/peers/disconnect": true,
		"/v1/routing/fees":     true,
		"/v1/rebalance":        true,
		"/v1/confirm":          true,
		"/v1/admin/kill-switch": true,
	}
	return writeEndpoints[path]
}
