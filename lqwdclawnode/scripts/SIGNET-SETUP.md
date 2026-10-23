# Signet Test Environment — Copy & Paste Setup

Run a parallel signet stack on the existing VM alongside mainnet. Signet uses separate ports, data dirs, and systemd services. Mainnet is completely untouched.

**VM**: 71.19.249.198
**Disk**: ~500MB for signet chain + LND
**RAM**: ~300MB additional (bitcoind-signet + lnd-signet)
**Time**: ~15 minutes to full sync

---

## Step 1: Create signet data directories

```bash
sudo mkdir -p /bitcoin-signet /lnd-signet /var/lib/lnd-gateway-signet /etc/lnd-gateway-signet
sudo chown bitcoin:bitcoin /bitcoin-signet
sudo chown lnd:lnd /lnd-signet
sudo chown lndgateway:lndgateway /var/lib/lnd-gateway-signet
```

---

## Step 2: Configure Bitcoin Core for signet

```bash
sudo -u bitcoin tee /bitcoin-signet/bitcoin.conf << 'EOF'
# LQWDClaw Signet — Bitcoin Core Configuration
signet=1
server=1
datadir=/bitcoin-signet

# RPC (different port from mainnet 853)
rpcuser=lqwdclaw_signet
rpcpassword=REPLACE_WITH_RANDOM_PASSWORD
rpcbind=127.0.0.1
rpcport=38332
rpcallowip=127.0.0.1/32

# No pruning needed — signet is tiny (~500MB)
prune=0
txindex=0
blockfilterindex=0
disablewallet=1

# ZMQ (different ports from mainnet)
zmqpubrawblock=tcp://127.0.0.1:38088
zmqpubrawtx=tcp://127.0.0.1:39088

# Signet-specific
[signet]
addnode=seed.signet.bitcoin.sprovoost.nl
addnode=v7ajjeirttkbnt32wber33nxfi7iqez5vazi7p7xjikvk72bqbad5syd.onion:38333
EOF
```

Generate the RPC password:

```bash
RPC_PASS=$(openssl rand -hex 16)
sudo sed -i "s/REPLACE_WITH_RANDOM_PASSWORD/$RPC_PASS/" /bitcoin-signet/bitcoin.conf
echo "Signet RPC password: $RPC_PASS"
```

---

## Step 3: Create bitcoind-signet systemd service

```bash
sudo tee /etc/systemd/system/bitcoind-signet.service << 'EOF'
[Unit]
Description=Bitcoin Core (Signet)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bitcoin
Group=bitcoin
ExecStart=/usr/local/bin/bitcoind -datadir=/bitcoin-signet -conf=/bitcoin-signet/bitcoin.conf
ExecStop=/usr/local/bin/bitcoin-cli -datadir=/bitcoin-signet stop
Restart=on-failure
RestartSec=10
TimeoutStopSec=60

PrivateTmp=yes
ProtectSystem=full
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bitcoind-signet
```

---

## Step 4: Start bitcoind-signet and wait for sync

```bash
sudo systemctl start bitcoind-signet
```

Monitor sync progress (signet syncs in ~5-10 minutes):

```bash
watch -n 5 'bitcoin-cli -datadir=/bitcoin-signet -rpcport=38332 -rpcuser=lqwdclaw_signet -rpcpassword='"$RPC_PASS"' getblockchaininfo 2>/dev/null | jq "{chain, blocks, headers, verificationprogress}" 2>/dev/null || echo "Waiting for bitcoind-signet to start..."'
```

Wait until `verificationprogress` is > 0.9999 and `blocks` equals `headers`.

Press `Ctrl+C` when synced.

---

## Step 5: Configure LND for signet

