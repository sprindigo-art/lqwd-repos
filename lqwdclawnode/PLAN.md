# LQWDClaw-NodeOps Execution Plan

**Last updated**: 2026-04-03
**Status**: v1.0 shipped (2026-03-27), v2.0 complete (2026-04-03)

---

## Overview

LQWDClaw-NodeOps is an AI-powered LND node management system built on:
- **OpenClaw** (open source agent framework) for the AI runtime, skills, and messaging channels
- **A custom Go gateway** ("lnd-gateway") for secure LND access via native gRPC
- **L402 pay-per-call API** for monetized Lightning data endpoints

The system replaces a previous TypeScript-based agent with a cleaner architecture where OpenClaw handles conversation/skills and the Go gateway handles all LND communication with hardened security.

---

## Phase 0: VM Provisioning

**Status**: Complete

### Infrastructure
- OneProvider dedicated server (Vancouver, Canada): Ryzen 5 3600X (6 cores / 12 threads), 32 GB DDR4 RAM, 512 GB NVMe SSD
- Bitcoin Core v30.2 (pruned 10GB) + LND v0.20.1-beta + Tor + Go 1.24+ + Node.js 22 + OpenClaw
- Hybrid mode: LND reachable via both clearnet (IPv4) and Tor (v3 .onion)

### Security Setup
- 4 system users: `bitcoin`, `lnd`, `gateway`, `openclaw`
- AppArmor profiles restricting `openclaw` to: `curl`, `jq`, `date`, `uuidgen`
- Filesystem isolation: `openclaw` cannot read LND data, macaroons, or TLS certs
- Scoped macaroons: readonly, invoice, channel-admin, pay (never admin.macaroon)
- Watchtower client connected to 2+ external watchtowers
- SCB backup: `inotifywait` on `channel.backup` -> encrypted upload to S3/remote
- CircuitBreaker: HTLC firewall with per-peer limits

---

## Phase 1A: Go Gateway Foundation

**Status**: Complete (14 source files, 23 tests passing)

Built: Entry point, config (18+ env vars), two-token auth, rate limiter, structured logging, panic recovery, audit logger (SQLite WAL + JSON fallback), budget enforcer, confirmation manager, idempotency store, kill switch, mock mode, 11 handler endpoints.

---

## Phase 1B: OpenClaw Workspace + Read-Only Skills

**Status**: Complete (11 files, 391 lines)

Built: Agent workspace (openclaw.json, AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md) + 5 read-only skills (lnd-info, lnd-wallet, lnd-channels, lnd-peers, node-startup-report).

---

## Phase 2: Write Operations + Monitoring

**Status**: Complete (11 new endpoints, 20 handler tests, 5 skills)

Built: All write endpoints (channel open/close, send payment, send on-chain), confirmation flow, on-chain fee guard, state hash validation, mempool fee estimation. Skills: lnd-payments, lnd-onchain, node-monitor, channel-watchdog, balance-alerts.

---

## Phase 3: Intelligence & Analytics

**Status**: Complete (6 new endpoints, 14 handler tests, 5 skills)

Built: Fee report, fee updates, graph queries, channel scores, circular rebalancing with budget enforcement. Skills: routing-analytics, fee-optimizer, channel-advisor, lnd-rebalance, zombie-detector.

---

## Phase 4: Self-Review & QA

**Status**: Complete (2 new endpoints, 4 handler tests, 6 skills)

Built: Audit query and summary endpoints. Skills: action-reviewer, qa-auditor, decision-journal, skill-reviewer, gateway-contract-validator, workspace-linter.

---

## Phase 5: Multi-Agent / LQWDClaw Integration

**Status**: Complete (1 new endpoint, 1 handler test, 2 skills)

Built: `/v1/node/summary` aggregated status endpoint. Skills: node-summary-api, agent-protocol. NodeOps operates as read-only sub-agent to LQWDClaw orchestrator.

---

## Phase 6: Hardening & Production Readiness

**Status**: Complete (3 skills, 4 scripts, 2 systemd services, upgrade runbook)

Built: deploy-gateway.sh, systemd units, SCB backup automation, env templates, upgrade runbook. Skills: disaster-recovery, alert-escalation, smoke-test.

---

