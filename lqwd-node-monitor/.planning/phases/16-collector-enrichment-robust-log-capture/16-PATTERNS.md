# Phase 16: Collector Enrichment — Robust Log Capture - Pattern Map

**Mapped:** 2026-07-15
**Files analyzed:** 13 (9 modified, 2–3 new, plus test + runbook extensions)
**Analogs found:** 13 / 13 (every changed file has an in-repo analog; the ONE justified hand-roll — the cursor/`LogSource` — has a cited external algorithm + a same-file idiom to copy)

> **SELECT-only collector boundary (preserved in every assignment below):** the
> collector's ONLY warehouse writes are INSERT on fact tables + the scoped UPSERT
> on `log_patterns` (`_upsert_log_patterns`, L1297) inside `write_tick`. It NEVER
> writes `service_inventory` or `log_patterns_config`. The D-07 reconciler and the
> D-08 gate are SEPARATE owner-side/bash artifacts. The cursor is LOCAL node state
> (`/lnd/nodemon/.log-cursors.json`), never the warehouse. Any plan that adds a
> `GRANT ... ON service_inventory` to `nodemon_telemetry` is wrong.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/fileserver/collect_telemetry.py` (LogSource/cursor NEW) | collector / utility | file-I/O, streaming | `_tail_text` (L573) + `_normalize`/`_redact`/`_classify` block (L624–685) in same file | same-file self-analog (exact) |
| `scripts/fileserver/collect_telemetry.py` (`extract_events` refactor) | collector | transform / event-driven | `extract_events` (L688) itself + `_classify` (L665) | exact (in-place extend) |
| `scripts/fileserver/collect_telemetry.py` (`_normalize` IP:port) | collector | transform | `_normalize` (L624) + `_RE_*` block (L608–612) | exact (in-place extend) |
| `scripts/fileserver/collect_telemetry.py` (tier gating + retention consts) | collector | CRUD | `_prune_tiered` (L1337) + `LOG_RETENTION_WINDOWS`/`LOG_MIDDLE_EVICT_CLASSES` (L1326/L1334) + `_insert_log_events` (L1278) | exact (in-place edit) |
| `scripts/fileserver/collect_telemetry.py` (decouple tailing from `detection_method`) | collector | request-response | `grade_service` (L814) + `main()` native branch (L1462–1476) | exact (in-place edit) |
| `scripts/fileserver/collect_telemetry.py` (LNCLI self-check, COLLECTOR_VERSION) | collector | request-response | `resolve_node_pubkey` (L86) + `log()` (L56) | exact |
| `db/seed-log-patterns.sql` (re-derive info/warn/critical + category) | config / migration | batch | `db/seed-log-patterns.sql` itself | exact (rewrite in place) |
| `db/seed-dimensions.sql` (document daemon paths/globs) | config / migration | batch | `db/seed-dimensions.sql` itself | exact (extend) |
| `scripts/fileserver/path-reconciler.(py\|sql)` (NEW, owner-side) | migration / service | CRUD (UPSERT) | `db/seed-dimensions.sql` (owner-run UPSERT discipline) + `fetch_inventory` (L851, SELECT shape) | role-match |
| `scripts/fileserver/deploy-env.sh` (absolute `LNCLI_BIN` + `NODEMON_CHANNEL`) | config / provisioning | file-I/O | `deploy-env.sh` itself (L55/L63–66/L101–111) | exact (in-place edit) |
| `scripts/fileserver/run_collect-telemetry.sh` (D-08 channel gate) | config / wrapper | request-response | `run_collect-telemetry.sh` `check_for_updates`/`update_one` (L46–89) | exact (in-place edit) |
| `scripts/fileserver/nodemonDownload.sh` (channel-aware pull, optional) | config / wrapper | file-I/O | `nodemonDownload.sh` itself (L37) | exact |
| `scripts/fileserver/test_extract.py` (extend) | test | transform | `test_extract.py` classes (L45–182) | exact (extend) |
| `src/lib/read/service-log-events.ts` (taxonomy reconcile — docs/narrow only) | service (read-layer) | request-response | `service-log-events.ts` itself (`narrowLevel` L86, module doc L6–36) | exact (verify + doc edit) |
| `src/lib/read/telemetry-bands.ts` | config (read-layer) | transform | — (D-04: verify-only, UNAFFECTED) | verify-only |
| `src/lib/insight/detectors/ap12-advisory.ts` | service (detector) | transform | — (D-04: verify-only, UNAFFECTED — pg_health counters) | verify-only |

## Shared Patterns

### SELECT-only warehouse boundary (applies to ALL collector changes)
**Source:** `write_tick` (`collect_telemetry.py` L1397–1425)
The single write transaction: `SET LOCAL app.host_id/app.node_pubkey`, then the
INSERT fan-out + `_upsert_log_patterns` + `_prune_tiered`. Every new write MUST
live INSIDE this txn AFTER the `SET LOCAL` lines (FORCE RLS fail-closes to zero
rows otherwise). No new grant, no new table, no cursor-in-DB.
```python
with conn:                                    # commit on success / rollback on error
    with conn.cursor() as cur:
        cur.execute("SET LOCAL app.host_id = %s", (host_id,))
        cur.execute("SET LOCAL app.node_pubkey = %s", (node_pubkey or "",))
        services   = _rls_admissible_node_rows(services, node_pubkey, "service_health")
        log_events = _rls_admissible_node_rows(log_events, node_pubkey, "service_log_events")
        ... _insert_log_events(cur, host_id, now, log_events)
            _upsert_log_patterns(cur, host_id, now, log_events)   # the ONE log_patterns write
            _prune_tiered(cur)
