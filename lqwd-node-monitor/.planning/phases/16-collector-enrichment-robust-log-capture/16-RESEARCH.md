# Phase 16: Collector Enrichment — Robust Log Capture - Research

**Researched:** 2026-07-15
**Domain:** Node-side Python telemetry collector — interval-complete log tailing, rotation handling, pattern-driven capture, taxonomy re-derivation, and versioned fleet rollout. No UI.
**Confidence:** HIGH (the code being changed was read in full; external patterns cross-checked against pygtail/logtail2 and LND/Postgres rotation behavior)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Hybrid bootstrap sourcing:** Build the real `log_patterns_config` set by (a) mining top real signatures from the live `log_patterns` aggregate across the fleet AND (b) cross-referencing the operator's local Obsidian "LQWD Node Log Reviews" library, then an operator categorization pass on the merged set. Patterns must come from reality.
- **D-02 — Obsidian is bootstrap-only:** Obsidian is LOCAL and will not exist on the VM. Use it ONCE now. The ongoing tuning mechanism is data-driven only: the `log_patterns` aggregate + operator `UPDATE`s to `log_patterns_config` (read live each tick, no fleet redeploy). No runtime Obsidian dependency.
- **D-03 — Clean 3-tier taxonomy:** Classification severity is **info** (benign/background) / **warn** (attention, not paging) / **critical** (pages/incidents). **Drop the opaque `ap11`/`ap12` codes** from log classification. For semantic grouping use a **human-readable category label** (e.g. "postgres-connection-exhaustion", "channel-reconnect"), not a cryptic code.
- **D-04 — pg_health counter path is untouched:** The deterministic too-many-clients detection (COL-02) reads `pg_health.too_many_clients_count` (a counter), NOT the log classification label. Dropping the `ap12` log-class does not break it. Planner must reconcile the existing `classification` enum + read-time bands (`telemetry-bands.ts`) + `ap12-advisory.ts` to the new info/warn/critical scheme.
- **D-05 — Tier-driven capture:** Storage is governed by the D-03 tier. **info → count-only** in `log_patterns` aggregate (zero `service_log_events` exemplar rows — kills the CMGR/connid flood). **warn → capped exemplars + count.** **critical → more exemplars + count + longer retention.** Operator always sees the count even for suppressed noise.
- **D-06 — Count always survives:** Even for suppressed/transient errors that LND recovers from, the aggregate count is preserved. Natural outcome of D-05's count-only info tier + the interval-complete scan (COL-04).
- **D-07 — Recurring owner-side reconciler:** A scheduled OWNER-run job (not the collector) probes each node's standard log locations against a declarative service→path convention and UPSERTs `service_inventory`. Auto-registers daemon logs (lnd.log / bitcoind debug.log / local postgres) fleet-wide by default. The collector stays **SELECT-only** on the warehouse (T-15 least-privilege boundary preserved).
- **D-08 — Version-gated canary rollout:** Add a self-update gate so nodes only pull a collector version they're pinned to (a version/channel field the node reads), letting a new build prove on ONE canary first, then promote fleet-wide. Ends accidental splices.
- **D-09 — Source-agnostic capture cursor:** Build the interval-complete scanner (COL-04) as a **"log source" interface** with a cursor: `read_since(cursor) → (lines, new_cursor)`. Ship the **file-tailing** implementation this phase (byte-offset + inode cursor; LND stable-name rename-archive + Postgres timestamped-filename glob/newest-match). Mirrors journald's cursor model so a future journald source is a bolt-on.

### Claude's Discretion (research targets — this document's focus)
- Incremental offset-checkpoint scan mechanics (byte offset + inode + size; local node state file `/lnd/nodemon/.log-cursors.json`; bounded per-tick bytes with LOGGED truncation).
- Dual rotation detection algorithm (inode-change / size-shrink → drain newest archive → reset).
- Capture-by-`log_patterns_config`-match vs the single `error_pattern` substring gate; decoupling log-tailing from `detection_method`.
- IP:port signature normalization in `_normalize`.
- `LNCLI_BIN` absolute-path fix in `/lnd/bashScripts/lncli-telemetry.sh`.
- Exact version/channel field + self-update gate design (D-08).
- Source-agnostic capture cursor interface (D-09).