```bash
sudo -u lnd tee /lnd-signet/lnd.conf << 'EOF'
[Application Options]
datadir=/lnd-signet/data
logdir=/lnd-signet/logs
debuglevel=info
maxpendingchannels=10
alias=LQWDClaw-Signet
tlscertpath=/lnd-signet/tls.cert
tlskeypath=/lnd-signet/tls.key
listen=0.0.0.0:9736
rpclisten=127.0.0.1:10010
restlisten=127.0.0.1:8081
color=#3399FF
minchansize=20000

[Bitcoin]
bitcoin.signet=1
bitcoin.node=bitcoind

[Bitcoind]
bitcoind.rpcuser=lqwdclaw_signet
bitcoind.rpcpass=REPLACE_SIGNET_RPC_PASS
bitcoind.zmqpubrawblock=tcp://127.0.0.1:38088
bitcoind.zmqpubrawtx=tcp://127.0.0.1:39088
bitcoind.rpchost=127.0.0.1:38332

[protocol]
protocol.wumbo-channels=true
protocol.option-scid-alias=true
protocol.zero-conf=true
EOF
```

Fill in the RPC password:

```bash
sudo sed -i "s/REPLACE_SIGNET_RPC_PASS/$RPC_PASS/" /lnd-signet/lnd.conf
```

---

## Step 6: Create lnd-signet systemd service

```bash
sudo tee /etc/systemd/system/lnd-signet.service << 'EOF'
[Unit]
Description=LND (Signet)
After=bitcoind-signet.service
Wants=bitcoind-signet.service

[Service]
Type=simple
User=lnd
Group=lnd
ExecStart=/usr/local/bin/lnd --lnddir=/lnd-signet
Restart=on-failure
RestartSec=10

PrivateTmp=yes
ProtectSystem=full
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable lnd-signet
```

---

## Step 7: Start LND-signet and create wallet

```bash
sudo systemctl start lnd-signet
sleep 5

# Create wallet (save the seed — but it's signet, so low stakes)
sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010 create
```

Enter a wallet password and save the seed phrase.

Verify LND is running:

```bash
sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010 getinfo | jq '{alias, synced_to_chain, synced_to_graph, identity_pubkey, block_height}'
```

**Expected**: `synced_to_chain: true`, alias `LQWDClaw-Signet`.

---

## Step 8: Generate signet macaroons for the gateway

```bash
SIGNET_MAC_DIR="/lnd-signet/data/chain/bitcoin/signet"

# Read-only
sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010 bakemacaroon \
  info:read offchain:read onchain:read peers:read \
  --save_to ${SIGNET_MAC_DIR}/readonly.macaroon

# Invoice
sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010 bakemacaroon \
  invoices:read invoices:write \
  --save_to ${SIGNET_MAC_DIR}/invoice.macaroon

# Channel admin
sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010 bakemacaroon \
  offchain:read offchain:write onchain:read \
  --save_to ${SIGNET_MAC_DIR}/channeladmin.macaroon

# Pay
sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010 bakemacaroon \
  offchain:read offchain:write \
  --save_to ${SIGNET_MAC_DIR}/pay.macaroon

# Permissions for gateway user
sudo chmod 640 ${SIGNET_MAC_DIR}/{readonly,invoice,channeladmin,pay}.macaroon
sudo chown lnd:lndgateway ${SIGNET_MAC_DIR}/{readonly,invoice,channeladmin,pay}.macaroon

# Grant traversal through directory chain
sudo chgrp lndgateway /lnd-signet /lnd-signet/data /lnd-signet/data/chain /lnd-signet/data/chain/bitcoin /lnd-signet/data/chain/bitcoin/signet
sudo chmod 750 /lnd-signet /lnd-signet/data /lnd-signet/data/chain /lnd-signet/data/chain/bitcoin /lnd-signet/data/chain/bitcoin/signet
```

---

## Step 9: Get signet coins

Generate a signet address:

```bash
sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010 newaddress p2wkh | jq -r '.address'
```

Get coins from a signet faucet (choose one):

- **https://signetfaucet.com** — paste your address, get coins
- **https://faucet.mutinynet.com** (if using mutinynet signet)
- **https://alt.signetfaucet.com**

Request at least **0.01 BTC** (1,000,000 sats) — enough for several channel opens.

Wait for confirmation (1 block, ~10 minutes on signet):

```bash
watch -n 10 'sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010 walletbalance | jq "{confirmed_balance, unconfirmed_balance}"'
```