```

### Parameter-bound SQL + redaction (applies to every captured tier)
**Source:** `_insert_log_events` (L1278) uses psycopg2 placeholders ONLY; `_redact`
(L635) scrubs `password/secret/macaroon/token/api_key/privkey` KV + long hex/b64
blobs BEFORE storage. The widened warn/critical capture MUST route every stored
`message`/`context_lines` through `_redact` (already done inside `extract_events`
L716–717) — never bypass it for the new tiers.

### `log()` observability (applies to bounded-bytes truncation, LNCLI self-check, COLLECTOR_VERSION)
**Source:** `log()` (L56) — timestamped stdout line captured by the cron redirect.
COL-04's LOGGED truncation, the D-08 version marker, and the COL-06 lncli self-check
all emit via this. Never log macaroon bytes/keys (CLAUDE.md; `_redact` covers stored text).

### Owner-run out-of-band seed discipline (applies to seeds + reconciler)
**Source:** `db/seed-log-patterns.sql` L1–13 + `db/seed-dimensions.sql` L1–24 headers.
Both declare: OPERATOR-RUN, hand-authored DATA seed, NOT a Drizzle migration, run
as owner because `nodemon_telemetry` has SELECT-only on the config/dimension tables.
The D-07 reconciler copies this header contract verbatim.

---

## Pattern Assignments

### `collect_telemetry.py` — NEW `LogSource`/cursor module (COL-04, D-09)

**Analog (same-file idiom):** `_tail_text` (L573–582) — the exact `open(rb)` +
`seek` + `decode("utf-8", errors="replace")` shape to evolve into `read_since`.
**External algorithm (cited, hand-rolled — the ONE justified exception):**
pygtail `core.py` (inode + byte-offset + size-shrink). Do NOT add pygtail as a dep
(fleet venv stays `psycopg2-binary` + `python-dotenv`; RESEARCH §Don't Hand-Roll).

**Current fixed-tail to REPLACE** (`_tail_text`, L573):
```python
def _tail_text(path, max_bytes):
    """Last max_bytes of a file decoded as utf-8 (best effort); '' on error."""
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - max_bytes))   # <-- the 15-second window bug
            return handle.read().decode("utf-8", errors="replace")
    except OSError:
        return ""
