package handlers

import "net/http"

// InternalNodeStats handles GET /v1/internal/node-stats.
// Returns the same data as L402 node-stats without the 402 challenge flow.
func (d *Dependencies) InternalNodeStats(w http.ResponseWriter, r *http.Request) {
	d.FetchNodeStats(w, r)
}

// InternalNetworkAnalytics handles GET /v1/internal/network-analytics.
// Returns the same data as L402 network-analytics without the 402 challenge flow.
func (d *Dependencies) InternalNetworkAnalytics(w http.ResponseWriter, r *http.Request) {
	d.FetchNetworkAnalytics(w, r)
}

// InternalPromo handles GET /v1/internal/promo.
// Returns the same data as L402 promo without the 402 challenge flow.
func (d *Dependencies) InternalPromo(w http.ResponseWriter, r *http.Request) {
	d.FetchPromo(w, r)
}
