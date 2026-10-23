# NodeMonitor fileserver scripts (EXEC-01 distribution rail)

Version-controlled source-of-truth copies of the NodeMonitor node-side
distribution scripts. The live fleet rail lives **outside this repo** (on the
operator machine at `/Users/joshuajackson/Desktop/LQwD/code/platform/tools/bashScripts/`
and on the fileserver under `~/nodemon` + `~/bashScripts`). These files mirror
the existing fleet pattern exactly — **no new distribution channel is invented**
(D-01). The operator copies them onto the fileserver during the Plan 04
bootstrap.

## Files

| File | Ships in (fileserver) | Lands on node | Role |
|------|----------------------|---------------|------|
| `nodemonDownload.sh` | `~/bashScripts/` | `/lnd/bashScripts/` | Pulls `~/nodemon/*` → `/lnd/nodemon`, `chmod +x` the executors |
| `run_check-queue.sh` | `~/bashScripts/` | `/lnd/bashScripts/` | `*/5` heartbeat: md5 self-update of executors, then invokes `check-queue` |
| `updateCrontab.snippet.sh` | n/a (splice source) | n/a | The `CRON_JOB_11` constant + idempotent merge block to paste into the live `updateCrontab.sh` |
| `check-queue`, `apply-fee` | `~/nodemon/` | `/lnd/nodemon/` | The executors themselves (authored in a sibling plan) |

## Deploy layout (PATTERNS Open-Q2 resolution)

Two pulls, two folders — matching the established fleet split:

1. **`~/bashScripts/` → `/lnd/bashScripts/`** via the existing all-folder
   `bashScriptDownloader.sh`. This carries `run_check-queue.sh` and
   `nodemonDownload.sh` (the wrappers/runners live alongside the other fleet
   runners).
2. **`~/nodemon/` → `/lnd/nodemon/`** via the dedicated `nodemonDownload.sh`.
   This carries the `check-queue` + `apply-fee` executors and is where the
   `*/5` runner reads/writes its log (`/lnd/nodemon/check-queue.log`).

`run_check-queue.sh` also self-updates the two executors each tick via md5
compare (back up to `/lnd/nodemon/old-scripts/backup_<TS>/` before scp), so a
dashboard-side fix to `check-queue`/`apply-fee` propagates within one heartbeat.

## `*/5` heartbeat (D-02 / D-09)

The cron line is added to the fleet `updateCrontab.sh` via the
`updateCrontab.snippet.sh` pieces:

```
*/5 * * * * /lnd/bashScripts/run_check-queue.sh >> /lnd/nodemon/check-queue.log 2>&1
```

- Splice **piece (a)** (the `CRON_JOB_11` constant) after `CRON_JOB_10`.
- Splice **piece (b)** (the `grep -Fxq` merge) before the final
  `crontab "${TEMP_CRON_FILE}"` load.

`grep -Fxq` makes the merge idempotent — re-running on every downloader tick
refreshes the line without duplicating it. The `*/5` cadence matches the fleet
default and sets the stale-claim reaper window to ≈ 15 min (3× the tick, D-09).

There is **no persistent daemon, agent, or AI** on the node — only this cron
line.

## One-time manual bootstrap (D-04)

On the pilot/canary node, the operator runs the downloader once by hand; it
scp's the scripts down and writes its crontab line. From then on the existing
~30-min downloader cron self-updates everything, and the `*/5` runner
self-updates the executors.

## Secret placement — out of band, NEVER in this channel (D-03)

The per-node HMAC secret and the node's DB connection creds live in a
**root-only env file pre-placed once by provisioning** — the same convention as
`/lnd/id_rsa`, `/lnd/tls.cert`, and the admin macaroon. The executors source
that local file at runtime.

**None of the scripts in this folder carry, reference, or ship that secret.**
The distribution channel (`scp` pull) transports executor scripts only. This is
asserted statically by `tests/node/check-distribution-static.sh`, which fails if
any secret token appears in the fileserver scripts.
