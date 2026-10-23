#!/usr/bin/env python3
"""test_extract.py - offline unit tests for the COL-01 log-capture helpers in
collect_telemetry.py (_normalize / _redact / extract_events / _classify).

Stdlib-only (unittest); also runs under pytest (`python3 -m pytest test_extract.py`).
No DB, no psycopg2 required - collect_telemetry guards the import so this file
is runnable before migration 0003 is applied to the live nodemon DB.
"""

import os
import sys
import time
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from collect_telemetry import (  # noqa: E402
    KEEP_N,
    MESSAGE_MAX_CHARS,
    _normalize,
    _redact,
    extract_events,
)

MACAROON_HEX = "a" * 64  # 64-char hex macaroon-like blob

BENIGN_CONFIG_ROW = {
    "id": "11111111-1111-1111-1111-111111111111",
    "match_expression": "unable to read message from peer",
    "service": None,
    "level": "error",
    "classification": "benign",
    "suppress": True,
}
AP12_CONFIG_ROW = {
    "id": "22222222-2222-2222-2222-222222222222",
    "match_expression": "sorry, too many clients already",
    "service": "postgres",
    "level": "fatal",
    "classification": "ap12",
    "suppress": False,
}
CONFIG = [BENIGN_CONFIG_ROW, AP12_CONFIG_ROW]


class TestNormalizeSignatureStability(unittest.TestCase):
    def test_timestamp_and_pid_variants_share_signature(self):
        """Two lines differing ONLY by timestamp/pid collapse to ONE signature."""
        line_a = (
            "2026-01-02 03:04:05.123 [ERR] PEER: unable to read message from peer: EOF"
        )
        line_b = (
            "2026-03-09 17:44:59.901 [ERR] PEER: unable to read message from peer: EOF"
        )
        self.assertEqual(_normalize(line_a), _normalize(line_b))
        syslog_a = "Jan 12 03:04:05 host postgres[12345]: FATAL: connection reset"
        syslog_b = "Feb  3 23:59:59 host postgres[99999]: FATAL: connection reset"
        self.assertEqual(_normalize(syslog_a), _normalize(syslog_b))

    def test_long_hex_and_numeric_values_collapse(self):
        line_a = "disconnecting peer=0311aa22bb33cc44dd55ee66ff770011 id=17"
        line_b = "disconnecting peer=aabbccddeeff00112233445566778899 id=402"
        self.assertEqual(_normalize(line_a), _normalize(line_b))

    def test_distinct_messages_do_not_collapse(self):
        self.assertNotEqual(
            _normalize("2026-01-02 03:04:05 [ERR] unable to read message from peer"),
            _normalize("2026-01-02 03:04:05 [ERR] channel force-closed"),
        )

    def test_extract_events_same_signature_across_timestamps(self):
        text = (
            "2026-01-02 03:04:05.123 [ERR] RPCS: rpc call failed dial=fail\n"
            "2026-01-02 03:09:05.456 [ERR] RPCS: rpc call failed dial=fail\n"
        )
        events = extract_events(text, "rpc call failed", "lnd", "error", [])
        signatures = {e["signature"] for e in events}
        self.assertEqual(len(signatures), 1)


class TestRedaction(unittest.TestCase):
    def test_macaroon_hex_redacted_in_message(self):
        text = "2026-01-02 03:04:05 [ERR] auth failed macaroon " + MACAROON_HEX
        events = extract_events(text, "auth failed", "lnd", "error", [])
        self.assertEqual(len(events), 1)
        self.assertNotIn(MACAROON_HEX, events[0]["message"])
        self.assertIn("<redacted>", events[0]["message"])

    def test_secret_kv_redacted(self):
        text = "2026-01-02 03:04:05 [ERR] db connect failed password=hunter2sekrit"
        events = extract_events(text, "db connect failed", "postgres", "error", [])
        self.assertNotIn("hunter2sekrit", events[0]["message"])
        self.assertIn("password=<redacted>", events[0]["message"])

    def test_context_lines_are_redacted_too(self):
        text = (
            "line before with macaroon=" + MACAROON_HEX + "\n"
            "2026-01-02 03:04:05 [ERR] boom happened\n"
            "line after\n"
        )
        events = extract_events(text, "boom happened", "lnd", "error", [])
        self.assertNotIn(MACAROON_HEX, events[0]["context_lines"])

    def test_message_truncated_to_max_chars(self):
        text = "ERRMARK " + ("x" * (MESSAGE_MAX_CHARS + 500))
        events = extract_events(text, "ERRMARK", "svc", "error", [])
        self.assertLessEqual(len(events[0]["message"]), MESSAGE_MAX_CHARS)


class TestContextWindow(unittest.TestCase):
    def test_context_spans_matched_line_plus_minus_5(self):
        lines = [f"line-{i}" for i in range(20)]
        lines[10] = "line-10 THE-ERROR here"
        text = "\n".join(lines)
        events = extract_events(text, "THE-ERROR", "svc", "error", [])
        self.assertEqual(len(events), 1)
        ctx = events[0]["context_lines"].splitlines()
        self.assertEqual(len(ctx), 11)  # matched line +/- 5
        self.assertEqual(ctx[0], "line-5")
        self.assertEqual(ctx[5], "line-10 THE-ERROR here")
        self.assertEqual(ctx[10], "line-15")

    def test_context_clamped_at_file_start(self):
        text = "THE-ERROR at line zero\nline-1\nline-2\n"
        events = extract_events(text, "THE-ERROR", "svc", "error", [])
        ctx = events[0]["context_lines"].splitlines()
        self.assertEqual(ctx[0], "THE-ERROR at line zero")
        self.assertLessEqual(len(ctx), 6)


