---
created: 2026-06-23T17:15:47Z
title: Harden check-queue lncli resolution for cron PATH (+ per-node LNCLI pin)
area: tooling
files:
  - scripts/node/check-queue:44
  - scripts/node/check-queue:73
  - scripts/fileserver/CANARY-RUNBOOK.md
  - scripts/fileserver/README.md
---

## Problem

`check-queue` invokes **bare `lncli`** (`LNCLI="${LNCLI:-lncli}"`), and `lncli`
lives in `/usr/local/bin`. The unattended `*/5` cron runs with a minimal PATH
(`/usr/bin:/bin`), which **drops `/usr/local/bin`** — so bare `lncli` is not
found, `getinfo` returns nothing, and the tick fails `could not derive
identity_pubkey`. It only worked during the 08-04 canary once run interactively
(the operator shell has `/usr/local/bin` in PATH). This means every node's
unattended cron will fail until fixed. See `08-04-SUMMARY.md` (A1.b).

## Solution

Two layers:

1. **Per-node deploy step (immediate):** pin `LNCLI=/usr/local/bin/lncli` in each
   node's root-only `/lnd/nodemon/.nodemon.env`. Add this to the bootstrap
   section of `CANARY-RUNBOOK.md` / `README.md` so it isn't rediscovered per node.
2. **Script hardening (durable):** make `check-queue` resolve an absolute `lncli`
   itself instead of relying on PATH — e.g.
   `LNCLI="${LNCLI:-$(command -v lncli || echo /usr/local/bin/lncli)}"`, or set a
   known PATH at the top of `run_check-queue.sh`. Re-run `bash -n` + the
   `tests/node/check-distribution-static.sh` gate after the change; ship via the
   md5 self-update rail (proven in 08-04).

Applies fleet-wide before the executor is rolled past the single canary node.
Related: the heartbeat/executor pattern is reused in v2.0 Phase 11.
