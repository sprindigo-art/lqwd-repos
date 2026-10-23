# LND + Gateway Upgrade Runbook

> **Internal operator guide — v1 scope notice**
>
> This runbook describes full-system upgrades including subsystems (L402 pay-per-call, credit proxy, paid MCP data tools, tier upgrade paths) that remain present in code but are **not part of LQWDClaw's v1 publicly advertised surface**. LQWDClaw offers the free channel faucet only at this time; paid liquidity is a later version. These subsystems are documented here for operator use and future re-activation.

Standard operating procedure for upgrading LND and lnd-gateway on the LQWDClaw-NodeOps VM.

## Pre-Upgrade Checklist

- [ ] Read release notes for the new version
- [ ] Verify SCB backup is current (`ls -la /var/lib/lnd-gateway/scb-backups/`)
- [ ] Check that no pending confirmations exist (`curl -s -H "Authorization: Bearer $ADMIN_TOKEN" -X POST http://127.0.0.1:7778/v1/confirm/list`)
- [ ] Engage kill switch if upgrading LND (`touch /var/lib/lnd-gateway/kill-switch`)
- [ ] Notify via Telegram that maintenance is starting
- [ ] If deploying L402 changes: verify L402 env vars are configured in `/etc/lnd-gateway/env` (see env.example for required vars)
- [ ] If deploying from feature branch: run `git log feature-branch..main` to check for divergence

## LND Upgrade

### 1. Download and verify

```bash
# Download from https://github.com/lightningnetwork/lnd/releases
LND_VERSION="v0.20.1-beta"
wget "https://github.com/lightningnetwork/lnd/releases/download/${LND_VERSION}/lnd-linux-amd64-${LND_VERSION}.tar.gz"
wget "https://github.com/lightningnetwork/lnd/releases/download/${LND_VERSION}/manifest-${LND_VERSION}.sig"
wget "https://github.com/lightningnetwork/lnd/releases/download/${LND_VERSION}/manifest-${LND_VERSION}.txt"

# Verify signature (requires LND team's GPG keys imported)
gpg --verify manifest-${LND_VERSION}.sig manifest-${LND_VERSION}.txt
sha256sum --check manifest-${LND_VERSION}.txt --ignore-missing
```

### 2. Stop services

```bash
systemctl stop lnd-gateway
systemctl stop lnd
```

### 3. Backup current binaries

```bash
cp /usr/local/bin/lnd /usr/local/bin/lnd.bak
cp /usr/local/bin/lncli /usr/local/bin/lncli.bak
```

### 4. Install new binaries

```bash
tar xzf lnd-linux-amd64-${LND_VERSION}.tar.gz
cp lnd-linux-amd64-${LND_VERSION}/lnd /usr/local/bin/
cp lnd-linux-amd64-${LND_VERSION}/lncli /usr/local/bin/
chmod 755 /usr/local/bin/lnd /usr/local/bin/lncli
```

### 5. Start LND and verify

```bash
systemctl start lnd

# Wait for startup and wallet unlock (if not auto-unlocked)
sleep 10
lncli getinfo

# Verify sync
lncli getinfo | jq '.synced_to_chain, .synced_to_graph'
```

### 6. Start gateway and verify

```bash
systemctl start lnd-gateway
sleep 2

# Health check
curl -s -H "Authorization: Bearer $AGENT_TOKEN" -X POST http://127.0.0.1:7778/v1/info | jq .
```

### 7. Disengage kill switch

```bash
rm /var/lib/lnd-gateway/kill-switch
```

### 8. Post-upgrade verification

```bash
# Full node summary
curl -s -H "Authorization: Bearer $AGENT_TOKEN" -X POST http://127.0.0.1:7778/v1/node/summary | jq .

# Check all channels are active
curl -s -H "Authorization: Bearer $AGENT_TOKEN" -X POST http://127.0.0.1:7778/v1/channels | jq '.data.channels[] | {chan_id, active}'

# Verify routing
curl -s -H "Authorization: Bearer $AGENT_TOKEN" -X POST http://127.0.0.1:7778/v1/routing/fee-report | jq .
```

## Gateway-Only Upgrade

```bash
cd /path/to/lqwdclawnode
git pull origin main
./scripts/deploy-gateway.sh
```

The deploy script handles: build, stop, install, restart, health check.

## Gateway Upgrade with L402

For deploying builds that include L402 pay-per-call endpoints.

### Pre-deploy: Configure L402 environment

If this is the first deploy with L402 enabled:

1. Generate signing key: `openssl rand -hex 32`
2. Edit `/etc/lnd-gateway/env`:
   ```bash
   L402_ENABLED=true
   L402_SIGNING_KEY=<paste-64-char-hex-key>
   L402_DB_PATH=/var/lib/lnd-gateway/l402.db
   ```
3. L402 endpoints are localhost-only (127.0.0.1:7778) — no external exposure needed.

### Deploy

```bash
cd /path/to/lqwdclawnode
git fetch origin feature/l402-server
git checkout feature/l402-server && git pull
./scripts/deploy-gateway.sh
```

The deploy script automatically:
- Backs up current binary to `/usr/local/bin/lnd-gateway.bak`
- Records current git commit to `/var/lib/lnd-gateway/rollback-commit`
- Builds, stops, installs, and restarts the service

### Post-deploy verification

```bash
# 1. Check service is running
systemctl is-active lnd-gateway

# 2. Run full test suite
cd lnd-gateway && make test

# 3. Run L402 end-to-end verification (mock mode, separate port)
./scripts/verify-l402.sh

# 4. Check health endpoint
curl -s http://127.0.0.1:7778/v1/health | jq .

# 5. Verify L402 endpoints are responding (expect 402 without token)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7778/v1/l402/node-stats
# Expected: 402
```

## Rollback

### LND rollback

```bash
systemctl stop lnd-gateway
systemctl stop lnd
cp /usr/local/bin/lnd.bak /usr/local/bin/lnd
cp /usr/local/bin/lncli.bak /usr/local/bin/lncli
systemctl start lnd
sleep 10
systemctl start lnd-gateway
```

**WARNING**: LND database migrations may be irreversible. If the new version migrated the DB, you may need to restore from a pre-upgrade snapshot. Always snapshot the VM before major LND version upgrades.

### Gateway rollback

**Quick rollback (binary only — restores previous binary):**

```bash
systemctl stop lnd-gateway
cp /usr/local/bin/lnd-gateway.bak /usr/local/bin/lnd-gateway
systemctl start lnd-gateway
systemctl is-active lnd-gateway  # verify running
```

**Full rollback (source + binary — rebuilds from previous commit):**

```bash
PREV_COMMIT=$(cat /var/lib/lnd-gateway/rollback-commit)
cd /path/to/lqwdclawnode
git checkout "$PREV_COMMIT"
./scripts/deploy-gateway.sh
```

**Note:** The deploy script now automatically backs up the binary and records the commit hash before every install. The `.bak` file and `rollback-commit` are always current as of the last deploy.

## Emergency: SCB Recovery

If the node is completely lost and you need to recover channels:

```bash
# 1. Install LND on new VM
# 2. Restore wallet from seed
lncli create  # Enter existing seed phrase

# 3. Decrypt latest SCB backup
age -d -i /path/to/private-key.txt -o channel.backup /path/to/latest-backup.age

# 4. Initiate channel recovery
lncli restorechanbackup --multi_file=channel.backup

# 5. Wait for force-closes to resolve (can take days due to timelocks)
```

**CRITICAL**: SCB recovery force-closes ALL channels. This is a last resort.
