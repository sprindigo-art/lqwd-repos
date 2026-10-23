---
name: disaster-recovery
description: Validate disaster recovery readiness and guide SCB recovery procedures
---

# Disaster Recovery

Verify backup integrity, test recovery readiness, and guide SCB-based channel recovery when needed.

## When to Use

- Scheduled DR readiness checks (weekly recommended)
- After any channel open/close to verify SCB backup triggered
- When planning VM migration or maintenance
- In an actual disaster (node loss, disk failure)

## DR Readiness Check

Run these checks to verify the node can be recovered:

### 1. Verify SCB backup service is running

```bash
systemctl is-active scb-backup
```

Expected: `active`

### 2. Verify recent SCB backups exist

```bash
ls -lt /var/lib/lnd-gateway/scb-backups/ | head -5
```

The most recent backup should be within minutes of the last channel change.

### 3. Verify SCB backup is non-empty and valid

```bash
LATEST=$(ls -t /var/lib/lnd-gateway/scb-backups/ | head -1)
stat /var/lib/lnd-gateway/scb-backups/$LATEST
```

Minimum expected size: ~200 bytes per channel.

### 4. Verify remote backup destination (if configured)

```bash
# Check env for remote destination
grep REMOTE_DEST /etc/lnd-gateway/scb-backup.env
```

### 5. Check LND wallet seed backup status

This cannot be verified programmatically. Confirm with the operator:
- Seed phrase stored securely offline
- Seed phrase NOT on the VM or any connected system

## DR Test Script

Simulates a recovery scenario without actually recovering:

```bash
# 1. Verify we can read the latest backup
LATEST=$(ls -t /var/lib/lnd-gateway/scb-backups/ | head -1)
echo "Latest backup: $LATEST"

# 2. Verify SCB file is a valid backup (check magic bytes)
hexdump -C /var/lib/lnd-gateway/scb-backups/$LATEST | head -1

# 3. Count channels in current state
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels -d '{}' | jq '.data.channels | length'

# 4. Report
echo "DR readiness: OK"
echo "  - SCB backup service: $(systemctl is-active scb-backup)"
echo "  - Latest backup: $LATEST"
echo "  - Backup age: $(stat -c '%Y' /var/lib/lnd-gateway/scb-backups/$LATEST | xargs -I{} date -d @{} '+%Y-%m-%d %H:%M:%S')"
```

## Recovery Severity Levels

| Scenario | Action | Data Loss Risk |
|----------|--------|----------------|
| Gateway crash | Restart systemd service | None |
| LND crash | Restart LND, wait for sync | None |
| Disk failure (NVMe) | Full SCB recovery on new VM | Force-close all channels |
| VM provider outage | Wait or migrate to new VM | Depends on duration |
| Compromised keys | Emergency: revoke all, SCB recover on fresh VM | Force-close + potential theft |

## Important Rules

- NEVER test recovery on the production node — use a separate testnet/signet instance
- SCB recovery force-closes ALL channels — this is catastrophic for routing
- After any recovery, all channel peers must be online to cooperatively close
- Recovery timelocks can be days to weeks depending on channel age
- Always verify the wallet seed is available before starting any recovery