```

**Constants to demote/add** (near L53): `LOG_TAIL_BYTES = 65536` becomes the
first-sight `INITIAL_TAIL_BYTES`; add `MAX_BYTES_PER_TICK = 8*1024*1024` (LOGGED
cap) and `CURSOR_FILE = "/lnd/nodemon/.log-cursors.json"`. New stdlib imports:
`glob`, `gzip` (see RESEARCH Standard Stack).

**`read_since` shape (RESEARCH Code Examples — copy faithfully):** returns
`(lines, updated_cursors)`; complete lines only (park offset at last `\n`+1);
inode-match & `size >= offset` → resume; inode-change | size-shrink → rotation
(Pattern 2 drain); no cursor → seed near EOF (`max(0, size - INITIAL_TAIL_BYTES)`);
bounded read with a `log()` truncation line.

**Atomic persist (copy this idiom exactly):**
```python
def save_cursors(cursors):
    tmp = CURSOR_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(cursors, fh)
    os.replace(tmp, CURSOR_FILE)   # atomic swap; a killed tick never corrupts the map
```

**`resolve_artifact` helper (new, feeds tailer + `_artifact_mtime` L585):** if the
`artifact_path` has a glob metachar or is a dir → newest match by mtime (PG
`postgresql-*.log`); else verbatim (LND stable name). Key the cursor by a stable
`source_key` (service name), NOT path, so PG day-roll survives.

**D-09 interface discipline:** `read_since(source_key, artifact, cursor) → (lines, new_cursor)`
so a future `JournaldSource.read_since` is a bolt-on. Cursor is a plain
JSON-serializable dict `{path, inode, offset, size}`.

---

### `collect_telemetry.py` — `extract_events` refactor (COL-05, D-05/D-06)

**Analog:** `extract_events` itself (L688–738) — the signature dedup + `buckets`
+ `KEEP_N` exemplar + `sig_tick_count` machinery is PROVEN; extend, do not rebuild.

**Capture gate to change** (L701–703):
```python
    for i, line in enumerate(lines):
        if error_pattern not in line:          # <-- substring gate; REPLACE
            continue
        signature = hashlib.sha256(_normalize(line).encode("utf-8")).hexdigest()
```
Replace with capture-by-`log_patterns_config`-match: a line is captured iff
`_classify(line, service, config)` (L665) returns a non-null `config_id` (or a
matched row). This captures `[WRN]`/`[CRT]` + every seeded regex, not just the one
`error_pattern`. Keep `error_pattern`/`text.count(error)` in `grade_log_service`
(L787–788) for the `service_health.error_count` axis — DECOUPLE capture from it.

**Tier gating to ADD (D-05):** from the matched config row read the new tier
(info/warn/critical). The exemplar-emission loop (L729–738) becomes tier-aware:
- **info → ZERO exemplars** (skip the `events.append`) but STILL bump the aggregate.
- **warn → capped exemplars (`KEEP_N`) + count** (current behavior).
- **critical → more exemplars + count.**
The `sig_tick_count` per-tick count (L736) MUST be produced for ALL matched
signatures regardless of tier — that is the D-06 "count always survives" tally that
`_upsert_log_patterns` (L1297) writes to the `log_patterns` aggregate.

**Existing bucket/exemplar loop to preserve (L729–738):**
```python
    events = []
    for signature in order:
        bucket = buckets[signature]
        exemplars = [bucket["first"]]
        if bucket["newest"] is not None:
            exemplars.append(bucket["newest"])
        for event in exemplars[:KEEP_N]:
            event["sig_tick_count"] = bucket["count"]   # <-- always set; tier gates the append
            events.append(event)
    return events
```

**COL-01 policy shift to reconcile:** Phase-15's "persist everything, suppress at
read" (documented in `service-log-events.ts` L9–15 + schema L273) is INTENTIONALLY
overridden for info → count-only at collect time. Update the module docstrings/tests.
The read-time `config_id` suppression join stays for warn/critical exemplars.

---

### `collect_telemetry.py` — `_normalize` IP:port collapse (COL-05, Pattern 5)

**Analog:** `_normalize` (L624–632) + the `_RE_*` block (L608–612). Add ONE rule in
the same style, applied BEFORE `_RE_EQ_NUM`:
```python
# Add near L612 with the other _RE_* rules:
_RE_IP_PORT = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}\b")   # 172.31.11.142:9735
# In _normalize (L624), after the ts/hex/pid subs, before _RE_EQ_NUM:
    s = _RE_IP_PORT.sub("<addr>", s)   # collapses both sides of "a:p->b:p" -> one signature
