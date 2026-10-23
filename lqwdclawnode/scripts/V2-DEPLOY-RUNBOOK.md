# v2.0 Deploy Runbook — Copy & Paste

> **Internal operator guide — v1 scope notice**
>
> This runbook describes full-system deployment including subsystems (L402 pay-per-call, credit proxy, paid MCP data tools, tier upgrade paths) that remain present in code but are **not part of LQWDClaw's v1 publicly advertised surface**. LQWDClaw offers the free channel faucet only at this time; paid liquidity is a later version. These subsystems are documented here for operator use and future re-activation.

**Target**: 71.19.249.198 (OneProvider VM, Vancouver)
**Branch**: `feature/l402-server`
**Prerequisite**: v1 stack already deployed and running

Every command below is meant to be run exactly as shown. Replace only lines marked with `# ← REPLACE`.

---

## Step 1: SSH into the VM

```bash
ssh youradminuser@71.19.249.198
```

---

## Step 2: Verify v1 is healthy

```bash
for svc in tor postgresql bitcoind lnd lnd-gateway scb-backup openclaw-nodeops; do
  printf "%-20s %s\n" "$svc" "$(sudo systemctl is-active $svc)"
done
```

**Expected**: All show `active`. If any show `inactive` or `failed`, fix before continuing.

```bash
curl -s http://127.0.0.1:7778/v1/health | jq .
```

**Expected**: `"ok": true`

```bash
df -h /
```

**Expected**: At least 500MB free.

---

## Step 3: Pull latest code

```bash
cd /opt/lqwdclawnode
sudo -u lndgateway git fetch origin
sudo -u lndgateway git checkout feature/l402-server
sudo -u lndgateway git pull origin feature/l402-server
```

**If permission error**:
```bash
sudo chown -R lndgateway:lndgateway /opt/lqwdclawnode
# Then retry the git commands above
```

**Verify**:
```bash
git log --oneline -1
```

**Expected**: `be43078 docs: add v2.0 deployment guide and update env.example` (or newer)

---

## Step 4: Create PostgreSQL database

```bash
# Generate a secure password
PG_PASSWORD=$(openssl rand -base64 24)
echo ""
echo "=========================================="
echo "  DATABASE PASSWORD (save this now):"
echo "  $PG_PASSWORD"
echo "=========================================="
echo ""
```

**Copy and save the password. You will need it in Step 8.**

```bash
sudo -u postgres psql << SQL
CREATE DATABASE lqwdclaw_gateway;
CREATE USER gateway_user WITH PASSWORD '${PG_PASSWORD}';
GRANT ALL PRIVILEGES ON DATABASE lqwdclaw_gateway TO gateway_user;
\c lqwdclaw_gateway
GRANT ALL ON SCHEMA public TO gateway_user;
SQL
```

**Verify**:
```bash
psql "postgresql://gateway_user:${PG_PASSWORD}@127.0.0.1/lqwdclaw_gateway?sslmode=disable" -c "SELECT 1 AS ok;"
```

**Expected**: Returns `1`.

---

## Step 5: Install Node.js (if not already installed)

```bash
node --version 2>/dev/null
```

If this returns `v18+` or `v20+` or `v22+`, skip to Step 6.

If not installed:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

---

## Step 6: Build admin dashboard frontend

```bash
cd /opt/lqwdclawnode/lnd-gateway/admin
npm install
npm run build
```

**Verify**:
```bash
ls dist/index.html dist/assets/
```

**Expected**: `index.html` exists, `assets/` directory has `.js` and `.css` files.

---

## Step 7: Build and test gateway binary

```bash
cd /opt/lqwdclawnode/lnd-gateway
export PATH=$PATH:/usr/local/go/bin
CGO_ENABLED=1 go build -o lnd-gateway ./cmd/lnd-gateway/
```

**Verify build**:
```bash
ls -lh lnd-gateway
```

