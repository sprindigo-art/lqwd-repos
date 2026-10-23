# Changelog

All notable changes to LQWDClaw-NodeOps (the backend powering **LQWD**'s public Bitcoin Lightning onboarding service) are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows milestone-based versioning (v1.0, v2.0, v3.0, …) rather than strict SemVer.

## [Unreleased]

Phase 22 Wave 6 human UAT (CHK-01, DOC-07, CHK-03) still open as of 2026-04-24.

## v3.0 Phase 22 — 2026-04-24

**Agent-native onboarding layer.** Made the Launchpad surface readable by AI agents without a human in the loop, closed the stuck-pending channel-status bug class, exposed operator-grade observability.

### Added

- `internal/lndparse` shared package — single source of truth for parsing `PendingChannelsResponse` across the live gRPC client, mock, and mainnet poller. `ParseChannelState` + `LiveChannelLookup` entry points.
- `internal/feeestimate` subsystem — polls mempool.space halfHourFee endpoint hourly, clamps to a sanity band, persists the live sat/vB rate onto each channel grant via `SetChannelFundingFeeRate`, and feeds into LND `OpenChannel` calls.
- `internal/middleware/version.go` — `X-Gateway-Version` response header on every request (success and error paths). Value is ldflags-injected at build time via `-X main.Version=$(git describe --tags --always --dirty)`.
- `GET /v1/channels/pending` — internal operator route, Bearer-authed, returns an allowlisted response shape mirroring LND `PendingChannels` (5 keys: `pending_open_channels`, `pending_closing_channels`, `pending_force_closing_channels`, `waiting_close_channels`, `total_limbo_balance`).
- `POST /v1/internal/admin/alert` — operator-alert bridge handler for SKL-03 / SKL-04 drift detection (version mismatch, trust-manifest drift). Allowlisted request schema, admin-auth, rate-limited.
- `/.well-known/ai-agent-trust.json` — machine-readable trust manifest, served by Caddy, cached 5 min must-revalidate.
- `/.well-known/security.txt` — RFC-9116 security contact.
- `pending_close_count` + `force_close_count` fields on `GET /v1/internal/admin/faucet/summary` — sourced from the same LND RPC call as the new `/v1/channels/pending` route (no duplicate gRPC).
- `/v1/discovery` v3.0: four additive fields — `install_commands.saturnzap.{explicit,verify}`, `flow_order[]` (7 steps), `suggested_alias_rules`, `discovery_version: "3.0"`. Pre-v3 fields are preserved verbatim (shape contract is locked via reflect.DeepEqual against a golden fixture).
- `scripts/Caddyfile` `handle` blocks for `/.well-known/ai-agent-trust.json` and `/.well-known/security.txt` — must appear before `handle /` so the catch-all doesn't swallow them.
- 5 `lqwdclaw-nodeops/skills/*/SKILL.md` updates with SKL-03 + SKL-04 bash preamble: `lnd-channels`, `faucet-admin`, `faucet-monitor`, `channel-faucet`, `gateway-contract-validator`.
- Drift-guard test (`lnd-gateway/internal/handlers/trust_manifest_test.go`) — detects drift between the committed `ai-agent-trust.json` and the compiled trust-manifest constants at CI time.
- CI scope-lock workflow (`.github/workflows/scope-lock.yml`) + scanner (`scripts/ci/scope-lock-check.sh`) + allowlist (`.github/scope-lock-allowlist.yml`) — guards `/for-agents` against classifier-unsafe content regressions.

### Changed

- `/v1/internal/channel/status` now reads LND live state via `lndparse.LiveChannelLookup` and issues an atomic CAS `UPDATE` on pending_open → open transitions. Closes the UAT-11 / UAT-12 stuck-pending bug class.
- Background channel poller refactored to share the `lndparse` code path — mock and live writers both funnel through `UpdateChannelStatusCAS`.
- `scripts/for-agents.html` rewritten to inspectable-data posture — removed `curl | sh` installers, made the public copy refer to the service consistently as **LQWD** (with `LQWD-AI-Launchpad` retained only as the LND alias label peers see on the network), ensured AI coding classifiers accept the page.
- `PendingChannels` gRPC wrapper widened to expose all 5 channel buckets (previously a subset) — enables the new internal operator route and the admin-summary enrichment.
- `ChannelGrant` row now carries `funding_fee_rate_sat_vb`, `capacity_sats`, `channel_point`, `fee_budget_sat`, and `closure_reason` — surfaced on `/v1/internal/channel/status` responses once the CAS transition populates them (REN-04 real path).
- `deploy-gateway.sh` copies `scripts/well-known/*` → `/etc/caddy/landing/.well-known/` and reloads Caddy.

### Fixed

- Mock `AccountStore.GetChannelGrant` / `GetChannelGrantByID` previously returned internal pointers, letting concurrent CAS writers race with readers outside the mutex. Now returns value copies — brings mock into parity with `PGStore`'s fresh-scan semantics. Surfaced by the new `-race` CAS concurrency test.

### Security

- Scrape Shield Email Obfuscation must be OFF on the Cloudflare zone (otherwise `/for-agents` injects `/cdn-cgi/scripts/…/email-decode.min.js`, which AI classifiers hard-block on). Codified as CHK-02 gate in Plan 22-09.
- WAF Custom Rule required: `Skip` action on `/for-agents`, `/v1/discovery`, and `/.well-known/*` — bypasses managed rulesets, rate-limits, and Super Bot Fight Mode that would otherwise challenge machine-readable surfaces.

### Known deploy-script gaps (tracked as Phase 22 post-ship tech-debt)

- `deploy-gateway.sh` calls bare `go build`; sudo's `secure_path` strips Go from PATH. Workaround: `sudo env "PATH=/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin" ./deploy-gateway.sh`.
- `deploy-gateway.sh` does NOT promote `scripts/Caddyfile` → `/etc/caddy/Caddyfile`. The new `handle /.well-known/*` blocks must be copied manually until the script is hardened.
- `deploy-gateway.sh` does NOT promote `scripts/for-agents.html` → `/etc/caddy/landing/for-agents.html`. Same manual step required.

See `scripts/deploy-gateway.sh` and Operations / Deployment Guide for manual workarounds until the script is hardened.

## v2.1 Phase 21 — 2026-04-22

- Gateway time-ban + faucet-pause internal endpoints.
- OpenClaw skills: `channel-faucet` rewrite, new `faucet-monitor` + `faucet-admin`.
- Fixed VM skills symlink so `git pull` auto-refreshes the Telegram runtime.

## v2.0 — 2026-04-08

Channel faucet onboarding. 20k sat channels, 1354 sat push, 100-channel cap. PostgreSQL-backed agent + grant store, registration rate limit (3/IP/hour), pubkey ban on connect failures, async channel open + background status poller.

## v1.0 — 2026-03-27

Initial production release. L402 pay-per-call, MCP data tools, admin dashboard, budget + kill-switch + confirmation-flow safety rails, SCB backup monitor, audit log with post-hoc budget check.