Press `Ctrl+C` when `confirmed_balance` shows your coins.

---

## Step 10: Create signet PostgreSQL database

```bash
PG_SIGNET_PASS=$(openssl rand -base64 24)
echo "Signet DB password: $PG_SIGNET_PASS"

sudo -u postgres psql -c "CREATE DATABASE lqwdclaw_signet;"
sudo -u postgres psql -c "CREATE USER gateway_signet WITH PASSWORD '${PG_SIGNET_PASS}';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE lqwdclaw_signet TO gateway_signet;"
sudo -u postgres psql -d lqwdclaw_signet -c "GRANT ALL ON SCHEMA public TO gateway_signet;"
```

Verify:

```bash
psql "postgresql://gateway_signet:${PG_SIGNET_PASS}@127.0.0.1/lqwdclaw_signet?sslmode=disable" -c "SELECT 1 AS ok;"
```

---

## Step 11: Generate signet gateway secrets

```bash
SIGNET_AGENT_TOKEN=$(openssl rand -hex 32)
SIGNET_ADMIN_TOKEN=$(openssl rand -hex 32)
SIGNET_INTERNAL_SECRET=$(openssl rand -hex 32)
SIGNET_L402_KEY=$(openssl rand -hex 32)

# Admin dashboard password (use same as mainnet or different)
SIGNET_ADMIN_PASS="signet-test-123"
SIGNET_ADMIN_HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw(b'${SIGNET_ADMIN_PASS}', bcrypt.gensalt()).decode())")

echo ""
echo "=========================================="
echo "  SIGNET SECRETS (save these):"
echo ""
echo "  AGENT_TOKEN:      $SIGNET_AGENT_TOKEN"
echo "  ADMIN_TOKEN:      $SIGNET_ADMIN_TOKEN"
echo "  INTERNAL_SECRET:  $SIGNET_INTERNAL_SECRET"
echo "  L402_KEY:         $SIGNET_L402_KEY"
echo "  ADMIN_HASH:       $SIGNET_ADMIN_HASH"
echo "  DB_PASS:          $PG_SIGNET_PASS"
echo "=========================================="
```

---

## Step 12: Create signet gateway environment file

```bash
sudo tee /etc/lnd-gateway-signet/env << ENVEOF
# ─── LQWDClaw Signet Gateway ─────────────────────────────────────

# Listen on different port from mainnet (7778)
GATEWAY_LISTEN=127.0.0.1:7779

# Production mode (real signet LND)
GATEWAY_MOCK=false

# Auth tokens
GATEWAY_AGENT_TOKEN=${SIGNET_AGENT_TOKEN}
GATEWAY_ADMIN_TOKEN=${SIGNET_ADMIN_TOKEN}

# Signet LND connection
LND_GRPC_HOST=127.0.0.1:10010
LND_TLS_CERT_PATH=/lnd-signet/tls.cert
LND_MACAROON_DIR=/lnd-signet/data/chain/bitcoin/signet

# Budget limits (lower for signet testing)
MAX_CHANNEL_SIZE_SATS=500000
MAX_PAYMENT_SATS=100000
MAX_REBALANCE_FEE_SATS=1000
MAX_DAILY_SPEND_SATS=1000000
MAX_FEE_RATE_SAT_VB=50
CONFIRM_EXPIRY_SECONDS=300

# Data paths (separate from mainnet)
AUDIT_DB_PATH=/var/lib/lnd-gateway-signet/audit.db
AUDIT_FALLBACK_PATH=/var/lib/lnd-gateway-signet/audit-fallback.jsonl
KILL_SWITCH_PATH=/var/lib/lnd-gateway-signet/kill-switch

# L402 (enabled for testing)
L402_ENABLED=true
L402_SIGNING_KEY=${SIGNET_L402_KEY}
L402_DB_PATH=/var/lib/lnd-gateway-signet/l402.db

# ─── v2.0 Faucet Onboarding ─────────────────────────────────────

# Signet PostgreSQL
DATABASE_URL=postgresql://gateway_signet:${PG_SIGNET_PASS}@127.0.0.1/lqwdclaw_signet?sslmode=disable

# Internal auth
INTERNAL_AUTH_SECRET=${SIGNET_INTERNAL_SECRET}

# Faucet (smaller amounts for signet testing)
FAUCET_DAILY_CAP_SATS=100000
FAUCET_CHANNEL_SIZE_SATS=50000
FAUCET_PUSH_SATS=10000
FAUCET_CHANNEL_CAP=10

# Proxy
PROXY_PRICE_SATS=5
PROXY_UPSTREAM_TIMEOUT_SECS=30

# Admin dashboard
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=${SIGNET_ADMIN_HASH}

# MCP
MCP_BILLING_ENABLED=true
ENVEOF

sudo chmod 600 /etc/lnd-gateway-signet/env
sudo chown root:lndgateway /etc/lnd-gateway-signet/env
```