**Expected**: Binary exists, ~30-50MB.

**Run tests**:
```bash
CGO_ENABLED=1 go test ./...
```

**Expected**: All packages `ok`, 0 failures. Do NOT proceed if tests fail.

---

## Step 8: Generate secrets and update environment

### Generate all secrets at once

```bash
INTERNAL_SECRET=$(openssl rand -hex 32)

echo ""
echo "=========================================="
echo "  INTERNAL_AUTH_SECRET:"
echo "  $INTERNAL_SECRET"
echo "=========================================="
echo ""
echo "  DATABASE PASSWORD (from Step 4):"
echo "  $PG_PASSWORD"
echo "=========================================="
echo ""
```

### Choose your admin dashboard password

Pick a password you'll use to log into the admin dashboard at `/admin/`.

```bash
# Install bcrypt if needed
pip3 install bcrypt 2>/dev/null || sudo apt install -y python3-pip && pip3 install bcrypt

# Set your chosen password here:
ADMIN_PASS="changeme123"   # ← REPLACE with your chosen password

ADMIN_HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw(b'${ADMIN_PASS}', bcrypt.gensalt()).decode())")

echo ""
echo "=========================================="
echo "  ADMIN_PASSWORD_HASH:"
echo "  $ADMIN_HASH"
echo "=========================================="
echo ""
```

### Append v2 config to env file

```bash
sudo tee -a /etc/lnd-gateway/env << ENVEOF

# ─── v2.0 Faucet Onboarding System ─────────────────────────────────

# PostgreSQL for account system
DATABASE_URL=postgresql://gateway_user:${PG_PASSWORD}@127.0.0.1/lqwdclaw_gateway?sslmode=disable

# Defense-in-depth shared secret
INTERNAL_AUTH_SECRET=${INTERNAL_SECRET}

# Cloudflare Access (uncomment after CF Tunnel is configured)
# CF_ACCESS_TEAM=lqwd
# CF_ACCESS_AUD=

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
ADMIN_PASSWORD_HASH=${ADMIN_HASH}

# MCP server
MCP_BILLING_ENABLED=true
ENVEOF
```

**Verify** — check no placeholders remain:
```bash
sudo grep -c '=' /etc/lnd-gateway/env
```

**Expected**: ~30+ lines.

```bash
sudo grep 'DATABASE_URL\|ADMIN_PASSWORD_HASH\|INTERNAL_AUTH_SECRET' /etc/lnd-gateway/env
```

**Expected**: All three lines present with real values (no empty values after `=`).

---

## Step 9: Engage kill switch and back up v1

```bash
# Block all write operations
sudo touch /var/lib/lnd-gateway/kill-switch

# Back up current binary
sudo cp /usr/local/bin/lnd-gateway /usr/local/bin/lnd-gateway.v1.bak

# Record rollback commit
echo "$(cd /opt/lqwdclawnode && git rev-parse HEAD)" | sudo tee /var/lib/lnd-gateway/rollback-commit
```

---

## Step 10: Deploy new binary

```bash
# Stop gateway
sudo systemctl stop lnd-gateway

# Install v2 binary
sudo cp /opt/lqwdclawnode/lnd-gateway/lnd-gateway /usr/local/bin/lnd-gateway
sudo chmod 755 /usr/local/bin/lnd-gateway

# Update systemd service file (if changed)
sudo cp /opt/lqwdclawnode/scripts/lnd-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload

# Start gateway
sudo systemctl start lnd-gateway

# Wait for startup
sleep 3
```

**Check status**:
```bash
sudo systemctl status lnd-gateway --no-pager -l
```

**Expected**: `active (running)`.

**If it failed**, check logs:
```bash
sudo journalctl -u lnd-gateway --no-pager -n 50
```

Common fixes:
- `DATABASE_URL` wrong → check password, database name exists
- `ADMIN_PASSWORD_HASH` has unescaped `$` → re-run Step 8 append
- Binary segfault → ensure `CGO_ENABLED=1` was used in build