## Critical Fixes + L402 Deploy (Phases 7-9)

A comprehensive adversarial security review identified critical design flaws in the gateway's SQLite handling, HTTP client, and observability. These phases address all findings and deploy the hardened gateway to production.

**Core Value**: The L402 server must be production-safe -- no double token consumption, no lost payments, no hanging goroutines, no cascading SQLite failures. Every sat must be accounted for.

### Phase 7: SQLite Connection Pool (Fix 1)

**Status**: Complete

All 3 SQLite stores (audit, idempotency, L402) use `SetMaxOpenConns(1)` and `_txlock=immediate` to prevent concurrent write contention and silent busy_timeout bypass.

### Phase 8: Atomic Store Operations (Fix 2)

**Status**: Complete

L402 token `Consume()` uses atomic `UPDATE...WHERE status='paid'` with `RowsAffected` check. Idempotency store uses atomic `INSERT OR IGNORE` + `RowsAffected`. No SELECT-then-UPDATE races.

### Phase 9: Cleanup Batching (Fix 3)

**Status**: Complete

L402 and idempotency cleanup queries use `LIMIT` batching with inter-batch sleep to avoid holding write locks during garbage collection.

### Phase 10: Concurrent Regression Tests (Fix 4)

**Status**: Complete

Concurrent regression tests prove only 1 of N goroutines succeeds for both `Consume()` and `CheckAndReserve()`. Race conditions are structurally impossible.

### Phase 11: HTTP Client Hardening (Fix 5)

**Status**: Complete

L402 client uses `http.NewRequestWithContext` for context propagation, checks `retryResp.StatusCode` after payment (returns error with payment receipt on upstream failure), and configures Transport bounds (MaxIdleConns, MaxConnsPerHost, IdleConnTimeout).

### Phase 12: Defense in Depth

**Status**: Complete

`matchEndpoint()` applies `path.Clean()` on both sides before pattern matching. Mock preimage generation uses `crypto/rand` instead of `math/rand`.

### Phase 13: Observability

**Status**: Complete

X-Request-ID UUID generated in logging middleware, propagated through context to all 14 audit entries and L402 outbound calls. Post-hoc budget check in `audit.Log()` auto-engages kill switch when daily spend exceeds limit. 100 tests passing.

### Phase 14: Security Scan Profiles

**Status**: Complete

Two YAML scan profiles codify the gateway's security posture:
- `security/gateway-l402.yaml` -- 5 scan cases: token replay rejection, concurrent consumption (1-of-N), expired token rejection, endpoint caveat enforcement
- `security/gateway-internal.yaml` -- 4 scan cases: Bearer-on-L402 rejection, L402-on-internal rejection, cross-layer auth isolation

### Phase 15: Production Deploy

**Status**: Complete

Deployed hardened gateway binary to VM (71.19.249.198). 100+ tests passing. End-to-end L402 flow verified in mock mode. Deploy scripts with rollback backup, documentation overhaul, env.example updated.

---

## v2.0 Faucet Onboarding System (Phases 10-16)

**Goal**: AI agent onboarding system with credit proxy + channel faucet for first 100 nodes.

### Phase 10: Cloudflare Tunnel + Origin Validation

**Status**: Complete

Cloudflare Access JWT validation with JWKS auto-refresh (go-oidc v3). Defense-in-depth shared secret (`X-Internal-Auth`). Nil verifier graceful degradation for dev/mock mode. Shared data functions on `*Dependencies` for L402 + internal endpoint reuse.

### Phase 11: Account System + Registration API

**Status**: Complete

PostgreSQL-backed agent registration with `lqwd_` API key prefix (base62). API key auth middleware with 401/403 differentiation. Agent profile with computed balance from credit ledger SUM. API key rotation with optimistic concurrency. Per-IP registration rate limiting (3/hour, PG-backed). pgx/v5 pgxpool (MinConns=2, MaxConns=10).

### Phase 12: Credit Ledger + Faucet Tiers

**Status**: Complete

Three-tier faucet grants (150 sat Tier 1 auto, 500 sat Tier 2 claim, Tier 3 admin manual). Credit ledger with transaction history. Daily faucet cap enforcement. Balance computed as SUM of ledger entries.