```
Add a `test_extract.py` case (mirror `TestNormalizeSignatureStability` L45) asserting
two broken-pipe lines to different peers share a signature.

---

### `collect_telemetry.py` — tier-driven retention constants (D-05, COL-06)

**Analog:** `LOG_RETENTION_WINDOWS` (L1326) + `LOG_MIDDLE_EVICT_CLASSES` (L1334) +
`_prune_tiered` (L1337). These reference the OLD classes — rewrite to the new taxonomy.

**Current (old taxonomy — REWRITE):**
```python
LOG_RETENTION_WINDOWS = (
    ("benign", "21 days"),
    ("other", "90 days"),
    ("warn", "90 days"),
    ("ap11", "90 days"),
)
LOG_MIDDLE_EVICT_CLASSES = ("benign", "other")
```
Reconcile to `{info, warn, critical}` (+ handle `other`/NULL for unmatched):
info → short window + middle-evict (it is the new "benign"); warn → 90d; critical →
never time-pruned (exempt, as `ap12`/`critical` are today). The `_prune_tiered`
DELETE loop (L1348–1353) and the keep-N eviction (L1358–1370) stay structurally
identical — only the tuple values change. `log_patterns` aggregate stays NEVER pruned.

---

### `collect_telemetry.py` — decouple tailing from `detection_method` (COL-05, Pattern 4)

**Analog:** `grade_service` (L814–832) + `main()` native branch (L1462–1476).

**Current early-return that starves native logs** (`grade_service`, L827–830):
```python
    if inv.get("detection_method") == "native":
        base["detail"] = "native probe pending"
        return base                              # <-- postgres/bitcoind NEVER tailed
```
**Current PG double-tail to UNIFY** (`main()`, L1469–1476): `main()` already tails the
PG log via `_tail_text(..., LOG_TAIL_BYTES)` (L1475) to feed `_count_pg_log_signatures`
(L977) for `pg_health`. Fix: tail ONCE via the cursor and fan the captured text to
BOTH `_count_pg_log_signatures` AND `extract_events` — never tail the same file twice
(RESEARCH Anti-Patterns). After the running/functioning determination (native OR
log-based), if the inventory row has a resolvable `artifact_path`, run the cursor
tailer + `extract_events` independent of `detection_method`.

---

### `collect_telemetry.py` — LNCLI self-check + COLLECTOR_VERSION (COL-06 Pattern 8, D-08 Pattern 9)

**Analog:** `resolve_node_pubkey` (L86–95) + `log()` (L56).
```python
def resolve_node_pubkey():
    lncli = os.environ.get("LNCLI", "lncli")   # <-- bare-lncli fallback = pubkey=none blip
    rc, out, _ = run_argv([lncli, "getinfo"], timeout=15)
