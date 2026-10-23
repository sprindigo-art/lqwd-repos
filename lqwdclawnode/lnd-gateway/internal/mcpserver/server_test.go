package mcpserver

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/accounts"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/handlers"
)

// newTestServer creates an MCPServer with mock dependencies for testing.
func newTestServer(billingEnabled bool) *MCPServer {
	store := accounts.NewMockStore()
	deps := &handlers.Dependencies{MockMode: true}
	proxy := &accounts.ProxyHandlers{
		Store:   store,
		Deps:    deps,
		Price:   10,
		Timeout: 30 * time.Second,
	}
	acctHandlers := &accounts.Handlers{
		Store:       store,
		MockMode:    true,
		ChannelSize: 100_000,
		PushAmount:  25_000,
	}
	channelHandlers := &accounts.ChannelHandlers{
		Store: store,
	}
	return New(Config{
		Deps:            deps,
		Store:           store,
		ProxyHandlers:   proxy,
		AccountHandlers: acctHandlers,
		ChannelHandlers: channelHandlers,
		BillingEnabled:  billingEnabled,
	})
}

// registerTestAgent creates a test agent in the store and returns the agent and its context.
func registerTestAgent(t *testing.T, s *MCPServer) (*accounts.Agent, context.Context) {
	t.Helper()
	agent, _, err := s.cfg.Store.Register(context.Background(), "test-agent", "127.0.0.1")
	if err != nil {
		t.Fatalf("failed to register test agent: %v", err)
	}
	ctx := accounts.SetAgent(context.Background(), agent)
	return agent, ctx
}

func TestToolCatalog(t *testing.T) {
	s := newTestServer(false)
	tools := s.Server().ListTools()

	// v1 advertises the three free account tools only. Paid data tools
	// (lqwd_get_node_stats / lqwd_get_network_analytics / lqwd_get_promo)
	// are kept in the source tree but are NOT registered in v1 — LQWDClaw
	// offers the channel faucet only at this time, there is no paid
	// service to expose. See tools.go registerPaidDataTools comment.
	if len(tools) != 3 {
		t.Fatalf("expected 3 tools (v1 channel-faucet-only surface), got %d", len(tools))
	}

	expected := map[string]bool{
		"lqwd_register":             false,
		"lqwd_check_balance":        false,
		"lqwd_check_channel_status": false,
	}

	for name := range tools {
		if _, ok := expected[name]; !ok {
			t.Errorf("unexpected tool in v1 catalog: %s", name)
		}
		expected[name] = true
	}

	for name, found := range expected {
		if !found {
			t.Errorf("missing expected tool: %s", name)
		}
	}

	// Regression guard: paid data tools MUST NOT be registered in v1.
	for _, name := range []string{"lqwd_get_node_stats", "lqwd_get_network_analytics", "lqwd_get_promo"} {
		if _, present := tools[name]; present {
			t.Errorf("paid tool %q must not be registered in v1 (no paid service at this time)", name)
		}
	}
}

func TestToolDescriptions(t *testing.T) {
	s := newTestServer(false)
	tools := s.Server().ListTools()

	for name, tool := range tools {
		if tool.Tool.Description == "" {
			t.Errorf("tool %s has empty description", name)
		}
	}
}

func TestHandleNodeStats(t *testing.T) {
	s := newTestServer(false)
	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_get_node_stats"

	result, err := s.handleNodeStats(context.Background(), req)
	if err != nil {
		t.Fatalf("handleNodeStats error: %v", err)
	}
	if result.IsError {
		t.Fatal("expected success result, got error")
	}

	// Check result text contains node stats fields
	text := extractText(t, result)
	if !strings.Contains(text, "identity_pubkey") {
		t.Error("result should contain identity_pubkey")
	}
	if !strings.Contains(text, "alias") {
		t.Error("result should contain alias")
	}
}

func TestHandleNodeStatsBilling(t *testing.T) {
	s := newTestServer(true)
	_, ctx := registerTestAgent(t, s)

	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_get_node_stats"

	result, err := s.handleNodeStats(ctx, req)
	if err != nil {
		t.Fatalf("handleNodeStats error: %v", err)
	}
	if result.IsError {
		t.Fatal("expected success result with billing, got error")
	}

	text := extractText(t, result)
	if !strings.Contains(text, "identity_pubkey") {
		t.Error("result should contain identity_pubkey")
	}
}

func TestHandleNodeStatsBillingNoAuth(t *testing.T) {
	s := newTestServer(true)
	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_get_node_stats"

	result, err := s.handleNodeStats(context.Background(), req)
	if err != nil {
		t.Fatalf("handleNodeStats error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error result without auth in billing mode")
	}
}

func TestHandleRegister(t *testing.T) {
	s := newTestServer(false)
	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_register"
	req.Params.Arguments = map[string]any{"name": "test-agent"}

	result, err := s.handleRegister(context.Background(), req)
	if err != nil {
		t.Fatalf("handleRegister error: %v", err)
	}
	if result.IsError {
		t.Fatalf("expected success result, got error: %s", extractText(t, result))
	}

	text := extractText(t, result)
	if !strings.Contains(text, "api_key") {
		t.Error("result should contain api_key")
	}
	// REST delegation now returns the same shape as /v1/internal/accounts/register:
	// a nested "agent" object (with id/name/tier/status/created_at) and a top-level
	// "next_steps" block. Assert both rather than the pre-delegation "agent_id" key.
	if !strings.Contains(text, `"agent"`) {
		t.Error("result should contain nested agent object")
	}
	if !strings.Contains(text, "next_steps") {
		t.Error("result should contain next_steps block (MCP register now mirrors REST shape)")
	}
}

