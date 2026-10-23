---
phase: 16-collector-enrichment-robust-log-capture
verified: 2026-07-16T18:53:23Z
status: passed
score: 34/34 must-haves verified
overrides_applied: 0
human_verification_result: "PASSED on lnd-ireland canary 2026-07-17 — see 16-HUMAN-UAT.md. WR-03 proven live (old collector warn→error vs 16.06 warn→warn at 20:55:30Z); native tailing confirmed via .log-cursors.json (lnd/bitcoind/postgres all read to EOF); capture-by-pattern caught a real aiLiquidityManager DB-auth error; info-tier suppressed to count-only; redaction holds (macaroon=<redacted>); D-08 gated canary pull + pubkey=set + version=16.06. Post-UAT reconciler fix (lnd pgrep not native) committed."
re_verification:
  previous_status: human_needed
  note: "First goal-backward verification; runs AFTER the 16-REVIEW code-review + fix cycle (7 fix commits). All CR/WR fixes independently re-checked in current code. Status advanced human_needed→passed after the 2026-07-17 canary UAT."
human_verification:
  - test: "On a live canary tick, emit or find one warn line (e.g. `[WRN]` HSWC failing link / closechannel) and one critical line (e.g. LND `[CRT]`), then open the node's log stream in the UI."
    expected: "The warn line renders with a warn chip and the critical line with an error chip — NOT both red 'error'. Confirms WR-03 (level derived from classification via _level_of) works end-to-end against real fleet data, not just the unit map."
    why_human: "The classification->level mapping is verified in code (collect_telemetry.py:_level_of + extract_events level=_level_of(classification)), but end-to-end chip rendering requires a real warn/critical log line flowing collector -> nodemon DB -> read layer -> UI, which cannot run in this static verification environment."
  - test: "Apply the owner-side SQL (16-04 db/seed-log-patterns.sql reseed + 16-05 scripts/fileserver/path-reconciler.sql) against the live nodemon DB as owner, then run one canary collector tick and check the tick log + service_log_events."
    expected: "Reconciler UPSERTs lnd/bitcoind/postgres daemon rows with is_expected=true, detection_method='native'; fetch_inventory keeps them; lnd.log is tailed and `[CRT]` lines captured. COLLECTOR_VERSION=16.06 and a resolved absolute lncli path (pubkey set, not none) appear in the tick log."
    why_human: "The SQL artifacts and collector code are correct and verified statically, but owner-side application + a live tick against a real LND/Postgres node is a deployment-time operation outside this environment."
---

# Phase 16: Collector Enrichment + Robust Log Capture Verification Report

**Phase Goal:** Make the */5 telemetry collector operationally robust before the AI/incident layer consumes its data — widen and harden log capture so real errors are reliably recorded fleet-wide.
**Verified:** 2026-07-16T18:53:23Z
**Status:** human_needed
**Re-verification:** No — initial goal-backward verification (post code-review fix cycle)

## Goal Achievement

Verification ran goal-backward against the three ROADMAP success criteria (COL-04/05/06) and the 34 plan-frontmatter truths across the six 16-0x plans. Every truth resolves to code-level VERIFIED. Because the collector is a node-side runtime that cannot execute in this static environment, two end-to-end behaviors are routed to human verification (WR-03 chip rendering; owner-side SQL apply + live tick). No BLOCKERs remain — the two REVIEW critical fixes (CR-01, CR-02) both hold in current code.

### Observable Truths

