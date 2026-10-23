---
name: faucet-admin
description: Telegram slash-command handlers for operator-driven faucet administration (unban, ban, pause, resume, retry, revoke)
---

# Faucet Admin

Operator-facing slash commands that let the authorised Telegram chat drive all
faucet administration without SSH + curl. Five read-only inspection commands
and seven destructive commands. Every destructive action follows the
"echo parsed intent + await `confirm` reply within 60 s" pattern from
`lnd-payments` and is audit-tagged as `via-telegram-admin:<operator-tg-username>`
so actions trace back in `/v1/audit/recent`.

## When to Use

- Operator wants a live faucet-state summary from Telegram
- Operator needs to undo / apply / time-bound a pubkey ban without SSH
- Operator wants to retry a failed channel-faucet grant
- Operator wants to nuke an abusing agent (suspend + rotate key)
- Operator wants to pause / resume the channel faucet during maintenance
- Operator wants the current faucet configuration surfaced in-chat

Do NOT use this skill for:
- Changing advertised `channel_size` / `push_amount` (requires gateway edit
  + rebuild; startup assertion at commit `9b3a886` refuses to boot on drift)
- Runtime mutation of `FAUCET_CHANNEL_CAP` (needs hot-reload config phase)
- Operator's own channel-open / close / send operations — use `lnd-channels`
  and `lnd-payments` skills, which remain fully functional even while the
  faucet is paused

## Required config / environment

Read tokens at skill load. **Both files are the ONLY source of truth —
do NOT grep `/etc/lnd-gateway/env` for any token under any condition.**
`/etc/lnd-gateway/env` is root:lndgateway 0600 and deliberately not
readable by the agent user.

```bash
# Agent token for non-admin read calls
AGENT_TOKEN=$(cat /etc/lnd-gateway/agent-token)

# Admin token for destructive commands and admin-only read calls.
# Uses Phase 20 Bearer auth. Provisioned by the operator at deploy time
# from /etc/lnd-gateway/admin-token — root:openclaw 0640, same perms
# pattern as agent-token so the openclaw user can read it.
ADMIN_TOKEN=$(cat /etc/lnd-gateway/admin-token)

# Internal auth secret for defense-in-depth on /v1/internal/* paths.
# cfMw (the Cloudflare Access middleware) requires this header on every
# /v1/internal/* request that does NOT carry a valid CF Access JWT —
# localhost calls never have the JWT, so X-Internal-Auth is mandatory.
# Provisioned by the operator from INTERNAL_AUTH_SECRET in env into the
# dedicated file /etc/lnd-gateway/internal-auth (root:openclaw 0640).
INTERNAL_AUTH=$(cat /etc/lnd-gateway/internal-auth)

# ── Gateway health preamble (SKL-03 / SKL-04) ─────────────────────────
# Run ONCE at skill load. Advisory only: logs + posts an operator alert on
# drift, but does NOT abort execution (D-15). Reuses ADMIN_TOKEN +
# INTERNAL_AUTH read above. Per-session dedupe flags keep one alert per
# drift (D-14).

# SKL-03: Gateway version drift check
EXPECTED_GATEWAY_VERSION="v3.0.0"  # bump per release; matches ldflags -X main.Version
_actual_version=$(curl -sI http://127.0.0.1:7778/v1/health 2>/dev/null | grep -i '^x-gateway-version:' | awk '{print $2}' | tr -d '\r\n')
if [ -n "$_actual_version" ] && [ "$_actual_version" != "$EXPECTED_GATEWAY_VERSION" ] && [ -z "$_SKL03_ALERTED" ]; then
  echo "WARN: Gateway version drift: expected $EXPECTED_GATEWAY_VERSION, got $_actual_version" >&2
  curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Internal-Auth: $INTERNAL_AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"level\":\"warn\",\"source\":\"skill:faucet-admin\",\"message\":\"gateway version drift: expected $EXPECTED_GATEWAY_VERSION got $_actual_version\"}" \
    http://127.0.0.1:7778/v1/internal/admin/alert >/dev/null || true
  _SKL03_ALERTED=1
fi

# SKL-04: Skills symlink self-check
EXPECTED_SKILLS_TARGET="/opt/lqwdclawnode/lqwdclaw-nodeops/skills"
_actual_target=$(readlink -f /home/openclaw/nodeops/skills 2>/dev/null)
if [ -n "$_actual_target" ] && [ "$_actual_target" != "$EXPECTED_SKILLS_TARGET" ] && [ -z "$_SKL04_ALERTED" ]; then
  echo "ERROR: Skills symlink drift: expected $EXPECTED_SKILLS_TARGET, got $_actual_target" >&2
  curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Internal-Auth: $INTERNAL_AUTH" \
    -H "Content-Type: application/json" \
    -d "{\"level\":\"error\",\"source\":\"skill:faucet-admin\",\"message\":\"skills symlink drift: expected $EXPECTED_SKILLS_TARGET got $_actual_target\"}" \
    http://127.0.0.1:7778/v1/internal/admin/alert >/dev/null || true
  _SKL04_ALERTED=1
fi
```