func TestHandleRegisterNoKey(t *testing.T) {
	// Register works without agent in context (CF Access only, no API key needed)
	s := newTestServer(false)
	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_register"
	req.Params.Arguments = map[string]any{"name": "no-key-agent"}

	result, err := s.handleRegister(context.Background(), req)
	if err != nil {
		t.Fatalf("handleRegister error: %v", err)
	}
	if result.IsError {
		t.Fatalf("register should work without agent context, got error")
	}

	text := extractText(t, result)
	if !strings.Contains(text, "api_key") {
		t.Error("result should contain api_key")
	}
}

// TestHandleRegisterWithChannel verifies the MCP register tool accepts
// the optional pubkey + node_uri args and triggers the channel-faucet
// path via REST delegation. The response must include the
// channel_status_url in next_steps so agents know where to poll.
func TestHandleRegisterWithChannel(t *testing.T) {
	s := newTestServer(false)

	validPubkey := "02aabbccddee00112233445566778899aabbccddee00112233445566778899aabb"
	validURI := validPubkey + "@1.2.3.4:9735"

	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_register"
	req.Params.Arguments = map[string]any{
		"name":     "channel-agent",
		"pubkey":   validPubkey,
		"node_uri": validURI,
	}

	result, err := s.handleRegister(context.Background(), req)
	if err != nil {
		t.Fatalf("handleRegister error: %v", err)
	}
	if result.IsError {
		t.Fatalf("expected success, got error: %s", extractText(t, result))
	}

	text := extractText(t, result)
	if !strings.Contains(text, `"channel_granted": true`) && !strings.Contains(text, `"channel_granted":true`) {
		t.Errorf("expected channel_granted=true in response; got: %s", text)
	}
	if !strings.Contains(text, "channel_status_url") {
		t.Errorf("expected channel_status_url in next_steps; got: %s", text)
	}
}

func TestHandleRegisterMissingName(t *testing.T) {
	s := newTestServer(false)
	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_register"
	req.Params.Arguments = map[string]any{}

	result, err := s.handleRegister(context.Background(), req)
	if err != nil {
		t.Fatalf("handleRegister error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error for missing name")
	}
}

func TestHandleCheckBalance(t *testing.T) {
	s := newTestServer(false)
	_, ctx := registerTestAgent(t, s)

	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_check_balance"

	result, err := s.handleCheckBalance(ctx, req)
	if err != nil {
		t.Fatalf("handleCheckBalance error: %v", err)
	}
	if result.IsError {
		t.Fatal("expected success result, got error")
	}

	text := extractText(t, result)
	if !strings.Contains(text, "available_credits_sats") {
		t.Error("result should contain available_credits_sats")
	}
}

func TestHandleCheckBalanceNoAuth(t *testing.T) {
	s := newTestServer(false)
	req := mcp.CallToolRequest{}
	req.Params.Name = "lqwd_check_balance"

	result, err := s.handleCheckBalance(context.Background(), req)
	if err != nil {
		t.Fatalf("handleCheckBalance error: %v", err)
	}
	if !result.IsError {
		t.Fatal("expected error without auth")
	}
}

func TestHttpToMCPResult(t *testing.T) {
	t.Run("200 extracts data field", func(t *testing.T) {
		rec := httptest.NewRecorder()
		rec.WriteHeader(200)
		rec.Write([]byte(`{"ok":true,"data":{"foo":"bar"}}`))

		result, err := httpToMCPResult(rec)
		if err != nil {
			t.Fatalf("httpToMCPResult error: %v", err)
		}
		if result.IsError {
			t.Fatal("expected success result")
		}
		text := extractText(t, result)
		if !strings.Contains(text, "foo") {
			t.Error("result should contain extracted data field")
		}
		// Verify it's flattened (no "ok" wrapper)
		if strings.Contains(text, `"ok"`) {
			t.Error("result should not contain envelope ok field")
		}
	})

	t.Run("400 returns error", func(t *testing.T) {
		rec := httptest.NewRecorder()
		rec.WriteHeader(400)
		rec.Write([]byte(`{"error":"bad request"}`))

		result, err := httpToMCPResult(rec)
		if err != nil {
			t.Fatalf("httpToMCPResult error: %v", err)
		}
		if !result.IsError {
			t.Fatal("expected error result for 400 status")
		}
	})
}

// extractText returns the text content from an MCP tool result.
func extractText(t *testing.T, result *mcp.CallToolResult) string {
	t.Helper()
	if len(result.Content) == 0 {
		t.Fatal("result has no content")
	}
	// Marshal and re-parse to extract text from the Content interface
	raw, err := json.Marshal(result.Content[0])
	if err != nil {
		t.Fatalf("failed to marshal content: %v", err)
	}
	var textContent struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &textContent); err != nil {
		t.Fatalf("failed to unmarshal text content: %v", err)
	}
	return textContent.Text
}
