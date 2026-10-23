package handlers

import (
	"net/http"
	"time"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/mock"
)

// NodeSummary returns a high-level node status summary suitable for external
// consumption by the LQWDClaw orchestrator or other sub-agent queries.
// Aggregates data from multiple LND RPCs into a single response.
func (d *Dependencies) NodeSummary(w http.ResponseWriter, r *http.Request) {
	d.logAndRespond(w, r, "node_summary", func() (map[string]any, int) {
		if d.MockMode {
			return mock.NodeSummary(), http.StatusOK
		}

		ctx := r.Context()

		// Fetch all data in sequence (could parallelize later)
		info, err := d.LND.GetInfo(ctx)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		wallet, err := d.LND.WalletBalance(ctx)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		chanBal, err := d.LND.ChannelBalance(ctx)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		channels, err := d.LND.ListChannels(ctx)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}
		peers, err := d.LND.ListPeers(ctx)
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}

		// 7-day forwarding history
		now := time.Now()
		weekAgo := now.Add(-7 * 24 * time.Hour)
		fwd, err := d.LND.ForwardingHistory(ctx, uint64(weekAgo.Unix()), uint64(now.Unix()))
		if err != nil {
			return lndErr(err), http.StatusBadGateway
		}

		// Extract nested data safely
		infoData, _ := info["data"].(map[string]any)
		walletData, _ := wallet["data"].(map[string]any)
		chanBalData, _ := chanBal["data"].(map[string]any)
		channelData, _ := channels["data"].(map[string]any)
		peerData, _ := peers["data"].(map[string]any)
		fwdData, _ := fwd["data"].(map[string]any)

		// Calculate totals from forwarding events
		fwdCount := 0
		fwdFees := int64(0)
		if events, ok := fwdData["forwarding_events"].([]map[string]any); ok {
			fwdCount = len(events)
			for _, e := range events {
				if fee, ok := e["fee"].(uint64); ok {
					fwdFees += int64(fee)
				}
			}
		}

		// Compute health status
		status := "healthy"
		synced, _ := infoData["synced_to_chain"].(bool)
		if !synced {
			status = "syncing"
		}
		if d.KillSwitch.IsActive() {
			status = "kill_switch_active"
		}

		onchainConfirmed, _ := walletData["confirmed_balance"].(int64)
		localSat, _ := chanBalData["local_balance_sat"].(int64)
		remoteSat, _ := chanBalData["remote_balance_sat"].(int64)
		chanCount := 0
		if channelData != nil {
			if c, ok := channelData["count"].(int); ok {
				chanCount = c
			}
		}
		peerCount := 0
		if peerData != nil {
			if c, ok := peerData["count"].(int); ok {
				peerCount = c
			}
		}

		totalCapacity := localSat + remoteSat
		localRatio := 0.0
		if totalCapacity > 0 {
			localRatio = float64(localSat) / float64(totalCapacity)
		}

		summary := map[string]any{
			"ok": true,
			"data": map[string]any{
				"node":     infoData,
				"balances": map[string]any{
					"onchain_confirmed_sats": onchainConfirmed,
					"channel_local_sats":     localSat,
					"channel_remote_sats":    remoteSat,
					"total_sats":            onchainConfirmed + localSat,
				},
				"channels": map[string]any{
					"active":              chanCount,
					"total_capacity_sats": totalCapacity,
					"avg_local_ratio":     localRatio,
				},
				"peers": map[string]any{
					"connected": peerCount,
				},
				"routing": map[string]any{
					"total_forwards_7d":    fwdCount,
					"total_fees_earned_7d": fwdFees,
				},
				"health": map[string]any{
					"status":      status,
					"kill_switch": d.KillSwitch.IsActive(),
					"uptime_hours": int(time.Since(d.StartTime).Hours()),
				},
				"generated_at": now.UTC().Format(time.RFC3339),
			},
		}

		return summary, http.StatusOK
	})
}
