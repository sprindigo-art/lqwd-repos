// Package handlers — Phase 2 write operation handlers.
// These endpoints modify LND state and require budget checks, confirmation flows,
// and idempotency enforcement.
package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// --- Channel Operations ---

// OpenChannel opens a new channel. Requires confirmation.
func (d *Dependencies) OpenChannel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NodePubkey        string `json:"node_pubkey"`
		LocalFundingAmount int64  `json:"local_funding_amount"`
		PushSats          int64  `json:"push_sats"`
		TargetConf        int    `json:"target_conf"`
		SatPerVbyte       int64  `json:"sat_per_vbyte"`
		Private           bool   `json:"private"`
		IdempotencyKey    string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "invalid request body",
		})
		return
	}
	if req.NodePubkey == "" || req.LocalFundingAmount <= 0 {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "node_pubkey and local_funding_amount are required",
		})
		return
	}

	// Idempotency check
	if cached, err := d.Idempotency.CheckAndReserve(req.IdempotencyKey, "/v1/channels/open"); err != nil {
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

	// Budget check
	result, err := d.Budget.Check("channel_open", req.LocalFundingAmount, req.SatPerVbyte)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok": false, "error": "budget check failed: " + err.Error(),
		})
		return
	}
	if !result.Allowed {
		resp := map[string]any{
			"ok": false, "error": "budget_exceeded", "reason": result.Reason,
			"daily_spent": result.DailySpent, "daily_remaining": result.DailyRemaining,
		}
		middleware.WriteJSON(w, http.StatusForbidden, resp)
		return
	}

	// Create confirmation (destructive operation — must be confirmed by admin)
	desc := fmt.Sprintf("Open %d sat channel to %s...%s",
		req.LocalFundingAmount, req.NodePubkey[:8], req.NodePubkey[len(req.NodePubkey)-8:])
	if req.PushSats > 0 {
		desc += fmt.Sprintf(" (pushing %d sats)", req.PushSats)
	}
	reqBody, _ := json.Marshal(req)
	op := d.Confirm.Create("/v1/channels/open", desc, string(reqBody), req.LocalFundingAmount)

	resp := map[string]any{
		"ok":                    false,
		"confirmation_required": true,
		"operation_id":          op.ID,
		"description":           op.Description,
		"amount_sats":           req.LocalFundingAmount,
		"expires_at":            op.ExpiresAt,
	}
	respBytes, _ := json.Marshal(resp)
	middleware.WriteJSON(w, http.StatusAccepted, resp)

	// Store idempotency + audit
	d.Idempotency.Store(req.IdempotencyKey, "/v1/channels/open", http.StatusAccepted, string(respBytes))
	d.Audit.Log(audit.Entry{
		Endpoint:     "channels_open",
		Method:       "POST",
		TokenLevel:   tokenLevelStr(r),
		RequestBody:  string(reqBody),
		ResponseCode: http.StatusAccepted,
		AmountSats:   req.LocalFundingAmount,
		OpType:       "channel_open",
		IdempotKey:   req.IdempotencyKey,
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}

// CloseChannel closes a channel. Requires confirmation.
func (d *Dependencies) CloseChannel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ChanID         string `json:"chan_id"`
		Force          bool   `json:"force"`
		TargetConf     int    `json:"target_conf"`
		SatPerVbyte    int64  `json:"sat_per_vbyte"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ChanID == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "chan_id is required",
		})
		return
	}

	// Idempotency check
	if cached, err := d.Idempotency.CheckAndReserve(req.IdempotencyKey, "/v1/channels/close"); err != nil {
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

	// Fee rate guard (on-chain op)
	if req.SatPerVbyte > 0 {
		result, err := d.Budget.Check("channel_close", 0, req.SatPerVbyte)
		if err != nil {
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
				"ok": false, "error": "budget check failed",
			})
			return
		}
		if !result.Allowed {
			middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
				"ok": false, "error": "budget_exceeded", "reason": result.Reason,
			})
			return
		}
	}

	closeType := "cooperative"
	if req.Force {
		closeType = "force"
	}
	desc := fmt.Sprintf("%s close channel %s", closeType, req.ChanID)
	reqBody, _ := json.Marshal(req)
	op := d.Confirm.Create("/v1/channels/close", desc, string(reqBody), 0)

	resp := map[string]any{
		"ok":                    false,
		"confirmation_required": true,
		"operation_id":          op.ID,
		"description":           op.Description,
		"expires_at":            op.ExpiresAt,
	}
	respBytes, _ := json.Marshal(resp)
	middleware.WriteJSON(w, http.StatusAccepted, resp)

	d.Idempotency.Store(req.IdempotencyKey, "/v1/channels/close", http.StatusAccepted, string(respBytes))
	d.Audit.Log(audit.Entry{
		Endpoint:     "channels_close",
		Method:       "POST",
		TokenLevel:   tokenLevelStr(r),
		RequestBody:  string(reqBody),
		ResponseCode: http.StatusAccepted,
		OpType:       "channel_close",
		IdempotKey:   req.IdempotencyKey,
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}

// --- Payment Operations ---

// SendPayment sends a Lightning payment. Budget-checked, idempotency-enforced.
func (d *Dependencies) SendPayment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PaymentRequest string `json:"payment_request"`
		AmountSats     int64  `json:"amount_sats"` // For keysend or zero-amount invoices
		TimeoutSeconds int    `json:"timeout_seconds"`
		FeeLimitSats   int64  `json:"fee_limit_sats"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "invalid request body",
		})
		return
	}
	if req.PaymentRequest == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "payment_request is required",
		})
		return
	}

	// Idempotency check
	if cached, err := d.Idempotency.CheckAndReserve(req.IdempotencyKey, "/v1/payments/send"); err != nil {
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

	// Budget check
	amount := req.AmountSats
	if amount <= 0 {
		// In production, decode the bolt11 invoice to get the amount.
		// For mock mode, use a placeholder.
		amount = 50_000
	}
	result, err := d.Budget.Check("payment", amount, 0)
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
	desc := fmt.Sprintf("Send %d sat payment via invoice", amount)
	reqBody, _ := json.Marshal(req)
	op := d.Confirm.Create("/v1/payments/send", desc, string(reqBody), amount)

	resp := map[string]any{
		"ok":                    false,
		"confirmation_required": true,
		"operation_id":          op.ID,
		"description":           op.Description,
		"amount_sats":           amount,
		"expires_at":            op.ExpiresAt,
	}
	respBytes, _ := json.Marshal(resp)
	middleware.WriteJSON(w, http.StatusAccepted, resp)

	// Store idempotency + audit
	d.Idempotency.Store(req.IdempotencyKey, "/v1/payments/send", http.StatusAccepted, string(respBytes))
	d.Audit.Log(audit.Entry{
		Endpoint:     "payments_send",
		Method:       "POST",
		TokenLevel:   tokenLevelStr(r),
		RequestBody:  string(reqBody),
		ResponseCode: http.StatusAccepted,
		AmountSats:   amount,
		OpType:       "payment",
		IdempotKey:   req.IdempotencyKey,
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}

// CreateInvoice creates a Lightning invoice.
func (d *Dependencies) CreateInvoice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AmountSats int64  `json:"amount_sats"`
		Memo       string `json:"memo"`
		Expiry     int64  `json:"expiry"` // seconds
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "invalid request body",
		})
		return
	}

	d.logAndRespond(w, r, "invoices_create", func() (map[string]any, int) {
		if d.MockMode {
			return mock.CreateInvoice(req.AmountSats, req.Memo), http.StatusOK
		}
		resp, err := d.LND.CreateInvoice(r.Context(), lnd.CreateInvoiceRequest{
			AmountSats: req.AmountSats,
			Memo:       req.Memo,
			ExpirySecs: req.Expiry,
		})
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// LookupInvoice looks up an invoice by payment hash.
func (d *Dependencies) LookupInvoice(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RHash string `json:"r_hash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.RHash == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "r_hash is required",
		})
		return
	}

	d.logAndRespond(w, r, "invoices_lookup", func() (map[string]any, int) {
		if d.MockMode {
			return mock.LookupInvoice(), http.StatusOK
		}
		resp, err := d.LND.LookupInvoice(r.Context(), req.RHash)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// --- On-Chain Operations ---

// SendOnChain sends an on-chain transaction. Requires confirmation.
func (d *Dependencies) SendOnChain(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Address        string `json:"address"`
		AmountSats     int64  `json:"amount_sats"`
		TargetConf     int    `json:"target_conf"`
		SatPerVbyte    int64  `json:"sat_per_vbyte"`
		SendAll        bool   `json:"send_all"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "invalid request body",
		})
		return
	}
	if req.Address == "" || (req.AmountSats <= 0 && !req.SendAll) {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "address and amount_sats are required (or send_all: true)",
		})
		return
	}

	// Idempotency check
	if cached, err := d.Idempotency.CheckAndReserve(req.IdempotencyKey, "/v1/onchain/send"); err != nil {
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

	// Budget check
	result, err := d.Budget.Check("onchain_send", req.AmountSats, req.SatPerVbyte)
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

	// Create confirmation
	desc := fmt.Sprintf("Send %d sats on-chain to %s...%s",
		req.AmountSats, req.Address[:8], req.Address[len(req.Address)-6:])
	if req.SendAll {
		desc = fmt.Sprintf("Send ALL on-chain funds to %s...%s",
			req.Address[:8], req.Address[len(req.Address)-6:])
	}
	reqBody, _ := json.Marshal(req)
	op := d.Confirm.Create("/v1/onchain/send", desc, string(reqBody), req.AmountSats)

	resp := map[string]any{
		"ok":                    false,
		"confirmation_required": true,
		"operation_id":          op.ID,
		"description":           op.Description,
		"amount_sats":           req.AmountSats,
		"expires_at":            op.ExpiresAt,
	}
	respBytes, _ := json.Marshal(resp)
	middleware.WriteJSON(w, http.StatusAccepted, resp)

	d.Idempotency.Store(req.IdempotencyKey, "/v1/onchain/send", http.StatusAccepted, string(respBytes))
	d.Audit.Log(audit.Entry{
		Endpoint:     "onchain_send",
		Method:       "POST",
		TokenLevel:   tokenLevelStr(r),
		RequestBody:  string(reqBody),
		ResponseCode: http.StatusAccepted,
		AmountSats:   req.AmountSats,
		OpType:       "onchain_send",
		IdempotKey:   req.IdempotencyKey,
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}

// NewAddress generates a new on-chain address.
func (d *Dependencies) NewAddress(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Type string `json:"type"` // p2wkh, np2wkh, p2tr
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		req.Type = "p2tr" // default to taproot
	}
	if req.Type == "" {
		req.Type = "p2tr"
	}

	d.logAndRespond(w, r, "onchain_newaddress", func() (map[string]any, int) {
		if d.MockMode {
			return mock.NewAddress(req.Type), http.StatusOK
		}
		resp, err := d.LND.NewAddress(r.Context(), req.Type)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// ListTransactions returns on-chain transaction history.
func (d *Dependencies) ListTransactions(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "onchain_transactions", func() (map[string]any, int) {
		if d.MockMode {
			return mock.ListTransactions(), http.StatusOK
		}
		resp, err := d.LND.ListTransactions(r.Context())
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// --- Routing & Peers ---

// ForwardingHistory returns forwarding events.
func (d *Dependencies) ForwardingHistory(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "routing_forwarding", func() (map[string]any, int) {
		if d.MockMode {
			return mock.ForwardingHistory(), http.StatusOK
		}
		resp, err := d.LND.ForwardingHistory(r.Context(), 0, 0)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// ConnectPeer connects to a new peer.
func (d *Dependencies) ConnectPeer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pubkey         string `json:"pubkey"`
		Host           string `json:"host"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Pubkey == "" || req.Host == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "pubkey and host are required",
		})
		return
	}

	d.logAndRespond(w, r, "peers_connect", func() (map[string]any, int) {
		if d.MockMode {
			return mock.ConnectPeer(), http.StatusOK
		}
		resp, err := d.LND.ConnectPeer(r.Context(), req.Pubkey, req.Host)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}

// DisconnectPeer disconnects from a peer.
func (d *Dependencies) DisconnectPeer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pubkey         string `json:"pubkey"`
		IdempotencyKey string `json:"idempotency_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Pubkey == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "pubkey is required",
		})
		return
	}

	d.logAndRespond(w, r, "peers_disconnect", func() (map[string]any, int) {
		if d.MockMode {
			return mock.DisconnectPeer(), http.StatusOK
		}
		resp, err := d.LND.DisconnectPeer(r.Context(), req.Pubkey)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		return resp, http.StatusOK
	})
}