### Phase 13: L402 Proxy

**Status**: Complete

POST-based proxy endpoints with Reserve-Execute-Settle debit flow. `pg_advisory_xact_lock` per agent (FNV-1a hash of agentID). Composite PK (idempotency_key, endpoint, agent_id). `httptest.NewRecorder` for upstream delegation. `context.Background()` for settle/refund survives client disconnect.

### Phase 14: Channel Faucet

**Status**: Complete

Real Lightning channel opens + pushed sats for first 100 registering nodes with valid pubkey. Async channel open (registration never blocks on LND). Background poller for channel state detection. Ban-on-failure with admin unban. Failed grants excluded from cap count (slots recoverable). Advisory lock key `0x4348464155434554` for cap enforcement.

### Phase 15: Admin Dashboard + Tier 3 Grants

**Status**: Complete

Embedded React SPA at `/admin/`. Session auth with `crypto/rand` opaque tokens. CSRF double-submit with constant-time compare. In-memory rate limiter (5/15min). Agent list, credit grants, status management (suspend/activate). Metrics dashboard with stat cards.

### Phase 15.1: Dashboard Polish

**Status**: Complete (inserted phase)

Channels page with 14-column grant display, filtering, sorting, pagination. Transaction history drawer (Radix Dialog slide-out with cursor pagination). Two-row dashboard stat cards for channel metrics. `generate_series` zero-fill for time series charts.

### Phase 16: MCP Server

**Status**: Complete

MCP Streamable HTTP transport via mcp-go v0.46.0. Tool registration for all L402 endpoints. Per-tool API key auth. Optional credit billing (`MCP_BILLING_ENABLED`). Endpoint at `/v1/internal/mcp` with CF Access middleware.

---

## Test Suite

247 tests across 32 test files in 15 packages:

| Package | Tests |
|---------|-------|
| internal/accounts | Agent registration, API key auth, proxy debit flow, channel faucet, store |
| internal/admin | Session auth, CSRF, rate limiting, dashboard handlers |
| internal/audit | Audit logging, request ID persistence, post-hoc budget kill switch |
| internal/budget | Per-op limits, daily spend ceiling |
| internal/confirm | Two-phase confirmation flow |
| internal/handlers | Endpoint handlers, audit integration, L402 client, internal proxy, shared data |
| internal/idempotency | Duplicate detection, atomic CheckAndReserve, concurrent regression |
| internal/killswitch | File-based + programmatic kill switch |
| internal/l402 | Token store, atomic Consume(), concurrent regression, macaroon minting |
| internal/lnd | gRPC client wrappers, channel executor |
| internal/mcpserver | Tool registration, MCP handler, billing integration |
| internal/middleware | Auth (Bearer, L402, CF Access, API key, session), rate limiting, logging, X-Request-ID |
| internal/mock | Mock LND responses |

---

## Skill Count by Phase

| Phase | Skills | Type |
|-------|--------|------|
| 1B | 5 | Read-only + startup report |
| 2 | 5 | Write ops + monitoring |
| 3 | 5 | Analytics + rebalancing |
| 4 | 6 | Self-review + QA |
| 5 | 2 | Sub-agent protocol |
| 6 | 3 | Hardening + production |
| v2 | 2 | L402 client + discovery |
| **Total** | **28** | |

---

## Production Audit Findings

A comprehensive adversarial review identified 6 critical design flaws, all addressed:

1. **OpenClaw Bash is an Unbounded Attack Surface** -- Fixed: User separation + AppArmor
2. **Confirmation Flow is Exploitable via Prompt Injection** -- Fixed: Two-token auth
3. **No Idempotency on Write Operations** -- Fixed: UUID idempotency keys in SQLite
4. **No Daily Spend Ceiling** -- Fixed: Rolling 24h aggregate spend ceiling
5. **No Watchtower Configuration** -- Fixed: 2+ external watchtowers
6. **No SCB Backup Automation** -- Fixed: inotifywait -> encrypted remote upload

---

## NemoClaw Decision

NVIDIA NemoClaw (kernel-level sandbox for OpenClaw) evaluated and **deferred to Q3 2026**. Alpha software with stability concerns. Phase 0 uses hand-built AppArmor + filesystem isolation instead.
