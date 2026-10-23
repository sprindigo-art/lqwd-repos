---
name: channel-faucet
description: Guide AI agents through LQWD channel-faucet registration, pre-flight reachability checks, and retry-on-failure recovery
---

# Channel Faucet

Help AI agents register with the LQWD channel faucet to receive a real inbound Lightning channel from LQWD's node.

## When to Use

- When the operator asks about the faucet or agent onboarding
- When an external agent needs a channel from LQWD
- When checking channel grant status for a registered agent
- When a prior registration failed and the agent wants to retry
- When generating content about LQWD's agent onboarding program

## What the Faucet Grants

Each successful registration opens ONE real Lightning channel from LQWD's node to the agent's node:

- **Channel capacity:** 20,000 sats
- **Push amount (inbound to agent):** 1,354 sats
- **Cap on active grants:** controlled by `FAUCET_CHANNEL_CAP` (current production value: 10)

There is no credit-proxy path. The faucet is a Lightning channel, full stop — the agent must operate a reachable LND node.

## Prerequisites

Before calling `/register-with-channel-faucet`, the agent MUST:

1. Run an LND node reachable from the public internet at a stable `pubkey@host:port`.
2. Know its own `pubkey` (66 hex chars) and full `node_uri`.
3. Pre-connect to LQWD's node as a peer (see below).
4. Optionally: run the reachability pre-flight (see below) to avoid burning a failure strike.

## Gateway health preamble (SKL-03 / SKL-04)

Run this block ONCE at the start of any session that will call the gateway. It
is advisory — it logs + posts an operator alert on drift, but does NOT abort
execution (per 22-CONTEXT.md D-15). Reads the same token files the other
admin-authed skills read.

```bash
ADMIN_TOKEN=$(cat /etc/lnd-gateway/admin-token 2>/dev/null)
INTERNAL_AUTH=$(cat /etc/lnd-gateway/internal-auth 2>/dev/null)

# SKL-03: Gateway version drift check
EXPECTED_GATEWAY_VERSION="v3.0.0"  # bump per release; matches ldflags -X main.Version
_actual_version=$(curl -sI http://127.0.0.1:7778/v1/health 2>/dev/null | grep -i '^x-gateway-version:' | awk '{print $2}' | tr -d '\r\n')
if [ -n "$_actual_version" ] && [ "$_actual_version" != "$EXPECTED_GATEWAY_VERSION" ] && [ -z "$_SKL03_ALERTED" ]; then
  echo "WARN: Gateway version drift: expected $EXPECTED_GATEWAY_VERSION, got $_actual_version" >&2
  curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Internal-Auth: $INTERNAL_AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"level\":\"warn\",\"source\":\"skill:channel-faucet\",\"message\":\"gateway version drift: expected $EXPECTED_GATEWAY_VERSION got $_actual_version\"}" \
    http://127.0.0.1:7778/v1/internal/admin/alert >/dev/null || true
  _SKL03_ALERTED=1  # per-session dedupe (D-14)
fi

# SKL-04: Skills symlink self-check
EXPECTED_SKILLS_TARGET="/opt/lqwdclawnode/lqwdclaw-nodeops/skills"
_actual_target=$(readlink -f /home/openclaw/nodeops/skills 2>/dev/null)
if [ -n "$_actual_target" ] && [ "$_actual_target" != "$EXPECTED_SKILLS_TARGET" ] && [ -z "$_SKL04_ALERTED" ]; then
  echo "ERROR: Skills symlink drift: expected $EXPECTED_SKILLS_TARGET, got $_actual_target" >&2
  curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Internal-Auth: $INTERNAL_AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"level\":\"error\",\"source\":\"skill:channel-faucet\",\"message\":\"skills symlink drift: expected $EXPECTED_SKILLS_TARGET got $_actual_target\"}" \
    http://127.0.0.1:7778/v1/internal/admin/alert >/dev/null || true
  _SKL04_ALERTED=1
fi
```

Both checks continue on failure — they are advisory alerts, not fatal guards
(D-15). Per-session dedupe flags keep one alert per drift (D-14).

## Step 1: Discover LQWD's Node URI

The LQWD node URI is exposed in `/v1/discovery` under `channel_faucet.lqwd_node.uri`. Always read this at runtime — do NOT hardcode.

```bash
curl -s https://api.lqwdclaw.bot/v1/discovery | jq '.channel_faucet.lqwd_node.uri'
```

Returns a string like `03abc...def@1.2.3.4:9735`.

Also surfaced in the same block: `advertised_channel_size_sats`, `advertised_push_sats`, and (when applicable) `faucet_paused: true` with `pause_reason`. If `faucet_paused` is true, do NOT attempt to register — the reservation will be rejected.

## Step 2: Pre-Connect to LQWD

Use the agent's own LND to open a peer connection to LQWD BEFORE registering. This ensures the peer link exists when LQWD tries to fund the channel back to the agent.

```bash
LQWD_URI=$(curl -s https://api.lqwdclaw.bot/v1/discovery | jq -r '.channel_faucet.lqwd_node.uri')
lncli connect "$LQWD_URI"
```

Or via the gateway's own peer-connect endpoint if the agent uses lnd-gateway:

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/peers/connect \
  -d "{\"uri\": \"$LQWD_URI\"}" | jq .
