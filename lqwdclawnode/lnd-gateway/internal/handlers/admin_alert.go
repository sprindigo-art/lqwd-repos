package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// AdminAlert receives operator-visible alerts from skills (SKL-03 version-drift,
// SKL-04 symlink-drift, and any future skill self-check failures). The handler
// is a thin log sink: it validates the payload, emits a structured log entry at
// the requested level, and returns 200.
//
// Operator-visible Telegram delivery is performed by the faucet-monitor skill,
// which tails gateway logs for source=skill:* entries and forwards warn/error
// levels to the operator chat (per memory feedback_operator_visibility — no
// hidden autonomous channels). This handler does NOT open its own Telegram
// client; centralising the egress surface keeps the gateway Go binary
// Telegram-credential-free and lets the operator gate delivery in one place.
//
// Route: POST /v1/internal/admin/alert
// Auth: bearer + X-Internal-Auth (enforced by the cfMw wrapper in main.go).
//
// Request body:
//
//	{"level": "info|warn|error", "source": "skill:<name>", "message": "<=500 chars"}
//
// Responses:
//   - 200 {"ok": true,  "data": {"accepted": true}}
//   - 400 {"ok": false, "error": "<reason>"}
//
// Threat model: T-22-08-07 mitigated by the dual-auth gate; T-22-08-08
// accepted because the alert source is our own skill preambles and the
// message is bounded to 500 chars. Future alert sources must follow the
// same discipline: no tokens, no macaroons, no private keys in messages.
func AdminAlert(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Level   string `json:"level"`
		Source  string `json:"source"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "invalid json body",
		})
		return
	}

	req.Level = strings.TrimSpace(req.Level)
	req.Source = strings.TrimSpace(req.Source)
	// Message intentionally not trimmed — internal whitespace is fine; we
	// only guard the total length and the non-empty requirement.

	switch req.Level {
	case "info", "warn", "error":
		// ok
	default:
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "level must be one of info|warn|error",
		})
		return
	}
	if req.Source == "" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "source required",
		})
		return
	}
	if req.Message == "" || len(req.Message) > 500 {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "message must be non-empty and <=500 chars",
		})
		return
	}

	// Structured log entry. faucet-monitor tails these for source=skill:*
	// and forwards warn/error levels to the operator Telegram channel.
	logger := slog.Default()
	attrs := []any{"source", req.Source, "message", req.Message}
	switch req.Level {
	case "info":
		logger.Info("skill_alert", attrs...)
	case "warn":
		logger.Warn("skill_alert", attrs...)
	case "error":
		logger.Error("skill_alert", attrs...)
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"data": map[string]any{"accepted": true},
	})
}
