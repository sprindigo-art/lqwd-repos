// Package mcpserver implements an MCP (Model Context Protocol) server that exposes
// LQWD Lightning node data and account management tools for AI agent discovery.
package mcpserver

import (
	"context"
	"net/http"
	"strings"

	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/accounts"
	"github.com/lqwdtech/lqwdclawnode/lnd-gateway/internal/handlers"
	"github.com/mark3labs/mcp-go/server"
)

// Config holds dependencies for the MCP server.
type Config struct {
	Deps            *handlers.Dependencies
	Store           accounts.AccountStore
	ProxyHandlers   *accounts.ProxyHandlers
	AccountHandlers *accounts.Handlers        // MCP -> REST register delegation (channel faucet path)
	ChannelHandlers *accounts.ChannelHandlers // MCP -> REST channel/status delegation
	BillingEnabled  bool
}

// MCPServer wraps the MCP protocol server with LQWD tool handlers.
type MCPServer struct {
	mcp *server.MCPServer
	cfg Config
}

// New creates an MCP server with all LQWD tools registered.
func New(cfg Config) *MCPServer {
	s := server.NewMCPServer(
		"lqwd-gateway",
		"1.0.0",
		server.WithToolCapabilities(true),
	)
	m := &MCPServer{mcp: s, cfg: cfg}
	m.registerTools()
	return m
}

// Handler returns an http.Handler for mounting on the gateway mux.
// The returned handler implements the MCP Streamable HTTP transport.
// When billing is enabled, extracts API key from Authorization header
// and injects the authenticated agent into the MCP request context.
func (m *MCPServer) Handler() http.Handler {
	opts := []server.StreamableHTTPOption{}
	if m.cfg.BillingEnabled && m.cfg.Store != nil {
		opts = append(opts, server.WithHTTPContextFunc(func(ctx context.Context, r *http.Request) context.Context {
			auth := r.Header.Get("Authorization")
			if auth == "" || !strings.HasPrefix(auth, "Bearer lqwd_") {
				return ctx
			}
			rawKey := strings.TrimPrefix(auth, "Bearer ")
			keyHash := accounts.SHA256Hex(rawKey)
			agent, err := m.cfg.Store.Authenticate(ctx, keyHash)
			if err != nil || agent == nil || agent.Status != "active" {
				return ctx
			}
			ctx = accounts.SetAgent(ctx, agent)
			ctx = accounts.SetKeyHash(ctx, keyHash)
			return ctx
		}))
	}
	return server.NewStreamableHTTPServer(m.mcp, opts...)
}

// Server returns the underlying MCP server for testing.
func (m *MCPServer) Server() *server.MCPServer {
	return m.mcp
}
