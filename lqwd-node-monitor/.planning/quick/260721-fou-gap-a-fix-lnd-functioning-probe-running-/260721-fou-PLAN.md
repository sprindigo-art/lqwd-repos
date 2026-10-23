---
phase: quick-260721-fou
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/fileserver/collect_telemetry.py
  - scripts/fileserver/test_extract.py
autonomous: true
requirements: [GAP-A2c, GAP-A2a, GAP-A2b]
must_haves:
  truths:
    - "A pgrep (persistent) service that is running + fresh with benign [ERR] lines grades functioning=TRUE (no longer downed by error_count)."
    - "A pgrep service whose tail contains a [CRT]/FATAL-class signature grades functioning=FALSE with a detail reason naming the critical signature."
    - "A pgrep service whose artifact mtime is older than interval×FRESHNESS_GRACE grades functioning=FALSE with detail='artifact stale (Nm old)'."
    - "LND [ERR] lines in a fresh tail are captured as (capped) service_log_events exemplars for operator visibility."
    - "A batch/log service (detection_method != pgrep) still grades functioning via fresh AND error_count==0 and only sets last_success_at via success_pattern — unchanged."
    - "When a pgrep service is fresh, last_success_at is set to the artifact mtime (log liveness = success proxy)."
  artifacts:
    - path: scripts/fileserver/collect_telemetry.py
      provides: "Persistent-proc functioning semantics (running AND fresh, down only on critical), code-side critical-signature detector, honest detail reason."
      contains: "detection_method"
    - path: scripts/fileserver/test_extract.py
      provides: "Offline unit tests pinning the 5 mandated cases (benign-[ERR]-fresh TRUE, [CRT] FALSE, stale FALSE, [ERR] captured, batch regression guard)."
      contains: "grade_log_service"
  key_links:
    - from: "grade_log_service"
      to: "_count_persistent_critical (new) + extract_events log_aggregates"
      via: "critical-signature gate that downs functioning for pgrep procs"
      pattern: "detection_method.*==.*pgrep"
    - from: "grade_log_service"
      to: "service_health.detail"
      via: "honest reason string when functioning=False"
      pattern: "detail ="
---

<objective>
Fix Gap A: the LND "functioning" probe in `scripts/fileserver/collect_telemetry.py` currently
grades `functioning = fresh AND error_count == 0` for every log service. Because healthy LND logs
routinely emit benign `[ERR]` lines, every LND row across the ~26-node fleet reads a false
`functioning=false`, `last_success_at=NULL`, `detail=NULL`, and — because capture is (in the
deployed build) tied to the error axis — `service_log_events` is empty, so there is no visibility
into *why*.

This plan implements the three operator-approved decisions, sequenced capture → functioning → detail:

- **A2c (capture first):** Lock the fact that LND `[ERR]` lines are captured as capped
  `service_log_events` exemplars — BEFORE we stop gating functioning on `error_count`, so visibility
  is preserved when the count gate is dropped.
- **A2a (redefine functioning for persistent procs ONLY):** For `detection_method == "pgrep"`,
  `functioning = running AND fresh`; drop the `error_count == 0` gate; down functioning ONLY on a
  FATAL/`[CRT]`-class signature in the tail; set `last_success_at = artifact mtime` when fresh.
  Batch/log services (non-pgrep) keep their current `error_count`/`success_pattern` behavior.
- **A2b (honest detail):** When `functioning=false`, populate `detail` with a real reason
  (stale / critical-signature / not-running summary). When `functioning=true`, `detail` may stay null.

Purpose: A wrong definition here can mask a real outage (false GREEN) or cry wolf fleet-wide (false
RED). This is fleet-safety-relevant — every case is pinned by an offline unit test.

Output: edits to `collect_telemetry.py` (a code-side critical detector + branched functioning/detail
logic) and 5 new/extended unit tests in `test_extract.py`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@scripts/fileserver/README.md