```
Add a startup self-check that `log()`s the resolved lncli path and WARNs on
`pubkey=none` (the `main()` tick summary L1482 already logs `pubkey={'set'|'none'}`
— extend it). Embed `COLLECTOR_VERSION = "16.x"` near the top constants (L45–53) and
`log()` it each tick (D-08 observability; NO warehouse write).

---

### `db/seed-log-patterns.sql` — re-derive to info/warn/critical + category (COL-06, D-01/D-03)

**Analog:** the file itself (L42–81) — same `INSERT INTO log_patterns_config
(match_expression, service, level, classification, suppress, note) VALUES (...)` shape,
Python-regex escaping rules (`\[WRN\]`/`\[ERR\]`/`\[CRT\]`, L22–27), and the
verification `SELECT` (L88).

**What changes:** classification domain `{benign,warn,ap11,ap12,critical,other}` →
`{info,warn,critical}`; add a human-readable `category` value per row; REPLACE the
Obsidian-proven-wrong rows (e.g. `\[ERR\] HSWC.*Unhandled error` L53) with REAL
canary signatures. RESEARCH Pattern 6 table gives the exact re-derivation:

| Real line (regex-escaped) | Tier | category | Replaces |
|---|---|---|---|
| `CMGR.*Unknown connid=` | info | `conn-noise` | (new; count-only) |
| `HSWC.*failing link` / `broken pipe` | warn | `channel-reconnect` | `HSWC.*Unhandled error` (L53, wrong) |
| `HSWC.*resuming link failed` | warn | `channel-reconnect` | — |
| `SWPR.*Failed to sweep` / `UTXN.*Failed to sweep` | warn | `sweep-failure` | — |
| `PEER.*peer exiting` / `resend failed` | info | `peer-churn` | — |
| `FATAL: sorry, too many clients already` | critical | `postgres-connection-exhaustion` | `ap12` (L64) |
| `\[CRT\]` | critical | `lnd-critical` | (keep; L73) |
| `closechannel` | warn/info | `close-event` | `ap11` (L71) |

**Category column:** RESEARCH A5 — an ADDITIVE nullable `category text` column on
`log_patterns_config` (schema `nodemon.ts` L345) is in-bounds for "no new tables";
confirm with operator. Keep the per-row `config_id`/`suppress` contract (L29–37) —
the read-layer join is on `config_id` PK, unaffected.

---

### `db/seed-dimensions.sql` — document daemon paths/globs (COL-06)

**Analog:** the `service_inventory` INSERT (L42–79). Document the standard fleet
log paths/globs the reconciler maintains (lnd stable name, bitcoind `/bitcoin/debug.log`,
postgres `/var/log/postgresql/postgresql-*.log` GLOB). Note the canary-added rows
(RESEARCH Runtime State Inventory) so the reconciler reconciles, not clobbers.

---

### `scripts/fileserver/path-reconciler.(py|sql)` — NEW owner-side reconciler (COL-06, D-07)

**Analog (owner-run UPSERT discipline):** `db/seed-dimensions.sql` header (L1–24)
+ its `service_inventory` INSERT (L42). **Analog (SELECT shape for the hosts fan):**
`fetch_inventory` (L851–859) parameter-bound query.
**Recommended shape (RESEARCH Pattern 7):** for each `hosts` row, UPSERT convention
paths with `ON CONFLICT (host_id, service_name) DO UPDATE SET artifact_path =
EXCLUDED.artifact_path`. Run as the nodemon OWNER role. MUST be a SEPARATE artifact —
never fold into `collect_telemetry.py` (Pitfall 7: would need a `service_inventory`
grant, breaking T-15). Minimum viable: convention-driven UPSERT keyed off `hosts`,
no SSH.

---

### `scripts/fileserver/deploy-env.sh` — absolute LNCLI_BIN + channel pin (COL-06, D-08)

**Analog:** the file itself. **LNCLI_BIN default to harden** (L55):
```bash
LNCLI_BIN="${LNCLI_BIN:-$(command -v lncli || true)}"   # <-- empty under thin cron PATH
```
Pin an absolute fleet-standard default (e.g. `/usr/local/bin/lncli` — RESEARCH A2:
CONFIRM the real path on a node first) rather than relying solely on `command -v`.
The wrapper heredoc (L63–66) and the managed env block (L101–111, which writes
`LNCLI=/lnd/bashScripts/lncli-telemetry.sh` at L109) are the exact insertion points.
Add a `NODEMON_CHANNEL=stable` line to the managed block (D-08) in the same style.

---

### `scripts/fileserver/run_collect-telemetry.sh` — D-08 channel gate (D-08, Pattern 9)

**Analog:** `check_for_updates` / `update_one` (L46–89) — the md5-compare + scp
self-update loop is the exact mechanism to gate. **Current blanket pull** (L70–88)
compares `local vs remote md5` for a fixed `PAYLOAD` and pulls on any diff. Insert a
channel gate BEFORE `check_for_updates` (called L102): read `NODEMON_CHANNEL` (sourced
from `.nodemon.env` at L108–111) → read `~/nodemon/channels/<channel>` pointer on the
fileserver → md5-compare/pull ONLY that version's payload. The `flock` overlap guard
(L96–100) and env-sourcing (L107–114) stay unchanged. RESEARCH A3: exact mechanism
(channel-pointer vs pinned-version file) needs operator confirmation before build.

---

### `scripts/fileserver/nodemonDownload.sh` — channel-aware pull (optional, D-08)

**Analog:** the file itself (L37 `scp -r ...${REMOTE_DIR}/*`). This blanket `scp -r`
is the accidental-splice mechanism (D-08). Either make it channel-aware or leave it
and gate exclusively in `run_collect-telemetry.sh` (RESEARCH recommends the latter —
the wrapper is the enforcement point). If touched, preserve the D-01/D-03 header
contract (L10–15: no secrets on this rail).

---

### `scripts/fileserver/test_extract.py` — extend (Wave 0)

**Analog:** existing classes `TestNormalizeSignatureStability` (L45), `TestExemplarCap`
(L130), `TestConfigClassification` (L155). Stdlib `unittest`, DB-free, temp-file
fixtures. Add: cursor resume/first-sight/partial-line, rotation (inode-change +
size-shrink), PG glob newest-match, bounded-bytes truncation log, capture-by-pattern
(`[WRN]`/`[CRT]`), tier gating (info → zero exemplars), IP:port normalization.
Run: `python3 scripts/fileserver/test_extract.py`.

---

### `src/lib/read/service-log-events.ts` — taxonomy reconcile (D-04, verify + doc)

**Analog:** the file itself. **`narrowLevel` (L86–93) already handles the new tiers** —
it maps `level` (error/warn/info), NOT `classification`, and already narrows
`crit/critical → error`, `warn/warning → warn`. The `config_id` PK join (L72,
`c.id = e.config_id`) is UNAFFECTED by the classification rename (that is the whole
point of the config_id design, documented L17–27). **Action:** update the module doc
(L9–15) to reflect the D-05 info-tier collect-time override; verify the
`config_id = NULL` survival invariant (L26) still holds; confirm NO branch reads the
string `"ap12"`/`"ap11"` as a classification value (grep CONFIRMED: none in `src/lib`).

---

## Verify-Only (D-04 — do NOT change behavior)

### `src/lib/read/telemetry-bands.ts`
`pg_conn_saturation` / `pg_40001_rate_multiple` / `oom_kills` bands (L119–141) derive
from `pg_health` COUNTERS, independent of the log classification string. UNAFFECTED
by dropping the `ap12` log-class. Verify only.

### `src/lib/insight/detectors/ap12-advisory.ts`
Consumes `pg_health` counters (`tooManyClients`, `connSaturation`, `rateMultiple` —
L102–130) and signal ids `ap12a_conn_exhaustion`/`ap12b_serialization` (L92), which
are DISTINCT from the log classification label (module doc L23–33 freezes this).
Dropping the `ap12` log-class does not touch it (D-04). Add a regression-guard test
asserting the detector is untouched. If the `ap12` *string* surfaces in UI copy,
rename/clarify — but the detector logic stays.

### `src/lib/db/schema/nodemon.ts`
Comments at L273/L345 enumerate the OLD `{benign,warn,ap11,ap12,critical,other}` set.
Update comments to `{info,warn,critical}`; add the optional additive `category text`
column (L345 area) if operator approves (RESEARCH A5). `classification` stays
plain `text()` (NOT a pgEnum) — SQL-tunable per D-05 (L273 comment).

---

## No Analog Found

None. Every changed file has an in-repo analog. The ONE hand-rolled component
(the `LogSource`/cursor) has BOTH a same-file idiom to evolve (`_tail_text`, L573)
AND a cited external algorithm (pygtail inode+offset+size-shrink) — deliberately
NOT added as a dependency (RESEARCH §Don't Hand-Roll: 2-dep fleet venv; no `.offset`
sidecar next to read-only logs; D-09 multi-source interface).

## Metadata

**Analog search scope:** `scripts/fileserver/` (collector + wrappers + tests),
`db/` (seeds), `src/lib/read/`, `src/lib/insight/detectors/`, `src/lib/db/schema/`.
**Files scanned:** 9 read in full/targeted + 4 grep-verified (schema, ap11/ap12 string
branches, test structure, PG-signature counting).
**Key confirmation:** grep found ZERO code branches on `"ap12"`/`"ap11"` as a
classification value in `src/lib` — the D-04 read-layer reconciliation is comment +
enum only, not logic.
**Pattern extraction date:** 2026-07-15
