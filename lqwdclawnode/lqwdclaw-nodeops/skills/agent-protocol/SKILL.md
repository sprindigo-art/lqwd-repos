---
name: agent-protocol
description: Define the communication protocol between LQWDClaw-NodeOps and the LQWDClaw orchestrator
---

# Agent Protocol

Defines how LQWDClaw-NodeOps communicates with the LQWDClaw orchestrator agent.

## Architecture

LQWDClaw-NodeOps operates as a **sub-agent** of the LQWDClaw orchestrator:

```
LQWDClaw (orchestrator)
  └── LQWDClaw-NodeOps (sub-agent, this system)
        └── lnd-gateway (Go binary → LND)
```

The orchestrator handles: social media posting, company communications, multi-agent coordination.
NodeOps handles: LND node management, routing, channel operations, Lightning analytics.

## Communication Protocol

### Inbound Queries (Orchestrator → NodeOps)

The orchestrator can ask NodeOps questions via Telegram or OpenClaw's multi-agent routing. NodeOps responds using its skills.

**Supported query types:**

| Query Pattern | Skill Used | Response |
|--------------|-----------|----------|
| "How is the node?" / "Node status" | `node-summary-api` | Aggregated health summary |
| "What are our channel balances?" | `lnd-wallet` | On-chain + channel balances |
| "How is routing performance?" | `routing-analytics` | Forwarding stats + fee revenue |
| "Any channel issues?" | `zombie-detector` + `channel-watchdog` | Problem channels report |
| "What fees are we charging?" | `fee-optimizer` | Current fee policies + suggestions |
| "Review recent actions" | `action-reviewer` | Audit log analysis |
| "Tell me about the faucet" | `channel-faucet` | Faucet status, stats, promotional copy |
| "How do agents register?" | `channel-faucet` | Registration flow, credit proxy, channel faucet |
| "What services do we offer?" | `channel-faucet` | Onboarding paths, MCP, proxy endpoints |
| "Give me content for a post about agent onboarding" | `channel-faucet` | Promotional talking points for social |

### Outbound Alerts (NodeOps → Orchestrator)

NodeOps proactively alerts the orchestrator (via Telegram) when:
- Kill switch is engaged
- Channel force-close detected
- Balance drops below threshold
- Daily spend exceeds 80% of ceiling
- Node goes out of sync
- Peer disconnection cascade (3+ peers lost)

### Response Format

When responding to the orchestrator, use this structured format:

```
[NODEOPS] Status: {healthy|degraded|critical}

{concise summary in 2-3 sentences}

Key metrics:
- Channels: X active, Y capacity
- Balance: X sats on-chain, Y sats in channels
- Routing: X forwards (7d), Y sats fees earned
```

Keep responses concise — the orchestrator may include them in social media posts or reports.

### Data Boundaries

NodeOps provides to the orchestrator:
- Node health status and metrics
- Channel and routing performance data
- Balance summaries (no exact addresses)
- Anonymized peer statistics
- Faucet status (total agents, channels granted, daily spend)
- Promotional content for the agent onboarding program
- MCP server availability and tool list

NodeOps does NOT share:
- Internal gateway tokens or configuration
- Macaroon details or LND connection info
- Full audit logs (only summaries)
- Operator-only alerts (these go direct to Telegram)
- Individual agent API keys or private balances
- Admin dashboard credentials or session details

## OpenClaw Multi-Agent Configuration

The orchestrator routes node-related queries to the NodeOps workspace via OpenClaw's agent routing. Configuration in the orchestrator's workspace:

```
When the user asks about the Lightning node, routing, channels, or
node performance, delegate to the LQWDClaw-NodeOps agent workspace.
```

NodeOps responds through its normal skill chain, and the orchestrator forwards the response to the user or incorporates it into its own output.

## Important Rules

- NodeOps never takes actions based on orchestrator requests alone — only the operator can authorize writes
- Orchestrator queries are treated as read-only information requests
- If the orchestrator asks NodeOps to perform a write operation, NodeOps must still follow the confirmation flow
- NodeOps should not share internal infrastructure details (IPs, ports, file paths) with the orchestrator
- Keep responses factual and data-driven — no speculation about markets or LQWD stock price
