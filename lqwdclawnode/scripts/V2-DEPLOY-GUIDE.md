# LQWDClaw-NodeOps v2.0 Deployment Guide

> **Internal operator guide — v1 scope notice**
>
> This guide describes full-system deployment including subsystems (L402 pay-per-call, credit proxy, paid MCP data tools, tier upgrade paths) that remain present in code but are **not part of LQWDClaw's v1 publicly advertised surface**. LQWDClaw offers the free channel faucet only at this time; paid liquidity is a later version. These subsystems are documented here for operator use and future re-activation.

**Deploying the Faucet Onboarding System to the production VM.**

This guide assumes v1.0 is already deployed and running on the VM (71.19.249.198) per the original [SETUP-GUIDE.md](SETUP-GUIDE.md). v2.0 adds: PostgreSQL account system, Cloudflare Tunnel, credit proxy, channel faucet, admin dashboard, and MCP server.

**VM**: 71.19.249.198 (OneProvider, Vancouver)
**Branch**: `feature/l402-server`
**Gateway binary**: lnd-gateway (Go, CGO_ENABLED=1 for SQLite)

---

## Table of Contents

1. [Pre-Deploy Checklist](#1-pre-deploy-checklist)
2. [Pull Latest Code](#2-pull-latest-code)
3. [PostgreSQL Database Setup](#3-postgresql-database-setup)
4. [Build Admin Dashboard Frontend](#4-build-admin-dashboard-frontend)
5. [Build Gateway Binary](#5-build-gateway-binary)
6. [Run Tests](#6-run-tests)
7. [Update Environment File](#7-update-environment-file)
8. [Update systemd Service](#8-update-systemd-service)
9. [Deploy Binary](#9-deploy-binary)
10. [Verify v2 Endpoints (Mock Mode)](#10-verify-v2-endpoints-mock-mode)
11. [Install Cloudflare Tunnel](#11-install-cloudflare-tunnel)
12. [Switch to Production Mode](#12-switch-to-production-mode)
13. [End-to-End Verification](#13-end-to-end-verification)
14. [Rollback Procedure](#14-rollback-procedure)

---

## 1. Pre-Deploy Checklist

SSH into the VM and verify the existing v1 stack is healthy:

```bash
ssh youradminuser@71.19.249.198

# Check all v1 services are running
for svc in tor postgresql bitcoind lnd lnd-gateway scb-backup openclaw-nodeops; do
  printf "%-20s %s\n" "$svc" "$(sudo systemctl is-active $svc)"
done

# Verify gateway is responding
curl -s http://127.0.0.1:7778/v1/health | jq .

# Verify PostgreSQL is running (already installed for LND)
sudo -u postgres psql -c "SELECT version();"

# Check disk space (need ~200MB for new DB + binary)
df -h /

# Check current gateway commit
cat /var/lib/lnd-gateway/rollback-commit 2>/dev/null || echo "No rollback file"
```

**All services must be `active` before proceeding.**

---

## 2. Pull Latest Code

```bash
# Navigate to repo
cd /opt/lqwdclawnode

# Stash any local changes (there shouldn't be any)
sudo -u lndgateway git stash 2>/dev/null

# Fetch and checkout the v2 branch
sudo -u lndgateway git fetch origin
sudo -u lndgateway git checkout feature/l402-server
sudo -u lndgateway git pull origin feature/l402-server

# Verify you're on the right commit
git log --oneline -3
# Should show: 8e80231 docs: update all documentation for v2.0 completion
```

> **Note**: If git fetch fails with permission errors, the repo may be owned by a different user. Fix with:
> ```bash
> sudo chown -R lndgateway:lndgateway /opt/lqwdclawnode
> ```

---

## 3. PostgreSQL Database Setup

v2 uses PostgreSQL for the account system (agents, credits, channel grants). This is separate from the LND PostgreSQL database.

```bash
# Create the gateway database and user
sudo -u postgres psql << 'SQL'
CREATE DATABASE lqwdclaw_gateway;
CREATE USER gateway_user WITH PASSWORD 'REPLACE_WITH_SECURE_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE lqwdclaw_gateway TO gateway_user;
-- Required for table creation in PostgreSQL 15+
\c lqwdclaw_gateway
GRANT ALL ON SCHEMA public TO gateway_user;
SQL
```

**Generate a secure password:**
```bash
# Generate and save — you'll need this for the env file
PG_PASSWORD=$(openssl rand -base64 24)
echo "Gateway DB password: $PG_PASSWORD"
echo "SAVE THIS — you'll need it in step 7"
```

**Verify connection:**
```bash
psql "postgresql://gateway_user:${PG_PASSWORD}@127.0.0.1/lqwdclaw_gateway?sslmode=disable" -c "SELECT 1;"
# Should return: 1
```

> **Tables are auto-created**: The gateway creates `agents`, `credit_ledger`, `proxy_idempotency`, and `faucet_channels` tables on first startup. No manual migration needed.

---

## 4. Build Admin Dashboard Frontend

The admin dashboard is a React SPA that gets embedded into the Go binary. The built assets must exist before compiling the gateway.

```bash
cd /opt/lqwdclawnode/lnd-gateway/admin

# Install Node.js dependencies
npm install

# Build the production bundle
npm run build

# Verify dist was created
ls -la dist/
# Should show: index.html and assets/ directory
```

> **Note**: This requires Node.js 18+ on the VM. If not installed:
> ```bash
> curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
> sudo apt install -y nodejs
> ```

---

## 5. Build Gateway Binary

```bash
cd /opt/lqwdclawnode/lnd-gateway

# Ensure Go is in PATH
export PATH=$PATH:/usr/local/go/bin

# Build (CGO required for SQLite)
CGO_ENABLED=1 go build -o lnd-gateway ./cmd/lnd-gateway/

# Verify the binary runs
./lnd-gateway --help 2>&1 || true
# (gateway has no --help flag, but should not crash)

# Check binary size (should be ~30-50MB with embedded frontend)
ls -lh lnd-gateway
```

---

## 6. Run Tests

```bash
cd /opt/lqwdclawnode/lnd-gateway

# Run all tests (247 tests expected)
CGO_ENABLED=1 go test ./...

# Optional: run with race detector
CGO_ENABLED=1 go test -race ./...
```

**All tests must pass before proceeding.**

---

## 7. Update Environment File

Add v2 environment variables to `/etc/lnd-gateway/env`:

```bash
# Generate required secrets
INTERNAL_SECRET=$(openssl rand -hex 32)
echo "Internal Auth Secret: $INTERNAL_SECRET"

# Generate admin dashboard password hash
# Option 1: Python (if bcrypt installed)
pip3 install bcrypt 2>/dev/null
ADMIN_PASS="YOUR_CHOSEN_PASSWORD"
ADMIN_HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw(b'${ADMIN_PASS}', bcrypt.gensalt()).decode())")
echo "Admin Password Hash: $ADMIN_HASH"

# Option 2: Use htpasswd
# sudo apt install -y apache2-utils
# htpasswd -nbBC 12 "" "YOUR_CHOSEN_PASSWORD" | cut -d: -f2
```

Now edit the env file:

```bash
sudo nano /etc/lnd-gateway/env
```

**Append these lines** to the existing env file (keep all v1 settings):

```bash
# ─── v2.0 Faucet Onboarding System ─────────────────────────────────

# PostgreSQL for account system (agents, credits, channels)
DATABASE_URL=postgresql://gateway_user:YOUR_PG_PASSWORD@127.0.0.1/lqwdclaw_gateway?sslmode=disable

# Cloudflare Access (leave empty until CF Tunnel is configured in step 11)
# CF_ACCESS_TEAM=lqwd
# CF_ACCESS_AUD=YOUR_CF_ACCESS_AUD_TAG

# Defense-in-depth shared secret for internal endpoints
INTERNAL_AUTH_SECRET=YOUR_GENERATED_SECRET

# Faucet configuration
FAUCET_DAILY_CAP_SATS=10000
FAUCET_CHANNEL_SIZE_SATS=100000
FAUCET_PUSH_SATS=25000
FAUCET_CHANNEL_CAP=100

# Credit proxy pricing
PROXY_PRICE_SATS=10
PROXY_UPSTREAM_TIMEOUT_SECS=30

# Admin dashboard
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=YOUR_BCRYPT_HASH

# MCP server (billing disabled by default)
MCP_BILLING_ENABLED=true
```

**Replace the placeholder values** with the real values you generated above.

**Verify the env file is complete:**
```bash
# Count v2 vars (should have at least 8 new lines)
sudo grep -c '=' /etc/lnd-gateway/env
# Expected: ~30+ total entries

# Check no placeholder values remain
sudo grep -i 'REPLACE\|YOUR_\|CHANGE_ME' /etc/lnd-gateway/env
# Should return nothing (all placeholders filled in)
```

---

## 8. Update systemd Service

The v2 gateway needs network access to PostgreSQL (Unix socket or TCP). The existing systemd service should work as-is since PostgreSQL runs on localhost. But verify:

```bash
# Check if the service file needs updating (compare with repo version)
diff /etc/systemd/system/lnd-gateway.service /opt/lqwdclawnode/scripts/lnd-gateway.service

# If there are differences, update:
sudo cp /opt/lqwdclawnode/scripts/lnd-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
```

> **Note**: The systemd service uses `ProtectSystem=strict` which blocks writes outside `ReadWritePaths`. PostgreSQL connections over TCP (127.0.0.1) work fine — no filesystem writes needed. If using Unix sockets, you'd need to add the socket path to `ReadWritePaths`.

---

## 9. Deploy Binary

```bash
# Engage kill switch (blocks write operations during deploy)
sudo touch /var/lib/lnd-gateway/kill-switch

# Back up current binary
sudo cp /usr/local/bin/lnd-gateway /usr/local/bin/lnd-gateway.v1.bak

# Record current commit for rollback
echo "$(cd /opt/lqwdclawnode && git rev-parse HEAD)" | sudo tee /var/lib/lnd-gateway/rollback-commit

# Stop gateway
sudo systemctl stop lnd-gateway

# Install new binary
sudo cp /opt/lqwdclawnode/lnd-gateway/lnd-gateway /usr/local/bin/lnd-gateway
sudo chmod 755 /usr/local/bin/lnd-gateway

# Start gateway
sudo systemctl start lnd-gateway

# Wait and check status
sleep 3
sudo systemctl status lnd-gateway --no-pager -l

# Check logs for startup errors
sudo journalctl -u lnd-gateway --no-pager -n 30
```

**Look for** in the logs:
- `listening on 127.0.0.1:7778` — basic startup
- `PostgreSQL connected` or similar — account store initialized
- `admin dashboard enabled` — admin SPA served
- No `ERROR` or `FATAL` lines

**If startup fails**, check:
```bash
# Common issues:
# 1. DATABASE_URL wrong — check PG password and database name
# 2. ADMIN_PASSWORD_HASH has special chars — ensure it's properly quoted in env file
# 3. Missing CGO — binary must be built with CGO_ENABLED=1
sudo journalctl -u lnd-gateway --no-pager -n 50 | grep -i 'error\|fatal\|panic'
```

---

## 10. Verify v2 Endpoints (Mock Mode)

If running in mock mode (`GATEWAY_MOCK=true`), test all v2 endpoints:

```bash
export AGENT_TOKEN=$(sudo cat /etc/lnd-gateway/agent-token)
export ADMIN_TOKEN="YOUR_ADMIN_TOKEN"

# ── v1 health check ──
echo "=== Health ==="
curl -s http://127.0.0.1:7778/v1/health | jq .

# ── Admin dashboard ──
echo "=== Admin Dashboard ==="
curl -s -o /dev/null -w "HTTP %{http_code}" http://127.0.0.1:7778/admin/
# Expect: HTTP 200

echo ""
echo "=== Admin Login ==="
curl -s -X POST http://127.0.0.1:7778/admin/api/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "YOUR_ADMIN_PASSWORD"}' | jq .
# Expect: {"token": "...", "csrf_token": "..."}

# ── Agent Registration ──
echo "=== Register Agent ==="
curl -s -X POST http://127.0.0.1:7778/v1/internal/accounts/register \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: YOUR_INTERNAL_SECRET" \
  -d '{"name": "test-agent-1"}' | jq .
# Expect: {"api_key": "lqwd_...", "tier": 1, "credits_granted": 150}
# SAVE THE API KEY for next tests

# ── Agent Profile ──
echo "=== Agent Profile ==="
API_KEY="lqwd_THE_KEY_FROM_ABOVE"
curl -s http://127.0.0.1:7778/v1/internal/accounts/me \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Internal-Auth: YOUR_INTERNAL_SECRET" | jq .
# Expect: agent details with balance: 150

# ── Credit Proxy ──
echo "=== Credit Proxy (node-stats) ==="
curl -s -X POST http://127.0.0.1:7778/v1/internal/proxy/node-stats \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Internal-Auth: YOUR_INTERNAL_SECRET" | jq .
# Expect: node stats data, balance decremented by PROXY_PRICE_SATS

# ── Agent Profile (check balance after proxy call) ──
echo "=== Balance After Proxy ==="
curl -s http://127.0.0.1:7778/v1/internal/accounts/me \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Internal-Auth: YOUR_INTERNAL_SECRET" | jq '.balance'
# Expect: 140 (150 - 10)

# ── Transactions ──
echo "=== Transaction History ==="
curl -s http://127.0.0.1:7778/v1/internal/accounts/transactions \
  -H "X-Api-Key: $API_KEY" \
  -H "X-Internal-Auth: YOUR_INTERNAL_SECRET" | jq .
# Expect: array with grant + debit entries

# ── MCP Server ──
echo "=== MCP Initialize ==="
curl -s -X POST http://127.0.0.1:7778/v1/internal/mcp \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: YOUR_INTERNAL_SECRET" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "id": 1, "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}}' | jq .
# Expect: capabilities with tools list

# ── Admin Metrics ──
echo "=== Admin Metrics ==="
# First login to get session token
SESSION=$(curl -s -X POST http://127.0.0.1:7778/admin/api/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "YOUR_ADMIN_PASSWORD"}' \
  -c - | grep session | awk '{print $NF}')

curl -s http://127.0.0.1:7778/admin/api/metrics \
  -H "Cookie: session=$SESSION" | jq .
# Expect: metrics with agent count, total credits, etc.

# ── Channel Registration (with pubkey — mock mode) ──
echo "=== Register Agent with Pubkey ==="
curl -s -X POST http://127.0.0.1:7778/v1/internal/accounts/register \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: YOUR_INTERNAL_SECRET" \
  -d '{
    "name": "test-node-agent",
    "pubkey": "0288a5f5c2e6b8e0c8f35a1d9c4b7e2a3f6d8e1b4c7a9d2e5f8b1c4d7e0a3f6b9c",
    "node_uri": "0288a5f5c2e6b8e0c8f35a1d9c4b7e2a3f6d8e1b4c7a9d2e5f8b1c4d7e0a3f6b9c@203.0.113.42:9735"
  }' | jq .
# Expect: channel_granted: true, channel_status: "pending"

echo ""
echo "=== All v2 endpoints verified ==="
```

**Disengage kill switch after verification:**
```bash
sudo rm -f /var/lib/lnd-gateway/kill-switch
```

---

## 11. Install Cloudflare Tunnel

Cloudflare Tunnel exposes `/v1/internal/*` endpoints to the internet securely. Skip this step if you want to test locally first.

### Install cloudflared

```bash
# Download and install
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
  -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb

# Verify
cloudflared --version
```

### Authenticate and Create Tunnel

```bash
# Login (opens browser — use SSH tunnel or copy URL)
cloudflared tunnel login

# Create tunnel
cloudflared tunnel create lqwdclaw
# Note the TUNNEL_ID from the output

# Configure tunnel
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml << 'EOF'
tunnel: YOUR_TUNNEL_ID
credentials-file: /root/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: api.lqwdclaw.bot
    service: http://127.0.0.1:7778
    originRequest:
      noTLSVerify: false
  - service: http_status:404
EOF
```

### Create DNS Record

```bash
# Point api.lqwdclaw.bot to the tunnel
cloudflared tunnel route dns lqwdclaw api.lqwdclaw.bot
```

### Create CF Access Application

1. Go to **Cloudflare Zero Trust dashboard** → Access → Applications
2. Create a **Self-hosted** application:
   - **Name**: LQWDClaw API
   - **Domain**: `api.lqwdclaw.bot`
   - **Path**: `/v1/internal/*`
3. **Copy the Application Audience (AUD) tag**
4. Create an Access policy (e.g., service tokens for AI agents)

### Update Gateway Environment

```bash
sudo nano /etc/lnd-gateway/env
```

Uncomment and fill in:
```bash
CF_ACCESS_TEAM=lqwd
CF_ACCESS_AUD=YOUR_APPLICATION_AUD_TAG
```

### Start Tunnel

```bash
# Install as systemd service
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

# Verify
sudo systemctl status cloudflared
```

### Restart Gateway (to pick up CF config)

```bash
sudo systemctl restart lnd-gateway
sleep 3
sudo systemctl status lnd-gateway --no-pager
```

### Verify External Access

```bash
# From your LOCAL machine (not the VM):
# Should return 403 (CF Access blocks without valid JWT)
curl -s -o /dev/null -w "HTTP %{http_code}" https://api.lqwdclaw.bot/v1/internal/node-stats

# With a CF Access service token:
curl -s https://api.lqwdclaw.bot/v1/internal/node-stats \
  -H "CF-Access-Client-Id: YOUR_SERVICE_TOKEN_ID" \
  -H "CF-Access-Client-Secret: YOUR_SERVICE_TOKEN_SECRET" | jq .
```

---

## 12. Switch to Production Mode

Once all v2 endpoints are verified in mock mode:

```bash
# Stop gateway
sudo systemctl stop lnd-gateway

# Switch from mock to production
sudo sed -i 's/^GATEWAY_MOCK=true/GATEWAY_MOCK=false/' /etc/lnd-gateway/env

# Start gateway
sudo systemctl start lnd-gateway

# Verify real LND data returns
sleep 3
curl -s -H "Authorization: Bearer $(sudo cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/info -d '{}' | jq '.alias'
# Should show: "LQWD-AI-Launchpad" (real node alias, not mock data)
```

---

## 13. End-to-End Verification

Run the full verification suite after deploying to production:

```bash
echo "╔══════════════════════════════════════════════╗"
echo "║  LQWDClaw-NodeOps v2.0 Deployment Verify    ║"
echo "╚══════════════════════════════════════════════╝"

PASS=0
FAIL=0

check() {
  if [ "$1" -eq 0 ]; then
    echo "  ✓ $2"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $2"
    FAIL=$((FAIL + 1))
  fi
}

# v1 services
echo ""
echo "── v1 Services ──"
sudo systemctl is-active --quiet lnd-gateway; check $? "lnd-gateway running"
sudo systemctl is-active --quiet lnd; check $? "LND running"
sudo systemctl is-active --quiet bitcoind; check $? "bitcoind running"
sudo systemctl is-active --quiet scb-backup; check $? "SCB backup running"
sudo systemctl is-active --quiet openclaw-nodeops; check $? "OpenClaw running"

# v1 endpoints
echo ""
echo "── v1 Endpoints ──"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/v1/health)
[ "$HTTP" = "200" ]; check $? "GET /v1/health → $HTTP"

# v2 services
echo ""
echo "── v2 Services ──"
sudo systemctl is-active --quiet postgresql; check $? "PostgreSQL running"

# v2 endpoints
echo ""
echo "── v2 Endpoints ──"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/admin/)
[ "$HTTP" = "200" ]; check $? "GET /admin/ → $HTTP (dashboard)"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:7778/admin/api/login \
  -H "Content-Type: application/json" -d '{"username":"admin","password":"wrong"}')
[ "$HTTP" = "401" ]; check $? "POST /admin/api/login (bad pw) → $HTTP"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  http://127.0.0.1:7778/v1/internal/accounts/me)
[ "$HTTP" = "401" -o "$HTTP" = "403" ]; check $? "GET /accounts/me (no key) → $HTTP"

HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  http://127.0.0.1:7778/v1/internal/mcp \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: $(sudo grep INTERNAL_AUTH_SECRET /etc/lnd-gateway/env | cut -d= -f2)" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}')
[ "$HTTP" = "200" ]; check $? "POST /v1/internal/mcp → $HTTP (MCP server)"

# Cloudflare (optional)
echo ""
echo "── Cloudflare Tunnel ──"
if sudo systemctl is-active --quiet cloudflared 2>/dev/null; then
  check 0 "cloudflared running"
else
  echo "  ⊘ cloudflared not installed (optional)"
fi

# Kill switch
echo ""
echo "── Safety ──"
[ ! -f /var/lib/lnd-gateway/kill-switch ]; check $? "Kill switch disengaged"

# Summary
echo ""
echo "════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo "  ⚠ DEPLOY INCOMPLETE — fix failures above"
  exit 1
else
  echo "  ✓ v2.0 DEPLOY VERIFIED"
fi
```

---

## 14. Rollback Procedure

If v2 deploy fails and you need to revert to v1:

### Quick Rollback (binary only)

```bash
# Stop gateway
sudo systemctl stop lnd-gateway

# Restore v1 binary
sudo cp /usr/local/bin/lnd-gateway.v1.bak /usr/local/bin/lnd-gateway

# Remove v2 env vars (or comment them out)
sudo nano /etc/lnd-gateway/env
# Comment out all lines under "v2.0 Faucet Onboarding System"

# Start gateway
sudo systemctl start lnd-gateway

# Verify
curl -s http://127.0.0.1:7778/v1/health | jq .
```

### Full Rollback (source + binary)

```bash
# Get the v1 commit
V1_COMMIT=$(cat /var/lib/lnd-gateway/rollback-commit)

# Checkout v1 code
cd /opt/lqwdclawnode
sudo -u lndgateway git checkout $V1_COMMIT

# Rebuild and deploy
cd lnd-gateway
export PATH=$PATH:/usr/local/go/bin
CGO_ENABLED=1 go build -o lnd-gateway ./cmd/lnd-gateway/

sudo systemctl stop lnd-gateway
sudo cp lnd-gateway /usr/local/bin/lnd-gateway
sudo systemctl start lnd-gateway
```

### Database Cleanup (if needed)

The v2 PostgreSQL database is independent — v1 doesn't touch it. Safe to leave in place or drop:

```bash
# Only if you want to fully remove v2 data:
sudo -u postgres psql -c "DROP DATABASE lqwdclaw_gateway;"
sudo -u postgres psql -c "DROP USER gateway_user;"
```

---

## Quick Reference — v2 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string |
| `INTERNAL_AUTH_SECRET` | **Yes** | — | Shared secret for X-Internal-Auth header |
| `ADMIN_USERNAME` | **Yes** | — | Dashboard login username |
| `ADMIN_PASSWORD_HASH` | **Yes** | — | bcrypt hash of dashboard password |
| `CF_ACCESS_TEAM` | No* | — | CF Access team domain |
| `CF_ACCESS_AUD` | No* | — | CF Access application audience tag |
| `FAUCET_DAILY_CAP_SATS` | No | `10000` | Global daily faucet cap |
| `FAUCET_CHANNEL_SIZE_SATS` | No | `100000` | Channel size for faucet grants |
| `FAUCET_PUSH_SATS` | No | `25000` | Sats pushed to peer on channel open |
| `FAUCET_CHANNEL_CAP` | No | `100` | Max total channel grants |
| `PROXY_PRICE_SATS` | No | `10` | Cost per proxy call |
| `PROXY_UPSTREAM_TIMEOUT_SECS` | No | `30` | Proxy upstream timeout |
| `MCP_BILLING_ENABLED` | No | `false` | Enable credit billing for MCP calls |

\* Required for external access. Gateway works without CF Access in mock/dev mode.

---

## Quick Reference — Service Dependencies

```
                    ┌─── bitcoind ──→ lnd ──→ lnd-gateway ──→ openclaw-nodeops
postgresql ─────────┤                             ↑
                    └─────────────────────────────┘
cloudflared (independent — Cloudflare Tunnel to :7778)
scb-backup (watches LND channel.backup)
```

## Quick Reference — v2 Ports

| Port | Service | Access |
|------|---------|--------|
| 7778 | lnd-gateway | localhost only (CF Tunnel for external) |
| 5432 | PostgreSQL | localhost only |
| 443 | cloudflared | outbound to Cloudflare edge |
| 9735 | LND P2P | public (Lightning Network) |

No new ports need to be opened in the firewall. All v2 external access goes through the Cloudflare Tunnel.