<interfaces>
<!-- Extracted from scripts/fileserver/collect_telemetry.py — executor uses these directly. -->

Constants (module scope):
- FRESHNESS_GRACE = 3            # multiplier on expected_interval to allow a late tick
- DEFAULT_INTERVAL_SECONDS = 300
- KEEP_N, KEEP_N_CRITICAL = 10   # exemplar caps (KEEP_N defined earlier in file)
- PG_SIG_FATAL = "FATAL"         # existing per-line PG signature substring

Existing signature-count exemplar to MIRROR (do NOT edit it):
```
def _count_pg_log_signatures(text): ...  # pure, per-line substring counts, returns dict
```

Functioning grader to MODIFY:
```
def grade_log_service(inv, running, now, config=None, cursors=None):
    # resolved = resolve_artifact(inv["artifact_path"]); epoch, mtime = _artifact_mtime(resolved)
    # interval = inv.get("expected_interval_seconds") or DEFAULT_INTERVAL_SECONDS
    # fresh = (now.timestamp() - epoch) <= interval * FRESHNESS_GRACE
    # lines, cursors = read_since(source_key, resolved, cursors); text = "\n".join(lines)
    # success = inv.get("success_pattern"); error = inv.get("error_pattern")
    # if success and success in text: last_success_at = mtime
    # if error: error_count = text.count(error)
    # log_events, log_aggregates = extract_events(text, error, service, "error", config, ...)
    # functioning = bool(fresh and error_count == 0)                       # <-- CURRENT (batch rule)
    # if inv.get("detection_method") == "pgrep": functioning = bool(functioning and running)
    # returns dict: running, functioning, last_success_at, last_artifact_mtime, error_count,
    #               detail, log_events, log_aggregates, cursors
```

Capture gate inside extract_events (already captures error_pattern substrings — this is the A2c fact to LOCK):
```
classification, config_id = _classify(line, service, config)
substring_hit = bool(error_pattern) and error_pattern in line
if config_id is None and not substring_hit:
    continue   # captured iff a config regex matched OR the error_pattern substring is present
```
Each captured event carries level/message/context_lines/signature/classification/config_id/source_path;
log_aggregates carry per-signature {classification, sig_tick_count, ...}.

detect_running(inv, now): pgrep -> bool(rc==0); systemctl -> active; cron-mtime -> fresh-by-mtime;
native -> None.

Test harness conventions (scripts/fileserver/test_extract.py):
- stdlib unittest; runs via `python3 -m pytest scripts/fileserver/test_extract.py`.
- Lazy imports inside each test method (mirror TestDeepVmParsers) so a missing new symbol errors ONLY
  the new test, never the module import.
