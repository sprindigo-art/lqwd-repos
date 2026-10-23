package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/audit"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// AuditQuery returns audit entries matching the given filter criteria.
func (d *Dependencies) AuditQuery(w http.ResponseWriter, r *http.Request) {
	var filter audit.QueryFilter
	if err := json.NewDecoder(r.Body).Decode(&filter); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "invalid request body",
		})
		return
	}

	entries, err := d.Audit.Query(filter)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "failed to query audit log: " + err.Error(),
		})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":    true,
		"data":  entries,
		"count": len(entries),
	})
}

// AuditSummary returns aggregate statistics from the audit log.
func (d *Dependencies) AuditSummary(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Since string `json:"since,omitempty"` // RFC3339
		Until string `json:"until,omitempty"` // RFC3339
	}
	// Ignore decode errors — empty body means "all time"
	json.NewDecoder(r.Body).Decode(&req)

	summary, err := d.Audit.Summary(req.Since, req.Until)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{
			"ok":    false,
			"error": "failed to compute audit summary: " + err.Error(),
		})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": summary,
	})
}