| # | Truth (grouped by plan / requirement) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | 16-01: RED test scaffolding for cursor/rotation/capture/tier/IP:port + TS taxonomy + AP-12 regression guard | ✓ VERIFIED | `test_extract.py` runs 43 tests OK; imports `collect_telemetry`; `service-log-events.test.ts` + `ap12-advisory.test.ts` present |
| 2 | COL-04: read offset->EOF each tick (no fixed 64KB tail) — early-interval `[ERR]` captured | ✓ VERIFIED | `read_since` (collect_telemetry.py:648) resumes from `prev.offset`; `INITIAL_TAIL_BYTES` demoted to first-sight-only (L68/684) |
| 3 | COL-04: only complete newline-terminated lines emitted; offset parks at trailing partial | ✓ VERIFIED | L698-714 `last_nl = raw.rfind(b"\n")`, `complete = raw[:last_nl+1]`, offset advances to `last_nl+1` |
| 4 | COL-04: first sight seeds near EOF, never full history | ✓ VERIFIED | L684 `start = max(0, st.st_size - INITIAL_TAIL_BYTES)` + forward newline-align L685-687 |
| 5 | COL-04: inode-change / size-shrink detected as rotation; previous file drained before reset | ✓ VERIFIED | L672-679 rotation branch + `_drain_previous` (L727) drains newest archive from prev.offset |
| 6 | COL-04: Postgres timestamped filenames -> newest glob match keyed by stable source_key | ✓ VERIFIED | `resolve_artifact` (L627) glob newest-match; source_key = service_name survives day-roll |
| 7 | COL-04: per-tick reads bounded by MAX_BYTES_PER_TICK with LOGGED truncation, remainder deferred | ✓ VERIFIED | L691-696 caps at 8 MB with `log("TRUNCATED tail ...")`; WR-01 oversize-line livelock fixed L699-711 |
| 8 | COL-04: cursor in /lnd/nodemon/.log-cursors.json (LOCAL), written atomically; SELECT-only preserved | ✓ VERIFIED | `CURSOR_FILE` L74; `save_cursors` os.replace L777; no warehouse write of cursor |
| 9 | COL-05: line captured iff log_patterns_config regex match (not single error_pattern substring) | ✓ VERIFIED | `extract_events` L949-954 `_classify` gate; substring kept only for error_count axis |
| 10 | COL-05: tier gating info->0 / warn->KEEP_N / critical->KEEP_N_CRITICAL; aggregate count bumped for ALL; tier READ from classification | ✓ VERIFIED | `_tier_of` L890, exemplar caps L984-990, aggregate `sig_tick_count` L1002 unconditional |
| 11 | COL-05: native services (postgres/bitcoind) log-tailed via cursor, decoupled from detection_method | ✓ VERIFIED | L1805-1818 native artifact_path tailed via `read_since` + `extract_events` regardless of native branch |
| 12 | COL-05: Postgres tailed ONCE via cursor, text fanned to BOTH count + extract (no double-tail) | ✓ VERIFIED | L1819-1820 `pg_log_text = native_text` reused by `probe_pg_health` L1821 — single read_since |
| 13 | COL-05: IP:port normalized so per-peer broken-pipe lines collapse to one signature | ✓ VERIFIED | `_RE_IP_PORT` L802 + `_normalize` L822 sub `<addr>` before signature hash L944 |
| 14 | COL-06: log_patterns_config re-derived into info/warn/critical from real signatures | ✓ VERIFIED | `seed-log-patterns.sql` DELETE+reseed L61-70; info/warn/critical rows L72-91 |
| 15 | COL-06: each pattern carries human-readable category label | ✓ VERIFIED | `category` column added L57; rows carry chain-sync-noise / conn-noise / etc. |
| 16 | COL-06: additive nullable category applied owner-side SQL (never push), reflected in schema | ✓ VERIFIED | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS category` L57; `category: text("category")` schema L355 |
| 17 | COL-06: read-layer config_id PK join unchanged; config_id=NULL survives; no branch on ap11/ap12 | ✓ VERIFIED | `service-log-events.ts` L84 `LEFT JOIN ... c.id = e.config_id`; narrowLevel off row.level L98-124 |
| 18 | COL-06: AP-12 pg_health-counter detector untouched (D-04) | ✓ VERIFIED | `ap12-advisory.test.ts` regression guard present; tsc clean |
| 19 | COL-06 (16-05): guarded UNIQUE (host_id, service_name) asserted before UPSERT | ✓ VERIFIED | `path-reconciler.sql` L42-46 DO $$ IF NOT EXISTS ADD CONSTRAINT service_inventory_host_service_uniq |
| 20 | COL-06 (16-05): owner-run reconciler UPSERTs daemon paths per hosts row, no SSH | ✓ VERIFIED | L80-94 INSERT...SELECT FROM hosts CROSS JOIN VALUES; ON CONFLICT DO UPDATE |
| 21 | COL-06 (16-05): auto-registers lnd/bitcoind/postgres fleet-wide; re-run self-heals; no canary clobber | ✓ VERIFIED | COALESCE(existing, excluded) on detection_method/is_expected L93-94 preserves canary values |
| 22 | COL-06 (16-05): reconciler separate owner artifact; collector stays SELECT-only; DDL not push | ✓ VERIFIED | Owner-scoped SQL file; no GRANT on service_inventory; no collector write path |
| 23 | COL-06 (16-05): seed-dimensions documents fleet daemon paths/globs (postgres glob, lnd stable) | ✓ VERIFIED | `postgresql-*.log` glob present; lnd stable path; canary-row note |
| 24 | COL-06 (16-06): absolute LNCLI_BIN default fixes root/cron pubkey=none | ✓ VERIFIED | `deploy-env.sh` L65 `${LNCLI_BIN:-$(command -v lncli || echo /usr/local/bin/lncli)}` + absolute guard L73-75 |
| 25 | COL-06 (16-06): collector logs resolved lncli path, WARNs pubkey=none, emits COLLECTOR_VERSION each tick | ✓ VERIFIED | `COLLECTOR_VERSION="16.06"` L54; `resolved_lncli_path` L107; tick log L1830-1834 (no warehouse write) |
| 26 | COL-06 (16-06): run wrapper reads NODEMON_CHANNEL, gates self-update to pinned channel version | ✓ VERIFIED | `read_channel`/`resolve_channel_version` L102-120; scoped `REMOTE_PAYLOAD_DIR=releases/<version>` L146; fail-safe SKIP L144 |
| 27 | COL-06 (16-06): esplora stale-row cleanup + tunables reviewed; CANARY-RUNBOOK documents channel promotion | ✓ VERIFIED | esplora NO-DATA branch; MAX_BYTES_PER_TICK 8 MB confirmed; CANARY-RUNBOOK Phase-16 section (P16-0..P16-5) |
| 28 | COL-06 (16-06): rollout gate is bash + local channel file; collector stays SELECT-only | ✓ VERIFIED | No new INSERT/UPDATE/GRANT in wrapper or downloader; channel pin read from env file |
| 29 | CR-01 fix: reconciler sets is_expected/detection_method so lnd logs are tailed | ✓ VERIFIED | path-reconciler.sql L81-82 inserts native/true/300; fetch_inventory expected-set now retains daemon rows |
| 30 | CR-02 fix: nodemonDownload.sh no longer blanket-scp's collector payload | ✓ VERIFIED | L58-59 pulls only `check-queue apply-fee *.sh`; collect_telemetry.py/requirements.txt/releases excluded |
| 31 | WR-01 fix: oversized newline-less line advances cursor (no livelock) | ✓ VERIFIED | L699-711 `if last_nl < 0 and pending > MAX_BYTES_PER_TICK: new_offset = start + len(raw)` + log |
| 32 | WR-02 fix: seed/runbook counts reconciled to 8 expected + 2 not-expected | ✓ VERIFIED | seed-dimensions.sql L14-20 "8 expected + 2 not-expected"; CANARY-RUNBOOK T1c L395-397 matches |
| 33 | WR-04 fix: probe password fed via psql stdin here-doc, not command line | ✓ VERIFIED | deploy-env.sh L101-108 here-doc CREATE ROLE, single-quote-escaped; no `-c "...PASSWORD..."` argv leak |
| 34 | WR-05 fix: retention windows rekeyed to live taxonomy; critical given bounded window | ✓ VERIFIED | LOG_RETENTION_WINDOWS L1630 keyed on info/warn/critical/other; dead benign/ap11/ap12 removed |

**Score:** 34/34 truths verified (code level). 2 behaviors routed to human for live/end-to-end confirmation.

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `scripts/fileserver/collect_telemetry.py` | read_since/cursor, extract_events capture-by-pattern, tier gating, IP:port norm, COLLECTOR_VERSION, WR-01/03/05 fixes | ✓ VERIFIED | All patterns present; imported by test_extract.py; 43 tests pass |
| `scripts/fileserver/path-reconciler.sql` | guarded UNIQUE + convention UPSERT with is_expected/detection_method (CR-01) | ✓ VERIFIED | `service_inventory_host_service_uniq`, native/true set on insert |
| `scripts/fileserver/deploy-env.sh` | absolute LNCLI_BIN + NODEMON_CHANNEL + WR-04 stdin pw | ✓ VERIFIED | All three present |
| `scripts/fileserver/run_collect-telemetry.sh` | D-08 channel gate scoping self-update to releases/<version> | ✓ VERIFIED | check_for_updates + update_one use REMOTE_PAYLOAD_DIR |
| `scripts/fileserver/nodemonDownload.sh` | blanket scp -r removed; payload excluded (CR-02) | ✓ VERIFIED | Pulls named executor scripts only |
| `db/seed-log-patterns.sql` | info/warn/critical reseed + category | ✓ VERIFIED | postgres-connection-exhaustion + category column |
| `db/seed-dimensions.sql` | postgres glob + 8/2 expected reconcile (WR-02) | ✓ VERIFIED | `postgresql-*.log`; 8 expected + 2 not-expected |
| `src/lib/db/schema/nodemon.ts` | category text column + {info,warn,critical} comment | ✓ VERIFIED | `category: text("category")` L355 |
| `src/lib/read/service-log-events.ts` | config_id PK join unchanged; narrowLevel off row.level | ✓ VERIFIED | LEFT JOIN c.id = e.config_id; config_id=NULL survives |
| `scripts/fileserver/CANARY-RUNBOOK.md` | Phase-16 channel-promotion + owner-prereq section | ✓ VERIFIED | P16-0..P16-5 + PASS criteria + T1c count reconciled |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| test_extract.py | collect_telemetry.py | `import collect_telemetry` | ✓ WIRED (43 tests run) |
| read_since | .log-cursors.json | save_cursors os.replace | ✓ WIRED |
| extract_events | _classify / log_patterns_config | capture-by-match gate; tier from classification | ✓ WIRED |
| grade native branch | read_since + extract_events | tail decoupled from detection_method | ✓ WIRED (L1805-1818) |
| path-reconciler.sql | service_inventory | UNIQUE + ON CONFLICT DO UPDATE (owner) | ✓ WIRED |
| deploy-env.sh | resolve_node_pubkey | absolute LNCLI export -> lncli getinfo | ✓ WIRED |
| run_collect-telemetry.sh | nodemonDownload / releases | NODEMON_CHANNEL gate | ✓ WIRED (scoped, fail-safe skip) |
| service-log-events.ts | log_patterns_config | config_id PK join | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Collector logic (cursor/rotation/capture/tier/IP:port) | `python3 scripts/fileserver/test_extract.py` | Ran 43 tests, OK | ✓ PASS |
| TS types (schema + read layer + detectors) | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| bash syntax (wrapper/downloader/deploy-env) | prior gate `bash -n` (per 16-06 SUMMARY) | OK | ✓ PASS |
| Live warn/critical chip rendering (WR-03) | requires live node + UI | — | ? SKIP → human |
| Owner-side SQL apply + live tick (CR-01 end-to-end) | requires live nodemon DB + LND | — | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| COL-04 | 16-01, 16-02 | Interval-complete, rotation-safe capture (offset cursor, local state, bounded bytes, both rotation styles) | ✓ SATISFIED | Truths 2-8, 31 |
| COL-05 | 16-01, 16-03 | Capture-by-pattern, native tailing decoupled, IP:port collapse | ✓ SATISFIED | Truths 9-13 |
| COL-06 | 16-01, 16-04, 16-05, 16-06 | Real-signature taxonomy + category, owner-side path reconciler, LNCLI fix, COLLECTOR_VERSION, D-08 gate | ✓ SATISFIED | Truths 14-30, 32-34 |

No orphaned requirements — REQUIREMENTS.md maps exactly COL-04/05/06 to Phase 16 (lines 219-221), all claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none) | — | No TBD/FIXME/XXX debt markers in any of the 9 touched files | — | — |
| collect_telemetry.py | 672/674 | IN-02: `prev["offset"]` direct subscript (KeyError on hand-corrupt cursor) | ℹ️ Info | Pre-existing INFO from REVIEW; not fixed, acceptable (load_cursors tolerates missing file; malformed entry is an edge case) |

### Human Verification Required

1. **Live warn/critical chip rendering (WR-03)** — Find/emit one warn line and one critical line on the canary; open the node log stream in the UI. Expected: warn->warn chip, critical->error chip (not both red). Code map verified (`_level_of`), but end-to-end render needs live data.
2. **Owner-side SQL apply + live tick** — Apply 16-04 reseed + 16-05 reconciler as owner, run one canary tick. Expected: daemon rows graded (is_expected=true), lnd.log tailed / `[CRT]` captured, COLLECTOR_VERSION=16.06 + resolved absolute lncli (pubkey set) in the tick log. Deployment-time operation outside this environment.

### Gaps Summary

No gaps. All 34 plan truths and all three roadmap success criteria (COL-04/05/06) are satisfied at the code level. The two REVIEW blockers were independently re-verified as fixed in current code: CR-01 (path-reconciler.sql now sets is_expected=true/detection_method='native' on daemon rows, so fetch_inventory retains them and lnd.log is tailed) and CR-02 (nodemonDownload.sh pulls only named executor scripts, excluding the collector payload — the blanket `scp -r ${REMOTE_DIR}/*` splice path is closed). All five warnings (WR-01..WR-05) and the taxonomy retention hazard are fixed. tsc is clean; the 43-test collector suite passes.

Status is `human_needed` (not `passed`) solely because two behaviors are inherently live/deployment-time and cannot be exercised in this static environment. Neither is a code defect — they are confirmation checks against a running canary.

---

_Verified: 2026-07-16T18:53:23Z_
_Verifier: Claude (gsd-verifier)_