---

## Step 13: Build gateway binary (if not already latest)

```bash
cd /opt/lqwdclawnode/lnd-gateway
export PATH=$PATH:/usr/local/go/bin
git pull origin feature/l402-server
CGO_ENABLED=1 go build -o lnd-gateway ./cmd/lnd-gateway/
CGO_ENABLED=1 go test ./...
sudo cp lnd-gateway /usr/local/bin/lnd-gateway
```

The same binary serves both mainnet and signet — configuration determines which LND it connects to.

---

## Step 14: Create signet gateway systemd service

```bash
sudo tee /etc/systemd/system/lnd-gateway-signet.service << 'EOF'
[Unit]
Description=LND Gateway — Signet Test Environment
After=lnd-signet.service network-online.target
Wants=network-online.target
Requires=lnd-signet.service

[Service]
Type=simple
User=lndgateway
Group=lndgateway

ExecStart=/usr/local/bin/lnd-gateway
EnvironmentFile=/etc/lnd-gateway-signet/env

NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

ReadWritePaths=/var/lib/lnd-gateway-signet
ReadOnlyPaths=/etc/lnd-gateway-signet /lnd-signet

Restart=on-failure
RestartSec=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=lnd-gateway-signet

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable lnd-gateway-signet
```

---

## Step 15: Start the signet gateway

```bash
sudo systemctl start lnd-gateway-signet
sleep 3
sudo systemctl status lnd-gateway-signet --no-pager -l
```

**Expected logs:**
- `lnd-gateway starting` on `127.0.0.1:7779`
- `connected to LND` on `127.0.0.1:10010`
- `account store: PostgreSQL`
- `channel faucet enabled` with signet amounts
- `admin dashboard enabled`

---

## Step 16: Verify signet gateway

```bash
echo "=== Health ==="
curl -s http://127.0.0.1:7779/v1/health | jq .

echo "=== Node Info ==="
curl -s -H "Authorization: Bearer ${SIGNET_AGENT_TOKEN}" \
  -X POST http://127.0.0.1:7779/v1/info -d '{}' | jq '{alias: .data.alias, chain: .data.chains, synced: .data.synced_to_chain}'

echo "=== Wallet Balance ==="
curl -s -H "Authorization: Bearer ${SIGNET_AGENT_TOKEN}" \
  -X POST http://127.0.0.1:7779/v1/wallet/balance -d '{}' | jq '.data'

echo "=== Admin Dashboard ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:7779/admin/
```

---

## Step 17: Test the full agent lifecycle on signet

```bash
AUTH="X-Internal-Auth: ${SIGNET_INTERNAL_SECRET}"
```

### 17a: Register an agent (credit proxy only)

```bash
RESULT=$(curl -s -X POST http://127.0.0.1:7779/v1/internal/accounts/register \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d '{"name": "signet-test-agent"}')
echo "$RESULT" | jq .
TEST_KEY=$(echo "$RESULT" | jq -r '.data.api_key')
KEY="Authorization: Bearer ${TEST_KEY}"
```

### 17b: Check profile and balance

```bash
curl -s http://127.0.0.1:7779/v1/internal/accounts/me -H "$KEY" -H "$AUTH" | jq '.data | {name, balance_sats, tier}'
```

