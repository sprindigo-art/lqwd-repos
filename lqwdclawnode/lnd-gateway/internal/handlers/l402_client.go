package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// marshalForIdempotency serializes a response body in the exact format
// middleware.WriteJSON emits (json.Encoder adds a trailing newline). Storing
// the same bytes the original writer produced ensures idempotent replays are
// byte-for-byte identical to the first response.
func marshalForIdempotency(v any) []byte {
	b, _ := json.Marshal(v)
	return append(b, '\n')
}

// l402HTTPClient has an explicit timeout to prevent hanging on slow upstreams.
// Transport bounds prevent connection leaks on the long-lived package-level client.
var l402HTTPClient = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:    10,
		MaxConnsPerHost: 5,
		IdleConnTimeout: 90 * time.Second,
	},
}

// L402PayRequest is the body for POST /v1/l402/pay.
type L402PayRequest struct {
	URL            string `json:"url"`             // The L402-protected URL to fetch
	MaxSats        int64  `json:"max_sats"`        // Max sats willing to pay (budget guard)
	IdempotencyKey string `json:"idempotency_key"` // Prevent duplicate payments
}

// L402Pay handles POST /v1/l402/pay — the agent-facing L402 client.
// Flow: fetch URL → detect 402 → extract macaroon+invoice → budget check →
// pay invoice via LND → retry with L402 header → return result.
func (ld *L402Deps) L402Pay(w http.ResponseWriter, r *http.Request) {
	// Require agent or admin token (this is an internal endpoint, not L402-authed)
	level := middleware.GetTokenLevel(r.Context())
	if level == middleware.TokenNone {
		middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
			"ok": false, "error": "L402 pay requires agent or admin token",
		})
		return
	}

	var req L402PayRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "invalid request body: " + err.Error(),
		})
		return
	}

	if req.URL == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "url is required",
		})
		return
	}
	if req.MaxSats <= 0 {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok": false, "error": "max_sats must be positive",
		})
		return
	}

	// Idempotency check
	if req.IdempotencyKey != "" {
		cached, err := ld.Deps.Idempotency.CheckAndReserve(req.IdempotencyKey, "/v1/l402/pay")
		if err != nil {
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
				"ok": false, "error": "idempotency check failed",
			})
			return
		}
		if cached != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(cached.StatusCode)
			w.Write([]byte(cached.ResponseBody))
			return
		}
	}

	// Budget check
	budgetResult, err := ld.Deps.Budget.Check("l402_payment", req.MaxSats, 0)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok": false, "error": "budget check failed: " + err.Error(),
		})
		return
	}
	if !budgetResult.Allowed {
		middleware.WriteJSON(w, http.StatusForbidden, map[string]any{
			"ok":     false,
			"error":  "budget_exceeded",
			"reason": budgetResult.Reason,
		})
		return
	}

	// Mock mode: simulate the full flow
	if ld.MockMode {
		resp := mock.L402ClientPay(req.URL, req.MaxSats)
		respBytes := marshalForIdempotency(resp)
		middleware.WriteJSON(w, http.StatusOK, resp)

		// Store success response so idempotent replays return the same payload.
		// Before Phase 16.2 this Store was missing, so a retry of the same key
		// within 24h would see status_code=0 and get a 409 "duplicate request
		// in progress" for a full day — unrecoverable for the caller.
		if err := ld.Deps.Idempotency.Store(req.IdempotencyKey, "/v1/l402/pay", http.StatusOK, string(respBytes)); err != nil {
			slog.Default().Error("l402 idempotency store failed", "error", err)
		}

		ld.Deps.Audit.Log(audit.Entry{
			Endpoint:   "l402_pay",
			Method:     r.Method,
			TokenLevel: "agent",
			AmountSats: req.MaxSats,
			OpType:     "l402_payment",
			RequestID:  middleware.GetRequestID(r.Context()),
		})
		return
	}

	// Production mode: HTTP fetch → detect 402 → pay → retry
	// Idempotency semantics: we release the reservation when NO funds moved
	// (pre-payment errors) so a retry can go through cleanly. When funds
	// DID move but a downstream step failed, we Store the error + receipt
	// so retries surface the failure instead of double-paying.
	result, err := ld.executeL402Fetch(r, req)
	if err != nil {
		errResp := map[string]any{
			"ok": false, "error": "L402 fetch failed: " + err.Error(),
		}
		if result != nil && result.PaidSats > 0 {
			// Payment succeeded, downstream failed. Expose the receipt so the
			// caller can prove payment off-line, and Store the error outcome
			// so retries don't re-pay.
			errResp["receipt"] = map[string]any{
				"paid_sats":    result.PaidSats,
				"payment_hash": result.PaymentHash,
				"body":         result.Body,
			}
			errBytes := marshalForIdempotency(errResp)
			if storeErr := ld.Deps.Idempotency.Store(req.IdempotencyKey, "/v1/l402/pay", http.StatusBadGateway, string(errBytes)); storeErr != nil {
				slog.Default().Error("l402 idempotency store (paid-but-failed) failed", "error", storeErr)
			}
			// Audit the outflow so DailySpend reflects it.
			ld.Deps.Audit.Log(audit.Entry{
				Endpoint:     "l402_pay",
				Method:       r.Method,
				TokenLevel:   "agent",
				ResponseCode: http.StatusBadGateway,
				AmountSats:   result.PaidSats,
				OpType:       "l402_payment",
				Error:        err.Error(),
				RequestID:    middleware.GetRequestID(r.Context()),
			})
			middleware.WriteJSON(w, http.StatusBadGateway, errResp)
			return
		}
		// No funds moved — release the reservation so the caller can retry.
		if relErr := ld.Deps.Idempotency.Release(req.IdempotencyKey, "/v1/l402/pay"); relErr != nil {
			slog.Default().Error("l402 idempotency release failed", "error", relErr)
		}
		middleware.WriteJSON(w, http.StatusBadGateway, errResp)
		return
	}

	resp := map[string]any{
		"ok": true,
		"data": map[string]any{
			"url":          req.URL,
			"paid_sats":    result.PaidSats,
			"payment_hash": result.PaymentHash,
			"response":     result.Body,
		},
	}
	respBytes := marshalForIdempotency(resp)
	middleware.WriteJSON(w, http.StatusOK, resp)

	if err := ld.Deps.Idempotency.Store(req.IdempotencyKey, "/v1/l402/pay", http.StatusOK, string(respBytes)); err != nil {
		slog.Default().Error("l402 idempotency store failed", "error", err)
	}

	ld.Deps.Audit.Log(audit.Entry{
		Endpoint:     "l402_pay",
		Method:       r.Method,
		TokenLevel:   "agent",
		ResponseCode: http.StatusOK,
		AmountSats:   result.PaidSats,
		OpType:       "l402_payment",
		RequestID:    middleware.GetRequestID(r.Context()),
	})
}

