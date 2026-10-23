# Phase 17 — MCP Exposure + Agent Discovery Endpoint

## Goal

Let MCP-aware agents (Claude Desktop, Cursor, Cline) connect to `api.lqwdclaw.bot`, auto-discover tools, register via the faucet, and make their first billed MCP call — all without reading human-authored documentation.

## Scope

1. **Expose the existing MCP server** (`lnd-gateway/internal/mcpserver`) through Caddy on the public edge at `api.lqwdclaw.bot/v1/mcp/*`. Preserve the gateway's existing MCP billing (`MCP_BILLING_ENABLED`) and agent-API-key auth.
2. **Add `GET /v1/discovery`** — public, unauthenticated JSON endpoint returning:
   - `mcp_url` (e.g. `https://api.lqwdclaw.bot/v1/mcp`)
   - `registration_url` (`…/v1/internal/accounts/register`)
   - `tier_matrix` (tier 1/2/3 with credit + channel grants)
   - `docs_url` (placeholder — filled in by Phase 18 frontend)
   - `example_curl` (one copy-paste snippet)
3. **Enrich `POST /v1/internal/accounts/register` response** with a `next_steps` block:
   - `docs_url`
   - `mcp_url`
   - `example_curl` (authenticated, using the api_key just issued)

## Non-goals

- Building a client-side SDK (raw HTTP + MCP cover the ecosystem)
- Frontend quickstart page — that's Phase 18
- OpenAPI / `.well-known` manifest — Phase 19 if demand surfaces
- New MCP tools — exposure only, tool set unchanged

## Goal-backward success criteria

An MCP-aware agent can:
1. `curl https://api.lqwdclaw.bot/v1/discovery` → learn the MCP URL + registration URL
2. `POST /v1/internal/accounts/register` → receive `api_key` + `next_steps.mcp_url`
3. Point its MCP client at `mcp_url` with the api_key → see the tool catalog
4. Invoke a billed MCP tool → credits debited, response streamed back

No human-authored documentation should be required between steps 1–4.

## Dependencies

- Phase 14 (channel faucet) — shipped
- Phase 16.2 (confirmation flow + L402 fixes) — shipped
- Cloudflare edge (`ops/cloudflare-edge`) — shipped; Caddyfile path allowlist needs a new entry

## Out of scope (guardrails)

- Do NOT modify MCP billing logic
- Do NOT change the Caddy architecture (still path-allowlist, still Origin CA)
- Do NOT expose any new Bearer-authed endpoints externally

## Status

- Created: 2026-04-17
- Next: `/gsd-plan-phase 17`