class TestExemplarCap(unittest.TestCase):
    def test_per_signature_exemplar_count_capped_at_keep_n(self):
        # 50 recurrences of the same normalized line: exemplars <= KEEP_N,
        # while sig_tick_count carries the TRUE occurrence count (D-07).
        text = "\n".join(
            f"2026-01-02 03:{i:02d}:05 [ERR] PEER: flaky peer disconnected code={i}"
            for i in range(50)
        )
        events = extract_events(text, "flaky peer disconnected", "lnd", "error", [])
        self.assertLessEqual(len(events), KEEP_N)
        self.assertEqual(len({e["signature"] for e in events}), 1)
        for event in events:
            self.assertEqual(event["sig_tick_count"], 50)

    def test_distinct_signatures_not_dropped_by_cap(self):
        # D-07: the cap is per-signature - distinct signatures all survive.
        text = (
            "2026-01-02 03:04:05 [ERR] failure alpha happened\n"
            "2026-01-02 03:04:06 [ERR] failure beta happened\n"
            "2026-01-02 03:04:07 [ERR] failure gamma happened\n"
        )
        events = extract_events(text, "failure", "lnd", "error", [])
        self.assertEqual(len({e["signature"] for e in events}), 3)


class TestConfigClassification(unittest.TestCase):
    def test_matched_config_row_yields_classification_and_config_id(self):
        text = "2026-01-02 03:04:05 [ERR] PEER: unable to read message from peer: EOF"
        events = extract_events(text, "unable to read message", "lnd", "error", CONFIG)
        self.assertEqual(events[0]["classification"], "benign")
        self.assertEqual(events[0]["config_id"], BENIGN_CONFIG_ROW["id"])

    def test_service_scoped_row_matches_own_service(self):
        text = "Jan 12 03:04:05 host postgres[123]: FATAL: sorry, too many clients already"
        events = extract_events(text, "FATAL", "postgres", "fatal", CONFIG)
        self.assertEqual(events[0]["classification"], "ap12")
        self.assertEqual(events[0]["config_id"], AP12_CONFIG_ROW["id"])

    def test_unmatched_line_is_other_with_null_config_id(self):
        text = "2026-01-02 03:04:05 [ERR] some never-before-seen failure"
        events = extract_events(text, "never-before-seen", "lnd", "error", CONFIG)
        self.assertEqual(events[0]["classification"], "other")
        self.assertIsNone(events[0]["config_id"])

    def test_source_path_threaded_onto_event(self):
        text = "2026-01-02 03:04:05 [ERR] whoops it broke"
        events = extract_events(
            text, "whoops", "lnd", "error", [], source_path="/lnd/logs/lnd.log"
        )
        self.assertEqual(events[0]["source_path"], "/lnd/logs/lnd.log")


class TestRedactStandalone(unittest.TestCase):
    def test_redact_base64_blob(self):
        blob = "QWxhZGRpbjpvcGVuIHNlc2FtZQ" * 3  # >48 chars base64-ish
        self.assertNotIn(blob, _redact("macaroon blob " + blob + " trailing"))


# ─────────────────────────────────────────────────────────────────────
# COL-03 deep-VM pure-parse tests (fixture /proc text; no live procfs)
# ─────────────────────────────────────────────────────────────────────
PROC_STAT_4CORE = """cpu  400 40 200 8000 100 4 8 40 0 0
cpu0 100 10 50 2000 25 1 2 10 0 0
cpu1 100 10 50 2000 25 1 2 11 0 0
cpu2 100 10 50 2000 25 1 2 12 0 0
cpu3 100 10 50 2000 25 1 2 13 0 0
intr 987654 1 2 3
ctxt 123456789
btime 1784000000
procs_running 3
procs_blocked 1
"""

DISKSTATS_FIXTURE = """   8       0 sda 51022 4207 3900956 27554 118120 79582 5006952 118577 0 63432 146131 0 0 0 0
   8       1 sda1 50784 4207 3891644 27500 117000 79000 5000000 118000 0 63000 145500 0 0 0 0
   7       0 loop0 55 0 2130 30 0 0 0 0 0 40 30 0 0 0 0
   1       0 ram0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0
 253       0 dm-0 100 0 800 50 200 0 1600 90 0 120 140 0 0 0 0
"""

NET_SNMP_FIXTURE = """Ip: Forwarding DefaultTTL InReceives
Ip: 2 64 1000
Tcp: RtoAlgorithm RtoMin RtoMax MaxConn ActiveOpens PassiveOpens AttemptFails EstabResets CurrEstab InSegs OutSegs RetransSegs InErrs OutRsts InCsumErrors
Tcp: 1 200 120000 -1 5817 972 137 12 38 501234 498765 4242 0 213 0
"""

NET_DEV_FIXTURE = """Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1234567    9999    0    0    0     0          0         0  1234567    9999    0    0    0     0       0          0
  eth0: 987654321 765432    7    3    0     0          0         0 123456789 654321    2    1    0     5       0          0
"""


