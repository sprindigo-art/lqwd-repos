---
created: 2026-06-23T17:15:47Z
title: Close A2 — exercise inbound-fee (lnd#8614) on an inbound-fee-bearing channel
area: tooling
files:
  - scripts/node/apply-fee
  - .planning/phases/08-node-scripts-heartbeat/08-04-SUMMARY.md
---

## Problem

The 08-04 canary could NOT close A2 (does `lncli updatechanpolicy` silently reset
inbound fees, per lnd#8614?). The canary channels carry `inbound_fee 0/0`, so the
fields stayed `0/0` across apply+revert — consistent with "no reset" but **not a
real test** (nothing to reset). If the pilot build *does* reset inbound fees,
`apply-fee` would silently zero an operator's inbound-fee policy on any channel
that uses them.

## Solution

Pick ONE of:

1. **Verify:** on a channel with **non-zero** inbound fees, capture the full
   before-policy, run one `apply-fee` (small outbound nudge), and diff the
   `inbound_fee_base_msat` / `inbound_fee_rate_milli_msat` fields before/after. If
   unchanged, A2 is closed; if reset, do option 2.
2. **Defend proactively:** fold inbound-fee passthrough into `apply-fee`'s argv
   (Plan-02 Task 2(d)) — pass `--inbound_base_fee_msat` / `--inbound_fee_rate_ppm`
   from the captured policy so a build that resets them is a no-op. Ship via the
   md5 self-update rail.

Until closed, do not rely on `apply-fee` for channels that carry inbound fees.
