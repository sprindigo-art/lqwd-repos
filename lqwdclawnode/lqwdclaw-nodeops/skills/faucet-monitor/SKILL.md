---
name: faucet-monitor
description: Passive Telegram surfacing of channel-faucet events — cap-hit, kill-switch, bans, rate-limit abuse, registrations, state transitions, daily sats pushed
---

# Faucet Monitor

Passive monitoring skill for the LQWDClaw channel faucet. Polls the gateway on
three cadences and surfaces events to the operator via Telegram using the
severity model from `skills/alert-escalation`.

This skill does **not** take action. It observes, classifies, and delivers.
Operator recourse lives in `skills/faucet-admin`.

## When to Use

- Runs continuously in the background once OpenClaw starts
- Emits alerts as events are detected on their respective polling cadences
- Operator reviews digests / daily summaries each morning or when pinged

Scenarios it covers:

- Channel faucet has exhausted advertised capacity (cap hit)
- Gateway kill-switch has engaged (all writes blocked)
- LQWD LND on-chain reserves are approaching force-close risk
- On-chain headroom no longer supports opening more faucet channels
- A pubkey has been auto-banned after 3 consecutive ConnectPeer/open failures
- A caller IP is hammering the rate limiter
- Day-over-day view of registrations, state transitions, and sats pushed

## Required Config / Environment

| Var / Path | Purpose |
|---|---|
| `/etc/lnd-gateway/agent-token` | Bearer token for gateway calls — same file every other skill reads. No new secret required. |
| `GATEWAY_BASE_URL` (default `http://127.0.0.1:7778`) | Gateway address. |
| Operator Telegram chat ID | Supplied by OpenClaw's existing delivery mechanism — this skill does not manage routing. |

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
    -d "{\"level\":\"warn\",\"source\":\"skill:faucet-monitor\",\"message\":\"gateway version drift: expected $EXPECTED_GATEWAY_VERSION got $_actual_version\"}" \
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
    -d "{\"level\":\"error\",\"source\":\"skill:faucet-monitor\",\"message\":\"skills symlink drift: expected $EXPECTED_SKILLS_TARGET got $_actual_target\"}" \
    http://127.0.0.1:7778/v1/internal/admin/alert >/dev/null || true
  _SKL04_ALERTED=1
fi
```

Both checks continue on failure — they are advisory alerts, not fatal guards
(D-15). Per-session dedupe flags keep one alert per drift (D-14).

**Log tail note:** faucet-monitor tails gateway structured logs for entries
with `source=skill:*` emitted by `/v1/internal/admin/alert` (SKL-03/SKL-04
drift) and forwards `level: warn|error` to the operator Telegram channel
using the existing severity model defined below. This closes the
operator-visibility loop (per project memory `feedback_operator_visibility`) —
skills never talk directly to Telegram; all bot-to-bot comms route through
the gateway's structured log surface so the operator sees everything.

## Severity Model

Mirrors `skills/alert-escalation`:

| Severity | Response Time | Action |
|----------|---------------|--------|
| CRITICAL | Immediate | Send Telegram DM to operator now |
| WARNING  | Within 1 hour | Accumulate into hourly digest |
| INFO     | Next daily report | Log, roll up into daily summary |

## Event Taxonomy

| Severity | Event | Source | Routing |
|---|---|---|---|
| CRITICAL | Faucet cap hit | count of non-failed grants | Immediate |
| CRITICAL | Kill-switch engaged | `/v1/health` | Immediate |
| CRITICAL | LQWD LND on-chain < 30,000 sats (reserve risk) | `/v1/wallet/balance` | Immediate |
| CRITICAL | On-chain headroom < 3 remaining faucet channels possible | derived | Immediate |
| WARNING | Pubkey hit 3-failure ban | channel_grants changes | Hourly digest |
| WARNING | Rate limit hit by same IP 3+ times / hour | `/v1/audit/recent` | Hourly digest |
| WARNING | ConnectPeer failure (pre-ban) | channel_grants changes | Hourly digest |
| INFO | New channel faucet registration | channel_grants | Daily summary |
| INFO | Channel state transition to active | channel_grants | Daily summary |
| INFO | Daily sats pushed (cumulative) | channel_grants | Daily summary |

## Poll Cadence

| Cadence | Scope | Endpoints |
|---|---|---|
| 5 minutes | CRITICAL events | `/v1/health`, `/v1/wallet/balance`, `/v1/channels`, `/v1/discovery`, `/v1/admin/api/channels` |
| 30 minutes | WARNING events | `/v1/admin/api/channels`, `/v1/audit/recent` |
| 24 hours (end-of-day, operator-local time) | INFO rollup | `/v1/admin/api/channels` |

All polling uses the agent bearer token. State between ticks (last-seen grant
timestamp, last-seen audit cursor, daily running totals) is held in skill-local
memory — this skill is idempotent across restarts because every classifier is
derivable from current gateway state.

## Derived Metrics

The gateway does not expose these precomputed; the skill computes them from raw
responses.

### On-chain headroom

Number of additional faucet channels the node can still open with current
on-chain balance, after reserving ~10,000 sats per existing anchor channel for
their anchor-output obligation.

```
headroom = floor(
  (wallet_balance - existing_anchor_channels * 10_000)
  / (faucet_channel_size + estimated_fee + 10_000)
)
```

Raw inputs:

- `wallet_balance` — `confirmed_balance` from `POST /v1/wallet/balance`
- `existing_anchor_channels` — count of entries in `POST /v1/channels` (anchor commitments are the default on LND ≥0.12)
- `faucet_channel_size` — `channel_faucet.channel_size_sats` from `GET /v1/discovery`
- `estimated_fee` — ~2,000 sats placeholder (replace with live fee estimator if available via `/v1/fees/estimate`)
- `10_000` — anchor reserve per channel

Fire CRITICAL when `headroom < 3`.

### Daily sats spent

Sum of `push_amount` across today's grants where `status != 'failed'`. Query
`POST /v1/admin/api/channels` and filter client-side by the day bucket in the
operator's local timezone.

```
daily_sats_spent = sum(grant.push_amount for grant in grants
                       if grant.created_at >= start_of_today_local
                       and grant.status != 'failed')