### 17c: Use credit proxy

```bash
curl -s -X POST http://127.0.0.1:7779/v1/internal/proxy/node-stats \
  -H "$KEY" -H "$AUTH" \
  -H "X-Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')" | jq '.data'
```

### 17d: Check balance after proxy call

```bash
curl -s http://127.0.0.1:7779/v1/internal/accounts/me -H "$KEY" -H "$AUTH" | jq '.data.balance_sats'
```

**Expected**: 145 (150 - 5 sats proxy cost)

---

## Step 18: Test channel faucet with a real signet channel

You need a second signet LND node to open a channel to. Options:

**Option A: Use a public signet node**

Find signet nodes at https://mempool.space/signet/lightning or use a known signet node:

```bash
# Example: connect to a public signet node (replace with a real one)
PEER_PUBKEY="03..."
PEER_URI="${PEER_PUBKEY}@<host>:9736"

# Register with channel faucet
RESULT=$(curl -s -X POST http://127.0.0.1:7779/v1/internal/accounts/register \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"name\": \"signet-node-test\", \"pubkey\": \"${PEER_PUBKEY}\", \"node_uri\": \"${PEER_URI}\"}")
echo "$RESULT" | jq .
CHAN_KEY=$(echo "$RESULT" | jq -r '.data.api_key')
```

**Option B: Run a second local LND on signet (different ports)**

```bash
# Quick second LND for testing (port 10011, P2P 9737)
sudo mkdir -p /lnd-signet-peer
sudo chown lnd:lnd /lnd-signet-peer

sudo -u lnd tee /lnd-signet-peer/lnd.conf << 'EOF'
[Application Options]
datadir=/lnd-signet-peer/data
logdir=/lnd-signet-peer/logs
alias=LQWDClaw-Signet-Peer
tlscertpath=/lnd-signet-peer/tls.cert
tlskeypath=/lnd-signet-peer/tls.key
listen=127.0.0.1:9737
rpclisten=127.0.0.1:10011
restlisten=127.0.0.1:8082

[Bitcoin]
bitcoin.signet=1
bitcoin.node=bitcoind

[Bitcoind]
bitcoind.rpcuser=lqwdclaw_signet
bitcoind.rpcpass=FILL_IN_RPC_PASS
bitcoind.zmqpubrawblock=tcp://127.0.0.1:38088
bitcoind.zmqpubrawtx=tcp://127.0.0.1:39088
bitcoind.rpchost=127.0.0.1:38332
EOF
```

Start, create wallet, get pubkey:

```bash
sudo -u lnd lnd --lnddir=/lnd-signet-peer &
sleep 5
sudo -u lnd lncli --lnddir=/lnd-signet-peer --rpcserver=127.0.0.1:10011 create
PEER_PUBKEY=$(sudo -u lnd lncli --lnddir=/lnd-signet-peer --rpcserver=127.0.0.1:10011 getinfo | jq -r '.identity_pubkey')
echo "Peer pubkey: $PEER_PUBKEY"
```

Register with faucet:

```bash
RESULT=$(curl -s -X POST http://127.0.0.1:7779/v1/internal/accounts/register \
  -H "Content-Type: application/json" -H "$AUTH" \
  -d "{\"name\": \"signet-faucet-test\", \"pubkey\": \"${PEER_PUBKEY}\", \"node_uri\": \"${PEER_PUBKEY}@127.0.0.1:9737\"}")
echo "$RESULT" | jq .
CHAN_KEY=$(echo "$RESULT" | jq -r '.data.api_key')
```

### 18b: Poll channel status

```bash
watch -n 10 'curl -s http://127.0.0.1:7779/v1/internal/channel/status -H "Authorization: Bearer '"$CHAN_KEY"'" -H "X-Internal-Auth: '"$SIGNET_INTERNAL_SECRET"'" | jq ".data | {status, funding_txid, confirmations}"'
```

Wait for `status: "open"` (3 confirmations, ~30 minutes on signet).

### 18c: Verify the channel on the peer side

