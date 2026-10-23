package admin

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/accounts"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/middleware"
)

// AdminHandlers holds dependencies for admin API handlers.
type AdminHandlers struct {
	Store             accounts.AccountStore
	Sessions          *SessionStore
	RateLimiter       *LoginRateLimiter
	AdminUsername     string
	AdminPasswordHash string // bcrypt hash from env
}

// loginRequest is the JSON body for POST /admin/api/login.
type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// grantRequest is the JSON body for POST /admin/api/agents/{id}/grant.
type grantRequest struct {
	AmountSats int64  `json:"amount_sats"`
	Reason     string `json:"reason"`
}

// statusRequest is the JSON body for PATCH /admin/api/agents/{id}/status.
type statusRequest struct {
	Status string `json:"status"`
}

// clientIP extracts the client IP from X-Forwarded-For or RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	// Strip port from RemoteAddr
	addr := r.RemoteAddr
	if idx := strings.LastIndex(addr, ":"); idx != -1 {
		return addr[:idx]
	}
	return addr
}

// Login handles POST /admin/api/login.
func (h *AdminHandlers) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		middleware.WriteJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	ip := clientIP(r)

	// Check rate limiter
	allowed, retryAfter := h.RateLimiter.Allow(ip)
	if !allowed {
		minutes := int(math.Ceil(retryAfter.Minutes()))
		middleware.WriteJSON(w, http.StatusTooManyRequests, map[string]any{
			"ok":                  false,
			"error":               "too many login attempts",
			"retry_after_minutes": minutes,
		})
		return
	}

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request body"})
		return
	}

	// Always run bcrypt even on wrong username to prevent timing leaks
	hashToCheck := []byte(h.AdminPasswordHash)
	if req.Username != h.AdminUsername {
		// Use a dummy hash so bcrypt still runs
		hashToCheck = []byte("$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
	}
	err := bcrypt.CompareHashAndPassword(hashToCheck, []byte(req.Password))

	if req.Username != h.AdminUsername || err != nil {
		h.RateLimiter.RecordFailure(ip)
		middleware.WriteJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "invalid credentials"})
		return
	}

	// Success
	h.RateLimiter.Reset(ip)

	token, err := h.Sessions.Create(req.Username, 24*time.Hour)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "session creation failed"})
		return
	}

	csrfToken, err := GenerateCSRFToken()
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "CSRF token generation failed"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    token,
		Path:     "/admin/",
		MaxAge:   86400,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "csrf_token",
		Value:    csrfToken,
		Path:     "/admin/",
		MaxAge:   86400,
		HttpOnly: false,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})

	middleware.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Logout handles POST /admin/api/logout.
func (h *AdminHandlers) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		middleware.WriteJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	cookie, err := r.Cookie("session")
	if err == nil && cookie.Value != "" {
		h.Sessions.Delete(cookie.Value)
	}

	// Clear cookies
	http.SetCookie(w, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/admin/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "csrf_token",
		Value:    "",
		Path:     "/admin/",
		MaxAge:   -1,
		HttpOnly: false,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})

	middleware.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// Metrics handles GET /admin/api/metrics.
func (h *AdminHandlers) Metrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		middleware.WriteJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	rangeStr := r.URL.Query().Get("range")
	rangeHours := 24
	switch rangeStr {
	case "168":
		rangeHours = 168
	case "720":
		rangeHours = 720
	}

	metrics, err := h.Store.AggregateMetrics(r.Context())
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to fetch metrics"})
		return
	}

	timeseries, err := h.Store.TimeSeriesMetrics(r.Context(), rangeHours)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to fetch timeseries"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"metrics":    metrics,
		"timeseries": timeseries,
	})
}

// ListAgents handles GET /admin/api/agents.
func (h *AdminHandlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		middleware.WriteJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	search := r.URL.Query().Get("search")
	sortBy := r.URL.Query().Get("sort")
	if sortBy == "" {
		sortBy = "created_at"
	}
	dir := r.URL.Query().Get("dir")
	if dir == "" {
		dir = "desc"
	}

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	offset := (page - 1) * perPage

	agents, total, err := h.Store.ListAgents(r.Context(), search, sortBy, dir, offset, perPage)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to list agents"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"agents":   agents,
		"total":    total,
		"page":     page,
		"per_page": perPage,
	})
}

// GrantCredits handles POST /admin/api/agents/{id}/grant.
func (h *AdminHandlers) GrantCredits(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		middleware.WriteJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	// Extract agent ID from path: /admin/api/agents/{id}/grant
	path := strings.TrimPrefix(r.URL.Path, "/admin/api/agents/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 || parts[0] == "" || parts[1] != "grant" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid path"})
		return
	}
	agentID := parts[0]

	var req grantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request body"})
		return
	}
	if req.AmountSats <= 0 {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "amount_sats must be positive"})
		return
	}

	err := h.Store.GrantCredits(r.Context(), agentID, req.AmountSats, req.Reason)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			middleware.WriteJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "agent not found"})
			return
		}
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "grant failed"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "granted_sats": req.AmountSats})
}

// UpdateStatus handles PATCH /admin/api/agents/{id}/status.
func (h *AdminHandlers) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		middleware.WriteJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	// Extract agent ID from path: /admin/api/agents/{id}/status
	path := strings.TrimPrefix(r.URL.Path, "/admin/api/agents/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 || parts[0] == "" || parts[1] != "status" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid path"})
		return
	}
	agentID := parts[0]

	var req statusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid request body"})
		return
	}

	switch req.Status {
	case "suspended":
		if err := h.Store.SuspendAgent(r.Context(), agentID); err != nil {
			if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "already suspended") {
				middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "suspend failed"})
			return
		}
	case "active":
		if err := h.Store.UnsuspendAgent(r.Context(), agentID); err != nil {
			if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "not suspended") {
				middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "unsuspend failed"})
			return
		}
	default:
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "status must be 'suspended' or 'active'"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "status": req.Status})
}

// ListChannels handles GET /admin/api/channels.
func (h *AdminHandlers) ListChannels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		middleware.WriteJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	status := r.URL.Query().Get("status")
	sortBy := r.URL.Query().Get("sort")
	if sortBy == "" {
		sortBy = "created_at"
	}
	dir := r.URL.Query().Get("dir")
	if dir == "" {
		dir = "desc"
	}

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	perPage, _ := strconv.Atoi(r.URL.Query().Get("per_page"))
	if perPage < 1 || perPage > 100 {
		perPage = 20
	}
	offset := (page - 1) * perPage

	channels, total, err := h.Store.ListAllChannelGrants(r.Context(), status, sortBy, dir, offset, perPage)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to list channels"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"channels": channels,
		"total":    total,
		"page":     page,
		"per_page": perPage,
	})
}

// AgentTransactions handles GET /admin/api/agents/{id}/transactions.
func (h *AdminHandlers) AgentTransactions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		middleware.WriteJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	// Extract agent ID from path: /admin/api/agents/{id}/transactions
	path := strings.TrimPrefix(r.URL.Path, "/admin/api/agents/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 || parts[0] == "" || parts[1] != "transactions" {
		middleware.WriteJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid path"})
		return
	}
	agentID := parts[0]

	cursor := r.URL.Query().Get("cursor")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 20
	}

	txs, nextCursor, err := h.Store.Transactions(r.Context(), agentID, cursor, limit)
	if err != nil {
		middleware.WriteJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "failed to fetch transactions"})
		return
	}

	middleware.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"transactions": txs,
		"next_cursor":  nextCursor,
	})
}
