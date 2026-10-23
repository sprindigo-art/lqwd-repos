package accounts

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"time"

	"github.com/google/uuid"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/handlers"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// ProxyHandlers implements the Reserve-Execute-Settle proxy flow for credit-based
// access to L402 data endpoints. Each call reserves credits, executes the upstream
// handler, then settles (on success) or refunds (on failure).
type ProxyHandlers struct {
	Store   AccountStore
	Deps    *handlers.Dependencies
	Price   int64
	Timeout time.Duration
}

// handleProxy is the core Reserve-Execute-Settle flow for proxy endpoints.
// It guarantees no double debits (idempotency) and no lost credits (refund on failure).
func (h *ProxyHandlers) handleProxy(w http.ResponseWriter, r *http.Request, endpoint string, fetch func(http.ResponseWriter, *http.Request)) {
	// 1. Extract authenticated agent
	agent := GetAgent(r.Context())
	if agent == nil {
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{
			"ok":      false,
			"error":   "unauthorized",
			"message": "not authenticated",
		})
		return
	}

	// 2. Require idempotency key
	idempKey := r.Header.Get("X-Idempotency-Key")
	if idempKey == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":      false,
			"error":   "missing_idempotency_key",
			"message": "X-Idempotency-Key header is required",
		})
		return
	}

	// 3. Validate UUID format
	if _, err := uuid.Parse(idempKey); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":      false,
			"error":   "invalid_idempotency_key",
			"message": "X-Idempotency-Key must be a valid UUID v4",
		})
		return
	}

	// 4. Generate X-Request-ID for tracing
	requestID := uuid.New().String()
	w.Header().Set("X-Request-ID", requestID)

	// 5. Check daily spend cap
	remaining, err := h.Store.DailySpendRemaining(r.Context(), agent.ID, agent.Tier)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":      false,
			"error":   "internal_error",
			"message": "failed to check spend cap",
		})
		return
	}
	if remaining < h.Price {
		middleware.WriteJSON(w, http.StatusPaymentRequired, map[string]any{
			"ok":      false,
			"error":   "spend_cap_exceeded",
			"message": "daily spend cap exceeded",
			"details": map[string]any{
				"daily_spend_remaining_sats": remaining,
				"cost_sats":                 h.Price,
				"reset_at":                  "midnight UTC",
			},
		})
		return
	}

	// 6. Reserve credits (atomic with idempotency check)
	result, err := h.Store.ReserveCredits(r.Context(), ReserveRequest{
		AgentID:        agent.ID,
		AmountSats:     h.Price,
		IdempotencyKey: idempKey,
		Endpoint:       endpoint,
		RequestID:      requestID,
	})
	if err != nil {
		if err == ErrInsufficientCredits {
			middleware.WriteJSON(w, http.StatusPaymentRequired, map[string]any{
				"ok":      false,
				"error":   "insufficient_credits",
				"message": "not enough credits for this call",
				"details": map[string]any{
					"cost_sats": h.Price,
					"hint":      "Top up your credits or claim Tier 2",
				},
			})
			return
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":      false,
			"error":   "reserve_failed",
			"message": "failed to reserve credits",
		})
		return
	}

	// Idempotency hit — return cached response
	if result.Cached != nil {
		w.Header().Set("X-Idempotency-Replay", "true")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(result.Cached.StatusCode)
		w.Write([]byte(result.Cached.ResponseBody))
		return
	}

	// 7. Execute upstream with timeout
	upstreamCtx, cancel := context.WithTimeout(r.Context(), h.Timeout)
	defer cancel()

	rec := httptest.NewRecorder()
	r.Header.Set("X-Request-ID", requestID)
	fetch(rec, r.WithContext(upstreamCtx))

	// 8. Settle or refund — use background context to survive client disconnect
	settleCtx, settleCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer settleCancel()

	if rec.Code >= 500 || upstreamCtx.Err() != nil {
		// Upstream failure or timeout — refund credits
		h.Store.RefundReserve(settleCtx, result.ReserveID, idempKey, endpoint)
		middleware.WriteJSON(w, http.StatusBadGateway, map[string]any{
			"ok":      false,
			"error":   "upstream_failure",
			"message": "upstream service error, credits refunded",
			"details": map[string]any{
				"credits_refunded": true,
				"refunded_sats":   h.Price,
			},
		})
		return
	}

	// Success — settle the reserve into a permanent debit
	h.Store.SettleReserve(settleCtx, result.ReserveID, idempKey, endpoint, rec.Code, rec.Body.String())

	// Copy upstream response to actual client
	for k, v := range rec.Header() {
		w.Header()[k] = v
	}
	// Ensure X-Request-ID is set (upstream may have overwritten headers)
	w.Header().Set("X-Request-ID", requestID)
	w.WriteHeader(rec.Code)
	w.Write(rec.Body.Bytes())
}

// NodeStats proxies a node-stats request through the Reserve-Execute-Settle flow.
func (h *ProxyHandlers) NodeStats(w http.ResponseWriter, r *http.Request) {
	h.handleProxy(w, r, "node-stats", h.Deps.FetchNodeStats)
}

// NetworkAnalytics proxies a network-analytics request through the Reserve-Execute-Settle flow.
func (h *ProxyHandlers) NetworkAnalytics(w http.ResponseWriter, r *http.Request) {
	h.handleProxy(w, r, "network-analytics", h.Deps.FetchNetworkAnalytics)
}

// Promo proxies a promo request through the Reserve-Execute-Settle flow.
func (h *ProxyHandlers) Promo(w http.ResponseWriter, r *http.Request) {
	h.handleProxy(w, r, "promo", h.Deps.FetchPromo)
}

// StartCleanup launches a background goroutine that periodically refunds orphaned
// reserves (reserves that were never settled or refunded, likely due to process crash).
func (h *ProxyHandlers) StartCleanup(ctx context.Context, interval time.Duration, maxAge time.Duration, logger *slog.Logger) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := h.Store.CleanupOrphanedReserves(ctx, maxAge)
				if err != nil {
					logger.Error("proxy reserve cleanup failed", "error", err)
				} else if n > 0 {
					logger.Info("proxy reserve cleanup", "removed", n)
				}
			}
		}
	}()
}
