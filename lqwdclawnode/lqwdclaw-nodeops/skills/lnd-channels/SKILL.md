---
name: lnd-channels
description: List all open Lightning Network channels with capacity, balance, and status
---

# LND Channels

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
    -d "{\"level\":\"warn\",\"source\":\"skill:lnd-channels\",\"message\":\"gateway version drift: expected $EXPECTED_GATEWAY_VERSION got $_actual_version\"}" \
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
    -d "{\"level\":\"error\",\"source\":\"skill:lnd-channels\",\"message\":\"skills symlink drift: expected $EXPECTED_SKILLS_TARGET got $_actual_target\"}" \
    http://127.0.0.1:7778/v1/internal/admin/alert >/dev/null || true
  _SKL04_ALERTED=1
fi
```

Both checks continue on failure — they are advisory alerts, not fatal guards
(D-15). Per-session dedupe flags keep one alert per drift (D-14).

## List All Channels
```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -X POST http://127.0.0.1:7778/v1/channels \
  -d '{}' | jq .
```

Returns an array of channels, each with:
- `chan_id` — unique channel identifier
- `remote_pubkey` — peer's public key
- `capacity` — total channel capacity in sats
- `local_balance` — your side (outbound liquidity)
- `remote_balance` — their side (inbound liquidity)
- `active` — whether the channel is currently active
- `private` — whether the channel is private (not announced to network)
- `initiator` — whether you opened the channel
- `total_satoshis_sent` — lifetime sats sent through this channel
- `total_satoshis_received` — lifetime sats received through this channel
- `num_updates` — number of commitment updates (indicates activity)
- `pending_htlcs` — currently in-flight HTLCs

## List Pending Channels

Phase 22 SKL-01: operator-facing view of on-chain channel state buckets that
`/v1/channels` (open-only) does not expose. Useful for investigating stuck
`pending_open` grants, auditing force-close exposure, and sourcing the
`pending_close_count` / `force_close_count` fields surfaced in the
faucet-admin `/faucet_status` summary.

```bash
curl -s -H "Authorization: Bearer $(cat /etc/lnd-gateway/agent-token)" \
  -H "X-Internal-Auth: $(cat /etc/lnd-gateway/internal-auth)" \
  -X POST http://127.0.0.1:7778/v1/channels/pending \
  -d '{}' | jq .
```

Returns five top-level fields inside `data`:

- `pending_open_channels` — array of `{channel_point, remote_node_pub, capacity, local_balance, remote_balance}`
- `pending_closing_channels` — same shape
- `pending_force_closing_channels` — same shape
- `waiting_close_channels` — same shape
- `total_limbo_balance` — int64 sats, sum of funds currently unspendable due to pending state

The response is an allowlisted struct (not a raw LND passthrough) — no
funding-txid / counterparty-pubkey leakage per D-20. The endpoint lives on
the internal surface and is not advertised via Caddy's `api.lqwdclaw.bot`
allowlist; only localhost callers reach it.

Called by the faucet-admin `/pending_channels` command and surfaced in
faucet-monitor daily digests.

## How to Present
Use a table format:

```
| Peer (short) | Capacity | Local | Remote | Balance % | Active | HTLCs |
|---|---|---|---|---|---|---|
| 03peer1...44 | 5,000,000 | 3,000,000 | 2,000,000 | 60/40 | Yes | 0 |
```

- "Balance %" shows local/remote as a percentage
- Flag channels where local balance < 10% capacity as "low outbound"
- Flag channels where remote balance < 10% capacity as "low inbound"
- Flag inactive channels prominently
- Flag channels with pending HTLCs

## Aggregation
After the table, show totals:
- Total channels (active/inactive)
- Total capacity
- Total local balance
- Total remote balance
- Average balance ratio
