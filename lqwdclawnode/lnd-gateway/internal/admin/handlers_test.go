package admin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/accounts"
)

func sha256HexForTest(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func newTestHandlers(t *testing.T) (*AdminHandlers, *accounts.MockStore) {
	t.Helper()
	store := accounts.NewMockStore()
	hash, err := bcrypt.GenerateFromPassword([]byte("testpass"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	h := &AdminHandlers{
		Store:             store,
		Sessions:          NewSessionStore(),
		RateLimiter:       NewLoginRateLimiter(5, 15*time.Minute),
		AdminUsername:     "admin",
		AdminPasswordHash: string(hash),
	}
	return h, store
}

func TestLogin_Success(t *testing.T) {
	h, _ := newTestHandlers(t)

	body, _ := json.Marshal(loginRequest{Username: "admin", Password: "testpass"})
	req := httptest.NewRequest(http.MethodPost, "/admin/api/login", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Check cookies
	cookies := rec.Result().Cookies()
	var sessionCookie, csrfCookie *http.Cookie
	for _, c := range cookies {
		switch c.Name {
		case "session":
			sessionCookie = c
		case "csrf_token":
			csrfCookie = c
		}
	}

	if sessionCookie == nil {
		t.Fatal("missing session cookie")
	}
	if !sessionCookie.HttpOnly {
		t.Error("session cookie should be HttpOnly")
	}
	if !sessionCookie.Secure {
		t.Error("session cookie should be Secure")
	}
	if sessionCookie.SameSite != http.SameSiteStrictMode {
		t.Error("session cookie should be SameSite=Strict")
	}

	if csrfCookie == nil {
		t.Fatal("missing csrf_token cookie")
	}
	if csrfCookie.HttpOnly {
		t.Error("csrf_token cookie should NOT be HttpOnly (JS needs to read it)")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	h, _ := newTestHandlers(t)

	body, _ := json.Marshal(loginRequest{Username: "admin", Password: "wrong"})
	req := httptest.NewRequest(http.MethodPost, "/admin/api/login", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestLogin_RateLimited(t *testing.T) {
	h, _ := newTestHandlers(t)

	// Fail 5 times
	for i := 0; i < 5; i++ {
		body, _ := json.Marshal(loginRequest{Username: "admin", Password: "wrong"})
		req := httptest.NewRequest(http.MethodPost, "/admin/api/login", bytes.NewReader(body))
		req.RemoteAddr = "1.2.3.4:12345"
		rec := httptest.NewRecorder()
		h.Login(rec, req)
	}

	// 6th should be rate limited
	body, _ := json.Marshal(loginRequest{Username: "admin", Password: "wrong"})
	req := httptest.NewRequest(http.MethodPost, "/admin/api/login", bytes.NewReader(body))
	req.RemoteAddr = "1.2.3.4:12345"
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMetrics(t *testing.T) {
	h, store := newTestHandlers(t)

	// Register agents to populate data
	store.Register(context.Background(), "agent1", "1.2.3.4")
	store.Register(context.Background(), "agent2", "1.2.3.4")

	req := httptest.NewRequest(http.MethodGet, "/admin/api/metrics", nil)
	rec := httptest.NewRecorder()

	h.Metrics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)

	metrics, ok := resp["metrics"].(map[string]any)
	if !ok {
		t.Fatal("expected metrics object in response")
	}
	if int(metrics["total_agents"].(float64)) != 2 {
		t.Errorf("expected total_agents=2, got %v", metrics["total_agents"])
	}
	if int(metrics["total_credits_granted"].(float64)) != 300 {
		t.Errorf("expected total_credits_granted=300, got %v", metrics["total_credits_granted"])
	}
}

func TestListAgents(t *testing.T) {
	h, store := newTestHandlers(t)

	store.Register(context.Background(), "alice", "1.2.3.4")
	store.Register(context.Background(), "bob", "1.2.3.4")

	req := httptest.NewRequest(http.MethodGet, "/admin/api/agents", nil)
	rec := httptest.NewRecorder()

	h.ListAgents(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)

	agents, ok := resp["agents"].([]any)
	if !ok {
		t.Fatal("expected agents array in response")
	}
	if len(agents) != 2 {
		t.Errorf("expected 2 agents, got %d", len(agents))
	}
	total := int(resp["total"].(float64))
	if total != 2 {
		t.Errorf("expected total=2, got %d", total)
	}
}

func TestGrantCredits(t *testing.T) {
	h, store := newTestHandlers(t)

	agent, _, _ := store.Register(context.Background(), "agent1", "1.2.3.4")

	body, _ := json.Marshal(grantRequest{AmountSats: 1000, Reason: "Tier 3 bonus"})
	req := httptest.NewRequest(http.MethodPost, "/admin/api/agents/"+agent.ID+"/grant", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	h.GrantCredits(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify balance
	profile, _ := store.Profile(context.Background(), agent.ID)
	if profile.BalanceSats != 1150 { // 150 + 1000
		t.Errorf("expected balance=1150, got %d", profile.BalanceSats)
	}
}

func TestSuspendAgent(t *testing.T) {
	h, store := newTestHandlers(t)

	agent, rawKey, _ := store.Register(context.Background(), "agent1", "1.2.3.4")

	body, _ := json.Marshal(statusRequest{Status: "suspended"})
	req := httptest.NewRequest(http.MethodPatch, "/admin/api/agents/"+agent.ID+"/status", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	h.UpdateStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify agent is suspended via Authenticate
	_ = rawKey
	result, _ := store.Authenticate(context.Background(), sha256HexForTest(rawKey))
	if result == nil {
		t.Fatal("expected agent from Authenticate")
	}
	if result.Status != "suspended" {
		t.Errorf("expected status=suspended, got %s", result.Status)
	}
}

func TestUnsuspendAgent(t *testing.T) {
	h, store := newTestHandlers(t)

	agent, _, _ := store.Register(context.Background(), "agent1", "1.2.3.4")

	// Suspend first
	store.SuspendAgent(context.Background(), agent.ID)

	// Unsuspend
	body, _ := json.Marshal(statusRequest{Status: "active"})
	req := httptest.NewRequest(http.MethodPatch, "/admin/api/agents/"+agent.ID+"/status", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	h.UpdateStatus(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCSRF_Rejected(t *testing.T) {
	h, store := newTestHandlers(t)

	agent, _, _ := store.Register(context.Background(), "agent1", "1.2.3.4")

	// Wrap GrantCredits handler with CSRF middleware
	handler := CSRFMiddleware(http.HandlerFunc(h.GrantCredits))

	body, _ := json.Marshal(grantRequest{AmountSats: 1000, Reason: "test"})
	req := httptest.NewRequest(http.MethodPost, "/admin/api/agents/"+agent.ID+"/grant", bytes.NewReader(body))
	// No CSRF cookie or header
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLogout(t *testing.T) {
	h, _ := newTestHandlers(t)

	// Login first
	body, _ := json.Marshal(loginRequest{Username: "admin", Password: "testpass"})
	req := httptest.NewRequest(http.MethodPost, "/admin/api/login", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("login failed: %d", rec.Code)
	}

	// Extract session cookie
	var sessionValue string
	for _, c := range rec.Result().Cookies() {
		if c.Name == "session" {
			sessionValue = c.Value
		}
	}

	// Logout
	req = httptest.NewRequest(http.MethodPost, "/admin/api/logout", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: sessionValue})
	rec = httptest.NewRecorder()
	h.Logout(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	// Session should be invalid now
	sess := h.Sessions.Validate(sessionValue)
	if sess != nil {
		t.Error("expected session to be deleted after logout")
	}

	// Check that cookies are cleared
	for _, c := range rec.Result().Cookies() {
		if c.Name == "session" && c.MaxAge != -1 {
			t.Error("expected session cookie MaxAge=-1")
		}
	}
}

func TestListChannelsHandler(t *testing.T) {
	h, store := newTestHandlers(t)
	ctx := context.Background()

	// Register an agent and reserve a channel slot
	agent, _, _ := store.Register(ctx, "agent1", "1.2.3.4")
	store.ReserveChannelSlot(ctx, agent.ID, "02"+strings.Repeat("a", 64), "02"+strings.Repeat("a", 64)+"@1.2.3.4:9735", 100000, 10000)

	// Test: list all channels
	req := httptest.NewRequest(http.MethodGet, "/admin/api/channels", nil)
	rec := httptest.NewRecorder()
	h.ListChannels(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)

	channels, ok := resp["channels"].([]any)
	if !ok {
		t.Fatal("expected channels array in response")
	}
	if len(channels) != 1 {
		t.Errorf("expected 1 channel, got %d", len(channels))
	}
	total := int(resp["total"].(float64))
	if total != 1 {
		t.Errorf("expected total=1, got %d", total)
	}

	// Verify agent_name is populated
	ch := channels[0].(map[string]any)
	if ch["agent_name"] != "agent1" {
		t.Errorf("expected agent_name=agent1, got %v", ch["agent_name"])
	}

	// Test: filter by status=pending returns 1
	req = httptest.NewRequest(http.MethodGet, "/admin/api/channels?status=pending", nil)
	rec = httptest.NewRecorder()
	h.ListChannels(rec, req)
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if int(resp["total"].(float64)) != 1 {
		t.Errorf("expected total=1 for pending filter, got %v", resp["total"])
	}

	// Test: filter by status=open returns 0
	req = httptest.NewRequest(http.MethodGet, "/admin/api/channels?status=open", nil)
	rec = httptest.NewRecorder()
	h.ListChannels(rec, req)
	json.Unmarshal(rec.Body.Bytes(), &resp)
	if int(resp["total"].(float64)) != 0 {
		t.Errorf("expected total=0 for open filter, got %v", resp["total"])
	}
}

func TestAgentTransactionsHandler(t *testing.T) {
	h, store := newTestHandlers(t)
	ctx := context.Background()

	// Register an agent (creates a faucet_grant ledger entry)
	agent, _, _ := store.Register(ctx, "agent1", "1.2.3.4")

	// Add an admin grant to create a second ledger entry
	store.GrantCredits(ctx, agent.ID, 500, "test grant")

	// Test: get transactions for agent
	req := httptest.NewRequest(http.MethodGet, "/admin/api/agents/"+agent.ID+"/transactions", nil)
	rec := httptest.NewRecorder()
	h.AgentTransactions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	json.Unmarshal(rec.Body.Bytes(), &resp)

	txs, ok := resp["transactions"].([]any)
	if !ok {
		t.Fatal("expected transactions array in response")
	}
	if len(txs) < 2 {
		t.Errorf("expected at least 2 transactions, got %d", len(txs))
	}

	// Test: limit=1 returns 1 transaction with next_cursor
	req = httptest.NewRequest(http.MethodGet, "/admin/api/agents/"+agent.ID+"/transactions?limit=1", nil)
	rec = httptest.NewRecorder()
	h.AgentTransactions(rec, req)
	json.Unmarshal(rec.Body.Bytes(), &resp)

	txs = resp["transactions"].([]any)
	if len(txs) != 1 {
		t.Errorf("expected 1 transaction with limit=1, got %d", len(txs))
	}
	if resp["next_cursor"] == "" || resp["next_cursor"] == nil {
		t.Error("expected non-empty next_cursor when more transactions exist")
	}

	// Test: invalid path
	req = httptest.NewRequest(http.MethodGet, "/admin/api/agents/"+agent.ID+"/invalid", nil)
	rec = httptest.NewRecorder()
	h.AgentTransactions(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for invalid path, got %d", rec.Code)
	}
}