### Deferred Ideas (OUT OF SCOPE)
- **Cron → systemd services migration** — separate future agent task. Impact when it happens: `cron-mtime` → `systemctl` detection (already supported); log source may shift files → journald (enabled cleanly by D-09's source-agnostic cursor); a systemd unit would fix lncli/PATH/env fragility via `Environment=`/`User=`/`EnvironmentFile=`.
- **UI surfacing of the new tiers/categories** — belongs to Phase 17.
- The Phase-17 AI/incident layer that consumes this data. New warehouse fact tables (none expected this phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **COL-04** | Log capture is interval-complete and rotation-safe — every `[ERR]` in a `*/5` interval is recorded (incremental offset-checkpoint scan replaces the fixed 64KB tail; per-log cursor in a LOCAL node state file so the collector stays SELECT-only; bounded per-tick bytes with a LOGGED truncation), across both LND stable-name rename-archive and Postgres timestamped-filename rotation. | §Pattern 1 (cursor/`read_since`), §Pattern 2 (dual rotation), §Common Pitfalls 1–4, §Code Examples |
| **COL-05** | Capture breadth and fidelity — lines captured by `log_patterns_config` match (not just `error_pattern` substring), native-probed services (postgres/bitcoind) log-tailed (tailing decoupled from `detection_method`), signatures normalize out IP:port so per-peer errors collapse. | §Pattern 3 (capture-by-pattern + tier), §Pattern 4 (decouple tailing), §Pattern 5 (IP:port normalize) |
| **COL-06** | Classification reflects reality and paths self-maintain — `log_patterns_config` re-derived from REAL fleet logs; per-node log paths populated owner-side via a discovery script + declarative service→path convention; the `lncli` wrapper uses an absolute `LNCLI_BIN`. | §Pattern 6 (taxonomy migration), §Pattern 7 (owner-side reconciler), §Pattern 8 (LNCLI fix), §Runtime State Inventory |
</phase_requirements>

## Summary

Phase 15 shipped a proven collector (`scripts/fileserver/collect_telemetry.py`) whose log-capture stage is architecturally sound but operationally too narrow, as the 2026-07-15 `lnd-ireland` canary proved live. Three structural gaps: (1) `grade_log_service` reads a **fixed 64 KB tail** (`LOG_TAIL_BYTES=65536`) of each log every tick — at LND-debug ~500 lines/min, 64 KB is ~15 s of log, so any `[ERR]` written early in a 5-minute interval scrolls past and is lost; (2) `extract_events` gates capture on a single `error_pattern` **substring** (`if error_pattern not in line`), so `[WRN]`/`[CRT]` lines and every seeded benign/critical regex are never captured; (3) native-probed services (`detection_method='native'` → `grade_native_service`) are **never tailed at all** — the canary showed 8639 Postgres FATALs in the local PG log with 0 captured. The seeded taxonomy is also Obsidian-derived and mismatched against real LND lines.

The fix is a set of surgical, well-scoped changes to a single Python file plus its two SQL seeds, the lncli wrapper in `deploy-env.sh`, and an owner-side reconciler, with a read-layer taxonomy reconciliation in TypeScript. The centerpiece is a **source-agnostic cursor interface** — `read_since(cursor) → (lines, new_cursor)` (D-09) — backed by a byte-offset + inode + size cursor persisted to a LOCAL JSON state file (`/lnd/nodemon/.log-cursors.json`), so the collector reads `last_offset → EOF` every tick and stays SELECT-only on the warehouse (no new grant). This is exactly the algorithm pygtail/logtail2 have used in production for years (inode identity + offset + size-shrink rotation detection) [VERIFIED: github.com/bgreenlee/pygtail]. Capture is decoupled from `error_pattern` (capture-by-regex-match against the live `log_patterns_config`) and from `detection_method` (native services with an `artifact_path` get tailed). Tier-driven storage (D-05) turns info→count-only, killing the exemplar flood while the `log_patterns` aggregate count always survives (D-06).

**Primary recommendation:** Build a small (~60-line) hand-rolled `LogSource`/cursor module inside `collect_telemetry.py` modeled explicitly on pygtail's proven inode+offset+size-shrink algorithm (not a new pip dependency — the per-node venv must stay `psycopg2-binary` + `python-dotenv` only, and the cursor must live in `/lnd/nodemon/` not next to the read-only logs). Refactor `extract_events` to capture-by-`log_patterns_config`-match with tier-gated exemplar emission, decouple tailing from `detection_method`, add IP:port normalization to `_normalize`, re-derive the seed from real fleet signatures using the new info/warn/critical + `category` taxonomy, add an owner-side path reconciler and a fileserver channel-pointer rollout gate. Preserve the T-15 SELECT-only boundary in every change.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Interval-complete log tailing + cursor persistence | Node-local collector (Python, root) | Local node state file `/lnd/nodemon/.log-cursors.json` | Cursor is per-node runtime state; keeping it local (not in the warehouse) is what preserves the collector's SELECT-only grant (COL-04, T-15). |
| Rotation detection + archive drain | Node-local collector (Python) | Filesystem (inode/glob) | Rotation is a filesystem event only observable on the node; both LND and PG rotation are node-local. |
| Capture-by-pattern + classification | Node-local collector (Python) | `log_patterns_config` dimension (warehouse, SELECT-only read each tick) | Patterns are SQL-tunable data (D-02/D-05); the collector reads them live and applies at capture time. |
| Tier-driven storage (info=count-only) | Node-local collector (write to fact tables under RLS) | `_upsert_log_patterns` (aggregate) + `_insert_log_events` (exemplars) | The one warehouse write the collector is granted (INSERT on facts + scoped log_patterns UPDATE); tier gates which table receives rows. |
| Path discovery / `service_inventory` maintenance | **Owner-side reconciler** (separate scheduled job) | `service_inventory` dimension (owner has INSERT/UPDATE) | D-07: collector MUST stay SELECT-only on `service_inventory`; only the owner may write dimension rows. |
| Version-gated rollout | Fileserver distribution rail (bash) + per-node channel file | `run_collect-telemetry.sh` self-update + `nodemonDownload.sh` | D-08: the gate lives entirely in the shared-fileserver layout + local channel pin, never in the warehouse — keeps the collector SELECT-only. |
| Taxonomy reconciliation for read | Dashboard read-layer (TypeScript) | `service-log-events.ts`, `telemetry-bands.ts`, `ap12-advisory.ts` | The UI/detector consume classification; the info/warn/critical rename must be mirrored read-side (D-04). |
| lncli identity resolution | Node-local collector + `deploy-env.sh` wrapper | `.nodemon.env` `LNCLI` var | COL-06: absolute `LNCLI_BIN` is a provisioning/wrapper concern on the node. |

## Standard Stack

**This phase introduces NO new libraries.** The collector's dependency surface is fixed at `psycopg2-binary` + `python-dotenv` (per-node venv, `scripts/fileserver/requirements.txt`) [VERIFIED: read requirements.txt]. Everything needed is Python 3 stdlib.

### Core (all Python 3 stdlib — already imported or to be added)
| Module | Status | Purpose in this phase |
|--------|--------|-----------------------|
| `os` (`os.fstat`, `os.SEEK_END`, `os.replace`) | imported | fstat for inode/size; atomic cursor-file write via `os.replace` |
| `re` | imported | IP:port normalization; capture-by-`match_expression` (cache already exists: `_compile_match_expression`) |
| `json` | imported | cursor state file read/write (`.log-cursors.json`) |
| `glob` | **add** | Postgres timestamped-filename newest-match (`postgresql-*.log`) resolution |
| `gzip` | **add (conditional)** | draining a rotated **gzip** LND archive across a rotation boundary (stdlib) |
| `hashlib` | imported | sha256 signature (unchanged) |

### Supporting — node runtime (already present on nodes)
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `lncli` (via `/lnd/bashScripts/lncli-telemetry.sh` wrapper) | node_pubkey resolution | COL-06 absolute-path fix |
| `pg_isready` / psycopg2 | PG probe (unchanged) | native probe already wired |
| bash + `scp`/`ssh` + `md5sum` | fileserver self-update rail | D-08 channel gate extends `run_collect-telemetry.sh` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled cursor module | **pygtail** (PyPI, MIT) [VERIFIED: pypi.org/project/pygtail] | pygtail is the proven reference for inode+offset+size-shrink rotation, BUT: (1) adds a pip dependency to every node's venv (the fleet standard is a 2-dep venv); (2) defaults to writing a `.offset` sidecar **next to the log** — the collector reads `/lnd/logs/**` which may be a dir it shouldn't write to, and D-09 mandates a single `/lnd/nodemon/.log-cursors.json`; (3) it is single-file oriented and does not express the D-09 multi-source `read_since(cursor)` interface, bounded-bytes-per-tick, or tier-aware capture. **Recommendation: hand-roll ~60 lines modeled explicitly on pygtail's algorithm** and cite it. This is the rare justified hand-roll (see §Don't Hand-Roll). |
| Draining ZSTD-compressed LND archives | `zstandard` (PyPI) or `zstd`/`unzstd` CLI | LND v0.19+ compresses rotated logs with ZSTD in place [CITED: docs.lightning.engineering lnd.conf `logging.file.compressor`]. Decompressing to drain adds a dependency (`zstandard`) or a CLI shell-out. **Recommendation: do NOT add the dep — skip-drain when the newest archive is compressed** and log it; the `log_patterns` count still recovers on the next tick from the new file. Flag as accepted limitation (see Open Questions). |
| New `category` warehouse table | **Additive `category text` column** on `log_patterns_config` (+ optionally `service_log_events`/`log_patterns`) | D-03 wants human-readable category labels; "no new tables" is the constraint but an additive nullable column is in-bounds. Confirm with operator. |

**Installation:** none (stdlib only). Node venv `requirements.txt` is unchanged.

## Package Legitimacy Audit

**No external packages are installed by this phase.** All new imports (`glob`, `gzip`) are Python 3 standard library. The collector's `requirements.txt` (`psycopg2-binary`, `python-dotenv`) is unchanged and already fleet-deployed.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| (none — stdlib only) | — | — | — | — | n/a | No install |
| `pygtail` *(reference only — NOT installed)* | PyPI | mature (logtail2 lineage) | — | github.com/bgreenlee/pygtail | not run | Algorithm cited, code hand-rolled; not added as a dependency |
| `zstandard` *(explicitly avoided)* | PyPI | — | — | github.com/indygreg/python-zstandard | not run | REJECTED — do not add; skip-drain compressed archives instead |

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs).
**Packages flagged as suspicious [SUS]:** none.

