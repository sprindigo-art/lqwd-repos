package handlers

import (
	"net/http"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// FetchNodeStats writes curated, public-safe node statistics to w.
// Used by both L402 and internal handlers.
func (d *Dependencies) FetchNodeStats(w http.ResponseWriter, r *http.Request) {
	if d.MockMode {
		middleware.WriteJSON(w, http.StatusOK, mock.L402NodeStats())
		return
	}
	// Real mode: get info from LND, extract curated fields
	info, err := d.LND.GetInfo(r.Context())
	if err != nil {
		middleware.WriteJSON(w, http.StatusBadGateway, map[string]any{
			"ok":    false,
			"error": "failed to get node info",
		})
		return
	}
	data, _ := info["data"].(map[string]any)
	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"identity_pubkey":     data["identity_pubkey"],
			"alias":               data["alias"],
			"num_active_channels": data["num_active_channels"],
			"num_peers":           data["num_peers"],
			"synced_to_chain":     data["synced_to_chain"],
			"synced_to_graph":     data["synced_to_graph"],
			"block_height":        data["block_height"],
			"version":             data["version"],
		},
	})
}

// FetchNetworkAnalytics writes network analytics data to w.
// Used by both L402 and internal handlers.
func (d *Dependencies) FetchNetworkAnalytics(w http.ResponseWriter, r *http.Request) {
	if d.MockMode {
		middleware.WriteJSON(w, http.StatusOK, mock.L402NetworkAnalytics())
		return
	}
	feeReport, err := d.LND.FeeReport(r.Context())
	if err != nil {
		middleware.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "failed to get fee report"})
		return
	}
	info, err := d.LND.GetInfo(r.Context())
	if err != nil {
		middleware.WriteJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "failed to get node info"})
		return
	}
	infoData, _ := info["data"].(map[string]any)
	feeData, _ := feeReport["data"].(map[string]any)
	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"data": map[string]any{
			"alias":               infoData["alias"],
			"num_active_channels": infoData["num_active_channels"],
			"num_peers":           infoData["num_peers"],
			"day_fee_sum":         feeData["day_fee_sum"],
			"week_fee_sum":        feeData["week_fee_sum"],
			"month_fee_sum":       feeData["month_fee_sum"],
		},
	})
}

// FetchPromo writes promotional data to w.
// Used by both L402 and internal handlers.
func (d *Dependencies) FetchPromo(w http.ResponseWriter, r *http.Request) {
	middleware.WriteJSON(w, http.StatusOK, mock.L402Promo())
}