class TestDeepVmParsers(unittest.TestCase):
    def test_cpu_cores_four_core_fixture(self):
        """A 4-core /proc/stat yields 4 core dicts; steal read from full-line
        field index 8 (values 10..13 per the fixture); aggregate `cpu ` skipped."""
        from collect_telemetry import _parse_cpu_cores

        cores = _parse_cpu_cores(PROC_STAT_4CORE)
        self.assertEqual(len(cores), 4)
        self.assertEqual([c["core_index"] for c in cores], [0, 1, 2, 3])
        self.assertEqual([c["steal_jiffies"] for c in cores], [10, 11, 12, 13])
        self.assertEqual(cores[0]["iowait_jiffies"], 25)
        self.assertEqual(cores[0]["idle_jiffies"], 2000)

    def test_proc_stat_scalars(self):
        from collect_telemetry import _parse_proc_stat_scalars

        scalars = _parse_proc_stat_scalars(PROC_STAT_4CORE)
        self.assertEqual(scalars["ctxt"], 123456789)
        self.assertEqual(scalars["intr"], 987654)  # first field = total
        self.assertEqual(scalars["btime"], 1784000000)
        self.assertEqual(scalars["procs_running"], 3)
        self.assertEqual(scalars["procs_blocked"], 1)

    def test_diskstats_skips_pseudo_devices(self):
        """loop*/ram* are filtered; dm-* (LVM/LUKS) and real devices are captured
        and parse the 1-based fields (IN-02)."""
        from collect_telemetry import _parse_diskstats

        rows = _parse_diskstats(DISKSTATS_FIXTURE)
        devices = [r["device"] for r in rows]
        self.assertNotIn("loop0", devices)
        self.assertNotIn("ram0", devices)
        self.assertIn("dm-0", devices)
        self.assertIn("sda", devices)
        sda = rows[devices.index("sda")]
        self.assertEqual(sda["reads_completed"], 51022)     # fld4
        self.assertEqual(sda["sectors_read"], 3900956)      # fld6
        self.assertEqual(sda["writes_completed"], 118120)   # fld8
        self.assertEqual(sda["sectors_written"], 5006952)   # fld10
        self.assertEqual(sda["ios_in_progress"], 0)         # fld12
        self.assertEqual(sda["ms_doing_io"], 63432)         # fld13

    def test_snmp_tcp_extracts_retrans_segs(self):
        from collect_telemetry import _parse_snmp_tcp

        tcp = _parse_snmp_tcp(NET_SNMP_FIXTURE)
        self.assertEqual(tcp["tcp_retrans_segs"], 4242)
        self.assertEqual(tcp["tcp_out_segs"], 498765)
        self.assertEqual(tcp["tcp_in_segs"], 501234)
        self.assertEqual(tcp["tcp_active_opens"], 5817)
        self.assertEqual(tcp["tcp_attempt_fails"], 137)

    def test_net_dev_skips_loopback(self):
        from collect_telemetry import _parse_net_dev_ifaces

        rows = _parse_net_dev_ifaces(NET_DEV_FIXTURE)
        self.assertEqual(len(rows), 1)
        eth0 = rows[0]
        self.assertEqual(eth0["iface"], "eth0")
        self.assertEqual(eth0["rx_bytes"], 987654321)
        self.assertEqual(eth0["rx_errs"], 7)
        self.assertEqual(eth0["rx_drop"], 3)
        self.assertEqual(eth0["tx_bytes"], 123456789)
        self.assertEqual(eth0["tx_errs"], 2)
        self.assertEqual(eth0["tx_drop"], 1)
        self.assertEqual(eth0["tx_colls"], 5)

    def test_file_nr_and_ss_summary(self):
        from collect_telemetry import _parse_file_nr, _parse_ss_summary

        self.assertEqual(_parse_file_nr("9344\t0\t9223372036854775807\n"),
                         (9344, 9223372036854775807))
        self.assertEqual(_parse_file_nr("garbage"), (None, None))
        ss = _parse_ss_summary(
            "Total: 512\nTCP:   77 (estab 41, closed 20, orphaned 0, timewait 9)\n"
        )
        self.assertEqual(ss["sockets_total"], 512)
        self.assertEqual(ss["tcp_estab"], 41)
        self.assertEqual(ss["tcp_time_wait"], 9)

    def test_vmstat_oom_kill(self):
        from collect_telemetry import _parse_vmstat

        vm = _parse_vmstat("pgfault 100\npgmajfault 5\npswpin 1\npswpout 2\noom_kill 0\n")
        self.assertEqual(vm["oom_kill"], 0)
        self.assertEqual(vm["pgmajfault"], 5)

    def test_df_inodes_parse(self):
        from collect_telemetry import _parse_df_inodes

        text = (
            "Filesystem      Inodes  IUsed   IFree IUse% Mounted on\n"
            "/dev/sda1      6553600 412000 6141600    7% /\n"
            "tmpfs           999999     10  999989    1% /run\n"
        )
        inodes = _parse_df_inodes(text)
        self.assertEqual(inodes["/"], (6553600, 412000, 6141600))
        self.assertEqual(inodes["/run"], (999999, 10, 999989))


class TestClockOffsetGraceful(unittest.TestCase):
    def test_clock_offset_none_when_tools_absent(self):
        """chronyc/ntpq absent (run_argv rc!=0) -> None, never a crash (A2)."""
        import collect_telemetry as ct

        original = ct.run_argv
        try:
            ct.run_argv = lambda argv, timeout=10: (1, "", "not found")
            self.assertIsNone(ct.gather_clock_offset())
        finally:
            ct.run_argv = original

    def test_chronyc_tracking_parse_signs(self):
        from collect_telemetry import _parse_chronyc_tracking

        fast = "System time     : 0.000123456 seconds fast of NTP time\n"
        slow = "System time     : 0.002000000 seconds slow of NTP time\n"
        self.assertAlmostEqual(_parse_chronyc_tracking(fast), 0.000123456)
        self.assertAlmostEqual(_parse_chronyc_tracking(slow), -0.002)
        self.assertIsNone(_parse_chronyc_tracking("no such line"))


# ─────────────────────────────────────────────────────────────────────
# COL-04/COL-05 Wave-0 RED scaffolding (Phase 16, Plan 16-01).
#
# These pin the NEW capture mechanics BEFORE any collector code exists:
#   read_since / resolve_artifact / save_cursors (16-02) and the
#   capture-by-pattern + tier-gating + IP:port normalization (16-03).
# They are RED NOW ON PURPOSE — the referenced functions/behaviors do not
# exist yet, so each class fails with ImportError / AttributeError /
# TypeError / assertion. Do NOT weaken them to pass against current code.
#
# ISOLATION (T-16-01): every fixture writes ONLY to tempfile paths — never
# next to a real node log. No DB, no network.
#
# IMPORTS ARE LAZY (inside each method, mirroring TestDeepVmParsers) so a
# missing symbol errors ONLY the new test, never the module import — the 27
# pre-existing tests keep running.
# ─────────────────────────────────────────────────────────────────────


def _write_tmp(content, dir=None, suffix=".log"):
    """Write bytes/str to a fresh NamedTemporaryFile; return its path. Caller
    is responsible for unlink (tests use addCleanup)."""
    data = content.encode("utf-8") if isinstance(content, str) else content
    fd, path = tempfile.mkstemp(suffix=suffix, dir=dir)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    return path


