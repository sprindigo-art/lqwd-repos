---
status: resolved
phase: 16-collector-enrichment-robust-log-capture
source: [16-VERIFICATION.md]
started: "2026-07-16"
updated: "2026-07-17"
---

## Current Test

[complete — canary UAT passed on lnd-ireland 2026-07-17]

## Tests

### 1. WR-03 — live severity chip rendering
expected: A real `[WRN]` log line captured by the collector renders with the `warn` chip in the UI, and a real `[CRT]` line renders with the `error`/critical chip — the two are visually distinct (not both red). The classification→level map (`_level_of` in `collect_telemetry.py:961`) is verified in code; this confirms it end-to-end through `narrowLevel` to the rendered chip.
result: passed — Proven on live data with a clean A/B. On the OLD collector, `warn` lines stored `level=error` (the bug); on the 16.06 collector (tick 2026-07-17 20:55:30Z) a real `warn` lnd line stored `level=warn`. `critical→error` and `other→error` also confirmed. Since the stored `level` is what `narrowLevel()` maps to the chip, correct storage = correct chip. (Literal browser render not separately eyeballed; data-layer mapping is the source of truth and is correct.)

### 2. Owner-side SQL apply + live canary tick
expected: After applying the owner-run SQL (`db/seed-log-patterns.sql` reseed + `scripts/fileserver/path-reconciler.sql`) against the `nodemon` DB owner-side, a live `*/5` collector tick on the canary (`lnd-ireland`) shows: (a) daemon logs (lnd/bitcoind/postgres) are tailed — `is_expected=true` rows are selected by `fetch_inventory`; (b) `COLLECTOR_VERSION=16.06` marker present; (c) the pinned absolute `/usr/local/bin/lncli` resolves (no `pubkey=none` skip under root/cron); (d) the D-08 channel-pointer gate resolves the channel → `releases/<version>/` and only performs a gated self-update.
result: passed — On lnd-ireland 2026-07-17: (a) cursor file `.log-cursors.json` shows lnd (72MB→EOF), bitcoind (297MB→EOF), postgres (0/0 empty) all tailed via read_since — native tailing + rotation-safe cursor confirmed; bitcoind/postgres captured 0 only because their content was quiet/non-matching, not skipped. (b) `collector version=16.06` logged each tick. (c) `pubkey=set` (no pubkey=none) with `lncli=/lnd/bashScripts/lncli-telemetry.sh`. (d) `D-08 gate: channel=canary -> version=16.06; self-update scoped to releases/16.06` then gated md5 pull `Updated collect_telemetry.py`. Bonus: capture-by-pattern caught a REAL production error (aiLiquidityManager DB-auth failure) the old 64KB tail was missing — operator fixed it and captures tapered 32→8→0. Info-tier suppressed to 0 exemplars (counts survive in log_patterns). Secret scan: 38 matches all benign (macaroon VALUE is `<redacted>` — redaction holds; the rest are "password authentication failed" wording).

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Notes / follow-ups (not UAT blockers)

- **IP:port normalization** — code-verified (`_normalize` collapses per-peer signatures) but no broken-pipe line occurred during the canary window to observe it live. Non-blocking.
- **Reconciler seeds `lnd` as `detection_method='native'`** for hosts that had no prior `lnd` row (15 non-canary hosts). lnd-ireland kept `pgrep` (pre-existing, COALESCE-preserved) and graded correctly. On the other hosts, `lnd` would be graded by `grade_native_service` as "unknown native service" — log capture still works via the decoupled tail, but the lnd RUNNING/health axis would be mis-graded. **Fix before P16-5 fleet promotion** (seed `lnd` as `pgrep`, keep bitcoind/postgres `native`). Tracked as a pre-promotion item.

## Gaps