*slopcheck was not run because this phase installs nothing. If the plan later chooses to add `zstandard` for archive draining (not recommended), gate it behind a `checkpoint:human-verify` task and run the Package Legitimacy Gate then.*

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
   */5 cron (CRON_JOB_12)│  run_collect-telemetry.sh (bash wrapper)     │
   ─────────────────────▶│  flock ─▶ [D-08 CHANNEL GATE] ─▶ self-update │
                         │  source .nodemon.env ─▶ venv python          │
                         └───────────────┬─────────────────────────────┘
                                         │ runs
                                         ▼
   ┌──────────────────────────  collect_telemetry.py (node, root)  ─────────────────────────┐
   │                                                                                          │
   │  fetch_inventory (SELECT service_inventory)   fetch_log_patterns_config (SELECT)         │
   │             │                                          │                                 │
   │             ▼                                          ▼                                 │
   │  for each inventory row ─────────────────────────────────────────────┐                  │
   │    resolve_artifact(path|glob)  ◀── NEW: glob/newest-match (PG)       │                  │
   │             │                                                         │                  │
   │             ▼                                                         │                  │
   │    LogSource.read_since(cursor) ◀── NEW (D-09): open, fstat(ino,size) │  ┌────────────┐  │
   │       inode==saved & size>=off ─▶ seek(off)→EOF, bounded by MAX_BYTES │──│ .log-      │  │
   │       inode changed | size<off  ─▶ ROTATION: drain newest archive,   │  │ cursors.   │  │
   │                                    reset off=0  (Pattern 2)           │◀─│ json (LOCAL│  │
   │             │  (lines, new_cursor)                                    │  │ node state)│  │
   │             ▼                                                         │  └────────────┘  │
   │    extract_events(lines) ◀── capture-by-log_patterns_config MATCH     │                  │
   │       _classify ─▶ (tier, config_id, category)                       │                  │
   │       tier=info  ─▶ count only  (aggregate bump, ZERO exemplars, D-5)│                  │
   │       tier=warn  ─▶ capped exemplars + count                        │                  │
   │       tier=crit  ─▶ more exemplars + count                          │                  │
   │       _normalize ◀── NEW: strip IP:port (Pattern 5)                  │                  │
   │             │                                                         │                  │
   │             ▼                                                         │                  │
   │    write_tick (SET LOCAL RLS ─▶ INSERT facts + log_patterns upsert)  ◀┘  SELECT-only     │
   │                                                                          except facts    │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
                                         ▲ reads (live each tick)
   ┌─────────────────────────────────────┴──────────────────────────────────────────────────┐
   │  OWNER-SIDE (separate scheduled job, NOT the collector) — has INSERT/UPDATE on dims       │
   │  path-reconciler.py/.sql (D-07): declarative service→path convention                      │
   │     ─▶ UPSERT service_inventory (auto-register lnd/bitcoind/postgres paths + globs)        │
   │  seed-log-patterns.sql re-derive (D-01): info/warn/critical + category                    │
   └───────────────────────────────────────────────────────────────────────────────────────────┘
                                         │ nodemon warehouse
                                         ▼
   Dashboard read-layer (TS): service-log-events.ts (config_id suppression, unchanged join)
                              telemetry-bands.ts / ap12-advisory.ts (pg_health counters — D-04)
```

### Recommended Project Structure (files touched — no new dirs)
```
scripts/fileserver/
├── collect_telemetry.py          # cursor/LogSource, extract_events refactor, _normalize, resolve_artifact, tier gating
├── deploy-env.sh                 # absolute LNCLI_BIN hardening (COL-06)
├── run_collect-telemetry.sh      # D-08 channel gate before self-update
├── nodemonDownload.sh            # D-08 channel-aware pull (or leave, gate in run_*)
├── test_extract.py               # EXTEND: cursor, rotation, IP:port, capture-by-pattern, tier tests
├── path-reconciler.(py|sql)      # NEW owner-side (D-07)
└── CANARY-RUNBOOK.md             # EXTEND: Phase-16 canary + channel-promotion procedure
db/
├── seed-log-patterns.sql         # re-derive: info/warn/critical + category (D-01/D-03)
└── seed-dimensions.sql           # documented lnd/bitcoind/postgres paths + globs
src/lib/db/schema/nodemon.ts      # + category column (additive) if approved
src/lib/read/service-log-events.ts# classification taxonomy reconcile (join unchanged)
src/lib/read/telemetry-bands.ts   # unaffected (pg_health bands) — verify only (D-04)
src/lib/insight/detectors/ap12-advisory.ts # unaffected — verify only (D-04)
```

### Pattern 1: Source-agnostic cursor / `read_since` (D-09, COL-04)

**What:** A `LogSource` abstraction with one method — `read_since(cursor) → (lines, new_cursor)` — and a file-tailing implementation backed by a `{path, inode, offset, size}` cursor persisted per-log in `/lnd/nodemon/.log-cursors.json`.

**When to use:** Replaces the `LOG_TAIL_BYTES` fixed-tail read in `grade_log_service` (L782) and the separate PG-log tail in `main()` (L1475). Every monitored log is read `offset → EOF` each tick.

**Mechanics (modeled on pygtail's proven algorithm [VERIFIED: github.com/bgreenlee/pygtail]):**
1. `fstat` the open file → `st_ino`, `st_size`.
2. If a saved cursor exists AND `st_ino == saved.inode` AND `st_size >= saved.offset`: **seek(offset), read to EOF** (bounded — see below). New offset = start-of-trailing-partial-line (see Pitfall 3).
3. If `st_ino != saved.inode` **OR** `st_size < saved.offset`: **rotation/truncation** → Pattern 2.
4. **First sight of a path (no cursor):** seed `offset = max(0, st_size - INITIAL_TAIL_BYTES)` (a small recent window, e.g. 64 KB) and align to the next newline, then checkpoint — do NOT ingest the entire historical file on the first tick (a mature lnd.log can be hundreds of MB).
5. **Bounded per-tick bytes (LOGGED truncation, COL-04):** read at most `MAX_BYTES_PER_TICK` (recommend 8 MB) from `offset`. If `st_size - offset > MAX_BYTES_PER_TICK`, read the cap, advance the offset by the cap, and `log()` a WARNING with the byte backlog — **defer** the remainder to the next tick (self-heals when the burst subsides). Never silently drop. [ASSUMED — cap value; operator to confirm the ceiling.]
6. **Atomic cursor persist:** write the whole JSON to a temp file then `os.replace()` (atomic on POSIX) so a killed tick can never corrupt the cursor map.

**D-09 interface shape (so a future journald source is a bolt-on):**
```python
# Cursor is a plain dict (JSON-serializable). File source uses {path, inode, offset, size};
# a future journald source would use {cursor: "<journald opaque cursor string>"} — same contract.
def read_since(source_key, artifact, cursor):
    """Return (lines: list[str], new_cursor: dict). Pure w.r.t. the cursor: given the
    same file bytes + cursor it yields the same lines + advance. Offline-testable."""
```
journald exposes exactly this model — an opaque cursor string you seek to and read forward from [CITED: systemd `sd_journal_get_cursor`/`sd_journal_seek_cursor`]; mirroring it now means the systemd migration adds a `JournaldSource.read_since` and reuses everything downstream.

### Pattern 2: Dual rotation detection + drain (COL-04)

**What:** On a detected rotation (inode change or size-shrink), drain the tail of the *previous* file before resetting to the new one, so no lines are lost across the boundary.

**LND (stable-name rename-archive):** `lnd.log` keeps its name; on rotation LND renames the current file to a numbered archive (`lnd.log.1`, …) and, on **v0.19+, compresses it (ZSTD) in place** [CITED: docs.lightning.engineering — `logging.file.max-files`, `logging.file.max-file-size`, `logging.file.compressor`]. Detection: the live `lnd.log` inode changes (new file) or size shrinks. Drain: glob the archive dir, pick the newest archive by mtime, read it from `saved.offset` to end. **If the newest archive is compressed** (`.zst`/`.gz`) — decompress only if stdlib `gzip` suffices; **for ZSTD, skip-drain and log** (do not add `zstandard`). Then reset the `lnd.log` cursor to offset 0 (or the small initial tail).

**Postgres (timestamped-filename glob):** `postgresql-YYYY-MM-DD.log` — a NEW filename appears when the date rolls. The `artifact_path` must be treated as a **glob/directory**; `resolve_artifact()` returns the newest match by mtime each tick. Key the cursor by a stable `source_key` (service name), NOT by path, so it survives the filename change; store the resolved path inside the cursor. When the resolved newest path differs from the cursor's stored path → rotation → drain the previous day's file from `saved.offset` to end, then start the new file from 0.

**Recommended helper:**
```python
def resolve_artifact(artifact_path):
    """If artifact_path contains a glob metachar or is a directory, return the newest
    matching file by mtime; else return it verbatim. Feeds both _artifact_mtime and the tailer."""
