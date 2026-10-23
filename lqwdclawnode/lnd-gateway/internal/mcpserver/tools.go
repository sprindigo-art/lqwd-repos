package mcpserver

import "github.com/mark3labs/mcp-go/mcp"

// Shared auth note appended to every tool description that requires authentication.
// Spelling out the exact HTTP-layer mechanism is necessary because MCP tool input
// schemas don't describe transport-level auth — fresh agents otherwise guess
// through X-Api-Key / X-LQWD-Api-Key / arguments.api_key and never find the
// correct Bearer header. Captured 2026-04-21 during a fresh-agent UAT.
const authNote = "Authenticate by sending the HTTP header `Authorization: Bearer <your_api_key>` on MCP requests (where <your_api_key> is the `lqwd_...` key returned by lqwd_register)."

// registerTools adds LQWD tools to the MCP server.
//
// v1 public surface (2026-04-21): LQWDClaw offers the channel faucet only.
// There is no paid service at this time — adding paid liquidity for use is
// a later version. Only the three free account tools are registered.
//
// The paid data tools (lqwd_get_node_stats, lqwd_get_network_analytics,
// lqwd_get_promo) are intentionally kept in the source tree — their
// handlers remain wired via credit-proxy REST so the plumbing can be
// re-enabled quickly when the paid tier is introduced. To re-register,
// uncomment the three AddTool calls in registerPaidDataTools below.
func (m *MCPServer) registerTools() {
	// Account tools — always free, always registered.
	m.mcp.AddTool(
		mcp.NewTool("lqwd_register",
			mcp.WithDescription("Register a new AI agent account with LQWD. Returns an API key and, when you supply a Lightning node's pubkey + node_uri, a one-time inbound channel on mainnet as part of the tier-1 faucet grant. Always free; no authentication required — this tool is how you GET your API key. To receive an inbound channel from LQWD, pass `pubkey` AND `node_uri` together."),
			mcp.WithString("name", mcp.Required(), mcp.Description("Agent name (1-100 characters). Choose a descriptive name for your agent.")),
			mcp.WithString("pubkey", mcp.Description("Optional. Your LND node's public key (66-char hex string). When provided alongside node_uri, LQWD opens a one-time inbound channel to your node as part of the tier-1 faucet grant. Omit if you don't run a Lightning node.")),
			mcp.WithString("node_uri", mcp.Description("Optional. Your node's public URI in the form `pubkey@host:port` (port 9735 must be publicly reachable). Required alongside pubkey. The response will include `channel_granted` and `next_steps.channel_status_url` so you can poll the async open.")),
		),
		m.handleRegister,
	)
	m.mcp.AddTool(
		mcp.NewTool("lqwd_check_balance",
			mcp.WithDescription("Check your LQWD agent account profile. Returns your account tier, status, and registration date. Always free. "+authNote),
		),
		m.handleCheckBalance,
	)
	m.mcp.AddTool(
		mcp.NewTool("lqwd_check_channel_status",
			mcp.WithDescription("Check the status of an inbound channel LQWD granted to your node during registration. Returns the current state (pending, active, failed), funding txid (when confirmed), and balances. Only meaningful if you registered with pubkey+node_uri; agents without a channel grant will get a 'no active grant' response. Always free. "+authNote),
		),
		m.handleCheckChannelStatus,
	)
}

// registerPaidDataTools is not called in v1. The three paid data tools
// below remain defined (with their handlers still wired via
// handleNodeStats / handleNetworkAnalytics / handlePromo) so the catalog
// can be re-enabled without code archaeology when a paid tier is
// introduced. Simply call this from registerTools to expose them again.
func (m *MCPServer) registerPaidDataTools() {
	m.mcp.AddTool(
		mcp.NewTool("lqwd_get_node_stats",
			mcp.WithDescription("Get Lightning node statistics for the LQWD node. Returns the node's public key, alias, number of active channels, peers, sync status, and block height. Use this to check if the LQWD node is online and healthy. Costs credits when billing is enabled. "+authNote),
		),
		m.handleNodeStats,
	)
	m.mcp.AddTool(
		mcp.NewTool("lqwd_get_network_analytics",
			mcp.WithDescription("Get Lightning Network analytics from the LQWD node's perspective. Returns fee revenue data (daily, weekly, monthly), channel count, and peer count. Use this to understand LQWD's routing performance and network position. Costs credits when billing is enabled. "+authNote),
		),
		m.handleNetworkAnalytics,
	)
	m.mcp.AddTool(
		mcp.NewTool("lqwd_get_promo",
			mcp.WithDescription("Get current LQWD promotional content and announcements. Returns the latest news and updates from LQWD Technologies. Costs credits when billing is enabled. "+authNote),
		),
		m.handlePromo,
	)
}
