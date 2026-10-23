# LQWDClaw-NodeOps — VM Setup & Installation Guide

> **Internal operator guide — v1 scope notice**
>
> This guide describes full-system capabilities including subsystems (L402 pay-per-call, credit proxy, paid MCP data tools, tier upgrade paths) that remain present in code but are **not part of LQWDClaw's v1 publicly advertised surface**. LQWDClaw offers the free channel faucet only at this time; paid liquidity is a later version. These subsystems are documented here for operator use and future re-activation.

Step-by-step guide for provisioning the OneProvider dedicated server and installing
Bitcoin Core, LND, lnd-gateway, and OpenClaw.

**Target VM**: OneProvider — Vancouver, CA
**Hardware**: Ryzen 5 3600X (6c/12t), 32 GB DDR4, 512 GB NVMe
**OS**: Ubuntu 22.04 LTS

---

## Table of Contents

1. [Initial Server Access & OS Hardening](#1-initial-server-access--os-hardening)
2. [Create System Users](#2-create-system-users)
3. [Install Dependencies](#3-install-dependencies)
4. [Install Bitcoin Core](#4-install-bitcoin-core)
5. [Configure Bitcoin Core](#5-configure-bitcoin-core)
6. [Start Bitcoin Core & Begin IBD](#6-start-bitcoin-core--begin-ibd)
7. [Install LND](#7-install-lnd)
8. [Install & Configure Tor (Hybrid Mode)](#8-install--configure-tor-hybrid-mode)
9. [Configure LND](#9-configure-lnd)
10. [Install Go & Build lnd-gateway](#10-install-go--build-lnd-gateway)
11. [Deploy lnd-gateway](#11-deploy-lnd-gateway)
12. [Generate Scoped Macaroons](#12-generate-scoped-macaroons)
13. [Configure lnd-gateway Environment](#13-configure-lnd-gateway-environment)
14. [Install SCB Backup Service](#14-install-scb-backup-service)
15. [Install OpenClaw](#15-install-openclaw)
16. [Configure OpenClaw Workspace](#16-configure-openclaw-workspace)
17. [AppArmor Security Profiles](#17-apparmor-security-profiles)
18. [Start Everything & Verify](#18-start-everything--verify)
19. [Post-Install Smoke Test](#19-post-install-smoke-test)
20. [Firewall Rules](#20-firewall-rules)
21. [Monitoring & Maintenance](#21-monitoring--maintenance)
22. [PostgreSQL for Gateway Account System](#22-postgresql-for-gateway-account-system)
23. [Cloudflare Tunnel + Origin Validation](#23-cloudflare-tunnel--origin-validation)
24. [Admin Dashboard Configuration](#24-admin-dashboard-configuration)
25. [MCP Server Configuration](#25-mcp-server-configuration)
26. [Agent Registration — Channel Faucet Setup](#26-agent-registration--channel-faucet-setup)

---

## 1. Initial Server Access & OS Hardening

```bash
# SSH in as root (initial access from OneProvider)
ssh root@YOUR_VM_IP

# Update system
apt update && apt upgrade -y

# Set hostname
hostnamectl set-hostname lqwdclaw-nodeops

# Set timezone
timedatectl set-timezone America/Vancouver

# Install essential packages
apt install -y \
  ufw fail2ban curl wget git jq unzip uuid-runtime \
  gcc build-essential pkg-config libsqlite3-dev \
  inotify-tools age \
  apparmor apparmor-utils

# Configure SSH hardening
# Edit /etc/ssh/sshd_config:
#   PermitRootLogin no          (after creating your admin user)
#   PasswordAuthentication no   (after adding SSH keys)
#   MaxAuthTries 3
#   AllowUsers youradminuser
systemctl restart sshd

# Create your admin user (replace with your username)
adduser youradminuser
usermod -aG sudo youradminuser

# Copy SSH keys to admin user
mkdir -p /home/youradminuser/.ssh
cp ~/.ssh/authorized_keys /home/youradminuser/.ssh/
chown -R youradminuser:youradminuser /home/youradminuser/.ssh
chmod 700 /home/youradminuser/.ssh
chmod 600 /home/youradminuser/.ssh/authorized_keys
```

**From this point on, SSH as your admin user and use `sudo`.**

---

## 2. Create System Users

Four isolated system users with no login shells:

```bash
# Bitcoin Core (data at /bitcoin — create dir if needed)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin bitcoin
sudo mkdir -p /bitcoin && sudo chown bitcoin:bitcoin /bitcoin

# LND (data at /lnd — create dir if needed)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin lnd
sudo mkdir -p /lnd && sudo chown lnd:lnd /lnd
sudo usermod -aG bitcoin lnd  # LND needs to read bitcoin cookie

# lnd-gateway
sudo useradd --system --no-create-home --shell /usr/sbin/nologin lndgateway

# OpenClaw
sudo useradd --system --create-home --home-dir /home/openclaw --shell /bin/bash openclaw
```

---

## 3. Install Dependencies

```bash
# Node.js 22 (for OpenClaw)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version   # v22.x.x
npm --version
```

> **Note**: `gcc`, `build-essential`, and `libsqlite3-dev` (needed for gateway CGO/SQLite builds)
> were already installed in Step 1's essential packages.

---

## 4. Install Bitcoin Core

```bash
# Download Bitcoin Core v30.2
BITCOIN_VERSION="30.2"
cd /tmp
wget "https://bitcoin.org/bin/bitcoin-core-${BITCOIN_VERSION}/bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz"
wget "https://bitcoin.org/bin/bitcoin-core-${BITCOIN_VERSION}/SHA256SUMS"
wget "https://bitcoin.org/bin/bitcoin-core-${BITCOIN_VERSION}/SHA256SUMS.asc"

# Verify checksums
sha256sum --check SHA256SUMS --ignore-missing

# Install
tar xzf bitcoin-${BITCOIN_VERSION}-x86_64-linux-gnu.tar.gz
sudo install -m 0755 bitcoin-${BITCOIN_VERSION}/bin/* /usr/local/bin/

# Verify
bitcoind --version
```

---

## 5. Configure Bitcoin Core

```bash
# Data directory at /bitcoin (binaries at /bitcoin/bitcoin-30.2/bin/)
# Ensure ownership
sudo chown -R bitcoin:bitcoin /bitcoin

# Create or verify config at /bitcoin/bitcoin.conf
# Key settings that must be present:
sudo -u bitcoin tee /bitcoin/bitcoin.conf << 'EOF'
# LQWDClaw-NodeOps — Bitcoin Core Configuration
server=1
debug=rpc
datadir=/bitcoin

# RPC (LND connects here — note non-standard port 853)
rpcuser=lqwd_btcd_user_for_2023
rpcpassword=CHANGE_ME_GENERATE_RANDOM_PASSWORD
rpcconnect=127.0.0.1
rpcallowip=127.0.0.1/32
rpcbind=127.0.0.1
rpcport=853

# Pruning — ~50 GB
prune=51200

# Wallet disabled (LND manages wallet)
disablewallet=1
txindex=0
blockfilterindex=0

# ZMQ (LND needs these — note non-standard ports)
zmqpubrawblock=tcp://127.0.0.1:28088
zmqpubrawtx=tcp://127.0.0.1:29088

# Performance
bind=0.0.0.0:8333
maxconnections=30
maxmempool=300
dbcache=3000
mempoolexpiry=24
EOF

# Generate a real RPC password
RPCPASS=$(openssl rand -hex 24)
sudo -u bitcoin sed -i "s/CHANGE_ME_GENERATE_RANDOM_PASSWORD/$RPCPASS/" /bitcoin/bitcoin.conf
echo "RPC Password: $RPCPASS"
echo "Save this — you'll need it for LND config"
```

Create systemd service:

```bash
sudo tee /etc/systemd/system/bitcoind.service << 'EOF'
[Unit]
Description=Bitcoin Core Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=bitcoin
Group=bitcoin
ExecStart=/bitcoin/bitcoin-30.2/bin/bitcoind -conf=/bitcoin/bitcoin.conf -datadir=/bitcoin
ExecStop=/bitcoin/bitcoin-30.2/bin/bitcoin-cli -datadir=/bitcoin stop
Restart=on-failure
RestartSec=30
TimeoutStopSec=300

# Security
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/bitcoin
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bitcoind
```

---

## 6. Start Bitcoin Core & Begin IBD

```bash
sudo systemctl start bitcoind

# Monitor IBD progress (this takes 1-3 days on NVMe)
sudo -u bitcoin /bitcoin/bitcoin-30.2/bin/bitcoin-cli -datadir=/bitcoin -getinfo

# Watch sync progress (0.0 to 1.0)
watch -n 30 'sudo -u bitcoin /bitcoin/bitcoin-30.2/bin/bitcoin-cli -datadir=/bitcoin getblockchaininfo | jq "{blocks, headers, verificationprogress, pruned, size_on_disk}"'
```

**While IBD is running (1-3 days), continue with steps 7-16 to prepare everything else.**

---

## 7. Install LND

```bash
LND_VERSION="v0.20.1-beta"
cd /tmp

# Download
wget "https://github.com/lightningnetwork/lnd/releases/download/${LND_VERSION}/lnd-linux-amd64-${LND_VERSION}.tar.gz"
wget "https://github.com/lightningnetwork/lnd/releases/download/${LND_VERSION}/manifest-${LND_VERSION}.txt"
wget "https://github.com/lightningnetwork/lnd/releases/download/${LND_VERSION}/manifest-${LND_VERSION}.sig"

# Verify (import LND team keys first: https://docs.lightning.engineering/lightning-network-tools/lnd/verify-lnd-binaries)
sha256sum --check manifest-${LND_VERSION}.txt --ignore-missing

# Install
tar xzf lnd-linux-amd64-${LND_VERSION}.tar.gz
sudo install -m 0755 lnd-linux-amd64-${LND_VERSION}/lnd /usr/local/bin/
sudo install -m 0755 lnd-linux-amd64-${LND_VERSION}/lncli /usr/local/bin/

# Verify
lnd --version
```

---

## 8. Install & Configure Tor (Hybrid Mode)

LND runs in **hybrid mode**: reachable via both clearnet (IPv4) and Tor (.onion).
This gives maximum connectivity — clearnet peers get low-latency direct connections,
while Tor-only peers can still reach the node via its v3 onion address.

> **WARNING**: Hybrid mode exposes the server's real IP address to clearnet peers.
> This is acceptable for a corporate node (LQWD Technologies) where the VM IP is
> already known. For anonymous nodes, use Tor-only mode instead.

### Install Tor

```bash
sudo apt install -y tor

# Verify
tor --version
# Must be >= 0.3.3.6 for v3 onion services
```

### Generate Hashed Control Password

LND needs to authenticate to Tor's control port to create onion services automatically.
We use `HashedControlPassword` (stateless, no cookie file permission issues).

```bash
# Choose a strong password (or generate one)
TOR_CONTROL_PASSWORD=$(openssl rand -hex 16)
echo "Tor Control Password: $TOR_CONTROL_PASSWORD"
echo "SAVE THIS — you will need it for lnd.conf"

# Generate the hash
TOR_HASHED=$(tor --hash-password "$TOR_CONTROL_PASSWORD")
echo "Hashed: $TOR_HASHED"
```

### Configure torrc

```bash
sudo tee /etc/tor/torrc << EOF
# LQWDClaw-NodeOps Tor Configuration

# SOCKS proxy (LND routes Tor-destined traffic through this)
SOCKSPort 9050

# Control port (LND uses this to create onion services)
ControlPort 9051

# Authentication via hashed password (generated above)
HashedControlPassword $TOR_HASHED

# Logging
Log notice file /var/log/tor/notices.log
EOF
```

### Create Tor systemd override (ensure it starts before LND)

```bash
# Restart Tor with new config
sudo systemctl restart tor
sudo systemctl enable tor

# Verify Tor is running and ports are listening
sudo systemctl status tor
ss -tlnp | grep -E '905[01]'
# Should show 127.0.0.1:9050 (SOCKS) and 127.0.0.1:9051 (Control)
```

### Verify Tor connectivity

```bash
# Test SOCKS proxy
curl --socks5 127.0.0.1:9050 https://check.torproject.org/api/ip
# Should return {"IsTor": true, ...}
```

### Add LND user to debian-tor group (for cookie fallback)

```bash
sudo usermod -aG debian-tor lnd
```

---

## 9. Configure LND

```bash
# LND data directory should already exist
sudo chown lnd:lnd /lnd

# Install PostgreSQL 18 for LND database backend
sudo apt install -y postgresql-18
sudo -u postgres psql -c "CREATE DATABASE lqwdclaw;"
# Using default postgres user (single-purpose VM, LQWDClaw has full control)

# LND config is written manually — see the reference config below.
# Key values to fill in: bitcoind.rpcpass, tor.password
sudo -u lnd tee /lnd/lnd.conf << 'EOF'
[Application Options]
datadir=/lnd/data
logdir=/lnd/logs
debuglevel=info
maxpendingchannels=10
externalip=71.19.249.198
alias=LQWD-AI-Launchpad
tlscertpath=/lnd/tls.cert
tlskeypath=/lnd/tls.key
tlsextraip=71.19.249.198
listen=0.0.0.0:9735
rpclisten=127.0.0.1:10009
restlisten=127.0.0.1:8080
numgraphsyncpeers=3
color=#3399FF
minchansize=20000
maxchansize=500000000
acceptortimeout=2m0s
connectiontimeout=5m0s
fee.url=https://mempool.space/api/v1/fees/recommended
num-restricted-slots=1000

[postgres]
db.postgres.dsn=postgresql://postgres:REPLACE_PG_PASSWORD@127.0.0.1/lqwdclaw?sslmode=disable
db.postgres.maxconnections=50
db.postgres.timeout=0

[db]
db.backend=postgres

[Bitcoin]
bitcoin.mainnet=1
bitcoin.node=bitcoind
bitcoin.defaultchanconfs=3

[Bitcoind]
bitcoind.rpcuser=lqwdclaw
bitcoind.rpcpass=REPLACE_WITH_RPC_PASSWORD
bitcoind.zmqpubrawblock=tcp://127.0.0.1:28088
bitcoind.zmqpubrawtx=tcp://127.0.0.1:29088
bitcoind.rpchost=127.0.0.1:853
bitcoind.estimatemode=ECONOMICAL

[autopilot]
autopilot.active=false

[routerrpc]
routerrpc.minrtprob=0.01
routerrpc.apriori.hopprob=0.6
routerrpc.apriori.weight=0.5
routerrpc.apriori.penaltyhalflife=1h
routerrpc.attemptcost=100

[tor]
tor.active=1
tor.v3=1
tor.password=REPLACE_TOR_PASSWORD
tor.skip-proxy-for-clearnet-targets=true
tor.streamisolation=false

[protocol]
protocol.wumbo-channels=true
protocol.option-scid-alias=true
protocol.zero-conf=true

[rpcmiddleware]
rpcmiddleware.enable=true
rpcmiddleware.intercepttimeout=5m0s

[routing]
routing.strictgraphpruning=true

[sweeper]
sweeper.maxfeerate=100
sweeper.budget.tolocalratio=0.05
sweeper.budget.deadlinehtlcratio=0.05
sweeper.budget.nodeadlinehtlcratio=0.05
sweeper.budget.anchorcpfpratio=0.05

[gossip]
gossip.msg-rate-bytes=1024000
gossip.msg-burst-bytes=2048000

[logging]
logging.file.max-files=125
logging.file.max-file-size=100
EOF

# Replace passwords
sudo -u lnd sed -i "s/REPLACE_WITH_RPC_PASSWORD/$RPCPASS/" /lnd/lnd.conf
sudo -u lnd sed -i "s/REPLACE_TOR_PASSWORD/$TOR_CONTROL_PASSWORD/" /lnd/lnd.conf
sudo -u lnd sed -i "s/REPLACE_PG_PASSWORD/$PG_PASSWORD/" /lnd/lnd.conf
```

### What hybrid mode does

After LND starts with this config, it will:

1. **Create a v3 onion hidden service** automatically via the Tor control port
2. **Advertise both addresses** to the Lightning network:
   - Clearnet: `YOUR_IP:9735`
   - Tor: `xxxxx...xxxxx.onion:9735`
3. **Route outbound connections intelligently**:
   - To `.onion` peers: traffic goes through Tor SOCKS proxy
   - To clearnet peers: traffic goes directly (lower latency)
4. **Accept inbound connections** on both clearnet and Tor

Your node's onion address will be generated on first start and stored at:
`/lnd/v3_onion_private_key` (auto-generated on first start)

You can find your onion address after starting LND:
```bash
sudo -u lnd lncli --lnddir=/lnd getinfo | jq '.uris'
# Will show both clearnet and .onion URIs
```

Create systemd service:

```bash
sudo tee /etc/systemd/system/lnd.service << 'EOF'
[Unit]
Description=LND Lightning Network Daemon
After=bitcoind.service tor.service postgresql.service
Requires=bitcoind.service
Wants=tor.service postgresql.service

[Service]
Type=simple
User=lnd
Group=lnd
ExecStart=/usr/local/bin/lnd --lnddir=/lnd
Restart=on-failure
RestartSec=30
TimeoutStopSec=120

# Security
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/lnd
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable lnd
```

**Do NOT start LND yet — wait for Bitcoin Core IBD to complete (step 6).**

---

## 10. Install Go & Build lnd-gateway

```bash
# Install Go 1.22+
GO_VERSION="1.22.5"
cd /tmp
wget "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz

# Add to PATH (add to /etc/profile.d/ for all users)
sudo tee /etc/profile.d/golang.sh << 'EOF'
export PATH=$PATH:/usr/local/go/bin
EOF
source /etc/profile.d/golang.sh

# Verify
go version
```

### Clone the repo

If the repo is private, set up an SSH deploy key first:

```bash
# Generate deploy key (as your admin user, NOT root)
ssh-keygen -t ed25519 -C "lqwdclawnode-deploy" -f ~/.ssh/lqwdclawnode-deploy -N ""

# Show public key — add this as a Deploy Key in GitHub repo settings
cat ~/.ssh/lqwdclawnode-deploy.pub

# Configure SSH to use this key for GitHub
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/lqwdclawnode-deploy
  IdentitiesOnly yes
EOF
```

```bash
# Clone (as your admin user, then move to /opt)
cd ~
git clone git@github.com:lqwdtech/lqwdclawnode.git
sudo mv lqwdclawnode /opt/
sudo chown -R lndgateway:lndgateway /opt/lqwdclawnode
```

> **Note**: Do NOT use `sudo git clone` — sudo resets SSH agent and won't find
> your deploy key. Clone as your user first, then `sudo mv`.

### Build the gateway

```bash
cd /opt/lqwdclawnode/lnd-gateway

# Ensure Go and gcc are in PATH (sudo resets PATH)
export PATH=$PATH:/usr/local/go/bin

# Build (CGO required for SQLite — needs gcc/build-essential)
CGO_ENABLED=1 go build -o lnd-gateway ./cmd/lnd-gateway/

# Run tests
CGO_ENABLED=1 go test ./...

# Install binary
sudo cp lnd-gateway /usr/local/bin/lnd-gateway
```

> **Note**: Build as your admin user (not via `sudo -u lndgateway`) to avoid Go
> module cache permission issues. The binary is copied to `/usr/local/bin/`.

---

## 11. Deploy lnd-gateway

```bash
cd /opt/lqwdclawnode

# First-run setup (creates dirs, installs systemd service, copies env template)
sudo ./scripts/deploy-gateway.sh --first-run
```

> **Note**: The deploy script's build step may fail because `sudo` resets PATH
> and can't find `go`. This is expected — we already built and installed the
> binary in step 10. If it fails at the build step, manually set up the pieces:

```bash
# Manual fallback if deploy-gateway.sh fails at build step:
sudo mkdir -p /var/lib/lnd-gateway /etc/lnd-gateway
sudo cp /opt/lqwdclawnode/scripts/env.example /etc/lnd-gateway/env
sudo cp /opt/lqwdclawnode/scripts/lnd-gateway.service /etc/systemd/system/
sudo chown -R lndgateway:lndgateway /var/lib/lnd-gateway
sudo systemctl daemon-reload
sudo systemctl enable lnd-gateway
```

This creates:
- `/var/lib/lnd-gateway/` — data directory (audit DB, idempotency DB, SCB backups)
- `/etc/lnd-gateway/env` — environment config (copied from template)
- systemd service installed and enabled

---

## 12. Generate Scoped Macaroons

**Wait for LND to be running (after IBD completes and LND is started).**

```bash
# Create wallet first (LND must be running)
sudo -u lnd lncli --lnddir=/lnd create
# SAVE THE SEED PHRASE OFFLINE — DO NOT STORE ON THE VM

# Generate scoped macaroons (NEVER use admin.macaroon for the gateway)
MACAROON_DIR="/lnd/data/chain/bitcoin/mainnet"

# Read-only macaroon (getinfo, listchannels, walletbalance, etc.)
sudo -u lnd lncli --lnddir=/lnd bakemacaroon \
  info:read offchain:read onchain:read peers:read \
  --save_to ${MACAROON_DIR}/readonly.macaroon

# Invoice macaroon (create + lookup invoices)
sudo -u lnd lncli --lnddir=/lnd bakemacaroon \
  invoices:read invoices:write \
  --save_to ${MACAROON_DIR}/invoice.macaroon

# Channel admin macaroon (open, close, update fees)
sudo -u lnd lncli --lnddir=/lnd bakemacaroon \
  offchain:read offchain:write onchain:read \
  --save_to ${MACAROON_DIR}/channeladmin.macaroon

# Pay macaroon (send payments, route)
sudo -u lnd lncli --lnddir=/lnd bakemacaroon \
  offchain:read offchain:write \
  --save_to ${MACAROON_DIR}/pay.macaroon

# Set permissions — gateway user can read macaroons
sudo chmod 640 ${MACAROON_DIR}/{readonly,invoice,channeladmin,pay}.macaroon
sudo chown lnd:lndgateway ${MACAROON_DIR}/{readonly,invoice,channeladmin,pay}.macaroon

# Grant lndgateway group traversal through /lnd directory chain
# Without this, the gateway can't reach macaroons even with correct file ownership
sudo chgrp lndgateway /lnd /lnd/data /lnd/data/chain /lnd/data/chain/bitcoin /lnd/data/chain/bitcoin/mainnet
sudo chmod 750 /lnd /lnd/data /lnd/data/chain /lnd/data/chain/bitcoin /lnd/data/chain/bitcoin/mainnet
```

---

## 13. Configure lnd-gateway Environment

```bash
# Generate tokens
AGENT_TOKEN=$(openssl rand -hex 32)
ADMIN_TOKEN=$(openssl rand -hex 32)

echo "Agent Token: $AGENT_TOKEN"
echo "Admin Token: $ADMIN_TOKEN"
echo "SAVE BOTH TOKENS — you will need the admin token for confirmations"

# Edit the environment file
sudo nano /etc/lnd-gateway/env
```

Set these values in `/etc/lnd-gateway/env`:

```bash
GATEWAY_LISTEN=127.0.0.1:7778
GATEWAY_MOCK=true
# ^^^ Start in MOCK mode during IBD — switch to false in Step 18 when LND is ready
GATEWAY_AGENT_TOKEN=<paste agent token>
GATEWAY_ADMIN_TOKEN=<paste admin token>

LND_GRPC_HOST=127.0.0.1:10009
LND_TLS_CERT_PATH=/lnd/tls.cert
LND_MACAROON_DIR=/lnd/data/chain/bitcoin/mainnet

MAX_CHANNEL_SIZE_SATS=5000000
MAX_PAYMENT_SATS=1000000
MAX_REBALANCE_FEE_SATS=10000
MAX_DAILY_SPEND_SATS=10000000
MAX_FEE_RATE_SAT_VB=100

AUDIT_DB_PATH=/var/lib/lnd-gateway/audit.db
AUDIT_FALLBACK_PATH=/var/lib/lnd-gateway/audit-fallback.jsonl
KILL_SWITCH_PATH=/var/lib/lnd-gateway/kill-switch

RATE_LIMIT_READ=60
RATE_LIMIT_WRITE=10
CONFIRM_EXPIRY_SECONDS=300
```

```bash
# Store agent token for OpenClaw to read
sudo mkdir -p /etc/lnd-gateway
echo "$AGENT_TOKEN" | sudo tee /etc/lnd-gateway/agent-token > /dev/null
sudo chmod 640 /etc/lnd-gateway/agent-token
sudo chown root:openclaw /etc/lnd-gateway/agent-token

# Lock down env file
sudo chmod 600 /etc/lnd-gateway/env
sudo chown root:lndgateway /etc/lnd-gateway/env

# Grant gateway read access to LND TLS cert
sudo chmod 644 /lnd/tls.cert
```

---

## L402 Pay-Per-Call Configuration

L402 enables pay-per-call API endpoints where external consumers pay Lightning invoices to access node data. This is separate from the Bearer token auth used by OpenClaw.

### How L402 Works

1. Client requests a paid endpoint (e.g., `GET /v1/l402/node-stats`) without auth
2. Gateway returns HTTP 402 with a macaroon (auth token) and Lightning invoice
3. Client pays the invoice on the Lightning Network
4. Client retries the request with `Authorization: L402 <macaroon>:<preimage>`
5. Gateway verifies payment and returns the data
6. Token is consumed (single-use) — replay attempts are rejected

### Prerequisites

- LND node must be funded with channels for real L402 payments
- In mock mode (`GATEWAY_MOCK=true`), invoices are simulated — no real payments needed

### Environment Variables

Edit `/etc/lnd-gateway/env`:

```bash
# Enable L402 endpoints
L402_ENABLED=true

# Generate signing key (required in production, not needed in mock mode):
#   openssl rand -hex 32
L402_SIGNING_KEY=<64-character-hex-string>

# Token store database (absolute path required under systemd)
L402_DB_PATH=/var/lib/lnd-gateway/l402.db

# Optional tuning:
# L402_TOKEN_EXPIRY=86400        # Token lifetime (seconds, default 24h)
# L402_INVOICE_EXPIRY=600        # Invoice expiry (seconds, default 10min)
# MAX_L402_PAYMENT_SATS=1000     # Max sats for outbound L402 payments
```

### Available L402 Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /v1/l402/node-stats` | 5 sats | Node statistics |
| `GET /v1/l402/network-analytics` | 25 sats | Network analytics |
| `GET /v1/l402/promo` | 1 sat | Promotional data |
| `POST /v1/l402/pay` | N/A (agent) | Outbound L402 payment proxy (Bearer auth) |

### Verification

After enabling L402, verify the endpoints are responding:

```bash
# Should return 402 Payment Required (not 404)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/v1/l402/node-stats

# Full e2e verification in mock mode (runs on separate port, safe while production runs)
./scripts/verify-l402.sh
```

---

## 14. Install SCB Backup Service

```bash
# Install the backup script
sudo cp /opt/lqwdclawnode/scripts/scb-backup.sh /usr/local/bin/
sudo chmod 755 /usr/local/bin/scb-backup.sh

# Create config
sudo cp /opt/lqwdclawnode/scripts/scb-backup.env.example /etc/lnd-gateway/scb-backup.env

# Generate age encryption keypair
age-keygen -o /tmp/scb-age-key.txt
echo "=================================================="
echo "AGE PUBLIC KEY (put in scb-backup.env):"
grep "public key:" /tmp/scb-age-key.txt
echo "=================================================="
echo "AGE PRIVATE KEY — SAVE THIS OFFLINE, then delete from VM:"
cat /tmp/scb-age-key.txt
echo "=================================================="

# Copy the age1... public key, then paste it into scb-backup.env:
sudo nano /etc/lnd-gateway/scb-backup.env
# Set AGE_RECIPIENT=age1... (the public key from above)
# Optionally set REMOTE_DEST for off-site rsync backups

# IMPORTANT: Save the private key (starts with AGE-SECRET-KEY-) to your
# password manager or write it on paper. You need this ONLY for disaster
# recovery (decrypting SCB backups). Then delete it from the VM:

# Lock down and set ownership
sudo chmod 600 /etc/lnd-gateway/scb-backup.env
sudo chown root:lndgateway /etc/lnd-gateway/scb-backup.env

# Create backup directory
sudo mkdir -p /var/lib/lnd-gateway/scb-backups
sudo chown lndgateway:lndgateway /var/lib/lnd-gateway/scb-backups

# Install systemd service
sudo cp /opt/lqwdclawnode/scripts/scb-backup.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable scb-backup

# DELETE the age private key from the VM
rm /tmp/scb-age-key.txt
```

---

## 15. Install OpenClaw

```bash
# Install OpenClaw globally (must be root — openclaw user can't write to /usr/lib/node_modules)
sudo npm install -g openclaw

# Verify
openclaw --version
```

> **Note**: Do NOT use `sudo -u openclaw npm install -g` — the openclaw system
> user lacks write access to the global npm directory. Install as root; the
> openclaw user can still execute `/usr/bin/openclaw`.

---

## 16. Configure OpenClaw Workspace

```bash
# Copy the workspace to openclaw's home
sudo cp -r /opt/lqwdclawnode/lqwdclaw-nodeops /home/openclaw/nodeops
sudo chown -R openclaw:openclaw /home/openclaw/nodeops

# Update the model config (default is Anthropic — change to Gemini if using Gemini API)
# For Gemini:
sudo -u openclaw sed -i 's|anthropic/claude-sonnet-4-6|google/gemini-2.5-flash|' /home/openclaw/nodeops/openclaw.json
# For Anthropic: leave as-is

# Set up environment (get Telegram token from @BotFather)
# Use GOOGLE_API_KEY for Gemini or ANTHROPIC_API_KEY for Claude
sudo -u openclaw tee /home/openclaw/nodeops/.env << 'EOF'
GOOGLE_API_KEY=REPLACE_WITH_YOUR_GEMINI_KEY
# ANTHROPIC_API_KEY=sk-ant-REPLACE_WITH_YOUR_KEY
TELEGRAM_BOT_TOKEN=REPLACE_WITH_TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWLIST=YOUR_TELEGRAM_USER_ID
EOF

sudo chmod 600 /home/openclaw/nodeops/.env
```

Create systemd service for OpenClaw:

```bash
sudo tee /etc/systemd/system/openclaw-nodeops.service << 'EOF'
[Unit]
Description=OpenClaw LQWDClaw-NodeOps Agent
After=lnd-gateway.service
Wants=lnd-gateway.service

[Service]
Type=simple
User=openclaw
Group=openclaw
WorkingDirectory=/home/openclaw/nodeops
ExecStart=/usr/bin/openclaw gateway run
EnvironmentFile=/home/openclaw/nodeops/.env
Restart=on-failure
RestartSec=10

# Security
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=tmpfs
BindPaths=/home/openclaw
ReadWritePaths=/home/openclaw/nodeops
ReadOnlyPaths=/etc/lnd-gateway/agent-token
PrivateTmp=yes
PrivateDevices=yes

# Resource limits
MemoryMax=512M
CPUQuota=50%

StandardOutput=journal
StandardError=journal
SyslogIdentifier=openclaw-nodeops

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable openclaw-nodeops
```

> **Note**: `ProtectHome=tmpfs` + `BindPaths=/home/openclaw` creates a clean tmpfs
> at /home with only the openclaw home dir bind-mounted in. This is more restrictive
> than `ProtectHome=read-only` — other users' home dirs are invisible.

---

## 17. AppArmor Security Profiles

Restrict the OpenClaw user to only allowed commands:

```bash
sudo tee /etc/apparmor.d/usr.bin.openclaw << 'EOF'
#include <tunables/global>

profile openclaw /home/openclaw/** {
  #include <abstractions/base>
  #include <abstractions/nameservice>

  # Allow network (for gateway API + Telegram)
  network inet stream,
  network inet6 stream,

  # Allowed executables
  /usr/bin/curl ix,
  /usr/bin/jq ix,
  /usr/bin/date ix,
  /usr/bin/uuidgen ix,
  /usr/bin/node ix,
  /usr/bin/openclaw ix,

  # Read-only access
  /etc/lnd-gateway/agent-token r,
  /home/openclaw/nodeops/** r,

  # Write to workspace
  /home/openclaw/nodeops/** w,

  # Deny access to LND and Bitcoin data
  deny /lnd/** rw,
  deny /bitcoin/** rw,
  deny /var/lib/lnd-gateway/** rw,

  # Deny access to secrets
  deny /etc/lnd-gateway/env r,
  deny /etc/lnd-gateway/scb-backup.env r,
}
EOF

sudo apparmor_parser -r /etc/apparmor.d/usr.bin.openclaw
sudo aa-enforce /etc/apparmor.d/usr.bin.openclaw
```

---

## 18. Start Everything & Verify

Once Bitcoin Core IBD is complete:

```bash
# 1. Verify Bitcoin Core is synced
/bitcoin/bitcoin-30.2/bin/bitcoin-cli -datadir=/bitcoin getblockchaininfo | jq '.verificationprogress'
# Must be > 0.9999

# 2. Verify Tor is running
sudo systemctl is-active tor
ss -tlnp | grep -E '905[01]'
# Should show 9050 (SOCKS) and 9051 (Control) listening

# 3. Start LND
sudo systemctl start lnd

# 4. Wait for LND startup
sleep 10

# 5. Create or unlock wallet
sudo -u lnd lncli --lnddir=/lnd create   # First time only — SAVE SEED OFFLINE
# OR
sudo -u lnd lncli --lnddir=/lnd unlock   # Subsequent starts

# 6. Wait for LND to sync to chain and graph
watch -n 10 'sudo -u lnd lncli --lnddir=/lnd getinfo | jq "{synced_to_chain, synced_to_graph, block_height, num_active_channels}"'
# Wait until synced_to_chain: true

# 7. Verify hybrid mode — both clearnet and onion URIs advertised
sudo -u lnd lncli --lnddir=/lnd getinfo | jq '.uris'
# Should show two URIs:
#   "pubkey@YOUR_IP:9735"
#   "pubkey@xxxx...xxxx.onion:9735"

# 8. Generate macaroons (step 12 — first time only)

# 9. Switch gateway from mock to production mode
sudo systemctl stop lnd-gateway
sudo sed -i 's/^GATEWAY_MOCK=true/GATEWAY_MOCK=false/' /etc/lnd-gateway/env
sudo systemctl start lnd-gateway
sleep 2
sudo systemctl status lnd-gateway
# Verify: curl should return real node data, not mock data
curl -s -H "Authorization: Bearer $(sudo cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/info -d '{}' | jq .

# 10. Start SCB backup
sudo systemctl start scb-backup
sudo systemctl status scb-backup

# 11. Start OpenClaw
sudo systemctl start openclaw-nodeops
sudo systemctl status openclaw-nodeops
```

---

## 19. Post-Install Smoke Test

Run the full smoke test to verify everything works:

```bash
# Set token for convenience
export AGENT_TOKEN=$(sudo cat /etc/lnd-gateway/agent-token)

# Step 1: Health
curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  http://127.0.0.1:7778/v1/health | jq .

# Step 2: Node Info
curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST http://127.0.0.1:7778/v1/info -d '{}' | jq .

# Step 3: Balances
curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST http://127.0.0.1:7778/v1/wallet/balance -d '{}' | jq .

# Step 4: Channels
curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST http://127.0.0.1:7778/v1/channels -d '{}' | jq .

# Step 5: Node Summary
curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST http://127.0.0.1:7778/v1/node/summary -d '{}' | jq .

# Step 6: Verify admin auth blocking
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST http://127.0.0.1:7778/v1/confirm/list -d '{}')
echo "Admin endpoint with agent token: HTTP $HTTP_CODE (expect 403)"

# Step 7: Kill switch NOT engaged
ls /var/lib/lnd-gateway/kill-switch 2>&1
# Expect: "No such file or directory"

# Step 8: SCB backup running
sudo systemctl is-active scb-backup

# Step 9: Verify Tor and hybrid mode
sudo systemctl is-active tor
sudo -u lnd lncli --lnddir=/lnd getinfo | jq '.uris'
# Should list both clearnet and .onion URIs

# Step 10: Check all services
for svc in tor postgresql bitcoind lnd lnd-gateway scb-backup openclaw-nodeops cloudflared; do
  echo "$svc: $(sudo systemctl is-active $svc)"
done
```

All should show `active` and endpoints return `"ok": true`.

---

## 20. Firewall Rules

```bash
# Enable UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH (change port if desired)
sudo ufw allow 22/tcp comment 'SSH'

# Bitcoin P2P
sudo ufw allow 8333/tcp comment 'Bitcoin P2P'

# LND P2P (Lightning)
sudo ufw allow 9735/tcp comment 'LND P2P'

# Block everything else — gateway, RPC, REST, Tor are localhost only
sudo ufw enable
sudo ufw status verbose
```

**Verify**: No external access to ports 7778 (gateway), 10009 (LND gRPC), 8080 (LND REST), 18789 (OpenClaw), 9050/9051 (Tor).

**Note on Tor**: Tor's SOCKS (9050) and Control (9051) ports bind to `127.0.0.1` only.
Tor's outbound connections use random high ports (allowed by `default allow outgoing`).

---

## 21. Monitoring & Maintenance

### Service Status

```bash
# Quick check all services
for svc in tor postgresql bitcoind lnd lnd-gateway scb-backup openclaw-nodeops; do
  printf "%-20s %s\n" "$svc" "$(sudo systemctl is-active $svc)"
done
```

### Logs

```bash
# Tor logs
sudo journalctl -u tor -f --no-pager

# Gateway logs
sudo journalctl -u lnd-gateway -f --no-pager

# LND logs
sudo journalctl -u lnd -f --no-pager

# Bitcoin Core logs
sudo journalctl -u bitcoind -f --no-pager

# SCB backup logs
sudo journalctl -u scb-backup -f --no-pager

# OpenClaw logs
sudo journalctl -u openclaw-nodeops -f --no-pager
```

### Wallet Unlock After Reboot

LND requires manual wallet unlock after restart (by design):

```bash
sudo -u lnd lncli --lnddir=/lnd unlock
```

Consider automating with a password file only if the security trade-off is acceptable:
```
# In lnd.conf (LESS SECURE — password on disk):
# wallet-unlock-password-file=/lnd/wallet-password  (LESS SECURE)
```

### Upgrades

See `scripts/UPGRADE-RUNBOOK.md` for detailed LND and gateway upgrade procedures.

### Daily Health Check

Via Telegram, ask the NodeOps agent: "How is the node?"
It will use the `node-summary-api` skill to return a full status report.

---

## 22. PostgreSQL for Gateway Account System

The v2 account system (agent registration, credit ledger, channel faucet) uses PostgreSQL — separate from the LND PostgreSQL database.

```bash
# Create the gateway database (uses the same PostgreSQL instance as LND)
sudo -u postgres psql -c "CREATE DATABASE lqwdclaw_gateway;"
sudo -u postgres psql -c "CREATE USER gateway_user WITH PASSWORD 'REPLACE_WITH_SECURE_PASSWORD';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE lqwdclaw_gateway TO gateway_user;"

# The gateway auto-creates tables on startup (agents, credits, channel_grants)
```

Add to `/etc/lnd-gateway/env`:

```bash
# Account system (v2)
DATABASE_URL=postgresql://gateway_user:REPLACE_WITH_SECURE_PASSWORD@127.0.0.1/lqwdclaw_gateway?sslmode=disable

# Faucet daily cap (total sats granted across all agents per day)
FAUCET_DAILY_CAP_SATS=10000
```

---

## 23. Cloudflare Edge (DNS A record + Caddy + Origin CA)

External agents reach `api.lqwdclaw.bot` through Cloudflare's orange-cloud proxy; Caddy terminates TLS on the VM and reverse-proxies to the localhost-bound gateway. No cloudflared daemon, no CF Tunnel. Four layered defenses ensure direct-IP bypass is blocked: UFW IP allowlist, Cloudflare Origin CA cert (not publicly trusted), SSL/TLS Full (Strict), and the path allowlist in the Caddyfile. Authenticated Origin Pulls (mTLS) is a planned follow-up phase.

See Obsidian `LQWDClaw/Infrastructure/Cloudflare Edge Setup.md` for architecture + rollback detail.

### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
caddy version
```

### Issue Origin CA cert

1. Cloudflare dashboard → `lqwdclaw.bot` zone → **SSL/TLS → Origin Server → Create Certificate**
2. Key type: RSA 2048 (or ECDSA P-256)
3. Hostnames: `api.lqwdclaw.bot` + `*.lqwdclaw.bot`
4. Validity: **15 years**
5. Copy cert + key locally, `scp` to VM, install with the helper:

```bash
sudo /opt/lqwdclawnode/scripts/install-caddy-origin-certs.sh \
    /tmp/origin-cert.pem /tmp/origin-key.pem
# Verifies issuer is CloudFlare Origin SSL CA; installs mode 640 root:caddy.
```

### Install Caddyfile + systemd drop-in for env

```bash
sudo cp /opt/lqwdclawnode/scripts/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile

# systemd drop-in to expose INTERNAL_AUTH_SECRET to the caddy process
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/override.conf > /dev/null << 'EOF'
[Service]
EnvironmentFile=/etc/caddy/env
EOF

# Mirror the shared secret from the gateway env into a caddy-readable file
SECRET=$(sudo grep -E '^INTERNAL_AUTH_SECRET=' /etc/lnd-gateway/env | cut -d= -f2-)
if [ -z "$SECRET" ]; then
  SECRET=$(openssl rand -hex 32)
  echo "INTERNAL_AUTH_SECRET=${SECRET}" | sudo tee -a /etc/lnd-gateway/env >/dev/null
fi
echo "INTERNAL_AUTH_SECRET=${SECRET}" | sudo tee /etc/caddy/env >/dev/null
sudo chmod 640 /etc/caddy/env
sudo chown root:caddy /etc/caddy/env
sudo systemctl daemon-reload
```

### UFW — allow 443 only from Cloudflare

```bash
sudo cp /opt/lqwdclawnode/scripts/ufw-cloudflare-ips.sh /usr/local/sbin/
sudo chmod +x /usr/local/sbin/ufw-cloudflare-ips.sh
sudo /usr/local/sbin/ufw-cloudflare-ips.sh
sudo ufw --force enable
sudo ufw status numbered | head -30
```

Idempotent — safe to re-run weekly via cron to pick up CF IP range changes.

### Cloudflare dashboard

1. **DNS → Records → Add record**: Type A, Name `api`, IPv4 `71.19.249.198`, Proxy **Proxied** (orange cloud), TTL Auto
2. **SSL/TLS → Overview**: set mode to **Full (Strict)**
3. Leave **Authenticated Origin Pulls** OFF for now — a follow-up plan will enable it alongside updated Caddy mTLS config.

### Start Caddy + verify

```bash
sudo systemctl enable --now caddy
sleep 5
sudo systemctl status caddy --no-pager | head -10
```

From the VM, verify Caddy + cert + path routing locally:

```bash
curl -sk https://127.0.0.1/v1/health \
  --resolve api.lqwdclaw.bot:443:127.0.0.1 -H "Host: api.lqwdclaw.bot"
# → {"ok":true,"data":{"status":"healthy"}} — minimized public body

curl -s http://127.0.0.1:7778/v1/health/detailed | jq
# → full body (kill_switch, pending_confirms, budget_limits) — localhost only
```

From your laptop (through CF):

```bash
curl -s https://api.lqwdclaw.bot/v1/health | jq
curl -sI https://api.lqwdclaw.bot/admin/              # 404 — blocked at Caddy
curl -sI https://api.lqwdclaw.bot/v1/l402/node-stats  # 402 challenge
curl -s -X POST https://api.lqwdclaw.bot/v1/internal/accounts/register \
  -H "Content-Type: application/json" -d '{"name":"post-deploy-smoke"}' | jq
# → {"ok":true,"data":{"api_key":"lqwd_...","balance_sats":150,...}}
```

Direct-IP bypass (should fail — UFW drops, Origin CA untrusted):

```bash
curl -v --connect-timeout 5 https://71.19.249.198/v1/health 2>&1 | tail -5
```

### 525/526 diagnostics

| Symptom | Probable cause | Check |
|---|---|---|
| CF 525 SSL handshake failed | Caddy not listening / cert mismatch / port blocked | `sudo systemctl status caddy`, `ss -tlnp \| grep :443`, `sudo ufw status` |
| CF 526 invalid certificate | Origin cert expired / wrong hostname | `sudo openssl x509 -in /etc/caddy/certs/origin-cert.pem -noout -dates -subject` |
| CF 502 bad gateway | Caddy up, upstream `:7778` down | `sudo systemctl status lnd-gateway; curl http://127.0.0.1:7778/v1/health` |
| 403 from `/v1/internal/*` | Caddy env not substituting | `sudo systemctl show caddy -p Environment`; verify `/etc/caddy/env` readable by `caddy` user |

### Rollback

```bash
sudo systemctl stop caddy
sudo systemctl disable caddy
# Gateway + LND untouched. UFW rules stay — SSH + 9735 still work.
# CF: DNS record can stay (502s until caddy returns) or be removed from dashboard.
```

---

## 24. Admin Dashboard Configuration

The admin dashboard is an embedded React SPA served at `/admin/`. It requires a username and bcrypt-hashed password.

### Generate Password Hash

```bash
# Install htpasswd or use Python
python3 -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_PASSWORD', bcrypt.gensalt()).decode())"
# Or use the gateway's built-in hash generation (if available)
```

### Gateway Environment

Add to `/etc/lnd-gateway/env`:

```bash
# Admin Dashboard (v2)
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2a$10$YOUR_BCRYPT_HASH_HERE
```

### Verify

```bash
# Should return the login page HTML
curl -s http://127.0.0.1:7778/admin/ | head -5

# Login test
curl -s -X POST http://127.0.0.1:7778/admin/api/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "YOUR_PASSWORD"}' | jq .
```

The dashboard provides:
- Agent list with balances and status
- Credit grant management (Tier 3 manual grants)
- Agent status control (suspend/activate)
- Channel grant overview
- Transaction history per agent
- Metrics overview (total agents, credits, channels)

---

## 25. MCP Server Configuration

The MCP (Model Context Protocol) server enables AI agents to discover and call gateway tools programmatically. It runs at `/v1/internal/mcp` behind CF Access.

### Gateway Environment

Add to `/etc/lnd-gateway/env`:

```bash
# MCP Server (v2) — enable credit billing so Bearer API-key auth is extracted
# from Authorization headers and the tier-1 150-sat grant actually enforces.
# Leaving this as false means MCP paid tools run free AND lqwd_check_balance
# cannot read the agent context (the Bearer extraction middleware is only
# installed when billing=true). Fresh-agent UAT 2026-04-21 caught this.
MCP_BILLING_ENABLED=true
```

### Verify

```bash
# MCP endpoint should respond (requires CF Access token in production)
# In mock mode, test directly:
curl -s -X POST http://127.0.0.1:7778/v1/internal/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "id": 1, "params": {"capabilities": {}}}' | jq .
```

### Proxy Configuration

Add to `/etc/lnd-gateway/env`:

```bash
# Credit proxy pricing (v2)
PROXY_PRICE_SATS=10
PROXY_UPSTREAM_TIMEOUT_SECS=30
```

---

## 26. Agent Registration — Channel Faucet Setup

The channel faucet grants real Lightning channels to the first 100 AI agents that register with a valid pubkey. This section covers how agents find their node details and register for a channel.

### Prerequisites

- A running Lightning node (LND v0.16+ recommended, or any Lightning implementation exposing a standard pubkey and address)
- The node must be online, fully synced, and reachable from the LQWDClaw node
- Network connectivity: either clearnet (public IP or domain) or Tor (.onion address)

### Finding Your Pubkey

```bash
# LND
lncli getinfo | jq -r '.identity_pubkey'
# Output: 0288a5f5c2e6b8e0c8f35a1d9c4b7e2a3f6d8e1b4c7a9d2e5f8b1c4d7e0a3f6b9c
```

The pubkey is a 66-character hex string (compressed secp256k1 public key).

### Constructing Your Node URI

The node URI format is `<pubkey>@<host>:<port>`:

```bash
# Clearnet example
0288a5f5...@203.0.113.42:9735

# Domain example
0288a5f5...@mynode.example.com:9735

# Tor example (.onion address)
0288a5f5...@abcdef1234567890.onion:9735
```

- **Default LND port:** 9735
- **Tor nodes:** Use the `.onion` address from your LND config. LND handles Tor connections natively. Find it with: `lncli getinfo | jq -r '.uris[]'`
- **NAT/firewall:** Ensure port 9735 (or your custom port) is forwarded and reachable

### Registering with Channel Faucet

```bash
# Register with pubkey and node_uri for a channel grant
curl -X POST http://<gateway-host>:7778/v1/internal/accounts/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-agent",
    "pubkey": "0288a5f5c2e6b8e0c8f35a1d9c4b7e2a3f6d8e1b4c7a9d2e5f8b1c4d7e0a3f6b9c",
    "node_uri": "0288a5f5c2e6b8e0c8f35a1d9c4b7e2a3f6d8e1b4c7a9d2e5f8b1c4d7e0a3f6b9c@203.0.113.42:9735"
  }'
```

On success, the response includes:
- `api_key` — your `lqwd_` API key for all subsequent requests
- `channel_granted: true` — a channel is being opened
- `channel_status: "pending"` — channel open is asynchronous
- `channel_id` — use this to poll status

### What Happens on Registration

1. Gateway validates the pubkey (66-char hex) and node_uri format
2. Gateway checks if the faucet cap has been reached
3. If cap available: registration commits immediately (API key + credits issued)
4. Channel open fires asynchronously in the background — registration never blocks on LND
5. LQWDClaw connects to your node (ConnectPeer) and opens a channel with pushed sats

### Polling Channel Status

After registration, poll for updates on your channel:

```bash
curl -H "X-Api-Key: lqwd_your-api-key" \
  http://<gateway-host>:7778/v1/internal/channel/status
```

Response fields:
- `status` — `pending`, `pending_open`, `open`, `failed`, `closed`
- `funding_txid` — Bitcoin transaction ID (available once channel is opening)
- `confirmations` — number of on-chain confirmations
- `failure_reason` — populated if status is `failed`

A background poller runs every 15 minutes to update channel states (detects confirmations, force-closes, closures).

### What Happens If Channel Open Fails

- The pubkey is automatically banned from retrying channel open
- The agent keeps full credit proxy access (API key and credits are not revoked)
- The faucet slot is released back to the pool (not consumed on failure)
- An admin can clear the ban to allow a re-attempt via the admin dashboard

### Faucet Exhausted

If the channel cap (default 100) has been reached:
- Registration still succeeds for credit proxy access
- Response includes `channel_granted: false` and `reason: "faucet_exhausted"`
- The agent gets an API key and credit grant, just no Lightning channel

### Registering Without a Node (Credit Proxy Only)

Agents without a Lightning node skip the pubkey and node_uri fields:

```bash
curl -X POST http://<gateway-host>:7778/v1/internal/accounts/register \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent"}'
```

This grants credit proxy access only — interact with Lightning data via proxy endpoints without running your own node.

### Channel Faucet Environment Variables

Set these in `/etc/lnd-gateway/env` on the gateway server:

```bash
# Channel Faucet (Phase 14)
FAUCET_CHANNEL_SIZE_SATS=100000    # Channel size in sats (default: 100000)
FAUCET_PUSH_SATS=25000             # Sats pushed to peer on open (default: 25000)
FAUCET_CHANNEL_CAP=100             # Max total channel grants (default: 100)
```

The `ADMIN_TOKEN` (already configured in Phase 15) is required for admin endpoints including clearing pubkey bans.

---

## Quick Reference — Systemd Service Order

```
tor  ──────────┐
postgresql  ───┤
bitcoind  →  lnd  →  lnd-gateway  →  openclaw-nodeops
                  →  scb-backup
cloudflared (independent — CF Tunnel)
```

Tor and PostgreSQL start independently. LND `Wants=tor.service postgresql.service` (soft dependencies). LND `Requires=bitcoind.service`. cloudflared runs independently (external access tunnel).

## Quick Reference — Key File Locations

| File | Path | Owner |
|------|------|-------|
| Tor config | `/etc/tor/torrc` | root |
| Tor data | `/var/lib/tor/` | debian-tor |
| Bitcoin data + binaries | `/bitcoin/` | bitcoin |
| Bitcoin config | `/bitcoin/bitcoin.conf` | bitcoin |
| Bitcoin binaries | `/bitcoin/bitcoin-30.2/bin/` | bitcoin |
| LND data | `/lnd/` | lnd |
| LND config | `/lnd/lnd.conf` | lnd |
| LND database | PostgreSQL `lqwdclaw` database | postgres |
| Scoped macaroons | `/lnd/data/chain/bitcoin/mainnet/*.macaroon` | lnd:lndgateway |
| Gateway env | `/etc/lnd-gateway/env` | root:lndgateway |
| Gateway agent token | `/etc/lnd-gateway/agent-token` | root:openclaw |
| Gateway data | `/var/lib/lnd-gateway/` | lndgateway |
| SCB backups | `/var/lib/lnd-gateway/scb-backups/` | lndgateway |
| SCB backup config | `/etc/lnd-gateway/scb-backup.env` | root:lndgateway |
| OpenClaw workspace | `/home/openclaw/nodeops/` | openclaw |
| Gateway binary | `/usr/local/bin/lnd-gateway` | root |
| Repo (source) | `/opt/lqwdclawnode/` | lndgateway |

## Quick Reference — Tokens

| Token | Purpose | Generated By | Used By |
|-------|---------|-------------|---------|
| `GATEWAY_AGENT_TOKEN` | Read + initiate writes | `openssl rand -hex 32` | OpenClaw agent |
| `GATEWAY_ADMIN_TOKEN` | Confirm ops + kill switch | `openssl rand -hex 32` | Human operator (Telegram) |
| `GOOGLE_API_KEY` or `ANTHROPIC_API_KEY` | AI model API access | Google AI Studio or Anthropic console | OpenClaw |
| `TELEGRAM_BOT_TOKEN` | Telegram bot access | @BotFather | OpenClaw |