```
This lets `service_inventory.artifact_path` carry `/var/log/postgresql/postgresql-*.log` for PG and a plain path for LND — the reconciler (D-07) populates the right shape per service.

### Pattern 3: Capture-by-`log_patterns_config`-match + tier-driven storage (COL-05 + D-05)

**What:** Two coupled changes to `extract_events` (L688):
1. **Capture gate:** replace `if error_pattern not in line: continue` (substring) with **"line matches any compiled `log_patterns_config.match_expression`"** — the compile cache (`_compile_match_expression`, L652) and `_classify` (L665) already exist. A line is captured iff `_classify` returns a non-null `config_id`. Keep `error_pattern`/`text.count(error)` in `grade_log_service` purely for the `service_health.error_count` axis (continuity), but **decouple capture from it**.
2. **Tier gating (D-05):** from the matched config row, read the tier (new info/warn/critical classification, or a derived tier from `suppress`). For **info → bump the `log_patterns` aggregate count only, emit ZERO `service_log_events` exemplars** (kills the CMGR/connid flood). For **warn → capped exemplars (KEEP_N) + count**. For **critical → more exemplars + count**. The aggregate `sig_tick_count` / `_upsert_log_patterns` path must run for ALL matched signatures regardless of tier (D-06: count always survives).

**Deliberate policy shift the planner MUST reconcile:** Phase-15's COL-01 contract (see `service-log-events.ts` header and `serviceLogEvents` schema comment) is *"the collector persists EVERYTHING it matches; suppression is never a collect-time drop — benign filtering happens at read via `config_id`."* D-05 **intentionally overrides this for the info tier** — info lines become count-only at collect time (no exemplar rows ever). The read-time `config_id` suppression join stays for warn/critical exemplars that are captured but should be hidden. Update the COL-01 module docs/tests to match, and confirm the read layer's "unmatched lines survive" invariant still holds for `config_id = NULL` lines.

### Pattern 4: Decouple log-tailing from `detection_method` (COL-05)

**What:** Currently `grade_service` (L814) returns early for `detection_method='native'` ("native probe pending") and `main()` routes native rows to `grade_native_service` (L1066) which never tails. Result: postgres/bitcoind logs are never captured even with `artifact_path` set.

**Fix:** After the running/functioning determination (native or log-based), if the inventory row has a resolvable `artifact_path`, run the Pattern-1 tailer + Pattern-3 `extract_events` on it, independent of `detection_method`. In `main()` the native branch (L1463) must also collect `log_events`. **Reconcile the existing PG double-tail:** `main()` already tails the PG log via `LOG_TAIL_BYTES` (L1475) to feed `_count_pg_log_signatures` for `pg_health`. Tail once via the cursor and pass the captured text to BOTH `_count_pg_log_signatures` AND `extract_events` — do not tail the same file twice.

### Pattern 5: IP:port signature normalization in `_normalize` (COL-05)

**What:** Add an IPv4:port (and peer-arrow) collapse to `_normalize` (L624) so broken-pipe-to-different-peers dedupes to ONE signature instead of fragmenting per peer.

```python
# Add near the other _RE_* signature rules (L608-612). Order: apply BEFORE _RE_EQ_NUM.
_RE_IP_PORT = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\b")   # 172.31.11.142:9735
# In _normalize, after the timestamp/hex/pid subs:
s = _RE_IP_PORT.sub("<addr>", s)         # collapses both sides of "a:p->b:p"
```
IPv6 is optional (LND peer lines are predominantly IPv4:port). Add a `test_extract.py` case asserting two broken-pipe lines to different `IP:port` peers share a signature.

### Pattern 6: Taxonomy re-derivation (D-01/D-03, COL-06)

**What:** Rewrite `db/seed-log-patterns.sql` from real fleet signatures (mined from the live `log_patterns` aggregate + Obsidian cross-ref, then operator categorization — D-01). Migrate classification from `{benign, warn, ap11, ap12, critical, other}` to **`{info, warn, critical}`** (D-03) plus a **human-readable `category` label** (e.g. `postgres-connection-exhaustion`, `channel-reconnect`, `sweep-failure`).

**Observed real signatures to categorize (from CONTEXT + canary):**
| Real line (regex-escaped in seed) | Tier | Suggested category | Notes |
|---|---|---|---|
| `CMGR.*Unknown connid=` | info | `conn-noise` | suppress-noise; count-only |
| `CMGR.*Can't accept connection.*i/o timeout` | info | `conn-noise` | count-only |
| `HSWC.*failing link: unable to synchronize channel states` / `broken pipe` | warn | `channel-reconnect` | reconnection churn, post-restart bursts |
| `HSWC.*resuming link failed` | warn | `channel-reconnect` | (replaces seeded `\[ERR\] HSWC.*Unhandled error`, proven wrong) |
| `SWPR.*Failed to sweep` / `UTXN.*Failed to sweep` | warn | `sweep-failure` | attention |
| `PEER.*peer exiting` / `resend failed` | info | `peer-churn` | mostly benign |
| `FATAL:  sorry, too many clients already` (PG) | critical | `postgres-connection-exhaustion` | was `ap12` |
| `\[CRT\]` (LND) | critical | `lnd-critical` | hard-zero band |
| `closechannel` (LND) | warn/info | `close-event` | was `ap11`; AP-11 is a **read-time rate** signature, not a log class |

**Reconciliation surface (D-04) — the planner MUST touch all of these together:**
1. **Collector constants** `LOG_RETENTION_WINDOWS` (L1326) and `LOG_MIDDLE_EVICT_CLASSES` (L1334) reference `benign/other/warn/ap11` and exempt `ap12/critical` — rewrite to `info/warn/critical` (+ handle `other`/NULL for unmatched).
2. **Seed** `db/seed-log-patterns.sql` classification values + the verification `SELECT`.
3. **Schema** `nodemon.ts` comments (L273/L345 enumerate the old set) + optional additive `category text` column.
4. **Read layer** `service-log-events.ts` — the `config_id` join is UNAFFECTED (PK join, not classification join — this is the whole point of the config_id design). `narrowLevel` maps `level`, not `classification`. Verify no code branches on the string `"ap12"`/`"ap11"` as a *classification* value.
5. **UNAFFECTED (verify only):** `ap12-advisory.ts` + `pg-health.ts` derive AP-12a/b from `pg_health` **counters** (`too_many_clients_count`, `serialization_40001_count`), and the insight **signal ids** (`ap12a_conn_exhaustion`, `ap12b_serialization` in `insight/schema.ts`) are distinct from the log classification label. Dropping the `ap12` log-class does not touch them (D-04) — but confirm with a grep that nothing joins `service_log_events.classification == 'ap12'`.

### Pattern 7: Owner-side path reconciler (D-07, COL-06)

**What:** A scheduled OWNER-run job (NOT the collector) that UPSERTs `service_inventory` from a declarative service→path convention, auto-registering daemon logs fleet-wide. The collector stays SELECT-only on `service_inventory`.

**Recommended shape:** For each host in the `hosts` dimension, UPSERT the standard fleet-layout paths/globs per service:
```
lnd       → /lnd/logs/bitcoin/mainnet/lnd.log            (stable-name; rename-archive)
bitcoind  → /bitcoin/debug.log                            (or /bitcoin/mainnet/debug.log)
postgres  → /var/log/postgresql/postgresql-*.log          (GLOB; newest-match)
```
Run as the nodemon **owner** role (has INSERT/UPDATE on dimensions), `ON CONFLICT (host_id, service_name) DO UPDATE SET artifact_path = EXCLUDED.artifact_path`. **Minimum viable (recommended for this phase):** a convention-driven UPSERT keyed off `hosts` — no SSH needed (the fleet has a standard `/lnd` layout). **Enhancement (flag as optional):** SSH-probe each node to confirm path existence and self-heal on moves. Preserve the SELECT-only boundary: this job is a **separate artifact** run with owner creds, never bundled into `collect_telemetry.py`.

### Pattern 8: Absolute `LNCLI_BIN` fix (COL-06)