---

## Step 11: Verify v2 endpoints

### 11a: Health check

```bash
curl -s http://127.0.0.1:7778/v1/health | jq .
```

**Expected**: `"ok": true`

### 11b: Admin dashboard loads

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:7778/admin/
```

**Expected**: `HTTP 200`

### 11c: Admin login

```bash
curl -s -X POST http://127.0.0.1:7778/admin/api/login \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"admin\", \"password\": \"${ADMIN_PASS}\"}" | jq .
```

**Expected**: JSON with `token` and `csrf_token` fields.

### 11d: Register a test agent

```bash
REGISTER_RESULT=$(curl -s -X POST http://127.0.0.1:7778/v1/internal/accounts/register \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: ${INTERNAL_SECRET}" \
  -d '{"name": "deploy-test-agent"}')

echo "$REGISTER_RESULT" | jq .

# Extract the API key for subsequent tests
TEST_API_KEY=$(echo "$REGISTER_RESULT" | jq -r '.api_key')
echo ""
echo "Test API Key: $TEST_API_KEY"
```

**Expected**: JSON with `api_key` starting with `lqwd_`, `credits_granted: 150`.

### 11e: Agent profile

```bash
curl -s http://127.0.0.1:7778/v1/internal/accounts/me \
  -H "X-Api-Key: ${TEST_API_KEY}" \
  -H "X-Internal-Auth: ${INTERNAL_SECRET}" | jq .
```

**Expected**: Agent details with `balance: 150`.

### 11f: Credit proxy call

```bash
curl -s -X POST http://127.0.0.1:7778/v1/internal/proxy/node-stats \
  -H "X-Api-Key: ${TEST_API_KEY}" \
  -H "X-Internal-Auth: ${INTERNAL_SECRET}" | jq .
```

**Expected**: Node stats data returned. (Mock data if `GATEWAY_MOCK=true`, real data if `false`.)

### 11g: Check balance after proxy call

```bash
curl -s http://127.0.0.1:7778/v1/internal/accounts/me \
  -H "X-Api-Key: ${TEST_API_KEY}" \
  -H "X-Internal-Auth: ${INTERNAL_SECRET}" | jq '.balance'
```

**Expected**: `140` (150 - 10 sats proxy cost).

### 11h: Transaction history

```bash
curl -s "http://127.0.0.1:7778/v1/internal/accounts/transactions" \
  -H "X-Api-Key: ${TEST_API_KEY}" \
  -H "X-Internal-Auth: ${INTERNAL_SECRET}" | jq .
```

**Expected**: Array with at least 2 entries (faucet grant + proxy debit).

### 11i: MCP server

```bash
curl -s -X POST http://127.0.0.1:7778/v1/internal/mcp \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: ${INTERNAL_SECRET}" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "id": 1, "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "deploy-test", "version": "1.0"}}}' | jq .
```

**Expected**: JSON with `serverInfo` and `capabilities`.

### 11j: Admin metrics (via API)

```bash
# Login and capture session cookie
SESSION_COOKIE=$(curl -s -X POST http://127.0.0.1:7778/admin/api/login \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"admin\", \"password\": \"${ADMIN_PASS}\"}" \
  -c - | grep session | awk '{print $NF}')

curl -s http://127.0.0.1:7778/admin/api/metrics \
  -H "Cookie: session=${SESSION_COOKIE}" | jq .
```

**Expected**: Metrics JSON with `total_agents: 1` (the test agent you just created).

### 11k: Channel faucet registration (mock)

```bash
curl -s -X POST http://127.0.0.1:7778/v1/internal/accounts/register \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: ${INTERNAL_SECRET}" \
  -d '{
    "name": "deploy-test-node",
    "pubkey": "0288a5f5c2e6b8e0c8f35a1d9c4b7e2a3f6d8e1b4c7a9d2e5f8b1c4d7e0a3f6b9c",
    "node_uri": "0288a5f5c2e6b8e0c8f35a1d9c4b7e2a3f6d8e1b4c7a9d2e5f8b1c4d7e0a3f6b9c@203.0.113.42:9735"
  }' | jq .
