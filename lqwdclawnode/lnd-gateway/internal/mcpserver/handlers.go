package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"

	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/accounts"
)

// authRequiredMsg is returned by tools that need an authenticated agent.
// Spells out the exact transport mechanism so a fresh agent doesn't have
// to guess — 2026-04-21 fresh-agent UAT established that this is the
// single biggest unblocker for agent self-onboarding.
const authRequiredMsg = "Authentication required. Send HTTP header `Authorization: Bearer <your_api_key>` on MCP requests (use the lqwd_... key returned by lqwd_register)."

// handleNodeStats returns node statistics. Delegates to proxy handlers
// when billing enabled, otherwise calls FetchNodeStats directly.
func (m *MCPServer) handleNodeStats(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return m.handleDataTool(ctx, "node-stats", m.cfg.Deps.FetchNodeStats, func() http.HandlerFunc {
		return m.cfg.ProxyHandlers.NodeStats
	})
}

// handleNetworkAnalytics returns network analytics data.
func (m *MCPServer) handleNetworkAnalytics(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return m.handleDataTool(ctx, "network-analytics", m.cfg.Deps.FetchNetworkAnalytics, func() http.HandlerFunc {
		return m.cfg.ProxyHandlers.NetworkAnalytics
	})
}

// handlePromo returns promotional content.
func (m *MCPServer) handlePromo(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	return m.handleDataTool(ctx, "promo", m.cfg.Deps.FetchPromo, func() http.HandlerFunc {
		return m.cfg.ProxyHandlers.Promo
	})
}

// handleDataTool is the shared logic for data tools.
// When billing is disabled, it calls the shared fetch function directly.
// When billing is enabled, it calls the proxy handler which does Reserve-Execute-Settle.
func (m *MCPServer) handleDataTool(
	ctx context.Context,
	endpoint string,
	fetchDirect func(http.ResponseWriter, *http.Request),
	getProxyHandler func() http.HandlerFunc,
) (*mcp.CallToolResult, error) {
	rec := httptest.NewRecorder()

	if m.cfg.BillingEnabled {
		// Billing path: delegate to proxy handler (Reserve-Execute-Settle)
		agent := accounts.GetAgent(ctx)
		if agent == nil {
			return mcp.NewToolResultError(authRequiredMsg), nil
		}
		httpReq := httptest.NewRequest("POST", "/v1/internal/proxy/"+endpoint, nil)
		httpReq = httpReq.WithContext(accounts.SetAgent(httpReq.Context(), agent))
		keyHash := accounts.GetKeyHash(ctx)
		if keyHash != "" {
			httpReq = httpReq.WithContext(accounts.SetKeyHash(httpReq.Context(), keyHash))
		}
		httpReq.Header.Set("X-Idempotency-Key", uuid.New().String())
		getProxyHandler()(rec, httpReq)
	} else {
		// Free path: call shared data function directly (no billing)
		httpReq := httptest.NewRequest("GET", "/v1/internal/"+endpoint, nil)
		fetchDirect(rec, httpReq)
	}

	return httpToMCPResult(rec)
}

// handleRegister creates a new agent account. Always free; no API key
// auth required (the tool *issues* the key).
//
// Delegates to the REST Register handler via httptest so the MCP and
// REST paths behave identically — rate limits, faucet cap, channel
// faucet flow (when pubkey + node_uri are provided), and the
// next_steps block all come through for free. Previously MCP
// registration bypassed the REST handler and silently dropped the
// channel-faucet surface — fresh-agent UAT 2026-04-21 caught this.
func (m *MCPServer) handleRegister(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	args := req.GetArguments()
	name, _ := args["name"].(string)
	if name == "" {
		return mcp.NewToolResultError("Parameter 'name' is required (1-100 characters)."), nil
	}
	if len(name) > 100 {
		return mcp.NewToolResultError("Parameter 'name' must be 1-100 characters."), nil
	}

	if m.cfg.AccountHandlers == nil {
		return mcp.NewToolResultError("Registration not configured on this gateway."), nil
	}

	body := map[string]any{"name": name}
	if pk, _ := args["pubkey"].(string); pk != "" {
		body["pubkey"] = pk
	}
	if uri, _ := args["node_uri"].(string); uri != "" {
		body["node_uri"] = uri
	}
	payload, _ := json.Marshal(body)

	rec := httptest.NewRecorder()
	httpReq := httptest.NewRequest("POST", "/v1/internal/accounts/register", bytes.NewReader(payload))
	httpReq.Header.Set("Content-Type", "application/json")
	// MCP registrations come in via the MCP server — no CF-Connecting-IP
	// is authoritative, so rely on the REST handler's RemoteAddr fallback.
	m.cfg.AccountHandlers.Register(rec, httpReq)

	return httpToMCPResult(rec)
}

// handleCheckChannelStatus delegates to the REST /v1/internal/channel/status
// endpoint. Requires authentication (API key → agent in context). Only
// meaningful for agents who registered with pubkey+node_uri; others will
// receive the "no active grant" response from the underlying handler.
func (m *MCPServer) handleCheckChannelStatus(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agent := accounts.GetAgent(ctx)
	if agent == nil {
		return mcp.NewToolResultError(authRequiredMsg), nil
	}
	if m.cfg.ChannelHandlers == nil {
		return mcp.NewToolResultError("Channel status endpoint not configured on this gateway."), nil
	}

	rec := httptest.NewRecorder()
	httpReq := httptest.NewRequest("GET", "/v1/internal/channel/status", nil)
	httpReq = httpReq.WithContext(accounts.SetAgent(httpReq.Context(), agent))
	keyHash := accounts.GetKeyHash(ctx)
	if keyHash != "" {
		httpReq = httpReq.WithContext(accounts.SetKeyHash(httpReq.Context(), keyHash))
	}
	m.cfg.ChannelHandlers.ChannelStatus(rec, httpReq)

	return httpToMCPResult(rec)
}

// handleCheckBalance returns the agent's profile and balance. Always free.
func (m *MCPServer) handleCheckBalance(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agent := accounts.GetAgent(ctx)
	if agent == nil {
		return mcp.NewToolResultError(authRequiredMsg), nil
	}

	profile, err := m.cfg.Store.Profile(ctx, agent.ID)
	if err != nil || profile == nil {
		return mcp.NewToolResultError("Failed to retrieve profile."), nil
	}

	result := map[string]any{
		"agent_id":               profile.ID,
		"name":                   profile.Name,
		"tier":                   profile.Tier,
		"status":                 profile.Status,
		"settled_credits_sats":   profile.SettledSats,
		"available_credits_sats": profile.AvailableSats,
		"reserved_credits_sats":  profile.ReservedSats,
		"daily_spend_remaining":  profile.DailySpendRemain,
		"created_at":             profile.CreatedAt,
	}
	formatted, _ := json.MarshalIndent(result, "", "  ")
	return mcp.NewToolResultText(string(formatted)), nil
}

// httpToMCPResult converts an httptest.ResponseRecorder to an MCP tool result.
// Extracts the "data" field and formats as indented JSON for LLM consumption.
func httpToMCPResult(rec *httptest.ResponseRecorder) (*mcp.CallToolResult, error) {
	if rec.Code >= 400 {
		return mcp.NewToolResultError(rec.Body.String()), nil
	}
	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		return mcp.NewToolResultText(rec.Body.String()), nil
	}
	// Extract "data" field for flattened LLM-friendly output
	data, ok := raw["data"]
	if !ok {
		data = raw
	}
	formatted, _ := json.MarshalIndent(data, "", "  ")
	return mcp.NewToolResultText(string(formatted)), nil
}