```bash
sudo -u lnd lncli --lnddir=/lnd-signet-peer --rpcserver=127.0.0.1:10011 listchannels | jq '.channels[] | {remote_pubkey, capacity, local_balance, remote_balance}'
```

**Expected**: Channel with 50,000 sats capacity, 10,000 sats on the peer's local balance (the pushed amount).

---

## Step 19: Test admin dashboard (from your laptop)

```bash
ssh -L 7779:127.0.0.1:7779 youradminuser@71.19.249.198
```

Open in browser: **http://localhost:7779/admin/**

Login: `admin` / `signet-test-123`

You should see:
- Test agents with balances
- Channel grants (pending or open)
- Credit transactions

---

## Step 20: Verify all signet services

```bash
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  LQWDClaw Signet Environment Verification   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

PASS=0; FAIL=0
check() {
  if [ "$1" -eq 0 ]; then echo "  ✓ $2"; PASS=$((PASS+1))
  else echo "  ✗ $2"; FAIL=$((FAIL+1)); fi
}

echo "── Services ──"
sudo systemctl is-active --quiet bitcoind-signet; check $? "bitcoind-signet"
sudo systemctl is-active --quiet lnd-signet; check $? "lnd-signet"
sudo systemctl is-active --quiet lnd-gateway-signet; check $? "lnd-gateway-signet"

echo ""
echo "── Endpoints ──"
H=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7779/v1/health)
[ "$H" = "200" ]; check $? "GET /v1/health → $H"

H=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7779/admin/)
[ "$H" = "200" ]; check $? "GET /admin/ → $H"

echo ""
echo "── Mainnet (untouched) ──"
sudo systemctl is-active --quiet lnd-gateway; check $? "mainnet gateway still running"
H=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/v1/health)
[ "$H" = "200" ]; check $? "mainnet health → $H"

echo ""
echo "════════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "════════════════════════════════════════"
[ "$FAIL" -eq 0 ] && echo "  ✓ SIGNET ENVIRONMENT READY" || echo "  ⚠ FIX FAILURES ABOVE"
```

---

## Quick Reference — Port Map

| Service | Mainnet | Signet |
|---------|---------|--------|
| bitcoind RPC | 853 | 38332 |
| bitcoind ZMQ block | 28088 | 38088 |
| bitcoind ZMQ tx | 29088 | 39088 |
| LND gRPC | 10009 | 10010 |
| LND P2P | 9735 | 9736 |
| LND REST | 8080 | 8081 |
| Gateway HTTP | 7778 | 7779 |

## Quick Reference — Signet Data Locations

| Data | Path |
|------|------|
| Bitcoin signet chain | `/bitcoin-signet/` |
| LND signet data | `/lnd-signet/` |
| Gateway signet data | `/var/lib/lnd-gateway-signet/` |
| Gateway signet env | `/etc/lnd-gateway-signet/env` |
| Signet macaroons | `/lnd-signet/data/chain/bitcoin/signet/` |
| Signet database | PostgreSQL `lqwdclaw_signet` |

## Quick Reference — Signet lncli

```bash
# Alias for convenience
alias lncli-signet='sudo -u lnd lncli --lnddir=/lnd-signet --rpcserver=127.0.0.1:10010'

# Usage
lncli-signet getinfo
lncli-signet walletbalance
lncli-signet listchannels
lncli-signet newaddress p2wkh
```

## Teardown (when done testing)

```bash
sudo systemctl stop lnd-gateway-signet lnd-signet bitcoind-signet
sudo systemctl disable lnd-gateway-signet lnd-signet bitcoind-signet
sudo rm /etc/systemd/system/{bitcoind-signet,lnd-signet,lnd-gateway-signet}.service
sudo systemctl daemon-reload

# Optional: remove data (irreversible)
sudo rm -rf /bitcoin-signet /lnd-signet /var/lib/lnd-gateway-signet /etc/lnd-gateway-signet
sudo -u postgres psql -c "DROP DATABASE lqwdclaw_signet;"
sudo -u postgres psql -c "DROP USER gateway_signet;"
```