**Header requirements:**
- Calls to `/v1/internal/admin/*` MUST include BOTH `Authorization: Bearer $ADMIN_TOKEN` AND `X-Internal-Auth: $INTERNAL_AUTH`.
- Calls to `/v1/internal/channel/retry` MUST include BOTH the agent's API-key Bearer AND `X-Internal-Auth: $INTERNAL_AUTH`.
- Calls to non-/v1/internal/* endpoints (e.g., `/v1/wallet/balance`, `/v1/channels`, `/v1/peers`) only need the Bearer token — no `X-Internal-Auth` required.

**Do NOT fall back to `grep GATEWAY_ADMIN_TOKEN /etc/lnd-gateway/env` or `grep INTERNAL_AUTH_SECRET /etc/lnd-gateway/env`.** The env file is root:lndgateway 0600 and cannot be read by the agent user on production. If either dedicated file is missing, reply with the failure-mode message below and stop.

- `GATEWAY_ADMIN_TOKEN` is required for every destructive command and for the
  `/v1/internal/admin/faucet/channels` listing used by `/faucet_status` and
  `/faucet_channels`. If the value cannot be read, the skill MUST reply with
  a clean configuration error (no token bytes in the error) and make NO
  gateway call.
- `OPERATOR_CHAT_IDS` — OpenClaw's existing operator-chat-ID whitelist. This
  skill reads that list at invocation time; see "Auth model" below.

## Auth model

Every command MUST pass two independent checks before any gateway call:

1. **OpenClaw operator-chat-ID whitelist** — the Telegram chat ID of the
   sender is compared against OpenClaw's existing whitelist. Non-whitelisted
   senders receive a generic "not authorized" reply and NO gateway call is
   made. Do not enumerate the command surface, do not reveal that the skill
   even exists beyond the refusal.

2. **`GATEWAY_ADMIN_TOKEN` Bearer forwarding** — forwarded on every admin
   call as:

   ```
   Authorization: Bearer <GATEWAY_ADMIN_TOKEN>
   ```

   This uses Phase 20's Bearer-accepting admin auth. The deprecated
   `X-Admin-Token` header is still accepted by the gateway for legacy
   compatibility only; new calls from this skill MUST use Bearer.

Every destructive call also sets an actor header for the audit trail:

```
X-Actor: via-telegram-admin:<operator-tg-username>
```

## Commands

### Read-only (no confirmation)

#### `/faucet_status`

Single-message summary of faucet state.

Fields:
- Grant counts by state: `pending`, `pending_open`, `open`, `failed`, `closed`
- Wallet balance (on-chain, from `/v1/wallet/balance`)
- On-chain headroom: `floor((wallet_balance - existing_anchor_channels × 10_000) / (channel_size + estimated_fee + 10_000))` — the number of additional faucet channels the wallet could still fund. Same formula used by `faucet-monitor`.
- Recent bans (last 24 h): grants where `banned = TRUE` OR `banned_until > NOW()`, from `/v1/internal/admin/faucet/channels`
- Recent fails (last 24 h)

Data calls (minimal — single admin call + wallet for headroom math):

```bash
# Server-side pre-aggregated summary. Returns counts-by-status,
# recent bans/fails, and faucet config in one response. NEVER count
# rows yourself — render the numbers in data.by_status verbatim.
SUMMARY=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "X-Internal-Auth: $INTERNAL_AUTH" \
  "https://api.lqwdclaw.bot/v1/internal/admin/faucet/summary")

# Wallet balance for the headroom calculation (not included in summary)
WALLET=$(curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST "https://api.lqwdclaw.bot/v1/wallet/balance" -d '{}')

# Existing anchor channel count (also for headroom)
CHANNELS=$(curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST "https://api.lqwdclaw.bot/v1/channels" -d '{}')
```

Render fields from the `SUMMARY.data` object EXACTLY:

| Output label | Source |
|---|---|
| open count | `.data.by_status.open` |
| pending_open count | `.data.by_status.pending_open` |
| pending count | `.data.by_status.pending` |
| failed count | `.data.by_status.failed` |
| closed count | `.data.by_status.closed` |
| pending_close count | `.data.pending_close_count` |
| force_close count | `.data.force_close_count` |
| Bans (24h) | `.data.recent_bans_24h` |
| Fails (24h) | `.data.recent_fails_24h` |
| Cap | `<by_status.open + by_status.pending_open>` / `.data.config.channel_cap` |
| Paused | `.data.config.faucet_paused` — render `yes`/`no` |
| Wallet | `WALLET.data.confirmed_balance` |
| Headroom | `floor((wallet_confirmed - existing_anchor × 10_000) / (.data.config.channel_size_sats + 2_000 + 10_000))` where `existing_anchor` = `CHANNELS.data.channels | length` |

**Counting rule (explicit):** every count rendered MUST come directly
from `.data.by_status`. Do NOT iterate the `.channels` array. Do NOT
sum in your head. If you need a count not present in `.data.by_status`,
that count is 0.

**Output rule (CRITICAL):** execute all shell commands silently. Your
Telegram reply MUST contain ONLY the formatted status message shown in
the "Example Telegram output" below — nothing else. Do NOT narrate the
bash commands, do NOT show `<execute_bash>` blocks, do NOT describe
what you're about to do, do NOT show intermediate JSON or reasoning.
The reply is ONLY the final formatted block. Start the reply with
"Faucet status —" and end with the Cap/Paused line. No prose before,
no prose after.

Example Telegram output:
```
Faucet status — 2026-04-22 18:14 UTC
Grants: 3 open · 1 pending_open · 0 pending · 2 failed · 5 closed
On-chain: 0 pending_close · 0 force_close
Wallet: 487,320 sats on-chain
Headroom: 12 more faucet channels fundable
Bans (24h): 1 active (04a1c2... until 2026-04-22 22:00 UTC)
Fails (24h): 2 (connect_peer_timeout × 2)
Cap: 3 / 20 · Paused: no
```

#### `/faucet_channels [state]`

Paginated list, 10 per page. Optional state filter:
`pending | pending_open | open | failed | closed`.

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "X-Internal-Auth: $INTERNAL_AUTH" \
  "https://api.lqwdclaw.bot/v1/internal/admin/faucet/channels?status=open&page=1&per_page=10"
```

Each row renders: `agent_name · pubkey[:8] · state · funding_txid[:8] · local/remote · age`.

Pagination: send `/faucet_channels next` to advance. The skill tracks the
last `(state, offset)` tuple per operator chat.

#### `/faucet_config`

Display-only. NO runtime mutation.

Shows:
- `channel_size_sats` — advertised channel size
- `push_sats` — advertised push amount
- `channel_cap` — max active grants
- `ban_after_failures` — 3-failure ban threshold
- `lqwd_node_uri` — for agent pre-connection
- `faucet_paused` — current pause state

All values come from a single token-authed gateway endpoint. Do NOT read
`/etc/lnd-gateway/env` (not agent-readable).

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "X-Internal-Auth: $INTERNAL_AUTH" \
  "https://api.lqwdclaw.bot/v1/internal/admin/faucet/config"
```

Footnote the skill MUST include in the reply:
> To change advertised values (channel size / push), edit
> `/etc/lnd-gateway/env` AND bump `AdvertisedChannelSizeSats` /
> `AdvertisedPushSats` in `internal/handlers/discovery.go` in lockstep, then
> rebuild. Startup assertion (commit `9b3a886`) refuses to boot on drift.

#### `/peers`

Two-section view.

- **Registered faucet agents** — LND peers whose `pub_key` appears in the
  faucet `channel_grants` rows. Cross-join skill-side: iterate `/v1/peers`
  peers, mark the ones present in `/v1/internal/admin/faucet/channels`.
- **Other peers** — everything else (watchtowers, manual peers,
  non-faucet channels).

```bash
# LND peers (base data: pub_key, online, bytes_sent/recv — NO alias)
PEERS=$(curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST "https://api.lqwdclaw.bot/v1/peers" -d '{}')

# All channels (for per-peer channel counts, grouped by remote pub_key)
CHANS=$(curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST "https://api.lqwdclaw.bot/v1/channels" -d '{}')

# Faucet grants (for registered-agent classification)
GRANTS=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "X-Internal-Auth: $INTERNAL_AUTH" \
  "https://api.lqwdclaw.bot/v1/internal/admin/faucet/summary")
```

For each peer in `PEERS.data.peers[]`, compute `num_channels` by
counting entries in `CHANS.data.channels[]` where `remote_pubkey ==
peer.pub_key`. Classify as "Registered faucet agent" if the peer's
`pub_key` appears in any grant from the channels endpoint (call
`/v1/internal/admin/faucet/channels` or use the summary's `total`
filter-path — simpler: any peer with `remote_pubkey` matching a faucet
grant is a registered agent).

Alias enrichment (optional, per-peer): `POST /v1/graph/node` with
`{pub_key}`. If omitted, render `—` for alias. Don't block the reply
on alias lookups.

Each row: `pubkey[:8] · alias_or_dash · online · num_channels`.

#### `/recent_registrations [hours=24]`

Audit-trail view. Default window 24 h.

```bash
# NOTE: /v1/audit/recent is POST (not GET). Body controls filtering.
curl -s -H "Authorization: Bearer $AGENT_TOKEN" \
  -X POST "https://api.lqwdclaw.bot/v1/audit/recent" \
  -d '{"hours": 24}'
```

Filter to registration-related events client-side (action contains
`register` / `reserve_channel_slot` / `claim-tier1`). Each row:
`ts · agent_name · ip_hash[:8] · outcome (success/failure/banned)`.

If the audit store is empty for the window, reply with `No
registrations in last {hours}h.` — do not fabricate entries.

### Destructive (echo-intent + `confirm` within 60 s)

All commands in this section follow this pattern exactly:

1. Parse the command → reply with the parsed intent in a structured echo.
2. Tell the operator to reply `confirm` (proceed) or `cancel` (abort) within
   60 s.
3. On `confirm`: issue the gateway call with `Authorization: Bearer
   $ADMIN_TOKEN` and `X-Actor: via-telegram-admin:<operator-tg-username>`.
4. On `cancel` OR silence for 60 s: auto-abort, reply "cancelled, no call
   made", and discard the parsed intent.

Echo template:
```
[confirm required] <action summary>
Target: <pubkey / ip / api_key / agent_id>
Effect: <one-line human description of the consequence>
Reply `confirm` within 60 s to proceed, or `cancel` to abort.
```

#### `/unban_pubkey <hex>`

Remove ban on a pubkey (both `banned = TRUE` and `banned_until > NOW()`).

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Internal-Auth: $INTERNAL_AUTH" \
  -H "X-Actor: via-telegram-admin:<operator-tg-username>" \
  -H "Content-Type: application/json" \
  "https://api.lqwdclaw.bot/v1/internal/admin/channel/unban" \
  -d '{"pubkey": "<hex>"}'
```

#### `/ban_pubkey <hex> <duration>`

Phase 21 NEW endpoint. Duration: `1h` | `24h` | `7d` | `permanent`.
`permanent` maps to `banned = TRUE`; others map to `banned_until = NOW() + d`.

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Internal-Auth: $INTERNAL_AUTH" \
  -H "X-Actor: via-telegram-admin:<operator-tg-username>" \
  -H "Content-Type: application/json" \
  "https://api.lqwdclaw.bot/v1/internal/admin/channel/ban" \
  -d '{"pubkey": "<hex>", "duration": "24h"}'
```

Skill-side duration validation BEFORE the echo: reject garbage with a
parse error, no confirmation flow spawned.

#### `/reset_rate_limit <ip>`

Reset the per-IP rate-limit counter.

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Internal-Auth: $INTERNAL_AUTH" \
  -H "X-Actor: via-telegram-admin:<operator-tg-username>" \
  -H "Content-Type: application/json" \
  "https://api.lqwdclaw.bot/v1/internal/admin/accounts/reset-rate-limit" \
  -d '{"ip_address": "192.0.2.5"}'
```

#### `/retry_channel <api_key>`

Retry a failed channel-faucet grant. The call is made WITH THAT KEY'S Bearer
(the agent's own token), NOT the admin token — the retry endpoint is
agent-scoped by design.

```bash
curl -s -X POST \
  -H "Authorization: Bearer <api_key>" \
  -H "X-Internal-Auth: $INTERNAL_AUTH" \
  -H "X-Actor: via-telegram-admin:<operator-tg-username>" \
  -H "Content-Type: application/json" \
  "https://api.lqwdclaw.bot/v1/internal/channel/retry" \
  -d '{}'
```

The operator supplies the `<api_key>`. Skill MUST NOT log or echo the key
bytes in the confirmation message — echo only a prefix (`<api_key>[:8]...`).

#### `/revoke_agent <agent_id_or_api_key>`

Nuclear option. Suspends the agent AND rotates its API key. Wraps the
existing `SuspendAgent` + `RotateKey` flow.

```bash
# 1) Suspend
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Internal-Auth: $INTERNAL_AUTH" \
  -H "X-Actor: via-telegram-admin:<operator-tg-username>" \
  -H "Content-Type: application/json" \
  "https://api.lqwdclaw.bot/v1/internal/admin/agents/suspend" \
  -d '{"agent_id": "<id>"}'

# 2) Rotate
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Internal-Auth: $INTERNAL_AUTH" \
  -H "X-Actor: via-telegram-admin:<operator-tg-username>" \
  -H "Content-Type: application/json" \
  "https://api.lqwdclaw.bot/v1/internal/admin/agents/rotate-key" \
  -d '{"agent_id": "<id>"}'
```

If the first call fails, do NOT issue the second; surface the error and
stop. Do not leak the rotated key to the chat; confirm the action succeeded
without echoing the new key bytes.

#### `/faucet_pause <reason>`

Phase 21 NEW endpoint. Stops new channel-faucet reservations immediately.
Faucet-only scope — the operator's own channel-open / close / send
operations are UNAFFECTED.

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Internal-Auth: $INTERNAL_AUTH" \
  -H "X-Actor: via-telegram-admin:<operator-tg-username>" \
  -H "Content-Type: application/json" \
  "https://api.lqwdclaw.bot/v1/internal/admin/faucet/pause" \
  -d '{"reason": "planned maintenance", "actor": "<operator-tg-username>"}'
```

After 200, `/v1/discovery` returns `channel_faucet.faucet_paused: true` with
the reason, so honest agents skip `/register` rather than burning a slot.

#### `/faucet_resume`

Phase 21 NEW endpoint. Removes the pause file-flag.

```bash
curl -s -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "X-Internal-Auth: $INTERNAL_AUTH" \
  -H "X-Actor: via-telegram-admin:<operator-tg-username>" \
  -H "Content-Type: application/json" \
  "https://api.lqwdclaw.bot/v1/internal/admin/faucet/resume" \
  -d '{"actor": "<operator-tg-username>"}'
```

### Out of scope (mention to operator; defer)

- `/faucet_config set <key> <value>` — runtime mutation of config values.
  Requires a hot-reload config architecture (DB-backed, schema-validated)
  before it can be safely added. Until then, edit `/etc/lnd-gateway/env`
  and restart.
- `/faucet_expand <N>` — hot-reload of `FAUCET_CHANNEL_CAP`. Same
  prerequisite. Out of Phase 21.

If an operator invokes either of these, the skill should reply with a short
explanation of why they are deferred and point at the env + restart path.

## Failure modes

| Failure | Skill behaviour |
|---|---|
| Non-operator chat invokes any command | Silent generic "not authorized" reply. No gateway call. Do not reveal the command surface. |
| `GATEWAY_ADMIN_TOKEN` missing / unreadable | Clean config error to the operator (e.g., "admin token not readable — ensure `/etc/lnd-gateway/admin-token` exists and is group-readable by the openclaw user, or that `/etc/lnd-gateway/env` is readable"). No token bytes in the message. No gateway call. |
| Gateway unreachable (connection refused / DNS) | Report transport error to the operator and retry once after 2 s. If second attempt fails, surface and stop. Never burn the confirmation on a transport failure — on destructive commands, the confirmation window remains valid for a manual retry within 60 s. |
| Gateway returns 5xx | Surface the status + truncated body to the operator. Do NOT auto-retry destructive calls on 5xx (risk of partial-success double-apply). Operator re-runs the command from scratch. |
| Gateway returns 4xx (e.g., duration parse error server-side) | Surface the structured error. Do not retry. |
| Confirmation timeout (60 s with no `confirm` / `cancel`) | Auto-cancel, reply "cancelled — timeout, no call made", discard parsed intent. |
| Operator replies anything other than `confirm` or `cancel` during window | Reply "unrecognised — reply `confirm` or `cancel`". Timer keeps running. |
| Two destructive commands issued before first is confirmed | Reject the second with "previous confirmation still pending — `cancel` it first". |
| `/retry_channel` called with a malformed `<api_key>` | Skill-side validation rejects before echo. No confirmation spawned. |

## Important rules

- Every destructive command echoes parsed intent and waits 60 s for `confirm`
  before calling the gateway. No exceptions.
- `X-Actor: via-telegram-admin:<operator-tg-username>` on every admin call,
  every time, for audit traceability.
- Never log, echo, or store the admin token bytes, agent api-key bytes, or
  the rotated key from `/revoke_agent`. Prefixes only.
- Do not reveal the command surface to non-operators.
- Read-only commands may be issued in parallel; destructive commands are
  strictly one-at-a-time per operator chat.
- `faucet_pause` stops the faucet only. The operator's own
  channel-open / close / send operations MUST remain functional; if a pause
  affects them, that is a gateway bug, not skill behaviour.