type l402FetchResult struct {
	PaidSats    int64
	PaymentHash string
	Body        string
}

// executeL402Fetch performs the real L402 client flow: GET → 402 → pay → retry.
func (ld *L402Deps) executeL402Fetch(r *http.Request, req L402PayRequest) (*l402FetchResult, error) {
	// Step 1: Fetch the URL (use caller's context so cancellation propagates)
	fetchReq, err := http.NewRequestWithContext(r.Context(), "GET", req.URL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	fetchReq.Header.Set("X-Request-ID", middleware.GetRequestID(r.Context()))
	httpResp, err := l402HTTPClient.Do(fetchReq)
	if err != nil {
		return nil, fmt.Errorf("fetch URL: %w", err)
	}
	defer httpResp.Body.Close()

	// If not 402, return the response as-is (no payment needed)
	if httpResp.StatusCode != http.StatusPaymentRequired {
		var body json.RawMessage
		json.NewDecoder(httpResp.Body).Decode(&body)
		return &l402FetchResult{Body: string(body)}, nil
	}

	// Step 2: Extract L402 challenge from WWW-Authenticate header
	wwwAuth := httpResp.Header.Get("WWW-Authenticate")
	if wwwAuth == "" {
		return nil, fmt.Errorf("402 response missing WWW-Authenticate header")
	}

	// Parse challenge body for invoice
	var challengeBody struct {
		Data struct {
			Invoice     string `json:"invoice"`
			AmountSats  int64  `json:"amount_sats"`
			Macaroon    string `json:"macaroon"`
			PaymentHash string `json:"payment_hash"`
		} `json:"data"`
	}
	if err := json.NewDecoder(httpResp.Body).Decode(&challengeBody); err != nil {
		return nil, fmt.Errorf("parse 402 body: %w", err)
	}

	if challengeBody.Data.AmountSats > req.MaxSats {
		return nil, fmt.Errorf("invoice amount %d sats exceeds max_sats %d", challengeBody.Data.AmountSats, req.MaxSats)
	}

	// Step 3: Pay the invoice via LND
	payResp, err := ld.Deps.LND.SendPayment(r.Context(), lnd.SendPaymentRequest{
		PaymentRequest: challengeBody.Data.Invoice,
		TimeoutSeconds: 60,
		FeeLimitSat:    100, // reasonable fee limit
	})
	if err != nil {
		return nil, fmt.Errorf("pay invoice: %w", err)
	}

	payData, _ := payResp["data"].(map[string]any)
	preimage, _ := payData["payment_preimage"].(string)
	if preimage == "" {
		return nil, fmt.Errorf("payment succeeded but no preimage returned")
	}

	// Step 4: Retry with L402 header
	retryReq, err := http.NewRequestWithContext(r.Context(), "GET", req.URL, nil)
	if err != nil {
		return nil, fmt.Errorf("create retry request: %w", err)
	}
	retryReq.Header.Set("X-Request-ID", middleware.GetRequestID(r.Context()))
	retryReq.Header.Set("Authorization", fmt.Sprintf("L402 %s:%s", challengeBody.Data.Macaroon, preimage))

	retryResp, err := l402HTTPClient.Do(retryReq)
	if err != nil {
		return nil, fmt.Errorf("retry with L402: %w", err)
	}
	defer retryResp.Body.Close()

	var retryBody json.RawMessage
	json.NewDecoder(retryResp.Body).Decode(&retryBody)

	if retryResp.StatusCode != http.StatusOK {
		return &l402FetchResult{
			PaidSats:    challengeBody.Data.AmountSats,
			PaymentHash: challengeBody.Data.PaymentHash,
			Body: fmt.Sprintf(
				`{"error":"upstream returned %d after payment","receipt":{"paid_sats":%d,"payment_hash":"%s","preimage":"%s"}}`,
				retryResp.StatusCode, challengeBody.Data.AmountSats, challengeBody.Data.PaymentHash, preimage,
			),
		}, fmt.Errorf("upstream returned %d after payment (preimage: %s, sats: %d)",
			retryResp.StatusCode, preimage, challengeBody.Data.AmountSats)
	}

	return &l402FetchResult{
		PaidSats:    challengeBody.Data.AmountSats,
		PaymentHash: challengeBody.Data.PaymentHash,
		Body:        string(retryBody),
	}, nil
}