```

Roll this up into the daily INFO summary; it is not a CRITICAL trigger on its
own (cap-hit and headroom already bound the blast radius).

## Alert Formats

### CRITICAL (immediate DM)

```
[CRITICAL] LQWDClaw Faucet

Event: Faucet cap hit
Time: 2026-04-22T17:12:00Z
Details: 40 of 40 advertised faucet channels allocated (non-failed).
         New /v1/internal/accounts/register calls will be rejected.

Action required: Raise FAUCET_CHANNEL_CAP and redeploy, or invoke
                 /faucet_pause "cap reached" from faucet-admin to stop
                 advertising a faucet that cannot deliver.
```

```
[CRITICAL] LQWDClaw Faucet

Event: On-chain headroom exhausted
Time: 2026-04-22T17:12:00Z
Details: Wallet confirmed 82,000 sats. With 22,000 sats per channel
         (20k size + ~2k fee) and 10k anchor reserve, only 2 more
         faucet channels are fundable before reserve risk.

Action required: Top up on-chain wallet, or /faucet_pause until funds
                 are in place.
```

### WARNING (hourly digest)

```
[DIGEST] LQWDClaw Faucet — 4 warnings (last 60 min)

1. 3-failure ban: 03a1b2c3... — ConnectPeer failed 3x, auto-banned
2. 3-failure ban: 03d4e5f6... — channel-open failed 3x, auto-banned
3. Rate limit hit: IP hash 7f3c... hit /register limit 4x
4. Pre-ban ConnectPeer failure: 0399aabb... (2/3 failures)

Recommended admin actions:
- /unban_pubkey <hex>  to clear honest retries
- /ban_pubkey <hex> 7d for persistent abuse
- /reset_rate_limit <ip> for a confirmed-good caller
```

### INFO (daily summary)

```
[DAILY] LQWDClaw Faucet — 2026-04-22

Registrations today: 12
State transitions to active: 9
Pending / pending_open: 2
Failed (pre-ban): 1
Sats pushed (cumulative, today): 12,186
Current cap usage: 31 / 40 non-failed grants
On-chain headroom: 14 faucet channels

