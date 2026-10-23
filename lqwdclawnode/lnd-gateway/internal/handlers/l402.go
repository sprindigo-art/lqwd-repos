package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/l402"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/lnd"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// L402Deps holds L402-specific dependencies, separate from the main Dependencies.
type L402Deps struct {
	Service       *l402.Service
	Store         *l402.Store
	TokenExpiry   int // seconds
	InvoiceExpiry int // seconds
	MockMode      bool
	Deps          *Dependencies // access to LND client for invoice creation + node info
}

// L402 endpoint pricing (sats). Configurable per-endpoint.
var l402Pricing = map[string]int64{
	"/v1/l402/node-stats":         5,
	"/v1/l402/network-analytics": 25,
	"/v1/l402/promo":              1,
}

// NodeStats handles GET /v1/l402/node-stats.
// No auth header → 402 challenge. Valid L402 header → return curated node data.
func (ld *L402Deps) NodeStats(w http.ResponseWriter, r *http.Request) {
	// If we get here with a valid L402 token (middleware already verified), return data
	auth := r.Header.Get("Authorization")
	if auth != "" {
		ld.Deps.FetchNodeStats(w, r)
		return
	}

	// No auth → issue 402 challenge
	ld.issueChallenge(w, r, "/v1/l402/node-stats")
}

// issueChallenge creates a new L402 challenge (macaroon + invoice) and returns 402.
func (ld *L402Deps) issueChallenge(w http.ResponseWriter, r *http.Request, endpoint string) {
	price, ok := l402Pricing[endpoint]
	if !ok {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "no pricing configured for endpoint",
		})
		return
	}

	expiresAt := time.Now().Add(time.Duration(ld.TokenExpiry) * time.Second)

	var paymentHash, invoice string
	var mockPreimage string // only set in mock mode
	var err error

	if ld.MockMode {
		// Mock: generate random preimage → derive hash → fake invoice
		paymentHash, mockPreimage, invoice = mockInvoice(price)
	} else {
		// Real: create invoice via LND
		paymentHash, invoice, err = ld.createInvoice(r, price, endpoint)
		if err != nil {
			middleware.WriteJSON(w, http.StatusBadGateway, map[string]any{
				"ok":    false,
				"error": "failed to create invoice: " + err.Error(),
			})
			return
		}
	}

	// Mint macaroon
	macaroonB64, err := ld.Service.MintMacaroon(paymentHash, endpoint, r.Method, expiresAt)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "failed to mint macaroon: " + err.Error(),
		})
		return
	}

	// Store the challenge
	if err := ld.Store.CreateChallenge(paymentHash, macaroonB64, invoice, endpoint, price, expiresAt); err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "failed to store challenge: " + err.Error(),
		})
		return
	}

	// In mock mode, auto-mark as paid with the real preimage so the full
	// 402 → pay → L402 header → 200 cycle works without real Lightning.
	if ld.MockMode {
		ld.Store.MarkPaid(paymentHash, mockPreimage)
	}

	// Return 402 with WWW-Authenticate header
	w.Header().Set("WWW-Authenticate", fmt.Sprintf(`L402 macaroon="%s", invoice="%s"`, macaroonB64, invoice))
	respData := map[string]any{
		"payment_hash": paymentHash,
		"amount_sats":  price,
		"invoice":      invoice,
		"macaroon":     macaroonB64,
		"expires_at":   expiresAt.Format(time.RFC3339),
	}
	// In mock mode, include the preimage so clients can complete the flow without paying
	if ld.MockMode {
		respData["preimage"] = mockPreimage
	}
	middleware.WriteJSON(w, http.StatusPaymentRequired, map[string]any{
		"ok":    false,
		"error": "payment_required",
		"data":  respData,
	})
}

// NetworkAnalytics handles GET /v1/l402/network-analytics.
func (ld *L402Deps) NetworkAnalytics(w http.ResponseWriter, r *http.Request) {
	auth := r.Header.Get("Authorization")
	if auth != "" {
		ld.Deps.FetchNetworkAnalytics(w, r)
		return
	}
	ld.issueChallenge(w, r, "/v1/l402/network-analytics")
}

// Promo handles GET /v1/l402/promo.
func (ld *L402Deps) Promo(w http.ResponseWriter, r *http.Request) {
	auth := r.Header.Get("Authorization")
	if auth != "" {
		ld.Deps.FetchPromo(w, r)
		return
	}
	ld.issueChallenge(w, r, "/v1/l402/promo")
}

// createInvoice creates a real Lightning invoice via LND.
func (ld *L402Deps) createInvoice(r *http.Request, amountSats int64, endpoint string) (paymentHash, invoice string, err error) {
	memo := fmt.Sprintf("L402 access: %s", endpoint)

	resp, lndErr := ld.Deps.LND.CreateInvoice(r.Context(), lnd.CreateInvoiceRequest{
		AmountSats: amountSats,
		Memo:       memo,
		ExpirySecs: int64(ld.InvoiceExpiry),
	})
	if lndErr != nil {
		return "", "", lndErr
	}

	data, _ := resp["data"].(map[string]any)
	ph, _ := data["r_hash"].(string)
	inv, _ := data["payment_request"].(string)
	if ph == "" || inv == "" {
		return "", "", fmt.Errorf("LND returned empty payment_hash or invoice")
	}
	return ph, inv, nil
}

// mockInvoice generates a random preimage, derives the payment hash, and returns
// all three values so mock mode can auto-pay with the correct preimage.
func mockInvoice(amountSats int64) (paymentHash, preimageHex, invoice string) {
	var preimage [32]byte
	rand.Read(preimage[:])
	hash := sha256.Sum256(preimage[:])
	paymentHash = hex.EncodeToString(hash[:])
	preimageHex = hex.EncodeToString(preimage[:])
	invoice = fmt.Sprintf("lnbc%dn1mock_%s", amountSats*10, paymentHash[:16])
	return paymentHash, preimageHex, invoice
}

// L402InvoiceCallback is called when a Lightning invoice is settled.
// It marks the corresponding L402 token as paid.
func (ld *L402Deps) InvoiceCallback(paymentHash, preimage string) error {
	return ld.Store.MarkPaid(paymentHash, preimage)
}

// ParseL402Request is a helper to decode JSON request bodies for L402 endpoints.
func parseL402Request(r *http.Request, v any) error {
	if r.Body == nil {
		return nil
	}
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(v)
}