class TestCursorReadSince(unittest.TestCase):
    """read_since(source_key, path, cursors) -> (lines, updated_cursors):
    resume-at-offset, complete-lines-only, trailing-partial parking, and the
    {path,inode,offset,size} cursor shape (D-09, COL-04)."""

    def test_resume_from_saved_offset_returns_only_bytes_after_it(self):
        from collect_telemetry import read_since

        path = _write_tmp("one\ntwo\nthree\nfour\n")
        self.addCleanup(os.unlink, path)
        ino = os.stat(path).st_ino
        # offset 8 == start of "three" (len("one\ntwo\n") == 8).
        cursors = {"svc": {"path": path, "inode": ino, "offset": 8, "size": 8}}
        lines, updated = read_since("svc", path, cursors)
        self.assertIn("three", lines)
        self.assertIn("four", lines)
        self.assertNotIn("one", lines)
        self.assertNotIn("two", lines)
        self.assertEqual(updated["svc"]["offset"], 19)  # parked at EOF newline

    def test_first_sight_seeds_near_eof_not_offset_zero(self):
        from collect_telemetry import INITIAL_TAIL_BYTES, read_since

        # A file LARGER than the bootstrap window: first sight must seed a
        # recent tail (size - INITIAL_TAIL_BYTES), never ingest from line 0.
        filler = "\n".join(f"FILLER-{i:05d}" for i in range(6000))  # ~78 KB
        content = "FIRST_LINE_MARKER\n" + filler + "\nLAST_LINE_MARKER\n"
        self.assertGreater(len(content.encode()), INITIAL_TAIL_BYTES)
        path = _write_tmp(content)
        self.addCleanup(os.unlink, path)
        lines, updated = read_since("svc", path, {})  # no cursor == first sight
        self.assertIn("LAST_LINE_MARKER", lines)
        self.assertNotIn("FIRST_LINE_MARKER", lines)
        self.assertGreater(updated["svc"]["offset"], 0)

    def test_trailing_partial_line_is_not_emitted_and_offset_parks(self):
        from collect_telemetry import read_since

        path = _write_tmp("alpha\nbeta\ngamma_partial")  # no final newline
        self.addCleanup(os.unlink, path)
        lines, updated = read_since("svc", path, {})
        self.assertIn("alpha", lines)
        self.assertIn("beta", lines)
        self.assertNotIn("gamma_partial", lines)
        # parked at last "\n"+1 == len("alpha\nbeta\n") == 11
        self.assertEqual(updated["svc"]["offset"], 11)

    def test_updated_cursor_carries_full_shape(self):
        from collect_telemetry import read_since

        path = _write_tmp("x\ny\n")
        self.addCleanup(os.unlink, path)
        _, updated = read_since("svc", path, {})
        cur = updated["svc"]
        self.assertEqual(set(cur.keys()), {"path", "inode", "offset", "size"})
        self.assertEqual(cur["path"], path)
        self.assertEqual(cur["inode"], os.stat(path).st_ino)
        self.assertEqual(cur["size"], os.stat(path).st_size)


class TestRotation(unittest.TestCase):
    """Dual rotation detection (Pattern 2, COL-04): inode change (LND
    stable-name rename-archive) AND size shrink (truncate) both reset to a
    fresh read from the start of the current file."""

    def test_inode_change_is_detected_as_rotation(self):
        from collect_telemetry import read_since

        d = tempfile.mkdtemp()
        self.addCleanup(lambda: None)
        path = os.path.join(d, "lnd.log")
        with open(path, "wb") as fh:
            fh.write(b"old1\nold2\n")
        self.addCleanup(os.unlink, path)
        ino_a = os.stat(path).st_ino
        cursors = {"lnd": {"path": path, "inode": ino_a, "offset": 10, "size": 10}}

        # Rotate: a NEW file (new inode) takes the stable name via os.replace.
        replacement = os.path.join(d, "lnd.log.new")
        with open(replacement, "wb") as fh:
            fh.write(b"new1\nnew2\n")
        os.replace(replacement, path)  # inode changes under the stable name
        self.assertNotEqual(os.stat(path).st_ino, ino_a)

        lines, updated = read_since("lnd", path, cursors)
        self.assertIn("new1", lines)  # drained the rotated-in file from the top
        self.assertEqual(updated["lnd"]["inode"], os.stat(path).st_ino)

    def test_size_shrink_below_offset_is_detected_as_rotation(self):
        from collect_telemetry import read_since

        path = _write_tmp("L1\nL2\nL3\nL4\nL5\n")  # 15 bytes
        self.addCleanup(os.unlink, path)
        ino = os.stat(path).st_ino
        cursors = {"svc": {"path": path, "inode": ino, "offset": 12, "size": 15}}
        # Truncate below the saved offset (same inode) -> shrink == rotation.
        with open(path, "wb") as fh:
            fh.write(b"X\n")
        lines, _ = read_since("svc", path, cursors)
        self.assertEqual(lines, ["X"])  # re-read from 0, not stuck past EOF


class TestPgGlobNewestMatch(unittest.TestCase):
    """Postgres timestamped-filename rotation (Pattern 2, COL-04):
    resolve_artifact() treats the artifact as a glob and returns the newest
    match by mtime; a day-roll (resolved path != cursor's stored path) is the
    caller's rotation signal."""

    def _two_pg_logs(self):
        d = tempfile.mkdtemp()
        old = os.path.join(d, "postgresql-2026-07-15.log")
        new = os.path.join(d, "postgresql-2026-07-16.log")
        for p in (old, new):
            with open(p, "wb") as fh:
                fh.write(b"pg line\n")
        now = time.time()
        os.utime(old, (now - 86400, now - 86400))
        os.utime(new, (now, now))
        self.addCleanup(os.unlink, old)
        self.addCleanup(os.unlink, new)
        return d, old, new

    def test_resolve_returns_newest_by_mtime(self):
        from collect_telemetry import resolve_artifact

        d, old, new = self._two_pg_logs()
        glob_path = os.path.join(d, "postgresql-*.log")
        self.assertEqual(resolve_artifact(glob_path), new)

    def test_resolve_ignores_non_matching_files(self):
        from collect_telemetry import resolve_artifact

        d, old, new = self._two_pg_logs()
        decoy = os.path.join(d, "not-a-pg.txt")
        with open(decoy, "wb") as fh:
            fh.write(b"noise\n")
        self.addCleanup(os.unlink, decoy)
        self.assertEqual(resolve_artifact(os.path.join(d, "postgresql-*.log")), new)

    def test_day_roll_is_visible_as_a_path_change_against_the_cursor(self):
        from collect_telemetry import resolve_artifact

        d, old, new = self._two_pg_logs()
        # A cursor keyed by the STABLE source_key still points at yesterday's
        # file; the newest-glob resolution differs -> the caller drains `old`.
        cursor = {"postgres": {"path": old, "inode": 1, "offset": 0, "size": 8}}
        resolved = resolve_artifact(os.path.join(d, "postgresql-*.log"))
        self.assertNotEqual(resolved, cursor["postgres"]["path"])
        self.assertEqual(resolved, new)