No CRITICAL events in last 24 h.
```

## Escalation Ladder

Mirrors `skills/alert-escalation` Escalation Chain:

1. **First fire**: Telegram DM to operator
2. **If unacknowledged after 15 min (CRITICAL faucet-cap-hit and headroom-exhausted only)**:
   re-fire with `[REMINDER]` prefix. Cap-hit and headroom are special —
   every minute of silence means honest agents are getting rejected at
   `/v1/internal/accounts/register`. Re-fire continues every 15 min until
   either:
   - operator invokes `/faucet_pause` via `faucet-admin`, or
   - the underlying condition clears (cap raised in env + redeploy, or
     wallet topped up)
3. **If unacknowledged after 30 min (other CRITICALs)**: re-fire with
   `[REMINDER]` prefix, then once per hour capped at 3 reminders.
4. **WARNING digests**: never re-fire. Next hour's digest supersedes.
5. **INFO summaries**: single daily delivery; no escalation.

Acknowledgement is implicit — operator sending any command matching
`/faucet_*` inside 15 min of the alert counts as acknowledged for the
same event class.

## Integration with faucet-admin

Every alert names the `faucet-admin` slash command the operator would use to
respond, so the DM is actionable without context-switching:

| Alert | Suggested action |
|---|---|
| Faucet cap hit | `/faucet_pause "cap reached"`, then redeploy with raised cap |
| Kill-switch engaged | operator-side investigation — faucet-admin cannot clear kill-switch (separate safety) |
| On-chain reserve < 30k sats | `/faucet_pause "reserve low"`, top up wallet |
| On-chain headroom < 3 | `/faucet_pause "headroom exhausted"`, top up wallet |
| 3-failure ban (honest retry) | `/unban_pubkey <hex>` |
| 3-failure ban (persistent abuser) | `/ban_pubkey <hex> 7d` for time-bounded ban, or `permanent` |
| ConnectPeer pre-ban (2/3) | observe only; if the 3rd fails the auto-ban fires |
| Rate limit repeat offender (IP) | `/reset_rate_limit <ip>` if confirmed-good, otherwise leave it |
| Registration / state transitions | informational; no action |
| Daily sats pushed | informational; no action |

Phase 21 endpoints referenced above (`/v1/internal/admin/channel/ban`,
`/v1/internal/admin/faucet/pause`, `/v1/internal/admin/faucet/resume`) are
added by the gateway work in the same phase and are called by `faucet-admin`
— this skill never calls them directly.

## Failure Modes

| Failure | Detection | Behaviour |
|---|---|---|
| Gateway unreachable (connection refused, timeout) | 3 consecutive 5-min polls fail | Emit a single CRITICAL `[gateway unreachable]` alert (do not re-fire until recovered). Resume normal polling once health returns. |
| `/v1/wallet/balance` returns a stale or clearly bogus value (e.g. negative, older than 1 h via header) | Value sanity check | Skip derived-metric alerts this tick (headroom / reserve). Log a WARNING internal note. Do not alert operator until 3 consecutive bogus reads. |
| `/v1/admin/api/channels` pagination drift (cursor gaps) | Missing grant IDs between polls | Refetch full page. If still inconsistent after retry, roll forward using the latest view — do not emit ghost transition alerts. |
| `/v1/audit/recent` returns empty while grants are clearly changing | Divergence between admin-channels and audit feed | Trust admin-channels; log a diagnostic INFO for the operator in the daily summary. |
| Agent token missing or rejected (401 / 403) | First poll after start | CRITICAL alert: "faucet-monitor cannot authenticate — check `/etc/lnd-gateway/agent-token`". Stop polling until operator resolves. |
| Discovery flag `channel_faucet.faucet_paused: true` already set | Every poll | Suppress cap-hit and headroom CRITICALs (the operator has already acknowledged). Other events continue to fire normally. |
| Clock skew between VM and operator local time | Daily summary boundaries drift | Align daily rollup to the operator-local TZ; use the VM's `date` as source of truth and tolerate ±1h drift in bucketing. |

## Important Rules

- This skill is read-only. Never POST to mutating endpoints from here.
- Never include the agent token, macaroon bytes, or raw pubkey secrets in
  Telegram messages. Pubkey prefixes (first 8 hex chars) are fine.
- Keep every DM under 500 characters for mobile readability. Digests and
  daily summaries can be longer but should still fit one Telegram message.
- Always verify a CRITICAL condition against live gateway state before
  firing — do not alert off cached counters.
- Do not fire on transient 5xx errors from a single poll; require two
  consecutive observations for any CRITICAL except kill-switch (which is a
  boolean and should alert on first observation).
- Suppress duplicate event emission within the same cadence window —
  cap-hit fires once, not once per polled grant.