```

**Expected**: `channel_granted: true`, `channel_status: "pending"`.

---

## Step 12: Disengage kill switch

```bash
sudo rm -f /var/lib/lnd-gateway/kill-switch
```

**Verify**:
```bash
curl -s http://127.0.0.1:7778/v1/health | jq '.kill_switch'
```

**Expected**: `false`

---

## Step 13: Switch to production mode (if currently in mock)

Skip this step if `GATEWAY_MOCK` is already `false`.

```bash
# Check current mode
sudo grep GATEWAY_MOCK /etc/lnd-gateway/env

# Switch to production
sudo sed -i 's/^GATEWAY_MOCK=true/GATEWAY_MOCK=false/' /etc/lnd-gateway/env

# Restart
sudo systemctl restart lnd-gateway
sleep 3
sudo systemctl status lnd-gateway --no-pager

# Verify real LND data
curl -s -H "Authorization: Bearer $(sudo cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/info -d '{}' | jq '.alias'
```

**Expected**: `"LQWD-AI-Launchpad"` (real node alias).

---

## Step 14: Run full verification script

```bash
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  LQWDClaw-NodeOps v2.0 Deploy Verification  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

PASS=0; FAIL=0
check() {
  if [ "$1" -eq 0 ]; then echo "  ✓ $2"; PASS=$((PASS+1))
  else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi
}

echo "── Services ──"
for svc in postgresql lnd lnd-gateway openclaw-nodeops; do
  sudo systemctl is-active --quiet $svc; check $? "$svc running"
done

echo ""
echo "── v1 Endpoints ──"
H=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/v1/health)
[ "$H" = "200" ]; check $? "GET /v1/health → $H"

echo ""
echo "── v2 Endpoints ──"
H=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/admin/)
[ "$H" = "200" ]; check $? "GET /admin/ → $H"

H=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/v1/internal/accounts/me)
[ "$H" = "401" -o "$H" = "403" ]; check $? "GET /accounts/me (no key) → $H"

INTERNAL_SECRET_VAL=$(sudo grep '^INTERNAL_AUTH_SECRET=' /etc/lnd-gateway/env | cut -d= -f2)
H=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:7778/v1/internal/mcp \
  -H "Content-Type: application/json" \
  -H "X-Internal-Auth: ${INTERNAL_SECRET_VAL}" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}')
[ "$H" = "200" ]; check $? "POST /v1/internal/mcp → $H"

echo ""
echo "── Safety ──"
[ ! -f /var/lib/lnd-gateway/kill-switch ]; check $? "Kill switch disengaged"