**What:** The observed `pubkey=none` blip on `lnd-ireland` traces to `resolve_node_pubkey` (L86) calling the wrapper via `os.environ.get("LNCLI", "lncli")` — if `LNCLI` is unset in the cron environment it falls back to bare `lncli` (PATH-dependent; root/cron's thin PATH lacks it → `getinfo` fails → `pubkey=none` → node-scoped rows RLS-skipped).

**Current state:** `deploy-env.sh` already writes `LNCLI=/lnd/bashScripts/lncli-telemetry.sh` into `.nodemon.env` (L109) and the wrapper `exec "${LNCLI_BIN}" …` (L65) with `LNCLI_BIN` resolved at provision time via `command -v lncli` (L55). **The gap is fragility, not absence:** if provisioning ran with lncli off PATH, `command -v` yields empty (guarded at L58) OR a stale wrapper predating this line is deployed on the canary.

**Fix (COL-06):**
1. In `deploy-env.sh`, pin an absolute fleet-standard `LNCLI_BIN` **default** (e.g. `/usr/local/bin/lncli` — confirm the fleet's real path) rather than relying solely on `command -v` under provisioning's PATH.
2. Re-provision the canary so the deployed wrapper is guaranteed absolute; add a startup self-check in `collect_telemetry.py` that `log()`s the resolved lncli path and warns on `pubkey=none`.
3. Confirm `run_collect-telemetry.sh` sources `.nodemon.env` before running (it does, L108-111) so `LNCLI` is exported to the Python process.

### Pattern 9: Version/channel rollout gate (D-08)

**What:** Stop the shared-fileserver `~/nodemon/` publish from auto-splicing the whole fleet. Introduce a per-node channel pin + fileserver channel-pointer indirection.

**Recommended design (channel-pointer indirection):**
- Per-node pin: a local `NODEMON_CHANNEL=stable|canary` line in `.nodemon.env` (root-only, never shipped — same rail as other node secrets), read by `run_collect-telemetry.sh`.
- Fileserver layout: versioned payloads under `~/nodemon/releases/<version>/collect_telemetry.py`, and channel pointer files `~/nodemon/channels/stable` / `~/nodemon/channels/canary` each containing a version string.
- Wrapper self-update logic: read the node's channel → read that channel's pointer on the fileserver → md5-compare and pull ONLY that version's payload. Publish a new build to `canary`; only the canary node pulls it. After the canary proves, promote by writing the new version into `channels/stable` → the fleet pulls on the next tick.
- Collector version marker: embed `COLLECTOR_VERSION = "16.x"` in `collect_telemetry.py` and `log()` it every tick (observability; no warehouse write needed).

**Keeps the collector SELECT-only:** the entire gate is bash + fileserver layout + a local channel file — zero new warehouse writes. [ASSUMED — exact mechanism; several valid designs exist (channel pointer vs. per-node pinned-version file vs. an allow-list on the fileserver). Operator to confirm before build.]

### Anti-Patterns to Avoid
- **Persisting the cursor to the warehouse.** Would require a new grant and break the SELECT-only boundary (T-15). The cursor is LOCAL node state (`/lnd/nodemon/.log-cursors.json`).
- **Writing the cursor / offset file next to the log** (pygtail's default). The log dirs may be non-writable by the collector and D-09 mandates a single consolidated state file.
- **Silent byte cap.** Bounding per-tick bytes without a `log()` line hides data loss (COL-04 explicitly requires a LOGGED truncation).
- **Re-serializing / re-tailing the PG log twice** (once for `pg_health` counts, once for `extract_events`). Tail once via the cursor, fan the text to both consumers.
- **Ingesting the full historical log on first sight.** Seed the cursor near EOF; a mature lnd.log is hundreds of MB.
- **Joining suppression on `classification`.** The `config_id` PK join is load-bearing (a `benign`/`info` class holds both suppress=true and suppress=false rows). Never regress to a classification join.
- **Adding `zstandard` to the node venv.** Skip-drain compressed archives instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Regex compilation/caching for config patterns | A new cache | Existing `_compile_match_expression` + `_MATCH_EXPR_CACHE` (L649-662) | Already handles uncompilable rows gracefully (caches `None`, skips) |
| Signature dedup + KEEP_N exemplars + aggregate | A new dedup path | Existing `extract_events` buckets + `_upsert_log_patterns` (D-05/D-06 feed INTO this) | Proven Phase-15 machinery; extend, do not rebuild |
| Secret redaction on captured lines | A new scrubber | Existing `_redact` (L635) | Already strips password/macaroon/token/hex/b64 before storage (T-15-05) |
| RLS-admissible row filtering | Per-tick guards | Existing `_rls_admissible_node_rows` (L1373) | Already drops rows the WITH CHECK would reject so a tick never aborts |
| PG counter probe | A new query | Existing `probe_pg_health` (L997) | Unchanged (D-04) |
| Detection-method dispatch | New branching | Existing `detect_running` (L741) — already supports pgrep/systemctl/cron-mtime/native | Informs the deferred systemd migration |

**Justified hand-roll (the ONE exception):** the incremental cursor / `LogSource`. pygtail is the reference implementation but is rejected as a *dependency* for three concrete reasons (extra pip dep on a 2-dep fleet venv; writes `.offset` sidecars next to read-only logs; single-file, no D-09 multi-source `read_since` / bounded-bytes / tier interface). The **algorithm** (inode identity + byte offset + size-shrink rotation detection) is ~60 lines and must be copied faithfully from pygtail's proven design and cited. This is the rare case where the ecosystem library's shape does not fit the constraints, so a small, well-tested reimplementation is correct.

**Key insight:** Nearly everything downstream of "get the right lines" already exists and is production-proven from Phase 15. The phase's real work is the *front* of the pipe (complete, rotation-safe, pattern-driven line acquisition) and the *taxonomy* — not new storage machinery.

## Runtime State Inventory

> This is a behavior + config + fleet-deployment phase. A grep finds files; it does NOT find deployed node state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | (1) `log_patterns_config` **existing rows** on the live nodemon DB carry the OLD classification values (`benign/ap11/ap12/critical`). Re-seeding is not enough — existing rows must be UPDATEd or the table truncated+reseeded by the owner. (2) `service_log_events` + `log_patterns` **existing rows** carry old `classification` strings; historical rows won't match new read-time logic unless reconciled. (3) NEW local file `/lnd/nodemon/.log-cursors.json` — created fresh per node, first-run seeds near EOF. | **Data migration** (owner UPDATE/reseed `log_patterns_config`) + **code edit** (collector writes new taxonomy going forward). Decide whether to backfill historical `service_log_events.classification` or accept mixed history. |
| **Live service config** | `service_inventory` rows on the live nodemon DB are owner-maintained and NOT fully in git (seed has `<CANARY_HOST_ID>` placeholders); the canary added real bitcoind/lnd paths (`bitcoind=/bitcoin/debug.log`, `lnd=/lnd/logs/bitcoin/mainnet/lnd.log`, `node_pubkey=NULL` host-level) that live only in the DB. The D-07 reconciler must reconcile these, not clobber them. | **API/DB (owner-side)** — reconciler UPSERT; document the canary-added rows in `seed-dimensions.sql`. |
| **OS-registered state** | (1) `CRON_JOB_12` (`*/5` cron running `run_collect-telemetry.sh`) — unchanged, but the D-08 gate changes what it pulls. (2) The lncli wrapper FILE `/lnd/bashScripts/lncli-telemetry.sh` on each node — the canary's copy may be stale/bare (COL-06). (3) The **accidentally-spliced expanded collector** is already deployed fleet-wide (2026-07-15 splice) — every node is running the Phase-15-plus collector, NOT a clean baseline. | **Re-provision** the canary wrapper (COL-06); **channel-gate** future pulls (D-08); note the fleet is already on the spliced build. |
| **Secrets / env vars** | `.nodemon.env` (root-only, 0600, per-node, NOT in git) holds `LNCLI`, DSN, PG/bitcoind creds. COL-06 adds/pins `LNCLI_BIN`; D-08 adds `NODEMON_CHANNEL`. No secret is renamed — additive env keys only. | **Code + provisioning edit** (`deploy-env.sh` writes the new keys). No secret rotation. |
| **Build artifacts** | (1) Per-node venv `/lnd/nodemon/.venv-telemetry` — unaffected (no new deps; stays `psycopg2-binary`+`python-dotenv`). (2) `old-scripts/backup_*` copies accumulate per self-update. (3) The new cursor state file is a runtime artifact, not a build artifact. | **None** for the venv (verified — no requirements.txt change). Cursor file needs no build step. |

**Nothing found that requires a schema table migration:** confirmed — the only schema change contemplated is an **additive `category` column** (Pattern 6), not a new table (matches ROADMAP "no new tables expected").

## Common Pitfalls

### Pitfall 1: 64 KB tail misses early-interval errors (the reported bug)
**What goes wrong:** `_tail_text(path, LOG_TAIL_BYTES=65536)` reads only the last 64 KB. At LND-debug ~500 lines/min, that's ~15 s of a 300 s interval — errors written in the first ~4.75 min scroll past unseen.
**Why:** Fixed-window tail with no memory of what was already read.
**How to avoid:** Pattern 1 cursor (`offset → EOF` each tick). `LOG_TAIL_BYTES` becomes the bootstrap `INITIAL_TAIL_BYTES` only.
**Warning signs:** `log_patterns.count_window` far lower than a manual `grep -c '\[ERR\]'` over the same window on-node.

### Pitfall 2: Partial trailing line double-count / corruption
**What goes wrong:** Reading to EOF mid-write captures a partial last line; next tick reads the rest and you emit a mangled + a duplicate line, or a broken signature.
**Why:** Logs are appended non-atomically at the byte level.
**How to avoid:** After reading `offset → EOF`, set the persisted offset to the **start of the trailing partial line** (last `\n` + 1), not raw EOF. Only emit complete (newline-terminated) lines. pygtail does exactly this.
**Warning signs:** Truncated messages in `service_log_events`; signatures that don't dedupe.

### Pitfall 3: Rotation boundary loss (both styles)
**What goes wrong:** Between two ticks the file rotates; lines written to the old file after the last checkpoint but before rotation are never read.
**Why:** The cursor points at the old inode/offset; the new file starts at 0.
**How to avoid:** Pattern 2 drain — on inode-change/size-shrink, read the newest archive from `saved.offset` to end before resetting. For PG, resolve the newest glob match and drain the previous file when the resolved path changes.
**Warning signs:** A gap in captured lines straddling a known rotation timestamp.

### Pitfall 4: Compressed LND archives can't be drained without a dep
**What goes wrong:** LND v0.19+ compresses rotated logs (ZSTD) in place [CITED: docs.lightning.engineering]. The drain step tries to read a `.zst` as text and gets garbage.
**Why:** In-place compression on rotation.
**How to avoid:** Detect the archive extension; drain `.gz` via stdlib `gzip`, **skip-drain `.zst` and `log()` it** (do not add `zstandard`). Accept a small, logged gap — the next tick recovers the count from the new file.
**Warning signs:** Binary/garbage lines in captured events (means a compressed file was read as text — a hard bug, not just a gap).

### Pitfall 5: Capture-by-pattern floods exemplars (CMGR/connid)
**What goes wrong:** Widening capture from one `error_pattern` to all `log_patterns_config` matches captures high-frequency benign lines (CMGR unknown connid) as exemplar rows — the exact flood Phase 15 tried to avoid.
**Why:** No tier gating at capture time.
**How to avoid:** D-05 tier gating — info → count-only (aggregate bump, zero exemplars). Enforce it INSIDE `extract_events`, not just at read.
**Warning signs:** `service_log_events` row count explodes; the same benign signature repeats thousands of times.

### Pitfall 6: ReDoS from a widened capture surface
**What goes wrong:** Capture-by-pattern runs every `log_patterns_config` regex against every line of a now-much-larger per-tick text. A catastrophically-backtracking operator-authored regex (`.*.*` style) can hang the tick.
**Why:** Python `re` has no execution timeout; the compile-guard (`_compile_match_expression`) only catches *invalid* regexes, not *slow* ones.
**How to avoid:** Keep seed patterns anchored and simple (prefer literal substrings + bounded `.*` between tokens); code-review operator UPDATEs; flock already prevents pile-up but a hung tick still stalls a cadence. Consider a per-tick wall-clock guard that logs and bails.
**Warning signs:** Ticks approaching the 300 s interval; flock "previous run still in progress" messages.

### Pitfall 7: Silent SELECT-only violation via the reconciler
**What goes wrong:** Folding the D-07 path discovery into `collect_telemetry.py` for convenience grants the collector write on `service_inventory`, breaking T-15.
**Why:** Expedience.
**How to avoid:** The reconciler is a SEPARATE owner-run artifact. The collector's grants stay SELECT on dimensions (+ INSERT on facts + scoped UPDATE on `log_patterns` only).
**Warning signs:** A `GRANT ... ON service_inventory` to `nodemon_telemetry` appearing in any diff.

### Pitfall 8: Cursor file grows unbounded / stale entries
**What goes wrong:** `.log-cursors.json` accumulates entries for paths that no longer exist (rotated-away PG day files), or an inode is reused by an unrelated file.
**Why:** No pruning; inode reuse after delete.
**How to avoid:** Key by stable `source_key`; store `{inode, size, offset, path}` and validate all three on read (inode match AND size ≥ offset). Prune entries whose source no longer resolves.
**Warning signs:** Cursor file bloat; a reset that re-ingests an old file.

## Code Examples

### Cursor read (Pattern 1) — modeled on pygtail's algorithm
```python
# Source: algorithm from github.com/bgreenlee/pygtail (core.py) — reimplemented, not vendored.
INITIAL_TAIL_BYTES = 65536          # bootstrap window on first sight (was LOG_TAIL_BYTES)
MAX_BYTES_PER_TICK = 8 * 1024 * 1024  # [ASSUMED] logged-truncation ceiling — operator to confirm

def read_since(source_key, path, cursors):
    """Return (lines, updated_cursors). Complete lines only; offset parked at the
    start of any trailing partial line. Pure enough to unit-test with a temp file."""
    prev = cursors.get(source_key)
    try:
        st = os.stat(path)
    except OSError:
        return [], cursors
    with open(path, "rb") as fh:
        if prev and prev.get("inode") == st.st_ino and st.st_size >= prev["offset"]:
            start = prev["offset"]                       # resume
        elif prev and (prev.get("inode") != st.st_ino or st.st_size < prev["offset"]):
            start = 0                                     # ROTATION/shrink -> Pattern 2 drain happens here
        else:
            start = max(0, st.st_size - INITIAL_TAIL_BYTES)  # first sight
        fh.seek(start)
        end = min(st.st_size, start + MAX_BYTES_PER_TICK)
        if st.st_size - start > MAX_BYTES_PER_TICK:
            log(f"TRUNCATED tail {path}: {st.st_size - start} bytes pending, capped at {MAX_BYTES_PER_TICK}")
        raw = fh.read(end - start)
    last_nl = raw.rfind(b"\n")
    complete = raw[: last_nl + 1] if last_nl >= 0 else b""
    new_offset = start + (last_nl + 1 if last_nl >= 0 else 0)
    lines = complete.decode("utf-8", errors="replace").splitlines()
    cursors = dict(cursors)
    cursors[source_key] = {"inode": st.st_ino, "size": st.st_size, "offset": new_offset, "path": path}
    return lines, cursors
```

### Atomic cursor persist
```python
# Source: standard POSIX atomic-write idiom (os.replace is atomic on the same filesystem).
CURSOR_FILE = "/lnd/nodemon/.log-cursors.json"
def save_cursors(cursors):
    tmp = CURSOR_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cursors, fh)
    os.replace(tmp, CURSOR_FILE)   # atomic swap; a killed tick never leaves a half-written cursor
```

### IP:port normalization (Pattern 5)
```python
# Add to the _RE_* block (L608) and apply in _normalize before _RE_EQ_NUM.
_RE_IP_PORT = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\b")
# _normalize: s = _RE_IP_PORT.sub("<addr>", s)
# "HSWC ... 172.31.11.142:9735->203.0.113.5:41234 broken pipe"
#   -> "HSWC ... <addr>-><addr> broken pipe"  (all peers collapse to one signature)
```

## State of the Art

| Old Approach (Phase 15) | Current Approach (Phase 16) | When Changed | Impact |
|--------------------------|------------------------------|--------------|--------|
| Fixed 64 KB tail (`LOG_TAIL_BYTES`) | Incremental offset+inode cursor (`read_since`) | This phase | Interval-complete capture; `LOG_TAIL_BYTES` demoted to bootstrap window |
| Capture gated on one `error_pattern` substring | Capture by any `log_patterns_config` regex match | This phase | `[WRN]`/`[CRT]` + all seeded patterns captured |
| Native services never tailed | Tailing decoupled from `detection_method` | This phase | PG/bitcoind FATALs captured (was 0/8639) |
| Classification `{benign,warn,ap11,ap12,critical,other}` | `{info,warn,critical}` + human-readable `category` | This phase (D-03) | Clearer operator taxonomy; AI-layer grouping via category |
| "Persist everything, suppress at read" (COL-01) | Info tier count-only at collect time (D-05) | This phase | Kills exemplar flood; count still survives (D-06) |
| Blanket `scp -r` fleet auto-splice | Channel-pointer version gate (D-08) | This phase | Canary isolation before fleet promotion |

**Deprecated/outdated:**
- Obsidian-derived seed patterns (`\[ERR\] HSWC.*Unhandled error` etc.) — proven wrong on the canary; real HSWC errors are `resuming link failed` / `broken pipe`. Obsidian is bootstrap-only (D-02).
- `ap11`/`ap12` as *log classification* labels — dropped (D-03). The AP-12a/b *detector* (pg_health counters) and its *signal ids* are unaffected (D-04).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `MAX_BYTES_PER_TICK = 8 MB` is a sane per-tick ceiling | Pattern 1 / Code | Too low → sustained backlog lag on a very chatty node; too high → a burst tick reads a lot of memory. Operator-tunable; low risk given ~2.5k lines/5min typical. |
| A2 | Fleet lncli absolute path is `/usr/local/bin/lncli` | Pattern 8 | Wrong path → re-provision doesn't fix `pubkey=none`. MUST confirm the real fleet path on a node before writing the default. |
| A3 | Channel-pointer indirection is the chosen D-08 mechanism | Pattern 9 | Several valid designs; operator may prefer a per-node pinned-version file or fileserver allow-list. Confirm before build. |
| A4 | Skip-draining ZSTD archives (no `zstandard` dep) is acceptable | Pitfall 4 | If the operator needs zero-gap capture across compressed rotations, a dep or CLI shell-out is required. Low risk (rare mid-interval rotation; count recovers next tick). |
| A5 | An additive `category text` column (not a new table) is in-bounds for "no new tables" | Pattern 6 | If disallowed, category must ride in `note` or be omitted — weaker Phase-17 grouping interface. Confirm. |
| A6 | Historical `service_log_events`/`log_patterns` rows with old classification strings can stay as mixed history (no backfill required) | Runtime State Inventory | If the read layer must show a single taxonomy over history, a backfill UPDATE is needed. |
| A7 | The convention-driven reconciler (no SSH) is sufficient for D-07 this phase | Pattern 7 | If node paths diverge from the standard `/lnd` layout, convention-only UPSERT registers wrong paths; SSH-probe enhancement would be needed. |

## Open Questions (RESOLVED)

1. **Byte-cap policy on backlog: defer vs. skip-to-EOF?**
   - What we know: COL-04 requires a LOGGED truncation, not a silent cap.
   - What's unclear: on a sustained burst exceeding the cap, do we defer (advance by cap, catch up next tick — risks lag) or jump to EOF (drop the middle, log the count)?
   - Recommendation: **defer** (self-heals when the burst subsides); log the pending backlog each tick. Revisit only if a node stays capped across many ticks.
   - **RESOLVED:** planned into 16-02 (cursor + MAX_BYTES_PER_TICK defer-and-log truncation).

2. **Backfill historical classification?** (A6)
   - Recommendation: do NOT backfill; the `config_id` PK join already resolves suppression per-pattern regardless of the stored classification string. Accept mixed history; document it.
   - **RESOLVED:** no-backfill accepted; taxonomy reseed handled owner-side in 16-04 (mixed history documented, config_id PK join preserved).

3. **ZSTD archive draining** (A4/Pitfall 4)
   - Recommendation: skip-drain compressed archives this phase; note as a known small gap. Reconsider only if the AI/incident layer (Phase 17) proves it needs zero-gap rotation capture.
   - **RESOLVED:** skip-drain ZSTD accepted for this phase; planned into 16-02 (rotation handling drains .gz, skips .zst with a logged gap note).

4. **Exact D-08 gate mechanism** (A3) — needs operator confirmation among channel-pointer / pinned-version-file / fileserver allow-list before the plan freezes it.
   - **RESOLVED via 16-06 Task-1 operator checkpoint** (`checkpoint:decision`, gate="blocking"): the operator confirms the gate mechanism (channel-pointer vs pinned-version) before Tasks 2-3 encode it; no guess is frozen.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 (dev box, for offline tests) | `test_extract.py` | ✓ | 3.12.0 | — |
| pytest (dev box) | running the collector unit tests | ✗ | — | stdlib `unittest` (`python3 test_extract.py`) — the file is stdlib-runnable by design |
| vitest (dev box) | TS read-layer tests | ✓ | ^4 | — |
| Python 3 + venv (nodes) | collector runtime | ✓ (deployed) | node venv | — |
| psycopg2-binary, python-dotenv (nodes) | collector runtime | ✓ (deployed) | pinned in requirements.txt | — |
| lncli wrapper (nodes) | node_pubkey resolution | ✓ (present, possibly stale on canary) | — | COL-06 re-provision |
| stdlib `glob`, `gzip` | PG newest-match; gz archive drain | ✓ (stdlib) | — | — |
| `zstandard` / `unzstd` (nodes) | draining ZSTD LND archives | ✗ (not installed; not recommended) | — | **skip-drain + log** (A4) |
| owner DB role w/ INSERT/UPDATE on `service_inventory` | D-07 reconciler | ✓ (owner creds exist for seeding) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:**
- `pytest` on the dev box → use stdlib `unittest` (the collector tests already run both ways).
- `zstandard` on nodes → skip-drain compressed archives (accepted limitation A4).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (collector) | Python **stdlib `unittest`** (also pytest-compatible) — `scripts/fileserver/test_extract.py`, 27 existing tests, DB-free by design |
| Framework (read-layer) | **vitest ^4** — `npm test` (`vitest run`) |
| Config file | none for unittest (stdlib); `package.json` `"test": "vitest run"` |
| Quick run command | `python3 scripts/fileserver/test_extract.py` (offline, no DB) |
| Full suite command | `python3 scripts/fileserver/test_extract.py && npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COL-04 | `read_since` resumes at offset; complete-lines-only; parks trailing partial | unit | `python3 scripts/fileserver/test_extract.py` | ❌ Wave 0 (new cursor tests) |
| COL-04 | rotation: inode-change + size-shrink detected; archive drained | unit (temp-file fixtures) | same | ❌ Wave 0 |
| COL-04 | PG newest-glob-match resolution; day-roll drain | unit | same | ❌ Wave 0 |
| COL-04 | bounded per-tick bytes logs truncation, defers remainder | unit | same | ❌ Wave 0 |
| COL-05 | capture-by-`log_patterns_config`-match (captures `[WRN]`/`[CRT]`, not just error_pattern) | unit | same | ❌ Wave 0 (extend `extract_events` tests) |
| COL-05 | tier gating: info → count-only (zero exemplars), warn/critical → exemplars | unit | same | ❌ Wave 0 |
| COL-05 | native-service tailing (detection_method decoupled) | unit | same | ❌ Wave 0 |
| COL-05 | IP:port normalization collapses per-peer signatures | unit | same | ❌ Wave 0 |
| COL-06 | classification maps to info/warn/critical; unmatched (config_id NULL) survives read | unit (TS) | `npm test` (extend `service-log-events` shape test) | ⚠️ extend |
| COL-06 | AP-12 detector unaffected by log-class rename (D-04 regression guard) | unit (TS) | `npm test` (`pg-health.test.ts`, `insight-cards.test.ts`) | ✅ exists — assert unchanged |
| COL-06 | absolute LNCLI_BIN resolves pubkey (self-check logs path) | manual (canary) | CANARY-RUNBOOK step | ❌ runbook step |
| COL-04/05/06 | end-to-end: every `[ERR]` in an interval captured; PG FATALs captured | manual (canary) | CANARY-RUNBOOK verification queries | ❌ runbook |

### Sampling Rate
- **Per task commit:** `python3 scripts/fileserver/test_extract.py` (< 2 s, offline).
- **Per wave merge:** `python3 scripts/fileserver/test_extract.py && npm test`.
- **Phase gate:** full suite green + a live canary run on `lnd-ireland` proving interval-complete capture and PG-FATAL capture before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `scripts/fileserver/test_extract.py` — extend with: cursor resume/first-sight/partial-line, rotation (inode-change + size-shrink) via temp files, PG glob newest-match, bounded-bytes truncation log, capture-by-pattern, tier gating (info count-only), IP:port normalization.
- [ ] `src/lib/read/service-log-events.test.ts` (or existing shape test) — assert info/warn/critical narrowing + `config_id = NULL` survival under the new taxonomy.
- [ ] Regression guard test asserting the AP-12 detector path (pg_health counters) is untouched by the log-class rename (D-04).
- [ ] `CANARY-RUNBOOK.md` — add a Phase-16 canary section: interval-complete verification query (compare `log_patterns.count_window` vs on-node `grep -c`), PG-FATAL capture check, LNCLI pubkey self-check, and the D-08 channel-promotion procedure.
- Framework install: none needed (stdlib unittest + existing vitest).

## Security Domain

`security_enforcement` is not set in `.planning/config.json` → treated as **enabled**. This phase runs privileged (root) code on production nodes that ingests untrusted log text and reads operator-tunable regexes from the DB, so the security surface is real despite "no UI."

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture / Trust Boundaries | yes | Collector SELECT-only on warehouse (INSERT facts + scoped UPDATE `log_patterns` only); D-07 reconciler + D-08 gate run owner-side. Cursor is local node state, never in the warehouse. |
| V4 Access Control | yes | DB-role least privilege (`nodemon_telemetry` SELECT-only on dimensions); FORCE RLS host-boxing (proven across 16 host_ids during the splice). NEVER grant the collector write on `service_inventory`. |
| V5 Input Validation | **yes (primary)** | Log lines are untrusted input stored as **inert data** via parameter-bound SQL only (existing `_insert_*` use psycopg2 placeholders). Operator regexes are compile-guarded (`_compile_match_expression`). Path/glob handling must not traverse outside expected dirs. |
| V6 Cryptography | no | No signing in this phase (HMAC is the queue/exec phases). Do not hand-roll any crypto. |
| V7 Error Handling & Logging | **yes** | `_redact` scrubs secrets (password/macaroon/token/hex/b64) BEFORE storage — must run on all newly-captured tiers (warn/critical exemplars + context). Never log macaroon bytes/keys (CLAUDE.md). The bounded-bytes truncation logs a count, not content. |
| V12 File Handling | **yes** | Cursor file written atomically (`os.replace`) to a root-only dir (`/lnd/nodemon/`, 0600-adjacent); artifact-path globs resolved from owner-seeded `service_inventory` values, not from log content. |

### Known Threat Patterns for {node-local Python log collector}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious log line injects SQL | Tampering | Parameter-bound SQL only (existing); message stored as inert text, never interpolated/evaluated |
| Malicious log line poses as a secret / leaks a real one | Info Disclosure | `_redact` before persistence on ALL captured tiers + context lines |
| Operator-authored ReDoS regex hangs the tick | DoS | Anchored/simple seed patterns; code-review UPDATEs; consider a per-tick wall-clock guard (Pitfall 6) |
| Collector granted write on `service_inventory` for reconciler convenience | Elevation of Privilege | Reconciler is a separate owner-run artifact; collector grants unchanged (Pitfall 7) |
| Fleet-wide auto-splice of an unproven build | Tampering / availability | D-08 channel gate; canary-first proof; FORCE RLS as the blast-radius net |
| Path traversal via a crafted `artifact_path`/glob | Tampering | `service_inventory` paths are owner-seeded (trusted); collector never derives paths from log content; glob confined to configured dirs |
| Cursor corruption on a killed tick causing re-ingest or skip | Tampering / integrity | Atomic `os.replace` write; validate inode AND size≥offset on read |
| Reused inode after file delete points cursor at wrong file | Integrity | Validate all of {inode, size, path}; prune unresolved entries (Pitfall 8) |

## Sources

### Primary (HIGH confidence)
- `scripts/fileserver/collect_telemetry.py` (read in full, 1497 lines) — the collector being changed; every function/line reference verified against source.
- `db/seed-log-patterns.sql`, `db/seed-dimensions.sql` — the seeds to re-derive; classification enum + suppress/config_id contract.
- `scripts/fileserver/run_collect-telemetry.sh`, `nodemonDownload.sh`, `deploy-env.sh` — the fileserver rail + lncli wrapper (D-08/COL-06 targets).
- `src/lib/read/service-log-events.ts`, `src/lib/read/pg-health.ts`, `src/lib/read/telemetry-bands.ts`, `src/lib/insight/detectors/ap12-advisory.ts`, `src/lib/db/schema/nodemon.ts`, `src/lib/insight/schema.ts` — the read/detector surface for the D-04 reconciliation (config_id PK join confirmed; signal ids distinct from log class).
- `scripts/fileserver/test_extract.py` (27 tests) — the offline unit-test harness to extend.
- `.planning/phases/16-.../16-CONTEXT.md`, `.planning/REQUIREMENTS.md` (COL-04/05/06), `.planning/ROADMAP.md` §Phase 16, `.planning/todos/pending/2026-07-15-collector-log-capture-enrichment.md`, `.planning/STATE.md` — decisions + requirements.
- github.com/bgreenlee/pygtail (core.py) — inode + byte-offset + size-shrink rotation algorithm [VERIFIED: WebSearch of the repo + PyPI].

### Secondary (MEDIUM confidence)
- docs.lightning.engineering — lnd.conf `logging.file.max-files` / `max-file-size` / `compressor` (ZSTD, v0.19+) [CITED].
- pypi.org/project/pygtail — package metadata / offset-file behavior [CITED].

### Tertiary (LOW confidence — flagged for validation)
- systemd `sd_journal_get_cursor` / `sd_journal_seek_cursor` cursor model [ASSUMED from training; used only to justify the D-09 interface shape, not implemented this phase].
- Fleet lncli absolute path `/usr/local/bin/lncli` [ASSUMED — must confirm on a node].

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — stdlib-only; the collector's dep surface was read from `requirements.txt`; pygtail rejected as a dep with concrete reasons.
- Architecture / code changes: HIGH — every recommendation is grounded in the actual `collect_telemetry.py` line references, verified against source.
- Rotation specifics (LND ZSTD, PG glob): MEDIUM — LND compression cited from official docs; the drain/skip-drain tradeoff flagged as an open question.
- Taxonomy reconciliation (D-04): HIGH — confirmed the `config_id` PK join and the pg_health-counter detector path are independent of the log classification string.
- D-08 gate mechanism: MEDIUM — recommended design is sound but multiple valid alternatives exist; flagged for operator confirmation.

**Research date:** 2026-07-15
**Valid until:** ~2026-08-15 (stable — internal code + slow-moving LND/PG rotation semantics; re-check LND log-compression defaults if the fleet upgrades LND).