class TestBoundedBytes(unittest.TestCase):
    """Bounded per-tick bytes with a LOGGED truncation (COL-04, Open Q1
    'defer'): when size-offset exceeds MAX_BYTES_PER_TICK the read is capped,
    a truncation marker is logged, and the offset advances by the cap (not to
    EOF) so the remainder is deferred to the next tick."""

    def test_oversized_backlog_caps_logs_and_defers_remainder(self):
        import collect_telemetry as ct
        from collect_telemetry import MAX_BYTES_PER_TICK, read_since

        # 100-byte lines; total comfortably exceeds the 8 MB cap.
        line = b"X" * 99 + b"\n"
        n_lines = (MAX_BYTES_PER_TICK // 100) + 10000
        path = _write_tmp(line * n_lines)
        self.addCleanup(os.unlink, path)
        size = os.stat(path).st_size
        ino = os.stat(path).st_ino
        self.assertGreater(size, MAX_BYTES_PER_TICK)

        # Saved offset 0 with matching inode -> resume from 0 -> full backlog.
        cursors = {"svc": {"path": path, "inode": ino, "offset": 0, "size": 0}}

        captured = []
        original_log = ct.log
        ct.log = lambda msg: captured.append(msg)
        try:
            lines, updated = read_since("svc", path, cursors)
        finally:
            ct.log = original_log

        new_offset = updated["svc"]["offset"]
        self.assertLessEqual(new_offset, MAX_BYTES_PER_TICK)  # capped, not EOF
        self.assertLess(new_offset, size)  # remainder deferred
        self.assertGreater(new_offset, 0)
        self.assertTrue(
            any("TRUNCATED" in m or "truncat" in m.lower() for m in captured),
            "expected a logged truncation marker for the deferred backlog",
        )


class TestCaptureByPattern(unittest.TestCase):
    """Capture-by-regex-match (COL-05): a line is captured iff _classify
    returns a non-null config match — NOT only when it contains the single
    error_pattern substring (the old L701-703 gate is gone)."""

    CONFIG = [
        {
            "id": "aaaa1111-0000-0000-0000-000000000001",
            "match_expression": r"\[WRN\]",
            "service": None,
            "level": "warn",
            "classification": "warn",
            "suppress": False,
        },
        {
            "id": "aaaa1111-0000-0000-0000-000000000002",
            "match_expression": r"\[CRT\]",
            "service": None,
            "level": "critical",
            "classification": "critical",
            "suppress": False,
        },
    ]

    def test_wrn_and_crt_captured_without_error_pattern_substring(self):
        text = (
            "2026-01-02 03:04:05.111 [WRN] HSWC: link inactive, backpressure\n"
            "2026-01-02 03:04:06.222 [CRT] CHDB: database corruption suspected\n"
        )
        # error_pattern is ABSENT from both lines: the old substring gate would
        # capture NOTHING; capture-by-pattern captures BOTH via config match.
        events = extract_events(text, "ZZZ_ABSENT_MARKER", "lnd", "error", self.CONFIG)
        messages = " ".join(e["message"] for e in events)
        self.assertGreaterEqual(len(events), 2)
        self.assertIn("[WRN]", messages)
        self.assertIn("[CRT]", messages)


class TestTierGating(unittest.TestCase):
    """Tier gating (COL-05, D-05/D-06): the matched config row's
    `classification` value (info|warn|critical) is the tier. info -> ZERO
    exemplars while the aggregate count STILL survives; warn -> <=KEEP_N;
    critical -> exemplars."""

    @staticmethod
    def _cfg(classification, mark):
        return [{
            "id": f"cfg-{classification}",
            "match_expression": mark,
            "service": None,
            "level": classification,
            "classification": classification,
            "suppress": False,
        }]

    def test_info_tier_yields_zero_exemplars(self):
        # Three lines sharing ONE signature (differ only by timestamp) and
        # CONTAINING the error_pattern — so current code WOULD emit exemplars
        # (making this RED); tier gating must drop info exemplars to zero.
        text = "\n".join(
            f"2026-01-02 03:0{i}:05 [INF] INFO_MARK peer flapped id={i}"
            for i in range(3)
        ) + "\n"
        events = extract_events(text, "INFO_MARK", "lnd", "info", self._cfg("info", "INFO_MARK"))
        self.assertEqual(len(events), 0)

    def test_info_tier_aggregate_count_survives(self):
        # The D-06 aggregate must still bump even when exemplars are zero.
        # `return_aggregate=True` is the planned surface (16-03) — current
        # extract_events lacks it -> TypeError -> RED.
        text = "\n".join(
            f"2026-01-02 03:0{i}:05 [INF] INFO_MARK peer flapped id={i}"
            for i in range(3)
        ) + "\n"
        exemplars, aggregates = extract_events(
            text, "INFO_MARK", "lnd", "info", self._cfg("info", "INFO_MARK"),
            return_aggregate=True,
        )
        self.assertEqual(len(exemplars), 0)
        self.assertEqual(len(aggregates), 1)
        self.assertEqual(aggregates[0]["sig_tick_count"], 3)

    def test_warn_tier_capped_at_keep_n(self):
        text = "\n".join(
            f"2026-01-02 03:0{i}:05 [WRN] WARN_MARK backpressure id={i}"
            for i in range(5)
        ) + "\n"
        events = extract_events(text, "WARN_MARK", "lnd", "warn", self._cfg("warn", "WARN_MARK"))
        self.assertGreaterEqual(len(events), 1)
        self.assertLessEqual(len(events), KEEP_N)

    def test_critical_tier_yields_exemplars(self):
        text = "2026-01-02 03:04:05 [CRT] CRIT_MARK database corruption\n"
        events = extract_events(text, "CRIT_MARK", "lnd", "critical", self._cfg("critical", "CRIT_MARK"))
        self.assertGreaterEqual(len(events), 1)


class TestIpPortNormalize(unittest.TestCase):
    """IP:port normalization (Pattern 5, COL-05): two per-peer broken-pipe
    lines to different IPv4:port peers collapse to ONE signature after
    _normalize (mirrors TestNormalizeSignatureStability)."""

    def test_per_peer_broken_pipe_lines_share_one_signature(self):
        line_a = (
            "2026-01-02 03:04:05.123 [ERR] HSWC: peer 172.31.11.142:9735->"
            "203.0.113.5:41234 broken pipe"
        )
        line_b = (
            "2026-03-09 17:44:59.901 [ERR] HSWC: peer 10.0.0.1:8333->"
            "198.51.100.9:5555 broken pipe"
        )
        self.assertEqual(_normalize(line_a), _normalize(line_b))


# ─────────────────────────────────────────────────────────────────────
# Gap A (260721-fou): LND "functioning" probe fix. Three sequenced decisions
# pinned by offline tests — A2c (capture-first), A2a (functioning redefine for
# pgrep persistent procs), A2b (honest detail). Every fixture writes ONLY to
# tempfile paths (ISOLATION); no DB, no network. Imports are LAZY per method so
# a missing new symbol errors ONLY the new test, never the module import.
# ─────────────────────────────────────────────────────────────────────


def _pgrep_inv(artifact_path, **overrides):
    """Build a pgrep persistent-proc service_inventory row for grade_log_service.
    Defaults model an LND row: pgrep detection, [ERR] error_pattern, no
    success_pattern, 300s interval."""
    inv = {
        "service_name": "lnd",
        "node_pubkey": "pk",
        "detection_method": "pgrep",
        "running_target": "lnd",
        "artifact_path": artifact_path,
        "success_pattern": None,
        "error_pattern": "[ERR]",
        "expected_interval_seconds": 300,
        "is_expected": True,
    }
    inv.update(overrides)
    return inv


class TestPersistentErrCapture(unittest.TestCase):
    """A2c (capture-FIRST): benign LND [ERR] lines in a fresh pgrep tail are
    captured as service_log_events exemplars via the error_pattern substring
    path — this PINS capture so Task 2 (dropping the error_count functioning
    gate) cannot silently take capture down with it."""

    def test_benign_err_lines_are_captured_without_config(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = (
            "2026-01-02 03:04:05.111 [ERR] PEER: unable to read message from peer: EOF\n"
            "2026-01-02 03:04:06.222 [ERR] HSWC: link inactive, backpressure\n"
        )
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertGreaterEqual(len(result["log_events"]), 1)
        messages = " ".join(e["message"] for e in result["log_events"])
        self.assertIn("[ERR]", messages)

    def test_capture_is_capped_but_aggregate_reflects_true_count(self):
        import datetime as dt
        from collect_telemetry import KEEP_N, grade_log_service

        # 50 same-signature [ERR] lines (differ only by timestamp + code=<n>) ->
        # <= KEEP_N exemplars while the aggregate's sig_tick_count == 50.
        text = "\n".join(
            f"2026-01-02 03:{i:02d}:05 [ERR] PEER: flaky peer disconnected code={i}"
            for i in range(50)
        ) + "\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertLessEqual(len(result["log_events"]), KEEP_N)
        self.assertEqual(len(result["log_aggregates"]), 1)
        self.assertEqual(result["log_aggregates"][0]["sig_tick_count"], 50)


class TestFunctioningSemantics(unittest.TestCase):
    """A2a: persistent (pgrep) procs grade functioning = running AND fresh,
    downed ONLY by a FATAL/[CRT]-class signature — never by benign [ERR] count.
    Batch (non-pgrep) services keep the error_count/success_pattern rule (Test 5
    regression guard)."""

    def test_1_benign_err_fresh_pgrep_is_functioning_true(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = (
            "2026-01-02 03:04:05.111 [ERR] PEER: unable to read message from peer: EOF\n"
            "2026-01-02 03:04:06.222 [ERR] HSWC: link inactive, backpressure\n"
        )
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        # Under the OLD rule error_count>0 forced False; this is the core fix.
        self.assertTrue(result["functioning"])

    def test_1c_fresh_pgrep_sets_last_success_at_to_mtime(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = "2026-01-02 03:04:05.111 [ERR] PEER: benign churn\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)  # no success_pattern
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertIsNotNone(result["last_success_at"])
        self.assertEqual(result["last_success_at"], result["last_artifact_mtime"])

    def test_2_crt_line_pgrep_is_functioning_false(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = (
            "2026-01-02 03:04:05.111 [ERR] PEER: benign churn\n"
            "2026-01-02 03:04:06.222 [CRT] CHDB: database corruption suspected\n"
        )
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertFalse(result["functioning"])

    def test_2_fatal_word_pgrep_is_functioning_false(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = "2026-01-02 03:04:05.111 [ERR] LTND: FATAL: cannot open wallet db\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertFalse(result["functioning"])

    def test_2b_not_running_pgrep_is_functioning_false(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = "2026-01-02 03:04:05.111 [ERR] PEER: benign churn\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=False, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertFalse(result["functioning"])

    def test_5_batch_service_keeps_error_count_rule(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        # Non-pgrep (cron-mtime) batch service with benign [ERR] lines: the
        # persistent-proc rule must NOT leak in — error lines STILL down it.
        text = "2026-01-02 03:04:05.111 [ERR] batch job hiccup, retrying\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = {
            "service_name": "some-batch",
            "node_pubkey": "pk",
            "detection_method": "cron-mtime",
            "running_target": None,
            "artifact_path": path,
            "success_pattern": "job complete",
            "error_pattern": "[ERR]",
            "expected_interval_seconds": 300,
            "is_expected": True,
        }
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        # error_count > 0 -> functioning False under the unchanged batch rule.
        self.assertGreater(result["error_count"], 0)
        self.assertFalse(result["functioning"])
        # last_success_at only via success_pattern (absent from tail) -> None.
        self.assertIsNone(result["last_success_at"])

    def test_5b_batch_service_functioning_true_when_clean(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        # Batch service, fresh, NO error lines, success_pattern present ->
        # functioning True and last_success_at set from the success marker.
        text = "2026-01-02 03:04:05.111 [INF] job complete: 42 rows\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = {
            "service_name": "some-batch",
            "node_pubkey": "pk",
            "detection_method": "cron-mtime",
            "running_target": None,
            "artifact_path": path,
            "success_pattern": "job complete",
            "error_pattern": "[ERR]",
            "expected_interval_seconds": 300,
            "is_expected": True,
        }
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertEqual(result["error_count"], 0)
        self.assertTrue(result["functioning"])
        self.assertIsNotNone(result["last_success_at"])


class TestFunctioningDetail(unittest.TestCase):
    """A2b: every functioning=false PERSISTENT row carries an honest `detail`
    reason (stale / critical / not-running / missing); functioning=true rows
    carry no false reason. Substring assertions keep exact wording flexible."""

    def test_3_stale_pgrep_reports_artifact_stale_with_age(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = "2026-01-02 03:04:05.111 [ERR] PEER: benign churn\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        old = time.time() - 3600  # 1h old; interval*grace = 300*3 = 900s
        os.utime(path, (old, old))
        inv = _pgrep_inv(path, expected_interval_seconds=300)
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertFalse(result["functioning"])
        self.assertIn("artifact stale", result["detail"])
        self.assertIn("60m", result["detail"])

    def test_2_crt_detail_names_critical_signature(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = (
            "2026-01-02 03:04:05.111 [ERR] PEER: benign churn\n"
            "2026-01-02 03:04:06.222 [CRT] CHDB: database corruption suspected\n"
        )
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertFalse(result["functioning"])
        self.assertIn("critical signature", result["detail"])
        self.assertIn("1", result["detail"])

    def test_2b_not_running_detail_names_reason(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = "2026-01-02 03:04:05.111 [ERR] PEER: benign churn\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=False, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertFalse(result["functioning"])
        self.assertIn("not running", result["detail"])

    def test_artifact_missing_detail_unchanged(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        inv = _pgrep_inv("/nonexistent/path/does-not-exist.log")
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertFalse(result["functioning"])
        self.assertEqual(result["detail"], "artifact missing")

    def test_functioning_true_carries_no_false_reason(self):
        import datetime as dt
        from collect_telemetry import grade_log_service

        text = "2026-01-02 03:04:05.111 [ERR] PEER: benign churn\n"
        path = _write_tmp(text)
        self.addCleanup(os.unlink, path)
        inv = _pgrep_inv(path)
        result = grade_log_service(
            inv, running=True, now=dt.datetime.now(), config=[], cursors={}
        )
        self.assertTrue(result["functioning"])
        self.assertIsNone(result["detail"])


# ─────────────────────────────────────────────────────────────────────
# Phase 18-08 (CODE-REVIEW-2026-07-22): honest-stale at the capture boundary.
#   C-iso — one bad artifact degrades ONE service, not the whole host tick.
#   C1    — a Postgres day-roll drains the PREVIOUS dated file's unread tail.
#   C2    — multi-rotation between ticks drains each archive from the correct
#           boundary in chronological order (no skipped .2 tail).
#   C4    — a .zst rotation surfaces the boundary (or a rotation-gap marker)
#           rather than silently reading "no errors" (returning []).
# Every fixture writes ONLY to tempfile paths (ISOLATION); no DB, no network.
# Imports are LAZY per method so a missing new symbol errors ONLY the new test.
# ─────────────────────────────────────────────────────────────────────


class TestPerServiceIsolation(unittest.TestCase):
    """C-iso (collect_telemetry.py:1848): one uncaught OSError while grading a
    single inventory row (e.g. resolve_artifact/getmtime racing logrotate) must
    NOT black out the whole host tick. grade_inventory wraps each row in
    try/except OSError, emitting functioning=False, detail='collector error'
    for THAT service while every other service still produces a row."""

    def test_one_oserror_degrades_one_service_others_survive(self):
        import datetime as dt
        import collect_telemetry as ct
        from collect_telemetry import grade_inventory

        good_path = _write_tmp(
            "2026-01-02 03:04:05.111 [ERR] PEER: benign churn\n"
        )
        self.addCleanup(os.unlink, good_path)
        good = _pgrep_inv(good_path, service_name="good-svc")
        bad = _pgrep_inv("/bad/marker/does-not-resolve.log", service_name="bad-svc")

        original_resolve = ct.resolve_artifact
        original_detect = ct.detect_running

        def fake_resolve(p):
            if p == "/bad/marker/does-not-resolve.log":
                raise OSError("logrotate race: stale file handle")
            return original_resolve(p)

        ct.resolve_artifact = fake_resolve
        ct.detect_running = lambda inv, now: True  # deterministic; no host pgrep
        try:
            services, events, aggs, cursors, pg_text = grade_inventory(
                [bad, good], dt.datetime.now(), None, None, True, [], {}
            )
        finally:
            ct.resolve_artifact = original_resolve
            ct.detect_running = original_detect

        by_name = {s["service_name"]: s for s in services}
        self.assertEqual(len(services), 2)
        # bad service degraded honestly — one service, not the host
        self.assertIn("bad-svc", by_name)
        self.assertFalse(by_name["bad-svc"]["functioning"])
        self.assertEqual(by_name["bad-svc"]["detail"], "collector error")
        # good service still graded normally (NOT swept away by the bad row)
        self.assertIn("good-svc", by_name)
        self.assertNotEqual(by_name["good-svc"]["detail"], "collector error")


class TestDayRollDrainsPreviousFile(unittest.TestCase):
    """C1 (collect_telemetry.py:722): a Postgres day-roll (resolved path !=
    cursor's stored path) must drain the PREVIOUS dated file from prev.offset
    to EOF — the previous dated file IS the archive, not a `.N` sibling of the
    new name. A seeded FATAL in the previous tail must survive."""

    def test_day_roll_drains_previous_dated_file_incl_fatal(self):
        from collect_telemetry import read_since

        d = tempfile.mkdtemp()
        old = os.path.join(d, "postgresql-2026-07-15.log")
        new = os.path.join(d, "postgresql-2026-07-16.log")
        with open(old, "wb") as fh:
            fh.write(b"OLD-HEAD-ALREADY-READ\n")
            head = fh.tell()
            fh.write(b"FATAL:  the database is dying\n")
        with open(new, "wb") as fh:
            fh.write(b"NEW-DAY-LINE\n")
        self.addCleanup(os.unlink, old)
        self.addCleanup(os.unlink, new)

        cursors = {
            "postgres": {
                "path": old,
                "inode": os.stat(old).st_ino,
                "offset": head,
                "size": os.stat(old).st_size,
            }
        }
        lines, updated = read_since("postgres", new, cursors)
        self.assertIn("FATAL:  the database is dying", lines)
        self.assertIn("NEW-DAY-LINE", lines)
        self.assertNotIn("OLD-HEAD-ALREADY-READ", lines)
        # cursor advances to the NEW day's file
        self.assertEqual(updated["postgres"]["path"], new)

    def test_drain_resets_when_offset_exceeds_previous_size(self):
        # offset > size (previous file truncated/replaced) -> reset to 0, drain
        # the whole previous file rather than seeking past EOF (C2 reset rule).
        from collect_telemetry import read_since

        d = tempfile.mkdtemp()
        old = os.path.join(d, "postgresql-2026-07-15.log")
        new = os.path.join(d, "postgresql-2026-07-16.log")
        with open(old, "wb") as fh:
            fh.write(b"SHORT-PREV-TAIL\n")
        with open(new, "wb") as fh:
            fh.write(b"NEWDAY-LINE\n")
        self.addCleanup(os.unlink, old)
        self.addCleanup(os.unlink, new)

        cursors = {
            "postgres": {
                "path": old,
                "inode": os.stat(old).st_ino,
                "offset": 999999,  # far beyond the 16-byte file
                "size": 999999,
            }
        }
        lines, _ = read_since("postgres", new, cursors)
        self.assertIn("SHORT-PREV-TAIL", lines)
        self.assertIn("NEWDAY-LINE", lines)


class TestMultiRotationDrain(unittest.TestCase):
    """C2 (collect_telemetry.py:722): two rotations between ticks. The cursor's
    file is now lnd.log.2 (unread tail after prev.offset); lnd.log.1 is a full
    rotation never seen (drain from 0); lnd.log is the live file. All three must
    surface in chronological (mtime) order — no skipped .2 tail, no wrong-offset
    partial read of .1."""

    def test_two_rotations_drain_each_from_correct_boundary_in_order(self):
        from collect_telemetry import read_since

        d = tempfile.mkdtemp()
        path = os.path.join(d, "lnd.log")
        a1 = path + ".1"
        a2 = path + ".2"
        # a2 == the file the cursor was reading: a read head + an unread tail.
        with open(a2, "wb") as fh:
            fh.write(b"A2-HEAD-SEEN\n")
            off = fh.tell()
            fh.write(b"A2-TAIL-FATAL: boom\n")
        # a1 == a full rotation we never saw: drain from 0.
        with open(a1, "wb") as fh:
            fh.write(b"A1-FULL-LINE\n")
        # live file.
        with open(path, "wb") as fh:
            fh.write(b"CURRENT-LIVE-LINE\n")
        for p in (a1, a2, path):
            self.addCleanup(os.unlink, p)

        cur_ino = os.stat(a2).st_ino
        base = time.time()
        os.utime(a2, (base - 20, base - 20))
        os.utime(a1, (base - 10, base - 10))
        os.utime(path, (base, base))

        cursors = {
            "lnd": {"path": path, "inode": cur_ino, "offset": off, "size": off}
        }
        lines, _ = read_since("lnd", path, cursors)
        self.assertIn("A2-TAIL-FATAL: boom", lines)
        self.assertIn("A1-FULL-LINE", lines)
        self.assertIn("CURRENT-LIVE-LINE", lines)
        self.assertNotIn("A2-HEAD-SEEN", lines)
        # chronological ordering: a2 tail before a1 before current
        self.assertLess(
            lines.index("A2-TAIL-FATAL: boom"), lines.index("A1-FULL-LINE")
        )
        self.assertLess(
            lines.index("A1-FULL-LINE"), lines.index("CURRENT-LIVE-LINE")
        )


class TestZstRotationGap(unittest.TestCase):
    """C4 (collect_telemetry.py:710): a .zst-compressed rotation whose tail
    cannot be decompressed must surface a persistent rotation-gap marker rather
    than silently returning [] ("no errors"). A plain sibling archive, when
    present, is still drained."""

    def test_zst_rotation_surfaces_gap_marker_not_silence(self):
        from collect_telemetry import read_since, ROTATION_GAP_MARKER

        d = tempfile.mkdtemp()
        path = os.path.join(d, "lnd.log")
        with open(path, "wb") as fh:
            fh.write(b"CURRENT-AFTER-ROTATION\n")
        zst = path + ".1.zst"
        with open(zst, "wb") as fh:
            fh.write(b"\x28\xb5\x2f\xfd not-a-valid-zstd-frame")
        for p in (path, zst):
            self.addCleanup(os.unlink, p)

        base = time.time()
        os.utime(zst, (base - 5, base - 5))
        os.utime(path, (base, base))
        # cursor inode differs from the live file -> rotation branch drains.
        cursors = {
            "lnd": {"path": path, "inode": 424242, "offset": 3, "size": 50}
        }
        lines, _ = read_since("lnd", path, cursors)
        self.assertTrue(
            any(ROTATION_GAP_MARKER in ln for ln in lines),
            f"expected a rotation-gap marker, got {lines!r}",
        )


if __name__ == "__main__":
    unittest.main()