echo ""
echo "════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"
[ "$FAIL" -eq 0 ] && echo "  ✓ v2.0 DEPLOY VERIFIED" || echo "  ⚠ FIX FAILURES ABOVE"
```

---

## Step 15: Cloudflare Tunnel (do this after v2 is verified)

This makes `/v1/internal/*` endpoints accessible from the internet.

### 15a: Install cloudflared

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
  -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
cloudflared --version
```

### 15b: Authenticate

```bash
cloudflared tunnel login
```

This prints a URL. Open it in your browser, select the `lqwdclaw.bot` domain, and authorize.

### 15c: Create tunnel

```bash
cloudflared tunnel create lqwdclaw
```

**Save the Tunnel ID** from the output. It looks like: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

### 15d: Configure tunnel

```bash
TUNNEL_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"   # ← REPLACE with your tunnel ID

sudo mkdir -p /etc/cloudflared

sudo tee /etc/cloudflared/config.yml << EOF
tunnel: ${TUNNEL_ID}
credentials-file: /root/.cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: api.lqwdclaw.bot
    service: http://127.0.0.1:7778
  - service: http_status:404
EOF
```

### 15e: Create DNS record

```bash
cloudflared tunnel route dns lqwdclaw api.lqwdclaw.bot
```

### 15f: Create CF Access application

1. Go to https://one.dash.cloudflare.com → Access → Applications
2. Click **Add an application** → **Self-hosted**
3. **Application name**: `LQWDClaw API`
4. **Session Duration**: 24 hours
5. **Application domain**: `api.lqwdclaw.bot`
6. **Path**: leave empty (protect entire domain)
7. Create a policy (e.g., "Service Auth" with service tokens)
8. **Copy the Application Audience (AUD) tag** from the overview page

### 15g: Update gateway env with CF credentials

```bash
CF_AUD="your-aud-tag-here"   # ← REPLACE with the AUD tag from step 15f

sudo sed -i "s|^# CF_ACCESS_TEAM=lqwd|CF_ACCESS_TEAM=lqwd|" /etc/lnd-gateway/env
sudo sed -i "s|^# CF_ACCESS_AUD=|CF_ACCESS_AUD=${CF_AUD}|" /etc/lnd-gateway/env
```

### 15h: Start tunnel and restart gateway

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

# Restart gateway to pick up CF config
sudo systemctl restart lnd-gateway
sleep 3
```

### 15i: Verify external access

From your **local machine** (not the VM):

```bash
# Should return 403 (blocked by CF Access — no JWT)
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://api.lqwdclaw.bot/v1/internal/node-stats
```

**Expected**: `HTTP 403`

---

## Rollback (if anything goes wrong)

### Quick rollback (binary only, 30 seconds)

```bash
sudo systemctl stop lnd-gateway
sudo cp /usr/local/bin/lnd-gateway.v1.bak /usr/local/bin/lnd-gateway

# Comment out v2 env vars
sudo sed -i '/v2.0 Faucet Onboarding/,$s/^/#/' /etc/lnd-gateway/env

sudo systemctl start lnd-gateway
curl -s http://127.0.0.1:7778/v1/health | jq .
```

### Nuclear rollback (drop v2 database)

```bash
sudo -u postgres psql -c "DROP DATABASE lqwdclaw_gateway;"
sudo -u postgres psql -c "DROP USER gateway_user;"
```

---

## Summary — What you'll have running after deploy

```
Internet
  │
  ├── Cloudflare Tunnel ──► api.lqwdclaw.bot
  │                              │
  │                    CF Access JWT validation
  │                              │
  ▼                              ▼
┌─────────────────────────────────────────────┐
│  lnd-gateway :7778                          │
│                                             │
│  /v1/*           → Bearer auth (agent/admin)│
│  /v1/l402/*      → L402 macaroon+preimage   │
│  /v1/internal/*  → CF Access + API key      │
│  /admin/*        → Session cookie + CSRF    │
│  /v1/internal/mcp → MCP Streamable HTTP     │
│                                             │
│  PostgreSQL ← agents, credits, channels     │
│  SQLite     ← audit, L402 tokens, idemp.    │
└──────────────┬──────────────────────────────┘
               │ gRPC
               ▼
             LND → bitcoind
```

| Component | Endpoint | Auth |
|-----------|----------|------|
| Admin Dashboard | `http://VM:7778/admin/` | username + password |
| Agent Registration | `POST /v1/internal/accounts/register` | CF Access |
| Credit Proxy | `POST /v1/internal/proxy/*` | CF Access + API key |
| Channel Status | `GET /v1/internal/channel/status` | CF Access + API key |
| MCP Tools | `/v1/internal/mcp` | CF Access |
| Node Ops (OpenClaw) | `POST /v1/*` | Bearer token |
| L402 Paid API | `GET /v1/l402/*` | Lightning payment |
