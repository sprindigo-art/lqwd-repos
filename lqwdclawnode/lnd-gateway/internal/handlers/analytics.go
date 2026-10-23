// Package handlers — Phase 3 analytics and intelligence endpoints.
// These endpoints provide routing analytics, graph queries, fee reports,
// channel health scores, and rebalancing support.
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// --- Routing Analytics ---

// FeeReport returns aggregate fee data across all channels.
func (d *Dependencies) FeeReport(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "routing_fee_report", func() (map[string]any, int) {
		if d.MockMode {
			return mock.FeeReport(), http.StatusOK
		}
		resp, err := d.LND.FeeReport(r.Context())
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// --- Graph Queries ---

// GraphNodeInfo returns information about a specific node in the network graph.
func (d *Dependencies) GraphNodeInfo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PubKey          string `json:"pub_key"`
		IncludeChannels bool   `json:"include_channels"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.PubKey == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "pub_key is required",
		})
		return
	}

	d.logAndRespond(w, r, "graph_node", func() (map[string]any, int) {
		if d.MockMode {
			return mock.GraphNodeInfo(req.PubKey, req.IncludeChannels), http.StatusOK
		}
		resp, err := d.LND.GetNodeInfo(r.Context(), req.PubKey, req.IncludeChannels)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// GraphChannelInfo returns information about a specific channel in the network graph.
func (d *Dependencies) GraphChannelInfo(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ChanID string `json:"chan_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ChanID == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "chan_id is required",
		})
		return
	}

	d.logAndRespond(w, r, "graph_channel", func() (map[string]any, int) {
		if d.MockMode {
			return mock.GraphChannelInfo(req.ChanID), http.StatusOK
		}
		chanID, parseErr := strconv.ParseUint(req.ChanID, 10, 64)
		if parseErr != nil {
			return map[string]any{"ok": false, "error": "invalid chan_id format"}, http.StatusBadRequest
		}
		resp, err := d.LND.GetChanInfo(r.Context(), chanID)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// --- Channel Scores ---

// ChannelScores returns computed health scores for all channels.
// Scores factor in: activity, balance ratio, peer reliability, forwarding volume.
func (d *Dependencies) ChannelScores(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "analytics_channel_scores", func() (map[string]any, int) {
		if d.MockMode {
			return mock.ChannelScores(), http.StatusOK
		}
		resp, err := d.LND.ChannelScores(r.Context())
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// --- Rebalancing ---

// Rebalance initiates a circular rebalance between two channels.
// Requires admin confirmation: returns 202 Accepted with an operation_id that
// the admin must POST to /v1/confirm before any sats move. Before Phase 16.2,
// this handler executed immediately on the agent token, giving an LLM prompt-
// injection path to drain up to MaxRebalanceFeeSats per call with no human
// approval.
func (d *Dependencies) Rebalance(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OutgoingChanID string `json:"outgoing_chan_id"`
		IncomingChanID string `json:"incoming_chan_id"` // last hop
		AmountSats     int64  `json:"amount_sats"`
		MaxFeeSats     int64  `json:"max_fee_sats"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "invalid request body",
		})
		return
	}
	if req.OutgoingChanID == "" || req.IncomingChanID == "" || req.AmountSats <= 0 {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "outgoing_chan_id, incoming_chan_id, and amount_sats are required",
		})
		return
	}

	// Idempotency check
	if cached, err := d.Idempotency.CheckAndReserve(req.IdempotencyKey, "/v1/rebalance"); err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok": false, "error": "idempotency check failed",
		})
		return
	} else if cached != nil {
		w.Header().Set("X-Idempotent-Replay", "true")
		w.WriteHeader(cached.StatusCode)
		w.Write([]byte(cached.ResponseBody))
		return
	}

	// Budget check — rebalance fee limit
	feeSats := req.MaxFeeSats
	if feeSats <= 0 {
		feeSats = 1000 // default max fee
	}
	result, err := d.Budget.Check("rebalance", feeSats, 0)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok": false, "error": "budget check failed: " + err.Error(),
		})
		return
	}
	if !result.Allowed {
		middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
			"ok": false, "error": "budget_exceeded", "reason": result.Reason,
			"daily_spent": result.DailySpent, "daily_remaining": result.DailyRemaining,
		})
		return
	}

	// Create confirmation (destructive operation — must be confirmed by admin)
	desc := fmt.Sprintf("Rebalance %d sats out=%s in=%s (max fee %d sats)",
		req.AmountSats, req.OutgoingChanID, req.IncomingChanID, feeSats)
	reqBody, _ := json.Marshal(req)
	op := d.Confirm.Create("/v1/rebalance", desc, string(reqBody), feeSats)

	resp := map[string]any{
		"ok":                    false,
		"confirmation_required": true,
		"operation_id":          op.ID,
		"description":           op.Description,
		"amount_sats":           req.AmountSats,
		"max_fee_sats":          feeSats,
		"expires_at":            op.ExpiresAt,
	}
	respBytes, _ := json.Marshal(resp)
	middleware.WriteJSON(w, http.StatusAccepted, resp)

	d.Idempotency.Store(req.IdempotencyKey, "/v1/rebalance", http.StatusAccepted, string(respBytes))
	d.Audit.Log(audit.Entry{
		Endpoint:     "rebalance",
		Method:       "POST",
		TokenLevel:   tokenLevelStr(r),
		RequestBody:  string(reqBody),
		ResponseCode: http.StatusAccepted,
		AmountSats:   feeSats,
		OpType:       "rebalance",
		IdempotKey:   req.IdempotencyKey,
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}

// --- Fee Management ---

// UpdateChannelFees updates fee policies for a specific channel or all channels.
func (d *Dependencies) UpdateChannelFees(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ChanID         string `json:"chan_id"`          // empty = all channels
		BaseFee        int64  `json:"base_fee_msat"`
		FeeRate        int64  `json:"fee_rate_ppm"`     // millionths
		TimeLockDelta  int    `json:"time_lock_delta"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "invalid request body",
		})
		return
	}

	// Idempotency check
	if cached, err := d.Idempotency.CheckAndReserve(req.IdempotencyKey, "/v1/routing/fees"); err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok": false, "error": "idempotency check failed",
		})
		return
	} else if cached != nil {
		w.Header().Set("X-Idempotent-Replay", "true")
		w.WriteHeader(cached.StatusCode)
		w.Write([]byte(cached.ResponseBody))
		return
	}

	desc := fmt.Sprintf("Update fees: base=%d msat, rate=%d ppm", req.BaseFee, req.FeeRate)
	if req.ChanID != "" {
		desc += fmt.Sprintf(" for channel %s", req.ChanID)
	} else {
		desc += " for ALL channels"
	}

	var resp map[string]any
	var status int
	if d.MockMode {
		resp = mock.UpdateChannelFees(req.ChanID, req.BaseFee, req.FeeRate)
		status = http.StatusOK
	} else {
		var err error
		resp, err = d.LND.UpdateChannelPolicy(r.Context(), lnd.UpdatePolicyRequest{
			ChanID:      req.ChanID,
			BaseFeeMsat: req.BaseFee,
			FeeRatePPM:  req.FeeRate,
			TimeLockDelta: uint32(req.TimeLockDelta),
		})
		if err != nil {
			resp = lndErr(err)
			status = http.StatusBadGateway
		} else {
			status = http.StatusOK
		}
	}
	respBytes, _ := json.Marshal(resp)
	middleware.WriteJSON(w, status, resp)

	d.Idempotency.Store(req.IdempotencyKey, "/v1/routing/fees", status, string(respBytes))
	d.Audit.Log(audit.Entry{
		Endpoint:     "routing_fees_update",
		Method:       "POST",
		TokenLevel:   tokenLevelStr(r),
		ResponseCode: status,
		RequestBody:  desc,
		OpType:       "fee_update",
		IdempotKey:   req.IdempotencyKey,
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}
