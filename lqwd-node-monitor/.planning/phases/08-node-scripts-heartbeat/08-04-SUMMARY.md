---
phase: 08-node-scripts-heartbeat
plan: 04
subsystem: live-canary-proof
tags: [exec-03, canary, lncli, updatechanpolicy, hmac, rls, self-update, lnd-0.20.1-beta]
requires:
  - phase: 08-01
    provides: "bounds + nodemon_node role + RLS (db/role-grants.sql)"
  - phase: 08-02
    provides: "check-queue + apply-fee executor (HMAC verify, node-side bounds, atomic claim)"
  - phase: 08-03
    provides: "distribution rail (nodemonDownload.sh, run_check-queue.sh, CRON_JOB_11) + md5 self-update"
provides:
  - "Live EXEC-03 happy-path proof on a real LND node: approved update_fee -> claimed -> HMAC-verified -> bounds-checked -> lncli applied -> succeeded -> visible on-node -> reverted"
  - "A1 closed: lncli updatechanpolicy global-flag spelling --tlscertpath/--macaroonpath CONFIRMED on LND 0.20.1-beta (no apply-fee argv change needed)"
  - "Deployment finding: cron PATH lacks /usr/local/bin -> check-queue's bare `lncli` needs LNCLI=/usr/local/bin/lncli pinned in the root-only .nodemon.env"
  - "A2 partial: inbound-fee fields stayed 0/0 across apply+revert; lnd#8614 reset NOT exercisable (canary channels carry no inbound fees)"
  - "Behavioral D-04/EXEC-01 self-update proof: a modified check-queue source re-pulls on the next tick (bidirectional), prior copy backed up to old-scripts/"
affects:
  - "v2.0 Phase 11 (telemetry ingestion reuses this heartbeat/executor pattern)"
  - "v2.0 Phase 13 (Node Detail + per-channel fee queue — two operator findings captured as todos, commit 6e720ad)"
tech-stack:
  added: []
  patterns:
    - "Single low-stakes canary channel + small nudge + mandatory revert + blocking human gate bounds the blast radius (D-12)"
    - "Operator-approved signed intent executed with on-node credentials; dashboard holds zero node credentials"
key-files:
  created:
    - .planning/phases/08-node-scripts-heartbeat/08-04-SUMMARY.md
  modified:
    - scripts/fileserver/CANARY-RUNBOOK.md  # (authored in Task 1; executed live in Task 2)
key-decisions:
  - "A1 CONFIRMED: LND 0.20.1-beta accepts --tlscertpath/--macaroonpath (the [ASSUMED] form) — apply-fee argv is correct as shipped, no change needed"
  - "Cron PATH gotcha: under the real */5 cron (minimal PATH /usr/bin:/bin) check-queue's bare `lncli` fails to derive identity_pubkey; pin LNCLI=/usr/local/bin/lncli in /lnd/nodemon/.nodemon.env (root-only). Worked interactively because the operator shell had /usr/local/bin in PATH."
  - "A2: inbound-fee reset (lnd#8614) could NOT be exercised — the canary channels have inbound_fee 0/0 baseline; recommend a targeted check on an inbound-fee-bearing channel, or proactively fold inbound-fee passthrough into apply-fee (Plan-02 Task 2d) before relying on it there."
  - "Two control-surface findings deferred to Phase 13 (todos committed 6e720ad): per-channel Node Detail fee queue without AI rec; one-click enqueue+approve (Option A — keep HMAC + node-side verify)."
patterns-established:
  - "Live revert via reused chanId/channelPoint from the original succeeded command, flipping only ppm — zero transcription risk"
requirements-completed: [EXEC-03]
duration: "live operator session"
completed: 2026-06-23
---

# Phase 8 Plan 04: Live Canary EXEC-03 Proof Summary

**The full signed-intent → node-execution path was proven LIVE on LQWD-Ireland: approved `update_fee` intents were claimed, HMAC-verified, bounds-checked, applied via `lncli updatechanpolicy`, reported `succeeded`, confirmed on-node, and reverted — and a modified `check-queue` was shown to actually re-pull on the next tick.**

## Canary Target

- **Node:** LQWD-Ireland — `0230b207b3385feddb1ed18d5c7a808015aeb668aaf9bf980bee62465a382112c1`
- **Build:** LND `0.20.1-beta` (commit `848b72ce96eb68fa90fd4336523ca4c59bddcd4c`)
- **Channels exercised (all low-stakes, mostly inactive):**
  - `1024943848780464130` (`18b4e119…:2`) — apply ppm 1→30, then revert 30→1 (base 1000, cltv 80)
  - `997414276675993605` (`4deb6160…:5`) — apply ppm 1→30, then revert 30→1 (base 0, cltv 80)
  - `966608159961645059` (`1810385824…:3`) — operator-intended apply (ppm 1, cltv 40→80); left as set (intentional, not reverted)

## What Was Proven

