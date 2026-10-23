package accounts

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRegisterHandler(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	body := bytes.NewBufferString(`{"name":"test-agent"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["ok"] != true {
		t.Errorf("expected ok=true, got %v", resp["ok"])
	}
	data := resp["data"].(map[string]any)
	apiKey := data["api_key"].(string)
	if !strings.HasPrefix(apiKey, "lqwd_") {
		t.Errorf("expected api_key to start with lqwd_, got %s", apiKey)
	}
	agent := data["agent"].(map[string]any)
	if agent["name"] != "test-agent" {
		t.Errorf("expected name=test-agent, got %v", agent["name"])
	}
}

// TestRegister_NextStepsBlock verifies the register response hands agents
// the pointers they need to self-orient: MCP URL, discovery URL, docs URL,
// and an example curl pre-authenticated with their freshly-issued API key.
// The shape must stay stable — external harnesses may parse it.
func TestRegister_NextStepsBlock(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	body := bytes.NewBufferString(`{"name":"next-steps-agent"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)

	ns, ok := data["next_steps"].(map[string]any)
	if !ok {
		t.Fatalf("missing next_steps block: %v", data)
	}

	required := []string{"docs_url", "mcp_url", "discovery_url"}
	for _, k := range required {
		if _, present := ns[k]; !present {
			t.Errorf("next_steps missing key %q", k)
		}
	}

	if ns["mcp_url"] != "https://api.lqwdclaw.bot/v1/mcp" {
		t.Errorf("mcp_url = %v, want https://api.lqwdclaw.bot/v1/mcp", ns["mcp_url"])
	}

	// v1 advertises no paid service, so the old example_curl pointing at
	// /v1/internal/proxy/node-stats was removed. Regression guard: if
	// example_curl reappears here, confirm the paid path was re-enabled
	// intentionally before letting this test assert its shape again.
	if _, present := ns["example_curl"]; present {
		t.Errorf("example_curl must NOT be present in next_steps (no paid service in v1)")
	}
}

func TestRegisterHandlerEmptyName(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	body := bytes.NewBufferString(`{"name":""}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRegisterHandlerNoBody(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRegisterHandlerNameTooLong(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	longName := strings.Repeat("a", 101)
	body := bytes.NewBufferString(`{"name":"` + longName + `"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRegisterHandlerRateLimited(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	// Register 3 agents from same IP
	for i := 0; i < 3; i++ {
		body := bytes.NewBufferString(`{"name":"agent-` + string(rune('A'+i)) + `"}`)
		req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "10.0.0.1:12345"
		rec := httptest.NewRecorder()
		h.Register(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("registration %d: expected 201, got %d: %s", i+1, rec.Code, rec.Body.String())
		}
	}

	// 4th should be rate limited
	body := bytes.NewBufferString(`{"name":"agent-D"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "10.0.0.1:12345"
	rec := httptest.NewRecorder()
	h.Register(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestProfileHandler(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "profile-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/v1/internal/accounts/me", nil)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.Profile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["ok"] != true {
		t.Errorf("expected ok=true, got %v", resp["ok"])
	}
	data := resp["data"].(map[string]any)
	if data["name"] != "profile-agent" {
		t.Errorf("expected name=profile-agent, got %v", data["name"])
	}
	// Balance should be 150 sats from registration grant
	balance := data["balance_sats"].(float64)
	if balance != 150 {
		t.Errorf("expected balance_sats=150, got %v", balance)
	}
}

func TestRotateKeyHandler(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, rawKey, err := store.Register(context.Background(), "rotate-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}
	keyHash := sha256Hex(rawKey)

	req := httptest.NewRequest("POST", "/v1/internal/accounts/rotate-key", nil)
	ctx := SetAgent(req.Context(), agent)
	ctx = SetKeyHash(ctx, keyHash)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.RotateKey(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["ok"] != true {
		t.Errorf("expected ok=true, got %v", resp["ok"])
	}
	data := resp["data"].(map[string]any)
	newKey := data["api_key"].(string)
	if !strings.HasPrefix(newKey, "lqwd_") {
		t.Errorf("expected new key to start with lqwd_, got %s", newKey)
	}
	if newKey == rawKey {
		t.Error("expected new key to differ from old key")
	}
}

func TestRotateKeyHandlerConflict(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "conflict-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	// Use wrong key hash to trigger conflict
	req := httptest.NewRequest("POST", "/v1/internal/accounts/rotate-key", nil)
	ctx := SetAgent(req.Context(), agent)
	ctx = SetKeyHash(ctx, "wrong-hash-value")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.RotateKey(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestProfileBalanceBreakdownHandler(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "breakdown-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/v1/internal/accounts/me", nil)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.Profile(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)

	// Verify balance breakdown fields exist and are correct
	if settled := data["settled_sats"].(float64); settled != 150 {
		t.Errorf("expected settled_sats=150, got %v", settled)
	}
	if reserved := data["reserved_sats"].(float64); reserved != 0 {
		t.Errorf("expected reserved_sats=0, got %v", reserved)
	}
	if available := data["available_sats"].(float64); available != 150 {
		t.Errorf("expected available_sats=150, got %v", available)
	}
	if _, ok := data["daily_spend_remaining"]; !ok {
		t.Error("expected daily_spend_remaining field to be present")
	}
	// Backward compat: balance_sats should still exist
	if balance := data["balance_sats"].(float64); balance != 150 {
		t.Errorf("expected balance_sats=150, got %v", balance)
	}
}

func TestClaimTier2Handler(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "tier2-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	// Make agent old enough for Tier 2
	store.mu.Lock()
	store.agents[agent.ID].CreatedAt = time.Now().Add(-2 * time.Hour)
	store.mu.Unlock()

	body := bytes.NewBufferString(`{"name":"tier2-agent"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/claim-tier2", body)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.ClaimTier2(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	if data["already_claimed"] != false {
		t.Errorf("expected already_claimed=false, got %v", data["already_claimed"])
	}
	if data["grant_sats"].(float64) != 500 {
		t.Errorf("expected grant_sats=500, got %v", data["grant_sats"])
	}
	if data["new_tier"].(float64) != 2 {
		t.Errorf("expected new_tier=2, got %v", data["new_tier"])
	}
}

func TestClaimTier2HandlerTooYoung(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "young-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	body := bytes.NewBufferString(`{"name":"young-agent"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/claim-tier2", body)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.ClaimTier2(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(resp["error"].(string), "account age must be at least 1 hour") {
		t.Errorf("expected age error, got %v", resp["error"])
	}
}

func TestClaimTier2HandlerNameMismatch(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "mismatch-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	store.mu.Lock()
	store.agents[agent.ID].CreatedAt = time.Now().Add(-2 * time.Hour)
	store.mu.Unlock()

	body := bytes.NewBufferString(`{"name":"wrong-name"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/claim-tier2", body)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.ClaimTier2(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(resp["error"].(string), "provided name does not match") {
		t.Errorf("expected name mismatch error, got %v", resp["error"])
	}
}

func TestClaimTier2HandlerAlreadyClaimed(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "repeat-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	store.mu.Lock()
	store.agents[agent.ID].CreatedAt = time.Now().Add(-2 * time.Hour)
	store.mu.Unlock()

	// First claim
	body := bytes.NewBufferString(`{"name":"repeat-agent"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/claim-tier2", body)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	h.ClaimTier2(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("first claim: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Second claim
	body2 := bytes.NewBufferString(`{"name":"repeat-agent"}`)
	req2 := httptest.NewRequest("POST", "/v1/internal/accounts/claim-tier2", body2)
	ctx2 := SetAgent(req2.Context(), agent)
	req2 = req2.WithContext(ctx2)
	rec2 := httptest.NewRecorder()
	h.ClaimTier2(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("second claim: expected 200, got %d: %s", rec2.Code, rec2.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	if data["already_claimed"] != true {
		t.Errorf("expected already_claimed=true, got %v", data["already_claimed"])
	}
}

func TestClaimTier2HandlerNoAuth(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	body := bytes.NewBufferString(`{"name":"no-auth"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/claim-tier2", body)
	rec := httptest.NewRecorder()

	h.ClaimTier2(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestTransactionsHandler(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "txn-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/v1/internal/accounts/transactions", nil)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.Transactions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	txns := data["transactions"].([]any)
	if len(txns) < 1 {
		t.Fatal("expected at least 1 transaction (registration grant)")
	}
	// Verify first entry is the registration grant
	first := txns[0].(map[string]any)
	if first["tx_type"] != "faucet_grant" {
		t.Errorf("expected tx_type=faucet_grant, got %v", first["tx_type"])
	}
	if first["amount_sats"].(float64) != 150 {
		t.Errorf("expected amount_sats=150, got %v", first["amount_sats"])
	}
	// next_cursor should be present (may be empty string)
	if _, ok := data["next_cursor"]; !ok {
		t.Error("expected next_cursor field to be present")
	}
}

func TestTransactionsHandlerPagination(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store}

	agent, _, err := store.Register(context.Background(), "page-agent", "127.0.0.1")
	if err != nil {
		t.Fatal(err)
	}

	// Make agent old enough and claim Tier 2 to get a second transaction
	store.mu.Lock()
	store.agents[agent.ID].CreatedAt = time.Now().Add(-2 * time.Hour)
	store.mu.Unlock()

	result, err := store.ClaimTier2(context.Background(), agent.ID, "page-agent")
	if err != nil {
		t.Fatal(err)
	}
	if result.AlreadyClaimed {
		t.Fatal("expected first claim, got already_claimed")
	}

	// Request limit=1, should get 1 entry + next_cursor
	req := httptest.NewRequest("GET", "/v1/internal/accounts/transactions?limit=1", nil)
	ctx := SetAgent(req.Context(), agent)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.Transactions(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data := resp["data"].(map[string]any)
	txns := data["transactions"].([]any)
	if len(txns) != 1 {
		t.Fatalf("expected 1 transaction, got %d", len(txns))
	}
	nextCursor := data["next_cursor"].(string)
	if nextCursor == "" {
		t.Fatal("expected non-empty next_cursor")
	}

	// Use cursor for second request
	req2 := httptest.NewRequest("GET", "/v1/internal/accounts/transactions?limit=1&cursor="+nextCursor, nil)
	ctx2 := SetAgent(req2.Context(), agent)
	req2 = req2.WithContext(ctx2)
	rec2 := httptest.NewRecorder()

	h.Transactions(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("page 2: expected 200, got %d: %s", rec2.Code, rec2.Body.String())
	}

	var resp2 map[string]any
	if err := json.Unmarshal(rec2.Body.Bytes(), &resp2); err != nil {
		t.Fatal(err)
	}
	data2 := resp2["data"].(map[string]any)
	txns2 := data2["transactions"].([]any)
	if len(txns2) != 1 {
		t.Fatalf("page 2: expected 1 transaction, got %d", len(txns2))
	}
}

func TestRegisterHandlerFaucetCap(t *testing.T) {
	store := NewMockStore()
	store.FaucetDailyCapSats = 100 // Less than 150 grant
	h := &Handlers{Store: store}

	body := bytes.NewBufferString(`{"name":"capped-agent"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(resp["error"].(string), "daily faucet limit reached") {
		t.Errorf("expected faucet cap error, got %v", resp["error"])
	}
}

func TestRetryChannel_HappyPath(t *testing.T) {
	// Agent registers (failed), then retries via the new endpoint.
	// Verify a new grant is created with the same pubkey + node_uri,
	// and the response includes the new channel_id.
	store := NewMockStore()
	store.FaucetChannelCap = 10
	h := &Handlers{Store: store, MockMode: true, ChannelSize: 20000, PushAmount: 1354}

	// Set up: agent + one failed grant.
	agent, _, _ := store.Register(context.Background(), "retry-test", "127.0.0.1")
	pk := "02" + strings.Repeat("de", 32)
	grantID, _ := store.ReserveChannelSlot(context.Background(), agent.ID, pk, pk+"@1.2.3.4:9735", 20000, 1354)
	_ = store.UpdateChannelStatus(context.Background(), grantID, "failed", "", "connect_peer: dial timeout", 0)

	req := httptest.NewRequest("POST", "/v1/internal/channel/retry", nil)
	req = req.WithContext(SetAgent(req.Context(), agent))
	rec := httptest.NewRecorder()

	h.RetryChannel(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["channel_id"] == nil || data["channel_id"] == "" {
		t.Errorf("expected a new channel_id in response")
	}
	if data["channel_id"] == grantID {
		t.Errorf("expected new grant_id distinct from prior; both were %s", grantID)
	}
	if data["prior_fail_category"] != "connect_peer_failed" {
		t.Errorf("expected prior_fail_category=connect_peer_failed, got %v", data["prior_fail_category"])
	}
}

func TestRetryChannel_RejectsIfNoPriorGrant(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store, MockMode: true, ChannelSize: 20000, PushAmount: 1354}
	agent, _, _ := store.Register(context.Background(), "no-grant", "127.0.0.1")

	req := httptest.NewRequest("POST", "/v1/internal/channel/retry", nil)
	req = req.WithContext(SetAgent(req.Context(), agent))
	rec := httptest.NewRecorder()

	h.RetryChannel(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when no prior grant, got %d", rec.Code)
	}
}

func TestRetryChannel_RejectsIfGrantNotFailed(t *testing.T) {
	store := NewMockStore()
	store.FaucetChannelCap = 10
	h := &Handlers{Store: store, MockMode: true, ChannelSize: 20000, PushAmount: 1354}
	agent, _, _ := store.Register(context.Background(), "pending-grant", "127.0.0.1")
	pk := "02" + strings.Repeat("ef", 32)
	_, _ = store.ReserveChannelSlot(context.Background(), agent.ID, pk, pk+"@1.2.3.4:9735", 20000, 1354)
	// Leave in 'pending' state.

	req := httptest.NewRequest("POST", "/v1/internal/channel/retry", nil)
	req = req.WithContext(SetAgent(req.Context(), agent))
	rec := httptest.NewRecorder()

	h.RetryChannel(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 when grant still pending, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestReachabilityCheck_MockMode(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store, MockMode: true}

	pk := "02" + strings.Repeat("ab", 32)
	body := bytes.NewBufferString(`{"pubkey":"` + pk + `","node_uri":"` + pk + `@1.2.3.4:9735"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/reachability-check", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.ReachabilityCheck(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["reachable"] != true {
		t.Errorf("mock mode must report reachable=true; got %v", data["reachable"])
	}
}

func TestReachabilityCheck_RejectsMalformed(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store, MockMode: true}

	cases := []struct {
		name string
		body string
	}{
		{"bad pubkey", `{"pubkey":"not-hex","node_uri":"x@1.2.3.4:9735"}`},
		{"uri pubkey mismatch", `{"pubkey":"02` + strings.Repeat("ab", 32) + `","node_uri":"03` + strings.Repeat("cd", 32) + `@1.2.3.4:9735"}`},
		{"uri missing at", `{"pubkey":"02` + strings.Repeat("ab", 32) + `","node_uri":"1.2.3.4:9735"}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/v1/internal/accounts/reachability-check", bytes.NewBufferString(c.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			h.ReachabilityCheck(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("expected 400 for %s, got %d", c.name, rec.Code)
			}
		})
	}
}

func TestAdminResetRateLimit(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store, AdminToken: "reset-token"}

	// Register an agent so there's a row to shift.
	agent, _, err := store.Register(context.Background(), "victim", "192.0.2.5")
	if err != nil {
		t.Fatalf("Register setup: %v", err)
	}
	beforeCreatedAt := agent.CreatedAt

	body := bytes.NewBufferString(`{"ip_address":"192.0.2.5"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/accounts/reset-rate-limit", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer reset-token")
	rec := httptest.NewRecorder()

	h.AdminResetRateLimit(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	if data["ip_address"] != "192.0.2.5" {
		t.Errorf("ip_address echo wrong: %v", data["ip_address"])
	}
	if rows, _ := data["rows_affected"].(float64); rows != 1 {
		t.Errorf("expected rows_affected=1, got %v", data["rows_affected"])
	}

	// Agent's created_at must actually have been backdated, not just
	// reported as affected. Pull the agent fresh from the store.
	got := store.agents[agent.ID]
	if !got.CreatedAt.Before(beforeCreatedAt) {
		t.Errorf("expected agent created_at to be backdated; before=%v after=%v", beforeCreatedAt, got.CreatedAt)
	}
}

func TestAdminResetRateLimitRejectsWithoutToken(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store, AdminToken: "reset-token"}

	body := bytes.NewBufferString(`{"ip_address":"192.0.2.5"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/accounts/reset-rate-limit", body)
	req.Header.Set("Content-Type", "application/json")
	// no auth header
	rec := httptest.NewRecorder()

	h.AdminResetRateLimit(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestAdminResetRateLimitValidatesIP(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store, AdminToken: "reset-token"}

	body := bytes.NewBufferString(`{"ip_address":"not-an-ip"}`)
	req := httptest.NewRequest("POST", "/v1/internal/admin/accounts/reset-rate-limit", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer reset-token")
	rec := httptest.NewRecorder()

	h.AdminResetRateLimit(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad IP, got %d: %s", rec.Code, rec.Body.String())
	}
}

// findJSONKey recursively searches a nested map/slice structure produced by
// json.Unmarshal for a given key name at any depth. Used by REN-02's
// negative-assertion test to ensure no response branch leaks the key.
func findJSONKey(v any, key string) bool {
	switch x := v.(type) {
	case map[string]any:
		if _, ok := x[key]; ok {
			return true
		}
		for _, vv := range x {
			if findJSONKey(vv, key) {
				return true
			}
		}
	case []any:
		for _, vv := range x {
			if findJSONKey(vv, key) {
				return true
			}
		}
	}
	return false
}

// TestRegisterResponseNoChannelPoint is load-bearing for Phase 22 REN-02.
// The /v1/internal/accounts/register response must NOT include a
// `channel_point` key at any nesting depth. The on-chain channel open is
// async (Phase 14 D-13), so channel_point is not populated at register
// time. Agents MUST poll /v1/internal/channel/status (Plan 22-03) to
// observe the authoritative channel_point once the open confirms.
//
// If a future edit re-introduces channel_point into this response, this
// test fails and the PR blocks merge. The load-bearing-ness is documented
// in the Register handler's doc-comment block in handlers.go.
func TestRegisterResponseNoChannelPoint(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{
		Store:       store,
		MockMode:    true,
		ChannelSize: 100_000,
		PushAmount:  25_000,
	}

	pk := "02" + strings.Repeat("ab", 32)
	body := bytes.NewBufferString(`{"name":"ren02-agent","pubkey":"` + pk + `","node_uri":"` + pk + `@1.2.3.4:9735"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/register", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Register(rec, req)

	if rec.Code >= 400 {
		t.Fatalf("register failed: status=%d body=%s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if findJSONKey(resp, "channel_point") {
		t.Errorf("register response leaked channel_point key (REN-02 violation). Body: %s", rec.Body.String())
	}
}

// TestReachabilityCheckHasEnrichmentFields asserts Phase 22 REN-01 — both
// `dialed_port` and `observed_source_ip` appear in the reachability-check
// response. Mock mode exercises the mock branch directly. The other three
// branches (reachable, already_connected, unreachable) are guarded by
// grep in the plan's <done> criteria; all four branches share the same
// portStr / observedIP derivation block per handlers.go.
func TestReachabilityCheckHasEnrichmentFields(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store, MockMode: true}

	pk := "02" + strings.Repeat("ab", 32)
	body := bytes.NewBufferString(`{"pubkey":"` + pk + `","node_uri":"` + pk + `@1.2.3.4:9735"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/reachability-check", body)
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "203.0.113.42:54321"
	rec := httptest.NewRecorder()

	h.ReachabilityCheck(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	data, ok := resp["data"].(map[string]any)
	if !ok {
		t.Fatalf("response missing data map: %s", rec.Body.String())
	}

	if p, _ := data["dialed_port"].(string); p != "9735" {
		t.Errorf("dialed_port=%q want %q", p, "9735")
	}
	if ip, _ := data["observed_source_ip"].(string); ip == "" {
		t.Error("observed_source_ip empty; want non-empty")
	} else if ip != "203.0.113.42" {
		t.Errorf("observed_source_ip=%q want %q (from r.RemoteAddr fallback)", ip, "203.0.113.42")
	}
}

// TestReachabilityCheckPrefersCFConnectingIP asserts that the REN-01
// observed_source_ip derivation prefers the CF-Connecting-IP header over
// r.RemoteAddr. Mirrors the same CF-Connecting-IP precedence used by the
// Register handler's ipAddr block (handlers.go:75-82).
func TestReachabilityCheckPrefersCFConnectingIP(t *testing.T) {
	store := NewMockStore()
	h := &Handlers{Store: store, MockMode: true}

	pk := "02" + strings.Repeat("ab", 32)
	body := bytes.NewBufferString(`{"pubkey":"` + pk + `","node_uri":"` + pk + `@5.6.7.8:19735"}`)
	req := httptest.NewRequest("POST", "/v1/internal/accounts/reachability-check", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Connecting-IP", "198.51.100.77")
	req.RemoteAddr = "10.0.0.1:9999" // should be ignored
	rec := httptest.NewRecorder()

	h.ReachabilityCheck(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)

	if ip, _ := data["observed_source_ip"].(string); ip != "198.51.100.77" {
		t.Errorf("observed_source_ip=%q want CF-Connecting-IP value %q", ip, "198.51.100.77")
	}
	if p, _ := data["dialed_port"].(string); p != "19735" {
		t.Errorf("dialed_port=%q want %q", p, "19735")
	}
}