- `_write_tmp(content, dir=None, suffix=".log")` writes a tempfile; use `self.addCleanup(os.unlink, path)`.
- Set staleness with `os.utime(path, (old_epoch, old_epoch))`.
- Datetime: `now` is a datetime; use `datetime.datetime.now()` (grade_log_service calls `now.timestamp()`).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1 (A2c): Lock LND [ERR] capture into service_log_events BEFORE dropping the count gate</name>
  <files>scripts/fileserver/test_extract.py, scripts/fileserver/collect_telemetry.py</files>
  <behavior>
    - Test 4 (capture): A fresh pgrep-style tail containing benign LND `[ERR]` lines, passed through
      `grade_log_service` with error_pattern="[ERR]" and NO config rows, yields `log_events` with
      >=1 captured exemplar whose message contains "[ERR]" — capture does not depend on any config row.
    - Test 4b (cap respected): 50 same-signature `[ERR]` lines yield <= KEEP_N exemplars while the
      matching log_aggregate's sig_tick_count reflects the true count (reuse the existing exemplar-cap
      contract; assert capture is not flooded).
    - The existing 40+ tests continue to pass unchanged.
  </behavior>
  <action>
    Add a test class (e.g. `TestPersistentErrCapture`) to test_extract.py that builds an `inv` dict for
    a pgrep persistent proc (detection_method="pgrep", running_target="lnd", artifact_path=temp log,
    success_pattern=None, error_pattern="[ERR]", expected_interval_seconds=300, service_name="lnd",
    node_pubkey="pk"), writes a fresh temp log with benign `[ERR]` lines via `_write_tmp`, and calls
    `grade_log_service(inv, running=True, now=datetime.now(), config=[], cursors={})`. Assert
    `result["log_events"]` is non-empty and an exemplar message contains "[ERR]". Add the cap assertion
    using 50 repeated same-normalized `[ERR]` lines (<= KEEP_N exemplars, aggregate count == 50 via the
    returned log_aggregates).

    This task is capture-FIRST (locked-decision sequencing): the current `extract_events` gate already
    captures a line when the declared `error_pattern` substring is present (see interfaces). Do NOT
    remove or weaken that substring capture path — this test PINS it so that Task 2 (which drops the
    functioning `error_count` gate) cannot silently take capture down with it. If the test reveals the
    substring path is NOT capturing (e.g. an unexpected suppression), fix the gate in extract_events so
    an error_pattern match is always captured (respecting the exemplar cap), then make the test pass.
    Do NOT touch functioning/detail logic in this task.
  </action>
  <verify>
    <automated>python3 -m pytest scripts/fileserver/test_extract.py -k "PersistentErrCapture or Capture or ExemplarCap" -q</automated>
  </verify>
  <done>New capture tests pass; benign [ERR] lines from a pgrep service produce capped service_log_events exemplars; no existing test regressed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2 (A2a): Redefine functioning for persistent (pgrep) procs — running AND fresh, down only on critical</name>
  <files>scripts/fileserver/collect_telemetry.py, scripts/fileserver/test_extract.py</files>
  <behavior>
    - Test 1 (benign [ERR] -> TRUE): pgrep service, running=True, fresh temp log with benign `[ERR]`
      lines and NO critical marker -> `functioning == True`. (Under the OLD rule error_count>0 forced
      False; this is the core false-alarm fix.)
    - Test 2 ([CRT] -> FALSE): pgrep service, running=True, fresh temp log containing a `[CRT]` line
      -> `functioning == False`. A `\bFATAL\b`-class line does the same.
    - Test 1c (last_success proxy): pgrep service, running=True, fresh, no success_pattern ->
      `last_success_at` equals the artifact mtime (not None).
    - Test 2b (not running -> FALSE): pgrep service, running=False, fresh, benign -> `functioning == False`.
    - Test 5 (batch regression guard): detection_method="cron-mtime" (or "log"/non-pgrep) service with
      benign error lines and error_pattern set -> functioning still follows `fresh AND error_count==0`
      (i.e. error lines DO down it), and last_success_at is set ONLY when success_pattern is in the tail.
      This proves the persistent-proc rule did NOT leak into batch services.
  </behavior>
  <action>
    Add a pure, testable code-side critical detector mirroring `_count_pg_log_signatures`:
    `def _count_persistent_critical(text)` -> int, counting per-line matches of a FATAL/`[CRT]`-class
    signature set. Define a module constant near PG_SIG_FATAL, e.g.
    `PERSISTENT_CRITICAL_SIGNATURES = (r"\[CRT\]", r"\bFATAL\b", r"\bFTL\b")` and match each line with a
    compiled regex (reuse the `_compile_match_expression` cache pattern or `re.search`). Keep it pure
    (input text -> int), no I/O.

    In `grade_log_service`, branch the functioning rule on `detection_method`:
    - PERSISTENT (detection_method == "pgrep"): compute
      `critical_hits = _count_persistent_critical(text)` PLUS any config-classified criticals already
      surfaced in `log_aggregates` (an aggregate whose classification == "critical"). Then
      `functioning = bool(running and fresh and critical_hits == 0)`. Do NOT include `error_count` in
      this branch. When `fresh` and `last_success_at is None`, set `last_success_at = mtime`
      (log-liveness success proxy). Preserve the existing `success_pattern` path (if a real
      success_pattern matched, that mtime still applies).
    - BATCH / everything else: keep the EXISTING behavior exactly —
      `functioning = bool(fresh and error_count == 0)`; last_success_at only via success_pattern.
      Do not regress it.

    Keep `error_count` computed and returned for BOTH branches (it still feeds service_health for
    visibility); it simply no longer GATES functioning for persistent procs. Thread `critical_hits` (or
    the resolved reason) forward so Task 3 can build `detail`.

    Add the 5 mandated test cases (Tests 1, 1c, 2, 2b, 5) to test_extract.py in a new class
    `TestFunctioningSemantics`, each constructing an `inv` + temp log and asserting `result["functioning"]`
    / `result["last_success_at"]`. For staleness-independent cases keep the temp file fresh; Test 5 uses a
    non-pgrep detection_method with error_pattern present and asserts error lines force functioning=False.
  </action>
  <verify>
    <automated>python3 -m pytest scripts/fileserver/test_extract.py -k "FunctioningSemantics" -q && python3 -m pytest scripts/fileserver/test_extract.py -q</automated>
  </verify>
  <done>All 5 functioning cases pass; benign-[ERR] pgrep services grade TRUE, [CRT]/FATAL grade FALSE, not-running grades FALSE, fresh pgrep sets last_success_at=mtime, and non-pgrep batch services keep the error_count/success_pattern rule. Full suite green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3 (A2b): Populate honest `detail` when functioning=false</name>
  <files>scripts/fileserver/collect_telemetry.py, scripts/fileserver/test_extract.py</files>
  <behavior>
    - Test 3 (stale): pgrep service whose artifact mtime is older than interval×FRESHNESS_GRACE (e.g.
      os.utime to now-3600 with interval=300) -> functioning=False AND
      `detail` startswith/contains "artifact stale" and reports an age in minutes (e.g. "artifact stale (60m old)").
    - Test 2 detail: the [CRT] case from Task 2 -> `detail` contains "critical signature" and the count
      (e.g. "1 critical signature(s) ...").
    - Test 2b detail: not-running (fresh, benign) -> `detail` names the not-running reason
      (e.g. "process not running").
    - Missing artifact still -> detail == "artifact missing" (unchanged).
    - functioning=true cases -> `detail` is None (or a benign last-success note); assert it does NOT
      contain "stale"/"critical"/"not running".
  </behavior>
  <action>
    In `grade_log_service`, after functioning is decided, set `detail` to an honest, concise reason
    when `functioning is False` (persistent branch), in priority order:
    1. artifact missing (epoch is None) -> "artifact missing" (already present; keep).
    2. not fresh -> f"artifact stale ({minutes}m old)" where
       minutes = int((now.timestamp() - epoch) // 60).
    3. downed by critical (critical_hits > 0) -> f"{critical_hits} critical signature(s) in tail".
    4. not running (pgrep running=False, otherwise fresh) -> "process not running (pgrep)".
    5. otherwise -> a concise summary (e.g. f"functioning=false (running={running}, fresh={fresh})").
    When `functioning is True`, leave detail None (may optionally note last-success; keep null to match
    existing behavior). Do NOT set stale/critical detail on the BATCH branch beyond what already exists
    there — only add the honest-reason summary for the persistent-proc branch (batch keeps its current
    detail behavior; a batch summary reason is acceptable but must not claim "artifact stale" unless the
    file is genuinely stale).

    Extend the Task 2 test cases (or add `TestFunctioningDetail`) with the stale case (Test 3) and detail
    assertions on the [CRT] and not-running cases. Use substring assertions ("artifact stale",
    "critical signature", "not running") so exact wording stays flexible.
  </action>
  <verify>
    <automated>python3 -m pytest scripts/fileserver/test_extract.py -q</automated>
  </verify>
  <done>Stale pgrep services report detail="artifact stale (Nm old)"; [CRT]-downed services report a "critical signature" reason with count; not-running reports a not-running reason; artifact-missing unchanged; functioning=true rows carry no false reason. Full suite green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| node log file -> collector | Untrusted, high-volume log text tailed each tick; benign [ERR] noise must not mask nor fabricate health. |
| collector grade -> service_health row | The graded `functioning`/`detail` drives operator RED/GREEN and outage response fleet-wide. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-A-01 | Denial of Service (visibility) | grade_log_service functioning rule | mitigate | False RED (benign [ERR] downing healthy LND) is the reported bug; Task 2 drops the error_count gate for persistent procs and pins it with Tests 1/1c. |
| T-A-02 | Repudiation / masking (false GREEN) | persistent-proc functioning = running AND fresh | mitigate | A hung-but-logging proc could read GREEN; the FATAL/[CRT] critical detector (Task 2) and freshness gate down it, pinned by Tests 2/2b/3. Detection is code-side (no live-DB config dependency). |
| T-A-03 | Tampering (regression into batch services) | non-pgrep grading path | mitigate | The new semantics is scoped strictly to detection_method=="pgrep"; Test 5 is a regression guard proving batch services keep error_count/success_pattern behavior. |
| T-A-04 | Information disclosure | detail string + captured exemplars | accept | messages/context flow through the existing `_redact` path (macaroon/secret redaction already covered by TestRedaction); this plan adds no new raw-log surface. |

No package-manager installs in this plan (pure stdlib Python edit) — no supply-chain / legitimacy gate required.
</threat_model>

<verification>
- `python3 -m pytest scripts/fileserver/test_extract.py -q` — full offline suite green (pre-existing 40+ tests + the 5 mandated new cases).
- The 5 mandated cases exist and pass: (1) benign-[ERR] pgrep fresh -> functioning TRUE; (2) [CRT] pgrep -> functioning FALSE + detail reason; (3) stale-artifact pgrep -> FALSE + "artifact stale"; (4) [ERR] lines produce captured events; (5) non-pgrep batch service unchanged (regression guard).
- `grade_log_service` branches functioning strictly on `detection_method == "pgrep"`; batch path is byte-for-byte the prior rule.
- No live-DB `service_inventory` config edit is required (critical detection is code-side).
</verification>

<success_criteria>
- Persistent (pgrep) services grade `functioning = running AND fresh`, downed ONLY by a FATAL/[CRT]-class signature — never by benign [ERR] count.
- `last_success_at` is set to the artifact mtime for fresh persistent procs.
- LND [ERR] lines are captured as capped service_log_events exemplars.
- `detail` carries an honest reason on every functioning=false persistent row (stale / critical / not-running / missing).
- Batch/log (non-pgrep) services are provably unchanged.
- Full `test_extract.py` suite passes offline (no DB, no network).
</success_criteria>

<notes>
- **Deploy is an operator ops step — do NOT attempt it here.** The collector runs on the fileserver/nodes;
  the fleet-wide empty `service_log_events` / false `functioning=false` is (in part) a deployed-build lag.
  Implementing + testing in this repo is in-scope; redeploying the updated collector to the nodes and
  bumping `COLLECTOR_VERSION` on rollout is a separate operator action. Call it out in the SUMMARY.
- **No live-DB config changes.** Critical-signature detection is code-side (`_count_persistent_critical`)
  so no `service_inventory` / `log_patterns_config` row edits are needed to fix the fleet.
- **Out of scope:** the dashboard read/UI (Gap B, already done).
- Bump `COLLECTOR_VERSION` in collect_telemetry.py as part of the change so the rollout is auditable.
</notes>

<output>
Create `.planning/quick/260721-fou-gap-a-fix-lnd-functioning-probe-running-/260721-fou-SUMMARY.md` when done.
</output>