- **Apply lifecycle (EXEC-03 happy path):** four `update_fee` commands ran the full state machine `∅→pending_approval→approved→claimed→executing→succeeded`, each with a `command_executions` row and complete `command_audit` chain (operator actor for enqueue/approve, executor actor for claim/execute). Verified in the queue DB and the node-side `check-queue.log`.
- **On-node confirmation:** `lncli getchaninfo` showed each applied policy live (e.g. `1024943848780464130` at ppm 30 / base 1000 / cltv 80 post-apply).
- **Revert (D-12):** both nudged channels restored to ppm 1; queue fully drained (0 non-terminal commands). Fleet left as-found apart from the one intentional `966608…` change.
- **Self-update (D-04/EXEC-01):** with the queue drained, a trivial marker comment was appended to the fileserver source copy of `check-queue` (ORIG `09629fcf…` → NEW `4834133d…`). The next tick logged `check-queue differs (… ) — updating`, backed the prior copy up to `old-scripts/backup_20260623_171012/`, re-pulled the modified file (on-node md5 → NEW), and the marker was present on-node. Removing the marker and ticking again re-pulled the clean copy (md5 → ORIG, marker gone). Bidirectional re-pull confirmed.

## A1 / A2 Findings (the open questions this canary existed to close)

- **A1 — flag spelling: CONFIRMED.** `lncli --tlscertpath /lnd/tls.cert --macaroonpath /lnd/data/chain/bitcoin/mainnet/admin.macaroon getinfo` returns valid JSON on this build. The `[ASSUMED]` `--tlscertpath`/`--macaroonpath` in `apply-fee`/`check-queue` are correct — **no argv change required.**
- **A1.b — cron PATH gotcha (NEW, important).** The first live tick failed `could not derive identity_pubkey`. Root cause: `check-queue` invokes **bare `lncli`** (`LNCLI="${LNCLI:-lncli}"`), and `lncli` lives in `/usr/local/bin`, which the **cron environment drops** (minimal PATH `/usr/bin:/bin`). It worked once run interactively (operator shell has `/usr/local/bin`). **Fix applied on the canary:** `LNCLI=/usr/local/bin/lncli` pinned in the root-only `/lnd/nodemon/.nodemon.env`. This MUST be set on every node for the unattended `*/5` cron to work — see Follow-ups.
- **A2 — inbound-fee behavior: NOT exercisable here.** `inbound_fee_base_msat` / `inbound_fee_rate_milli_msat` stayed `0/0` across every apply and revert, so no lnd#8614 reset was observed — but the canary channels carry **no inbound fees**, so this is *not a definitive test*. Recommend re-checking on an inbound-fee-bearing channel before trusting `apply-fee` there, or proactively folding inbound-fee passthrough into `apply-fee`'s argv (Plan-02 Task 2d).

## Operational Findings (control surface — deferred to Phase 13, todos in 6e720ad)

- **Rec-card-only enqueue caused 3× channel mis-targeting.** The only enqueue entry point is AI recommendation cards (which only ever suggest *raising* ppm), so the operator could not reliably act on a specific channel or compose a revert. → todo `node-detail-all-channels-fee-queue`.
- **No "cancel approved" affordance.** An approved-but-unclaimed wrong-channel command can only clear via 24h TTL or a manual DB write — there is no reject for `approved`. → noted in the same todo.
- **Routing-warehouse staleness.** `lnd_node_channel_info` returned a Jan-14 snapshot as the latest row for a live channel, so per-channel current-fee values can be badly stale — a freshness signal is needed for any per-channel fee UI. → noted in the same todo.
- **Too many prompts.** Operator chose Option A (one-click enqueue+approve), keeping HMAC + node-side verify. → todo `one-click-enqueue-approve`.

## Verification

- Queue DB: all four applies + both reverts `state=succeeded` with `command_executions` + full `command_audit` chains; `0` non-terminal commands remaining.
- On-node: `lncli getchaninfo` confirmed live policies post-apply and post-revert (both target channels back to ppm 1).
- Self-update: on-node `md5sum /lnd/nodemon/check-queue` tracked the modified source and reverted to ORIG; prior copies in `old-scripts/`.

## PASS Criteria Scorecard (the live gate)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Approved `update_fee` applied + `succeeded` | PASS (4 applies, full audit) |
| 2 | New policy visible on-node; inbound-fee unchanged (A2) | PASS (visible); inbound 0/0 — lnd#8614 reset not exercisable |
| 3 | Revert restored original policy (D-12) | PASS (both channels back to ppm 1) |
| 4 | Flag spelling + inbound-fee recorded (A1/A2) | PASS (A1 confirmed + cron-PATH fix); A2 partial |
| 5 | Modified `check-queue` re-pulls (self-update, D-04) | PASS (bidirectional, with backup) |

**Verdict: the live gate PASSES.** The signed-intent execution path, on-node confirmation, revert, and self-update are all proven on a real node. A2's inbound-fee reset is the one item not fully exercised (no inbound fees on the canary channels) — recorded as a follow-up, not a blocker.

## Follow-ups

- **Per-node deploy step:** pin `LNCLI=/usr/local/bin/lncli` in each node's root-only `.nodemon.env` (cron PATH does not include `/usr/local/bin`). Consider hardening `check-queue` to resolve an absolute `lncli` (e.g. `command -v lncli` fallback) and/or documenting this in the runbook/README so it isn't rediscovered per node.
- **A2 closure:** exercise the inbound-fee path on a channel with non-zero inbound fees, or add inbound-fee passthrough to `apply-fee` (Plan-02 Task 2d) as defense-in-depth.
- **Phase 13:** the two control-surface todos (per-channel Node Detail fee queue; one-click enqueue+approve).