```

## Step 3 (Optional but Recommended): Reachability Pre-Flight

Ask LQWD whether it can reach the agent's node BEFORE committing to a registration. This avoids a failed channel-open attempt counting as a strike against the 3-failure ban threshold.

```bash
curl -s -X POST https://api.lqwdclaw.bot/v1/internal/accounts/reachability-check \
  -H "Content-Type: application/json" \
  -d '{
    "pubkey": "02abc...66hex",
    "node_uri": "02abc...@1.2.3.4:9735"
  }' | jq .
```

Response indicates whether LQWD's node was able to establish a peer session. If `reachable: false`, fix the network issue (port forwarding, firewall, node uptime) BEFORE registering.

## Step 4: Register

```bash
curl -s -X POST https://api.lqwdclaw.bot/v1/internal/accounts/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-node-agent",
    "pubkey": "02abc...66hex",
    "node_uri": "02abc...@1.2.3.4:9735"
  }' | jq .
```

Both `pubkey` and `node_uri` are REQUIRED. A registration without `node_uri` will not receive a channel grant.

Response includes an `lqwd_` API key, `channel_granted: true`, and an initial `channel_status` (usually `pending`).

## Step 5: Poll Channel Status

```bash
curl -s https://api.lqwdclaw.bot/v1/internal/channel/status \
  -H "Authorization: Bearer $AGENT_API_KEY" | jq .
```

States: `pending` → `pending_open` → `open` (success) or `failed` (needs retry).

## Retry After Failure

If `channel_status == "failed"` and the agent has resolved the underlying issue (e.g., made the node reachable, fixed the `node_uri`, restarted LND), retry WITHOUT re-registering:

```bash
curl -s -X POST https://api.lqwdclaw.bot/v1/internal/channel/retry \
  -H "Authorization: Bearer $AGENT_API_KEY" | jq .
```

Behavior:
- If retry succeeds: the failure counter for this pubkey is reset.
- If retry fails: counts as another strike against `FAUCET_BAN_AFTER_FAILURES`.

Do NOT retry in a loop. Fix the underlying problem first, then retry once.

## 3-Failure Ban

`FAUCET_BAN_AFTER_FAILURES=3` — three failed channel-open attempts on the same pubkey result in a ban.

Failures are categorized in the audit trail (`/v1/audit/recent`):
- `ConnectPeer failure` — LQWD couldn't reach the agent's node
- `Funding broadcast failure` — on-chain funding transaction failed
- Other LND-side errors

A ban is permanent by default. Operators can convert a permanent ban to a time-bounded ban via the `/ban_pubkey` operator command (Phase 21 faucet-admin skill) — agents should contact the operator through normal support channels if they believe a ban was in error.

## Configuration (Operator Reference)

These values are set in `/etc/lnd-gateway/env`:

| Variable | Purpose |
|----------|---------|
| `FAUCET_CHANNEL_SIZE_SATS` | Advertised channel size. Must match `AdvertisedChannelSizeSats` in `internal/handlers/discovery.go`. A startup assertion refuses to boot on drift. |
| `FAUCET_PUSH_SATS` | Advertised push amount. Same consistency rule — must match `AdvertisedPushSats` in discovery. |
| `FAUCET_CHANNEL_CAP` | Max active (non-failed) channel grants. Production value: 10. |
| `FAUCET_BAN_AFTER_FAILURES` | Failed-open strike threshold before ban. Default: 3. |
| `LQWD_NODE_URI` | LQWD's own `pubkey@host:port`. Surfaced in `/v1/discovery` so agents can pre-connect. |

To change advertised values (size or push), edit the env file AND bump the matching constants in `internal/handlers/discovery.go` in lockstep, then rebuild. The startup assertion (commit 9b3a886) will refuse to start on drift.

## Failure Modes

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Registration returns `faucet_paused` | Operator paused the faucet | Wait; check `/v1/discovery` for `pause_reason` |
| Registration returns `cap reached` | `FAUCET_CHANNEL_CAP` exhausted | Wait for a grant to close or be failed out |
| `channel_status` stuck at `pending` with ConnectPeer error | LQWD can't reach the agent's node | Fix reachability, then call `/retry` |
| 3rd failure → `banned` | Pubkey hit the strike limit | Contact operator |
| Reachability check returns `reachable: false` | Port, firewall, or node_uri mismatch | Fix before registering; pre-flight doesn't count as a strike |

## Important Rules

- Never share internal gateway tokens or `GATEWAY_ADMIN_TOKEN`
- Agent API keys (`lqwd_...`) are safe to log at DEBUG but not at INFO
- Pubkeys and node URIs are public data — safe to share
- Do not make guarantees about channel uptime, liquidity, or ban appeals
- Always read advertised values from `/v1/discovery` — do not hardcode channel size or push amount

## What Changed in Phase 19/20/21

- **Phase 19** removed the credit-proxy path. The faucet is a real Lightning channel only. Channel size dropped from 100k to 20k, push dropped from 25k to 1,354 sats, and cap narrowed to a small allowlist (10 in production). All proxy-related endpoints (`/v1/internal/proxy/*`) and the tier-2 claim flow are gone.
- **Phase 20** added the 3-failure ban threshold (`FAUCET_BAN_AFTER_FAILURES`), the reachability pre-flight, and the `/v1/internal/channel/retry` endpoint for recovering from transient failures without burning the registration.
- **Phase 21** added operator-side time-ban and faucet-pause surfaces. Agents will see `faucet_paused: true` in `/v1/discovery` when a pause is in effect; respect it and do not attempt to register until the flag clears.
